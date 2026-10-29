// verify:nottrainee — bots and system accounts are not trainees (D-262).
//
// The plant's bot accounts (*Procurement Bot, *Jarvis, …) are ordinary active
// non-admin accounts, so Training counted them: every "everyone" course and
// every course of the department they were filed under was "not yet trained".
// The flag leaves them out of every count, list and assignment, and changes
// nothing else about the account.
//
// Caller sets PORT + DBPATH (the runner boots the server). Boots a second server
// on PORT+100 so the once-per-database bot pass runs over the fixtures, and a
// third to prove a flag somebody cleared stays cleared.
// Control: drop TRAINEE_SQL from trainingSnapshot — the "after" counts equal "before".
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5157);
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];

const BOTS = ['*Alex', '*Controller Bot', '*Jarvis', '*Operations Bot', '*Procurement Bot', '*Product Manager', '*Pulse Bot', '*Time Tracking Bot'];
const db = new Database(DBP);
const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('nt-admin', 'Nina Admin', 'admin', 'admin');
mk('nt-op', 'Omar Operator', 'operator', 'warehouse', { operator: 'view' });
BOTS.forEach((n, i) => mk(`nt-bot${i}`, n, 'supervisor', 'office', { products: 'view' }));
// A bot whose name carries no "*": known only because it holds a token.
mk('nt-tokbot', 'Inventory Helper', 'supervisor', 'office', { products: 'view' });
db.prepare(`INSERT INTO api_tokens (id, user_id, label, token_prefix, token_hash, scopes, created_by)
  VALUES ('nt-tok', 'nt-tokbot', 'fixture', 'rdk_fixt', 'fixture-hash-not-a-token', '["read"]', 'fixture')`).run();
// The deploy has not happened yet on this database.
db.prepare("DELETE FROM app_settings WHERE key = 'training_bot_accounts_flagged_v1'").run();
db.prepare("UPDATE users SET not_trainee = 0").run();
const gmp = db.prepare("SELECT id, title FROM training_courses WHERE active = 1 AND required_roles = '[]' AND required_departments = '[]' AND COALESCE(required_positions, '[]') IN ('[]', '') LIMIT 1").get();
db.close();

const H = { 'Content-Type': 'application/json' };
const mkCall = (url) => async (m, p, b, tok) => {
  const r = await fetch(`${url}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};
let call = mkCall(`http://localhost:${PORT}`);
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Trainee2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Trainee2026!!' })).json;
};
const admin = await signIn('Nina Admin', 'nt-admin');
t('a course that applies to everyone exists', !!gmp, 'no everyone-course seeded');

console.log('\n── before ──');
let r = await call('GET', '/training/matrix', null, admin.token);
const before = r.json.counts;
const beforeUsers = r.json.users.map(u => u.name);
t('the bots are counted as trainees today', BOTS.every(b => beforeUsers.includes(b)) && beforeUsers.includes('Inventory Helper'));
r = await call('POST', '/training/assign', { course_id: gmp.id, people: [{ user_id: 'nt-bot2' }, { user_id: 'nt-op' }], due_date: '2026-12-01' }, admin.token);
t('a bot can be assigned training today', r.json?.created?.some(c => c.user_id === 'nt-bot2'), r.text);
const botTask = r.json?.created?.find(c => c.user_id === 'nt-bot2')?.work_order_id;
r = await call('POST', '/training/bulk-complete', { course_id: gmp.id, training_date: '2025-02-01', attendees: [{ employee_user_id: 'nt-bot3', employee_name: '*Operations Bot' }] }, admin.token);
t('a bot can be recorded as trained today', r.json?.created === 1);

console.log('\n── the deploy ──');
const procs = [];
process.on('exit', () => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } });
async function boot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP, HOUSEKEEPING_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); return { proc, url: `http://localhost:${port}`, log: () => log }; } catch { /* booting */ }
  }
  return { proc, url: null, log: () => log };
}
const two = await boot(PORT + 100);
t('second server booted', !!two.url, two.log().slice(-300));
await wait(1500);
const flagged = q('SELECT name FROM users WHERE not_trainee = 1').map(r => r.name);
t('every listed bot is marked not a trainee', BOTS.every(b => flagged.includes(b)), flagged.join(', '));
t('…and the bot known only by its token', flagged.includes('Inventory Helper'));
t('…and ReadyBot', flagged.includes('ReadyBot'));
t('no person is marked', !flagged.includes('Omar Operator') && !flagged.includes('Nina Admin'));
t('the accounts are still active (nothing deactivated)', q("SELECT 1 FROM users WHERE id LIKE 'nt-bot%' AND is_active = 1").length === BOTS.length);
t("the bot's open training task is cancelled with the reason, not deleted",
  one('SELECT status, notes FROM work_orders WHERE id = ?', botTask)?.status === 'cancelled'
  && /not a trainee/.test(one('SELECT notes FROM work_orders WHERE id = ?', botTask)?.notes || ''));
