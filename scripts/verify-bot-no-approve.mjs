// verify:botnoapprove — a bot never approves, signs, verifies or publishes (D-279).
//
//   1. A bot token is refused on every approval route — the ones whose path says
//      so and the ones whose body does (a document filed as approved, a training
//      sign-off with the competence statement, a group sign-off, "course updated
//      for revision", a paper revision applied) — however the token is set up:
//      write scope, every grant, an account filed under QA as a supervisor.
//   2. The same bot ACCOUNT signed in with a password is refused the same acts.
//   3. Neither is told it may approve: `can_approve` reads false for both, while a
//      person in the same department reads true and does approve.
//   4. The approval check lists every token with "can approve: no" and finds no
//      approval made by a bot — writes nothing — and does find one planted.
//
// Caller sets PORT + DBPATH (verify-all does).
// Control: drop the bot-account branch from tokenApproveGuard — the bot account
// signed in with a password approves the document revision.
import Database from 'better-sqlite3';

const PORT = Number(process.env.PORT || 5168);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  const all = { sops: 'edit', 'work-instructions': 'edit', training: 'edit', 'qa-review': 'edit', coa: 'edit', sanitation: 'edit', operator: 'view' };
  mk('bn-admin', 'Ada Admin', 'admin', 'admin');
  // The worst case: a bot filed as a QA supervisor holding every module at Edit.
  mk('bn-bot', 'Quality Bot', 'supervisor', 'qa', all);
  mk('bn-qa', 'Quinn Quality', 'supervisor', 'qa', all);
  mk('bn-op', 'Otto Trainee', 'operator', 'warehouse', { operator: 'view' });
  db.close();
}
const call = async (m, p, b, tok) => {
  const headers = { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) };
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const PW = 'NoBotSign2026!';
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const admin = await signIn('bn-admin', 'Ada Admin');
const qa = await signIn('bn-qa', 'Quinn Quality');
const botSession = await signIn('bn-bot', 'Quality Bot');
t('admin, a QA supervisor and the bot account signed in with passwords', !!admin && !!qa && !!botSession);

// A test database's own token on the bot account — write scope and every grant.
let r = await call('POST', '/api-tokens', { user_id: 'bn-bot', label: 'Quality bot', scopes: ['read', 'write'] }, admin);
const tokenId = r.json?.token?.id; const bot = r.json?.plaintext;
t('the bot holds a write token', !!bot && !!tokenId, JSON.stringify(r.json).slice(0, 160));
const grants = (await call('GET', '/api-tokens', null, admin)).json?.grants?.map(g => g.key) || [];
r = await call('POST', `/api-tokens/${tokenId}/grants`, { grants }, admin);
t(`…and every grant there is (${grants.join(', ') || 'none'})`, r.status === 200 || grants.length === 0, `${r.status} ${r.json?.error}`);

// A document at V1 with a V2 draft, a course on it, a training record.
r = await call('POST', '/documents', { doc_type: 'wi', doc_number: 'WI 908', title: 'Auger Changeover', category: 'quality', revision: 'V3', status: 'active', content: 'Step one.' }, admin);
const doc = r.json;
const draft = (await call('POST', `/documents/${doc.id}/revisions`, {}, admin)).json;
await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { change_summary: 'New step' }, admin);
const course = (await call('POST', '/training/courses', { code: 'WI908', title: 'Auger Changeover Training', sop_id: doc.id }, admin)).json;
t('WI 908 V3 with a draft revision and a course on it', !!doc?.id && !!draft?.id && !!course?.id, JSON.stringify(draft).slice(0, 120));

