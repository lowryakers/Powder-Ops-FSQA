// Artwork version history and verification.
//
// The record of what is actually printed on the pack: which revision is
// current, what the checks said, who signed it, and the file itself.
//
// Two things shape this module.
//
// First, versions are mostly NOT created by someone uploading. The
// Artwork-Proofing service already receives every file Shaun sends and every
// proof Mike returns, and it already rasterises and checks them. It posts the
// outcome here (POST /ingest), so the history accumulates as a side effect of
// work that was happening anyway. Shaun keeps working in Drive and changes
// nothing. Manual upload exists for the cases that never went through proofing.
//
// Second, an approved version is never rewritten. A change files a new version
// and supersedes the old one — the same rule as a signed organoleptic record,
// and for the same reason: the old one is history, and history that can be
// edited is not evidence.
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { createHash, timingSafeEqual } from 'crypto';
import fs from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';

const router = Router();

// mediaUpload() returns a multer instance, not middleware — .array() is what
// the router can mount. Files land on disk and stream to R2, so a 40 MB print
// PDF never sits in memory.
const artworkUpload = mediaUpload({ files: 10 }).array('files', 10);
const ingestUpload = mediaUpload({ files: 5 }).array('files', 5);

const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

// Only QA and admins put a pack into print. A supervisor can prepare one.
const canRelease = (u) => u && (u.role === 'admin' || u.department === 'qa');

// ── Shaping ──────────────────────────────────────────────────────────────────

function filesFor(db, ids) {
  if (!ids.length) return new Map();
  const q = `SELECT * FROM artwork_files WHERE version_id IN (${ids.map(() => '?').join(',')}) ORDER BY kind, page`;
  const out = new Map();
  for (const f of db.prepare(q).all(...ids)) {
    if (!out.has(f.version_id)) out.set(f.version_id, []);
    out.get(f.version_id).push(f);
  }
  return out;
}

function checksFor(db, ids) {
  if (!ids.length) return new Map();
  const q = `SELECT * FROM artwork_checks WHERE version_id IN (${ids.map(() => '?').join(',')}) ORDER BY checked_at`;
  const out = new Map();
  for (const c of db.prepare(q).all(...ids)) {
    if (!out.has(c.version_id)) out.set(c.version_id, []);
    out.get(c.version_id).push(c);
  }
  return out;
}

function hydrate(db, versions) {
  const ids = versions.map((v) => v.id);
  const files = filesFor(db, ids);
  const checks = checksFor(db, ids);
  return versions.map((v) => {
    const vc = checks.get(v.id) || [];
    return {
      ...v,
      files: files.get(v.id) || [],
      checks: vc,
      // Open findings only — a dismissal is answered, not outstanding.
      failures: vc.filter((c) => c.result === 'fail').length,
      warnings: vc.filter((c) => c.result === 'warn').length,
      has_preview: (files.get(v.id) || []).some((f) => f.kind === 'preview'),
    };
  });
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** The board: one entry per SKU+component, showing its current version. */
router.get('/', (req, res) => {
  const db = getDb();
  const status = req.query.status;
  // The latest version per (sku, component) — everything older is history.
  const rows = db.prepare(`
    SELECT v.*, p.flavor, p.category, p.pack, p.gtin
    FROM artwork_versions v
    JOIN products p ON p.sku = v.sku
    WHERE v.version = (
      SELECT MAX(v2.version) FROM artwork_versions v2
      WHERE v2.sku = v.sku AND v2.component = v.component
    )
    ${status ? 'AND v.status = ?' : ''}
    ORDER BY p.category, p.flavor, v.component
  `).all(...(status ? [status] : []));

  // SKUs with no artwork on file at all. Naming them is the point — a catalogue
  // that only lists what exists cannot tell you what is missing.
  const missing = db.prepare(`
    SELECT p.sku, p.flavor, p.category, p.pack FROM products p
    WHERE p.status != 'discontinued'
      AND NOT EXISTS (SELECT 1 FROM artwork_versions v WHERE v.sku = p.sku)
    ORDER BY p.category, p.flavor
  `).all();

  // Named `packs`, not `current`: React's compiler treats a `.current` field
  // access as a ref and refuses to memoize the consuming component.
  res.json({ packs: hydrate(db, rows), missing, storage: storageEnabled() });
});

/** Every version for one SKU, newest first. */
router.get('/sku/:sku', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!product) return res.status(404).json({ error: 'No such SKU' });
  const versions = db.prepare(
    'SELECT * FROM artwork_versions WHERE sku = ? ORDER BY component, version DESC',
  ).all(req.params.sku);
  res.json({ product, versions: hydrate(db, versions) });
});

