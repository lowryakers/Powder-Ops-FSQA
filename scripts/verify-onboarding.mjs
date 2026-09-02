// The ADP onboarding fold, executed against a live server.
//
// Folding a branch that shares no history with main is a merge by hand: seven
// files, a table, two mounts, a public path and five client wires. Booting is
// not evidence that any of it is connected — the endpoints have to answer.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4902;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('ob-admin','Onb Admin','Onb Admin','admin','office',1,'SC-OB',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('ob-op','Onb Operator','Onb Operator','operator','warehouse',1,'SC-OP',datetime('now','+7 day'),'{"production-log":"edit"}')`).run();
t('the onboarding_records table exists on a fresh database',
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='onboarding_records'").get());
db.close();

await post('/users/login', { name: 'Onb Admin' });
await post('/users/set-password', { user_id: 'ob-admin', password: 'OnbPW2026!', setup_code: 'SC-OB' });
token = (await J(await post('/users/login', { name: 'Onb Admin', password: 'OnbPW2026!' })))?.token;
t('admin signed in', !!token);

console.log('\nThe admin router is mounted and behind the module');
let rec = null, link = null;
{
  const r = await post('/onboarding', { first_name: 'Test', last_name: 'Hire', email: 't@example.com' });
  rec = await J(r);
  t('a record can be created', r.ok && !!rec?.id, `got ${r.status}`);
  t('it starts as invited', rec?.status === 'invited', `got ${rec?.status}`);
  const list = await J(await req('/onboarding'));
  const rows = Array.isArray(list) ? list : (list?.records || list?.rows || []);
  t('and it comes back on the list', rows.some(x => x.id === rec?.id));
}

console.log('\nThe token link, and the public portal a new hire uses');
{
  const r = await J(await post(`/onboarding/${rec.id}/reissue`));
  link = r?.link || r?.url || null;
  t('a link is issued', !!link, JSON.stringify(r || {}).slice(0, 90));
}
{
  const tok = String(link || '').split('/').pop();
  const noAuth = await fetch(`${B}/onboarding-portal/${tok}`);
  t('THE PORTAL ANSWERS WITH NO SESSION', noAuth.ok, `got ${noAuth.status}`);
  const body = await J(noAuth);
  t('and returns that hire\'s record', body?.first_name === 'Test' || body?.id === rec.id,
    JSON.stringify(body || {}).slice(0, 90));
  const bogus = await fetch(`${B}/onboarding-portal/not-a-real-token`);
  t('a bad token is refused', bogus.status === 404, `got ${bogus.status}`);
}

console.log('\nThe data that should never be in clear');
{
  const tok = String(link).split('/').pop();
  await fetch(`${B}/onboarding-portal/${tok}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Test', ssn: '123-45-6789', dd_account: '000123456789', dd_routing: '021000021' }),
  });
  const d = new Database(process.env.DBPATH, { readonly: true });
  const row = d.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id);
  d.close();
  const clear = JSON.stringify(row);

  if (process.env.ONBOARDING_ENC_KEY) {
    // THE SAVE HAS TO HAVE LANDED FIRST. "Not stored in clear" is trivially
    // true of a record that stored nothing at all, which is how a security
    // assertion passes while the feature is broken — it did here, until this
    // line was added.
    t('the submission actually saved', !!row?.ssn_enc && !!row?.dd_account_enc,
      `ssn_enc=${!!row?.ssn_enc} dd_account_enc=${!!row?.dd_account_enc}`);
    t('only the last four are readable', row?.ssn_last4 === '6789' && row?.dd_account_last4 === '6789',
      `ssn_last4=${row?.ssn_last4} dd_last4=${row?.dd_account_last4}`);
    t('the SSN is not stored in clear', !clear.includes('123-45-6789'));
    t('the account number is not stored in clear', !clear.includes('000123456789'));
  } else {
    // With no key configured the fields are NOT COLLECTED AT ALL. A plaintext
    // SSN in a database backup is a worse outcome than a form with two fewer
    // fields, and this is the assertion that proves the app takes that line
    // rather than quietly storing them unencrypted.
    t('with no key, nothing sensitive is stored at all',
      !row?.ssn_enc && !row?.ssn_last4 && !row?.dd_account_enc);
    t('and certainly not in clear', !clear.includes('123-45-6789') && !clear.includes('000123456789'));
    t('the rest of the submission still saves', row?.first_name === 'Test', `first_name=${row?.first_name}`);
  }
}

console.log('\nAn operator with no grant gets nothing');
{
  await post('/users/login', { name: 'Onb Operator' });
  await post('/users/set-password', { user_id: 'ob-op', password: 'OpPW2026!', setup_code: 'SC-OP' });
  const opTok = (await J(await post('/users/login', { name: 'Onb Operator', password: 'OpPW2026!' })))?.token;
  const r = await fetch(`${B}/onboarding`, { headers: { Authorization: `Bearer ${opTok}` } });
  t('the module guard refuses them', r.status === 403 || r.status === 401, `got ${r.status}`);
}

console.log('\nADP itself degrades gracefully, like storage and AI');
{
  const r = await post(`/onboarding/${rec.id}/submit-adp`, {});
  t('submitting with no ADP credentials 503s rather than throwing',
    r.status === 503 || r.status === 400, `got ${r.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
