// Which received items QA wants a lab sample pulled from — the standing list,
// and the match that fires off it.
//
// WHY THIS IS ITS OWN LIST AND NOT A TICK ON THE RECEIVING LINE.
//
// The receiver at the dock does not know which raws need testing; that is a
// standing QA decision made once per item, not a judgement made per truck at
// 6am. A checkbox on the receiving form would ask the wrong person the wrong
// question every time, and the day it is missed is the day the sample is not
// pulled and the pallet has already gone to the racking.
//
// WHY IT IS NOT A FLAG ON `coa_specifications` EITHER, which is the other
// obvious home: a spec is the number a RESULT is graded against, and having one
// is not the same fact as "sample this every time it arrives". Plenty of items
// have a spec on file and are tested on a schedule rather than per receipt.
// Folding the two together would mean one column answering two questions —
// which is the defect this codebase keeps unpicking. One owner per fact.
//
// PURE. Rows in, decisions out: no Express, no database handle, no writes. The
// question "would this receipt have alerted QA?" is answerable without standing
// anything up, and the caller decides what the answer means.

/**
 * Item codes are compared with case and surrounding space removed, and nothing
 * else. NOT a fuzzy match, and deliberately not a description match:
 * "Whey Protein Isolate" appears in the description of a dozen distinct parts,
 * and an alert that fires on the wrong pallet is one QA learns to dismiss.
 * A part received under two codes gets two rows on the list, which is a
 * deliberate act by somebody who knows they are the same material.
 */
export function itemKey(v) {
  return String(v ?? '').trim().toUpperCase();
}

/**
 * Does this receiving line call for a lab sample?
 *
 * `rules` are the active rows of the standing list. Returns the matching rule
 * or null — never a "probably", because the caller turns this into a message
 * that sends somebody to the dock with a sample jar.
 *
 * A LINE WITH NO PART NUMBER NEVER MATCHES, and that is not a silent miss: the
 * receiving form requires a part number OR a description, so a description-only
 * line is legitimate and simply cannot be resolved to an item. `unmatchable()`
 * below is how those surface for review instead of vanishing.
 */
export function labTestFor(line, rules) {
  const key = itemKey(line?.part_number);
  if (!key) return null;
  return (rules || []).find(r => r.is_active !== 0 && itemKey(r.part_number) === key) || null;
}

/**
 * Lines that could not be checked against the list at all, because they carry
 * no part number.
 *
 * A rule that quietly does not apply is worse than one that visibly does not:
 * this is what lets QA see "three receipts last month had no part number, so
 * nothing was checked" rather than assuming silence meant nothing was due.
 */
export function unmatchable(lines) {
  return (lines || []).filter(l => !itemKey(l?.part_number));
}

/**
 * The alert's own wording, built from the rule and the receipt.
 *
 * The tests are printed VERBATIM from the rule — "HM & Micro" is how 1,150 of
 * the real COA requests are written, and expanding a panel shorthand into named
 * tests here would tell QA to run something they did not ask for. Same rule the
 * COA submission composer follows.
 */
export function alertDetail(rule, line) {
  const bits = [
    rule?.tests && `Tests: ${rule.tests}`,
    line?.vendor_lot ? `Vendor lot ${line.vendor_lot}` : 'Vendor lot NOT RECORDED',
    line?.quantity_received != null && line?.quantity_received !== ''
      ? `Qty ${line.quantity_received}${line.uom ? ` ${line.uom}` : ''}` : null,
    line?.po_number && `PO ${line.po_number}`,
    rule?.note,
  ].filter(Boolean);
  return bits.join(' · ');
}
