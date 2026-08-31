// The invoice reader, asserted against the shapes invoices are actually
// written in. Pure: no server, no database.
import { parseMoney, findTotal, findInvoiceDate, readInvoiceFigures } from '../server/invoice-figures.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n── money ──');
t('a plain figure reads', parseMoney('412.00') === 412);
t('a dollar sign and thousands separator read', parseMoney('$1,234.56') === 1234.56);
t('spacing is tolerated', parseMoney('$ 1 234.56') === 1234.56);
// The comma decimal only when the comma is LAST and has two digits after it —
// otherwise "1,234" silently becomes one and a bit.
t('a comma decimal reads', parseMoney('1.234,56') === 1234.56);
t('a thousands comma is NOT a decimal', parseMoney('1,234') === 1234);
t('nonsense is null, not zero', parseMoney('n/a') === null);
t('nothing is null', parseMoney(null) === null);

console.log('\n── the total ──');
const statement = `
ACME SUPPLY CO
Invoice 88123
Previous Balance          1,900.00
Subtotal                    530.00
Sales Tax                    39.88
TOTAL AMOUNT DUE            569.88
`;
const st = findTotal(statement);
t('the labelled amount due wins over the previous balance', st.amount === 569.88, JSON.stringify(st));
t('the total carries the line it was read from', /TOTAL AMOUNT DUE/.test(st.evidence));

t('a subtotal is never read as the total',
  findTotal('Subtotal 530.00\nTotal 569.88').amount === 569.88);
t('tax is never read as the total', findTotal('Sales Tax 39.88') === null);
t('"Amount Due" beats "Grand Total"',
  findTotal('Grand Total 100.00\nAmount Due 90.00').amount === 90);
// A running total appears before the final one on a multi-page invoice.
t('among equal labels the LAST wins',
  findTotal('Total 100.00\nTotal 250.00').amount === 250);
t('the figure on a total line is the last one on it',
  findTotal('Total 3 items $412.00').amount === 412);
// The refusal that matters: a page of numbers with nothing labelled produces
// nothing, rather than the biggest number on it.
t('NOTHING LABELLED YIELDS NULL, not the largest number',
  findTotal('12.00\n980.00\n45.00') === null);

console.log('\n── the date ──');
t('an ISO date reads', findInvoiceDate('Invoice Date: 2026-08-31').date === '2026-08-31');
t('a US date reads', findInvoiceDate('Invoice Date 08/31/2026').date === '2026-08-31');
t('a written date reads', findInvoiceDate('Invoice Date: Aug 31, 2026').date === '2026-08-31');
t('a day-first written date reads', findInvoiceDate('Date of Invoice: 31 August 2026').date === '2026-08-31');
// An invoice carries several dates; the labelled one is the one wanted.
t('the invoice date beats the due date',
  findInvoiceDate('Due Date: 09/30/2026\nInvoice Date: 08/31/2026').date === '2026-08-31',
  JSON.stringify(findInvoiceDate('Due Date: 09/30/2026\nInvoice Date: 08/31/2026')));
t('no date yields null', findInvoiceDate('ACME SUPPLY CO') === null);

console.log('\n── the whole read ──');
const all = readInvoiceFigures(statement + '\nInvoice Date: 08/31/2026\n');
t('both figures come back', all.total === 569.88 && all.invoice_date === '2026-08-31', JSON.stringify(all));
t('both carry their evidence', !!all.total_evidence && !!all.invoice_date_evidence);
t('a readable invoice says so', all.readable === true);
t('an unreadable one says so rather than looking like a failure',
  readInvoiceFigures('scanned image, no text layer').readable === false);
t('empty text is handled', readInvoiceFigures('').total === null);
t('null text is handled', readInvoiceFigures(null).readable === false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
