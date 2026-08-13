// Nutrition Facts Panel approval.
//
// The panel is the one thing on a pack that is a regulatory statement rather
// than a design choice, and it is approved by someone who mostly does not have
// a ReadyDoc account — the formulator, or whoever signs off nutrition. So the
// approval travels the same way a flavour approval does: a texted link with a
// long random token, no login, one decision, link done.
//
// Two rules shape everything here.
//
// FIRST: the product's `nfp_version` / `nfp_approved_at` columns are a MIRROR,
// not an input. Those two fields are what the artwork print gate reads — nothing
// reaches print_ready without an approved NFP, or against a panel that is not
// the product's current one. While they were hand-typed, that gate could be
// opened by typing a date into a text box. They are written here, in the same
// transaction as the decision, and nowhere else. (products.js refuses them on
// PUT and says so.)
//
// SECOND: an approved panel is never rewritten. A correction files a new
// version and supersedes the old one — the same rule as artwork and a signed
// organoleptic record. What was approved in March has to still read as what was
// approved in March, because artwork was printed from it.
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { randomBytes, createHash } from 'crypto';
import fs from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { readyDocOrigin } from '../links.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';

const router = Router();

const nfpUpload = mediaUpload({ files: 5 }).array('files', 5);

// Same ladder as the catalogue: a wrong panel is a relabel, not a typo.
const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

// ── Shaping ──────────────────────────────────────────────────────────────────

function filesFor(db, ids) {
  if (!ids.length) return new Map();
  const q = `SELECT * FROM nfp_files WHERE version_id IN (${ids.map(() => '?').join(',')}) ORDER BY kind`;
  const out = new Map();
  for (const f of db.prepare(q).all(...ids)) {
    if (!out.has(f.version_id)) out.set(f.version_id, []);
    out.get(f.version_id).push(f);
  }
  return out;
}

/**
 * Shape a version for the client.
 *
 * `token_hash` never leaves the server — it is a credential, and the clear text
 * was handed over once when the link was issued. `link_live` is the only thing
 * a screen actually needs to know about it.
 */
function hydrate(db, versions) {
  const files = filesFor(db, versions.map((v) => v.id));
  return versions.map((v) => {
    const { token_hash, ...rest } = v;
    return {
      ...rest,
      files: files.get(v.id) || [],
      link_live: !!token_hash,
      has_panel: (files.get(v.id) || []).length > 0 || !!v.drive_url,
    };
  });
}

