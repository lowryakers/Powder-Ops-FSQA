// Pausing a schedule closes the open and missed work it had raised (D-139,
// superseding D-055's "closes nothing"); a card somebody had STARTED is left and
// reported (open_work on the list, the pause response, the audit entry, and the
// leftovers strip). Caller sets PORT + DBPATH.
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
t('the pause response says it closed both tasks and left nothing', paused.is_active === 0 && Number(paused.closed_work) === 2 && Number(paused.open_work) === 0, JSON.stringify({ a: paused.is_active, c: paused.closed_work, o: paused.open_work }));
row = await listed();
t('the paused schedule reports no leftover work on the list', row.is_active === 0 && Number(row.open_work) === 0);
{ const db = new Database(dbPath);
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'pm_schedule' AND entity_id = ? AND action = 'update' ORDER BY rowid DESC LIMIT 1").get(sched.id);
  const det = a?.details ? JSON.parse(a.details) : {};
  t('the audit entry records the pause, what it closed and what it left', det.paused === true && det.closed_work === 2 && det.open_work_left === 0, JSON.stringify(det));
  const cards = db.prepare("SELECT status, notes FROM work_orders WHERE pm_schedule_id = ?").all(sched.id);
  t('both cards are CANCELLED, not deleted, with who paused it on each', cards.length === 2 && cards.every(c => c.status === 'cancelled' && /paused by Plant Admin/.test(c.notes || '')));
  db.close(); }

const resumed = await (await call('PUT', `/pm/schedules/${sched.id}`, { is_active: true }, tok)).json();
t('resuming carries the count too, and is not audited as a pause', resumed.is_active === 1 && Number(resumed.open_work) === 0);
{ const db = new Database(dbPath);
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'pm_schedule' AND entity_id = ? AND action = 'update' ORDER BY rowid DESC LIMIT 1").get(sched.id);
  t('the resume audit entry carries no paused flag', !a?.details || !JSON.parse(a.details || '{}').paused);
  db.close(); }

// A card somebody has STARTED is the one thing a pause leaves: raise one,
// start it, raise another, pause, then look at the screen.
const s1 = await (await call('POST', `/pm/schedules/${sched.id}/raise`, { due_date: day(1) }, tok)).json();
const s2 = await (await call('POST', `/pm/schedules/${sched.id}/raise`, { due_date: day(0) }, tok)).json();
{ const db = new Database(dbPath);
  db.prepare("UPDATE work_orders SET status = 'in_progress', started_at = datetime('now') WHERE id = ?").run(s1.id || s1.work_order?.id);
  db.close(); }
const p2 = await (await call('PUT', `/pm/schedules/${sched.id}`, { is_active: false }, tok)).json();
t('pausing again closes the open card and leaves the started one', Number(p2.closed_work) === 1 && Number(p2.open_work) === 1, JSON.stringify({ c: p2.closed_work, o: p2.open_work, s2: !!(s2.id || s2.work_order?.id) }));
console.log('\n── a Quality Schedule pause closes what it raised too (D-148) ──');
{
  const qs = await (await call('POST', '/quality-schedules', { title: 'Tap Water Testing (pause test)', frequency_type: 'monthly', first_due: day(-30) }, tok)).json();
  const qs2 = await (await call('POST', '/quality-schedules', { title: 'Air Testing (delete test)', frequency_type: 'annual', first_due: day(-30) }, tok)).json();
  const db = new Database(dbPath);
  const ins = db.prepare(`INSERT INTO work_orders (id, quality_schedule_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, '[]', 'qa', ?)`);
  ins.run('qs-open', qs.id, qs.title, day(0), 'open');
  ins.run('qs-missed', qs.id, qs.title, day(-31), 'missed');
  ins.run('qs-started', qs.id, qs.title, day(-2), 'in_progress');
  ins.run('qs2-open', qs2.id, qs2.title, day(0), 'open');
  db.close();
  const p = await (await call('PUT', `/quality-schedules/${qs.id}`, { is_active: false }, tok)).json();
  const st = (id) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare('SELECT status, notes FROM work_orders WHERE id = ?').get(id); } finally { d.close(); } };
  t('pausing a Quality Schedule cancels its open and missed cards and says so', p.is_active === 0 && Number(p.closed_work) === 2
    && st('qs-open').status === 'cancelled' && st('qs-missed').status === 'cancelled', JSON.stringify({ a: p.is_active, c: p.closed_work }));
  t('…leaves the started one, counted, and names who paused it on each card', st('qs-started').status === 'in_progress' && Number(p.open_work) === 1
    && /paused by Plant Admin/.test(st('qs-open').notes || ''));
  const d = await (await call('DELETE', `/quality-schedules/${qs2.id}`, null, tok)).json();
  t('deleting one cancels its card rather than orphaning it', Number(d.closed_work) === 1 && st('qs2-open').status === 'cancelled');
}
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
  t('it counts the schedule and the one started task and names the schedule', /1 paused schedule still carries 1 open task/.test(text) && /Daily Scale Check \(pause test\) \(1\)/.test(text), text.slice(0, 160));
  t('an admin is offered Cleanup Review', await strip.locator('[data-open-cleanup]').count() === 1);
  t('the row shows the leftover count in amber', /amber/.test(await page.locator(`[data-open-work="${sched.id}"]`).getAttribute('class') || ''));
  await strip.locator('[data-open-cleanup]').click();
  await page.waitForTimeout(2500);
  t('clicking it lands on Settings → Cleanup Review', /Cleanup/.test(await page.locator('body').innerText()) && /pick a cutoff|Cleanup Review|Closed as cancelled/i.test(await page.locator('body').innerText()));
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
