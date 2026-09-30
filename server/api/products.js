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
import { randomUUID as uuid } from 'crypto';
import { checkProofToken, refuseProofToken } from '../proof-token.js';
import { provenanceOf, provenanceMissing, provenanceStale } from '../../shared/panel-provenance.js';
import { catalogueCompleteness } from '../product-completeness.js';
import { getDb, logAudit } from '../db.js';
import { resolveFlavorCodes } from '../flavor-codes.js';
import { preferredSku, LINE_CODES, PACK_CODES } from '../../shared/sku-format.js';
import { READINESS, TICKABLE, readinessOf, nextBasis } from '../../shared/product-readiness.js';
import { shelfState, gtinPrefixes } from '../product-shelf.js';
import { normalizeGtin, sameGtin, gtinValid } from '../../shared/gtin.js';
import { validateField, FIELD_RULES, NA_FIELDS, naOf, looksLikeTypedNa, MASTER_CSV_SOURCES, PACKAGING_DERIVED } from '../../shared/product-fields.js';
import { shelfLifeBasis, shelfLifeFor, NO_BASIS, BASIS_KIND_LABEL, DATE_TYPE_LABEL } from '../stability.js';
import { stageInputs, stageFor } from '../product-stages.js';
import { buildSpecPatch, SPEC_ID_RE } from '../../shared/packaging-spec.js';
import { parseDelimited } from '../tabular.js';
import { pmsValid, hexValid, colorIssues, isBlankSlot, conflictSeverity }
  from '../../shared/product-colors.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import fs from 'fs';
import { extractInvoiceText } from '../invoice-text.js';

const barcodeUpload = mediaUpload({ files: 1 }).array('files', 1);

const router = Router();

// Only these can change the catalogue. A wrong GTIN is a recall, not a typo.
const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

// ── GS1 ──────────────────────────────────────────────────────────────────────

// What a GS1 number IS lives in `shared/gtin.js` — the check digit, the
// lengths, and which spellings are the same number. Re-exported here because
// this file was its home and several callers import it from this path.
export { checkDigit, gtinValid } from '../../shared/gtin.js';

/**
 * What a typed GTIN is STORED as.
 *
 * The check digit of `00` + a UPC-A is the UPC-A's own, so a padded number
 * passes `gtinValid` exactly as the bare one does and both write paths used to
 * keep whatever was pasted. One number on file in two spellings is this
 * codebase's recurring defect; the padding comes off at the door so every
 * reader downstream — the GS1 capacity count, the barcode-image check, the
 * proofing feed — sees one number. See `shared/gtin.js` for what is never
 * touched (a real GTIN-14 case code).
 */
