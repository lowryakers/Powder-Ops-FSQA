// verify:editfails — the finder for training records an edit turned into a fail (D-267).
//
// Plants the five shapes on a live server's database and checks the report sorts
// them: the edit bug's own (listed), a low-score edited fail (to check), a real
// fail (no completion date — left out), a failed row nobody edited (left out),
// an edit before the bug existed (left out). Also: the report writes nothing and
// is admin-only.
// Caller sets PORT + DBPATH (the runner boots the server).
import Database from 'better-sqlite3';

const PORT = Number(process.env.PORT || 5160);
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,'qa',1,?,datetime('now','+7 day'),'{"training":"edit"}')`).run(id, name, name, role, `SC-${id}`);
mk('ef-admin', 'Edna Admin', 'admin');
mk('ef-sup', 'Sam Super', 'supervisor');
const course = db.prepare('SELECT id, passing_score FROM training_courses WHERE active = 1 ORDER BY code LIMIT 1').get();
const rec = (id, name, status, passed, completion, score) => db.prepare(`INSERT INTO training_records
  (id, employee_name, training_topic, course_id, training_date, completion_date, status, passed, score)
  VALUES (?, ?, 'Fixture', ?, '2026-09-01', ?, ?, ?, ?)`).run(id, name, course.id, completion, status, passed, score);
const edit = (id, when) => db.prepare(`INSERT INTO audit_log (timestamp, actor, action, entity_type, entity_id, details)
  VALUES (?, 'Daniela Servin', 'update', 'training', ?, '{}')`).run(when, id);
rec('ef-bug', 'Bea Bug', 'failed', 0, '2026-09-01', null); edit('ef-bug', '2026-10-15 14:00:00');
rec('ef-bug2', 'Ben Bug', 'failed', 0, '2026-09-01', 100); edit('ef-bug2', '2026-10-20 09:00:00');
rec('ef-low', 'Lou Low', 'failed', 0, '2026-09-01', 40); edit('ef-low', '2026-10-16 10:00:00');
rec('ef-real', 'Ray Real', 'failed', 0, null, 40); edit('ef-real', '2026-10-16 10:00:00');
rec('ef-noedit', 'Nora None', 'failed', 0, '2026-09-01', null);
rec('ef-early', 'Earl Early', 'failed', 0, '2026-09-01', null); edit('ef-early', '2026-10-01 10:00:00');
// Ben still has a passing record for the course, so he still reads as trained.
rec('ef-bug2-pass', 'Ben Bug', 'completed', 1, '2026-10-25', 90);
db.close();

const call = async (p, tok) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, { headers: { Authorization: `Bearer ${tok}` } });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`http://localhost:${PORT}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'EditFails2026!!', setup_code: `SC-${id}` });
  return (await (await post('/users/login', { name, password: 'EditFails2026!!' })).json()).token;
};
const admin = await signIn('Edna Admin', 'ef-admin');
const sup = await signIn('Sam Super', 'ef-sup');

const count = () => { const d = new Database(DBP, { readonly: true }); try { return [d.prepare('SELECT COUNT(*) n FROM audit_log').get().n, d.prepare("SELECT group_concat(id || status || passed) s FROM training_records WHERE id LIKE 'ef-%'").get().s]; } finally { d.close(); } };
const before = count();
let r = await call('/compliance/edit-failed-training', admin);
const likely = (r.json?.likely || []).map(x => x.id).sort();
const check = (r.json?.check || []).map(x => x.id);
t('the edit bug\'s fails are listed (with no score, and with a passing score)', likely.join() === 'ef-bug,ef-bug2', likely.join());
t('an edited fail with a score below the pass mark is listed apart, to check', check.join() === 'ef-low', check.join());
const all = [...likely, ...check];
t('a real fail (filed with no completion date) is left out', !all.includes('ef-real'));
t('a failed record nobody edited is left out', !all.includes('ef-noedit'));
t('an edit from before the bug existed is left out', !all.includes('ef-early'));
const bea = r.json?.likely?.find(x => x.id === 'ef-bug');
t('each names who edited it and when', bea?.edited_by?.[0] === 'Daniela Servin' && bea?.first_edit?.startsWith('2026-10-15'));
t('…and whether the person still reads as trained', !bea?.other_pass && r.json?.likely?.find(x => x.id === 'ef-bug2')?.other_pass === '2026-10-25');
t('the text version reads plainly', /Bea Bug .* now reads NOT TRAINED/.test(r.json?.text || ''));
t('running it writes nothing (not even an audit row)', JSON.stringify(count()) === JSON.stringify(before));
r = await call('/compliance/edit-failed-training', sup);
t('it is admin-only', r.status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
