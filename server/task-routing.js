// Who sees which tasks — READ-ONLY (D-217). One definition, two callers: the Settings card
// (Data backup → Who sees which tasks, run on the live database) and `npm run report:routing -- <db copy>`.
// Every statement is a SELECT on the connection it is handed. Nothing is written, not even an audit row.
//
// Asked because Maria still had a "Daily PM Checklist — Production (Qa)" card beside the three
// Temp & Humidity checks, and the plant suspected more people see work that is not theirs. A task
// reaches a person by ONE rule (`/pm/operator-tasks`): its `task_group` equals their department, or it
// is assigned to them. A schedule's `task_group` comes from its equipment's team (`equipment.task_group`,
// `syncTaskGroupToPM`), so a machine assigned to QA sends its PMs to QA's list. This report lists every
// place that rule produces something a team should probably not be carrying, each with the reason and
// where it is changed. It reports; it never changes a schedule, a card or an account.
import { consolidatedChecklists, CONSOLIDATED_LIKE } from './pm-coverage.js';
import { TASK_GROUP_VALUES, taskGroupLabel } from '../shared/task-groups.js';
import { moduleLevel, parseModuleAccess } from './module-access.js';

const OUTSTANDING = "('open','in_progress','overdue','missed')";
// Machine care: what consolidation folded and what "Create schedules from these tasks" writes
// (`<machine> — Daily PM`). A controlled QA check (Temp & Humidity, BP&G, Light Inspection) never
// carries these words.
const MACHINE_CARE = /\bPM\b|preventive maintenance|lubricat|grease|Daily PM Checklist/i;
// The teams whose work IS machine care. Production teams run their own lines and may legitimately
// own a filler's daily PM, so they are listed, not flagged.
const MACHINE_TEAMS = new Set(['maintenance', 'warehouse']);
const NOT_MACHINE_TEAMS = new Set(['qa', 'document_control', 'office', 'cleaning']);

