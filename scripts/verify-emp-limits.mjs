// verify:emplimits — D-204, single-spine move 03 for the environmental
// monitoring alert and action levels (FORM 604-01).
//
// The levels lived in emp-results.js as code: changing ">500 CFU/mL" was a
// deploy, and the next result was graded against the new number with no
// approval anywhere. Now they are a controlled definition (controlled.js): a
// change parks for Document Control, the app goes on grading against the
// approved snapshot, approval applies it at once, and every graded sample
// keeps the level it was graded against.
//
// Caller sets PORT + DBPATH on a fresh database. The control is `main` before
// the change: no controlled definition, no /emp/limits.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5124;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
  VALUES ('emp-qa','Emp QA','Emp QA','admin','qa',1,'SC-EMP', datetime('now','+7 day'))`).run();
const H = { 'Content-Type': 'application/json' };
const post = (p, b, h = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers: h, body: JSON.stringify(b) });
await post('/users/login', { name: 'Emp QA' });
await post('/users/set-password', { user_id: 'emp-qa', password: 'EmpLimits2026!', setup_code: 'SC-EMP' });
const auth = await (await post('/users/login', { name: 'Emp QA', password: 'EmpLimits2026!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
t('signed in', !!auth?.token);
const get = async (p) => (await fetch(`${URL}/api${p}`, { headers: A })).json();

console.log('\n── under Document Control ──');
const row = db.prepare("SELECT * FROM controlled_definitions WHERE key = 'emp:FORM 604-01'").get();
t('the EMP levels are a controlled definition from first boot', row?.status === 'approved', JSON.stringify(row?.status));
const snap = JSON.parse(row?.approved_snapshot || '{}');
const water = snap.limits?.water?.['Total Aerobic Bacteria Count'];
t('…the approved baseline is the form\'s: water TABC alert >500, action >1000', water?.alert === 500 && water?.action === 1000 && snap.document === 'FORM 604-01');
t('…and the zone 2–4 pathogen tests are presence tests', snap.limits?.zone3?.['Listeria monocytogenes']?.kind === 'presence');
let lim = await get('/check-records/emp/limits');
t('GET /check-records/emp/limits answers with the levels in force', lim?.limits?.water?.['Total Aerobic Bacteria Count']?.alert === 500 && lim?.revision === 'V1', JSON.stringify(lim).slice(0, 120));

const TODAY = db.prepare("SELECT date('now') d").get().d;
const file = async (site, value) => (await post('/check-records/emp/samples', {
  zone: 'water', test: 'Total Aerobic Bacteria Count', site, sampled_on: TODAY, result_value: value,
}, A)).json();

console.log('\n── graded against the approved level ──');
let r = await file('Kitchen tap', '600');
t('600 CFU/mL is ALERT against >500', r.sample?.outcome === 'alert', JSON.stringify(r.sample?.outcome));
t('…and the sample keeps the level it was graded against', r.sample?.alert_limit === '>500 CFU/mL');
const first = r.sample?.id;

console.log('\n── a change parks, and takes effect when approved ──');
const pending = JSON.parse(JSON.stringify(snap));
pending.limits.water['Total Aerobic Bacteria Count'] = { ...water, alert: 700, alert_text: '>700 CFU/mL' };
pending.revision = 'V2';
db.prepare("UPDATE controlled_definitions SET pending_snapshot = ?, pending_hash = 'x', status = 'pending', pending_seen_at = datetime('now') WHERE id = ?")
  .run(JSON.stringify(pending), row.id);
lim = await get('/check-records/emp/limits');
t('while parked, the app goes on grading against >500', lim?.limits?.water?.['Total Aerobic Bacteria Count']?.alert === 500);
r = await file('Restroom tap', '600');
t('…so 600 is still ALERT', r.sample?.outcome === 'alert');
const ap = await post(`/controlled/${row.id}/approve`, {}, A);
t('Document Control approves', ap.ok, String(ap.status));
lim = await get('/check-records/emp/limits');
t('…the new level is in force at once, no restart', lim?.limits?.water?.['Total Aerobic Bacteria Count']?.alert === 700 && lim?.revision === 'V2');
r = await file('Mop sink', '600');
t('600 is now OK against >700, and the sample says >700', r.sample?.outcome === 'ok' && r.sample?.alert_limit === '>700 CFU/mL', JSON.stringify(r.sample && { o: r.sample.outcome, a: r.sample.alert_limit }));
const kept = db.prepare('SELECT outcome, alert_limit FROM emp_samples WHERE id = ?').get(first);
t('the sample graded under >500 still says ALERT and >500', kept?.outcome === 'alert' && kept?.alert_limit === '>500 CFU/mL');
r = await file('Ice machine', '1200');
t('an action-level result still raises its CAR', r.sample?.outcome === 'action' && !!r.capa?.capa_number);
const capa = db.prepare('SELECT description FROM capas WHERE capa_number = ?').get(r.capa?.capa_number);
t('…naming the revision of the levels it was graded against', /FORM 604-01 V2/.test(capa?.description || ''), capa?.description);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
