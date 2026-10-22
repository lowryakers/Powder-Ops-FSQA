// The banned-substance check on a supplier's material (C3, CAR 4990682-3 (a),
// D-202). SOP 404 V5 asks, for every material we approve, whether it appears on
// the banned / prohibited substance lists — and against WHICH EDITION of each.
//
// THE UNIT IS THE MATERIAL, not the vendor (SOP 404 § III.A, the register's
// own rule): AIFI supplies three materials from three makers, and "AIFI was
// checked" says nothing about the potassium citrate.
//
// THE EDITIONS ARE READ, NEVER TYPED. They are the latest annual banned-list
// review's (`currentListEditions`), frozen onto the check. A check made before
// the next annual review recorded new editions is STALE — it was made against
// lists that have since moved — and is owed again. That is what the review's
// own "materials re-checked" question is asking for.
//
// No review on file ⇒ no check can be made: an edition is a fact somebody
// recorded, and a check "against the current lists" with nothing saying which
// lists those were is the thing an auditor cannot accept.
//
// THE GATE IS THE D-063 SHAPE. `app_settings.supplier_banned_gate`: off / warn
// (default) / on. Warn approves and STAMPS the gaps on the qualification; on
// refuses "approved" while any gap is open. An admin turns it on when SOP 404 V5
// is live; a deploy never does.
import { randomUUID as uuid } from 'crypto';
import { currentListEditions } from './check-records.js';
import { BANNED_LISTS } from '../shared/check-forms.js';

export const BANNED_RESULTS = [
  { value: 'not_listed', label: 'Not on any list' },
  { value: 'listed', label: 'On a list — do not approve' },
];
export const GATE_MODES = ['off', 'warn', 'on'];

export function bannedGateMode(db) {
  try {
    const v = db.prepare("SELECT value FROM app_settings WHERE key = 'supplier_banned_gate'").get()?.value;
    return GATE_MODES.includes(v) ? v : 'warn';
  } catch { return 'warn'; }
}

/** The latest check per material, with its state against the review in force. */
export function materialChecks(db, supplierId) {
  const review = currentListEditions(db);
  const materials = db.prepare(`SELECT * FROM supplier_materials WHERE supplier_id = ? AND is_active = 1
    ORDER BY item_description`).all(supplierId);
  const latest = db.prepare(`SELECT * FROM supplier_banned_checks WHERE material_id = ?
    ORDER BY checked_at DESC, rowid DESC LIMIT 1`);
  return materials.map(m => {
    const c = latest.get(m.id);
    const check = c ? { ...c, editions: JSON.parse(c.editions || '{}') } : null;
    let state = 'none';
    if (check) state = check.result === 'listed' ? 'listed' : (review && check.review_id !== review.id ? 'stale' : 'current');
    return { ...m, banned_check: check, banned_state: state };
  });
}

/** What stands between this supplier and "approved", named per material. */
export function bannedGaps(db, supplierId) {
  const rows = materialChecks(db, supplierId);
  if (!rows.length) return [{ material_id: null, material: null, state: 'no_materials',
    reason: 'No material is recorded for this supplier, so nothing has been checked against the banned lists.' }];
  const why = {
    none: 'not checked against the banned lists',
    stale: 'checked against list editions the latest annual review has replaced — check it again',
    listed: 'recorded as ON a banned list',
  };
  return rows.filter(r => r.banned_state !== 'current').map(r => ({
    material_id: r.id, material: r.item_description, state: r.banned_state,
    reason: `${r.item_description}: ${why[r.banned_state]}`,
  }));
}

/** File one check. Returns { error, status } or { check }. */
export function recordBannedCheck(db, { supplierId, materialId, result, notes, user }) {
  const m = db.prepare('SELECT * FROM supplier_materials WHERE id = ? AND supplier_id = ?').get(materialId, supplierId);
  if (!m) return { status: 404, error: 'That material is not on this supplier.' };
  if (!BANNED_RESULTS.some(r => r.value === result)) return { status: 400, error: 'Result must be "not_listed" or "listed".' };
  const note = String(notes ?? '').trim().slice(0, 1000) || null;
  if (result === 'listed' && !note) return { status: 400, error: 'Say which list and which substance — a "listed" result needs a note.' };
  const review = currentListEditions(db);
  if (!review) {
    return { status: 409, error: 'No annual banned-list review is on file, so there are no list editions to check against. '
      + 'Record the review first (Quality Schedules → List reviews).' };
  }
  const editions = Object.fromEntries(BANNED_LISTS.map(l => [l.key, review.editions?.[l.key] || null]));
  const id = uuid();
  db.prepare(`INSERT INTO supplier_banned_checks (id, supplier_id, material_id, result, editions, review_id, review_on,
      notes, checked_by, checked_by_id, checked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`)
    .run(id, supplierId, materialId, result, JSON.stringify(editions), review.id, review.reviewed_on || null,
      note, user?.name || null, user?.id || null);
  return { check: { ...db.prepare('SELECT * FROM supplier_banned_checks WHERE id = ?').get(id), editions }, material: m };
}
