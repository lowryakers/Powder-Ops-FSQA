// The lot rule on the server (D-246, COA Phase 2 task D). The rule itself is
// `shared/coa-lot-readiness.js` (pure); this file loads a lot, records what
// each door decided, holds Quality's overrides, and builds the readiness
// report Lowry reads before switching the gate to strict.
//
//  · ONE MODE SWITCH. `app_settings.coa_release_gate` off / warn / on ("strict"
//    in words) governs both the five-category check (CAR 4990683-3, kept as it
//    was) and the lot rule. Off evaluates nothing and records nothing. Warn
//    evaluates, records what strict WOULD block, and blocks nothing. Strict
//    blocks. The default is warn and nothing here changes it.
//  · THE RULE APPLIES TO ITEMS ON THE COA PRODUCT LIST. An item nobody put on
//    the list (a client's raw material) is not judged by a ProDough rule. An
//    item on the list with no approved plan is "unknown" — strict blocks it.
//  · AN OVERRIDE opens the production sign-off door for one lot. It never makes
//    a certificate signable and never enables publishing.
import { v4 as uuid } from 'uuid';
import { GATE_MODES, specCoverage } from '../shared/spec-coverage.js';
import { lotReadiness, batchState } from '../shared/coa-lot-readiness.js';
import { splitLot } from '../shared/lot-model.js';
import { specIndex } from './coa-grade.js';
import { getPlan, productReadiness, READINESS_WORDS } from './coa-test-plans.js';
import { openUnreadItems, rereadCheck } from './coa-checks.js';

export const MIN_OVERRIDE_REASON = 10;
// Who publishes and withdraws a public certificate is an open decision; until
// it is made, publishing is an admin's act (D-247). Withdrawing is Quality's too.
export const canPublishCoa = (u) => u?.role === 'admin';
export const READINESS_TARGET = { warn_days: 30, false_block_window_days: 14 };

/** The release gate's mode. Unset or unreadable is WARN. */
export function gateMode(db) {
  try {
    const v = db.prepare("SELECT value FROM app_settings WHERE key = 'coa_release_gate'").get()?.value;
    return GATE_MODES.includes(v) ? v : 'warn';
  } catch { return 'warn'; }
}
export const MODE_WORDS = { off: 'off', warn: 'warn', on: 'strict' };

const matcher = (t, results) => specIndex(results).find(t) || null;
/** Does a plan test name answer to a result name? The same name rules as the grader. */
export const matcherFor = () => (planName, resultName) => !!specIndex([{ test_type: planName }]).find(resultName);

/** The COA product row for an item, and its plan (approved or not). */
export function productFor(db, itemNumber) {
  const product = db.prepare('SELECT * FROM coa_products WHERE item_number = ?').get(itemNumber);
  if (!product) return { product: null, plan: null };
  return { product, plan: product.plan_id ? getPlan(db, product.plan_id) : null };
}

/** Everything the rule reads about one lot. Synchronous; no PDF is read. */
export function loadLot(db, itemNumber, baseLot) {
  const requests = db.prepare(`SELECT id, lot_number, batch, retest_of, created_at, qa_signed_at, status, brand_owner
    FROM coa_requests WHERE item_number = ? AND base_lot = ? ORDER BY created_at`).all(itemNumber, baseLot)
    .map(r => ({ ...r, signed: !!r.qa_signed_at }));
  const resultsByRequest = {};
  const res = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ?');
  for (const r of requests) resultsByRequest[r.id] = res.all(r.id);
  const openUnread = new Set(requests.filter(r => openUnreadItems(db, r.id).length).map(r => r.id));
  return { requests, resultsByRequest, openUnread };
}

/** The lot, judged. `reread: true` reads every lab report again (publishing). */
export async function evaluateLot(db, itemNumber, baseLot, { reread = false, uploadDir = null, assumeSigned = null } = {}) {
  const { product, plan } = productFor(db, itemNumber);
  const lot = loadLot(db, itemNumber, baseLot);
  const rr = {};
  if (reread && uploadDir) {
    for (const r of lot.requests) rr[r.id] = await rereadCheck(db, { id: r.id }, uploadDir);
  }
  const out = lotReadiness({ ...lot, plan, reread: rr, gfClaim: !!product?.gf_claim, match: matcher, assumeSigned });
  return { ...out, item_number: itemNumber, base_lot: baseLot, product, plan, on_list: !!product, rereads: rr };
}
export function evaluateLotSync(db, itemNumber, baseLot, opts = {}) {
  const { product, plan } = productFor(db, itemNumber);
  const lot = loadLot(db, itemNumber, baseLot);
  const out = lotReadiness({ ...lot, plan, gfClaim: !!product?.gf_claim, match: matcher, assumeSigned: opts.assumeSigned || null });
  return { ...out, item_number: itemNumber, base_lot: baseLot, product, plan, on_list: !!product };
}

