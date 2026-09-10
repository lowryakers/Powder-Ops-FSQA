// The AP Drop reader, on its own: text in, suggestions out.
import { parseFinanceDocument, findVendor, findDueDate, findOrderRefs, findInvoiceNumber } from '../server/ap-drop-parse.js';
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
t('our own name is never the vendor', findVendor('Powder Ops LLC\nAcme Widgets Inc') .value === 'Acme Widgets Inc');
t('a CO reference is read and typed', findOrderRefs('Ref CO# 88231 and PO 4471')[0].kind === 'CO' && findOrderRefs('Ref CO# 88231 and PO 4471')[1].value === '4471');
t('duplicate references collapse', findOrderRefs('PO 4471\nPO 4471 again').length === 1);
r = parseFinanceDocument('Credit Memo No: CM-77\nAcme\nTotal -$50.00');
t('a credit memo number is read', r.fields.invoice_number === 'CM-77', r.fields.invoice_number);

console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