const storedGtin = (raw) => normalizeGtin(raw) || null;

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
  SELECT p.*, s.name AS spec_name, s.format AS spec_format, s.material_structure, s.zipper, s.print_process,
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
  // The new-product stage's facts, read once for the whole list (D-134).
  const stageFacts = stageInputs(db);
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
    const readiness = readinessOf(withColors);
    return {
      ...withColors,
      readiness,
      // Where the product is in the new-product flow, and the first gate it is
      // waiting on, named (shared/product-stage.js). Derived on every read;
      // there is no stage column and there must never be one.
      stage: stageFor(stageFacts, { ...withColors, readiness }),
      preferred_sku: pref.sku,
      preferred_sku_blocked_by: pref.blocked_by,
      has_barcode_image: !!r.barcode_key,
      // A barcode image encodes ONE number. If the GTIN has moved since the
      // image was uploaded, the file on record no longer matches the product
      // and must not go to artwork — said out loud rather than left to be
      // discovered on a printed pack.
      // Compared as NUMBERS, not as strings: one GTIN written two ways is one
      // GTIN, and a raw compare put a red "this image is for a different
      // number" on products whose image is for exactly the number they carry.
      barcode_stale: !!r.barcode_key && !!r.gtin && !sameGtin(r.barcode_gtin, r.gtin),
      barcode_gtin: r.barcode_gtin || null,
      // The fields somebody has marked NOT APPLICABLE on this SKU, with who and
      // when (shared/product-fields.js). Parsed here so no reader touches the
      // JSON column.
      na: naOf(r),
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
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

/* ── Packaging specs (D-135) ────────────────────────────────────────────────
 *
 * `packaging_specs` is the one owner of the film facts every product on the
 * spec reads through `products.spec_id`, and master.csv hands them to the
 * proofer. The import refuses to write them per product (D-133) and says
 * "set it on the spec" — these routes are where that is done. The rules live
 * in `shared/packaging-spec.js`, which the editor reads too.
 *
 * Declared before `/:sku`, or Express reads "specs" as a product code.
 */
function specsWithUse(db, where = '', args = []) {
  const specs = db.prepare(`SELECT * FROM packaging_specs ${where} ORDER BY spec_id`).all(...args);
  const using = db.prepare(`SELECT sku, flavor, status, artwork_status FROM products
    WHERE spec_id = ? ORDER BY sku`);
  return specs.map((s) => {
    const products = using.all(s.spec_id);
    return {
      ...s,
      products,
      products_using: products.length,
      // Artwork already released against this spec. Reported beside an edit,
      // never gated: a film fact that moves under a printed pack is somebody's
      // question to ask, not the app's to answer.
      print_ready: products.filter((p) => p.artwork_status === 'print_ready').length,
    };
  });
}

router.get('/specs', (_req, res) => {
  res.json({ specs: specsWithUse(getDb()) });
});

router.post('/specs', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, supervisors and admins can change a packaging spec' });
  const db = getDb();
  const body = req.body || {};
  const specId = String(body.spec_id || '').trim().toUpperCase();
  if (!SPEC_ID_RE.test(specId)) {
    return res.status(400).json({ error: 'A spec code is SPEC- followed by letters, digits and hyphens, e.g. SPEC-BOTTLE-SM', errors: { spec_id: 'e.g. SPEC-BOTTLE-SM' } });
  }
  if (db.prepare('SELECT 1 FROM packaging_specs WHERE spec_id = ?').get(specId)) {
    return res.status(409).json({ error: `${specId} already exists — edit it rather than opening a second one`, errors: { spec_id: 'already exists' } });
  }
  const { patch, errors } = buildSpecPatch(body, null);
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
  const row = { spec_id: specId, ...patch };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO packaging_specs (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  const [created] = specsWithUse(db, 'WHERE spec_id = ?', [specId]);
  logAudit(req.user, 'packaging_spec_created', 'packaging_spec', specId, { fields: Object.keys(patch) }, null, created, created.name);
  res.status(201).json({ spec: created });
});

router.put('/specs/:specId', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, supervisors and admins can change a packaging spec' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM packaging_specs WHERE spec_id = ?').get(req.params.specId);
  if (!existing) return res.status(404).json({ error: `No packaging spec ${req.params.specId}` });
  const body = req.body || {};
  // The join key. Products, POs and the proofer resolve through it; a
  // different spec is a new spec, opened with POST.
  if (body.spec_id !== undefined && String(body.spec_id).trim() !== existing.spec_id) {
    return res.status(400).json({ error: 'A spec code cannot be changed — open a new spec and move the products to it', errors: { spec_id: 'cannot be changed' } });
  }
  const { patch, errors } = buildSpecPatch(body, existing);
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
  if (Object.keys(patch).length) {
    const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE packaging_specs SET ${sets}, updated_at = datetime('now') WHERE spec_id = @spec_id`)
      .run({ ...patch, spec_id: existing.spec_id });
  }
  const [updated] = specsWithUse(db, 'WHERE spec_id = ?', [existing.spec_id]);
  if (Object.keys(patch).length) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, existing[k]]));
    logAudit(req.user, 'packaging_spec_updated', 'packaging_spec', existing.spec_id,
      { fields: Object.keys(patch), products_using: updated.products_using, print_ready: updated.print_ready },
      before, patch, existing.name);
  }
  res.json({ spec: updated, changed: Object.keys(patch) });
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can issue a flavor code.' });
  const db = getDb();
  const flavor = String(req.body?.flavor || '').trim();
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!flavor) return res.status(400).json({ error: 'A flavor name is required.' });
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
      const why = !lineCode ? `no code agreed for ${r.category}` : `${r.base_flavor} has no flavor code yet`;
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can change the catalog.' });
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

/**
 * Every table keyed on `products.sku`, and the one place a rename moves them.
 *
 * THE SKU IS A JOIN KEY IN FOUR TABLES, NOT ONE. Both rename paths used to
 * carry `product_colors` alone, which was correct for exactly as long as the
 * catalogue had no artwork and no nutrition panels: `artwork_versions` and
 * `nfp_versions` declare a foreign key, so renaming a product that had either
 * threw a bare `FOREIGN KEY constraint failed` at COMMIT — and
 * `artwork_snapshots` declares none, so its rows would have been orphaned
 * SILENTLY, which is worse: `GET /artwork/snapshot?sku=` would simply stop
 * finding the proof that was run against that pack.
 *
 * It had never fired because the seeded catalogue has neither, and the
 * proofing loop files an artwork version the first time a pack is proofed.
 * So the rename would have broken on precisely the products furthest along.
 *
 * A new table keyed on the SKU goes in this list, or a rename loses it.
 */
const SKU_CHILD_TABLES = ['product_colors', 'artwork_versions', 'artwork_snapshots', 'nfp_versions', 'product_completeness_blocks', 'packaging_po_records'];

function moveSkuChildren(db, from, to) {
  for (const t of SKU_CHILD_TABLES) {
    db.prepare(`UPDATE ${t} SET sku = ? WHERE sku = ?`).run(to, from);
  }
}

router.post('/drafts/realign', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can change the catalog.' });
  const db = getDb();
  const { plan, blocked } = planDraftRealign(db);
  if (!plan.length) return res.json({ renamed: 0, blocked });
  db.transaction(() => {
    // Same defer_foreign_keys reasoning as the rename endpoint: the child
    // tables point at the SKU, and the check moves to COMMIT when they agree.
    db.pragma('defer_foreign_keys = ON');
    const upd = db.prepare("UPDATE products SET sku = ?, updated_at = datetime('now') WHERE sku = ?");
    const before = db.prepare('SELECT * FROM products WHERE sku = ?');
    for (const r of plan) {
      const was = before.get(r.from);
      upd.run(r.to, r.from); moveSkuChildren(db, r.from, r.to);
      stampReadiness(db, r.to, was, ['sku'], req.user?.name);
    }
  })();
  for (const r of plan) {
    logAudit(req.user, 'product_renamed', 'product', r.to,
      { from: r.from, to: r.to, reason: 'draft realigned to the flavor register' }, null, null, `${r.from} → ${r.to}`);
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
    stale: !!p.gtin && !sameGtin(p.barcode_gtin, p.gtin),
    current_gtin: p.gtin,
  });
});

router.delete('/:sku/barcode', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can change the catalog.' });
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only QA, a supervisor or an admin can retire a flavor code.' });
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
// ── The spec sheet's completeness (D-128, server/product-completeness.js) ────
// Named gaps per SKU and a roll-up by line — never a score. DECLARED BEFORE
// `/:sku`, or Express reads "completeness" as a product code.
// ── Fill-down and the CSV import (D-131) ─────────────────────────────────────
//
// Both go through `buildPatch` + `applyPatch`, the same pair the PUT uses, so
// a value the drawer refuses is a value the grid and the file refuse. Neither
// writes anything a person did not see first: the fill-down is one value the
// person typed applied to the rows they selected, and the import shows its
// diff before anything is committed.

/** The fields a fill-down may set. Never an identifier — filling a GTIN or a seller SKU down ten rows is ten collisions. */
// A function, not a constant: WRITABLE is declared further down the file and
// a top-level read here is a temporal-dead-zone error at boot.
const bulkFields = () => WRITABLE.filter((c) => !['gtin', 'legacy_sku', 'shopify_sku', 'shopify_variant_id', 'amazon_sku', 'amazon_asin'].includes(c));

router.post('/bulk-edit', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const { field, value } = req.body || {};
  const skus = [...new Set((Array.isArray(req.body?.skus) ? req.body.skus : []).map((x) => String(x)))];
  if (!skus.length) return res.status(400).json({ error: 'Name the SKUs to fill.' });
  if (!bulkFields().includes(field)) {
    return res.status(400).json({ error: `${field || 'That field'} cannot be filled down. It can be: ${bulkFields().join(', ')}.` });
  }
  const rows = skus.map((sku) => db.prepare('SELECT * FROM products WHERE sku = ?').get(sku));
  const missing = skus.filter((_, i) => !rows[i]);
  if (missing.length) return res.status(404).json({ error: `No such SKU: ${missing.join(', ')}` });
  // Validated per row (an NA cleared on one, an Amazon confirmation dropped on
  // another) but refused as a whole: a fill-down that lands on six rows and
  // not the seventh is a screen that lies about what it did.
  const plans = [];
  for (const existing of rows) {
    const built = buildPatch(db, existing, { [field]: value ?? '' });
    if (built.error) return res.status(built.status).json({ error: `${existing.sku}: ${built.error}`, field: built.field, expected: built.expected });
    plans.push([existing, built.patch]);
  }
  db.transaction(() => {
    for (const [existing, patch] of plans) if (Object.keys(patch).length) applyPatch(db, existing, patch, req.user, { fill_down: true });
  })();
  logAudit(req.user, 'product_bulk_edit', 'product', field, { field, value: value ?? null, skus }, null, null, `${field} on ${skus.length} SKUs`);
  res.json({ updated: plans.filter(([, patch]) => Object.keys(patch).length).length, skus, field });
});

/**
 * The columns a CSV may carry. The key is the products column; the aliases
 * are what a header may say — the grid's own labels, and master.csv's names,
 * so the feed a person exported and edited in a spreadsheet imports straight
 * back. `pms` / `hex` are the colour slots, pipe-delimited as the feed writes
 * them.
 */
const IMPORT_COLUMNS = [
  ['gtin', ['gtin', 'upc']],
  ['flavor', ['flavor', 'flavour', 'product', 'product name']],
  ['base_flavor', ['base_flavor', 'base flavour', 'base flavor', 'flavour']],
  ['category', ['category', 'line']],
  ['pack', ['pack', 'packaging type', 'pack format']],
  ['pack_count', ['pack_count', 'pack count']],
  ['protein_type', ['protein_type', 'protein']],
  ['status', ['status']],
  ['spec_id', ['spec_id', 'spec', 'packaging spec']],
  ['eyemark_color', ['eyemark_color', 'eye mark color', 'eyemark colour', 'eye mark']],
  ['dieline_required', ['dieline_required', 'die line required', 'dieline']],
  ['mrp_formula_id', ['mrp_formula_id', 'formula_ref', 'formula ref']],
  ['formula_rev', ['formula_rev', 'formula_version', 'formula version']],
  ['fill_weight_g', ['fill_weight_g', 'fill weight (g)', 'fill weight']],
  ['shopify_sku', ['shopify_sku', 'shopify sku']],
  ['amazon_channel', ['amazon_channel', 'amazon channel']],
  ['amazon_sku', ['amazon_sku', 'amazon sku']],
  ['amazon_asin', ['amazon_asin', 'asin']],
  ['drive_url', ['drive_url', 'drive link', 'drive']],
  ['notes', ['notes']],
  ['pms', ['pms', 'pms spot colors', 'pms spot colours']],
  ['hex', ['hex', 'hex spot colors', 'hex spot colours']],
];
/**
 * THE PACKAGING SPEC'S COLUMNS ARE RECOGNISED AND NOT WRITTEN (D-133).
 *
 * `eye mark color` is a products column and imports as a value; `wind
 * direction`, `trim length`, `trim width`, `print`, `material`, `zipper`, the
 * gusset and the front panel are `packaging_specs` columns reached through
 * `products.spec_id` — the same row for every product on that spec. Writing
 * one per product would either rewrite the spec for all of them from one
 * row of a CSV or need a product-level copy, which is a second owner of a
 * film fact. So a file carrying them is not "ignored": the preview names the
 * spec each value comes from and reports a cell that DIFFERS from it as a
 * mismatch to take to the spec. Nothing on these columns is ever written.
 */
const DERIVED_IMPORT_COLUMNS = [
  ['material_structure', ['material', 'material_structure', 'material structure']],
  ['zipper', ['zipper']],
  ['print_process', ['print', 'print_process', 'print process']],
  ['trim_length_mm', ['trim length', 'trim_length', 'trim_length_mm', 'trim length (mm)']],
  ['trim_width_mm', ['trim width', 'trim_width', 'trim_width_mm', 'trim width (mm)']],
  ['gusset_mm', ['gusset dimension', 'gusset', 'gusset_mm', 'gusset (mm)']],
  ['front_panel_mm', ['front panel dimension', 'front panel', 'front_panel_mm', 'front panel (mm)']],
  ['wind_direction', ['wind direction', 'wind_direction']],
];
const DERIVED_SOURCE = Object.fromEntries(PACKAGING_DERIVED.map(([k, label, source]) => [k, { label, source }]));
const derivedColumnFor = (header) => {
  const h = String(header || '').trim().toLowerCase();
  for (const [column, aliases] of DERIVED_IMPORT_COLUMNS) if (aliases.includes(h)) return column;
  return null;
};
const importFieldFor = (header) => {
  const h = String(header || '').trim().toLowerCase();
  if (h === 'sku') return 'sku';
  for (const [field, aliases] of IMPORT_COLUMNS) if (aliases.includes(h)) return field;
  return null;
};
const yesNo = (v) => (/^(?:1|yes|y|true)$/i.test(v) ? 1 : /^(?:0|no|n|false)$/i.test(v) ? 0 : null);
const joinSlots = (colors, k) => colors.filter((c) => c[k]).map((c) => c[k]).join(' | ');
const splitSlots = (v) => String(v || '').split('|').map((x) => x.trim()).filter(Boolean);

/**
 * The import plan: per SKU, each field that would change, from → to, and any
 * cell the field rules refuse. Writes nothing. Preview and commit both call it,
 * so what is on the screen is what lands.
 */
function planImport(db, csvText) {
  const grid = parseDelimited(String(csvText || '')).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!grid.length) return { error: 'The file is empty.' };
  const headers = grid[0].map((h) => String(h ?? '').trim());
  const fields = headers.map(importFieldFor);
  const skuCol = fields.indexOf('sku');
  if (skuCol < 0) return { error: 'The file needs a "sku" column — every row is matched on it.' };
  const derived = headers.map((h, i) => (fields[i] === null ? derivedColumnFor(h) : null));
  const unknown_columns = headers.filter((_, i) => fields[i] === null && derived[i] === null && headers[i] !== '');
  // The spec columns the file carries, each with where its value really lives.
  const derived_columns = headers.map((h, i) => (derived[i] ? { header: h, column: derived[i], label: DERIVED_SOURCE[derived[i]]?.label, source: DERIVED_SOURCE[derived[i]]?.source } : null)).filter(Boolean);

  const rows = []; const unknown_skus = []; const seen = new Set(); const mismatches = [];
  for (const r of grid.slice(1)) {
    const sku = String(r[skuCol] ?? '').trim().toUpperCase();
    if (!sku) continue;
    if (seen.has(sku)) { rows.push({ sku, error: 'This SKU appears twice in the file.', changes: [] }); continue; }
    seen.add(sku);
    const existing = db.prepare(`${SELECT} WHERE p.sku = ?`).get(sku);
    if (!existing) { unknown_skus.push(sku); continue; }
    const colors = db.prepare('SELECT * FROM product_colors WHERE sku = ? ORDER BY slot').all(sku);
    const body = {}; const changes = []; let colorPlan = null;
    const wantPms = { set: false, v: null }; const wantHex = { set: false, v: null };
    // A spec column in the file: compared with the spec the product is on,
    // reported when it differs, never written. Compared as trimmed text; a
    // blank cell is not a claim about anything.
    derived.forEach((column, i) => {
      if (!column) return;
      const to = String(r[i] ?? '').trim();
      if (to === '') return;
      const from = existing[column] === null || existing[column] === undefined ? '' : String(existing[column]).trim();
      if (from === to) return;
      mismatches.push({ sku, column, header: headers[i], label: DERIVED_SOURCE[column]?.label || column, spec_id: existing.spec_id || null, source: DERIVED_SOURCE[column]?.source || null, spec_value: from, file_value: to });
    });
    fields.forEach((field, i) => {
      if (!field || field === 'sku') return;
      const to = String(r[i] ?? '').trim();
      if (field === 'pms') { wantPms.set = true; wantPms.v = to; return; }
      if (field === 'hex') { wantHex.set = true; wantHex.v = to; return; }
      let from = existing[field];
      let toValue = to;
      if (field === 'dieline_required') {
        from = existing[field] ? 'yes' : 'no';
        if (to !== '') { const yn = yesNo(to); if (yn === null) { changes.push({ field, from, to, error: 'Die line required is yes or no.' }); return; } toValue = yn; }
        if (to === '' || String(from) === (yesNo(to) ? 'yes' : 'no')) return;
        body[field] = toValue; changes.push({ field, from, to }); return;
      }
      const fromStr = from === null || from === undefined ? '' : String(from);
      if (fromStr === to) return;
      // A field rule normalises before it compares (F-00002 typed in lower case is the same value).
      const v = validateField(field, to);
      if (!v.ok) { changes.push({ field, from: fromStr, to, error: v.error }); return; }
      if (String(v.value ?? '') === fromStr) return;
      body[field] = to; changes.push({ field, from: fromStr, to: v.value === null ? '' : String(v.value) });
    });
    if (wantPms.set || wantHex.set) {
      const pmsList = wantPms.set ? splitSlots(wantPms.v) : colors.map((c) => c.pms);
      const hexList = wantHex.set ? splitSlots(wantHex.v) : colors.map((c) => c.hex);
      const n = Math.max(pmsList.length, hexList.length);
      const slots = Array.from({ length: n }, (_, i) => ({ pms: pmsList[i] || null, hex: hexList[i] || null }));
      const plan = planColors(db, existing, slots);
      if (plan.error) {
        changes.push({ field: 'colors', from: `${joinSlots(colors, 'pms')} / ${joinSlots(colors, 'hex')}`, to: `${pmsList.join(' | ')} / ${hexList.join(' | ')}`, error: plan.error });
      } else if (plan.changed) {
        colorPlan = slots;
        if (wantPms.set && joinSlots(colors, 'pms') !== joinSlots(plan.afterShape, 'pms')) changes.push({ field: 'pms', from: joinSlots(colors, 'pms'), to: joinSlots(plan.afterShape, 'pms') });
        if (wantHex.set && joinSlots(colors, 'hex') !== joinSlots(plan.afterShape, 'hex')) changes.push({ field: 'hex', from: joinSlots(colors, 'hex'), to: joinSlots(plan.afterShape, 'hex') });
      }
    }
    let patch = {};
    if (Object.keys(body).length) {
      const built = buildPatch(db, existing, body);
      if (built.error) changes.push({ field: built.field || 'row', from: '', to: '', error: built.error });
      else patch = built.patch;
    }
    if (!changes.length) continue;
    rows.push({ sku, product: existing.flavor, changes, errors: changes.filter((c) => c.error).length, _existing: existing, _patch: patch, _colors: colorPlan });
  }
  const counts = {
    rows_in_file: grid.length - 1,
    skus_changing: rows.filter((r) => !r.error && r.changes.some((c) => !c.error)).length,
    changes: rows.reduce((n, r) => n + r.changes.filter((c) => !c.error).length, 0),
    errors: rows.reduce((n, r) => n + (r.error ? 1 : 0) + r.changes.filter((c) => c.error).length, 0),
    unknown_skus: unknown_skus.length,
    derived_columns: derived_columns.length,
    spec_mismatches: mismatches.length,
  };
  return { rows, unknown_skus, unknown_columns, derived_columns, spec_mismatches: mismatches, counts, headers };
}
const publicPlan = (plan) => ({ ...plan, rows: plan.rows.map(({ _existing, _patch, _colors, ...r }) => r) });

router.post('/import/preview', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const plan = planImport(getDb(), req.body?.csv);
  if (plan.error) return res.status(400).json({ error: plan.error });
  res.json(publicPlan(plan));
});

/**
 * COMMIT REFUSES THE WHOLE FILE WHILE ANY CELL IS INVALID. Reject on save, not
 * warn: a file that lands on 90 rows and skips 4 is a file somebody believes
 * went in. The preview names every refused cell, so the fix is in the file.
 */
router.post('/import/commit', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const plan = planImport(db, req.body?.csv);
  if (plan.error) return res.status(400).json({ error: plan.error });
  if (plan.counts.errors) {
    return res.status(400).json({ error: `${plan.counts.errors} cell${plan.counts.errors === 1 ? '' : 's'} refused — fix the file and preview again. Nothing was written.`, ...publicPlan(plan) });
  }
  let applied = 0;
  db.transaction(() => {
    for (const r of plan.rows) {
      if (r.error) continue;
      if (Object.keys(r._patch).length) applyPatch(db, r._existing, r._patch, req.user, { import: true });
      if (r._colors) {
        const w = writeColors(db, db.prepare('SELECT * FROM products WHERE sku = ?').get(r.sku), r._colors, req.user);
        if (w.error) throw new Error(`${r.sku}: ${w.error}`);
      }
      applied++;
    }
  })();
  logAudit(req.user, 'product_import', 'product', 'csv', { skus: applied, changes: plan.counts.changes, unknown_skus: plan.unknown_skus }, null, null, `${applied} SKUs from a CSV`);
  res.json({ applied, ...publicPlan(plan) });
});

router.get('/completeness', (_req, res) => {
  res.json(catalogueCompleteness(getDb()));
});

/**
 * Mark a SKU blocked: it cannot be completed yet for a reason somebody owns —
 * "formula not final — Danny". Blocked is its own state, not "incomplete": the
 * SKU stays listed with every gap, and leaves the incomplete count.
 */
/**
 * RECORD A PACKAGING PO against the current released artwork (D-134, stage 9).
 * The server decides which artwork — the one print-ready now — so a PO can
 * never be filed against film that has since been replaced. Never refused for
 * being "out of order": with no released artwork it is still recorded, and the
 * stage says there is nothing for it to count against.
 */
router.post('/:sku/packaging-po', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const p = db.prepare('SELECT sku FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'No such SKU' });
  const po = String(req.body?.po_number || '').trim().slice(0, 60);
  if (!po) return res.status(400).json({ error: 'The PO number is what this records.' });
  const placed = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.placed_on || '')) ? req.body.placed_on : null;
  const art = stageInputs(db).artwork.get(p.sku) || null;
  const id = uuid();
  db.prepare(`INSERT INTO packaging_po_records (id, sku, artwork_version_id, po_number, vendor, placed_on, note, recorded_by, recorded_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.sku, art?.id || null, po, String(req.body?.vendor || '').trim().slice(0, 120) || null,
    placed, String(req.body?.note || '').trim().slice(0, 500) || null, req.user?.name || null, req.user?.id || null);
  logAudit(req.user, 'packaging_po_recorded', 'product', p.sku, { po_number: po, artwork_version_id: art?.id || null, artwork_version: art?.version ?? null }, null, null, p.sku);
  const row = db.prepare(`${SELECT} WHERE p.sku = ?`).get(p.sku);
  const [product] = hydrate([row], db);
  res.status(201).json({ id, artwork_version: art?.version ?? null, against_artwork: !!art, stage: product.stage });
});

