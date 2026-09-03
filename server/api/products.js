// The finished-goods catalogue — the master list.
//
// Three jobs:
//   · Be the one place a SKU, its GTIN and its packaging spec are true. Every
//     other product record (artwork, POs, code requests) joins to it.
//   · Answer "what is still missing on this product" without anyone keeping a
//     side checklist. See readinessOf() — a GS1 number nobody assigned and an
//     NFP nobody approved are the two things that actually hold a launch up.
//   · Feed the Artwork-Proofing service. GET /master.csv emits the exact
//     sixteen lowercased headers its _fetch_sheet_rows() matches on. That
//     function is the contract: renaming a column here breaks proofing there,
//     silently, because its parser skips headers it does not recognise.
import { Router } from 'express';
import { createHash, timingSafeEqual, randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { resolveFlavorCodes } from '../flavor-codes.js';
import { preferredSku, LINE_CODES, PACK_CODES } from '../../shared/sku-format.js';
import { READINESS, TICKABLE, readinessOf, nextBasis } from '../../shared/product-readiness.js';
import { shelfState, gtinPrefixes } from '../product-shelf.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import fs from 'fs';
import { extractInvoiceText } from '../invoice-text.js';

const barcodeUpload = mediaUpload({ files: 1 }).array('files', 1);

const router = Router();

// Only these can change the catalogue. A wrong GTIN is a recall, not a typo.
const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

// ── GS1 ──────────────────────────────────────────────────────────────────────

/** GS1 mod-10 over everything but the final digit. */
export function checkDigit(body) {
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    total += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (total % 10)) % 10;
}

export function gtinValid(gtin) {
  if (!gtin || !/^\d+$/.test(gtin)) return false;
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  return checkDigit(gtin.slice(0, -1)) === Number(gtin[gtin.length - 1]);
}

// ── Readiness ────────────────────────────────────────────────────────────────
//
// The checklist and its dependency rules live in `shared/product-readiness.js`
// so the drawer renders exactly what the server counted. Adding a step is one
// entry there. `stampReadiness` is called from every write path that can
// satisfy or move a step — this file's POST, PUT, bottle-drafts, rename and
// realign, the confirm endpoint, the NFP approval in nfp.js and the artwork
// release in artwork.js — because a step that is satisfied without recording
// what it was satisfied against can never be found stale, and a SKU that
// changes under a done Shopify step must un-tick it.

// ── Shaping ──────────────────────────────────────────────────────────────────

const SELECT = `
  SELECT p.*, s.name AS spec_name, s.material_structure, s.zipper, s.print_process,
         s.trim_length_mm, s.trim_width_mm, s.gusset_mm, s.front_panel_mm,
         s.wind_direction, s.vendor_spec_string
  FROM products p LEFT JOIN packaging_specs s ON s.spec_id = p.spec_id`;

/**
 * Record what each satisfied step is true against, after a write.
 *
 * EXPORTED because three other write paths satisfy a step: the NFP approval in
 * nfp.js, the artwork release in artwork.js, and the barcode upload below. A
 * step satisfied without recording its basis can never be found stale — it
 * would sit green through every subsequent change — so every one of them calls
 * this, with the columns it wrote, in the same transaction.
 *
 * `changedColumns` is what makes it precise: writing a step's OWN column means
 * the work was re-done and the basis moves with it; writing anything else
 * leaves the basis alone so the step can go stale.
 */
export function stampReadiness(db, sku, before, changedColumns = [], who = null) {
  const row = db.prepare(`${SELECT} WHERE p.sku = ?`).get(sku);
  if (!row) return;
  // Colours are a dependency of artwork and live in their own table.
  const colors = db.prepare('SELECT * FROM product_colors WHERE sku = ? ORDER BY slot').all(sku);
  const after = { ...row, colors };
  const beforeWithColors = before ? { ...before, colors: before.colors || colors } : after;
  db.prepare('UPDATE products SET readiness_basis = ? WHERE sku = ?')
    .run(nextBasis(beforeWithColors, after, changedColumns, who), sku);
}

