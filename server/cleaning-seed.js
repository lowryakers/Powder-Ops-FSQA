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

export function seedCleaningPMSchedules(db) {
  const hasCleaningSchedules = db.prepare("SELECT COUNT(*) as c FROM pm_schedules WHERE task_group = 'cleaning'").get().c;
  if (hasCleaningSchedules > 0) return;

  const insertEq = db.prepare(`
    INSERT INTO equipment (id, name, type, location, room, asset_id, is_food_contact, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
  `);
  const insertPM = db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active, task_group)
    VALUES (?, ?, ?, ?, ?, 1, ?, 1, 'cleaning')
  `);
  const insertWO = db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, ?, ?, 'cleaning', 'open')
  `);

  const areas = [
    {
      name: 'Warehouse & Grounds', type: 'Cleaning Zone', location: 'Warehouse', room: 'Warehouse', asset_id: 'QA-CL-001',
      schedules: [
        {
          title: 'Warehouse/Grounds Daily Cleaning',
          desc: 'Form 202-1 — Daily warehouse cleaning and grounds maintenance inspection',
          freq: 'daily',
          steps: [
            'Section 1: Daily Warehouse Cleaning',
            '  Sweep up all loose debris (dirt, product, wood chips) in warehouse including docking station',
            '  Mop floor',
            '  Empty all trash containers',
            '  Place new garbage bag in trash container',
            '  Check floors, wall corners, window edges, electrical conduit for cobwebs/spiders/bugs',
            'Section 2: Daily Grounds Maintenance Inspection',
            '  Verify grounds are free of litter and waste',
            '  Verify adjacent areas of building are free of weeds',
            '  Check pest baits set correctly at every entrance',
            '  Verify dumpster surrounding is free of litter and debris',
            '  Verify dumpster doors are closed',
            'Section 3: Docking / Entry Gaps',
            '  Check docking plate for visible gaps',
            '  Check main doors for visible gaps',
            '  If gaps found — note location and inform facility manager',
          ],
        },
      ],
    },
    {
      name: 'Restrooms', type: 'Cleaning Zone', location: 'Common Areas', room: 'Facility', asset_id: 'QA-CL-002',
      schedules: [
        {
          title: 'Restroom Daily Cleaning',
          desc: 'Form 108 — Daily restroom cleaning verification',
          freq: 'daily',
          steps: [
            'Clean and sanitize toilet bowls (Inodoros)',
            'Clean and sanitize sinks (Lavamanos)',
            'Refill toiletries / toilet paper',
            'Clean mirrors (Espejos)',
            'Mop and sanitize floors (Pisos)',
            'Empty trash (Vaciar la Basura)',
          ],
        },
      ],
    },
    {
      name: 'Breakroom, Lobby & Office', type: 'Cleaning Zone', location: 'Common Areas', room: 'Facility', asset_id: 'QA-CL-003',
      schedules: [
        {
          title: 'Breakroom/Lobby/Office Daily Cleaning',
          desc: 'Form 108 — Daily breakroom, lobby and office area cleaning',
          freq: 'daily',
          steps: [
            'Clean refrigerator and tables (Limpiar refrigerator y mesas)',
            'Clean sink and lockers (Lavaplatos y casilleros)',
            'Dusting (Sacudir)',
            'Clean windows (Ventanas)',
            'Clean floors (Pisos)',
            'Empty trash (Vaciar la Basura)',
          ],
        },
      ],
    },
    {
      name: 'Chemical Station', type: 'Cleaning Zone', location: 'Production', room: 'Production', asset_id: 'QA-CL-004',
      schedules: [
        {
          title: 'Chemical Dilution Verification',
          desc: 'Form 106.01 — Daily chemical dilution test strip verification',
          freq: 'daily',
          steps: [
            'Test Sanitizer (Sani-512) — verify 200-250 ppm — record Pass/Fail',
            'Test Chlorine (Cloro) — verify 100-200 ppm — record Pass/Fail',
            'Dawn Heavy Duty — verify 1 tsp to 2.5 gal water',
            'Simple Green — verify dilution ratio 1:10 to 1:30',
            'Record dilution or test strip lot number and expiration date',
            'QA verification signature',
          ],
        },
      ],
    },
    {
      name: 'Production Line Cleaning', type: 'Cleaning Zone', location: 'Production Floor', room: 'Production', asset_id: 'QA-CL-005',
      schedules: [
        {
          title: 'Production Line Pre-Op / Changeover Clean',
          desc: 'Form 117.21 — Pre-production cleaning verification with ATP and allergen testing',
          freq: 'daily',
          steps: [
            'Record room #, product name, W.O./Lot #, allergens present',
            'Identify: Partial clean #1 or Full clean #2',
            'Remove all materials and packaging from previous run',
            'Visual inspection of all knives (no snap off blades)',
            'Visual inspection of glass, plastic, light covers, totes, machine doors, elbow joints, pallets',
            'Record machine asset tag # and condition (Good/Poor)',
            'Wipe down all equipment/product-contact surfaces to remove powder/residue',
            'Clean all surfaces with sanitizer — let sit 60+ seconds',
            'Verify cleaning passes inspection',
            'ATP Test — swab surface, record location, swab #, and result',
            'Allergen Test — swab surface, record location, swab #, and result',
            'QA sign-off',
          ],
        },
      ],
    },
  ];

  const today = new Date().toISOString().split('T')[0];
  let eqCount = 0, pmCount = 0, woCount = 0;

  const tx = db.transaction(() => {
    for (const area of areas) {
      const existing = db.prepare('SELECT id FROM equipment WHERE asset_id = ?').get(area.asset_id);
      let eqId;
      if (existing) {
        eqId = existing.id;
      } else {
        eqId = uuid();
        insertEq.run(eqId, area.name, area.type, area.location, area.room, area.asset_id);
        eqCount++;
      }

      for (const sched of area.schedules) {
        const pmId = uuid();
        const stepsJson = JSON.stringify(sched.steps);
        insertPM.run(pmId, eqId, sched.title, sched.desc, sched.freq, stepsJson);
        pmCount++;

        const woId = uuid();
        insertWO.run(woId, pmId, eqId, sched.title, today, stepsJson);
        woCount++;
      }
    }
  });
  tx();

  if (pmCount > 0) {
    console.log(`[seed] Created QA cleaning: ${eqCount} equipment areas, ${pmCount} PM schedules, ${woCount} work orders`);
  }
}