router.post('/:sku/completeness-block', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the spec sheet.' });
  const db = getDb();
  const p = db.prepare('SELECT sku FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'No such SKU' });
  const reason = String(req.body?.reason || '').trim();
  const owner = String(req.body?.owner || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it cannot be completed yet.' });
  if (owner.length < 2) return res.status(400).json({ error: 'Name who owns unblocking it.' });
  const before = db.prepare('SELECT * FROM product_completeness_blocks WHERE sku = ?').get(p.sku) || null;
  db.prepare(`INSERT INTO product_completeness_blocks (sku, reason, owner, blocked_by, blocked_by_id, blocked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(sku) DO UPDATE SET reason = excluded.reason, owner = excluded.owner,
      blocked_by = excluded.blocked_by, blocked_by_id = excluded.blocked_by_id, blocked_at = excluded.blocked_at`)
    .run(p.sku, reason.slice(0, 500), owner.slice(0, 120), req.user.name, req.user.id || null);
  logAudit(req.user, 'product_completeness_blocked', 'product', p.sku, { reason, owner }, before,
    db.prepare('SELECT * FROM product_completeness_blocks WHERE sku = ?').get(p.sku), p.sku);
  res.json({ ok: true });
});

router.delete('/:sku/completeness-block', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the spec sheet.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM product_completeness_blocks WHERE sku = ?').get(req.params.sku);
  if (!before) return res.status(404).json({ error: 'That SKU is not blocked.' });
  db.prepare('DELETE FROM product_completeness_blocks WHERE sku = ?').run(req.params.sku);
  logAudit(req.user, 'product_completeness_unblocked', 'product', req.params.sku, null, before, null, req.params.sku);
  res.json({ ok: true });
});

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
  // `severity` is 'warn' unless a caller says otherwise. Everything on this
  // list is something to go and do; only `color_conflict` has a state where
  // the answer is already known, so it is the only caller that passes one.
  const add = (kind, sku, detail, severity = 'warn') =>
    issues.push({ kind, sku, detail, severity });

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

    // "NA" TYPED INTO A BOX is a value, and it would reach the proofer's feed
    // as an eye mark colour called NA. Not applicable is a control with a name
    // on it (POST /:sku/na); reported here, never converted — "NA" might be
    // somebody's initials in a notes field, so a person moves it.
    for (const c of NA_FIELDS) {
      if (looksLikeTypedNa(p[c])) add('typed_na', p.sku, `"${p[c]}" is typed into ${c} — mark the field not applicable instead`);
    }

    const cs = bySku.get(p.sku) || [];
    if (!cs.length) add('no_colors', p.sku, 'No brand colors recorded');
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

  /* ── One Pantone, two colours ──────────────────────────────────────────────
   *
   * The same Pantone code carrying a materially different hex on two rows is
   * INTERNAL evidence that one of them was transcribed wrongly — it needs no
   * Pantone book, only the catalogue disagreeing with itself. This is the
   * check that would have caught the pancake Pumpkin Spice row, where PMS 285
   * (a blue) sat beside a burnt-orange hex while the same code on two Cookie
   * Crumble rows was correctly blue.
   *
   * REPORTED, NEVER CORRECTED. Which side is wrong is a question about what is
   * printed on a pack, and nothing here can see that — the two Pumpkin Spice
   * rows were only resolvable because a person held the artwork. A punch-list
   * entry is the honest output; an automatic fix would be a guess written into
   * the master feed.
   *
   * THREE BANDS, NOT TWO, and both numbers are the plant's rather than the
   * code's — the standing the ATP limit and the scale tolerances have.
   *
   *   under 16   SILENT. Set from the proofing service's own: it matches a
   *              rendered colour to plus or minus 6 because a raster is an
   *              approximation of the vector ink, and two transcriptions of
   *              one Pantone sampled off two artwork files land a few units
   *              apart every time. There are 255 such pairs in the catalogue
   *              today; reporting them is the wallpaper that gets a punch list
   *              ignored.
   *   16 to 25   INFO. Far enough apart to be worth saying out loud, close
   *              enough that it is plainly one ink. `INFO_TOLERANCE`.
   *   over 25    WARN — unless a person has checked that exact pair against
   *              the artwork and recorded it in `COLOR_PAIR_DECISIONS`, which
   *              also reads as info. A decision NEVER hides the row: a
   *              disagreement somebody has explained is a different fact from
   *              one nobody has looked at, and the reason travels with it.
   *
   * The two named in that table today are a good illustration of why the
   * tolerance alone cannot do this job. PMS 123 C differs by 17 and drops on
   * the number; PMS 375 C differs by 36 and would still have been shouting,
   * because the whole gap is in the BLUE channel of a saturated green — a
   * max-per-channel overstates a difference nobody can see on a pack. Only a
   * person holding the artwork could say so, and now it is written down.
   */
  const REPORT_FLOOR = 16;
  const byPms = new Map();
  for (const c of colors) {
    if (!pmsValid(c.pms)) continue;
    if (!hexValid(c.hex)) continue;
    if (!byPms.has(c.pms)) byPms.set(c.pms, []);
    byPms.get(c.pms).push(c);
  }
  for (const [pms, list] of byPms) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const verdict = conflictSeverity(pms, list[i].hex, list[j].hex);
        if (verdict.delta === null || verdict.delta <= REPORT_FLOOR) continue;
        const note = verdict.decision
          ? ` Checked against the artwork by ${verdict.decision.decided_by} on `
            + `${verdict.decision.decided_at}: ${verdict.decision.reason}`
          : verdict.severity === 'info'
            ? ' Close enough to be one ink; worth an eye, not a correction.'
            : ' One of the two was transcribed wrongly — check both against the artwork.';
        // Named on BOTH rows: whoever opens the punch list has to be able to
        // reach either one, and neither is more suspect than the other.
        for (const [a, b] of [[list[i], list[j]], [list[j], list[i]]]) {
          add('color_conflict', a.sku,
            `Slot ${a.slot}: ${pms} is ${a.hex} here and ${b.hex} on ${b.sku} slot ${b.slot}.${note}`,
            verdict.severity);
        }
      }
    }
  }

  const KINDS = ['no_spec', 'bad_color', 'color_conflict', 'no_colors', 'not_a_sku', 'gtin', 'typed_na'];
  // WORK AND NOTES ARE COUNTED SEPARATELY. `counts` is what somebody has to go
  // and do; `noted` is what has already been answered and is on the list so
  // that the answer is visible, not so that it can be actioned. Both are the
  // size of a set taken straight off `issues` — the `activity-metrics` rule —
  // so a card can never disagree with the list under it, and a SKU carrying
  // both kinds legitimately appears in both figures.
  const skusOf = (k, sev) =>
    new Set(issues.filter(i => i.kind === k && i.severity === sev).map(i => i.sku)).size;
  const counts = Object.fromEntries(KINDS.map(k => [k, skusOf(k, 'warn')]));
  const noted = Object.fromEntries(KINDS.map(k => [k, skusOf(k, 'info')]));

  // WHICH PRODUCTS ARE ON AMAZON AT ALL is a decision, not a defect, so it is
  // counted here rather than shown as an outstanding readiness step on every
  // product. Active rows only — a discontinued SKU owes no channel decision.
  const live = products.filter((p) => p.status !== 'discontinued');
  const amazon = {
    listed: live.filter((p) => p.amazon_channel === 'listed').length,
    not_sold: live.filter((p) => p.amazon_channel === 'not_sold').length,
    // The honest state of the catalogue until somebody goes through it.
    undecided: live.filter((p) => !p.amazon_channel).length,
    // Listed, and the listing has not been confirmed since the SKU last moved.
    unconfirmed: live.filter((p) => p.amazon_channel === 'listed'
      && !(readinessOf(p).steps.find((x) => x.key === 'amazon') || {}).done).length,
  };

  res.json({
    products: products.length,
    flavors: names.length,
    counts,
    noted,
    amazon,
    // SKUs affected, not issues raised — one SKU with three bad colour slots is
    // one product to go and fix, and reporting three overstates the work. An
    // `info` row is not work and is deliberately not in this number.
    affected: new Set(issues.filter(i => i.severity !== 'info').map(i => i.sku)).size,
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
  // What the date on the pack rests on, and which date it may therefore be
  // (D-133). Derived from the justification in force for the SKU on every
  // read; never a product column.
  const shelf = shelfLifeFor(db, row.sku);
  product.shelf_life = { ...shelf, basis_label: shelf.basis_kind ? BASIS_KIND_LABEL[shelf.basis_kind] : null, date_type_label: DATE_TYPE_LABEL[shelf.date_type] };
  product.packaging_pos = db.prepare(`SELECT r.*, a.version AS artwork_version FROM packaging_po_records r
    LEFT JOIN artwork_versions a ON a.id = r.artwork_version_id WHERE r.sku = ? ORDER BY r.recorded_at DESC LIMIT 50`).all(row.sku);
  res.json(product);
});

