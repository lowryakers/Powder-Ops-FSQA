// verify:nameusage — D-326, live on a fresh database (+ a browser at 1280).
//
// "Where is a name used?" on Doc Control Review: a chemical renamed in an SOP
// is still written in recurring tasks, the chemical register and the built-in
// dilution checks. The search finds every place, says who changes each one,
// ignores capitals/spaces/hyphens, and WRITES NOTHING.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main`
// before this change: /doc-review/name-usage does not exist.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5207;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

{
  const db = new Database(DBP);
  for (const [id, name, role, dept] of [['nu-dc', 'Dana Usage', 'operator', 'document_control'], ['nu-op', 'Owen Usage', 'operator', 'warehouse'], ['nu-admin', 'Ada Usage', 'admin', 'office']]) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ documents: 'edit' }));
  }
  db.close();
}
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'Usage2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Usage2026!!' })).json;
};
const dcLogin = await signIn('nu-dc', 'Dana Usage');
const D = dcLogin?.token;
const O = (await signIn('nu-op', 'Owen Usage'))?.token;
t('signed in (Document Control and a warehouse operator)', !!D && !!O);

// Row counts of every table, before.
const counts = () => {
  const db = new Database(DBP, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sessions','user_activity','audit_log','api_token_calls')").all().map((r) => r.name);
    const out = {};
    for (const n of tables) { try { out[n] = db.prepare(`SELECT COUNT(*) c FROM "${n}"`).get().c; } catch { /* virtual */ } }
    return out;
  } finally { db.close(); }
};
const before = counts();

console.log('\n── The search ──');
let r = await call('GET', '/doc-review/name-usage?q=Sani-512', null, D);
t('Document Control can search', r.status === 200, `${r.status} ${r.json?.error}`);
const sec = (j, k) => (j?.sections || []).find((s) => s.key === k);
t('it finds the recurring dilution schedule', sec(r.json, 'schedules')?.count > 0, JSON.stringify(sec(r.json, 'schedules')?.rows?.slice(0, 2)));
t('it finds the built-in FORM 106-01 definition, and says a code change is needed', sec(r.json, 'built_in')?.count > 0 && /Controlled Changes/.test(sec(r.json, 'built_in')?.who || ''));
t('every section says who changes it and how', (r.json?.sections || []).every((s) => s.who && s.how && s.label));
t('the total is the sum of the sections', r.json?.total === (r.json?.sections || []).reduce((a, s) => a + s.count, 0));
const total = r.json?.total;
r = await call('GET', '/doc-review/name-usage?q=' + encodeURIComponent('sani 512'), null, D);
t('"sani 512" finds the same places as "Sani-512"', r.json?.total === total, `${r.json?.total} vs ${total}`);
r = await call('GET', '/doc-review/name-usage?q=SANI512', null, D);
t('"SANI512" too', r.json?.total === total);
r = await call('GET', '/doc-review/name-usage?q=ab', null, D);
t('a term under three characters is refused in words', r.status === 200 && !!r.json?.error && r.json?.total === 0 && !r.json?.sections?.length);
r = await call('GET', '/doc-review/name-usage?q=zzqqxx-not-a-thing', null, D);
t('a name used nowhere reads 0', r.json?.total === 0);
r = await call('GET', '/doc-review/name-usage?q=Sani-512', null, O);
t('a warehouse operator is refused', r.status === 403);
r = await call('GET', '/doc-review/name-usage?q=Sani-512');
t('no session is refused', r.status === 401);
const after = counts();
const moved = Object.keys(before).filter((k) => before[k] !== after[k]);
t('the search wrote nothing (every table the same size)', moved.length === 0, moved.join(','));

console.log('\n── The screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [D, dcLogin.user]);
  await page.goto(`${URL}/?tab=doc-review`);
  await page.waitForSelector('[data-name-usage-toggle]', { timeout: 20000 });
  t('the search is on Doc Control Review', true);
  await page.click('[data-name-usage-toggle]');
  await page.fill('[data-name-usage-input]', 'sani 512');
  await page.click('[data-name-usage-search]');
  await page.waitForSelector('[data-name-usage-result]', { timeout: 10000 });
  const shown = await page.getAttribute('[data-name-usage-result]', 'data-total');
  t('the screen shows the same total as the API', Number(shown) === total, `${shown} vs ${total}`);
  t('the schedules section is listed', (await page.$('[data-name-usage-section="schedules"]')) !== null);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  t('no sideways scroll', !overflow);
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
