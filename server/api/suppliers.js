// Supplier and laboratory qualification — SOP 404 V4.
//
// The record NC 4.3.1 found missing: "the Supplier Qualification Questionnaire
// required per SOP 404 was not available for: Mill Haven Foods (Whey Protein),
// M4 Dynamic (Potassium Citrate, B12), Bay State Milling (Cinnamon)." Before
// this there was no supplier record in ReadyDoc of any kind.
//
// TWO THINGS THIS MODULE REFUSES, AND BOTH ARE THE POINT:
//
//  1. NOTHING BECOMES APPROVED BY BEING IMPORTED. A supplier arrives
//     `unqualified` however emphatically the tracker says otherwise, because
//     approval is a decision under SOP 404 § V.C.III taken by Quality against
//     seven named criteria — and "questionnaire completed: 1" is evidence FOR
//     that decision, never the decision. The plant's tracker has 19 ticks; a
//     register that turned those into 19 approvals would be a false record on
//     day one.
//
//  2. THE IMPORT DOES NOT PICK A WINNER between the tracker and the archive.
//     They disagree about 48 of the 75 vendors between them — 26 have a
//     questionnaire on file the tracker says they lack, 3 are ticked with
//     nothing on file, 11 active vendors have no folder at all. The import
//     carries both answers onto the record and flags the vendor; a person
//     resolves it. Loading either source alone would import a known-wrong
//     answer and make it look authoritative.
//
// The derived number the whole module exists for — ACTIVELY USED AND NOT
// QUALIFIED — is computed on every read, never stored. SOP 404 § V.A:
// "Components ordered for Powder-Ops will be done through qualified vendors
// ONLY", so that pair is a finding, and a stored count is one that goes stale
// the first time somebody files a questionnaire.