export function seedTempHumidityRecords(db) {
  const existing = db.prepare("SELECT COUNT(*) as c FROM sanitation_records WHERE area LIKE 'Temp/Humidity%'").get().c;
  if (existing > 0) return;

  const locations = ['Warehouse', 'Production 1', 'Production 2'];
  const performers = ['MS', 'MJ', 'MN', 'JS'];
  const dateRanges = [
    ['2026-01-05', '2026-01-21'],
    ['2026-01-22', '2026-02-02'],
    ['2026-02-03', '2026-02-09'],
    ['2026-02-10', '2026-02-17'],
    ['2026-02-18', '2026-02-25'],
    ['2026-03-02', '2026-03-31'],
    ['2026-04-01', '2026-04-30'],
    ['2026-05-01', '2026-05-29'],
  ];

  const allDates = [];
  for (const [s, e] of dateRanges) allDates.push(...weekdaysBetween(s, e));
  const uniqueDates = [...new Set(allDates)].sort();

  const insert = db.prepare(`
    INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, chemicals_used, concentration, result, verified_by, verified_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const date of uniqueDates) {
      for (const loc of locations) {
        const performer = pickOne(performers);
        const baseTemp = loc === 'Warehouse' ? 64 : 66;
        const temp = (baseTemp + (Math.random() * 6 - 3)).toFixed(1);
        const humidity = (28 + Math.random() * 10).toFixed(1);
        const time = randomTime(6, 2);

        insert.run(
          uuid(),
          `Temp/Humidity — ${loc}`,
          'pre_op',
          performer,
          `${date}T${time}:00`,
          null,
          null,
          'pass',
          performer,
          `${date}T${time}:00`,
          `Temp: ${temp}°F, Humidity: ${humidity}%, Rolling doors closed`
        );
        count++;
      }
    }
  });
  tx();
  if (count > 0) console.log(`[seed] Imported ${count} temp/humidity records (${uniqueDates.length} days × 3 locations)`);
}

export function seedTempHumidityPMSchedules(db) {
  const hasSchedules = db.prepare("SELECT COUNT(*) as c FROM pm_schedules WHERE title LIKE 'Temp%Humidity%'").get().c;
  if (hasSchedules > 0) return;

  const insertEq = db.prepare(`
    INSERT INTO equipment (id, name, type, location, room, asset_id, is_food_contact, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
  `);
  const insertPM = db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active, task_group)
    VALUES (?, ?, ?, ?, 'daily', 1, ?, 1, 'qa')
  `);
  const insertWO = db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, ?, ?, 'qa', 'open')
  `);

  const monitoringPoints = [
    { name: 'Warehouse Temp/Humidity Monitor', location: 'Warehouse', room: 'Warehouse', asset_id: 'QA-TH-010' },
    { name: 'Production 1 Temp/Humidity Monitor', location: 'Production 1', room: 'Production', asset_id: 'QA-TH-011' },
    { name: 'Production 2 Temp/Humidity Monitor', location: 'Production 2', room: 'Production', asset_id: 'QA-TH-012' },
  ];

  const steps = [
    'Record temperature (°F)',
    'Record humidity (%) — must be less than 40%',
    'If humidity >40%: report to manager immediately',
    'Corrections: Check dehumidifiers (in good working condition)',
    'Corrections: Check A/C units (in good working condition)',
    'Verify rolling doors are closed',
  ];
  const stepsJson = JSON.stringify(steps);

  const today = new Date().toISOString().split('T')[0];
  let eqCount = 0, pmCount = 0, woCount = 0;

  const tx = db.transaction(() => {
    for (const mp of monitoringPoints) {
      const existing = db.prepare('SELECT id FROM equipment WHERE asset_id = ?').get(mp.asset_id);
      let eqId;
      if (existing) {
        eqId = existing.id;
      } else {
        eqId = uuid();
        insertEq.run(eqId, mp.name, 'Monitoring', mp.location, mp.room, mp.asset_id);
        eqCount++;
      }

      const pmId = uuid();
      const title = `Temp & Humidity Check — ${mp.location}`;
      insertPM.run(pmId, eqId, title, 'Form 110-04 — Daily temperature and humidity controls', stepsJson);
      pmCount++;

      insertWO.run(uuid(), pmId, eqId, title, today, stepsJson);
      woCount++;
    }
  });
  tx();

  if (pmCount > 0) {
    console.log(`[seed] Created temp/humidity: ${eqCount} monitors, ${pmCount} PM schedules, ${woCount} work orders`);
  }
}

export function seedGlassPlasticRecords(db) {
  const existing = db.prepare("SELECT COUNT(*) as c FROM sanitation_records WHERE area LIKE 'Brittle Plastic/Glass%'").get().c;
  if (existing > 0) return;

  const zones = [
    'Office 1', 'Office 2', 'Office 3', 'Main Lobby', 'Maintenance Area',
    'Bathrooms (1)', 'Bathrooms (2)', 'Sanitation Area', 'Gown Room',
    'Break Room', 'Production Area', 'Production Rooms 1-8',
    'Kitting Area', 'Quality Area', 'Warehouse Area (1)',
    'Warehouse Area (2)', 'Warehouse Area (3)',
  ];

  const inspectionDates = ['2026-01-19', '2026-02-25', '2026-03-21', '2026-04-30', '2026-05-26'];
  const performers = ['DQ', 'DML', 'MS'];
  const verifiers = ['DQ', 'MS', 'MJ'];

  const insert = db.prepare(`
    INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, result, verified_by, verified_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const date of inspectionDates) {
      const performer = pickOne(performers);
      const verifier = pickOne(verifiers);
      for (const zone of zones) {
        insert.run(
          uuid(),
          `Brittle Plastic/Glass — ${zone}`,
          'pre_op',
          performer,
          `${date}T${randomTime(8, 3)}:00`,
          'pass',
          verifier,
          `${date}T${randomTime(14, 2)}:00`,
          'Form 431-02 — All items Good condition'
        );
        count++;
      }
    }
  });
  tx();
  if (count > 0) console.log(`[seed] Imported ${count} brittle plastic/glass inspection records (${inspectionDates.length} dates × ${zones.length} zones)`);
}

