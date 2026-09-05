// Pausing a schedule reports the work it leaves behind (D-012): open_work on
// the list, missed included; the pause response carries the count; the audit
// entry records it. Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4977; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('pp-admin','Plant Admin','Plant Admin','admin','maintenance',1,'SC-PP',datetime('now','+7 day'))`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await call('POST', '/users/login', { name: 'Plant Admin' });
await call('POST', '/users/set-password', { user_id: 'pp-admin', password: 'Admin2026!!', setup_code: 'SC-PP' });
const auth = await (await call('POST', '/users/login', { name: 'Plant Admin', password: 'Admin2026!!' })).json();
t('signed in', !!auth?.token);
const tok = auth.token;

const eq = await (await call('POST', '/equipment', { name: 'Pause Test Scale', type: 'Scale', location: 'Batching', asset_id: 'PT-1' }, tok)).json();
t('equipment created', !!eq?.id, JSON.stringify(eq).slice(0, 120));
const sched = await (await call('POST', '/pm/schedules', { equipment_id: eq.id, title: 'Daily Scale Check (pause test)', frequency_type: 'daily', frequency_value: 1, task_group: 'maintenance', procedure_steps: ['Check zero'] }, tok)).json();
t('schedule created and active', !!sched?.id && sched.is_active === 1, JSON.stringify(sched).slice(0, 120));

const listed = async () => (await (await call('GET', '/pm/schedules?include_inactive_equipment=true', null, tok)).json()).find(s => s.id === sched.id);
let row = await listed();
t('the list carries open_work, 0 before anything is raised', row && Number(row.open_work) === 0, JSON.stringify(row?.open_work));

// Raise two days' tasks, then age one to missed the way housekeeping would.
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
const r1 = await (await call('POST', `/pm/schedules/${sched.id}/raise`, { due_date: day(0) }, tok)).json();
const r2 = await (await call('POST', `/pm/schedules/${sched.id}/raise`, { due_date: day(3) }, tok)).json();
t('two tasks raised', !!(r1?.id || r1?.work_order?.id) && !!(r2?.id || r2?.work_order?.id), JSON.stringify(r1).slice(0, 100));
{ const db = new Database(dbPath);
  db.prepare("UPDATE work_orders SET status = 'missed' WHERE pm_schedule_id = ? AND due_date = ?").run(sched.id, day(3));
  db.close(); }
row = await listed();
t('open_work counts the open AND the missed task', Number(row.open_work) === 2, String(row.open_work));

const paused = await (await call('PUT', `/pm/schedules/${sched.id}`, { is_active: false }, tok)).json();
t('the pause response says how much work it left behind', paused.is_active === 0 && Number(paused.open_work) === 2, JSON.stringify({ a: paused.is_active, o: paused.open_work }));
row = await listed();
t('the paused schedule still reports its 2 leftover tasks on the list', row.is_active === 0 && Number(row.open_work) === 2);
{ const db = new Database(dbPath);
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'pm_schedule' AND entity_id = ? AND action = 'update' ORDER BY rowid DESC LIMIT 1").get(sched.id);
  const det = a?.details ? JSON.parse(a.details) : {};
  t('the audit entry records the pause and the count', det.paused === true && det.open_work_left === 2, JSON.stringify(det));
  const open = db.prepare("SELECT COUNT(*) c FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','missed')").get(sched.id).c;
  t("pausing itself closed nothing (that is Cleanup Review's job, and it must stay visible)", open === 2);
  db.close(); }

const resumed = await (await call('PUT', `/pm/schedules/${sched.id}`, { is_active: true }, tok)).json();
t('resuming carries the count too, and is not audited as a pause', resumed.is_active === 1 && Number(resumed.open_work) === 2);
{ const db = new Database(dbPath);
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'pm_schedule' AND entity_id = ? AND action = 'update' ORDER BY rowid DESC LIMIT 1").get(sched.id);
  t('the resume audit entry carries no paused flag', !a?.details || !JSON.parse(a.details || '{}').paused);
  db.close(); }

// Leave it paused with its two leftovers, then look at the screen.
await call('PUT', `/pm/schedules/${sched.id}`, { is_active: false }, tok);
console.log('\n── in the browser: Recurring Schedules ──');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, auth.user]);
  await page.goto(`${URL}/?tab=pm-schedules`);
  await page.waitForTimeout(3500);
  const strip = page.locator('[data-paused-leftovers]');
  t('the paused-leftovers strip is on the schedules screen', await strip.count() === 1);
  const text = await strip.innerText().catch(() => '');
  t('it counts the schedule and its two tasks and names the schedule', /1 paused schedule still carries 2 open tasks/.test(text) && /Daily Scale Check \(pause test\) \(2\)/.test(text), text.slice(0, 160));
  t('an admin is offered Cleanup Review', await strip.locator('[data-open-cleanup]').count() === 1);
  t('the row shows the leftover count in amber', /amber/.test(await page.locator(`[data-open-work="${sched.id}"]`).getAttribute('class') || ''));
  await strip.locator('[data-open-cleanup]').click();
  await page.waitForTimeout(2500);
  t('clicking it lands on Settings → Cleanup Review', /Cleanup/.test(await page.locator('body').innerText()) && /pick a cutoff|Cleanup Review|Closed as cancelled/i.test(await page.locator('body').innerText()));
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
