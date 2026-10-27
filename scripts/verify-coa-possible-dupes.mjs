#!/usr/bin/env node
// verify:coadupes — the 59 POSSIBLE duplicates queued for Maria (D-242), live,
// on a temporary database, plus a real browser.
//
//  1. Boot (schema + COA history), stop, file every record the 43 Phase 1 items
//     and the 59 pairs name, clear both markers, boot: 43 + 59 items, and no
//     COA row moves. Boot again with the duplicates marker cleared: 0 inserted,
//     every item and every COA row as it was.
//  2. Maria decides one pair "same test", an admin deletes the record she
//     marked, the item settles; she dismisses another "not a duplicate"; the
//     kind grants her no un-sign and no delete.
//  3. The browser: the block on the request screen, and "Not a duplicate".
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COA_DUP_PORT || 4628);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coa-dup-'));
const dbPath = path.join(dir, 'dup.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const open = () => new Database(dbPath);
const one = (sql, ...a) => { const d = open(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = open(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const DUPS = JSON.parse(readFileSync(path.join(root, 'server/seed/coa-possible-duplicates.json'), 'utf8')).items;
const P1 = JSON.parse(readFileSync(path.join(root, 'server/seed/coa-phase1-review-items.json'), 'utf8')).items;

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

function coaHashes({ skipLots = false } = {}) {
  const d = open();
  try {
    const h = {};
    for (const table of ['coa_requests', 'coa_test_results', 'coa_files']) {
      for (const r of d.prepare(`SELECT * FROM ${table}`).all()) {
        const c = { ...r }; if (skipLots) { delete c.base_lot; delete c.batch; }
        h[`${table}:${r.id}`] = crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
      }
    }
    return h;
  } finally { d.close(); }
}
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
const itemsSnapshot = (where) => JSON.stringify(all(`SELECT * FROM coa_review_items WHERE ${where} ORDER BY item_key`));

const SINGLE = DUPS.find(s => !s.id_b);
const PAIR = DUPS[0];          // a65c364b / ee205dff
const PAIR2 = DUPS[1];

try {
  await boot();
  await stop();
  {
    const d = open();
    const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
    const adminName = d.prepare("SELECT name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get().name;
    d.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-Dup-2026!'), adminName);
    d.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES ('dup-qa', 'Mara Quality', 'Mara Quality', 'supervisor', 'qa', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Quality-Dup-2026!'));
    d.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES ('dup-op', 'Otto Floor', 'Otto Floor', 'operator', 'warehouse', 1, ?, datetime('now'), '{"coa":"edit"}')`).run(hashOf('Operator-Dup-2026!'));
    writeFileSync(path.join(dir, 'admin-name'), adminName);
    const ins = d.prepare(`INSERT OR IGNORE INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, source, created_by)
      VALUES (?, ?, ?, ?, 'HM & Micro', 'pass', 'fixture', 'fixture')`);
    // Every record the two lists name, where the shipped history lacks it.
    for (const s of DUPS) { ins.run(s.id_a, 'DUP-A', s.product, s.lot); if (s.id_b) ins.run(s.id_b, 'DUP-B', s.product, s.lot); }
    for (const s of P1) { ins.run(s.request_id, s.item_number || 'P1', s.item_description || 'P1', s.lot || 'P1'); if (s.canonical_request_id) ins.run(s.canonical_request_id, 'CANON', 'CANON', s.lot || 'P1'); }
    // The single-record item: unsigned, with a result line entered twice.
    d.prepare('UPDATE coa_requests SET qa_signed_at = NULL, qa_signed_by = NULL, certificate_number = NULL WHERE id = ?').run(SINGLE.id_a);
    d.prepare('DELETE FROM coa_test_results WHERE request_id = ?').run(SINGLE.id_a);
    for (const v of ['Taste', 'Taste', 'Color']) d.prepare("INSERT INTO coa_test_results (id, request_id, test_type, result_value, pass_fail) VALUES (?, ?, ?, 'Conforms', 'pass')").run(crypto.randomUUID(), SINGLE.id_a, v);
    for (const id of [PAIR.id_a, PAIR.id_b, PAIR2.id_a, PAIR2.id_b]) d.prepare('UPDATE coa_requests SET qa_signed_at = NULL, qa_signed_by = NULL, certificate_number = NULL WHERE id = ?').run(id);
    d.prepare("DELETE FROM app_settings WHERE key IN ('coa_possible_duplicates_seeded_v1', 'coa_phase1_review_items_seeded_v1')").run();
    d.prepare('DELETE FROM coa_review_items').run();
    d.close();
  }
  const admin = readFileSync(path.join(dir, 'admin-name'), 'utf8');
  const before = coaHashes({ skipLots: true });

  console.log('── the 59 possible duplicates are queued once, beside the 43 (D-242)');
  await boot();
  const kinds = Object.fromEntries(all('SELECT kind, COUNT(*) n FROM coa_review_items GROUP BY kind').map(r => [r.kind, r.n]));
  t('59 POSSIBLE_DUPLICATE items', kinds.POSSIBLE_DUPLICATE === 59, JSON.stringify(kinds));
  t('… beside the 43 Phase 1 items, 21 of them DELETE_DUPLICATE', (kinds.RESIGN + kinds.UNSIGN_CORRECT_NO_RESIGN + kinds.UNSIGN_FAILED + kinds.CORRECT_ONLY + kinds.DELETE_DUPLICATE) === 43 && kinds.DELETE_DUPLICATE === 21);
  t('one item is about a single record (results entered twice)', !!one("SELECT 1 x FROM coa_review_items WHERE item_key = ?", `dup-rows:${SINGLE.id_a}`));
  t('the queue wrote one audit row naming the decision', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_review_items' AND details LIKE '%queued 59 possible duplicates for Maria, decision A-20261027-003%'"));
  t('no COA record moved (base_lot/batch aside)', diff(before, coaHashes({ skipLots: true })).length === 0, diff(before, coaHashes({ skipLots: true })).slice(0, 3).join(', '));
  const pairItem = one('SELECT * FROM coa_review_items WHERE item_key = ?', `dup:${PAIR.id_a}:${PAIR.id_b}`);
  t('the words are plain: "record A / record B", never an id fragment', /record A/.test(pairItem.reason) && !pairItem.reason.includes(PAIR.id_a.slice(0, 8))
    && pairItem.title === `${PAIR.product} · lot ${PAIR.lot} · possible duplicate`);
  t('the evidence links both records and names what differs', JSON.parse(pairItem.evidence).filter(e => e.kind === 'request').length === 2 && JSON.parse(pairItem.evidence).some(e => e.kind === 'line' && /^Record A/.test(e.label)));
  await stop();
  const afterFirst = coaHashes();
  const p1Snap = itemsSnapshot("kind != 'POSSIBLE_DUPLICATE'");
  const dupSnap = itemsSnapshot("kind = 'POSSIBLE_DUPLICATE'");
  { const d = open(); d.prepare("DELETE FROM app_settings WHERE key = 'coa_possible_duplicates_seeded_v1'").run(); d.close(); }
  await boot();
  t('a second queuing run inserts 0', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_review_items' AND details LIKE '%queued 0 possible duplicates%'"));
  t('… every item is as it was, the 43 Phase 1 items included', itemsSnapshot("kind = 'POSSIBLE_DUPLICATE'") === dupSnap && itemsSnapshot("kind != 'POSSIBLE_DUPLICATE'") === p1Snap);
  t('… and every COA row is byte-identical', diff(afterFirst, coaHashes()).length === 0);

  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(admin, 'Admin-Dup-2026!');
  const Q = await login('Mara Quality', 'Quality-Dup-2026!');
  const O = await login('Otto Floor', 'Operator-Dup-2026!');
  const call = async (m, p, b, tok = Q) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    return { s: r.status, j: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null };
  };
  const pile = async () => (await call('GET', '/qa-review?source=coa-corrections')).j.sources.find(s => s.key === 'coa-corrections');

  console.log('\n── QA Review and the request screen');
  let p = await pile();
  t('the pile carries the 43 and the 59 (102)', p.count === 102, String(p.count));
  t('a possible duplicate row reads as one', p.items.some(i => i.action_kind === 'POSSIBLE_DUPLICATE' && i.subtitle === 'Possible duplicate'));
  let r = await call('GET', `/coa/requests/${PAIR.id_b}`);
  const onB = r.j.correction_items.find(i => i.kind === 'POSSIBLE_DUPLICATE');
  t('the item shows on record B too, saying which record this is', onB?.this_record === 'B' && onB.pair.a === PAIR.id_a);
  t('the kind grants Quality no un-sign and no delete', r.j.correction?.unsign === false && r.j.correction?.delete === false
    && (await call('GET', `/coa/requests/${PAIR.id_a}`)).j.correction?.delete === false);

  console.log('\n── "same test": Maria marks one, an admin deletes it');
  t('the operator cannot decide (403)', (await call('POST', `/coa/review-items/${pairItem.id}/decide`, { remove: 'A', reason: 'same' }, O)).s === 403);
  t('a decision needs a reason', (await call('POST', `/coa/review-items/${pairItem.id}/decide`, { remove: 'A' })).s === 400);
  t('… and names A or B', (await call('POST', `/coa/review-items/${pairItem.id}/decide`, { remove: 'C', reason: 'same test' })).s === 400);
  const single = one('SELECT id FROM coa_review_items WHERE item_key = ?', `dup-rows:${SINGLE.id_a}`);
  t('a single-record item takes no A/B decision', (await call('POST', `/coa/review-items/${single.id}/decide`, { remove: 'A', reason: 'same test' })).s === 400);
  r = await call('POST', `/coa/review-items/${pairItem.id}/decide`, { remove: 'A', reason: 'Empty placeholder of the same test' });
  t('Quality records "same test — remove record A"', r.s === 200 && JSON.parse(r.j.decision).remove_id === PAIR.id_a);
  t('… audited, and the request is untouched', !!one("SELECT 1 x FROM audit_log WHERE entity_type = 'coa_review_item' AND entity_id = ? AND action = 'update'", pairItem.id) && !!one('SELECT 1 x FROM coa_requests WHERE id = ?', PAIR.id_a));
  r = await call('GET', `/coa/requests/${PAIR.id_a}`);
  const st = r.j.correction_items.find(i => i.kind === 'POSSIBLE_DUPLICATE');
  t('step 1 ticks; step 2 waits for an admin', st.steps.map(x => x.done).join() === 'true,false' && /Waiting for an admin to delete record A/.test(st.blockedBy || ''));
  t('Quality still cannot delete it', (await call('POST', '/coa/requests/bulk-delete', { ids: [PAIR.id_a], reason: 'dup', signature_password: 'Quality-Dup-2026!' })).s === 403);
  r = await call('POST', '/coa/requests/bulk-delete', { ids: [PAIR.id_a] }, A);
  t('an admin deletes the marked record with the ordinary delete', r.s === 200 && r.j.deleted === 1);
  p = await pile();
  t('… the item settles and leaves the pile (101)', p.count === 101 && !p.items.some(i => i.id === pairItem.id), String(p.count));

  console.log('\n── "not a duplicate", and the single record');
  const item2 = one('SELECT * FROM coa_review_items WHERE item_key = ?', `dup:${PAIR2.id_a}:${PAIR2.id_b}`);
  t('dismissing needs a reason', (await call('POST', `/coa/review-items/${item2.id}/dismiss`, {})).s === 400);
  t('the operator cannot dismiss it', (await call('POST', `/coa/review-items/${item2.id}/dismiss`, { reason: 'not' }, O)).s === 403);
  const p1Item = one("SELECT id FROM coa_review_items WHERE kind = 'RESIGN' LIMIT 1");
  t('Quality still cannot dismiss a Phase 1 correction (admin only)', (await call('POST', `/coa/review-items/${p1Item.id}/dismiss`, { reason: 'try it' })).s === 403);
  r = await call('POST', `/coa/review-items/${item2.id}/dismiss`, { reason: 'Different test panels, both real' });
  t('Quality dismisses a possible duplicate "not a duplicate", recorded', r.s === 200 && one('SELECT status s FROM coa_review_items WHERE id = ?', item2.id).s === 'dismissed'
    && !!one("SELECT 1 x FROM audit_log WHERE entity_id = ? AND action = 'dismiss' AND details LIKE '%Different test panels%'", item2.id));
  t('… both records are still there', !!one('SELECT 1 x FROM coa_requests WHERE id = ?', PAIR2.id_a) && !!one('SELECT 1 x FROM coa_requests WHERE id = ?', PAIR2.id_b));
  const dupLine = all("SELECT id FROM coa_test_results WHERE request_id = ? AND test_type = 'Taste'", SINGLE.id_a)[1];
  r = await call('DELETE', `/coa/requests/${SINGLE.id_a}/results/${dupLine.id}`);
  p = await pile();
  t('deleting the repeated result line settles the single-record item', r.s === 200 && !p.items.some(i => i.id === single.id));

  console.log('\n── tokens');
  r = await call('POST', '/api-tokens', { user_id: 'dup-qa', label: 'dup check', scopes: ['read', 'write'] }, A);
  const TOK = r.j.plaintext;
  const item3 = one('SELECT id FROM coa_review_items WHERE item_key = ?', `dup:${DUPS[2].id_a}:${DUPS[2].id_b}`);
  t('a bot token cannot decide or dismiss', [401, 403].includes((await call('POST', `/coa/review-items/${item3.id}/decide`, { remove: 'A', reason: 'bot says' }, TOK)).s)
    && [401, 403].includes((await call('POST', `/coa/review-items/${item3.id}/dismiss`, { reason: 'bot says' }, TOK)).s));

  console.log('\n── in a browser');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    await page.evaluate((tok) => localStorage.setItem('auth_token', tok), Q);
    await page.goto(`http://127.0.0.1:${PORT}/?tab=coa`);
    await page.waitForSelector('table tbody tr', { timeout: 30000 });
    const target = DUPS[3];
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'coa', request: id } })), target.id_b);
    await page.waitForSelector('[data-possible-duplicate]', { timeout: 20000 });
    t('the request screen shows the pair, marking this one as record B', await page.getByText('This is record B.').count() === 1
      && await page.locator('[data-dup-remove="B"]', { hasText: '(this one)' }).count() === 1);
    page.once('dialog', d => d.accept('Checked the lab reports: two different samples'));
    await page.locator('[data-dup-dismiss]').click();
    await page.waitForFunction(() => !document.querySelector('[data-dup-dismiss]'), null, { timeout: 20000 });
    t('"Not a duplicate…" closes it with the reason', one('SELECT status s, dismissed_reason r FROM coa_review_items WHERE item_key = ?', `dup:${target.id_a}:${target.id_b}`)?.s === 'dismissed');
  } finally { await browser.close(); }
} catch (e) {
  fail++; console.error(e);
} finally {
  await stop();
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
