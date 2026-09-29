// THE DAILY SCALE CHECK WAS NEVER ON THE OPERATOR'S SCREEN.
//
// Scale Verification (Forms 417-01 … 417-05) is a Quick Forms shortcut and
// not a task, so the Operator View never showed it; nothing anywhere reported
// a check that was NOT done; and "today" on the one QA screen that did show it
// was UTC, which in Utah flips at 6pm. Filling went eighteen days.
//
// Asserted here: one derivation read by the Calibration tab, the Operator
// View strip and the bell; the plant's day rather than UTC's; department
// scoping identical to the tasks beside it; and, in a real browser, a card
// that opens the kiosk already on that scale and leaves once the record is
// filed — the record IS the completion.
//
// Caller sets PORT + DBPATH. Needs a fresh database and `npm run build`.
const PORT = process.env.PORT || 5026;
const B = `http://localhost:${PORT}/api`;
const URL = `http://localhost:${PORT}`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { plantDateOf, PLANT_TZ, plantHour, plantWeekday } = await import('../server/plant-clock.js');
const { scaleCheckStatus, scaleChecksDue, TEAM_OF_AREA, scaleChecksOverdueNow, SCALE_CHECK_GRACE_HOUR } = await import('../server/scale-checks.js');
const { SCALE_FORMS } = await import('../server/scale-forms.js');

console.log(`\nThe plant's day, not UTC's (${PLANT_TZ})`);
{
  // 19:30 Mountain on the 28th is 01:30 UTC on the 29th. SQLite stamps the
  // latter with no zone marker; the plant did the check on the 28th.
  t('a SQLite UTC stamp after 6pm Mountain still belongs to the plant’s day', plantDateOf('2026-09-29 01:30:00') === '2026-09-28', plantDateOf('2026-09-29 01:30:00'));
  t('an ISO stamp with a zone is read as given', plantDateOf('2026-09-29T13:00:00Z') === '2026-09-29');
  t('every scale form’s area routes to a team — nothing falls off the floor screen for want of a mapping',
    SCALE_FORMS.every(f => TEAM_OF_AREA[f.area]), SCALE_FORMS.filter(f => !TEAM_OF_AREA[f.area]).map(f => f.code).join(','));
  t('the grace hour is the plant’s number and is a morning hour', SCALE_CHECK_GRACE_HOUR >= 6 && SCALE_CHECK_GRACE_HOUR <= 12);
  const mon10 = new Date('2026-09-28T16:00:00Z'); // Monday 10:00 Mountain
  const mon5 = new Date('2026-09-28T11:00:00Z');  // Monday 05:00 Mountain
  const sat10 = new Date('2026-09-26T16:00:00Z');
  t('the bell speaks on a weekday after the grace hour', scaleChecksOverdueNow(mon10));
  t('…and not at 5am, before anyone could have run one', !scaleChecksOverdueNow(mon5));
  t('…and not on a Saturday', !scaleChecksOverdueNow(sat10));
}

// ── Live ─────────────────────────────────────────────────────────────────────
const db = new Database(process.env.DBPATH);
const mkUser = (id, name, role, dept, code, access) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, access);
mkUser('sd-admin', 'Scale Admin', 'admin', 'quality', 'SC-SDA', null);
mkUser('sd-batch', 'Batch Super', 'supervisor', 'batching', 'SC-SDB', '{"operator":"view","form-scale":"edit"}');
db.prepare("DELETE FROM scale_verifications").run(); // a fresh database seeds none; asserted below
db.close();

const signIn = async (name, id, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await J(await post('/users/login', { name, password: pw })))?.token;
};
const adminTok = await signIn('Scale Admin', 'sd-admin', 'SC-SDA', 'ScaleAdm2026!');
const batchTok = await signIn('Batch Super', 'sd-batch', 'SC-SDB', 'BatchSup2026!');
t('both accounts signed in', !!adminTok && !!batchTok);

