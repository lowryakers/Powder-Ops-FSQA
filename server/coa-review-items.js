// COA corrections — the decisions of A-20261027-001/002, waiting on Maria (D-236).
//
// Forty-three COA requests need a person to act on them: re-sign a certificate
// whose gluten line was misread ("<44" for "<4"), un-sign certificates issued on
// failed lots, correct one unsigned request, and delete twenty-one empty
// duplicate imports. The decisions were made; DOING them is Maria's, in the app.
// This module never un-signs, corrects or deletes anything itself.
//
//  · `seedCoaPhase1ReviewItems` files the 43 items once, additive, INSERT OR
//    IGNORE on `item_key`. It never updates a row and never touches a request.
//  · `itemProgress` DERIVES each item's steps from the request and the audit
//    log on every read. Nothing is ticked by hand, and a GET writes nothing.
//  · `coaCorrectionAllowed` is the one narrow door: a QA reviewer may un-sign or
//    delete exactly the requests an open, unfinished item names — nothing else.
//  · `coaSignHold` holds the failed Cookie Crumble 101706 request (8afd7fbe…)
//    unsigned while its item is open. No other request is ever held here.

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { isQaReviewer } from './qa-signing.js';
import { unreadRowsFor } from './coa-checks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DECISION = 'A-20261027-001';
export const SEED_MARKER = 'coa_phase1_review_items_seeded_v1';
export const SEED_FILE = path.join(__dirname, 'seed', 'coa-phase1-review-items.json');

export const RETEST_ID = '9e8cb2b4-3e5d-49f1-bc3b-99327147d012';
export const HELD_ID = '8afd7fbe-3ed0-4257-b22b-95c16eccff75';

export const KINDS = {
  RESIGN: { label: 'Re-sign', steps: ['unsign', 'gluten', 'resign'], authorizes: ['unsign'] },
  UNSIGN_CORRECT_NO_RESIGN: { label: 'Un-sign and correct — do not re-sign', steps: ['unsign', 'gluten'], authorizes: ['unsign'] },
  UNSIGN_FAILED: { label: 'Un-sign', steps: ['unsign'], authorizes: ['unsign'] },
  CORRECT_ONLY: { label: 'Correct', steps: ['gluten'], authorizes: [] },
  DELETE_DUPLICATE: { label: 'Delete duplicate', steps: ['delete'], authorizes: ['delete'] },
  // D-242: a pair that MAY be one test entered twice. Maria decides; it grants
  // no un-sign and no delete — an admin deletes the record she marks.
  POSSIBLE_DUPLICATE: { label: 'Possible duplicate', steps: ['decide', 'remove'], authorizes: [] },
  // D-243: lines of a lab report the reader could not read. Each is added as a
  // result or answered with a reason; while any is open the certificate cannot
  // be signed. Grants nothing.
  UNREAD_ROWS: { label: 'Lines the app could not read', steps: ['resolve'], authorizes: [] },
  // D-245: results on an unsigned request that could not be linked to the
  // specification on file by the admin-run link script — the stored verdict
  // disagrees with the approved limit, or no single spec matches. Opening each
  // result and saving it (with a reason if the verdict is set by hand) links
  // it. Grants nothing. Filed ONLY by `coa-link-results-to-specs.mjs --apply --file-items`.
  SPEC_LINK_REVIEW: { label: 'Results that do not match the specification', steps: ['link'], authorizes: [] },
};

const STEP_LABEL = {
  unsign: 'Un-sign (with a reason)',
  gluten: 'Correct the gluten result to <4 ppm',
  resign: 'Sign again',
  delete: 'Delete the duplicate',
  decide: 'Decide: the same test, or not',
  remove: 'An admin deletes the record marked',
  results: 'Delete the result lines entered twice',
};

const itemKey = (kind, requestId) => `coa-p1:${kind}:${requestId}`;

export function loadSeedItems() {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')).items;
}

