// The worklist order, asserted — because the order IS the advice.
import { itemKind, orderWorklist, worklistProgress, UNMATCHED } from '../server/doc-worklist.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const item = (o) => ({ state: 'pending', changes: [], ...o });
const ch = (...f) => f.map(field => ({ field }));

console.log('\n── what an item is asking for ──');
t('a file matching no document needs a person',
  itemKind(item({ document_id: null })) === UNMATCHED);
t('a moved revision outranks everything else it also changes',
  itemKind(item({ document_id: 'd', changes: ch('description', 'revision', 'title') })) === 'revision_moved');
t('dates only', itemKind(item({ document_id: 'd', changes: ch('effective_date') })) === 'dates_only');
t('body only', itemKind(item({ document_id: 'd', changes: ch('description') })) === 'body_only');
t('nothing proposed is a confirm-and-move-on',
  itemKind(item({ document_id: 'd', changes: [] })) === 'no_change');

console.log('\n── the order ──');
const items = [
  item({ id: 'e', document_id: 'd5', doc_number: 'SOP 500', changes: [] }),
  item({ id: 'b', document_id: null, filename: 'mystery.pdf' }),
  item({ id: 'c', document_id: 'd3', doc_number: 'SOP 300', changes: ch('effective_date') }),
  item({ id: 'a', document_id: 'd1', doc_number: 'SOP 100', changes: ch('revision') }),
  item({ id: 'd', document_id: 'd4', doc_number: 'SOP 400', changes: ch('description') }),
];
const order = orderWorklist(items).map(i => i.id);
t('a moved revision comes first — the register is quoting a superseded one',
  order[0] === 'a', order.join(','));
t('a file nobody can place comes next', order[1] === 'b', order.join(','));
t('no-change sorts last', order[order.length - 1] === 'e', order.join(','));

// Within a kind, past-due first: the same act discharges two obligations.
const due = orderWorklist([
  item({ id: 'fresh', document_id: 'd1', doc_number: 'SOP 100', changes: ch('revision'), review_due: '2027-01-01' }),
  item({ id: 'late',  document_id: 'd2', doc_number: 'SOP 900', changes: ch('revision'), review_due: '2026-01-01' }),
], { today: '2026-09-02' }).map(i => i.id);
t('within a kind, a document past its review date comes first', due[0] === 'late', due.join(','));
t('a document with no review date is not treated as overdue',
  !orderWorklist([item({ document_id: 'd', changes: ch('revision') })], { today: '2026-09-02' })[0].overdue);

// A queue that reshuffles between loads is one you lose your place in.
const a = orderWorklist(items).map(i => i.id).join(',');
const b = orderWorklist([...items].reverse()).map(i => i.id).join(',');
t('THE ORDER IS STABLE whatever order the rows arrive in', a === b, `${a} vs ${b}`);
t('ordering does not mutate the input', items[0].id === 'e');

console.log('\n── how much is left ──');
const p = worklistProgress([
  item({ state: 'applied' }), item({ state: 'applied' }), item({ state: 'skipped' }),
  item({ state: 'pending', document_id: 'd', changes: ch('revision') }),
  item({ state: 'pending', document_id: null }),
]);
t('counts come from the rows', p.total === 5 && p.applied === 2 && p.skipped === 1 && p.outstanding === 2,
  JSON.stringify(p));
t('progress counts a skip as handled', p.percent === 60, `${p.percent}`);
t('the ones needing a person are called out', p.needs_a_person === 1);
t('an empty worklist does not divide by zero', worklistProgress([]).percent === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
