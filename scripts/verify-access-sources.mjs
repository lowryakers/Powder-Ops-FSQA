// verify:accesssources — D-187. Nobody can open a module that Settings does not show.
//
// "Victor is seeing Danny's List and it isn't in Settings." Bulk Permissions
// turned a BLANK map into "every module at Edit" before applying its patch — a
// rule from when blank meant unrestricted — so one bulk pass gave every blank
// account every module, Danny's List included, and audited only a count. And
// several modules show by a rule (department, every supervisor, a NAME) that no
// Settings screen could display.
//
// Caller sets PORT + DBPATH + DB_PATH. Boots a second server on PORT+100 for the
// one-time repairs. Needs a built client.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import { ALL_MODULE_IDS, moduleLevel } from '../server/module-access.js';

const PORT = Number(process.env.PORT || 5113);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const mapOf = (id) => { const r = q('SELECT module_access FROM users WHERE id = ?', id)[0]; return r?.module_access ? JSON.parse(r.module_access) : null; };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('ac-adm', 'Lowry Access', 'admin', 'executive', null);
  mk('ac-blank', 'Bea Blank', 'operator', 'warehouse', null);
  mk('ac-mapped', 'Mo Mapped', 'operator', 'warehouse', { sanitation: 'view' });
  // What the old bulk path wrote: every module at edit, Danny's List included.
  mk('ac-victor', 'Victor Bulked', 'operator', 'warehouse', { ...Object.fromEntries(ALL_MODULE_IDS.map((m) => [m, 'edit'])), 'dannys-list': 'edit' });
  // An admin whose only entry was the Danny's List grant: full access only while that grant was private.
  mk('ac-owner', 'Owen Owner', 'admin', 'executive', { 'dannys-list': 'edit' });
  mk('ac-intended', 'Ida Intended', 'supervisor', 'office', { 'dannys-list': 'edit', sanitation: 'view' });
  mk('ac-ricardo', 'Ricardo Testa', 'operator', 'maintenance', null);
  mk('ac-sup', 'Olga Rule', 'supervisor', 'qa', { sanitation: 'view' });
  // The map somebody set on Victor by hand before the bulk pass.
  db.prepare(`INSERT INTO audit_log (actor, action, entity_type, entity_id, entity_label, details, previous_state, new_state, timestamp)
    VALUES ('Lowry', 'permission_change', 'user', 'ac-victor', 'Victor Bulked', '{"module_access":{"changed":true}}', NULL, ?, '2026-09-01 10:00:00')`)
    .run(JSON.stringify({ id: 'ac-victor', module_access: JSON.stringify({ sanitation: 'view', 'receiving-log': 'edit' }) }));
  db.prepare("DELETE FROM app_settings WHERE key IN ('bulk_access_repair_v1', 'out_now_name_rule_v1', 'retired_module_grants_v1')").run();
  db.close();
}

async function boot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 90; i++) { await wait(1000); try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); return { proc, url: `http://localhost:${port}`, log: () => log }; } catch { /* booting */ } }
  return { proc, url: null, log: () => log };
}

console.log('\n── the deploy repairs what the bulk bug wrote ──');
const two = await boot(BOOT2);
t('booted', !!two.url);
t('DANNY\'S LIST IS RETIRED: its grant comes off every account (D-215)', !mapOf('ac-victor')?.['dannys-list'] && !mapOf('ac-intended')?.['dannys-list'] && !mapOf('ac-owner')?.['dannys-list'], JSON.stringify(mapOf('ac-intended')));
t('AN ADMIN WHOSE ONLY ENTRY WAS THAT GRANT KEEPS FULL ACCESS — not a narrowed admin holding nothing',
  moduleLevel({ role: 'admin', module_access: mapOf('ac-owner') }, 'sanitation') === 'edit', JSON.stringify(mapOf('ac-owner')));
t('…and nothing else on those maps moves', mapOf('ac-intended')?.sanitation === 'view' && mapOf('ac-victor')?.sanitation === 'edit');
t('the removal is audited per account', q("SELECT COUNT(*) n FROM audit_log WHERE entity_id IN ('ac-victor','ac-intended','ac-owner') AND details LIKE '%D-215%'")[0].n === 3);
t('the boot log names them', /Retired module grants removed from 3 account/.test(two.log()), two.log().match(/Retired module grants.*/)?.[0]);
t('THE NAME RULE BECAME A GRANT: the account named Ricardo now holds Out now, visibly', mapOf('ac-ricardo')?.['currently-out'] === 'view');

