import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const data = JSON.parse(readFileSync(path.join(__dirname, 'seed-data.json'), 'utf-8'));

const db = getDb();
const existing = db.prepare('SELECT COUNT(*) as c FROM equipment').get().c;

if (existing > 0) {
  console.log(`[seed] Equipment table already has ${existing} rows — skipping seed.`);
  process.exit(0);
}

console.log(`[seed] Inserting ${data.length} equipment items...`);

const insert = db.prepare(`
  INSERT INTO equipment (id, name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, status, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const tx = db.transaction(() => {
  for (const eq of data) {
    const id = uuid();
    insert.run(
      id, eq.name, eq.type, eq.location, eq.room || null,
      eq.asset_id, eq.manufacturer, eq.model_number, eq.serial_number,
      eq.vendor, eq.pm_frequency, eq.is_food_contact ? 1 : 0,
      null, eq.status, eq.notes
    );
    logAudit('seed', 'create', 'equipment', id, { name: eq.name, type: eq.type }, null, null);
  }
});

tx();
console.log(`[seed] Done — ${data.length} equipment items inserted.`);
