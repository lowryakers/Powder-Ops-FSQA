#!/usr/bin/env node
// verify:coawindow — the COA correction window and the fixes beside it
// (D-307 … D-312), end to end on a fresh database through the real routes.
//
//   C1 correction window: who may un-sign, what is asked, history kept,
//      reopened state, field edits audited, re-sign with a new number that
//      names the old one, expiry, the published block, the readiness line
//   C2 a heavy-metal draft is never approved without a number
//   C3 one Limit box, parsed and said back
//   C4 a new spec is a draft; editing an active spec is a new version
//   C5 the gluten "<44" report lists signed certificates and writes nothing
//   C6 item codes trimmed, bulk register (dry run first), PDF-but-no-plan
//   C7 a re-issued report names the request it replaces
//   C8 the coa-prep grant prepares and never decides
//   C9 paging, "not read yet", the sign dialog's stored-vs-printed facts
//
// Control: run against `main` before this change — the window routes do not
// exist and the first window assertion fails.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COA_WINDOW_PORT || 5186);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coawin-'));
const dbPath = path.join(dir, 'coawin.db');
const fixture = (id) => readFileSync(path.join(root, 'scripts/fixtures/coa', `ctla-${id}.pdf`));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const write = (fn) => { const d = new Database(dbPath); try { return fn(d); } finally { d.close(); } };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set COA_WINDOW_PORT.`); process.exit(1); } catch { /* free */ }

const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', SIGNATURE_NAME_OPTIONAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const out = []; child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
const stop = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', () => { stop(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

try {
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
  if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

  // Accounts: admin; Wren (QA, the window will name her); Quinn (QA, never
  // named); Oscar (warehouse operator with COA edit); Pia (coa-prep).
  const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
  const admin = write(db => {
    const a = db.prepare("SELECT name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get().name;
    db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-Win-2026'), a);
    const add = db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), ?)`);
    add.run('win-wren', 'Wren Window', 'Wren Window', 'operator', 'qa', hashOf('Wren-Win-2026'), '{"coa":"edit"}');
    add.run('win-quinn', 'Quinn Window', 'Quinn Window', 'supervisor', 'qa', hashOf('Quinn-Win-2026'), '{"coa":"edit"}');
    add.run('win-oscar', 'Oscar Window', 'Oscar Window', 'operator', 'warehouse', hashOf('Oscar-Win-2026'), '{"coa":"edit"}');
    add.run('win-pia', 'Pia Prep', 'Pia Prep', 'operator', 'warehouse', hashOf('Pia-Win-2026'), '{"coa":"edit","coa-prep":"edit"}');
    return a;
  });
  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(admin, 'Admin-Win-2026');
  const W = await login('Wren Window', 'Wren-Win-2026');
  const Q = await login('Quinn Window', 'Quinn-Win-2026');
  const O = await login('Oscar Window', 'Oscar-Win-2026');
  const P = await login('Pia Prep', 'Pia-Win-2026');
  t('five accounts signed in', !!A && !!W && !!Q && !!O && !!P);

  const call = async (m, p, b, tok = A) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type') || '';
    const j = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { s: r.status, j };
  };
  const upload = async (p, buf, name, fields = {}, tok = A) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(BASE + p, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
    return { s: r.status, j: await r.json() };
  };
  const row = (id) => one('SELECT * FROM coa_requests WHERE id = ?', id);
  const REPORT_ROWS = [
    { test_type: 'Total Aerobic Microbial Count (USP)', result_value: '<100', unit: 'cfu/g' },
    { test_type: 'Lead', result_value: '0.009', unit: 'ppm' },
    { test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm' },
  ];
  for (const [test_type, extra] of [['Total Aerobic Microbial Count (USP)', { max_value: 10000, unit: 'cfu/g' }], ['Lead', { max_value: 0.5, unit: 'ppm' }], ['Gluten Allergen', { max_value: 20, unit: 'ppm' }]]) {
    await call('POST', '/coa/specifications', { approve_now: true, item_number: 'WIN-1', item_description: 'Whey Protein Pouch (Vanilla)', test_type, ...extra });
  }
  // A signed pass on CTLA 183621 (lot 101954), applied from the file.
  const makeSigned = async (lot = '101954') => {
    const q = (await call('POST', '/coa/requests', { item_number: 'WIN-1', item_description: 'Whey Protein Pouch (Vanilla)', lot_number: lot, tests_requested: 'HM & Micro', date_sent: '2026-10-27', received_date: '2026-10-27' })).j;
    const f = (await upload(`/coa/requests/${q.id}/files`, fixture('183621'), 'ctla-183621.pdf', { file_type: 'lab_results' })).j;
    const ap = await call('POST', `/coa/requests/${q.id}/results`, { source_file_id: f.id, results: REPORT_ROWS });
    const sg = await call('POST', `/coa/requests/${q.id}/sign`, { signature: SIG, signature_password: 'Admin-Win-2026' });
    return { id: q.id, file: f, applied: ap, signed: sg };
  };
  const s1 = await makeSigned();
  t('setup: a request on CTLA 183621 is applied from the file and signed', s1.applied.s === 201 && s1.signed.s === 200 && !!row(s1.id).certificate_number,
    `${s1.applied.s} ${s1.signed.s} ${JSON.stringify(s1.signed.j).slice(0, 200)}`);
  const cert1 = row(s1.id).certificate_number;

  console.log('\n── C1: who may un-sign');
  let r = await call('DELETE', `/coa/requests/${s1.id}/sign`, { reason: 'Expiry was typed wrong', field_plan: 'expiry' }, O);
  t('a warehouse operator cannot un-sign', r.s === 403);
  r = await call('DELETE', `/coa/requests/${s1.id}/sign`, { reason: 'Expiry was typed wrong', field_plan: 'expiry', signature_password: 'Wren-Win-2026' }, W);
  t('Quality outside a window cannot un-sign', r.s === 403);

  console.log('\n── C1: opening a window');
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-wren'], reason: 'Correcting October expiry dates typed wrong' }, W);
  t('only an admin opens a window', r.s === 403);
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-wren'], reason: 'too short' });
  t('a reason under 20 characters is refused', r.s === 400);
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-wren'], hours: 400, reason: 'Correcting October expiry dates typed wrong' });
  t('more than 14 days is refused', r.s === 400);
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-oscar'], reason: 'Correcting October expiry dates typed wrong', signature_password: 'Admin-Win-2026' });
  t('a window covers Quality reviewers only', r.s === 400 && /Oscar/.test(r.j.error), r.j.error);
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-wren'], reason: 'Correcting October expiry dates typed wrong' });
  t('opening a window asks for the admin\'s password', r.s === 403 && r.j.signature_required === true);
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-wren'], reason: 'Correcting October expiry dates typed wrong', signature_password: 'Admin-Win-2026' });
  const win = r.j;
  t('with the password it opens: 7 days by default, Wren named', r.s === 201 && win.state === 'open' && win.people?.[0]?.name === 'Wren Window'
    && Math.abs(new Date(win.expires_at) - Date.now() - 168 * 3600e3) < 120e3, JSON.stringify(r.j).slice(0, 200));
  t('opening is audited', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_correction_window' AND action = 'open'"));
  r = await call('GET', '/coa/requests?limit=50', null, W);
  const listed = r.j.requests?.find(x => x.id === s1.id);
  t('Wren\'s list carries the window and un-sign on the signed certificate', !!r.j.window && listed?.correction?.unsign === true && listed?.correction?.delete === false);
  r = await call('GET', '/coa/requests?limit=50', null, Q);
  t('Quinn, not named, sees no window and no un-sign', !r.j.window && r.j.requests?.find(x => x.id === s1.id)?.correction?.unsign === false);

  console.log('\n── C1: un-signing under the window');
  r = await call('DELETE', `/coa/requests/${s1.id}/sign`, { reason: 'Expiry was typed wrong', signature_password: 'Wren-Win-2026' }, W);
  t('without "what will you correct" it is refused', r.s === 400 && r.j.needs_field_plan === true);
  r = await call('DELETE', `/coa/requests/${s1.id}/sign`, { reason: 'wrong', field_plan: 'expiry', signature_password: 'Wren-Win-2026' }, W);
  t('a reason under 10 characters is refused', r.s === 400);
  r = await call('DELETE', `/coa/requests/${s1.id}/sign`, { reason: 'Expiry was typed wrong at filing', field_plan: 'expiry 2026-10 to 2028-10' }, W);
  t('without her password it is refused', r.s === 403 && r.j.signature_required === true && !!row(s1.id).qa_signed_at);
  r = await call('DELETE', `/coa/requests/${s1.id}/sign`, { reason: 'Expiry was typed wrong at filing', field_plan: 'expiry 2026-10 to 2028-10', signature_password: 'Wren-Win-2026' }, W);
  const after = row(s1.id);
  t('with all three it un-signs and the request is reopened for correction', r.s === 200 && r.j.reopened === true && !after.qa_signed_at
    && after.reopened_for_correction === 1 && after.reopened_window_id === win.id, JSON.stringify(r.j));
  const hist = one('SELECT * FROM coa_signature_history WHERE request_id = ?', s1.id);
  t('the original signature is KEPT: image, snapshot, hash, number, who removed it and why', hist?.certificate_number === cert1 && !!hist.qa_signature
    && !!hist.signed_snapshot && !!hist.signed_content_hash && hist.unsigned_by === 'Wren Window' && hist.field_plan === 'expiry 2026-10 to 2028-10' && hist.window_id === win.id);
  t('the history refuses an UPDATE', (() => { try { write(d => d.prepare("UPDATE coa_signature_history SET reason = 'x'").run()); return false; } catch { return true; } })());
  t('… and a DELETE', (() => { try { write(d => d.prepare('DELETE FROM coa_signature_history').run()); return false; } catch { return true; } })());
  r = await call('GET', `/coa/requests/${s1.id}`, null, W);
  t('the request shows its signature history', r.j.signature_history?.length === 1 && r.j.signature_history[0].certificate_number === cert1 && !('qa_signature' in r.j.signature_history[0]));
  r = await call('GET', `/coa/requests/${s1.id}/pdf`, null, W);
  t('while reopened the certificate PDF is not issued', r.s === 409);

  console.log('\n── C1: correcting while reopened');
  r = await call('PUT', `/coa/requests/${s1.id}`, { product_expiration: '2028-10-31' }, Q);
  t('Quinn, not covered by the window, cannot change it', r.s === 403 && r.j.reopened === true);
  r = await call('PUT', `/coa/requests/${s1.id}`, { product_expiration: '2028-10-31' }, W);
  t('Wren corrects the expiry', r.s === 200 && row(s1.id).product_expiration === '2028-10-31');
  t('the field change is audited as a correction, old and new', !!one("SELECT 1 x FROM audit_log WHERE entity_id = ? AND action = 'correction'", s1.id));
  // D-345: the edit form sends the WHOLE request back, certificate_number and
  // date_of_issuance included (blank while reopened). That must save.
  { const whole = (await call('GET', `/coa/requests/${s1.id}`, null, W)).j;
    r = await call('PUT', `/coa/requests/${s1.id}`, { ...whole, supplier: 'Corrected Supplier Co' }, W);
    t('D-345: the screen\'s whole-request Update saves while reopened', r.s === 200 && row(s1.id).supplier === 'Corrected Supplier Co', JSON.stringify(r.j).slice(0, 200));
    r = await call('PUT', `/coa/requests/${s1.id}`, { ...whole, certificate_number: 'TYPED-1' }, A);
    t('D-345: a typed certificate number is still refused', r.s === 400 && /set by signing/.test(r.j.error || ''));
    r = await call('POST', '/coa/requests/bulk-delete', { ids: [s1.id] }, A);
    t('D-345: deleting a reopened certificate says why nothing was deleted', r.s === 200 && r.j.deleted === 0 && /reopened for correction/.test(r.j.not_deleted || ''), JSON.stringify(r.j));
    t('… and the request is still there', !!row(s1.id)); }

  console.log('\n── C1: re-signing');
  r = await call('POST', `/coa/requests/${s1.id}/sign`, { signature: SIG, signature_password: 'Wren-Win-2026' }, W);
  const re = row(s1.id);
  t('it signs again with a NEW number', r.s === 200 && !!re.certificate_number && re.certificate_number !== cert1, JSON.stringify(r.j).slice(0, 200));
  t('… that names the one it corrects, and it is no longer reopened', re.supersedes_certificate_number === cert1 && re.reopened_for_correction === 0);
  { const snap = JSON.parse(re.signed_snapshot);
    t('the snapshot is version 3 and carries what it corrects and why', snap.snapshot_version === 3 && snap.corrected_from?.certificate_number === cert1
      && /typed wrong/.test(snap.corrected_from?.reason || ''), JSON.stringify(snap.corrected_from)); }
  r = await call('GET', `/coa/requests/${s1.id}/pdf`, null, W);
  t('the corrected certificate PDF downloads', r.s === 200 && r.j.slice(0, 4).toString() === '%PDF');
  t('a certificate number is never issued twice', all('SELECT certificate_number c FROM coa_requests WHERE certificate_number IS NOT NULL').length
    === new Set(all('SELECT certificate_number c FROM coa_requests WHERE certificate_number IS NOT NULL').map(x => x.c)).size);

  console.log('\n── C1: published certificates, the readiness line, expiry, closing');
  const s2 = await makeSigned('101955');
  write(d => d.prepare(`INSERT INTO coa_publications (id, public_id, certificate_number, request_id, base_lot, item_number, product_slug, brand_owner, snapshot, snapshot_sha256, published_by)
    VALUES ('pub-1', 'pubwin1', ?, ?, '101955', 'WIN-1', 'whey', 'ProDough', '{}', 'x', 'test')`).run(row(s2.id).certificate_number, s2.id));
  r = await call('DELETE', `/coa/requests/${s2.id}/sign`, { reason: 'Expiry was typed wrong at filing', field_plan: 'expiry', signature_password: 'Wren-Win-2026' }, W);
  t('a published certificate still blocks the un-sign, window or not', r.s === 409 && r.j.published === true);
  const s3 = await makeSigned('101956');
  r = await call('DELETE', `/coa/requests/${s3.id}/sign`, { reason: 'Lot typed wrong at filing', field_plan: 'lot number', signature_password: 'Wren-Win-2026' }, W);
  t('a second certificate reopens', r.s === 200);
  write(d => d.prepare("UPDATE coa_requests SET reopened_at = datetime('now', '-5 days') WHERE id = ?").run(s3.id));
  r = await call('GET', '/coa/readiness', null, Q);
  const line = r.j.lines?.find(l => l.key === 'reopened_certificates');
  t('the readiness report fails its line for a certificate reopened more than 3 days', line && line.ok === false && /1 certificate reopened/.test(line.text), JSON.stringify(line));
  write(d => d.prepare("UPDATE coa_correction_windows SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 60e3).toISOString(), win.id));
  const s4 = await makeSigned('101957');
  r = await call('DELETE', `/coa/requests/${s4.id}/sign`, { reason: 'Expiry was typed wrong at filing', field_plan: 'expiry', signature_password: 'Wren-Win-2026' }, W);
  t('once the window has expired the un-sign is refused (checked on the clock, no job needed)', r.s === 403 && !!row(s4.id).qa_signed_at);
  r = await call('PUT', `/coa/requests/${s3.id}`, { lot_number: '101956-X' }, W);
  t('… and the reopened certificate can no longer be changed by Wren', r.s === 403);
  r = await call('GET', '/coa/correction-window', null, A);
  t('the window reads expired', r.j.windows?.find(w => w.id === win.id)?.state === 'expired');
  r = await call('POST', '/coa/correction-window', { user_ids: ['win-wren'], hours: 2, reason: 'A second short window for the lot fix', signature_password: 'Admin-Win-2026' });
  const win2 = r.j;
  r = await call('DELETE', `/coa/correction-window/${win2.id}`, { reason: 'Done early' });
  t('an admin closes a window early', r.s === 200 && r.j.state === 'closed');
  r = await call('GET', '/coa/requests?limit=5', null, W);
  t('… and it leaves Wren\'s list', !r.j.window);

  console.log('\n── C2 / C4: specification drafts and versions');
  r = await call('POST', '/coa/specifications', { item_number: 'WIN-2', item_description: 'Spec check', test_type: 'Arsenic', unit: 'ppm' });
  const draft = r.j;
  t('a new spec is a DRAFT and grades nothing', r.s === 201 && draft.approval_status === 'draft' && draft.is_active === 0, JSON.stringify(r.j).slice(0, 160));
  r = await call('POST', '/coa/specifications/drafts/approve', { ids: [draft.id] });
  t('a heavy-metal draft with no number is not approved', r.s >= 400 && one('SELECT is_active a FROM coa_specifications WHERE id = ?', draft.id).a === 0, `${r.s} ${r.j.error}`);
  r = await call('POST', '/coa/specifications/drafts/approve', { ids: [draft.id], limits: { [draft.id]: { max_value: 0.5 } } });
  t('with a number it is approved and active', r.s === 200 && one('SELECT is_active a, max_value m FROM coa_specifications WHERE id = ?', draft.id).a === 1);
  r = await call('PUT', `/coa/specifications/${draft.id}`, { limit: 'NMT 0.3' });
  t('editing the active spec without a reason is refused', r.s === 400 && r.j.needs_reason === true);
  r = await call('PUT', `/coa/specifications/${draft.id}`, { limit: 'NMT 0.3', change_reason: 'Customer asked for a tighter limit' });
  const v2 = r.j;
  t('with a reason it is a new draft version; the active one goes on grading', r.s === 201 && v2.spec_version === 2 && v2.max_value === 0.3
    && one('SELECT is_active a, max_value m FROM coa_specifications WHERE id = ?', draft.id).m === 0.5);
  r = await call('POST', '/coa/specifications/drafts/approve', { ids: [v2.id] });
  t('approving the new version retires the old', r.s === 200 && one('SELECT is_active a FROM coa_specifications WHERE id = ?', draft.id).a === 0
    && one('SELECT is_active a FROM coa_specifications WHERE id = ?', v2.id).a === 1);
  r = await call('POST', '/coa/specifications', { item_number: 'WIN-2', item_description: 'Spec check', test_type: 'Lead', unit: 'ppm', approve_now: true });
  t('"save and approve" a heavy metal with no number is refused too', r.s >= 400, `${r.s}`);

  console.log('\n── C3: one Limit box');
  for (const [input, min, max] of [['NMT 1.0', null, 1], ['< 10', null, 10], ['10–50', 10, 50], ['NLT 5', 5, null]]) {
    r = await call('POST', '/coa/specifications/parse-limit', { limit: input });
    t(`"${input}" reads min ${min} / max ${max}, said back in words`, r.s === 200 && r.j.min_value === min && r.j.max_value === max && !!r.j.meaning, JSON.stringify(r.j));
  }
  r = await call('POST', '/coa/specifications/parse-limit', { limit: 'about right' });
  t('a limit that cannot be read is refused in words', r.s === 400 && !!r.j.error);
  r = await call('POST', '/coa/specifications', { item_number: 'WIN-2', item_description: 'Spec check', test_type: 'Mercury', unit: 'ppm', limit: 'NMT 0.1', approve_now: true });
  t('a spec filed through the Limit box carries the parsed number', r.s === 201 && r.j.max_value === 0.1 && r.j.min_value === null, JSON.stringify(r.j).slice(0, 200));
  r = await call('GET', '/coa/specifications/text-only');
  t('the text-only list is served (read-only)', r.s === 200 && Array.isArray(r.j.specs));

  console.log('\n── C5: the gluten "<44" report');
  const g = (await call('POST', '/coa/requests', { item_number: 'WIN-G', item_description: 'Gluten misread', lot_number: '101500', tests_requested: 'Gluten' })).j;
  write(d => {
    d.prepare("INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, pass_fail) VALUES ('g-1', ?, 'Gluten Allergen ReportELISA <', '<44', 'ppm', 'pass')").run(g.id);
    d.prepare("UPDATE coa_requests SET qa_signed_at = datetime('now'), qa_signed_by = 'Old Signer', certificate_number = '000999', status = 'pass' WHERE id = ?").run(g.id);
  });
  const beforeRows = all('SELECT * FROM coa_test_results ORDER BY id');
  r = await call('GET', '/coa/reports/gluten-misread', null, Q);
  t('the report lists the signed certificate with the misread', r.s === 200 && r.j.signed?.some(x => x.request_id === g.id && x.certificate_number === '000999'), JSON.stringify(r.j).slice(0, 200));
  t('… and the correctly read certificate is not on it', !r.j.signed?.some(x => x.request_id === s1.id));
  t('reading the report changed no result', JSON.stringify(all('SELECT * FROM coa_test_results ORDER BY id')) === JSON.stringify(beforeRows));
  r = await call('GET', '/coa/reports/gluten-misread', null, O);
  t('it is Quality\'s and an admin\'s report', r.s === 403);

  console.log('\n── C6: item codes, bulk register, PDF but no plan');
  r = await call('POST', '/coa/requests', { item_number: ' WHEY-77\t', item_description: 'Whey Protein Stick (Chocolate)', lot_number: '101960', tests_requested: 'HM' });
  t('an item code with a tab and spaces is stored trimmed', r.s === 201 && row(r.j.id).item_number === 'WHEY-77', JSON.stringify(row(r.j.id)?.item_number));
  const productsBefore = one('SELECT COUNT(*) c FROM coa_products').c;
  r = await call('POST', '/coa/products/bulk-register', { item_numbers: 'WHEY-77\nNOPE-9\n', brand_owner: 'ProDough' });
  t('the dry run plans one to register and one with no lab request, writing nothing', r.s === 200 && r.j.dry_run === true
    && r.j.register.map(x => x.item_number).join() === 'WHEY-77' && r.j.unknown[0]?.item_number === 'NOPE-9' && one('SELECT COUNT(*) c FROM coa_products').c === productsBefore);
  r = await call('POST', '/coa/products/bulk-register', { item_numbers: 'WHEY-77\nNOPE-9\n', brand_owner: 'ProDough', dry_run: false }, P);
  t('a coa-prep account cannot bulk register', r.s === 403);
  r = await call('POST', '/coa/products/bulk-register', { item_numbers: 'WHEY-77\nNOPE-9\n', brand_owner: 'ProDough', dry_run: false });
  t('the commit registers it as ProDough', r.s === 200 && r.j.registered === 1 && one("SELECT brand_owner b FROM coa_products WHERE item_number = 'WHEY-77'")?.b === 'ProDough');
  r = await call('POST', '/coa/products/bulk-register', { item_numbers: 'WHEY-77', brand_owner: 'ProDough' });
  t('a second run names it as already on the list', r.j.already?.[0]?.item_number === 'WHEY-77' && r.j.register.length === 0);
  r = await call('GET', '/coa/products/no-plan');
  t('WIN-1 has lab report PDFs and no plan, and is listed', r.s === 200 && r.j.items.some(i => i.item_number === 'WIN-1' && i.plan_state === 'not_registered'));

  console.log('\n── C7: a re-issued report replaces');
  const x = s4.id; // signed, CTLA 183621, lot 101957
  const y = (await call('POST', '/coa/requests', { item_number: 'WIN-1', item_description: 'Whey Protein Pouch (Vanilla)', lot_number: '101957', tests_requested: 'HM & Micro' })).j;
  const yf = (await upload(`/coa/requests/${y.id}/files`, fixture('183621'), 'ctla-183621-reissued.pdf', { file_type: 'lab_results' })).j;
  r = await call('POST', `/coa/requests/${y.id}/results`, { source_file_id: yf.id, results: REPORT_ROWS });
  t('the same CTLA ID on another request for the same lot asks which it replaces', r.s === 409 && r.j.needs_replaces === true && r.j.candidates.some(c => c.id === x));
  r = await call('POST', `/coa/requests/${y.id}/results`, { source_file_id: yf.id, results: REPORT_ROWS, replaces_request_id: x });
  t('… and refuses while that request holds a live signature', r.s === 409 && r.j.replaces_signed === true);
  await call('DELETE', `/coa/requests/${x}/sign`, { reason: 'The lab re-issued the report' });
  r = await call('POST', `/coa/requests/${y.id}/results`, { source_file_id: yf.id, results: REPORT_ROWS, replaces_request_id: x });
  t('once un-signed through the correction path, applying marks it replaced', r.s === 201 && row(x).replaced_by_request_id === y.id && row(y.id).replaces_request_id === x);
  t('the replacement is audited as a void', !!one("SELECT 1 z FROM audit_log WHERE entity_id = ? AND action = 'void'", x));
  r = await call('POST', `/coa/requests/${x}/sign`, { signature: SIG, signature_password: 'Admin-Win-2026' });
  t('a replaced request can never be signed again', r.s === 409 && r.j.replaced === true);

  console.log('\n── C8: coa-prep prepares, never decides');
  r = await call('PUT', '/coa/products/WIN-1', { display_name: 'Whey Pouch Vanilla' }, P);
  t('Pia puts an item on the COA product list', r.s === 200);
  r = await call('POST', '/coa/plans', { name: 'Whey draft plan' }, P);
  t('… and starts a draft plan', r.s === 201);
  r = await call('POST', `/coa/plans/${r.j.id}/approve`, { signature_password: 'Pia-Win-2026' }, P);
  t('… and cannot approve it', r.s === 403);
  r = await call('POST', '/coa/specifications', { item_number: 'WIN-1', item_description: 'x', test_type: 'Cadmium', limit: 'NMT 0.1' }, P);
  t('she cannot file a specification', r.s === 403);
  r = await call('POST', '/coa/specifications/drafts/approve', { ids: [v2.id] }, P);
  t('… nor approve one', r.s === 403);
  r = await call('POST', `/coa/requests/${y.id}/sign`, { signature: SIG, signature_password: 'Pia-Win-2026' }, P);
  t('… nor sign', r.s === 403);
  r = await call('POST', `/coa/requests/${y.id}/results`, { results: [{ test_type: 'Lead', result_value: '0.01' }] }, P);
  t('… nor add results', r.s === 403);
  r = await call('PUT', `/coa/requests/${y.id}`, { status: 'pass' }, P);
  t('… nor set a status', r.s === 403);
  r = await call('PUT', `/coa/requests/${y.id}`, { notes: 'Pallet 3 of 4' }, P);
  t('… but she may fill in an unsigned request\'s fields', r.s === 200);

  console.log('\n── C9: paging, "not read yet", stored vs printed');
  r = await call('GET', '/coa/requests?limit=2&offset=0');
  const p1 = r.j.requests.map(q => q.id);
  r = await call('GET', '/coa/requests?limit=2&offset=2');
  t('offset pages the list', r.j.offset === 2 && r.j.shown === 2 && !r.j.requests.some(q => p1.includes(q.id)));
  const z = (await call('POST', '/coa/requests', { item_number: 'WIN-1', item_description: 'Whey Protein Pouch (Vanilla)', lot_number: '101954', tests_requested: 'HM & Micro', received_date: '2026-10-27' })).j;
  await upload(`/coa/requests/${z.id}/files`, fixture('183621'), 'unread.pdf', { file_type: 'lab_results' });
  r = await call('GET', '/coa/requests?search=101954&limit=50');
  t('a lab report attached and not applied reads "not read yet"', r.j.requests.find(q => q.id === z.id)?.unread_reports === 1
    && r.j.requests.find(q => q.id === s1.id)?.unread_reports === 0);
  r = await call('GET', `/coa/requests/${z.id}/sign-facts`);
  const fact = (k) => r.j.facts?.find(f => f.key === k);
  t('the sign dialog compares the stored lot with the printed one', r.s === 200 && fact('lot')?.printed === '101954' && fact('lot')?.agree === true, JSON.stringify(r.j.facts));
  t('… the date received', fact('date')?.printed === '2026-10-27' && fact('date')?.agree === true);
  t('… and gluten, from the report even before it is applied', fact('gluten')?.printed === '<4 ppm');
  await call('PUT', `/coa/requests/${z.id}`, { lot_number: '101945' });
  r = await call('GET', `/coa/requests/${z.id}/sign-facts`);
  t('a lot typed wrong reads as disagreeing', r.j.facts.find(f => f.key === 'lot')?.agree === false);
} catch (e) {
  fail++; console.log(`  ✗ threw: ${e.stack}`);
} finally {
  stop();
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
