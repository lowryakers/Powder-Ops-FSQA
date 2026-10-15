// verify:eodatp — the end-of-day report's ATP swab carries its READING (D-179).
//
// A tick said a swab was taken; PC #1's limit is a number. Asserts, live:
//   1. a reading on a cleaning event is stored, graded against 35 RLU, and the
//      limit is stamped beside it; over the limit reads as a failure;
//   2. a reading sets the swab tick (so the swab shelf counts it), a blank
//      reading is a gap, never a failure, and nonsense is not stored;
//   3. the running day log ("My Day") takes the reading too;
//   4. in a real browser: ticking "ATP swab taken" opens the reading box, the
//      limit hint reacts, and the log shows the reading after filing.
// THE CONTROL is `main` before this: the reading is dropped on save.
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5105;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('ea-adm','Atp Admin','Atp Admin','admin','qa',1,'SC-EA',datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Atp Admin' });
await post('/users/set-password', { user_id: 'ea-adm', password: 'AtpAdmin2026!', setup_code: 'SC-EA' });
const auth = await J(await post('/users/login', { name: 'Atp Admin', password: 'AtpAdmin2026!' }));
tok = auth?.token;
t('signed in', !!tok);

const day = new Date().toISOString().slice(0, 10);
const shelf = async () => (await J(await req('/sanitation/swab-stock')))?.swabs?.find(s => s.key === 'atp');
const atpBefore = (await shelf())?.on_hand;

console.log('\n── the reading is stored and graded ──');
const base = { date: day, team: 'Batching', submitted_by: 'Atp Admin', people_count: 1,
  mo_lines: [{ product_name: 'ATP Test Mix', mo_number: 'MO-ATP-1', lot_number: 'L1', quantity: 10, start_time: '07:00', end_time: '09:00', room: 'Batching 1' }] };
const entry = await J(await post('/production/entries', { ...base,
  cleaning_events: [
    { level: 'Full Clean', scope: ['Room'], room: 'Batching 1', atp_swab: true, atp_reading: '12', start_time: '06:00', end_time: '06:45' },
    { level: 'Full Clean', scope: ['Blender 1'], room: 'Batching 1', atp_reading: 60, start_time: '06:45', end_time: '07:00' },
    { level: 'Full Clean', scope: ['Sifter'], room: 'Batching 1', atp_swab: true, atp_reading: '', start_time: '07:00', end_time: '07:10' },
    { level: 'Partial Clean', scope: ['Utensils'], room: 'Batching 1', atp_swab: true, atp_reading: 'abc' },
  ] }));
t('an entry with four cleans was filed', !!entry?.id, JSON.stringify(entry).slice(0, 200));
const stored = (() => { const db = new Database(process.env.DBPATH); const r = db.prepare('SELECT cleaning_events FROM production_entries WHERE id = ?').get(entry?.id); db.close(); return JSON.parse(r?.cleaning_events || '[]'); })();
const [a, b, c, d] = stored;
t('A READING OF 12 IS STORED as a number', a?.atp_reading === 12, JSON.stringify(a));
t('…with the limit it was graded against (35) beside it', a?.atp_limit === 35);
t('…and it passes', a?.atp_pass === true);
t('60 IS OVER THE LIMIT and reads as a failure', b?.atp_reading === 60 && b?.atp_pass === false, JSON.stringify(b));
t('a reading sets the swab tick even when the box was not ticked', b?.atp_swab === true);
t('A BLANK READING IS A GAP: tick kept, no reading, no grade', c?.atp_swab === true && c?.atp_reading === null && c?.atp_pass === null, JSON.stringify(c));
t('a reading that is not a number is not stored', d?.atp_reading === null && d?.atp_limit === null, JSON.stringify(d));
const atpAfter = (await shelf())?.on_hand;
t('the swab shelf counts all four ATP swabs', typeof atpBefore === 'number' && atpBefore - atpAfter === 4, `${atpBefore} → ${atpAfter}`);

console.log('\n── an amend keeps or changes the reading ──');
let r = await put(`/production/entries/${entry.id}`, { cleaning_events: stored.map((e, i) => i === 0 ? { ...e, atp_reading: 14 } : e), reason: 'Reading typed wrong' });
t('the amend is accepted', r.status === 200, `${r.status} ${JSON.stringify(await J(r)).slice(0, 160)}`);
{
  const db = new Database(process.env.DBPATH);
  const ev = JSON.parse(db.prepare('SELECT cleaning_events FROM production_entries WHERE id = ?').get(entry.id).cleaning_events);
  db.close();
  t('the corrected reading (14) is re-graded and passes', ev[0]?.atp_reading === 14 && ev[0]?.atp_pass === true, JSON.stringify(ev[0]));
  t('the untouched over-limit reading (60) survives the amend', ev[1]?.atp_reading === 60 && ev[1]?.atp_pass === false);
}

console.log('\n── My Day takes the reading too ──');
const dl = await J(await post('/production/day-log', { date: day, team: 'Batching' }));
const logId = dl?.id || dl?.log?.id;
t('a day log is open', !!logId, JSON.stringify(dl).slice(0, 160));
r = await post(`/production/day-log/${logId}/items`, { kind: 'clean', data: { level: 'Full Clean', scope: ['Room'], room: 'Batching 2', atp_swab: true, atp_reading: '44' } });
const logRow = await J(r);
const idata = (logRow?.items || []).find(i => i.kind === 'clean')?.data;
t('A DAY-LOG CLEAN KEEPS ITS READING, graded (44 fails)', idata?.atp_reading === 44 && idata?.atp_pass === false, JSON.stringify(logRow).slice(0, 260));

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, auth.user]);
await page.goto(`${URL}/?tab=production-log`);
await page.waitForSelector('text=MO-ATP-1', { timeout: 20000 }).catch(() => {});
const row = page.locator('tr', { hasText: 'MO-ATP-1' }).first();
await row.click().catch(() => {});
await page.waitForSelector('[data-atp-reading-chip]', { timeout: 8000 }).catch(() => {});
const chips = await page.locator('[data-atp-reading-chip]').allInnerTexts();
t('THE LOG SHOWS THE READINGS against the limit', chips.some(x => /ATP 14 \/ 35 RLU/.test(x)), JSON.stringify(chips));
t('…the over-limit one marked in red', chips.some(x => /ATP 60 \/ 35 RLU · over limit/.test(x)) && await page.locator('[data-atp-reading-chip="fail"]').count() >= 1);
t('…and a ticked swab with no reading says so', await page.locator('text=no ATP reading recorded').count() >= 1);