router.get('/versions/:id', (req, res) => {
  const db = getDb();
  const v = db.prepare(`
    SELECT v.*, p.flavor, p.category, p.pack, p.gtin, p.nfp_version AS product_nfp_version
    FROM artwork_versions v JOIN products p ON p.sku = v.sku WHERE v.id = ?`).get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  res.json(hydrate(db, [v])[0]);
});

/** Short-lived download URL. Issued only after the module check has passed. */
router.get('/files/:id', async (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM artwork_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const url = await presignGet(f.storage_key, f.filename);
  if (!url) return res.status(503).json({ error: 'File storage unavailable' });
  res.json({ url, filename: f.filename, content_type: f.content_type });
});

// ── Writing ──────────────────────────────────────────────────────────────────

function nextVersion(db, sku, component) {
  const row = db.prepare(
    'SELECT MAX(version) AS v FROM artwork_versions WHERE sku = ? AND component = ?',
  ).get(sku, component);
  return (row?.v || 0) + 1;
}

/** File a new version. Files attach separately so this works without R2. */
router.post('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage artwork.' });
  const b = req.body || {};
  const sku = (b.sku || '').trim();
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  if (!product) return res.status(400).json({ error: `${sku || 'That SKU'} is not in the catalogue.` });

  const component = (b.component || 'primary').trim();
  const id = uuid();
  const version = nextVersion(db, sku, component);
  db.prepare(`INSERT INTO artwork_versions
    (id, sku, component, version, status, source, drive_url, nfp_version, change_summary, created_by)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`).run(
    id, sku, component, version, b.source || 'upload',
    b.drive_url || null, b.nfp_version || product.nfp_version || null,
    b.change_summary || null, req.user.name);

  logAudit(req.user, 'artwork_version_created', 'artwork', id,
    { sku, component, version }, null, null, `${sku} ${component} v${version}`);
  res.status(201).json(hydrate(db, [db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(id)])[0]);
});

