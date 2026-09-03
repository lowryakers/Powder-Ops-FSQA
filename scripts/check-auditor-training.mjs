// The Auditor View's training columns read columns that EXIST.
//
// The table rendered `r.person_name || r.user_name` — neither a column on
// training_records — so every person read "—" and the CSV shipped a blank
// Person column. This walks every column definition with a recording proxy
// and checks each property it reads against the real schema in db.js plus the
// aliases the /training endpoint joins in, so a label can never again point at
// a column that is not there.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TRAINING_COLUMNS } from '../src/lib/auditorTraining.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

// Real columns: the CREATE TABLE in db.js …
const db = readFileSync(join(ROOT, 'server/db.js'), 'utf8');
const create = /CREATE TABLE IF NOT EXISTS training_records \(([\s\S]*?)\);/.exec(db);
t('training_records is declared in db.js', !!create);
const columns = new Set((create ? create[1] : '').split('\n').map(l => /^\s*([a-z_]+)\s/.exec(l)?.[1]).filter(Boolean));
// … plus later addColumnIfMissing calls …
for (const m of db.matchAll(/addColumnIfMissing\(db, 'training_records', '([a-z_]+)'/g)) columns.add(m[1]);
// … plus the aliases the list endpoint selects.
const api = readFileSync(join(ROOT, 'server/api/training.js'), 'utf8');
const listSql = /router\.get\('\/', \(req, res\) => \{[\s\S]*?SELECT tr\.\*,([^\n]*)/.exec(api);
t('the list endpoint selects tr.* with aliases', !!listSql);
for (const m of (listSql ? listSql[1] : '').matchAll(/AS ([a-z_]+)/g)) columns.add(m[1]);
t('the schema was read (employee_name is a column)', columns.has('employee_name'));
t('the join alias was read (course_title)', columns.has('course_title'));

console.log('\n── every property a column reads exists ──');
for (const col of TRAINING_COLUMNS) {
  const read = new Set();
  const probe = new Proxy({}, { get: (_, k) => { if (typeof k === 'string') read.add(k); return undefined; } });
  col.value(probe);
  t(`${col.label} reads at least one column`, read.size > 0);
  for (const k of read) t(`${col.label} → ${k} exists`, columns.has(k), `no such column on training_records or its joins`);
}

console.log('\n── and they render the record, not a dash ──');
const row = { employee_name: 'Maria Servin', training_topic: 'GMP', course_title: 'GMP-101 Good Manufacturing Practice',
  training_date: '2026-08-12', completion_date: '2026-08-12 09:00:00', score: 90, trainer: 'Adam' };
const by = Object.fromEntries(TRAINING_COLUMNS.map(c => [c.key, c.value(row)]));
t('Person is the employee', by.person === 'Maria Servin');
t('Course prefers the joined course over the imported heading', by.course === 'GMP-101 Good Manufacturing Practice');
t('an imported row with no course keeps its heading', TRAINING_COLUMNS.find(c => c.key === 'course').value({ training_topic: 'Food Defense (WI)' }) === 'Food Defense (WI)');
t('Completed is the date only', by.completed === '2026-08-12');
t('a matrix row dated only by training_date still has a date', TRAINING_COLUMNS.find(c => c.key === 'completed').value({ training_date: '2023-04-01' }) === '2023-04-01');
t('Score 0 is 0, not blank', TRAINING_COLUMNS.find(c => c.key === 'score').value({ score: 0 }) === 0);
t('Trainer is the trainer', by.trainer === 'Adam');
t('the CSV carries Trainer and the table does not', TRAINING_COLUMNS.some(c => c.key === 'trainer' && c.csvOnly));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
