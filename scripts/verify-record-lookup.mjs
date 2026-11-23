// D-375 (single-spine move 04): "Look up records" — everything about one lot,
// one machine or one person on one screen, backed by GET /api/records.
//
// What this proves:
//   - a LOT finds the production entry, the on-hold record and the receiving
//     inspection carrying it, and nothing on another lot;
//   - a MACHINE finds its cleans, the scale checks and calibrations of the
//     instruments linked to it, and the training whose course is about it —
//     and nothing on another machine;
//   - a PERSON finds what they did and what they signed, and nobody else's;
//   - every record type that CANNOT take the filter is named under
//     `not_searched` with why, and only types the person may read are named;
//   - somebody who can open only Training is answered from Training alone, gets
//     no machine list, and a record from another module is a 404;
//   - the sidebar's module list is exactly the modules behind the record types;
//   - in a browser at 1280 and 390: the screen is in the sidebar, a lot lookup
//     lists the records and names what was not searched, and the page does not
//     pan sideways.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5240;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('lk-a', 'Look Admin', 'admin', 'quality', null);
mkUser('lk-t', 'Look Trainer', 'operator', 'warehouse', JSON.stringify({ training: 'view' }));

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const res = (await call('POST', '/users/login', { name, password: pw })).body;
  return { headers: { ...H, Authorization: `Bearer ${res?.token}` }, token: res?.token, user: res?.user };
};
const ADM = await login('lk-a', 'Look Admin', 'LookAdmin2026!');
const TRN = await login('lk-t', 'Look Trainer', 'LookTrainer2026!');
const A = ADM.headers, T = TRN.headers;

console.log('── seeding: one lot, two machines, one person ──');
const LOT = 'LK-LOT-7701', OTHER = 'LK-LOT-9999', P = 'Pat Lookup';
const prod = db.prepare(`INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, start_time, end_time,
  quantity_completed, people_count, submitted_by) VALUES (?, '2026-11-02', 'Batching', 'Batching 1', 'Lookup Blend', ?, ?, '06:00', '14:00', 100, 3, ?)`);
prod.run('lk-p1', 'MO-LK-1', LOT, 'Bernardo Look');
prod.run('lk-p2', 'MO-LK-2', OTHER, 'Bernardo Look');
db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, approvals, created_by)
  VALUES ('lk-oh', 'on_hold', 'OH-LK-1', '2026-11-03', 'open', ?, '{}', 'Maria Look')`).run(JSON.stringify({ lot: LOT, product: 'Lookup Blend', reason: 'Recall drill' }));
db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, approvals, created_by)
  VALUES ('lk-dev', 'deviation', 'DEV-LK-1', '2026-11-03', 'open', ?, '{}', 'Maria Look')`).run(JSON.stringify({ lot: OTHER }));
let r = await call('POST', '/receiving/checklist', { vendor: 'Lookup Vendor' }, A);
const RNO = r.body?.inspection_no;
db.prepare(`INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, part_description, vendor_lot, quantity_received, uom, received_by)
  VALUES ('lk-rl', ?, '2026-11-01', 'PO-LK', 'RM-LK', 'Lookup whey', ?, 10, 'kg', 'Dock Look')`).run(RNO, LOT);

const E = 'lk-eq-1', E2 = 'lk-eq-2';
const eq = db.prepare(`INSERT INTO equipment (id, name, type, status) VALUES (?, ?, 'Blender', 'active')`);
eq.run(E, 'Lookup Blender'); eq.run(E2, 'Other Blender');
const san = db.prepare(`INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, result, equipment_id, verified_by, verified_at)
  VALUES (?, 'Batching 1', 'pre_op', ?, ?, 'pass', ?, ?, ?)`);
