// Is this drop about a reconciliation partner? PURE: a drop's fields and text
// in, a decision with its reasons out. No database, no Express.
//
// The question it answers is Jake's manual step: every M4 invoice that lands in
// AP Drop also has to be on the Partner Reconciliation ledger, and re-keying it
// there is the step that gets forgotten. So the drop is scanned once and routed.
//
// TWO CONFIDENCE TIERS, AND THE SPLIT IS WHERE THE NAME APPEARED.
//   high — the partner is named in a field that identifies a party to the
//          document: the vendor line, the bill-to line, what the submitter
//          typed (vendor, PO/CO, notes) or the filename. That is the document
//          being FROM or TO the partner.
//   low  — the partner is named only somewhere in the body text. That can be
//          "ship to M4", "as agreed with M4", a product called M4FF — a mention,
//          not a party. A draft on the ledger for one of those is a wrong number
//          somebody has to find; a question on the queue is not.
// High routes to a draft. Low parks the drop as needs_info "M4 partner?" and a
// person decides. Nothing here approves, settles or voids anything.
//
// Direction follows the same rule the partner importer uses: whoever is billed
// owes. Vendor = partner ⇒ payable (they billed us); bill-to = partner ⇒
// receivable (we billed them). When neither field says, the body text is asked
// (detectDirection); failing that, payable — an AP Drop is inbound bills by
// default, and the draft's direction is editable on the ledger before it can
// ever count.
import { detectDirection } from './invoice-parse.js';

const NAME_NOISE = /\b(inc|llc|l\.l\.c|ltd|co|corp|company|dynamics)\b\.?/gi;
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The strings a document might print for a partner, longest first, plus its code as a whole word. */
export function partnerPatterns(partner) {
  const full = String(partner?.name || '').trim();
  const out = [];
  if (full.length >= 3) out.push(full);
  const short = full.replace(NAME_NOISE, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (short.length >= 3 && short !== full) out.push(short);
  // "M4 Dynamics" is printed "M4 Dynamic" on their own invoices and in
  // QuickBooks; a singular/plural difference must not miss the partner.
  const singular = full.replace(/s\b$/i, '').trim();
  if (singular.length >= 3 && singular !== full && singular !== short) out.push(singular);
  const code = String(partner?.code || '').trim();
  if (code.length >= 2) out.push(code);
  // Longest first, so "M4 Dynamics" is what is reported as matched rather than "M4".
  return [...new Set(out)].sort((a, b) => b.length - a.length)
    .map(s => ({ text: s, re: new RegExp(`(?<![A-Za-z0-9])${escape(s)}(?![A-Za-z0-9])`, 'i') }));
}

function hit(value, patterns) {
  const s = String(value || '');
  if (!s) return null;
  for (const p of patterns) if (p.re.test(s)) return p.text;
  return null;
}

/**
 * @param {object} args
 * @param {Array<{id:string,name:string,code?:string,terms_days?:number}>} args.partners  active partner accounts
 * @param {object} args.fields  the drop's own columns: vendor_name, bill_to, po_or_co_ref, notes, filename
 * @param {object} [args.typed] what the SUBMITTER typed (vendor_name, po_or_co_ref, notes) — high-confidence by itself
 * @param {string} [args.text]  extracted text of the file
 * @param {string[]} [args.usNames]
 * @returns {{partner:object|null, confidence:'high'|'low'|null, matched_on:string[], matched_text:string|null, direction:string|null, direction_reason:string|null, reason:string}}
 */
export function detectPartner({ partners = [], fields = {}, typed = {}, text = '', usNames = ['Powder Ops', 'PowderOps', 'Powder-Ops'] }) {
  const none = (reason) => ({ partner: null, confidence: null, matched_on: [], matched_text: null, direction: null, direction_reason: null, reason });
  if (!partners.length) return none('No reconciliation partners are set up.');

  for (const partner of partners) {
    const pats = partnerPatterns(partner);
    if (!pats.length) continue;
    const on = [];
    let matchedText = null;
    const check = (label, value) => { const m = hit(value, pats); if (m) { on.push(label); matchedText = matchedText || m; } };
    check('vendor', fields.vendor_name);
    check('bill_to', fields.bill_to);
    check('filename', fields.filename);
    check('typed_vendor', typed.vendor_name);
    check('typed_reference', typed.po_or_co_ref);
    check('typed_notes', typed.notes);
    // The parsed PO/CO reference is a party-identifying field only when a
    // person typed it; one read off the page is body text.
    const bodyHit = hit(text, pats) || hit(fields.po_or_co_ref, pats);

    if (on.length) {
      const vendorIsPartner = on.includes('vendor') || on.includes('typed_vendor');
      const billToIsPartner = on.includes('bill_to');
      const dir = (() => {
        if (vendorIsPartner && !billToIsPartner) return { direction: 'payable', reason: `The vendor is ${partner.name}, so we owe it.` };
        if (billToIsPartner && !vendorIsPartner) return { direction: 'receivable', reason: `The document bills ${partner.name}, so they owe it.` };
        const d = detectDirection(text, { usNames, partnerNames: pats.map(p => p.text) });
        if (d.direction) return { direction: d.direction, reason: d.reason };
        return { direction: 'payable', reason: 'Could not tell who issued it from the fields or the text; filed as payable (an inbound bill) — correct it on the ledger if this is ours.' };
      })();
      return {
        partner, confidence: 'high', matched_on: on, matched_text: matchedText, direction: dir.direction, direction_reason: dir.reason,
        reason: `${matchedText} appears in ${on.map(labelOf).join(', ')}.`,
      };
    }
    if (bodyHit) {
      return {
        partner, confidence: 'low', matched_on: ['text'], matched_text: bodyHit, direction: null, direction_reason: null,
        reason: `${bodyHit} is mentioned in the document, but neither the vendor nor the bill-to is ${partner.name}.`,
      };
    }
  }
  return none('No partner is named on it.');
}

const LABELS = { vendor: 'the vendor line', bill_to: 'the bill-to line', filename: 'the filename', typed_vendor: 'the vendor the submitter typed', typed_reference: 'the PO/CO the submitter typed', typed_notes: 'the submitter\'s note', text: 'the text' };
const labelOf = (k) => LABELS[k] || k;