function hydrate(rows, db) {
  if (!rows.length) return [];
  // The flavour register, read once for the whole list rather than per row.
  let codeByFlavor = {};
  try {
    codeByFlavor = Object.fromEntries(db.prepare(
      'SELECT flavor, code FROM flavor_codes WHERE is_active = 1'
    ).all().map(r => [r.flavor, r.code]));
  } catch { /* the column may not exist on a very old database */ }
  const colors = db.prepare('SELECT * FROM product_colors ORDER BY sku, slot').all();
  const bySku = new Map();
  for (const c of colors) {
    if (!bySku.has(c.sku)) bySku.set(c.sku, []);
    bySku.get(c.sku).push(c);
  }
  return rows.map((r) => {
    const withColors = { ...r, colors: bySku.get(r.sku) || [] };
    // What this SKU would be under the new standard. Derived every read, never
    // stored: it depends on the flavour register, which moves as collisions
    // are broken. It is NOT this product's SKU — the existing catalogue keeps
    // its codes and the rename is its own project.
    const pref = preferredSku({ ...withColors, product_line: withColors.category }, codeByFlavor);
    return {
      ...withColors,
      readiness: readinessOf(withColors),
      preferred_sku: pref.sku,
      preferred_sku_blocked_by: pref.blocked_by,
      has_barcode_image: !!r.barcode_key,
      // A barcode image encodes ONE number. If the GTIN has moved since the
      // image was uploaded, the file on record no longer matches the product
      // and must not go to artwork — said out loud rather than left to be
      // discovered on a printed pack.
      barcode_stale: !!r.barcode_key && !!r.gtin && r.barcode_gtin !== r.gtin,
      barcode_gtin: r.barcode_gtin || null,
    };
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = hydrate(db.prepare(`${SELECT} ORDER BY p.sku`).all(), db);
  const specs = db.prepare('SELECT * FROM packaging_specs ORDER BY spec_id').all();
  res.json({ products: rows, specs, readinessSteps: READINESS.map((s) => ({ key: s.key, label: s.label })) });
});

/**
 * The text inside a shelf document, for search.
 *
 * Returns '' when the file has no readable text and null when reading it threw
 * — the row records which, so nobody assumes a search covered a scan it could
 * not read. Never blocks the upload: losing the file is worse than losing the
 * index.
 */
async function extractShelfText(f, slot) {
  try {
    const buf = await fs.promises.readFile(f.path);
    return (await extractInvoiceText(buf, f.mimetype, f.originalname)) || '';
  } catch (e) {
    console.warn(`[products] shelf text not indexed (${slot}):`, e.message);
    return null;
  }
}

/* ── The shelf ─────────────────────────────────────────────────────────────
 *
 * The reference documents this work runs on — the brand guide a proof is
 * checked against, the GS1 licence a retailer asks for, the Shopify export the
 * catalogue is reconciled against. Declared before `/:sku`.
 *
 * Reading is open to the module: anyone proofing artwork needs the brand guide.
 * Filing and retiring is `canManage`, the same as the catalogue itself.
 */
router.get('/shelf', (_req, res) => {
  res.json(shelfState(getDb()));
});

// Upload a document into a slot. The file's text is indexed for search the way
// equipment manuals and policies are — searched, never shipped.
router.post('/shelf/:slot', mediaUpload().array('files', 1), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const db = getDb();
  const files = req.files || [];
  try {
    const slot = db.prepare('SELECT * FROM product_doc_slots WHERE key = ? AND is_active = 1').get(req.params.slot);
    if (!slot) return res.status(404).json({ error: 'No such document slot.' });
    const title = String(req.body?.title || '').trim() || files[0]?.originalname || slot.label;
    const linkUrl = String(req.body?.link_url || '').trim() || null;
    // A LINK IS A REAL ANSWER for a document that lives somewhere else and is
    // meant to. Refusing both is the only thing worth refusing: a row with
    // neither a file nor an address is a note, not a document.
    if (!files.length && !linkUrl) {
      return res.status(400).json({ error: 'Attach a file or give a link — a slot needs something to open.' });
    }
    if (files.length && !storageEnabled()) {
      return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });
    }

    const id = uuid();
    let key = null, text = null, textStatus = null;
    const f = files[0];
    if (f) {
      key = `product-shelf/${req.params.slot}/${id}-${(f.originalname || 'file').replace(/[^\w.-]+/g, '_')}`;
      await putStream(key, fs.createReadStream(f.path), f.mimetype || null);
      // A file whose text will not read is still a file — the row says which,
      // rather than letting somebody assume a search covered it.
      text = await extractShelfText(f, req.params.slot);
      textStatus = text == null ? 'failed' : (text ? 'ok' : 'empty');
    }
    db.prepare(`INSERT INTO product_documents
      (id, slot_key, title, filename, storage_key, content_type, size, extracted_text, text_status,
       effective_date, link_url, notes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.params.slot, title, f?.originalname || null, key, f?.mimetype || null, f?.size || null,
        text ?? null, textStatus,
        // Dated from the document, not from the upload.
        String(req.body?.effective_date || '').trim() || new Date().toISOString().slice(0, 10),
        linkUrl, String(req.body?.notes || '').trim() || null, req.user?.name || null);
    logAudit(req.user, 'create', 'product_document', id, { slot: req.params.slot, title }, null, null, title);
    res.status(201).json(shelfState(db));
  } catch (e) {
    res.status(400).json({ error: uploadErrorMessage(e) || e.message });
  } finally { cleanupTemp(files); }
});

// Everything filed in one slot, newest first — the history, which is the point
// of a slot with a cadence.
router.get('/shelf/:slot/documents', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT id, slot_key, title, filename, content_type, size, effective_date,
    link_url, notes, uploaded_by, created_at, storage_key, text_status, extracted_text
    FROM product_documents WHERE slot_key = ?
    ORDER BY COALESCE(effective_date, created_at) DESC, created_at DESC LIMIT 200`).all(req.params.slot);
  res.json({
    documents: rows.map(({ extracted_text, storage_key, ...r }) => ({
      ...r, has_file: !!storage_key,
      searchable: extracted_text == null ? null : !!extracted_text,
    })),
  });
});

router.get('/shelf/documents/:id/file', async (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT * FROM product_documents WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found.' });
  if (!d.storage_key) return res.status(404).json({ error: 'This entry is a link, not a file.' });
  const url = await presignGet(d.storage_key, d.filename);
  if (!url) return res.status(503).json({ error: 'File storage unavailable.' });
  res.json({ url, filename: d.filename, content_type: d.content_type });
});

router.delete('/shelf/documents/:id', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const db = getDb();
  const d = db.prepare('SELECT * FROM product_documents WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found.' });
  if (d.storage_key) { try { await deleteObject(d.storage_key); } catch { /* the row is the record */ } }
  db.prepare('DELETE FROM product_documents WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'product_document', req.params.id, { slot: d.slot_key }, d, null, d.title);
  res.json(shelfState(db));
});

// The cadence is the plant's to set. "Monthly" here is a recommendation the
// first time the row is created and a decision afterwards — hence editable,
// and hence the seeder never touching a row that exists.
router.put('/shelf/:slot', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const db = getDb();
  const slot = db.prepare('SELECT * FROM product_doc_slots WHERE key = ?').get(req.params.slot);
  if (!slot) return res.status(404).json({ error: 'No such document slot.' });
  const b = req.body || {};
  const cadence = b.cadence_days === undefined ? slot.cadence_days
    : (b.cadence_days === null || b.cadence_days === '' ? null : Math.max(1, Number(b.cadence_days) || 0) || null);
  db.prepare(`UPDATE product_doc_slots SET label = ?, description = ?, cadence_days = ?, is_active = ?,
    updated_by = ?, updated_at = datetime('now') WHERE key = ?`)
    .run(String(b.label || slot.label).trim(), b.description ?? slot.description, cadence,
      b.is_active === undefined ? slot.is_active : (b.is_active ? 1 : 0),
      req.user?.name || null, req.params.slot);
  logAudit(req.user, 'update', 'product_doc_slot', req.params.slot, { cadence_days: cadence }, slot, null, slot.label);
  res.json(shelfState(db));
});

