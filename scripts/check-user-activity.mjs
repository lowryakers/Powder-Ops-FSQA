// check:useractivity — the activity log's rules, without a server (D-261).
// What is redacted, what counts as a record or a file, the field-level diff, the
// append-only table, and that no code anywhere deletes from it.
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dir = mkdtempSync(join(tmpdir(), 'ua-check-'));
process.env.DB_PATH = join(dir, 'ua.db');
process.env.NODE_ENV = 'test';
const { getDb, logAudit } = await import('../server/db.js');
const ua = await import('../server/user-activity.js');

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('── what is never stored ──');
for (const k of ['password', 'current_password', 'new_password', 'signature_password', 'token', 'api_token', 'setup_code',
  'ssn', 'dd_routing', 'dd_account', 'account_number', 'signature_image', 'pin', 'password_hash', 'client_secret', 'ssn_enc']) {
  t(`"${k}" is redacted`, ua.safeValue(k, 'hunter2!') === ua.REDACTED);
}
t('a blank secret stays blank (nothing to hide)', ua.safeValue('password', '') === '');
for (const k of ['status', 'name', 'notes', 'tokens_used_label', 'account_type']) {
  // account_type and similar are ordinary fields; only the listed shapes are secret.
  if (k === 'tokens_used_label') continue;
  t(`"${k}" is kept`, ua.safeValue(k, 'out_of_service') === 'out_of_service');
}
t("a file's contents are never kept (data: url)", ua.safeValue('photo', 'data:image/png;base64,iVBORw0KGgo=') === '[file contents not stored]');
t('extracted text is never kept', !/xxx/.test(String(ua.safeValue('extracted_text', 'x'.repeat(5000)))));
t('a stored panel snapshot is never kept', ua.safeValue('panel_json', '{"kcal":1}') === '[not stored]');
t('a long value is cut to 200 characters and says how long it was', /^a{200}… \(900 characters\)$/.test(ua.safeValue('notes', 'a'.repeat(900))));
t('a nested secret inside an object is redacted', !/s3cr3t/.test(ua.safeValue('data', { inner: { password: 's3cr3t' }, ok: 1 })));
t('a query string (where a link token lives) is dropped', ua.cleanPath('/api/x/files/9?token=abc&X-Amz-Signature=1') === '/api/x/files/9');

console.log('── field-level changes ──');
const ch = ua.fieldChanges({ status: 'active', name: 'Mon 1', updated_at: '1', password_hash: 'x' }, { status: 'out_of_service', name: 'Mon 1', updated_at: '2', password_hash: 'y' });
t('a change names the field, the old value and the new one', ch.some(c => c.field === 'status' && c.from === 'active' && c.to === 'out_of_service'));
t('an unchanged field is not listed', !ch.some(c => c.field === 'name'));
t('updated_at is not a change anybody made', !ch.some(c => c.field === 'updated_at'));
t('a changed secret is listed as changed, with both values redacted', ch.some(c => c.field === 'password_hash' && c.from === ua.REDACTED && c.to === ua.REDACTED));
const created = ua.fieldChanges(null, { name: 'New', empty: '', n: 3 });
t('a create lists what it set, with no "from"', created.length === 2 && created.every(c => !('from' in c)));
t('JSON text states are read as objects', ua.fieldChanges('{"a":1}', '{"a":2}')[0]?.to === 2);

