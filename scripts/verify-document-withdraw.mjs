// Withdrawn is a door, not a dropdown value — executed against a live server.
//
// The registry's edit form filtered "No longer in use" out of its status
// select, so opening a withdrawn SOP to fix a typo had the browser pick the
// first option -- Draft -- and the save returned it to the active registry.
// The server refuses the transition now, whatever a client's dropdown offers.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4924;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
const del = (p, b) => req(p, { method: 'DELETE', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('dw-dc','Doc Control','Doc Control','admin','document_control',1,'SC-DW',datetime('now','+7 day'))`).run();
db.close();
await post('/users/login', { name: 'Doc Control' });
await post('/users/set-password', { user_id: 'dw-dc', password: 'DocPW2026!', setup_code: 'SC-DW' });
token = (await J(await post('/users/login', { name: 'Doc Control', password: 'DocPW2026!' })))?.token;
t('signed in', !!token);
const status = (id) => { const d = new Database(process.env.DBPATH, { readonly: true }); const r = d.prepare('SELECT status, archived_at, archive_reason FROM sop_documents WHERE id = ?').get(id); d.close(); return r; };

console.log('\nA document, withdrawn with a reason');
const doc = await J(await post('/documents', { doc_number: 'SOP 999', title: 'Withdraw test', category: 'quality', revision: 'V1', status: 'active' }));
t('created active', !!doc?.id && status(doc?.id)?.status === 'active', JSON.stringify(doc || {}).slice(0, 100));
{
  const r = await del(`/documents/${doc.id}`, { reason: 'superseded by SOP 998' });
  t('withdrawn', r.ok && status(doc.id)?.status === 'archived', `got ${r.status} ${JSON.stringify(status(doc.id))}`);
  t('with who/when/why recorded', !!status(doc.id)?.archived_at && /superseded/.test(status(doc.id)?.archive_reason || ''));
}

console.log('\nThe bug: an edit that carries the fallback status');
{
  // What the old form sent after the browser fell back to the first option.
  const r = await put(`/documents/${doc.id}`, { title: 'Withdraw test (typo fixed)', status: 'draft' });
  const b = await J(r);
  t('PUT status=draft on a withdrawn document is REFUSED', r.status === 400, `got ${r.status}`);
  t('...and names Reinstate', b?.use === 'reinstate' && /reinstate/i.test(b?.error || ''), b?.error);
  t('IT IS STILL WITHDRAWN', status(doc.id)?.status === 'archived', JSON.stringify(status(doc.id)));
}

console.log('\nAn honest edit of a withdrawn document still works');
{
  const r = await put(`/documents/${doc.id}`, { title: 'Withdraw test (typo fixed)', status: 'archived' });
  t('title edit with status unchanged is accepted', r.ok, `got ${r.status}`);
  t('still withdrawn', status(doc.id)?.status === 'archived');
  const r2 = await put(`/documents/${doc.id}`, { title: 'Withdraw test (again)' });
  t('an edit that sends no status is accepted', r2.ok, `got ${r2.status}`);
}

console.log('\nThe doors still work, and are the only way across the line');
{
  const r = await post(`/documents/${doc.id}/reinstate`, {});
  t('reinstate returns it to draft', r.ok && status(doc.id)?.status === 'draft', `got ${r.status} ${JSON.stringify(status(doc.id))}`);
  const r2 = await put(`/documents/${doc.id}`, { status: 'archived' });
  const b2 = await J(r2);
  t('PUT status=archived on a live document is refused — withdrawing needs a reason', r2.status === 400 && b2?.use === 'withdraw', `got ${r2.status}`);
  const r3 = await put(`/documents/${doc.id}`, { status: 'active' });
  t('an ordinary status change (draft → active) still works', r3.ok && status(doc.id)?.status === 'active', `got ${r3.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