/** Everything an approver has to be able to see before saying yes. */
async function approverView(db, v) {
  const product = db.prepare('SELECT sku, flavor, category, pack, gtin FROM products WHERE sku = ?').get(v.sku);
  const files = db.prepare("SELECT * FROM nfp_files WHERE version_id = ? ORDER BY kind").all(v.id);
  const panels = [];
  for (const f of files) {
    // Presigned and short-lived, issued only after the token check — the same
    // arrangement the partner portal uses for a partner's own documents.
    const url = await presignGet(f.storage_key, f.filename);
    if (url) panels.push({ filename: f.filename, content_type: f.content_type, kind: f.kind, url });
  }
  return {
    sku: v.sku,
    product: product?.flavor || v.sku,
    category: product?.category,
    pack: product?.pack,
    gtin: product?.gtin,
    version: v.version,
    serving_size: v.serving_size,
    servings_per_container: v.servings_per_container,
    formula_rev: v.formula_rev,
    change_summary: v.change_summary,
    drive_url: v.drive_url,
    sent_to: v.sent_to,
    sent_by: v.token_issued_by,
    panels,
    // Says out loud when there is no viewable file, so the page can tell the
    // approver to open the Drive link rather than silently showing nothing.
    storage: storageEnabled(),
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * The board: what is waiting on someone, and which products have no panel.
 *
 * Naming the products with nothing on file is the point — a list of the panels
 * that exist cannot tell you which product is about to go to artwork without
 * one, and that is the failure this module exists to catch.
 */
router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT n.*, p.flavor, p.category, p.pack
    FROM nfp_versions n JOIN products p ON p.sku = n.sku
    ORDER BY CASE n.status WHEN 'sent' THEN 0 WHEN 'draft' THEN 1 WHEN 'rejected' THEN 2
                           WHEN 'approved' THEN 3 ELSE 4 END,
             n.updated_at DESC`).all();

  const missing = db.prepare(`
    SELECT p.sku, p.flavor, p.category, p.pack FROM products p
    WHERE p.status != 'discontinued' AND p.nfp_approved_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM nfp_versions n WHERE n.sku = p.sku AND n.status IN ('draft','sent','approved'))
    ORDER BY p.category, p.flavor`).all();

  res.json({ versions: hydrate(db, rows), missing, storage: storageEnabled() });
});

/** Every panel filed against one SKU, newest first. */
router.get('/sku/:sku', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM nfp_versions WHERE sku = ? ORDER BY created_at DESC').all(req.params.sku);
  res.json({ versions: hydrate(db, rows) });
});

/** Short-lived download URL, issued only to a signed-in reader of the module. */
router.get('/files/:id', async (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM nfp_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const url = await presignGet(f.storage_key, f.filename);
  if (!url) return res.status(503).json({ error: 'File storage unavailable' });
  res.json({ url, filename: f.filename, content_type: f.content_type });
});

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * File a panel.
 *
 * `source: 'paper'` with an approver and a date records a panel that was
 * approved before ReadyDoc existed — that is the door for the products whose
 * approval date used to be typed into the catalogue, and it asks for the two
 * facts a typed date never carried: who approved it, and against what.
 */
router.post('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const b = req.body || {};
  const sku = (b.sku || '').trim();
  const version = (b.version || '').trim();
  if (!sku || !version) return res.status(400).json({ error: 'A SKU and a panel version are required.' });

  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  if (!product) return res.status(400).json({ error: `${sku} is not in the catalogue.` });
  if (db.prepare('SELECT 1 FROM nfp_versions WHERE sku = ? AND version = ?').get(sku, version)) {
    return res.status(409).json({ error: `${sku} already has a panel ${version}. Panels are never rewritten — file the next version.` });
  }

  const paper = b.source === 'paper';
  const approvedBy = (b.approved_by || '').trim();
  const approvedAt = (b.approved_at || '').trim();
  if (paper && (!approvedBy || !/^\d{4}-\d{2}-\d{2}$/.test(approvedAt))) {
    return res.status(400).json({ error: 'A panel approved on paper needs the name of whoever approved it and the date (YYYY-MM-DD).' });
  }

  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO nfp_versions
      (id, sku, version, status, source, serving_size, servings_per_container, formula_rev,
       drive_url, change_summary, approved_by, approved_at, decided_via, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, sku, version, paper ? 'approved' : 'draft', paper ? 'paper' : 'upload',
      b.serving_size || null, b.servings_per_container || null,
      b.formula_rev || product.formula_rev || null,
      b.drive_url || null, b.change_summary || null,
      paper ? approvedBy : null, paper ? approvedAt : null, paper ? 'paper' : null,
      req.user.name);
    if (paper) applyApproval(db, id, sku, version, approvedAt);
  })();

  logAudit(req.user, 'nfp_version_created', 'nfp', id,
    { sku, version, source: paper ? 'paper' : 'upload' }, null, null, `${sku} NFP ${version}`);
  res.status(201).json(hydrate(db, [db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(id)])[0]);
});

/* ── Batch: one link, several panels ──────────────────────────────────────────
 *
 * DECLARED BEFORE THE `/:id` ROUTES. Express matches in declaration order and
 * `/batch/send` is a perfectly good `/:id/send` — with these below, every batch
 * call was answered by the single-panel handler looking for a version called
 * "batch". Same trap as `/master.csv` on the products router.
 */

/**
 * ONE LINK FOR SEVERAL PANELS.
 *
 * Ten SKUs whose serving size changed together is one decision the formulator
 * makes once. Ten separate texts is a lift big enough that it does not happen,
 * and a panel nobody approved is a pack that cannot go to print.
 *
 * The BATCH owns the token; the DECISIONS stay per panel. Each one records his
 * name, its own timestamp and `decided_via = 'link'`, and goes through the same
 * `decide()` the single link and the in-app button use — so a batch approval is
 * byte-for-byte the record a one-at-a-time approval would have produced. What
 * is shared is the trip, not the decision.
 */
router.post('/batch/send', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const ids = Array.isArray(req.body?.version_ids) ? req.body.version_ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one panel to send.' });

  const versions = db.prepare(
    `SELECT * FROM nfp_versions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (versions.length !== ids.length) return res.status(400).json({ error: 'One of those panels no longer exists.' });

  // Same two refusals as the single link, applied per panel: an already-decided
  // panel is not up for decision, and a panel with nothing to look at would be
  // a rubber stamp. Named individually, or the person fixes one and resends
  // only to be refused for the next.
  const bad = [];
  for (const v of versions) {
    if (!['draft', 'sent', 'rejected'].includes(v.status)) {
      bad.push(`${v.sku} ${v.version} has already been decided`);
      continue;
    }
    const hasFile = db.prepare('SELECT COUNT(*) n FROM nfp_files WHERE version_id = ?').get(v.id).n > 0;
    if (!hasFile && !v.drive_url) bad.push(`${v.sku} ${v.version} has no panel to look at`);
  }
  if (bad.length) return res.status(409).json({ error: `Cannot send: ${bad.join('; ')}.`, problems: bad });

  const token = randomBytes(24).toString('base64url');
  const id = uuid();
  const sentTo = (req.body?.sent_to || '').trim() || null;
  const note = (req.body?.note || '').trim() || null;

  db.transaction(() => {
    db.prepare('INSERT INTO nfp_batches (id, token_hash, sent_to, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(id, hashToken(token), sentTo, note, req.user.name);
    const link = db.prepare('INSERT INTO nfp_batch_items (batch_id, version_id) VALUES (?, ?)');
    const mark = db.prepare(`UPDATE nfp_versions SET status = 'sent', token_issued_at = datetime('now'),
      token_issued_by = ?, sent_to = ?, updated_at = datetime('now') WHERE id = ?`);
    for (const v of versions) { link.run(id, v.id); mark.run(req.user.name, sentTo, v.id); }
  })();

  logAudit(req.user, 'nfp_link_issued', 'nfp', id,
    { batch: true, count: versions.length, sent_to: sentTo, skus: versions.map(v => `${v.sku} ${v.version}`) },
    null, null, `${versions.length} panels for approval`);

  res.json({ ok: true, batch_id: id, count: versions.length, link: `${readyDocOrigin()}/nfp/batch/${token}` });
});

