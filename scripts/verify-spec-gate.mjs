// The specification release gate (CAR 4990683-3, 21 CFR 111.70), live: a lot
// whose item lacks a specification covering identity, purity, strength,
// composition and contaminants — or whose identity rests on a look, smell and
// taste — is released CARRYING its gaps in warn mode and HELD in enforcing
// mode; every release door (roll-up, Mark Pass, bulk pass, signing the
// certificate) meets the same gate; approving the missing specifications and
// filing an identity result releases the lot; the strip, the bell and the
// readiness review read the same stamped columns. Caller sets PORT + DBPATH;
// needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4985; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sg-adm','Lowry Gate','Lowry Gate','admin','admin',1,'SC-GA',datetime('now','+7 day'),NULL)`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sg-qa','Maria Gate','Maria Gate','supervisor','qa',1,'SC-GQ',datetime('now','+7 day'),'{"coa":"edit"}')`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (name, id, pw, code) => { await call('POST', '/users/login', { name }); await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code }); return (await (await call('POST', '/users/login', { name, password: pw })).json()); };
const adm = await login('Lowry Gate', 'sg-adm', 'Admin2026!!', 'SC-GA');
const qa = await login('Maria Gate', 'sg-qa', 'Quality2026!', 'SC-GQ');
const A = adm.token, Q = qa.token;
t('an admin and Quality signed in', !!A && !!Q);
const sqlite = () => new Database(dbPath);
const row = (id) => sqlite().prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
const gapsOf = (r) => JSON.parse(r.release_gaps || 'null');
// A 1×1 PNG — the sign route wants a real data URL.
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const spec = (item, test, extra = {}) => call('POST', '/coa/specifications', { item_number: item, item_description: `Gate test ${item}`, test_type: test, ...extra }, Q);
const request = (item, lot) => call('POST', '/coa/requests', { item_number: item, item_description: `Gate test ${item}`, lot_number: lot, tests_requested: 'HM & Micro', date_sent: '2026-09-01' }, Q).then(r => r.json());
const results = (id, rows) => call('POST', `/coa/requests/${id}/results`, { results: rows }, Q);

console.log('\n── the gate opens in warn mode ──');
let g = await (await call('GET', '/coa/release-gate', null, Q)).json();
t('the gate reads WARN by default, with the three modes offered', g.mode === 'warn' && g.modes.join() === 'off,warn,on');
let r = await spec('GATE-A', 'Total Aerobic Plate Count', { max_value: 10000, unit: 'CFU/g' });
t('an item with only a micro specification files', r.status === 201);
const a1 = await request('GATE-A', 'L-A1');
r = await results(a1.id, [{ test_type: 'Total Aerobic Plate Count', result_value: '500' }]);
let a1r = row(a1.id);
t('every test passed, so the lot RELEASES in warn mode…', r.status === 201 && a1r.status === 'pass', `${r.status} ${a1r.status}`);
t('…carrying its gaps: four missing categories and identity never tested', Array.isArray(gapsOf(a1r)) && gapsOf(a1r).length === 5 && gapsOf(a1r).some(x => /identity/i.test(x)) && a1r.release_gate_mode === 'warn', JSON.stringify(gapsOf(a1r)));
g = await (await call('GET', '/coa/release-gate', null, Q)).json();
t('the gate counts the release and names the item\'s missing categories', g.released_with_gaps_count === 1 && g.coverage.find(c => c.item_number === 'GATE-A')?.missing.length === 4 && g.items_fully_covered < g.items_total);

console.log('\n── enforcing ──');
r = await call('PUT', '/coa/release-gate', { mode: 'on' }, Q);
t('Quality cannot move the mode — an admin decision, audited', r.status === 403);
r = await call('PUT', '/coa/release-gate', { mode: 'sideways' }, A);
t('an unknown mode is refused', r.status === 400);
r = await call('PUT', '/coa/release-gate', { mode: 'on' }, A);
t('the admin enforces the gate', r.status === 200 && (await r.json()).mode === 'on');
const a2 = await request('GATE-A', 'L-A2');
r = await results(a2.id, [{ test_type: 'Total Aerobic Plate Count', result_value: '300' }]);
let a2r = row(a2.id);
t('the same passing result now HOLDS the lot, with the gaps on the record', a2r.status === 'hold' && gapsOf(a2r).length === 5 && a2r.release_gate_mode === 'on', `${a2r.status}`);
r = await call('PUT', `/coa/requests/${a2.id}`, { status: 'pass' }, Q); let j = await r.json();
t('Mark Pass by hand meets the same gate', r.status === 400 && j.release_blocked && j.gaps.length === 5 && row(a2.id).status === 'hold');
r = await call('POST', `/coa/requests/${a2.id}/sign`, { signature: SIG }, Q); j = await r.json();
t('signing the certificate meets the same gate — no certificate number is issued', r.status === 400 && j.release_blocked && !row(a2.id).certificate_number);
r = await call('POST', '/coa/requests/bulk-update', { ids: [a2.id], patch: { status: 'pass' } }, Q); j = await r.json();
t('a bulk pass skips and NAMES the held lot rather than passing it in the batch', r.status === 200 && j.updated === 0 && j.blocked.length === 1 && j.blocked[0].lot_number === 'L-A2' && row(a2.id).status === 'hold');
g = await (await call('GET', '/coa/release-gate', null, Q)).json();
t('the gate lists the held lot', g.held_count === 1 && g.held[0].lot_number === 'L-A2');
let bell = await (await call('GET', '/compliance/notifications', null, Q)).json();
let items = bell.items || bell;
t('the bell carries the held lot and the release with gaps, from the same columns', JSON.stringify(items).includes('"coa-held"') && JSON.stringify(items).includes('"coa-gaps"'));