/** Attach files to a version. Streamed from disk, so a big PDF is not buffered. */
router.post('/versions/:id/files', artworkUpload, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage artwork.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No file received.' });

  try {
    const kind = ['print_pdf', 'preview', 'dieline', 'proof_report', 'other']
      .includes(req.body?.kind) ? req.body.kind : 'print_pdf';
    for (const f of files) {
      const filename = (f.originalname || 'artwork').slice(0, 255);
      const key = `artwork/${v.sku}/${v.id}-${kind}-${filename.replace(/[^\w.-]+/g, '_')}`;
      await putStream(key, fs.createReadStream(f.path), f.mimetype || null);
      db.prepare(`INSERT INTO artwork_files
        (id, version_id, kind, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuid(), v.id, kind, filename, f.mimetype || null, f.size || null, key, req.user.name);
    }
    db.prepare("UPDATE artwork_versions SET updated_at = datetime('now') WHERE id = ?").run(v.id);
    res.status(201).json(hydrate(db, [db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(v.id)])[0]);
  } catch (err) {
    res.status(500).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

/** Record a check result by hand. The engine uses /ingest instead. */
router.post('/versions/:id/checks', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage artwork.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.check_name || !['pass', 'fail', 'warn'].includes(b.result)) {
    return res.status(400).json({ error: 'A check needs a name and a result of pass, fail or warn.' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO artwork_checks
    (id, version_id, check_name, result, detail, expected, found, checked_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, v.id, b.check_name, b.result, b.detail || null, b.expected || null, b.found || null, req.user.name);
  res.status(201).json({ ok: true, id });
});

/**
 * Wave a finding through, keeping it on the record.
 *
 * Deliberately not a delete. "We looked and it was fine" is the answer an
 * auditor wants, and a deleted row cannot give it.
 */
router.post('/checks/:id/dismiss', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage artwork.' });
  const db = getDb();
  const c = db.prepare('SELECT * FROM artwork_checks WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say why it is acceptable — that note is the record.' });
  db.prepare("UPDATE artwork_checks SET result = 'dismissed', dismissed_by = ?, dismissed_reason = ? WHERE id = ?")
    .run(req.user.name, reason, c.id);
  logAudit(req.user, 'artwork_check_dismissed', 'artwork', c.version_id,
    { check: c.check_name, reason }, null, null, c.check_name);
  res.json({ ok: true });
});

/**
 * Move a version through its states.
 *
 * The gate that matters: nothing reaches print_ready with an open failure or
 * against an NFP that is not the product's approved one. Both were designed
 * into the old app and never built; a pack going to film against a stale
 * nutrition panel is a relabel at best.
 */
const FLOW = {
  draft: ['in_review', 'rejected'],
  in_review: ['approved', 'rejected', 'draft'],
  approved: ['print_ready', 'rejected'],
  print_ready: ['superseded'],
  rejected: ['draft'],
  superseded: [],
};

router.post('/versions/:id/status', (req, res) => {
  const db = getDb();
  const v = db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const next = req.body?.status;
  if (!FLOW[v.status]?.includes(next)) {
    return res.status(400).json({ error: `Cannot go from ${v.status.replace(/_/g, ' ')} to ${String(next).replace(/_/g, ' ')}.` });
  }
  if (next === 'print_ready' && !canRelease(req.user)) {
    return res.status(403).json({ error: 'Only QA or an admin releases artwork to print.' });
  }
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage artwork.' });

  if (next === 'print_ready') {
    const open = db.prepare(
      "SELECT COUNT(*) n FROM artwork_checks WHERE version_id = ? AND result = 'fail'").get(v.id).n;
    if (open > 0) {
      return res.status(409).json({ error: `${open} check${open === 1 ? '' : 's'} still failing. Fix or dismiss with a reason first.` });
    }
    const product = db.prepare('SELECT nfp_version, nfp_approved_at FROM products WHERE sku = ?').get(v.sku);
    if (!product?.nfp_approved_at) {
      return res.status(409).json({ error: 'This product has no approved NFP. Artwork cannot go to print against an unapproved panel.' });
    }
    if (v.nfp_version && product.nfp_version && v.nfp_version !== product.nfp_version) {
      return res.status(409).json({
        error: `This artwork was drawn against NFP ${v.nfp_version}; the approved panel is ${product.nfp_version}.`,
      });
    }
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE artwork_versions SET status = ?, updated_at = datetime('now'),
      approved_by = CASE WHEN ? IN ('approved','print_ready') THEN ? ELSE approved_by END,
      approved_at = CASE WHEN ? IN ('approved','print_ready') THEN ? ELSE approved_at END,
      effective_date = CASE WHEN ? = 'print_ready' THEN ? ELSE effective_date END
      WHERE id = ?`).run(next, next, req.user.name, next, now, next, now.slice(0, 10), v.id);

    if (next === 'print_ready') {
      // Exactly one live version per component. Superseding the others here
      // rather than trusting a later edit is what keeps "current" meaningful.
      const others = db.prepare(`SELECT id FROM artwork_versions
        WHERE sku = ? AND component = ? AND id != ? AND status IN ('print_ready','approved')`)
        .all(v.sku, v.component, v.id);
      for (const o of others) {
        db.prepare("UPDATE artwork_versions SET status = 'superseded', superseded_by = ?, updated_at = datetime('now') WHERE id = ?")
          .run(v.id, o.id);
      }
      // The product's own summary fields follow the released version, so the
      // catalogue and the readiness checklist cannot disagree with this table.
      db.prepare("UPDATE products SET artwork_status = 'print_ready', artwork_version = ?, updated_at = datetime('now') WHERE sku = ?")
        .run(String(v.version), v.sku);
    } else if (v.component === 'primary') {
      db.prepare("UPDATE products SET artwork_status = ?, updated_at = datetime('now') WHERE sku = ?")
        .run(next, v.sku);
    }
  })();

  logAudit(req.user, 'artwork_status_changed', 'artwork', v.id,
    { sku: v.sku, from: v.status, to: next }, null, null, `${v.sku} v${v.version} → ${next}`);
  res.json(hydrate(db, [db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(v.id)])[0]);
});

// ── The proofing service's way in ────────────────────────────────────────────
//
// Mounted separately in server.js, at /api/artwork/ingest, and deliberately
// NOT behind requireModuleWrite: that guard rejects any non-GET without a
// req.user, and this caller is a service holding a token, not a person. Same
// arrangement partner-portal uses.
export const ingestRouter = Router();

