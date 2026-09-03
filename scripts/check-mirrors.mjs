// A fact has one owner, and the paths that used to write around it are closed.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

t('G3 closing a re-clean task from a cleaning record clears rework_required',
  /rework_required = 0, notes = COALESCE/.test(src('server/api/sanitation.js')));
t('G4 reassigning a machine leaves QA\'s inspections on QA\'s list',
  (src('server/api/equipment.js').match(/COALESCE\(task_group, ''\) != 'qa'/g) || []).length === 2);
{ const pay = src('server/api/pay.js');
  t('G5 assignments, reviews and the nudge read the LINKED name and role',
    (pay.match(/withEmployeeFacts\(db, db\.prepare/g) || []).length === 3 && /e\.user_id/.test(pay));
  t('G5 no list route hands back e.name straight from the join',
    !/JOIN pay_employees e ON e\.id = a\.employee_id\n\s+WHERE[^`]*`\)\.all\(soon\);\n/.test(pay)); }
{ const office = src('server/api/office.js');
  t('G6 a quantity below what arrived is refused', /Number\(patch\.qty\) < received/.test(office));
  t('G6 status cannot leave received while the count is full', /patch\.status !== 'received' && existing\.status === 'received'/.test(office));
  t('G6 a changed quantity moves the status with it', /received >= q \? 'received' : \(existing\.status === 'received' \? 'ordered'/.test(office)); }
t('G7 ReadyBot is created with a sign-in name', /INSERT INTO users \(id, name, username, role, department, is_active, module_access\) VALUES \(\?, 'ReadyBot', 'ReadyBot'/.test(src('server/api/comms.js')));
t('G7 onboarding derives the username at creation', /uniqueUsername\(db, name, null\)/.test(src('server/api/onboarding.js')));
{ const users = src('server/api/users.js');
  t('G8 a disambiguated username still follows a rename', /u\.username\.replace\(\/ \\d\+\$\/, ''\) === base/.test(users) && /stillDerived\(existing\)/.test(users)); }
t('G9 the area normalizer writes record_group with the area', /SET area = \?, record_group = \? WHERE id = \?/.test(src('server/api/sanitation.js')));
t('G10 the products seed never writes the NFP mirror', /nfp_version: null,/.test(src('server/products-seed.js')) && !/nfp_version: p\.nfp_version/.test(src('server/products-seed.js')));
t('G11 the equipment seed classifies what it inserts', /defaultAssetKind\(eq\.type\)/.test(src('server/seed.js')) && /asset_kind, loto_required\)/.test(src('server/seed.js')));
t('G13 the NFP paragraph says what the code does', /deliberately NOT in WRITABLE/.test(src('server/api/products.js')) && !/deliberately left WRITABLE/.test(src('server/api/products.js')));
t('E4 a raised quality check is due when the schedule said', /s\.next_due \|\| new Date\(\)/.test(src('server/api/quality-schedules.js')) && !/'normal', date\('now'\), \?, 'qa'/.test(src('server/api/quality-schedules.js')));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
