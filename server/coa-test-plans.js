// Test plans: the tests a product must have, with limits, a version and who
// approved them (D-244, COA Phase 2 task A).
//
// Live data on 27 Oct 2026: 1,063 items, 23 active specifications on 2 of
// them, and not one of the 1,632 results on the 126 signed certificates linked
// to a specification. "Passed" traced to nothing anybody approved. A plan is
// how a limit gets an owner:
//  · A plan is DRAFT until a QA reviewer approves it with the password, and an
//    approved plan is never edited — "Edit" makes the next version as a draft.
//  · Approval is refused while a required limit test has no limit or no unit;
//    the refusal names each one in words.
//  · Applying an approved plan to products WRITES THE SPECIFICATION ROWS THE
//    GRADER ALREADY READS (`gradeResult` / `specIndex` are untouched), each
//    carrying the plan, its version and its approver. The rows it replaces are
//    retired (is_active = 0, audited), never deleted.
//  · It NEVER OVERRIDES A DIFFERENT LIMIT. An active specification for the same
//    test with another limit, written outside this plan, makes the product a
//    CONFLICT: the preview says so, the apply skips it, Lowry decides.
//  · Seeded: the ProDough standard panel as a DRAFT, with ONE limit filled in —
//    gluten < 20 ppm, internal only (decided A-20261027-005). Every other limit
//    is Maria's to enter. Nothing else is invented.
import { v4 as uuid } from 'uuid';
import { specIndex } from './coa-grade.js';

export const PRODOUGH_PLAN = 'ProDough standard panel';
export const GF_PLAN = 'Gluten-free claim';
export const COMPARATORS = ['<', '<=', '>', '>=', 'range', 'absent'];
export const MAX_APPLY = 2000;

// The CTLA panel on every real ProDough report. Names only; the limits are Maria's.
const PRODOUGH_TESTS = [
  ['Total Aerobic Microbial Count (USP)', 'USP <2021>', 'cfu/g'],
  ['Total Coliforms (BAM) (MOD)', 'BAM CH. 4', 'cfu/g'],
  ['E.Coli BAM (MOD)', 'BAM CH. 4', null],
  ['Salmonella', 'BAM CH. 5', null],
  ['Staphylococcus aureus', 'USP <2022>', 'cfu/g'],
  ['Yeast & Mold', 'USP <2021>', 'cfu/g'],
  ['Arsenic', 'USP <233>', 'ppm'],
  ['Cadmium', 'USP <233>', 'ppm'],
  ['Mercury', 'USP <233>', 'ppm'],
  ['Lead', 'USP <233>', 'ppm'],
];
// Decided A-20261027-005: internal only, never public, never called a claim.
const PRODOUGH_GLUTEN = { test_type: 'Gluten Allergen', evaluation: 'limit', comparator: '<', max_value: 20, unit: 'ppm', method: 'ELISA', specification: 'Internal limit < 20 ppm' };
const GF_CLAIM_GLUTEN = { test_type: 'Gluten Allergen', evaluation: 'limit', comparator: '<', max_value: 20, unit: 'ppm', method: 'ELISA', specification: '< 20 ppm (gluten-free claim)' };

/** Insert-only: a plan with the same name already there is left exactly as it is. */
export function seedCoaTestPlans(db, logAudit) {
  const has = db.prepare('SELECT 1 FROM coa_test_plans WHERE name = ?');
  const created = [];
  db.transaction(() => {
    if (!has.get(PRODOUGH_PLAN)) {
      created.push(insertPlan(db, { name: PRODOUGH_PLAN, brand_owner: 'ProDough', created_by: 'system',
        notes: 'Every ProDough SKU, every new production lot, before release. Limits other than gluten are entered by Quality.' },
      [...PRODOUGH_TESTS.map(([test_type, method, unit]) => ({ test_type, evaluation: 'limit', method, unit })), PRODOUGH_GLUTEN]));
    }
    if (!has.get(GF_PLAN)) {
      created.push(insertPlan(db, { name: GF_PLAN, brand_owner: 'ProDough', created_by: 'system',
        notes: 'Only for products that carry the gluten-free claim (Gluten Free Flour). The claim is supported for a lot only when every batch is under 20 ppm.' },
      [GF_CLAIM_GLUTEN]));
    }
  })();
  if (created.length) logAudit?.('system', 'create', 'coa_test_plans', null, { message: `seeded ${created.length} draft test plan(s)`, plans: created });
  return { created };
}

