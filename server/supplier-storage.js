// Attaching the BYTES to a catalogued supplier file.
//
// The import walks the archive and records what exists — vendor, kind, expiry,
// and the path it was found at. It stores no bytes, so "show me the BRC
// certificate" ended at a filename. This module is the other half: it decides,
// for one file coming out of a zip, WHICH catalogued row it belongs to.
//
// Pure on purpose — paths and rows in, a decision out, no Express, no database,
// no S3. What an auditor is going to be handed should be checkable without
// standing up a server, and matching a document to the wrong vendor is the
// failure this module exists to prevent.

/** Strip the leading folder the zip was made from, and any './'. */
export function normalizePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/').filter(p => p && p !== '.').join('/');
}

/**
 * The common prefix every entry shares, so a zip made from inside the archive
 * folder and one made from its parent both match the catalogue.
 *
 * Only whole path SEGMENTS count. A character-wise prefix would happily strip
 * half a vendor name off every path when two vendors happen to share letters.
 */
export function commonPrefix(paths) {
  const lists = (paths || []).map(p => normalizePath(p).split('/')).filter(l => l.length > 1);
  if (!lists.length) return '';
  let out = lists[0].slice(0, -1);   // never consume the filename itself
  for (const l of lists.slice(1)) {
    let i = 0;
    while (i < out.length && i < l.length - 1 && out[i] === l[i]) i++;
    out = out.slice(0, i);
    if (!out.length) break;
  }
  return out.join('/');
}

/** Drop `prefix` from the front of `path` when it is there. */
export function stripPrefix(path, prefix) {
  const p = normalizePath(path);
  if (!prefix) return p;
  return p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : p;
}

/**
 * Match one archive entry to a catalogued row.
 *
 * Three passes, strongest first — the same doctrine as supplier-reconcile's
 * name matching, and for the same reason. There is deliberately NO fuzzy pass:
 * attaching a certificate to the wrong company is worse than leaving it
 * unattached and saying so.
 *
 *   1. the path, exactly as catalogued
 *   2. the path with the zip's own root folder removed
 *   3. the filename, but ONLY when exactly one catalogued row carries it —
 *      an ambiguous filename ("Certificate.pdf" under four vendors) is refused
 *
 * `rows` is [{ id, supplier_id, source_path, filename, storage_key }].
 */
export function matchArchiveFile(entryPath, rows, { prefix = '' } = {}) {
  const full = normalizePath(entryPath);
  const rel = stripPrefix(full, prefix);
  const base = full.split('/').pop();

  const byPath = new Map();
  const byName = new Map();
  for (const r of rows || []) {
    const sp = normalizePath(r.source_path);
    if (sp) byPath.set(sp, r);
    const n = String(r.filename || '').toLowerCase();
    if (!n) continue;
    if (byName.has(n)) byName.set(n, null);   // ambiguous — poisoned on purpose
    else byName.set(n, r);
  }

  const hit = byPath.get(full) || byPath.get(rel);
  if (hit) return { row: hit, how: byPath.get(full) ? 'path' : 'path-relative' };

  const named = byName.get(String(base || '').toLowerCase());
  if (named) return { row: named, how: 'filename' };
  if (named === null) return { row: null, reason: 'ambiguous filename' };
  return { row: null, reason: 'no catalogued row for this path' };
}

/** A directory entry, an OS artefact, or a nested container — never a document. */
export function isSkippable(entryPath, { isDirectory = false } = {}) {
  if (isDirectory) return 'directory';
  const p = normalizePath(entryPath);
  const base = p.split('/').pop() || '';
  if (!base) return 'directory';
  if (p.startsWith('__MACOSX/') || p.includes('/__MACOSX/')) return 'mac metadata';
  if (base.startsWith('._')) return 'mac resource fork';
  if (/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(base)) return 'os artefact';
  return null;
}

/** Where an object lives in the bucket. Keyed on the row, so it is stable. */
export function storageKeyFor(supplierId, fileId, filename) {
  const ext = (String(filename || '').match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0].toLowerCase();
  return `suppliers/${supplierId}/${fileId}${ext}`;
}

/**
 * Plan a zip against the catalogue. Writes nothing and reads no bytes — this is
 * what the screen shows BEFORE anything is uploaded, and it is computed by the
 * same function the commit uses, so the preview cannot differ from the result.
 *
 * `entries` is [{ path, isDirectory, size }].
 */
export function planArchiveUpload(entries, rows, { replace = false } = {}) {
  // The prefix is computed over the REAL documents only. A single
  // `__MACOSX/...` entry shares no root with the rest and would otherwise
  // reduce the common prefix to nothing, so every path would then have to
  // match the catalogue with the zip's own root folder still on the front —
  // which none of them do. One stray OS artefact silently unmatching an entire
  // archive is exactly the kind of failure this module has to not have.
  const real = (entries || []).filter(e => !isSkippable(e.path, e));
  const prefix = commonPrefix(real.map(e => e.path));

  const plan = { prefix, store: [], skip: [], unmatched: [] };
  const claimed = new Set();

  for (const e of entries || []) {
    const skip = isSkippable(e.path, e);
    if (skip) { plan.skip.push({ path: e.path, reason: skip }); continue; }

    const { row, how, reason } = matchArchiveFile(e.path, rows, { prefix });
    if (!row) { plan.unmatched.push({ path: e.path, reason }); continue; }

    // One catalogued row is one document. Two zip entries claiming the same row
    // means the archive holds it twice; storing the second over the first would
    // make the record say something nobody chose.
    if (claimed.has(row.id)) {
      plan.skip.push({ path: e.path, reason: 'already claimed by another entry in this zip' });
      continue;
    }
    // Already stored — the re-upload case. Skipping is what makes a timed-out
    // upload recoverable by simply doing it again.
    if (row.storage_key && !replace) {
      plan.skip.push({ path: e.path, reason: 'already stored' });
      continue;
    }
    claimed.add(row.id);
    plan.store.push({ path: e.path, file_id: row.id, supplier_id: row.supplier_id, how, size: e.size || 0 });
  }

  plan.counts = {
    store: plan.store.length,
    skip: plan.skip.length,
    unmatched: plan.unmatched.length,
    bytes: plan.store.reduce((n, s) => n + (s.size || 0), 0),
  };
  return plan;
}
