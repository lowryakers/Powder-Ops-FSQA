// verify:democleanup — D-219. The demo build's leftovers, retired once: 19,460 invented "completed" PM
// tasks (Feb–Jun, before go-live, no audit entry by an account) and the Auditor account on PIN 9999.
//
// Caller sets PORT + DBPATH (the runner boots the server). Boots a second server on PORT+100 so the
// once-only passes run over the fixtures, as a deploy would.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const PORT = Number(process.env.PORT || 5132);
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

const db = new Database(DBP);
const eq = db.prepare('SELECT id FROM equipment LIMIT 1').get().id;
const wo = (id, by, at) => db.prepare(`INSERT OR REPLACE INTO work_orders (id, equipment_id, title, due_date, status, completed_by, completed_at)
  VALUES (?, ?, 'Weekly PM — fixture', ?, 'completed', ?, ?)`).run(id, eq, at.slice(0, 10), by, at);
wo('dc-fake-1', 'Adam B.', '2026-03-03 10:00:00');
wo('dc-fake-2', 'Ricardo A.', '2026-04-14 09:30:00');
wo('dc-fake-3', 'Spencer R.', '2026-06-01 14:00:00');
// Same name, but somebody really did it: an audit entry by an account.
wo('dc-real', 'Ricardo A.', '2026-05-20 08:00:00');
db.prepare(`INSERT INTO audit_log (timestamp, actor, actor_id, action, entity_type, entity_id) VALUES ('2026-05-20 08:00:00', 'Ricardo A.', 'acct-1', 'complete', 'work_order', 'dc-real')`).run();
// After go-live: not the demo backfill's window, so not touched.
wo('dc-after', 'Adam B.', '2026-07-15 08:00:00');
wo('dc-other', 'Jorge Tamez', '2026-03-03 10:00:00');
// The demo Auditor, active on its PIN (a fresh database has already deactivated its own, so re-arm it).
db.prepare("UPDATE users SET is_active = 1, pin = '9999', password_hash = NULL WHERE name = 'Auditor' AND role = 'auditor'").run();
db.prepare("DELETE FROM app_settings WHERE key IN ('demo_history_retired_v1', 'demo_auditor_deactivated_v1')").run();
db.close();

const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT + 100), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { proc.kill(); } catch { /* gone */ } });
let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await wait(1000); try { await fetch(`http://localhost:${PORT + 100}/api/users/lookup?q=zz`); up = true; } catch { /* booting */ } }
t('second server booted', up, log.slice(-300));
const st = (id) => one('SELECT status, notes FROM work_orders WHERE id = ?', id);
t('the three invented completions are cancelled', ['dc-fake-1', 'dc-fake-2', 'dc-fake-3'].every(id => st(id).status === 'cancelled'));
t('each carries the reason', /Invented by the demo build/.test(st('dc-fake-2').notes || ''));
t('none was deleted', one("SELECT COUNT(*) n FROM work_orders WHERE id LIKE 'dc-fake-%'").n === 3);
t('a completion with an audit entry by an account is left', st('dc-real').status === 'completed');
t('a completion after go-live is left', st('dc-after').status === 'completed');
t('a real person\'s completion is left', st('dc-other').status === 'completed');
t('one audit entry records the batch', !!one("SELECT 1 x FROM audit_log WHERE entity_id = 'demo-history'"));
const aud = one("SELECT is_active, pin FROM users WHERE name = 'Auditor' AND role = 'auditor'");
t('the demo Auditor is deactivated and its PIN cleared', aud.is_active === 0 && !aud.pin, JSON.stringify(aud));
t('the boot log says both', /Retired 3 invented demo PM completions/.test(log) && /Deactivated the demo Auditor/.test(log), log.match(/\[migrate\] (Retired|Deactivated).*/g)?.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
