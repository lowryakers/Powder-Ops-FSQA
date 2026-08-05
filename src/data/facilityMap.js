// The facility, as data.
//
// Transcribed from the plant's facility map (the current layout — Batching
// Rooms 1-3, Rooms 1-7, packaging, warehouse racking, offices). Same principle
// as `processFlows.js`: this is DATA and the renderer is small, so correcting a
// room or adding a fixture is an edit here rather than a drawing exercise.
//
// WHY REDRAW IT AT ALL. A PDF of a floor plan answers one question — where
// things are. This answers the questions people actually ask standing in front
// of it: when was that room last cleaned, is it inside the 72-hour window, what
// is scheduled in it this week, which brittle-plastic zone covers it. The map
// is a way INTO the live record, which a scan can never be.
//
// COORDINATES are a plain 0-1000 × 0-410 grid matching the drawing's
// proportions (the building is roughly 2.4:1). They are relative positions, not
// survey data — the wall dimensions from the drawing travel separately in
// `SPANS` so the numbers on the map are the plant's own, not something derived
// from these boxes.
//
// `room` is the name ReadyDoc knows the space by (production_entries.room,
// sanitation_records.area). Where a room's map label and its record name differ,
// `room` wins for lookups and `label` is what gets drawn. A room with no `room`
// key is a space that isn't a record-keeping area (offices, the entrance).

export const PLAN = { width: 1000, height: 410 };

// Wall dimensions as printed on the drawing. Kept separate from the box
// geometry so the map shows the plant's own measurements rather than anything
// inferred from the rectangles.
export const SPANS = [
  { label: "40'", x: 44, y: 44, note: 'Bathrooms / sink bay' },
  { label: "75'", x: 430, y: 44, note: 'Entrance run' },
  { label: "69'", x: 240, y: 84, note: 'Production rooms, north end' },
  { label: "74'", x: 240, y: 262, note: 'Production rooms, south end' },
  { label: "49'", x: 630, y: 160, note: 'Warehouse bay' },
  { label: "64'", x: 790, y: 48, note: 'Warehouse depth' },
  { label: "64'", x: 600, y: 320, note: 'Warehouse bay, south' },
  { label: "57'", x: 380, y: 398, note: 'Shipping / receiving dock' },
];

