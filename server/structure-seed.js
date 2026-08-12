// Seeds the managed lists the app ships with. These are proposals, not
// constants: ensureList() creates anything missing and then leaves it alone, so
// a label the team edits or an option they retire survives every later deploy.
//
// Once a list exists here, changing its contents is a Settings task rather than
// a code change — which is the entire point.

import { ensureList } from './custom-fields.js';
import { SANITATION_AREAS } from './sanitation-areas.js';

// Brittle plastic & glass inspection zones (Form 431-02). This list is the
// reason the feature exists: the zone set used to be a hardcoded array, so
// adding an area meant a deploy. The seed mirrors the zones already created by
// cleaning-seed.js so the two agree on day one.
const BPG_ZONES = [
  'Office 1', 'Office 2', 'Office 3', 'Main Lobby', 'Maintenance Area',
  'Bathrooms (1)', 'Bathrooms (2)', 'Sanitation Area', 'Gown Room', 'Break Room',
  'Production Area', 'Kitting Area', 'Quality Area',
  'Warehouse Area (1)', 'Warehouse Area (2)', 'Warehouse Area (3)', 'Warehouse Area (Main)',
];

export function seedStructureLists(db) {
  let added = 0;

  // Receiving Log dropdowns — the values the warehouse has actually used
  // across ~2,100 Monday rows.
  added += ensureList(db, {
    key: 'uom',
    label: 'Unit of Measure',
    description: 'Units used on receiving and inventory records.',
    options: ['Kg', 'G', 'Each', 'Lb', 'Case', 'Pallet'],
  });

  added += ensureList(db, {
    key: 'receiving_release_status',
    label: 'Receiving — Status of Release',
    description: 'QA disposition of an incoming lot.',
    options: ['N/A', 'Needs to be tested', 'Sent to the lab', 'RELEASED', 'Rejected'],
  });

  // Inspection zones, now editable in-app.
  added += ensureList(db, {
    key: 'bpg_zones',
    label: 'Brittle Plastic & Glass — Inspection Zones',
    description: 'Areas covered by the monthly Form 431-02 inspection. Adding a zone here makes it available to schedule.',
    options: BPG_ZONES,
  });

  // Meeting types. Management Review and the Food Safety Team meeting are SQF
  // records rather than preferences, so they ship; everything else the plant
  // holds regularly is here as a starting point and editable in Settings.
  added += ensureList(db, {
    key: 'meeting_types',
    label: 'Meeting Types',
    description: 'The kinds of meeting recorded in Meetings. Management Review and Food Safety Team are required records.',
    options: [
      'Management Review', 'Food Safety Team (HACCP)', 'Production / Operations',
      'Safety', 'Quality Review', 'Training', 'Customer / Supplier', 'Other',
    ],
  });

  // Where a clean happened. This was a free-text box, which is how one room
  // ended up filed under four spellings and how the 72-hour rule stopped
  // joining to the Production Log at all (see sanitation-areas.js).
  //
  // The VALUE is the room token the schedule and Production Log already store;
  // the LABEL is what a person reads. Adding an area is a Settings task from
  // here on — which is the point, and is why the picker has no free-text
  // escape hatch back into the state this fixes.
  added += ensureList(db, {
    key: 'sanitation_areas',
    label: 'Sanitation — Areas',
    description: 'Where a clean was performed. The stored value matches the Production Log\'s room, so the 72-hour re-clean rule can tell whether a cleaned room has since been used.',
    options: SANITATION_AREAS.map(a => ({
      value: a.value, label: a.label, meta: { applicable: a.applicable },
    })),
  });

  if (added > 0) console.log(`[seed] Structure lists: added ${added} list options`);
  return added;
}
