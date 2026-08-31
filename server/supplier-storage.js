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

/**
 * How much of the front of these paths is the zip's WRAPPER rather than a
 * vendor folder — the one judgement a zip walk has to make, and the one that
 * is wrong in two opposite directions if you take the shared prefix literally.
 *
 * A zip of the whole archive is `Supplier Qualification Questionnaire/AIFI/…`,
 * where the first segment must go. A zip of ONE vendor is `AIFI/2025/…`, where
 * every path shares "AIFI" and stripping it leaves the YEAR standing where the
 * vendor should be — which files every document under a supplier called 2025.
 * Commonality alone cannot tell those apart.
 *
 * The archive's own shape can: a path is `vendor/year/file` or `vendor/file`,
 * so the segment left at the front must not be a year and there must be at
 * least two segments left. Take the longest prefix that satisfies both, which
 * is nothing at all for a single-vendor zip and the wrapper for a whole-archive
 * one.
 */
const YEAR = /^(19|20)\d{2}$/;

export function archiveRoot(paths) {
  const lists = (paths || []).map(p => normalizePath(p).split('/')).filter(l => l.length > 1);
  if (!lists.length) return '';
  // A HANDFUL OF LOOSE FILES MUST NOT VETO THE STRIP FOR EVERYTHING ELSE.
  // Requiring every path to survive it meant one spreadsheet sitting at the top
  // of the archive — "Current Suppliers.xlsx", which is genuinely under no
  // vendor — cancelled the wrapper for the other 1,280 paths, and the whole
  // archive imported as a single supplier named after the download folder.
  // Same shape as the __MACOSX entry that once destroyed the shared prefix.
  //
  // So: the strip must never leave a YEAR at the front of a path deep enough to
  // have one, and it must still leave a vendor and a filename for the great
  // majority. Files it orphans are reported by parseArchivePath as not filed
  // under a vendor, which is exactly what they are.
  const shared = commonPrefix(paths).split('/').filter(Boolean);
  for (let n = shared.length; n > 0; n--) {
    // THE YEAR TEST IS THE DISCRIMINATOR, and it is the only one needed. A
    // percentage of surviving paths was a second, arbitrary rule that made the
    // answer depend on how many loose files an archive happens to carry — five
    // paths with one loose file behaved differently from a thousand with one.
    // A path the strip orphans is reported as not filed under a vendor, which
    // is exactly what a spreadsheet at the top of the archive is.
    const noYear = lists.every(l => l.length <= n + 1 || !YEAR.test(l[n]));
    const kept = lists.filter(l => l.length - n >= 2).length;
    if (noYear && kept > 0) return shared.slice(0, n).join('/');
  }
  return '';
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
 *   3. the filename — but ONLY within the SAME VENDOR FOLDER, and only when
 *      exactly one row there carries it
 *
 * THE VENDOR SCOPE ON PASS 3 IS LOAD-BEARING. Without it, a file called
 * "SDS.pdf" sitting under a company we have never heard of attaches to
 * whichever supplier happens to be the only one with a row of that name — a
 * document filed against a company that did not send it, which is precisely
 * the failure this module exists to prevent. Filenames in this archive are
 * generic by nature ("SDS.pdf", "Spec.pdf", "Certificate.pdf"); it is the
 * folder that says whose they are. Caught by a test, not by reading.
 *
 * `rows` is [{ id, supplier_id, source_path, filename, storage_key }].
 */
const vendorFolder = (path) => normalizePath(path).split('/')[0] || '';

export function matchArchiveFile(entryPath, rows, { prefix = '' } = {}) {
  const full = normalizePath(entryPath);
  const rel = stripPrefix(full, prefix);
  const base = full.split('/').pop();
  // BOTH READINGS OF THE VENDOR, for the same reason the path pass tries both.
  // A zip of one vendor has that vendor's folder as its common prefix, so the
  // stripped path's first segment is a YEAR — scoping to that alone would
  // compare "2025" against "AIFI" and refuse every filename match inside a
  // per-vendor zip, which is the shape people actually upload.
  const vendors = [...new Set([vendorFolder(rel), vendorFolder(full)]
    .map(v => v.toLowerCase()).filter(Boolean))];

  const byPath = new Map();
  const byName = new Map();
  for (const r of rows || []) {
    const sp = normalizePath(r.source_path);
    if (sp) byPath.set(sp, r);
    const n = String(r.filename || '').toLowerCase();
    if (!n) continue;
    // Keyed on vendor folder + filename, so two vendors' "Certificate.pdf"
    // never collide with each other and never reach the other's documents.
    const key = `${vendorFolder(sp).toLowerCase()}/${n}`;
    if (byName.has(key)) byName.set(key, null);   // ambiguous — poisoned on purpose
    else byName.set(key, r);
  }

  const hit = byPath.get(full) || byPath.get(rel);
  if (hit) return { row: hit, how: byPath.get(full) ? 'path' : 'path-relative' };

  if (!vendors.length) return { row: null, reason: 'not filed under a vendor folder' };
  let poisoned = false;
  for (const v of vendors) {
    const named = byName.get(`${v}/${String(base || '').toLowerCase()}`);
    if (named) return { row: named, how: 'filename' };
    if (named === null) poisoned = true;
  }
  if (poisoned) return { row: null, reason: 'ambiguous filename within the vendor folder' };
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
  const prefix = archiveRoot(real.map(e => e.path));

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