console.log('\nOne derivation, read by three screens');
token = adminTok;
{
  const status = await J(await req('/scale-verification/status'));
  t('the Calibration tab’s status names every form', status?.forms?.length === SCALE_FORMS.length, `${status?.forms?.length}`);
  t('…and now says which plant day it is answering for', status?.date === plantDateOf(), status?.date);
  t('nothing has been checked today on a fresh database', status.forms.every(f => f.today === null));
  const due = await J(await req('/pm/operator-checks'));
  t('the Operator View is handed all five as due (admin, all teams)', due?.scale_checks?.length === 5, JSON.stringify(due).slice(0, 120));
  t('each card carries its team', due.scale_checks.every(c => c.team));
  const d2 = new Database(process.env.DBPATH, { readonly: true });
  t('what the screen gets IS scaleChecksDue — not a second query', JSON.stringify(scaleChecksDue(d2).map(c => c.code)) === JSON.stringify(due.scale_checks.map(c => c.code)));
  d2.close();
}

console.log('\nScoped by the same department rule as the tasks');
token = batchTok;
{
  const due = await J(await req('/pm/operator-checks'));
  const codes = (due?.scale_checks || []).map(c => c.code).sort();
  t('a Batching supervisor is shown the two Batching scales and nothing else', JSON.stringify(codes) === JSON.stringify(['417-01', '417-02']), codes.join(','));
  const sneaky = await J(await req('/pm/operator-checks?group=kitting'));
  t('…and cannot browse another team’s by asking', JSON.stringify((sneaky?.scale_checks || []).map(c => c.code).sort()) === JSON.stringify(['417-01', '417-02']));
}

console.log('\nFiling the check is what clears the card');
token = adminTok;
{
  const f = SCALE_FORMS.find(x => x.code === '417-01');
  const r = await post('/scale-verification', { form_code: '417-01', readings: f.points.map(p => String(p.nominal)), performed_by: 'Scale Admin', room: 'Batching' });
  t('a passing 417-01 check is filed', r.status === 201, `${r.status}`);
  const due = await J(await req('/pm/operator-checks'));
  t('417-01 leaves the due list — the record is the completion', !due.scale_checks.some(c => c.code === '417-01'));
  t('the other four remain', due.scale_checks.length === 4);
  const status = await J(await req('/scale-verification/status'));
  t('and the Calibration tab agrees: 417-01 has a check today', !!status.forms.find(x => x.code === '417-01')?.today);
}

console.log('\nThe evening-shift case the old derivation got wrong');
{
  // A check filed at 19:00 Mountain TODAY: its UTC stamp is already tomorrow's
  // date, so `date(performed_at) = date('now')` called it "not today".
  const today = plantDateOf();
  const d = new Database(process.env.DBPATH);
  // Build 19:00 plant time today as a UTC instant.
  const probe = new Date(`${today}T12:00:00Z`); // noon UTC, safely inside the plant day
  const offsetH = 12 - plantHour(probe);         // UTC hour minus plant hour at that instant
  const eveningUtc = new Date(Date.parse(`${today}T19:00:00Z`) + offsetH * 3600e3); // 19:00 plant = 01:00Z next day in summer
  const stamp = eveningUtc.toISOString().slice(0, 19).replace('T', ' ');
  d.prepare(`INSERT INTO scale_verifications (id, form_code, form_title, performed_by, performed_at, readings, result, source)
    VALUES ('sd-evening','417-05','Scale Verification — Kitting','Night Shift',?, '[]','pass','app')`).run(stamp);
  d.close();
  const status = await J(await req('/scale-verification/status'));
  const k = status.forms.find(x => x.code === '417-05');
  t(`a check stamped ${stamp} UTC (19:00 plant time) COUNTS as today`, !!k.today, `today=${JSON.stringify(k.today)}`);
  const utcDate = stamp.slice(0, 10);
  t('…although its UTC date is tomorrow’s — the case the old code got wrong', utcDate !== today, `${utcDate} vs ${today}`);
  const due = await J(await req('/pm/operator-checks'));
  t('and Kitting leaves the due list', !due.scale_checks.some(c => c.code === '417-05'));
}