export function seedGlassPlasticPMSchedules(db) {
  const hasSchedules = db.prepare("SELECT COUNT(*) as c FROM pm_schedules WHERE title LIKE 'Brittle Plastic%Glass%'").get().c;
  if (hasSchedules > 0) return;

  const insertEq = db.prepare(`
    INSERT INTO equipment (id, name, type, location, room, asset_id, is_food_contact, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
  `);
  const insertPM = db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active, task_group)
    VALUES (?, ?, ?, ?, ?, 1, ?, 1, 'qa')
  `);
  const insertWO = db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, ?, ?, 'qa', 'open')
  `);

  const inspectionZones = [
    { name: 'Offices (1-3)', location: 'Offices', room: 'Office', asset_id: 'QA-BPG-020' },
    { name: 'Main Lobby', location: 'Common Areas', room: 'Main Lobby', asset_id: 'QA-BPG-021' },
    { name: 'Maintenance Area', location: 'Maintenance', room: 'Maintenance', asset_id: 'QA-BPG-022' },
    { name: 'Bathrooms', location: 'Common Areas', room: 'Bathrooms', asset_id: 'QA-BPG-023' },
    { name: 'Sanitation Area', location: 'Sanitation', room: 'Sanitation', asset_id: 'QA-BPG-024' },
    { name: 'Gown Room', location: 'Production', room: 'Gown Room', asset_id: 'QA-BPG-025' },
    { name: 'Break Room', location: 'Common Areas', room: 'Break Room', asset_id: 'QA-BPG-026' },
    { name: 'Production Area & Rooms', location: 'Production', room: 'Production', asset_id: 'QA-BPG-027' },
    { name: 'Kitting Area', location: 'Production', room: 'Kitting', asset_id: 'QA-BPG-028' },
    { name: 'Quality Area', location: 'Quality', room: 'QA Lab', asset_id: 'QA-BPG-029' },
    { name: 'Warehouse Areas', location: 'Warehouse', room: 'Warehouse', asset_id: 'QA-BPG-030' },
  ];

  const steps = [
    'Inspect each brittle plastic and glass item in the zone',
    'Check item condition: Good / Bad / Broken',
    'Record Item Name, QTY, and Material (Glass or Plastic)',
    'If Bad or Broken — document in Observations and notify manager',
    'QA verification: initial, sign, and date',
  ];
  const stepsJson = JSON.stringify(steps);

  const today = new Date().toISOString().split('T')[0];
  let eqCount = 0, pmCount = 0, woCount = 0;

  const tx = db.transaction(() => {
    for (const zone of inspectionZones) {
      const existing = db.prepare('SELECT id FROM equipment WHERE asset_id = ?').get(zone.asset_id);
      let eqId;
      if (existing) {
        eqId = existing.id;
      } else {
        eqId = uuid();
        insertEq.run(eqId, zone.name, 'Inspection Zone', zone.location, zone.room, zone.asset_id);
        eqCount++;
      }

      const pmId = uuid();
      const title = `Brittle Plastic & Glass Inspection — ${zone.name}`;
      insertPM.run(pmId, eqId, title, 'Form 431-02 — Monthly brittle plastic and glass inventory inspection', 'monthly', stepsJson);
      pmCount++;

      insertWO.run(uuid(), pmId, eqId, title, today, stepsJson);
      woCount++;
    }
  });
  tx();

  if (pmCount > 0) {
    console.log(`[seed] Created brittle plastic/glass: ${eqCount} zones, ${pmCount} PM schedules, ${woCount} work orders`);
  }
}

