#!/usr/bin/env node
// check:coacopylinks — the Drive-link copy script (D-250) on a temporary
// database: the dry run writes nothing, --apply adds each link once, a signed or
// missing keeper is skipped, a second --apply writes nothing, and the backup is
// taken. Never touches a real database.
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'scripts', 'coa-copy-drive-links.mjs');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const tmp = mkdtempSync(path.join(tmpdir(), 'coa-links-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const dbPath = path.join(tmp, 'app.db');
const boot = spawnSync(process.execPath, ['-e', "import('./server/db.js').then(m => { m.getDb(); process.exit(0); })"],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
if (boot.status !== 0) { console.error(boot.stderr); process.exit(1); }

const L1 = 'https://drive.google.com/file/d/AAA/view', L2 = 'https://drive.google.com/file/d/BBB/view';
const L3 = 'https://drive.google.com/file/d/CCC/view', L4 = 'https://drive.google.com/file/d/DDD/view';
const d = new Database(dbPath);
const req = d.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, notes, qa_signed_at, qa_signed_by, certificate_number)
  VALUES (?, 'IT1', 'Product IT1', ?, 'Micro', 'pass', ?, ?, ?, ?)`);
req.run('keep-a', 'L1', 'Existing note', null, null, null);
req.run('keep-b', 'L2', null, null, null, null);
req.run('keep-s', 'L3', null, '2026-08-01 10:00:00', 'Maria', '190001');
req.run('keep-c', 'L5', `Already: ${L4}`, null, null, null);
const audit = d.prepare("INSERT INTO audit_log (actor, action, entity_type, entity_id, details) VALUES ('x', ?, 'coa_request', ?, ?)");
const del = (rid, keeper, link, decision = 'A-20261027-003') =>
  audit.run('delete', rid, JSON.stringify({ decision, keeper_id: keeper, ...(link ? { lab_report_link: link } : {}) }));
del('gone-1', 'keep-a', L1);
del('gone-2', 'keep-b', L2);
del('gone-3', 'keep-s', L3);
del('gone-4', 'keep-x', 'https://drive.google.com/file/d/EEE/view'); // keeper no longer exists
del('gone-5', 'keep-c', L4); // already noted
del('gone-6', 'keep-b', null); // no link: not listed
del('gone-7', 'keep-b', 'https://drive.google.com/file/d/ZZZ/view', 'SOMETHING-ELSE'); // another decision: ignored
d.close();

const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
const notes = () => { const x = new Database(dbPath, { readonly: true }); const o = Object.fromEntries(x.prepare('SELECT id, notes FROM coa_requests').all().map(r => [r.id, r.notes])); x.close(); return o; };
const before = notes();

console.log('── the dry run');
let r = run();
t('lists the five links with a link, and only this decision', /Links found in the audit log: 5 · to add: 2 · skipped: 3/.test(r.stdout), r.stdout);
t('exits 3 because there are skips to read', r.status === 3, String(r.status));
t('writes nothing', JSON.stringify(notes()) === JSON.stringify(before));
t('names a signed keeper and prints its link so it is not lost', /signed — not changed/.test(r.stdout) && r.stdout.includes(L3));
t('names a missing keeper and an already-noted one', /no longer exists/.test(r.stdout) && /already in its notes/.test(r.stdout));

console.log('── --apply');
r = run('--apply');
const after = notes();
t('adds two links', /APPLIED: 2 link/.test(r.stdout), r.stdout + r.stderr);
t('appends to an existing note, keeping it', after['keep-a'] === `Existing note\nLab report link (from removed duplicate row gone-1): ${L1}`, after['keep-a']);
t('fills an empty note', after['keep-b'] === `Lab report link (from removed duplicate row gone-2): ${L2}`, after['keep-b']);
t('never touches a signed keeper', after['keep-s'] === null);
t('never touches one that already has the link', after['keep-c'] === before['keep-c']);
const backups = readdirSync(path.join(tmp, 'backups')).filter(f => f.startsWith('pre-coa-copy-links-'));
t('backs the database up first', backups.length === 1 && existsSync(path.join(tmp, 'backups', backups[0])));
const x = new Database(dbPath, { readonly: true });
const aud = x.prepare("SELECT entity_id, details FROM audit_log WHERE action = 'update' AND entity_type = 'coa_request'").all();
x.close();
t('one audit row per request changed, naming the link', aud.length === 2 && aud.every(a => /lab_report_link/.test(a.details) && /D-250/.test(a.details)), JSON.stringify(aud));

console.log('── a second --apply');
r = run('--apply');
t('writes nothing and takes no backup', /Nothing to add/.test(r.stdout) && JSON.stringify(notes()) === JSON.stringify(after)
  && readdirSync(path.join(tmp, 'backups')).filter(f => f.startsWith('pre-coa-copy-links-')).length === 1, r.stdout);
r = run('--force');
t('an unknown argument is refused', r.status === 1 && /Unknown argument/.test(r.stderr));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