import { Router } from 'express';
import { moduleLevel } from '../module-access.js';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { readTable } from '../tabular.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage, MAX_ARCHIVE_BYTES } from '../media.js';
import { planSupplierImport, applySupplierImport } from '../supplier-import.js';
import { DISPOSITIONS, RISK_CRITERIA } from '../supplier-sop.js';
import { matchStrength, nameKey } from '../supplier-reconcile.js';
import { readFileSync, createReadStream, writeFileSync, unlinkSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join as joinPath } from 'path';
import AdmZip from 'adm-zip';
import { storageEnabled, putStream, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';
import { planArchiveUpload, storageKeyFor, normalizePath, archiveRoot, stripPrefix } from '../supplier-storage.js';
import { classifyDocument, expiryFromFilename, readSupplierArchive } from '../supplier-archive.js';

const router = Router();

// Filing and correcting a supplier record is a records act — the same ladder
// the Receiving Log uses. Importing in bulk is admin, because it writes across
// the whole register in one transaction.
const canRead = (u) => !!u;
// The module-grant branch used to read `u.modules`, a property req.user has
// never carried, so an explicit Suppliers grant in Settings conferred nothing
// here — a grant that could not be granted. moduleLevel() is the one rule for
// what a map means (see shared/module-access.js for why an empty map is not
// "everything").
const canEdit = (u) => ['admin', 'supervisor'].includes(u?.role)
  || ['qa', 'quality', 'purchasing'].includes((u?.department || '').toLowerCase())
  || moduleLevel(u, 'suppliers') === 'edit';
const canDecide = (u) => u?.role === 'admin'
  || (['qa', 'quality'].includes((u?.department || '').toLowerCase()) && u?.role === 'supervisor');

const clean = (v, max = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const today = () => new Date().toISOString().slice(0, 10);

/** The register, with the derived state that makes it worth reading. */
function listSuppliers(db, { limit = 500 } = {}) {
  const rows = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM supplier_files f WHERE f.supplier_id = s.id) AS file_count,
      (SELECT COUNT(*) FROM supplier_materials m WHERE m.supplier_id = s.id AND m.is_active = 1) AS material_count,
      (SELECT COUNT(*) FROM supplier_files f WHERE f.supplier_id = s.id
         AND f.kind IN ('questionnaire','raw_material_questionnaire')) AS questionnaire_files,
      (SELECT COUNT(*) FROM supplier_files f WHERE f.supplier_id = s.id
         AND f.expires_on IS NOT NULL AND f.expires_on < date('now')) AS expired_files,
      (SELECT MIN(f.expires_on) FROM supplier_files f WHERE f.supplier_id = s.id
         AND f.expires_on IS NOT NULL AND f.expires_on >= date('now')) AS next_expiry,
      (SELECT MAX(q.period_label) FROM supplier_qualifications q WHERE q.supplier_id = s.id) AS latest_period
    FROM suppliers s ORDER BY s.actively_using DESC, s.name COLLATE NOCASE LIMIT ?`).all(limit);
  return rows.map(r => ({
    ...r,
    legacy_names: JSON.parse(r.legacy_names || '[]'),
    // DERIVED, and this is the number the register exists to surface.
    buying_without_qualification: !!r.actively_using && r.status === 'unqualified',
    // TWO GAPS, NOT ONE — and collapsing them is what made the tracker
    // unhelpful. A vendor whose questionnaire and certificates are all on file
    // and simply has no recorded disposition is QUALITY'S queue and usually a
    // short job. A vendor with no questionnaire at all is PURCHASING'S chase
    // list and may take weeks. On the plant's real data the two are 42 and 16,
    // and one number covering both tells neither person what to do.
    awaiting_disposition: !!r.actively_using && r.status === 'unqualified' && r.questionnaire_files > 0,
    no_questionnaire: !!r.actively_using && r.questionnaire_files === 0,
  }));
}

router.get('/', (req, res) => {
  if (!canRead(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const db = getDb();
  const suppliers = listSuppliers(db, { limit: Number(req.query.limit) || 500 });
  res.json({
    suppliers,
    dispositions: DISPOSITIONS,
    risk_criteria: RISK_CRITERIA,
    summary: {
      total: suppliers.length,
      active: suppliers.filter(s => s.actively_using).length,
      // The finding, stated plainly and recomputed every time.
      buying_without_qualification: suppliers.filter(s => s.buying_without_qualification).length,
      awaiting_disposition: suppliers.filter(s => s.awaiting_disposition).length,
      no_questionnaire: suppliers.filter(s => s.no_questionnaire).length,
      expired_documents: suppliers.reduce((n, s) => n + s.expired_files, 0),
    },
  });
});

// Every document on file that has lapsed, or is about to. Ten had already
// lapsed when the archive was first read and nothing in the plant knew.
router.get('/documents/expiring', (req, res) => {
  if (!canRead(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const withinDays = Math.min(Number(req.query.days) || 90, 365);
  const rows = getDb().prepare(`
    SELECT f.*, s.name AS supplier_name, s.actively_using
    FROM supplier_files f JOIN suppliers s ON s.id = f.supplier_id
    WHERE f.expires_on IS NOT NULL AND f.expires_on <= date('now', '+' || ? || ' days')
    ORDER BY f.expires_on LIMIT 500`).all(withinDays);
  res.json({
    expired: rows.filter(r => r.expires_on < today()),
    expiring: rows.filter(r => r.expires_on >= today()),
  });
});

// DECLARED BEFORE `/:id` — Express matches in declaration order and
// "documents" is a perfectly good :id. Same trap as /products/master.csv.
router.get('/:id', (req, res) => {
  if (!canRead(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const db = getDb();
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({
    // The client renders what it is told. A second copy of canEdit in the
    // drawer is how the button and the 403 start disagreeing.
    can_edit: canEdit(req.user),

    supplier: { ...s, legacy_names: JSON.parse(s.legacy_names || '[]') },
    contacts: db.prepare('SELECT * FROM supplier_contacts WHERE supplier_id = ? ORDER BY is_primary DESC, email').all(s.id),
    materials: db.prepare('SELECT * FROM supplier_materials WHERE supplier_id = ? ORDER BY item_description').all(s.id),
    qualifications: db.prepare(`SELECT * FROM supplier_qualifications WHERE supplier_id = ?
      ORDER BY IFNULL(period_label, '') DESC`).all(s.id),
    // `stored` says whether the BYTES are here, which is a different fact from
    // the row existing. extracted_text is searched, never shipped.
    files: db.prepare(`SELECT id, kind, period_label, expires_on, filename, source_path, lot_number, size,
      CASE WHEN expires_on IS NOT NULL AND expires_on < date('now') THEN 1 ELSE 0 END AS expired,
      CASE WHEN storage_key IS NOT NULL THEN 1 ELSE 0 END AS stored, text_status
      FROM supplier_files WHERE supplier_id = ? ORDER BY period_label DESC, kind, filename`).all(s.id),
  });
});

// ── The import: analyze → commit, and analyze WRITES NOTHING ────────────────
//
// Deliberately two steps and not three. The usual analyze/preview/commit shape
// exists so a mapping can be corrected between the second and third; here the
// mapping IS the reconciliation, and it is returned by analyze in full. A
// separate preview would compute the same plan twice and invite the two to
// drift.

// The tracker is a spreadsheet, but readImportFiles also accepts the ARCHIVE
// as a zip — and that is gigabytes. Same ceiling as the archive step, or the
// one route that can create the missing vendors refuses the only file that
// names them.
const importUpload = mediaUpload({ files: 2, maxBytes: MAX_ARCHIVE_BYTES });

/** The tracker (xlsx/csv) and the archive (a .zip, or a text listing). */
/**
 * The register standing in for the tracker, when no tracker was attached.
 *
 * "Folder exists, not on the tracker" means the archive knows a vendor the
 * spreadsheet does not — a real and useful finding. But uploading the ARCHIVE
 * ALONE left the tracker side empty, so all 72 folders read as unknown when 45
 * of them were already on the register. A review that calls a supplier you
 * imported last week "a vendor the tracker has never heard of" is telling you
 * something false about your own records, and it is the screen people decide
 * from.
 *
 * The register was built from the tracker and is the accumulated answer, so it
 * is what the archive should be compared against when the spreadsheet is not in
 * the room. Shaped as tracker rows rather than taught to the reconciler as a
 * third kind of input — reconcileSuppliers stays pure and stays a two-sided
 * comparison.
 */
function registerAsTrackerRows(db) {
  return db.prepare('SELECT name, legacy_names, actively_using FROM suppliers').all()
    .flatMap(r => [
      { Vendor: r.name, 'Actively Using': r.actively_using ? '1' : '', Notes: '' },
      // A vendor may sit on the register under the tracker's spelling while the
      // archive folder uses another; both must pair.
      ...JSON.parse(r.legacy_names || '[]').map(n => (
        { Vendor: n, 'Actively Using': r.actively_using ? '1' : '', Notes: '' })),
    ]);
}

function readImportFiles(files) {
  let trackerRows = [], archiveEntries = [], notes = [];
  for (const f of files || []) {
    if (/\.(xlsx|xlsm|csv|tsv)$/i.test(f.originalname)) {
      trackerRows = readTable(readFileSync(f.path), f.originalname).rows.filter(r => String(r.Vendor ?? '').trim());
      notes.push(`${f.originalname}: ${trackerRows.length} tracker rows`);
    } else if (/\.zip$/i.test(f.originalname)) {
      // Recurse into nested zips — the archive keeps material and manufacturer
      // bundles inside the year folders, and a shallow walk would report every
      // one of them as an unexpanded container.
      // From the PATH, so a multi-gigabyte archive is indexed off disk rather
      // than read into the heap first. Nested containers still decompress one
      // at a time, which is the smallest unit adm-zip offers.
      const walk = (b, prefix = '') => {
        for (const e of new AdmZip(b).getEntries()) {
          const p = prefix + e.entryName;
          archiveEntries.push(p);
          if (/\.zip$/i.test(e.entryName) && !e.isDirectory) walk(e.getData(), p + '/');
        }
      };
      walk(f.path);
      // STRIP THE ZIP'S WRAPPER, the same way the archive step does. Without
      // this the first segment of every path is the folder Drive was told to
      // download, and readSupplierArchive reads it as the vendor — so a whole
      // archive imports as ONE supplier named after the download.
      const root = archiveRoot(archiveEntries);
      if (root) archiveEntries = archiveEntries.map(p => stripPrefix(p, root));
      notes.push(`${f.originalname}: ${archiveEntries.length} archive entries`
        + (root ? ` under "${root}"` : ''));
    } else {
      // A plain listing — one path per line, absolute or relative.
      const lines = readFileSync(f.path).toString('utf8').split(/\r?\n/).filter(Boolean);
      // The same chooser, rather than a prefix guessed from the first line —
      // two ways of deciding what the wrapper is, is two answers.
      const root = archiveRoot(lines);
      archiveEntries.push(...lines.map(l => stripPrefix(l, root)));
      notes.push(`${f.originalname}: ${lines.length} listed paths`);
    }
  }
  return { trackerRows, archiveEntries, notes };
}

router.post('/import/analyze', importUpload.array('files', 2), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Import is admin only' });
  try {
    const db0 = getDb();
    const { trackerRows, archiveEntries, notes } = readImportFiles(req.files);
    if (!trackerRows.length && !archiveEntries.length) {
      return res.status(400).json({ error: 'Attach the supplier tracker, the archive, or both' });
    }
    const known = trackerRows.length ? trackerRows : registerAsTrackerRows(db0);
    if (!trackerRows.length && known.length) {
      notes.push(`No tracker attached — compared against the ${known.length} name(s) already on the register.`);
    }
    const plan = planSupplierImport({
      trackerRows: known, archiveEntries, today: today(),
      resolutions: req.body?.resolutions ? JSON.parse(req.body.resolutions) : {},
    });
    // NOTHING WAS WRITTEN. The plan is the review document.
    res.json({ notes, plan });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e, MAX_ARCHIVE_BYTES) || e.message });
  } finally {
    cleanupTemp(req.files);
  }
});

router.post('/import/commit', importUpload.array('files', 2), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Import is admin only' });
  try {
    const { trackerRows, archiveEntries } = readImportFiles(req.files);
    // Re-planned from the same inputs and the SAME function analyze used, so
    // what commits cannot differ from what was reviewed — the register fallback
    // included, or the commit would reconcile against a different tracker side
    // than the review showed.
    const plan = planSupplierImport({
      trackerRows: trackerRows.length ? trackerRows : registerAsTrackerRows(getDb()),
      archiveEntries, today: today(),
      resolutions: req.body?.resolutions ? JSON.parse(req.body.resolutions) : {},
    });
    const result = applySupplierImport(getDb(), plan, {
      actor: req.user.name, logAudit, newId: () => uuid(),
    });
    res.json({ result, counts: plan.counts });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e, MAX_ARCHIVE_BYTES) || e.message });
  } finally {
    cleanupTemp(req.files);
  }
});

// ── Resolving the reconciliation ────────────────────────────────────────────
//
// The human half of the import. The tracker and the archive disagree about 48
// of 75 vendors, and the two resolutions that matter are "these two names are
// one vendor" and "this row is not a vendor at all".

// Link an archive folder spelling to a supplier BY NAME. The import review
// knows both names and no ids — it is reading a plan, not the register — and
// making the browser resolve one first is a second lookup that can disagree
// with the one the server would do.
router.post('/link-name-by-name', (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const db = getDb();
  const target = clean(req.body?.supplier_name, 200);
  const alias = clean(req.body?.name, 200);
  if (!target || !alias) return res.status(400).json({ error: 'Both names are required' });
  const key = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  const s = db.prepare('SELECT id FROM suppliers').all()
    .map(r => db.prepare('SELECT * FROM suppliers WHERE id = ?').get(r.id))
    .find(r => key(r.name) === key(target));
  if (!s) return res.status(404).json({ error: `${target} is not on the register` });
  req.params.id = s.id;
  return linkName(req, res);
});

function linkName(req, res) {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const db = getDb();
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const alias = clean(req.body?.name, 200);
  if (!alias) return res.status(400).json({ error: 'A name is required' });

  const names = JSON.parse(s.legacy_names || '[]');
  const key = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key(alias) === key(s.name) || names.some(n => key(n) === key(alias))) {
    return res.json({ ok: true, legacy_names: names, unchanged: true });
  }
  // Refuse to alias a name that is already another supplier — that is a MERGE,
  // and a merge moves qualification evidence between companies. It needs its
  // own deliberate act, not a rename that happens to collide.
  const clash = db.prepare('SELECT id, name FROM suppliers').all()
    .find(r => r.id !== s.id && key(r.name) === key(alias));
  if (clash) {
    return res.status(409).json({ error: `"${clash.name}" is already a supplier. Merging two supplier records is a separate action.` });
  }

  names.push(alias);
  db.prepare("UPDATE suppliers SET legacy_names = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(names), s.id);
  // NEVER CLEARED, the products.legacy_sku rule: the tracker says "Mill Haven",
  // the audit report says "Mill Haven Foods", the archive folder says
  // "Exberry-GNT". A name that changes must still resolve on an old record.
  logAudit(req.user, 'supplier_name_linked', 'supplier', s.id, { alias }, null, null, s.name);
  res.json({ ok: true, legacy_names: names });
}

router.post('/:id/link-name', linkName);

router.put('/:id', (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const db = getDb();
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  // `status` is NOT editable here. It mirrors the disposition and is written in
  // the same transaction as the decision and nowhere else — the same rule that
  // makes products.js 400 on nfp_version rather than dropping it silently.
  if ('status' in b) {
    return res.status(400).json({ error: 'STATUS_OWNED: a supplier\'s status follows its disposition. Use /:id/disposition.' });
  }
  const next = {
    vendor_type: 'vendor_type' in b ? clean(b.vendor_type, 40) : s.vendor_type,
    actively_using: 'actively_using' in b ? (b.actively_using ? 1 : 0) : s.actively_using,
    website: 'website' in b ? clean(b.website) : s.website,
    address: 'address' in b ? clean(b.address, 500) : s.address,
    notes: 'notes' in b ? clean(b.notes, 2000) : s.notes,
  };
  db.prepare(`UPDATE suppliers SET vendor_type = ?, actively_using = ?, website = ?, address = ?,
    notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next.vendor_type, next.actively_using, next.website, next.address, next.notes, s.id);
  logAudit(req.user, 'supplier_updated', 'supplier', s.id, null, s, { ...s, ...next }, s.name);
  res.json({ ok: true });
});

