/**
 * The warehouse trucks' pre-shift inspection, and who owns it (D-123).
 *
 * The daily schedule of every forklift, pallet jack and forklift charger carries
 * a DESIGNED checklist — `item|check|section`, rendered on the Operator View as
 * the Good / Bad / X inspection, with inputs such as the hour meter. It is not a
 * copy of the two lines the equipment import left under "Daily" on the machine
 * record, and it must not be reduced to them.
 *
 * This used to run on EVERY boot and overwrite every such schedule
 * unconditionally, while `POST /equipment/procedure-steps/resync` reduced the
 * same schedules to the Equipment list's two lines. Two owners, one field: the
 * re-sync reported success, the floor lost its inspection until the next deploy
 * put it back, and the banner came back with the same fifteen machines on it.
 *
 * So the checklist is written only where the schedule does NOT already carry a
 * designed checklist — a plain or empty list. That is idempotent by
 * construction, it heals a schedule a re-sync flattened, and it leaves alone a
 * checklist somebody has edited by hand, which the old pass silently undid.
 */
export const isDesignedChecklist = (steps) =>
  Array.isArray(steps) && steps.some(s => typeof s === 'string' && s.includes('|'));

export const FORKLIFT_DAILY_STEPS = [
  'Check the Safety light housing|check|KEY OFF Procedures',
  'Overhead Light|check|KEY OFF Procedures',
  'Overhead Fan|check|KEY OFF Procedures',
  'Dash plastic|check|KEY OFF Procedures',
  'Head lights (Glass)|check|KEY OFF Procedures',
  'The vehicle inspection|check|KEY OFF Procedures',
  'Overhead guard|check|KEY OFF Procedures',
  'Hydraulic cylinders|check|KEY OFF Procedures',
  'Mast assembly|check|KEY OFF Procedures',
  'Lift chains and rollers|check|KEY OFF Procedures',
  'Forks|check|KEY OFF Procedures',
  'Tires|check|KEY OFF Procedures',
  'Examine the battery (any fluids on top? Acid?)|check|KEY OFF Procedures',
  'Water level (If added, how much?)|input|Fluid Checks',
  'Check the hydraulic fluid level|check|Fluid Checks',
  'Brake fluid level|check|Fluid Checks',
  'Grease Bearings (If need, notify Maintenance)|check|Fluid Checks',
  'KEY ON Procedures|check|KEY ON Procedures',
  'Check the gauges|check|KEY ON Procedures',
  'Hour meter (write the hours)|input|KEY ON Procedures',
  'Battery Level|check|KEY ON Procedures',
  'Test the standard equipment|check|KEY ON Procedures',
  'Steering|check|KEY ON Procedures',
  'Brakes|check|KEY ON Procedures',
  'Horn|check|KEY ON Procedures',
  'Safety seat (if equipped)|check|KEY ON Procedures',
];

export const PALLET_JACK_DAILY_STEPS = [
  'Forks condition (cracks, bends)|check|Visual Inspection',
  'Wheels and rollers|check|Visual Inspection',
  'Handle grip and controls|check|Visual Inspection',
  'Hydraulic jack/pump|check|Visual Inspection',
  'Lowering mechanism|check|Functional Check',
  'Lifting mechanism|check|Functional Check',
  'Steering operation|check|Functional Check',
  'Battery charge level (if electric)|check|Functional Check',
  'Charger and cord condition (if electric)|check|Functional Check',
  'Leaks (hydraulic fluid)|check|Functional Check',
  'Horn/alert (if equipped)|check|Functional Check',
  'Overall cleanliness|check|General',
];

export const CHARGER_DAILY_STEPS = [
  'Power cord condition|check|Inspection',
  'Connector/plug condition|check|Inspection',
  'Indicator lights functioning|check|Inspection',
  'Ventilation clear and unobstructed|check|Inspection',
  'No unusual smell or heat|check|Inspection',
  'Area around charger clean and dry|check|Inspection',
];

export function stepsForTruck(type) {
  if (type === 'Forklift') return FORKLIFT_DAILY_STEPS;
  if (type === 'Pallet Jack') return PALLET_JACK_DAILY_STEPS;
  if (type === 'Forklift Charger') return CHARGER_DAILY_STEPS;
  return null;
}

export function applyTruckChecklists(db) {
  const trucks = db.prepare("SELECT id, type FROM equipment WHERE type IN ('Forklift', 'Forklift Charger', 'Pallet Jack')").all();
  let written = 0;
  let kept = 0;
  for (const eq of trucks) {
    const stepsJson = JSON.stringify(stepsForTruck(eq.type));
    const daily = db.prepare("SELECT id, procedure_steps FROM pm_schedules WHERE equipment_id = ? AND frequency_type = 'daily'").all(eq.id);
    for (const s of daily) {
      let have;
      try { have = JSON.parse(s.procedure_steps || '[]'); } catch { have = []; }
      if (isDesignedChecklist(have)) { kept++; continue; }
      db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(stepsJson, s.id);
      // 'missed' too — yesterday's missed inspection is still on the floor's screen.
      db.prepare("UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ('open','in_progress','missed')").run(stepsJson, s.id);
      written++;
    }
  }
  return { written, kept };
}