const URL = two.url;
const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
await post('/users/login', { name: 'Lowry Access' });
await post('/users/set-password', { user_id: 'ac-adm', password: 'Access2026!!', setup_code: 'SC-ac-adm' });
const adm = await (await post('/users/login', { name: 'Lowry Access', password: 'Access2026!!' })).json();
t('admin signed in', !!adm.token);

console.log('\n── Bulk Permissions on a blank account ──');
const r1 = await (await post('/users/bulk-access', { user_ids: ['ac-blank', 'ac-mapped'], module_access: { operator: 'view' } }, adm.token)).json();
t('a blank account gets ONLY what the patch says — not every module', JSON.stringify(mapOf('ac-blank')) === '{"operator":"view"}', JSON.stringify(mapOf('ac-blank')));
t('a mapped account keeps its modules and gains the patch', mapOf('ac-mapped')?.sanitation === 'view' && mapOf('ac-mapped')?.operator === 'view');
t('reported as 2 updated', r1.updated === 2);
const audit = q("SELECT previous_state, new_state FROM audit_log WHERE entity_id = 'ac-blank' AND details LIKE '%\"bulk\":true%'")[0];
t('EACH ACCOUNT\'S BULK CHANGE IS AUDITED with its before and after', !!audit && /operator/.test(audit.new_state) && /null/.test(audit.previous_state), JSON.stringify(audit));
await post('/users/bulk-access', { user_ids: ['ac-intended'], module_access: { sanitation: 'edit' }, mode: 'replace' }, adm.token);
t('replace mode sets what it was asked', mapOf('ac-intended')?.sanitation === 'edit');

console.log('\n── the review list ──');
const rev = await (await fetch(`${URL}/api/users/access-review`, { headers: { Authorization: `Bearer ${adm.token}` } })).json();
const v = rev.accounts?.find((a) => a.id === 'ac-victor');
t('Victor is listed as holding nearly every module', !!v, JSON.stringify(rev).slice(0, 200));
t('…with the map set on him by hand, to restore in one click', v?.restore?.module_access?.sanitation === 'view' && v?.restore?.module_access?.['receiving-log'] === 'edit', JSON.stringify(v?.restore));
t('a normal account is not listed', !rev.accounts.some((a) => a.id === 'ac-mapped'));

console.log('\n── Settings shows every module and why ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [adm.token, adm.user]);
await page.goto(`${URL}/?tab=settings&section=users`);
await page.waitForSelector('[data-access-review]', { timeout: 20000 }).catch(() => {});
t('the review strip is on Settings → Users, naming Victor', await page.locator('[data-review-account="Victor Bulked"]').count() === 1);
await page.locator('[data-review-account="Victor Bulked"] [data-review-restore]').click();
await page.waitForFunction(() => !document.querySelector('[data-review-account="Victor Bulked"]'), null, { timeout: 8000 }).catch(() => {});
t('RESTORE puts back what was set by hand', JSON.stringify(mapOf('ac-victor')) === JSON.stringify({ sanitation: 'view', 'receiving-log': 'edit' }), JSON.stringify(mapOf('ac-victor')));

await page.click('[data-who-open-btn]');
await page.waitForSelector('[data-who-can-open]');
await page.selectOption('[data-who-module]', 'office-requests');
const reqHolder = await page.locator('[data-who-holder="Olga Rule"]').textContent().catch(() => '');
t('a rule-based module names the rule (Requests — every supervisor)', /Every supervisor/.test(reqHolder), reqHolder);
await page.click('[data-who-can-open] [aria-label="Close"]');

await page.locator('tr', { hasText: 'Olga Rule' }).getByRole('button', { name: 'Edit' }).first().click();
await page.waitForSelector('[data-what-they-open]');
const byRule = await page.getAttribute('[data-access-by-rule]', 'data-access-by-rule').catch(() => null);
t('HER RECORD SAYS WHAT SHE OPENS WITHOUT A TICK (QA Review by department, Requests as a supervisor…)', Number(byRule) >= 2, `by rule: ${byRule}`);
await page.click('[data-what-they-open] > button');
t('…each with its reason', await page.locator('[data-open-module="qa-review"][data-open-source="rule"]').count() === 1
  && /QA \/ Quality department/.test(await page.textContent('[data-open-module="qa-review"]')));
t('…and what is ticked says so', await page.locator('[data-open-module="sanitation"][data-open-source="settings"]').count() === 1);
await browser.close();
two.proc.kill();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
