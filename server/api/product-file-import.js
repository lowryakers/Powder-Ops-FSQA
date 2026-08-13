// Dropping a Drive folder of finished panels or artwork in at once.
//
// One importer for BOTH, because the job is identical: read the filenames,
// work out which product each belongs to, and file it as a version with the
// file attached. The only differences are which table the version lands in and
// what a version is called, and those are two small adapters at the bottom.
//
// ANALYZE WRITES NOTHING. It reads every file, matches, pulls the panel text,
// and reports — including what it could NOT place. The client sends the files
// again on commit with the mapping it approved, so there is no stash table and
// no half-finished import sitting in the database (the same arrangement the
// scanned-test importer uses).
//
// NOTHING IS FILED ON A GUESS. matchProduct() only returns a SKU for a GTIN or
// a code; a flavour-name resemblance is always a suggestion the person picks
// from. A nutrition panel on the wrong SKU is what artwork then prints from.

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putStream } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { extractPdfText } from './documents.js';
import { matchProduct, readNfpText, versionFromFilename } from '../product-file-match.js';

const router = Router();

const upload = mediaUpload({ files: 60 }).array('files', 60);
const withUpload = (req, res, next) => upload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

const catalogue = (db) => db.prepare(
  "SELECT sku, legacy_sku, gtin, flavor, base_flavor, category, pack FROM products WHERE status != 'discontinued'"
).all();

/* ── The two targets ──────────────────────────────────────────────────────── */

const TARGETS = {
  nfp: {
    label: 'Nutrition panels',
    // What this SKU already has, so the screen can say "this one has V2 on
    // file" before somebody adds a second copy of it.
    existing: (db) => new Map(db.prepare(
      "SELECT sku, GROUP_CONCAT(version) v, COUNT(*) n FROM nfp_versions WHERE status != 'superseded' GROUP BY sku"
    ).all().map(r => [r.sku, { versions: r.v, count: r.n }])),
    // Reads the panel so the version arrives with its numbers already in it.
    read: async (buffer) => {
      try {
        const { text } = await extractPdfText(buffer);
        return readNfpText(text);
      } catch { return { serving_size: null, servings_per_container: null, evidence: {} }; }
    },
    nextVersion: (db, sku, fromName) => {
      if (fromName) return fromName;
      const n = db.prepare('SELECT COUNT(*) c FROM nfp_versions WHERE sku = ?').get(sku).c;
      return `V${n + 1}`;
    },
    create(db, { sku, version, file, read, user }) {
      if (db.prepare('SELECT 1 FROM nfp_versions WHERE sku = ? AND version = ?').get(sku, version)) {
        return { skipped: `${sku} already has a panel ${version}` };
      }
      const id = uuid();
      db.prepare(`INSERT INTO nfp_versions
        (id, sku, version, status, source, serving_size, servings_per_container, change_summary, created_by)
        VALUES (?, ?, ?, 'draft', 'upload', ?, ?, ?, ?)`).run(
        id, sku, version, read?.serving_size || null, read?.servings_per_container || null,
        `Imported from ${file.originalname}.`, user);
      return { id };
    },
    attach(db, { id, sku, key, file, user }) {
      db.prepare(`INSERT INTO nfp_files (id, version_id, kind, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, 'panel', ?, ?, ?, ?, ?)`)
        .run(uuid(), id, file.originalname.slice(0, 255), file.mimetype || null, file.size || null, key, user);
    },
    keyFor: (sku, id, name) => `nfp/${sku}/${id}-panel-${name.replace(/[^\w.-]+/g, '_')}`,
    entity: 'nfp',
  },

  artwork: {
    label: 'Artwork',
    existing: (db) => new Map(db.prepare(
      "SELECT sku, GROUP_CONCAT(version) v, COUNT(*) n FROM artwork_versions WHERE status != 'superseded' GROUP BY sku"
    ).all().map(r => [r.sku, { versions: r.v, count: r.n }])),
    // Artwork carries no numbers worth pre-filling — the proofing service is
    // what reads a pack — so this only says whether the PDF has text at all.
    read: async () => ({}),
    nextVersion: (db, sku) => {
      const row = db.prepare(
        "SELECT MAX(version) v FROM artwork_versions WHERE sku = ? AND component = 'primary'").get(sku);
      return (row?.v || 0) + 1;
    },
    create(db, { sku, version, file, user }) {
      const product = db.prepare('SELECT nfp_version FROM products WHERE sku = ?').get(sku);
      const id = uuid();
      db.prepare(`INSERT INTO artwork_versions
        (id, sku, component, version, status, source, nfp_version, change_summary, created_by)
        VALUES (?, ?, 'primary', ?, 'draft', 'upload', ?, ?, ?)`).run(
        id, sku, version, product?.nfp_version || null, `Imported from ${file.originalname}.`, user);
      return { id };
    },
    attach(db, { id, sku, key, file, user }) {
      db.prepare(`INSERT INTO artwork_files (id, version_id, kind, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, 'print_pdf', ?, ?, ?, ?, ?)`)
        .run(uuid(), id, file.originalname.slice(0, 255), file.mimetype || null, file.size || null, key, user);
    },
    keyFor: (sku, id, name) => `artwork/${sku}/${id}-${name.replace(/[^\w.-]+/g, '_')}`,
    entity: 'artwork',
  },
};

