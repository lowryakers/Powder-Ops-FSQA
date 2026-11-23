// verify:spinep1a — D-367 (single-spine P1, step A). Overdue counts are honest:
// the flash splits team-owned from person-owned past-due cards and leaves out a
// card whose person has been deactivated; deactivating an account closes its
// leftover training (cancelled with an employment-ended note, never deleted);
// the training assignments list stops listing a departed person's open work.
// Caller sets PORT + DBPATH. Control: `main` before the change — the deactivated
// card is counted, deactivating leaves the training open, the list still shows it.
import Database from 'better-sqlite3';
import { overdueCounts } from '../server/work-order-owners.js';
import { exceptions } from '../server/flash-report.js';

const PORT = process.env.PORT || 5236;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 5000');

const mk = (id, name, role, active = 1) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'warehouse',?,?,datetime('now','+7 day'),?)`).run(id, name, name, role, active, `SC-${id}`, JSON.stringify({ training: 'edit', pm: 'edit' }));
mk('p1-boss', 'Pia Boss', 'admin');
mk('p1-here', 'Hal Present', 'operator');
mk('p1-gone', 'Gus Departed', 'operator', 0);    // already deactivated, card left behind
mk('p1-leave', 'Lea Leaving', 'operator');        // deactivated through the API below
mk('p1-bot', 'Bo Botlike', 'operator');           // marked not a trainee below
mk('p1-ended', 'Eda Ended', 'operator');          // access ended from the onboarding packet below

const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
await post('/users/login', { name: 'Pia Boss' });
await post('/users/set-password', { user_id: 'p1-boss', password: 'Spine2026!!x', setup_code: 'SC-p1-boss' });
const boss = await (await post('/users/login', { name: 'Pia Boss', password: 'Spine2026!!x' })).json();
t('signed in', !!boss?.token);
const call = async (method, p, body) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${boss.token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};

const today = db.prepare("SELECT date('now') d").get().d;
const yesterday = db.prepare("SELECT date('now','-1 day') d").get().d;
const eq = db.prepare('SELECT id FROM equipment LIMIT 1').get()?.id;
const course = db.prepare('SELECT id FROM training_courses LIMIT 1').get()?.id;
t('fixtures: a machine and a course exist', !!eq && !!course);
let n = 0;
const card = ({ status = 'missed', due = yesterday, to = null, toId = null, training = false, created = null } = {}) => {
  const id = `p1-wo-${++n}`;
  db.prepare(`INSERT INTO work_orders (id, equipment_id, title, status, due_date, assigned_to, assigned_to_id, training_course_id, task_group, created_at)
    VALUES (?,?,?,?,?,?,?,?, 'warehouse', COALESCE(?, datetime('now')))`).run(id, eq, `P1 check ${n}`, status, due, to, toId, training ? course : null, created);
  // The D-074 trigger fills the id from the name; a test of the name path clears it again.
  if (to && !toId) db.prepare('UPDATE work_orders SET assigned_to_id = NULL WHERE id = ?').run(id);
  return id;
};

console.log('\n── the flash counts');
const c0 = overdueCounts(db, today);
card();                                         // team-owned missed daily
const c1 = overdueCounts(db, today);
t('a team-owned missed card counts as team-owned', c1.team === c0.team + 1 && c1.person === c0.person && c1.total === c0.total + 1, JSON.stringify([c0, c1]));
card({ to: 'Hal Present', toId: 'p1-here' });     // person-owned missed daily
const c2 = overdueCounts(db, today);
t('a card named to a person counts as person-owned', c2.person === c1.person + 1 && c2.team === c1.team && c2.total === c1.total + 1, JSON.stringify(c2));
card({ to: 'Gus Departed', toId: 'p1-gone', training: true });   // missed training on a deactivated account
const c3 = overdueCounts(db, today);
t('a missed training card on a deactivated account does NOT count', c3.total === c2.total && c3.team === c2.team && c3.person === c2.person && c3.deactivated_left_out === c2.deactivated_left_out + 1, JSON.stringify(c3));
card({ to: 'Gus Departed' });                    // name only, no id
const c4 = overdueCounts(db, today);
t('…nor a card naming them with no account id', c4.total === c3.total && c4.deactivated_left_out === c3.deactivated_left_out + 1, JSON.stringify(c4));
db.prepare(`INSERT INTO users (id,name,username,role,department,is_active) VALUES ('p1-gone-twin','Gus Departed','Gus Twin','operator','warehouse',1)`).run();  // a namesake who still works here
const c5 = overdueCounts(db, today);
t('…but a name an ACTIVE account also carries is counted (never hide real work)', c5.total === c4.total + 1 && c5.person === c4.person + 1, JSON.stringify(c5));
db.prepare("DELETE FROM users WHERE id = 'p1-gone-twin'").run();
card({ status: 'open', due: today, to: 'Hal Present', toId: 'p1-here' });
t('a card due today is not past due', overdueCounts(db, today).total === c4.total);

// The flash text: make a spike (old cards a week ago, more now), then read it.
const old = overdueCounts(db, today, { createdBefore: "datetime('now','-7 day')" });
for (let i = 0; i < 10; i++) { const id = card(); db.prepare("UPDATE work_orders SET created_at = datetime('now','-8 day') WHERE id = ?").run(id); }
const add = Math.ceil(0.3 * (old.total + 10)) + 2;
for (let i = 0; i < add; i++) card({ to: 'Hal Present', toId: 'p1-here' });
const ex = exceptions(db).find(e => e.id === 'overdue_spike');
const now = overdueCounts(db, today);
t('the flash spike names team-owned and person-owned separately', !!ex && ex.text.includes(`(${now.team} team-owned, ${now.person} named to a person)`) && ex.text.includes(`→ ${now.total}`), ex?.text || 'no spike');
t('…and carries the counts', ex?.counts?.total === now.total && ex.counts.team + ex.counts.person === ex.counts.total);

console.log('\n── deactivating an account');
const t1 = card({ status: 'open', due: today, to: 'Lea Leaving', toId: 'p1-leave', training: true });
const t2 = card({ status: 'missed', to: 'Lea Leaving', toId: 'p1-leave', training: true });
const t3 = card({ status: 'missed', to: 'Lea Leaving', training: true });           // name only
const pm = card({ status: 'missed', to: 'Lea Leaving', toId: 'p1-leave' });          // not training: left alone
const done = card({ status: 'completed', to: 'Lea Leaving', toId: 'p1-leave', training: true });
const before = db.prepare('SELECT COUNT(*) c FROM work_orders').get().c;
const r = await call('PUT', '/users/p1-leave', { is_active: 0 });
t('deactivate answers 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
const rows = db.prepare(`SELECT id, status, notes FROM work_orders WHERE id IN (?,?,?,?,?)`).all(t1, t2, t3, pm, done);
const by = Object.fromEntries(rows.map(x => [x.id, x]));
t('her open and missed training cards are cancelled (by id and by name)', [t1, t2, t3].every(id => by[id]?.status === 'cancelled'), JSON.stringify(rows.map(x => x.status)));
t('…with the employment-ended note, saying it is not a completion', [t1, t2, t3].every(id => /account deactivated \/ employment ended\. This is not a completion of the course\./.test(by[id]?.notes || '')));
t('her non-training card and her completed training are untouched', by[pm]?.status === 'missed' && by[done]?.status === 'completed');
t('no row was deleted', db.prepare('SELECT COUNT(*) c FROM work_orders').get().c === before);
const audit = db.prepare(`SELECT details FROM audit_log WHERE entity_type = 'user' AND entity_id = 'p1-leave' ORDER BY rowid DESC LIMIT 1`).get();
t('the audit entry records how many were closed', /"training_tasks_closed":3/.test(audit?.details || ''), audit?.details);

console.log('\n── ending access from the onboarding packet (D-382)');
{ const e1 = card({ status: 'open', due: today, to: 'Eda Ended', toId: 'p1-ended', training: true });
  const e2 = card({ status: 'missed', to: 'Eda Ended', toId: 'p1-ended' });           // not training: left alone
  db.prepare(`INSERT INTO onboarding_records (id, status, first_name, last_name, user_id) VALUES ('p1-ob', 'completed', 'Eda', 'Ended', 'p1-ended')`).run();
  const before2 = db.prepare('SELECT COUNT(*) c FROM work_orders').get().c;
  const re = await call('POST', '/onboarding/p1-ob/end-access', { reason: 'Assignment ended' });
  t('end access answers 200 and deactivates the account', re.status === 200 && re.body?.account === true
    && db.prepare('SELECT is_active FROM users WHERE id = ?').get('p1-ended').is_active === 0, JSON.stringify(re.body).slice(0, 200));
  const s1 = db.prepare('SELECT status, notes FROM work_orders WHERE id = ?').get(e1);
  t('…and her open training is cancelled with the employment-ended note', s1.status === 'cancelled' && /account deactivated \/ employment ended/.test(s1.notes || ''), JSON.stringify(s1));
  t('…her non-training card is untouched, and no row was deleted',
    db.prepare('SELECT status FROM work_orders WHERE id = ?').get(e2).status === 'missed' && db.prepare('SELECT COUNT(*) c FROM work_orders').get().c === before2);
  t('…and the response says how many were closed', re.body?.training_tasks_closed === 1, String(re.body?.training_tasks_closed)); }

console.log('\n── not a trainee keeps its own wording');
const tb = card({ status: 'open', due: today, to: 'Bo Botlike', toId: 'p1-bot', training: true });
const rb = await call('PUT', '/users/p1-bot', { not_trainee: true });
const nb = db.prepare('SELECT status, notes FROM work_orders WHERE id = ?').get(tb);
t('marking not a trainee still cancels with the bot/system note', rb.status === 200 && nb.status === 'cancelled' && /not a trainee \(a bot or system account\)/.test(nb.notes) && !/employment ended/.test(nb.notes), JSON.stringify(nb));

console.log('\n── the training assignments list');
const gusCard = card({ status: 'missed', to: 'Gus Departed', toId: 'p1-gone', training: true });
const list = (await call('GET', '/training/assignments')).body || [];
t('no outstanding row for a deactivated account', !list.some(a => a.assigned_to_id === 'p1-gone' && a.outstanding) && !list.some(a => a.id === gusCard));
card({ status: 'missed', to: 'Hal Present', toId: 'p1-here', training: true });
const list2 = (await call('GET', '/training/assignments')).body || [];
t('…a present person\'s outstanding training is still listed', list2.some(a => a.assigned_to_id === 'p1-here' && a.outstanding));
t('…and a departed person\'s COMPLETED training stays as history', list.some(a => a.id === done && a.status === 'completed'));

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