t("…and the person's stays open", q("SELECT 1 FROM work_orders WHERE training_course_id = ? AND assigned_to_id = 'nt-op' AND status = 'open'", gmp.id).length === 1);
const report = JSON.parse(one("SELECT value FROM app_settings WHERE key = 'training_bot_accounts_flagged_v1'")?.value || '{}');
t('the deploy wrote its report, with the counts before and after', !!report.before && !!report.after && report.flagged?.length >= 10);
t('…and an audit entry naming them', /\*Jarvis/.test(one("SELECT details FROM audit_log WHERE details LIKE '%bot_accounts_not_trainees%' ORDER BY id DESC LIMIT 1")?.details || ''));

console.log('\n── after ──');
r = await call('GET', '/training/matrix', null, admin.token);
const after = r.json.counts;
const afterUsers = r.json.users.map(u => u.name);
t('the matrix lists no bot', !afterUsers.some(n => BOTS.includes(n) || n === 'Inventory Helper' || n === 'ReadyBot'));
t('…and still lists the people', afterUsers.includes('Omar Operator') && afterUsers.includes('Nina Admin'));
t('"Not yet trained" fell', after.missing < before.missing, `${before.missing} → ${after.missing}`);
t('the people count fell by the accounts flagged', report.before.people - report.after.people === report.flagged.length,
  `${report.before.people} → ${report.after.people}, ${report.flagged.length} flagged`);
const roster = (await call('GET', '/training/people', null, admin.token)).json;
t('By person lists no bot', !roster.some(p => BOTS.includes(p.name)));
r = await call('POST', '/training/assign', { course_id: gmp.id, people: [{ user_id: 'nt-bot4' }], due_date: '2026-12-01' }, admin.token);
t('assigning a course to a bot is skipped, by name', !r.json?.created?.length && r.json?.skipped?.[0]?.why?.startsWith('not a trainee'), r.text);
r = await call('POST', '/training/bulk-complete', { course_id: gmp.id, training_date: '2025-03-01', attendees: [
  { employee_user_id: 'nt-bot5', employee_name: '*Pulse Bot' }, { employee_user_id: 'nt-op', employee_name: 'Omar Operator' }] }, admin.token);
t('Group Training leaves a bot out and records the person', r.json?.created === 1 && r.json?.skipped?.[0]?.name === '*Pulse Bot', r.text);
const due = (await call('GET', '/training/due', null, admin.token)).json;
t('the retraining list shows no bot', !due.some(d => BOTS.includes(d.employee_name)));
const asg = (await call('GET', '/training/assignments', null, admin.token)).json;
t('the assignment list shows no bot', !asg.some(a => BOTS.includes(a.assigned_to)));
const users = (await call('GET', '/users', null, admin.token)).json;
t('Settings → Users says which accounts are not trainees', users.find(u => u.name === '*Jarvis')?.not_trainee === 1 && users.find(u => u.name === 'Omar Operator')?.not_trainee === 0);