/* ── The barcode board ─────────────────────────────────────────────────────
 *
 * The same question the Nutrition panels tab answers, for the other file that
 * has to be right before anything prints. Declared before `/:sku`, or Express
 * reads "barcodes" as a product code.
 *
 * THE NUMBER AND THE LIST COME FROM THE SAME WALK — the counts are `.length`
 * of the rows returned, never a second query, so the headline and the list it
 * opens cannot disagree about the same SKU.
 */
router.get('/barcodes', (_req, res) => {
  const db = getDb();
  const rows = hydrate(db.prepare(`${SELECT} ORDER BY p.sku`).all(), db)
    .map((p) => ({
      sku: p.sku, flavor: p.flavor, category: p.category, pack: p.pack, status: p.status,
      gtin: p.gtin, gtin_valid: !!p.gtin_valid,
      has_barcode_image: p.has_barcode_image, barcode_gtin: p.barcode_gtin,
      barcode_stale: p.barcode_stale,
      barcode_filename: p.barcode_filename, barcode_uploaded_at: p.barcode_uploaded_at,
      barcode_uploaded_by: p.barcode_uploaded_by,
      // The one that decides what a person does next.
      state: !p.gtin ? 'no_gtin'
        : !p.gtin_valid ? 'bad_gtin'
          : p.barcode_stale ? 'stale'
            : p.has_barcode_image ? 'ok' : 'no_image',
    }));
  const by = (st) => rows.filter((r) => r.state === st);
  res.json({
    products: rows,
    counts: {
      total: rows.length,
      ok: by('ok').length,
      // A file that encodes a number the product no longer carries. The worst
      // of these, because it LOOKS done — the doctrine behind barcode_gtin.
      stale: by('stale').length,
      no_image: by('no_image').length,
      no_gtin: by('no_gtin').length,
      bad_gtin: by('bad_gtin').length,
    },
    // GS1 numbers are finite and one block is nearly full. Counted from the
    // catalogue, because the GTINs in use ARE the allocation.
    prefixes: gtinPrefixes(db),
  });
});

router.get('/specs', (_req, res) => {
  res.json({ specs: getDb().prepare('SELECT * FROM packaging_specs ORDER BY spec_id').all() });
});

// Registered BEFORE /:sku — Express matches in declaration order, and
// '/master.csv' is a perfectly good :sku as far as the router is concerned.
// The handler and its helpers live at the bottom of the file with the rest of
// the proofing-feed code; only the registration has to be up here.
router.get('/master.csv', (req, res) => masterCsv(req, res));

/* ── Flavour codes ─────────────────────────────────────────────────────────
 *
 * The register that makes `WHY-BTL-BLM` mean one thing. Declared before
 * `/:sku`, or Express reads "flavor-codes" as a product code.
 *
 * Reading is open to the module — anyone minting a SKU needs the code — and
 * only `canManage` may add one, because these get printed.
 */
router.get('/flavor-codes', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM flavor_codes ORDER BY is_active DESC, flavor').all();
  // The unresolved collisions are DERIVED on read from the live products, never
  // stored: resolve one by filing its code and this list shortens by itself. A
  // stored to-do list would go stale the moment somebody acted on it.
  let pending = [];
  try {
    const products = db.prepare('SELECT sku, flavor, base_flavor FROM products').all();
    // The codes already on file are fed BACK IN, so a collision somebody has
    // broken stops being reported for the other side of it too.
    const issued = Object.fromEntries(rows.filter(r => r.is_active).map(r => [r.flavor, r.code]));
    pending = resolveFlavorCodes(products, { issued }).needs_decision;
  } catch { /* advisory only */ }
  res.json({
    codes: rows.map(r => ({ ...r, is_active: !!r.is_active, legacy_codes: JSON.parse(r.legacy_codes || 'null') })),
    needs_decision: pending,
    can_edit: canManage(req.user),
  });
});

