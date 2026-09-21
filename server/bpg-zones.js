// The brittle plastic & glass zones, their inventories, and whether the
// inspector can actually see each one.
//
// FORM 431-02 is inspected zone by zone, and the list of what is IN a zone —
// "Windows | 16 | Glass" — lives as `pm_schedules.procedure_steps`, one
// schedule per zone. Those lists are the plant's to maintain: somebody counts
// the monitors in the Quality area and corrects what is on file.
//
// TWO THINGS WERE WRONG WITH WHERE THAT EDITOR LIVED. It was only on the BP&G
// task card in the Operator View — which is department-locked to `qa` AND
// gated on `isAdmin` — so Document Control, whose job this is, could not reach
// it from any screen. And a zone that is not producing a card has no task card
// to edit, which is exactly the zone somebody is asking about. A fix that is
// not where the problem is seen is a fix nobody runs.
//
// So this module answers both halves in one payload: every zone's inventory,
// AND its live inspection state with the REASON when there is no card. The
// state is DERIVED on every read from the schedule, the area and the work
// orders — never stored — so it cannot go stale the moment somebody
// reactivates an area.

import { logAudit } from './db.js';
import { recordAreaForTask } from './qa-records.js';

// The one spelling of a zone schedule's title. The seeder builds titles with
// this prefix and the operator view matches on it; a second copy is how the
// screen and the seeder start disagreeing about what a zone is.
export const BPG_TITLE_PREFIX = 'Brittle Plastic & Glass Inspection — ';

// Both zone-title spellings the database can hold: the em dash the seeder
// writes, and a plain hyphen somebody may have typed. Anchored, so an
// unrelated schedule that merely mentions glass is never treated as a zone.
const TITLE_RE = /^brittle plastic\s*(?:&|and)\s*glass inspection\s*[—–-]\s*(.+)$/i;

export function isBpgSchedule(title) {
  return TITLE_RE.test(String(title || '').trim());
}

export function zoneNameFromTitle(title) {
  const m = TITLE_RE.exec(String(title || '').trim());
  return m ? m[1].trim() : null;
}

// The work-order statuses that mean "there is a card in front of somebody".
// 'missed' IS one of them: a monthly inspection past its date is flipped to
// missed by housekeeping and is the ordinary state of a BP&G zone. Leaving it
// out is the defect this whole area keeps being reported for.
export const LIVE_STATUSES = ['open', 'in_progress', 'overdue', 'missed'];

/* ── The inventory, read and written ──────────────────────────────────────── */

// A stored step is `name|qty|material`. The placeholder a zone is seeded with
// when the code has no transcription for it is 'N/A|N/A|N/A' — a real absence,
// reported as an empty inventory rather than as one item called N/A.
export function parseItems(procedureSteps) {
  let steps = procedureSteps;
  if (typeof steps === 'string') {
    try { steps = JSON.parse(steps); } catch { steps = []; }
  }
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(s => typeof s === 'string' && s.includes('|'))
    .map(s => {
      const [name, qty, material] = s.split('|');
      return { name: (name || '').trim(), qty: (qty || '').trim(), material: (material || '').trim() };
    })
    .filter(i => i.name && i.name.toUpperCase() !== 'N/A');
}

export const MATERIALS = ['Plastic', 'Glass'];

// Rows in, storage strings out — with the refusals stated rather than silently
// repaired. A pipe inside a name would invent a fourth column in a
// pipe-delimited format and the item would come back mangled, so it is refused
// by name instead of being stripped.
//
// A PLAIN STRING WITH NO PIPE IS PASSED THROUGH UNTOUCHED. `procedure_steps`
// is the step list for every kind of schedule, not only a zone inventory —
// "Check the drive belt" is a maintenance step, and turning it into
// "Check the drive belt|1|Plastic" on its way through a shared writer would
// quietly rewrite another team's procedure.
export function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return { error: 'items must be an array' };
  const steps = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && !entry.includes('|')) {
      const plain = entry.trim();
      if (plain) steps.push(plain);
      continue;
    }
    const row = typeof entry === 'string'
      ? (() => { const [name, qty, material] = entry.split('|'); return { name, qty, material }; })()
      : (entry || {});
    const name = String(row.name ?? '').trim();
    if (!name) continue;   // a blank row is somebody having tapped Add and not typed
    const qty = String(row.qty ?? '').trim() || '1';
    const material = String(row.material ?? '').trim() || 'Plastic';
    for (const [label, v] of [['name', name], ['quantity', qty], ['material', material]]) {
      if (v.includes('|')) return { error: `A ${label} cannot contain "|" — it is the character that separates the columns.` };
    }
    steps.push(`${name}|${qty}|${material}`);
  }
  return { steps };
}

