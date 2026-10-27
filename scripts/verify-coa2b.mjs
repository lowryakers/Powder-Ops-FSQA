#!/usr/bin/env node
// verify:coa2b — COA Phase 2B (D-246 … D-249), live on a temporary database,
// plus a real browser.
//
//  1. The lot rule: a lot is released only when every batch is signed with
//     every required test of its approved plan, all passing.
//  2. The doors: certificate signing and production QA sign-off. Warn records
//     what strict would do and stops nothing; strict refuses; off records
//     nothing. Moving the mode needs an admin, a reason and the password.
//  3. Overrides open the production door only. Would-blocks are reviewed.
//     The readiness report and the golden-file record.
//  4. Publishing: admin only, every check in words, every batch at once, a
//     snapshot that can never be rewritten or deleted; withdraw, supersede,
//     and un-signing refused while published.
//  5. The public page: the same 404 for everything until both switches are
//     on; no lab, no report number, no person, no cookie, noindex.
//  6. The browser: Release & publishing, the lot, the checklist, the preview.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { readPdfColumns } from '../server/coa-pdf-text.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COA2B_PORT || 4623);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coa2b-'));
const dbPath = path.join(dir, 'coa2b.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = new Database(dbPath); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const run = (sql, ...a) => { const d = new Database(dbPath); try { return d.prepare(sql).run(...a); } finally { d.close(); } };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const golden = (n) => readFileSync(path.join(root, 'scripts/fixtures/coa/golden', `${n}.pdf`));
const FORBIDDEN = /CTLA|190001|accredit|\bISO\b|Quinn|FG0971|Admin|coa-files|ctla-/i;

const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', HOUSEKEEPING_MS: '999999999' }, stdio: ['ignore', 'pipe', 'pipe'] });
const out = []; child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

try {
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
  if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

  const db = new Database(dbPath);
  const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
  const admin = db.prepare("SELECT name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get().name;
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-Coa2b-2026'), admin);
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('c2b-qa', 'Quinn Lot', 'Quinn Lot', 'supervisor', 'qa', 1, ?, datetime('now'), '{"coa":"edit","production-log":"edit"}')`).run(hashOf('Quality-Coa2b-2026'));
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('c2b-op', 'Oscar Lot', 'Oscar Lot', 'operator', 'warehouse', 1, ?, datetime('now'), '{"coa":"edit","production-log":"edit"}')`).run(hashOf('Operator-Coa2b-2026'));
  const initialGate = db.prepare("SELECT value v FROM app_settings WHERE key = 'coa_release_gate'").get()?.v ?? null;
  db.close();
  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(admin, 'Admin-Coa2b-2026');
  const Q = await login('Quinn Lot', 'Quality-Coa2b-2026');
  const O = await login('Oscar Lot', 'Operator-Coa2b-2026');
  const QPW = { signature_password: 'Quality-Coa2b-2026' };
  const APW = { signature_password: 'Admin-Coa2b-2026' };
  const call = async (m, p, b, tok = Q) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { s: r.status, j: ct.includes('json') ? await r.json() : await r.text() };
  };
  const pub = async (p) => { const r = await fetch(`${ORIGIN}/tested${p}`); const buf = Buffer.from(await r.arrayBuffer()); return { s: r.status, h: r.headers, body: buf.toString('utf8'), buf }; };
  const upload = async (p, buf, name, fields = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(BASE + p, { method: 'POST', headers: { Authorization: `Bearer ${Q}` }, body: fd });
    return { s: r.status, j: await r.json() };
  };
  const scanFile = async (reqId, fileId) => {
    const fd = new FormData(); fd.append('file_id', fileId);
    const x = await fetch(`${BASE}/coa/requests/${reqId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${Q}` }, body: fd });
    return { s: x.status, j: await x.json() };
  };
  const req = async (item, lot, desc = `Phase 2B ${item}`) => (await call('POST', '/coa/requests', { item_number: item, item_description: desc, lot_number: lot, tests_requested: 'HM & Micro', date_sent: '2026-10-01' })).j;
  // A batch with the whole standard panel read from the lab report.
  const batch = async (item, lot) => {
    const r0 = await req(item, lot);
    await call('PUT', `/coa/requests/${r0.id}/brand-owner`, { brand_owner: 'ProDough' });
    const f = (await upload(`/coa/requests/${r0.id}/files`, golden('synthetic-01-standard-panel'), `lab-${lot}.pdf`, { file_type: 'lab_results' })).j;
    const scan = (await scanFile(r0.id, f.id)).j;
    const res = await call('POST', `/coa/requests/${r0.id}/results`, { source_file_id: f.id,
      results: scan.results.map(x => ({ test_type: x.test_type, result_value: x.result_value, unit: x.unit, mdl: x.mdl, method: x.method, stated_pass_fail: x.stated || undefined })) });
    return { ...r0, file: f, filed: res };
  };
  const sign = (id, extra = QPW) => call('POST', `/coa/requests/${id}/sign`, { signature: SIG, ...extra });
  const entry = (product, lot) => {
    const id = crypto.randomUUID();
    run(`INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, submitted_by)
      VALUES (?, '2026-10-20', 'Batching', 'Batching 1', ?, ?, ?, '06:00', '10:00', 500, 3, 'Oscar Lot')`, id, product, `MO${Math.floor(Math.random() * 90000) + 10000}`, lot);
    return id;
  };
  const signOff = (id) => call('PUT', `/production/entries/${id}/qa-signoff`, { qa_signoff_by: 'Quinn Lot', ...QPW });
  const events = () => all('SELECT * FROM coa_gate_events ORDER BY at, rowid');
  t('admin, Quality and an operator signed in', !!A && !!Q && !!O);
  t('the gate starts on WARN (nothing set) and the public switches are closed', initialGate === null
    && one("SELECT value v FROM coa_settings WHERE key = 'public_coa_enabled'")?.v === 'off'
    && one("SELECT public_publish_allowed p FROM coa_brands WHERE name = 'ProDough'")?.p === 0);

  // ── 1. A plan, a product, a lot ───────────────────────────────────────────
  console.log('\n── the plan, the product and its lot');
  let r = await call('GET', '/coa/plans');
  const pd = r.j.plans.find(p => p.name === 'ProDough standard panel');
  const micro = (n, max) => ({ test_type: n, evaluation: 'limit', comparator: '<=', max_value: max, unit: 'cfu/g' });
  const metal = (n) => ({ test_type: n, evaluation: 'limit', comparator: '<=', max_value: 0.5, unit: 'ppm' });
  r = await call('PUT', `/coa/plans/${pd.id}`, { tests: [
    micro('Total Aerobic Microbial Count (USP)', 10000), micro('Total Coliforms (BAM) (MOD)', 100), { test_type: 'E.Coli BAM (MOD)', evaluation: 'limit', comparator: 'absent' },
    { test_type: 'Salmonella', evaluation: 'limit', comparator: 'absent' }, micro('Staphylococcus aureus', 100), micro('Yeast & Mold', 1000),
    metal('Arsenic'), metal('Cadmium'), metal('Mercury'), metal('Lead'),
    { test_type: 'Gluten Allergen', evaluation: 'limit', comparator: '<', max_value: 20, unit: 'ppm', specification: 'Internal limit < 20 ppm' },
  ] });
  t('Quality fills in every limit', r.s === 200 && r.j.missing.length === 0, JSON.stringify(r.j.missing || r.j));
  const gfPlan = (await call('GET', '/coa/plans')).j.plans.find(p => p.name === 'Gluten-free claim');
  r = await call('PUT', `/coa/plans/${gfPlan.id}`, { tests: [...gfPlan.tests, { test_type: 'Moisture', evaluation: 'report_only', public: true }] });
  t('a reported-only test can be ticked "show publicly", and the tick is kept', r.s === 200 && r.j.tests.find(x => x.test_type === 'Moisture')?.public === 1);
  r = await call('POST', `/coa/plans/${pd.id}/approve`, QPW);
  t('… and approves it', r.s === 200 && r.j.status === 'approved');
  const b1 = await batch('FG0971', '102000-1');
  const b2 = await batch('FG0971', '102000-2');
  t('two batches of lot 102000 file every result from their lab reports', b1.filed.s === 201 && b2.filed.s === 201, JSON.stringify(b1.filed.j).slice(0, 200));
  r = await call('PUT', '/coa/products/FG0971', { display_name: 'Gluten Free Flour', slug: 'gluten-free-flour', brand_owner: 'ProDough', gf_claim: true, aliases: 'GF Flour 5 lb; Gluten-Free Flour' });
  t('the product joins the list with its public name, a slug, the gluten-free claim and two other names', r.s === 200 && JSON.parse(r.j.aliases).length === 2);
  await req('OTHER-1', '102050');
  r = await call('PUT', '/coa/products/OTHER-1', { display_name: 'Other Mix', aliases: 'gf flour 5 LB' });
  t('… a name already used by another product is refused, case aside (409)', r.s === 409 && /already names another COA product/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', `/coa/plans/${pd.id}/apply`, { item_numbers: ['FG0971'], mode: 'apply', reason: 'ProDough panel', ...QPW });
  t('the plan is applied to the product', r.s === 200 && r.j.applied === 1, JSON.stringify(r.j).slice(0, 300));
  // Re-grade against the plan's specifications: post the results again from the file.
  for (const b of [b1, b2]) {
    for (const x of all('SELECT id FROM coa_test_results WHERE request_id = ?', b.id)) run('DELETE FROM coa_test_results WHERE id = ?', x.id);
    const scan = (await scanFile(b.id, b.file.id)).j;
    await call('POST', `/coa/requests/${b.id}/results`, { source_file_id: b.file.id,
      results: scan.results.map(x => ({ test_type: x.test_type, result_value: x.result_value, unit: x.unit, mdl: x.mdl, method: x.method, stated_pass_fail: x.stated || undefined })) });
  }
  const rows = all('SELECT test_type, pass_fail, specification_id FROM coa_test_results WHERE request_id = ?', b1.id);
  t('every result is graded pass against the plan\'s limits', rows.length === 11 && rows.every(x => x.pass_fail === 'pass'), JSON.stringify(rows.filter(x => x.pass_fail !== 'pass')));
  t('… and both requests rolled up to pass', one('SELECT status s FROM coa_requests WHERE id = ?', b1.id)?.s === 'pass' && one('SELECT status s FROM coa_requests WHERE id = ?', b2.id)?.s === 'pass');
  r = await call('GET', '/coa/lots/FG0971/102000');
  t('the lot reads NOT released: 0 of 2 batches signed', r.s === 200 && r.j.state === 'not_met' && /0 of 2 batches signed and passing — lot not released/.test(r.j.summary), r.j.summary);
  r = await call('GET', '/coa/readiness');
  t('readiness says what strict would block today, naming the lot', r.s === 200 && /What strict would block today: \d+ lot/.test(r.j.headline) && r.j.would_block.some(l => l.base_lot === '102000'), r.j.headline);
  t('… and never changes a mode', one("SELECT value v FROM app_settings WHERE key = 'coa_release_gate'") === undefined);

  // ── 2. The doors in warn ──────────────────────────────────────────────────
  console.log('\n── the doors, on warn');
  r = await sign(b1.id);
  t('batch 1 signs (its own tests all pass)', r.s === 200, JSON.stringify(r.j).slice(0, 300));
  let ev = events();
  t('… and the sign door wrote down that strict would NOT have blocked it', ev.length === 1 && ev[0].door === 'coa_sign' && ev[0].mode === 'warn' && ev[0].would_block === 0);
  const e1 = entry('GF Flour 5 lb', '102000');
  r = await signOff(e1);
  t('production QA sign-off for the lot (named by an alias) goes ahead on warn…', r.s === 200 && !!r.j.qa_signoff_by, JSON.stringify(r.j).slice(0, 200));
  t('…and says where the lot stands: "COA: 1 of 2 batches signed and passing — lot not released"', (r.j.coa_gate || [])[0]?.summary === 'COA: 1 of 2 batches signed and passing — lot not released', JSON.stringify(r.j.coa_gate));
  ev = events();
  t('… recorded as a would-block on the production door', ev.some(e => e.door === 'production_qa_signoff' && e.would_block === 1 && e.blocked === 0 && e.entry_id === e1));
  const eSub = entry('GF Flour 5 lb extra', '102000');
  r = await signOff(eSub);
  t('a product name that only CONTAINS an alias is not the product — nothing is evaluated', r.s === 200 && !r.j.coa_gate);

  // ── 3. Moving the mode ────────────────────────────────────────────────────
  console.log('\n── moving the mode');
  t('Quality cannot move it (403)', (await call('PUT', '/coa/release-gate', { mode: 'on', reason: 'ready' }, Q)).s === 403);
  r = await call('PUT', '/coa/release-gate', { mode: 'on' }, A);
  t('an admin without a reason is refused (400)', r.s === 400 && r.j.reason_required === true);
  r = await call('PUT', '/coa/release-gate', { mode: 'on', reason: 'Testing strict' }, A);
  t('… without the password is asked for it (403)', r.s === 403 && r.j.signature_required === true);
  r = await call('PUT', '/coa/release-gate', { mode: 'on', reason: 'Testing strict', ...APW }, A);
  t('… with both it moves to strict, audited with the reason', r.s === 200 && r.j.mode === 'on'
    && !!one("SELECT 1 x FROM audit_log WHERE entity_id = 'coa_release_gate' AND details LIKE '%Testing strict%' AND details LIKE '%signature%'"));

  // ── 4. Strict, and the override ───────────────────────────────────────────
  console.log('\n── strict, and the override');
  const e2 = entry('Gluten Free Flour', '102000');
  r = await signOff(e2);
  t('strict refuses the production sign-off while the lot is not released (409, in words)', r.s === 409 && /Strict COA release: Gluten Free Flour lot 102000/.test(r.j.error) && !one('SELECT qa_signoff_by s FROM production_entries WHERE id = ?', e2)?.s, r.j.error);
  t('an operator cannot override (403)', (await call('POST', '/coa/lots/FG0971/102000/override', { reason: 'Customer order waiting today' }, O)).s === 403);
  t('a short reason is refused (400)', (await call('POST', '/coa/lots/FG0971/102000/override', { reason: 'urgent', ...QPW })).s === 400);
  r = await call('POST', '/coa/lots/FG0971/102000/override', { reason: 'Customer order waiting today' });
  t('… without the password it asks (403)', r.s === 403 && r.j.signature_required === true);
  r = await call('POST', '/coa/lots/FG0971/102000/override', { reason: 'Customer order waiting today', ...QPW });
  t('Quality overrides the lot, with a reason and the password', r.s === 201 && r.j.by_name === 'Quinn Lot');
  t('… audited as an override', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_lot_override' AND action = 'override'"));
  r = await signOff(e2);
  t('the production sign-off now goes ahead, marked overridden', r.s === 200 && r.j.coa_gate?.[0]?.overridden === true);
  t('… and the event says overridden, not blocked', events().some(e => e.entry_id === e2 && e.overridden === 1 && e.blocked === 0));
  r = await call('GET', '/coa/lots/FG0971/102000/publish-check', null, A);
  t('the override does NOT make the lot publishable: the lot rule check fails, saying an override does not count', r.s === 200 && r.j.ok === false
    && r.j.checks.find(c => c.key === 'lot')?.ok === false && /override does not count/.test(r.j.checks.find(c => c.key === 'lot').text));
  // An item on the list with no approved plan is "unknown": strict blocks it.
  // A product on the list with no approved plan is "unknown". Its specs cover
  // all five categories, so the category check passes and only the lot rule speaks.
  const nx = await req('PD-NOPLAN', '102100');
  await call('PUT', '/coa/products/PD-NOPLAN', { display_name: 'No Plan Mix', slug: 'no-plan-mix', brand_owner: 'ProDough' });
  for (const [tt, extra] of [['Identity (FTIR)', {}], ['Purity', {}], ['Assay potency', {}], ['Moisture', {}], ['Lead', { max_value: 1, unit: 'ppm' }]]) {
    await call('POST', '/coa/specifications', { item_number: 'PD-NOPLAN', item_description: 'No Plan Mix', test_type: tt, ...extra }, A);
  }
  r = await call('POST', `/coa/requests/${nx.id}/results`, { results: [
    { test_type: 'Identity (FTIR)', result_value: 'Conforms', pass_fail: 'pass', edit_reason: 'Typed from the paper report' },
    { test_type: 'Purity', result_value: '99%', pass_fail: 'pass', edit_reason: 'Typed from the paper report' },
    { test_type: 'Assay potency', result_value: '101%', pass_fail: 'pass', edit_reason: 'Typed from the paper report' },
    { test_type: 'Moisture', result_value: '4.0', pass_fail: 'pass', edit_reason: 'Typed from the paper report' },
    { test_type: 'Lead', result_value: '0.1', unit: 'ppm' },
  ] });
  t('a product with full category coverage files a passing request in strict', r.s === 201 && one('SELECT status s FROM coa_requests WHERE id = ?', nx.id)?.s === 'pass', `${r.s} ${one('SELECT status s FROM coa_requests WHERE id = ?', nx.id)?.s} ${JSON.stringify(r.j).slice(0, 200)}`);
  r = await sign(nx.id);
  t('strict refuses its certificate: the product has no approved plan (409, "no required tests defined")', r.s === 409 && r.j.lot_blocked === true && /no required tests defined/.test(r.j.error), JSON.stringify(r.j).slice(0, 300));
  t('… recorded as blocked on the sign door', events().some(e => e.request_id === nx.id && e.blocked === 1 && e.mode === 'on'));
  r = await signOff(entry('No Plan Mix', '102100'));
  t('… and its production sign-off is refused too ("unknown" is never released)', r.s === 409 && /No Plan Mix lot 102100/.test(r.j.error));
  r = await call('GET', '/coa/readiness');
  t('readiness warns that strict also holds certificates whose specifications miss a category', r.j.lines.some(l => l.key === 'categories' && /five categories/.test(l.text) && !l.ok), JSON.stringify(r.j.lines.find(l => l.key === 'categories')));
  r = await call('PUT', '/coa/release-gate', { mode: 'warn', reason: 'Back to warn after the test', ...APW }, A);
  t('back to warn', r.s === 200 && r.j.mode === 'warn');
  r = await sign(b2.id);
  t('batch 2 signs', r.s === 200, JSON.stringify(r.j).slice(0, 300));
  r = await call('GET', '/coa/lots/FG0971/102000');
  t('the lot is released: 2 of 2, and the gluten-free claim is supported', r.j.state === 'met' && r.j.met === true && r.j.claim_supported === true, r.j.summary);
  r = await call('POST', '/coa/lots/FG0971/102000/override/revoke', { reason: 'Lot released', ...QPW });
  t('the override is revoked, with a reason and the password', r.s === 200 && !!r.j.revoked_at);

  // ── 5. Would-blocks, golden run, readiness, QA Review ─────────────────────
  console.log('\n── reviewing would-blocks; the golden run; readiness');
  const wb = events().find(e => e.would_block === 1 && e.door === 'production_qa_signoff');
  t('reviewing needs a reason', (await call('POST', `/coa/gate-events/${wb.id}/review`, { review: 'correct' })).s === 400);
  t('an operator cannot review (403)', (await call('POST', `/coa/gate-events/${wb.id}/review`, { review: 'correct', note: 'batch 2 unsigned' }, O)).s === 403);
  r = await call('POST', `/coa/gate-events/${wb.id}/review`, { review: 'correct', note: 'Batch 2 was not signed yet' });
  t('Quality marks it correct', r.s === 200 && r.j.review === 'correct' && r.j.reviewed_by === 'Quinn Lot');
  r = await call('GET', '/qa-review?source=coa-readiness');
  const src = (r.j.sources || []).find(s => s.key === 'coa-readiness');
  t('QA Review lists "COA readiness" as an action pile, nothing to sign', r.s === 200 && src?.kind === 'action' && src.can_sign === false, JSON.stringify(src));
  t('… with the product whose plan is missing', JSON.stringify(r.j).includes('No Plan Mix'));
  t('a golden-file run without the password asks for it', (await call('POST', '/coa/readiness/golden-attest', { run_on: '2026-10-26', pdfs_read: 40, mismatches: 0, unread_rows: 0 })).s === 403);
  r = await call('POST', '/coa/readiness/golden-attest', { run_on: '2026-10-26', pdfs_read: 40, mismatches: 0, unread_rows: 0, note: 'Real CTLA set', ...QPW });
  t('… with it, the run is recorded', r.s === 201 && r.j.by_name === 'Quinn Lot');
  r = await call('GET', '/coa/readiness');
  const line = (k) => r.j.lines.find(x => x.key === k);
  t('readiness: the golden run, the reviewed would-block, the overrides, the public page', /40 PDFs, 0 mismatches/.test(line('golden').text)
    && /1 correct, 0 false/.test(line('warn_days').text) && /Overrides in force: 0/.test(line('overrides').text) && /Public certificate page: off/.test(line('public').text), JSON.stringify(r.j.lines));
  r = await call('GET', '/coa/readiness?format=csv');
  t('… and as a CSV', r.s === 200 && /^section,item_number/.test(r.j) && /would_block|summary/.test(r.j));

  // ── 6. Publishing ─────────────────────────────────────────────────────────
  console.log('\n── publishing');
  r = await call('GET', '/coa/lots/FG0971/102000/publish-check', null, A);
  t('every publish check passes, each in words', r.s === 200 && r.j.ok === true, JSON.stringify(r.j.checks?.filter(c => !c.ok)));
  t('Quality cannot publish yet — an admin decision (403)', (await call('POST', '/coa/lots/FG0971/102000/publish', QPW)).s === 403);
  r = await call('POST', '/coa/lots/FG0971/102000/publish', {}, A);
  t('publishing asks for the password', r.s === 403 && r.j.signature_required === true);
  r = await call('POST', '/coa/lots/FG0971/102000/publish', APW, A);
  t('the admin publishes BOTH batches at once, and is told the page is still off', r.s === 201 && r.j.published.length === 2 && r.j.live === false && /switched off/.test(r.j.note), JSON.stringify(r.j).slice(0, 300));
  const [p1, p2] = r.j.published.sort((a, b) => String(a.batch).localeCompare(String(b.batch)));
  t('… audited as publish, per batch', all("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_publication' AND action = 'publish'").length === 2);
  let threw = '';
  try { run("UPDATE coa_publications SET snapshot = '{}' WHERE public_id = ?", p1.public_id); } catch (e) { threw = e.message; }
  t('a publication\'s snapshot can never be rewritten', /never rewritten/.test(threw), threw);
  threw = '';
  try { run('DELETE FROM coa_publications WHERE public_id = ?', p1.public_id); } catch (e) { threw = e.message; }
  t('… or deleted', /never deleted/.test(threw), threw);
  const stored = JSON.parse(one('SELECT snapshot s FROM coa_publications WHERE public_id = ?', p1.public_id).s);
  t('the stored public snapshot carries no lab, no report number, no person, no item number', !FORBIDDEN.test(JSON.stringify(stored)), JSON.stringify(stored).match(FORBIDDEN)?.[0]);

  // ── 7. The public page ────────────────────────────────────────────────────
  console.log('\n── the public page');
  const nf = await pub('/c/doesnotexist1');
  let x = await pub(`/c/${p1.public_id}`);
  t('with the switches off, a real certificate is the SAME 404 as one that does not exist', x.s === 404 && nf.s === 404 && x.body === nf.body);
  t('… and so is every other public address', (await pub('/sku/gluten-free-flour')).s === 404 && (await pub('/verify')).s === 404 && (await pub('/robots.txt')).s === 404);
  t('Quality cannot switch the page on (403)', (await call('PUT', '/coa/public-switches/enabled', { value: 'on', reason: 'go live' }, Q)).s === 403);
  t('an admin without a reason is refused', (await call('PUT', '/coa/public-switches/enabled', { value: 'on' }, A)).s === 400);
  r = await call('PUT', '/coa/public-switches/enabled', { value: 'on', reason: 'Verify test', ...APW }, A);
  t('the master switch goes on with a reason and the password', r.s === 200 && r.j.enabled === 'on');
  x = await pub(`/c/${p1.public_id}`);
  t('… but the page stays a 404 while ProDough may not publish', x.s === 404 && x.body === nf.body);
  r = await call('PUT', '/coa/public-switches/brand', { value: 'on', reason: 'Verify test', ...APW }, A);
  t('ProDough publishing is allowed, audited on the brand', r.s === 200 && r.j.brand_allowed === true && !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_brand' AND details LIKE '%Verify test%'"));
  x = await pub(`/c/${p1.public_id}`);
  t('now the certificate shows: product, lot, certificate, the gluten-free tile, "Approved by Powder Ops QA"', x.s === 200 && /Gluten Free Flour/.test(x.body) && /102000-1/.test(x.body)
    && x.body.includes(p1.certificate_number) && /Gluten-free: under 20 ppm in every batch/.test(x.body) && /Approved by Powder Ops QA/.test(x.body) && /Results apply to the sample tested/.test(x.body));
  t('… with a link to the other batch', x.body.includes(`/tested/c/${p2.public_id}`));
  t('no lab name, report number, person, item number, "accredited" or "ISO" anywhere on it', !FORBIDDEN.test(x.body), x.body.match(FORBIDDEN)?.[0]);
  t('headers: a CSP with no script, noindex, no cookie, no framing', /default-src 'none'/.test(x.h.get('content-security-policy')) && !/script-src/.test(x.h.get('content-security-policy'))
    && /noindex/.test(x.h.get('x-robots-tag')) && !x.h.get('set-cookie') && x.h.get('x-frame-options') === 'DENY');
  t('no script on the page', !/<script/i.test(x.body));
  x = await pub(`/c/${p1.public_id}.json`);
  const pj = JSON.parse(x.body);
  t('the JSON is the same snapshot, clean', x.s === 200 && pj.status === 'published' && pj.certificate.lot_number === '102000-1' && !FORBIDDEN.test(x.body));
  x = await pub(`/c/${p1.public_id}.pdf`);
  const pdfText = x.s === 200 ? (await readPdfColumns(x.buf)).text : '';
  t('the PDF prints the certificate, clean', x.s === 200 && /Gluten Free Flour/.test(pdfText) && /Approved by Powder Ops QA/.test(pdfText) && !FORBIDDEN.test(pdfText), pdfText.slice(0, 300));
  t('the lot page lists both batches', (x = await pub('/lot/gluten-free-flour/102000')).s === 200 && x.body.includes(p1.public_id) && x.body.includes(p2.public_id));
  t('the product page lists the lot', (x = await pub('/sku/gluten-free-flour')).s === 200 && /Lot 102000/.test(x.body));
  t('verify needs both the certificate number and the lot (400 with one)', (await pub(`/verify?cert=${p1.certificate_number}`)).s === 400);
  x = await pub(`/verify?cert=${p1.certificate_number}&lot=102000-1`);
  t('… and with both says it is genuine', x.s === 200 && /That certificate is genuine/.test(x.body));
  x = await pub(`/verify?cert=${p1.certificate_number}&lot=999999`);
  t('… a wrong lot is "No match"', x.s === 200 && /No match/.test(x.body));
  x = await pub('/badge/gluten-free-flour.json');
  t('the badge JSON names the product and its latest lot, nothing internal', x.s === 200 && JSON.parse(x.body).latest_lot === '102000' && !FORBIDDEN.test(x.body));
  t('robots.txt disallows everything while the page is not indexable', (x = await pub('/robots.txt')).s === 200 && /Disallow: \//.test(x.body));
  t('an unknown address under /tested is the same 404', (await pub('/c/bad$id!')).s === 404 && (await pub('/nope')).s === 404 && (await pub('/lot/gluten-free-flour/999999')).s === 404);
  t('a product that is not ProDough has no page', (await pub('/sku/no-plan-mix')).s === 404);

  // ── 8. Withdraw, un-sign, supersede ───────────────────────────────────────
  console.log('\n── withdraw, un-sign, supersede');
  r = await call('DELETE', `/coa/requests/${b1.id}/sign`, { reason: 'Correction needed' }, A);
  t('un-signing a published certificate is refused until it is withdrawn (409)', r.s === 409 && r.j.published === true);
  const pub1 = one('SELECT id FROM coa_publications WHERE public_id = ?', p1.public_id).id;
  t('an operator cannot withdraw (403)', (await call('POST', `/coa/publications/${pub1}/withdraw`, { reason: 'Lab corrected the report' }, O)).s === 403);
  t('a short reason is refused (400)', (await call('POST', `/coa/publications/${pub1}/withdraw`, { reason: 'wrong', ...QPW })).s === 400);
  r = await call('POST', `/coa/publications/${pub1}/withdraw`, { reason: 'Lab corrected the report', ...QPW });
  t('Quality withdraws it with a reason and the password', r.s === 200 && r.j.status === 'withdrawn' && r.j.withdrawn_by === 'Quinn Lot');
  x = await pub(`/c/${p1.public_id}`);
  t('the public address now says it was withdrawn (410) — and never why', x.s === 410 && /This certificate was withdrawn/.test(x.body) && !/Lab corrected/.test(x.body));
  r = await call('DELETE', `/coa/requests/${b1.id}/sign`, { reason: 'Correction needed' }, A);
  t('now it can be un-signed', r.s === 200);
  r = await sign(b1.id);
  t('signed again (a new certificate number)', r.s === 200);
  r = await call('POST', '/coa/lots/FG0971/102000/publish', APW, A);
  t('published again: two new publications', r.s === 201 && r.j.published.length === 2, JSON.stringify(r.j).slice(0, 300));
  const p2new = r.j.published.find(p => p.batch === '2');
  t('… the old batch 2 publication is marked superseded, pointing at the new one', one('SELECT status s FROM coa_publications WHERE public_id = ?', p2.public_id)?.s === 'superseded' && p2new.superseded.includes(p2.public_id));
  x = await pub(`/c/${p2.public_id}`);
  t('the old address still shows, with a banner linking to the replacement', x.s === 200 && /This certificate was replaced/.test(x.body) && x.body.includes(`/tested/c/${p2new.public_id}`));
  x = await pub(`/c/${p2.public_id}.json`);
  t('… its JSON says superseded and names the replacement', JSON.parse(x.body).status === 'superseded' && JSON.parse(x.body).replaced_by === p2new.public_id);

  // ── 9. Off records nothing; the switches go back ──────────────────────────
  console.log('\n── off; closing up');
  await call('PUT', '/coa/release-gate', { mode: 'off', reason: 'Checking off', ...APW }, A);
  const before = events().length;
  r = await signOff(entry('Gluten Free Flour', '102000'));
  t('with the gate off the production door asks nothing and records nothing', r.s === 200 && !r.j.coa_gate && events().length === before);
  await call('PUT', '/coa/release-gate', { mode: 'warn', reason: 'Back to warn', ...APW }, A);
  t('the gate is left on warn', one("SELECT value v FROM app_settings WHERE key = 'coa_release_gate'")?.v === 'warn');

  // ── 10. Browser ───────────────────────────────────────────────────────────
  console.log('\n── in a browser');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const adminUser = one('SELECT id, name, role, department FROM users WHERE name = ?', admin);
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${ORIGIN}/manifest.webmanifest`);
    await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, adminUser]);
    await page.goto(`${ORIGIN}/?tab=coa&view=release`);
    await page.waitForSelector('[data-coa-release]', { timeout: 20000 });
    await page.waitForSelector('[data-coa-readiness]', { timeout: 20000 });
    t(`${width}px: Release & publishing opens on the readiness report, reading warn`, (await page.locator('[data-coa-readiness]').getAttribute('data-coa-readiness')) === 'warn'
      && /What strict would block today/.test(await page.locator('[data-readiness-headline]').innerText()));
    await page.fill('[data-lot-find-item]', 'FG0971');
    await page.fill('[data-lot-find-base]', '102000');
    await page.getByRole('button', { name: 'Open lot' }).click();
    await page.waitForSelector('[data-coa-lot="102000"]', { timeout: 15000 });
    t(`${width}px: the lot reads Released with both batches ticked`, (await page.locator('[data-coa-lot]').getAttribute('data-lot-state')) === 'met' && (await page.locator('[data-lot-batch]').count()) === 2);
    await page.click('[data-publish-check]');
    await page.waitForSelector('[data-publish-checks]', { timeout: 20000 });
    t(`${width}px: the publish checklist shows every check, all passing`, (await page.locator('[data-publish-checks]').getAttribute('data-publish-checks')) === 'ok' && (await page.locator('[data-check][data-ok="0"]').count()) === 0);
    await page.click('[data-publish-preview]');
    await page.waitForSelector('[data-public-preview]', { timeout: 20000 });
    const frame = page.frameLocator('[data-public-preview]');
    t(`${width}px: the preview shows the public page inside ReadyDoc, clean`, /Approved by Powder Ops QA/.test(await frame.locator('body').innerText()) && !FORBIDDEN.test(await frame.locator('body').innerText()));
    await page.keyboard.press('Escape');
    t(`${width}px: no horizontal scroll and no errors`, (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
} catch (e) {
  fail++; console.error(e); console.error(out.join('').split('\n').slice(-20).join('\n'));
}
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
