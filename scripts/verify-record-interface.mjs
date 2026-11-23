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
// A type implements all five, or documents the subset (D-369): `signs: false`
// when no signature exists for it (no sign / revoke), `filedBy: ['task']` when
// completing its task is the only door (no file). Anything else missing fails.
for (const rt of RECORD_TYPES) {
  const allowed = new Set([...(rt.signs === false ? ['sign', 'revoke'] : []),
    ...(Array.isArray(rt.filedBy) && !rt.filedBy.some(d => d !== 'task') ? ['file'] : [])]);
  const missing = [...INTERFACE, 'get', 'canRead'].filter(k => typeof rt[k] !== 'function' && !allowed.has(k));
  const extra = [...allowed].filter(k => typeof rt[k] === 'function');
  t(`${rt.type} implements ${rt.signs === false || allowed.size ? 'its documented subset' : 'file, sign, revoke, retrieve, describe'}`,
    !missing.length && !extra.length && Array.isArray(rt.modules) && rt.modules.length > 0, missing.concat(extra).join(', '));
}
const ADOPTED = 'banned_list_review,culture_check,emp,food_defense_challenge,gmp_walk,management_review,production,qms,sanitation,scale';
t('the adopted types: sanitation, scale, qms, production and the six check records', RECORD_TYPES.map(r => r.type).sort().join() === ADOPTED, RECORD_TYPES.map(r => r.type).sort().join());
t('no check record claims a signature', RECORD_TYPES.filter(r => ['emp', 'gmp_walk', 'banned_list_review', 'culture_check', 'management_review', 'food_defense_challenge'].includes(r.type)).every(r => r.signs === false && !r.sign && !r.revoke));

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
t('GET /api/records lists the types', r.status === 200 && !!rs && !!rk && list.types.join() === 'sanitation,scale,qms,production,emp,gmp_walk,banned_list_review,culture_check,management_review,food_defense_challenge', `${r.status} ${JSON.stringify(list?.types)}`);
t('the clean is described: form, place, who, result, unsigned', rs?.form && /^FORM 108/.test(rs.form) && rs.place === 'Restrooms'
  && rs.performed_by === 'Zuleika Test' && rs.result === 'pass' && rs.signed_by === null, JSON.stringify(rs));
t('the scale check is described with its form and revision', rk?.form === 'FORM 417-01 V4' && rk.place === 'Batching 1' && rk.performed_by === 'Bernardo Test', JSON.stringify(rk));
const sanToday = db.prepare('SELECT COUNT(*) n FROM sanitation_records WHERE substr(performed_at,1,10) >= ?').get(today).n;
const scaleToday = db.prepare('SELECT COUNT(*) n FROM scale_verifications WHERE substr(performed_at,1,10) >= ?').get(today).n;
const qmsToday = db.prepare('SELECT COUNT(*) n FROM qms_records WHERE substr(COALESCE(record_date, created_at),1,10) >= ?').get(today).n;
t('the counts agree with the modules\' own tables', list.records.filter(x => x.type === 'sanitation').length === sanToday
  && list.records.filter(x => x.type === 'scale').length === scaleToday
  && list.records.filter(x => ['sanitation', 'scale', 'qms'].includes(x.type)).length === sanToday + scaleToday + qmsToday, `${list.total} vs ${sanToday}+${scaleToday}+${qmsToday}`);
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

console.log('\n── production entries (D-370) ──');
mkUser('ri-p', 'Rec Prodqa', 'supervisor', 'qa', JSON.stringify({ 'production-log': 'edit' }));
mkUser('ri-p2', 'Rec Otherqa', 'supervisor', 'qa', JSON.stringify({ 'production-log': 'edit' }));
const P = await login('ri-p', 'Rec Prodqa', 'RecProdqa2026!');
const P2 = await login('ri-p2', 'Rec Otherqa', 'RecOtherqa2026!');
r = await call('POST', '/production/entries', { date: today, team: 'Batching', submitted_by: 'Bernardo Test', people_count: 2,
  mo_lines: [
    { product_name: 'RI Vanilla', mo_number: 'MO-RI-1', lot_number: 'RILOT-A', quantity: 300, start_time: '07:00', end_time: '09:00', room: 'Batching 1' },
    { product_name: 'RI Chocolate', mo_number: 'MO-RI-2', lot_number: 'RILOT-B', quantity: 200, start_time: '09:30', end_time: '11:00', room: 'Batching 2' },
  ] }, A);
