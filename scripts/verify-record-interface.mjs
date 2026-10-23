// D-207 (single-spine move 02): the record interface — file, sign, revoke,
// retrieve, describe — adopted by sanitation records and scale verifications.
//
// What this proves:
//   - every registered type implements all five;
//   - GET /api/records lists both types in one shape, and agrees with the
//     modules' own tables;
//   - a signature made on the module's route, or through QA Review, shows on the
//     described record — one writer, whichever door;
//   - a scale verification can be REVOKED now (there was no way back before), by
//     the signer or an admin and nobody else;
//   - each type is read only by someone who can open its module, and a record
//     the caller may not read is a 404.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5126;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('── the interface ──');
const { RECORD_TYPES, INTERFACE } = await import('../server/record-interface.js');
for (const rt of RECORD_TYPES) {
  const missing = [...INTERFACE, 'get', 'canRead'].filter(k => typeof rt[k] !== 'function');
  t(`${rt.type} implements file, sign, revoke, retrieve, describe`, !missing.length && Array.isArray(rt.modules) && rt.modules.length > 0, missing.join(', '));
}
t('sanitation and scale are the two adopted types', RECORD_TYPES.map(r => r.type).sort().join() === 'sanitation,scale');

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('ri-a', 'Rec Admin', 'admin', 'quality', null);
mkUser('ri-q', 'Rec Quality', 'supervisor', 'qa', JSON.stringify({ sanitation: 'edit', 'qa-inspections': 'edit', calibration: 'edit', 'qa-review': 'edit' }));
mkUser('ri-c', 'Rec Calib', 'operator', 'warehouse', JSON.stringify({ calibration: 'view' }));
mkUser('ri-o', 'Rec Operator', 'operator', 'warehouse', null);

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const tok = (await call('POST', '/users/login', { name, password: pw })).body?.token;
  return { ...H, Authorization: `Bearer ${tok}` };
};
const A = await login('ri-a', 'Rec Admin', 'RecAdmin2026!');
const Q = await login('ri-q', 'Rec Quality', 'RecQuality2026!');
const C = await login('ri-c', 'Rec Calib', 'RecCalib2026!');
const O = await login('ri-o', 'Rec Operator', 'RecOperator2026!');
const today = db.prepare("SELECT date('now') d").get().d;

