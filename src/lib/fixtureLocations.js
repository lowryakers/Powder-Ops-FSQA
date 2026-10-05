// Where each fixture of one kind is, in words someone can paste into a text
// (D-152).
//
// An inspector walking the plant with a phone wants "8. Fire extinguisher —
// beside Warehouse 1, east side", not a screenshot to squint at. The map
// already holds every position (`FIXTURES`) and every space (`ROOMS`), so the
// words are DERIVED from that geometry on every read — nothing is stored, and
// renaming a room in the app renames it in the list.
//
// - A fixture is numbered in the order FIXTURES lists it, and the same number
//   is drawn beside it on the map, so the list and the picture agree.
// - Inside a space → "in <space>". On open floor within REACH of one →
//   "beside <space>". Further than that → "nearest <space>", because claiming
//   "beside" for something across the warehouse is a wrong instruction.
// - Every line also names where it sits in the BUILDING (north-west corner,
//   east side …) — the one description that survives a room being renamed.
// - The positions were transcribed by eye from the paper map and the list says
//   so; it is a guide to where to look, not survey data.
const REACH = 24;

function distToRect(x, y, r) {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function buildingArea(x, y, plan) {
  const ew = x < plan.width / 3 ? 'west' : x > (2 * plan.width) / 3 ? 'east' : '';
  const ns = y < plan.height / 3 ? 'north' : y > (2 * plan.height) / 3 ? 'south' : '';
  if (ns && ew) return `${ns}-${ew} corner`;
  if (ns || ew) return `${ns || ew} side`;
  return 'middle of the building';
}

export function fixtureLocations(type, { rooms, fixtures, plan, nameOf = (r) => r.label }) {
  return fixtures.filter((f) => f.type === type).map((f, i) => {
    let best = null;
    for (const r of rooms) {
      if (!nameOf(r)) continue;
      const d = distToRect(f.x, f.y, r);
      // Ties go to the smaller space: a point on the wall of a room and the
      // corridor it opens onto is better described by the room.
      if (!best || d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && r.w * r.h < best.r.w * best.r.h)) best = { d, r };
    }
    const relation = !best ? null : best.d === 0 ? 'in' : best.d <= REACH ? 'beside' : 'nearest';
    const area = buildingArea(f.x, f.y, plan);
    const where = best ? `${relation} ${nameOf(best.r)}` : '';
    return {
      n: i + 1, x: f.x, y: f.y, room_id: best?.r.id || null, room: best ? nameOf(best.r) : null,
      relation, area, text: where ? `${where} (${area})` : area,
    };
  });
}

export function locationsText(label, list) {
  return [
    `${label} locations — ${list.length}`,
    ...list.map((l) => `${l.n}. ${l.text.charAt(0).toUpperCase()}${l.text.slice(1)}`),
    'Positions are from the facility map and approximate.',
  ].join('\n');
}