// ── Events ──────────────────────────────────────────────────────────────────
export function recordGateEvent(db, e) {
  const id = uuid();
  db.prepare(`INSERT INTO coa_gate_events (id, door, request_id, entry_id, base_lot, item_number, mode, would_block, blocked, reasons, overridden, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, e.door, e.request_id || null, e.entry_id || null, e.base_lot || null, e.item_number || null,
    e.mode, e.would_block ? 1 : 0, e.blocked ? 1 : 0, JSON.stringify(e.reasons || []), e.overridden ? 1 : 0, e.actor || null);
  return id;
}

// ── Overrides ───────────────────────────────────────────────────────────────
export function activeOverride(db, itemNumber, baseLot) {
  return db.prepare('SELECT * FROM coa_lot_overrides WHERE item_number = ? AND base_lot = ? AND revoked_at IS NULL ORDER BY at DESC').get(itemNumber, baseLot) || null;
}
export const overridesInForce = (db) => db.prepare('SELECT * FROM coa_lot_overrides WHERE revoked_at IS NULL ORDER BY at DESC').all();

// ── The sign door (the batch being signed) ──────────────────────────────────
/**
 * At signing, judge THIS batch (it is about to be signed, so "not signed" is
 * not held against it; other batches are not its problem yet). Returns
 * `{ applies, mode, block, reasons, lot }`. Strict blocks; warn records.
 */
export function signDoor(db, request, { actor } = {}) {
  const mode = gateMode(db);
  if (mode === 'off') return { applies: false, mode };
  const { product, plan } = productFor(db, request.item_number);
  if (!product) return { applies: false, mode };
  const base = request.base_lot || splitLot(request.lot_number).base_lot;
  const lot = loadLot(db, request.item_number, base);
  const approved = plan && plan.status === 'approved';
  const mine = batchState({ request: { ...request, signed: true }, results: lot.resultsByRequest[request.id] || [],
    plan: approved ? plan : null, unreadOpen: lot.openUnread.has(request.id), match: matcher, assumeSigned: true });
  const reasons = approved ? mine.reasons : ['no required tests defined (no approved test plan)', ...mine.reasons];
  const would = reasons.length > 0;
  const block = would && mode === 'on';
  recordGateEvent(db, { door: 'coa_sign', request_id: request.id, base_lot: base, item_number: request.item_number, mode,
    would_block: would, blocked: block, reasons, actor });
  return { applies: true, mode, block, would_block: would, reasons };
}

// ── The production QA sign-off door ─────────────────────────────────────────
const nameKey = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** The COA product a production entry's product name names: display name or an alias, exactly. Never a substring. */
export function productForName(db, productName) {
  const k = nameKey(productName);
  if (!k) return null;
  for (const p of db.prepare('SELECT * FROM coa_products').all()) {
    const names = [p.display_name, ...(() => { try { return JSON.parse(p.aliases || '[]'); } catch { return []; } })()];
    if (names.some(n => nameKey(n) === k)) return p;
  }
  return null;
}

/** Each (product, base lot) a production entry names: line 0 and every MO line. */
export function entryLots(entry) {
  const lines = (() => { try { return JSON.parse(entry.mo_lines || '[]'); } catch { return []; } })();
  const pairs = [[entry.product_name, entry.lot_number], ...lines.map(l => [l.product_name, l.lot_number])];
  const seen = new Set(); const out = [];
  for (const [name, lotNo] of pairs) {
    const base = splitLot(lotNo).base_lot;
    if (!name || !base) continue;
    const key = `${nameKey(name)}|${base}`;
    if (!seen.has(key)) { seen.add(key); out.push({ product_name: name, base_lot: base }); }
  }
  return out;
}

/**
 * The production sign-off door. For each lot on the entry that maps to a COA
 * product: off → nothing; warn → the sign-off goes ahead and the lot's state is
 * returned and recorded; strict → refused unless an override is in force.
 */
export function productionDoor(db, entry, { actor } = {}) {
  const mode = gateMode(db);
  if (mode === 'off') return { applies: false, mode, lots: [] };
  const lots = [];
  for (const { product_name, base_lot } of entryLots(entry)) {
    const product = productForName(db, product_name);
    if (!product) continue;
    const lot = evaluateLotSync(db, product.item_number, base_lot);
    const override = activeOverride(db, product.item_number, base_lot);
    const would = !lot.met;
    const block = would && mode === 'on' && !override;
    const reasons = [...lot.problems, ...lot.at_fault.map(b => `batch ${b.batch ?? '—'}: ${b.reasons.join('; ')}`)];
    recordGateEvent(db, { door: 'production_qa_signoff', entry_id: entry.id, base_lot, item_number: product.item_number, mode,
      would_block: would, blocked: block, reasons, overridden: would && !!override, actor });
    lots.push({ item_number: product.item_number, display_name: product.display_name, base_lot, met: lot.met, state: lot.state,
      summary: `COA: ${lot.summary}`, reasons, overridden: would && !!override, block });
  }
  return { applies: lots.length > 0, mode, lots, block: lots.some(l => l.block) };
}

// ── Readiness (task D6) ─────────────────────────────────────────────────────
function recentLots(db, days = 60) {
  return db.prepare(`SELECT DISTINCT r.item_number, r.base_lot FROM coa_requests r
    JOIN coa_products p ON p.item_number = r.item_number
    WHERE r.base_lot IS NOT NULL AND r.created_at >= datetime('now', ?) ORDER BY r.item_number, r.base_lot`).all(`-${days} days`);
}

/** The one page Lowry reads before strict. Read-only; it never changes a mode. */
export function coaReadiness(db, { publicState = null } = {}) {
  const mode = gateMode(db);
  const products = productReadiness(db);
  const prodough = products.filter(p => p.brand_owner === 'ProDough');
  const lots = recentLots(db).map(l => evaluateLotSync(db, l.item_number, l.base_lot))
    .map(l => ({ item_number: l.item_number, base_lot: l.base_lot, display_name: l.product?.display_name || null, state: l.state, met: l.met,
      summary: l.summary, problems: l.problems,
      at_fault: l.at_fault.map(b => ({ batch: b.batch, lot_number: b.lot_number, request_id: b.request_id, reasons: b.reasons })) }));
  const would_block = lots.filter(l => !l.met);
  const unlinked = db.prepare(`SELECT COUNT(*) c FROM coa_test_results t JOIN coa_requests r ON r.id = t.request_id
    WHERE t.specification_id IS NULL AND r.qa_signed_at IS NULL`).get().c;
  const items = (() => { try { return db.prepare("SELECT kind, COUNT(*) c FROM coa_review_items WHERE status = 'open' AND kind IN ('UNREAD_ROWS','SPEC_LINK_REVIEW') GROUP BY kind").all(); } catch { return []; } })();
  const golden = db.prepare('SELECT * FROM coa_golden_attestations ORDER BY at DESC LIMIT 1').get() || null;
  const goldenAgeDays = golden ? Math.floor((Date.now() - Date.parse(`${golden.at.replace(' ', 'T')}Z`)) / 86400000) : null;
  const planLive = db.prepare("SELECT MIN(approved_at) a FROM coa_test_plans WHERE approved_at IS NOT NULL").get()?.a || null;
  const warnSince = planLive ? Math.floor((Date.now() - Date.parse(`${planLive.replace(' ', 'T')}Z`)) / 86400000) : null;
  const reviews = db.prepare(`SELECT review, COUNT(*) c FROM coa_gate_events WHERE would_block = 1 AND review IS NOT NULL GROUP BY review`).all();
  const falseRecent = db.prepare(`SELECT COUNT(*) c FROM coa_gate_events WHERE review = 'false_block' AND reviewed_at >= datetime('now', ?)`)
    .get(`-${READINESS_TARGET.false_block_window_days} days`).c;
  const unreviewed = db.prepare('SELECT COUNT(*) c FROM coa_gate_events WHERE would_block = 1 AND review IS NULL').get().c;
  const overrides = overridesInForce(db);
  const categoryShort = products.map(p => {
    const specs = db.prepare('SELECT test_type FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(p.item_number);
    return { item_number: p.item_number, display_name: p.display_name, missing: specCoverage(specs).missing };
  }).filter(c => c.missing.length);
  const count = (k) => items.find(i => i.kind === k)?.c || 0;
  const lines = [
    { key: 'plans', ok: prodough.length > 0 && prodough.every(p => p.status === 'ready'),
      text: `ProDough products with an approved plan and every limit: ${prodough.filter(p => p.status === 'ready').length} of ${prodough.length}.` },
    { key: 'would_block', ok: would_block.length === 0, text: `What strict would block today: ${would_block.length} lot${would_block.length === 1 ? '' : 's'} (last 60 days).` },
    { key: 'categories', ok: categoryShort.length === 0,
      text: categoryShort.length ? `Strict also holds a certificate whose specifications do not cover all five categories (identity, purity, strength, composition, contaminants — CAR 4990683-3). Products on the list short of one: ${categoryShort.length} (${categoryShort.slice(0, 8).map(c => `${c.display_name || c.item_number}: ${c.missing.join(', ')}`).join('; ')}${categoryShort.length > 8 ? '; …' : ''}).`
        : 'Every product on the list has specifications covering all five categories.' },
    { key: 'unlinked', ok: unlinked === 0, text: `Results with no linked specification on unsigned requests: ${unlinked}.` },
    { key: 'items', ok: count('UNREAD_ROWS') + count('SPEC_LINK_REVIEW') === 0,
      text: `Open QA Review items: ${count('UNREAD_ROWS')} with unread lines, ${count('SPEC_LINK_REVIEW')} with results that do not match the specification.` },
    { key: 'golden', ok: !!golden && golden.mismatches === 0 && golden.unread_rows === 0,
      text: golden ? `Golden-file run recorded ${goldenAgeDays} day${goldenAgeDays === 1 ? '' : 's'} ago: ${golden.pdfs_read} PDFs, ${golden.mismatches} mismatches, ${golden.unread_rows} unread lines.` : 'No golden-file run recorded yet.' },
    { key: 'warn_days', ok: warnSince != null && warnSince >= READINESS_TARGET.warn_days && falseRecent === 0,
      text: warnSince == null ? 'No test plan approved yet, so warn mode has not started counting.'
        : `${warnSince} day${warnSince === 1 ? '' : 's'} in warn since the first plan was approved (target ${READINESS_TARGET.warn_days}); would-blocks reviewed: ${reviews.find(r => r.review === 'correct')?.c || 0} correct, ${reviews.find(r => r.review === 'false_block')?.c || 0} false (${falseRecent} false in the last ${READINESS_TARGET.false_block_window_days} days; target 0); ${unreviewed} not reviewed yet.` },
    { key: 'overrides', ok: true, text: `Overrides in force: ${overrides.length}.` },
    { key: 'public', ok: true, text: publicState ? `Public certificate page: ${publicState.enabled === 'on' ? 'ON' : 'off'}; ProDough publishing ${publicState.brand_allowed ? 'allowed' : 'not allowed'}; search engines ${publicState.indexable === 'on' ? 'allowed' : 'blocked'}.` : 'Public certificate page: off.' },
  ];
  return {
    mode, mode_words: MODE_WORDS[mode], lines, headline: `What strict would block today: ${would_block.length} lot${would_block.length === 1 ? '' : 's'}`,
    products, counts: products.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {}), words: READINESS_WORDS,
    lots, would_block, category_short: categoryShort, unlinked_results: unlinked, golden, overrides, warn_days: warnSince, false_blocks_recent: falseRecent, unreviewed_would_blocks: unreviewed,
  };
}

/** What Maria needs to look at today (the QA Review "COA readiness" source). */
export function readinessActions(db) {
  const out = [];
  for (const p of productReadiness(db).filter(x => x.status !== 'ready')) {
    out.push({ id: `plan:${p.item_number}`, kind: 'product', title: `${p.display_name || p.item_number}: ${READINESS_WORDS[p.status] || p.status}`, item_number: p.item_number });
  }
  for (const e of db.prepare(`SELECT * FROM coa_gate_events WHERE would_block = 1 AND review IS NULL ORDER BY at DESC LIMIT 200`).all()) {
    out.push({ id: `event:${e.id}`, kind: 'would_block', event_id: e.id, title: `Strict would have blocked lot ${e.base_lot} (${e.item_number}) at ${e.door === 'coa_sign' ? 'certificate signing' : 'production QA sign-off'} — is that right?`,
      reasons: (() => { try { return JSON.parse(e.reasons || '[]'); } catch { return []; } })(), at: e.at, item_number: e.item_number, base_lot: e.base_lot });
  }
  return out;
}
