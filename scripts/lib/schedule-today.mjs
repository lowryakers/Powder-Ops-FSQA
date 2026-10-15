// Put a production cell on TODAY's schedule (plant day) for a verify.
import { plantDateOf } from '../../server/plant-clock.js';
export function scheduleToday(db, room, team, { roomType = 'production', date = plantDateOf() } = {}) {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0, the schedule's own convention
  const ws = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  const id = `sched-${room}-${team}-${date}`.replace(/\s+/g, '_');
  db.prepare(`INSERT OR REPLACE INTO production_schedule (id, week_start, day_of_week, room, slot, room_type, team, created_by)
    VALUES (?, ?, ?, ?, 0, ?, ?, 'verify')`).run(id, ws, dow, room, roomType, team);
  return id;
}
