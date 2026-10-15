// verify:sanswabs — every swab on a Sanitation record is a row (D-182), and
// QA's swab sheet is filed once on a database that predates the change.
//
// Asserted live:
//   1. a record carries several swabs, each graded against PC #1 with the limit
//      stamped on the row; the record's ATP figure is the worst swab (the
//      mirror) and any failing swab fails the record;
//   2. an allergen swab read as a fail fails the record; a reading that is not a
//      number is refused by name;
//   3. a record with rows refuses a bare `atp_reading` (the rows own it), and a
//      corrected swab re-grades the record;
//   4. a Pre-Op record's Form 117.21 swab lines are emptied — one place a swab lives;
//   5. two consecutive failing visits raise the re-clean task (D-036, unchanged);
//   6. the swab shelf counts every row, and a pre-D-182 record still counts once;
//   7. THE SHEET IMPORT: skipped on a fresh database; on one that predates it,
//      27 visits / 39 swabs, the 39 RLU sifter separate from its 5 RLU re-swab,
//      entered late with the reason, never twice;
//   8. in a browser: the form takes several swabs, saves them, and the record
//      shows them with the over-limit one in red.
// THE CONTROL is the code before D-182: the swab list is ignored.
import { spawn } from 'child_process';
const PORT = Number(process.env.PORT || 5109);
const BOOT2 = PORT + 1000;
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const q1 = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const qa = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('sw-adm','Swab Admin','Swab Admin','admin','qa',1,'SC-SW',datetime('now','+7 day'))`).run();
  db.close();
}
function client(base) {
  let tok = null; let user = null;
  const req = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  return {
    req, get token() { return tok; }, get user() { return user; },
    post: (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) }),
    put: (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) }),
    async login() {
      const post0 = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      await post0('/users/login', { name: 'Swab Admin' });
      await post0('/users/set-password', { user_id: 'sw-adm', password: 'SwabAdmin2026!', setup_code: 'SC-SW' });
      const a = await J(await post0('/users/login', { name: 'Swab Admin', password: 'SwabAdmin2026!' }));
      tok = a?.token; user = a?.user; return !!tok;
    },
  };
}
const A = client(`${URL}/api`);
t('signed in', await A.login());
const LIMIT = (await J(await A.req('/atp-limit')))?.max;
t(`the limit in force is read (${LIMIT} RLU)`, typeof LIMIT === 'number');
const stock = async () => Object.fromEntries(((await J(await A.req('/sanitation/swab-stock')))?.swabs || []).map((s) => [s.key, s.used_since]));
const used0 = await stock();

console.log('\n── several swabs on one record ──');
let r = await A.post('/sanitation', { area: '3', type: 'pre_op', performed_by: 'Swab Admin', result: 'pass',
  swabs: [
    { swab_no: '701', surface: 'Table', atp_reading: '12' },
    { swab_no: '702', surface: 'Sifter', atp_reading: LIMIT + 10, allergen_swab: true, allergen_lot: '9626' },
    { swab_no: '703', surface: 'Utensils', atp_reading: '' },
    { swab_no: '', surface: '', atp_reading: '' },
  ] });
let rec = await J(r);
t('the record is filed', r.status === 201, `${r.status} ${JSON.stringify(rec).slice(0, 200)}`);
t('THREE SWAB ROWS — the empty one is writing space, dropped', rec?.swabs?.length === 3, JSON.stringify(rec?.swabs?.map((s) => s.swab_no)));
const s702 = rec?.swabs?.find((s) => s.swab_no === '702');
t('EACH ROW IS GRADED, the limit stamped on it', s702?.atp_pass === false && s702?.atp_limit === LIMIT
  && rec.swabs.find((s) => s.swab_no === '701')?.atp_pass === true);
t('a swab with no reading is a gap, not a pass', rec?.swabs?.find((s) => s.swab_no === '703')?.atp_pass === null);
t('THE RECORD\'S ATP FIGURE IS THE WORST SWAB', rec?.atp_reading === LIMIT + 10 && rec?.atp_limit === LIMIT, `${rec?.atp_reading}`);
t('ONE FAILING SWAB FAILS THE RECORD, whatever was chosen', rec?.result === 'fail');
t('the allergen swab and its kit lot are kept', s702?.allergen_swab === true && s702?.allergen_lot === '9626' && s702?.allergen_result === null);
const firstId = rec?.id;

r = await A.post('/sanitation', { area: '4', type: 'pre_op', performed_by: 'Swab Admin', result: 'pass',
  swabs: [{ swab_no: '710', surface: 'Table', atp_reading: 3 }, { swab_no: '711', surface: 'Table', allergen_swab: true, allergen_result: 'fail' }] });
rec = await J(r);
t('AN ALLERGEN SWAB READ AS A FAIL FAILS THE RECORD', rec?.result === 'fail' && rec?.atp_reading === 3, JSON.stringify(rec).slice(0, 160));
r = await A.post('/sanitation', { area: '4', type: 'pre_op', performed_by: 'Swab Admin', result: 'pass', swabs: [{ surface: 'Table', atp_reading: 'abc' }] });
t('a reading that is not a number is refused by name', r.status === 400 && /Swab 1/.test((await J(r))?.error || ''));

console.log('\n── correcting ──');
r = await A.put(`/sanitation/${firstId}`, { atp_reading: 5 });
t('A RECORD WITH ROWS REFUSES A BARE READING (the rows own it)', r.status === 400 && (await J(r))?.code === 'SWABS_OWN_READING');
r = await A.put(`/sanitation/${firstId}`, { result: 'pass', swabs: [
  { swab_no: '701', surface: 'Table', atp_reading: 12 }, { swab_no: '702', surface: 'Sifter', atp_reading: 20, allergen_swab: true, allergen_lot: '9626' }] });
rec = await J(r);
t('a corrected swab re-grades the record', r.status === 200 && rec?.result === 'pass' && rec?.atp_reading === 20 && rec?.swabs?.length === 2, JSON.stringify(rec).slice(0, 200));

console.log('\n── Form 117.21 ──');
r = await A.post('/sanitation', { area: '6', type: 'pre_op', performed_by: 'Swab Admin', result: 'pass',
  preop_form: { product_name: 'Test', checks: { knives: 'yes' }, atp: [{ location: 'old line', swab_no: '1', reading: 99 }] },
  swabs: [{ swab_no: '720', surface: 'Table', atp_reading: 2 }] });
rec = await J(r);
const form = JSON.parse(rec?.preop_form || '{}');
t('THE FORM\'S SWAB LINES ARE EMPTIED — the swab lives in its row', r.status === 201 && Array.isArray(form.atp) && form.atp.length === 0 && form.checks?.knives === 'yes', JSON.stringify(form).slice(0, 160));
t('…and its old line\'s 99 RLU graded nothing', rec?.result === 'pass' && rec?.atp_reading === 2);

console.log('\n── two failing visits in a row ──');
const failVisit = () => A.post('/sanitation', { area: '7', type: 'pre_op', performed_by: 'Swab Admin', result: 'pass',
  swabs: [{ surface: 'Sifter', atp_reading: LIMIT + 5 }, { surface: 'Table', atp_reading: 1 }] });
const v1 = await J(await failVisit());
const v2 = await J(await failVisit());
t('the first failing visit asks for a re-swab', v1?.atp_stage === 'reswab');
t('THE SECOND RAISES THE RE-CLEAN TASK (D-036 reads the mirror)', v2?.atp_stage === 'escalate' && !!v2?.reclean_work_order_id, JSON.stringify(v2).slice(0, 160));

console.log('\n── a record filed before the rows, and the swab shelf ──');
r = await A.post('/sanitation', { area: '5', type: 'pre_op', performed_by: 'Swab Admin', result: 'pass', atp_reading: 9 });
rec = await J(r);
t('a record filed the old way still works, with no rows', r.status === 201 && rec?.atp_reading === 9 && rec?.swabs?.length === 0);
const used1 = await stock();
// rows with a reading: 701, 702 (after correction), 710, 720, 2 + 2 failing visits = 8; legacy 1 → 9 ATP.
// allergen rows: 702, 711 → 2.
t('THE SHELF COUNTS EVERY ROW, and the old record once', used1.atp - used0.atp === 9, `${used0.atp} → ${used1.atp}`);
t('…and every allergen swab', used1.allergen - used0.allergen === 2, `${used0.allergen} → ${used1.allergen}`);

console.log('\n── the swab sheet ──');
const flag = q1("SELECT value FROM app_settings WHERE key = 'swab_sheet_imported_v1'");
t('A FRESH DATABASE IS NEVER GIVEN THE SHEET', /skipped_fresh/.test(flag?.value || '') && !q1("SELECT 1 x FROM sanitation_records WHERE late_entry_reason LIKE '%Swab Tracebility%'"), flag?.value);
{
  const db = new Database(DBP);
  db.prepare("DELETE FROM app_settings WHERE key = 'swab_sheet_imported_v1'").run(); // as a database that predates D-182
  db.close();
}
async function boot() {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(BOOT2), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) { await wait(1000); try { await fetch(`http://localhost:${BOOT2}/api/users/lookup?q=zz`); ready = true; } catch { /* booting */ } }
  return { proc, ready, log: () => log };
}
let b = await boot();
t('the redeploy came up', b.ready, b.log().slice(-300));
b.proc.kill(); await wait(800);
const imported = qa("SELECT * FROM sanitation_records WHERE late_entry_reason LIKE '%Swab Tracebility%' ORDER BY performed_at");
const importedSwabs = q1(`SELECT COUNT(*) n FROM sanitation_swabs WHERE record_id IN (SELECT id FROM sanitation_records WHERE late_entry_reason LIKE '%Swab Tracebility%')`)?.n;
t('THE SHEET IS FILED: 27 room visits, 39 swabs', imported.length === 27 && importedSwabs === 39, `${imported.length} / ${importedSwabs}`);
t('…every one entered late, by Diana, as a Pre-Op', imported.every((x) => x.entered_late === 1 && x.performed_by === 'Diana Carolina' && x.type === 'pre_op'));
const sw675 = q1("SELECT s.*, r.result, r.id rid FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '675'");
const sw676 = q1("SELECT s.*, r.result, r.id rid FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '676'");
t('THE 39 RLU SIFTER (swab 675) FAILS its record', sw675?.atp_reading === 39 && sw675?.atp_pass === 0 && sw675?.result === 'fail');
t('…and its 5 RLU re-swab (676) is its own, passing visit', sw676?.result === 'pass' && sw676?.rid !== sw675?.rid);
t('the sheet\'s first swab is stamped at its plant time (7:57 MDT = 13:57 UTC)', q1("SELECT r.performed_at p FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '653'")?.p === '2026-10-01 13:57:00');
t('Bat 2 is Batching 2, Kitting is room 15, QA is the QA Room', q1("SELECT r.area a FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '657'")?.a === 'Batching 2'
  && q1("SELECT r.area a FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '681'")?.a === '15'
  && q1("SELECT r.area a FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '678'")?.a === 'QA Room');
