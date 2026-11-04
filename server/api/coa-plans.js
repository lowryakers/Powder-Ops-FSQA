// Test plans, the COA product list and the readiness report (D-244). Mounted
// inside the COA router (`/api/coa/...`), so the COA module grant reaches it;
// every write is Quality's (`isQaReviewer`) and audited with the actor.
// Approve and apply are signatures (password, 21 CFR 11.200) — and "approve"
// in the path keeps every bot token out (no-token-approve.js).
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { isQaReviewer } from '../qa-signing.js';
import { hasCoaPrep, isCoaPrepOnly } from '../coa-prep.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import {
  getPlan, listPlans, cleanTest, planMissing, planApply, applyPlan, SLUG_RE, MAX_APPLY,
} from '../coa-test-plans.js';
import { coaReadiness } from '../coa-lot-gate.js';
import { publicState } from '../coa-public-snapshot.js';
import { reopenedRequests, REOPENED_STALE_DAYS } from '../coa-correction-window.js';
import { cleanItemNumber } from '../coa-item-number.js';

const router = Router();
const QA_ONLY = 'Only Quality (a QA reviewer) or an admin can change test plans and COA products.';
// Approving and applying are decisions: never the coa-prep grant (D-311).
const mayEdit = (u) => !isCoaPrepOnly(u) && (u?.role === 'admin' || isQaReviewer(u));
// Preparing a draft plan or the product list: Quality, or the coa-prep grant.
const mayPrep = (u) => u?.role === 'admin' || isQaReviewer(u) || hasCoaPrep(u);
// A bot token holding the coa-prep TOKEN grant (D-313). Which writes it may make
// is WRITE_AREAS' job (server/bot-api.js); here it only stands in for the grant.
const botPrep = (req) => req.auth?.kind === 'token' && (req.auth.grants || []).includes('coa-prep');
const mayPrepReq = (req) => botPrep(req) || mayPrep(req.user);
const botLabel = (req) => req.auth?.label || req.auth?.prefix || 'bot token';
// One `bot_coa_write` row per successful bot write: the token's name, the old
// value and the new value. A person's write produces none.
function botCoaWrite(req, entity, id, label, before, after, extra = {}) {
  if (req.auth?.kind !== 'token') return;
  logAudit(req.user, 'bot_coa_write', entity, id, {
    token_id: req.auth.tokenId, token_prefix: req.auth.prefix, token_label: req.auth.label || null,
    bot_name: req.user?.name || null, grant: 'coa-prep', method: req.method, path: (req.baseUrl || '') + req.path, ...extra,
  }, before ?? null, after ?? null, label);
}
const planTestView = (t) => ({ test_type: t.test_type, evaluation: t.evaluation, comparator: t.comparator, min_value: t.min_value, max_value: t.max_value, unit: t.unit, method: t.method, required: t.required, specification: t.specification });
const testKey = (t) => String(t.test_type || '').toLowerCase();
const sameTest = (a, b) => ['evaluation', 'comparator', 'min_value', 'max_value', 'unit', 'method', 'required', 'specification', 'public']
  .every(k => (a[k] ?? null) === (b[k] ?? null) || (k === 'public' && !!a[k] === !!b[k]) || (k === 'required' && !!a[k] === !!b[k]));
/** A draft plan's proposed products: trimmed, de-duplicated item numbers, each one a COA item. */
function cleanItems(db, raw) {
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\n,;]/)).map(cleanItemNumber).filter(Boolean);
  const uniq = [...new Set(list)];
  if (uniq.length > MAX_APPLY) return [null, `At most ${MAX_APPLY} products on a plan at a time.`];
  const unknown = uniq.filter(i => !db.prepare('SELECT 1 FROM coa_products WHERE item_number = ? UNION SELECT 1 FROM coa_requests WHERE item_number = ? LIMIT 1').get(i, i));
  if (unknown.length) return [null, `No lab request or COA product has the item number ${unknown.map(u => `"${u}"`).join(', ')}.`];
  return [uniq, null];
}

// ── Test plans ─────────────────────────────────────────────────────────────
router.get('/plans', (_req, res) => res.json({ plans: listPlans(getDb()) }));