const WRITABLE = [
  'legacy_sku', 'gtin', 'category', 'protein_type', 'pack', 'pack_count', 'flavor',
  'base_flavor', 'flavor_code', 'status', 'spec_id', 'eyemark_color', 'dieline_required',
  'shopify_sku', 'shopify_variant_id', 'mrp_formula_id', 'formula_rev',
  // Amazon: the channel decision and the two identifiers a listing hangs off.
  // `amazon_listed_at` is NOT here — it is a confirmation, owned by
  // POST /confirm/amazon, the same doctrine that keeps `nfp_version` off the
  // ordinary edit form.
  'amazon_channel', 'amazon_sku', 'amazon_asin',
  'drive_url', 'notes', 'fill_weight_g',
];

/**
 * `artwork_status` and `artwork_version` are NOT in WRITABLE either (D-131).
 *
 * They were a dropdown on the edit form, and the readiness step "Artwork
 * print-ready" read the dropdown — so the print gate opened by picking
 * "print ready" from a list, with no artwork version behind it. They are a
 * MIRROR now, written by the release in api/artwork.js in the same transaction
 * as the artwork_versions row, and by nothing else; the readiness line says
 * which version and when. Refused loudly, the NFP_OWNED rule.
 */
const ARTWORK_OWNED = ['artwork_status', 'artwork_version'];

