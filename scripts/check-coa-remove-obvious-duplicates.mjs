#!/usr/bin/env node
// check:coadupes — the obvious-duplicate clean-up script (D-241) on a temporary
// database: every skip reason, the file copies, the backup, the refusals, the
// second run, and --preserve-links. Never touches a real database.
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync, copyFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { lotText, QUEUED_IN_PHASE1 } from './coa-remove-obvious-duplicates.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'scripts', 'coa-remove-obvious-duplicates.mjs');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const tmp = mkdtempSync(path.join(tmpdir(), 'coa-dupes-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const UPD = '2026-07-06 16:56:09';
const LINK = 'https://drive.google.com/file/d/1abcDEF/view?usp=drive_link';
const id = (s) => `${s.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000`;
const QUEUED = [...QUEUED_IN_PHASE1][0];

console.log('── pure helpers');
t('a Drive link typed into the lot reads as the text in brackets', lotText(`${LINK} (L00562)`) === 'L00562' && lotText('L00562') === 'L00562');

// ── build the fixture database ──────────────────────────────────────────────
function build(dbPath) {
  const r = spawnSync(process.execPath, ['-e', "import('./server/db.js').then(m => { m.getDb(); process.exit(0); })"],
    { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const d = new Database(dbPath);
  const req = d.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, source, updated_at,
    qa_signed_at, qa_signed_by, certificate_number, notes, retest_of) VALUES (?, ?, ?, ?, 'HM & Micro', ?, ?, ?, ?, ?, ?, ?, ?)`);
  let cert = 190000;
  const add = (rid, { item = 'IT1', lot = 'L1', status = 'pass', source = 'import_monday', upd = UPD, signed = false, notes = null, retest = null } = {}) =>
    req.run(rid, item, `Product ${item}`, lot, status, source, upd, signed ? '2026-08-01 10:00:00' : null, signed ? 'Maria' : null, signed ? String(++cert) : null, notes, retest);
  const res = d.prepare("INSERT INTO coa_test_results (id, request_id, test_type, result_value, pass_fail) VALUES (?, ?, 'Lead', '0.1', 'pass')");
  const fileDir = path.join(path.dirname(dbPath), 'coa-files'); mkdirSync(fileDir, { recursive: true });
  const insFile = d.prepare("INSERT INTO coa_files (id, request_id, file_type, filename, original_name, size_bytes, created_at) VALUES (?, ?, 'lab_results', ?, ?, ?, ?)");
  const file = (fid, rid, fn, bytes, name = 'COA_1.pdf', at = '2026-08-19 13:00:00') => {
    if (bytes !== null) writeFileSync(path.join(fileDir, fn), bytes);
    insFile.run(fid, rid, fn, name, bytes ? bytes.length : 0, at);
  };

  // keepers
  add(id('k1'), { lot: 'L1' }); file(id('kf1'), id('k1'), 'k1.pdf', Buffer.from('%PDF keeper one')); res.run(crypto.randomUUID(), id('k1')); res.run(crypto.randomUUID(), id('k1'));
  add(id('k2'), { lot: 'L2', signed: true });
  add(id('kfail'), { lot: 'L9', status: 'fail' });
  add(id('kless'), { lot: 'L10' });
  // the rows the list names
  add(id('ok1'), { lot: `${LINK} (L1)` });               // deletable; its keeper is unsigned → a note with --preserve-links
  add(id('ok2'), { lot: `${LINK} (L2)` });               // deletable; its keeper is signed → never a note
  add(id('sgn'), { lot: 'L1', signed: true });            // SIGNED
  add(id('hasf'), { lot: 'L1' }); file(id('hf'), id('hasf'), 'hasf.pdf', Buffer.from('%PDF x'));
  add(id('hasr'), { lot: 'L1' }); res.run(crypto.randomUUID(), id('hasr'));
  add(id('chg'), { lot: 'L1', upd: '2026-10-01 00:00:00' });
  add(id('nokeep'), { lot: 'L1' });
  add(id('kinset'), { lot: `${LINK} (L1)` });              // its keeper (ok1) is itself being deleted
  add(QUEUED, { lot: 'L1', source: 'ctla_coa_upload' });
  add(id('rtgt'), { lot: 'L1' }); add(id('rtchild'), { lot: 'L1', retest: id('rtgt') });
  add(id('inqa'), { lot: 'L1' });
  d.prepare("INSERT INTO coa_review_items (id, item_key, kind, request_id, status) VALUES (?, ?, 'RESIGN', ?, 'open')").run(crypto.randomUUID(), `coa-p1:RESIGN:${id('inqa')}`, id('inqa'));
  add(id('less'), { lot: 'L10' });
  add(id('failk'), { lot: 'L9' });
  // files on one signed request: an identical copy, a different copy, a copy sharing the keeper's stored file
  add(id('frq'), { lot: 'L5', signed: true });
  const PDF = Buffer.from('%PDF-1.4 the same lab report');
  file(id('fkeep'), id('frq'), 'keep.pdf', PDF, 'COA_175699.pdf', '2026-08-19 16:25:13');
  file(id('fsame'), id('frq'), 'same.pdf', PDF, 'COA_175699.pdf', '2026-08-19 13:52:03');
  file(id('fdiff'), id('frq'), 'diff.pdf', Buffer.from('%PDF-1.4 a different report'), 'COA_175699.pdf', '2026-08-19 13:51:00');
  file(id('fshare'), id('frq'), 'keep.pdf', null, 'COA_175699.pdf', '2026-08-19 13:50:00');
  d.close();
}

const ROWS = [
  ['request', 'ok1', 'k1', '', 'L1', '1f/2r'], ['request', 'ok2', 'k2', '', 'L2', '0f/0r'], ['request', 'sgn', 'k1', '', 'L1', '0f/0r'],
  ['request', 'hasf', 'k1', '', 'L1', '0f/0r'], ['request', 'hasr', 'k1', '', 'L1', '0f/0r'], ['request', 'chg', 'k1', '', 'L1', '0f/0r'],
  ['request', 'nokeep', 'gone', '', 'L1', '0f/0r'], ['request', 'kinset', 'ok1', '', 'L1', '0f/0r'], ['request', QUEUED, 'k1', '', 'L1', '0f/0r'],
  ['request', 'rtgt', 'k1', '', 'L1', '0f/0r'], ['request', 'inqa', 'k1', '', 'L1', '0f/0r'], ['request', 'less', 'kless', '', 'L10', '1f/1r'],
  ['request', 'failk', 'kfail', '', 'L9', '0f/0r'],
  ['file', 'fsame', 'fkeep', 'frq', 'L5', ''], ['file', 'fdiff', 'fkeep', 'frq', 'L5', ''], ['file', 'fshare', 'fkeep', 'frq', 'L5', ''],
];
const full = (s) => (s.includes('-') ? s : id(s));
function writeList(p) {
  const lines = ['kind,delete_id,keep_id,request_id,item_number,lot,delete_source,delete_status,delete_updated_at,keeper_holds,keeper_signed,product,lab_report_link_in_deleted_row,reason,rule'];
  for (const [kind, del, keep, rq, lot, h] of ROWS) {
    const src = del === QUEUED ? 'ctla_coa_upload' : 'import_monday';
    const upd = kind === 'request' ? UPD : '';
    lines.push([kind, full(del), full(keep), rq ? full(rq) : '', 'IT1', lot, kind === 'request' ? src : '', kind === 'request' ? 'pass' : '', upd, h, '0', 'Product IT1',
      ['ok1', 'ok2', 'kinset'].includes(del) ? LINK : '', 'Empty record', kind === 'request' ? 'empty twin' : 'identical file copy'].join(','));
  }
  writeFileSync(p, lines.join('\n') + '\n');
}

function hashes(dbPath) {
  const d = new Database(dbPath, { readonly: true });
  try {
    const out = {};
    for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      if (name.includes('_fts')) continue;
      out[name] = crypto.createHash('sha256').update(JSON.stringify(d.prepare(`SELECT * FROM "${name}"`).all())).digest('hex');
    }
    return out;
  } finally { d.close(); }
}
const run = (dbPath, csv, ...flags) => spawnSync(process.execPath, [SCRIPT, '--csv', csv, ...flags],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });

const A = path.join(tmp, 'a', 'db.sqlite'); mkdirSync(path.dirname(A));
build(A);
const csv = path.join(tmp, 'list.csv'); writeList(csv);
// A pristine copy for the --preserve-links run.
const B = path.join(tmp, 'b', 'db.sqlite'); mkdirSync(path.dirname(B));
copyFileSync(A, B); mkdirSync(path.join(tmp, 'b', 'coa-files'));
for (const f of readdirSync(path.join(tmp, 'a', 'coa-files'))) copyFileSync(path.join(tmp, 'a', 'coa-files', f), path.join(tmp, 'b', 'coa-files', f));
const one = (p, sql, ...a) => { const d = new Database(p, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const exists = (p, rid) => !!one(p, 'SELECT 1 x FROM coa_requests WHERE id = ?', rid);

console.log('\n── refusals before a dry run');
let r = run(A, csv, '--apply');
t('--apply with no dry run is refused (exit 1) and writes nothing', r.status === 1 && /no dry-run report/.test(r.stderr) && exists(A, id('ok1')));

console.log('\n── the dry run');
const before = hashes(A);
r = run(A, csv);
t('the dry run exits 3 (skips to read)', r.status === 3, `exit ${r.status}\n${r.stderr}`);
t('… and changes no table at all', JSON.stringify(hashes(A)) === JSON.stringify(before));
t('… and writes only its own report (no backup, no export)', readdirSync(path.join(tmp, 'a', 'backups')).length === 1
  && /^coa-dup-removal-dryrun-.*\.json$/.test(readdirSync(path.join(tmp, 'a', 'backups'))[0]));
const line = (del) => r.stdout.split('\n').find(l => l.includes(full(del).slice(0, 8))) || '';
for (const [del, why] of [['ok1', 'DELETE'], ['ok2', 'DELETE'], ['sgn', 'SIGNED'], ['hasf', 'HAS_FILE'], ['hasr', 'HAS_RESULTS'], ['chg', 'CHANGED'],
  ['nokeep', 'KEEPER_MISSING'], ['kinset', 'KEEPER_IN_DELETE_SET'], [QUEUED, 'QUEUED_IN_PHASE1'], ['rtgt', 'RETEST_TARGET'],
  ['inqa', 'IN_QA_REVIEW'], ['less', 'KEEPER_HOLDS_LESS'], ['failk', 'KEEPER_FAILED'],
  ['fsame', 'DELETE'], ['fdiff', 'FILE_DIFFERENT'], ['fshare', 'DELETE']]) {
  t(`${del.slice(0, 8)} → ${why}`, line(del).includes(why), line(del));
}
t('the dry run says how many keeper notes --preserve-links would write (1)', /1 keeper note\(s\) would be written/.test(r.stdout));

console.log('\n── a row that changes after the dry run');
{ const d = new Database(A); d.prepare("UPDATE coa_requests SET updated_at = '2026-10-27 00:00:00' WHERE id = ?").run(id('ok2')); d.close(); }
r = run(A, csv, '--apply');
t('--apply refuses when a decision moved since the dry run (exit 1), nothing deleted', r.status === 1 && /decide differently/.test(r.stderr) && exists(A, id('ok1')) && exists(A, id('ok2')));
{ const d = new Database(A); d.prepare('UPDATE coa_requests SET updated_at = ? WHERE id = ?').run(UPD, id('ok2')); d.close(); }

console.log('\n── --apply');
r = run(A, csv, '--apply');
t('--apply finishes (exit 3: there were skips)', r.status === 3, `exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-400)}`);
t('exactly the two eligible requests are gone', !exists(A, id('ok1')) && !exists(A, id('ok2')));
t('every skipped request is still there', ['sgn', 'hasf', 'hasr', 'chg', 'nokeep', 'kinset', 'rtgt', 'inqa', 'less', 'failk'].every(x => exists(A, id(x))) && exists(A, QUEUED));
t('the signed twin is never deleted', exists(A, id('sgn')) && !!one(A, 'SELECT qa_signed_at s FROM coa_requests WHERE id = ?', id('sgn')).s);
t('identical copy and shared copy gone, different copy kept', !one(A, 'SELECT 1 x FROM coa_files WHERE id = ?', id('fsame'))
  && !one(A, 'SELECT 1 x FROM coa_files WHERE id = ?', id('fshare')) && !!one(A, 'SELECT 1 x FROM coa_files WHERE id = ?', id('fdiff')) && !!one(A, 'SELECT 1 x FROM coa_files WHERE id = ?', id('fkeep')));
const dir = path.join(tmp, 'a', 'coa-files');
t('the identical copy\'s PDF is removed from disk; the shared one (the keeper\'s) is not', !existsSync(path.join(dir, 'same.pdf')) && existsSync(path.join(dir, 'keep.pdf')));
const audits = (() => { const d = new Database(A, { readonly: true }); try { return d.prepare("SELECT * FROM audit_log WHERE actor = 'Duplicate clean-up (A-20261027-003)'").all(); } finally { d.close(); } })();
t('one audit row per deleted row (2 requests + 2 files), none for a skip', audits.length === 4 && audits.every(a => a.action === 'delete'));
const okAudit = audits.find(a => a.entity_id === id('ok1'));
t('… carrying the decision, the keeper, the old row and the Drive link', /A-20261027-003/.test(okAudit?.details || '') && JSON.parse(okAudit.details).keeper_id === id('k1')
  && JSON.parse(okAudit.previous_state).id === id('ok1') && JSON.parse(okAudit.details).lab_report_link === LINK && okAudit.actor_role === 'admin');
t('--preserve-links off: no keeper notes written', !one(A, 'SELECT notes n FROM coa_requests WHERE id = ?', id('k1')).n);
const bk = readdirSync(path.join(tmp, 'a', 'backups'));
const bdb = bk.find(f => /^pre-coa-dup-removal-.*\.db$/.test(f));
t('the backup copy opens and still holds the deleted rows', !!bdb && exists(path.join(tmp, 'a', 'backups', bdb), id('ok1')) && exists(path.join(tmp, 'a', 'backups', bdb), id('ok2')));
const exp = bk.find(f => /^coa-dup-removal-\d/.test(f) && !f.endsWith('.json'));
const expDir = path.join(tmp, 'a', 'backups', exp || 'none');
t('the export holds the rows, the PDF and a CSV with the Drive link', !!exp && JSON.parse(readFileSync(path.join(expDir, 'coa_requests.json'), 'utf8')).length === 2
  && readdirSync(path.join(expDir, 'pdfs')).length >= 1 && readFileSync(path.join(expDir, 'removed.csv'), 'utf8').includes(LINK));
t('a report JSON was written', bk.some(f => /^coa-dup-removal-report-.*\.json$/.test(f)));

console.log('\n── a second run');
r = run(A, csv); r = run(A, csv, '--apply');
t('a second --apply deletes nothing (rows reported already gone)', /Nothing to delete/.test(r.stdout) && /2 already gone/.test(r.stdout));

console.log('\n── --preserve-links (on a fresh copy)');
r = run(B, csv); r = run(B, csv, '--apply', '--preserve-links');
t('--apply --preserve-links finishes', r.status === 3, `exit ${r.status}\n${r.stderr}`);
const note = one(B, 'SELECT notes n FROM coa_requests WHERE id = ?', id('k1')).n || '';
t('the unsigned keeper gets the link, once, naming the removed row', note.includes(LINK) && note.includes(id('ok1').slice(0, 8)) && note.split(LINK).length === 2);
t('the signed keeper gets nothing', !one(B, 'SELECT notes n FROM coa_requests WHERE id = ?', id('k2')).n);
t('the note is audited as an update', !!one(B, "SELECT 1 x FROM audit_log WHERE actor = 'Duplicate clean-up (A-20261027-003)' AND action = 'update' AND entity_id = ?", id('k1')));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
