// D-393: the Procurement bot adds a supplier it has never seen. A token with the
// suppliers-edit grant may POST /api/suppliers; the supplier starts unqualified,
// says the bot added it, and approving it stays a person's.
//
// What this proves:
//   - without the grant a token is refused and nothing is written;
//   - with it, the bot adds "Berlin Packaging": 201, unqualified, source 'bot', audited via the token;
//   - the same name again is SUPPLIER_EXISTS; "Berlin Packaging LLC" is SUPPLIER_NEAR_MATCH naming it;
//   - a person may still add a near-match (only the bot is stopped);
//   - a type is still required while we buy from it;
//   - the bot cannot record a disposition on the supplier it added;
//   - the register offers the bot can_create, and shows "Added by bot".
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5251;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('bs-a', 'Sup Admin', 'admin', 'admin', null);
mkUser('bs-p', 'Sup Purchasing', 'operator', 'purchasing', JSON.stringify({ suppliers: 'edit' }));
mkUser('bs-bot', '*Procurement Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'edit' }));

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { headers: { ...H, Authorization: `Bearer ${r.body?.token}` }, token: r.body?.token, user: r.body?.user };
};
const A = await login('bs-a', 'Sup Admin', 'SupAdmin20266!');
const P = await login('bs-p', 'Sup Purchasing', 'SupPurch2026!');
const mint = async (label, grants) => {
  const m = await call('POST', '/api-tokens', { user_id: 'bs-bot', label, scopes: ['read', 'write'] }, A.headers);
  if (grants.length) await call('POST', `/api-tokens/${m.body?.token?.id}/grants`, { grants }, A.headers);
  return { ...H, Authorization: `Bearer ${m.body?.plaintext}` };
};
const NONE = await mint('fixture bot (no grant)', []);
const EDIT = await mint('fixture bot (suppliers-edit)', ['suppliers-edit']);
t('signed in, and two fixture tokens (with and without the grant)', !!A.token && !!P.token);
const count = () => db.prepare('SELECT COUNT(*) n FROM suppliers').get().n;

console.log('\n── the grant decides ──');
let n0 = count();
let r = await call('POST', '/suppliers', { name: 'Berlin Packaging', vendor_type: 'packaging' }, NONE);
t('without suppliers-edit a token is refused (403), nothing written', r.status === 403 && count() === n0, `${r.status}`);
t('…the register tells it so (can_create false)', (await call('GET', '/suppliers', undefined, NONE)).body?.can_create === false);
t('with it, can_create is true', (await call('GET', '/suppliers', undefined, EDIT)).body?.can_create === true);
r = await call('POST', '/suppliers', { name: 'Berlin Packaging', vendor_type: 'packaging', website: 'berlinpackaging.com' }, EDIT);
const berlin = r.body?.id;
t('the bot adds Berlin Packaging (201)', r.status === 201 && !!berlin, JSON.stringify(r.body));
const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(berlin) || {};
t('…unqualified, source "bot", created by the bot account', row.status === 'unqualified' && row.source === 'bot' && row.created_by === '*Procurement Bot', JSON.stringify({ s: row.status, src: row.source, by: row.created_by }));
t('…audited through the token', !!db.prepare("SELECT 1 FROM audit_log WHERE entity_id = ? AND details LIKE '%via_token%' AND details LIKE '%\"source\":\"bot\"%'").get(berlin));

console.log('\n── no second Berlin ──');
n0 = count();
r = await call('POST', '/suppliers', { name: 'berlin  packaging', vendor_type: 'packaging' }, EDIT);
t('the same name (case and spacing aside) → 409 SUPPLIER_EXISTS', r.status === 409 && r.body?.code === 'SUPPLIER_EXISTS' && r.body.existing_id === berlin);
r = await call('POST', '/suppliers', { name: 'Berlin Packaging LLC', vendor_type: 'packaging' }, EDIT);
t('"Berlin Packaging LLC" → 409 SUPPLIER_NEAR_MATCH naming Berlin Packaging', r.status === 409 && r.body?.code === 'SUPPLIER_NEAR_MATCH'
  && r.body.candidates?.some(c => c.id === berlin), JSON.stringify(r.body));
t('…nothing was written', count() === n0);
r = await call('POST', '/suppliers', { name: 'Berlin Packaging LLC', vendor_type: 'packaging' }, P.headers);
t('a person may still add a near-match (201)', r.status === 201, `${r.status}`);
r = await call('POST', '/suppliers', { name: 'Silgan Closures' }, EDIT);
t('a type is still required while we buy from it (400)', r.status === 400 && r.body?.code === 'VENDOR_TYPE_REQUIRED');

console.log('\n── the bot never decides ──');
r = await call('POST', `/suppliers/${berlin}/disposition`, { disposition: 'approved' }, EDIT);
t('the bot cannot record a disposition on it (403)', r.status === 403 && db.prepare('SELECT status FROM suppliers WHERE id = ?').get(berlin).status === 'unqualified', JSON.stringify(r.body));

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [P.token, P.user]);
  await page.goto(`${URL}/?tab=suppliers`);
  const chip = page.locator(`[data-supplier-added-by-bot="${berlin}"]:visible`).first();
  await chip.waitFor({ timeout: 20000 });
  t('the register marks Berlin Packaging "Added by bot"', /Added by bot/.test(await chip.innerText()));
} catch (e) { t('the register rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