san.run('lk-s1', 'Zuleika Look', '2026-11-04 08:00:00', E, P, '2026-11-04 09:00:00');
san.run('lk-s2', 'Zuleika Look', '2026-11-04 10:00:00', E2, null, null);
db.prepare(`INSERT INTO calibration_instruments (id, name, type, equipment_id, status) VALUES ('lk-inst', 'Lookup Blender load cell', 'scale', ?, 'active')`).run(E);
db.prepare(`INSERT INTO scale_verifications (id, form_code, form_title, instrument_id, performed_by, performed_at, readings, result)
  VALUES ('lk-sv', '417-01', 'Batching Platform', 'lk-inst', 'Bernardo Look', '2026-11-05 07:00:00', '[]', 'pass')`).run();
db.prepare(`INSERT INTO calibration_records (id, instrument_id, calibrated_by, calibrated_at, result) VALUES ('lk-cal', 'lk-inst', 'Cal Look', '2026-11-06 07:00:00', 'pass')`).run();
db.prepare(`INSERT INTO training_courses (id, code, title, equipment_id) VALUES ('lk-course', 'WI-LK', 'Running the Lookup Blender', ?)`).run(E);
db.prepare(`INSERT INTO training_records (id, employee_name, training_topic, training_date, status, course_id) VALUES ('lk-tr', ?, 'Lookup Blender', '2026-11-07', 'completed', 'lk-course')`).run(P);
db.prepare(`INSERT INTO training_records (id, employee_name, training_topic, training_date, status) VALUES ('lk-tr2', 'Someone Else', 'GMP', '2026-11-07', 'completed')`).run();

const ids = (b) => new Set((b?.records || []).map(x => `${x.type}:${x.id}`));
const has = (s, k) => s.has(k);

console.log('\n── a lot ──');
r = await call('GET', `/records?lot=${LOT}`, undefined, A);
let s = ids(r.body);
t('the production entry on the lot', has(s, 'production:lk-p1'), [...s].join(' '));
t('the on-hold record naming the lot (a QMS form carries it in its data)', has(s, 'qms:lk-oh'));
t('the receiving inspection the lot arrived on', [...s].some(k => k.startsWith('receiving:')));
t('nothing on another lot', !has(s, 'production:lk-p2') && !has(s, 'qms:lk-dev'));
t('exactly those three', s.size === 3, [...s].join(' '));
t('the described QMS record names its lot', r.body?.records?.find(x => x.id === 'lk-oh')?.lots?.includes(LOT));
const ns = Object.fromEntries((r.body?.not_searched || []).map(n => [n.type, n]));
t('types that carry no lot are named, with why', !!ns.sanitation && !!ns.training && !!ns.scale && /lot/.test(ns.sanitation.why), JSON.stringify(r.body?.not_searched));
t('a type that does carry a lot is not in that list', !ns.production && !ns.qms && !ns.receiving && !ns.disposal && !ns.coa);
t('a lookup is uncapped', r.body?.capped === false);

console.log('\n── a machine ──');
r = await call('GET', `/records?equipment=${E}`, undefined, A);
s = ids(r.body);
t('its clean', has(s, 'sanitation:lk-s1'), [...s].join(' '));
t('the scale check on the instrument linked to it', has(s, 'scale:lk-sv'));
t('the calibration of that instrument', has(s, 'calibration:lk-cal'));
t('the training whose course is about it', has(s, 'training:lk-tr'));
t('nothing on the other machine', !has(s, 'sanitation:lk-s2'));
t('exactly those four', s.size === 4, [...s].join(' '));
t('types that name no machine are listed as not searched', (r.body?.not_searched || []).some(n => n.type === 'production' && /machine/.test(n.why)));
r = await call('GET', '/records?equipment=lk-inst&type=scale', undefined, A);
t('an instrument id still finds its own scale checks', ids(r.body).has('scale:lk-sv'));
r = await call('GET', '/records/machines', undefined, A);
t('the machine list names the equipment', (r.body || []).some(m => m.id === E && m.kind === 'equipment'));
t('…and not an instrument already owned by a machine', !(r.body || []).some(m => m.id === 'lk-inst'));