// The words Maria reads, templated from the seed row. Plain language; the
// ids and lot are the record's own.
function textFor(s) {
  const lot = s.lot ? `Lot ${s.lot}` : '';
  const item = s.item_number || s.item_description || '';
  const GLUTEN_REASON = `Stored gluten value is "<44 ppm"; the CTLA report prints "<4 ppm" (MDL 4). The reader merged two table cells. Decision ${DECISION}.`;
  switch (s.kind) {
    case 'RESIGN': return {
      title: [item, lot, 'Correct gluten and re-sign'].filter(Boolean).join(' · '),
      recommended_action: 'Un-sign (with reason), correct the gluten result to <4 ppm, then sign again. The new certificate gets a new number and date.',
      reason: GLUTEN_REASON + (s.note === 'dupGluten=Y' ? ' This request carries the gluten result twice; keep one row.' : ''),
      note: s.request_id === RETEST_ID
        ? 'Treated as the valid re-test that followed the failed request 8afd7fbe (decision A-20261027-002). The two lab reports for this lot differ on Yeast & Mold (200 vs 500 cfu/g); the re-test is the later, passing one.'
        : null,
    };
    case 'UNSIGN_CORRECT_NO_RESIGN': return {
      title: [item, lot, 'Un-sign and correct — do not re-sign'].filter(Boolean).join(' · '),
      recommended_action: 'Un-sign (with reason) and correct the gluten value. Do NOT sign again.',
      reason: `Signed on a failed lot: Yeast & Mold 500 cfu/g failed. Its re-test is request 9e8cb2b4. The gluten line also reads "<44 ppm" where the report prints "<4 ppm". Decision ${DECISION}.`,
      note: 'This request cannot be signed while this item is open. An admin can dismiss the item with a reason to lift the hold.',
    };
    case 'UNSIGN_FAILED': return {
      title: [item, lot, 'Un-sign: failed lot'].filter(Boolean).join(' · '),
      recommended_action: 'Un-sign (with reason). It stays on file as fail / re-test with no certificate.',
      reason: `A certificate was signed on a lot that failed: ${s.note}… (the full list is on the request). Decision ${DECISION}.`,
      note: null,
    };
    case 'CORRECT_ONLY': return {
      title: [item, lot, 'Correct gluten'].filter(Boolean).join(' · '),
      recommended_action: 'Correct the gluten result to <4 ppm (not signed, so no un-sign).',
      reason: GLUTEN_REASON,
      note: `The lab prints lot "${s.lot}" (likely 101691-1). Confirm the lot spelling with CTLA; do not change it silently.`,
    };
    case 'DELETE_DUPLICATE': return {
      title: [s.item_description, lot, 'Delete empty duplicate'].filter(Boolean).join(' · '),
      recommended_action: `Delete this empty duplicate (no results, no file, not signed). The same lab report is already on request ${s.canonical_request_id}.`,
      reason: `Imported twice from one lab report (source ctla_coa_upload) with nothing on it. Decision ${DECISION}.`,
      note: null,
    };
    default: return { title: s.request_id, recommended_action: null, reason: null, note: null };
  }
}

function evidenceFor(s) {
  const ev = [{ kind: 'request', label: 'Open the request', request_id: s.request_id }];
  if (s.kind === 'DELETE_DUPLICATE') {
    ev.push({ kind: 'request', label: 'The request that keeps the report', request_id: s.canonical_request_id });
    ev.push({ kind: 'file', label: s.file_name, file_id: s.file_id, request_id: s.canonical_request_id });
  } else {
    ev.push({ kind: 'file', label: s.file_name, file_id: s.file_id, request_id: s.request_id });
  }
  if (['RESIGN', 'UNSIGN_CORRECT_NO_RESIGN', 'CORRECT_ONLY'].includes(s.kind)) {
    ev.push({ kind: 'line', label: 'Gluten Allergen · ELISA · MDL 4 · report prints <4 ppm; stored <44 ppm' });
  }
  if (s.kind === 'UNSIGN_FAILED') ev.push({ kind: 'line', label: `Failing rows: ${s.note}` });
  return ev;
}

/**
 * File the 43 items, once. Additive: INSERT OR IGNORE on item_key, a request
 * that does not exist is skipped, nothing is updated. The marker is written
 * only once coa_requests has rows — on a fresh database the COA history is
 * seeded later, and marking it done then would mean it never runs.
 */