/** What has been sent as a batch, and how far through it the approver is. */
router.get('/batch/list', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM nfp_batch_items i WHERE i.batch_id = b.id) AS total,
      (SELECT COUNT(*) FROM nfp_batch_items i JOIN nfp_versions v ON v.id = i.version_id
         WHERE i.batch_id = b.id AND v.status IN ('approved','rejected','superseded')) AS decided
    FROM nfp_batches b ORDER BY b.created_at DESC LIMIT 50`).all();
  res.json(rows.map(({ token_hash, ...r }) => ({ ...r, link_live: !!token_hash })));
});

/** Withdraw the whole batch. Undecided panels go back to draft; decided ones
 *  are history and are left exactly as they are. */
router.post('/batch/:id/revoke', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const b = db.prepare('SELECT * FROM nfp_batches WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare("UPDATE nfp_batches SET token_hash = NULL, revoked_at = datetime('now'), revoked_by = ? WHERE id = ?")
      .run(req.user.name, b.id);
    db.prepare(`UPDATE nfp_versions SET status = 'draft', updated_at = datetime('now')
      WHERE status = 'sent' AND id IN (SELECT version_id FROM nfp_batch_items WHERE batch_id = ?)`).run(b.id);
  })();
  logAudit(req.user, 'nfp_link_revoked', 'nfp', b.id, { batch: true }, null, null, 'Batch approval link');
  res.json({ ok: true });
});

/** Attach the panel file. Streamed from disk, so a big PDF is not buffered. */
router.post('/:id/files', nfpUpload, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  // An approved panel is the record artwork was printed from. Adding a file to
  // it after the fact would change what "approved" pointed at.
  if (['approved', 'superseded'].includes(v.status)) {
    return res.status(409).json({ error: 'This panel is already decided. File the next version instead.' });
  }
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No file received.' });

  try {
    const kind = ['panel', 'preview', 'backup', 'other'].includes(req.body?.kind) ? req.body.kind : 'panel';
    for (const f of files) {
      const filename = (f.originalname || 'nfp').slice(0, 255);
      const key = `nfp/${v.sku}/${v.id}-${kind}-${filename.replace(/[^\w.-]+/g, '_')}`;
      await putStream(key, fs.createReadStream(f.path), f.mimetype || null);
      db.prepare(`INSERT INTO nfp_files
        (id, version_id, kind, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuid(), v.id, kind, filename, f.mimetype || null, f.size || null, key, req.user.name);
    }
    db.prepare("UPDATE nfp_versions SET updated_at = datetime('now') WHERE id = ?").run(v.id);
    res.status(201).json(hydrate(db, [db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(v.id)])[0]);
  } catch (err) {
    res.status(500).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

/** Correct a panel that has not been decided yet. */
const EDITABLE = ['serving_size', 'servings_per_container', 'formula_rev', 'drive_url', 'change_summary'];

router.put('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (['approved', 'superseded'].includes(v.status)) {
    return res.status(409).json({ error: 'An approved panel is what artwork was printed from and is never rewritten. File the next version.' });
  }
  const patch = {};
  for (const c of EDITABLE) if (req.body?.[c] !== undefined) patch[c] = req.body[c] === '' ? null : req.body[c];
  if (!Object.keys(patch).length) return res.json(hydrate(db, [v])[0]);
  db.prepare(`UPDATE nfp_versions SET ${Object.keys(patch).map((c) => `${c} = ?`).join(', ')},
    updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), v.id);
  logAudit(req.user, 'nfp_version_updated', 'nfp', v.id,
    { sku: v.sku, version: v.version, changed: Object.keys(patch) }, null, null, `${v.sku} NFP ${v.version}`);
  res.json(hydrate(db, [db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(v.id)])[0]);
});

// ── The signed link ──────────────────────────────────────────────────────────

/**
 * Issue (or re-issue) the approval link.
 *
 * The clear token is returned exactly once and stored only as a hash. Losing
 * the link therefore means issuing a new one, which invalidates the old — that
 * is the behaviour you want from a link that approves a regulatory statement,
 * not an inconvenience to design around.
 *
 * Refuses when there is nothing to look at. An approval given against a panel
 * the approver could not see is a rubber stamp, and the record would not say so.
 */
router.post('/:id/send', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'sent', 'rejected'].includes(v.status)) {
    return res.status(409).json({ error: 'This panel has already been decided.' });
  }
  const hasFile = db.prepare('SELECT COUNT(*) n FROM nfp_files WHERE version_id = ?').get(v.id).n > 0;
  if (!hasFile && !v.drive_url) {
    return res.status(409).json({
      error: 'Attach the panel or add a Drive link first — there is nothing for the approver to look at.',
    });
  }

  const token = randomBytes(24).toString('base64url');
  const sentTo = (req.body?.sent_to || '').trim() || null;
  db.prepare(`UPDATE nfp_versions SET status = 'sent', token_hash = ?, token_issued_at = datetime('now'),
    token_issued_by = ?, sent_to = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hashToken(token), req.user.name, sentTo, v.id);

  logAudit(req.user, 'nfp_link_issued', 'nfp', v.id,
    { sku: v.sku, version: v.version, sent_to: sentTo, reissued: !!v.token_hash }, null, null,
    `${v.sku} NFP ${v.version}`);

  // readyDocOrigin(), never appBaseUrl() — the launcher host answers a deep
  // link with the workspace picker.
  res.json({
    ok: true,
    link: `${readyDocOrigin()}/nfp/${token}`,
    reissued: !!v.token_hash,
  });
});