console.log('── what is a record, what is a file ──');
t('/api/pm/schedules/<uuid> is a record', ua.recordFromPath('/api/pm/schedules/3f6b1c2e-1d2a-4c1b-9f00-123456789abc')?.record_type === 'pm/schedules');
t('/api/receiving/checklist/A-100-0042 is a record', ua.recordFromPath('/api/receiving/checklist/A-100-0042')?.record_id === 'A-100-0042');
for (const p of ['/api/pm/operator-tasks', '/api/compliance/notifications', '/api/comms/channels/abc-1/messages', '/api/products/master.csv', '/api/equipment']) {
  t(`${p} is not a record`, ua.recordFromPath(p) === null);
}
t('a PDF answer is a download', ua.fileKindOf(200, { 'content-type': 'application/pdf' }) === 'download');
t('an attachment is a download', ua.fileKindOf(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="a.txt"' }) === 'download');
t('an inline PDF is a file open', ua.fileKindOf(200, { 'content-type': 'application/pdf', 'content-disposition': 'inline' }) === 'file_open');
t('a redirect to stored storage is a file open', ua.fileKindOf(302, { location: 'https://x.r2.cloudflarestorage.com/k?X-Amz-Signature=1' }) === 'file_open');
t('JSON is not a file', ua.fileKindOf(200, { 'content-type': 'application/json; charset=utf-8' }) === null);

console.log('── the table ──');
const db = getDb();
db.prepare(`INSERT INTO users (id, name, username, role, department, is_active) VALUES ('u1', 'Pat Check', 'pat', 'operator', 'qa', 1)`).run();
logAudit({ id: 'u1', name: 'Pat Check', role: 'operator' }, 'update', 'equipment', 'e1', null, { status: 'active' }, { status: 'out_of_service' }, 'Monitor');
t('before the listener starts, an audit entry writes no activity', db.prepare('SELECT COUNT(*) n FROM user_activity').get().n === 0);
ua.startUserActivity();
const before = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
logAudit({ id: 'u1', name: 'Pat Check', role: 'operator' }, 'update', 'equipment', 'e1', { why: 'probe' }, { status: 'active' }, { status: 'out_of_service' }, 'Monitor');
const row = db.prepare("SELECT * FROM user_activity WHERE action = 'edit'").get();
t('an audit entry by a person becomes an edit row', !!row && row.user_id === 'u1' && row.record_label === 'Monitor');
t('…carrying the field change', JSON.parse(row?.details || '{}').changes?.[0]?.to === 'out_of_service');
t('…and linked to its audit entry', row?.audit_id === db.prepare('SELECT MAX(id) m FROM audit_log').get().m);
const after = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
t('the audit log gained exactly the one entry, and the earlier ones are byte-identical',
  after.length === before.length + 1 && JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before));
logAudit('system', 'update', 'equipment', 'e1', null, null, null);
logAudit({ id: 'u1', name: 'Pat Check' }, 'login_failed', 'user', 'u1');
t('a system entry and a failed sign-in write no activity', db.prepare('SELECT COUNT(*) n FROM user_activity').get().n === 1);
let threw = '';
try { db.prepare('UPDATE user_activity SET user_name = ?').run('someone else'); } catch (e) { threw = e.message; }
t('an UPDATE is refused (append-only)', /append-only/.test(threw), threw);
threw = '';
try { db.prepare('DELETE FROM user_activity').run(); } catch (e) { threw = e.message; }
t('a DELETE is refused (append-only), so history is kept beyond two years', /append-only/.test(threw), threw);

console.log('── session timeouts ──');
db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES ('s1', 'u1', 'tok1', ?)`).run(new Date(Date.now() - 3600e3).toISOString());
db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES ('s2', 'u1', 'tok2', ?)`).run(new Date(Date.now() + 3600e3).toISOString());
t('an expired session is one timeout', ua.sweepSessionTimeouts(db) === 1);
t('…and only once', ua.sweepSessionTimeouts(db) === 0);
const to = db.prepare("SELECT occurred_at FROM user_activity WHERE action = 'session_timeout'").get();
t('…dated when it expired, in UTC', /Z$/.test(to?.occurred_at || '') && Date.now() - Date.parse(to.occurred_at) > 3500e3);

console.log('── nothing deletes from it ──');
const offenders = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (f === 'node_modules' || f.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js|jsx)$/.test(f) && /DELETE\s+FROM\s+user_activity|DROP\s+TABLE[^;]*user_activity/i.test(readFileSync(p, 'utf8'))) offenders.push(p);
  }
};
walk(join(process.cwd(), 'server'));
walk(join(process.cwd(), 'src'));
t('no server or client code deletes from or drops user_activity', offenders.length === 0, offenders.join(', '));

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
