#!/usr/bin/env node
// verify:coa2 — COA Phase 2A (D-243 … D-245), live on a temporary database,
// plus a real browser.
//
//  1. Test plans: seeded as drafts, approval refused while a limit is missing,
//     a password to approve, never edited once approved, a new version instead.
//  2. COA products and applying a plan: the preview writes nothing, a limit
//     already on file is a CONFLICT and is skipped, the rest is written with the
//     plan, its version and its approver. The readiness report.
//  3. A scan applied from the file: the lines the reader could not read are
//     stored, a QA Review item is filed, and signing waits until each is answered.
//  4. Hand edits need a reason; the signature re-reads the PDF; a changed file
//     is refused; the certificate prints †, the MDL and the report number.
//  5. The browser: the plans section, the unread lines, the "by hand" mark.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { readPdfColumns } from '../server/coa-pdf-text.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COA2_PORT || 4622);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coa2-'));
const dbPath = path.join(dir, 'coa2.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = new Database(dbPath); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const golden = (n) => readFileSync(path.join(root, 'scripts/fixtures/coa/golden', `${n}.pdf`));

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
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-Coa2-2026'), admin);
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('c2-qa', 'Quinn Two', 'Quinn Two', 'supervisor', 'qa', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Quality-Coa2-2026'));
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('c2-op', 'Oscar Two', 'Oscar Two', 'operator', 'warehouse', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Operator-Coa2-2026'));
  db.close();
  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(admin, 'Admin-Coa2-2026');
  const Q = await login('Quinn Two', 'Quality-Coa2-2026');
  const O = await login('Oscar Two', 'Operator-Coa2-2026');
  const QPW = { signature_password: 'Quality-Coa2-2026' };
  const call = async (m, p, b, tok = Q) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { s: r.status, j: ct.includes('json') ? await r.json() : ct.includes('csv') ? await r.text() : Buffer.from(await r.arrayBuffer()) };
  };
  const upload = async (p, buf, name, fields = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(BASE + p, { method: 'POST', headers: { Authorization: `Bearer ${Q}` }, body: fd });
    return { s: r.status, j: await r.json() };
  };
  const req = async (item, lot) => (await call('POST', '/coa/requests', { item_number: item, item_description: `Phase 2 ${item}`, lot_number: lot, tests_requested: 'HM & Micro', date_sent: '2026-10-01' })).j;
  const scanFile = async (reqId, fileId) => {
    const fd = new FormData(); fd.append('file_id', fileId);
    const x = await fetch(`${BASE}/coa/requests/${reqId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${Q}` }, body: fd });
    return { s: x.status, j: await x.json() };
  };
  const sign = (id) => call('POST', `/coa/requests/${id}/sign`, { signature: SIG, ...QPW });
  t('admin, Quality and an operator signed in', !!A && !!Q && !!O);

  // ── 1. Test plans ─────────────────────────────────────────────────────────
  console.log('\n── test plans (D-244)');
  let r = await call('GET', '/coa/plans');
  const pd = r.j.plans.find(p => p.name === 'ProDough standard panel');
  const gf = r.j.plans.find(p => p.name === 'Gluten-free claim');
  t('both plans are seeded once, as drafts', pd?.status === 'draft' && gf?.status === 'draft' && r.j.plans.length === 2);
  const glutenRow = pd.tests.find(x => /gluten/i.test(x.test_type));
  t('ProDough gluten is "< 20 ppm", worded as an internal limit', glutenRow?.comparator === '<' && glutenRow?.max_value === 20 && glutenRow?.unit === 'ppm'
    && /Internal limit < 20 ppm/.test(glutenRow?.specification || ''), JSON.stringify(glutenRow));
  t('the ProDough plan names what is missing before it can be approved', pd.missing.length > 0);
  r = await call('POST', `/coa/plans/${pd.id}/approve`, QPW);
  t('approval is refused while a limit is missing (400, with the list)', r.s === 400 && Array.isArray(r.j.missing) && r.j.missing.length > 0);
  t('an operator cannot edit a plan (403)', (await call('PUT', `/coa/plans/${pd.id}`, { notes: 'x' }, O)).s === 403);
  // Quality fills the plan in: three tests, every one judged.
  const tests = [
    { test_type: 'Total Aerobic Microbial Count (USP)', evaluation: 'limit', comparator: '<=', max_value: 10000, unit: 'cfu/g', method: 'USP <2021>' },
    { test_type: 'Lead', evaluation: 'limit', comparator: '<=', max_value: 0.5, unit: 'ppm', method: 'USP <233>' },
    { test_type: 'Gluten Allergen', evaluation: 'limit', comparator: '<', max_value: 20, unit: 'ppm', method: 'ELISA', specification: 'Internal limit < 20 ppm' },
  ];
  r = await call('PUT', `/coa/plans/${pd.id}`, { tests: [...tests, { test_type: 'Lead', evaluation: 'limit', comparator: '<=', max_value: 1, unit: 'ppm' }] });
  t('a test listed twice is refused', r.s === 400 && /twice/.test(r.j.error));
  r = await call('PUT', `/coa/plans/${pd.id}`, { tests });
  t('the draft is edited in place; nothing is missing now', r.s === 200 && r.j.missing.length === 0 && r.j.tests.length === 3);
  r = await call('POST', `/coa/plans/${pd.id}/approve`, {});
  t('approving asks for the password (403 signature_required)', r.s === 403 && r.j.signature_required === true);
  r = await call('POST', `/coa/plans/${pd.id}/approve`, QPW);
  t('with the password it is approved, by name', r.s === 200 && r.j.status === 'approved' && r.j.approved_by === 'Quinn Two');
  t('… and audited as an approval with the signature check', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_test_plan' AND action = 'approve' AND entity_id = ? AND details LIKE '%signature%'", pd.id));
  t('an approved plan is never edited (409)', (await call('PUT', `/coa/plans/${pd.id}`, { tests })).s === 409);
  r = await call('POST', `/coa/plans/${pd.id}/new-version`, {});
  const v2 = r.j;
  t('"New version" makes a draft copy, version 2', r.s === 201 && v2.version === 2 && v2.status === 'draft' && v2.tests.length === 3);
  t('… and only one draft at a time', (await call('POST', `/coa/plans/${pd.id}/new-version`, {})).s === 409);

  // ── 2. Products, apply, readiness ─────────────────────────────────────────
  console.log('\n── COA products, applying a plan, readiness (D-244)');
  const pa = await req('PD-PANCAKE', '101900');
  const pb = await req('PD-WAFFLE', '101901');
  t('a product must have a lab request to join the list', (await call('PUT', '/coa/products/NOPE-1', {})).s === 400);
  r = await call('PUT', '/coa/products/PD-PANCAKE', { display_name: 'Pancake Mix', slug: 'Bad Slug!' });
  t('a web slug is checked', r.s === 400);
  r = await call('PUT', '/coa/products/PD-PANCAKE', { display_name: 'Pancake Mix', slug: 'pancake-mix' });
  t('a product is added with a slug', r.s === 200 && r.j.slug === 'pancake-mix');
  t('… a slug another product holds is a 409', (await call('PUT', '/coa/products/PD-WAFFLE', { slug: 'pancake-mix' })).s === 409);
  await call('PUT', '/coa/products/PD-WAFFLE', { display_name: 'Waffle Mix', slug: 'waffle-mix' });
  // The waffle already has a Lead limit on file, approved outside any plan.
  await call('POST', '/coa/specifications', { item_number: 'PD-WAFFLE', item_description: 'Waffle', test_type: 'Lead', max_value: 2, unit: 'ppm' }, A);
  const specsBefore = all('SELECT id FROM coa_specifications').length;
  r = await call('POST', `/coa/plans/${pd.id}/apply`, { item_numbers: ['PD-PANCAKE', 'PD-WAFFLE', 'NOT-ON-LIST'] });
  const prev = Object.fromEntries((r.j.products || []).map(p => [p.item_number, p]));
  t('the preview writes nothing', r.s === 200 && r.j.mode === 'preview' && all('SELECT id FROM coa_specifications').length === specsBefore);
  t('… the pancake would gain all three tests', prev['PD-PANCAKE']?.status === 'ok' && prev['PD-PANCAKE'].add.length === 3);
  t('… the waffle is a CONFLICT, naming the limit already on file', prev['PD-WAFFLE']?.status === 'CONFLICT' && /Lead/.test(prev['PD-WAFFLE'].conflicts[0] || ''));
  t('… and an item not on the list says so', prev['NOT-ON-LIST']?.status === 'NOT_A_PRODUCT');
  r = await call('POST', `/coa/plans/${v2.id}/apply`, { item_numbers: ['PD-PANCAKE'], mode: 'apply', reason: 'first', ...QPW });
  t('a draft version cannot be applied (409)', r.s === 409);
  r = await call('POST', `/coa/plans/${pd.id}/apply`, { item_numbers: ['PD-PANCAKE', 'PD-WAFFLE'], mode: 'apply', reason: 'x', ...QPW });
  t('applying needs a reason', r.s === 400);
  r = await call('POST', `/coa/plans/${pd.id}/apply`, { item_numbers: ['PD-PANCAKE', 'PD-WAFFLE'], mode: 'apply', reason: 'First ProDough plan' });
  t('applying asks for the password', r.s === 403 && r.j.signature_required === true);
  r = await call('POST', `/coa/plans/${pd.id}/apply`, { item_numbers: ['PD-PANCAKE', 'PD-WAFFLE'], mode: 'apply', reason: 'First ProDough plan', ...QPW });
  t('applied to the pancake; the waffle CONFLICT is skipped, never forced', r.s === 200 && r.j.applied === 1 && r.j.skipped.some(s => s.item_number === 'PD-WAFFLE'), JSON.stringify(r.j));
  const pSpecs = all("SELECT * FROM coa_specifications WHERE item_number = 'PD-PANCAKE' AND is_active = 1");
  t('the pancake\'s specs carry the plan, its version and its approver', pSpecs.length === 3 && pSpecs.every(s => s.plan_id === pd.id && s.plan_version === 1 && s.approved_by === 'Quinn Two'));
  const g = pSpecs.find(s => /gluten/i.test(s.test_type));
  t('"< 20 ppm" is stored strictly below 20 (19.9 passes, 20 does not)', g && g.max_value < 20 && g.max_value > 19.99, String(g?.max_value));
  t('the waffle\'s own Lead limit is untouched', one("SELECT max_value v FROM coa_specifications WHERE item_number = 'PD-WAFFLE' AND test_type = 'Lead' AND is_active = 1")?.v === 2);
  r = await call('GET', '/coa/readiness');
  const rd = Object.fromEntries(r.j.products.map(p => [p.item_number, p.status]));
  t('readiness: the pancake is ready, the waffle still needs a plan', rd['PD-PANCAKE'] === 'ready' && rd['PD-WAFFLE'] === 'needs plan', JSON.stringify(rd));
  r = await call('GET', '/coa/readiness?format=csv');
  t('… and as a CSV', r.s === 200 && /^section,item_number,display_name/.test(r.j) && /PD-PANCAKE/.test(r.j));
  t('… for Quality and admins only', (await call('GET', '/coa/readiness', null, O)).s === 403);

  // ── 3. Unread lines ───────────────────────────────────────────────────────
  console.log('\n── the lines the reader could not read (D-243)');
  const u1 = await req('PD-UNREAD', '101902');
  await call('POST', '/coa/specifications', { item_number: 'PD-UNREAD', item_description: 'Unread', test_type: 'Lead', max_value: 0.5, unit: 'ppm' }, A);
  r = await upload(`/coa/requests/${u1.id}/files`, golden('synthetic-11-unreadable-row'), 'ctla-190011.pdf', { file_type: 'lab_results' });
  const uFile = r.j;
  r = await scanFile(u1.id, uFile.id);
  t('the scan proposes 1 result and names the 2 lines it could not read', r.s === 200 && r.j.results.length === 1 && r.j.unread.length === 2 && r.j.file_id === uFile.id, JSON.stringify({ s: r.s, n: r.j.results?.length, u: r.j.unread?.length }));
  t('… with the report number and date', r.j.lab_report_number === '190011' && r.j.report_date === '2026-08-12');
  t('… and the proposal itself writes nothing', !one('SELECT 1 x FROM coa_unread_rows WHERE request_id = ?', u1.id) && !one('SELECT 1 x FROM coa_test_results WHERE request_id = ?', u1.id));
  const lead = r.j.results[0];
  r = await call('POST', `/coa/requests/${u1.id}/results`, { source_file_id: uFile.id, results: [{ test_type: lead.test_type, result_value: lead.result_value, unit: lead.unit, mdl: lead.mdl, method: lead.method }] });
  t('applying from the file stores the result as read from the PDF', r.s === 201 && r.j[0].source === 'pdf' && r.j[0].source_sha256 === uFile.sha256 && r.j[0].read_value === '0.012');
  const unread = all('SELECT * FROM coa_unread_rows WHERE request_id = ?', u1.id);
  t('… stores the 2 unread lines', unread.length === 2 && unread.every(x => x.status === 'open'));
  t('… and files ONE QA Review item for them', all("SELECT * FROM coa_review_items WHERE request_id = ? AND kind = 'UNREAD_ROWS'", u1.id).length === 1);
  t('… the report number and date are kept on the file', one('SELECT lab_report_number n, lab_report_date d FROM coa_files WHERE id = ?', uFile.id)?.n === '190011');
  r = await call('GET', '/qa-review?source=coa-corrections');
  t('the item is in Quality\'s pile', r.s === 200 && JSON.stringify(r.j).includes('lines the app could not read'));
  await call('PUT', `/coa/requests/${u1.id}`, { status: 'pass' });
  r = await sign(u1.id);
  t('signing is refused while a line is unanswered', r.s === 409 && /could not be read/.test(r.j.error), r.j.error);
  t('an operator cannot answer a line (403)', (await call('POST', `/coa/unread-rows/${unread[0].id}/dismiss`, { reason: 'Footnote, not a result' }, O)).s === 403);
  t('answering needs a reason', (await call('POST', `/coa/unread-rows/${unread[0].id}/dismiss`, { reason: 'x' })).s === 400);
  r = await call('POST', `/coa/unread-rows/${unread[0].id}/dismiss`, { reason: 'Footnote on the report, not a result' });
  t('Quality answers one line', r.s === 200 && r.j.unread_rows.find(x => x.id === unread[0].id)?.state === 'dismissed');
  t('… and cannot answer it twice (409)', (await call('POST', `/coa/unread-rows/${unread[0].id}/dismiss`, { reason: 'Footnote on the report' })).s === 409);
  await call('POST', `/coa/unread-rows/${unread[1].id}/dismiss`, { reason: 'Signature block, not a result' });
  r = await call('GET', `/coa/requests/${u1.id}`);
  t('the request lists its lines and what became of them', r.j.unread_rows.length === 2 && r.j.unread_rows.every(x => x.state === 'dismissed'));
  r = await sign(u1.id);
  t('with every line answered, it signs', r.s === 200, JSON.stringify(r.j).slice(0, 200));

  // ── 4. Hand edits, the re-read, the certificate ───────────────────────────
  console.log('\n── hand edits, the re-read at signing, the certificate (D-244)');
  const h1 = await req('PD-PANCAKE', '101903');
  r = await upload(`/coa/requests/${h1.id}/files`, golden('synthetic-01-standard-panel'), 'ctla-190001.pdf', { file_type: 'lab_results' });
  const hFile = r.j;
  const scan = (await scanFile(h1.id, hFile.id)).j;
  const pick = scan.results.filter(x => /Aerobic|Lead|Gluten/i.test(x.test_type)).map(x => ({ test_type: x.test_type, result_value: x.result_value, unit: x.unit, mdl: x.mdl, method: x.method, stated_pass_fail: x.stated || undefined }));
  t('the standard panel reads the three plan tests', pick.length === 3, JSON.stringify(scan.results.map(x => x.test_type)));
  const others = scan.results.filter(x => !/Aerobic|Lead|Gluten/i.test(x.test_type));
  r = await call('POST', `/coa/requests/${h1.id}/results`, { source_file_id: hFile.id, results: [...pick,
    ...others.map(x => ({ test_type: x.test_type, result_value: x.result_value, unit: x.unit, mdl: x.mdl, method: x.method, pass_fail: 'na', edit_reason: 'Not on this product\'s plan' }))] });
  t('the whole report is applied; tests off the plan are set N/A by hand, with a reason', r.s === 201, JSON.stringify(r.j).slice(0, 200));
  const lr = all('SELECT * FROM coa_test_results WHERE request_id = ?', h1.id);
  const leadRow = lr.find(x => x.test_type === 'Lead');
  r = await call('PUT', `/coa/requests/${h1.id}/results/${leadRow.id}`, { result_value: '0.02' });
  t('changing a value read from the PDF without a reason is refused (400, in words)', r.s === 400 && r.j.needs_reason && /differs from the lab report/.test(r.j.error), r.j.error);
  r = await call('PUT', `/coa/requests/${h1.id}/results/${leadRow.id}`, { pass_fail: 'fail' });
  t('so is setting a verdict the limit does not give', r.s === 400 && /set by hand/.test(r.j.error));
  r = await call('PUT', `/coa/requests/${h1.id}/results/${leadRow.id}`, { result_value: '0.02', edit_reason: 'Lab corrected by email 10/20' });
  t('with a reason it saves, flagged and named', r.s === 200 && r.j.edit_reason === 'Lab corrected by email 10/20' && r.j.edited_by === 'Quinn Two');
  t('… and the audit says so', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_test_result' AND entity_id = ? AND details LIKE '%hand_value%true%'", leadRow.id));
  r = await sign(h1.id);
  t('the re-read finds the difference explained by the reason, and it signs', r.s === 200, JSON.stringify(r.j).slice(0, 300));
  const snap = JSON.parse(one('SELECT signed_snapshot s FROM coa_requests WHERE id = ?', h1.id).s);
  const sl = snap.results.find(x => x.test_type === 'Lead');
  t('snapshot v2: the Lead result is marked by hand with its reason, plan and approver', snap.snapshot_version === 2 && sl.manual === true && sl.edit_reason === 'Lab corrected by email 10/20'
    && sl.plan_id === pd.id && sl.spec_approved_by === 'Quinn Two' && snap.signed_by === 'Quinn Two' && snap.lab_report_number === '190001');
  r = await call('GET', `/coa/requests/${h1.id}/pdf`);
  const cert = r.s === 200 ? (await readPdfColumns(r.j)).text : '';
  t('the certificate marks it † with a footnote giving the reason', /0\.02 †/.test(cert) && /† Lead: entered or graded by hand: Lab corrected by email 10\/20/.test(cert), cert.split('\n').filter(l => /†|Lead/.test(l)).join(' | '));
  t('… prints the lab report number, its date and the MDL', /Lab Report No\./i.test(cert) && /190001/.test(cert) && /MDL /.test(cert), cert.slice(0, 1500));
  t('… and the signer from the snapshot', /Quinn Two — Quality/.test(cert));

  // A file that changed after it was attached is refused at signing.
  const c1 = await req('PD-PANCAKE', '101904');
  r = await upload(`/coa/requests/${c1.id}/files`, golden('synthetic-01-standard-panel'), 'ctla-190001.pdf', { file_type: 'lab_results' });
  const cFile = r.j;
  await call('POST', `/coa/requests/${c1.id}/results`, { source_file_id: cFile.id, results: [...pick,
    ...others.map(x => ({ test_type: x.test_type, result_value: x.result_value, unit: x.unit, mdl: x.mdl, method: x.method, pass_fail: 'na', edit_reason: 'Not on this product\'s plan' }))] });
  const disk = path.join(dir, 'coa-files', readdirSync(path.join(dir, 'coa-files')).find(f => f === cFile.filename) || cFile.filename);
  writeFileSync(disk, golden('synthetic-02-merged-header-dot-mdl'));
  r = await sign(c1.id);
  t('a lab report that changed on disk since it was attached blocks the signature', r.s === 409 && /changed since it was attached/.test(r.j.error), r.j.error);
  writeFileSync(disk, golden('synthetic-01-standard-panel'));
  const tamc = all('SELECT * FROM coa_test_results WHERE request_id = ?', c1.id).find(x => /Aerobic/.test(x.test_type));
  { const w = new Database(dbPath); w.prepare("UPDATE coa_test_results SET result_value = '<10' WHERE id = ?").run(tamc.id); w.close(); }
  r = await sign(c1.id);
  t('a value that disagrees with the report, with no reason, blocks it — in warn mode too', r.s === 409 && /the report says .* but the saved result is <10/.test(r.j.error)
    && one("SELECT value v FROM app_settings WHERE key = 'coa_release_gate'")?.v !== 'on', r.j.error);
  t('… and nothing about the gate mode was changed', ['warn', undefined].includes(one("SELECT value v FROM app_settings WHERE key = 'coa_release_gate'")?.v));

  // ── 5. Browser ────────────────────────────────────────────────────────────
  console.log('\n── in a browser');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    await page.evaluate((tok) => localStorage.setItem('auth_token', tok), Q);
    await page.goto(`http://127.0.0.1:${PORT}/?tab=coa`);
    await page.waitForSelector('table tbody tr', { timeout: 30000 });
    await page.getByText('Specifications', { exact: true }).first().click();
    await page.waitForSelector('[data-test-plans]', { timeout: 20000 });
    await page.locator('[data-test-plans] > button').first().click();
    await page.waitForSelector('[data-plan="ProDough standard panel"]', { timeout: 20000 });
    t('the Specifications tab shows the test plans, with their status', await page.locator('[data-plan-status="approved"]').count() === 1 && await page.locator('[data-plan-status="draft"]').count() === 2);
    t('… and the COA product list with the slug', await page.locator('[data-coa-product="PD-PANCAKE"]', { hasText: 'pancake-mix' }).count() === 1);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'coa', request: id } })), u1.id);
    await page.waitForSelector('[data-unread-rows]', { timeout: 20000 });
    t('a request shows the lines the app could not read, and what became of each', await page.locator('[data-unread-row="dismissed"]').count() === 2);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'coa', request: id } })), h1.id);
    await page.waitForSelector('[data-hand-entered]', { timeout: 20000 });
    t('a result entered by hand is marked "† by hand"', await page.locator('[data-hand-entered]').count() >= 1);
  } finally { await browser.close(); }
} catch (e) {
  fail++; console.error(e);
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