router.post('/flavor-codes', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can issue a flavour code.' });
  const db = getDb();
  const flavor = String(req.body?.flavor || '').trim();
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!flavor) return res.status(400).json({ error: 'A flavour name is required.' });
  if (!/^[A-Z]{2,4}$/.test(code)) return res.status(400).json({ error: 'A code is two to four letters — it is printed on film.' });

  // BOTH DIRECTIONS ARE REFUSED, and the message says which, because the two
  // mistakes need different fixes: a flavour that already has a code needs
  // nobody's attention, while a code already meaning something else needs a
  // different abbreviation chosen.
  const byFlavor = db.prepare('SELECT * FROM flavor_codes WHERE flavor = ?').get(flavor);
  if (byFlavor) {
    return res.status(409).json({
      error: `${flavor} already carries "${byFlavor.code}". A code is never changed once issued — it is on film and on every PO. Retire it and issue a new one only as a deliberate rename.`,
    });
  }
  const byCode = db.prepare('SELECT * FROM flavor_codes WHERE code = ?').get(code);
  if (byCode) {
    return res.status(409).json({
      error: `"${code}" is already ${byCode.flavor}${byCode.is_active ? '' : ' (retired — a code is never reissued)'}. Pick a different abbreviation.`,
    });
  }

  const id = uuid();
  db.prepare(`INSERT INTO flavor_codes (id, flavor, code, source, legacy_codes, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, flavor, code, req.body?.source === 'new' ? 'new' : 'decided',
      Array.isArray(req.body?.legacy_codes) && req.body.legacy_codes.length ? JSON.stringify(req.body.legacy_codes) : null,
      req.body?.note || null, req.user?.name || null);
  const row = db.prepare('SELECT * FROM flavor_codes WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'flavor_code', id, { flavor, code }, null, row, `${flavor} → ${code}`);
  res.status(201).json({ ...row, is_active: !!row.is_active });
});

// Retired, never deleted, and the code is never reissued — the controlled-form
// rule. The row staying is what keeps its code out of circulation.
/* ── Draft bottle SKUs ─────────────────────────────────────────────────────
 *
 * The bottling line, as rows in the catalogue rather than a spreadsheet. One
 * draft per protein flavour that already has an agreed code.
 *
 * DRAFTS, NOT PRODUCTS. `status = 'Draft'` and no GTIN: the GS1 numbers are
 * being allocated by hand and a barcode invented here would be a barcode
 * printed. Readiness already reports "no GS1 barcode", so each draft arrives
 * carrying its own punch list.
 *
 * Preview writes NOTHING and is computed by the same function that commits, so
 * what is on screen cannot differ from what lands.
 */
function planBottleDrafts(db) {
  const codes = Object.fromEntries(db.prepare(
    'SELECT flavor, code FROM flavor_codes WHERE is_active = 1'
  ).all().map(r => [r.flavor, r.code]));
  // One row per flavour per protein line — a flavour made in both whey and
  // plant is two bottles, not one. Read off what the plant already makes.
  const src = db.prepare(`SELECT DISTINCT category, protein_type, base_flavor, flavor
    FROM products WHERE category IN ('Whey Protein','Beef Protein','Plant Protein')
    ORDER BY category, base_flavor`).all();
  const existing = new Set(db.prepare('SELECT sku FROM products').all().map(r => r.sku));

  const plan = [];
  const blocked = [];
  const seen = new Set();
  for (const r of src) {
    const lineCode = LINE_CODES[r.category];
    const flavourCode = codes[r.base_flavor];
    if (!lineCode || !flavourCode) {
      const why = !lineCode ? `no code agreed for ${r.category}` : `${r.base_flavor} has no flavour code yet`;
      if (!blocked.some(b => b.flavor === r.base_flavor && b.category === r.category)) {
        blocked.push({ category: r.category, flavor: r.base_flavor, reason: why });
      }
      continue;
    }
    const sku = `${lineCode}-${PACK_CODES.Bottle}-${flavourCode}`;
    if (seen.has(sku)) continue;
    seen.add(sku);
    // Idempotent: a second run creates nothing, so this is safe to click twice.
    if (existing.has(sku)) continue;
    plan.push({
      sku,
      category: r.category,
      protein_type: r.protein_type,
      pack: PACK_CODES.Bottle,
      flavor: `${r.base_flavor} ${r.category} Bottle`,
      base_flavor: r.base_flavor,
      flavor_code: flavourCode,
    });
  }
  return { plan, blocked };
}

router.get('/bottle-drafts/preview', (req, res) => {
  const { plan, blocked } = planBottleDrafts(getDb());
  res.json({ plan, blocked, can_edit: canManage(req.user) });
});

router.post('/bottle-drafts', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can add products.' });
  const db = getDb();
  const { plan, blocked } = planBottleDrafts(db);
  if (!plan.length) return res.json({ created: 0, blocked, note: 'Nothing to add — every bottle SKU already exists.' });

  const ins = db.prepare(`INSERT INTO products
    (sku, gtin, gtin_valid, category, protein_type, pack, flavor, base_flavor, flavor_code,
     status, spec_id, dieline_required, notes, created_by)
    VALUES (@sku, NULL, 0, @category, @protein_type, @pack, @flavor, @base_flavor, @flavor_code,
     'Draft', 'SPEC-BOTTLE', 1, @notes, @created_by)`);
  const by = req.user?.name || null;
  const tx = db.transaction(() => {
    for (const p of plan) {
      ins.run({ ...p, created_by: by,
        notes: 'Draft for the bottling line. Needs a GS1 barcode, an MRP formula, an approved NFP and artwork.' });
      stampReadiness(db, p.sku, null, ['spec_id'], by);
    }
  });
  tx();
  logAudit(req.user, 'create', 'product', null,
    { action: 'bottle_drafts', created: plan.length, skus: plan.map(p => p.sku) },
    null, null, `${plan.length} bottle draft(s)`);
  res.status(201).json({ created: plan.length, skus: plan.map(p => p.sku), blocked });
});

/* ── The GS1 barcode image ──────────────────────────────────────────────────
 *
 * The PNG that comes off the GS1 site. The GTIN is the number; this is the
 * artwork the designer places, and until now there was nowhere to keep it —
 * so it lived in somebody's downloads folder and was re-fetched each time.
 *
 * One image per product, replaced rather than versioned: a barcode is not a
 * document with a revision history, it is a rendering of a number. If the
 * number changes the image is simply wrong, which is what `barcode_gtin`
 * exists to catch.
 */
router.post('/:sku/barcode', barcodeUpload, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can change the catalogue.' });
  const db = getDb();
  const files = req.files || [];
  try {
    const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    // NOTHING TO ENCODE. Storing a barcode image against a product with no
    // GTIN would leave a file nobody could check against anything.
    if (!p.gtin) return res.status(400).json({ error: 'This product has no GS1 barcode number yet — assign the GTIN first.' });
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });
    if (!files.length) return res.status(400).json({ error: 'No file received.' });

    const f = files[0];
    const filename = (f.originalname || `${p.gtin}.png`).slice(0, 255);
    const key = `barcodes/${p.sku}/${p.gtin}-${filename.replace(/[^\w.-]+/g, '_')}`;
    await putStream(key, fs.createReadStream(f.path), f.mimetype || null);
    // Replacing: the previous object is removed, since nothing references it.
    if (p.barcode_key && p.barcode_key !== key) {
      try { await deleteObject(p.barcode_key); } catch { /* orphan beats a failed upload */ }
    }
    db.prepare(`UPDATE products SET barcode_key = ?, barcode_filename = ?, barcode_content_type = ?,
      barcode_size = ?, barcode_gtin = ?, barcode_uploaded_at = datetime('now'), barcode_uploaded_by = ?,
      updated_at = datetime('now') WHERE sku = ?`)
      .run(key, filename, f.mimetype || null, f.size || null, p.gtin, req.user?.name || null, p.sku);
    logAudit(req.user, 'update', 'product', p.sku,
      { action: 'barcode_image', filename, gtin: p.gtin }, null, null, p.sku);
    res.status(201).json({ ok: true, filename, gtin: p.gtin });
  } catch (err) {
    res.status(500).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

/* ── Bringing drafts into line with the register ───────────────────────────
 *
 * A draft minted before a flavour code was corrected carries the old code —
 * BEF-BTL-CHU sitting beside a preferred SKU of BEF-BTL-CSG, which is exactly
 * the disagreement the preview column exists to make impossible.
 *
 * ONLY DRAFTS, AND THAT IS THE WHOLE SAFETY ARGUMENT. An active SKU is a join
 * key on open purchase orders, ShipHero inventory locations and every Shopify
 * order line ever placed — renaming one is the costed migration project, never
 * a button. A draft has been nowhere: no barcode, no artwork, no order.
 *
 * `legacy_sku` is deliberately NOT set. It exists so a code that shipped still
 * resolves on a two-year-old PO; a draft code never shipped, and recording it
 * would put a SKU into the "must still resolve" set that never existed.
 */
function planDraftRealign(db) {
  const rows = hydrate(db.prepare(`${SELECT} WHERE LOWER(p.status) = 'draft'`).all(), db);
  const taken = new Set(db.prepare('SELECT sku FROM products').all().map(r => r.sku));
  const plan = [];
  const blocked = [];
  for (const p of rows) {
    if (!p.preferred_sku) { blocked.push({ sku: p.sku, reason: (p.preferred_sku_blocked_by || [])[0] || 'cannot be worked out' }); continue; }
    if (p.preferred_sku === p.sku) continue;
    // Another product already holds the target. Reported, never overwritten.
    if (taken.has(p.preferred_sku)) { blocked.push({ sku: p.sku, reason: `${p.preferred_sku} already exists` }); continue; }
    plan.push({ from: p.sku, to: p.preferred_sku, product: p.flavor });
  }
  return { plan, blocked };
}

router.get('/drafts/realign/preview', (req, res) => {
  const { plan, blocked } = planDraftRealign(getDb());
  res.json({ plan, blocked, can_edit: canManage(req.user) });
});

router.post('/drafts/realign', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can change the catalogue.' });
  const db = getDb();
  const { plan, blocked } = planDraftRealign(db);
  if (!plan.length) return res.json({ renamed: 0, blocked });
  db.transaction(() => {
    // Same defer_foreign_keys reasoning as the rename endpoint: product_colors
    // points at the SKU, and the check moves to COMMIT when both agree again.
    db.pragma('defer_foreign_keys = ON');
    const upd = db.prepare("UPDATE products SET sku = ?, updated_at = datetime('now') WHERE sku = ?");
    const col = db.prepare('UPDATE product_colors SET sku = ? WHERE sku = ?');
    const before = db.prepare('SELECT * FROM products WHERE sku = ?');
    for (const r of plan) {
      const was = before.get(r.from);
      upd.run(r.to, r.from); col.run(r.to, r.from);
      stampReadiness(db, r.to, was, ['sku'], req.user?.name);
    }
  })();
  for (const r of plan) {
    logAudit(req.user, 'product_renamed', 'product', r.to,
      { from: r.from, to: r.to, reason: 'draft realigned to the flavour register' }, null, null, `${r.from} → ${r.to}`);
  }
  res.json({ renamed: plan.length, plan, blocked });
});

router.get('/:sku/barcode', async (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  if (!p.barcode_key) return res.status(404).json({ error: 'No barcode image on file.' });
  const url = await presignGet(p.barcode_key, p.barcode_filename);
  if (!url) return res.status(503).json({ error: 'File storage unavailable.' });
  res.json({
    url, filename: p.barcode_filename, content_type: p.barcode_content_type,
    gtin: p.barcode_gtin, uploaded_at: p.barcode_uploaded_at, uploaded_by: p.barcode_uploaded_by,
    // The reader is told before they hand it to a designer, not after.
    stale: !!p.gtin && p.barcode_gtin !== p.gtin,
    current_gtin: p.gtin,
  });
});

router.delete('/:sku/barcode', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can change the catalogue.' });
  const db = getDb();
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p?.barcode_key) return res.status(404).json({ error: 'No barcode image on file.' });
  try { await deleteObject(p.barcode_key); } catch { /* the row is the record */ }
  db.prepare(`UPDATE products SET barcode_key = NULL, barcode_filename = NULL, barcode_content_type = NULL,
    barcode_size = NULL, barcode_gtin = NULL, barcode_uploaded_at = NULL, barcode_uploaded_by = NULL,
    updated_at = datetime('now') WHERE sku = ?`).run(p.sku);
  logAudit(req.user, 'update', 'product', p.sku, { action: 'barcode_image_removed' }, null, null, p.sku);
  res.json({ ok: true });
});

router.delete('/flavor-codes/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can retire a flavour code.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM flavor_codes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  db.prepare('UPDATE flavor_codes SET is_active = 0 WHERE id = ?').run(row.id);
  logAudit(req.user, 'update', 'flavor_code', row.id, { action: 'retired' }, row, null, `${row.flavor} → ${row.code}`);
  res.json({ ok: true });
});

/**
 * What is wrong with the catalogue right now.
 *
 * DERIVED ON EVERY READ, never stored — the same rule as `readiness`. A punch
 * list that has to be regenerated is a punch list that goes stale, and the
 * whole point of this one is that it shrinks as the data is fixed.
 *
 * The counts were previously worked out by hand in a spreadsheet and written
 * into a document. That answers the question once. This answers it whenever
 * someone asks, against the catalogue that is actually live.
 *
 * The COLLISIONS are the part that blocks other work. The new SKU standard
 * (`WHY-PLG-BLM` — category · pack · flavour) uses a flavour abbreviation as a
 * key, and an abbreviation that means two flavours cannot be a key. Freezing
 * the flavour table with `CC` meaning both Cookie Crumble and Cheesecake
 * Crumble bakes the ambiguity into every code minted afterwards — and a code
 * that has been printed cannot be changed. So they are surfaced beside the
 * data faults rather than left in a document.
 *
 * Nothing here is auto-fixed. Every item is a decision about a real product:
 * which flavour keeps `CC`, whether Key Lime and Key Lime Pie are one flavour,
 * whether a missing colour was never chosen or never recorded.
 */
router.get('/data-health', (_req, res) => {
  const db = getDb();
  const products = db.prepare(`${SELECT}`).all();
  const colors = db.prepare('SELECT * FROM product_colors ORDER BY sku, slot').all();

  const bySku = new Map();
  for (const c of colors) {
    if (!bySku.has(c.sku)) bySku.set(c.sku, []);
    bySku.get(c.sku).push(c);
  }

  const issues = [];
  const add = (kind, sku, detail) => issues.push({ kind, sku, detail });

  for (const p of products) {
    // A spec you cannot print from is not a spec. The readiness step asks for
    // `material_structure` too, so this uses the same test — one definition of
    // "has a usable spec", or the punch list and the readiness bar disagree.
    if (!p.spec_id) add('no_spec', p.sku, 'No packaging spec assigned');
    else if (!p.material_structure) add('no_spec', p.sku, `Spec ${p.spec_id} has no material structure recorded`);

    if (!p.gtin) add('gtin', p.sku, 'No GS1 barcode');
    else if (!p.gtin_valid) add('gtin', p.sku, `GTIN ${p.gtin} fails its GS1 check digit`);

    // A row whose "SKU" is an 8+ digit number is a Shopify variant id that got
    // into the SKU column. It is not a code anyone prints.
    if (/^\d{8,}$/.test(p.sku)) add('not_a_sku', p.sku, 'This is a numeric id, not a SKU');

    const cs = bySku.get(p.sku) || [];
    if (!cs.length) add('no_colors', p.sku, 'No brand colours recorded');
    for (const c of cs) {
      if (!c.hex_valid) add('bad_color', p.sku, `Slot ${c.slot}: "${c.hex}" is not a usable hex value`);
      else if (!c.pms_valid) add('bad_color', p.sku, `Slot ${c.slot}: "${c.pms}" is not a usable PMS value`);
    }
  }

  // One abbreviation, more than one flavour. Read from the MIDDLE segment of
  // the existing code (PP-CM-02 → CM) rather than re-derived from the flavour
  // name, because what matters is the collision as it exists on today's
  // printed codes.
  const byAbbr = new Map();
  for (const p of products) {
    const m = String(p.sku).match(/^[A-Z]+-([A-Z]+)-/);
    if (!m) continue;
    if (!byAbbr.has(m[1])) byAbbr.set(m[1], new Map());
    const flavors = byAbbr.get(m[1]);
    if (!flavors.has(p.base_flavor)) flavors.set(p.base_flavor, []);
    flavors.get(p.base_flavor).push(p.sku);
  }
  const collisions = [...byAbbr.entries()]
    .filter(([, f]) => f.size > 1)
    .map(([abbr, f]) => ({
      abbr,
      flavors: [...f.entries()].map(([flavor, skus]) => ({ flavor, skus })),
    }))
    .sort((a, b) => a.abbr.localeCompare(b.abbr));

  // Two flavour names where one is a prefix of the other — "Key Lime" and
  // "Key Lime Pie". Sometimes two products, sometimes one product named twice,
  // and only a person knows which. Reported, never merged.
  const names = [...new Set(products.map(p => p.base_flavor))].sort();
  const similar = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i].toLowerCase(), b = names[j].toLowerCase();
      if (b.startsWith(`${a} `) || a.startsWith(`${b} `)) {
        similar.push({
          a: names[i], b: names[j],
          a_skus: products.filter(p => p.base_flavor === names[i]).map(p => p.sku),
          b_skus: products.filter(p => p.base_flavor === names[j]).map(p => p.sku),
        });
      }
    }
  }

  /**
   * How much GS1 numbering is left.
   *
   * Every GTIN here is a 12-digit UPC-A: a 9-digit company prefix, a 2-digit
   * item reference, a check digit. That is ONE HUNDRED numbers per prefix, and
   * there is no way to make it more. Running out is not a degradation — it is a
   * hard stop on launching anything, discovered at the worst moment, because
   * obtaining a new block from GS1 takes weeks.
   *
   * Counted from the GTINs actually in use rather than tracked in a field, so
   * it cannot drift from reality.
   */
  const prefixes = new Map();
  for (const p of products) {
    if (!p.gtin || String(p.gtin).length !== 12) continue;
    const prefix = String(p.gtin).slice(0, 9);
    if (!prefixes.has(prefix)) prefixes.set(prefix, new Set());
    prefixes.get(prefix).add(String(p.gtin).slice(9, 11));
  }
  const gs1 = [...prefixes.entries()]
    .map(([prefix, used]) => ({
      prefix,
      used: used.size,
      capacity: 100,
      remaining: 100 - used.size,
      // 25 is roughly one flavour launched across every format. Below that,
      // ordering the next block stops being housekeeping.
      low: 100 - used.size < 25,
    }))
    .sort((a, b) => a.remaining - b.remaining);

  const KINDS = ['no_spec', 'bad_color', 'no_colors', 'not_a_sku', 'gtin'];
  const counts = Object.fromEntries(KINDS.map(k => [k, new Set(issues.filter(i => i.kind === k).map(i => i.sku)).size]));

  res.json({
    products: products.length,
    flavors: names.length,
    counts,
    // SKUs affected, not issues raised — one SKU with three bad colour slots is
    // one product to go and fix, and reporting three overstates the work.
    affected: new Set(issues.map(i => i.sku)).size,
    issues,
    collisions,
    similar,
    gs1,
  });
});

router.get('/:sku', (req, res) => {
  const db = getDb();
  const row = db.prepare(`${SELECT} WHERE p.sku = ?`).get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'No such SKU' });
  const [product] = hydrate([row], db);
  // A change to one flavour usually touches the others. Danny says "blueberry";
  // that is a pouch and a stick.
  product.siblings = db
    .prepare('SELECT sku, flavor, category, pack FROM products WHERE base_flavor = ? AND sku != ? ORDER BY sku')
    .all(row.base_flavor, row.sku);
  res.json(product);
});

const WRITABLE = [
  'legacy_sku', 'gtin', 'category', 'protein_type', 'pack', 'pack_count', 'flavor',
  'base_flavor', 'flavor_code', 'status', 'spec_id', 'eyemark_color', 'dieline_required',
  'shopify_sku', 'shopify_variant_id', 'mrp_formula_id', 'formula_rev',
  'artwork_version', 'artwork_status', 'drive_url', 'notes', 'fill_weight_g',
];

/**
 * `nfp_version` and `nfp_approved_at` are deliberately NOT in WRITABLE.
 *
 * Those two columns are the artwork print gate — nothing reaches print_ready
 * without an approved NFP, or against a panel that is not the product's current
 * one. While they were text boxes, that gate opened by typing a date into one.
 *
 * They are now a mirror written by api/nfp.js in the same transaction as the
 * approval, and by nothing else. A panel approved before ReadyDoc existed is
 * recorded by filing it with `source: 'paper'`, which asks for the two facts a
 * typed date never carried: who approved it, and against what.
 *
 * Refused loudly rather than dropped silently, because a client that used to be
 * able to send these would otherwise look like it saved and quietly not have.
 */
const NFP_OWNED = ['nfp_version', 'nfp_approved_at'];

/**
 * The three steps that record work done in another system.
 *
 * A formula approved in the MRP, a listing in Shopify, a sync to ShipHero —
 * ReadyDoc cannot see into any of them, so a person says so. They were free
 * text ("Yes", and a number the SKU column already carried), which is a tick
 * that takes longer to fill in, cannot be un-set, and records neither who said
 * so nor when.
 *
 * Their columns are NOT in WRITABLE. A confirmation is an act with a name on
 * it, not a field to patch — the same doctrine that keeps `nfp_version` off the
 * ordinary edit form.
 */
const CONFIRMATIONS = {
  formula: { at: 'formula_approved_at', by: 'formula_approved_by', label: 'Approved formula' },
  shopify: { at: 'shopify_listed_at', by: 'shopify_listed_by', label: 'Listed in Shopify' },
  shiphero: { at: 'shiphero_synced_at', by: 'shiphero_synced_by', label: 'Synced to ShipHero' },
};

router.post('/:sku/confirm/:step', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const c = CONFIRMATIONS[req.params.step];
  if (!c || !TICKABLE.includes(req.params.step)) {
    return res.status(400).json({ error: `${req.params.step} is not something a person confirms here.` });
  }
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });

  const on = req.body?.on !== false;
  db.prepare(`UPDATE products SET ${c.at} = ?, ${c.by} = ?, updated_at = datetime('now') WHERE sku = ?`)
    .run(on ? new Date().toISOString() : null, on ? (req.user?.name || null) : null, existing.sku);
  // The step's own column, so re-confirming a STALE step is what clears it —
  // the basis moves to the facts as they stand now. That is the whole way back
  // for these three: somebody looks at Shopify again and says yes.
  stampReadiness(db, existing.sku, existing, [c.at], req.user?.name);
  logAudit(req.user, 'product_updated', 'product', existing.sku,
    { step: req.params.step, confirmed: on }, existing,
    db.prepare('SELECT * FROM products WHERE sku = ?').get(existing.sku), existing.sku);
  res.json(hydrate([db.prepare(`${SELECT} WHERE p.sku = ?`).get(existing.sku)], db)[0]);
});

router.post('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const b = req.body || {};
  const sku = (b.sku || '').trim().toUpperCase();
  if (!sku || !b.flavor?.trim() || !b.category?.trim() || !b.pack?.trim()) {
    return res.status(400).json({ error: 'SKU, flavour, category and pack are required.' });
  }
  const db = getDb();
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) {
    return res.status(409).json({ error: `${sku} already exists.` });
  }
  const gtin = (b.gtin || '').trim() || null;
  if (gtin && !gtinValid(gtin)) return res.status(400).json({ error: `${gtin} fails its GS1 check digit.` });
  if (gtin && db.prepare('SELECT sku FROM products WHERE gtin = ?').get(gtin)) {
    return res.status(409).json({ error: `${gtin} is already on another product.` });
  }

  const cols = ['sku', 'gtin', 'gtin_valid', 'created_by', ...WRITABLE.filter((c) => c !== 'gtin')];
  const vals = cols.map((c) => {
    if (c === 'sku') return sku;
    if (c === 'gtin') return gtin;
    if (c === 'gtin_valid') return gtinValid(gtin) ? 1 : 0;
    if (c === 'created_by') return req.user.name;
    if (c === 'base_flavor') return (b.base_flavor || b.flavor).trim();
    if (c === 'dieline_required') return b.dieline_required === false ? 0 : 1;
    return b[c] ?? null;
  });
  db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  // A product created with a spec or an artwork status already satisfies steps;
  // without a basis the NEXT unrelated write would stamp the post-write facts
  // and a GTIN corrected after creation could never make the artwork step stale.
  stampReadiness(db, sku, null, cols, req.user?.name);
  logAudit(req.user, 'product_created', 'product', sku, { gtin, flavor: b.flavor }, null, null, `${sku} — ${b.flavor}`);
  res.status(201).json(db.prepare(`${SELECT} WHERE p.sku = ?`).get(sku));
});

router.put('/:sku', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });
  const b = req.body || {};

  if (NFP_OWNED.some((c) => b[c] !== undefined)) {
    return res.status(400).json({
      error: 'The NFP version and its approval date are set by approving a panel, not by typing them. Open the product\'s NFP panels.',
    });
  }

  // A GTIN that fails its check digit is never stored, from any door.
  if (b.gtin !== undefined) {
    const g = (b.gtin || '').trim();
    if (g && !gtinValid(g)) return res.status(400).json({ error: `${g} fails its GS1 check digit.` });
    const clash = g && db.prepare('SELECT sku FROM products WHERE gtin = ? AND sku != ?').get(g, existing.sku);
    if (clash) return res.status(409).json({ error: `${g} is already on ${clash.sku}.` });
  }

  const patch = {};
  for (const c of WRITABLE) if (b[c] !== undefined) patch[c] = b[c] === '' ? null : b[c];
  // A fill weight is a number in grams or nothing — never a guess or a unit.
  if (patch.fill_weight_g !== undefined && patch.fill_weight_g !== null) {
    const n = Number(String(patch.fill_weight_g).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Fill weight is a number of grams, e.g. 30.' });
    patch.fill_weight_g = n;
  }
  if (patch.gtin !== undefined) patch.gtin_valid = gtinValid(patch.gtin) ? 1 : 0;
  if (!Object.keys(patch).length) return res.json(existing);

  const sets = Object.keys(patch).map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE sku = ?`)
    .run(...Object.values(patch), existing.sku);
  // What each satisfied step is now true against. Editing the GTIN here is
  // exactly the case this exists for: the step's own basis moves, and every
  // step that DEPENDED on the GTIN — the artwork, the Shopify listing — keeps
  // the old one and comes back onto the punch list saying so.
  stampReadiness(db, existing.sku, existing, Object.keys(patch), req.user?.name);
  logAudit(req.user, 'product_updated', 'product', existing.sku, { changed: Object.keys(patch) }, null, null, existing.sku);
  res.json(hydrate([db.prepare(`${SELECT} WHERE p.sku = ?`).get(existing.sku)], db)[0]);
});