console.log('\n── approving the specifications releases the lot ──');
for (const [test, extra] of [['FTIR Identity', {}], ['Purity (HPLC)', { min_value: 98, unit: '%' }], ['Protein assay', { min_value: 80, unit: '%' }], ['Moisture', { max_value: 6, unit: '%' }]]) await spec('GATE-A', test, extra);
g = await (await call('GET', '/coa/release-gate', null, Q)).json();
t('GATE-A now covers all five categories', g.coverage.find(c => c.item_number === 'GATE-A')?.missing.length === 0);
r = await call('PUT', `/coa/requests/${a2.id}`, { status: 'pass' }, Q); j = await r.json();
t('the lot is STILL held: identity has a specification but no result on this lot', r.status === 400 && j.gaps.length === 1 && /identity/i.test(j.gaps[0]));
r = await results(a2.id, [{ test_type: 'Purity (HPLC)', result_value: '99.1' }, { test_type: 'Protein assay', result_value: '84' }, { test_type: 'Moisture', result_value: '4.2' }, { test_type: 'Organoleptic Test — Appearance', result_value: 'Conforms', pass_fail: 'pass' }]);
a2r = row(a2.id);
t('purity, strength, composition and an organoleptic pass do not release it — identity is still a look, smell and taste', a2r.status === 'hold' && gapsOf(a2r).length === 1 && /organoleptic/i.test(gapsOf(a2r)[0]), JSON.stringify(gapsOf(a2r)));
r = await results(a2.id, [{ test_type: 'FTIR Identity', result_value: 'Matches reference', pass_fail: 'pass' }]);
a2r = row(a2.id);
t('an identity result releases the lot with NO gaps recorded', a2r.status === 'pass' && a2r.release_gaps === null && a2r.release_gate_mode === 'on', `${a2r.status} ${a2r.release_gaps}`);
r = await call('POST', `/coa/requests/${a2.id}/sign`, { signature: SIG }, Q);
t('and the certificate signs', r.status === 200 && !!row(a2.id).certificate_number);
g = await (await call('GET', '/coa/release-gate', null, Q)).json();
t('nothing is held any more; the earlier warn-mode release still carries its gaps', g.held_count === 0 && g.released_with_gaps_count === 1);

console.log('\n── off records nothing ──');
await call('PUT', '/coa/release-gate', { mode: 'off' }, A);
const b1 = await request('GATE-B', 'L-B1');
await results(b1.id, [{ test_type: 'Salmonella', result_value: 'Absent in 25g', pass_fail: 'pass' }]);
const b1r = row(b1.id);
t('with the gate off an unspecified item releases and records no gaps, only the mode', b1r.status === 'pass' && b1r.release_gaps === null && b1r.release_gate_mode === 'off');
await call('PUT', '/coa/release-gate', { mode: 'warn' }, A);
{ const db = sqlite();
  const n = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_id = 'coa_release_gate' AND actor_id = 'sg-adm'").get().c;
  t('every mode change is audited to the admin who made it', n === 3, `${n}`);
  db.close(); }

console.log('\n── the review reads the same rows ──');
const rev = await (await call('GET', '/compliance/readiness-review', null, Q)).json();
const sec = rev.sections.find(s => s.title === 'Specifications & release');
t('the readiness review has the section, reading warn mode', !!sec && sec.items.some(i => /warn mode/.test(i.label)));
t('it counts the lot released carrying gaps and the items still short of a full specification', sec.items.some(i => /1 lot\(s\) released carrying specification gaps/.test(i.label)) && sec.items.some(i => /tested items have an approved specification/.test(i.label)));

console.log('\n── in the browser ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
page.on('dialog', d => d.accept());
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, adm.user]);
await page.goto(`${URL}/?tab=coa`);
await page.waitForSelector('[data-release-gate]', { timeout: 15000 });
t('the strip opens on the Lab Requests tab reading warn, with the API\'s counts', (await page.locator('[data-release-gate]').getAttribute('data-release-gate')) === 'warn'
  && (await page.locator('[data-gate-with-gaps]').getAttribute('data-gate-with-gaps')) === '1' && (await page.locator('[data-gate-held]').getAttribute('data-gate-held')) === '0');
await page.waitForSelector('[data-release-gaps]:visible', { timeout: 15000 });
t('the released-with-gaps lot wears its chip in the list', (await page.locator('[data-release-gaps]:visible').count()) >= 1);
await page.getByText('Details').click();
t('the details name the item still short of a specification', (await page.locator('[data-gate-item]').count()) >= 1 && !(await page.locator('[data-gate-item="GATE-A"]').count()));
await page.selectOption('[data-gate-mode]', 'on');
await page.waitForSelector('[data-release-gate="on"]', { timeout: 15000 });
t('the admin enforces the gate from the strip', true);
await page.selectOption('[data-gate-mode]', 'warn');
await page.waitForSelector('[data-release-gate="warn"]', { timeout: 15000 });
await page.locator('tr', { hasText: 'L-A1' }).first().locator('td').nth(1).click();
await page.waitForSelector('[data-detail-gaps]', { timeout: 15000 });
t('the record says what it went out under', /identity/i.test(await page.locator('[data-detail-gaps]').innerText()));
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
