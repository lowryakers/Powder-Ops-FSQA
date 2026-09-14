/**
 * One GS1 number, one spelling.
 *
 * A GTIN can be written at several lengths, and the longer ones are often the
 * same number zero-padded: `00` + a 12-digit UPC-A is that UPC's GTIN-14 form,
 * and it carries the SAME check digit. That is why nothing ever objected —
 * `gtinValid()` accepts 8, 12, 13 and 14 digits and the padded form passes its
 * check digit exactly as the bare one does, so both write paths stored it as
 * typed and one number ended up on file in two spellings.
 *
 * The cost was not theoretical. Three readers disagreed about those rows:
 *   - `gtinPrefixes()` counts GS1 capacity from 12-digit numbers only, so a
 *     padded row was invisible to the allocation it had actually consumed;
 *   - the barcode-image staleness check is a STRING compare, so a product
 *     whose image encodes the number it still carries read "this image is for
 *     a different number" — a red warning about nothing;
 *   - `master.csv` shipped 14 digits to the proofing tool, which expects the
 *     UPC-A that is printed on the pack.
 *
 * A GTIN-14 whose indicator digit is 1–8 is a DIFFERENT number — a case or
 * carton code, not the consumer unit — and is never touched here. Only the
 * padding comes off, and only while twelve digits remain, so a 12-digit UPC-A
 * that genuinely begins with a zero keeps it.
 */
export function normalizeGtin(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return s;
  return s.replace(/^0+(?=\d{12})/, '');
}

/** True when the value carries padding this would strip. */
export function isPaddedGtin(raw) {
  const s = String(raw ?? '').trim();
  return /^\d+$/.test(s) && normalizeGtin(s) !== s;
}

/**
 * Do two values name the same number?
 *
 * Used wherever a stored GTIN is compared with another — the barcode image's
 * own number, a GTIN posted back by the proofing service. A blank on either
 * side is not a match: "no number recorded" is a gap, never an agreement.
 */
export function sameGtin(a, b) {
  const x = normalizeGtin(a);
  const y = normalizeGtin(b);
  return !!x && !!y && x === y;
}

/** GS1 mod-10 over everything but the final digit. */
export function checkDigit(body) {
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    total += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (total % 10)) % 10;
}

/**
 * Does this number check out?
 *
 * Deliberately still accepts 13 and 14 digits. A padded UPC-A is a legitimate
 * way to write the number and refusing it at the door would reject a value
 * someone copied correctly off the GS1 site; `normalizeGtin` is what makes
 * sure only one spelling is ever STORED.
 */
export function gtinValid(gtin) {
  if (!gtin || !/^\d+$/.test(gtin)) return false;
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  return checkDigit(gtin.slice(0, -1)) === Number(gtin[gtin.length - 1]);
}
