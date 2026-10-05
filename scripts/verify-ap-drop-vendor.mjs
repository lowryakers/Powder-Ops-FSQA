// verify:apdropvendor — D-147, live: a drop already on file whose vendor the
// reader took from a table header is cleared at boot; a vendor a person typed
// is never touched. Caller sets PORT + DBPATH + DB_PATH. Boots its own server.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const PORT = Number(process.env.PORT || 5062);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HDR = '| ACTIVITY | QTY | | RATE | | AMOUNT |';

const db = new Database(DBP);
const ins = db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, parse_status, parsed_json, vendor_name, amount, status)
  VALUES (?, ?, ?, ?, 'partial', ?, ?, ?, 'new')`);
// The 14 Sep drop, as live has it: the reader's header row in the vendor field.
ins.run('v-hdr', 'invoice.pdf', 'k1', 'sha-1', JSON.stringify({ fields: { vendor: HDR, total: 27180.49 } }), HDR, 27180.49);
// A person typed "USA Packaging" over the reader's "USA": theirs, kept.
ins.run('v-typed', 'b.pdf', 'k2', 'sha-2', JSON.stringify({ fields: { vendor: 'USA' } }), 'USA Packaging', 120);
// A real vendor the reader got right: kept.
ins.run('v-good', 'c.pdf', 'k3', 'sha-3', JSON.stringify({ fields: { vendor: 'Mountain Flavor Supply' } }), 'Mountain Flavor Supply', 873.44);
db.close();

const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(BOOT2), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
let ready = false;
for (let i = 0; i < 90; i++) { await wait(1000); try { await fetch(`http://localhost:${BOOT2}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ } }
t('the application booted on the drops', ready);
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const v = (id) => q('SELECT vendor_name, status FROM ap_drops WHERE id = ?', id)[0];
t('the header-row vendor is cleared, and the drop stays Outstanding', v('v-hdr').vendor_name === null && v('v-hdr').status === 'new');
t('…with an event saying what it was and why', /vendor_cleared/.test(JSON.stringify(q("SELECT kind, detail FROM ap_drop_events WHERE drop_id = 'v-hdr'"))));
t('the boot log names it', /AP Drop v-hdr: vendor "\| ACTIVITY/.test(log));
t('a vendor a person typed is never touched', v('v-typed').vendor_name === 'USA Packaging');
t('a real vendor the reader got right is kept', v('v-good').vendor_name === 'Mountain Flavor Supply');
proc.kill('SIGKILL');
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
