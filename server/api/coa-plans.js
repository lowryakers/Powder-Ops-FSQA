// Test plans, the COA product list and the readiness report (D-244). Mounted
// inside the COA router (`/api/coa/...`), so the COA module grant reaches it;
// every write is Quality's (`isQaReviewer`) and audited with the actor.
// Approve and apply are signatures (password, 21 CFR 11.200) — and "approve"
// in the path keeps every bot token out (no-token-approve.js).
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { isQaReviewer } from '../qa-signing.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import {
  getPlan, listPlans, cleanTest, planMissing, planApply, applyPlan, productReadiness, READINESS_WORDS, SLUG_RE, MAX_APPLY,
} from '../coa-test-plans.js';

const router = Router();
const QA_ONLY = 'Only Quality (a QA reviewer) or an admin can change test plans and COA products.';
const mayEdit = (u) => u?.role === 'admin' || isQaReviewer(u);

// ── Test plans ─────────────────────────────────────────────────────────────
router.get('/plans', (_req, res) => res.json({ plans: listPlans(getDb()) }));

router.get('/plans/:id', (req, res) => {
  const plan = getPlan(getDb(), req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  res.json({ ...plan, missing: planMissing(plan.tests) });
});

router.post('/plans', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 80) return res.status(400).json({ error: 'Name the plan (3–80 characters).' });
  const db = getDb();
  if (db.prepare('SELECT 1 FROM coa_test_plans WHERE LOWER(name) = LOWER(?)').get(name)) return res.status(409).json({ error: `A plan named "${name}" already exists. Edit it to make a new version.` });
  const id = uuid();
  db.prepare(`INSERT INTO coa_test_plans (id, name, brand_owner, version, status, notes, created_by) VALUES (?, ?, ?, 1, 'draft', ?, ?)`)
    .run(id, name, String(req.body?.brand_owner || '').trim() || null, String(req.body?.notes || '').trim() || null, req.user.name);
  logAudit(req.user, 'create', 'coa_test_plan', id, { name }, null, getPlan(db, id), name);
  res.status(201).json(getPlan(db, id));
});

