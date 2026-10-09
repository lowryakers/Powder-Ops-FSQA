// verify:apdropreport (D-160) — no server. Two things that touch a database
// built BEFORE D-160:
//   1. the read-only backfill report finds the stuck receivable (I136-shaped)
//      and Jake's near-duplicate pair, and WRITES NOTHING (file hash and every
//      row count identical before and after);
//   2. booting the app widens ap_drops.status in place: the rows and their
//      activity log survive (ap_drop_events cascades on delete, so a careless
//      DROP TABLE would empty it), the indexes come back, and the new statuses
//      are accepted.
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const dir = mkdtempSync(join(tmpdir(), 'apdrop-report-'));
const DBP = join(dir, 'compliance.db');
const boot = () => execFileSync('node', ['-e', "import('./server/db.js').then(m => { m.getDb(); m.getDb().close(); })"], { env: { ...process.env, DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

boot();
let db = new Database(DBP);
// Put ap_drops back the way it was before D-160.
const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ap_drops'").get().sql;
t('a fresh database already accepts the new statuses', sql.includes('to_partner_ar') && sql.includes('receivable_other'));
const oldSql = sql.replace(",'to_partner_ar','receivable_other')", ')').replace(/CREATE TABLE\s+"?ap_drops"?/i, 'CREATE TABLE ap_drops_old');
const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='ap_drops' AND sql IS NOT NULL").all().map(r => r.sql);
db.pragma('foreign_keys = OFF');
db.exec(oldSql); db.exec('INSERT INTO ap_drops_old SELECT * FROM ap_drops'); db.exec('DROP TABLE ap_drops'); db.exec('ALTER TABLE ap_drops_old RENAME TO ap_drops');
for (const ix of idx) db.exec(ix);
db.pragma('foreign_keys = ON');
t('the fixture is a pre-D-160 table', !db.prepare("SELECT sql FROM sqlite_master WHERE name='ap_drops'").get().sql.includes('to_partner_ar'));

db.prepare("INSERT OR IGNORE INTO partner_accounts (id, name, code, terms_days, is_active) VALUES ('p-fx', 'M4 Dynamics', 'M4', 30, 1)").run();
const doc = (id, dirn, no, amt) => db.prepare(`INSERT INTO partner_documents (id, partner_id, direction, doc_type, doc_number, amount, status, issued_date, terms_days, source, created_by)
  VALUES (?, 'p-fx', ?, 'invoice', ?, ?, 'draft', '2026-09-24', 30, 'ap-drop', 'fixture')`).run(id, dirn, no, amt);
doc('doc-i136', 'receivable', 'I136', 1051.92);
doc('doc-pay', 'payable', 'M4-2210', 4500);
doc('doc-jake', 'payable', 'M4-3301', 7464.34);
const route = JSON.stringify({ partner: { id: 'p-fx', name: 'M4 Dynamics' }, confidence: 'high' });
const drop = (id, at, who, amt, ref, vendor, sha, status, docId) => {
  db.prepare(`INSERT INTO ap_drops (id, created_at, submitter, filename, storage_key, content_sha256, amount, po_or_co_ref, vendor_name, status, partner_document_id, partner_route)
    VALUES (?, ?, ?, ?, 'k', ?, ?, ?, ?, ?, ?, ?)`).run(id, at, who, `${id}.pdf`, sha, amt, ref, vendor, status, docId, docId ? route : null);
  db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_name, kind) VALUES (?, ?, ?, 'uploaded')").run(`ev-${id}`, id, who);
};
drop('aaaa1136-0000', '2026-09-24 15:10:00', 'Lowry', 1051.92, null, 'USA', 'sha-i136', 'new', 'doc-i136');
drop('bbbb2210-0000', '2026-09-05 10:00:00', 'Jake', 4500, null, 'M4 Dynamic', 'sha-pay', 'in_qbo', 'doc-pay');
drop('cccc0001-0000', '2026-09-23 09:00:00', 'Jake', 7464.34, 'PO-01231', 'M4 Dynamic', 'sha-j1', 'new', 'doc-jake');
drop('cccc0002-0000', '2026-09-23 09:04:00', 'Jake', 7464.49, 'PO PO-01231', 'M4 Dynamics Inc', 'sha-j2', 'new', null);
drop('dddd0001-0000', '2026-09-01 09:00:00', 'Jake', 500, 'PO-9', 'Acme', 'sha-d1', 'new', null);
drop('dddd0002-0000', '2026-09-02 15:00:00', 'Jake', 500, 'PO-9', 'Acme', 'sha-d2', 'new', null);
drop('eeee0001-0000', '2026-09-03 09:00:00', 'Jake', 500, 'PO-10', 'Acme', 'sha-e1', 'new', null);
drop('eeee0002-0000', '2026-09-03 09:05:00', 'Jake', 502.5, 'PO-10', 'Acme', 'sha-e2', 'new', null);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
const counts = (d) => Object.fromEntries(tables.map(n => [n, d.prepare(`SELECT COUNT(*) c FROM "${n}"`).get().c]));
db.pragma('wal_checkpoint(TRUNCATE)');
const before = counts(db);
db.close();
const hash = () => createHash('sha256').update(readFileSync(DBP)).digest('hex');
const h0 = hash();

console.log('\n── the report, read-only ──');
const out = execFileSync('node', ['scripts/report-ap-drop-stuck-receivables.mjs', DBP]).toString();
console.log(out.split('\n').map(l => '    ' + l).join('\n'));
t('it lists I136: Outstanding while a receivable on the ledger', /aaaa1136 .*Lowry .*1051\.92 .*I136 .*new/.test(out));
t('it does not list a payable on the ledger', !/bbbb2210/.test(out.split('Near-duplicate')[0]));
t('it reports one stuck receivable', /RECEIVABLES on the partner ledger: 1\b/.test(out));
t('it lists Jake\'s pair (PO-01231 vs "PO PO-01231", 4 min, partner match across vendor spellings)', /cccc0001/.test(out) && /cccc0002/.test(out) && /\+4 min/.test(out));
t('…and not a pair 30 hours apart, nor one $2.50 apart', !/dddd000/.test(out) && !/eeee000/.test(out));
t('it reports exactly one pair', /different file\): 1\b/.test(out));
t('the database file is byte-for-byte unchanged', hash() === h0);
db = new Database(DBP, { readonly: true });
t('every row count is identical', JSON.stringify(counts(db)) === JSON.stringify(before));
db.close();

console.log('\n── the boot migration on the pre-D-160 table ──');
const log = boot();
db = new Database(DBP);
const newSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ap_drops'").get().sql;
t('boot widened the CHECK and said so', newSql.includes('to_partner_ar') && newSql.includes('receivable_other') && /now accepts to_partner_ar/.test(log), log.slice(-200));
t('every drop survived', db.prepare('SELECT COUNT(*) c FROM ap_drops').get().c === before.ap_drops);
t('the activity log survived (the cascade did not fire)', db.prepare('SELECT COUNT(*) c FROM ap_drop_events').get().c === before.ap_drop_events);
t('the indexes came back', ['idx_ap_drops_status', 'idx_ap_drops_sha', 'idx_ap_drops_user'].every(n => db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?").get(n)));
db.prepare("UPDATE ap_drops SET status = 'to_partner_ar' WHERE id = 'aaaa1136-0000'").run();
t('the new status is accepted now', db.prepare("SELECT status FROM ap_drops WHERE id = 'aaaa1136-0000'").get().status === 'to_partner_ar');
t('foreign keys are on and still hold', db.pragma('foreign_key_check').length === 0);
db.close();
const log2 = boot();
t('a second boot does nothing', !/now accepts to_partner_ar/.test(log2));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
