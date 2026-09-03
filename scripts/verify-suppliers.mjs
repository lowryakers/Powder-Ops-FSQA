// Supplier qualification — executed, not asserted.
// Boots against a running server (PORT/DB_PATH set by the caller) and imports
// the plant's REAL tracker and archive listing over HTTP, exactly as the screen
// does. Every line below is a measured result on a fresh database.
// Executed, not asserted: boot a real server on a fresh database, import the
// plant's REAL tracker and archive over HTTP, then check what the screen's
// endpoints actually return.
const B = 'http://localhost:4841/api';
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

// An admin to act as.
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  // Tolerated: on a re-run the fixture admin is referenced by audit rows it
  // wrote, and the point of the run is the supplier surface, not the roster.
  try { db.prepare("DELETE FROM users WHERE name = 'Sup Admin'").run(); } catch { /* referenced */ }
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('sup-admin','Sup Admin','Sup Admin','admin','qa',1,'SEED-CODE', datetime('now','+7 day'))`).run();
  db.close();
}
await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Sup Admin' }) });
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'sup-admin', password: 'SupSecret2026', setup_code: 'SEED-CODE' }) });
const login = await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Sup Admin', password: 'SupSecret2026' }) }));
token = login?.token;
t('admin signed in', !!token);

// Empty register first.
let reg = await J(await req('/suppliers'));
t('register is empty before import', reg?.suppliers?.length === 0, `${reg?.suppliers?.length}`);

// Import the real files, over the real endpoint, exactly as the screen does.
const { readFileSync } = await import('fs');
const U = '/root/.claude/uploads/af00ada3-a0aa-542a-9170-4983495b696f/';
const listing = JSON.parse(readFileSync('scripts/fixtures/supplier-archive-full.json', 'utf8'));
const mk = () => {
  const fd = new FormData();
  fd.append('files', new Blob([readFileSync(U + '64517a7d-Current_Suppliers__Updated_8_6_2026.xlsx')]),
    'Current Suppliers.xlsx');
  fd.append('files', new Blob([listing.entries.join('\n')], { type: 'text/plain' }), 'supplier-listing.txt');
  return fd;
};
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });

const analyzed = await J(await up('/suppliers/import/analyze', mk()));
t('analyze returns a plan', analyzed?.plan?.counts?.suppliers > 60, `${analyzed?.plan?.counts?.suppliers}`);
t('analyze imports NOTHING as approved', analyzed?.plan?.counts?.approved === 0);
t('analyze WROTE NOTHING', (await J(await req('/suppliers')))?.suppliers?.length === 0);
t('analyze reports the disagreements', (analyzed?.plan?.reconciliation?.disagreements || []).length >= 3);

const committed = await J(await up('/suppliers/import/commit', mk()));
t('commit created the suppliers', committed?.result?.suppliers_created > 60, `${committed?.result?.suppliers_created}`);

reg = await J(await req('/suppliers'));
t('register now lists them', reg.suppliers.length === committed.result.suppliers_created);
t('EVERY supplier is unqualified after import',
  reg.suppliers.every(s => s.status === 'unqualified'));
t('the derived finding is present and non-zero',
  reg.summary.buying_without_qualification > 0, `${reg.summary.buying_without_qualification}`);
t('the derived finding equals active-and-unqualified',
  reg.summary.buying_without_qualification === reg.suppliers.filter(s => s.actively_using && s.status === 'unqualified').length);
t('the SOP\'s three dispositions are served to the screen', reg.dispositions?.length === 3);
t('the SOP\'s seven risk criteria are served to the screen', reg.risk_criteria?.length === 7);

// The expiring view — declared BEFORE /:id, so it must not be read as an id.
const exp = await J(await req('/suppliers/documents/expiring?days=120'));
t('/documents/expiring is not swallowed by /:id', Array.isArray(exp?.expired), JSON.stringify(exp).slice(0, 60));

// One supplier, in detail.
const mh = reg.suppliers.find(s => /^Mill Haven/i.test(s.name));
t('Mill Haven is in the register', !!mh);
const detail = await J(await req(`/suppliers/${mh.id}`));
t('detail returns its files', Array.isArray(detail?.files));

// The disposition: refusals first, then the decision.
const bad1 = await req(`/suppliers/${mh.id}/disposition`, { method: 'POST', body: JSON.stringify({ disposition: 'approved' }) });
t('a disposition with no risk evaluation is REFUSED', bad1.status === 400);
const seven = Object.fromEntries(reg.risk_criteria.map(c => [c.key, 'yes']));
const bad2 = await req(`/suppliers/${mh.id}/disposition`, { method: 'POST', body: JSON.stringify({ disposition: 'not_approved', risk_criteria: seven }) });
t('a not-approved disposition with no reason is REFUSED', bad2.status === 400);
const bad3 = await req(`/suppliers/${mh.id}/disposition`, { method: 'POST', body: JSON.stringify({ disposition: 'looks_fine', risk_criteria: seven }) });
t('a disposition outside the SOP\'s three is REFUSED', bad3.status === 400);

const ok = await req(`/suppliers/${mh.id}/disposition`, { method: 'POST',
  body: JSON.stringify({ disposition: 'approved', period_label: '2026', risk_criteria: seven, notes: 'Questionnaire and audit on file.' }) });
t('a complete disposition is accepted', ok.status === 200);
const after = await J(await req('/suppliers'));
const mh2 = after.suppliers.find(s => s.id === mh.id);
t('the supplier status MIRRORS the disposition', mh2.status === 'approved');
t('the finding fell by exactly one',
  after.summary.buying_without_qualification === reg.summary.buying_without_qualification - 1,
  `${reg.summary.buying_without_qualification} → ${after.summary.buying_without_qualification}`);

// status is owned by the disposition.
const owned = await req(`/suppliers/${mh.id}`, { method: 'PUT', body: JSON.stringify({ status: 'approved' }) });
t('PUT /:id REFUSES to set status directly', owned.status === 400);

// Re-import is idempotent through the real endpoint.
const again = await J(await up('/suppliers/import/commit', mk()));
t('a re-import creates no duplicates', again.result.suppliers_created === 0, `${again.result.suppliers_created}`);
const after2 = await J(await req('/suppliers'));
t('the register did not grow', after2.suppliers.length === after.suppliers.length);
t('the re-import did NOT reset the approved supplier',
  after2.suppliers.find(s => s.id === mh.id).status === 'approved');

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`\nregister: ${after2.suppliers.length} suppliers · ${after2.summary.active} active · ` +
  `${after2.summary.buying_without_qualification} buying without qualification · ` +
  `${after2.summary.expired_documents} expired documents`);

// TWO GAPS, NOT ONE — the decomposition that makes the number actionable.
t('the two gaps are reported separately',
  typeof after2.summary.awaiting_disposition === 'number' && typeof after2.summary.no_questionnaire === 'number');
t('the two gaps do not double-count a vendor',
  after2.suppliers.filter(s => s.awaiting_disposition && s.no_questionnaire).length === 0);
const awaiting = after2.suppliers.filter(s => s.awaiting_disposition);
const noQ = after2.suppliers.filter(s => s.no_questionnaire);
t('both gaps are non-empty on the real tracker — the .every() below has rows to check',
  awaiting.length > 0 && noQ.length > 0, `${awaiting.length} awaiting, ${noQ.length} no questionnaire`);
t('the summary counts are the rows, not a second query',
  after2.summary.awaiting_disposition === awaiting.length && after2.summary.no_questionnaire === noQ.length);
t('every awaiting-disposition vendor really does have a questionnaire on file',
  awaiting.length > 0 && awaiting.every(s => s.questionnaire_files > 0));
t('every no-questionnaire vendor really has none',
  noQ.length > 0 && noQ.every(s => s.questionnaire_files === 0));
console.log(`  two gaps: ${after2.summary.awaiting_disposition} awaiting a disposition (evidence on file), ` +
  `${after2.summary.no_questionnaire} with no questionnaire at all`);
console.log(`\n${pass} passed, ${fail} failed  [final]`);
process.exit(fail ? 1 : 0);