t('a mixer swab with no room is filed under Production, saying so', /room written "MIXER 1"/.test(q1("SELECT r.notes n FROM sanitation_swabs s JOIN sanitation_records r ON r.id = s.record_id WHERE s.swab_no = '682'")?.n || ''));
t('an allergen swab keeps its kit lot and no invented result', (() => { const x = q1("SELECT * FROM sanitation_swabs WHERE swab_no = '653'"); return x?.allergen_swab === 1 && x?.allergen_lot === '9626' && x?.allergen_result === null; })());
b = await boot();
b.proc.kill(); await wait(800);
t('A SECOND DEPLOY FILES NOTHING TWICE', qa("SELECT id FROM sanitation_records WHERE late_entry_reason LIKE '%Swab Tracebility%'").length === 27);

console.log('\n── in a browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
await page.goto(`${URL}/?tab=sanitation`);
await page.getByRole('button', { name: /New Record/ }).first().click({ timeout: 20000 });
await page.locator('[data-swab-table]').waitFor({ timeout: 8000 }).catch(() => {});
t('THE FORM HAS A SWAB TABLE, starting with one row', await page.locator('[data-swab-row]').count() === 1);
t('…and no single ATP box beside it', await page.locator('label', { hasText: /^ATP Reading \(RLU\)$/ }).count() === 0);
const formEl = page.locator('form').filter({ has: page.locator('[data-swab-table]') });
await formEl.locator('select').first().selectOption('2');
await formEl.locator('input[required]').first().fill('Swab Admin');
await page.locator('[data-swab-row="1"] [data-swab-no]').fill('801');
await page.locator('[data-swab-row="1"] [data-swab-surface]').fill('Sifter');
await page.locator('[data-swab-row="1"] [data-swab-atp]').fill(String(LIMIT + 7));
await page.locator('[data-swab-add]').click();
await page.locator('[data-swab-row="2"] [data-swab-no]').fill('802');
await page.locator('[data-swab-row="2"] [data-swab-surface]').fill('Table');
await page.locator('[data-swab-row="2"] [data-swab-atp]').fill('4');
await page.locator('[data-swab-row="2"] [data-swab-allergen]').check();
await page.locator('[data-swab-row="2"] [data-swab-allergen-lot]').fill('9626');
t('a second swab is added, with an allergen swab and its lot', await page.locator('[data-swab-row]').count() === 2);
t('the over-limit reading says so as it is typed', /Over the/.test(await page.locator('[data-swab-row="1"]').innerText()));
await page.getByRole('button', { name: /Save Record/ }).click();
await page.waitForTimeout(1500);
const saved = q1("SELECT r.* FROM sanitation_records r JOIN sanitation_swabs s ON s.record_id = r.id WHERE s.swab_no = '801'");
t('SAVED FROM THE SCREEN: two rows, failed on the sifter', !!saved && saved.result === 'fail' && q1('SELECT COUNT(*) n FROM sanitation_swabs WHERE record_id = ?', saved?.id)?.n === 2);
await page.reload();
const row = page.locator('tr', { hasText: 'Room 2' }).filter({ hasText: 'Swab Admin' }).first();
await row.click({ timeout: 15000 }).catch(() => {});
await page.locator('[data-swab-list]').first().waitFor({ timeout: 8000 }).catch(() => {});
t('THE RECORD SHOWS ITS SWABS', await page.locator('[data-swab-list] tr[data-swab-line="801"]').count() >= 1);
t('…the over-limit one in red', await page.locator('[data-swab-list] tr[data-swab-line="801"][data-swab-pass="fail"]').count() >= 1);
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
await phone.goto(`${URL}/?tab=sanitation`);
await phone.getByRole('button', { name: /New Record/ }).first().click({ timeout: 20000 }).catch(() => {});
await phone.locator('[data-swab-table]').waitFor({ timeout: 8000 }).catch(() => {});
t('at 390px the swab table fits without sideways scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