/** Take the link out of service without deciding anything. */
router.post('/:id/revoke', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE nfp_versions SET token_hash = NULL,
    status = CASE WHEN status = 'sent' THEN 'draft' ELSE status END,
    updated_at = datetime('now') WHERE id = ?`).run(v.id);
  logAudit(req.user, 'nfp_link_revoked', 'nfp', v.id, { sku: v.sku, version: v.version }, null, null,
    `${v.sku} NFP ${v.version}`);
  res.json({ ok: true });
});

// ── Deciding ─────────────────────────────────────────────────────────────────

/**
 * Write the product mirror and supersede whatever was current.
 *
 * Called inside the caller's transaction. This is the ONLY place
 * products.nfp_version / nfp_approved_at are written, which is what stops the
 * print gate and this table from ever telling different stories.
 */
function applyApproval(db, id, sku, version, approvedAt) {
  const others = db.prepare(
    "SELECT id FROM nfp_versions WHERE sku = ? AND id != ? AND status = 'approved'").all(sku, id);
  for (const o of others) {
    db.prepare("UPDATE nfp_versions SET status = 'superseded', superseded_by = ?, updated_at = datetime('now') WHERE id = ?")
      .run(id, o.id);
  }
  db.prepare("UPDATE products SET nfp_version = ?, nfp_approved_at = ?, updated_at = datetime('now') WHERE sku = ?")
    .run(version, approvedAt, sku);
}

/**
 * Print-ready artwork that was drawn against a different panel.
 *
 * Reported, never changed. The film already printed is still what is on the
 * shelf, so silently superseding it would make the record wrong — but nobody
 * should have to work out for themselves that approving V4 just stranded three
 * packs on V3.
 */
function strandedArtwork(db, sku, version) {
  return db.prepare(`SELECT id, component, version AS artwork_version, nfp_version
    FROM artwork_versions
    WHERE sku = ? AND status = 'print_ready' AND nfp_version IS NOT NULL AND nfp_version != ?`)
    .all(sku, version);
}

/**
 * Record a decision. Shared by the signed link and the in-app button so a
 * decision is byte-for-byte the same record whichever door it came through —
 * the same rule QA Review follows for signatures.
 */
function decide(db, v, { decision, by, comments, via }) {
  const now = new Date().toISOString();
  db.transaction(() => {
    if (decision === 'approved') {
      db.prepare(`UPDATE nfp_versions SET status = 'approved', approved_by = ?, approved_at = ?,
        decided_via = ?, decision_comments = ?, token_hash = NULL, updated_at = datetime('now')
        WHERE id = ?`).run(by, now.slice(0, 10), via, comments || null, v.id);
      applyApproval(db, v.id, v.sku, v.version, now.slice(0, 10));
    } else {
      db.prepare(`UPDATE nfp_versions SET status = 'rejected', rejected_reason = ?, approved_by = ?,
        decided_via = ?, token_hash = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(comments, by, via, v.id);
    }
  })();
  return decision === 'approved' ? strandedArtwork(db, v.sku, v.version) : [];
}

