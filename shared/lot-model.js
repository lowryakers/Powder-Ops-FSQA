// A lot and its batches (D-237, decided A-20261027-001 item 6 and -002).
//
// "101690-1" and "101690-2" are two BATCHES inside ONE production run, lot
// 101690 — not two lots. The per-lot gluten policy ("every production lot of
// every ProDough SKU is tested before release") is judged at the BASE lot, and
// a base lot meets it only when EVERY batch known to ReadyDoc has a signed,
// passing gluten result. PURE: both the server and the screen import it.

// A trailing "-N" or " N" (one or two digits) after a base of five or more
// characters is a batch. Anything else is the whole string as the base lot.
const BATCH_RE = /^(.{5,}?)[-\s](\d{1,2})$/;
// A ProDough production lot is six digits starting "10" (101690). A base that
// looks like one but is not six digits (10169-1, 1011383) is FLAGGED for a
// person — never corrected here.
const PRODOUGH_STYLE = /^10\d{3,5}$/;

/** `{ base_lot, batch, suspect }`. The lot as written is never changed. */
export function splitLot(lot) {
  const s = String(lot ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return { base_lot: null, batch: null, suspect: false };
  const m = s.match(BATCH_RE);
  const base = m ? m[1].trim() : s;
  const batch = m ? m[2] : null;
  const suspect = PRODOUGH_STYLE.test(base) && base.length !== 6;
  return { base_lot: base, batch, suspect };
}

/**
 * Does one gluten result support a "gluten-free (<20 ppm)" claim? Internal
 * only; nothing public reads it. Strictly below 20: "<4 ppm" yes, "<20 ppm"
 * yes (it reads below 20), "20 ppm" no, "<44 ppm" no, a number with no unit no.
 */
export function glutenSupportsGfClaim(result) {
  if (!result) return false;
  const unit = String(result.unit ?? '').trim().toLowerCase();
  if (unit !== 'ppm') return false;
  const v = String(result.result_value ?? '').replace(/\s+/g, '').replace(/,/g, '');
  const bound = v.match(/^<(\d+(?:\.\d+)?)$/);
  if (bound) return Number(bound[1]) <= 20;
  if (/^\d+(?:\.\d+)?$/.test(v)) return Number(v) < 20;
  return false;
}

/**
 * Roll batches up to their base lot.
 * `rows`: [{ lot_number, signed, gluten: [{ pass_fail, result_value, unit }] }]
 * — one per COA request. Returns one entry per base lot:
 * { base_lot, met, batches: [{ batch, lot_number, state }], at_fault: [...] }.
 * A batch is `ok` only when its request is signed AND it has a gluten result
 * graded pass. Missing, unsigned, ungraded and failing batches are each named.
 */
export function rollUpLots(rows) {
  const lots = new Map();
  for (const r of rows || []) {
    const { base_lot, batch } = splitLot(r.lot_number);
    if (!base_lot) continue;
    if (!lots.has(base_lot)) lots.set(base_lot, []);
    const g = r.gluten || [];
    let state;
    if (!g.length) state = 'missing';
    else if (g.some(x => x.pass_fail === 'fail')) state = 'failing';
    else if (!g.some(x => x.pass_fail === 'pass')) state = 'ungraded';
    else if (!r.signed) state = 'unsigned';
    else state = 'ok';
    lots.get(base_lot).push({ batch, lot_number: r.lot_number, request_id: r.id ?? null, state });
  }
  return [...lots].map(([base_lot, list]) => {
    // Two requests for one batch (a re-test): the batch is fine if ANY of its
    // requests is a signed pass — the later re-test supersedes the failure.
    const byBatch = new Map();
    for (const b of list) {
      const k = b.batch ?? '';
      const prev = byBatch.get(k);
      if (!prev || (b.state === 'ok' && prev.state !== 'ok')) byBatch.set(k, b);
    }
    const batches = [...byBatch.values()].sort((a, b) => String(a.batch ?? '').localeCompare(String(b.batch ?? ''), undefined, { numeric: true }));
    const at_fault = batches.filter(b => b.state !== 'ok');
    return { base_lot, met: at_fault.length === 0, batches, at_fault };
  });
}

export const BATCH_STATE_LABEL = {
  ok: 'signed pass', missing: 'no gluten result', unsigned: 'not signed', ungraded: 'not graded', failing: 'failed',
};