function insertPlan(db, plan, tests) {
  const id = uuid();
  db.prepare(`INSERT INTO coa_test_plans (id, name, brand_owner, version, status, supersedes_id, notes, created_by)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`).run(id, plan.name, plan.brand_owner || null, plan.version || 1, plan.supersedes_id || null, plan.notes || null, plan.created_by || null);
  writeTests(db, id, tests);
  return id;
}

function writeTests(db, planId, tests) {
  db.prepare('DELETE FROM coa_test_plan_tests WHERE plan_id = ?').run(planId);
  const ins = db.prepare(`INSERT INTO coa_test_plan_tests (id, plan_id, test_type, evaluation, comparator, min_value, max_value, unit, method, required, specification, sort, public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  tests.forEach((t, i) => ins.run(uuid(), planId, t.test_type, t.evaluation || 'limit', t.comparator || null, t.min_value ?? null, t.max_value ?? null,
    t.unit || null, t.method || null, t.required === 0 || t.required === false ? 0 : 1, t.specification || null, i, t.public ? 1 : 0));
}

export function getPlan(db, id) {
  const plan = db.prepare('SELECT * FROM coa_test_plans WHERE id = ?').get(id);
  if (!plan) return null;
  return { ...plan, tests: db.prepare('SELECT * FROM coa_test_plan_tests WHERE plan_id = ? ORDER BY sort, test_type').all(id) };
}

export function listPlans(db) {
  return db.prepare('SELECT * FROM coa_test_plans ORDER BY name, version DESC').all()
    .map(p => ({ ...getPlan(db, p.id), missing: planMissing(getPlan(db, p.id).tests), products: db.prepare('SELECT COUNT(*) c FROM coa_products WHERE plan_id = ?').get(p.id).c }));
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const fmt = (n) => (n == null ? '' : String(Number(n)));

/** Check one edited test row; returns [cleanRow, error]. */
export function cleanTest(t) {
  const test_type = String(t?.test_type || '').replace(/\s+/g, ' ').trim();
  if (test_type.length < 2) return [null, 'Every test needs a name.'];
  const evaluation = t.evaluation === 'report_only' ? 'report_only' : 'limit';
  const comparator = t.comparator ? String(t.comparator) : null;
  if (comparator && !COMPARATORS.includes(comparator)) return [null, `${test_type}: the comparison must be one of ${COMPARATORS.join(', ')}.`];
  const min_value = num(t.min_value); const max_value = num(t.max_value);
  if ((min_value != null && !Number.isFinite(min_value)) || (max_value != null && !Number.isFinite(max_value))) return [null, `${test_type}: a limit must be a number.`];
  return [{ test_type, evaluation, comparator, min_value, max_value, unit: String(t.unit || '').trim() || null,
    method: String(t.method || '').trim() || null, required: t.required === 0 || t.required === false ? 0 : 1,
    specification: String(t.specification || '').trim() || null,
    // Shown on the public certificate (D-247). Only a report-only test needs it:
    // a judged test is public by default; a report-only one is hidden unless ticked.
    public: t.public === true || t.public === 1 ? 1 : 0 }, null];
}

/** What stops this plan being approved, in words. An empty list means it may be. */
export function planMissing(tests) {
  const out = [];
  if (!tests?.length) out.push('The plan has no tests.');
  for (const t of tests || []) {
    if (t.evaluation !== 'limit' || !t.required) continue;
    const c = t.comparator;
    if (!c) { out.push(`${t.test_type}: choose how it is judged (below a limit, above, a range, or absent).`); continue; }
    if (c === 'absent') continue;
    if (c === 'range' && (t.min_value == null || t.max_value == null)) out.push(`${t.test_type}: enter both ends of the range.`);
    else if ((c === '<' || c === '<=') && t.max_value == null) out.push(`${t.test_type}: enter the limit.`);
    else if ((c === '>' || c === '>=') && t.min_value == null) out.push(`${t.test_type}: enter the limit.`);
    if (!t.unit) out.push(`${t.test_type}: enter the unit.`);
  }
  return out;
}

/** The printed wording of a limit when the plan does not give one. */
export function limitWording(t) {
  if (t.specification) return t.specification;
  if (t.evaluation === 'report_only') return 'Report';
  const u = t.unit ? ` ${t.unit}` : '';
  switch (t.comparator) {
    case '<': return `< ${fmt(t.max_value)}${u}`;
    case '<=': return `≤ ${fmt(t.max_value)}${u}`;
    case '>': return `> ${fmt(t.min_value)}${u}`;
    case '>=': return `≥ ${fmt(t.min_value)}${u}`;
    case 'range': return `${fmt(t.min_value)} – ${fmt(t.max_value)}${u}`;
    case 'absent': return 'Absent';
    default: return null;
  }
}

// The grader compares with ≤ / ≥. A strict limit ("< 20") is stored a hair
// inside the line, so a result of exactly 20 fails as the plan says.
const STRICT = (v) => Math.abs(v) * 1e-9 || 1e-9;
/** The coa_specifications limit fields a plan test produces. */
export function specFieldsFor(t) {
  const base = { test_type: t.test_type, unit: t.unit || null, method: t.method || null, specification: limitWording(t), min_value: null, max_value: null };
  if (t.evaluation !== 'limit') return base;
  switch (t.comparator) {
    case '<': return { ...base, max_value: t.max_value - STRICT(t.max_value) };
    case '<=': return { ...base, max_value: t.max_value };
    case '>': return { ...base, min_value: t.min_value + STRICT(t.min_value) };
    case '>=': return { ...base, min_value: t.min_value };
    case 'range': return { ...base, min_value: t.min_value, max_value: t.max_value };
    default: return base;   // 'absent' — the wording "Absent" is what the grader reads
  }
}

const close = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6));
const sameLimit = (spec, f) => close(spec.min_value, f.min_value) && close(spec.max_value, f.max_value)
  && String(spec.unit || '').trim().toLowerCase() === String(f.unit || '').trim().toLowerCase();

/** The plan ids in one plan's line of versions (same name). */
const lineage = (db, plan) => new Set(db.prepare('SELECT id FROM coa_test_plans WHERE name = ?').all(plan.name).map(r => r.id));

/**
 * What applying `plan` to these products would do, per product. Writes nothing.
 * The SAME function decides the apply, so the preview cannot promise one thing
 * and the apply do another.
 */
export function planApply(db, plan, itemNumbers) {
  const ours = lineage(db, plan);
  const fields = plan.tests.map(t => ({ t, f: specFieldsFor(t) }));
  return [...new Set(itemNumbers.map(s => String(s || '').trim()).filter(Boolean))].map(item_number => {
    const product = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(item_number);
    if (!product) return { item_number, status: 'NOT_A_PRODUCT', note: 'Add it to the product list first.' };
    const active = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(item_number);
    const idx = specIndex(active);
    const conflicts = []; const add = []; const change = []; const retire = []; const kept = [];
    const replaced = new Set();
    for (const { t, f } of fields) {
      const cur = idx.find(t.test_type);
      if (!cur) { add.push(t.test_type); continue; }
      replaced.add(cur.id);
      const fromUs = cur.plan_id && ours.has(cur.plan_id);
      if (!fromUs && (cur.min_value != null || cur.max_value != null) && !sameLimit(cur, f)) {
        conflicts.push(`${t.test_type}: the item already has ${cur.specification || `${cur.min_value ?? ''}–${cur.max_value ?? ''}`} ${cur.unit || ''} on file, approved outside this plan.`.replace(/\s+/g, ' '));
        continue;
      }
      if (sameLimit(cur, f) && (cur.specification || '') === (f.specification || '') && cur.plan_id === plan.id) kept.push(t.test_type);
      else change.push(t.test_type);
    }
    // Rows from an earlier version of this plan for a test the plan no longer has.
    for (const s of active) if (s.plan_id && ours.has(s.plan_id) && !replaced.has(s.id)) retire.push(s.test_type);
    const drafts = db.prepare("SELECT COUNT(*) c FROM coa_specifications WHERE item_number = ? AND COALESCE(approval_status,'approved') = 'draft'").get(item_number).c;
    const open = db.prepare('SELECT COUNT(*) c FROM coa_requests WHERE item_number = ? AND qa_signed_at IS NULL').get(item_number).c;
    return {
      item_number, display_name: product.display_name, status: conflicts.length ? 'CONFLICT' : 'ok',
      conflicts, add, change, retire, kept, drafts_to_supersede: drafts, open_requests: open,
    };
  });
}

/**
 * Apply an APPROVED plan. One transaction; a CONFLICT or a non-product is
 * skipped and reported, never forced. `audit(action, entity, id, details, prev, next, label)`.
 */
export function applyPlan(db, plan, itemNumbers, { by, audit }) {
  if (plan.status !== 'approved') throw new Error('Only an approved plan can be applied.');
  const ours = lineage(db, plan);
  const fields = plan.tests.map(t => ({ t, f: specFieldsFor(t) }));
  const out = { applied: [], skipped: [] };
  db.transaction(() => {
    for (const row of planApply(db, plan, itemNumbers)) {
      if (row.status !== 'ok') { out.skipped.push(row); continue; }
      const product = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(row.item_number);
      const active = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(row.item_number);
      const idx = specIndex(active);
      const description = product.display_name || db.prepare('SELECT item_description d FROM coa_requests WHERE item_number = ? ORDER BY created_at DESC LIMIT 1').get(row.item_number)?.d || row.item_number;
      const retireRow = (s) => {
        db.prepare("UPDATE coa_specifications SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(s.id);
        audit('retire', 'coa_specification', s.id, { reason: `replaced by test plan "${plan.name}" v${plan.version}`, plan_id: plan.id }, s, null, `${row.item_number} · ${s.test_type}`);
      };
      const touched = new Set();
      for (const { t, f } of fields) {
        const cur = idx.find(t.test_type);
        if (cur) touched.add(cur.id);
        // Already this plan's row, word for word: nothing to do (the preview said "kept").
        if (cur && cur.plan_id === plan.id && sameLimit(cur, f) && (cur.specification || '') === (f.specification || '')) continue;
        if (cur) retireRow(cur);
        db.prepare(`INSERT INTO coa_specifications (id, item_number, item_description, test_type, specification, unit, min_value, max_value, method,
            is_active, created_by, approval_status, source, plan_id, plan_version, approved_by, approved_at, spec_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'approved', ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), row.item_number, description, f.test_type, f.specification, f.unit, f.min_value, f.max_value, f.method, by,
            `plan:${plan.name} v${plan.version}`, plan.id, plan.version, plan.approved_by, plan.approved_at, plan.version);
      }
      for (const s of active) if (s.plan_id && ours.has(s.plan_id) && !touched.has(s.id)) retireRow(s);
      // A draft for the same test on this item is now answered by the plan.
      // Marked superseded — kept, never deleted — and its wording ("FDA
      // gluten-free labelling threshold") is not reused anywhere.
      const drafts = db.prepare("SELECT * FROM coa_specifications WHERE item_number = ? AND COALESCE(approval_status,'approved') = 'draft'").all(row.item_number);
      const draftIdx = specIndex(drafts);
      for (const { t } of fields) {
        const d = draftIdx.find(t.test_type);
        if (!d) continue;
        db.prepare("UPDATE coa_specifications SET approval_status = 'superseded', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND approval_status = 'draft'").run(by, d.id);
        audit('update', 'coa_specification', d.id, { superseded_draft: true, by_plan: plan.id }, d, null, `${row.item_number} · ${d.test_type}`);
      }
      db.prepare('UPDATE coa_products SET plan_id = ?, plan_version = ? WHERE item_number = ?').run(plan.id, plan.version, row.item_number);
      audit('update', 'coa_product', row.item_number, { applied_plan: plan.id, plan_name: plan.name, plan_version: plan.version, tests: fields.map(x => x.t.test_type) },
        { plan_id: product.plan_id, plan_version: product.plan_version }, { plan_id: plan.id, plan_version: plan.version }, row.item_number);
      out.applied.push(row);
    }
  })();
  return out;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Readiness, part 1 (A6): per COA product, whether its required tests are
 * defined and approved. Read-only.
 */
export function productReadiness(db) {
  const products = db.prepare('SELECT * FROM coa_products ORDER BY brand_owner, item_number').all();
  return products.map(p => {
    const plan = p.plan_id ? getPlan(db, p.plan_id) : null;
    const required = (plan?.tests || []).filter(t => t.required);
    const withLimit = required.filter(t => t.evaluation === 'report_only' || planMissing([t]).length === 0);
    let status;
    if (!plan) status = 'needs plan';
    else if (plan.status !== 'approved') status = 'plan draft';
    else if (withLimit.length < required.length) status = 'limits missing';
    else status = 'ready';
    return { item_number: p.item_number, display_name: p.display_name, slug: p.slug, brand_owner: p.brand_owner, gf_claim: !!p.gf_claim,
      plan_name: plan?.name || null, plan_version: plan?.version ?? null, plan_status: plan?.status || null,
      tests_required: required.length, tests_with_limit: withLimit.length, status };
  });
}

export const READINESS_WORDS = {
  ready: 'Ready: an approved plan with every limit.',
  'needs plan': 'No test plan applied yet.',
  'plan draft': 'Its plan is still a draft.',
  'limits missing': 'Its plan is missing a limit.',
};
