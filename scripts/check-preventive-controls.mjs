// The four preventive controls on a temporary database: the seeder is
// insert-only and re-links nothing, a hand edit is reported as drift naming
// both values, and the edit guard closes exactly the document's fields on
// exactly the document's rows. No server.
import Database from 'better-sqlite3';
import { randomUUID as uuid } from 'crypto';
import {
  PREVENTIVE_CONTROLS, seedPreventiveControls, ccpDrift, guardCcpEdit, documentOwned, ccpName,
} from '../server/preventive-controls.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE haccp_ccps (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, hazard_type TEXT,
    critical_limits TEXT NOT NULL, monitoring_procedure TEXT NOT NULL, monitoring_frequency TEXT,
    corrective_action TEXT NOT NULL, verification_procedure TEXT, record_keeping_requirements TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE equipment (id TEXT PRIMARY KEY, name TEXT, haccp_ccp_id TEXT, updated_at TEXT);
  INSERT INTO equipment (id, name) VALUES ('xr1', 'X-Ray Inspection Machine Mech 1'), ('xr2', 'X-Ray Rejection Box Mech 1'),
    ('conv', 'Conveyor');
`);

console.log('── seeding ──');
let r = seedPreventiveControls(db, { uuid });
t('four controls are created on a fresh database', r.created.length === 4 && PREVENTIVE_CONTROLS.length === 4);
t('both X-ray machines are linked to PC #4', r.linked === 2);
t('the conveyor is left alone', db.prepare("SELECT haccp_ccp_id FROM equipment WHERE id = 'conv'").get().haccp_ccp_id === null);
t('nothing drifts straight after seeding', ccpDrift(db).length === 0);
r = seedPreventiveControls(db, { uuid });
t('a second boot creates nothing and relinks nothing', r.created.length === 0 && r.linked === 0 && r.alreadyLinked === 2);
t('still four rows', db.prepare('SELECT COUNT(*) c FROM haccp_ccps').get().c === 4);

console.log('── drift ──');
const pc1 = db.prepare('SELECT * FROM haccp_ccps WHERE name = ?').get(ccpName(PREVENTIVE_CONTROLS[0]));
db.prepare("UPDATE haccp_ccps SET critical_limits = '40 RLU' WHERE id = ?").run(pc1.id);
let d = ccpDrift(db);
t('a hand-edited limit is reported, naming both values', d.length === 1 && d[0].field === 'critical_limits' && d[0].stored === '40 RLU' && d[0].document === pc1.critical_limits);
r = seedPreventiveControls(db, { uuid });
t('re-seeding does NOT overwrite the hand edit (a row is a decision)', r.created.length === 0 && db.prepare('SELECT critical_limits FROM haccp_ccps WHERE id = ?').get(pc1.id).critical_limits === '40 RLU');
db.prepare('UPDATE haccp_ccps SET critical_limits = ? WHERE id = ?').run(pc1.critical_limits, pc1.id);
db.prepare('DELETE FROM haccp_ccps WHERE id = ?').run(pc1.id);
d = ccpDrift(db);
t('a deleted control is reported as missing', d.length === 1 && d[0].missing === true && d[0].name === pc1.name);
seedPreventiveControls(db, { uuid });
t('and the next boot puts it back', ccpDrift(db).length === 0);

console.log('── the edit guard ──');
const owned = db.prepare('SELECT * FROM haccp_ccps WHERE name = ?').get(ccpName(PREVENTIVE_CONTROLS[3]));
t('a seeded row is document-owned', documentOwned(owned) === true);
t('changing its critical limit is refused, field named', JSON.stringify(guardCcpEdit(owned, { critical_limits: 'Fe 5mm' })) === '["critical_limits"]');
t('changing its name is refused — the name is the seeder key', JSON.stringify(guardCcpEdit(owned, { name: 'CCP 4' })) === '["name"]');
t('two guarded fields → both named', guardCcpEdit(owned, { monitoring_frequency: 'hourly', corrective_action: 'stop' }).length === 2);
t('sending the same value back is not a change', guardCcpEdit(owned, { critical_limits: owned.critical_limits, name: owned.name }).length === 0);
t('the description is open', guardCcpEdit(owned, { description: 'Where the record is today: Keychain' }).length === 0);
t('a field the body does not mention is not a change', guardCcpEdit(owned, {}).length === 0);
db.prepare(`INSERT INTO haccp_ccps (id, name, critical_limits, monitoring_procedure, corrective_action)
  VALUES ('mine', 'CCP 9 — Metal detection', 'Fe 1.5mm', 'test pieces', 'hold back')`).run();
const mine = db.prepare("SELECT * FROM haccp_ccps WHERE id = 'mine'").get();
t('an app-created CCP is not document-owned', documentOwned(mine) === false);
t('and is exactly as editable as before', guardCcpEdit(mine, { critical_limits: 'Fe 2.0mm', name: 'CCP 9' }).length === 0);
t('an app-created CCP never reads as drift', ccpDrift(db).length === 0);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