/**
 * Turn a request body into the patch a write path applies — ONE reader of
 * the field rules for the PUT, the fill-down and the CSV import, so a value
 * the grid refuses is a value the import refuses.
 *
 * Returns `{ patch }` or `{ status, error }`. Nothing is written here.
 */
function buildPatch(db, existing, b) {
  if (NFP_OWNED.some((c) => b[c] !== undefined)) {
    return { status: 400, code: 'NFP_OWNED', error: 'The NFP version and its approval date are set by approving a panel, not by typing them. Open the product\'s NFP panels.' };
  }
  if (ARTWORK_OWNED.some((c) => b[c] !== undefined)) {
    return { status: 400, code: 'ARTWORK_OWNED', error: 'Artwork status and version are set by releasing a version on the Artwork board, not by typing them.' };
  }
  const patch = {};
  for (const c of WRITABLE) if (b[c] !== undefined) patch[c] = b[c] === '' ? null : b[c];

  // VALIDATED AT THE FIELD, REFUSED ON SAVE (shared/product-fields.js). The
  // refusal names the expected format, so "Yes" in the formula ref comes back
  // as "F- followed by five digits" rather than as a saved lie.
  for (const c of Object.keys(patch)) {
    if (!FIELD_RULES[c] || patch[c] === null) continue;
    const v = validateField(c, patch[c]);
    if (!v.ok) return { status: 400, code: 'FIELD_FORMAT', field: c, error: v.error, expected: v.expected };
    patch[c] = v.value;
  }
  // A pointer to a spec that does not exist is refused by name, not by the
  // foreign key's bare 500. Specs are opened on Packaging specs (D-135).
  if (patch.spec_id != null && !db.prepare('SELECT 1 FROM packaging_specs WHERE spec_id = ?').get(patch.spec_id)) {
    return { status: 400, field: 'spec_id', error: `No packaging spec ${patch.spec_id} — open it under Products → Packaging specs first.` };
  }
  if (patch.gtin !== undefined) {
    patch.gtin_valid = gtinValid(patch.gtin) ? 1 : 0;
    const clash = patch.gtin && db.prepare('SELECT sku FROM products WHERE gtin = ? AND sku != ?').get(patch.gtin, existing.sku);
    if (clash) return { status: 409, error: `${patch.gtin} is already on ${clash.sku}.` };
  }
  // Three states and no fourth. A value the readiness step cannot read would
  // silently take the product off Amazon's punch list.
  if (patch.amazon_channel != null && !AMAZON_CHANNELS.includes(patch.amazon_channel)) {
    return { status: 400, error: `Amazon channel is ${AMAZON_CHANNELS.join(' or ')}, or blank for "nobody has said yet".` };
  }
  // Moving a product OFF Amazon drops the confirmation with it — a stamped
  // listing date on a product marked not sold is a record of something that is
  // no longer true, and it would come straight back if it were ever relisted.
  if (patch.amazon_channel === 'not_sold' && existing.amazon_listed_at) {
    patch.amazon_listed_at = null; patch.amazon_listed_by = null;
  }
  // A VALUE WRITTEN INTO A FIELD CLEARS ITS "NOT APPLICABLE". The two cannot
  // both be true, and the value is the later statement.
  const na = naOf(existing);
  const cleared = Object.keys(patch).filter((c) => na[c] && patch[c] !== null);
  if (cleared.length) {
    for (const c of cleared) delete na[c];
    patch.na_fields = Object.keys(na).length ? JSON.stringify(na) : null;
  }
  return { patch };
}

