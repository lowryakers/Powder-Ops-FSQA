#!/usr/bin/env node
// verify:coaphase1 — COA Phase 1 part 1 (D-236 … D-239), live, on a temporary
// database, plus a real browser.
//
//  1. Boot once (schema + the COA history seed), stop, file the 43 decided
//     requests as fixtures in their real states, clear the seed marker, and
//     boot again: the 43 QA Review items appear and NOTHING on a request moves.
//  2. Boot a third time with the marker cleared again: 0 inserted, same rows.
//  3. QA Review: the pile, its derived steps, and the panel shape; the scoped
//     un-sign / delete for Quality; the one held request; an admin's dismiss.
//  4. Brands: create, bulk preview / apply / idempotent / refusals.
//  5. The browser: action rows with no Sign button, the deep link into COA,
//     and the Lab Requests list loading every request at once.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { isPublicPath } from '../server/middleware/auth.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COA_P1_PORT || 4618);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coa-p1-'));
const dbPath = path.join(dir, 'p1.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const open = () => new Database(dbPath);
const one = (sql, ...a) => { const d = open(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = open(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SEED = JSON.parse(readFileSync(path.join(root, 'server/seed/coa-phase1-review-items.json'), 'utf8')).items;

let child = null;
const out = [];
async function boot() {
  child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', HOUSEKEEPING_MS: '999999999' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* booting */ } await sleep(500); }
  console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1);
}
async function stop() {
  if (!child) return;
  const c = child; child = null;
  await new Promise(r => { c.once('exit', r); c.kill('SIGTERM'); setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 3000); });
}
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

// Every row of the COA tables, hashed — except base_lot / batch, the two new
// columns the boot fills from the lot as written (D-237).
function coaHashes() {
  const d = open();
  try {
    const h = {};
    for (const [table, skip] of [['coa_requests', ['base_lot', 'batch']], ['coa_test_results', []], ['coa_files', []], ['coa_brands', []], ['coa_settings', []]]) {
      for (const r of d.prepare(`SELECT * FROM ${table}`).all()) {
        const copy = { ...r }; for (const k of skip) delete copy[k];
        h[`${table}:${r.id ?? r.key}`] = crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
      }
    }
    return h;
  } finally { d.close(); }
}
const sameHashes = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => a[k] !== b[k]);
};