const attempts = [
  ['approve the document revision', 'POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, { signature_password: PW }],
  ['file a document as approved', 'POST', '/documents', { doc_type: 'wi', doc_number: 'WI 909', title: 'Bot doc', category: 'quality', revision: 'V1', status: 'active', content: 'x' }],
  ['move a document into force', 'PUT', `/documents/${doc.id}`, { status: 'active', approved_by: 'Quality Bot' }],
  ['apply a paper revision', 'POST', `/documents/${doc.id}/apply-revision`, { fields: ['revision'], revision: 'V9' }],
  ['sign off training with the competence statement', 'POST', '/training', { employee_name: 'Otto Trainee', employee_user_id: 'bn-op', course_id: course.id, status: 'completed', training_date: '2026-10-29', completion_date: '2026-10-29', method: 'verbal', competence_confirmed: true }],
  ['a group training sign-off', 'POST', '/training/bulk-complete', { course_id: course.id, people: [{ user_id: 'bn-op' }], competence_confirmed: true }],
  ['mark the course updated for a revision', 'POST', `/training/courses/${course.id}/revision`, { kind: 'updated' }],
  ['sign in QA Review', 'POST', '/qa-review/sign', { source: 'production', ids: ['x'], signature_password: PW }],
  ['verify a sanitation record', 'POST', '/sanitation/nope/verify', { signature_password: PW }],
  ['publish a COA', 'POST', '/coa/lots/X1/L1/publish', { signature_password: PW }],
];

console.log('\n── 1. the token is refused at the door ──');
for (const [label, m, p, b] of attempts) {
  r = await call(m, p, b, bot);
  t(`token: ${label} → 403`, r.status === 403 && /approve|token_denied/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
}
const docAfter = q('SELECT revision, status FROM sop_documents WHERE id = ?', doc.id)[0];
t('…and WI 908 is still V3, the draft still a draft', docAfter.revision === 'V3' && q('SELECT status FROM document_revisions WHERE id = ?', draft.id)[0].status === 'draft');

console.log('\n── 2. the bot ACCOUNT, signed in with a password, is refused the same ──');
for (const [label, m, p, b] of attempts) {
  r = await call(m, p, b, botSession);
  t(`session: ${label} → 403 bot_account_cannot_approve`, r.status === 403 && r.json?.error === 'bot_account_cannot_approve', `${r.status} ${r.json?.error}`);
}
t('…each refusal audited as bot_approve_blocked', q("SELECT COUNT(*) c FROM audit_log WHERE action = 'bot_approve_blocked' AND actor_id = 'bn-bot'")[0].c >= attempts.length);
t('…and no training record was filed by the bot', q("SELECT COUNT(*) c FROM training_records WHERE recorded_by_id = 'bn-bot'")[0].c === 0);

console.log('\n── 3. neither is told it may approve ──');
r = await call('GET', `/documents/${doc.id}/revisions`, null, bot);
t('token: can_approve is false on WI 908', r.status === 200 && r.json?.can_approve === false, `${r.status} ${JSON.stringify(r.json?.can_approve)}`);
r = await call('GET', `/documents/${doc.id}/revisions`, null, botSession);
t('session: can_approve is false on WI 908', r.status === 200 && r.json?.can_approve === false, `${r.status} ${JSON.stringify(r.json?.can_approve)}`);
r = await call('GET', `/documents/${doc.id}/revisions`, null, qa);
t('a person in the same department and role: can_approve is true', r.json?.can_approve === true);
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, { signature_password: PW }, qa);
t('…and that person approves WI 908 V4', r.status === 200 && q('SELECT revision FROM sop_documents WHERE id = ?', doc.id)[0].revision === 'V4', `${r.status} ${r.json?.error}`);

console.log('\n── 4. the approval check ──');
r = await call('GET', '/api-tokens/approval-check', null, bot);
t('a token cannot read the check', r.status === 403);
r = await call('GET', '/api-tokens/approval-check', null, qa);
t('a non-admin cannot read the check', r.status === 403);
const auditBefore = q('SELECT COUNT(*) c FROM audit_log')[0].c;
r = await call('GET', '/api-tokens/approval-check', null, admin);
const rep = r.json;
t('the check lists the bot token with can_approve false', r.status === 200 && rep.tokens.some(x => x.id === tokenId && x.can_approve === false && x.account === 'Quality Bot'), JSON.stringify(rep?.tokens).slice(0, 200));
t('…every token reads can_approve false', rep.tokens.every(x => x.can_approve === false));
t('…the bot account is named as a bot', rep.bot_accounts.some(b => b.id === 'bn-bot'));
t('…and no approval on file was made by a bot', rep.approvals_by_bots.length === 0, JSON.stringify(rep.approvals_by_bots).slice(0, 300));
t('…the check wrote nothing', q('SELECT COUNT(*) c FROM audit_log')[0].c === auditBefore);
{
  const db = new Database(DBP);
  db.prepare(`INSERT INTO audit_log (timestamp, actor, actor_id, action, entity_type, entity_id, details)
    VALUES (datetime('now'), 'Quality Bot', 'bn-bot', 'approve', 'document', ?, '{}')`).run(doc.id);
  db.close();
}
r = await call('GET', '/api-tokens/approval-check', null, admin);
t('a planted bot approval is found and listed', r.json?.approvals_by_bots?.length === 1 && r.json.approvals_by_bots[0].actor === 'Quality Bot', JSON.stringify(r.json?.approvals_by_bots));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