// A DRAFT is edited in place; an approved plan never is.
router.put('/plans/:id', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const plan = getPlan(db, req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  if (plan.status !== 'draft') return res.status(409).json({ error: 'An approved plan is not edited. Make a new version, edit that, and approve it.' });
  let tests = plan.tests;
  if (Array.isArray(req.body?.tests)) {
    tests = [];
    for (const t of req.body.tests) {
      const [clean, err] = cleanTest(t);
      if (err) return res.status(400).json({ error: err });
      tests.push(clean);
    }
    const names = tests.map(t => t.test_type.toLowerCase());
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return res.status(400).json({ error: `"${dup}" is in the plan twice.` });
  }
  db.transaction(() => {
    if (req.body?.notes !== undefined || req.body?.brand_owner !== undefined) {
      db.prepare('UPDATE coa_test_plans SET notes = ?, brand_owner = ? WHERE id = ?').run(
        req.body.notes !== undefined ? (String(req.body.notes || '').trim() || null) : plan.notes,
        req.body.brand_owner !== undefined ? (String(req.body.brand_owner || '').trim() || null) : plan.brand_owner, plan.id);
    }
    if (Array.isArray(req.body?.tests)) {
      db.prepare('DELETE FROM coa_test_plan_tests WHERE plan_id = ?').run(plan.id);
      const ins = db.prepare(`INSERT INTO coa_test_plan_tests (id, plan_id, test_type, evaluation, comparator, min_value, max_value, unit, method, required, specification, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      tests.forEach((t, i) => ins.run(uuid(), plan.id, t.test_type, t.evaluation, t.comparator, t.min_value, t.max_value, t.unit, t.method, t.required, t.specification, i));
    }
  })();
  const after = getPlan(db, plan.id);
  logAudit(req.user, 'update', 'coa_test_plan', plan.id, { name: plan.name, version: plan.version }, plan, after, `${plan.name} v${plan.version}`);
  res.json({ ...after, missing: planMissing(after.tests) });
});

// "Edit" on an approved plan: the next version, as a draft copy.
router.post('/plans/:id/new-version', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const plan = getPlan(db, req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  if (plan.status === 'draft') return res.status(409).json({ error: 'This version is still a draft — edit it directly.' });
  const open = db.prepare("SELECT id FROM coa_test_plans WHERE name = ? AND status = 'draft'").get(plan.name);
  if (open) return res.status(409).json({ error: 'A draft of the next version already exists.', draft_id: open.id });
  const version = (db.prepare('SELECT MAX(version) v FROM coa_test_plans WHERE name = ?').get(plan.name).v || plan.version) + 1;
  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO coa_test_plans (id, name, brand_owner, version, status, supersedes_id, notes, created_by) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .run(id, plan.name, plan.brand_owner, version, plan.id, plan.notes, req.user.name);
    const ins = db.prepare(`INSERT INTO coa_test_plan_tests (id, plan_id, test_type, evaluation, comparator, min_value, max_value, unit, method, required, specification, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const t of plan.tests) ins.run(uuid(), id, t.test_type, t.evaluation, t.comparator, t.min_value, t.max_value, t.unit, t.method, t.required, t.specification, t.sort);
  })();
  logAudit(req.user, 'create', 'coa_test_plan', id, { name: plan.name, version, supersedes: plan.id }, null, null, `${plan.name} v${version}`);
  res.status(201).json(getPlan(db, id));
});

router.post('/plans/:id/approve', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const plan = getPlan(db, req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  if (plan.status !== 'draft') return res.status(409).json({ error: 'This version is already approved or retired.' });
  const missing = planMissing(plan.tests);
  if (missing.length) return res.status(400).json({ error: `This plan cannot be approved yet: ${missing.join(' ')}`, missing });
  if (!gateSignature(req, res, { action: 'coa_plan_approve' })) return;
  db.transaction(() => {
    db.prepare("UPDATE coa_test_plans SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?").run(req.user.name, plan.id);
    // The version it replaces stops being the one in force. Products keep
    // their specifications until the new version is applied to them.
    db.prepare("UPDATE coa_test_plans SET status = 'retired' WHERE name = ? AND status = 'approved' AND id != ?").run(plan.name, plan.id);
  })();
  logAudit(req.user, 'approve', 'coa_test_plan', plan.id, { name: plan.name, version: plan.version, tests: plan.tests.map(t => t.test_type), ...signatureEvidence() },
    { status: 'draft' }, { status: 'approved' }, `${plan.name} v${plan.version}`);
  res.json(getPlan(db, plan.id));
});

// Apply: preview (writes nothing) or apply (reason + password, one transaction).
router.post('/plans/:id/apply', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const plan = getPlan(db, req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  const items = Array.isArray(req.body?.item_numbers) ? req.body.item_numbers : [];
  if (!items.length) return res.status(400).json({ error: 'Choose the products to apply it to.' });
  if (items.length > MAX_APPLY) return res.status(400).json({ error: `At most ${MAX_APPLY} products at a time.` });
  if (req.body?.mode !== 'apply') return res.json({ mode: 'preview', plan: { id: plan.id, name: plan.name, version: plan.version, status: plan.status }, products: planApply(db, plan, items) });
  if (plan.status !== 'approved') return res.status(409).json({ error: 'Only an approved plan can be applied. Approve it first.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why this plan is being applied.' });
  if (!gateSignature(req, res, { action: 'coa_plan_apply' })) return;
  const audit = (action, entity, id, details, prev, next, label) => logAudit(req.user, action, entity, id, { ...details, reason }, prev, next, label);
  const out = applyPlan(db, plan, items, { by: req.user.name, audit });
  logAudit(req.user, 'update', 'coa_test_plan', plan.id, { applied_to: out.applied.map(a => a.item_number), skipped: out.skipped.map(s => ({ item_number: s.item_number, status: s.status })), reason, ...signatureEvidence() },
    null, null, `${plan.name} v${plan.version}`);
  res.json({ mode: 'apply', applied: out.applied.length, skipped: out.skipped });
});

// ── COA products ───────────────────────────────────────────────────────────
router.get('/products', (_req, res) => {
  const db = getDb();
  const products = db.prepare(`SELECT p.*, pl.name plan_name, pl.status plan_status FROM coa_products p
    LEFT JOIN coa_test_plans pl ON pl.id = p.plan_id ORDER BY p.brand_owner, p.item_number`).all();
  // Items with lab requests that are not on the list yet, so adding one is a pick, not a typing exercise.
  const candidates = db.prepare(`SELECT item_number, MAX(item_description) item_description, MAX(brand_owner) brand_owner, COUNT(*) requests
    FROM coa_requests WHERE item_number NOT IN (SELECT item_number FROM coa_products)
    GROUP BY item_number ORDER BY MAX(CASE WHEN brand_owner = 'ProDough' THEN 0 ELSE 1 END), item_number LIMIT 2000`).all();
  res.json({ products, candidates });
});

router.put('/products/:item', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const item = String(req.params.item || '').trim();
  const before = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(item);
  const b = req.body || {};
  const pick = (k, cur) => (b[k] !== undefined ? (String(b[k] ?? '').trim() || null) : cur ?? null);
  const slug = b.slug !== undefined ? (String(b.slug || '').trim().toLowerCase() || null) : before?.slug ?? null;
  if (slug && (!SLUG_RE.test(slug) || slug.length > 60)) return res.status(400).json({ error: 'A web slug is lower-case letters, numbers and single dashes, up to 60 characters (for example "pancake-mix-buttermilk").' });
  if (slug && db.prepare('SELECT 1 FROM coa_products WHERE slug = ? AND item_number != ?').get(slug, item)) return res.status(409).json({ error: `The slug "${slug}" is already used by another product.` });
  const brand = pick('brand_owner', before?.brand_owner);
  if (brand && brand !== 'unassigned' && !db.prepare('SELECT 1 FROM coa_brands WHERE name = ?').get(brand)) return res.status(400).json({ error: `"${brand}" is not on the brand list.` });
  const product_id = pick('product_id', before?.product_id);
  if (product_id && !db.prepare('SELECT 1 FROM products WHERE sku = ?').get(product_id)) return res.status(400).json({ error: `No catalog product with SKU "${product_id}".` });
  const gf = b.gf_claim !== undefined ? (b.gf_claim ? 1 : 0) : (before?.gf_claim ?? 0);
  const row = { display_name: pick('display_name', before?.display_name), slug, brand_owner: brand, gf_claim: gf, product_id, public_note: pick('public_note', before?.public_note) };
  if (before) {
    db.prepare('UPDATE coa_products SET display_name = ?, slug = ?, brand_owner = ?, gf_claim = ?, product_id = ?, public_note = ? WHERE item_number = ?')
      .run(row.display_name, row.slug, row.brand_owner, row.gf_claim, row.product_id, row.public_note, item);
  } else {
    if (!db.prepare('SELECT 1 FROM coa_requests WHERE item_number = ?').get(item)) return res.status(400).json({ error: `No lab request has the item number "${item}".` });
    db.prepare('INSERT INTO coa_products (item_number, display_name, slug, brand_owner, gf_claim, product_id, public_note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item, row.display_name, row.slug, row.brand_owner, row.gf_claim, row.product_id, row.public_note, req.user.name);
  }
  const after = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(item);
  logAudit(req.user, before ? 'update' : 'create', 'coa_product', item, { gf_claim_changed: !!before && before.gf_claim !== after.gf_claim }, before || null, after, item);
  res.json(after);
});

// ── Readiness, part 1 (A6) ─────────────────────────────────────────────────
function readiness(db) {
  const products = productReadiness(db);
  const counts = products.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {});
  // Catalog products (ProDough) with no COA product linked — information only.
  const unlinked = db.prepare(`SELECT sku, category || ' · ' || flavor || ' · ' || pack AS name FROM products WHERE status = 'active'
    AND sku NOT IN (SELECT product_id FROM coa_products WHERE product_id IS NOT NULL) ORDER BY sku LIMIT 2000`).all();
  return { products, counts, words: READINESS_WORDS, catalog_without_coa_product: unlinked };
}

router.get('/readiness', (req, res) => {
  if (!(req.user?.role === 'admin' || isQaReviewer(req.user))) return res.status(403).json({ error: 'The readiness report is for Quality and admins.' });
  const db = getDb();
  const r = readiness(db);
  if (req.query.format !== 'csv') return res.json(r);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['item_number,display_name,brand,plan,plan_version,tests_required,tests_with_limit,status'];
  for (const p of r.products) lines.push([p.item_number, p.display_name, p.brand_owner, p.plan_name, p.plan_version, p.tests_required, p.tests_with_limit, p.status].map(cell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="coa-readiness.csv"');
  res.send(lines.join('\n') + '\n');
});

export default router;
export { readiness };