/** Apply a patch built by `buildPatch`: one UPDATE, the readiness stamp, one audit entry. */
function applyPatch(db, existing, patch, user, detail = {}) {
  const cols = Object.keys(patch);
  if (!cols.length) return existing;
  const sets = cols.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE sku = ?`)
    .run(...cols.map((c) => patch[c]), existing.sku);
  // What each satisfied step is now true against. Editing the GTIN here is
  // exactly the case this exists for: the step's own basis moves, and every
  // step that DEPENDED on the GTIN — the artwork, the Shopify listing — keeps
  // the old one and comes back onto the punch list saying so.
  stampReadiness(db, existing.sku, existing, cols, user?.name);
  logAudit(user, 'product_updated', 'product', existing.sku, { changed: cols, ...detail }, null, null, existing.sku);
  return db.prepare('SELECT * FROM products WHERE sku = ?').get(existing.sku);
}

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
  amazon: { at: 'amazon_listed_at', by: 'amazon_listed_by', label: 'Listed on Amazon' },
};

/** NULL (nobody has said) | 'listed' | 'not_sold'. Anything else is refused. */
const AMAZON_CHANNELS = ['listed', 'not_sold'];

router.post('/:sku/confirm/:step', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const c = CONFIRMATIONS[req.params.step];
  if (!c || !TICKABLE.includes(req.params.step)) {
    return res.status(400).json({ error: `${req.params.step} is not something a person confirms here.` });
  }
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });

  // Confirming a listing on a product nobody has said is on Amazon would put a
  // date against a channel that may not exist. Say which it is first.
  if (req.params.step === 'amazon' && existing.amazon_channel !== 'listed') {
    return res.status(400).json({
      error: existing.amazon_channel === 'not_sold'
        ? 'This product is marked as not sold on Amazon.'
        : 'Say whether this product is sold on Amazon before confirming its listing.',
    });
  }

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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const b = req.body || {};
  const skuCheck = validateField('sku', b.sku);
  const sku = skuCheck.ok ? skuCheck.value : null;
  if (!sku || !b.flavor?.trim() || !b.category?.trim() || !b.pack?.trim()) {
    return res.status(400).json({ error: skuCheck.ok ? 'SKU, flavor, category and pack are required.' : skuCheck.error, expected: skuCheck.expected });
  }
  // The same rules the edit path applies, from the first write (D-131).
  for (const c of ['mrp_formula_id', 'formula_rev', 'fill_weight_g']) {
    if (b[c] === undefined || b[c] === null || b[c] === '') continue;
    const v = validateField(c, b[c]);
    if (!v.ok) return res.status(400).json({ error: v.error, field: c, expected: v.expected });
    b[c] = v.value;
  }
  const db = getDb();
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) {
    return res.status(409).json({ error: `${sku} already exists.` });
  }
  const gtin = storedGtin(b.gtin);
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
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });
  const built = buildPatch(db, existing, req.body || {});
  if (built.error) return res.status(built.status).json({ error: built.error, code: built.code, field: built.field, expected: built.expected });
  if (!Object.keys(built.patch).length) return res.json(existing);
  applyPatch(db, existing, built.patch, req.user);
  res.json(hydrate([db.prepare(`${SELECT} WHERE p.sku = ?`).get(existing.sku)], db)[0]);
});

/**
 * Not applicable, as a decision with a name on it.
 *
 * `POST /:sku/na { field, on }`. On: the field's value is cleared and the NA
 * recorded with who and when; off: the NA is removed and the field is EMPTY
 * again, never restored to what it held. Only the fields in `NA_FIELDS` — the
 * identity fields, the formula and the fill weight are owed by every product,
 * and an NA on one of those would be a gap wearing a tick.
 */
router.post('/:sku/na', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });
  const field = String(req.body?.field || '');
  if (!NA_FIELDS.includes(field)) {
    return res.status(400).json({ error: `${field || 'That field'} cannot be marked not applicable. It can be: ${NA_FIELDS.join(', ')}.`, na_fields: NA_FIELDS });
  }
  const on = req.body?.on !== false;
  const na = naOf(existing);
  const patch = {};
  if (on) {
    na[field] = { by: req.user?.name || null, at: new Date().toISOString() };
    if (existing[field] !== null && existing[field] !== undefined) patch[field] = null;
  } else {
    delete na[field];
  }
  patch.na_fields = Object.keys(na).length ? JSON.stringify(na) : null;
  applyPatch(db, existing, patch, req.user, { na: { field, on } });
  res.json(hydrate([db.prepare(`${SELECT} WHERE p.sku = ?`).get(existing.sku)], db)[0]);
});

/**
 * Write the whole colour list for one product. Shared by the drawer's editor,
 * the grid's pms/hex cells and the CSV import, so one rule decides.
 *
 * TWO RULES, and which one applies depends on whether the slot CHANGED. A slot
 * the caller sends back exactly as stored is accepted as it stands — the audit
 * transcribed `PMS Black C` and `PMS 4625`, and a person correcting slot 3 must
 * not be refused over slot 1. A slot whose value MOVED takes the strict shape
 * (`PMS 158 C`, `HEX EE7623`; shared/product-fields.js), because that is the
 * one moment a shape is being chosen. `colorIssues` (D-108) still runs on every
 * slot, so the placeholder and process-build refusals stand.
 *
 * Returns `{ product }` (re-read and hydrated) or `{ status, error, problems }`.
 */
function planColors(db, product, colors) {
  if (!Array.isArray(colors)) return { status: 400, error: 'Send the whole color list.' };
  // A row with neither value typed into it is an empty line on the form, not
  // a colour somebody meant to record as blank.
  const wanted = colors
    .filter((c) => !isBlankSlot(c))
    .map((c) => ({ pms: String(c.pms ?? '').trim() || null, hex: String(c.hex ?? '').trim() || null }));

  const before = db.prepare('SELECT * FROM product_colors WHERE sku = ? ORDER BY slot').all(product.sku);
  const beforeShape = before.map((c) => ({ slot: c.slot, pms: c.pms, hex: c.hex }));

  // REFUSED, NEVER STORED AND FLAGGED. A value the proofing service cannot
  // match a separation against is worse on the feed than an empty cell — the
  // check would report a name mismatch against a name nobody printed. Named
  // per slot, or the person has to work out which of four boxes it meant.
  const problems = [];
  wanted.forEach((c, i) => {
    for (const msg of colorIssues(c)) problems.push(`Color ${i + 1}: ${msg}`);
    const was = beforeShape[i] || {};
    for (const k of ['pms', 'hex']) {
      if (c[k] === null || c[k] === (was[k] ?? null)) continue;
      const v = validateField(k, c[k]);
      if (!v.ok) problems.push(`Color ${i + 1}: ${v.error}`);
      else c[k] = v.value;
    }
  });
  if (problems.length) return { status: 400, error: problems.join(' '), problems };

  const afterShape = wanted.map((c, i) => ({ slot: i + 1, ...c }));
  return { before, beforeShape, afterShape, changed: JSON.stringify(beforeShape) !== JSON.stringify(afterShape) };
}

function writeColors(db, product, colors, user) {
  const plan = planColors(db, product, colors);
  if (plan.error) return plan;
  const { before, beforeShape, afterShape } = plan;
  const read = () => hydrate([db.prepare(`${SELECT} WHERE p.sku = ?`).get(product.sku)], db)[0];
  if (!plan.changed) return { product: read(), unchanged: true };

  db.transaction(() => {
    db.prepare('DELETE FROM product_colors WHERE sku = ?').run(product.sku);
    const ins = db.prepare(`INSERT INTO product_colors (id, sku, slot, pms, hex, pms_valid, hex_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const c of afterShape) {
      // RECOMPUTED, never taken from the caller — the same rule `gtin_valid`
      // follows. These two columns are what the data-health punch list and the
      // swatch on the drawer read, so a client may not declare a value good.
      ins.run(uuid(), product.sku, c.slot, c.pms, c.hex,
        pmsValid(c.pms) ? 1 : 0, hexValid(c.hex) ? 1 : 0);
    }
    db.prepare("UPDATE products SET updated_at = datetime('now') WHERE sku = ?").run(product.sku);
    // The colours step has just been re-done, so its basis moves to what was
    // typed — and ARTWORK, which depends on colours, keeps the old one and
    // comes back onto the punch list saying the brand colours moved. That is
    // the point: a pack released against PMS 285 was released against a
    // different ink from the one now on the record.
    stampReadiness(db, product.sku, { ...product, colors: before }, ['colors'], user?.name);
  })();

  logAudit(user, 'product_colors_updated', 'product', product.sku,
    { slots: afterShape.length }, { colors: beforeShape }, { colors: afterShape }, product.sku);
  return { product: read() };
}

