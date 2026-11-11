// Who may write the gated product fields (R-0645, D-342).
//
// Three gates sit ON TOP of canManage (admin, supervisor, QA), which stays as
// it is. Every write path that can touch these fields — the PUT, create, the
// fill-down, the CSV import and the N/A control — calls `writeGate`, so no
// door is left open:
//
//   1. ACTIVE. Moving a product to Active is the one commercial gate. Only the
//      configured approver (a user id in app_settings), in a person's own
//      session, and only when every checklist step that applies is done.
//      A token or a bot account never does — even on the approver's account.
//   2. PRICES and EXTERNAL ITEM NUMBERS. Only the configured price editor (and
//      item-number editor, which defaults to the price editor). A token or
//      bot never writes them.
//   3. GTINs. A token or bot never writes the unit, inner or case GTIN. A
//      person pastes an already-allocated code; the backfill copies from the
//      GS1 export. Nothing here ever builds one.
//
// An unset setting is a REFUSAL that names the setting — never a fallback to
// "any admin". Nothing here names a person; the ids live in app_settings and
// are chosen by an admin in Settings → Products.

import { isBotAccount } from './trainees.js';
import { SOT_SETTINGS, SOT_SETTING_LABEL, PRICE_FIELDS, ITEM_NO_FIELDS, LEVEL_GTIN_FIELDS } from '../shared/product-sot-config.js';
import { normalizeStatus, ACTIVE } from '../shared/product-status.js';

export function sotSetting(db, key) {
  try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SOT_SETTINGS[key])?.value || null; }
  catch { return null; }
}

/** The configured people, by role. The item-number editor falls back to the price editor. */
export function sotPeople(db) {
  const price = sotSetting(db, 'price_editor');
  return {
    active_approver: sotSetting(db, 'active_approver'),
    price_editor: price,
    item_no_editor: sotSetting(db, 'item_no_editor') || price,
  };
}

const isToken = (req) => !!(req?.user?.via_token || req?.auth?.kind === 'token');
const changed = (existing, patch, f) => patch[f] !== undefined && String(patch[f] ?? '') !== String(existing?.[f] ?? '');

/** Refusal for a person-only act reached by a token or a bot account, or null. */
function personOnly(db, req, what) {
  if (isToken(req)) {
    return { status: 403, code: 'approve_requires_human_session', error: `${what} is done by a person in their own session, never by an API token.` };
  }
  if (isBotAccount(db, req?.user)) {
    return { status: 403, code: 'bot_account_cannot_approve', error: `${what} is done by a person — this account is a bot account.` };
  }
  return null;
}

function configured(db, req, role, what) {
  const id = sotPeople(db)[role];
  if (!id) {
    return { status: 403, code: 'SOT_SETTING_UNSET', setting: SOT_SETTINGS[role],
      error: `Nobody is set as "${SOT_SETTING_LABEL[role]}" (${SOT_SETTINGS[role]}). An admin chooses the person in Settings → Products. Nothing was written.` };
  }
  if (req?.user?.id !== id) {
    return { status: 403, code: role === 'active_approver' ? 'ACTIVE_APPROVER_ONLY' : 'PRICE_EDITOR_ONLY',
      error: `${what} is reserved for the person set as "${SOT_SETTING_LABEL[role]}". Nothing was written.` };
  }
  return null;
}

/** Is this patch moving the status to Active? */
export const movesToActive = (existing, patch) => patch.status !== undefined
  && normalizeStatus(patch.status) === ACTIVE && normalizeStatus(existing?.status) !== ACTIVE;

/**
 * The refusal for writing `patch` onto `existing`, or null when every gate
 * passes. `readinessAfter(row)` returns the readiness walk for the row as it
 * would stand after the write; it is asked only when the status moves to
 * Active.
 */
export function writeGate(db, req, existing, patch, { readinessAfter } = {}) {
  const gtins = ['gtin', ...LEVEL_GTIN_FIELDS].filter((f) => changed(existing, patch, f));
  if (gtins.length) {
    const r = personOnly(db, req, 'Entering a GTIN');
    if (r) return { ...r, code: r.code === 'approve_requires_human_session' ? 'GTIN_HUMAN_ONLY' : r.code, field: gtins[0],
      error: `${r.error} GTINs are copied from the GS1 Data Hub by a person, or loaded from its export.` };
  }
  const prices = PRICE_FIELDS.filter((f) => changed(existing, patch, f));
  if (prices.length) {
    const r = personOnly(db, req, 'Editing a price') || configured(db, req, 'price_editor', 'Editing a price');
    if (r) return { ...r, code: r.code === 'approve_requires_human_session' ? 'PRICE_EDITOR_ONLY' : r.code, field: prices[0] };
  }
  const items = ITEM_NO_FIELDS.filter((f) => changed(existing, patch, f));
  if (items.length) {
    const r = personOnly(db, req, 'Editing a distributor or wholesale item number') || configured(db, req, 'item_no_editor', 'Editing a distributor or wholesale item number');
    if (r) return { ...r, code: r.code === 'approve_requires_human_session' ? 'PRICE_EDITOR_ONLY' : r.code, field: items[0] };
  }
  if (movesToActive(existing, patch)) {
    const r = personOnly(db, req, 'Moving a product to Active') || configured(db, req, 'active_approver', 'Moving a product to Active');
    if (r) return { ...r, field: 'status' };
    if (readinessAfter) {
      const steps = (readinessAfter({ ...existing, ...patch })?.steps || []).filter((s) => !s.done);
      if (steps.length) {
        return { status: 400, code: 'READINESS_OPEN', field: 'status', open: steps.map((s) => ({ key: s.key, label: s.label, reason: s.reason })),
          error: `It cannot go Active yet — still open: ${steps.map((s) => s.label).join(', ')}. Finish them or mark the fields N/A.` };
      }
    }
  }
  return null;
}

/** What the current user may do on this screen — the drawer renders what it is told. */
export function sotPermissions(db, req) {
  const people = sotPeople(db);
  const human = !isToken(req) && !isBotAccount(db, req?.user);
  const me = req?.user?.id;
  return {
    can_activate: human && !!people.active_approver && me === people.active_approver,
    can_edit_prices: human && !!people.price_editor && me === people.price_editor,
    can_edit_item_nos: human && !!people.item_no_editor && me === people.item_no_editor,
    active_approver_set: !!people.active_approver,
    price_editor_set: !!people.price_editor,
  };
}

/**
 * The refusal for touching one gated field at all — used by the N/A control,
 * where marking a price "not applicable" is a statement about the price even
 * when no value is there to clear. Null for an ungated field.
 */
export function fieldGate(db, req, field) {
  if (['gtin', ...LEVEL_GTIN_FIELDS].includes(field)) {
    const r = personOnly(db, req, 'Changing a GTIN');
    return r ? { ...r, field } : null;
  }
  if (PRICE_FIELDS.includes(field)) {
    const r = personOnly(db, req, 'Editing a price') || configured(db, req, 'price_editor', 'Editing a price');
    return r ? { ...r, field } : null;
  }
  if (ITEM_NO_FIELDS.includes(field)) {
    const r = personOnly(db, req, 'Editing a distributor or wholesale item number') || configured(db, req, 'item_no_editor', 'Editing a distributor or wholesale item number');
    return r ? { ...r, field } : null;
  }
  return null;
}
