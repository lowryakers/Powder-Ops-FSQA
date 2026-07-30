// Seeds the managed lists the app ships with. These are proposals, not
// constants: ensureList() creates anything missing and then leaves it alone, so
// a label the team edits or an option they retire survives every later deploy.
//
// Once a list exists here, changing its contents is a Settings task rather than
// a code change — which is the entire point.

import { ensureList } from './custom-fields.js';

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

  if (added > 0) console.log(`[seed] Structure lists: added ${added} list options`);
  return added;
}