/**
 * Correct the brand colours.
 *
 * WHY THIS IS EDITABLE AT ALL, since almost nothing else on a product is.
 * `product_colors` has exactly ONE writer — `seedProducts()`, which loads
 * `seed-data/sku_colors.csv` and skips entirely once `products` has any row,
 * so it runs once in a database's life and never again. There is no sync, no
 * feed and nothing derived: a value transcribed wrongly in the audit stayed
 * wrong for good, with no door to correct it through. Making it editable
 * cannot be overwritten by anything, because there is nothing left to
 * overwrite it.
 *
 * ITS OWN ROUTE rather than fields on the PUT, for the same reason the panel
 * values and a SKU rename are: the colours go out on `master.csv`, the
 * proofing service matches a PDF's separation NAMES against them, and a wrong
 * Pantone reference is a pack checked against the wrong ink. That should read
 * in the audit log as a deliberate act, not as an edit to a text box.
 *
 * The whole slot list is sent and REPLACES what is there. A redesign that
 * drops a fourth colour is a real edit, and patching slot by slot would leave
 * no way to express it; the before and after both go in the audit entry, so
 * the removal is in the trail.
 */
router.put('/:sku/colors', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!product) return res.status(404).json({ error: 'No such SKU' });
  const r = writeColors(db, product, req.body?.colors, req.user);
  if (r.error) return res.status(r.status).json({ error: r.error, problems: r.problems });
  res.json(r.product);
});

/**
 * Rename a SKU, keeping the old code on the row forever.
 *
 * Separate from PUT on purpose: this rewrites the join key, so it should read
 * as its own deliberate act in the audit log rather than hide inside a field
 * edit. legacy_sku is only ever set here, and never cleared.
 */
router.post('/:sku/rename', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });
  // A rename MINTS a code, so it takes the new standard (shared/product-fields.js).
  // The legacy shapes already on file are never re-tested — they are join keys.
  const typed = String(req.body?.sku || '').trim().toUpperCase();
  if (typed === existing.sku) return res.json(existing);
  // A code another row already holds is refused as TAKEN before its shape is
  // judged — the row is real whatever shape its code is.
  if (typed && db.prepare('SELECT 1 FROM products WHERE sku = ?').get(typed)) {
    return res.status(409).json({ error: `${typed} already exists.` });
  }
  const nextCheck = validateField('sku', typed);
  if (!nextCheck.ok || !nextCheck.value) {
    return res.status(400).json({ error: nextCheck.error || 'A SKU is required.', expected: nextCheck.expected || FIELD_RULES.sku.expected });
  }
  const next = nextCheck.value;
  db.transaction(() => {
    // Foreign keys are enforced app-wide (db.js sets foreign_keys = ON), so
    // renaming the parent leaves the child rows pointing at a SKU that no
    // longer exists for the instant between the statements. defer_foreign_keys
    // moves the check to COMMIT, when both tables agree again. It is scoped to
    // this transaction and resets itself — unlike foreign_keys = OFF, which
    // would be a global switch flipped from inside a request handler.
    db.pragma('defer_foreign_keys = ON');
    db.prepare('UPDATE products SET sku = ?, legacy_sku = COALESCE(legacy_sku, ?), updated_at = datetime(\'now\') WHERE sku = ?')
      .run(next, existing.sku, existing.sku);
    moveSkuChildren(db, existing.sku, next);
    // The SKU is keyed into Shopify and ShipHero; those steps depend on it and
    // must read stale after a rename rather than go on describing the old code.
    stampReadiness(db, next, existing, ['sku'], req.user?.name);
  })();
  logAudit(req.user, 'product_renamed', 'product', next, { from: existing.sku, to: next }, null, null, `${existing.sku} → ${next}`);
  res.json(db.prepare(`${SELECT} WHERE p.sku = ?`).get(next));
});

// ── The Artwork-Proofing feed ────────────────────────────────────────────────

// Public path, guarded by the proofing service's token — checked in
// server/proof-token.js, the one copy of that rule (D-126). Read-only and it
// exposes nothing a printer would not already hold. Unset token = endpoint off.

const PACK_LABEL = {
  PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick pack', BOX: 'Carton', CUP: 'Cup',
};

