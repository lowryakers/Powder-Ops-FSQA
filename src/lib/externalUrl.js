/**
 * A pasted address, turned into one a click actually opens.
 *
 * People paste `amazon.com/dp/…` as often as they paste the scheme, and a bare
 * href like that is read as a RELATIVE PATH — the click stays inside ReadyDoc
 * and goes nowhere, which reads as the link having been stored wrongly. So the
 * scheme is added at RENDER time and the typed value is never rewritten: what
 * somebody pasted is what the record holds, and correcting it is their edit to
 * make, not a normalisation that quietly changes a stored field.
 *
 * Returns null for anything that is not an address, so a caller renders plain
 * text rather than a link that resolves to nothing — the same reason
 * `hexDigits` returns null instead of guessing at a colour.
 *
 * ONE DEFINITION. This was a private copy in `SupplyOrdersPanel` and a second,
 * identical one in `SpendTab`; a standing-list item would have been a third,
 * and three copies is how one screen opens a scheme-less paste and the next
 * one silently does not.
 */
export function externalUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?)/i.test(v)) return `https://${v}`;
  return null;
}
