// verify:movemessage — a message moved to another channel, and items closed when
// resolved (D-355). Caller sets PORT + DBPATH.
// Control: main before this — /messages/:id/move is 404.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5225);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'MoveMsg2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ operator: 'view' }));
mk('mv-office', 'Mara Office', 'supervisor', 'office');
mk('mv-emp', 'Eddie Floor', 'operator', 'filling');
mk('mv-other', 'Olga Floor', 'operator', 'filling');
const ch = (id, name, members) => {
  db.prepare("INSERT OR REPLACE INTO chat_channels (id, kind, name, created_by) VALUES (?, 'private', ?, 'mv-office')").run(id, name);
  for (const u of members) db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, 'member')").run(`${id}-${u}`, id, u);
};
ch('mv-hr', 'hr-issues-test', ['mv-office']);
ch('mv-tt', 'time-tracking-test', ['mv-office']);
ch('mv-locked', 'not-mine-test', ['mv-other']);
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const office = await login('mv-office', 'Mara Office');
const emp = await login('mv-emp', 'Eddie Floor');
t('the office and an employee sign in', !!office && !!emp);

const dm = (await call('POST', '/comms/dm', { user_ids: ['mv-office'] }, emp)).json;
const dmId = dm?.id || dm?.channel?.id;
const sent = (await call('POST', `/comms/channels/${dmId}/messages`, { body: "I left early today with Adam's approval" }, emp)).json;
const sent2 = (await call('POST', `/comms/channels/${dmId}/messages`, { body: 'I have this issue with my pay stub, help' }, emp)).json;
t('the employee DMs the office', !!sent?.id && !!sent2?.id, JSON.stringify(dm).slice(0, 120));

let r = await call('POST', `/comms/messages/${sent.id}/move`, { channel_id: 'mv-tt' }, emp);
t('the employee cannot move it', r.status === 403);
r = await call('POST', `/comms/messages/${sent.id}/move`, { channel_id: 'mv-locked' }, office);
t('the office cannot move it into a channel they are not in', r.status === 404);
r = await call('POST', `/comms/messages/${sent.id}/move`, { channel_id: 'mv-tt', note: 'approved by Adam' }, office);
t('THE OFFICE MOVES IT TO #time-tracking', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
const moved = r.json?.message;
t('…keeping the author and the words', moved?.user_id === 'mv-emp' && /left early/.test(moved?.body || ''));
t('…saying where it came from and who moved it', moved?.moved_from?.kind === 'dm' && moved?.moved_from?.by === 'Mara Office' && moved?.moved_from?.note === 'approved by Adam');
t('…as an open item', moved?.tracked?.state === 'open');
const dmView = (await call('GET', `/comms/channels/${dmId}/messages`, null, emp)).json || [];
const orig = dmView.find(x => x.id === sent.id);
t('THE EMPLOYEE STILL SEES IT, marked moved — nothing deleted', orig && /left early/.test(orig.body) && orig.moved_to?.channel_name === 'time-tracking-test', JSON.stringify(orig?.moved_to));
r = await call('POST', `/comms/messages/${sent.id}/move`, { channel_id: 'mv-hr' }, office);
t('a message is moved once', r.status === 409);
r = await call('POST', `/comms/messages/${sent2.id}/move`, { channel_id: 'mv-hr', track: true }, office);
t('the pay question goes to #hr-issues', r.status === 201);
const hrItem = r.json?.message;
r = await call('GET', '/comms/channels/mv-hr/tracked?state=open', null, office);
t('#hr-issues lists one open item', r.status === 200 && r.json?.length === 1);
r = await call('GET', '/comms/channels/mv-hr/tracked', null, emp);
t('…which the employee cannot read (not a member)', r.status === 404 || r.status === 403);
r = await call('POST', `/comms/messages/${hrItem.id}/resolve`, { note: 'Fixed in the next payroll' }, office);
t('the office marks it resolved, with how', r.status === 200 && r.json?.tracked?.state === 'resolved' && r.json?.tracked?.resolved_by === 'Mara Office');
r = await call('GET', '/comms/channels/mv-hr/tracked?state=open', null, office);
t('…and the open list is empty', r.json?.length === 0);
r = await call('POST', `/comms/messages/${hrItem.id}/reopen`, {}, office);
t('it can be reopened', r.status === 200 && r.json?.tracked?.state === 'open');
t('every move and resolve is in the audit log', q("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'chat_message' AND action IN ('move','resolve','reopen')")[0].n >= 4);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
const me = (await call('GET', '/users/me', null, office)).json;
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [office, me]);
await page.goto(`${URL}/?c=mv-tt`);
await page.waitForTimeout(3500);
t('#time-tracking shows the open item strip', await page.locator('[data-tracked-strip]').count() === 1);
t('…the moved message says it came from a direct message', await page.locator('[data-moved-from]').count() >= 1);
await page.locator('[data-resolve]').first().click().catch(() => {});
page.once('dialog', d => d.accept('ok'));
await page.waitForTimeout(300);
const third = (await call('POST', `/comms/channels/${dmId}/messages`, { body: 'Running 10 minutes late tomorrow' }, emp)).json;
await page.goto(`${URL}/?c=${dmId}`);
await page.waitForTimeout(3500);
const row = page.locator('.msg-row', { hasText: 'Running 10 minutes late' });
await row.hover();
await row.locator('[data-tip="More actions"]').click();
await page.waitForTimeout(300);
t('the message menu offers Move to channel', await page.getByText('Move to channel…').count() >= 1);
await page.getByText('Move to channel…').first().click();
await page.waitForTimeout(800);
await page.locator('[data-move-target]').selectOption('mv-tt');
await page.locator('[data-move-go]').click();
await page.waitForTimeout(1500);
t('MOVING FROM THE SCREEN PUTS IT IN #time-tracking', q("SELECT COUNT(*) n FROM chat_messages WHERE channel_id = 'mv-tt' AND moved_from_message_id = ?", third.id)[0].n === 1);
t('…and the DM shows it as moved', await page.locator('[data-moved-to]').count() >= 1);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