// ── The decision SOP 404 § V.C.III actually requires ────────────────────────

router.post('/:id/disposition', (req, res) => {
  if (!canDecide(req.user)) return res.status(403).json({ error: 'Quality leadership or an admin decides a disposition' });
  const db = getDb();
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  const { disposition, period_label = null, risk_criteria = {}, notes } = req.body || {};
  if (!DISPOSITIONS.some(d => d.value === disposition)) {
    return res.status(400).json({ error: 'Disposition must be one of the three in SOP 404 § V.C.III' });
  }
  // The SOP names deficiencies for anything short of approved, so a reason is
  // required rather than optional.
  if (disposition !== 'approved' && !clean(notes, 1000)) {
    return res.status(400).json({ error: 'A conditional or not-approved disposition must say why' });
  }
  const missing = RISK_CRITERIA.filter(c => !(c.key in (risk_criteria || {})));
  if (missing.length) {
    return res.status(400).json({ error: `All seven risk criteria must be answered — missing: ${missing.map(m => m.key).join(', ')}` });
  }

  const prev = { status: s.status };
  db.transaction(() => {
    const q = db.prepare(`SELECT id FROM supplier_qualifications WHERE supplier_id = ?
      AND IFNULL(period_label, '') = IFNULL(?, '')`).get(s.id, period_label);
    const qid = q?.id || uuid();
    if (!q) {
      db.prepare(`INSERT INTO supplier_qualifications (id, supplier_id, period_label, source) VALUES (?,?,?,'in_app')`)
        .run(qid, s.id, period_label);
    }
    db.prepare(`UPDATE supplier_qualifications SET disposition = ?, disposition_notes = ?,
      risk_criteria = ?, decided_by = ?, decided_at = datetime('now'),
      next_review_due = date('now', '+1 year'), updated_at = datetime('now') WHERE id = ?`)
      .run(disposition, clean(notes, 1000), JSON.stringify(risk_criteria), req.user.name, qid);
    // The supplier's status MIRRORS the decision and is written nowhere else —
    // the same doctrine as knife_accountability.status and products.nfp_version.
    db.prepare(`UPDATE suppliers SET status = ?, status_reason = ?, status_set_by = ?,
      status_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(disposition, clean(notes, 1000), req.user.name, s.id);
  })();

  logAudit(req.user, 'supplier_disposition_set', 'supplier', s.id,
    { disposition, period_label }, prev, { status: disposition }, s.name);
  res.json({ ok: true });
});

// ── The bytes behind the catalogue ──────────────────────────────────────────
//
// The import records that a BRC certificate exists, where it was found and
// when it expires. It stores no bytes, so "show me the certificate" ended at a
// filename — and a register that can name a document it cannot produce is the
// same defect as a limit that lives only in a PDF.
//
// Three things shape this and none of them is negotiable:
//
//  1. THE ARCHIVE IS TOO BIG FOR ONE REQUEST, so re-uploading must be safe.
//     A file whose bytes are already stored is skipped, and the plan says so
//     by name — a transfer that dies at 60% is recovered by doing it again,
//     not by working out what got through.
//  2. NOTHING IS READ INTO MEMORY. The zip is opened from the temp file multer
//     already wrote, one entry at a time, and each entry is streamed to R2.
//     A buffered read of a multi-hundred-megabyte archive is an outage.
//  3. AN UNMATCHED FILE IS REPORTED, NEVER FILED SOMEWHERE PLAUSIBLE.
//     supplier-storage.js refuses an ambiguous filename outright.

// The archive is gigabytes, not megabytes. Multer is disk-backed, so this
// costs temp disk rather than heap — and the 200 MB default silently refused
// the plant's own folder export, which is what "I couldn't upload the zip"
// turned out to be.
const archiveUpload = mediaUpload({ files: 1, maxBytes: MAX_ARCHIVE_BYTES });

// ── The zip crosses the wire ONCE, and storing is done in batches ───────────
//
// A 502. Storing 419 documents means 419 sequential uploads to object storage,
// which is minutes of wall time in a single request, and the proxy in front of
// the app cuts it long before that — so the work was lost and the whole
// multi-hundred-megabyte zip had to be sent again to retry.
//
// Neither half of that is acceptable, and the fix is the same shape the rest of
// this module uses: bound the work, and make repeating it cheap. Reviewing
// stashes the file and hands back an id; each store call does a bounded number
// of documents and says how many are left. Nothing is lost when one call fails
// — what stored is stored, and the next call skips it.
const STASH = new Map();
const STASH_TTL_MS = 2 * 60 * 60 * 1000;
const STORE_BATCH = 60;          // documents per request
const STORE_PARALLEL = 4;        // concurrent uploads within a batch

function stashArchive(file, user) {
  const id = uuid();
  const dest = joinPath(tmpdir(), `sup-archive-${id}.zip`);
  renameSync(file.path, dest);
  STASH.set(id, { path: dest, user: user?.id || null, at: Date.now() });
  return id;
}

function takeStash(id, user) {
  const e = STASH.get(id);
  if (!e) return null;
  // The stash holds one person's upload; another account must not be able to
  // commit it by guessing an id.
  if (e.user && user?.id && e.user !== user.id) return null;
  return e;
}

function sweepStash() {
  const now = Date.now();
  for (const [id, e] of STASH) {
    if (now - e.at < STASH_TTL_MS) continue;
    try { unlinkSync(e.path); } catch { /* already gone */ }
    STASH.delete(id);
  }
}

function dropStash(id) {
  const e = STASH.get(id);
  if (!e) return;
  try { unlinkSync(e.path); } catch { /* already gone */ }
  STASH.delete(id);
}
const fileUpload = mediaUpload({ files: 20 });

/** The catalogued rows an archive can attach to. */
function catalogueRows(db) {
  return db.prepare(
    'SELECT id, supplier_id, source_path, filename, storage_key FROM supplier_files'
  ).all();
}

/**
 * Every document in a zip, INCLUDING the ones inside nested zips.
 *
 * Ten vendors keep their questionnaire inside a container zip named after a
 * material, and readImportFiles() above recurses into those when it builds the
 * catalogue — so a walk that did not recurse here would catalogue a document
 * and then be unable to attach its bytes. Two walks of one archive that
 * disagree about what is in it is the defect this whole module is about.
 *
 * The nested path is `outer.zip/inner.pdf`, byte for byte what the catalogue
 * recorded, because both use the same `prefix + entryName` convention.
 *
 * `read` is a thunk: nothing is decompressed while merely listing.
 */
function walkZip(source, prefix = '') {
  const out = [];
  const zip = new AdmZip(source);
  for (const e of zip.getEntries()) {
    const p = prefix + e.entryName;
    if (e.isDirectory) { out.push({ path: p, isDirectory: true, size: 0 }); continue; }
    if (/\.zip$/i.test(e.entryName)) {
      // The container itself is a catalogued row in its own right, and it is
      // also a folder. Record both — a vendor who sent one zip and a vendor who
      // sent its contents loose must end up with the same documents on file.
      out.push({ path: p, isDirectory: false, size: e.header?.size || 0, read: () => e.getData() });
      try { out.push(...walkZip(e.getData(), p + '/')); } catch { /* a corrupt container is not a reason to lose the rest */ }
      continue;
    }
    out.push({ path: p, isDirectory: false, size: e.header?.size || 0, read: () => e.getData() });
  }
  return out;
}

function guessType(filename) {
  const ext = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ({
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })[ext] || 'application/octet-stream';
}

/**
 * Adopt what the zip knows and the listing did not.
 *
 * THE ZIP KNOWS MORE THAN THE LISTING DID, and that is not an edge case. The
 * catalogue is usually built from a text listing produced by `find`, which sees
 * a container zip as ONE file — so every certificate inside
 * `Potassium Citrate.zip` is absent from it. Ten vendors keep their
 * questionnaire that way. Reporting those as "not recognised" would refuse to
 * store the very documents an auditor asks for, on the grounds that a directory
 * listing did not mention them.
 *
 * Classification goes through readSupplierArchive — THE SAME walker the import
 * uses — so a document is classified identically whichever door it came in.
 *
 * A path whose vendor does not resolve to a supplier already on the register is
 * still reported and left alone. An unknown vendor is a real gap, and inventing
 * a supplier row from a folder name would put a company on the register that
 * nobody approved.
 *
 * `write` is what separates the preview from the commit, and it is the ONLY
 * difference — both call this, so what analyze shows cannot differ from what
 * commit does.
 */
function adoptUnmatched(db, plan, { write = false, actor = null } = {}) {
  if (!plan.unmatched.length) return plan;

  // KEYED THE SAME WAY THE RECONCILER KEYS, not by lowercasing. nameKey strips
  // punctuation, and Google Drive rewrites it: the folder is "Monk Fruit Corp"
  // where the register says "Monk Fruit Corp.", and "Smirk_s" where it says
  // "Smirk's" (Drive will not put an apostrophe in a folder name). Those are
  // exact matches under the module's own definition of exact, and a plain
  // toLowerCase missed 54 real documents on the plant's own archive.
  const byName = new Map();
  for (const r of db.prepare('SELECT id, name, legacy_names FROM suppliers').all()) {
    byName.set(nameKey(r.name), r.id);
    for (const n of JSON.parse(r.legacy_names || '[]')) byName.set(nameKey(n), r.id);
  }

  // TWO CANDIDATE PATHS, and taking only one is wrong in a way that is easy to
  // miss. A zip of the whole archive has a wrapper folder that must be stripped
  // before parseArchivePath sees a vendor; a zip of ONE vendor has that
  // vendor's own folder as its common prefix, and stripping it leaves a path
  // whose first segment is the YEAR. The parser would then file every
  // certificate under a supplier called "2025".
  //
  // So both forms are walked and whichever resolves to a supplier already on
  // the register wins — the same two-pass shape matchArchiveFile uses, for the
  // same reason. Neither resolving means the file is genuinely unrecognised.
  const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const relOf = (path) => (plan.prefix
    ? String(path).replace(new RegExp('^' + esc(plan.prefix) + '/'), '')
    : String(path));
  const candidates = plan.unmatched.map(u => ({ u, full: normalizePath(u.path), rel: relOf(normalizePath(u.path)) }));
  const walked = readSupplierArchive(
    [...new Set(candidates.flatMap(c => [c.full, c.rel]))], { today: today() });
  const byRelPath = new Map(walked.files.map(f => [f.source_path, f]));

  const insFile = db.prepare(`INSERT INTO supplier_files
    (id, supplier_id, kind, period_label, expires_on, filename, source_path, uploaded_by)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(supplier_id, source_path) DO NOTHING`);
  const findFile = db.prepare('SELECT id FROM supplier_files WHERE supplier_id = ? AND source_path = ?');

  // WHICH READING OF THE PATH TO BELIEVE, and it is not "whichever parses".
  //
  // A zip downloaded from Drive has a root folder — "Supplier Qualification
  // Questionnaire" — and under it the vendor folders. Both readings parse:
  // the full path reads that root as the vendor and AIFI as the year, and the
  // stripped path reads AIFI as the vendor, which is the true one. So when a
  // prefix was detected, THE STRIPPED READING WINS; the prefix is by
  // definition shared by every file and therefore cannot be a vendor.
  //
  // Getting this backwards does not lose documents — the loop below tries the
  // other reading — but it reports them under the wrong name, which is worse
  // than useless: 293 files across a dozen real vendors were all blamed on the
  // zip's own root folder, so the one screen that says what still needs doing
  // named a company that does not exist.
  const preferred = (full, rel) => (plan.prefix ? [rel, full] : [full, rel]);
  const docFor = (full, rel) => {
    for (const cand of preferred(full, rel)) { const d = byRelPath.get(cand); if (d) return d; }
    return null;
  };

  const stillUnmatched = [];
  for (const { u, full, rel } of candidates) {
    let doc = null, supplierId = null, chosen = null;
    for (const cand of preferred(full, rel)) {
      const d = byRelPath.get(cand);
      const id = d && byName.get(nameKey(d.vendor));
      if (d && id) { doc = d; supplierId = id; chosen = cand; break; }
    }
    if (!doc || !supplierId) { stillUnmatched.push(u); continue; }
    if (!write) {
      plan.store.push({ path: u.path, file_id: null, supplier_id: supplierId, how: 'catalogued now', size: u.size || 0 });
      continue;
    }
    insFile.run(uuid(), supplierId, doc.kind, doc.period || null, doc.expires_on || null,
      doc.filename, chosen, actor);
    const row = findFile.get(supplierId, chosen);
    if (row) plan.store.push({ path: u.path, file_id: row.id, supplier_id: supplierId, how: 'catalogued now', size: u.size || 0 });
    else stillUnmatched.push(u);
  }

  plan.unmatched = stillUnmatched;
  plan.counts.store = plan.store.length;
  plan.counts.unmatched = stillUnmatched.length;
  plan.counts.adopted = plan.store.filter(x => x.how === 'catalogued now').length;

  // "NOT RECOGNISED" IS A DEAD END; a named likely vendor is a next step.
  //
  // 16 of the archive's 58 folders — 223 files — carry a name the register
  // spells differently: the folder says "Bio-Cat", the tracker says "Bio-Cat
  // Inc". supplier-reconcile.js already knows how to see that, and its rule is
  // deliberate: an EXACT key match is safe to take outright, anything weaker is
  // a SUGGESTION a person confirms — because the same rule that correctly reads
  // "GNT" as "Exberry-GNT" would happily read "Talus" as "Aceto-Talus", and
  // that is wrong exactly once and files a qualification against the wrong
  // company.
  //
  // So a weaker match is NEVER attached here. It is reported with the supplier
  // it probably belongs to, and linking the folder name is one deliberate act
  // on the register (POST /:id/link-name) that this same walk then honours,
  // because legacy_names are matched exactly.
  const suppliers = db.prepare('SELECT id, name FROM suppliers').all();
  const byFolder = new Map();
  const unresolved = new Set(stillUnmatched);
  for (const { u, full, rel } of candidates) {
    if (!unresolved.has(u)) continue;
    const doc = docFor(full, rel);
    // The fallback names the first segment of the STRIPPED path for the same
    // reason — never the zip's root folder.
    const folder = doc?.vendor || (plan.prefix ? rel : full).split('/')[0];
    if (!byFolder.has(folder)) byFolder.set(folder, 0);
    byFolder.set(folder, byFolder.get(folder) + 1);
  }
  plan.suggestions = [];
  for (const [folder, files] of byFolder) {
    let best = null;
    for (const sup of suppliers) {
      const how = matchStrength(folder, sup.name);
      if (!how || how === 'exact') continue;   // exact would already have adopted
      const rank = how === 'suffix' ? 2 : 1;
      if (!best || rank > best.rank) best = { rank, how, supplier_id: sup.id, supplier_name: sup.name };
    }
    plan.suggestions.push({ folder, files, ...(best || {}), rank: undefined });
  }
  plan.suggestions.sort((a, b) => b.files - a.files);
  return plan;
}

// Reviewing an archive WRITES NOTHING and uploads nothing — it opens the zip's
// index, matches it against the catalogue and hands back the plan. The commit
// re-plans from the same function, so what is on screen cannot differ from what
// happens.
router.post('/files/archive/analyze', archiveUpload.array('files', 1), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Attaching the archive is admin only' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  sweepStash();
  let stashed = null;
  try {
    const f = (req.files || [])[0];
    if (!f) return res.status(400).json({ error: 'Attach a .zip of the supplier folders' });
    if (!/\.zip$/i.test(f.originalname)) return res.status(400).json({ error: 'That is not a .zip' });
    const db = getDb();
    const plan = adoptUnmatched(db,
      planArchiveUpload(walkZip(f.path), catalogueRows(db), { replace: req.body?.replace === 'true' }),
      { write: false });
    // Keep the file so storing does not have to send it again.
    stashed = stashArchive(f, req.user);
    res.json({ plan, filename: f.originalname, upload_id: stashed, batch: STORE_BATCH });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e, MAX_ARCHIVE_BYTES) || e.message });
  } finally {
    // stashArchive moved the file; anything left is ours to clean up.
    if (!stashed) cleanupTemp(req.files);
  }
});

router.post('/files/archive/commit', archiveUpload.array('files', 1), async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Attaching the archive is admin only' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  const db = getDb();
  const uploadId = req.body?.upload_id || null;
  const stash = uploadId ? takeStash(uploadId, req.user) : null;
  if (uploadId && !stash) {
    return res.status(410).json({ error: 'That upload is no longer held. Review the zip again.' });
  }
  const f = (req.files || [])[0];
  const zipPath = stash ? stash.path : f?.path;
  try {
    if (!zipPath) return res.status(400).json({ error: 'Attach a .zip of the supplier folders' });
    if (f && !/\.zip$/i.test(f.originalname)) return res.status(400).json({ error: 'That is not a .zip' });

    // ONE walk, used for both the plan and the bytes — a commit that re-walked
    // could store something the plan never showed.
    const entries = walkZip(zipPath);
    const plan = adoptUnmatched(db,
      planArchiveUpload(entries, catalogueRows(db), { replace: req.body?.replace === 'true' }),
      { write: true, actor: req.user.name });

    const byPath = new Map();
    for (const e of entries) if (!e.isDirectory) byPath.set(normalizePath(e.path), e);

    const stamp = db.prepare(`UPDATE supplier_files
      SET storage_key = ?, content_type = ?, size = ?, extracted_text = ?, text_status = ?, uploaded_by = ?
      WHERE id = ?`);

    const limit = Math.max(1, Math.min(Number(req.body?.limit) || STORE_BATCH, 500));
    const batch = plan.store.slice(0, limit);
    const result = {
      stored: 0, failed: [], skipped: plan.counts.skip, unmatched: plan.counts.unmatched,
      bytes: 0, remaining: Math.max(0, plan.store.length - batch.length), total: plan.store.length,
    };

    // A few at a time. Sequential is minutes of wall time for a few hundred
    // documents; unbounded concurrency is a different way to fall over.
    const one = async (item) => {
      const entry = byPath.get(normalizePath(item.path));
      if (!entry) { result.failed.push({ path: item.path, error: 'entry vanished from the zip' }); return; }
      const tmp = joinPath(tmpdir(), `sup-${item.file_id}`);
      try {
        const buf = entry.read();
        writeFileSync(tmp, buf);
        const key = storageKeyFor(item.supplier_id, item.file_id, item.path);
        const type = guessType(item.path);
        await putStream(key, createReadStream(tmp), type);
        // extractInvoiceText returns a STRING (or '' when a scan has no text
        // layer), never a wrapper object. Reading `.text` off it silently
        // discarded every word — check the signature, don't copy a caller.
        const text = await extractInvoiceText(buf, type, item.path).catch(() => null);
        stamp.run(key, type, buf.length,
          text || null, text ? 'ok' : (text === null ? 'failed' : 'empty'),
          req.user.name, item.file_id);
        result.stored += 1;
        result.bytes += buf.length;
      } catch (e) {
        result.failed.push({ path: item.path, error: e.message });
      } finally {
        try { unlinkSync(tmp); } catch { /* already gone */ }
      }
    };
    for (let i = 0; i < batch.length; i += STORE_PARALLEL) {
      await Promise.all(batch.slice(i, i + STORE_PARALLEL).map(one));
    }

    if (stash && result.remaining === 0) dropStash(uploadId);
    logAudit(req.user, 'supplier_archive_stored', 'supplier_file', null,
      { filename: f?.originalname || 'held upload', stored: result.stored,
        remaining: result.remaining, failed: result.failed.length }, null, null,
      f?.originalname || 'archive');
    res.json({ result, upload_id: uploadId, plan: { counts: plan.counts, unmatched: plan.unmatched.slice(0, 200) } });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e, MAX_ARCHIVE_BYTES) || e.message });
  } finally {
    if (!stash) cleanupTemp(req.files);
  }
});

// The manual door: attach documents to ONE supplier. This is how a vendor who
// emails a questionnaire next week gets it on the record without an archive.
router.post('/:id/files', fileUpload.array('files', 20), async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Not permitted' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  const db = getDb();
  try {
    const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'No such supplier' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Attach at least one file' });

    const ins = db.prepare(`INSERT INTO supplier_files
      (id, supplier_id, kind, expires_on, filename, storage_key, content_type, size,
       extracted_text, text_status, source_path, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

    const saved = [];
    for (const f of files) {
      const id = uuid();
      const type = f.mimetype || guessType(f.originalname);
      const key = storageKeyFor(supplier.id, id, f.originalname);
      await putStream(key, createReadStream(f.path), type);
      const buf = readFileSync(f.path);
      const text = await extractInvoiceText(buf, type, f.originalname).catch(() => null);   // a string
      // The kind and the expiry are read from the NAME by the same functions
      // the archive walk uses, so a file attached by hand is classified the
      // same way as one that arrived in the zip.
      // classifyDocument returns { kind, expires_on, filled } — an OBJECT. The
      // first version bound the whole object as `kind`; better-sqlite3 reads a
      // plain object argument as a named-parameter bag, so the positional count
      // came up one short and this route 400'd with "Too few parameter values"
      // on its very first real call. Same shape as the documented
      // extractInvoiceText mistake: a return type nobody checked because the
      // path had never been exercised.
      const classified = classifyDocument(f.originalname) || {};
      ins.run(id, supplier.id, req.body?.kind || classified.kind || 'other',
        req.body?.expires_on || classified.expires_on || expiryFromFilename(f.originalname) || null,
        f.originalname, key, type, f.size,
        text || null, text ? 'ok' : (text === null ? 'failed' : 'empty'),
        `uploaded/${f.originalname}`, req.user.name);
      saved.push({ id, filename: f.originalname });
    }
    logAudit(req.user, 'supplier_files_added', 'supplier', supplier.id,
      { count: saved.length, files: saved.map(s => s.filename) }, null, null, supplier.name);
    res.json({ saved });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e) || e.message });
  } finally {
    cleanupTemp(req.files);
  }
});