/* ── Step 1 — look, decide nothing ────────────────────────────────────────── */

router.post('/:target/analyze', withUpload, async (req, res) => {
  const target = TARGETS[req.params.target];
  if (!target) return res.status(404).json({ error: 'Unknown import target.' });
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage product files.' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files received.' });

  const db = getDb();
  const products = catalogue(db);
  const have = target.existing(db);

  try {
    const out = [];
    for (const f of files) {
      const name = f.originalname || 'file';
      const m = matchProduct(name, products);
      const isPdf = /pdf$/i.test(f.mimetype || '') || /\.pdf$/i.test(name);
      const read = isPdf ? await target.read(fs.readFileSync(f.path)) : {};
      const sku = m.sku || null;
      out.push({
        filename: name, size: f.size, is_pdf: isPdf,
        sku,
        basis: m.basis || null,
        detail: m.detail || null,
        ambiguous: !!m.ambiguous,
        suggestions: m.suggestions || [],
        version_in_name: versionFromFilename(name),
        // Named so the screen can warn before a second copy of V2 is filed.
        existing: sku ? (have.get(sku) || null) : null,
        read,
      });
    }

    const matched = out.filter(r => r.sku).length;
    res.json({
      target: req.params.target, label: target.label,
      files: out,
      counts: {
        total: out.length,
        matched,
        // The two that need a person, counted apart: one is "pick from these",
        // the other is "nothing here resembles a product".
        needs_pick: out.filter(r => !r.sku && r.suggestions.length).length,
        unmatched: out.filter(r => !r.sku && !r.suggestions.length).length,
      },
      products: products.map(p => ({ sku: p.sku, flavor: p.flavor, category: p.category, pack: p.pack })),
      storage: storageEnabled(),
    });
  } finally {
    cleanupTemp(files);
  }
});

/* ── Step 2 — file them ───────────────────────────────────────────────────── */

/**
 * `mapping` is `{ filename: sku }` — what the person approved, including the
 * ones they picked by hand. A file not in the mapping is SKIPPED rather than
 * guessed at, so leaving something out of the mapping is how you decline it.
 */
router.post('/:target/commit', withUpload, async (req, res) => {
  const target = TARGETS[req.params.target];
  if (!target) return res.status(404).json({ error: 'Unknown import target.' });
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage product files.' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files received.' });

  let mapping = {};
  try { mapping = JSON.parse(req.body?.mapping || '{}'); } catch { mapping = {}; }

  const db = getDb();
  const known = new Set(catalogue(db).map(p => p.sku));
  const created = [], skipped = [];

  try {
    for (const f of files) {
      const name = f.originalname || 'file';
      const sku = String(mapping[name] || '').trim();
      if (!sku) { skipped.push({ filename: name, reason: 'not mapped to a product' }); continue; }
      if (!known.has(sku)) { skipped.push({ filename: name, reason: `${sku} is not in the catalogue` }); continue; }

      const isPdf = /pdf$/i.test(f.mimetype || '') || /\.pdf$/i.test(name);
      const read = isPdf ? await target.read(fs.readFileSync(f.path)) : {};
      const version = target.nextVersion(db, sku, versionFromFilename(name));

      // The row first, then the object. A version with no file is visibly
      // incomplete and can be fixed; a stored object with no row is invisible.
      const made = target.create(db, { sku, version, file: f, read, user: req.user.name });
      if (made.skipped) { skipped.push({ filename: name, reason: made.skipped }); continue; }

      const key = target.keyFor(sku, made.id, name);
      try {
        await putStream(key, fs.createReadStream(f.path), f.mimetype || null);
      } catch (e) {
        // Leave the version, say the file did not land. Reporting it is what
        // lets somebody retry the one file instead of the whole folder.
        skipped.push({ filename: name, reason: `stored the version but the file upload failed: ${e.message}` });
        continue;
      }
      target.attach(db, { id: made.id, sku, key, file: f, user: req.user.name });
      created.push({ filename: name, sku, version, id: made.id, read });
    }

    logAudit(req.user, 'import', target.entity, 'bulk-file-import',
      { target: req.params.target, created: created.length, skipped: skipped.length,
        skus: created.map(c => c.sku) },
      null, null, `${target.label} — ${created.length} file(s)`);

    res.json({ created, skipped, counts: { created: created.length, skipped: skipped.length } });
  } finally {
    cleanupTemp(files);
  }
});

export default router;