// These sixteen header names are the contract with Artwork-Proofing's
// _fetch_sheet_rows(). Do not rename them to match our column names.
// WHERE EACH COLUMN POPULATES FROM is written beside its name in
// `MASTER_CSV_SOURCES` (shared/product-fields.js) — the one place that answers
// "which table does the proofer's 'material' come from" — and the header list
// is its keys, in order, so the two cannot drift. The seventeenth column,
// `fill weight (g)`, is an extra the proofer's Net Weight check reads; extra
// columns are free, the sixteen are not.
const CSV_HEADERS = MASTER_CSV_SOURCES.map(([name]) => name);

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function masterCsv(req, res) {
  const auth = checkProofToken(req);
  if (!auth.ok) return refuseProofToken(res, auth, { text: true });
  const db = getDb();
  const rows = hydrate(db.prepare(`${SELECT} WHERE p.status != 'discontinued' ORDER BY p.sku`).all(), db);
  // The date type per SKU, one walk (D-133). "best by" is also the answer for
  // a SKU with no basis recorded — the rule's own answer for no data.
  const shelf = shelfLifeBasis(db);

  const lines = [CSV_HEADERS.join(',')];
  for (const p of rows) {
    const pms = p.colors.filter((c) => c.pms).map((c) => c.pms).join(' | ');
    const hex = p.colors.filter((c) => c.hex).map((c) => c.hex).join(' | ');
    lines.push([
      // The feed is a CONTRACT and the proofer expects the UPC-A that is
      // printed on the pack, so the number leaves here in one spelling
      // whatever is on the row. Normalising at the write path makes this a
      // no-op today; it is here so a row written by any future door cannot
      // quietly ship 14 digits to a tool that reads 12.
      p.sku, normalizeGtin(p.gtin), p.flavor, PACK_LABEL[p.pack] || p.pack,
      p.material_structure, p.zipper, p.print_process,
      p.trim_length_mm, p.trim_width_mm, p.gusset_mm, p.front_panel_mm,
      p.wind_direction, pms, hex, p.eyemark_color,
      p.dieline_required ? 'yes' : 'no',
      p.fill_weight_g ?? '',
      (shelf.get(p.sku) || NO_BASIS).date_type === 'expiration' ? 'expiration' : 'best by',
    ].map(csvCell).join(','));
  }

  res.type('text/csv; charset=utf-8')
    // Short cache: the proofer already caches for 5 minutes its side, and a
    // stale master is how artwork gets checked against a barcode we retired.
    .set('Cache-Control', 'no-store')
    .send(lines.join('\n'));
}

/* ── The approved nutrition panel, for the proofing service ───────────────────
 *
 * The other half of the same integration, and the one that closes the hole
 * master.csv cannot. The proofing tool checks a label against its own
 * arithmetic, which catches a panel that contradicts itself and is blind to
 * the panel where every number is internally consistent and every number came
 * off a different product. That is how a 38-SKU bottle run produced 13
 * nutrition errors with only 5 of them visible to the check.
 *
 * The Nutrition panels tab already says it is the gate — "approving one here
 * is what lets artwork be released to print against it" — and until this
 * endpoint existed nothing could read it.
 *
 * STATUS IS PART OF THE ANSWER, not a filter applied here. A draft panel is
 * returned AND SAID TO BE A DRAFT, so the proofing service can refuse to mark
 * a file releasable against it while still checking the numbers. Returning
 * only approved panels would make "draft" and "missing" the same 404, and
 * those are different problems with different fixes.
 *
 * A superseded panel is never the answer: it is what was true before the
 * current one, and artwork drawn against it is already reported as stranded.
 */
function currentPanel(db, sku) {
  return db.prepare(`SELECT * FROM nfp_versions WHERE sku = ? AND status = 'approved'
                     ORDER BY approved_at DESC, updated_at DESC LIMIT 1`).get(sku)
    || db.prepare(`SELECT * FROM nfp_versions WHERE sku = ? AND status IN ('draft','sent','rejected')
                   ORDER BY updated_at DESC LIMIT 1`).get(sku);
}

export function nutritionPanel(req, res) {
  const auth = checkProofToken(req);
  if (!auth.ok) return refuseProofToken(res, auth);
  const gtin = normalizeGtin(req.query.gtin);
  const sku = String(req.query.sku || '').trim();
  if (!gtin && !sku) return res.status(400).json({ error: 'Supply a gtin or a sku.' });

  const db = getDb();
  // GTIN BEFORE SKU, the same order artwork ingest resolves in: a decoded
  // barcode is the only unambiguous identification of a pack, and a filename
  // cannot tell a pouch from a stick.
  const product = (gtin && db.prepare('SELECT * FROM products WHERE gtin = ?').get(gtin))
    || (sku && db.prepare('SELECT * FROM products WHERE sku = ?').get(sku))
    || null;
  if (!product) {
    return res.status(404).json({ error: 'No product matches that GTIN or SKU.', reason: 'product_not_found' });
  }

  const v = currentPanel(db, product.sku);
  // EVERY REFUSAL SAYS WHICH ONE IT IS. All three read as "unverified" to the
  // proofing service, which is right — but to the plant they are three
  // different jobs, and a bare 404 makes "nobody has filed a panel" look
  // identical to "the panel is on file and nobody typed the numbers in".
  if (!v) {
    return res.status(404).json({
      error: `No nutrition panel is on file for ${product.sku}.`,
      reason: 'no_panel', sku: product.sku, gtin: product.gtin || null,
    });
  }
  // A row whose JSON somehow will not parse is answered as "no values", not
  // as a 500: to the proofing service that is the same unverified state, and a
  // crash on one bad row would take the feed down for every product.
  const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const panel = parse(v.panel_json);
  if (!panel || !Object.values(panel).some((x) => x !== null && x !== '')) {
    return res.status(404).json({
      error: `${product.sku} panel ${v.version} is on file but its values have not been entered.`,
      reason: 'no_panel_values', sku: product.sku, gtin: product.gtin || null,
      version: v.version, status: v.status,
    });
  }
  const callouts = parse(v.front_callouts);
  const prov = provenanceOf(v);

  res.set('Cache-Control', 'no-store').json({
    sku: product.sku,
    gtin: normalizeGtin(product.gtin),
    product_name: [product.flavor, PACK_LABEL[product.pack] || product.pack].filter(Boolean).join(' — '),
    // THE LABEL, NOT A COUNTER. This is what a person chose and what a printer
    // quotes; `panel_rev` beside it is the integer that moves on every change
    // to the numbers, and it is the one to record against a proofing run.
    // `panel_version` is the same integer under the name the proofing tool
    // posts back on ingest, so it can read and return one field.
    version: v.version,
    panel_rev: v.panel_rev || 0,
    panel_version: v.panel_rev || 0,
    status: v.status,
    approved_by: v.approved_by || null,
    // As stored: a date, because that is the fact the approval carries. A
    // fabricated time of day would read as precision nobody recorded.
    approved_at: v.approved_at || null,
    panel,
    front_callouts: callouts,
    // WHERE THE NUMBERS CAME FROM (D-128), so the proofer can say "artwork
    // matches approved panel v3, but that panel was computed against formula
    // v2.0 and the catalogue's current formula is v2.1". `approved_provenance`
    // is what the approval was given against, frozen; `provenance` is the
    // record's own block, derived — `source_system: 'unknown'` and
    // `provenance_missing: true` until a person fills it.
    provenance: prov,
    provenance_missing: provenanceMissing(prov).length > 0,
    approved_provenance: parse(v.approved_provenance),
    current_formula: { formula_ref: product.mrp_formula_id || null, formula_version: product.formula_rev || null },
    fill_weight_g: product.fill_weight_g ?? null,
    provenance_stale: provenanceStale(prov, product),
  });
}

export default router;
