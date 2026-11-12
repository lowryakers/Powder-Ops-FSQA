// QA Review names the scheduled runs with no end-of-day report (D-346).
//
// The Production Log banner and the ReadyBot chase carried them; QA Review did
// not, because it lists only records awaiting a signature and an unfiled report
// has no record. Maria asked for the notice so she can tell the supervisor —
// Filling, that day — to file. It is a NOTICE, not a pile: nothing to sign.
//
// Caller sets PORT + DBPATH (fresh database) and has built the client.
const PORT = process.env.PORT || 5216;
const B = `http://localhost:${PORT}/api`;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const crypto = await import('node:crypto');
const { default: Database } = await import('better-sqlite3');
const write = (fn) => { const db = new Database(process.env.DBPATH); try { return fn(db); } finally { db.close(); } };
const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };

const monday = (() => { const d = new Date(Date.now() - 21 * 86400000); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const dayOf = (off) => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };

write(db => {
  const add = db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), ?)`);
  add.run('qn-maria', 'Mara Quality', 'Mara Quality', 'supervisor', 'qa', hashOf('Mara-QA-2026'), '{"qa-review":"edit","production-log":"view"}');
  add.run('qn-fill', 'Fern Filling', 'Fern Filling', 'supervisor', 'filling', hashOf('Fern-F-2026'), '{"production-log":"edit"}');
  add.run('qn-floor', 'Olly Floor', 'Olly Floor', 'operator', 'filling', hashOf('Olly-F-2026'), '{"operator":"view"}');
  db.prepare('DELETE FROM production_schedule').run();
  db.prepare('DELETE FROM production_entries').run();
  const slot = db.prepare(`INSERT INTO production_schedule (id, week_start, day_of_week, room, room_type, team, mo_number, product_name, slot)
    VALUES (?,?,?,?,'production',?,?,'Alkify Stick',0)`);
  slot.run('qn-s1', monday, 0, '1', 'Filling', 'MO80001');
  slot.run('qn-s2', monday, 1, '2', 'Filling', 'MO80002');
  slot.run('qn-s3', monday, 2, '3', 'Kitting', 'MO80003');   // a team with no supervisor here
});

const login = async (name, password) => (await (await fetch(`${B}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
const get = async (p, tok) => { const r = await fetch(B + p, { headers: { Authorization: `Bearer ${tok}` } }); return { s: r.status, j: await r.json().catch(() => null) }; };

const M = await login('Mara Quality', 'Mara-QA-2026');
const O = await login('Olly Floor', 'Olly-F-2026');

console.log('\nQA Review carries the notice');
let r = await get('/qa-review', M);
const n = r.j?.missed_eod;
t('the payload carries missed_eod', r.s === 200 && !!n, JSON.stringify(r.j).slice(0, 200));
t('it counts the three runs with no report', n?.total === 3, JSON.stringify(n));
const fill = n?.teams?.find(x => x.team === 'Filling');
t('Filling: 2 runs, naming its supervisor', fill?.count === 2 && fill.supervisors.includes('Fern Filling'), JSON.stringify(fill));
t('… with the runs themselves (date, room, MO)', fill?.runs?.some(x => x.mo_number === 'MO80001' && x.date === dayOf(0) && x.room === '1'));
const kit = n?.teams?.find(x => x.team === 'Kitting');
t('a team with no supervisor says so (empty list, never a guess)', kit?.count === 1 && kit.supervisors.length === 0, JSON.stringify(kit));
t('it is not a signable source', !r.j.sources.some(s => /eod|end-of-day/i.test(s.key + s.label)));
t('… and adds nothing to the signature total', !r.j.sources.some(s => s.count > 0) ? r.j.total === 0 : true);
r = await get('/qa-review', O);
t('someone who is not a QA reviewer still gets 403', r.s === 403);

console.log('\nFiling the report clears it');
write(db => db.prepare(`INSERT INTO production_entries (id,date,team,room,product_name,mo_number,lot_number,start_time,end_time,quantity_completed,people_count,submitted_by)
  VALUES ('qn-e1', ?, 'Filling', '1', 'Alkify Stick', 'MO80001', 'L1', '06:00', '14:00', 100, 3, 'Fern Filling')`).run(dayOf(0)));
r = await get('/qa-review', M);
const fill2 = r.j?.missed_eod?.teams?.find(x => x.team === 'Filling');
t('Filling drops to 1 and the total to 2', r.j?.missed_eod?.total === 2 && fill2?.count === 1, JSON.stringify(r.j?.missed_eod));

console.log('\nOn the screen');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const me = (await get('/users/me', M)).j;
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [M, me]);
    await page.goto(`${URL}/?tab=qa-review`);
    const strip = page.locator('[data-missed-eod-notice]');
    await strip.waitFor({ timeout: 20000 }).catch(() => {});
    t(`${width}px: the notice is shown`, await strip.isVisible());
    const text = (await strip.textContent().catch(() => '')) || '';
    t(`${width}px: it says 2 runs and tells QA to ask Fern Filling`, /2 scheduled runs with no end-of-day report/.test(text) && /tell Fern Filling/.test(text), text.slice(0, 200));
    t(`${width}px: Kitting reads "no supervisor set up"`, /no supervisor set up/.test(text));
    await page.click('[data-missed-eod-toggle]');
    t(`${width}px: Show runs lists the MO`, /MO80002/.test((await strip.textContent()) || ''));
    const pans = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    t(`${width}px: no sideways pan`, !pans);
    await page.click('[data-missed-eod-open]');
    await page.waitForTimeout(1500);
    t(`${width}px: Production Log opens, and its banner gives the same count`, await page.getByText('2 scheduled production runs have no end-of-day report').first().isVisible().catch(() => false));
    await page.close();
  }
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