/* ── Who may change what an inspection covers ─────────────────────────────── */

// Adding or removing an item changes the SCOPE of a controlled inspection, so
// it is a Quality or Document Control decision, not a floor one — an inspector
// who finds a miscount reports it, which is precisely what happened here.
// Document Control is named because maintaining the inventory behind FORM
// 431-01 is their job and they held no `pm` grant, so every door was shut.
export function canEditZoneItems(user) {
  if (!user) return false;
  if (user.role === 'auditor') return false;      // read-only everywhere, by contract
  if (user.role === 'admin') return true;
  const dept = String(user.department || '').toLowerCase();
  if (dept === 'document_control' || dept === 'document control') return true;
  if (dept === 'qa' || dept === 'quality') return user.role === 'supervisor';
  return false;
}

/* ── Reading the zones ────────────────────────────────────────────────────── */

// Why a zone is not in front of the inspector. Derived, and each answer names
// something somebody can go and change — the point of the screen is that it
// ends the hunt rather than starting one.
function cardGap(sched, eq, live) {
  if (live) return null;
  if (!sched.is_active) return { code: 'paused', why: 'The recurring schedule is paused. Restart it in Recurring Schedules.' };
  if (!eq) return { code: 'no_area', why: 'The area this zone inspects is missing from the Equipment registry.' };
  if (eq.status !== 'active') {
    return { code: 'area_out_of_service', why: `The area is "${eq.status}" in the Equipment registry, so no inspection is raised for it. Set it back to active.` };
  }
  return { code: 'no_card_yet', why: 'No inspection card is open. One is raised the next time the schedule comes due.' };
}