function duplicateCadence(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!MACHINE_CARE.test(r.title)) continue;
    const k = `${r.equipment_id}|${r.frequency_type}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter(g => g.length > 1).map(g => ({
    name: g[0].name, asset_id: g[0].asset_id, frequency_type: g[0].frequency_type, n: g.length,
    titles: g.map(r => `${r.title} [${taskGroupLabel(r.task_group) || 'no team'}]`).join(' + '),
  }));
}

export function taskRouting(db) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!has('pm_schedules') || !has('work_orders')) return null;

  const schedules = db.prepare(`SELECT ps.id, ps.title, ps.description, ps.frequency_type, ps.task_group, ps.is_active,
      ps.equipment_id, e.name eq_name, e.asset_id, e.task_group eq_team, e.status eq_status, e.asset_kind,
      (SELECT COUNT(*) FROM work_orders w WHERE w.pm_schedule_id = ps.id AND w.status IN ${OUTSTANDING}) open_cards
    FROM pm_schedules ps LEFT JOIN equipment e ON e.id = ps.equipment_id`).all();
  const active = schedules.filter(s => s.is_active === 1);
  const label = (s) => `${s.title}${s.eq_name ? ` · ${s.eq_name}${s.asset_id ? ` #${s.asset_id}` : ''}` : ''}`;

  // ── per team: what lands on its list ──
  const teams = {};
  for (const g of [...TASK_GROUP_VALUES, '(none)']) teams[g] = { schedules: 0, by_cadence: {}, machine_care: 0, open_cards: 0 };
  for (const s of active) {
    const g = TASK_GROUP_VALUES.includes(s.task_group) ? s.task_group : '(none)';
    const t = teams[g];
    t.schedules++; t.by_cadence[s.frequency_type] = (t.by_cadence[s.frequency_type] || 0) + 1;
    if (MACHINE_CARE.test(s.title)) t.machine_care++;
  }
  for (const r of db.prepare(`SELECT COALESCE(task_group, '(none)') g, COUNT(*) n FROM work_orders WHERE status IN ${OUTSTANDING} GROUP BY 1`).all()) {
    const g = TASK_GROUP_VALUES.includes(r.g) ? r.g : '(none)';
    teams[g].open_cards += r.n;
  }

  const findings = [];
  const add = (key, title, why, fix, rows) => { if (rows.length) findings.push({ key, title, why, fix, rows }); };

  // 1. A July room checklist still running for a team whose dailies are controlled forms (D-138).
  const checklists = consolidatedChecklists(db);
  const ownDaily = db.prepare(`SELECT title FROM pm_schedules WHERE equipment_id = ? AND is_active = 1 AND frequency_type = 'daily'
    AND (description IS NULL OR description NOT LIKE ?)`);
  add('checklist_wrong_team', 'Room checklists folded for a team that is not Maintenance or Warehouse',
    'PM consolidation (July) folded each team\'s daily schedules into one checklist per room. QA\'s and Cleaning\'s dailies are controlled checks that file their own record, so a folded checklist is a second card with no form number that files nothing.',
    'Recurring Schedules → open the checklist → pause it, once the plant confirms each line below is covered elsewhere.',
    checklists.filter(c => !MACHINE_TEAMS.has(c.schedule.task_group)).map(c => ({
      text: `${c.schedule.title} [${taskGroupLabel(c.schedule.task_group) || 'no team'}] — ${c.lines.length} line(s), hung on ${c.schedule.equipment_id ? (schedules.find(s => s.id === c.schedule.id)?.eq_name || 'unknown') : 'nothing'}`,
      lines: c.lines.map(l => {
        const own = l.equipment_ids.flatMap(id => ownDaily.all(id, CONSOLIDATED_LIKE).map(x => x.title));
        return `${l.label || l.step.slice(0, 60)} → ${!l.equipment_ids.length ? 'matches no equipment' : own.length ? `also has its own daily: ${own.join(', ')}` : 'no daily of its own (this checklist is its only daily)'}`;
      }),
    })));

  // 2. A checklist hung on a machine it no longer has a line for: the card names the wrong machine.
  add('checklist_anchor_off', 'Room checklists hung on a machine that is not on them',
    'A checklist can carry only one equipment id, so it was hung on the first machine folded. When that machine\'s line came off (D-138, D-139), the card kept showing it — the Production (Qa) card names the Production 1 monitor although that monitor has its own Temp & Humidity check.',
    'Pause the checklist if nothing on it is still owed; otherwise it needs re-hanging on a machine it covers.',
    checklists.filter(c => c.schedule.equipment_id && !c.lines.some(l => l.equipment_ids.includes(c.schedule.equipment_id)))
      .map(c => ({ text: `${c.schedule.title} — hung on ${schedules.find(s => s.id === c.schedule.id)?.eq_name || c.schedule.equipment_id}, which has no line on it` })));

  // 3. Machine care routed to a team that does not do machine care.
  add('machine_care_wrong_team', 'Machine PM schedules on QA, Document Control, Office or Cleaning lists',
    'A schedule\'s team comes from its equipment\'s team in the Equipment register. A machine whose team is set to QA sends every PM written on it to QA\'s list.',
    'Equipment → the machine → Team. Changing the team moves its schedules and open cards with it (QA-owned schedules are left alone on purpose, so check those by hand).',
    active.filter(s => NOT_MACHINE_TEAMS.has(s.task_group) && MACHINE_CARE.test(s.title) && !/Consolidated daily checks/.test(s.description || ''))
      .map(s => ({ text: `${label(s)} [${s.frequency_type}, ${taskGroupLabel(s.task_group)}; equipment team: ${taskGroupLabel(s.eq_team) || 'none'}] — ${s.open_cards} open card(s)` })));

  // 4. Areas carrying a machine PM. A monitoring point or an inspection zone has no motor to service.
  add('zone_pm', 'Areas (zones and monitoring points) carrying a machine PM',
    'Zones are areas, not machines (`asset_kind = zone`). A PM on one was usually created from imported maintenance text.',
    'Recurring Schedules → pause it, unless the area really has equipment that needs it.',
    active.filter(s => s.asset_kind === 'zone' && MACHINE_CARE.test(s.title) && !/Consolidated daily checks/.test(s.description || ''))
      .map(s => ({ text: `${label(s)} [${s.frequency_type}, ${taskGroupLabel(s.task_group) || 'no team'}] — ${s.open_cards} open card(s)` })));

  // 5. A schedule whose team is not the equipment's team: the two disagree about who owns the machine.
  add('team_disagrees', 'Schedules on a different team from their equipment',
    'Usually deliberate (a QA check on a production room), but a machine PM on another team is the same defect as 3.',
    'Decide per row: the schedule\'s team (Recurring Schedules) or the machine\'s team (Equipment).',
    active.filter(s => s.eq_team && s.task_group && s.eq_team !== s.task_group && MACHINE_CARE.test(s.title)
      && !/Consolidated daily checks/.test(s.description || ''))
      .map(s => ({ text: `${label(s)} — schedule: ${taskGroupLabel(s.task_group)}, equipment: ${taskGroupLabel(s.eq_team)}` })));

  // 6. Reaches nobody: no team, or a team that is not a team.
  add('no_team', 'Schedules whose team routes to nobody',
    'Only a team in the list reaches an Operator View. These cards are seen only by an admin browsing, or by a person they are assigned to.',
    'Recurring Schedules → Team.',
    active.filter(s => !TASK_GROUP_VALUES.includes(s.task_group))
      .map(s => ({ text: `${label(s)} [${s.frequency_type}] — team "${s.task_group ?? 'blank'}", ${s.open_cards} open card(s)` })));

  // 7. Open cards on a team other than their schedule's: a re-route that never reached the card.
  add('card_team_stale', 'Open cards on a different team from the schedule that raised them',
    'Changing a schedule\'s team moves its open cards, but older changes did not reach every status (missed cards above all). The card stays on the old team\'s list.',
    'Fix in code: carry the schedule\'s team onto its open cards.',
    db.prepare(`SELECT w.title, w.task_group card_team, ps.task_group sched_team, COUNT(*) n FROM work_orders w
        JOIN pm_schedules ps ON ps.id = w.pm_schedule_id
      WHERE w.status IN ${OUTSTANDING} AND COALESCE(w.task_group,'') != COALESCE(ps.task_group,'')
      GROUP BY w.pm_schedule_id, w.task_group ORDER BY n DESC`).all()
      .map(r => ({ text: `${r.title} — ${r.n} card(s) on ${taskGroupLabel(r.card_team) || 'no team'}, schedule is ${taskGroupLabel(r.sched_team) || 'no team'}` })));

  // 8. Cards left behind by a paused schedule or a retired machine.
  add('orphan_cards', 'Open cards from a paused schedule or out-of-service equipment',
    'Pausing a schedule closes what it raised since D-139; cards from before that, or from a machine taken out of service, stay on the list.',
    'Cleanup Review closes them with a reason, or fix in code.',
    db.prepare(`SELECT w.title, w.task_group, ps.is_active, e.status eq_status, COUNT(*) n FROM work_orders w
        LEFT JOIN pm_schedules ps ON ps.id = w.pm_schedule_id LEFT JOIN equipment e ON e.id = w.equipment_id
      WHERE w.status IN ${OUTSTANDING} AND ((w.pm_schedule_id IS NOT NULL AND ps.is_active = 0) OR (e.status IS NOT NULL AND e.status != 'active'))
      GROUP BY w.pm_schedule_id, w.title ORDER BY n DESC`).all()
      .map(r => ({ text: `${r.title} [${taskGroupLabel(r.task_group) || 'no team'}] — ${r.n} card(s); ${r.is_active === 0 ? 'schedule paused' : `equipment ${r.eq_status}`}` })));

  // 9. Two active schedules of one cadence on one machine: the same job twice.
  add('duplicate_cadence', 'Machines with two active schedules at the same cadence',
    'Often a July schedule beside one made later by "Create schedules from these tasks". Both raise a card.',
    'Recurring Schedules → pause the one that is not wanted.',
    // Machine care only: four dilution checks on one chemical station are four controlled checks, not a duplicate.
    duplicateCadence(db.prepare(`SELECT ps.equipment_id, e.name, e.asset_id, ps.frequency_type, ps.title, ps.task_group
      FROM pm_schedules ps JOIN equipment e ON e.id = ps.equipment_id
      WHERE ps.is_active = 1 AND (ps.description IS NULL OR ps.description NOT LIKE ?) ORDER BY e.name, ps.title`).all(CONSOLIDATED_LIKE))
      .map(r => ({ text: `${r.name}${r.asset_id ? ` #${r.asset_id}` : ''} — ${r.n} ${r.frequency_type}: ${r.titles}` })));

  // ── people: what each Operator View shows, by the same rule as /pm/operator-tasks ──
  const people = db.prepare(`SELECT id, name, role, department, module_access FROM users
    WHERE is_active = 1 AND COALESCE(is_external, 0) = 0 AND role != 'auditor' AND lower(name) != 'readybot' ORDER BY department, name`).all()
    .map(u => {
      const dept = u.department || null;
      const group = dept || 'warehouse'; // the route's fallback for a blank department
      const n = u.role === 'admin' ? null : db.prepare(`SELECT COUNT(*) n FROM work_orders WHERE status IN ${OUTSTANDING}
        AND (task_group = ? OR assigned_to_id = ? OR assigned_to = ?)`).get(group, u.id, u.name).n;
      const user = { ...u, module_access: parseModuleAccess(u.module_access) };
      const note = u.role === 'admin' ? 'admin: picks any team'
        : !dept ? 'NO DEPARTMENT: sees Warehouse\'s tasks'
        : !TASK_GROUP_VALUES.includes(dept) ? `department "${dept}" is not a team: sees only tasks assigned by name`
        : '';
      return { name: u.name, role: u.role, department: dept, cards: n, task_center: !!moduleLevel(user, 'pm'), note };
    });

  return { teams, findings, people, active_schedules: active.length, checklists: checklists.length };
}

export function routingText(r, label) {
  const L = [];
  const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
  const num = (s, n) => String(s ?? '').padStart(n);
  L.push(`Who sees which tasks — ${label}`);
  L.push('Read-only: nothing was changed. A card reaches a person when its team is their department, or it is assigned to them.', '');
  if (!r) { L.push('No task tables in this database.'); return L.join('\n'); }
  L.push(`${r.active_schedules} active schedules, ${r.checklists} room checklists.`, '');
  L.push(`${pad('Team', 18)}${num('schedules', 10)}${num('machine PM', 11)}${num('open cards', 11)}  by cadence`);
  for (const [g, t] of Object.entries(r.teams)) {
    if (!t.schedules && !t.open_cards) continue;
    L.push(`${pad(g === '(none)' ? '(no team)' : taskGroupLabel(g), 18)}${num(t.schedules, 10)}${num(t.machine_care, 11)}${num(t.open_cards, 11)}  ${Object.entries(t.by_cadence).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  if (!r.findings.length) L.push('', 'No findings.');
  r.findings.forEach((f, i) => {
    L.push('', `${i + 1}. ${f.title} (${f.rows.length})`, `   Why: ${f.why}`, `   Where to change it: ${f.fix}`);
    for (const row of f.rows) {
      L.push(`   - ${row.text}`);
      for (const l of row.lines || []) L.push(`       · ${l}`);
    }
  });
  L.push('', 'People (active employees): cards on their Operator View today, and whether they can open the Task Center (every team).');
  L.push(`${pad('Name', 28)}${pad('Role', 12)}${pad('Department', 18)}${num('cards', 6)}  ${pad('Task Center', 12)}note`);
  for (const p of r.people) {
    L.push(`${pad(p.name, 28)}${pad(p.role, 12)}${pad(p.department || '—', 18)}${num(p.cards ?? '—', 6)}  ${pad(p.task_center ? 'yes' : 'no', 12)}${p.note}`);
  }
  return L.join('\n');
}