console.log('\n── changing it by hand ──');
r = await call('PUT', '/users/nt-bot0', { not_trainee: false }, admin.token);
t('an admin can clear the flag', r.status === 200 && r.json?.not_trainee === 0, r.text);
r = await call('PUT', '/users/nt-op', { not_trainee: true }, admin.token);
t('…or set it, which closes their open training tasks', r.json?.not_trainee === 1 && r.json?.training_tasks_closed === 1, r.text);
await call('PUT', '/users/nt-op', { not_trainee: false }, admin.token);
t('each change is audited', q("SELECT 1 FROM audit_log WHERE entity_id IN ('nt-bot0','nt-op') AND details LIKE '%not_trainee%'").length >= 3);
const mint = (await call('POST', '/api-tokens', { user_id: 'nt-op', label: 'test bot token', scopes: ['read'] }, admin.token)).json;
t("an account's first bot token marks it not a trainee", !!mint?.plaintext && one("SELECT not_trainee FROM users WHERE id = 'nt-op'")?.not_trainee === 1);
await call('PUT', '/users/nt-op', { not_trainee: false }, admin.token);
two.proc.kill();
await wait(1000);
const three = await boot(PORT + 101);
t('a third boot runs nothing again', !!three.url && !/marked not a trainee/.test(three.log()), three.log().match(/\[training\][^\n]*/)?.[0]);
t('…so a flag somebody cleared stays cleared', one("SELECT not_trainee FROM users WHERE id = 'nt-bot0'")?.not_trainee === 0);
three.proc.kill();

console.log('\n── one name, two accounts (Carol Pierce) ──');
{
  const w = new Database(DBP);
  w.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active) VALUES ('nt-carol','Carol Pierce','Carol Pierce','supervisor','quality',1)`).run();
  w.close();
}
r = await call('POST', '/auditor-passes', { visitor_name: 'Carol Pierce', days: 1 }, admin.token);
t('an auditor pass in her name makes a second account', r.status < 300 && q("SELECT 1 FROM users WHERE name = 'Carol Pierce'").length === 2, r.text.slice(0, 120));
const twice = (await call('GET', '/training/matrix', null, admin.token)).json.users.filter(u => u.name === 'Carol Pierce').length;
t('…and Training counts her twice (the reported symptom)', twice === 2, String(twice));
const auditBeforeReport = one('SELECT COUNT(*) n FROM audit_log').n;
r = await call('GET', '/compliance/same-name-accounts?name=Carol%20Pierce', null, admin.token);
const g = r.json?.groups?.[0];
t('the side-by-side shows both accounts', g?.accounts?.length === 2, r.text.slice(0, 160));
t('…naming the auditor pass as how the second was made', g?.accounts?.some(a => /auditor pass/.test(a.created_how)) && g?.accounts?.some(a => a.role === 'supervisor'));
t('…as text a person can read', /How created/.test(r.json?.text || '') && /Account 2/.test(r.json?.text || ''));
t('running it writes nothing (not even an audit row)', one('SELECT COUNT(*) n FROM audit_log').n === auditBeforeReport);
r = await call('GET', '/compliance/same-name-accounts', null, admin.token);
t('without a name it lists every name with more than one account', r.json?.groups?.some(x => x.accounts[0].name === 'Carol Pierce'));

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://localhost:${PORT}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin.token, admin.user]);
await page.goto(`http://localhost:${PORT}/?tab=training`);
await page.getByRole('button', { name: 'Group Training' }).click({ timeout: 20000 }).catch(() => {});
await page.getByText('Record group training').waitFor({ timeout: 10000 }).catch(() => {});
const listed = await page.locator('div.fixed').last().innerText().catch(() => '');
t('Group Training does not offer a bot as an attendee', /Omar Operator/.test(listed) && !/\*Jarvis|\*Pulse Bot/.test(listed), listed.slice(0, 120));
await browser.close();

console.log(`\nBEFORE ${JSON.stringify(report.before)}\nAFTER  ${JSON.stringify(report.after)}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
