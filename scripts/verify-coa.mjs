#!/usr/bin/env node
// verify:coa — COA Phase 0 (D-221 … D-226), end to end on a fresh database.
//
// Runs the pure suites (`node --test scripts/test/`) first, then boots its own
// server on a temporary database and drives the routes: the PDF reader on the
// golden fixtures, the certificate that is no longer issued by reading it, the
// signing refusals and the lock after signing, the import that used to lose
// its file, the all-N/A roll-up, unit grading, the brand owner and the
// settings defaults. Part of `npm run check`.
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { readPdfColumns } from '../server/coa-pdf-text.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const unit = spawnSync(process.execPath, ['--test', ...readdirSync(path.join(root, 'scripts/test')).filter(f => /^coa-.*\.test\.mjs$/.test(f)).map(f => path.join('scripts/test', f))], { cwd: root, encoding: 'utf8' });
const tally = (unit.stdout.match(/^# (pass|fail) \d+$/gm) || []).join(', ');
console.log(`── pure suites: ${tally}`);
if (unit.status !== 0 && !process.env.COA_SKIP_UNIT) { console.log(unit.stdout.split('\n').filter(l => /^not ok|AssertionError|expected|actual/.test(l)).join('\n')); process.exit(1); }

const PORT = Number(process.env.COA_CHECK_PORT || 4602);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coa-'));
const dbPath = path.join(dir, 'coa.db');
const coaDir = path.join(dir, 'coa-files');
const fixture = (id) => readFileSync(path.join(root, 'scripts/fixtures/coa', `ctla-${id}.pdf`));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set COA_CHECK_PORT.`); process.exit(1); } catch { /* free */ }

const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
const out = []; child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
const stop = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', () => { stop(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

try {
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
  if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

  // Accounts: the seeded admin, a QA supervisor, an operator with COA edit.
  const db = new Database(dbPath);
  const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
  const admin = db.prepare("SELECT name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get().name;
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-Coa-2026'), admin);
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('coa-qa', 'Quinn Coa', 'Quinn Coa', 'supervisor', 'qa', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Quality-Coa-2026'));
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('coa-op', 'Oscar Coa', 'Oscar Coa', 'operator', 'warehouse', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Operator-Coa-2026'));
  db.close();
  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(admin, 'Admin-Coa-2026');
  const Q = await login('Quinn Coa', 'Quality-Coa-2026');
  const O = await login('Oscar Coa', 'Operator-Coa-2026');
  t('admin, Quality and an operator signed in', !!A && !!Q && !!O);

  const call = async (m, p, b, tok = Q) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    let j = null; const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) j = await r.json(); else j = Buffer.from(await r.arrayBuffer());
    return { s: r.status, j };
  };
  const upload = async (p, buf, name, fields = {}, tok = Q) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(BASE + p, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
    return { s: r.status, j: await r.json() };
  };
  const req = async (item, lot) => (await call('POST', '/coa/requests', { item_number: item, item_description: `COA check ${item}`, lot_number: lot, tests_requested: 'HM', date_sent: '2026-10-01' })).j;
  const row = (id) => one('SELECT * FROM coa_requests WHERE id = ?', id);
  const sign = (id, tok = Q, pw = 'Quality-Coa-2026') => call('POST', `/coa/requests/${id}/sign`, { signature: SIG, signature_password: pw }, tok);
  const filesOnDisk = () => { try { return readdirSync(coaDir).length; } catch { return 0; } };

  console.log('\n── reading a CTLA report (D-221)');
  const g1 = await req('COA-G', 'G-1');
  let r = await upload(`/coa/requests/${g1.id}/scan`, fixture('176906'), 'ctla-176906.pdf');
  const gl = r.j.results?.find(x => /gluten/i.test(x.test_type));
  t('the scan reads gluten as <4 ppm, not <44', r.s === 200 && gl?.result_value === '<4' && gl?.unit === 'ppm', JSON.stringify(gl));
  t('…by the column reader', r.j.read_by === 'columns', r.j.read_by);
  r = await upload(`/coa/requests/${g1.id}/scan`, fixture('180953'), 'ctla-180953.pdf');
  t('Alkify soy and milk read <0.04 and <0.4', r.j.results?.find(x => x.test_type === 'Soy Allergen')?.result_value === '<0.04'
    && r.j.results?.find(x => x.test_type === 'Milk Allergen')?.result_value === '<0.4');

  console.log('\n── grading (D-222)');
  await call('POST', '/coa/specifications', { item_number: 'COA-U', item_description: 'Unit check', test_type: 'Lead', max_value: 500, unit: 'ppb' });
  const u1 = await req('COA-U', 'U-1');
  r = await call('POST', `/coa/requests/${u1.id}/results`, { results: [{ test_type: 'Lead', result_value: '2', unit: 'ppm' }] });
  t('2 ppm against a 500 ppb limit FAILS (units normalised)', r.s === 201 && r.j[0].pass_fail === 'fail', JSON.stringify(r.j));
  r = await call('POST', `/coa/requests/${u1.id}/results`, { results: [{ test_type: 'Lead', result_value: '0,5', unit: 'ppm' }] });
  t('"0,5" is not read as 5 — left ungraded', r.j[0]?.pass_fail === null);
  const na = await req('COA-NA', 'NA-1');
  await call('POST', `/coa/requests/${na.id}/results`, { results: [{ test_type: 'Odor', result_value: 'n/a', pass_fail: 'na' }, { test_type: 'Taste', result_value: 'n/a', pass_fail: 'na' }] });
  t('a request whose results are all N/A does not roll up to pass', row(na.id).status !== 'pass', row(na.id).status);
  await call('PUT', `/coa/requests/${na.id}`, { status: 'pass' });
  r = await sign(na.id);
  t('… and cannot be signed even when marked pass by hand (D-228)', r.s === 409 && /no result passed/.test(r.j.error) && !row(na.id).certificate_number, r.j.error);

  console.log('\n── numbers read in full, units stated (D-227, D-229)');
  await call('POST', '/coa/specifications', { item_number: 'COA-U', item_description: 'Unit check', test_type: 'Total Aerobic Plate Count', max_value: 10000, unit: 'cfu/g' });
  const sci = await req('COA-U', 'SCI-1');
  r = await call('POST', `/coa/requests/${sci.id}/results`, { results: [
    { test_type: 'Total Aerobic Plate Count', result_value: '1.3e5', unit: 'cfu/g' }] });
  t('1.3e5 cfu/g against ≤10,000 FAILS (the exponent is read)', r.j[0]?.pass_fail === 'fail', JSON.stringify(r.j));
  const sci2 = await req('COA-U', 'SCI-2');
  r = await call('POST', `/coa/requests/${sci2.id}/results`, { results: [{ test_type: 'Total Aerobic Plate Count', result_value: '1.3x10^3', unit: 'cfu/g' }] });
  t('1.3x10^3 cfu/g passes as 1,300', r.j[0]?.pass_fail === 'pass');
  const sci3 = await req('COA-U', 'SCI-3');
  r = await call('POST', `/coa/requests/${sci3.id}/results`, { results: [
    { test_type: 'Total Aerobic Plate Count', result_value: '1.3e', unit: 'cfu/g' },
    { test_type: 'Lead', result_value: '0.2' },
    { test_type: 'Lead', result_value: '2.5 mg/g', unit: 'ppm' }] });
  t('a number the reader cannot take in full is left ungraded', r.j[0]?.pass_fail === null);
  t('a number with no unit against a ppb limit is "unit not stated", not compared raw', r.j[1]?.pass_fail === null);
  t('a value whose own unit disagrees with the unit column is not graded', r.j[2]?.pass_fail === null);

  console.log('\n── specifications (D-225)');
  const sp = (await call('GET', '/coa/specifications?item_number=COA-U')).j[0];
  r = await call('PUT', `/coa/specifications/${sp.id}`, { is_active: 0 });
  t('is_active cannot be flipped by an ordinary edit', r.s === 400);
  r = await call('PUT', `/coa/specifications/${sp.id}`, { method: 'ICP-MS' });
  t('other fields still edit', r.s === 200 && r.j.method === 'ICP-MS');

  console.log('\n── the certificate is not issued by reading it (D-223)');
  await call('POST', '/coa/specifications', { item_number: 'COA-C', item_description: 'Cert check', test_type: 'Arsenic', max_value: 0.5, unit: 'ppm' });
  const c1 = await req('COA-C', 'C-1');
  r = await upload(`/coa/requests/${c1.id}/files`, fixture('176906'), 'report.pdf', { file_type: 'lab_report' });
  t('a file type outside the list is a 400, and the file is not left behind', r.s === 400 && filesOnDisk() === 0, `${r.s} files=${filesOnDisk()}`);
  r = await upload(`/coa/requests/${c1.id}/files`, fixture('176906'), 'report.pdf', { file_type: 'lab_results' });
  const fileRow = r.j;
  t('a lab report uploads with the SHA-256 of its bytes', r.s === 201 && fileRow.sha256 === crypto.createHash('sha256').update(fixture('176906')).digest('hex'));
  await call('POST', `/coa/requests/${c1.id}/results`, { results: [{ test_type: 'Arsenic', result_value: '0.02', unit: 'ppm' }] });
  t('one passing result rolls the request up to pass', row(c1.id).status === 'pass', row(c1.id).status);
  r = await call('GET', `/coa/requests/${c1.id}/pdf`);
  t('the PDF of an unsigned request is a 409 …', r.s === 409 && r.j.draft_available === true);
  r = await call('GET', `/coa/requests/${c1.id}/pdf?draft=1`);
  t('… the draft preview renders …', r.s === 200 && r.j.slice(0, 4).toString() === '%PDF');
  t('… and neither allocated a certificate number', row(c1.id).certificate_number === null);
  r = await call('PUT', `/coa/requests/${c1.id}`, { certificate_number: '999999' });
  t('the certificate number is not editable', r.s === 400 && row(c1.id).certificate_number === null);
  r = await call('PUT', `/coa/requests/${c1.id}`, { status: 'approved-ish' });
  t('an unknown status is a 400, not a 500', r.s === 400);
  r = await call('POST', '/coa/requests/bulk-update', { ids: [c1.id], patch: { status: 'nope' } });
  t('… on the bulk update too', r.s === 400);

  console.log('\n── signing (D-224)');
  const f1 = await req('COA-C', 'F-1');
  await call('POST', `/coa/requests/${f1.id}/results`, { results: [{ test_type: 'Arsenic', result_value: '0.9', unit: 'ppm' }] });
  r = await sign(f1.id);
  t('a failing request cannot be signed', r.s === 409 && r.j.sign_refused && /status is "fail"/.test(r.j.error) && !row(f1.id).certificate_number, r.j.error);
  await call('PUT', `/coa/requests/${f1.id}`, { status: 'pass' });
  r = await sign(f1.id);
  t('… nor once someone marks it pass by hand: a result still failed', r.s === 409 && /failed/.test(r.j.error), r.j.error);
  const e1 = await req('COA-C', 'E-1');
  await call('PUT', `/coa/requests/${e1.id}`, { status: 'pass' });
  r = await sign(e1.id);
  t('a pass with no results cannot be signed', r.s === 409 && /no test results/.test(r.j.error));
  r = await sign(c1.id);
  const c1s = row(c1.id);
  t('a clean pass signs, with a certificate number', r.s === 200 && /^\d{6}$/.test(c1s.certificate_number || ''), JSON.stringify(r.j).slice(0, 200));
  t('… and the SHA-256 of what was signed is the hash of its snapshot', c1s.signed_content_hash === crypto.createHash('sha256').update(c1s.signed_snapshot).digest('hex')
    && JSON.parse(c1s.signed_snapshot).results[0].result_value === '0.02');
  r = await call('GET', `/coa/requests/${c1.id}/pdf`);
  t('the signed certificate downloads', r.s === 200 && r.j.slice(0, 4).toString() === '%PDF');
  const rid = (await call('GET', `/coa/requests/${c1.id}`)).j.test_results[0].id;
  t('results are locked: add', (await call('POST', `/coa/requests/${c1.id}/results`, { results: [{ test_type: 'Lead', result_value: '0.01' }] })).s === 409);
  t('results are locked: edit', (await call('PUT', `/coa/requests/${c1.id}/results/${rid}`, { result_value: '0.03' })).s === 409);
  t('results are locked: delete', (await call('DELETE', `/coa/requests/${c1.id}/results/${rid}`)).s === 409);
  const before = filesOnDisk();
  r = await upload(`/coa/requests/${c1.id}/files`, fixture('176905'), 'late.pdf', { file_type: 'lab_results' });
  t('files are locked: upload refused and nothing kept', r.s === 409 && filesOnDisk() === before);
  t('files are locked: delete', (await call('DELETE', `/coa/files/${fileRow.id}`)).s === 409 && !!one('SELECT 1 x FROM coa_files WHERE id = ?', fileRow.id));
  t('the lot number is locked', (await call('PUT', `/coa/requests/${c1.id}`, { lot_number: 'C-1X' })).s === 409 && row(c1.id).lot_number === 'C-1');
  t('a note is not', (await call('PUT', `/coa/requests/${c1.id}`, { notes: 'sent to customer' })).s === 200);
  r = await call('POST', '/coa/requests/bulk-delete', { ids: [c1.id] }, A);
  t('a signed certificate is never bulk-deleted', r.s === 200 && r.j.deleted === 0 && r.j.skipped_signed.length === 1 && !!row(c1.id));
  const voided = c1s.certificate_number;
  t('un-signing needs a reason', (await call('DELETE', `/coa/requests/${c1.id}/sign`, {}, A)).s === 400);
  r = await call('DELETE', `/coa/requests/${c1.id}/sign`, { reason: 'Wrong lot on the paper copy' }, A);
  t('an admin un-signs with a reason: signature, number and date cleared', r.s === 200 && !row(c1.id).qa_signed_at && row(c1.id).certificate_number === null && row(c1.id).date_of_issuance === null);
  t('… audited with the voided number', !!one("SELECT 1 x FROM audit_log WHERE entity_id = ? AND action = 'unsign' AND details LIKE ?", c1.id, `%${voided}%`));
  r = await sign(c1.id);
  t('signed again, it gets a NEW number; the voided one is never reissued', r.s === 200 && Number(row(c1.id).certificate_number) > Number(voided));

  console.log('\n── a number found on an unsigned request is never issued (D-228)');
  t('the one-time void ran at boot and left its marker', !!one("SELECT 1 x FROM app_settings WHERE key = 'coa_unissued_cert_numbers_voided_v1'"));
  const leg = await req('COA-C', 'LEG-1');
  await call('POST', `/coa/requests/${leg.id}/results`, { results: [{ test_type: 'Arsenic', result_value: '0.01', unit: 'ppm' }] });
  { const w = new Database(dbPath); w.prepare("UPDATE coa_requests SET certificate_number = '170001', date_of_issuance = '2026-01-01' WHERE id = ?").run(leg.id); w.close(); }
  r = await sign(leg.id);
  t('signing draws a fresh number and today\'s date, never the one the request held', r.s === 200
    && row(leg.id).certificate_number !== '170001' && row(leg.id).date_of_issuance !== '2026-01-01', `${row(leg.id).certificate_number} ${row(leg.id).date_of_issuance}`);

  const mth = await req('COA-C', 'M-1');
  await call('POST', `/coa/requests/${mth.id}/results`, { results: [{ test_type: 'Arsenic', result_value: '0.01', unit: 'ppm', method: 'USP <233>', mdl: '0.005' }] });
  r = await sign(mth.id);
  const snapR = JSON.parse(row(mth.id).signed_snapshot || '{}').results?.[0];
  t('a newly signed certificate freezes the method and MDL (D-231)', r.s === 200 && snapR?.method === 'USP <233>' && snapR?.mdl === '0.005', JSON.stringify(snapR));
  r = await call('GET', `/coa/requests/${mth.id}/pdf`);
  const certText = r.s === 200 ? (await readPdfColumns(r.j)).text : '';
  t('… and its PDF prints the method in the Method column', /USP <233>/.test(certText), certText.split('\n').find(l => /Arsenic/.test(l)) || '');

  console.log('\n── two certificates issued at once (D-223)');
  const ids = [];
  for (const lot of ['P-1', 'P-2', 'P-3', 'P-4']) {
    const x = await req('COA-C', lot);
    await call('POST', `/coa/requests/${x.id}/results`, { results: [{ test_type: 'Arsenic', result_value: '0.01', unit: 'ppm' }] });
    ids.push(x.id);
  }
  const signed = await Promise.all(ids.map(id => sign(id)));
  const nums = ids.map(id => row(id).certificate_number);
  t('four signed together get four different numbers', signed.every(x => x.s === 200) && new Set(nums).size === 4, nums.join(','));

  console.log('\n── filing from a read PDF (D-224)');
  r = await upload('/coa/parse-coa', fixture('176901'), 'ctla-176901.pdf');
  const pg = r.j.test_results?.find(x => /gluten/i.test(x.test_type));
  t('/parse-coa reads the gluten row as <4, method ELISA, MDL 4', r.s === 200 && pg?.result_value === '<4' && pg?.method === 'ELISA' && pg?.mdl === '4', JSON.stringify(pg));
  const parsed = r.j; const uploaded = parsed._uploaded_file;
  r = await call('POST', '/coa/import-parsed-coa', { parsed: { ...parsed, status: 'sideways' }, uploaded_file: uploaded });
  t('an unknown status on the import is a 400', r.s === 400);
  r = await call('POST', '/coa/import-parsed-coa', { parsed: { ...parsed, status: 'pass' }, uploaded_file: uploaded });
  const imp = r.j;
  t('the import files the request …', r.s === 201, JSON.stringify(r.j).slice(0, 200));
  const impFile = one('SELECT * FROM coa_files WHERE request_id = ?', imp.id);
  t('… WITH its PDF, as lab_results, hashed', impFile?.file_type === 'lab_results' && impFile?.sha256 === crypto.createHash('sha256').update(fixture('176901')).digest('hex'));
  t('… and the client\'s "pass" is not taken: ungraded results leave it pending', row(imp.id).status === 'pending', row(imp.id).status);
  const impG = one("SELECT method, mdl FROM coa_test_results WHERE request_id = ? AND test_type LIKE '%Gluten%'", imp.id);
  t('… storing the method and MDL on the result (D-231)', impG?.method === 'ELISA' && impG?.mdl === '4', JSON.stringify(impG));
  r = await call('POST', '/coa/import-parsed-coa', { parsed, uploaded_file: uploaded });
  t('the same lot filed twice is refused and names the first', r.s === 409 && r.j.existing_id === imp.id);
  r = await call('POST', '/coa/import-parsed-coa', { parsed: { ...parsed, lot_number: 'X-9' }, uploaded_file: { filename: '../../etc/passwd' } });
  t('an uploaded_file the server did not store is refused', r.s === 400 && !one("SELECT 1 x FROM coa_requests WHERE lot_number = 'X-9'"));

  console.log('\n── brand owner, default deny (D-226)');
  t('every request carries a brand owner, "unassigned" by default', one("SELECT COUNT(*) n FROM coa_requests WHERE brand_owner IS NULL OR brand_owner != 'unassigned'").n === 0);
  t('ProDough is on the brand list and not allowed to publish', one("SELECT public_publish_allowed p FROM coa_brands WHERE name = 'ProDough'")?.p === 0);
  t('an operator with COA edit cannot set it', (await call('PUT', `/coa/requests/${g1.id}/brand-owner`, { brand_owner: 'ProDough' }, O)).s === 403);
  t('an unknown brand is refused', (await call('PUT', `/coa/requests/${g1.id}/brand-owner`, { brand_owner: 'Somebody Else' })).s === 400);
  r = await call('PUT', `/coa/requests/${g1.id}/brand-owner`, { brand_owner: 'ProDough' });
  t('Quality sets it, audited', r.s === 200 && row(g1.id).brand_owner === 'ProDough' && !!one("SELECT 1 x FROM audit_log WHERE entity_id = ? AND details LIKE '%brand_owner%'", g1.id));
  r = await call('GET', '/coa/requests?limit=5000');
  const listed = r.j.requests;
  t('… list rows carry brand_owner, no qa_signature, no signed_snapshot', listed.every(x => 'brand_owner' in x && !('qa_signature' in x) && !('signed_snapshot' in x)));
  const PUBLIC_WORD = 'public_publish_allowed';
  const readers = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); } else if (/\.(m?js|jsx)$/.test(f) && readFileSync(p, 'utf8').includes(PUBLIC_WORD)) readers.push(path.relative(root, p)); } };
  walk(path.join(root, 'server')); walk(path.join(root, 'src')); walk(path.join(root, 'shared'));
  t('nothing in the app reads public_publish_allowed (only the schema declares it)', readers.join() === 'server/db.js', readers.join());

  console.log('\n── settings scaffold (D-226)');
  r = await call('GET', '/coa/settings');
  const val = (k) => r.j.settings.find(x => x.key === k)?.value;
  t('defaults: lab PDFs never shared, non-claim gluten hidden', val('evidence_disclosure_mode') === 'never' && val('public_nonclaim_gluten_display') === 'hidden');
  t('Quality cannot change a setting', (await call('PUT', '/coa/settings/evidence_disclosure_mode', { value: 'on_request_approval' })).s === 403);
  t('an admin cannot set a value outside the list', (await call('PUT', '/coa/settings/evidence_disclosure_mode', { value: 'always' }, A)).s === 400);
  r = await call('PUT', '/coa/settings/evidence_disclosure_mode', { value: 'on_request_approval' }, A);
  t('opening lab evidence needs a reason (D-233)', r.s === 400 && r.j.reason_required === true);
  r = await call('PUT', '/coa/settings/public_nonclaim_gluten_display', { value: 'visible' }, A);
  t('showing a non-claim gluten result needs a reason', r.s === 400 && r.j.reason_required === true);
  r = await call('PUT', '/coa/settings/evidence_disclosure_mode', { value: 'on_request_approval', reason: 'Customer audit request, approved by Quality' }, A);
  t('an admin changes it with a reason, and the reason is in the audit record', r.s === 200
    && !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_setting' AND details LIKE '%Customer audit request%'"));
  r = await call('PUT', '/coa/settings/evidence_disclosure_mode', { value: 'never' }, A);
  t('closing it again needs no reason', r.s === 200);
} finally {
  stop();
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
