// A select can offer what the record already holds — and every managed-list
// select goes through the one helper that makes that true.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { withCurrent } from '../src/lib/managedList.js';
import { TASK_GROUPS, TASK_GROUP_VALUES } from '../shared/task-groups.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n── withCurrent ──');
const opts = [{ value: 'room_1', label: 'Room 1' }, { value: 'room_2', label: 'Room 2' }];
t('an active value is offered once, unchanged', JSON.stringify(withCurrent(opts, 'room_1')) === JSON.stringify(opts));
t('a blank value adds nothing', withCurrent(opts, '').length === 2 && withCurrent(opts, null).length === 2);
const r = withCurrent(opts, 'Restroom');
t('A RETIRED VALUE IS STILL OFFERABLE', r.length === 3 && r[2].value === 'Restroom' && r[2].retired === true);
t('...and labelled so nobody picks it for a new record', /no longer offered/.test(r[2].label));
t('a fallback label names what the value was', withCurrent(opts, 'eq-9', 'Old scale')[2].label === 'Old scale (no longer offered)');
t('bare strings are normalised to objects', withCurrent(['kg', 'lb'], 'g').map(o => o.value).join(',') === 'kg,lb,g'
  && withCurrent(['kg'], 'kg')[0].label === 'kg');
t('a numeric stored value matches a string option', withCurrent(['1', '2'], 1).length === 2);
t('undefined options are an empty list', withCurrent(undefined, '').length === 0);

console.log('\n── every managed-list select uses it ──');
for (const f of ['src/components/compliance/SanitationPanel.jsx', 'src/components/warehouse/ReceivingLogPanel.jsx',
  'src/components/common/CustomFields.jsx', 'src/components/compliance/QMSRecordsPanel.jsx',
  'src/components/compliance/ProductionLog.jsx', 'src/components/compliance/MeetingsPanel.jsx',
  'src/components/compliance/PMSchedulesPanel.jsx']) {
  const s = src(f);
  t(`${f} imports withCurrent and calls it`, /import \{ withCurrent \}/.test(s) && /withCurrent\(/.test(s));
}
t('the receiving FORM selects (UOM, release status) both go through it — the list filter may not',
  (src('src/components/warehouse/ReceivingLogPanel.jsx').match(/withCurrent\((uomList|statusList)\?\.options, form\./g) || []).length === 2);
t('the sanitation area select no longer maps the raw list',
  !/\(areas\?\.options \|\| \[\]\)\.map/.test(src('src/components/compliance/SanitationPanel.jsx')));
t('ProductsPanel offers `rejected`, the status artwork.js writes',
  /'print_ready', 'rejected', 'superseded'/.test(src('src/components/compliance/ProductsPanel.jsx'))
  && /'rejected'/.test(src('server/api/artwork.js')));
t('the training method select offers a blank for imported rows',
  /<option value="">Not recorded<\/option>/.test(src('src/components/compliance/TrainingPanel.jsx')));

console.log('\n── one team list ──');
t('every team has a value and a label', TASK_GROUPS.length > 0 && TASK_GROUPS.every(g => g.value && g.label));
t('values are distinct', new Set(TASK_GROUP_VALUES).size === TASK_GROUP_VALUES.length);
for (const v of ['office', 'document_control', 'cleaning', 'qa']) t(`${v} is a team`, TASK_GROUP_VALUES.includes(v));
t('the meetings server default (office) is a team somebody can open', TASK_GROUP_VALUES.includes('office')
  && /task_group \|\| 'office'/.test(src('server/api/meetings.js')));
t('Task Center builds its tabs from the shared list', /TASK_GROUPS\.map\(g =>/.test(src('src/components/compliance/PMPanel.jsx')));
t('Meetings has no private team list', !/const TASK_GROUPS = \[/.test(src('src/components/compliance/MeetingsPanel.jsx'))
  && /import \{ TASK_GROUPS \}/.test(src('src/components/compliance/MeetingsPanel.jsx')));
t('Recurring Schedules has no private team list', !/const GROUPS = \[/.test(src('src/components/compliance/PMSchedulesPanel.jsx'))
  && /import \{ TASK_GROUPS \}/.test(src('src/components/compliance/PMSchedulesPanel.jsx')));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