router.get('/plans/:id', (req, res) => {
  const plan = getPlan(getDb(), req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  res.json({ ...plan, missing: planMissing(plan.tests) });
});

router.post('/plans', (req, res) => {
  if (!mayPrep(req.user)) return res.status(403).json({ error: QA_ONLY });
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
  if (!mayPrepReq(req)) return res.status(403).json({ error: QA_ONLY });
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
  let items = null;
  if (req.body?.items !== undefined) {
    const [list, err] = cleanItems(db, req.body.items);
    if (err) return res.status(400).json({ error: err });
    items = list;
  }
  const bot = req.auth?.kind === 'token';
  // What the plan has now, by test name: a bot cannot move `public`, a person's
  // edit keeps the bot mark on a test it did not change (D-313).
  const prior = new Map(plan.tests.map(t => [testKey(t), t]));
  if (bot && Array.isArray(req.body?.tests)) for (const t of tests) t.public = prior.get(testKey(t))?.public ? 1 : 0;
  db.transaction(() => {
    if (items !== null) db.prepare('UPDATE coa_test_plans SET proposed_items = ? WHERE id = ?').run(items.length ? JSON.stringify(items) : null, plan.id);
    if (req.body?.notes !== undefined || req.body?.brand_owner !== undefined) {
      db.prepare('UPDATE coa_test_plans SET notes = ?, brand_owner = ? WHERE id = ?').run(
        req.body.notes !== undefined ? (String(req.body.notes || '').trim() || null) : plan.notes,
        req.body.brand_owner !== undefined ? (String(req.body.brand_owner || '').trim() || null) : plan.brand_owner, plan.id);
    }
    if (Array.isArray(req.body?.tests)) {
      db.prepare('DELETE FROM coa_test_plan_tests WHERE plan_id = ?').run(plan.id);
      const ins = db.prepare(`INSERT INTO coa_test_plan_tests (id, plan_id, test_type, evaluation, comparator, min_value, max_value, unit, method, required, specification, sort, public, bot_prepared_at, bot_prepared_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      tests.forEach((t, i) => {
        const was = prior.get(testKey(t));
        const unchanged = was && sameTest(was, t);
        // A bot's changed or new test is marked; an unchanged one keeps its mark;
        // a person's change is the person's value and carries none.
        const mark = bot ? (unchanged ? [was.bot_prepared_at, was.bot_prepared_by] : [new Date().toISOString(), botLabel(req)])
          : (unchanged ? [was.bot_prepared_at, was.bot_prepared_by] : [null, null]);
        ins.run(uuid(), plan.id, t.test_type, t.evaluation, t.comparator, t.min_value, t.max_value, t.unit, t.method, t.required, t.specification, i, t.public ? 1 : 0, mark[0] ?? null, mark[1] ?? null);
      });
    }
    if (bot) db.prepare('UPDATE coa_test_plans SET bot_prepared_at = ?, bot_prepared_by = ? WHERE id = ?').run(new Date().toISOString(), botLabel(req), plan.id);
  })();
  const after = getPlan(db, plan.id);
  logAudit(req.user, 'update', 'coa_test_plan', plan.id, { name: plan.name, version: plan.version, ...(bot ? { via_bot: botLabel(req) } : {}) }, plan, after, `${plan.name} v${plan.version}`);
  botCoaWrite(req, 'coa_test_plan', plan.id, `${plan.name} v${plan.version}`,
    { tests: plan.tests.map(planTestView), proposed_items: plan.proposed, notes: plan.notes },
    { tests: after.tests.map(planTestView), proposed_items: after.proposed, notes: after.notes },
    { plan_name: plan.name, plan_version: plan.version });
  res.json({ ...after, missing: planMissing(after.tests) });
});

// "Edit" on an approved plan: the next version, as a draft copy.
router.post('/plans/:id/new-version', (req, res) => {
  if (!mayPrep(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const plan = getPlan(db, req.params.id);
  if (!plan) return res.status(404).json({ error: 'No such test plan.' });
  if (plan.status === 'draft') return res.status(409).json({ error: 'This version is still a draft — edit it directly.' });
  const open = db.prepare("SELECT id FROM coa_test_plans WHERE name = ? AND status = 'draft'").get(plan.name);
  if (open) return res.status(409).json({ error: 'A draft of the next version already exists.', draft_id: open.id });
  const version = (db.prepare('SELECT MAX(version) v FROM coa_test_plans WHERE name = ?').get(plan.name).v || plan.version) + 1;
  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO coa_test_plans (id, name, brand_owner, version, status, supersedes_id, notes, created_by, proposed_items) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .run(id, plan.name, plan.brand_owner, version, plan.id, plan.notes, req.user.name, plan.proposed_items || null);
    const ins = db.prepare(`INSERT INTO coa_test_plan_tests (id, plan_id, test_type, evaluation, comparator, min_value, max_value, unit, method, required, specification, sort, public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const t of plan.tests) ins.run(uuid(), id, t.test_type, t.evaluation, t.comparator, t.min_value, t.max_value, t.unit, t.method, t.required, t.specification, t.sort, t.public ? 1 : 0);
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
    db.prepare("UPDATE coa_test_plans SET status = 'approved', approved_by = ?, approved_at = datetime('now'), bot_prepared_at = NULL, bot_prepared_by = NULL WHERE id = ?").run(req.user.name, plan.id);
    // A person approving the plan is the review of every value a bot prepared on it (D-313).
    db.prepare('UPDATE coa_test_plan_tests SET bot_prepared_at = NULL, bot_prepared_by = NULL WHERE plan_id = ?').run(plan.id);
    // The version it replaces stops being the one in force. Products keep
    // their specifications until the new version is applied to them.
    db.prepare("UPDATE coa_test_plans SET status = 'retired' WHERE name = ? AND status = 'approved' AND id != ?").run(plan.name, plan.id);
  })();
  logAudit(req.user, 'approve', 'coa_test_plan', plan.id, { name: plan.name, version: plan.version, tests: plan.tests.map(t => t.test_type), ...signatureEvidence() },
    { status: 'draft', bot_prepared: !!plan.bot_prepared_at || plan.tests.some(t => t.bot_prepared_at) }, { status: 'approved' }, `${plan.name} v${plan.version}`);
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

// ── Bulk register (D-310) ───────────────────────────────────────────────────
// Puts several item codes on the COA product list under one brand (ProDough by
// default) in one act. `dry_run` (the default) writes NOTHING and returns the
// plan; the commit re-derives the same plan, so what was previewed is what is
// written. An item already on the list is left alone and named — a brand is
// never moved by a bulk act. An item with no lab request is refused by name.
// Plans are not attached here: a plan is approved per product.
export function planBulkRegister(db, { item_numbers, brand_owner = 'ProDough' }) {
  const raw = Array.isArray(item_numbers) ? item_numbers : String(item_numbers || '').split(/[\n,;]/);
  const codes = [...new Set(raw.map(cleanItemNumber).filter(Boolean))];
  const brand = String(brand_owner || '').trim();
  if (!codes.length) return { error: 'List at least one item code.' };
  if (codes.length > 500) return { error: 'At most 500 item codes in one go.' };
  if (!brand || brand === 'unassigned') return { error: 'Choose the brand the items are registered under.' };
  if (!db.prepare('SELECT 1 FROM coa_brands WHERE name = ?').get(brand)) return { error: `"${brand}" is not on the brand list.` };
  // Requests are matched on the CLEANED code, so a request filed as "100245\t"
  // still counts as the item 100245.
  const reqs = new Map();
  for (const r of db.prepare('SELECT item_number, MAX(item_description) item_description, COUNT(*) n FROM coa_requests GROUP BY item_number').all()) {
    const k = cleanItemNumber(r.item_number);
    const cur = reqs.get(k);
    reqs.set(k, { item_description: cur?.item_description || r.item_description, requests: (cur?.requests || 0) + r.n, stored_as: [...(cur?.stored_as || []), r.item_number] });
  }
  const register = [], already = [], unknown = [];
  for (const code of codes) {
    const on = db.prepare('SELECT item_number, brand_owner, plan_id FROM coa_products WHERE item_number = ?').get(code);
    if (on) { already.push({ item_number: code, brand_owner: on.brand_owner, has_plan: !!on.plan_id }); continue; }
    const r = reqs.get(code);
    if (!r) { unknown.push({ item_number: code, reason: 'No lab request has this item code.' }); continue; }
    register.push({ item_number: code, item_description: r.item_description, requests: r.requests,
      untidy_spellings: r.stored_as.filter(x => x !== code) });
  }
  return { brand_owner: brand, register, already, unknown };
}

router.post('/products/bulk-register', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const plan = planBulkRegister(db, req.body || {});
  if (plan.error) return res.status(400).json({ error: plan.error });
  const dry = req.body?.dry_run !== false;
  if (dry) return res.json({ dry_run: true, ...plan });
  const ins = db.prepare('INSERT INTO coa_products (item_number, display_name, brand_owner, created_by) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of plan.register) {
      ins.run(r.item_number, r.item_description || null, plan.brand_owner, req.user.name);
      logAudit(req.user, 'create', 'coa_product', r.item_number, { bulk: true, brand_owner: plan.brand_owner }, null,
        db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(r.item_number), r.item_number);
    }
  })();
  logAudit(req.user, 'bulk_register', 'coa_product', null, { brand_owner: plan.brand_owner, registered: plan.register.length,
    already: plan.already.length, unknown: plan.unknown.length });
  res.json({ dry_run: false, ...plan, registered: plan.register.length });
});

// Items that have a lab report PDF on file and no approved test plan (D-310):
// either not on the COA product list at all, or on it with no plan attached.
// Read-only, for the plans screen.
router.get('/products/no-plan', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT r.item_number, MAX(r.item_description) item_description, MAX(r.brand_owner) brand_owner,
      COUNT(DISTINCT r.id) requests_with_pdf, MAX(f.created_at) last_pdf_at,
      p.item_number AS product_item, p.plan_id, pl.status AS plan_status
    FROM coa_requests r JOIN coa_files f ON f.request_id = r.id AND f.file_type = 'lab_results'
    LEFT JOIN coa_products p ON p.item_number = r.item_number
    LEFT JOIN coa_test_plans pl ON pl.id = p.plan_id
    GROUP BY r.item_number
    HAVING p.plan_id IS NULL OR pl.status IS NULL OR pl.status != 'approved'
    ORDER BY MAX(CASE WHEN r.brand_owner = 'ProDough' THEN 0 ELSE 1 END), r.item_number LIMIT 2000`).all()
    .map(r => ({ item_number: r.item_number, item_description: r.item_description, brand_owner: r.brand_owner,
      requests_with_pdf: r.requests_with_pdf, last_pdf_at: r.last_pdf_at,
      on_product_list: !!r.product_item, plan_state: !r.product_item ? 'not_registered' : (!r.plan_id ? 'no_plan' : (r.plan_status || 'missing')) }));
  res.json({ items: rows, total: rows.length });
});

router.put('/products/:item', (req, res) => {
  if (!mayPrepReq(req)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const item = cleanItemNumber(req.params.item);
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
  // The other names a production entry uses for this product (D-246). Matched
  // exactly (case and spacing aside), never as a substring.
  let aliases = before?.aliases ?? null;
  if (b.aliases !== undefined) {
    const list = (Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split(/[\n;]/)).map(a => String(a).replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (list.some(a => a.length > 120)) return res.status(400).json({ error: 'A name is at most 120 characters.' });
    const taken = list.find(a => db.prepare('SELECT item_number FROM coa_products WHERE item_number != ? AND (LOWER(display_name) = LOWER(?) OR EXISTS (SELECT 1 FROM json_each(COALESCE(aliases, \'[]\')) WHERE LOWER(value) = LOWER(?)))').get(item, a, a));
    if (taken) return res.status(409).json({ error: `"${taken}" already names another COA product. One name must point at one product.` });
    aliases = list.length ? JSON.stringify([...new Set(list)]) : null;
  }
  const row = { display_name: pick('display_name', before?.display_name), slug, brand_owner: brand, gf_claim: gf, product_id, public_note: pick('public_note', before?.public_note), aliases };
  if (before) {
    db.prepare('UPDATE coa_products SET display_name = ?, slug = ?, brand_owner = ?, gf_claim = ?, product_id = ?, public_note = ?, aliases = ? WHERE item_number = ?')
      .run(row.display_name, row.slug, row.brand_owner, row.gf_claim, row.product_id, row.public_note, row.aliases, item);
  } else {
    if (!db.prepare('SELECT 1 FROM coa_requests WHERE item_number = ?').get(item)) return res.status(400).json({ error: `No lab request has the item number "${item}".` });
    db.prepare('INSERT INTO coa_products (item_number, display_name, slug, brand_owner, gf_claim, product_id, public_note, aliases, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item, row.display_name, row.slug, row.brand_owner, row.gf_claim, row.product_id, row.public_note, row.aliases, req.user.name);
  }
  // Bot-prepared (D-313): the fields a bot changed read "needs review" until a
  // person saves the product or marks it reviewed. A person's save is that review.
  const BOT_FIELDS = ['display_name', 'brand_owner', 'aliases'];
  const changed = BOT_FIELDS.filter(k => (before?.[k] ?? null) !== (row[k] ?? null));
  if (req.auth?.kind === 'token') {
    if (!before || changed.length) {
      const prev = before?.bot_prepared_fields ? JSON.parse(before.bot_prepared_fields) : [];
      const fields = [...new Set([...prev, ...(before ? changed : ['registered', ...changed])])];
      db.prepare('UPDATE coa_products SET bot_prepared_at = ?, bot_prepared_by = ?, bot_prepared_fields = ? WHERE item_number = ?')
        .run(new Date().toISOString(), botLabel(req), JSON.stringify(fields), item);
    }
  } else if (before?.bot_prepared_at) {
    db.prepare('UPDATE coa_products SET bot_prepared_at = NULL, bot_prepared_by = NULL, bot_prepared_fields = NULL WHERE item_number = ?').run(item);
  }
  const after = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(item);
  logAudit(req.user, before ? 'update' : 'create', 'coa_product', item, { gf_claim_changed: !!before && before.gf_claim !== after.gf_claim, ...(req.auth?.kind === 'token' ? { via_bot: botLabel(req) } : {}) }, before || null, after, item);
  const view = (r) => r ? Object.fromEntries(BOT_FIELDS.map(k => [k, r[k] ?? null])) : null;
  botCoaWrite(req, 'coa_product', item, item, view(before), view(after), { registered: !before, changed });
  res.json(after);
});

// A person marks a bot-prepared product reviewed (D-313). "acknowledge" is a
// decision segment, so a token is refused here whatever its grants.
router.post('/products/:item/acknowledge', (req, res) => {
  if (!mayEdit(req.user)) return res.status(403).json({ error: QA_ONLY });
  const db = getDb();
  const item = cleanItemNumber(req.params.item);
  const before = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(item);
  if (!before) return res.status(404).json({ error: 'No such COA product.' });
  if (!before.bot_prepared_at) return res.json(before);
  db.prepare('UPDATE coa_products SET bot_prepared_at = NULL, bot_prepared_by = NULL, bot_prepared_fields = NULL WHERE item_number = ?').run(item);
  const after = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(item);
  logAudit(req.user, 'update', 'coa_product', item, { reviewed_bot_prep: true, fields: JSON.parse(before.bot_prepared_fields || '[]'), prepared_by: before.bot_prepared_by },
    { bot_prepared_at: before.bot_prepared_at }, { bot_prepared_at: null }, item);
  res.json(after);
});

// ── Readiness (A6 + D6) ─────────────────────────────────────────────────────
// One page, read-only: it never changes a mode. Part 1 (the plans) is as it
// was; part 2 is the lot rule's report — what strict would block today.
function readiness(db) {
  const report = coaReadiness(db, { publicState: publicState(db) });
  // Catalog products (ProDough) with no COA product linked — information only.
  const unlinked = db.prepare(`SELECT sku, category || ' · ' || flavor || ' · ' || pack AS name FROM products WHERE status = 'active'
    AND sku NOT IN (SELECT product_id FROM coa_products WHERE product_id IS NOT NULL) ORDER BY sku LIMIT 2000`).all();
  // D-307: a certificate reopened for correction and not re-signed within three
  // days fails its own line, so a window that ran out is not forgotten.
  const reopened = reopenedRequests(db);
  const stale = reopened.filter(r => r.stale);
  const lines = [...(report.lines || []), {
    key: 'reopened_certificates', ok: stale.length === 0,
    text: stale.length
      ? `${stale.length} certificate${stale.length === 1 ? '' : 's'} reopened for correction > ${REOPENED_STALE_DAYS} days`
      : `No certificate reopened for correction more than ${REOPENED_STALE_DAYS} days${reopened.length ? ` (${reopened.length} reopened, all recent)` : ''}`,
  }];
  return { ...report, lines, reopened_certificates: reopened, catalog_without_coa_product: unlinked };
}
const mayRead = (u) => u?.role === 'admin' || isQaReviewer(u);

router.get('/readiness', (req, res) => {
  if (!mayRead(req.user)) return res.status(403).json({ error: 'The readiness report is for Quality and admins.' });
  const db = getDb();
  const r = readiness(db);
  if (req.query.format !== 'csv') return res.json(r);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['section,item_number,display_name,brand,plan,plan_version,tests_required,tests_with_limit,status,base_lot,batch,reason'];
  for (const p of r.products) lines.push(['product', p.item_number, p.display_name, p.brand_owner, p.plan_name, p.plan_version, p.tests_required, p.tests_with_limit, p.status, '', '', ''].map(cell).join(','));
  for (const l of r.would_block) {
    const rows = l.at_fault.length ? l.at_fault : [{ batch: '', reasons: l.problems }];
    for (const b of rows) lines.push(['would_block', l.item_number, l.display_name, '', '', '', '', '', l.state, l.base_lot, b.batch ?? '', (b.reasons || []).join('; ')].map(cell).join(','));
  }
  for (const x of r.lines) lines.push(['summary', '', '', '', '', '', '', '', x.ok ? 'ok' : 'not yet', '', '', x.text].map(cell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="coa-readiness.csv"');
  res.send(lines.join('\n') + '\n');
});

// The golden-file run (D-246): Quality runs the real CTLA PDFs through the
// reader (`COA_REAL_PDF_DIR=… node --test scripts/test/coa-real-pdf.test.mjs`)
// and records what it showed, with the password. The app does not run it — the
// PDFs are never on the server. A record, not a switch.
router.post('/readiness/golden-attest', (req, res) => {
  if (!mayRead(req.user)) return res.status(403).json({ error: 'Only Quality or an admin can record a golden-file run.' });
  const b = req.body || {};
  const n = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const run_on = String(b.run_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(run_on)) return res.status(400).json({ error: 'Give the date the run was done.' });
  const pdfs = n(b.pdfs_read); const mism = n(b.mismatches); const unread = n(b.unread_rows ?? 0);
  if (!pdfs) return res.status(400).json({ error: 'Say how many lab reports were read (at least 1).' });
  if (mism == null || unread == null) return res.status(400).json({ error: 'Give the number of mismatches and unread lines (0 if none).' });
  const sha = b.report_sha256 ? String(b.report_sha256).trim().toLowerCase() : null;
  if (sha && !/^[0-9a-f]{64}$/.test(sha)) return res.status(400).json({ error: 'The report fingerprint is a 64-character SHA-256.' });
  if (!gateSignature(req, res, { action: 'coa_golden_attest' })) return;
  const db = getDb();
  const id = uuid();
  db.prepare('INSERT INTO coa_golden_attestations (id, run_on, pdfs_read, mismatches, unread_rows, report_sha256, note, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, run_on, pdfs, mism, unread, sha, String(b.note || '').trim() || null, req.user.name);
  const row = db.prepare('SELECT * FROM coa_golden_attestations WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'coa_golden_attestation', id, { ...row, ...signatureEvidence() }, null, row, `Golden-file run ${run_on}`);
  res.status(201).json(row);
});

export default router;
export { readiness };