const pe = r.body;
t('an end-of-day entry is filed on the Production Log route', r.status === 201 && !!pe?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', `/records?from=${today}&type=production`, undefined, A);
const dp = r.body?.records?.find(x => x.id === pe?.id);
t('…and is on GET /api/records: team, room, who, when, both lots and MOs, pending QA',
  dp?.form === 'Production Log · Batching EOD' && dp.place === 'Batching 1' && dp.team === 'Batching' && dp.performed_by === 'Bernardo Test' && dp.performed_at === today
  && JSON.stringify(dp.lots) === '["RILOT-A","RILOT-B"]' && JSON.stringify(dp.mos) === '["MO-RI-1","MO-RI-2"]' && dp.result === 'pending QA' && dp.signed_by === null, JSON.stringify(dp));
const prodToday = db.prepare('SELECT COUNT(*) n FROM production_entries WHERE date >= ?').get(today).n;
t('the production count agrees with the table', r.body.records.length === prodToday, `${r.body.records.length} vs ${prodToday}`);
r = await call('GET', `/records?from=${today}&lot=rilot-b`, undefined, A);
t('the SECOND MO\'s lot finds the entry — and only types that know a lot answer', r.body?.records?.length === 1 && r.body.records[0].id === pe?.id, JSON.stringify(r.body?.records?.map(x => x.type)));
r = await call('GET', `/records?mo=MO-RI-2`, undefined, A);
t('an MO finds it', r.body?.records?.some(x => x.id === pe?.id) && r.body.records.every(x => x.type === 'production'));
r = await call('GET', `/records?from=${today}&team=Batching&person=bernardo test`, undefined, A);
t('team and person narrow it', r.body?.records?.some(x => x.id === pe?.id) && r.body.records.every(x => x.type === 'production' || x.performed_by?.toLowerCase() === 'bernardo test'));
r = await call('GET', `/records?from=${today}&place=Batching 2&type=production`, undefined, A);
t('a room on the second run finds it too', r.body?.records?.some(x => x.id === pe?.id));
r = await call('GET', `/records?lot=RILOT-A&type=sanitation`, undefined, A);
t('a lot asked of sanitation records matches none (not all)', r.body?.records?.length === 0);

r = await call('PUT', `/production/entries/${pe?.id}/qa-signoff`, { qa_signoff_by: 'Rec Prodqa' }, P);
t('QA sign-off without the password is refused (gateSignature)', r.status === 403 && r.body?.signature_required === true, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('PUT', `/production/entries/${pe?.id}/qa-signoff`, { qa_signoff_by: 'Rec Prodqa', signature_password: 'RecProdqa2026!' }, P);
t('with it, the entry is signed', r.status === 200 && r.body?.qa_signoff_by === 'Rec Prodqa', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call('GET', `/records/production/${pe?.id}`, undefined, A);
t('…and the described record shows who signed', r.body?.signed_by === 'Rec Prodqa' && r.body.result === 'signed' && r.body.signatures?.length === 1);
r = await call('GET', `/records?from=${today}&type=production&signed=yes`, undefined, A);
t('signed=yes finds it', r.body?.records?.some(x => x.id === pe?.id));
const botAcct = 'ri-bot';
mkUser(botAcct, 'Rec Bot', 'supervisor', 'qa', JSON.stringify({ 'production-log': 'edit' }));
const minted = (await call('POST', '/api-tokens', { user_id: botAcct, label: 'record-interface verify', scopes: ['read', 'write'] }, A)).body?.plaintext;
const BOT = { ...H, Authorization: `Bearer ${minted}` };
r = await call('DELETE', `/production/entries/${pe?.id}/qa-signoff`, { signature_password: 'x' }, BOT);
t('a token cannot revoke a sign-off', !!minted && r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('PUT', `/production/entries/${pe?.id}/qa-signoff`, { qa_signoff_by: 'Rec Bot', signature_password: 'x' }, BOT);
t('…nor sign one', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('DELETE', `/production/entries/${pe?.id}/qa-signoff`, {}, P);
t('revoking asks for the password too', r.status === 403 && r.body?.signature_required === true, `${r.status}`);
r = await call('DELETE', `/production/entries/${pe?.id}/qa-signoff`, { signature_password: 'RecOtherqa2026!' }, P2);
t('another QA supervisor cannot revoke it (the signer or an admin)', r.status === 403 && /Rec Prodqa or an admin/.test(r.body?.error || ''), `${r.status} ${JSON.stringify(r.body)}`);
r = await call('DELETE', `/production/entries/${pe?.id}/qa-signoff`, { signature_password: 'RecProdqa2026!' }, P);
t('the signer can', r.status === 200 && r.body?.qa_signoff_by == null, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
const revAudit = db.prepare(`SELECT details FROM audit_log WHERE entity_type = 'production_entry' AND entity_id = ? AND details LIKE '%qa_signoff_revoked%'`).get(pe?.id);
t('…audited with who had signed', /"was_signed_by":"Rec Prodqa"/.test(revAudit?.details || ''));
r = await call('GET', `/records/production/${pe?.id}`, undefined, A);
t('…and the record reads unsigned again', r.body?.signed_by === null && r.body.result === 'pending QA');
{
  const { recordType } = await import('../server/record-interface.js');
  const { getDb } = await import('../server/db.js');
  const appDb = getDb();
  const n0 = db.prepare('SELECT COUNT(*) n FROM production_entries').get().n;
  const out = recordType('production').file(appDb, { id: 'ri-a', name: 'Rec Admin', role: 'admin' }, { date: today, team: 'Filling', room: 'Room 3',
    product_name: 'RI Stick', mo_number: 'MO-RI-3', lot_number: 'RILOT-C', start_time: '07:00', end_time: '08:00', quantity_completed: 50, people_count: 1 });
  t('filing through the interface uses the route\'s writer (same table, signer = the person)', out.status === 201 && db.prepare('SELECT COUNT(*) n FROM production_entries').get().n === n0 + 1
    && out.entry?.submitted_by === 'Rec Admin', JSON.stringify(out).slice(0, 160));
  const bad = recordType('production').file(appDb, { id: 'ri-a', name: 'Rec Admin', role: 'admin' }, { date: today, team: 'Filling' });
  t('…and refuses what the route refuses', bad.status === 400 && /Missing required fields/.test(bad.error || ''));
  const fs = await import('fs');
  const src = fs.readdirSync('server', { recursive: true }).filter(f => String(f).endsWith('.js')).map(f => `server/${f}`)
    .filter(f => fs.readFileSync(f, 'utf8').includes('INSERT INTO production_entries'));
  // production-seed.js is the one-time import of the plant's own history, run
  // only on an empty table — not a door. Nothing else may insert an entry.
  t('one writer: only the Production Log (and the first-boot history import) inserts an entry',
    JSON.stringify(src.sort()) === '["server/api/production.js","server/production-seed.js"]', JSON.stringify(src));
}

console.log('\n── the check records (D-369), each through its own door ──');
const { MANAGEMENT_REVIEW_ITEMS, FOOD_DEFENSE_ITEMS, GMP_WALK_ITEMS, CULTURE_SAFETY_ITEMS } = await import('../shared/check-forms.js');
// EMP by hand (the route), with a result.
r = await call('POST', '/check-records/emp/samples', { zone: 'zone1', test: (await call('GET', '/check-records/emp/zones', undefined, A)).body.zones.zone1.tests[0],
  site: 'Blender 1', sampled_on: today, lab: 'CTLA', sampled_by: 'Emma Sampler' }, A);
const emp = r.body?.sample;
t('an EMP sample is filed on its own route', r.status === 201 && !!emp?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
// Management review and Food Defense by hand (the routes).
r = await call('POST', '/check-records/management-reviews', { reviewed_on: today, reviewed_by: 'Mona Review', attendees: 'Adam, Maria',
  items: Object.fromEntries(MANAGEMENT_REVIEW_ITEMS.map(i => [i.key, { result: 'done' }])) }, A);
const mr = r.body;
t('a management review is filed by hand', r.status === 201 && !!mr?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
r = await call('POST', '/check-records/food-defense/challenges', { performed_on: today, performed_by: 'Fran Defense', team: 'QA', methods: ['mock_scenario'],
  outcome: 'Plan held', findings: 'None', corrective_actions: 'None',
  items: Object.fromEntries(FOOD_DEFENSE_ITEMS.map(i => [i.key, { result: 'done' }])) }, A);
const fd = r.body;
t('a Food Defense challenge is filed by hand', r.status === 201 && !!fd?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
// Culture check from its page.
const allC = Object.fromEntries([...GMP_WALK_ITEMS, ...CULTURE_SAFETY_ITEMS].map(i => [i.key, { result: 'c' }]));
r = await call('POST', '/culture/checks', { department: 'batching', items: allC, observation_note: 'Good', talk_date: today, talk_attendees: 5 }, A);
const cc = r.body;
t('a culture check is filed on its page', r.status === 201 && !!cc?.id, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
// GMP walk and list review: completing their task is the only door.
const sched = (title) => db.prepare('SELECT id FROM quality_schedules WHERE title = ?').get(title)?.id;
db.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
  VALUES ('ri-walk', 'Weekly GMP Walk-through', 'x', 'normal', date('now'), '[]', 'qa', ?, 'open')`).run(sched('Weekly GMP Walk-through'));
db.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
  VALUES ('ri-list', 'Banned/Prohibited Substance List Review', 'x', 'normal', date('now'), '[]', 'qa', ?, 'open')`).run(sched('Banned/Prohibited Substance List Review'));
r = await call('POST', '/pm/work-orders/ri-walk/complete-and-recur', { completed_by: 'Rec Admin', check: { area: 'Production 1',
  items: Object.fromEntries(GMP_WALK_ITEMS.map(i => [i.key, { result: 'c' }])) } }, A);
t('a GMP walk is filed by completing its task', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('POST', '/pm/work-orders/ri-list/complete-and-recur', { completed_by: 'Rec Admin', check: { editions: { nsf306_annex_c: 'Annex C 2025',
  nfl_nflpa: 'NFL 2026', mlb: 'MLB 2026', wada: 'WADA 2026' }, changes_found: 'none', actions_taken: 'none', materials_rechecked: true } }, A);
t('a list review is filed by completing its task', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

r = await call('GET', `/records?from=${today}&type=emp,gmp_walk,banned_list_review,culture_check,management_review,food_defense_challenge`, undefined, A);
const cr = r.body?.records || [];
const one = (type, id) => cr.find(x => x.type === type && (!id || x.id === id));
const ce = one('emp', emp?.id);
t('the EMP sample is on GET /api/records: form, site, zone, who, when, result, unsigned',
  ce?.form === 'FORM 604-01 V1' && ce.site === 'Blender 1' && ce.place && ce.performed_by === 'Emma Sampler' && ce.performed_at === today && ce.result === 'pending' && ce.signed_by === null, JSON.stringify(ce));
t('the management review is there with its clause and revision', /SQF Code 2\.1\.2\.1 · DRAFT-1/.test(one('management_review', mr?.id)?.form || '') && one('management_review', mr?.id)?.performed_by === 'Mona Review', JSON.stringify(one('management_review', mr?.id)));
t('the Food Defense challenge is there with its SOP revision', one('food_defense_challenge', fd?.id)?.form === 'SOP 434 V3' && one('food_defense_challenge', fd?.id)?.result === 'Plan held');
t('the culture check is there with its department as the place', one('culture_check', cc?.id)?.place === 'batching' && one('culture_check', cc?.id)?.result === 'compliant', JSON.stringify(one('culture_check', cc?.id)));
t('the GMP walk is there with its area and revision', one('gmp_walk')?.place === 'Production 1' && one('gmp_walk')?.form === 'GMP walk-through DRAFT-1' && one('gmp_walk')?.performed_by === 'Rec Admin', JSON.stringify(one('gmp_walk')));
t('the list review is there', one('banned_list_review')?.result === 'no changes', JSON.stringify(one('banned_list_review')));
const countOf = (table, col) => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE substr(${col},1,10) >= ?`).get(today).n;
const counts = { emp: countOf('emp_samples', 'sampled_on'), gmp_walk: countOf('gmp_walkthroughs', 'walked_on'), banned_list_review: countOf('banned_list_reviews', 'reviewed_on'),
  culture_check: countOf('culture_checks', 'checked_on'), management_review: countOf('management_reviews', 'reviewed_on'), food_defense_challenge: countOf('food_defense_challenges', 'performed_on') };
t('each check type\'s count agrees with its own table', Object.entries(counts).every(([k, n]) => cr.filter(x => x.type === k).length === n), JSON.stringify(counts));
r = await call('GET', `/records?from=${today}&type=emp&site=Blender 1`, undefined, A);
t('an EMP sample is found by its site', r.body?.records?.length >= 1 && r.body.records.every(x => x.site === 'Blender 1'));
r = await call('GET', `/records?from=${today}&type=emp,gmp_walk,culture_check&signed=yes`, undefined, A);
t('asking for signed check records finds none — none is signed', r.body?.records?.length === 0);
r = await call('GET', `/records/emp/${emp?.id}`, undefined, A);
t('one EMP sample, described', r.status === 200 && r.body?.id === emp?.id && r.body.type === 'emp');
r = await call('GET', `/records/emp/${emp?.id}/pdf`, undefined, A);
t('…and it prints', r.status === 200 || r.status === null, `${r.status}`);
r = await call('GET', '/records/types', undefined, A);
const ty = Object.fromEntries((r.body || []).map(x => [x.type, x]));
t('/records/types says the check records do not sign, and where the walk is filed', ty.emp?.signs === false && JSON.stringify(ty.gmp_walk?.filed_by) === '["task"]'
  && !ty.emp.implements.includes('sign') && ty.emp.implements.includes('file') && !ty.gmp_walk.implements.includes('file'), JSON.stringify([ty.emp, ty.gmp_walk]));

console.log('\n── through the interface: the same writer, no second one ──');
const { recordType } = await import('../server/record-interface.js');
// The writer audits through the app's own connection; a second handle holding a
// transaction would lock it out, so the interface is driven on getDb().
const { getDb } = await import('../server/db.js');
const appDb = getDb();
const rows0 = countOf('management_reviews', 'reviewed_on');
const viaIf = recordType('management_review').file(appDb, { id: 'ri-a', name: 'Rec Admin', role: 'admin', department: 'quality' },
  { reviewed_on: today, attendees: 'A', items: Object.fromEntries(MANAGEMENT_REVIEW_ITEMS.map(i => [i.key, { result: 'done' }])) });
t('filing through the interface lands in the same table, settled the same way', viaIf.status === 201 && countOf('management_reviews', 'reviewed_on') === rows0 + 1
  && db.prepare('SELECT source FROM management_reviews WHERE id = ?').get(viaIf.id)?.source === 'paper', JSON.stringify(viaIf).slice(0, 160));
const opFile = recordType('emp').file(appDb, { id: 'ri-o', name: 'Rec Operator', role: 'operator', department: 'warehouse' }, { zone: 'zone1', test: 'x', site: 'y', sampled_on: today });
t('the interface keeps the module\'s rule: an operator cannot file an EMP sample', opFile.status === 403);

// No second writer (D-369): each check table is inserted into only where it was
// before this change. The interface added none.
{
  const fs = await import('fs'); const path = await import('path');
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) files.push(p); } };
  walk('server'); files.push('server.js');
  const WRITERS = { emp_samples: ['server/api/check-records.js', 'server/check-records.js'], gmp_walkthroughs: ['server/check-records.js'],
    banned_list_reviews: ['server/check-records.js'], culture_checks: ['server/culture.js'], management_reviews: ['server/check-records.js'],
    food_defense_challenges: ['server/check-records.js'] };
  const found = Object.fromEntries(Object.keys(WRITERS).map(tb => [tb, files.filter(f => fs.readFileSync(f, 'utf8').includes(`INSERT INTO ${tb}`)).sort()]));
  t('no second writer: each check table is inserted into only by its existing writer', Object.entries(WRITERS).every(([tb, w]) => JSON.stringify(found[tb]) === JSON.stringify([...w].sort())), JSON.stringify(found));
  t('…and the record interface writes no record row itself', !/INSERT INTO|UPDATE \w+ SET/.test(fs.readFileSync('server/record-interface.js', 'utf8') + fs.readFileSync('server/check-record-types.js', 'utf8')));
}

console.log('\n── who reads what ──');
r = await call('GET', '/records/types', undefined, C);
// The check-records route admits calibration holders (server.js mount), and the
// interface reads by the same rule rather than a narrower copy of it.
t('a calibration-only account sees scale and the check records it can open on their own route — never sanitation, qms or culture',
  JSON.stringify(r.body?.map(x => x.type)) === '["scale","emp","gmp_walk","banned_list_review","management_review","food_defense_challenge"]'
  && r.body?.[0]?.implements?.length === 5, JSON.stringify(r.body?.map(x => x.type)));
r = await call('GET', `/records?from=${today}`, undefined, C);
t('…and no sanitation, qms or culture records in the list', r.body?.records?.length > 0 && r.body.records.every(x => !['sanitation', 'qms', 'culture_check'].includes(x.type)));
r = await call('GET', `/records/culture_check/${cc?.id}`, undefined, C);
t('…a culture check is a 404 to them (only the concern log\'s readers read it)', r.status === 404);
r = await call('GET', `/records/sanitation/${san.id}`, undefined, C);
t('…and a sanitation record is a 404, not a 403', r.status === 404);
r = await call('GET', `/records?from=${today}`, undefined, O);
t('an account with no record modules reads nothing', r.status === 200 && r.body?.records?.length === 0 && r.body?.types?.length === 0, JSON.stringify(r.body).slice(0, 120));
r = await call('POST', '/records', {}, A);
t('the surface is read-only (no POST)', r.status === 404 || r.status === 405, `${r.status}`);

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