export function seedCoaPhase1ReviewItems(db, logAudit, { items = loadSeedItems() } = {}) {
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SEED_MARKER)) return { already: true, inserted: 0, skipped: 0 };
  if (!db.prepare('SELECT COUNT(*) c FROM coa_requests').get().c) return { waiting: true, inserted: 0, skipped: 0 };
  const exists = db.prepare('SELECT 1 FROM coa_requests WHERE id = ?');
  const insert = db.prepare(`INSERT OR IGNORE INTO coa_review_items
    (id, item_key, kind, request_id, title, recommended_action, reason, evidence, steps, decision_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inserted = 0, skipped = 0;
  db.transaction(() => {
    for (const s of items) {
      if (!KINDS[s.kind] || !exists.get(s.request_id)) { skipped++; continue; }
      const t = textFor(s);
      const info = insert.run(uuid(), itemKey(s.kind, s.request_id), s.kind, s.request_id, t.title, t.recommended_action, t.reason,
        JSON.stringify(evidenceFor(s)), JSON.stringify({ steps: KINDS[s.kind].steps, note: t.note, seed: s }),
        s.request_id === RETEST_ID ? 'A-20261027-001; A-20261027-002' : DECISION);
      inserted += info.changes;
    }
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(SEED_MARKER, new Date().toISOString());
  })();
  logAudit?.('system', 'create', 'coa_review_items', null,
    { message: `seeded ${inserted} items, decision ${DECISION}`, inserted, skipped, decision: DECISION });
  return { inserted, skipped };
}

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// The latest un-sign of this request recorded after the item was filed.
function lastUnsign(db, item) {
  return db.prepare(`SELECT timestamp FROM audit_log WHERE entity_type = 'coa_request' AND entity_id = ?
    AND action = 'unsign' AND timestamp >= ? ORDER BY timestamp DESC, id DESC LIMIT 1`).get(item.request_id, item.created_at)?.timestamp || null;
}

const isGluten = (r) => /gluten/i.test(r.test_type || '');
/** Exactly one gluten row, named "Gluten Allergen", reading <4 ppm, and no <44 left. */
export function glutenCorrected(results) {
  const g = results.filter(isGluten);
  if (results.some(r => /<\s*44/.test(String(r.result_value ?? '')))) return false;
  if (g.length !== 1) return false;
  const r = g[0];
  return String(r.test_type || '').trim().toLowerCase() === 'gluten allergen'
    && String(r.result_value ?? '').replace(/\s+/g, '') === '<4'
    && String(r.unit || '').trim().toLowerCase() === 'ppm';
}

/**
 * Where an item stands, derived. Steps tick themselves from the request and
 * the audit log; nothing here writes.
 */
export function itemProgress(db, item) {
  if (item.kind === 'POSSIBLE_DUPLICATE') return possibleProgress(db, item);
  if (item.kind === 'UNREAD_ROWS') return unreadProgress(db, item);
  if (item.kind === 'SPEC_LINK_REVIEW') return specLinkProgress(db, item);
  const kind = KINDS[item.kind];
  const req = db.prepare('SELECT id, qa_signed_at FROM coa_requests WHERE id = ?').get(item.request_id);
  if (!req) {
    const steps = kind.steps.map(k => ({ key: k, label: STEP_LABEL[k], done: k === 'delete' }));
    return { steps, complete: true, gone: true, blockedBy: null };
  }
  const signed = !!req.qa_signed_at;
  const unsignAt = lastUnsign(db, item);
  const results = db.prepare('SELECT test_type, result_value, unit FROM coa_test_results WHERE request_id = ?').all(item.request_id);
  const done = {
    unsign: !!unsignAt && (!signed || req.qa_signed_at >= unsignAt),
    gluten: glutenCorrected(results),
    resign: signed && !!unsignAt && req.qa_signed_at >= unsignAt,
    delete: false,
  };
  const steps = kind.steps.map(k => ({ key: k, label: STEP_LABEL[k], done: done[k] }));
  let blockedBy = null;
  const next = steps.find(s => !s.done);
  if (next?.key === 'gluten' && signed) blockedBy = 'The certificate is signed, so its results are closed — un-sign it first.';
  if (next?.key === 'resign' && !done.gluten) blockedBy = 'Correct the gluten result before signing again.';
  return { steps, complete: steps.every(s => s.done), gone: false, blockedBy };
}

/**
 * A possible duplicate (D-242), derived. A pair is settled once either record
 * is gone; Maria's recorded decision ticks the first step. A single record
 * whose results were entered twice is settled once no result line repeats.
 */
export function possibleProgress(db, item) {
  const seed = parse(item.steps, {})?.seed || {};
  const get = db.prepare('SELECT id, qa_signed_at FROM coa_requests WHERE id = ?');
  if (!seed.id_b) {
    const req = get.get(item.request_id);
    if (!req) return { steps: [{ key: 'results', label: STEP_LABEL.results, done: true }], complete: true, gone: true, blockedBy: null };
    const repeats = db.prepare(`SELECT COUNT(*) c FROM (SELECT 1 FROM coa_test_results WHERE request_id = ?
      GROUP BY LOWER(TRIM(test_type)), TRIM(COALESCE(result_value, '')), LOWER(TRIM(COALESCE(unit, ''))),
        COALESCE(specification_id, ''), TRIM(COALESCE(notes, '')) HAVING COUNT(*) > 1)`).get(req.id).c;
    const steps = [{ key: 'results', label: STEP_LABEL.results, done: repeats === 0 }];
    return { steps, complete: repeats === 0, gone: false,
      blockedBy: repeats && req.qa_signed_at ? 'The record is signed, so its results are closed — an admin un-signs it first.' : null };
  }
  const a = get.get(seed.id_a), b = get.get(seed.id_b);
  const settled = !a || !b;
  const decision = parse(item.decision, null);
  const marked = decision ? (decision.remove === 'B' ? b : a) : null;
  const steps = [
    { key: 'decide', label: STEP_LABEL.decide, done: !!decision || settled },
    { key: 'remove', label: decision ? `An admin deletes record ${decision.remove}` : STEP_LABEL.remove, done: settled },
  ];
  let blockedBy = null;
  if (decision && !settled) blockedBy = marked?.qa_signed_at
    ? `Record ${decision.remove} is signed — an admin un-signs it, then deletes it.`
    : `Waiting for an admin to delete record ${decision.remove}.`;
  return { steps, complete: settled, gone: settled, blockedBy };
}

/**
 * Maria's answer on a possible duplicate: the same test, and which record
 * goes. Recorded on the item; nothing is deleted here.
 */
export function recordDuplicateDecision(db, user, id, { remove, reason }) {
  const item = db.prepare('SELECT * FROM coa_review_items WHERE id = ? OR item_key = ?').get(id, id);
  if (!item) return { status: 404, error: 'No such correction item.' };
  if (item.kind !== 'POSSIBLE_DUPLICATE') return { status: 400, error: 'Only a possible duplicate takes this decision.' };
  if (item.status !== 'open') return { status: 409, error: 'This item is already closed.' };
  const seed = parse(item.steps, {})?.seed || {};
  if (!seed.id_b) return { status: 400, error: 'This item is about one record; delete the repeated result lines on it, or dismiss it.' };
  if (!['A', 'B'].includes(remove)) return { status: 400, error: 'Say which record goes: A or B.' };
  if (possibleProgress(db, item).complete) return { status: 409, error: 'One of the two records is already gone.' };
  const decision = { remove, remove_id: remove === 'A' ? seed.id_a : seed.id_b, keep_id: remove === 'A' ? seed.id_b : seed.id_a,
    reason, by: user.name, at: new Date().toISOString() };
  db.prepare('UPDATE coa_review_items SET decision = ? WHERE id = ?').run(JSON.stringify(decision), item.id);
  return { item: db.prepare('SELECT * FROM coa_review_items WHERE id = ?').get(item.id), before: item, decision };
}

/** Lines the app could not read (D-243): done when each is added as a result or answered. */
export function unreadProgress(db, item) {
  if (!db.prepare('SELECT 1 FROM coa_requests WHERE id = ?').get(item.request_id)) {
    return { steps: [{ key: 'resolve', label: 'Add or answer each line', done: true }], complete: true, gone: true, blockedBy: null };
  }
  const fileId = parse(item.steps, {})?.file_id ?? null;
  const rows = unreadRowsFor(db, item.request_id, fileId);
  const open = rows.filter(r => r.state === 'open').length;
  const steps = [{ key: 'resolve', label: `Add each line as a result, or say why it is not one (${rows.length - open} of ${rows.length} done)`, done: open === 0 }];
  return { steps, complete: open === 0, gone: false, blockedBy: null, lines: rows };
}

/** Done when every listed result is linked to a specification, or gone. */
export function specLinkProgress(db, item) {
  const ids = parse(item.steps, {})?.result_ids || [];
  const req = db.prepare('SELECT qa_signed_at FROM coa_requests WHERE id = ?').get(item.request_id);
  if (!req) return { steps: [{ key: 'link', label: 'Open each result and save it', done: true }], complete: true, gone: true, blockedBy: null };
  const rows = ids.map(id => db.prepare('SELECT id, specification_id FROM coa_test_results WHERE id = ?').get(id));
  const left = rows.filter(r => r && !r.specification_id).length;
  const steps = [{ key: 'link', label: `Open each result and save it against the specification (${ids.length - left} of ${ids.length} done)`, done: left === 0 }];
  return { steps, complete: left === 0, gone: false,
    blockedBy: left && req.qa_signed_at ? 'The certificate is signed, so its results are closed — un-sign it first.' : null };
}

// D-256: the pile is worked most dangerous first. A signed certificate that is
// wrong can already be in a customer's hands; an empty duplicate harms nobody.
// It used to sort by the kind's code name, which put the 21 signed
// certificates under 80 duplicate cards.
export const RISK_ORDER = Object.freeze([
  'UNSIGN_FAILED', 'UNSIGN_CORRECT_NO_RESIGN', 'RESIGN', 'CORRECT_ONLY',
  'UNREAD_ROWS', 'SPEC_LINK_REVIEW', 'DELETE_DUPLICATE', 'POSSIBLE_DUPLICATE',
]);
const riskRank = (kind) => { const i = RISK_ORDER.indexOf(kind); return i < 0 ? RISK_ORDER.length : i; };

// Empty duplicates of the same kept request are one card on the screen, so
// they sort next to each other.
const groupKeyOf = (item) => {
  if (item.kind !== 'DELETE_DUPLICATE') return null;
  const canon = parse(item.steps, {})?.seed?.canonical_request_id;
  return canon ? `keeps:${canon}` : null;
};

/** Open items with their derived progress, most dangerous first. */
export function openItems(db) {
  return db.prepare("SELECT * FROM coa_review_items WHERE status = 'open'").all()
    .map(i => ({ ...i, progress: itemProgress(db, i), group_key: groupKeyOf(i) }))
    .sort((a, b) => riskRank(a.kind) - riskRank(b.kind)
      || String(a.group_key || '').localeCompare(String(b.group_key || ''))
      || String(a.created_at || '').localeCompare(String(b.created_at || ''))
      || String(a.item_key).localeCompare(String(b.item_key)));
}

/** The pile: open and not yet complete. */
export const pendingItems = (db) => openItems(db).filter(i => !i.progress.complete);

/**
 * May this user un-sign / delete this request? An admin, as before; or a QA
 * reviewer while an OPEN, unfinished item for exactly this request authorizes
 * exactly this action. Returns the item that authorizes it (null for an admin
 * acting without one), or false.
 */
export function coaCorrectionAllowed(db, user, requestId, action) {
  const item = itemFor(db, requestId, action);
  if (user?.role === 'admin') return { admin: true, item };
  if (!isQaReviewer(user) || !item) return false;
  return { admin: false, item };
}

function itemFor(db, requestId, action) {
  let rows;
  try { rows = db.prepare("SELECT * FROM coa_review_items WHERE request_id = ? AND status = 'open'").all(requestId); } catch { return null; }
  return rows.find(i => KINDS[i.kind]?.authorizes.includes(action) && !itemProgress(db, i).complete) || null;
}

/** The correction flags the COA screen reads instead of `role === 'admin'`. */
export function correctionFlags(db, user, requestId) {
  const u = coaCorrectionAllowed(db, user, requestId, 'unsign');
  const d = coaCorrectionAllowed(db, user, requestId, 'delete');
  return { unsign: !!u, delete: !!d, item_key: (u && u.item?.item_key) || (d && d.item?.item_key) || null };
}

/** Why a delete authorized by a DELETE_DUPLICATE item is refused; null when it may go ahead. */
export function duplicateDeleteRefusal(db, requestId, item) {
  const seed = parse(item.steps, {})?.seed || {};
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(requestId);
  if (!r) return 'The request no longer exists.';
  if (r.qa_signed_at) return 'It is signed.';
  if (db.prepare('SELECT COUNT(*) c FROM coa_test_results WHERE request_id = ?').get(requestId).c) return 'It has test results.';
  if (db.prepare('SELECT COUNT(*) c FROM coa_files WHERE request_id = ?').get(requestId).c) return 'It has files attached.';
  if (r.source !== 'ctla_coa_upload') return `Its source is "${r.source || 'none'}", not ctla_coa_upload.`;
  const canon = seed.canonical_request_id;
  if (!canon || !db.prepare('SELECT COUNT(*) c FROM coa_files WHERE request_id = ?').get(canon).c) {
    return 'The request that keeps the lab report has no file on it, so this one is not a duplicate of anything on file.';
  }
  return null;
}

/** The one hold: request 8afd7fbe stays unsigned while its item is open. */
export function coaSignHold(db, requestId) {
  let item;
  try {
    item = db.prepare("SELECT item_key FROM coa_review_items WHERE request_id = ? AND kind = 'UNSIGN_CORRECT_NO_RESIGN' AND status = 'open'").get(requestId);
  } catch { return null; }
  return item ? `Held: failed-lot correction ${DECISION}, see QA Review.` : null;
}

/** An admin closes an item with a reason (which lifts the hold, if it is the held one). */
export function dismissItem(db, user, id, reason) {
  const item = db.prepare('SELECT * FROM coa_review_items WHERE id = ? OR item_key = ?').get(id, id);
  if (!item) return { status: 404, error: 'No such correction item.' };
  if (item.status !== 'open') return { status: 409, error: 'This item is already closed.' };
  db.prepare("UPDATE coa_review_items SET status = 'dismissed', dismissed_by = ?, dismissed_reason = ?, dismissed_at = datetime('now') WHERE id = ?")
    .run(user.name, reason, item.id);
  return { item: db.prepare('SELECT * FROM coa_review_items WHERE id = ?').get(item.id), before: item };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A request named the way Maria knows it: what, which lot, when it was filed. */
export function requestLabel(db, id) {
  const r = db?.prepare('SELECT item_number, item_description, lot_number, created_at, qa_signed_at FROM coa_requests WHERE id = ?').get(id);
  if (!r) return 'a request that is no longer on file';
  const what = r.item_description || r.item_number || 'request';
  return `${what} · lot ${r.lot_number || 'blank'} · filed ${String(r.created_at || '').slice(0, 10) || 'unknown'}${r.qa_signed_at ? ' · signed' : ''}`;
}

// D-256: the stored wording names requests by their long ids. Read out, each
// becomes the request's own name. The stored text is never rewritten.
const plainIds = (db, text) => (text && db
  ? String(text).replace(UUID_RE, (id) => `the request "${requestLabel(db, id)}"`)
  : text);

/** The QA Review row for one item. */
export function reviewRow(item, db = null) {
  const extra = parse(item.steps, {});
  const groupKey = item.group_key ?? groupKeyOf(item);
  const keeper = groupKey ? groupKey.slice('keeps:'.length) : null;
  return {
    id: item.id,
    item_key: item.item_key,
    request_id: item.request_id,
    title: item.title,
    subtitle: KINDS[item.kind]?.label || item.kind,
    action_kind: item.kind,
    by: null,
    date: (item.created_at || '').slice(0, 10),
    result: null,
    extra: null,
    risk: riskRank(item.kind),
    group_key: groupKey,
    group_label: keeper && db ? requestLabel(db, keeper) : null,
    request_label: db ? requestLabel(db, item.request_id) : null,
    recommended_action: plainIds(db, item.recommended_action),
    reason: plainIds(db, item.reason),
    note: [plainIds(db, extra.note), (() => { const d = parse(item.decision, null); return d ? `${d.by} marked record ${d.remove} for removal: ${d.reason}` : null; })()].filter(Boolean).join(' ') || null,
    evidence: parse(item.evidence, []),
    steps: item.progress?.steps || [],
    blocked_by: item.progress?.blockedBy || null,
    decision_ref: item.decision_ref,
  };
}

/**
 * D-256: every open "delete empty duplicate" item at once (or the ones named),
 * each checked exactly as a single delete is. Ready ones can go in one act;
 * a refused one is named with its reason and left alone. Writes nothing.
 */
export function emptyDuplicatePlan(db, { requestIds = null } = {}) {
  const wanted = Array.isArray(requestIds) && requestIds.length ? new Set(requestIds) : null;
  const items = pendingItems(db).filter(i => i.kind === 'DELETE_DUPLICATE' && (!wanted || wanted.has(i.request_id)));
  const ready = [], refused = [];
  for (const item of items) {
    const refusal = duplicateDeleteRefusal(db, item.request_id, item);
    const row = { request_id: item.request_id, item_key: item.item_key, label: requestLabel(db, item.request_id),
      keeps: requestLabel(db, parse(item.steps, {})?.seed?.canonical_request_id) };
    if (refusal) refused.push({ ...row, reason: refusal }); else ready.push(row);
  }
  if (wanted) {
    const seen = new Set(items.map(i => i.request_id));
    for (const id of wanted) if (!seen.has(id)) refused.push({ request_id: id, label: requestLabel(db, id), reason: 'It is not an open "delete empty duplicate" correction.' });
  }
  return { ready, refused };
}
