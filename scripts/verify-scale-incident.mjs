// verify:scaleincident — D-194, live on a fresh database and a real browser.
//
// The caution and the product-control steps Daniela and Carol wrote for the
// SQF 11.2.3.4 corrective action, built into the app:
//  1. a scale reported dropped or damaged (app or kiosk) goes out of service,
//     tells QA, and opens a product disposition back to the last good check;
//  2. only QA returns it to use — with a password, an inspection note and a
//     passing check dated AFTER the incident; a failed calibration no longer
//     puts any instrument back in service;
//  3. "on hold" is not an answer: the finding stays open until released;
//  4. the decision carries lots, quantity and the evaluation result;
//  5. the daily check, the kiosk and the Operator View say the scale is out;
//  6. the caution prints on every calibration screen, naming the SOP the
//     registry holds (SOP 415 V2 here) rather than a number in code.
//
// Caller sets PORT + DBPATH (server up). Needs a built client. The control is
// `main`: there is no /calibration/incidents route.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5117);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
const mkUser = db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,?,?,datetime('now','+7 day'),?)`);
mkUser.run('si-admin', 'Sia Admin', 'Sia Admin', 'admin', 'office', 1, 'SC-sia', null);
mkUser.run('si-qa', 'Quinn Lead', 'Quinn Lead', 'supervisor', 'qa', 1, 'SC-siq', JSON.stringify({ calibration: 'edit', operator: 'view' }));
mkUser.run('si-op', 'Fill Operator', 'Fill Operator', 'operator', 'filling', 1, 'SC-sio', JSON.stringify({ calibration: 'edit', operator: 'view' }));
db.prepare(`INSERT OR REPLACE INTO calibration_instruments (id, name, type, asset_number, department, room, status, next_due)
  VALUES ('si-scale','Bench Scale','Scale','185','FILLING','6','active', date('now','+200 days'))`).run();
db.prepare(`INSERT OR REPLACE INTO calibration_instruments (id, name, type, asset_number, department, room, status, next_due)
  VALUES ('si-scale2','Floor Scale','Scale','186','FILLING','6','active', date('now','+200 days'))`).run();
// The last good calibration ten days back; a passing daily check two days back
// is LATER, so the window of doubt opens there.
db.prepare(`INSERT OR REPLACE INTO calibration_records (id, instrument_id, calibrated_by, calibrated_at, result)
  VALUES ('si-good','si-scale','Tech', datetime('now','-10 days'), 'pass')`).run();
db.prepare(`INSERT OR REPLACE INTO scale_verifications (id, instrument_id, form_code, form_title, performed_by, performed_at, readings, result)
  VALUES ('si-ver','si-scale','417-03','Scale Verification','Floor', datetime('now','-2 days'), '[]', 'pass')`).run();
const verAt = db.prepare("SELECT performed_at FROM scale_verifications WHERE id='si-ver'").get().performed_at;
// A run in the scale's room yesterday — "possibly affected".
db.prepare(`INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, submitted_by)
  VALUES ('si-run', date('now','-1 day'), 'Filling', '6', 'Blueberry Muffin', 'MO99001', '109001', '07:00', '15:00', 400, 3, 'Floor')`).run();
// The registry row the caution names. In this plant SOP 415 is Equipment Calibration.
db.prepare(`INSERT OR REPLACE INTO sop_documents (id, doc_number, title, category, revision, status)
  VALUES ('si-sop','SOP 415','Equipment Calibration','quality','V2','active')`).run();
db.close();

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name, code) => {
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: code });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const adm = await login('si-admin', 'Sia Admin', 'SC-sia');
const qa = await login('si-qa', 'Quinn Lead', 'SC-siq');
const op = await login('si-op', 'Fill Operator', 'SC-sio');
const A = (m, p, b) => c(m, p, b, adm?.token);
const Q = (m, p, b) => c(m, p, b, qa?.token);
const O = (m, p, b) => c(m, p, b, op?.token);
const QS = (m, p, b) => Q(m, p, b && { ...b, signature_password: 'Passw0rd!!' });
t('admin, QA lead and an operator sign in', !!(adm?.token && qa?.token && op?.token));
const bell = async (call, id) => ((await J(await call('GET', '/compliance/notifications')))?.items || []).find(i => i.id === id)?.count || 0;
const instStatus = (id) => { const d = new Database(process.env.DBPATH, { readonly: true }); const s = d.prepare('SELECT status FROM calibration_instruments WHERE id = ?').get(id)?.status; d.close(); return s; };

console.log('\n── the caution, from the registry ──');
let r = await O('GET', '/calibration/incidents');
let inc0 = await J(r);
t('GET /calibration/incidents answers', r.status === 200 && Array.isArray(inc0?.incidents), `${r.status}`);
t('the caution is Carol\'s wording, verbatim', /immediately stop using it, label it “OUT OF SERVICE,” and notify QA\/QC/.test(inc0?.caution?.text || ''));
t('…and names the SOP the REGISTRY holds — SOP 415 V2, Equipment Calibration', inc0?.caution?.document === 'SOP 415' && inc0?.caution?.revision === 'V2' && inc0?.caution?.document_source === 'register');
t('…with the five product-control steps', (inc0?.caution?.product_control || []).length === 5);
const forms = await J(await fetch(`${B}/submit/scale-forms`));
t('the public kiosk feed carries the caution and the scales it can name', forms?.caution?.document === 'SOP 415' && (forms?.scales || []).some(s => s.id === 'si-scale'));
const vforms = await J(await Q('GET', '/scale-verification/forms'));
t('the Scale Verification feed carries the caution too', vforms?.caution?.document === 'SOP 415');

console.log('\n── a scale is dropped ──');
r = await O('POST', '/calibration/incidents', { kind: 'dropped', instrument_id: 'si-scale', occurred_at: new Date(Date.now() + 3600e3).toISOString() });
t('a time in the future is refused', r.status === 400 && /future/i.test((await J(r))?.error || ''));
r = await O('POST', '/calibration/incidents', { kind: 'dropped', instrument_id: 'si-scale' });
t('a report without WHEN it happened is refused, saying why the time matters', r.status === 400 && /when it happened/i.test((await J(r))?.error || ''));
const occurred = new Date(Date.now() - 2 * 3600e3).toISOString();
r = await O('POST', '/calibration/incidents', { kind: 'dropped', instrument_id: 'si-scale', occurred_at: occurred, description: 'Knocked off the bench' });
const inc = await J(r);
t('the operator who saw it files it (201)', r.status === 201 && !!inc?.id, `${r.status} ${JSON.stringify(inc)?.slice(0, 160)}`);
t('…named as the reporter', inc?.reported_by === 'Fill Operator');
t('the scale goes OUT OF SERVICE on filing', instStatus('si-scale') === 'out_of_service');
t('a product disposition is owed', inc?.disposition_state === 'pending');
t('…with the window frozen at the last acceptable check (the daily check two days ago, not the calibration)', inc?.affected_since === verAt, `${inc?.affected_since} vs ${verAt}`);
t('the run in that room yesterday is listed as possibly affected', (inc?.possibly_affected || []).some(p => p.id === 'si-run'));
t('QA sees it on the bell', (await bell(Q, 'product-disposition')) >= 1);

r = await A('PUT', '/calibration/instruments/si-scale', { status: 'active' });
t('the instrument edit form cannot flip it back while the incident is open (409)', r.status === 409);
t('…and it is still out of service', instStatus('si-scale') === 'out_of_service');

console.log('\n── a failed calibration does not return anything to use ──');
r = await O('POST', '/calibration/records', { instrument_id: 'si-scale2', calibrated_by: 'Tech', result: 'fail' });
t('a failing calibration files', r.status === 201 || r.status === 200, `${r.status}`);
t('…and takes THAT instrument out of service (it used to set it active)', instStatus('si-scale2') === 'out_of_service');
r = await O('POST', '/calibration/records', { instrument_id: 'si-scale', calibrated_by: 'Tech', result: 'fail' });
t('a failing recalibration of the dropped scale leaves it out of service', instStatus('si-scale') === 'out_of_service');

console.log('\n── returning it to use ──');
r = await O('POST', `/calibration/incidents/${inc.id}/return`, { inspection: 'looks fine', signature_password: 'Passw0rd!!' });
t('an operator cannot return a scale to use (403)', r.status === 403);
r = await Q('POST', `/calibration/incidents/${inc.id}/return`, { inspection: 'No cracks, feet level' });
t('QA without the password is asked for it (403 signature_required, never 401)', r.status === 403 && (await J(r))?.signature_required === true);
r = await Q('POST', `/calibration/incidents/${inc.id}/return`, { inspection: 'No cracks, feet level', signature_password: 'Passw0rd!!' });
let body = await J(r);
t('with the password but no passing check since the incident, refused naming it', r.status === 409 && /No passing calibration or verification/i.test(body?.error || ''), JSON.stringify(body));
r = await O('POST', '/calibration/records', { instrument_id: 'si-scale', calibrated_by: 'Tech', result: 'adjusted_pass' });
t('the scale is recalibrated and passes', r.status === 201 || r.status === 200);
t('…and a passing calibration does NOT return it to use by itself', instStatus('si-scale') === 'out_of_service');
r = await Q('POST', `/calibration/incidents/${inc.id}/return`, { inspection: '', signature_password: 'Passw0rd!!' });
t('a return without an inspection note is refused', r.status === 409 && /inspection/i.test((await J(r))?.error || ''));
r = await Q('POST', `/calibration/incidents/${inc.id}/return`, { inspection: 'No cracks, feet level, display steady', signature_password: 'Passw0rd!!' });
body = await J(r);
t('QA authorizes the return: inspection + passing check + password', r.status === 200 && body?.status === 'closed' && body?.returned_by === 'Quinn Lead', JSON.stringify(body)?.slice(0, 200));
t('…and the scale is active again', instStatus('si-scale') === 'active');
t('…the disposition is still owed — returning the scale is not deciding the product', body?.disposition_state === 'pending');
r = await Q('POST', `/calibration/incidents/${inc.id}/return`, { inspection: 'again', signature_password: 'Passw0rd!!' });
t('a second return is refused (409)', r.status === 409);

console.log('\n── the product: hold, then release ──');
r = await Q('POST', `/calibration/dispositions/incident/${inc.id}`, { disposition: 'on_hold', notes: 'Held MO99001', ref: 'OH-77' });
t('placing product on hold needs the affected lots', r.status === 400 && /lots/i.test((await J(r))?.error || ''));
t('D-195: an incomplete decision is refused BEFORE any password is asked (400, not 403)', r.status === 400);
const holdBody = { disposition: 'on_hold', notes: 'Held MO99001', ref: 'OH-77', lots: '109001', quantity: '400 units' };
r = await Q('POST', `/calibration/dispositions/incident/${inc.id}`, holdBody);
body = await J(r);
t('D-195: a complete decision with no password is asked for one (403 signature_required, never 401)', r.status === 403 && body?.signature_required === true);
r = await Q('POST', `/calibration/dispositions/incident/${inc.id}`, { ...holdBody, signature_password: 'wrong-password' });
t('D-195: a wrong password is refused', r.status === 403 && (await J(r))?.signature_required === true);
t('…and neither refusal wrote anything — the finding still owes a decision',
  (await J(await Q('GET', '/calibration/dispositions'))).pending.some(x => x.id === inc.id));
r = await QS('POST', `/calibration/dispositions/incident/${inc.id}`, holdBody);
body = await J(r);
t('QA places it on hold; the finding stays OPEN as held', r.status === 200 && body?.disposition_state === 'held' && body?.disposition_lots === '109001');
t('the bell shows product on hold', (await bell(Q, 'product-held')) >= 1);
r = await O('POST', `/calibration/dispositions/incident/${inc.id}`, { disposition: 'retested_released', notes: 'x', lots: '109001', evaluation: 'ok' });
t('an operator cannot release product (403)', r.status === 403);
r = await Q('POST', `/calibration/dispositions/incident/${inc.id}`, { disposition: 'retested_released', notes: 'Reweighed', lots: '109001' });
t('a release without the evaluation result is refused', r.status === 400 && /evaluation/i.test((await J(r))?.error || ''));
r = await QS('POST', `/calibration/dispositions/incident/${inc.id}`, { disposition: 'retested_released', notes: 'Reweighed and released',
  lots: '109001', quantity: '400 units', evaluation: 'Reweighed 50 units on verified scale #186: all within label claim' });
body = await J(r);
t('QA releases it; the finding closes with the hold kept in its history', r.status === 200 && body?.disposition_state === 'recorded'
  && body?.disposition_history?.[0]?.disposition === 'on_hold', JSON.stringify(body)?.slice(0, 200));
let open = await J(await Q('GET', '/calibration/dispositions'));
t('…and it is on neither open list', !open.pending.some(x => x.id === inc.id) && !open.held.some(x => x.id === inc.id));
const d2 = new Database(process.env.DBPATH, { readonly: true });
const acts = d2.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid").all(inc.id).map(x => x.action);
d2.close();
t('the audit trail holds the report, the return, the hold and the release',
  ['create', 'returned_to_use', 'product_disposition', 'hold_released'].every(a => acts.includes(a)), JSON.stringify(acts));
const d3 = new Database(process.env.DBPATH, { readonly: true });
const decided = d3.prepare("SELECT details FROM audit_log WHERE entity_id = ? AND action IN ('product_disposition','hold_released')").all(inc.id);
const leaked = d3.prepare("SELECT COUNT(*) n FROM audit_log WHERE details LIKE '%Passw0rd!!%' OR details LIKE '%wrong-password%'").get().n;
d3.close();
t('D-195: both decisions are recorded as signed with a password', decided.length === 2 && decided.every(x => /"signature_verified":true/.test(x.details || '')), JSON.stringify(decided));
t('D-195: the password itself is never written to the audit log', leaked === 0);

console.log('\n── from the kiosk ──');
r = await fetch(`${B}/submit/scale-incident`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind: 'impact', scale_label: 'small scale by the sealer', reported_by: 'Kiosk Person', occurred_at: new Date(Date.now() - 600e3).toISOString() }) });
body = await J(r);
t('the kiosk files a report with no account (201)', r.status === 201 && body?.ok && !!body?.incident?.id, `${r.status}`);
t('…and hands back nothing but the confirmation', body && Object.keys(body.incident).sort().join() === 'id,occurred_at,scale_label');
const kioskId = body?.incident?.id;
inc0 = await J(await Q('GET', '/calibration/incidents'));
t('QA sees the kiosk report, unlinked', inc0.incidents.some(i => i.id === kioskId && !i.instrument_id && i.source === 'kiosk'));
r = await Q('POST', `/calibration/incidents/${kioskId}/return`, { inspection: 'ok', signature_password: 'Passw0rd!!' });
t('it cannot be returned before it names a scale', r.status === 400);
r = await O('POST', `/calibration/incidents/${kioskId}/link`, { instrument_id: 'si-scale' });
t('an operator cannot link it (403)', r.status === 403);
r = await Q('POST', `/calibration/incidents/${kioskId}/link`, { instrument_id: 'si-scale' });
body = await J(r);
t('QA links it to the scale, which goes out of service', r.status === 200 && body?.instrument_id === 'si-scale' && instStatus('si-scale') === 'out_of_service');
t('…and its window is set from that scale\'s own history', !!body?.affected_since);

console.log('\n── the daily check says so ──');
const oc = await J(await O('GET', '/pm/operator-checks'));
t('the Operator View feed names the out-of-service scale', (oc?.out_of_service || []).some(s => s.id === 'si-scale' && s.incident_label === 'Hit or knocked'), JSON.stringify(oc?.out_of_service));
const kf = await J(await fetch(`${B}/submit/scale-forms`));
t('…and so does the kiosk feed', (kf?.out_of_service || []).some(s => s.id === 'si-scale'));

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qa.token, qa.user]);
  await page.goto(`${URL}/?tab=calibration`);
  await page.waitForSelector('[data-open-incidents]', { timeout: 15000 }).catch(() => {});
  t('Calibration Management lists the open dropped-scale report', await page.locator(`[data-incident="${kioskId}"]`).count() === 1);
  t('…with the return-to-use control for QA', await page.locator('[data-return-to-use]').count() >= 1);
  await page.click('[data-incident-open-form]');
  await page.waitForSelector('[data-incident-form]', { timeout: 5000 }).catch(() => {});
  t('"Report a dropped scale" opens the form, with the caution on it', await page.locator('[data-incident-form] [data-scale-caution]').count() === 1);
  const cautionText = await page.locator('[data-incident-form] [data-scale-caution]').innerText().catch(() => '');
  t('…naming SOP 415 V2', /SOP 415 V2/.test(cautionText), cautionText.slice(0, 120));
  await page.selectOption('[data-incident-form] select#incident-scale', 'si-scale2').catch(() => {});
  await page.fill('#incident-when', new Date(Date.now() - 30 * 60e3 - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16));
  await page.click('[data-incident-submit]');
  await page.waitForTimeout(1500);
  const n = await page.locator('[data-incident]').count();
  t('filing from the screen adds it to the list', n >= 2, `${n}`);

  await page.goto(`${URL}/?tab=calibration&view=instruments`);
  await page.waitForTimeout(1500);
  await page.locator('button:visible', { hasText: 'Calibrate' }).first().click();
  await page.waitForTimeout(400);
  t('the Record Calibration form carries the caution', await page.locator('form [data-scale-caution]').count() === 1);

  await page.goto(`${URL}/?tab=calibration&view=scale-verification`);
  await page.waitForTimeout(1500);
  t('the Scale Verification tab warns the scale is out of service', await page.locator('[data-out-of-service]').count() >= 1);

  const kiosk = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await kiosk.goto(`${URL}/kiosk/scale`);
  await kiosk.waitForTimeout(2000);
  t('the scale kiosk warns which scales are out of service', await kiosk.locator('[data-out-of-service-scale]').count() >= 1);
  t('…and offers "report a dropped scale"', await kiosk.locator('[data-kiosk-report-incident]').count() >= 1);
  const kw = await kiosk.evaluate(() => document.documentElement.scrollWidth);
  t('no sideways scroll on the kiosk at 390px', kw <= 390, `${kw}px`);

  const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await phone.goto(`${URL}/manifest.webmanifest`);
  await phone.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [op.token, op.user]);
  await phone.goto(`${URL}/?tab=operator`);
  await phone.waitForTimeout(2500);
  t('the Operator View on a phone says the scale is out of service', await phone.locator('[data-out-of-service]').count() >= 1);
  await phone.goto(`${URL}/?tab=calibration`);
  await phone.waitForTimeout(1500);
  const pw = await phone.evaluate(() => document.documentElement.scrollWidth);
  t('no sideways scroll on Calibration at 390px', pw <= 390, `${pw}px`);
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