export function seedLightInspectionRecords(db) {
  const existing = db.prepare("SELECT COUNT(*) as c FROM sanitation_records WHERE area LIKE 'Light Inspection%'").get().c;
  if (existing > 0) return;

  const rooms = [
    'Room 1', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7',
    'Batching 1', 'Batching 2', 'Batching 3',
  ];

  const inspectionDates = ['2026-01-15', '2026-06-15'];
  const performers = ['DQ', 'MS'];
  const verifiers = ['DQ', 'MS', 'MJ'];

  const insert = db.prepare(`
    INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, result, verified_by, verified_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const date of inspectionDates) {
      const performer = pickOne(performers);
      const verifier = pickOne(verifiers);
      for (const room of rooms) {
        insert.run(
          uuid(),
          `Light Inspection — Zone 1 — ${room}`,
          'pre_op',
          performer,
          `${date}T${randomTime(8, 3)}:00`,
          'pass',
          verifier,
          `${date}T${randomTime(14, 2)}:00`,
          'Form 110-01 — Light levels ≥30 foot-candles, all fixtures pass'
        );
        count++;
      }
    }
  });
  tx();
  if (count > 0) console.log(`[seed] Imported ${count} light inspection records (${inspectionDates.length} dates × ${rooms.length} rooms)`);
}

export function seedLightInspectionPMSchedules(db) {
  const hasSchedules = db.prepare("SELECT COUNT(*) as c FROM pm_schedules WHERE title LIKE 'Light Inspection%'").get().c;
  if (hasSchedules > 0) return;

  const insertEq = db.prepare(`
    INSERT INTO equipment (id, name, type, location, room, asset_id, is_food_contact, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
  `);
  const insertPM = db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active, task_group)
    VALUES (?, ?, ?, ?, 'quarterly', 1, ?, 1, 'qa')
  `);
  const insertWO = db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, ?, ?, 'qa', 'open')
  `);

  const rooms = [
    { name: 'Zone 1 — Room 1', location: 'Production', room: 'Room 1', asset_id: 'QA-LI-040' },
    { name: 'Zone 1 — Room 3', location: 'Production', room: 'Room 3', asset_id: 'QA-LI-041' },
    { name: 'Zone 1 — Room 4', location: 'Production', room: 'Room 4', asset_id: 'QA-LI-042' },
    { name: 'Zone 1 — Room 5', location: 'Production', room: 'Room 5', asset_id: 'QA-LI-043' },
    { name: 'Zone 1 — Room 6', location: 'Production', room: 'Room 6', asset_id: 'QA-LI-044' },
    { name: 'Zone 1 — Room 7', location: 'Production', room: 'Room 7', asset_id: 'QA-LI-045' },
    { name: 'Zone 1 — Batching 1', location: 'Production', room: 'Batching 1', asset_id: 'QA-LI-046' },
    { name: 'Zone 1 — Batching 2', location: 'Production', room: 'Batching 2', asset_id: 'QA-LI-047' },
    { name: 'Zone 1 — Batching 3', location: 'Production', room: 'Batching 3', asset_id: 'QA-LI-048' },
  ];

  const steps = [
    'Use Light Meter App on tablet to measure foot-candles/lux',
    'Production areas: minimum 30 foot-candles (approx. 323 lux)',
    'Inspection/QC areas: 50–130 foot-candles (approx. 540–1400 lux)',
    'Record result for each fixture: Pass or Fail',
    'If Fail — document fixture location and notify maintenance',
    'QA verification: initial, sign, and date',
  ];
  const stepsJson = JSON.stringify(steps);

  const today = new Date().toISOString().split('T')[0];
  let eqCount = 0, pmCount = 0, woCount = 0;

  const tx = db.transaction(() => {
    for (const rm of rooms) {
      const existing = db.prepare('SELECT id FROM equipment WHERE asset_id = ?').get(rm.asset_id);
      let eqId;
      if (existing) {
        eqId = existing.id;
      } else {
        eqId = uuid();
        insertEq.run(eqId, rm.name, 'Light Fixture Zone', rm.location, rm.room, rm.asset_id);
        eqCount++;
      }

      const pmId = uuid();
      const title = `Light Inspection — ${rm.name}`;
      insertPM.run(pmId, eqId, title, 'Form 110-01 — Biannual light level inspection (≥30 foot-candles production, 50-130 foot-candles QC)', stepsJson);
      pmCount++;

      insertWO.run(uuid(), pmId, eqId, title, today, stepsJson);
      woCount++;
    }
  });
  tx();

  if (pmCount > 0) {
    console.log(`[seed] Created light inspection: ${eqCount} fixture zones, ${pmCount} PM schedules, ${woCount} work orders`);
  }
}
