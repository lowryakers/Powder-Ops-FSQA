// Equipment readiness: the two steps that can be out of date, and the eight
// that cannot. Runs the real check against a real (temporary) database.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(process.env.SCRATCH || tmpdir(), 'eqr-'));
process.env.DB_PATH = join(dir, 'eqr.db');

const { getDb } = await import('../server/db.js');
const { equipmentReadiness, stampEquipmentReadiness } = await import('../server/equipment-readiness.js');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const db = getDb();
const eqRow = () => db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq-t');
const step = (id) => equipmentReadiness(db, eqRow()).steps.find((s) => s.id === id);

db.prepare(`INSERT OR REPLACE INTO equipment (id, name, type, model_number, serial_number, is_food_contact, loto_required, asset_kind, status)
  VALUES ('eq-t','Test Blender','Blender','MDL-1','SN-1',1,1,'machine','active')`).run();

console.log('\n── nothing done yet ──');
t('the LOTO step is outstanding', step('loto').state !== 'done' && !step('loto').done);
t('the hygienic step is outstanding', !step('hygienic_design').done);
t('neither is stale — there is nothing to be stale about',
  !step('loto').stale && !step('hygienic_design').stale);

console.log('\n── doing the work records what it was true against ──');
db.prepare(`INSERT INTO loto_procedures (id, equipment_id, title, energy_sources, steps, is_active)
  VALUES ('lp-1','eq-t','Lockout','["electrical"]','["isolate"]',1)`).run();
stampEquipmentReadiness(db, 'eq-t', ['loto'], 'Lowry');
t('the LOTO step is done', step('loto').done);
t('and not stale', !step('loto').stale);

db.prepare(`INSERT INTO design_verifications (id, equipment_id, trigger_reason, checklist_responses, overall_result, performed_by)
  VALUES ('dv-1','eq-t','new_install','{}','approved','fixture')`).run();
stampEquipmentReadiness(db, 'eq-t', ['hygienic_design'], 'Lowry');
t('the hygienic verification is done', step('hygienic_design').done);

console.log('\n── the machine changes underneath them ──');
db.prepare("UPDATE equipment SET model_number = 'MDL-2' WHERE id = 'eq-t'").run();
const loto = step('loto'), hyg = step('hygienic_design');
t('a new model makes the LOTO procedure stale', loto.stale === true, JSON.stringify(loto.detail));
t('A STALE STEP IS NOT DONE', loto.done === false);
t('it names what changed', (loto.changed_labels || []).join() === 'the model or serial number', (loto.changed_labels || []).join());
t('the detail says so in words', /Needs re-checking/.test(loto.detail), loto.detail);
t('the verification went stale on the same change', hyg.stale === true);
const roll = equipmentReadiness(db, eqRow());
t('both are counted as outstanding', roll.outstanding >= 2 && roll.stale.length === 2, JSON.stringify(roll.stale));

console.log('\n── an unrelated edit does not clear it ──');
db.prepare("UPDATE equipment SET notes = 'moved to room 4' WHERE id = 'eq-t'").run();
stampEquipmentReadiness(db, 'eq-t', [], 'Lowry');
t('editing the notes leaves it stale', step('loto').stale === true);

console.log('\n── re-doing the work clears it ──');
stampEquipmentReadiness(db, 'eq-t', ['loto'], 'Lowry');
t('re-writing the LOTO procedure clears that step', step('loto').stale === false);
t('and only that step — the verification still needs a look', step('hygienic_design').stale === true);

console.log('\n── food-contact is its own dependency ──');
stampEquipmentReadiness(db, 'eq-t', ['hygienic_design'], 'Lowry');
t('baseline is clean', !step('hygienic_design').stale);
db.prepare("UPDATE equipment SET is_food_contact = 0 WHERE id = 'eq-t'").run();
t('turning food-contact OFF removes the step entirely',
  !equipmentReadiness(db, eqRow()).steps.some((s) => s.id === 'hygienic_design'));
db.prepare("UPDATE equipment SET is_food_contact = 1 WHERE id = 'eq-t'").run();
t('turning it back on does NOT invent a change (the value is the same again)',
  step('hygienic_design').stale === false);

console.log('\n── the first-sight rule ──');
// A machine whose work was done long before any of this existed has no
// recorded basis and must read as done, or the deploy lights up the whole plant.
db.prepare(`INSERT OR REPLACE INTO equipment (id, name, type, model_number, is_food_contact, loto_required, asset_kind, status, readiness_basis)
  VALUES ('eq-old','Old Mixer','Mixer','MDL-9',1,1,'machine','active', NULL)`).run();
db.prepare(`INSERT INTO loto_procedures (id, equipment_id, title, energy_sources, steps, is_active)
  VALUES ('lp-9','eq-old','Lockout','["electrical"]','["isolate"]',1)`).run();
const old = equipmentReadiness(db, db.prepare("SELECT * FROM equipment WHERE id = 'eq-old'").get());
t('NO BASIS MEANS DONE, NEVER STALE', old.steps.find((s) => s.id === 'loto').done === true);
t('and nothing on the machine reads stale', old.stale.length === 0, JSON.stringify(old.stale));

console.log('\n── the steps that cannot go stale ──');
// Every other step is a live count, so it corrects itself. Retiring the record
// flips it back with no basis involved at all.
db.prepare("UPDATE loto_procedures SET is_active = 0 WHERE id = 'lp-1'").run();
t('retiring the procedure puts the step back to outstanding by itself',
  step('loto').done === false && step('loto').stale === false, JSON.stringify(step('loto')));

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
