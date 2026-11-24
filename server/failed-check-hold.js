// A FAILED X-RAY OR METAL-DETECTOR CHECK PUTS THE LOT ON HOLD (D-389,
// A-20261124-002 / R-0830).
//
// The operation log (FORM 413-1 X-Ray, and the metal-detector check that travels
// with the batch record) stays in KEYCHAIN with the BPR. Nothing reports a check
// result into ReadyDoc — no Keychain API, webhook or ingest exists, checked at
// tip — so the failure gets in the way every other fact here does: a person
// standing at the machine presses "Log a failed check".
//
// That files an ordinary Form 424-01 On Hold record (`on_hold`, through
// createQmsRecord — the one writer), its reason starting with the fixed prefix
// below so these holds are findable on the On Hold log. Releasing it is the
// existing On Hold path, by a person. Nothing here releases, signs or touches
// the Keychain log. Each log is its own hold: two failures are two events.
import { isBotAccount } from './trainees.js';

export const CHECK_KINDS = {
  xray: 'X-ray',
  metal_detector: 'Metal detector',
};
/** The reason starts with this, so a failed-check hold is findable by its words. */
export const reasonPrefix = (kind) => `Failed ${CHECK_KINDS[kind]} check`;

/** The machines a person can pick: equipment named or typed as an X-ray or a metal detector. */
export function checkMachines(db) {
  return db.prepare(`SELECT id, name, asset_id AS asset_number, location, type FROM equipment
    WHERE COALESCE(status, 'active') != 'retired'
      AND (lower(name) LIKE '%x-ray%' OR lower(name) LIKE '%xray%' OR lower(name) LIKE '%x ray%' OR lower(name) LIKE '%metal detect%'
        OR lower(COALESCE(type,'')) LIKE '%x-ray%' OR lower(COALESCE(type,'')) LIKE '%xray%' OR lower(COALESCE(type,'')) LIKE '%metal detect%')
    ORDER BY lower(name)`).all();
}

/**
 * Validate a failed-check log and build the On Hold body. Returns
 * { status, error } or { body } for createQmsRecord.
 */
export function failedCheckHold(db, user, auth, b = {}) {
  if (auth?.kind === 'token' || isBotAccount(db, user)) {
    return { status: 403, error: 'A failed check is logged by a person at the machine.', code: 'PERSON_ONLY' };
  }
  const kind = String(b.check || '');
  if (!CHECK_KINDS[kind]) return { status: 400, error: 'Say which check failed: X-ray or metal detector.' };
  const lot = String(b.lot || '').trim();
  if (!lot) return { status: 400, error: 'Name the lot on the line.' };
  const what = String(b.what_happened || '').trim();
  if (what.length < 3) return { status: 400, error: 'Say what happened (what the check showed).' };
  let machine = String(b.machine_name || '').trim();
  let location = String(b.location || '').trim();
  if (b.equipment_id) {
    const eq = db.prepare('SELECT name, asset_id, location FROM equipment WHERE id = ?').get(String(b.equipment_id));
    if (!eq) return { status: 400, error: 'That machine is not on the equipment list.' };
    machine = `${eq.name}${eq.asset_id ? ` #${eq.asset_id}` : ''}`;
    if (!location) location = eq.location || '';
  }
  if (!machine) return { status: 400, error: 'Name the machine.' };
  const today = new Date().toISOString().slice(0, 10);
  return {
    body: {
      record_date: today,
      status: 'on_hold',
      product: String(b.product || '').trim() || null,
      item_number: String(b.item_number || '').trim() || null,
      work_order: String(b.work_order || '').trim() || null,
      lot,
      location: location || machine,
      reason: `${reasonPrefix(kind)} — ${machine}: ${what}`,
      qty: String(b.qty || '').trim() || null,
      placed_by: `${today} ${user.name}`,
      notes: `Logged with "Log a failed check" by ${user.name}. The ${CHECK_KINDS[kind]} operation log is in Keychain with the batch record.`,
    },
    kind, machine,
  };
}