await page.getByRole('tab', { name: /Entry Form/ }).click();
await page.waitForTimeout(300);
const teamSelect = page.locator('form select').filter({ has: page.locator('option[value="Batching"]') }).first();
await teamSelect.selectOption('Batching');
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Add a clean/ }).first().click();
await page.waitForTimeout(200);
t('no reading box before the swab is ticked', await page.locator('[data-atp-reading-input]').count() === 0);
await page.getByLabel('ATP swab taken').first().check();
await page.waitForTimeout(200);
t('TICKING "ATP swab taken" OPENS THE READING BOX', await page.locator('[data-atp-reading-input]').count() === 1);
await page.locator('[data-atp-reading-input]').fill('60');
t('…and 60 is shown as over the 35 RLU limit as it is typed', /Over the 35 RLU limit/.test(await page.locator('[data-atp-reading-field]').innerText()));
await page.locator('[data-atp-reading-input]').fill('20');
t('…and 20 as within it', /Within limit/.test(await page.locator('[data-atp-reading-field]').innerText()));
await page.getByLabel('ATP swab taken').first().uncheck();
await page.waitForTimeout(200);
t('unticking the swab removes the box (no reading without a swab)', await page.locator('[data-atp-reading-input]').count() === 0);

await page.setViewportSize({ width: 390, height: 844 });
await page.getByLabel('ATP swab taken').first().check();
await page.waitForTimeout(200);
t('at 390px the box fits without sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
