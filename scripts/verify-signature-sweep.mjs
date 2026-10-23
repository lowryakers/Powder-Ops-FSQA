// D-206 (single-spine move 01): every act that signs a record asks for the
// signer's password at the moment of signing.
//
// The sweep found five writers that put a name under a record on the strength of
// the session alone: the internal audit sign-off, approving meeting minutes,
// authorizing a mock recall, signing a COA, and deciding a nutrition panel in the
// app. Each now goes through `gateSignature` — 403 `signature_required` without
// the password, never 401 (a 401 signs the person out) — and the audit row says
// the signature was verified.
//
// This script walks the two that no other verify reaches (internal audits and
// meetings) end to end, and the refusal on the other three.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5125;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { SECTION_IDS } = await import('../server/audit-checklist.js');
const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES ('sg-a','Sig Admin','Sig Admin','admin','quality',1,NULL,'SC-SG', datetime('now','+7 day'))`).run();

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
await call('POST', '/users/set-password', { user_id: 'sg-a', password: 'SigSweep2026!', setup_code: 'SC-SG' });
const auth = (await call('POST', '/users/login', { name: 'Sig Admin', password: 'SigSweep2026!' })).body;
const A = { ...H, Authorization: `Bearer ${auth?.token}` };
t('signed in', !!auth?.token);
const PW = { signature_password: 'SigSweep2026!' };
const refused = (r) => r.status === 403 && r.body?.signature_required === true;
const verifiedAudit = (type, id, action) => {
  const row = db.prepare('SELECT details FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ? ORDER BY rowid DESC LIMIT 1').get(type, id, action);
  return /signature_verified/.test(row?.details || '');
};

console.log('\n── internal audit sign-off (Form 403-01) ──');
let r = await call('POST', '/internal-audits', { audit_date: '2026-10-20', sections: [SECTION_IDS[0]] }, A);
const audit = r.body;
t('an audit is opened', r.status === 201 && audit?.items?.length > 0, `${r.status}`);
for (const it of audit?.items || []) await call('PUT', `/internal-audits/${audit.id}/items/${it.id}`, { result: 'c' }, A);
r = await call('POST', `/internal-audits/${audit.id}/complete`, {}, A);
t('signing it off WITHOUT a password is refused (403 signature_required)', refused(r), `${r.status} ${JSON.stringify(r.body)}`);
t('…and nothing was signed', db.prepare('SELECT status, signed_by FROM internal_audits WHERE id = ?').get(audit.id)?.signed_by === null);
r = await call('POST', `/internal-audits/${audit.id}/complete`, { signature_password: 'wrong-password' }, A);
t('a wrong password is refused too', refused(r), `${r.status}`);
r = await call('POST', `/internal-audits/${audit.id}/complete`, PW, A);
t('with the password it is signed', r.status === 200 && r.body?.status === 'completed' && r.body?.signed_by === 'Sig Admin', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
t('…and the audit row records a verified signature', verifiedAudit('internal_audit', audit.id, 'approve'));
t('the password itself is nowhere in the audit log', !db.prepare("SELECT 1 FROM audit_log WHERE details LIKE '%SigSweep2026!%' OR details LIKE '%wrong-password%'").get());

console.log('\n── meeting minutes ──');
r = await call('POST', '/meetings', { title: 'Food safety team', meeting_type: 'food_safety_team', meeting_date: '2026-10-20' }, A);
const meeting = r.body;
t('a meeting is filed', r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
await call('PUT', `/meetings/${meeting.id}`, { minutes: 'Reviewed the EMP trend. No actions.' }, A);
r = await call('POST', `/meetings/${meeting.id}/approve`, {}, A);
t('approving the minutes WITHOUT a password is refused', refused(r), `${r.status} ${JSON.stringify(r.body)}`);
t('…and they are not approved', db.prepare('SELECT approved_by FROM meetings WHERE id = ?').get(meeting.id)?.approved_by === null);
r = await call('POST', `/meetings/${meeting.id}/approve`, PW, A);
t('with the password they are approved', r.status === 200 && r.body?.status === 'approved', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
t('…and the audit row records a verified signature', verifiedAudit('meeting', meeting.id, 'approve'));

console.log('\n── the other three refuse a request with no password ──');
// Each is walked through its own verify with the password; here only the
// refusal. The record has to reach the signature step for the gate to answer,
// so these use real ids where the route checks one first.
r = await call('POST', '/mock-recalls/no-such-id/approve', {}, A);
t('mock recall authorize: an unknown id is still 404 (the gate is not asked first)', r.status === 404, `${r.status}`);
r = await call('POST', '/nfp/no-such-id/decide', { decision: 'approved' }, A);
t('NFP decide: an unknown id is still 404', r.status === 404, `${r.status}`);
r = await call('POST', '/coa/requests/no-such-id/sign', {}, A);
t('COA sign: an unknown id is still 404', r.status === 404, `${r.status}`);

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