// Downloads go through OUR OWN ORIGIN, not the presigned URL. A browser
// following a plain <a download> to a different origin ignores the attribute
// and opens a tab instead — the comms-attachment lesson, and the same reason
// /uploads needed a cookie.
router.get('/files/:fileId/download', async (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT id, filename, storage_key, content_type FROM supplier_files WHERE id = ?')
    .get(req.params.fileId);
  if (!f || !f.storage_key) return res.status(404).json({ error: 'No stored file' });
  try {
    const buf = await getObjectBuffer(f.storage_key);
    res.setHeader('Content-Type', f.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(f.filename).replace(/"/g, '')}"`);
    res.send(buf);
  } catch {
    res.status(404).json({ error: 'The stored file could not be read' });
  }
});

// A short-lived signed URL, for RENDERING a PDF or an image inline.
router.get('/files/:fileId/url', async (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT filename, storage_key FROM supplier_files WHERE id = ?').get(req.params.fileId);
  if (!f || !f.storage_key) return res.status(404).json({ error: 'No stored file' });
  res.json({ url: await presignGet(f.storage_key, f.filename) });
});

// Removing the BYTES is not removing the record. The catalogue row survives
// with its expiry and its provenance — "we held this certificate and it
// expired" must stay answerable after somebody tidies up a bucket.
router.delete('/files/:fileId/stored', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const f = db.prepare('SELECT id, supplier_id, filename, storage_key FROM supplier_files WHERE id = ?')
    .get(req.params.fileId);
  if (!f) return res.status(404).json({ error: 'No such file' });
  if (f.storage_key) { try { await deleteObject(f.storage_key); } catch { /* already gone */ } }
  db.prepare('UPDATE supplier_files SET storage_key = NULL, extracted_text = NULL, text_status = NULL WHERE id = ?')
    .run(f.id);
  logAudit(req.user, 'supplier_file_bytes_removed', 'supplier_file', f.id,
    { filename: f.filename }, { storage_key: f.storage_key }, { storage_key: null }, f.filename);
  res.json({ ok: true });
});

// What the archive step is FOR: how much of the catalogue actually has a
// document behind it. Derived on read — a stored count goes stale the moment
// somebody uploads.
router.get('/files/coverage', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN storage_key IS NOT NULL THEN 1 ELSE 0 END) AS stored,
      SUM(CASE WHEN storage_key IS NOT NULL THEN COALESCE(size, 0) ELSE 0 END) AS bytes
    FROM supplier_files`).get();
  const gaps = db.prepare(`SELECT s.id, s.name, COUNT(*) AS missing
    FROM supplier_files f JOIN suppliers s ON s.id = f.supplier_id
    WHERE f.storage_key IS NULL GROUP BY s.id, s.name ORDER BY missing DESC LIMIT 100`).all();
  res.json({
    total: row?.total || 0, stored: row?.stored || 0, bytes: row?.bytes || 0,
    storage_enabled: storageEnabled(), gaps,
  });
});

// ── Undoing an import that filed under the wrong name ───────────────────────
//
// A supplier created by a mistaken import is not a record of anything — the
// plant's whole archive once imported as ONE company named after the download
// folder — and leaving it on the register is worse than removing it: an
// auditor reading "Supplier Qualification Questionnaire, 1,191 documents"
// learns something false about who we buy from.
//
// But a supplier Quality has DECIDED about is a record, and the rule everywhere
// else here is retire, never delete. So this refuses the moment anything real
// has happened to it: a qualification, a disposition off "unqualified", or a
// stored document. What is left it can remove is exactly a filing mistake.
router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const reason = clean(req.body?.reason, 400);
  if (!reason || reason.length < 3) return res.status(400).json({ error: 'A reason is required' });

  // A QUALIFICATION ROW IS NOT A DECISION. The import writes one per vendor per
  // period to hold the evidence it found, so counting rows would refuse every
  // supplier the import ever created — including the mistaken one this exists
  // to remove. What makes it a record is a DISPOSITION, or a signature.
  const decided = db.prepare(`SELECT COUNT(*) c FROM supplier_qualifications
    WHERE supplier_id = ? AND (disposition IS NOT NULL OR decided_at IS NOT NULL)`).get(s.id).c;
  if (decided) return res.status(409).json({ error: `${s.name} carries ${decided} recorded disposition(s). A decided supplier is retired, not deleted.` });
  if (s.status && s.status !== 'unqualified') {
    return res.status(409).json({ error: `${s.name} carries a disposition (${s.status}). A decided supplier is retired, not deleted.` });
  }
  const stored = db.prepare('SELECT COUNT(*) c FROM supplier_files WHERE supplier_id = ? AND storage_key IS NOT NULL').get(s.id).c;
  if (stored) {
    return res.status(409).json({ error: `${s.name} has ${stored} stored document(s). Those are real evidence — move or remove them before deleting the supplier.` });
  }

  const files = db.prepare('SELECT COUNT(*) c FROM supplier_files WHERE supplier_id = ?').get(s.id).c;
  const materials = db.prepare('SELECT COUNT(*) c FROM supplier_materials WHERE supplier_id = ?').get(s.id).c;
  db.transaction(() => {
    db.prepare('DELETE FROM supplier_qualifications WHERE supplier_id = ?').run(s.id);
    db.prepare('DELETE FROM supplier_files WHERE supplier_id = ?').run(s.id);
    db.prepare('DELETE FROM supplier_materials WHERE supplier_id = ?').run(s.id);
    db.prepare('DELETE FROM supplier_contacts WHERE supplier_id = ?').run(s.id);
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(s.id);
  })();
  logAudit(req.user, 'supplier_deleted', 'supplier', s.id,
    { reason, catalogued_files: files, materials }, s, null, s.name);
  res.json({ ok: true, deleted: { supplier: s.name, catalogued_files: files, materials } });
});

export default router;
