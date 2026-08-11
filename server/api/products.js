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
import { createHash, timingSafeEqual } from 'crypto';
import { getDb, logAudit } from '../db.js';

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

// The checklist, in the order a product actually has to clear it. Each entry
// reads one field and says what is missing in the words you would use out loud
// — "no GS1 barcode", not "gtin is null". Adding a step is one row here.
const READINESS = [
  { key: 'sku', label: 'SKU assigned', ok: (p) => !!p.sku && !/^\d{8,}$/.test(p.sku) },
  { key: 'gtin', label: 'GS1 barcode', ok: (p) => !!p.gtin && !!p.gtin_valid },
  { key: 'spec', label: 'Packaging spec', ok: (p) => !!p.spec_id && !!p.material_structure },
  { key: 'formula', label: 'MRP formula', ok: (p) => !!p.mrp_formula_id },
  { key: 'nfp', label: 'NFP approved', ok: (p) => !!p.nfp_version && !!p.nfp_approved_at },
  { key: 'artwork', label: 'Artwork print-ready', ok: (p) => p.artwork_status === 'print_ready' },
  { key: 'colors', label: 'Brand colours', ok: (p) => (p.colors || []).length > 0 },
  { key: 'shopify', label: 'In Shopify', ok: (p) => !!p.shopify_sku },
  { key: 'shiphero', label: 'Synced to ShipHero', ok: (p) => !!p.shiphero_synced_at },
];

function readinessOf(p) {
  const steps = READINESS.map((s) => ({ key: s.key, label: s.label, done: !!s.ok(p) }));
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, missing: steps.filter((s) => !s.done).map((s) => s.label) };
}

// ── Shaping ──────────────────────────────────────────────────────────────────

const SELECT = `
  SELECT p.*, s.name AS spec_name, s.material_structure, s.zipper, s.print_process,
         s.trim_length_mm, s.trim_width_mm, s.gusset_mm, s.front_panel_mm,
         s.wind_direction, s.vendor_spec_string
  FROM products p LEFT JOIN packaging_specs s ON s.spec_id = p.spec_id`;

function hydrate(rows, db) {
  if (!rows.length) return [];
  const colors = db.prepare('SELECT * FROM product_colors ORDER BY sku, slot').all();
  const bySku = new Map();
  for (const c of colors) {
    if (!bySku.has(c.sku)) bySku.set(c.sku, []);
    bySku.get(c.sku).push(c);
  }
  return rows.map((r) => {
    const withColors = { ...r, colors: bySku.get(r.sku) || [] };
    return { ...withColors, readiness: readinessOf(withColors) };
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = hydrate(db.prepare(`${SELECT} ORDER BY p.sku`).all(), db);
  const specs = db.prepare('SELECT * FROM packaging_specs ORDER BY spec_id').all();
  res.json({ products: rows, specs, readinessSteps: READINESS.map((s) => ({ key: s.key, label: s.label })) });
});

router.get('/specs', (_req, res) => {
  res.json({ specs: getDb().prepare('SELECT * FROM packaging_specs ORDER BY spec_id').all() });
});

// Registered BEFORE /:sku — Express matches in declaration order, and
// '/master.csv' is a perfectly good :sku as far as the router is concerned.
// The handler and its helpers live at the bottom of the file with the rest of
// the proofing-feed code; only the registration has to be up here.
router.get('/master.csv', (req, res) => masterCsv(req, res));

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
  'shopify_sku', 'shopify_variant_id', 'shiphero_synced_at', 'mrp_formula_id', 'formula_rev',
  'nfp_version', 'nfp_approved_at', 'artwork_version', 'artwork_status', 'drive_url', 'notes',
];

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
  logAudit(req.user, 'product_created', 'product', sku, { gtin, flavor: b.flavor }, null, null, `${sku} — ${b.flavor}`);
  res.status(201).json(db.prepare(`${SELECT} WHERE p.sku = ?`).get(sku));
});

router.put('/:sku', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalogue.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!existing) return res.status(404).json({ error: 'No such SKU' });
  const b = req.body || {};

  // A GTIN that fails its check digit is never stored, from any door.
  if (b.gtin !== undefined) {
    const g = (b.gtin || '').trim();
    if (g && !gtinValid(g)) return res.status(400).json({ error: `${g} fails its GS1 check digit.` });
    const clash = g && db.prepare('SELECT sku FROM products WHERE gtin = ? AND sku != ?').get(g, existing.sku);
    if (clash) return res.status(409).json({ error: `${g} is already on ${clash.sku}.` });
  }

  const patch = {};
  for (const c of WRITABLE) if (b[c] !== undefined) patch[c] = b[c] === '' ? null : b[c];
  if (patch.gtin !== undefined) patch.gtin_valid = gtinValid(patch.gtin) ? 1 : 0;
  if (!Object.keys(patch).length) return res.json(existing);

  const sets = Object.keys(patch).map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE sku = ?`)
    .run(...Object.values(patch), existing.sku);
  logAudit(req.user, 'product_updated', 'product', existing.sku, { changed: Object.keys(patch) }, null, null, existing.sku);
  res.json(db.prepare(`${SELECT} WHERE p.sku = ?`).get(existing.sku));
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
];

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function masterCsv(req, res) {
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
    ].map(csvCell).join(','));
  }

  res.type('text/csv; charset=utf-8')
    // Short cache: the proofer already caches for 5 minutes its side, and a
    // stale master is how artwork gets checked against a barcode we retired.
    .set('Cache-Control', 'no-store')
    .send(lines.join('\n'));
}

export default router;
