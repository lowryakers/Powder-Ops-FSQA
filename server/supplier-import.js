// Planning a supplier import — the tracker and the archive, reconciled, turned
// into exactly what would be written.
//
// PURE PLANNING. Rows and paths in, a plan out. No database, no Express, no
// file access. `applySupplierImport` is the only thing that writes, and it
// writes THE PLAN — it re-derives nothing. A preview computed differently from
// the commit is a preview that lies, and this one is shown before a bulk write
// across sixty vendors and eight hundred files.
//
// FOUR RULES THIS IMPORT DOES NOT BEND:
//
//  1. NOTHING IS IMPORTED AS QUALIFIED. Every supplier is created
//     `status = 'unqualified'`, whatever either source says, because approval
//     is a decision under SOP 404 § V.C.III made by Quality against seven
//     criteria — and the tracker's "questionnaire completed: 1" is evidence for
//     that decision, never the decision. Importing 19 ticks as 19 approvals is
//     precisely the false record this module exists to prevent.
//
//  2. NOTHING IS INVENTED. A date the sources do not carry stays null. The
//     archive gives a period LABEL ("2025"), not the day a questionnaire came
//     back, so `questionnaire_received_at` stays empty and the period says what
//     is actually known.
//
//  3. A DISAGREEMENT IS CARRIED, NOT RESOLVED. Where the tracker and the folder
//     disagree the plan records both and flags the vendor. The import does not
//     get to pick a winner; a person does, and until they do the vendor reads
//     as needing attention rather than as settled.
//
//  4. IDEMPOTENT. Re-running produces updates, not duplicates: a supplier is
//     its name key, a file is (supplier, source_path).

import { readSupplierArchive } from './supplier-archive.js';
import { reconcileSuppliers, nameKey } from './supplier-reconcile.js';

const cell = (row, key) => String(row?.[key] ?? '').trim();