/**
 * Rename a SKU, keeping the old code on the row forever.
 *
 * Separate from PUT on purpose: this rewrites the join key, so it should read
 * as its own deliberate act in the audit log rather than hide inside a field
 * edit. legacy_sku is only ever set here, and never cleared.
 */
router.post('/:sku/rename', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });
  const next = (req.body?.sku || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(next)) {
    return res.status(400).json({ error: 'A SKU is letters, digits and hyphens, 3 to 24 characters.' });
  }
  if (next === existing.sku) return res.json(existing);
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(next)) {
    return res.status(409).json({ error: `${next} already exists.` });
  }
  db.transaction(() => {
    // Foreign keys are enforced app-wide (db.js sets foreign_keys = ON), so
    // renaming the parent leaves product_colors pointing at a SKU that no
    // longer exists for the instant between the two statements. defer_foreign_keys
    // moves the check to COMMIT, when both tables agree again. It is scoped to
    // this transaction and resets itself — unlike foreign_keys = OFF, which
    // would be a global switch flipped from inside a request handler.
    db.pragma('defer_foreign_keys = ON');
    db.prepare('UPDATE products SET sku = ?, legacy_sku = COALESCE(legacy_sku, ?), updated_at = datetime(\'now\') WHERE sku = ?')
      .run(next, existing.sku, existing.sku);
    db.prepare('UPDATE product_colors SET sku = ? WHERE sku = ?').run(next, existing.sku);
    // The SKU is keyed into Shopify and ShipHero; those steps depend on it and
    // must read stale after a rename rather than go on describing the old code.
    stampReadiness(db, next, existing, ['sku'], req.user?.name);
  })();
  logAudit(req.user, 'product_renamed', 'product', next, { from: existing.sku, to: next }, null, null, `${existing.sku} → ${next}`);
  res.json(db.prepare(`${SELECT} WHERE p.sku = ?`).get(next));
});

