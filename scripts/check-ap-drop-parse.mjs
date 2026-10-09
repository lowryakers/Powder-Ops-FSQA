// The AP Drop reader, on its own: text in, suggestions out.
import { parseFinanceDocument, findVendor, findBillTo, findDueDate, findOrderRefs, findInvoiceNumber, notAVendor } from '../server/ap-drop-parse.js';
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const INVOICE = `
Mountain Flavor Supply
1200 Industrial Way, Ogden UT 84401
INVOICE
Invoice No: MFS-10442
Invoice Date: 08/28/2026
Due Date: 09/27/2026
Bill To: Powder Ops LLC
PO # 4471-B
Item                Qty     Price
Vanilla flavor       2    $412.00
Subtotal                  $824.00
Tax                        $49.44
Amount Due                $873.44
`;
let r = parseFinanceDocument(INVOICE);
t('vendor is the letterhead, not us', r.fields.vendor === 'Mountain Flavor Supply', r.fields.vendor);
t('invoice number', r.fields.invoice_number === 'MFS-10442', r.fields.invoice_number);
t('invoice date', r.fields.invoice_date === '2026-08-28', r.fields.invoice_date);
t('due date', r.fields.due_date === '2026-09-27', r.fields.due_date);
t('total is Amount Due, not the subtotal', r.fields.total === 873.44, String(r.fields.total));
t('PO reference', r.fields.order_refs.join() === 'PO 4471-B', r.fields.order_refs.join());
t('bill-to is read', /Powder Ops/.test(r.fields.bill_to || ''), r.fields.bill_to);
t('currency USD from the dollar sign', r.fields.currency === 'USD');
t('every field carries its line', r.evidence.total === 'Amount Due                $873.44' && /Invoice No/.test(r.evidence.invoice_number));
t('status ok when vendor, number and total were all read', r.status === 'ok');

t('empty text is failed, with a reason', parseFinanceDocument('').status === 'failed' && parseFinanceDocument('  ').reason);
r = parseFinanceDocument('Thanks for your business\nCall us any time');
t('text with nothing readable is failed, not partial', r.status === 'failed', r.status);
r = parseFinanceDocument('Acme Packaging\nTotal $120.00');
t('a vendor and a total without a number is partial', r.status === 'partial' && r.fields.invoice_number === null);

t('"Invoice Date" is never taken as the invoice number', findInvoiceNumber('Invoice Date 08/28/2026') === null);
t('a bare "Amount Due" line is not a due date', findDueDate('Amount Due $873.44') === null);
t('"Net 30" is not a date', findDueDate('Terms: Net 30 due on receipt') === null);
// D-160: our own name AS THE LETTERHEAD is returned, flagged ours — on our
// own invoice we are the issuer. Below Bill To nothing is ever the vendor.
t('our own letterhead is the vendor, flagged ours', findVendor('Powder Ops LLC\nAcme Widgets Inc')?.value === 'Powder Ops LLC' && findVendor('Powder Ops LLC\nAcme Widgets Inc')?.ours === true);
t('nothing at or below "Bill To" is ever the vendor', findVendor('INVOICE 7781\nBill To:\nAcme Widgets Inc\nPowder Ops LLC') === null);
t('our name deep in the page (past the letterhead) is still skipped', findVendor('INVOICE\n1\n2\n3\n4\n5\n6\n7\nPowder Ops LLC\nAcme Widgets Inc')?.value === 'Acme Widgets Inc');
t('the partner (M4) is no longer skipped: its letterhead is the vendor, not ours', findVendor('M4 Dynamic\n88 Formulation Drive\nBill To: Powder Ops')?.value === 'M4 Dynamic' && !findVendor('M4 Dynamic')?.ours);
t('a CO reference is read and typed', findOrderRefs('Ref CO# 88231 and PO 4471')[0].kind === 'CO' && findOrderRefs('Ref CO# 88231 and PO 4471')[1].value === '4471');
t('duplicate references collapse', findOrderRefs('PO 4471\nPO 4471 again').length === 1);
r = parseFinanceDocument('Credit Memo No: CM-77\nAcme\nTotal -$50.00');
t('a credit memo number is read', r.fields.invoice_number === 'CM-77', r.fields.invoice_number);

// D-147: the 14 Sep drop ($27,180.49) whose vendor was a markdown table header.
const MD = `| ACTIVITY | QTY | | RATE | | AMOUNT |
|---|---|---|---|---|---|
| Blending services | 1 | | 27,180.49 | | 27,180.49 |
Total $27,180.49`;
t('a markdown table header row is never the vendor', findVendor(MD) === null, JSON.stringify(findVendor(MD)));
r = parseFinanceDocument(MD);
t('…so that drop reads its total and leaves the vendor for a person', r.fields.vendor === null && r.fields.total === 27180.49, JSON.stringify(r.fields));
t('a row of column headings without pipes is refused too', notAVendor('Description Quantity Rate Amount') && notAVendor('ITEM QTY PRICE TOTAL'));
t('a bare country is not a vendor ("USA")', findVendor('USA\nTotal $50.00') === null && notAVendor('United States'));
t('a "City, ST" line is not a vendor', notAVendor('Salt Lake City, UT'));
t('markdown emphasis is stripped from a real name, the evidence kept as read', findVendor('# **Acme Packaging LLC**')?.value === 'Acme Packaging LLC'
  && findVendor('# **Acme Packaging LLC**')?.evidence === '# **Acme Packaging LLC**');
t('a real vendor after the header noise is still found', findVendor('USA\n| QTY | RATE |\nBeta Boxes Co')?.value === 'Beta Boxes Co');
t('an ordinary company name passes', !notAVendor('Mountain Flavor Supply') && !notAVendor('Rate Card Printing Co'));

t('a markdown header row is never the bill-to (D-148)', findBillTo('| BILL TO | SHIP TO |\n| Powder Ops | Powder Ops |') === null);
t('an ordinary Bill To still reads', findBillTo('Bill To: Powder Ops LLC')?.value === 'Powder Ops LLC');

// I136 (D-160): our own invoice to M4. The vendor read "USA" before D-147 and
// blank after it; it is the Powder Ops letterhead, and the due date printed
// before the invoice date is not offered.
const I136 = `Powder Ops LLC
1150 W 2700 S
Salt Lake City, UT
USA
INVOICE
Invoice No: I136
Invoice Date: 09/24/2026
Due Date: 05/26/2026
Bill To: M4 Dynamics
PO-01231
Amount Due $1,051.92`;
r = parseFinanceDocument(I136);
t('I136: the vendor is the Powder Ops letterhead, flagged ours, never "USA"', r.fields.vendor === 'Powder Ops LLC' && r.fields.vendor_ours === true, JSON.stringify(r.fields.vendor));
t('I136: a due date before the issue date is not applied, and says why', r.fields.due_date === null && r.fields.invoice_date === '2026-09-24' && /before the invoice date/.test((r.notes || []).join()), JSON.stringify({ due: r.fields.due_date, notes: r.notes }));
t('I136: bill-to M4 and the amount are read', /M4/.test(r.fields.bill_to || '') && r.fields.total === 1051.92);
r = parseFinanceDocument(INVOICE);
t('regression: a third-party invoice is unchanged (vendor, due date, not ours)', r.fields.vendor === 'Mountain Flavor Supply' && r.fields.due_date === '2026-09-27' && r.fields.vendor_ours === null && !r.notes);

console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
