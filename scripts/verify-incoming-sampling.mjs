// D-394 (A-20261124-003): incoming sampling is filed in ReadyDoc as the step
// after a signed receiving inspection, per SOP 402 V3, and signed by QA with
// the password.
//
// What this proves:
//   - sampling waits for the receiving sign-off (409), then opens pre-filled from the line;
//   - opening it twice is one record; it is tied to the inspection, the line and the lot;
//   - the container count comes from the CONTROLLED rule (√(N+1), up) — a code
//     change parks, and the rule is registered with controlled.js;
//   - every refusal: too few containers, a blank step, a "no" with no note, hold without
//     a reason, a dietary ingredient released with no passing identity test;
//   - QA signs with the password; the dock cannot; a token and a bot account cannot,
//     and no signature is stored;
//   - a signed record is closed; revoking needs a reason and the password;
//   - it is found by lot in Look up records; FORM 402 reads as ReadyDoc's;
//   - the screen: the "Sample" door on a signed inspection, the steps, the Sign button.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5252;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
const RL = JSON.stringify({ 'receiving-log': 'edit', coa: 'view' });
mkUser('is-a', 'Sample Admin', 'admin', 'admin', null);
mkUser('is-q', 'Sample QA', 'supervisor', 'qa', RL);
mkUser('is-w', 'Sample Dock', 'operator', 'warehouse', RL);
mkUser('is-bot', 'Sample Bot', 'supervisor', 'qa', RL);
// Two inspections: one signed, one not.
db.prepare(`INSERT INTO receiving_checklists (id, inspection_no, checklist_revision, inspection_date, vendor, reviewed_by, reviewed_at)
  VALUES ('is-cl1', 'A-100-0901', 'V2', date('now'), 'Glanbia', 'Sample Dock', datetime('now'))`).run();
db.prepare(`INSERT INTO receiving_checklists (id, inspection_no, checklist_revision, inspection_date, vendor) VALUES ('is-cl2', 'A-100-0902', 'V2', date('now'), 'Other Co')`).run();
db.prepare(`INSERT INTO receiving_log (id, inspection_no, po_number, part_number, part_description, vendor_lot, quantity_received, uom, date_received)
  VALUES ('is-l1', 'A-100-0901', 'PO00700', 'RM-WPI-90', 'Whey Protein Isolate 90', 'GL-5531', 40, 'BAG', date('now'))`).run();
