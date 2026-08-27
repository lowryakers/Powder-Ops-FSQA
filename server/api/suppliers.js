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
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { readTable } from '../tabular.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { planSupplierImport, applySupplierImport } from '../supplier-import.js';
import { DISPOSITIONS, RISK_CRITERIA } from '../supplier-sop.js';
import { readFileSync } from 'fs';
import AdmZip from 'adm-zip';

const router = Router();

// Filing and correcting a supplier record is a records act — the same ladder
// the Receiving Log uses. Importing in bulk is admin, because it writes across
// the whole register in one transaction.
const canRead = (u) => !!u;
const canEdit = (u) => ['admin', 'supervisor'].includes(u?.role)
  || ['qa', 'quality', 'purchasing'].includes((u?.department || '').toLowerCase())
  || u?.modules?.includes?.('suppliers');
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
    supplier: { ...s, legacy_names: JSON.parse(s.legacy_names || '[]') },
    contacts: db.prepare('SELECT * FROM supplier_contacts WHERE supplier_id = ? ORDER BY is_primary DESC, email').all(s.id),
    materials: db.prepare('SELECT * FROM supplier_materials WHERE supplier_id = ? ORDER BY item_description').all(s.id),
    qualifications: db.prepare(`SELECT * FROM supplier_qualifications WHERE supplier_id = ?
      ORDER BY IFNULL(period_label, '') DESC`).all(s.id),
    files: db.prepare(`SELECT id, kind, period_label, expires_on, filename, source_path, lot_number,
      CASE WHEN expires_on IS NOT NULL AND expires_on < date('now') THEN 1 ELSE 0 END AS expired
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

const importUpload = mediaUpload(2);

/** The tracker (xlsx/csv) and the archive (a .zip, or a text listing). */
function readImportFiles(files) {
  let trackerRows = [], archiveEntries = [], notes = [];
  for (const f of files || []) {
    const buf = readFileSync(f.path);
    if (/\.(xlsx|xlsm|csv|tsv)$/i.test(f.originalname)) {
      trackerRows = readTable(buf, f.originalname).rows.filter(r => String(r.Vendor ?? '').trim());
      notes.push(`${f.originalname}: ${trackerRows.length} tracker rows`);
    } else if (/\.zip$/i.test(f.originalname)) {
      // Recurse into nested zips — the archive keeps material and manufacturer
      // bundles inside the year folders, and a shallow walk would report every
      // one of them as an unexpanded container.
      const walk = (b, prefix = '') => {
        for (const e of new AdmZip(b).getEntries()) {
          const p = prefix + e.entryName;
          archiveEntries.push(p);
          if (/\.zip$/i.test(e.entryName) && !e.isDirectory) walk(e.getData(), p + '/');
        }
      };
      walk(buf);
      notes.push(`${f.originalname}: ${archiveEntries.length} archive entries`);
    } else {
      // A plain listing — one path per line, absolute or relative.
      const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean);
      const common = lines.length ? lines[0].replace(/[^/]*$/, '') : '';
      archiveEntries.push(...lines.map(l => (common && l.startsWith(common) ? l.slice(common.length) : l)));
      notes.push(`${f.originalname}: ${lines.length} listed paths`);
    }
  }
  return { trackerRows, archiveEntries, notes };
}

router.post('/import/analyze', importUpload.array('files', 2), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Import is admin only' });
  try {
    const { trackerRows, archiveEntries, notes } = readImportFiles(req.files);
    if (!trackerRows.length && !archiveEntries.length) {
      return res.status(400).json({ error: 'Attach the supplier tracker, the archive, or both' });
    }
    const plan = planSupplierImport({
      trackerRows, archiveEntries, today: today(),
      resolutions: req.body?.resolutions ? JSON.parse(req.body.resolutions) : {},
    });
    // NOTHING WAS WRITTEN. The plan is the review document.
    res.json({ notes, plan });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e) || e.message });
  } finally {
    cleanupTemp(req.files);
  }
});

router.post('/import/commit', importUpload.array('files', 2), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Import is admin only' });
  try {
    const { trackerRows, archiveEntries } = readImportFiles(req.files);
    // Re-planned from the same inputs and the SAME function analyze used, so
    // what commits cannot differ from what was reviewed.
    const plan = planSupplierImport({
      trackerRows, archiveEntries, today: today(),
      resolutions: req.body?.resolutions ? JSON.parse(req.body.resolutions) : {},
    });
    const result = applySupplierImport(getDb(), plan, {
      actor: req.user.name, logAudit, newId: () => uuid(),
    });
    res.json({ result, counts: plan.counts });
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e) || e.message });
  } finally {
    cleanupTemp(req.files);
  }
});

// ── Resolving the reconciliation ────────────────────────────────────────────
//
// The human half of the import. The tracker and the archive disagree about 48
// of 75 vendors, and the two resolutions that matter are "these two names are
// one vendor" and "this row is not a vendor at all".

router.post('/:id/link-name', (req, res) => {
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
});

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

export default router;