/** Email addresses out of one jammed cell. 179 of them live in 67 cells. */
export function splitContacts(raw) {
  const seen = new Set();
  return String(raw || '')
    .split(/[,;]/).map(s => s.trim()).filter(Boolean)
    // A trailing comma in the tracker leaves an empty entry; a stray word that
    // is not an address is kept as a name so nothing is silently dropped.
    .map(v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
      ? { email: v, name: null }
      : { email: null, name: v }))
    // DEDUPED HERE, not only at the write. Flavor Waves lists
    // techdata@flavorwaves.com twice, so the plan said 179 contacts and the
    // commit wrote 178 — a preview that disagrees with its own commit, which is
    // the exact defect this module keeps warning about, in miniature. Caught by
    // the check asserting the two counts match.
    .filter(c => {
      const k = (c.email || c.name || '').toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** The vendor type a name plainly announces. A SUGGESTION; never stored blind. */
export function suggestVendorType(name) {
  const n = String(name || '').toLowerCase();
  if (/packag|pak\b|container|carton|film|pouch|label/.test(n)) return 'packaging';
  if (/\blab\b|laborator|analytic|testing/.test(n)) return 'laboratory';
  if (/webstaurant|cary company|industrial container/.test(n)) return 'supplies';
  return null;
}

/**
 * Everything the import would write, and why.
 *
 * @param {object}   input
 * @param {object[]} input.trackerRows    rows as read from the tracker
 * @param {string[]} input.archiveEntries archive paths, relative to its root
 * @param {object}   [input.resolutions]  the human decisions from the review step
 * @param {Array<[string,string]>} [input.resolutions.links] tracker name ↔ folder name
 * @param {string[]} [input.resolutions.ignore]  names that are not vendors
 * @param {object}   [input.resolutions.vendorTypes] name → type, confirmed
 * @param {string}   [input.today]        for expiry reporting; required for a stable plan
 */
export function planSupplierImport({ trackerRows = [], archiveEntries = [], resolutions = {}, today = null } = {}) {
  const archive = readSupplierArchive(archiveEntries, { today });

  // A confirmed link renames the folder onto the tracker's spelling BEFORE
  // reconciling, so the pair matches exactly and the reconciliation never has
  // to be told twice. This is how "GNT" and "Exberry-GNT" become one vendor —
  // by a person saying so once, not by loosening the matcher for everybody.
  const linkOf = new Map((resolutions.links || []).map(([tracker, folder]) => [nameKey(folder), tracker]));
  if (linkOf.size) {
    for (const v of archive.vendors) {
      const to = linkOf.get(nameKey(v.vendor));
      if (to) { v.alias_of = v.vendor; v.vendor = to; }
    }
    for (const f of archive.files) {
      const to = linkOf.get(nameKey(f.vendor));
      if (to) f.vendor = to;
    }
  }

  const ignore = new Set((resolutions.ignore || []).map(nameKey));
  const rec = reconcileSuppliers(trackerRows, archive);
  const rowByKey = new Map(trackerRows.filter(r => cell(r, 'Vendor')).map(r => [nameKey(cell(r, 'Vendor')), r]));
  const filesByVendor = new Map();
  for (const f of archive.files) {
    if (!filesByVendor.has(nameKey(f.vendor))) filesByVendor.set(nameKey(f.vendor), []);
    filesByVendor.get(nameKey(f.vendor)).push(f);
  }

  const suppliers = [];
  const skipped = [];
  for (const v of rec.vendors) {
    const key = nameKey(v.name);
    if (ignore.has(key)) { skipped.push({ name: v.name, reason: 'marked not a vendor' }); continue; }
    const row = rowByKey.get(key);
    const files = filesByVendor.get(key) || [];

    // Periods come from the archive; a vendor with files and no year gets one
    // undated qualification so the evidence has somewhere to hang.
    const periods = [...new Set(files.map(f => f.period))];
    const qualifications = (periods.length ? periods : (row ? [null] : []))
      .sort((a, b) => String(a ?? '').localeCompare(String(b ?? '')))
      .map(period => ({
        period_label: period,
        // RULE 2. The sources carry no dates for these, so they stay null.
        questionnaire_requested_at: null,
        questionnaire_received_at: null,
        // RULE 1. Never imported as a decision.
        disposition: null,
        source: 'import',
        // What the evidence for this period actually is, so the review step and
        // the record agree without a second query.
        evidence: {
          files: files.filter(f => f.period === period).length,
          has_questionnaire: files.some(f => f.period === period
            && (f.kind === 'questionnaire' || f.kind === 'raw_material_questionnaire')),
        },
      }));

    suppliers.push({
      name: v.name,
      legacy_names: [...new Set([
        ...(archive.vendors.find(a => nameKey(a.vendor) === key)?.alias_of ? [archive.vendors.find(a => nameKey(a.vendor) === key).alias_of] : []),
      ])],
      vendor_type: resolutions.vendorTypes?.[v.name] ?? suggestVendorType(v.name),
      actively_using: v.actively_using ? 1 : 0,
      // RULE 1, stated in the data rather than only in a comment.
      status: 'unqualified',
      notes: v.notes || null,
      source: 'import',
      contacts: splitContacts(row?.Contact),
      qualifications,
      files: files.map(f => ({
        kind: f.kind, period_label: f.period, expires_on: f.expires_on,
        filename: f.filename, source_path: f.source_path,
      })),
      // RULE 3. Carried, not resolved.
      issues: v.issues,
      on_tracker: v.on_tracker,
      has_folder: v.has_folder,
      tracker_questionnaire: v.tracker_questionnaire,
      folder_questionnaire: v.folder_questionnaire,
    });
  }

  return {
    suppliers, skipped,
    reconciliation: rec,
    unreadable: archive.skipped,
    // 40 nested zips are not expanded by a filesystem listing, and a plan that
    // did not say so would look like a complete inventory.
    unexpanded_containers: archive.containers.length,
    counts: {
      suppliers: suppliers.length,
      contacts: suppliers.reduce((n, s) => n + s.contacts.length, 0),
      qualifications: suppliers.reduce((n, s) => n + s.qualifications.length, 0),
      files: suppliers.reduce((n, s) => n + s.files.length, 0),
      needing_attention: suppliers.filter(s => s.issues.length).length,
      // Never a count of "approved". Nothing here is approved.
      approved: 0,
    },
  };
}

/**
 * Write the plan. ONE transaction, and it re-derives nothing.
 *
 * Audited per supplier plus one summary row — a bulk action must leave the
 * trail a manual one would.
 */
export function applySupplierImport(db, plan, { actor = 'import', logAudit = null, newId } = {}) {
  const id = newId || (() => `sup_${Math.random().toString(36).slice(2, 10)}`);
  const result = { suppliers_created: 0, suppliers_updated: 0, contacts: 0, qualifications: 0, files: 0, files_skipped: 0 };

  // The supplier lookup is done in JS on the same nameKey the reconciliation
  // uses. Doing it in SQL would need a second, subtly different normalisation —
  // and SQLite reads a double-quoted string as an identifier, which is how the
  // first attempt failed.
  const allSuppliers = () => db.prepare('SELECT id, name FROM suppliers').all();
  const insSupplier = db.prepare(`INSERT INTO suppliers
    (id, name, legacy_names, vendor_type, actively_using, status, notes, source, created_by)
    VALUES (?, ?, ?, ?, ?, 'unqualified', ?, ?, ?)`);
  const updSupplier = db.prepare(`UPDATE suppliers SET vendor_type = COALESCE(?, vendor_type),
    actively_using = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`);
  const insContact = db.prepare(`INSERT INTO supplier_contacts (id, supplier_id, name, email) VALUES (?, ?, ?, ?)`);
  const hasContact = db.prepare('SELECT 1 FROM supplier_contacts WHERE supplier_id = ? AND IFNULL(email, name) = ?');
  const findQual = db.prepare(
    `SELECT id FROM supplier_qualifications WHERE supplier_id = ? AND IFNULL(period_label, '') = IFNULL(?, '')`);
  const insQual = db.prepare(`INSERT INTO supplier_qualifications (id, supplier_id, period_label, source) VALUES (?, ?, ?, ?)`);
  const insFile = db.prepare(`INSERT INTO supplier_files
    (id, supplier_id, qualification_id, kind, period_label, expires_on, filename, source_path, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, source_path) DO UPDATE SET
      kind = excluded.kind, period_label = excluded.period_label, expires_on = excluded.expires_on`);

  const key = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');

  const run = db.transaction(() => {
    for (const s of plan.suppliers) {
      const existing = allSuppliers().find(r => key(r.name) === key(s.name));
      let sid;
      if (existing) {
        sid = existing.id;
        updSupplier.run(s.vendor_type, s.actively_using, s.notes, sid);
        result.suppliers_updated += 1;
      } else {
        sid = id();
        insSupplier.run(sid, s.name, JSON.stringify(s.legacy_names || []), s.vendor_type,
          s.actively_using, s.notes, s.source, actor);
        result.suppliers_created += 1;
      }
      for (const c of s.contacts) {
        const k = c.email || c.name;
        if (!k || hasContact.get(sid, k)) continue;
        insContact.run(id(), sid, c.name, c.email);
        result.contacts += 1;
      }
      const qualId = new Map();
      for (const q of s.qualifications) {
        const found = findQual.get(sid, q.period_label);
        if (found) { qualId.set(q.period_label, found.id); continue; }
        const qid = id();
        insQual.run(qid, sid, q.period_label, q.source);
        qualId.set(q.period_label, qid);
        result.qualifications += 1;
      }
      for (const f of s.files) {
        if (!f.source_path) { result.files_skipped += 1; continue; }
        insFile.run(id(), sid, qualId.get(f.period_label) ?? null, f.kind, f.period_label,
          f.expires_on, f.filename, f.source_path, actor);
        result.files += 1;
      }
      logAudit?.(actor, 'supplier_imported', 'supplier', sid,
        { files: s.files.length, qualifications: s.qualifications.length, issues: s.issues });
    }
  });
  run();
  logAudit?.(actor, 'supplier_import_completed', 'supplier', null, result);
  return result;
}