db.prepare(`INSERT INTO receiving_log (id, inspection_no, part_number, part_description, vendor_lot) VALUES ('is-l2', 'A-100-0902', 'RM-X', 'Thing', 'X-1')`).run();
db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, receiving_log_id)
  VALUES ('is-coa', 'RM-WPI-90', 'Whey Protein Isolate 90', 'GL-5531', 'Identity (FTIR)', 'pending', 'is-l1')`).run();

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { headers: { ...H, Authorization: `Bearer ${r.body?.token}` }, token: r.body?.token, user: r.body?.user, pw };
};
const A = await login('is-a', 'Sample Admin', 'SampleAdmin2026!');
const Q = await login('is-q', 'Sample QA', 'SampleQa202666!');
const W = await login('is-w', 'Sample Dock', 'SampleDock2026!');
const BOT = await login('is-bot', 'Sample Bot', 'SampleBot20266!');
const BT = (await call('POST', '/api-tokens', { user_id: 'is-bot', label: 'fixture sampling bot', scopes: ['read', 'write'] }, A.headers)).body?.plaintext;
const TK = { ...H, Authorization: `Bearer ${BT}` };
t('signed in (QA, the dock, an admin) and a fixture bot token', !!Q.token && !!W.token && !!BT);

console.log('\n── after the receiving sign-off ──');
let r = await call('POST', '/receiving/sampling', { receiving_log_id: 'is-l2' }, W.headers);
t('a line on an unsigned inspection is refused (409 RECEIVING_NOT_SIGNED)', r.status === 409 && r.body?.code === 'RECEIVING_NOT_SIGNED');
r = await call('POST', '/receiving/sampling', { receiving_log_id: 'is-l1' }, W.headers);
const S = r.body;
t('the dock opens sampling for the signed line (201), pre-filled', r.status === 201 && /^SMP-\d{4}$/.test(S?.sampling_no || '')
  && S.inspection_no === 'A-100-0901' && S.part_number === 'RM-WPI-90' && S.vendor_lot === 'GL-5531' && S.vendor === 'Glanbia' && S.po_number === 'PO00700', JSON.stringify(S));
t('…stamped DRAFT-1 and SOP 402 V3', S?.form_revision === 'DRAFT-1' && S?.procedure === 'SOP 402 V3');
r = await call('POST', '/receiving/sampling', { receiving_log_id: 'is-l1' }, Q.headers);
t('opening it again is the same record', r.status === 200 && r.body?.id === S.id);

console.log('\n── the controlled rule ──');
const { readFileSync } = await import('fs');
const ctl = readFileSync(new globalThis.URL('../server/controlled.js', import.meta.url), 'utf8');
t('the container rule is registered with controlled.js', /samplingControlledEntry\(\)/.test(ctl));
t('…and on file as a controlled definition', !!db.prepare("SELECT 1 FROM controlled_definitions WHERE key = 'sampling:SOP 402'").get());
const { containersRequired } = await import('../shared/incoming-sampling.js');
t('√(N+1) rounded up: 40 → 7, 1 → 2 capped at 1, 3 → 2', containersRequired(40) === 7 && containersRequired(1) === 1 && containersRequired(3) === 2);
t('no hard-coded count in the sampling module', !/containers_required\s*[:=]\s*\d/.test(readFileSync(new globalThis.URL('../server/incoming-sampling.js', import.meta.url), 'utf8')));

console.log('\n── what stops a signature ──');
const put = (b, h = W.headers) => call('PUT', `/receiving/sampling/${S.id}`, b, h);
r = await put({ material_kind: 'dietary_ingredient', containers_received: 40, containers_sampled: 5, item_name: 'Whey Protein Isolate 90' });
t('the record says 7 containers are needed for 40', r.body?.containers_required === 7 && r.body.refusals.some(x => /at least 7/.test(x)), JSON.stringify(r.body?.refusals));
const allYes = { random_select: 'yes', gloves: 'yes', lid_wiped: 'yes', area_sanitized: 'yes', lid_protected: 'yes', scoop: 'yes', resealed: 'yes', sample_labelled: 'yes', sampled_label: 'no' };
r = await put({ containers_sampled: 7, steps: allYes, disposition: 'release' });
t('a "no" with no note is refused', r.body?.refusals?.some(x => /note/.test(x)));
t('…and a release with a "no" step is refused', r.body?.refusals?.some(x => /hold it/.test(x)));
r = await put({ steps: { sampled_label: 'yes' } });
t('a dietary ingredient released with no lab request linked is refused', r.body?.refusals?.some(x => /Link the lab request/.test(x)));
r = await put({ coa_request_id: 'is-coa' });
t('…linked but pending: still refused, naming the status', r.body?.refusals?.some(x => /reads "pending"/.test(x)), JSON.stringify(r.body?.refusals));
r = await call('POST', `/receiving/sampling/${S.id}/sign`, {}, Q.headers);
t('signing now is refused with the reasons (400), no password asked', r.status === 400 && r.body?.code === 'NOT_READY');
r = await put({ disposition: 'hold' });
t('hold with no reason is refused', r.body?.refusals?.some(x => /kept on hold/.test(x)));
db.prepare("UPDATE coa_requests SET status = 'pass' WHERE id = 'is-coa'").run();
r = await put({ disposition: 'release' });
t('the identity test passed: nothing stops it', r.body?.refusals?.length === 0, JSON.stringify(r.body?.refusals));

console.log('\n── who signs ──');
r = await call('POST', `/receiving/sampling/${S.id}/sign`, { signature_password: W.pw }, W.headers);
t('the dock cannot sign (403)', r.status === 403);
r = await call('POST', `/receiving/sampling/${S.id}/sign`, {}, TK);
t('a token cannot (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', `/receiving/sampling/${S.id}/sign`, { signature_password: BOT.pw }, BOT.headers);
t('a bot account signing in itself cannot (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
t('…no signature stored', !db.prepare('SELECT signed_at FROM incoming_samplings WHERE id = ?').get(S.id).signed_at);
r = await call('POST', `/receiving/sampling/${S.id}/sign`, {}, Q.headers);
t('QA without the password is asked for it (403 signature_required)', r.status === 403 && r.body?.signature_required === true);
r = await call('POST', `/receiving/sampling/${S.id}/sign`, { signature_password: Q.pw }, Q.headers);
const signed = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(S.id);
t('QA signs with the password: released, meaning and fingerprint stored', r.status === 200 && signed.signed_by === 'Sample QA' && signed.disposition === 'release'
  && signed.sign_meaning === 'Sampled the lot and recorded its disposition' && /^[0-9a-f]{64}$/.test(signed.sign_hash || ''), JSON.stringify(r.body)?.slice(0, 200));
t('…the rule and the count are frozen on it', JSON.parse(signed.rule || '{}').method === 'sqrt_n_plus_1' && signed.containers_required === 7);
r = await put({ notes: 'late change' }, Q.headers);
t('a signed record is closed (409)', r.status === 409);
r = await call('DELETE', `/receiving/sampling/${S.id}/sign`, { signature_password: Q.pw }, Q.headers);
t('revoking without a reason is refused (400)', r.status === 400);

console.log('\n── found again ──');
r = await call('GET', '/records?lot=GL-5531', undefined, Q.headers);
t('Look up records finds the sampling by its lot', r.body?.records?.some(x => x.type === 'incoming_sampling' && x.id === S.id && x.result === 'release'), JSON.stringify(r.body?.records?.map(x => x.type)));
const { FORM_REGISTRY } = await import('../shared/form-registry.js');
t('FORM 402 reads as ReadyDoc\'s; FORM 100-01 is untouched here', FORM_REGISTRY.find(f => f.code === 'FORM 402')?.where === 'readydoc'
  && FORM_REGISTRY.find(f => f.code === 'FORM 100-01')?.where === 'paper');

console.log('\n── on the screen ──');
db.prepare(`INSERT INTO receiving_log (id, inspection_no, part_number, part_description, vendor_lot) VALUES ('is-l3', 'A-100-0901', 'RM-CIT', 'Citric Acid', 'CA-77')`).run();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [W.token, W.user]);
  await page.goto(`${URL}/?tab=receiving-log&view=inspections&checklist=A-100-0901`);
  const door = page.locator('[data-sample-line="is-l3"]');
  await door.waitFor({ timeout: 20000 });
  t('the signed inspection offers "Sample" on its lines', true);
  await door.click();
  const drawer = page.locator('[data-sampling-drawer]');
  await drawer.locator('[data-sampling-step="gloves"]').waitFor({ timeout: 15000 });
  t('the sampling record opens with the SOP\'s steps', await drawer.locator('[data-sampling-step]').count() === 9);
  t('…DRAFT-1 is said on screen', /DRAFT-1/.test(await drawer.innerText()));
  t('…the dock is told QA signs (no Sign button)', await drawer.locator('[data-sampling-sign]').count() === 0);
  t('…and the new record is on file for the line', !!db.prepare("SELECT 1 FROM incoming_samplings WHERE receiving_log_id = 'is-l3'").get());
  t('no sideways scroll at 1280', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
} catch (e) { t('the screen rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