/** Tell whoever sent the link. A decision nobody hears about is not a decision. */
async function tellIssuer(db, v, decision, by, comments) {
  try {
    const issuer = v.token_issued_by
      && db.prepare('SELECT id, name FROM users WHERE name = ? AND is_active = 1').get(v.token_issued_by);
    if (!issuer) return;
    const { bot, dm } = botDm(db, issuer.id);
    const emoji = decision === 'approved' ? '✅' : '❌';
    // Bot bold is *text*, not **text** — the chat renderer isn't markdown.
    await postMessageAs(db, dm, bot,
      `${emoji} NFP ${decision}: *${v.sku}* panel ${v.version} — ${by}${comments ? ` — "${comments}"` : ''}`);
    pushToUser(issuer.id, {
      title: `NFP ${decision}`,
      body: `${v.sku} panel ${v.version} — ${by}`.slice(0, 120),
      tag: `nfp-${v.id}`, renotify: true, url: `/?tab=products`,
    }).catch(() => {});
  } catch { /* best-effort — a comms failure must never fail the decision */ }
}

/** Approve or reject from inside the app, for a panel signed off in person. */
router.post('/:id/decide', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'sent', 'rejected'].includes(v.status)) {
    return res.status(409).json({ error: 'This panel has already been decided.' });
  }
  const decision = req.body?.decision === 'approved' ? 'approved'
    : req.body?.decision === 'rejected' ? 'rejected' : null;
  if (!decision) return res.status(400).json({ error: 'Decision must be approved or rejected.' });

  // The name matters more than the button: this is a regulatory sign-off, and
  // "approved by whoever was logged in" is not who approved it if the panel was
  // signed by the formulator and keyed in by QA.
  const by = (req.body?.approved_by || '').trim() || req.user.name;
  const comments = (req.body?.comments || '').trim();
  if (decision === 'rejected' && comments.length < 3) {
    return res.status(400).json({ error: 'Say what is wrong with the panel — that note is what gets fixed.' });
  }

  const stranded = decide(db, v, { decision, by, comments, via: 'in_app' });
  logAudit(req.user, decision === 'approved' ? 'nfp_approved' : 'nfp_rejected', 'nfp', v.id,
    { sku: v.sku, version: v.version, by, via: 'in_app' }, null, null, `${v.sku} NFP ${v.version}`);
  res.json({ ok: true, stranded_artwork: stranded,
    version: hydrate(db, [db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(v.id)])[0] });
});

