// Executed, not asserted (D-300):
//   1. every open copy of ReadyDoc shares ONE idle clock — input in one tab keeps
//      a second, untouched tab (or the docked Messages panel) signed in, and the
//      limit still bites once nobody touches either;
//   2. a phone that renews its push subscription hands it over while nobody is
//      signed in (/api/push-rotate), proving possession of the old one.
// Needs a built client and VAPID keys (verify-all passes test keys).
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 5177;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const req = (p, tok, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 5000');
const mk = (id, name, access) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,'operator','warehouse',1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, access);
mk('clk-a', 'Clara Clock', '{"sanitation":"edit"}');
mk('clk-b', 'Bo Other', '{"sanitation":"edit"}');
for (const id of ['clk-a', 'clk-b']) await req('/users/set-password', null, { method: 'POST', body: JSON.stringify({ user_id: id, password: 'ClockSecret2026', setup_code: 'SEED-CODE' }) });
const login = async (name, extra = {}) => J(await req('/users/login', null, { method: 'POST', body: JSON.stringify({ name, password: 'ClockSecret2026', ...extra }) }));

// ── 1. one idle clock across every open copy ────────────────────────────────
console.log('\n── one idle clock for every open copy ──');
const s = await login('Clara Clock', { shared_device: true });
t('a shared-device sign-in (15 minutes)', s.user?.idle_minutes === 15, JSON.stringify(s.user?.idle_minutes));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.clock.install();
const open = async (path) => {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  [pageerror]', e.message));
  await p.goto(`${URL}/manifest.webmanifest`);
  await p.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.setItem('shared_device', '1'); }, [s.token, s.user]);
  await p.goto(`${URL}${path}`);
  return p;
};
const pa = await open('/?tab=sanitation');
const pb = await open('/chat');
await pa.waitForTimeout(3000);
const onLogin = (p) => p.locator('[data-shared-device]').count().then(n => n > 0);
t('both copies open signed in', !(await onLogin(pa)) && !(await onLogin(pb)));
// 24 minutes of work in copy A only — copy B is never touched.
for (let i = 0; i < 12; i++) {
  await pa.mouse.click(5, 400);
  await ctx.clock.runFor(2 * 60 * 1000);
}
await pa.waitForTimeout(800);
t('24 minutes of use in one tab: the untouched tab has NOT signed the person out', !(await onLogin(pb)));
t('…and the session is still alive on the server', (await req('/users/me', s.token)).status === 200);
// Nobody touches either copy now: the 15 minutes still apply.
await ctx.clock.runFor(16 * 60 * 1000);
await pb.waitForTimeout(1500);
t('16 minutes with no input in either: signed out', await onLogin(pb) || await onLogin(pa));
t('…and the server ended the session', (await req('/users/me', s.token)).status === 401);
await browser.close();

// ── 2. a renewed push subscription is handed over with nobody signed in ──────
console.log('\n── a renewed push subscription ──');
const sub = (n) => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: `https://push.example.invalid/send/${n}-${crypto.randomBytes(8).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
};
const b = await login('Bo Other');
const oldSub = sub('old');
t('the phone registers while signed in', (await req('/comms/push/subscribe', b.token, { method: 'POST', body: JSON.stringify({ subscription: oldSub }) })).status === 200);
await req('/users/logout', b.token, { method: 'POST' });
t('then the person is signed out', (await req('/users/me', b.token)).status === 401);
const newSub = sub('new');
const rotate = (body) => req('/push-rotate', null, { method: 'POST', body: JSON.stringify(body) });
let r = await rotate({ old_endpoint: oldSub.endpoint, old_auth: sub('x').keys.auth, subscription: newSub });
t('the wrong auth secret is refused, as not found', r.status === 404);
r = await rotate({ old_endpoint: 'https://push.example.invalid/send/nobody', old_auth: oldSub.keys.auth, subscription: newSub });
t('an endpoint nobody holds is refused, as not found', r.status === 404);
r = await rotate({ old_endpoint: oldSub.endpoint, old_auth: oldSub.keys.auth, subscription: { endpoint: 'not a url' } });
t('a malformed new subscription is refused', r.status === 400);
t('nothing moved yet', !!db.prepare('SELECT 1 FROM chat_push_subscriptions WHERE endpoint = ?').get(oldSub.endpoint));
r = await rotate({ old_endpoint: oldSub.endpoint, old_auth: oldSub.keys.auth, subscription: newSub });
t('with the old endpoint + auth, the service worker hands the new one over — no session', r.status === 200, `${r.status}`);
const row = db.prepare('SELECT user_id FROM chat_push_subscriptions WHERE endpoint = ?').get(newSub.endpoint);
t('the new subscription belongs to the same person', row?.user_id === 'clk-b');
t('the old one is gone', !db.prepare('SELECT 1 FROM chat_push_subscriptions WHERE endpoint = ?').get(oldSub.endpoint));
t('the audit log records it without the endpoint', !!db.prepare("SELECT 1 FROM audit_log WHERE details LIKE '%push_subscription_renewed%'").get()
  && !db.prepare('SELECT 1 FROM audit_log WHERE details LIKE ?').get(`%${newSub.endpoint}%`));
r = await rotate({ old_endpoint: oldSub.endpoint, old_auth: oldSub.keys.auth, subscription: sub('again') });
t('the old pair cannot be used twice', r.status === 404);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
