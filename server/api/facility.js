// What ReadyDoc knows about each space in the building.
//
// This is what makes the Facility Map a ReadyDoc screen rather than a picture
// of one: click a room and you get its last clean, whether it is inside the
// 72-hour window, what is scheduled in it this week, and the brittle-plastic
// zone that covers it — the questions people actually ask standing in front of
// a floor plan.
//
// The map's GEOMETRY lives on the client (`src/data/facilityMap.js`) because it
// is a drawing. Only the live facts come from here, keyed on the room name the
// records already use, so nothing needed a new column to make this work.

import { Router } from 'express';
import { getDb } from '../db.js';
import { recleanRooms } from './sanitation.js';

const router = Router();

// One pass per fact, grouped — not a query per room. There are ~30 spaces and
// this is on a screen someone opens repeatedly; the performance note in
// CLAUDE.md exists because per-room MAX() queries are exactly what made the
// re-clean status slow.
router.get('/map-status', (req, res) => {
  const db = getDb();
  const out = { rooms: {}, zones: {}, generated_at: new Date().toISOString() };

  // Last passed clean per area, and whether it was entered late.
  try {
    const rows = db.prepare(`SELECT area, MAX(performed_at) AS last_clean,
        SUM(CASE WHEN entered_late = 1 THEN 1 ELSE 0 END) AS late_entries
      FROM sanitation_records WHERE result = 'pass' GROUP BY area`).all();
    for (const r of rows) {
      out.rooms[r.area] = { ...(out.rooms[r.area] || {}), last_clean: r.last_clean, late_entries: r.late_entries || 0 };
    }
  } catch { /* optional */ }

  // The 72-hour rule's own answer, so the map and the Sanitation module can
  // never disagree about whether a room is due.
  try {
    for (const r of recleanRooms(db)) {
      out.rooms[r.room] = {
        ...(out.rooms[r.room] || {}),
        reclean_status: r.status,
        hours_since_clean: r.hours_since_clean,
        needs_reclean: !!r.needs_attention,
        reclean_applicable: !!r.applicable,
      };
    }
  } catch { /* optional */ }

  // What ran in each room recently, and what is scheduled there this week.
  try {
    const rows = db.prepare(`SELECT room, MAX(date) AS last_run, COUNT(*) AS runs_30d
      FROM production_entries WHERE room IS NOT NULL AND date >= date('now', '-30 days')
      GROUP BY room`).all();
    for (const r of rows) {
      out.rooms[r.room] = { ...(out.rooms[r.room] || {}), last_run: r.last_run, runs_30d: r.runs_30d };
    }
  } catch { /* optional */ }

  try {
    const monday = db.prepare("SELECT date('now', 'weekday 1', '-7 days') d").get().d;
    const rows = db.prepare(`SELECT room, COUNT(*) AS scheduled
      FROM production_schedule WHERE week_start = ? AND (team IS NOT NULL OR mo_number IS NOT NULL)
      GROUP BY room`).all(monday);
    for (const r of rows) {
      out.rooms[r.room] = { ...(out.rooms[r.room] || {}), scheduled_this_week: r.scheduled };
    }
  } catch { /* optional */ }

  // Equipment sited in each room.
  try {
    const rows = db.prepare(`SELECT COALESCE(room, location) AS place, COUNT(*) AS equipment
      FROM equipment WHERE status = 'active' AND COALESCE(room, location) IS NOT NULL
      GROUP BY place`).all();
    for (const r of rows) {
      out.rooms[r.place] = { ...(out.rooms[r.place] || {}), equipment: r.equipment };
    }
  } catch { /* optional */ }

  // Brittle Plastic & Glass: the item list per zone lives on the zone's PM
  // schedule (`item|qty|material`), and the last inspection is a sanitation
  // record filed against "Brittle Plastic/Glass — <zone>".
  try {
    const schedules = db.prepare(`SELECT title, procedure_steps FROM pm_schedules
      WHERE title LIKE 'Brittle Plastic & Glass Inspection — %'`).all();
    for (const s of schedules) {
      const zone = s.title.replace('Brittle Plastic & Glass Inspection — ', '').trim();
      let steps = [];
      try { steps = JSON.parse(s.procedure_steps || '[]'); } catch { steps = []; }
      const items = steps
        .map(line => {
          const [item, qty, material] = String(line).split('|').map(x => (x || '').trim());
          return item ? { item, qty: qty || '', material: material || '' } : null;
        })
        .filter(Boolean)
        .filter(i => i.item.toUpperCase() !== 'N/A');
      out.zones[zone] = { items, item_count: items.length };
    }
    const last = db.prepare(`SELECT area, MAX(performed_at) AS last_inspection
      FROM sanitation_records WHERE area LIKE 'Brittle Plastic/Glass — %' GROUP BY area`).all();
    for (const r of last) {
      const zone = r.area.replace('Brittle Plastic/Glass — ', '').trim();
      out.zones[zone] = { ...(out.zones[zone] || { items: [], item_count: 0 }), last_inspection: r.last_inspection };
    }
  } catch { /* optional */ }

  res.json(out);
});

export default router;
