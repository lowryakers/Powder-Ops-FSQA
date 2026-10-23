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
t('sanitation, scale and qms are the adopted types', RECORD_TYPES.map(r => r.type).sort().join() === 'qms,sanitation,scale');

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('ri-a', 'Rec Admin', 'admin', 'quality', null);
mkUser('ri-q', 'Rec Quality', 'supervisor', 'qa', JSON.stringify({ sanitation: 'edit', 'qa-inspections': 'edit', calibration: 'edit', 'qa-review': 'edit', deviations: 'edit', 'maintenance-signout': 'edit' }));
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
t('GET /api/records lists the types', r.status === 200 && !!rs && !!rk && list.types.join() === 'sanitation,scale,qms', `${r.status} ${JSON.stringify(list?.types)}`);
t('the clean is described: form, place, who, result, unsigned', rs?.form && /^FORM 108/.test(rs.form) && rs.place === 'Restrooms'
  && rs.performed_by === 'Zuleika Test' && rs.result === 'pass' && rs.signed_by === null, JSON.stringify(rs));
t('the scale check is described with its form and revision', rk?.form === 'FORM 417-01 V4' && rk.place === 'Batching 1' && rk.performed_by === 'Bernardo Test', JSON.stringify(rk));
const sanToday = db.prepare('SELECT COUNT(*) n FROM sanitation_records WHERE substr(performed_at,1,10) >= ?').get(today).n;
const scaleToday = db.prepare('SELECT COUNT(*) n FROM scale_verifications WHERE substr(performed_at,1,10) >= ?').get(today).n;
const qmsToday = db.prepare('SELECT COUNT(*) n FROM qms_records WHERE substr(COALESCE(record_date, created_at),1,10) >= ?').get(today).n;
t('the counts agree with the modules\' own tables', list.records.filter(x => x.type === 'sanitation').length === sanToday
  && list.records.filter(x => x.type === 'scale').length === scaleToday && list.total === sanToday + scaleToday + qmsToday, `${list.total} vs ${sanToday}+${scaleToday}+${qmsToday}`);
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

console.log('\n── QMS records on the interface ──');
r = await call('POST', '/qms/deviation', { product_description: 'Interface test blend', lot: 'L-RI-1', record_date: today }, Q);
const dev = r.body;
t('a deviation is filed on the module route', r.status === 201 && !!dev?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', `/records/qms/${dev.id}`, undefined, A);
t('…described: Form 442-01, its number and product, unsigned, three approvals pending', r.status === 200 && r.body?.form === 'Form 442-01'
  && /^Deviation .+ — Interface test blend$/.test(r.body?.title || '') && r.body.signed_by === null
  && r.body.approvals_pending?.join() === 'manufacturing_manager,qa_director,customer', JSON.stringify(r.body));
r = await call('POST', `/qms/deviation/${dev.id}/approve`, { role: 'qa_director', signature_password: 'RecQuality2026!' }, Q);
t('QA signs as QA Director on the module route', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', `/records/qms/${dev.id}`, undefined, A);
t('…and the described record names the signature and its role', r.body?.signed_by === 'Rec Quality' && r.body.signatures?.length === 1
  && r.body.signatures[0].role === 'qa_director' && r.body.approvals_pending?.join() === 'manufacturing_manager,customer', JSON.stringify(r.body));
r = await call('GET', `/records?type=qms&from=${today}&person=rec quality`, undefined, A);
t('the person filter finds a record by who SIGNED it', r.body?.records?.some(x => x.id === dev.id));
r = await call('GET', `/records?type=qms&qms_type=deviation&signed=yes`, undefined, A);
t('qms_type and signed=yes narrow to it', r.body?.records?.some(x => x.id === dev.id) && r.body.records.every(x => x.group === 'deviation'));

process.env.DB_PATH = process.env.DBPATH;
const { recordType: rt } = await import('../server/record-interface.js');
// Shaped like req.user: the session middleware hands the map over parsed.
const asUser = (id) => { const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id); return { ...u, module_access: u.module_access ? JSON.parse(u.module_access) : null }; };
const qUser = asUser('ri-q');
const aUser = asUser('ri-a');
let out = rt('qms').sign(db, aUser, dev.id, {});
t('the interface refuses to guess which of two approvals is meant', out.status === 400 && /more than one approval/.test(out.error || ''), JSON.stringify(out));
out = rt('qms').sign(db, aUser, dev.id, { role: 'manufacturing_manager', record_type: 'knife_sign_out' });
t('…and a record of another form is not found (a queue cannot cross forms)', out.status === 404);
out = rt('qms').revoke(db, aUser, dev.id, {});
t('revoke with one signature on the record needs no role name — but only the signer or an admin', out.ok === true, JSON.stringify(out));
r = await call('GET', `/records/qms/${dev.id}`, undefined, A);
t('…and the described record is unsigned again', r.body?.signed_by === null && r.body.signatures.length === 0);
const audit = db.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid").all(dev.id).map(x => x.action);
t('every act is audited by the module\'s own functions', audit.includes('create') && audit.includes('qms_signed_qa_director') && audit.includes('qms_unsigned_qa_director'), audit.join());
out = rt('qms').file(db, qUser, { record_type: 'deviation', product_description: 'Filed through the interface', record_date: today });
t('filing through the interface writes an ordinary deviation', !!out.record?.id && out.record.record_type === 'deviation' && /^\d+|\w/.test(out.record.record_number || ''), JSON.stringify(out).slice(0, 160));
out = rt('qms').file(db, asUser('ri-c'), { record_type: 'deviation', product_description: 'x' });
t('…someone without the module cannot (404)', out.status === 404);

r = await call('POST', '/qms/maintenance_sign_out', { item_name: 'Torque wrench', employee_name: 'Ricardo Test', status: 'returned', condition_out: 'Good', condition_returned: 'Good', return_reason: 'Returned', record_date: today }, Q);
const so = r.body;
t('a routine tool return is filed', r.status === 201 && !!so?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('POST', '/qa-review/sign', { source: 'sign-out-equipment', ids: [so.id], signature_password: 'RecQuality2026!' }, Q);
t('QA Review signs it (through the interface)', r.status === 200 && r.body?.signed?.length === 1, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', `/records/qms/${so.id}`, undefined, A);
t('…and the described record says who signed, as a batch review', r.body?.signed_by === 'Rec Quality' && r.body?.form === 'Form 703-01', JSON.stringify(r.body));
r = await call('POST', '/qa-review/sign', { source: 'sign-out-equipment', ids: [dev.id], signature_password: 'RecQuality2026!' }, Q);
const devAfter = db.prepare('SELECT approvals FROM qms_records WHERE id = ?').get(dev.id).approvals;
t('the sign-out queue cannot sign a deviation id handed to it', !/quality/.test(devAfter || ''), devAfter);

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