console.log('\nThe bell says a check was NOT run — after the plant’s morning');
{
  const notes = await J(await req('/compliance/notifications'));
  const items = Array.isArray(notes) ? notes : (notes?.items || notes?.notifications || []);
  const item = items.find(i => i.id === 'scale-not-checked');
  const d2 = new Database(process.env.DBPATH, { readonly: true });
  const dueNow = scaleChecksDue(d2).length; d2.close();
  if (scaleChecksOverdueNow()) {
    t(`it is past ${SCALE_CHECK_GRACE_HOUR}:00 plant time on a weekday — the bell names the ${dueNow} unrun checks`, item?.count === dueNow, JSON.stringify(item || null));
    t('…pointing at Calibration, where the cards are', item?.tab === 'calibration');
  } else {
    t(`it is ${plantHour()}:00 plant time${plantWeekday() ? '' : ' at the weekend'} — the bell stays quiet on purpose`, !item, JSON.stringify(item || null));
  }
}

console.log('\nIn a real browser, on the floor screen');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  const me = await J(await req('/users/me'));
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [adminTok, me]);
  await page.goto(`${URL}/?tab=operator`);
  await page.waitForTimeout(4000);
  const strip = page.locator('[data-scale-due]');
  t('the due strip is on the Operator View', await strip.count() === 1, (await page.locator('body').innerText()).slice(0, 160).replace(/\n/g, ' '));
  const cards = await page.locator('[data-scale-due-card]').count();
  t('it lists the three scales still owed (417-01 and 417-05 are filed)', cards === 3, `${cards}`);
  const kit = page.locator('[data-scale-due-card="417-05"]');
  t('…and the one filed at 19:00 plant time is NOT among them', await kit.count() === 0);
  const fill = page.locator('[data-scale-due-card="417-04"]');
  t('the Filling card says when it was last checked — never, on this database', /never/i.test(await fill.innerText().catch(() => '')));

  await fill.locator('[data-scale-run]').click();
  await page.waitForTimeout(1500);
  const overlay = page.locator('[data-quick-form="scale"]');
  t('tapping Run opens the Scale Verification form over the screen', await overlay.count() === 1);
  const ov = await overlay.innerText().catch(() => '');
  t('…already on Form 417-04, not the “which scale?” picker', /417-04/.test(ov) && !/417-01/.test(ov), ov.slice(0, 120).replace(/\n/g, ' '));
  t('the Operator View is still underneath it', await strip.count() === 1);

  const f = SCALE_FORMS.find(x => x.code === '417-04');
  const inputs = overlay.locator('input[type="number"]');
  t('the three weight boxes are on the form', await inputs.count() === 3, `${await inputs.count()}`);
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(String(f.points[i].nominal));
  await overlay.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1500);
  t('the check files and the form confirms it', /passed|logged by/i.test(await overlay.innerText().catch(() => '')));
  await page.locator('[data-quick-form-close]').click();
  await page.waitForTimeout(1500);
  const after = await page.locator('[data-scale-due-card]').count();
  t('closing the form, Filling has left the strip without a reload — the record is the completion', after === 2 && await fill.count() === 0, `${after} cards`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('nothing pans the page sideways at 390px', over <= 1, `${over}px over`);

  // The standalone floor route (/operator) is a different layout with its own
  // modal list, and had no quick-form overlay at all — a card there would have
  // done nothing when tapped.
  await page.goto(`${URL}/operator`);
  await page.waitForTimeout(3500);
  const standaloneCards = await page.locator('[data-scale-due-card]').count();
  t('the strip is on the standalone /operator route too', standaloneCards === 2, `${standaloneCards}`);
  await page.locator('[data-scale-due-card] [data-scale-run]').first().click();
  await page.waitForTimeout(1200);
  t('…and Run opens the form there as well — the overlay is one definition in every layout',
    await page.locator('[data-quick-form="scale"]').count() === 1);
  await page.locator('[data-quick-form-close]').click();
  await page.waitForTimeout(400);
  await page.goto(`${URL}/?tab=operator`);
  await page.waitForTimeout(2500);

  // Spanish: a prompt shown in one language reaches half the shift.
  await page.evaluate(() => localStorage.setItem('op_lang', 'es'));
  await page.reload(); await page.waitForTimeout(3000);
  t('the strip reads in Spanish when the phone is set to it', /báscula/i.test(await page.locator('[data-scale-due]').innerText().catch(() => '')));
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