router.delete('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage nutrition panels.' });
  const db = getDb();
  const v = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (['approved', 'superseded'].includes(v.status)) {
    return res.status(409).json({ error: 'A decided panel is part of the record and cannot be deleted.' });
  }
  for (const f of db.prepare('SELECT storage_key FROM nfp_files WHERE version_id = ?').all(v.id)) {
    deleteObject(f.storage_key);
  }
  db.prepare('DELETE FROM nfp_versions WHERE id = ?').run(v.id);
  logAudit(req.user, 'nfp_version_deleted', 'nfp', v.id, { sku: v.sku, version: v.version }, null, null,
    `${v.sku} NFP ${v.version}`);
  res.json({ ok: true });
});

// ── The public half: the signed link ─────────────────────────────────────────
//
// Mounted separately at /api/nfp-link, outside requireModuleWrite — the person
// holding the link has no ReadyDoc account, which is the whole point. Same
// arrangement partner-portal and artwork/ingest use.
export const linkRouter = Router();

function byToken(db, token) {
  if (!token || token.length < 20) return null;
  // A single indexed lookup on the hash, not a scan comparing cleartext.
  return db.prepare("SELECT * FROM nfp_versions WHERE token_hash = ? AND status = 'sent'").get(hashToken(token));
}

const GONE = 'This approval link is invalid, already used, or has been withdrawn.';

linkRouter.get('/:token', async (req, res) => {
  const db = getDb();
  const v = byToken(db, req.params.token);
  if (!v) return res.status(404).json({ error: GONE });
  res.json(await approverView(db, v));
});

linkRouter.post('/:token', async (req, res) => {
  const db = getDb();
  const v = byToken(db, req.params.token);
  if (!v) return res.status(404).json({ error: GONE });
  const decision = req.body?.decision === 'approved' ? 'approved'
    : req.body?.decision === 'rejected' ? 'rejected' : null;
  if (!decision) return res.status(400).json({ error: 'Decision must be approved or rejected.' });

  // The link cannot know who is holding it, so the approver says. Required:
  // a regulatory approval with no name on it is not an approval.
  const by = (req.body?.name || '').trim();
  if (by.length < 2) return res.status(400).json({ error: 'Please give your name — the approval is recorded against it.' });
  const comments = (req.body?.comments || '').trim();
  if (decision === 'rejected' && comments.length < 3) {
    return res.status(400).json({ error: 'Please say what is wrong with the panel.' });
  }

  decide(db, v, { decision, by, comments, via: 'link' });
  logAudit(by, decision === 'approved' ? 'nfp_approved' : 'nfp_rejected', 'nfp', v.id,
    { sku: v.sku, version: v.version, via: 'signed-link' }, null, null, `${v.sku} NFP ${v.version}`);
  await tellIssuer(db, v, decision, by, comments);
  res.json({ ok: true, decision, sku: v.sku, version: v.version });
});

/* ── The batch link, from the approver's side ─────────────────────────────── */

/**
 * The token stays LIVE until every panel in the batch has been decided.
 *
 * A single-panel link is cleared by its decision, which is right when there is
 * one decision to make. Here there are ten: clearing on the first would strand
 * the other nine, and someone who approves six and comes back after lunch for
 * the rest must find the link still working. It clears itself when the last one
 * is answered.
 */