console.log('\n── a person ──');
r = await call('GET', `/records?person=${encodeURIComponent(P)}`, undefined, A);
s = ids(r.body);
t('the clean they signed', has(s, 'sanitation:lk-s1'), [...s].join(' '));
t('their training', has(s, 'training:lk-tr'));
t('nobody else\'s training, and nothing they had no hand in', !has(s, 'training:lk-tr2') && !has(s, 'sanitation:lk-s2') && !has(s, 'production:lk-p1'));
t('every type takes a person, so nothing is listed as not searched', (r.body?.not_searched || []).length === 0, JSON.stringify(r.body?.not_searched));

console.log('\n── who can see what ──');
r = await call('GET', `/records?equipment=${E}`, undefined, T);
s = ids(r.body);
t('someone with only Training gets only training', [...s].every(k => k.startsWith('training:')) && has(s, 'training:lk-tr'), [...s].join(' '));
t('…and is told nothing about types they cannot read', (r.body?.not_searched || []).length === 0, JSON.stringify(r.body?.not_searched));
r = await call('GET', `/records?lot=${LOT}`, undefined, T);
t('a lot lookup tells them only that training carries no lot', JSON.stringify((r.body?.not_searched || []).map(n => n.type)) === '["training"]' && (r.body?.records || []).length === 0, JSON.stringify(r.body));
r = await call('GET', '/records/sanitation/lk-s1', undefined, T);
t('a record from another module is a 404, not a 403', r.status === 404);
mkUser('lk-p', 'Look Producer', 'operator', 'batching', JSON.stringify({ 'production-log': 'view' }));
const PRD = await login('lk-p', 'Look Producer', 'LookProducer2026!');
r = await call('GET', '/records/machines', undefined, PRD.headers);
t('no machine list for someone who can read nothing found by machine', Array.isArray(r.body) && r.body.length === 0);

console.log('\n── the sidebar\'s list ──');
const { RECORD_TYPES } = await import('../server/record-interface.js');
const { RECORD_MODULES } = await import('../shared/record-modules.js');
const union = [...new Set(RECORD_TYPES.flatMap(rt => rt.modules))].sort();
t('RECORD_MODULES is exactly the modules behind the record types', JSON.stringify([...RECORD_MODULES].sort()) === JSON.stringify(union), `${union.join()} vs ${[...RECORD_MODULES].sort().join()}`);

console.log('\n── in a browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true]]) {
    const pg = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await pg.goto(`${URL}/manifest.webmanifest`);
    await pg.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [ADM.token, ADM.user]);
    await pg.goto(`${URL}/?tab=records`);
    await pg.waitForSelector('[data-record-lookup]', { timeout: 15000 });
    t(`${w}px: the screen opens from ?tab=records`, true);
    if (!mobile) t(`${w}px: "Look up records" is in the sidebar`, await pg.locator('nav >> text=Look up records').count() > 0 || await pg.locator('text=Look up records').count() > 1);
    await pg.click('[data-lookup-run]');
    t(`${w}px: an empty lookup asks for something to look up`, /lot, a machine, a person/.test(await pg.locator('[data-lookup-hint]').innerText()));
    await pg.fill('[data-lookup-lot]', LOT);
    await pg.click('[data-lookup-run]');
    await pg.waitForSelector('[data-lookup-results]', { timeout: 15000 });
    t(`${w}px: three records for the lot`, (await pg.locator('[data-lookup-total]').innerText()).trim() === '3');
    const listed = mobile ? await pg.locator('[data-lookup-card]').count() : await pg.locator('[data-lookup-row]').count();
    t(`${w}px: three rows listed`, listed === 3, String(listed));
    t(`${w}px: what was not searched is named`, await pg.locator('[data-not-searched="sanitation"]').count() === 1);
    if (mobile) await pg.locator('[data-lookup-card]').first().locator('button').first().click();
    else await pg.locator('[data-lookup-row]').first().click();
    t(`${w}px: a row opens to its detail, with Print`, await pg.locator('[data-lookup-detail] [data-print-record]').count() >= 1);
    const pans = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    t(`${w}px: the page does not pan sideways`, !pans);
    await pg.close();
  }
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