// Same token as the master-list feed: the two endpoints are the two halves of
// one integration, and a second secret to rotate buys nothing.
function tokenOk(supplied) {
  const expected = process.env.PRODUCT_MASTER_TOKEN || '';
  if (!expected || !supplied) return false;
  const a = createHash('sha256').update(String(supplied)).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * A finished proofing job, filed as a version with its checks.
 *
 * Idempotent on (proof_job_id, sku, component): the proofing service can retry
 * a delivery without filing the pack twice.
 *
 * Body: { job_id, sku?, gtin?, component?, checks: [{name, result, detail,
 *         expected, found}], drive_url?, summary? }
 *
 * The SKU is resolved by GTIN when one was decoded off the barcode, because
 * that is the identification we actually trust — a filename cannot tell a
 * pouch from a stick.
 */
ingestRouter.post('/', (req, res) => {
  if (!tokenOk(req.query.token || req.headers['x-proof-token'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const b = req.body || {};
  if (!b.job_id) return res.status(400).json({ error: 'job_id is required.' });

  const db = getDb();
  const product = b.gtin
    ? db.prepare('SELECT * FROM products WHERE gtin = ?').get(String(b.gtin))
      || db.prepare('SELECT * FROM products WHERE sku = ?').get(String(b.sku || ''))
    : db.prepare('SELECT * FROM products WHERE sku = ?').get(String(b.sku || ''));
  if (!product) {
    return res.status(404).json({ error: 'No product matches that GTIN or SKU.', gtin: b.gtin, sku: b.sku });
  }

  const component = (b.component || 'primary').trim();
  const existing = db.prepare(
    'SELECT * FROM artwork_versions WHERE proof_job_id = ? AND sku = ? AND component = ?',
  ).get(String(b.job_id), product.sku, component);

  const checks = Array.isArray(b.checks) ? b.checks : [];
  const id = existing?.id || uuid();

  db.transaction(() => {
    if (!existing) {
      db.prepare(`INSERT INTO artwork_versions
        (id, sku, component, version, status, source, proof_job_id, drive_url, nfp_version,
         change_summary, created_by)
        VALUES (?, ?, ?, ?, 'in_review', 'proofing', ?, ?, ?, ?, 'artwork-proofing')`).run(
        id, product.sku, component, nextVersion(db, product.sku, component),
        String(b.job_id), b.drive_url || null, product.nfp_version || null, b.summary || null);
    } else {
      // A retry replaces the previous check set rather than appending a second
      // copy of the same findings.
      db.prepare('DELETE FROM artwork_checks WHERE version_id = ?').run(id);
    }
    const ins = db.prepare(`INSERT INTO artwork_checks
      (id, version_id, check_name, result, detail, expected, found, checked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'artwork-proofing')`);
    for (const c of checks) {
      const result = ['pass', 'fail', 'warn'].includes(c.result) ? c.result : 'warn';
      ins.run(uuid(), id, String(c.name || 'check').slice(0, 120), result,
        c.detail || null, c.expected || null, c.found || null);
    }
  })();

  const version = hydrate(db, [db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(id)])[0];
  res.status(existing ? 200 : 201).json({
    ok: true, version_id: id, sku: product.sku, version: version.version,
    failures: version.failures, warnings: version.warnings, replaced: !!existing,
  });
});

/** Attach a file to an ingested version — the print PDF and its preview PNG. */
ingestRouter.post('/:id/files', ingestUpload, async (req, res) => {
  if (!tokenOk(req.query.token || req.headers['x-proof-token'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const db = getDb();
  const v = db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured.' });

  const files = req.files || [];
  try {
    const kind = ['print_pdf', 'preview', 'proof_report'].includes(req.body?.kind)
      ? req.body.kind : 'print_pdf';
    for (const f of files) {
      const filename = (f.originalname || 'artwork').slice(0, 255);
      const key = `artwork/${v.sku}/${v.id}-${kind}-${filename.replace(/[^\w.-]+/g, '_')}`;
      await putStream(key, fs.createReadStream(f.path), f.mimetype || null);
      db.prepare(`INSERT INTO artwork_files
        (id, version_id, kind, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'artwork-proofing')`).run(
        uuid(), v.id, kind, filename, f.mimetype || null, f.size || null, key);
    }
    res.status(201).json({ ok: true, files: files.length });
  } catch (err) {
    res.status(500).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

router.delete('/versions/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage artwork.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  // Released artwork is history. Supersede it instead.
  if (['print_ready', 'superseded'].includes(v.status)) {
    return res.status(409).json({ error: 'Released artwork is part of the record and cannot be deleted.' });
  }
  for (const f of db.prepare('SELECT storage_key FROM artwork_files WHERE version_id = ?').all(v.id)) {
    deleteObject(f.storage_key);
  }
  db.prepare('DELETE FROM artwork_versions WHERE id = ?').run(v.id);
  logAudit(req.user, 'artwork_version_deleted', 'artwork', v.id,
    { sku: v.sku, version: v.version }, null, null, `${v.sku} v${v.version}`);
  res.json({ ok: true });
});

export default router;
