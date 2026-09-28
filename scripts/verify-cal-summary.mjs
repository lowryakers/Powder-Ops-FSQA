// The Calibration header has to agree with the rows under it.
//
// Live check 2026-09-28: the header read "32 of 32 current · 0 overdue" while
// the list showed #162 ("LOCK OUT TAG OUT") and #228 as out_of_service with a
// Next Due of 2026-07-31. `current` was derived as total − overdue − due_soon,
// `total` counted everything that is not retired, and overdue/due_soon
// deliberately exclude out-of-service instruments — so an out-of-service
// instrument months past its date was subtracted from nothing and landed in
// "current". This builds that exact shape and asserts the five figures
// partition the register.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 4991;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('cal-a','Cal Admin','Cal Admin','admin','qa',1,'{"calibration":"edit"}','SC-CAL', datetime('now','+7 day'))`).run();
  // Start from a known register: the seeds file their own instruments, and a
  // count that depends on how many they filed is a test that moves on its own.
  db.prepare('DELETE FROM calibration_instruments').run();
  const ins = db.prepare(`INSERT INTO calibration_instruments (id, name, type, calibration_frequency, status, next_due, department)
    VALUES (?, ?, 'scale', 'annual', ?, ?, ?)`);
  ins.run('ci-cur-1', 'Current scale 1', 'active', day(200), 'qa');
  ins.run('ci-cur-2', 'Current scale 2', 'active', day(120), 'qa');
  ins.run('ci-cur-3', 'Current scale 3', 'active', day(90), 'maintenance');
  ins.run('ci-over-1', 'Overdue scale 1', 'active', day(-40), 'qa');
  ins.run('ci-over-2', 'Overdue thermometer', 'overdue', day(-5), 'maintenance');
  ins.run('ci-soon-1', 'Due soon gauge', 'active', day(12), 'qa');
  // The two the live plant actually has: out of service AND months past due.
  ins.run('ci-oos-162', '#162 LOCK OUT TAG OUT', 'out_of_service', '2026-07-31', 'maintenance');
  ins.run('ci-oos-228', '#228', 'out_of_service', '2026-07-31', 'maintenance');
  ins.run('ci-nodue-1', 'No date on file', 'active', null, 'qa');
  ins.run('ci-ret-1', 'Retired scale', 'retired', day(-300), 'qa');
  db.close();
}

const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
await post('/users/login', { name: 'Cal Admin' });
await post('/users/set-password', { user_id: 'cal-a', password: 'Calib2026!', setup_code: 'SC-CAL' });
const auth = await (await post('/users/login', { name: 'Cal Admin', password: 'Calib2026!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
t('signed in', !!auth?.token, JSON.stringify(auth).slice(0, 160));

const s = await (await fetch(`${URL}/api/calibration/summary`, { headers: A })).json();
const j = JSON.stringify(s);

t('total counts every instrument that is not retired', s.total === 9, j);
t('the retired instrument is not in the register', s.total !== 10, j);
t('out_of_service is reported as its own figure', s.out_of_service === 2, j);
t('an out-of-service instrument past its date is NOT overdue', s.overdue === 2, j);
t('due in 30 days is counted', s.due_soon === 1, j);
t('an active instrument with no date is its own figure, not a pass', s.no_due_date === 1, j);

// THE ASSERTION THAT MATTERS: three are genuinely current, not six.
t('current counts only the instruments that are actually current', s.current === 3, j);
t('the header cannot claim every instrument is current', s.current !== s.total, j);
t('the five figures partition the register',
  s.current + s.overdue + s.due_soon + s.out_of_service + s.no_due_date === s.total, j);
t('no figure is negative',
  [s.current, s.overdue, s.due_soon, s.out_of_service, s.no_due_date].every(n => n >= 0), j);

const dept = Object.fromEntries((s.by_department || []).map(d => [d.department, d]));
t('the department roll-up is returned', !!dept.maintenance && !!dept.qa, j);
t('a department does not report an overdue the header counts as current',
  dept.maintenance?.overdue === 1, JSON.stringify(dept.maintenance));
t('the department overdue figures sum to the header overdue',
  (s.by_department || []).reduce((n, d) => n + d.overdue, 0) === s.overdue, j);
t('a department names its own out-of-service instruments',
  dept.maintenance?.out_of_service === 2, JSON.stringify(dept.maintenance));

// The rows the header is compared against: what the screen itself lists.
const rows = await (await fetch(`${URL}/api/calibration/instruments`, { headers: A })).json();
const list = Array.isArray(rows) ? rows : (rows.instruments || []);
const oos = list.filter(r => r.status === 'out_of_service');
t('the list still shows both out-of-service instruments', oos.length === 2, `${list.length} rows`);
t('one of them is the LOCK OUT TAG OUT instrument',
  oos.some(r => /LOCK OUT TAG OUT/i.test(r.name || '')), JSON.stringify(oos.map(r => r.name)));
t('the rows the list calls out of service equal the header figure',
  oos.length === s.out_of_service, j);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
