// FORM 604-01 V1 — Master Site List (EMP).
//
// The environmental monitoring program's site list: what gets sampled, where,
// for what, how often, and the alert/action limits. Transcribed from the
// plant's own controlled form, wording kept as written — including its own
// oddities ("at least once per twice a year" on Zone 2 is the form's text;
// reading it as a cadence is done ONCE, in EMP_SCHEDULES below, and flagged
// there). Changing a limit or a frequency is a Document Change Request, the
// same doctrine as scale-forms.js tolerances.
//
// This file is the REFERENCE the Quality Schedules screen shows. The
// recurring work it implies is seeded as quality schedules (EMP_SCHEDULES),
// keyed on title and inserted once — an edited frequency or a paused schedule
// is a decision a redeploy must not undo.

export const EMP_FORM_CODE = 'FORM 604-01';
export const EMP_REVISION = 'V1';
export const EMP_TITLE = 'Master Site List (EMP)';

export const EMP_SECTIONS = [
  {
    key: 'air',
    title: 'Air',
    columns: ['Location', 'Specification Limit', 'Frequency'],
    rows: [
      { location: 'Production area Rooms / Warehouse', limit: 'For Information Only', frequency: 'All sites once/twice a year' },
      { location: 'Compressed Air', limit: 'For Information Only', frequency: 'All sites once/year' },
    ],
  },
  {
    key: 'water',
    title: 'Water',
    columns: ['Location', 'Tests', 'Sampling Frequency', 'Alert', 'Action'],
    rows: [
      { location: 'POTABLE WATER', test: 'Total Aerobic Bacteria Count', frequency: 'Monthly', alert: '>500 CFU/mL', action: '>1000 CFU/mL' },
      { location: 'POTABLE WATER', test: 'Total Coliforms', frequency: 'Monthly', alert: 'Present/100mL', action: 'Present/100mL' },
      { location: 'POTABLE WATER', test: 'Free Chlorine*', frequency: 'Monthly', alert: 'NA', action: '>2.0 ppm' },
    ],
    note: '*Only 1 composite sample for all locations chlorine is a site located close to where the water comes into the building.',
  },
  {
    key: 'zone1',
    title: 'Product Contact Surfaces: Zone 1',
    columns: ['Location', 'Tests', 'Frequency', 'Alert', 'Action'],
    rows: [
      {
        location: '2 product contact surfaces from each piece of manufacturing equipment (can include product contact utensils)',
        test: 'Total Aerobic Bacteria Count', alert: '>300 CFU/cm²', action: '>1000 CFU/cm²',
        frequency: 'Twice a year after a cleaning or if the item is cleaned less than once/month then sample after each cleaning',
      },
      {
        location: '2 product contact surfaces from each piece of manufacturing equipment (can include product contact utensils)',
        test: 'Total Yeast and Mold Count', alert: '>150 CFU/cm²', action: '>500 CFU/cm²',
        frequency: 'Twice a year after a cleaning or if the item is cleaned less than once/month then sample after each cleaning',
      },
      {
        location: 'Room: 2 product contact surfaces from each piece of manufacturing equipment (can include product contact utensils)',
        test: 'Total Aerobic Bacteria Count', alert: '>300 CFU/cm²', action: '>1000 CFU/cm²',
        frequency: 'Twice Monthly after a cleaning or if the item is cleaned less than twice a month then sample after each cleaning',
      },
      {
        location: 'Room: 2 product contact surfaces from each piece of manufacturing equipment (can include product contact utensils)',
        test: 'Total Yeast and Mold Count', alert: '>150 CFU/cm²', action: '>500 CFU/cm²',
        frequency: 'Twice Monthly after a cleaning or if the item is cleaned less than twice a month then sample after each cleaning',
      },
    ],
  },
  {
    key: 'zone2',
    title: 'Non-Product Contact Surfaces in close proximity to product contact surfaces: Zone 2',
    columns: ['Location', 'Tests', 'Frequency', 'Alert', 'Action'],
    sites: [
      'Production Blending/Pouching', 'Equipment Housing', 'Control Panel', 'Outer Surface of Vacuum Hose',
      'Tables', 'Scales', 'Elevator conveyor', 'Rooms', 'Table in Room', 'Scale, Weigh Plate and Control Panel',
      'Wall', 'Floor', 'Wall/Floor junction', 'Plastic tent', 'Shop Vac',
    ],
    rows: [
      { test: 'Salmonella species', alert: 'NA', action: 'Present in Sample', frequency: 'All sample sites to be tested at least once per twice a year' },
      { test: 'Listeria monocytogenes', alert: 'NA', action: 'Present in Sample', frequency: 'All sample sites to be tested at least once per twice a year' },
    ],
  },
  {
    key: 'zone3',
    title: 'More remote non-product contact surfaces near processing areas: Zone 3',
    columns: ['Location', 'Tests', 'Frequency', 'Alert', 'Action'],
    sites: [
      'Building M', 'Hand Wash/Gowning area', 'Floor Drain in a washroom', 'Gowning areas', 'Rack in a Zone 3 area',
      'Mop/Mop Buckets/Broom', 'Bins', 'Sink', 'Main Gowning Room', 'Mop/Mop Bucket', 'Broom or Squeegee',
    ],
    rows: [
      { test: 'Salmonella species', alert: 'NA', action: 'Present in Sample', frequency: 'All sample sites to be tested at least once a year' },
      { test: 'Listeria monocytogenes', alert: 'NA', action: 'Present in Sample', frequency: 'All sample sites to be tested at least once a year' },
    ],
  },
  {
    key: 'zone4',
    title: 'Remote areas outside of the processing area: Zone 4',
    columns: ['Location', 'Tests', 'Frequency', 'Alert', 'Action'],
    sites: [
      'Warehouse / Office area', 'Reception, office hallway, offices and bathroom.', 'Breakroom',
      'Receiving/Shipping dock area', 'Maintenance rooms', 'Packaging Area',
    ],
    rows: [
      { test: 'Salmonella species', alert: 'NA', action: 'Present in Sample', frequency: 'All sample sites to be tested at least once per quarter' },
      { test: 'Listeria monocytogenes', alert: 'NA', action: 'Present in Sample', frequency: 'All sample sites to be tested at least once per quarter' },
    ],
  },
];