function batchByToken(db, token) {
  if (!token || token.length < 20) return null;
  return db.prepare('SELECT * FROM nfp_batches WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token));
}

async function batchView(db, b) {
  const versions = db.prepare(`SELECT v.* FROM nfp_batch_items i JOIN nfp_versions v ON v.id = i.version_id
    WHERE i.batch_id = ? ORDER BY v.sku`).all(b.id);
  const panels = [];
  for (const v of versions) {
    const view = await approverView(db, v);
    panels.push({ ...view, id: v.id, status: v.status, decided: ['approved', 'rejected'].includes(v.status),
      approved_by: v.approved_by, rejected_reason: v.rejected_reason });
  }
  return {
    batch_id: b.id, note: b.note, sent_to: b.sent_to, sent_by: b.created_by,
    total: panels.length,
    outstanding: panels.filter(p => !p.decided).length,
    panels,
    storage: storageEnabled(),
  };
}

/** Clear the token once nothing is left to decide. */
function closeIfFinished(db, batchId) {
  const left = db.prepare(`SELECT COUNT(*) n FROM nfp_batch_items i JOIN nfp_versions v ON v.id = i.version_id
    WHERE i.batch_id = ? AND v.status = 'sent'`).get(batchId).n;
  if (!left) db.prepare('UPDATE nfp_batches SET token_hash = NULL WHERE id = ?').run(batchId);
  return left;
}

linkRouter.get('/batch/:token', async (req, res) => {
  const db = getDb();
  const b = batchByToken(db, req.params.token);
  if (!b) return res.status(404).json({ error: GONE });
  res.json(await batchView(db, b));
});

/**
 * Decide one panel, or all of the ones still outstanding.
 *
 * `version_id` decides one; omitting it with `decision: 'approved'` approves
 * everything still outstanding — which is the case this exists for, ten SKUs
 * carrying one change. Each still becomes its own record through `decide()`.
 *
 * REJECTING IS ALWAYS ONE AT A TIME. An approval across a batch says "all of
 * these are right", which is a thing a person can mean; a rejection has to say
 * what is wrong, and one reason spread over ten panels tells whoever fixes them
 * nothing about any of them.
 */
linkRouter.post('/batch/:token', async (req, res) => {
  const db = getDb();
  const b = batchByToken(db, req.params.token);
  if (!b) return res.status(404).json({ error: GONE });

  const decision = req.body?.decision === 'approved' ? 'approved'
    : req.body?.decision === 'rejected' ? 'rejected' : null;
  if (!decision) return res.status(400).json({ error: 'Decision must be approved or rejected.' });

  const by = (req.body?.name || '').trim();
  if (by.length < 2) return res.status(400).json({ error: 'Please give your name — the approval is recorded against it.' });
  const comments = (req.body?.comments || '').trim();

  const wanted = req.body?.version_id;
  if (decision === 'rejected' && !wanted) {
    return res.status(400).json({ error: 'Reject one panel at a time, and say what is wrong with it.' });
  }
  if (decision === 'rejected' && comments.length < 3) {
    return res.status(400).json({ error: 'Please say what is wrong with the panel.' });
  }

  const rows = db.prepare(`SELECT v.* FROM nfp_batch_items i JOIN nfp_versions v ON v.id = i.version_id
    WHERE i.batch_id = ? AND v.status = 'sent'${wanted ? ' AND v.id = ?' : ''}`)
    .all(...(wanted ? [b.id, wanted] : [b.id]));
  if (!rows.length) return res.status(409).json({ error: 'Nothing left to decide on this link.' });

  const done = [], stranded = [];
  for (const v of rows) {
    const s = decide(db, v, { decision, by, comments, via: 'link' });
    logAudit(by, decision === 'approved' ? 'nfp_approved' : 'nfp_rejected', 'nfp', v.id,
      { sku: v.sku, version: v.version, via: 'signed-link', batch: b.id }, null, null, `${v.sku} NFP ${v.version}`);
    done.push({ sku: v.sku, version: v.version });
    // Print-ready artwork drawn against the older panel is REPORTED, never
    // changed — the film already printed is still what is on the shelf.
    for (const a of s) stranded.push({ sku: v.sku, ...a });
    tellIssuer(db, v, decision, by, comments).catch(() => {});
  }
  const left = closeIfFinished(db, b.id);
  res.json({ ok: true, decision, decided: done, outstanding: left, stranded });
});

export default router;
