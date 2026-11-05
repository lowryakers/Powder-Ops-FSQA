// verify:inspectionno — a receiving line joins its checklist whatever stray
// space it was typed with (D-314).
//
// Reported: A-100-6338 signed off reading "0 lines filed", while the line on
// the Receiving Log opened a BLANK checklist ("Inspection checklist (A-100-6338 )").
// The line was filed as "A-100-6338 " and every lookup is an exact match.
//
// Boots its own server twice on a fresh database (INSPNO_PORT):
//   1. a line posted with "A-100-xxxx " (trailing space) and one with a
//      non-breaking space is stored in the clean spelling, counts on the
//      checklist list, and opens the signed checklist; a link carrying the
//      space opens the same checklist;
//   2. rows already on file with a stray space (planted, as the live database
//      has them) are respelled at the next boot, audited, and join their
//      checklist; a second boot changes nothing; a checklist saved with a stray
//      space whose clean twin exists is left alone and reported.
// Control: main before D-314 — the line keeps its space, the list reads 0 lines
// and the checklist opened from the line is blank.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.INSPNO_PORT || 5190);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-inspno-'));
const dbPath = path.join(dir, 'inspno.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const all = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => all(sql, ...a)[0];
const write = (fn) => { const d = new Database(dbPath); try { return fn(d); } finally { d.close(); } };

let child = null; let out = [];
const boot = async () => {
  out = [];
  child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', SIGNATURE_NAME_OPTIONAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* booting */ } await sleep(500); }
  console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1);
};
const halt = async () => { if (!child) return; child.kill('SIGKILL'); await new Promise(r => child.once('exit', r)); child = null; };
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set INSPNO_PORT.`); process.exit(1); } catch { /* free */ }

await boot();
const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
write(db => db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
  VALUES ('ins-jorge', 'Jorge Dock', 'Jorge Dock', 'supervisor', 'warehouse', 1, ?, datetime('now'), '{"receiving-log":"edit"}')`).run(hashOf('Jorge-Dock-2026')));
const J = (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Jorge Dock', password: 'Jorge-Dock-2026' }) })).json()).token;
const call = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${J}` }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json };
};
t('a warehouse supervisor signed in', !!J);

console.log('\n── a line typed with a stray space ──');
let r = await call('POST', '/receiving/checklist', {});
const NO = r.json?.checklist?.inspection_no || r.json?.inspection_no;
t('a checklist is started and issues a number', /^A-100-\d{4}$/.test(NO || ''), JSON.stringify(r.json).slice(0, 160));
const line = (inspection_no, part) => call('POST', '/receiving', { inspection_no, date_received: '2026-11-05', part_number: part, part_description: 'Whey', quantity_received: 1540, uom: 'Kg' });
r = await line(`${NO} `, '202459');
t('a line posted as "<number> " (trailing space) is stored without it', r.status === 201 && one('SELECT inspection_no FROM receiving_log WHERE part_number = ?', '202459')?.inspection_no === NO,
  `${r.status} ${JSON.stringify(one('SELECT inspection_no FROM receiving_log WHERE part_number = ?', '202459'))}`);
r = await line(` ${NO}​`, '202460');
t('a non-breaking or zero-width space is folded too', one('SELECT inspection_no FROM receiving_log WHERE part_number = ?', '202460')?.inspection_no === NO);
r = await call('GET', '/receiving/checklists');
const listed = (r.json?.checklists || r.json || []).find?.(c => c.inspection_no === NO);
t('the checklist list counts both lines', listed?.line_count === 2, JSON.stringify(listed).slice(0, 200));
r = await call('GET', `/receiving/checklist/${encodeURIComponent(`${NO} `)}`);
t('opening it from a link carrying the space opens THIS checklist with its lines', r.json?.checklist?.inspection_no === NO && r.json?.lines?.length === 2,
  `${JSON.stringify(r.json?.checklist?.inspection_no)} lines=${r.json?.lines?.length}`);

console.log('\n── rows already on file with a stray space ──');
await halt();
const PLANT = 'A-100-6338';
write(db => {
  db.prepare(`INSERT INTO receiving_checklists (id, inspection_no, checklist_revision, inspection_date, inspector, created_by, vendor, reviewed_at, reviewed_by)
    VALUES ('ck-6338', ?, 'V2', '2026-11-05', 'Jorge Dock', 'Jorge Dock', 'Mill Haven Foods', datetime('now'), 'Jorge Dock')`).run(PLANT);
  db.prepare(`INSERT INTO receiving_log (id, inspection_no, date_received, part_number, part_description, quantity_received, uom, created_by)
    VALUES ('rl-6338', ?, '2026-11-05', '202459', 'Grassfed Whey', 1540, 'Kg', 'Jorge Dock')`).run(`${PLANT} `);
  // A checklist saved with a stray space whose clean twin exists: two checklists, one delivery.
  db.prepare(`INSERT INTO receiving_checklists (id, inspection_no, checklist_revision, inspection_date, inspector, created_by)
    VALUES ('ck-6338-dup', ?, 'V2', '2026-11-05', 'Jorge Dock', 'Jorge Dock')`).run(`${PLANT} `);
  // An untidy checklist with no twin.
  db.prepare(`INSERT INTO receiving_checklists (id, inspection_no, checklist_revision, inspection_date, inspector, created_by)
    VALUES ('ck-7001', 'A-100-7001 ', 'V2', '2026-11-05', 'Jorge Dock', 'Jorge Dock')`).run();
});
t('planted: the live shape — signed A-100-6338 with 0 lines, its line filed as "A-100-6338 "',
  one('SELECT COUNT(*) c FROM receiving_log WHERE inspection_no = ?', PLANT).c === 0);
await boot();
t('after the boot the line joins A-100-6338', one('SELECT inspection_no FROM receiving_log WHERE id = ?', 'rl-6338').inspection_no === PLANT);
t('…audited with the old and new spelling', all("SELECT details FROM audit_log WHERE entity_type = 'receiving_log' AND entity_id = 'rl-6338'")
  .some(a => /inspection_no_spelling/.test(a.details) && a.details.includes(`"${PLANT} "`)));
r = await call('GET', '/receiving/checklists');
const signed = (r.json?.checklists || r.json || []).find?.(c => c.inspection_no === PLANT);
t('the signed checklist now reads 1 line filed', signed?.line_count === 1, JSON.stringify(signed).slice(0, 200));
t('…and is still signed, its answers untouched', one('SELECT reviewed_at, vendor FROM receiving_checklists WHERE id = ?', 'ck-6338').vendor === 'Mill Haven Foods'
  && !!one('SELECT reviewed_at FROM receiving_checklists WHERE id = ?', 'ck-6338').reviewed_at);
t('an untidy checklist with no twin is respelled', one('SELECT inspection_no FROM receiving_checklists WHERE id = ?', 'ck-7001').inspection_no === 'A-100-7001');
t('an untidy checklist whose clean twin exists is LEFT and reported', one('SELECT inspection_no FROM receiving_checklists WHERE id = ?', 'ck-6338-dup').inspection_no === `${PLANT} `
  && /Two checklists claim inspection A-100-6338/.test(out.join('')));
const audits = one('SELECT COUNT(*) c FROM audit_log').c;
await halt(); await boot();
t('a second boot changes nothing', one('SELECT COUNT(*) c FROM audit_log').c === audits
  && one('SELECT inspection_no FROM receiving_log WHERE id = ?', 'rl-6338').inspection_no === PLANT);
await halt();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
