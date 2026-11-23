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
// D-217: the schedules and their cards keep QA's INSPECTIONS by title
// (TASK_TITLE_SQL), not "anything already on QA"; a one-off card on the machine
// that is already QA's keeps its team.
t('G4 reassigning a machine leaves QA\'s inspections on QA\'s list',
  (src('server/api/equipment.js').match(/NOT \$\{TASK_TITLE_SQL\}/g) || []).length === 2
  && /COALESCE\(task_group, ''\) != 'qa'/.test(src('server/api/equipment.js')));
{ const pay = src('server/api/pay.js');
  // Four callers since D-057: the assignment list, the review list, the nudge,
  // and payActions (the office's queue). A fifth list route must join them.
  t('G5 assignments, reviews, the nudge and the action queue read the LINKED name and role',
    (pay.match(/withEmployeeFacts\(db, db\.prepare/g) || []).length === 4 && /e\.user_id/.test(pay));
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

// ── MOVE 06: every copied fact has its writers named (D-379) ──
// A copy is safe only while its writers are known. Each entry is a column that
// copies a fact owned elsewhere, the owner, and the files allowed to WRITE it
// (an UPDATE … SET col = or an INSERT naming the column). A new file writing
// one fails here, so a second writer is a decision someone makes on purpose,
// not a drift found months later. Dynamic column lists (built from an array)
// are not seen by this scan; the verifies for each mirror cover those.
console.log('\n── mirror writers ──');
{ const { readdirSync, statSync } = await import('fs');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d))) {
    const p = `${d}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) { if (f !== 'node_modules') walk(p); }
    else if (p.endsWith('.js')) files.push(p);
  } };
  walk('server');
  const bodies = files.map(f => [f, src(f)]);
  const writersOf = (table, col) => {
    const out = new Set();
    for (const [f, s] of bodies) {
      const up = new RegExp(`UPDATE\\s+${table}\\s+SET([\\s\\S]{0,600}?)(WHERE|\`|'\\))`, 'g');
      let m;
      while ((m = up.exec(s))) if (new RegExp(`\\b${col}\\s*=`).test(m[1])) out.add(f);
      const ins = new RegExp(`INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+${table}\\s*\\(([^)]*)\\)`, 'g');
      while ((m = ins.exec(s))) if (new RegExp(`\\b${col}\\b`).test(m[2])) out.add(f);
    }
    return [...out];
  };
  const MIRRORS = [
    // [table, columns, owner, allowed writer files]
    ['products', ['nfp_version', 'nfp_approved_at'], 'the approved nfp_versions row (applyApproval)', ['server/api/nfp.js', 'server/products-seed.js']],
    ['products', ['artwork_status', 'artwork_version'], 'the released artwork_versions row', ['server/api/artwork.js', 'server/products-seed.js']],
    ['suppliers', ['status'], 'the latest supplier disposition', ['server/api/suppliers.js', 'server/supplier-import.js']],
    ['sanitation_records', ['atp_reading', 'atp_limit'], 'the record\'s swab rows (or its one legacy reading)', ['server/api/sanitation.js', 'server/api/pm.js', 'server/swab-sheet-seed.js']],
    ['supply_orders', ['label'], 'supply_orders.tags (first entry)', ['server/api/office.js', 'server/swab-stock.js']],
    ['sop_documents', ['equipment_id'], 'sop_documents.equipment_ids (first entry)', ['server/api/documents.js']],
    ['org_positions', ['job_description_id'], 'org_positions.job_description_ids (first entry)', ['server/api/org.js']],
    ['training_practical_evaluations', ['result'], 'gradeEvaluation() over the items', ['server/api/training.js']],
    ['calibration_instruments', ['last_calibrated'], 'the newest calibration_records row', ['server/api/calibration.js']],
    ['production_entries', ['product_name', 'mo_number', 'lot_number', 'quantity_completed'], 'mo_lines line 0 on a multi-MO entry', ['server/api/production.js', 'server/production-seed.js']],
    ['sop_documents', ['revision', 'doc_number'], 'the approved document_revisions row (recordApprovedRevision)', ['server/api/documents.js', 'server/document-revisions.js', 'server/banned-substance-sop-seed.js', 'server/form-431-seed.js', 'server/reference-seed.js']],
    ['haccp_ccps', ['critical_limits', 'monitoring_procedure'], 'Protocol 003 via preventive-controls.js (guardCcpEdit)', ['server/api/haccp.js', 'server/preventive-controls.js']],
  ];
  for (const [table, cols, owner, allowed] of MIRRORS) {
    for (const col of cols) {
      const w = writersOf(table, col);
      const extra = w.filter(f => !allowed.includes(f));
      t(`M ${table}.${col} is written only by its named writers (owner: ${owner})`, w.length > 0 && extra.length === 0,
        extra.length ? `also written by ${extra.join(', ')}` : (w.length ? '' : 'no writer found — the scan pattern is stale'));
    }
  }
  // The mirror and its fact travel together: every statement that writes a
  // supply order's `label` also writes its `tags`.
  const labelOnly = [];
  for (const [f, s] of bodies) {
    const ins = /INSERT\s+INTO\s+supply_orders\s*\(([^)]*)\)/g; let m;
    while ((m = ins.exec(s))) if (/\blabel\b/.test(m[1]) && !/\btags\b/.test(m[1])) labelOnly.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
  }
  t('M every supply order filed with a group writes tags and label together', labelOnly.length === 0, labelOnly.join(', '));
}

console.log('\n── residuals ──');
{ const { readdirSync } = await import('fs');
  const bare = readdirSync(join(ROOT, 'server/api')).filter(f => f.endsWith('.js'))
    .filter(f => /\bif \(q\) (\{|sql)/.test(src(`server/api/${f}`)) || /if \(req\.query\.q\) \{/.test(src(`server/api/${f}`)));
  t('no search guard accepts a whitespace-only query', bare.length === 0, bare.join(', ')); }
t('the COA file-count IN list is only prepared when there is something to put in it',
  /requests\.length > 0\n\s+\? db\.prepare\('SELECT request_id/.test(src('server/api/coa.js')));
t('the COA panel select-all is false for an empty group', (src('src/components/compliance/COAPanel.jsx').match(/g\.tests\.length > 0 && g\.tests\.every/g) || []).length === 2);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