// kind drives the colour: production rooms, batching, warehouse, support
// (bathrooms, break room), office, and dock.
export const ROOMS = [
  // ── North strip ─────────────────────────────────────────────────────────
  { id: 'sink-bay', label: 'Sinks', kind: 'support', x: 0, y: 0, w: 88, h: 37,
    note: 'Hand wash, mop sink, 4-compartment sink' },
  { id: 'bathroom-1', label: 'Bathroom', kind: 'support', room: 'Bathroom 1', x: 89, y: 3, w: 59, h: 34 },
  { id: 'bathroom-2', label: 'Bathroom', kind: 'support', room: 'Bathroom 2', x: 149, y: 3, w: 68, h: 34 },
  { id: 'break-room', label: 'Break Room', kind: 'support', room: 'Break Room', x: 228, y: 3, w: 135, h: 34 },
  { id: 'entrance', label: 'Entrance', kind: 'support', x: 364, y: 3, w: 134, h: 34 },

  // ── West block: batching + holds ────────────────────────────────────────
  { id: 'west-top', label: 'Warehouse', kind: 'warehouse', x: 0, y: 77, w: 88, h: 40 },
  { id: 'batching-1', label: 'Batching Rm 1', kind: 'batching', room: 'Batching 1', x: 2, y: 144, w: 86, h: 21 },
  { id: 'batching-2', label: 'Batching Rm 2', kind: 'batching', room: 'Batching 2', x: 2, y: 167, w: 86, h: 21 },
  { id: 'batching-3', label: 'Batching Rm 3', kind: 'batching', room: 'Batching 3', x: 2, y: 206, w: 86, h: 21 },
  { id: 'blender-1', label: 'Lg Blender 1', kind: 'equipment', room: 'Lg Blender 1', x: 2, y: 309, w: 86, h: 20 },
  { id: 'qa-hold', label: 'QA Hold', kind: 'hold', room: 'QA Hold', x: 2, y: 331, w: 86, h: 19 },
  { id: 'receiving-hold', label: 'Receiving hold area', kind: 'hold', room: 'Receiving Hold', x: 2, y: 371, w: 86, h: 20 },

  // ── Production room column ──────────────────────────────────────────────
  // `room` is the key this space's records are filed under and stays as it is;
  // `label` is what the map says, and the plant can change it in-app (Edit on
  // the detail panel) when the line in the space changes.
  { id: 'vffs', label: 'Bottling line', kind: 'production', room: 'Large VFFS', x: 153, y: 81, w: 74, h: 20 },
  { id: 'room-1', label: 'Room 1', kind: 'production', room: '1', x: 153, y: 102, w: 74, h: 19 },
  { id: 'room-2', label: 'Pouching machine Rm 2', kind: 'production', room: '2', x: 153, y: 122, w: 74, h: 41 },
  { id: 'room-3', label: 'Room 3', kind: 'production', room: '3', x: 153, y: 164, w: 74, h: 19 },
  { id: 'room-4', label: 'Room 4', kind: 'production', room: '4', x: 153, y: 184, w: 74, h: 20 },
  { id: 'room-5', label: 'Room 5', kind: 'production', room: '5', x: 153, y: 205, w: 74, h: 19 },
  { id: 'room-6', label: 'Room 6', kind: 'production', room: '6', x: 153, y: 226, w: 74, h: 19 },
  { id: 'room-7', label: 'Room 7', kind: 'production', room: '7', x: 153, y: 246, w: 74, h: 20 },
  { id: 'blender-2', label: 'Lg Blender 2', kind: 'equipment', room: 'Lg Blender 2', x: 151, y: 309, w: 76, h: 20 },

  // ── Centre ──────────────────────────────────────────────────────────────
  { id: 'packaging', label: 'Packaging area', kind: 'production', room: 'Packaging', x: 289, y: 79, w: 70, h: 245 },

  // ── Warehouse racking ───────────────────────────────────────────────────
  // Labelled 1/2/3 because those are the three Warehouse Area BP&G zones —
  // an unlabelled rectangle is a rectangle, and the zone it carries is the
  // whole reason someone opens the brittle-plastic layer.
  { id: 'rack-a', label: 'Warehouse 1', kind: 'warehouse', x: 550, y: 55, w: 62, h: 250 },
  { id: 'rack-b', label: 'Warehouse 2', kind: 'warehouse', x: 740, y: 55, w: 66, h: 250 },
  { id: 'rack-c', label: 'Warehouse 3', kind: 'warehouse', x: 866, y: 55, w: 62, h: 268 },

  // ── East: gate and offices ──────────────────────────────────────────────
  { id: 'locked-gate', label: 'Locked Gate', kind: 'support', x: 930, y: 55, w: 66, h: 24 },
  // Three offices in the south-east corner: one across the top, two below it.
  { id: 'office-1', label: 'Office', kind: 'office', x: 866, y: 319, w: 130, h: 30 },
  { id: 'office-2', label: 'Office', kind: 'office', x: 866, y: 351, w: 62, h: 40 },
  { id: 'office-3', label: 'Office', kind: 'office', x: 930, y: 351, w: 66, h: 40 },

  // ── South: shipping and receiving ───────────────────────────────────────
  { id: 'shipping-receiving', label: 'Shipping & Receiving', kind: 'dock', room: 'Shipping and Receiving',
    x: 240, y: 350, w: 420, h: 40 },
];

export const ROOM_KINDS = {
  production: { label: 'Production', fill: '#dbeafe', stroke: '#60a5fa', text: '#1e3a8a' },
  batching: { label: 'Batching', fill: '#fef3c7', stroke: '#fbbf24', text: '#78350f' },
  equipment: { label: 'Blenders', fill: '#fde68a', stroke: '#d97706', text: '#78350f' },
  warehouse: { label: 'Warehouse racking', fill: '#f1f5f9', stroke: '#94a3b8', text: '#334155' },
  hold: { label: 'Hold areas', fill: '#fee2e2', stroke: '#f87171', text: '#7f1d1d' },
  support: { label: 'Support / welfare', fill: '#e0f2fe', stroke: '#7dd3fc', text: '#075985' },
  office: { label: 'Offices', fill: '#f3f4f6', stroke: '#d1d5db', text: '#374151' },
  dock: { label: 'Shipping & receiving', fill: '#dcfce7', stroke: '#4ade80', text: '#14532d' },
};

