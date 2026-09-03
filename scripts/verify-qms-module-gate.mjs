// What a module map means on /api/qms — executed against a live server.
//
// requireType() read the map itself: a NULL map passed every write (the
// Settings bug, on the server, on a router mounted outside the shared guard
// so this was the only gate), and a VIEW grant was refused from filing
// although the rule for this module is that anyone who can see a deviation
// may report one. moduleLevel() is the one reading now.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4911;
const B = `http://localhost:${PORT}/api`;
const MOD = 'deviations';
const J = async r => { try { return await r.json(); } catch { return null; } };
const mk = (tok) => (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');

const db = new Database(process.env.DBPATH);
const mkUser = (id, name, role, map) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,'warehouse',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, 'SC-' + id, map);
mkUser('g-none', 'Gate Nobody', 'operator', null);
mkUser('g-view', 'Gate Viewer', 'operator', JSON.stringify({ [MOD]: 'view' }));
mkUser('g-edit', 'Gate Editor', 'operator', JSON.stringify({ [MOD]: 'edit' }));
mkUser('g-adm', 'Gate Admin', 'admin', null);
mkUser('g-aud', 'Gate Auditor', 'auditor', null);
db.close();
const login = async (id, name) => {
  const anon = mk(null);
  await anon('/users/login', { method: 'POST', body: JSON.stringify({ name }) });
  await anon('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password: 'GatePW2026!', setup_code: 'SC-' + id }) });
  return mk((await J(await anon('/users/login', { method: 'POST', body: JSON.stringify({ name, password: 'GatePW2026!' }) })))?.token);
};
const none = await login('g-none', 'Gate Nobody'), view = await login('g-view', 'Gate Viewer'),
  edit = await login('g-edit', 'Gate Editor'), adm = await login('g-adm', 'Gate Admin'), aud = await login('g-aud', 'Gate Auditor');
const file = (c, who) => c('/qms/deviation', { method: 'POST', body: JSON.stringify({ initiator: who, description: 'gate test', lot: 'L' }) });

console.log('\nNothing assigned means nothing — including on /api/qms');
{
  const r = await file(none, 'Nobody');
  t('A NULL MAP CANNOT FILE A QMS RECORD', r.status === 403, `got ${r.status}`);
  t('...and is told why', /assigned/i.test((await J(r))?.error || ''));
}

console.log('\nView may FILE, and nothing else');
let devId = null;
{
  const r = await file(view, 'Viewer');
  const b = await J(r);
  devId = b?.id;
  t('a viewer can report a deviation (the rule written for this module)', r.status === 201 && !!devId, `got ${r.status}`);
  const g = await view(`/qms/deviation/${devId}`);
  t('and read it back', g.ok, `got ${g.status}`);
  const put = await view(`/qms/deviation/${devId}`, { method: 'PUT', body: JSON.stringify({ description: 'edited' }) });
  t('but cannot edit it', put.status === 403, `got ${put.status}`);
  const del = await view(`/qms/deviation/${devId}`, { method: 'DELETE' });
  t('cannot delete it', del.status === 403, `got ${del.status}`);
  const sign = await view(`/qms/deviation/${devId}/approve`, { method: 'POST', body: JSON.stringify({ role: 'qa_director' }) });
  t('cannot sign it', sign.status === 403, `got ${sign.status}`);
}

console.log('\nEdit may do all of it; auditor none of it; admin unchanged');
{
  // The module gate is one door; mayEdit() is the second — the filer while
  // unsigned, or a records role. An operator with module Edit passes the gate
  // and is then refused on SOMEBODY ELSE'S record, which is the documented
  // records-integrity rule and not this bug. So: the editor files their own.
  const other = await edit(`/qms/deviation/${devId}`, { method: 'PUT', body: JSON.stringify({ description: 'x' }) });
  t('an editor passes the module gate but mayEdit refuses another filer\'s record', other.status === 403, `got ${other.status}`);
  const own = await J(await file(edit, 'Editor'));
  const put = await edit(`/qms/deviation/${own?.id}`, { method: 'PUT', body: JSON.stringify({ description: 'edited by editor' }) });
  t('an editor can edit their own record', put.ok, `got ${put.status}`);
  const a = await file(aud, 'Auditor');
  t('an auditor is read-only', a.status === 403, `got ${a.status}`);
  const ad = await file(adm, 'Admin');
  t('an admin with no map files as before', ad.status === 201, `got ${ad.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