// ── The Artwork-Proofing feed ────────────────────────────────────────────────

// Public path, guarded by a token compared as a hash. Read-only and it exposes
// nothing a printer would not already hold. Unset token = endpoint off, same
// graceful-degradation shape as storageEnabled().
function tokenOk(supplied) {
  const expected = process.env.PRODUCT_MASTER_TOKEN || '';
  if (!expected || !supplied) return false;
  const a = createHash('sha256').update(String(supplied)).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const PACK_LABEL = {
  PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick pack', BOX: 'Carton', CUP: 'Cup',
};

// These sixteen header names are the contract with Artwork-Proofing's
// _fetch_sheet_rows(). Do not rename them to match our column names.
const CSV_HEADERS = [
  'sku', 'gtin', 'flavor', 'packaging type', 'material', 'zipper', 'print',
  'trim length', 'trim width', 'gusset dimension', 'front panel dimension',
  'wind direction', 'pms spot colors', 'hex spot colors', 'eye mark color',
  'die line required',
  // An extra column is free — the proofer skips headers it does not know —
  // and this one is what its Net Weight check reads (alias: Fill Weight (g)).
  'fill weight (g)',
];

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function masterCsv(req, res) {
  if (!tokenOk(req.query.token)) return res.status(401).send('Unauthorized');
  const db = getDb();
  const rows = hydrate(db.prepare(`${SELECT} WHERE p.status != 'discontinued' ORDER BY p.sku`).all(), db);

  const lines = [CSV_HEADERS.join(',')];
  for (const p of rows) {
    const pms = p.colors.filter((c) => c.pms).map((c) => c.pms).join(' | ');
    const hex = p.colors.filter((c) => c.hex).map((c) => c.hex).join(' | ');
    lines.push([
      p.sku, p.gtin, p.flavor, PACK_LABEL[p.pack] || p.pack,
      p.material_structure, p.zipper, p.print_process,
      p.trim_length_mm, p.trim_width_mm, p.gusset_mm, p.front_panel_mm,
      p.wind_direction, pms, hex, p.eyemark_color,
      p.dieline_required ? 'yes' : 'no',
      p.fill_weight_g ?? '',
    ].map(csvCell).join(','));
  }

  res.type('text/csv; charset=utf-8')
    // Short cache: the proofer already caches for 5 minutes its side, and a
    // stale master is how artwork gets checked against a barcode we retired.
    .set('Cache-Control', 'no-store')
    .send(lines.join('\n'));
}

export default router;
