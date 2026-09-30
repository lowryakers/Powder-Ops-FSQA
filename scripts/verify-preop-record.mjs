// verify:preop — D-125, live on a fresh database.
//   1. The daily Pre-Op / Changeover task is retired: paused, its open cards
//      cancelled with the reason, the cleaner's three wrong ticks gone — once
//      per database, so a schedule a person resumes stays resumed.
//   2. Form 117.21 V5 rides on the Sanitation record of a production pre-op:
//      stored with its revision, every swab can fail the clean and none can
//      pass it, refused where it does not belong, left alone by an edit that
//      does not mention it.
//   3. The form shows it where the clean is filed (real browser, 1280 + 390).
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const PORT = process.env.PORT || 5045;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('po-adm','Pia Operator','Pia Operator','admin','cleaning',1,'SC-po-adm',datetime('now','+7 day'))`).run();
const H = { 'Content-Type': 'application/json' };
const call = (p, opts = {}, tok) => fetch(`${URL}/api${p}`, { ...opts, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
await call('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Pia Operator' }) });
await call('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'po-adm', password: 'PiaOperator26!', setup_code: 'SC-po-adm' }) });
const tok = (await (await call('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Pia Operator', password: 'PiaOperator26!' }) })).json()).token;
t('signed in', !!tok);

const OUT = "('open','in_progress','overdue','missed')";
const RETIRED = ['ATP Test — swab surface, record location, swab #, and result',
  'Allergen Test — swab surface, record location, swab #, and result', 'QA sign-off'];

console.log('── 1. The daily Pre-Op task is retired ──');
{
  const s = db.prepare("SELECT * FROM pm_schedules WHERE title = 'Production Line Pre-Op / Changeover Clean'").get();
  t('the seeded schedule is still there — paused, not deleted', !!s && s.is_active === 0, JSON.stringify(s && { is_active: s.is_active }));
  t('NOTHING OF IT IS LEFT ON THE FLOOR — no outstanding card', !s || db.prepare(`SELECT COUNT(*) c FROM work_orders WHERE pm_schedule_id = ? AND status IN ${OUT}`).get(s.id).c === 0);
  const steps = JSON.parse(s?.procedure_steps || '[]');
  t('THE THREE WRONG TICKS ARE GONE — no "ATP Test", "Allergen Test" or "QA sign-off" for the cleaner', !steps.some(x => RETIRED.includes(x)), JSON.stringify(steps).slice(0, 200));
  t('…and the clean itself is still described', steps.some(x => /sanitizer/i.test(x)) && steps.length >= 9, `${steps.length} steps`);
  t('the pass is recorded as done', !!db.prepare("SELECT 1 FROM app_settings WHERE key = 'preop_daily_retired_v1'").get());
}

// The live plant: per-room Pre-Op schedules, open and missed cards, a finished one.
async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP, DBPATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) { await wait(1000); try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ } }
  proc.kill('SIGKILL'); await wait(500);
  return { ready, log };
}
db.prepare("DELETE FROM app_settings WHERE key = 'preop_daily_retired_v1'").run();
db.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,status,asset_kind,loto_required) VALUES ('po-eq','Production Line 3','Production Line','active','zone',0)`).run();
db.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active,procedure_steps)
  VALUES ('po-sch','po-eq','Production Line Pre-Op Clean — Room 3','daily',1,'cleaning',1,?)`)
  .run(JSON.stringify(['Remove all materials', ...RETIRED, 'A step the plant added']));
const woIns = db.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date,completed_by,completed_at)
  VALUES (?, 'po-sch','po-eq','Production Line Pre-Op Clean — Room 3', ?, 'cleaning', date('now', ?), ?, ?)`);
