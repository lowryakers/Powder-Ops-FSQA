// verify:bulkmembers — D-200. Several people into several channels, in one act.
//
// Settings → Channels → Members adds people to ONE channel; a new starter who
// belongs in four channels meant four trips. `POST /comms/admin/bulk-members`
// loops the same rules: an M4 guest only lands in a `client--` channel, an
// archived channel and a DM are refused, a refusal is named and the rest go in,
// and `preview` writes nothing.
//
// Caller sets PORT + DBPATH on a fresh database. Needs a built client. The
// control is `main` before the change: the route does not exist.
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5120;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
const mk = (id, name, role, ext = 0) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,is_external,external_org,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'office',1,?,?,?,datetime('now','+7 day'),?)`).run(id, name, name, role, ext, ext ? 'M4 Dynamic' : null, `SC-${id}`, JSON.stringify({ operator: 'view' }));
mk('bm-admin', 'Bulk Admin', 'admin');
mk('bm-sup', 'Bulk Supervisor', 'supervisor');
mk('bm-a', 'Ana Newstart', 'operator');
mk('bm-b', 'Ben Newstart', 'operator');
mk('bm-m4', 'Mia Guest', 'operator', 1);

const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'BulkMembers2026!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'BulkMembers2026!' })).json();
};
const A = await signIn('Bulk Admin', 'bm-admin');
const S = await signIn('Bulk Supervisor', 'bm-sup');
t('signed in', !!A?.token && !!S?.token);
const call = (tok, p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${tok}` }, body: JSON.stringify(b) });

const mkCh = (name, kind = 'public', archived = 0) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO chat_channels (id, kind, name, archived) VALUES (?, ?, ?, ?)').run(id, kind, name, archived);
  return id;
};
const c1 = mkCh('bm-batching'), c2 = mkCh('bm-safety'), c3 = mkCh('bm-private', 'private'), arch = mkCh('bm-old', 'public', 1), cli = mkCh('client--bmtest', 'private');
db.prepare("INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, 'bm-a', 'member')").run(crypto.randomUUID(), c1);
const members = (cid) => db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(cid).map(r => r.user_id).sort();
const count = () => db.prepare('SELECT COUNT(*) n FROM chat_channel_members').get().n;

console.log('\n── the server ──');
const body = { user_ids: ['bm-a', 'bm-b', 'bm-m4'], channel_ids: [c1, c2, c3, arch, cli] };
const sup = await call(S.token, '/comms/admin/bulk-members', { ...body, preview: true });
t('a supervisor is refused (admin only)', sup.status === 403, String(sup.status));
const empty = await call(A.token, '/comms/admin/bulk-members', { user_ids: [], channel_ids: [c1] });
t('no people is a 400, never read as "everyone"', empty.status === 400);

const before = count();
const pv = await (await call(A.token, '/comms/admin/bulk-members', { ...body, preview: true })).json();
t('the preview writes nothing', count() === before);
t('preview: 3 people × 5 channels', pv.people === 3 && pv.channels === 5, JSON.stringify({ p: pv.people, c: pv.channels }));
t('preview: Ana is already in bm-batching', pv.already.some(r => r.user_id === 'bm-a' && r.channel_id === c1));
t('preview: the guest is refused from every non-client channel, by name', pv.refused.filter(r => r.user_id === 'bm-m4' && r.channel_id !== arch).length === 3 && pv.refused.every(r => r.reason));
t('preview: the guest CAN go into the client channel', pv.add.some(r => r.user_id === 'bm-m4' && r.channel_id === cli));
t('preview: the archived channel is refused for everyone', pv.refused.filter(r => r.channel_id === arch).length === 3);
t('preview adds partition the pairs', pv.add.length + pv.already.length + pv.refused.length === 15, `${pv.add.length}+${pv.already.length}+${pv.refused.length}`);

const r = await (await call(A.token, '/comms/admin/bulk-members', body)).json();
t('the commit adds exactly what the preview said', r.added.length === pv.add.length, `${r.added.length} vs ${pv.add.length}`);
t('Ana and Ben are in bm-safety and the private channel', ['bm-a', 'bm-b'].every(u => members(c2).includes(u) && members(c3).includes(u)));
t('the guest is in NO plant channel', ![c1, c2, c3].some(c => members(c).includes('bm-m4')));
t('…and is in the client channel', members(cli).includes('bm-m4'));
t('nobody joined the archived channel', members(arch).length === 0);
t('a new member starts read as of now (no wall of unread)', !db.prepare("SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = 'bm-b' AND last_read_at IS NULL").get(c2));
t('each channel is audited, bulk, with the names', db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'chat_channel' AND details LIKE '%members_added%' AND details LIKE '%"bulk":true%'`).get().n === 4);
const again = await (await call(A.token, '/comms/admin/bulk-members', body)).json();
t('running it again adds nothing', again.added.length === 0 && count() === before + r.added.length);

console.log('\n── the screen ──');
const c4 = mkCh('bm-quality'), c5 = mkCh('bm-warehouse');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('comms_last_channel'); }, [A.token, A.user]);
    await page.goto(`${URL}/chat`);
    await page.locator('[data-tip="Communication settings"]').first().click({ timeout: 15000 }).catch(() => {});
    await page.locator('[data-open-bulk-members]').click({ timeout: 10000 }).catch(() => {});
    t(`${w}px: Settings → Channels offers "Add people to channels"`, await page.locator('[data-bulk-members]').count() === 1);
    const who = w === 1280 ? 'bm-a' : 'bm-b';
    await page.locator(`[data-pick="people"] [data-pick-item="${who}"]`).check().catch(() => {});
    await page.locator('#bulk-filter-channels').fill('bm-');
    const target = w === 1280 ? c4 : c5;
    await page.locator(`[data-pick="channels"] [data-pick-item="${target}"]`).check().catch(() => {});
    await page.locator(`[data-pick="channels"] [data-pick-item="${c2}"]`).check().catch(() => {});
    await page.locator('[data-bulk-preview]').click().catch(() => {});
    await page.waitForSelector('[data-bulk-plan]', { timeout: 8000 }).catch(() => {});
    t(`${w}px: the check says 1 to add, 1 already in`, (await page.locator('[data-plan-add]').textContent().catch(() => '')) === '1' && (await page.locator('[data-plan-already]').textContent().catch(() => '')) === '1');
    t(`${w}px: checking wrote nothing`, !members(target).includes(who));
    await page.locator('[data-bulk-commit]').click().catch(() => {});
    await page.waitForSelector('[data-bulk-result]', { timeout: 8000 }).catch(() => {});
    t(`${w}px: Add puts them in`, members(target).includes(who) && (await page.locator('[data-result-added]').textContent().catch(() => '')) === '1');
    t(`${w}px: no sideways pan`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.close();
  }
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