/**
 * Which existing quality schedule covers each of the form's rows, so nothing
 * on the paper is silently uncovered. The water and air rows were already
 * scheduled before this form was transcribed; the rest are seeded below.
 */
export const EMP_COVERAGE = [
  { row: 'Water — potable (TAB, Total Coliforms, Free Chlorine), Monthly', schedule: 'Tap Water Testing' },
  { row: 'Air — production rooms / warehouse, once-twice a year', schedule: 'Air Testing (Settle Plate)' },
  { row: 'Air — compressed, once/year', schedule: 'Compressed Air Testing (EMP)' },
  { row: 'Zone 1 — equipment product contact surfaces, twice a year', schedule: 'EMP Zone 1 Swabs — Equipment Surfaces' },
  { row: 'Zone 1 — room product contact surfaces, twice monthly', schedule: 'EMP Zone 1 Swabs — Room Surfaces' },
  { row: 'Zone 2 — Salmonella + Listeria monocytogenes', schedule: 'EMP Zone 2 Swabs (Salmonella / Listeria)' },
  { row: 'Zone 3 — Salmonella + Listeria monocytogenes, once a year', schedule: 'EMP Zone 3 Swabs (Salmonella / Listeria)' },
  { row: 'Zone 4 — Salmonella + Listeria monocytogenes, once per quarter', schedule: 'EMP Zone 4 Swabs (Salmonella / Listeria)' },
];

/**
 * The schedules the form implies, in the shape seedQualitySchedules takes.
 * Each carries the limits in its steps so the person swabbing does not need
 * the form open beside the task.
 *
 * Two cadence readings worth knowing about:
 * - Zone 1 rooms: the form says "Twice Monthly"; the closest supported
 *   frequency is biweekly (every 14 days), which lands 26/yr vs 24 — the
 *   conservative side.
 * - Zone 2: the form's cell reads "at least once per twice a year", which
 *   does not parse cleanly; seeded as semi-annual (twice a year), the more
 *   frequent of the two readings. If Document Control rules it means annual,
 *   edit the schedule — the seed never overwrites an edit.
 */