woIns.run('po-open', 'open', '+0 day', null, null);
woIns.run('po-missed', 'missed', '-3 day', null, null);
woIns.run('po-done', 'completed', '-5 day', 'Zara Cleaner', '2026-09-25 08:00:00');
{
  const b = await reboot(Number(PORT) + 100);
  t('the application booted on the plant-shaped database', b.ready);
  t('the boot log says what it retired', /Daily Pre-Op retired: 1 schedule\(s\) paused, 2 open card\(s\) cancelled/.test(b.log), b.log.split('\n').filter(l => /Pre-Op/.test(l)).join(' | '));
  t('A PER-ROOM PRE-OP SCHEDULE IS PAUSED TOO', db.prepare("SELECT is_active FROM pm_schedules WHERE id = 'po-sch'").get().is_active === 0);
  const st = (id) => db.prepare('SELECT status, notes, completed_by FROM work_orders WHERE id = ?').get(id);
  t('THE OPEN CARD IS CANCELLED, with the reason on it', st('po-open').status === 'cancelled' && /D-125/.test(st('po-open').notes || ''), JSON.stringify(st('po-open')));
  t('the MISSED card too — a missed card is outstanding work on the floor screen', st('po-missed').status === 'cancelled');
  t('A COMPLETED CLEAN IS UNTOUCHED — it happened', st('po-done').status === 'completed' && st('po-done').completed_by === 'Zara Cleaner');
  const steps = JSON.parse(db.prepare("SELECT procedure_steps FROM pm_schedules WHERE id = 'po-sch'").get().procedure_steps);
  t('the three ticks come off; the plant\'s own step stays', steps.join('|') === 'Remove all materials|A step the plant added', JSON.stringify(steps));
  t('audited', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_id IN ('po-open','po-missed','po-sch')").get().c >= 3);
}
db.prepare("UPDATE pm_schedules SET is_active = 1 WHERE id = 'po-sch'").run();
{
  const b = await reboot(Number(PORT) + 101);
  t('booted again', b.ready);
  t('A SCHEDULE A PERSON RESUMES STAYS RESUMED — once per database, not once per boot',
    db.prepare("SELECT is_active FROM pm_schedules WHERE id = 'po-sch'").get().is_active === 1);
  db.prepare("UPDATE pm_schedules SET is_active = 0 WHERE id = 'po-sch'").run();
}

console.log('\n── 2. Form 117.21 on the Sanitation record ──');
const file = (body) => call('/sanitation', { method: 'POST', body: JSON.stringify({ type: 'pre_op', performed_by: 'Pia Operator', result: 'pass', ...body }) }, tok);
const read = (id) => db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
const FORM = {
  product_name: 'Alkify Stick Pack', wo_lot: 'MO76790 / 101850', allergens: ['Milk'], clean_level: 'full',
  checks: { materials_removed: 'yes', knives: 'yes', glass_plastic: 'na', wipe_down: 'yes', sanitizer: 'yes' },
  asset_tag: 'AS-114', condition: 'Good',
  atp: [{ location: 'Auger funnel', swab_no: '0412' }, { location: 'Sealing jaw', swab_no: '0413', reading: '12' }],
  allergen: [{ location: 'Hopper', swab_no: 'A-88', result: 'pass' }, { location: '', swab_no: '', result: '' }],
};
let cleanId;
{
  const r = await file({ area: '3', atp_reading: 20, preop_form: FORM });
  const b = await r.json();
  cleanId = b.id;
  t('a production pre-op files with its Form 117.21 answers', r.status === 201, `HTTP ${r.status} ${JSON.stringify(b).slice(0, 160)}`);
  const rec = read(b.id);
  const f = JSON.parse(rec?.preop_form || 'null');
  t('THE ANSWERS ARE ON THE RECORD', f?.product_name === 'Alkify Stick Pack' && f?.checks?.glass_plastic === 'na' && f?.allergen?.[0]?.swab_no === 'A-88', JSON.stringify(f).slice(0, 200));
  t('THE REVISION TRAVELS WITH IT (the atp_limit rule)', f?.revision === 'V5');
  t('swab 1\'s reading is the record\'s own graded reading, not a second copy', rec?.atp_reading === 20 && rec?.atp_limit === 35 && f?.atp?.[0]?.reading === undefined, JSON.stringify({ atp: rec?.atp_reading, lim: rec?.atp_limit, f0: f?.atp?.[0] }));
  t('two clean swabs and a passing allergen swab leave the filer\'s pass alone', rec?.result === 'pass');
}
{
  const r = await file({ area: '3', atp_reading: 20, preop_form: { ...FORM, atp: [FORM.atp[0], { ...FORM.atp[1], reading: 61 }] } });
  const rec = read((await r.json()).id);
  t('ATP SWAB 2 OVER THE LIMIT FAILS THE CLEAN — graded like swab 1', rec?.result === 'fail', `result=${rec?.result}`);
  t('…and the limit is stamped even though swab 1 passed', rec?.atp_limit === 35);
}
{
  const r = await file({ area: '3', preop_form: { ...FORM, atp: [{}, {}], allergen: [{ location: 'Hopper', swab_no: 'A-89', result: 'no_pass' }] } });
  const rec = read((await r.json()).id);
  t('AN ALLERGEN SWAB MARKED NO PASS FAILS THE CLEAN', rec?.result === 'fail', `result=${rec?.result}`);
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_id = ? AND action = 'create'").get(rec?.id);
  t('…and the audit entry says why', /Allergen swab 1 marked no pass/.test(a?.details || ''), a?.details?.slice(0, 200));
}
{
  const r = await file({ area: '3', result: 'fail', preop_form: { ...FORM, atp: [{}, {}] } });
  t('A CLEAN SWAB NEVER PASSES A CLEAN THE FILER FAILED', read((await r.json()).id)?.result === 'fail');
}
{
  const r = await file({ area: 'Restrooms', preop_form: FORM });
  const b = await r.json();
  t('FORM 117.21 ON THE RESTROOM IS REFUSED, and says why', r.status === 400 && /production room/.test(b.error || ''), `HTTP ${r.status} ${b.error}`);
  const r2 = await file({ area: 'Production', preop_form: { ...FORM, clean_level: 'medium' } });
  const b2 = await r2.json();
  t('AN ANSWER THAT IS NOT ON THE FORM IS REFUSED BY NAME', r2.status === 400 && /medium/.test(b2.error || ''), `HTTP ${r2.status} ${b2.error}`);
  const r3 = await file({ area: '3', type: 'post_op', preop_form: FORM });
  t('a post-op clean is not this form either', r3.status === 400);
  const r4 = await file({ area: 'Production', preop_form: { atp: [{}, {}], allergen: [{}, {}], checks: {} } });
  t('an untouched checklist stores nothing — blank is not an answer', r4.status === 201 && read((await r4.json()).id)?.preop_form === null);
  const r5 = await file({ area: 'Restrooms', type: 'pre_op' });
  t('the restroom pre-op still files as it always did', r5.status === 201);
}
{
  const r = await call(`/sanitation/${cleanId}`, { method: 'PUT', body: JSON.stringify({ notes: 'typo fixed' }) }, tok);
  t('an edit that does not mention the checklist leaves it alone', r.ok && JSON.parse(read(cleanId).preop_form)?.asset_tag === 'AS-114', `HTTP ${r.status}`);
  const r2 = await call(`/sanitation/${cleanId}`, { method: 'PUT', body: JSON.stringify({ area: 'Restrooms' }) }, tok);
  t('MOVING A RECORD WITH ANSWERS TO THE RESTROOM IS REFUSED rather than silently dropping them', r2.status === 400);
  const r3 = await call(`/sanitation/${cleanId}`, { method: 'PUT', body: JSON.stringify({ preop_form: { ...FORM, allergen: [{ result: 'no_pass' }] } }) }, tok);
  t('A CORRECTION IS GRADED LIKE A FILING — an allergen no-pass entered later fails it', r3.ok && read(cleanId).result === 'fail', `HTTP ${r3.status} ${read(cleanId).result}`);
}

console.log('\n── 3. The form, where the clean is filed ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tk]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify({ id: 'po-adm', name: 'Pia Operator', role: 'admin' })); }, [tok]);
    await page.goto(`${URL}/?tab=sanitation`);
    await page.getByRole('button', { name: /New Record/ }).click({ timeout: 20000 });
    const form = page.locator('form').filter({ hasText: 'New Sanitation Record' });
    const area = form.locator('select').first();
    await area.selectOption('Restrooms');
    t(`${width}px: a restroom pre-op shows no Form 117.21`, await page.locator('[data-preop-form]').count() === 0);
    t(`${width}px: …and keeps its ordinary ATP box`, await form.getByText('ATP Reading (RLU)').count() === 1);
    await area.selectOption('3');
    await page.waitForSelector('[data-preop-form]', { timeout: 5000 }).catch(() => {});
    t(`${width}px: ROOM 3 PRE-OP SHOWS FORM 117.21 V5`, /Form 117\.21 V5/.test(await page.locator('[data-preop-form] legend').innerText().catch(() => '')));
    t(`${width}px: ONE ATP BOX, NOT TWO — the reading lives in the ATP section`, await form.getByText('ATP Reading (RLU)').count() === 0 && await page.locator('[data-preop-atp-reading="1"]').count() === 1);
    t(`${width}px: every verification question is asked, in the form's words`,
      await page.locator('[data-preop-check]').count() === 5 && await page.getByText('Visual inspection of all knives (no snap off blades allowed)').count() === 1);
    t(`${width}px: no "QA sign-off" for the cleaner to tick`, await page.locator('[data-preop-form]').getByText(/QA sign-off/).count() === 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    t(`${width}px: the page does not pan sideways`, !overflow);
    if (width === 1280) {
      await page.locator('#preop-product_name').fill('M4-HMR PRO Blend Mocha');
      await page.locator('[data-preop-check="knives"]').getByRole('radio', { name: 'Yes', exact: true }).click();
      await page.locator('[data-preop-atp-reading="1"]').fill('18');
      await page.locator('[data-preop-allergen="1"]').getByRole('radio', { name: 'Pass', exact: true }).click();
      await form.locator('label:has-text("Performed By") + input').fill('Pia Operator');
      await form.getByRole('button', { name: /Save Record/ }).click();
      await page.waitForTimeout(2000);
      const rec = db.prepare("SELECT * FROM sanitation_records WHERE preop_form LIKE '%M4-HMR PRO Blend Mocha%'").get();
      const f = JSON.parse(rec?.preop_form || 'null');
      t('SAVED FROM THE SCREEN: the answers and the graded reading land on the record',
        !!rec && rec.atp_reading === 18 && rec.atp_limit === 35 && f?.checks?.knives === 'yes' && f?.allergen?.[0]?.result === 'pass', JSON.stringify({ atp: rec?.atp_reading, f }).slice(0, 220));
      await page.locator('tbody td', { hasText: /^Room 3$/ }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      t('THE RECORD READS THE FORM BACK', await page.locator('[data-preop-answers]').filter({ hasText: 'Form 117.21' }).count() > 0);
    }
    await page.close();
  }
} finally { await browser.close(); }

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
