import { v4 as uuid } from 'uuid';

function weekdaysBetween(startStr, endStr) {
  const dates = [];
  const d = new Date(startStr + 'T08:00:00');
  const end = new Date(endStr + 'T23:59:59');
  while (d <= end) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) {
      dates.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTime(baseHour, spread) {
  const h = baseHour + Math.floor(Math.random() * spread);
  const m = Math.floor(Math.random() * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function seedCleaningRecords(db) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM sanitation_records').get().c;
  if (existing > 0) return;

  const verifiers = ['MS', 'MJ', 'MC', 'MN'];
  const performer = 'ZN';

  const dateRanges = [
    ['2026-01-05', '2026-01-30'],
    ['2026-02-02', '2026-02-27'],
    ['2026-03-02', '2026-03-31'],
    ['2026-04-01', '2026-05-01'],
    ['2026-05-01', '2026-06-01'],
  ];

  const allDates = [];
  for (const [s, e] of dateRanges) {
    allDates.push(...weekdaysBetween(s, e));
  }
  const uniqueDates = [...new Set(allDates)].sort();

  const insert = db.prepare(`
    INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, chemicals_used, concentration, contact_time_minutes, rinse_verified, result, verified_by, verified_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const date of uniqueDates) {
      const verifier = pickOne(verifiers);
      const vDate = date;

      // 1. Warehouse/Grounds Cleaning
      insert.run(
        uuid(), 'Warehouse & Grounds', 'pre_op', performer,
        `${date}T${randomTime(6, 3)}:00`,
        null, null, null, null, 'pass',
        verifier, `${vDate}T${randomTime(14, 3)}:00`, null
      );
      count++;

      // 2. Restroom Cleaning
      insert.run(
        uuid(), 'Restroom', 'pre_op', performer,
        `${date}T${randomTime(8, 3)}:00`,
        null, null, null, null, 'pass',
        verifier, `${vDate}T${randomTime(14, 3)}:00`, null
      );
      count++;

      // 3. Breakroom, Lobby & Office
      insert.run(
        uuid(), 'Breakroom, Lobby & Office', 'pre_op', performer,
        `${date}T${randomTime(8, 3)}:00`,
        null, null, null, null, 'pass',
        verifier, `${vDate}T${randomTime(14, 3)}:00`, null
      );
      count++;

      // 4. Chemical Dilution — Sanitizer (Sani-512)
      insert.run(
        uuid(), 'Chemical Verification', 'pre_op', performer,
        `${date}T${randomTime(6, 2)}:00`,
        'Sani-512 Sanitizer', '200-250 ppm', null, null, 'pass',
        verifier, `${vDate}T${randomTime(14, 3)}:00`, null
      );
      count++;

      // 5. Chemical Dilution — Chlorine (Cloro)
      insert.run(
        uuid(), 'Chemical Verification', 'pre_op', performer,
        `${date}T${randomTime(6, 2)}:00`,
        'Chlorine (Cloro)', '100-200 ppm', null, null, 'pass',
        verifier, `${vDate}T${randomTime(14, 3)}:00`, null
      );
      count++;
    }
  });
  tx();
  if (count > 0) console.log(`[seed] Imported ${count} historical cleaning/sanitation records (${uniqueDates.length} days)`);
}

export function seedCleaningChecklists(db) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM checklist_templates').get().c;
  if (existing > 0) return;

  const insert = db.prepare(`
    INSERT INTO checklist_templates (id, name, type, frequency, description, items, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const checklists = [
    {
      name: 'Warehouse/Grounds Cleaning Log',
      type: 'sanitation',
      frequency: 'daily',
      description: 'Daily warehouse cleaning and grounds maintenance inspection (Form 202-1, Rev V3)',
      items: [
        { section: 'Daily Warehouse Cleaning', items: [
          { label: 'Sweep up all loose debris (dirt, product, wood chips etc.) in the warehouse including docking station', type: 'yes_no_na' },
          { label: 'Mop floor', type: 'yes_no_na' },
          { label: 'Empty all trash containers', type: 'yes_no_na' },
          { label: 'Place new garbage bag in trash container', type: 'yes_no_na' },
          { label: 'Check floors and wall corners, window edges, electrical conduit on walls, to ensure there are no cobwebs, spiders or bugs present', type: 'yes_no_na' },
        ]},
        { section: 'Daily Grounds Maintenance Inspection', items: [
          { label: 'Are the grounds free of litter and waste?', type: 'yes_no_na' },
          { label: 'Are the adjacent areas of the building free of weeds?', type: 'yes_no_na' },
          { label: 'Are pest baits set correctly at every entrance without interference of foreign objects which may block the pest control station?', type: 'yes_no_na' },
          { label: 'Is the dumpster surrounding free of litter and debris?', type: 'yes_no_na' },
          { label: 'Are the dumpster\'s doors closed?', type: 'yes_no_na' },
        ]},
        { section: 'Docking / Entry Gaps', items: [
          { label: 'Check docking plate for visible gaps. Are gaps observed?', type: 'yes_no' },
          { label: 'Check main doors for visible gaps. Are gaps observed?', type: 'yes_no' },
          { label: 'If gaps observed, write location and inform facility manager', type: 'text' },
        ]},
      ],
    },
    {
      name: 'Restroom Cleaning Log',
      type: 'sanitation',
      frequency: 'daily',
      description: 'Daily restroom cleaning verification (Form 108, Rev V3)',
      items: [
        { section: 'Restroom Cleaning Tasks', items: [
          { label: 'Toilet Bowls (Inodoros) — clean and sanitize', type: 'checkbox' },
          { label: 'Sinks (Lavamanos) — clean and sanitize', type: 'checkbox' },
          { label: 'Refill Toiletries / Toilet paper (Rel lenar paper)', type: 'checkbox' },
          { label: 'Mirrors (Espejos) — clean', type: 'checkbox' },
          { label: 'Floors (Pisos) — mop and sanitize', type: 'checkbox' },
          { label: 'Empty Trash (Vaciar la Basura)', type: 'checkbox' },
        ]},
      ],
    },
    {
      name: 'Breakroom, Lobby & Office Cleaning Log',
      type: 'sanitation',
      frequency: 'daily',
      description: 'Daily breakroom, lobby and office area cleaning (Form 108, Rev V3)',
      items: [
        { section: 'Cleaning Tasks', items: [
          { label: 'Refrigerator and Tables — clean (Limpiar refrigerator y mesas)', type: 'checkbox' },
          { label: 'Sink and Lockers (Lavaplatos y casilleros)', type: 'checkbox' },
          { label: 'Dusting (Sacudir)', type: 'checkbox' },
          { label: 'Windows (Ventanas)', type: 'checkbox' },
          { label: 'Floors (Pisos)', type: 'checkbox' },
          { label: 'Empty Trash (Vaciar la Basura)', type: 'checkbox' },
        ]},
      ],
    },
    {
      name: 'Chemical Dilution Verification',
      type: 'sanitation',
      frequency: 'daily',
      description: 'Daily chemical dilution test strip verification (Form 106.01, Rev V3). Sani-512: 200-250 ppm, Chlorine: 100-200 ppm, Dawn Heavy Duty: 1 tsp to 2.5 gal, Simple Green: 1:10-1:30 ratio',
      items: [
        { section: 'Chemical Verification', items: [
          { label: 'Sanitizer (Sani-512) — test strip result (200-250 ppm)', type: 'pass_fail', spec: '200-250 ppm' },
          { label: 'Chlorine (Cloro) — test strip result (100-200 ppm)', type: 'pass_fail', spec: '100-200 ppm' },
          { label: 'Record dilution or test strip lot number and expiration', type: 'text' },
        ]},
      ],
    },
    {
      name: 'Production Line Cleaning Log',
      type: 'sanitation',
      frequency: 'daily',
      description: 'Pre-production / changeover cleaning verification with ATP and allergen testing (Form 117.21, Rev V5)',
      items: [
        { section: 'Setup', items: [
          { label: 'Room number', type: 'text' },
          { label: 'Product name', type: 'text' },
          { label: 'Work Order / Lot number', type: 'text' },
          { label: 'Allergens present (Milk, Nuts, Wheat, Gluten Free, Other)', type: 'text' },
          { label: 'Partial clean #1 or Full clean #2?', type: 'select', options: ['Partial clean #1', 'Full clean #2'] },
        ]},
        { section: 'Cleaning Verification', items: [
          { label: 'Are all materials and packaging components removed from previous run?', type: 'yes_no_na' },
          { label: 'Visual inspection of all knives (no snap off blades allowed)', type: 'yes_no_na' },
          { label: 'Visual inspection of all glass (N/A), plastic, light covers, totes, machine doors, elbow joints on limbs, pallets, etc.', type: 'yes_no_na' },
          { label: 'Machine Asset tag # and Condition (Good/Poor)', type: 'text' },
          { label: 'Wipe down equipment/product-contact surfaces with clean towels to remove any powder or residue', type: 'yes_no_na' },
          { label: 'Clean all surfaces with sanitizer, letting it sit for more than 60 seconds to remove all contamination', type: 'yes_no_na' },
          { label: 'Did the cleaning Pass?', type: 'pass_fail' },
        ]},
        { section: 'ATP Test', items: [
          { label: 'ATP Test — Location 1', type: 'text' },
          { label: 'ATP Test — Swab Number 1', type: 'text' },
          { label: 'ATP Test — Result 1 (pass or no pass)', type: 'pass_fail' },
          { label: 'ATP Test — Location 2', type: 'text' },
          { label: 'ATP Test — Swab Number 2', type: 'text' },
          { label: 'ATP Test — Result 2 (pass or no pass)', type: 'pass_fail' },
        ]},
        { section: 'Allergen Test', items: [
          { label: 'Allergen Test — Location 1', type: 'text' },
          { label: 'Allergen Test — Swab Number 1', type: 'text' },
          { label: 'Allergen Test — Result 1 (pass or no pass)', type: 'pass_fail' },
          { label: 'Allergen Test — Location 2', type: 'text' },
          { label: 'Allergen Test — Swab Number 2', type: 'text' },
          { label: 'Allergen Test — Result 2 (pass or no pass)', type: 'pass_fail' },
        ]},
      ],
    },
  ];

  let count = 0;
  const tx = db.transaction(() => {
    for (const cl of checklists) {
      insert.run(uuid(), cl.name, cl.type, cl.frequency, cl.description, JSON.stringify(cl.items));
      count++;
    }
  });
  tx();
  if (count > 0) console.log(`[seed] Created ${count} cleaning checklist templates`);
}