console.log('\n── filing on the modules\' own routes ──');
let r = await call('POST', '/sanitation', { area: 'Restroom', type: 'post_op', performed_by: 'Zuleika Test', result: 'pass' }, A);
const san = r.body;
t('a restroom clean is filed', r.status === 201 && !!san?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
const forms = (await call('GET', '/scale-verification/forms', undefined, A)).body?.forms || [];
const f1 = forms.find(f => f.code === '417-01');
r = await call('POST', '/scale-verification', { form_code: '417-01', room: 'Batching 1', performed_by: 'Bernardo Test',
  readings: f1.points.map(p => p.nominal) }, A);
const sc = r.body;
t('a scale check is filed and passes', r.status === 201 && sc?.result === 'pass', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

console.log('\n── one list, one shape ──');
r = await call('GET', `/records?from=${today}`, undefined, A);
const list = r.body;
const rs = list?.records?.find(x => x.type === 'sanitation' && x.id === san?.id);
const rk = list?.records?.find(x => x.type === 'scale' && x.id === sc?.id);
t('GET /api/records lists both types', r.status === 200 && !!rs && !!rk && list.types.join() === 'sanitation,scale', `${r.status} ${JSON.stringify(list?.types)}`);
t('the clean is described: form, place, who, result, unsigned', rs?.form && /^FORM 108/.test(rs.form) && rs.place === 'Restrooms'
  && rs.performed_by === 'Zuleika Test' && rs.result === 'pass' && rs.signed_by === null, JSON.stringify(rs));
t('the scale check is described with its form and revision', rk?.form === 'FORM 417-01 V4' && rk.place === 'Batching 1' && rk.performed_by === 'Bernardo Test', JSON.stringify(rk));
const sanToday = db.prepare('SELECT COUNT(*) n FROM sanitation_records WHERE substr(performed_at,1,10) >= ?').get(today).n;
const scaleToday = db.prepare('SELECT COUNT(*) n FROM scale_verifications WHERE substr(performed_at,1,10) >= ?').get(today).n;
t('the counts agree with the modules\' own tables', list.records.filter(x => x.type === 'sanitation').length === sanToday
  && list.records.filter(x => x.type === 'scale').length === scaleToday && list.total === sanToday + scaleToday, `${list.total} vs ${sanToday}+${scaleToday}`);
r = await call('GET', `/records?from=${today}&person=bernardo test`, undefined, A);
t('the person filter finds what they did (case-insensitive)', r.body?.records?.length === 1 && r.body.records[0].id === sc.id, JSON.stringify(r.body?.records?.map(x => x.id)));
r = await call('GET', `/records?from=${today}&form=FORM 417`, undefined, A);
t('the form filter narrows by form number', r.body?.records?.every(x => x.type === 'scale') && r.body.records.some(x => x.id === sc.id));
r = await call('GET', '/records?type=nonsense', undefined, A);
t('an unknown type is refused by name (400)', r.status === 400 && /sanitation, scale/.test(r.body?.error || ''), JSON.stringify(r.body));
r = await call('GET', `/records/scale/${sc.id}`, undefined, A);
t('one record is described on its own', r.status === 200 && r.body?.id === sc.id && r.body?.type === 'scale');

console.log('\n── one writer for a signature, whichever door ──');
r = await call('PUT', `/scale-verification/${sc.id}/verify`, { signature_password: 'RecQuality2026!' }, Q);
t('QA verifies the scale check on the module route', r.status === 200 && r.body?.verified_by === 'Rec Quality', `${r.status}`);
r = await call('GET', `/records/scale/${sc.id}`, undefined, A);
t('…and the described record says who signed', r.body?.signed_by === 'Rec Quality' && !!r.body?.signed_at, JSON.stringify(r.body));
r = await call('GET', `/records?from=${today}&signed=no`, undefined, A);
t('the "unsigned" filter now leaves it out', !r.body?.records?.some(x => x.id === sc.id));
r = await call('POST', '/qa-review/sign', { source: 'sanitation', ids: [san.id], signature_password: 'RecQuality2026!' }, Q);
t('QA Review signs the clean (through the interface)', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', `/records/sanitation/${san.id}`, undefined, A);
t('…and the described record says so', r.body?.signed_by === 'Rec Quality', JSON.stringify(r.body));

console.log('\n── a scale verification can be revoked now ──');
r = await call('DELETE', `/scale-verification/${sc.id}/verify`, undefined, C);
t('someone who did not sign it cannot revoke it (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('DELETE', `/scale-verification/${sc.id}/verify`, undefined, Q);
t('the signer revokes their own verification', r.status === 200 && r.body?.verified_by === null, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
const rev = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'scale_verification' AND entity_id = ? AND details LIKE '%verification_revoked%'").get(sc.id);
t('…and it is audited with who had signed', /Rec Quality/.test(rev?.details || ''), rev?.details);
r = await call('DELETE', `/scale-verification/${sc.id}/verify`, undefined, Q);
t('revoking an unsigned check is refused (400)', r.status === 400);
r = await call('DELETE', `/sanitation/${san.id}/verify`, undefined, A);
t('an admin revokes the sanitation verification (the extracted function still answers the route)', r.status === 200 && r.body?.verified_by === null, `${r.status}`);

console.log('\n── who reads what ──');
r = await call('GET', '/records/types', undefined, C);
t('a calibration-only account sees only the scale type', JSON.stringify(r.body?.map(x => x.type)) === '["scale"]'
  && r.body?.[0]?.implements?.length === 5, JSON.stringify(r.body));
r = await call('GET', `/records?from=${today}`, undefined, C);
t('…and only scale records in the list', r.body?.records?.length > 0 && r.body.records.every(x => x.type === 'scale'));
r = await call('GET', `/records/sanitation/${san.id}`, undefined, C);
t('…and a sanitation record is a 404, not a 403', r.status === 404);
r = await call('GET', `/records?from=${today}`, undefined, O);
t('an account with no record modules reads nothing', r.status === 200 && r.body?.records?.length === 0 && r.body?.types?.length === 0, JSON.stringify(r.body).slice(0, 120));
r = await call('POST', '/records', {}, A);
t('the surface is read-only (no POST)', r.status === 404 || r.status === 405, `${r.status}`);

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
