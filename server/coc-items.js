// Which received items need a Certificate of Compliance, and whether a receipt
// has the proof (D-275).
//
// The plant must be able to show that every delivery of packaging, gloves and
// poly bags was checked for a CoC. FORM 204-01 already asks "Certificate of
// Conformance" as a Yes / No / N/A tick, and a tick is not proof: the receiver
// decides whether it applies, and nothing of the certificate is kept.
//
// THE LIST IS QA's, like the lab-test list (lab-test-items.js): which parts need
// a CoC is a standing decision made once per item, not a judgement made per truck.
// A receiving line for a listed part makes the CoC REQUIRED on its inspection.
//
// PROOF IS ONE OF TWO THINGS, and the record says which:
//   - `attached` — the certificate that came with this delivery, stored on the
//     receipt (a photo or PDF);
//   - `on_file`  — a standing certificate the supplier sends once (often yearly),
//     kept in Supplier Qualification, current on the day of the receipt.
//
// PURE. Rows in, decisions out: no Express, no database handle, no writes.
import { itemKey } from './lab-test-items.js';

export const COC_CATEGORIES = [
  { key: 'packaging', label: 'Packaging' },
  { key: 'gloves', label: 'Gloves' },
  { key: 'poly_bags', label: 'Poly bags' },
  { key: 'other', label: 'Other food-contact material' },
];
export const isCocCategory = (k) => COC_CATEGORIES.some(c => c.key === k);
export const cocCategoryLabel = (k) => COC_CATEGORIES.find(c => c.key === k)?.label || 'Other food-contact material';

/** The active rule for this line's part, or null. Part number only, never the description. */
export function cocFor(line, rules) {
  const key = itemKey(line?.part_number);
  if (!key) return null;
  return (rules || []).find(r => r.is_active !== 0 && r.is_active !== false && itemKey(r.part_number) === key) || null;
}

/**
 * Is an on-file certificate current on the receipt's date? A certificate with an
 * expiry before that date is not proof. One with NO expiry recorded is accepted
 * and SAID to have none — the supplier register reads expiry off the document and
 * never invents one, and refusing every undated certificate would push the proof
 * back onto paper.
 */
export function onFileCurrent(file, onDate) {
  if (!file) return false;
  if (!file.expires_on) return true;
  return !onDate || String(file.expires_on).slice(0, 10) >= String(onDate).slice(0, 10);
}

/**
 * What an inspection owes, part by part.
 *
 * @param lines   receiving_log rows filed against the inspection
 * @param rules   active rows of the CoC list
 * @param proofs  live receiving_coc_proofs rows for the inspection (removed ones excluded)
 * @param onDate  the inspection date, for an on-file certificate's expiry
 * @returns [{ part_number, description, category, lines, proofs, status }]
 *          status: 'proved' | 'missing'
 */
export function cocRequirements(lines, rules, proofs, onDate) {
  const byPart = new Map();
  for (const line of lines || []) {
    const rule = cocFor(line, rules);
    if (!rule) continue;
    const key = itemKey(rule.part_number);
    if (!byPart.has(key)) {
      byPart.set(key, {
        part_number: rule.part_number,
        description: rule.part_description || line.part_description || null,
        category: rule.category || 'other',
        rule_id: rule.id,
        lines: [],
      });
    }
    byPart.get(key).lines.push({ id: line.id, vendor_lot: line.vendor_lot || null, quantity_received: line.quantity_received ?? null, uom: line.uom || null });
  }
  return [...byPart.values()].map(req => {
    const mine = (proofs || []).filter(p => !p.removed_at && itemKey(p.part_number) === itemKey(req.part_number));
    const valid = mine.filter(p => p.source === 'attached' || (p.source === 'on_file' && onFileCurrent({ expires_on: p.expires_on }, onDate)));
    return { ...req, proofs: mine, status: valid.length ? 'proved' : 'missing' };
  });
}

/**
 * Why a checklist cannot be signed off yet, in words, or [] when it can.
 * Two refusals: a listed part with no proof, and the form's own CoC line
 * answered N/A or No while the CoC is required.
 */
export function cocSignRefusals(requirements, answers) {
  const out = [];
  const missing = (requirements || []).filter(r => r.status === 'missing');
  for (const r of missing) {
    out.push(`${r.part_number}${r.description ? ` (${r.description})` : ''} needs its Certificate of Compliance — attach the one that came with the delivery, or link the current one on file.`);
  }
  if ((requirements || []).length && !missing.length && answers?.coc_present && answers.coc_present !== 'yes') {
    out.push('"Certificate of Conformance" must be answered Yes — this delivery has a CoC on record for every listed item.');
  }
  if ((requirements || []).length && missing.length && answers?.coc_present === 'na') {
    out.push('"Certificate of Conformance" cannot be N/A — this delivery includes items QA has listed as needing one.');
  }
  return out;
}