// Fixtures, from the drawing's own legend. Positions are transcribed by eye
// from the plan; the map says so rather than implying survey accuracy.
export const FIXTURES = [
  { type: 'handwash', x: 40, y: 8 }, { type: 'handwash', x: 68, y: 17 },
  { type: 'handwash', x: 218, y: 8 }, { type: 'handwash', x: 238, y: 82 },
  { type: 'handwash', x: 238, y: 192 }, { type: 'handwash', x: 227, y: 296 },
  { type: 'handwash', x: 620, y: 192 }, { type: 'handwash', x: 622, y: 296 },
  { type: 'mopsink', x: 52, y: 6 },
  { type: 'foursink', x: 60, y: 26 },
  { type: 'extinguisher', x: 9, y: 7 }, { type: 'extinguisher', x: 241, y: 13 },
  { type: 'extinguisher', x: 241, y: 171 }, { type: 'extinguisher', x: 624, y: 87 },
  { type: 'extinguisher', x: 622, y: 212 }, { type: 'extinguisher', x: 238, y: 373 },
  { type: 'extinguisher', x: 562, y: 375 }, { type: 'extinguisher', x: 939, y: 13 },
  { type: 'pillar', x: 644, y: 8 },
];

export const FIXTURE_KINDS = {
  handwash: { label: 'Hand washing sink', color: '#bae6fd', edge: '#0284c7' },
  mopsink: { label: 'Mop sink', color: '#e0f2fe', edge: '#0369a1' },
  foursink: { label: '4-compartment sink', color: '#cbd5e1', edge: '#475569' },
  extinguisher: { label: 'Fire extinguisher', color: '#f97316', edge: '#c2410c' },
  pillar: { label: 'Pillar', color: '#60a5fa', edge: '#1d4ed8' },
};

// Rodent trap stations, numbered as on the drawing.
//
// 21 of the 25 stations are placed. **9, 10, 11 and 13 are on the drawing but
// their positions could not be read off it**, and the map says so rather than
// putting them somewhere plausible — a pest-control map with an invented
// station on it is worse than one that admits a gap, because the gap is what
// gets checked against the paper.
export const TRAPS = [
  { n: 1, x: 617, y: 402 }, { n: 2, x: 849, y: 402 },
  { n: 3, x: 984, y: 301 }, { n: 4, x: 984, y: 187 }, { n: 5, x: 984, y: 114 },
  { n: 6, x: 914, y: 8 }, { n: 7, x: 869, y: 3 }, { n: 8, x: 616, y: 2 },
  { n: 12, x: 254, y: 5 },
  { n: 14, x: 9, y: 28 }, { n: 15, x: 5, y: 114 }, { n: 16, x: 9, y: 193 },
  { n: 17, x: 10, y: 300 }, { n: 18, x: 10, y: 400 },
  { n: 19, x: 139, y: 401 }, { n: 20, x: 139, y: 383 },
  { n: 21, x: 250, y: 405 }, { n: 22, x: 317, y: 405 },
  { n: 23, x: 495, y: 403 }, { n: 24, x: 495, y: 376 }, { n: 25, x: 569, y: 403 },
];
export const TRAPS_UNPLACED = [9, 10, 11, 13];

// Which Brittle Plastic & Glass zone (FORM 431-01) covers which part of the
// map. The zone NAMES must match the `bpg_zones` managed list, because that is
// what the inspection schedules are keyed on — the map reads the live item
// lists and inspection dates through these names.
export const BPG_ZONE_AREAS = {
  'Office 1': ['office-1'],
  'Office 2': ['office-2'],
  'Office 3': ['office-3'],
  'Main Lobby': ['entrance'],
  'Break Room': ['break-room'],
  'Bathrooms (1)': ['bathroom-1'],
  'Bathrooms (2)': ['bathroom-2'],
  'Sanitation Area': ['sink-bay'],
  'Production Area': ['vffs', 'room-1', 'room-2', 'room-3', 'room-4', 'room-5', 'room-6', 'room-7', 'packaging'],
  'Kitting Area': ['blender-1', 'blender-2'],
  'Quality Area': ['qa-hold'],
  'Warehouse Area (1)': ['rack-a'],
  'Warehouse Area (2)': ['rack-b'],
  'Warehouse Area (3)': ['rack-c'],
  'Warehouse Area (Main)': ['west-top', 'receiving-hold', 'shipping-receiving'],
};

// room id → zone name, derived so a lookup is one map access.
export const ZONE_OF_ROOM = Object.entries(BPG_ZONE_AREAS)
  .reduce((acc, [zone, ids]) => { for (const id of ids) acc[id] = zone; return acc; }, {});

export const roomById = (id) => ROOMS.find(r => r.id === id) || null;