try {
  // ── 1. Fresh boot, then the 43 requests in their real states ──────────────
  await boot();
  await stop();
  {
    const d = open();
    const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
    const adminName = d.prepare("SELECT name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get().name;
    d.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-P1-2026!'), adminName);
    d.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES ('p1-qa', 'Mara Quality', 'Mara Quality', 'supervisor', 'qa', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Quality-P1-2026!'));
    d.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES ('p1-op', 'Otto Floor', 'Otto Floor', 'operator', 'warehouse', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Operator-P1-2026!'));
    writeFileSync(path.join(dir, 'admin-name'), adminName);
    const lab = d.prepare('SELECT id, name FROM coa_labs LIMIT 1').get();
    const insReq = d.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, lab_id, lab_name, date_sent, source, created_by,
      qa_signed_by, qa_signed_at, qa_signature, certificate_number, date_of_issuance)
      VALUES (?, ?, ?, ?, 'HM & Micro', ?, ?, ?, '2026-08-01', ?, 'fixture', ?, ?, ?, ?, ?)`);
    const insRes = d.prepare('INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, pass_fail) VALUES (?, ?, ?, ?, ?, ?)');
    const insFile = d.prepare("INSERT INTO coa_files (id, request_id, file_type, filename, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, 'lab_results', ?, ?, 'application/pdf', ?, 'fixture')");
    mkdirSync(path.join(dir, 'coa-files'), { recursive: true });
    const pdf = readFileSync(path.join(root, 'scripts/fixtures/coa/ctla-176906.pdf'));
    let cert = 190000;
    const signedReq = (id, item, lot, status = 'pass') => insReq.run(id, item, `P1 ${item}`, lot, status, lab?.id || null, lab?.name || 'CTLA', 'ctla_coa_upload',
      'Earlier Signer', '2026-08-15 10:00:00', SIG, String(cert++), '2026-08-15');
    const unsignedReq = (id, item, lot, status = 'pass', source = 'ctla_coa_upload') => insReq.run(id, item, `P1 ${item}`, lot, status, lab?.id || null, lab?.name || 'CTLA', source,
      null, null, null, null, null);
    const file = (fileId, reqId, name) => { const fn = `${fileId}.pdf`; writeFileSync(path.join(dir, 'coa-files', fn), pdf); insFile.run(fileId, reqId, fn, name, pdf.length); };
    const gluten44 = (reqId, two) => {
      insRes.run(crypto.randomUUID(), reqId, 'Gluten Allergen ReportELISA <', '<44', 'ppm', 'pass');
      if (two) insRes.run(crypto.randomUUID(), reqId, 'Gluten Allergen', '<44', 'ppm', 'pass');
      insRes.run(crypto.randomUUID(), reqId, 'Total Aerobic Microbial Count (USP)', '<100', 'cfu/g', 'pass');
    };
    // One of the 43 is also in the shipped COA history; file every fixture fresh.
    const allIds = [...new Set([...SEED.map(x => x.request_id), ...SEED.map(x => x.canonical_request_id).filter(Boolean)])];
    for (const id of allIds) {
      d.prepare('DELETE FROM coa_test_results WHERE request_id = ?').run(id);
      d.prepare('DELETE FROM coa_files WHERE request_id = ?').run(id);
      d.prepare('DELETE FROM coa_requests WHERE id = ?').run(id);
    }
    const made = new Set();
    for (const s of SEED) {
      if (made.has(s.request_id)) continue;
      made.add(s.request_id);
      if (s.kind === 'DELETE_DUPLICATE') { unsignedReq(s.request_id, 'DUP', s.lot, 'pending'); continue; }
      if (s.kind === 'CORRECT_ONLY') unsignedReq(s.request_id, s.item_number, s.lot, 'sent');
      else signedReq(s.request_id, s.item_number, s.lot);
      if (s.kind === 'UNSIGN_FAILED') insRes.run(crypto.randomUUID(), s.request_id, 'Total Aerobic Microbial Count (USP)', '7,400,000', 'cfu/g', 'fail');
      else gluten44(s.request_id, s.note === 'dupGluten=Y');
      file(s.file_id, s.request_id, s.file_name);
    }
    // The canonical requests that keep each duplicate's lab report.
    for (const s of SEED.filter(x => x.kind === 'DELETE_DUPLICATE')) {
      if (made.has(s.canonical_request_id)) continue;
      made.add(s.canonical_request_id);
      unsignedReq(s.canonical_request_id, 'CANON', s.lot, 'pass');
      file(s.file_id, s.canonical_request_id, s.file_name);
    }
    // One ordinary signed certificate and one ordinary request no item names.
    signedReq('p1-other-signed', 'OTHER', '555001');
    unsignedReq('p1-other-unsigned', 'OTHER', '555002', 'pending');
    d.prepare("DELETE FROM app_settings WHERE key = 'coa_phase1_review_items_seeded_v1'").run();
    d.prepare('DELETE FROM coa_review_items').run();
    d.close();
  }
  const admin = readFileSync(path.join(dir, 'admin-name'), 'utf8');
  const before = coaHashes();

  console.log('── the 43 items are filed once, and no request moves (D-236)');
  await boot();
  const afterSeed = coaHashes();
  const items = all('SELECT kind, COUNT(*) n FROM coa_review_items GROUP BY kind');
  const n = Object.fromEntries(items.map(r => [r.kind, r.n]));
  t('43 items: 17 RESIGN, 1 UNSIGN_CORRECT_NO_RESIGN, 3 UNSIGN_FAILED, 1 CORRECT_ONLY, 21 DELETE_DUPLICATE',
    n.RESIGN === 17 && n.UNSIGN_CORRECT_NO_RESIGN === 1 && n.UNSIGN_FAILED === 3 && n.CORRECT_ONLY === 1 && n.DELETE_DUPLICATE === 21, JSON.stringify(n));
  t('the seed wrote one audit row naming the decision', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_review_items' AND details LIKE '%seeded 43 items, decision A-20261027-001%'"));
  t('booting with the items changed no COA row (base_lot/batch aside)', sameHashes(before, afterSeed).length === 0, sameHashes(before, afterSeed).slice(0, 5).join(', '));
  t('base_lot and batch were filled from the lot as written', one("SELECT base_lot b, batch c FROM coa_requests WHERE id = '8f122ca9-cdb1-49e4-8011-55f24b3c90da'")?.b === '101690'
    && one("SELECT batch c FROM coa_requests WHERE id = '8f122ca9-cdb1-49e4-8011-55f24b3c90da'")?.c === '1'
    && one("SELECT lot_number l FROM coa_requests WHERE id = '8f122ca9-cdb1-49e4-8011-55f24b3c90da'")?.l === '101690-1');
  await stop();
  { const d = open(); d.prepare("DELETE FROM app_settings WHERE key = 'coa_phase1_review_items_seeded_v1'").run(); d.close(); }
  const itemsBefore = all('SELECT * FROM coa_review_items ORDER BY item_key');
  await boot();
  t('a second seeding run inserts 0 and leaves the items as they were', JSON.stringify(all('SELECT * FROM coa_review_items ORDER BY item_key')) === JSON.stringify(itemsBefore)
    && !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_review_items' AND details LIKE '%seeded 0 items%'"));
  t('… and every COA row is still byte-identical (no code path touched the 43)', sameHashes(before, coaHashes()).length === 0);

  // ── sessions ──────────────────────────────────────────────────────────────
  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(admin, 'Admin-P1-2026!');
  const Q = await login('Mara Quality', 'Quality-P1-2026!');
  const O = await login('Otto Floor', 'Operator-P1-2026!');
  t('admin, Quality and an operator signed in', !!A && !!Q && !!O);
  const call = async (m, p, b, tok = Q) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { s: r.status, j: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const QPW = { signature_password: 'Quality-P1-2026!' };
  const req = (id) => one('SELECT * FROM coa_requests WHERE id = ?', id);
  const item = (id, kind) => one('SELECT * FROM coa_review_items WHERE request_id = ? AND kind = ?', id, kind);
  const pile = async () => (await call('GET', '/qa-review?source=coa-corrections')).j.sources.find(s => s.key === 'coa-corrections');
  const rowOf = async (rid) => (await pile()).items.find(i => i.request_id === rid);

  console.log('\n── QA Review: the COA corrections pile');
  let r = await call('GET', '/qa-review');
  const src = r.j.sources.find(s => s.key === 'coa-corrections');
  t('a QA reviewer sees "COA corrections" with 43, as an action source', r.s === 200 && src?.count === 43 && src?.kind === 'action' && src?.can_sign === false, JSON.stringify({ count: src?.count, kind: src?.kind }));
  t('… counted in the QA Review total', r.j.total >= 43);
  const SHAPE = ['can_sign', 'count', 'form', 'items', 'key', 'label', 'module', 'noun', 'plural', 'view'].join();
  t('every other source keeps exactly its old JSON shape (no `kind`)', r.j.sources.filter(s => s.key !== 'coa-corrections').every(s => Object.keys(s).sort().join() === SHAPE),
    r.j.sources.filter(s => s.key !== 'coa-corrections').map(s => Object.keys(s).sort().join()).find(k => k !== SHAPE) || '');
  t('the operator gets 403', (await call('GET', '/qa-review', null, O)).s === 403);
  const resignRow = await rowOf('3818f512-e1d2-4614-b1c8-f0bffd78f75f');
  t('a row carries the recommended action, reason, steps and evidence links', /correct the gluten result to <4 ppm, then sign again/.test(resignRow?.recommended_action || '')
    && /"<44 ppm"/.test(resignRow?.reason || '') && resignRow?.steps.map(s => s.key).join() === 'unsign,gluten,resign'
    && resignRow.evidence.some(e => e.kind === 'file' && e.file_id === 'ea894197-6dd0-4a22-9067-6aa182538f23'));
  t('the re-test 9e8cb2b4 carries the plain note', /valid re-test that followed the failed request 8afd7fbe/.test((await rowOf('9e8cb2b4-3e5d-49f1-bc3b-99327147d012'))?.note || ''));
  t('the bell carries the pile for Quality', ((await call('GET', '/compliance/notifications')).j?.items || (await call('GET', '/compliance/notifications')).j || []).some?.(i => i.id === 'coa-corrections' && i.count === 43) ?? false);
  r = await call('GET', `/coa/files/${resignRow.evidence.find(e => e.kind === 'file').file_id}/download`);
  t('the evidence link downloads the lab report through the COA route', r.s === 200 && Buffer.isBuffer(r.j) && r.j.subarray(0, 4).toString() === '%PDF');
  t('a POST to sign from the pile is refused (it is not a signature)', (await call('POST', '/qa-review/sign', { source: 'coa-corrections', ids: [resignRow.id], ...QPW })).s === 403);

  console.log('\n── a RESIGN item: un-sign → correct → sign, the steps tick themselves');
  const R = '3818f512-e1d2-4614-b1c8-f0bffd78f75f';
  t('the detail tells Quality it may un-sign this one', (await call('GET', `/coa/requests/${R}`)).j.correction?.unsign === true);
  t('… and not an ordinary signed certificate', (await call('GET', '/coa/requests/p1-other-signed')).j.correction?.unsign === false);
  t('Quality cannot un-sign a request no item names (403)', (await call('DELETE', '/coa/requests/p1-other-signed/sign', { reason: 'testing', ...QPW })).s === 403);
  t('… nor the operator one that is named', (await call('DELETE', `/coa/requests/${R}/sign`, { reason: 'testing', signature_password: 'Operator-P1-2026!' }, O)).s === 403);
  t('un-signing needs a reason', (await call('DELETE', `/coa/requests/${R}/sign`, {})).s === 400);
  r = await call('DELETE', `/coa/requests/${R}/sign`, { reason: 'Gluten misread, decision A-20261027-001' });
  t('… and the password (403 signature_required, never 401)', r.s === 403 && r.j.signature_required === true, JSON.stringify(r.j));
  r = await call('DELETE', `/coa/requests/${R}/sign`, { reason: 'Gluten misread, decision A-20261027-001', ...QPW });
  t('with both, Quality un-signs it', r.s === 200 && !req(R).qa_signed_at);
  t('… audited with the item and the decision', !!one("SELECT 1 x FROM audit_log WHERE entity_id = ? AND action = 'unsign' AND details LIKE ? AND details LIKE '%A-20261027-001%'", R, `%coa-p1:RESIGN:${R}%`));
  let row = await rowOf(R);
  t('step 1 ticks; step 2 waits', row.steps.map(s => s.done).join() === 'true,false,false', row.steps.map(s => s.done).join());
  const gl = all("SELECT id, test_type FROM coa_test_results WHERE request_id = ? AND test_type LIKE '%gluten%'", R);
  await call('DELETE', `/coa/requests/${R}/results/${gl[1].id}`);
  row = await rowOf(R);
  t('one gluten row deleted is not yet a correction (it still reads <44)', row.steps[1].done === false);
  r = await call('PUT', `/coa/requests/${R}/results/${gl[0].id}`, { test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm', pass_fail: 'pass' });
  row = await rowOf(R);
  t('corrected to one "Gluten Allergen" <4 ppm: step 2 ticks', r.s === 200 && row.steps.map(s => s.done).join() === 'true,true,false', row.steps.map(s => s.done).join());
  r = await call('POST', `/coa/requests/${R}/sign`, { signature: SIG, ...QPW });
  t('signed again with a NEW number', r.s === 200 && Number(req(R).certificate_number) >= 190000 && req(R).qa_signed_by === 'Mara Quality', JSON.stringify(r.j).slice(0, 200));
  t('… the item is complete and leaves the pile (42)', !(await rowOf(R)) && (await pile()).count === 42);
  t('… and no longer authorizes an un-sign', (await call('GET', `/coa/requests/${R}`)).j.correction?.unsign === false);

  console.log('\n── the held request (8afd7fbe) and the re-test (9e8cb2b4)');
  const H = '8afd7fbe-3ed0-4257-b22b-95c16eccff75', T2 = '9e8cb2b4-3e5d-49f1-bc3b-99327147d012';
  const fixGluten = async (id) => {
    const g = all("SELECT id FROM coa_test_results WHERE request_id = ? AND test_type LIKE '%gluten%'", id);
    for (const x of g.slice(1)) await call('DELETE', `/coa/requests/${id}/results/${x.id}`);
    return call('PUT', `/coa/requests/${id}/results/${g[0].id}`, { test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm', pass_fail: 'pass' });
  };
  r = await call('DELETE', `/coa/requests/${H}/sign`, { reason: 'Signed on a failed lot', ...QPW });
  await fixGluten(H);
  t('Quality un-signs and corrects the failed-lot request; its item is complete', r.s === 200 && !(await rowOf(H)));
  r = await call('POST', `/coa/requests/${H}/sign`, { signature: SIG, ...QPW });
  t('it CANNOT be signed while its item is open (409, held)', r.s === 409 && r.j.held === true && /Held: failed-lot correction A-20261027-001/.test(r.j.error), JSON.stringify(r.j));
  t('… for an admin too', (await call('POST', `/coa/requests/${H}/sign`, { signature: SIG, signature_password: 'Admin-P1-2026!' }, A)).s === 409);
  const hItem = item(H, 'UNSIGN_CORRECT_NO_RESIGN');
  t('Quality cannot dismiss the item (admin only)', (await call('POST', `/coa/review-items/${hItem.id}/dismiss`, { reason: 'try' })).s === 403);
  t('an admin needs a reason', (await call('POST', `/coa/review-items/${hItem.id}/dismiss`, {}, A)).s === 400);
  r = await call('POST', `/coa/review-items/${hItem.id}/dismiss`, { reason: 'Re-test accepted, lot released on 9e8cb2b4' }, A);
  t('an admin dismisses it with a reason, recorded', r.s === 200 && item(H, 'UNSIGN_CORRECT_NO_RESIGN').status === 'dismissed'
    && !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_review_item' AND action = 'dismiss' AND details LIKE '%Re-test accepted%'"));
  t('… which lifts the hold', (await call('POST', `/coa/requests/${H}/sign`, { signature: SIG, ...QPW })).s === 200);
  r = await call('DELETE', `/coa/requests/${T2}/sign`, { reason: 'Gluten misread', ...QPW });
  await fixGluten(T2);
  r = await call('POST', `/coa/requests/${T2}/sign`, { signature: SIG, ...QPW });
  t('the re-test 9e8cb2b4 is NOT held: un-signed, corrected, signed again', r.s === 200 && !(await rowOf(T2)), JSON.stringify(r.j).slice(0, 160));

  console.log('\n── UNSIGN_FAILED, CORRECT_ONLY');
  const F1 = '568388b9-4d58-4a8f-b052-e20c9fa46020';
  r = await call('DELETE', `/coa/requests/${F1}/sign`, { reason: 'Signed on a failed lot', ...QPW });
  t('a failed-lot certificate is un-signed by Quality and its item completes', r.s === 200 && !req(F1).qa_signed_at && !(await rowOf(F1)));
  const C = '1b26e549-0dc3-449d-8138-6381e6e42e9b';
  t('CORRECT_ONLY grants no un-sign and no delete', (await call('GET', `/coa/requests/${C}`)).j.correction?.unsign === false && (await call('GET', `/coa/requests/${C}`)).j.correction?.delete === false);
  t('the CORRECT_ONLY item names the lot spelling to confirm', /10169-1/.test((await rowOf(C))?.note || ''));
  await fixGluten(C);
  t('… and completes once the gluten line reads <4 ppm', !(await rowOf(C)));

  console.log('\n── DELETE_DUPLICATE');
  const D1 = 'e2fad74c-6e40-4151-a901-e33e945eefa1', D2 = '1fe1a66e-1842-45a4-8a84-9d457656f7d4';
  const list = (await call('GET', '/coa/requests?limit=5000')).j;
  const flagD = list.requests.find(x => x.id === D1)?.correction;
  t('… the list carries correction.delete for the duplicate and not for an ordinary request',
    flagD?.delete === true && list.requests.find(x => x.id === 'p1-other-unsigned')?.correction?.delete === false);
  t('Quality cannot delete a request no item names', (await call('POST', '/coa/requests/bulk-delete', { ids: ['p1-other-unsigned'], reason: 'tidy', ...QPW })).s === 403);
  t('… nor a duplicate mixed with one that is not', (await call('POST', '/coa/requests/bulk-delete', { ids: [D1, 'p1-other-unsigned'], reason: 'tidy', ...QPW })).s === 403 && !!req(D1));
  t('… nor a failed-lot request (its item authorizes an un-sign, not a delete)', (await call('POST', '/coa/requests/bulk-delete', { ids: [F1], reason: 'tidy', ...QPW })).s === 403);
  t('a reason is required', (await call('POST', '/coa/requests/bulk-delete', { ids: [D1], ...QPW })).s === 400);
  t('the password is required', (await call('POST', '/coa/requests/bulk-delete', { ids: [D1], reason: 'Empty duplicate of 515f3457' })).s === 403 && !!req(D1));
  { const d = open(); d.prepare("INSERT INTO coa_test_results (id, request_id, test_type, result_value) VALUES ('p1-stray', ?, 'Lead', '1')").run(D2); d.close(); }
  r = await call('POST', '/coa/requests/bulk-delete', { ids: [D2], reason: 'Empty duplicate', ...QPW });
  t('a "duplicate" that has a result is refused (409) and kept', r.s === 409 && /test results/.test(r.j.error) && !!req(D2));
  r = await call('POST', '/coa/requests/bulk-delete', { ids: [D1], reason: 'Empty duplicate of 515f3457', ...QPW });
  t('Quality deletes the empty duplicate with a reason and the password', r.s === 200 && r.j.deleted === 1 && !req(D1));
  t('… audited with the item and the decision', !!one("SELECT 1 x FROM audit_log WHERE entity_id = ? AND action = 'delete' AND details LIKE ?", D1, `%coa-p1:DELETE_DUPLICATE:${D1}%`));
  t('… its item is complete, off the pile, and the row is kept for history', !(await rowOf(D1)) && !!item(D1, 'DELETE_DUPLICATE'));
  t('the deep link to a deleted request says it no longer exists (404)', (await call('GET', `/coa/requests/${D1}`)).s === 404);
  r = await call('POST', '/coa/requests/bulk-delete', { ids: ['p1-other-unsigned'] }, A);
  t('an admin is unchanged: deletes an ordinary request with no reason or password', r.s === 200 && r.j.deleted === 1);
  const pileNow = (await pile()).count;
  t(`the pile now reads ${pileNow} (43 − 1 re-signed − 1 held − 1 re-test − 1 failed − 1 corrected − 1 deleted = 37)`, pileNow === 37, String(pileNow));

  console.log('\n── a bot token can write none of it');
  r = await call('POST', '/api-tokens', { user_id: 'p1-qa', label: 'p1 check', scopes: ['read', 'write'] }, A);
  const TOK = r.j.plaintext;
  t('a test token was minted on the temporary database', !!TOK, JSON.stringify(r.j).slice(0, 120));
  const D3 = '905b6c57-91d6-4426-b1cb-66214ef218fe';
  t('token: un-sign refused', [401, 403].includes((await call('DELETE', `/coa/requests/${'7615afb8-f2c4-4cd6-9295-0099412bb602'}/sign`, { reason: 'bot', ...QPW }, TOK)).s));
  t('token: delete refused', [401, 403].includes((await call('POST', '/coa/requests/bulk-delete', { ids: [D3], reason: 'bot', ...QPW }, TOK)).s) && !!req(D3));
  t('token: dismiss refused', [401, 403].includes((await call('POST', `/coa/review-items/${item(D3, 'DELETE_DUPLICATE').id}/dismiss`, { reason: 'bot' }, TOK)).s));
  t('token: brand bulk refused', [401, 403].includes((await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'preview', rows: [{ request_id: D3, brand_owner: 'ProDough' }] }, TOK)).s));
  t('token: new brand refused', [401, 403].includes((await call('POST', '/coa/brands', { name: 'Bot Brand' }, TOK)).s));
  const NEW_ROUTES = [['GET', '/api/coa/review-items'], ['POST', '/api/coa/review-items/x/dismiss'], ['POST', '/api/coa/brands'], ['POST', '/api/coa/requests/brand-owner/bulk'],
    ['DELETE', '/api/coa/requests/x/sign'], ['POST', '/api/coa/requests/bulk-delete'], ['GET', '/api/qa-review']];
  t('none of the routes is public', NEW_ROUTES.every(([method, p]) => !isPublicPath({ method, path: p })));
  for (const [m, p] of [['GET', '/qa-review'], ['GET', '/coa/review-items'], ['POST', '/coa/brands']]) {
    const x = await fetch(BASE + p.replace('/api', ''), { method: m });
    t(`no session: ${m} ${p} is refused`, [401, 403].includes(x.status));
  }

  console.log('\n── brands: create, bulk assign (D-238)');
  t('the operator cannot add a brand', (await call('POST', '/coa/brands', { name: 'KOH' }, O)).s === 403);
  t('a one-letter name is refused', (await call('POST', '/coa/brands', { name: 'K' })).s === 400);
  r = await call('POST', '/coa/brands', { name: 'KOH' });
  t('Quality adds a brand', r.s === 201 && r.j.name === 'KOH');
  t('… a duplicate name is refused', (await call('POST', '/coa/brands', { name: 'koh' })).s === 409);
  const ids = all("SELECT id FROM coa_requests WHERE brand_owner = 'unassigned' AND source != 'ctla_coa_upload' LIMIT 6").map(x => x.id);
  { const d = open(); d.prepare("UPDATE coa_requests SET brand_owner = 'ProDough' WHERE id = ?").run(ids[5]); d.close(); }
  const rows = [
    { request_id: ids[0], brand_owner: 'ProDough', confidence: 'high' },
    { request_id: ids[1], brand_owner: 'KOH', confidence: 'medium' },
    { request_id: ids[2], brand_owner: 'M4', confidence: 'high' },
    { request_id: ids[3], brand_owner: 'unassigned' },
    { request_id: 'no-such-request', brand_owner: 'ProDough' },
    { request_id: ids[5], brand_owner: 'KOH' },
  ];
  const snapshot = () => JSON.stringify(all('SELECT id, brand_owner FROM coa_requests ORDER BY id'));
  const beforeBrands = snapshot();
  r = await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'preview', rows });
  t('preview: 2 changes, 1 no-op, 3 errors (unknown request, unknown brand M4, already assigned)', r.s === 200 && r.j.changes === 2 && r.j.no_ops === 1 && r.j.errors === 3, JSON.stringify({ c: r.j.changes, n: r.j.no_ops, e: r.j.errors }));
  t('… counts per brand and per confidence', r.j.plan.by_brand.ProDough === 1 && r.j.plan.by_brand.KOH === 1 && r.j.plan.by_confidence.high === 1 && r.j.plan.by_confidence.medium === 1);
  t('… and the preview wrote nothing', snapshot() === beforeBrands);
  r = await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'preview', rows, create_missing_brands: true });
  t('with create_missing_brands the preview names M4 as a brand it would add', r.j.plan.brands_to_create.join() === 'M4' && r.j.changes === 3 && !one("SELECT 1 x FROM coa_brands WHERE name = 'M4'"));
  t('apply needs a reason', (await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'apply', rows, create_missing_brands: true, ...QPW })).s === 400);
  t('apply needs the password', (await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'apply', rows, create_missing_brands: true, reason: 'Reviewed proposals' })).s === 403 && snapshot() === beforeBrands);
  r = await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'apply', rows, create_missing_brands: true, reason: 'Reviewed proposals', ...QPW });
  t('apply: 3 assigned in one act, M4 created', r.s === 200 && r.j.changes === 3 && r.j.brands_created.join() === 'M4'
    && req(ids[0]).brand_owner === 'ProDough' && req(ids[1]).brand_owner === 'KOH' && req(ids[2]).brand_owner === 'M4', JSON.stringify(r.j).slice(0, 200));
  t('… the unassigned target and the already-assigned request are untouched', req(ids[3]).brand_owner === 'unassigned' && req(ids[5]).brand_owner === 'ProDough');
  t('… one audit row per request carrying the batch id, plus one batch row', all("SELECT details FROM audit_log WHERE entity_type = 'coa_request' AND details LIKE ?", `%${r.j.batch_id}%`).length === 3
    && !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_brand_assignment' AND entity_id = ?", r.j.batch_id));
  r = await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'apply', rows: rows.slice(0, 3), reason: 'again', ...QPW });
  t('a second apply changes nothing (3 no-ops)', r.s === 200 && r.j.changes === 0 && r.j.no_ops === 3);
  t('Quality cannot pass allow_change', (await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'preview', allow_change: true, reason: 'x y z', rows: [{ request_id: ids[5], brand_owner: 'KOH' }] })).s === 403);
  r = await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'preview', allow_change: true, reason: 'Wrong brand on import', rows: [{ request_id: ids[5], brand_owner: 'KOH' }] }, A);
  t('an admin with allow_change and a reason may change an assigned request', r.s === 200 && r.j.changes === 1);
  t('more than 2,000 rows is refused', (await call('POST', '/coa/requests/brand-owner/bulk', { mode: 'preview', rows: Array.from({ length: 2001 }, (_, i) => ({ request_id: `x${i}`, brand_owner: 'KOH' })) })).s === 400);
  // The brand chosen when a request is filed (D-240).
  const newReq = (b, tok = Q) => call('POST', '/coa/requests', { item_number: 'P1-NEW', item_description: 'Brand at filing', lot_number: '777001', tests_requested: 'HM & Micro', ...b }, tok);
  r = await newReq({ brand_owner: 'KOH' });
  t('Quality files a new request with its brand', r.s === 201 && req(r.j.id).brand_owner === 'KOH');
  r = await newReq({});
  t('… and without one it is unassigned, as before', r.s === 201 && req(r.j.id).brand_owner === 'unassigned');
  t('a brand not on the list is refused (400)', (await newReq({ brand_owner: 'Nobody Inc' })).s === 400);
  t('the operator cannot set a brand at filing (403)', (await newReq({ brand_owner: 'KOH' }, O)).s === 403);
  t('every brand is closed to publishing', all('SELECT public_publish_allowed p FROM coa_brands').every(b => b.p === 0));
  t('the release gate is still warn and the settings still never / hidden', (await call('GET', '/coa/release-gate')).j.mode === 'warn'
    && one("SELECT value v FROM coa_settings WHERE key = 'evidence_disclosure_mode'").v === 'never'
    && one("SELECT value v FROM coa_settings WHERE key = 'public_nonclaim_gluten_display'").v === 'hidden');
  r = await call('GET', '/coa/release-gate');
  t('the per-lot gluten roll-up is reported, advisory', !!r.j.lot_rollup && Array.isArray(r.j.lot_rollup.not_met));
  t('the base-lot filter returns every batch of lot 101690', (await call('GET', '/coa/requests?base_lot=101690&limit=5000')).j.requests.map(x => x.batch).sort().join() === '1,2');

  // ── 5. the browser ────────────────────────────────────────────────────────
  console.log('\n── in a browser: the pile, the deep link, the whole list');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    await page.evaluate((tok) => localStorage.setItem('auth_token', tok), Q);
    await page.goto(`http://127.0.0.1:${PORT}/?tab=qa-review`);
    await page.getByText('COA corrections', { exact: true }).first().click();
    await page.waitForSelector('[data-action-row]', { timeout: 20000 });
    const nRows = await page.locator('[data-action-row]').count();
    t('QA Review lists the corrections as action rows', nRows > 0, String(nRows));
    t('… with no Sign button and no checkbox', await page.locator('[data-action-source] [data-review-sign]').count() === 0
      && await page.locator('[data-action-source] input[type=checkbox]').count() === 0);
    const target = '7615afb8-f2c4-4cd6-9295-0099412bb602';
    await page.locator(`[data-open-request="${target}"]`).click();
    await page.waitForSelector('[data-correction-items]', { timeout: 20000 });
    t('"Open request" lands on that request in COA with its correction and steps', await page.locator('[data-correction-step="unsign"]').count() === 1
      && await page.getByText('Lot: 101712').count() > 0);
    t('… and offers Quality the un-sign the item asks for', await page.locator('[data-unsign]').count() === 1);
    t('Quality is not offered Dismiss on a correction (admin only)', await page.locator('[data-dismiss-item]').count() === 0);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'coa', request: id } })), D1);
    await page.waitForSelector('[data-request-gone]', { timeout: 20000 });
    t('a deep link to a deleted request says "This request no longer exists"', await page.getByText('This request no longer exists').count() === 1);
    await page.getByText('Back to the list').click();
    await page.waitForSelector('table tbody tr', { timeout: 30000 });
    const total = (await call('GET', '/coa/requests?limit=1')).j.total;
    const shown = await page.locator('table tbody tr').count();
    t(`the Lab Requests list loads every request at once (${shown} of ${total}), with no "Load all"`, shown === total
      && await page.getByText(/Load all/).count() === 0 && await page.locator('[data-req-capped]').count() === 0, `${shown}/${total}`);
    t('a batch shows as a chip beside its base lot', await page.locator('[data-batch-chip]').count() > 0);
    await page.getByRole('button', { name: /New Request/i }).first().click();
    await page.waitForSelector('[data-new-brand]', { timeout: 20000 });
    t('the new-request form asks Quality for the brand', await page.locator('[data-new-brand] option', { hasText: 'KOH' }).count() === 1);

    // An admin sees the button on the request and lifts the item with a reason.
    const adminPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await adminPage.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    await adminPage.evaluate((tok) => localStorage.setItem('auth_token', tok), A);
    await adminPage.goto(`http://127.0.0.1:${PORT}/?tab=coa`);
    await adminPage.waitForSelector('table tbody tr', { timeout: 30000 });
    await adminPage.evaluate((id) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'coa', request: id } })), target);
    await adminPage.waitForSelector('[data-dismiss-item]', { timeout: 20000 });
    adminPage.once('dialog', d => d.accept('No longer needed, checked by the admin'));
    await adminPage.locator('[data-dismiss-item]').first().click();
    await adminPage.waitForFunction(() => !document.querySelector('[data-dismiss-item]'), null, { timeout: 20000 });
    t('an admin dismisses a correction from the request screen, with a reason', item(target, 'RESIGN')?.status === 'dismissed'
      && /No longer needed/.test(item(target, 'RESIGN')?.dismissed_reason || ''));
  } finally { await browser.close(); }
} catch (e) {
  fail++; console.error(e);
} finally {
  await stop();
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