export function bpgZones(db) {
  const scheds = db.prepare(`
    SELECT ps.*, e.id AS eq_id, e.name AS eq_name, e.status AS eq_status,
           e.asset_id AS eq_asset_id, e.location AS eq_location, e.room AS eq_room
      FROM pm_schedules ps
      LEFT JOIN equipment e ON e.id = ps.equipment_id
     WHERE ps.title LIKE 'Brittle Plastic%Glass%'
  `).all().filter(s => isBpgSchedule(s.title));

  const liveStmt = db.prepare(`
    SELECT id, status, due_date, assigned_to FROM work_orders
     WHERE pm_schedule_id = ? AND status IN (${LIVE_STATUSES.map(() => '?').join(',')})
     ORDER BY due_date ASC LIMIT 1
  `);
  // WHEN WAS THIS ZONE LAST INSPECTED is answered from the RECORD, not from a
  // completed task. `sanitation_records` is what an auditor asks for and what
  // the paper history was imported into; a task completion merely files one,
  // and most of this plant's BP&G history predates ReadyDoc raising tasks at
  // all. Reading the work orders alone had every zone saying "never inspected".
  // The area string comes from recordAreaForTask — the one map between a task
  // title and the record it files — rather than being spelled a second time.
  const lastRecStmt = db.prepare(`
    SELECT performed_at, performed_by, result FROM sanitation_records
     WHERE area = ? ORDER BY performed_at DESC LIMIT 1
  `);
  const lastWoStmt = db.prepare(`
    SELECT completed_at, completed_by FROM work_orders
     WHERE pm_schedule_id = ? AND status = 'completed' AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1
  `);

  const zones = scheds.map(s => {
    const eq = s.eq_id ? { id: s.eq_id, name: s.eq_name, status: s.eq_status, asset_id: s.eq_asset_id, location: s.eq_location, room: s.eq_room } : null;
    const live = liveStmt.get(s.id, ...LIVE_STATUSES) || null;
    const area = recordAreaForTask(s.title);
    const rec = area ? lastRecStmt.get(area) : null;
    const wo = rec ? null : lastWoStmt.get(s.id);
    const last = rec
      ? { at: rec.performed_at, by: rec.performed_by, result: rec.result }
      : wo ? { at: wo.completed_at, by: wo.completed_by, result: null } : null;
    const items = parseItems(s.procedure_steps);
    const gap = cardGap(s, eq, live);
    return {
      schedule_id: s.id,
      zone: zoneNameFromTitle(s.title) || s.title,
      title: s.title,
      frequency: s.frequency_type,
      is_active: !!s.is_active,
      task_group: s.task_group,
      equipment: eq,
      items,
      item_count: items.length,
      glass_count: items.filter(i => /glass/i.test(i.material)).length,
      live_card: live,
      record_area: area,
      last_inspected_at: last?.at || null,
      last_inspected_by: last?.by || null,
      last_result: last?.result || null,
      // The two halves of "is this zone in front of the inspector", and the
      // reason when it is not.
      inspectable: !!live,
      gap_code: gap?.code || null,
      gap_reason: gap?.why || null,
    };
  });

  // A ZONE NOBODY IS INSPECTING SORTS FIRST, and the order is the point: it is
  // the only state that looks finished from every other screen — the schedule
  // is there, the form is there, and no card ever reaches anybody. Everything
  // else reads alphabetically, which is how somebody finds a zone to correct.
  zones.sort((a, b) => (a.inspectable === b.inspectable)
    ? a.zone.localeCompare(b.zone)
    : (a.inspectable ? 1 : -1));
  return zones;
}

/* ── Writing the inventory: ONE writer ────────────────────────────────────── */

// Both doors — this module's route and PUT /pm/schedules/:id/items — go
// through here. The cascade onto the cards already open is the part that was
// wrong, and a second copy of it is a second chance to leave 'missed' out.
//
// Permission is NOT decided here: the two doors have different, honest rules
// (a maintenance supervisor legitimately edits a maintenance schedule's steps;
// only Quality and Document Control change what a BP&G inspection covers), so
// each caller applies its own before calling this.
export function writeScheduleItems(db, schedId, rawItems, user, { note = null } = {}) {
  const sched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(schedId);
  if (!sched) return { status: 404, error: 'PM schedule not found' };

  const { steps, error } = normalizeSteps(rawItems);
  if (error) return { status: 400, error };

  const before = parseItems(sched.procedure_steps);
  const stepsJson = JSON.stringify(steps);

  const tx = db.transaction(() => {
    db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?")
      .run(stepsJson, schedId);
    // 'missed' IS INCLUDED, and leaving it out is the defect this endpoint was
    // reported for. A monthly inspection past its date is flipped to 'missed'
    // by housekeeping — the ordinary state of a BP&G zone — so a corrected item
    // count reached the SCHEDULE and never the card the inspector was actually
    // working from. She counts sixteen windows, saves, and the list in front of
    // her still says eight.
    const info = db.prepare(`
      UPDATE work_orders SET procedure_steps = ?
       WHERE pm_schedule_id = ? AND status IN (${LIVE_STATUSES.map(() => '?').join(',')})
    `).run(stepsJson, schedId, ...LIVE_STATUSES);
    return info.changes;
  });
  const cardsUpdated = tx();

  const items = parseItems(stepsJson);
  logAudit(user, 'items_updated', 'pm_schedule', schedId, {
    item_count: items.length,
    was: before.length,
    cards_updated: cardsUpdated,
    ...(note ? { note } : {}),
  }, { procedure_steps: sched.procedure_steps }, { procedure_steps: stepsJson }, sched.title);

  return {
    status: 200,
    schedule: db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(schedId),
    items,
    cards_updated: cardsUpdated,
  };
}