export const EMP_SCHEDULES = [
  {
    title: 'Compressed Air Testing (EMP)',
    module_id: 'Environmental Monitoring',
    description: 'Annual compressed air quality test — FORM 604-01: all sites once/year, results for information only. File the lab report against this task.',
    frequency_type: 'annual', frequency_value: 1,
    procedure_steps: [
      'Sample compressed air at each point of use per the method',
      'Label each sample with the point, date and time',
      'Send to the contract lab and record where they went',
      'File the result against this task (for information only — no spec limit)',
    ],
  },
  {
    title: 'EMP Zone 1 Swabs — Equipment Surfaces',
    module_id: 'Environmental Monitoring',
    description: 'FORM 604-01 Zone 1: 2 product contact surfaces from each piece of manufacturing equipment (can include product contact utensils), twice a year after a cleaning — or, if the item is cleaned less than once/month, sample after each cleaning. TAB alert >300 / action >1000 CFU/cm²; Yeast & Mold alert >150 / action >500 CFU/cm².',
    frequency_type: 'semi_annual', frequency_value: 1,
    procedure_steps: [
      'Swab AFTER a cleaning, never before',
      'Swab 2 product contact surfaces on each piece of manufacturing equipment (utensils count)',
      'Test each swab for Total Aerobic Bacteria Count and Total Yeast and Mold Count',
      'Grade TAB: alert >300 CFU/cm², action >1000 CFU/cm²',
      'Grade Yeast & Mold: alert >150 CFU/cm², action >500 CFU/cm²',
      'Any action-level result: open a Non-Conformance and notify the QA Manager',
    ],
  },
  {
    title: 'EMP Zone 1 Swabs — Room Surfaces',
    module_id: 'Environmental Monitoring',
    description: 'FORM 604-01 Zone 1 (rooms): 2 product contact surfaces, twice monthly after a cleaning — or, if the item is cleaned less than twice a month, sample after each cleaning. Same limits as equipment surfaces.',
    frequency_type: 'biweekly', frequency_value: 1,
    procedure_steps: [
      'Swab AFTER a cleaning, never before',
      'Swab 2 product contact surfaces in the room',
      'Test each swab for Total Aerobic Bacteria Count and Total Yeast and Mold Count',
      'Grade TAB: alert >300 CFU/cm², action >1000 CFU/cm²',
      'Grade Yeast & Mold: alert >150 CFU/cm², action >500 CFU/cm²',
      'Any action-level result: open a Non-Conformance and notify the QA Manager',
    ],
  },
  {
    title: 'EMP Zone 2 Swabs (Salmonella / Listeria)',
    module_id: 'Environmental Monitoring',
    description: 'FORM 604-01 Zone 2 — non-product contact surfaces in close proximity to product contact surfaces: blending/pouching equipment housing, control panels, vacuum hose outer surface, tables, scales, elevator conveyor, walls, floors, wall/floor junctions, plastic tent, shop vac. Salmonella species and Listeria monocytogenes; action = present in sample.',
    frequency_type: 'semi_annual', frequency_value: 1,
    procedure_steps: [
      'Swab every Zone 2 sample site on the Master Site List',
      'Test for Salmonella species and Listeria monocytogenes',
      'Action level: PRESENT in any sample',
      'A positive: hold affected product, open a Non-Conformance, notify the QA Manager immediately',
    ],
  },
  {
    title: 'EMP Zone 3 Swabs (Salmonella / Listeria)',
    module_id: 'Environmental Monitoring',
    description: 'FORM 604-01 Zone 3 — more remote non-product contact surfaces near processing areas: hand wash/gowning areas, floor drain in a washroom, racks, mops/mop buckets/brooms, bins, sinks, main gowning room, squeegees. All sites at least once a year. Salmonella species and Listeria monocytogenes; action = present in sample.',
    frequency_type: 'annual', frequency_value: 1,
    procedure_steps: [
      'Swab every Zone 3 sample site on the Master Site List',
      'Test for Salmonella species and Listeria monocytogenes',
      'Action level: PRESENT in any sample',
      'A positive: open a Non-Conformance and notify the QA Manager immediately',
    ],
  },
  {
    title: 'EMP Zone 4 Swabs (Salmonella / Listeria)',
    module_id: 'Environmental Monitoring',
    description: 'FORM 604-01 Zone 4 — remote areas outside the processing area: warehouse/office area, reception, office hallway, offices and bathroom, breakroom, receiving/shipping dock, maintenance rooms, packaging area. All sites at least once per quarter. Salmonella species and Listeria monocytogenes; action = present in sample.',
    frequency_type: 'quarterly', frequency_value: 1,
    procedure_steps: [
      'Swab every Zone 4 sample site on the Master Site List',
      'Test for Salmonella species and Listeria monocytogenes',
      'Action level: PRESENT in any sample',
      'A positive: open a Non-Conformance and notify the QA Manager immediately',
    ],
  },
];

export const EMP_SITE_LIST = {
  form_code: EMP_FORM_CODE,
  revision: EMP_REVISION,
  title: EMP_TITLE,
  sections: EMP_SECTIONS,
  coverage: EMP_COVERAGE,
};
