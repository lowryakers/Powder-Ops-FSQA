#!/usr/bin/env node
// verify:coaworklist — D-256 … D-258, live on a temporary database, plus a real browser.
//
//  1. The COA corrections pile: most dangerous first, empty copies of one kept
//     request next to each other, no long ids in the words, and every empty
//     duplicate deleted in one act (preview writes nothing; a non-empty one is
//     named and left; reason and password required; one audit row each).
//  2. "Start lab request" from a receiving line: the prefill, the link stored,
//     a second request for the line refused, the alert carrying the link.
//  3. Late lab results: only samples with an expected date before today, the
//     no-date count, and the day's message (quiet when nothing is late).
//  4. The browser: chips, the grouped card, the one-step delete through the
//     password prompt, the prefilled form, the late strip.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { lateLabResults, lateResultsMessage } from '../server/coa-late-results.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COA_WL_PORT || 4624);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-coa-wl-'));
const dbPath = path.join(dir, 'wl.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const open = () => new Database(dbPath);
const one = (sql, ...a) => { const d = open(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = open(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const SEED = JSON.parse(readFileSync(path.join(root, 'server/seed/coa-phase1-review-items.json'), 'utf8')).items;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

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

try {
  // ── fixtures: the 43 decided requests, as verify:coaphase1 files them ──────
  await boot();
  await stop();
  let adminName;
  {
    const d = open();
    const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
    adminName = d.prepare("SELECT name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get().name;
    d.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?").run(hashOf('Admin-WL-2026!'), adminName);
    d.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES ('wl-qa', 'Mara Quality', 'Mara Quality', 'supervisor', 'qa', 1, ?, datetime('now'), '{"coa":"edit","receiving-log":"edit"}')`).run(hashOf('Quality-WL-2026!'));
    d.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
      VALUES ('wl-op', 'Otto Floor', 'Otto Floor', 'operator', 'warehouse', 1, ?, datetime('now'), '{"coa":"edit","receiving-log":"edit"}')`).run(hashOf('Operator-WL-2026!'));
    const lab = d.prepare('SELECT id, name FROM coa_labs LIMIT 1').get();
    const insReq = d.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, lab_id, lab_name, date_sent, source, created_by,
      qa_signed_by, qa_signed_at, qa_signature, certificate_number, date_of_issuance)
      VALUES (?, ?, ?, ?, 'HM & Micro', ?, ?, ?, '2026-08-01', ?, 'fixture', ?, ?, ?, ?, ?)`);
    const insRes = d.prepare('INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, pass_fail) VALUES (?, ?, ?, ?, ?, ?)');
    const insFile = d.prepare("INSERT INTO coa_files (id, request_id, file_type, filename, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, 'lab_results', ?, ?, 'application/pdf', 10, 'fixture')");
    mkdirSync(path.join(dir, 'coa-files'), { recursive: true });
    let cert = 290000;
    const SIG = 'data:image/png;base64,iVBORw0KGgo=';
    const ids = [...new Set([...SEED.map(x => x.request_id), ...SEED.map(x => x.canonical_request_id).filter(Boolean)])];
    for (const id of ids) {
      d.prepare('DELETE FROM coa_test_results WHERE request_id = ?').run(id);
      d.prepare('DELETE FROM coa_files WHERE request_id = ?').run(id);
      d.prepare('DELETE FROM coa_requests WHERE id = ?').run(id);
    }
    const made = new Set();
    for (const s of SEED) {
      if (made.has(s.request_id)) continue;
      made.add(s.request_id);
      if (s.kind === 'DELETE_DUPLICATE') {
        insReq.run(s.request_id, 'DUP', 'Dup material', s.lot, 'pending', lab?.id || null, lab?.name || 'CTLA', 'ctla_coa_upload', null, null, null, null, null);
        continue;
      }
      const signed = s.kind !== 'CORRECT_ONLY';
      insReq.run(s.request_id, s.item_number, `WL ${s.item_number}`, s.lot, signed ? 'pass' : 'sent', lab?.id || null, lab?.name || 'CTLA', 'ctla_coa_upload',
        signed ? 'Earlier Signer' : null, signed ? '2026-08-15 10:00:00' : null, signed ? SIG : null, signed ? String(cert++) : null, signed ? '2026-08-15' : null);
      insRes.run(crypto.randomUUID(), s.request_id, 'Gluten Allergen', '<44', 'ppm', 'pass');
      insFile.run(s.file_id, s.request_id, `${s.file_id}.pdf`, s.file_name);
    }
    for (const s of SEED.filter(x => x.kind === 'DELETE_DUPLICATE')) {
      if (made.has(s.canonical_request_id)) continue;
      made.add(s.canonical_request_id);
      insReq.run(s.canonical_request_id, 'CANON', 'Kept material', s.lot, 'pass', lab?.id || null, lab?.name || 'CTLA', 'ctla_coa_upload', null, null, null, null, null);
      insFile.run(crypto.randomUUID(), s.canonical_request_id, `${s.file_id}-k.pdf`, s.file_name);
    }
    d.prepare("DELETE FROM app_settings WHERE key = 'coa_phase1_review_items_seeded_v1'").run();
    d.prepare('DELETE FROM coa_review_items').run();

    // Late results: one late (sent 10 days ago, 5-day turnaround), one not
    // yet due, one with no date, one already back. Everything else 'sent' is
    // moved out of the way so the counts are this fixture's.
    d.prepare("UPDATE coa_requests SET status = 'pass' WHERE status = 'sent' AND id NOT IN (SELECT request_id FROM coa_test_results)").run();
    const late = (id, sent, tat, expected, results) => d.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, lab_name,
      date_sent, tat_days, expected_results_date, date_of_results, created_by) VALUES (?, ?, ?, ?, 'HM & Micro', 'sent', 'CTLA', ?, ?, ?, ?, 'fixture')`)
      .run(id, 'LATE', `Late ${id}`, `L-${id}`, sent, tat, expected, results);
    late('wl-late', daysAgo(10), 5, null, null);
    late('wl-ontime', daysAgo(1), 5, null, null);
    late('wl-nodate', null, null, null, null);
    late('wl-back', daysAgo(20), 5, null, daysAgo(2));
    d.close();
  }
  await boot();

  const login = async (name, password) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })).json()).token;
  const A = await login(adminName, 'Admin-WL-2026!');
  const Q = await login('Mara Quality', 'Quality-WL-2026!');
  const O = await login('Otto Floor', 'Operator-WL-2026!');
  t('admin, Quality and an operator signed in', !!A && !!Q && !!O);
  const call = async (m, p, b, tok = Q) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { s: r.status, j: ct.includes('json') ? await r.json() : null };
  };
  const pile = async () => (await call('GET', '/qa-review?source=coa-corrections')).j.sources.find(s => s.key === 'coa-corrections');

  // ── 1. the corrections pile ──────────────────────────────────────────────
  console.log('\n── COA corrections: order, grouping, words');
  let src = await pile();
  const items = src.items;
  t('the pile holds the 43', src.count === 43 && items.length === 43, String(src.count));
  const risks = items.map(i => i.risk);
  t('most dangerous first: the risk never goes down the list', risks.every((v, i) => i === 0 || v >= risks[i - 1]), risks.join(','));
  t('the first item is an un-sign of a failed lot', items[0].action_kind === 'UNSIGN_FAILED', items[0].action_kind);
  const lastSigned = Math.max(...items.map((x, i) => (['RESIGN', 'UNSIGN_FAILED', 'UNSIGN_CORRECT_NO_RESIGN'].includes(x.action_kind) ? i : -1)));
  const firstDup = items.findIndex(x => x.action_kind === 'DELETE_DUPLICATE');
  t('every wrong signed certificate comes before any duplicate', lastSigned < firstDup, `${lastSigned} vs ${firstDup}`);
  const dups = items.filter(x => x.action_kind === 'DELETE_DUPLICATE');
  const groups = [...new Set(dups.map(x => x.group_key))];
  const adjacent = groups.every(g => { const idx = items.map((x, i) => (x.group_key === g ? i : -1)).filter(i => i >= 0); return idx[idx.length - 1] - idx[0] === idx.length - 1; });
  t('copies of one kept request sit next to each other', adjacent);
  t('a kept request with several copies exists (the 101434 case)', groups.some(g => dups.filter(x => x.group_key === g).length > 1));
  t('each duplicate names its kept request in words', dups.every(x => /lot /.test(x.group_label || '') && /filed /.test(x.group_label || '')));
  t('no long request id in any duplicate\'s words', dups.every(x => !UUID_RE.test(`${x.recommended_action} ${x.reason} ${x.note || ''}`)), dups.map(x => x.recommended_action).find(s => UUID_RE.test(s)) || '');
  t('the stored wording is untouched (ids still in the table)', !!one("SELECT 1 x FROM coa_review_items WHERE kind = 'DELETE_DUPLICATE' AND recommended_action LIKE '%-%-%-%-%'"));

  console.log('\n── one-step delete of the empty duplicates');
  const busy = dups[0].request_id;
  {
    const d = open();
    d.prepare("INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, pass_fail) VALUES ('wl-r1', ?, 'Lead', '0.01', 'ppm', 'pass')").run(busy);
    d.close();
  }
  const nDups = dups.length;
  let r = await call('POST', '/coa/corrections/duplicates/delete', { preview: true });
  t('preview: every empty duplicate is ready, the one with a result is named', r.s === 200 && r.j.ready.length === nDups - 1
    && r.j.refused.length === 1 && r.j.refused[0].request_id === busy && /test results/.test(r.j.refused[0].reason), JSON.stringify(r.j?.refused));
  t('… and the preview deleted nothing', one('SELECT COUNT(*) n FROM coa_requests WHERE id IN (' + dups.map(() => '?').join(',') + ')', ...dups.map(x => x.request_id)).n === nDups);
  t('an operator is refused', (await call('POST', '/coa/corrections/duplicates/delete', { preview: true }, O)).s === 403);
  r = await call('POST', '/coa/corrections/duplicates/delete', { signature_password: 'Quality-WL-2026!' });
  t('no reason: refused, nothing deleted', r.s === 400 && r.j.reason_required === true);
  r = await call('POST', '/coa/corrections/duplicates/delete', { reason: 'Empty copies, decision A-20261027-001' });
  t('no password: 403 signature_required, nothing deleted', r.s === 403 && !!r.j.signature_required
    && one('SELECT COUNT(*) n FROM coa_requests WHERE id IN (' + dups.map(() => '?').join(',') + ')', ...dups.map(x => x.request_id)).n === nDups);
  const group = dups.filter(x => x.group_key === groups.find(g => dups.filter(y => y.group_key === g).length > 1));
  r = await call('POST', '/coa/corrections/duplicates/delete', { request_ids: group.map(x => x.request_id).filter(id => id !== busy), reason: 'One card', signature_password: 'Quality-WL-2026!' });
  const groupDone = group.filter(x => x.request_id !== busy).length;
  t('one card\'s copies go together', r.s === 200 && r.j.deleted === groupDone, JSON.stringify(r.j));
  r = await call('POST', '/coa/corrections/duplicates/delete', { reason: 'Empty copies, decision A-20261027-001', signature_password: 'Quality-WL-2026!' });
  t('the rest go in one act', r.s === 200 && r.j.deleted === nDups - 1 - groupDone && r.j.refused.length === 1, JSON.stringify(r.j));
  t('… only the one with a result is still on file', one('SELECT COUNT(*) n FROM coa_requests WHERE id IN (' + dups.map(() => '?').join(',') + ')', ...dups.map(x => x.request_id)).n === 1 && !!one('SELECT 1 x FROM coa_requests WHERE id = ?', busy));
  t('… each deletion is its own audit row, with the item and the signature', all("SELECT details FROM audit_log WHERE entity_type = 'coa_request' AND action = 'delete'").filter(a => /"bulk":true/.test(a.details) && /coa-p1:DELETE_DUPLICATE/.test(a.details) && /signature_verified/.test(a.details)).length === nDups - 1);
  t('… plus one summary row', all("SELECT 1 FROM audit_log WHERE action LIKE '%coa_duplicates_deleted%' OR details LIKE '%\"deleted\":" + (nDups - 1 - groupDone) + "%'").length >= 1);
  t('… and the password never reached the audit log', !one("SELECT 1 x FROM audit_log WHERE details LIKE '%Quality-WL-2026!%'"));
  src = await pile();
  t('the pile dropped by the deleted copies', src.count === 43 - (nDups - 1), String(src.count));
  r = await call('POST', '/coa/corrections/duplicates/delete', { request_ids: ['wl-ontime'], preview: true });
  t('naming a request no item covers is refused by name', r.j.ready.length === 0 && /not an open/.test(r.j.refused[0]?.reason || ''));

  // ── 2. receiving → lab request ───────────────────────────────────────────
  console.log('\n── Start lab request from a receiving line');
  r = await call('POST', '/receiving/lab-test-items', { part_number: 'WPI-90', part_description: 'Whey isolate', tests: 'HM & Micro' });
  t('QA puts a part on the lab-test list', r.s === 201);
  r = await call('POST', '/receiving', { part_number: 'WPI-90', part_description: 'Whey isolate 90', vendor_lot: 'VL-7781', po_number: 'PO-555', date_received: daysAgo(0), expiration_date: '2027-10-01', quantity_received: 40, uom: 'bag' });
  const line = r.j;
  await sleep(800);
  t('the receiving line files and is marked as needing a lab test', r.s === 201 && one('SELECT lab_test_required v FROM receiving_log WHERE id = ?', line.id)?.v === 1);
  t('the alert to QA carries the "Start the lab request" link', !!one("SELECT 1 x FROM chat_messages WHERE body LIKE ? AND body LIKE '%Start the lab request%'", `%from_receiving=${line.id}%`));
  r = await call('GET', `/coa/receiving-prefill/${line.id}`);
  const pf = r.j.prefill;
  t('the prefill comes from the line', r.s === 200 && pf.item_number === 'WPI-90' && pf.lot_number === 'VL-7781' && pf.vendor_lot === 'VL-7781'
    && pf.tests_requested === 'HM & Micro' && pf.product_expiration === '2027-10-01' && /PO-555/.test(pf.notes) && r.j.existing === null && r.j.missing.length === 0, JSON.stringify(r.j));
  t('the operator cannot read it without COA… (has COA here, so 200)', (await call('GET', `/coa/receiving-prefill/${line.id}`, null, O)).s === 200);
  t('an unknown line is 404', (await call('GET', '/coa/receiving-prefill/nope')).s === 404);
  r = await call('POST', '/coa/requests', { ...pf, lab_id: '', date_sent: '' });
  const made = r.j;
  t('saving it files the request with the line linked', r.s === 201 && one('SELECT receiving_log_id v FROM coa_requests WHERE id = ?', made.id).v === line.id);
  t('the prefill now names the existing request', (await call('GET', `/coa/receiving-prefill/${line.id}`)).j.existing?.id === made.id);
  r = await call('POST', '/coa/requests', { ...pf });
  t('a second request for the same line is refused, naming the first', r.s === 409 && r.j.existing_id === made.id);
  r = await call('GET', '/receiving?limit=50');
  const listed = (Array.isArray(r.j) ? r.j : r.j.records || r.j.rows || []).find(x => x.id === line.id);
  t('the receiving list says which lab request the line has', listed?.lab_request_id === made.id, JSON.stringify(listed || r.j).slice(0, 160));
  r = await call('POST', '/receiving', { part_number: 'WPI-90', part_description: 'Whey isolate 90', po_number: 'PO-556', date_received: daysAgo(0) });
  const noLot = r.j;
  t('a line with no vendor lot says so on the prefill', (await call('GET', `/coa/receiving-prefill/${noLot.id}`)).j.missing.includes('vendor lot'));

  // ── 3. late results ──────────────────────────────────────────────────────
  console.log('\n── Late lab results');
  r = await call('GET', '/coa/late-results');
  const lateIds = r.j.late.map(x => x.id);
  t('only the sample past its due date is late', r.s === 200 && lateIds.includes('wl-late') && !lateIds.includes('wl-ontime') && !lateIds.includes('wl-back') && !lateIds.includes('wl-nodate'), lateIds.join());
  t('… five days late (sent 10 days ago, 5-day turnaround)', r.j.late.find(x => x.id === 'wl-late')?.days_late === 5);
  t('the one with no expected date is counted apart', r.j.no_date >= 1);
  t('the message names the late sample and links to Lab Requests', /Lab results overdue/.test(lateResultsMessage(r.j) || '') && /Late wl-late/.test(lateResultsMessage(r.j)) && /tab=coa/.test(lateResultsMessage(r.j)));
  t('… and there is no message when nothing is late', lateResultsMessage({ late: [] }) === null);
  t('it is on Settings → ReadyBot messages, settable', ((await call('GET', '/flash/readybot-audience', null, A)).j?.audiences || []).some?.(a => a.key === 'coa_late_results' && a.setting === 'coa_late_results_recipients') ?? false);

  // ── 4. the browser ───────────────────────────────────────────────────────
  console.log('\n── in a browser');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    await page.evaluate((tok) => localStorage.setItem('auth_token', tok), Q);
    await page.goto(`http://127.0.0.1:${PORT}/?tab=qa-review`);
    await page.getByText('COA corrections', { exact: true }).first().click();
    await page.waitForSelector('[data-coa-chips]', { timeout: 20000 });
    t('the chips name each kind with its count', await page.locator('[data-coa-chip="RESIGN"]').count() === 1 && await page.locator('[data-coa-chip="all"]').count() === 1);
    t('the first card is the un-sign of a failed lot', await page.locator('[data-action-source] li').first().getAttribute('data-action-row') === 'UNSIGN_FAILED');
    await page.locator('[data-coa-chip="RESIGN"]').click();
    const kinds = await page.locator('[data-action-row]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-action-row')))]);
    t('a chip shows only that kind', kinds.length === 1 && kinds[0] === 'RESIGN', kinds.join());
    await page.locator('[data-coa-chip="all"]').click();

    // Put two fresh empty copies back so there is a card and a one-step delete.
    {
      const d = open();
      const keep = SEED.find(x => x.kind === 'DELETE_DUPLICATE');
      const lab = d.prepare('SELECT id, name FROM coa_labs LIMIT 1').get();
      for (const s of SEED.filter(x => x.kind === 'DELETE_DUPLICATE' && x.canonical_request_id === keep.canonical_request_id).slice(0, 2)) {
        if (!d.prepare('SELECT 1 FROM coa_requests WHERE id = ?').get(s.request_id)) {
          d.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, lab_id, lab_name, source, created_by)
            VALUES (?, 'DUP', 'Dup material', ?, 'HM & Micro', 'pending', ?, ?, 'ctla_coa_upload', 'fixture')`).run(s.request_id, s.lot, lab?.id || null, lab?.name || 'CTLA');
        }
      }
      d.close();
    }
    await page.reload();
    await page.getByText('COA corrections', { exact: true }).first().click();
    await page.waitForSelector('[data-dup-delete-all]', { timeout: 20000 });
    t('"Delete all empty duplicates" is offered', await page.locator('[data-dup-delete-all]').count() === 1);
    await page.locator('[data-dup-delete-all]').click();
    await page.waitForSelector('[data-dup-dialog]', { timeout: 10000 });
    t('the dialog names the one that will be left alone', await page.locator('[data-dup-refused="1"]').count() === 1);
    await page.locator('[data-dup-confirm]').click();
    await page.waitForSelector('[data-signature-prompt] input[type=password]', { timeout: 10000 });
    await page.locator('[data-signature-prompt] input[type=password]').click();
    await page.keyboard.type('Quality-WL-2026!');
    const box = await page.locator('[data-signature-prompt] button[type=submit]').boundingBox();
    const topAt = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-signature-prompt]'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    t('the password prompt is on top of the dialog', topAt);
    await page.locator('[data-signature-prompt] button[type=submit]').click();
    await page.waitForSelector('[data-dup-message]', { timeout: 15000 });
    t('the screen says how many were deleted', /Deleted \d+ empty duplicate/.test(await page.locator('[data-dup-message]').innerText()));

    await page.goto(`http://127.0.0.1:${PORT}/?tab=coa&from_receiving=${noLot.id}`);
    await page.waitForSelector('[data-receiving-prefill]', { timeout: 20000 });
    t('the receiving link opens the new-request form, filled in', /Filled in from the receiving line/.test(await page.locator('[data-receiving-prefill]').innerText())
      && /vendor lot/.test(await page.locator('[data-receiving-prefill]').innerText()));
    t('… with the part filled in', await page.locator('input[placeholder="e.g. MO01409"]').inputValue() === 'WPI-90');
    await page.goto(`http://127.0.0.1:${PORT}/?tab=coa`);
    await page.waitForSelector('[data-late-results]', { timeout: 20000 });
    t('Lab Requests shows the late sample', await page.locator('[data-late-row="wl-late"]').count() === 1);
    t('… and says how many have no expected date', await page.locator('[data-late-nodate]').count() === 1);

    const wpage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await wpage.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    await wpage.evaluate((tok) => localStorage.setItem('auth_token', tok), Q);
    await wpage.goto(`http://127.0.0.1:${PORT}/?tab=receiving-log&view=log`);
    const row = wpage.locator('table tbody tr', { hasText: 'Whey isolate 90' }).filter({ hasText: 'PO-555' }).first();
    await row.waitFor({ timeout: 20000 });
    await row.click();
    await wpage.waitForSelector('[data-start-lab-request]', { timeout: 10000 });
    t('the receiving line offers the lab request', await wpage.locator('[data-start-lab-request]').count() >= 1);
  } finally { await browser.close(); }
} catch (e) {
  fail++; console.error(e);
} finally {
  await stop();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
