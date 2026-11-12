#!/usr/bin/env node
// check:supplierstep2 — the supplier step-2 script (D-347) on a temporary
// database: the dry run writes nothing; --apply fills blanks only, needs the
// evidence for a correction, never deletes, leaves the gates alone, backs up,
// audits each change; a second --apply writes nothing. Never touches a real
// database.
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'scripts', 'supplier-step2.mjs');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const tmp = mkdtempSync(path.join(tmpdir(), 'sup-step2-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const dbPath = path.join(tmp, 'app.db');
const boot = spawnSync(process.execPath, ['-e', "import('./server/db.js').then(m => { m.getDb(); process.exit(0); })"],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
if (boot.status !== 0) { console.error(boot.stderr); process.exit(1); }

const d = new Database(dbPath);
d.prepare('DELETE FROM supplier_material_parts').run();
d.prepare('DELETE FROM supplier_files').run();
d.prepare('DELETE FROM supplier_materials').run();
const sup = d.prepare('INSERT INTO suppliers (id, name, vendor_type, actively_using) VALUES (?,?,?,1)');
sup.run('s-anc', 'Acme Natural Colors', null);     // typeless → ingredient
sup.run('s-nm', 'National Measures Test', null);   // typeless → packaging
sup.run('s-cary', 'Cary Test Co', 'supplies');     // already typed — stays supplies
sup.run('s-left', 'Left Typeless', null);          // not on the plan — stays typeless
d.prepare("INSERT INTO supplier_materials (id, supplier_id, item_description, is_active) VALUES ('m-1','s-anc','Beet Juice Powder',1)").run();
d.prepare("INSERT INTO supplier_materials (id, supplier_id, item_description, is_active) VALUES ('m-2','s-anc','Spirulina',1)").run();
d.prepare("INSERT INTO supplier_material_parts (id, material_id, system, part_number) VALUES ('p-2','m-2','mrpeasy','200500')").run();
const file = d.prepare('INSERT INTO supplier_files (id, supplier_id, kind, expires_on, lot_number, filename) VALUES (?,?,?,?,?,?)');
file.run('f-q', 's-anc', 'unknown', null, null, 'M4 signed VQ.pdf');          // → questionnaire
file.run('f-gmp', 's-anc', 'certificate', null, null, 'GMP cert.pdf');         // → gmp_certificate + date
file.run('f-gmp-nodate', 's-anc', 'certificate', null, null, 'SQF cert.pdf');  // → gmp without a date: refused
file.run('f-wrongfrom', 's-anc', 'sds', null, null, 'SDS.pdf');               // from_kind mismatch: refused
file.run('f-exp', 's-anc', 'letter_of_guarantee', '2026-01-01', null, 'LOG.pdf'); // expiry change with evidence
file.run('f-exp2', 's-anc', 'letter_of_guarantee', '2026-03-01', null, 'LOG2.pdf'); // change without evidence: refused
file.run('f-lot', 's-anc', 'coa', null, null, 'COA.pdf');
d.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('supplier_gmp_gate','warn'), ('supplier_banned_gate','warn')").run();
const auditBefore = d.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
const countsOf = (d) => ({
  suppliers: d.prepare('SELECT COUNT(*) n FROM suppliers').get().n,
  materials: d.prepare('SELECT COUNT(*) n FROM supplier_materials').get().n,
  parts: d.prepare('SELECT COUNT(*) n FROM supplier_material_parts').get().n,
  files: d.prepare('SELECT COUNT(*) n FROM supplier_files').get().n,
});
const before = countsOf(d);
d.close();

const csv = [
  'action,supplier,vendor_type,material,system,part_number,create,file_id,from_kind,kind,expires_on,from_expires_on,lot_number',
  'type,Acme Natural Colors,Ingredient,,,,,,,,,,',
  'type,s-nm,packaging,,,,,,,,,,',
  'type,Cary Test Co,ingredient,,,,,,,,,,',
  'type,Acme Natural Colors,flavour,,,,,,,,,,',
  'part,Acme Natural Colors,,Beet Juice Powder,mrpeasy,201069,,,,,,,',
  'part,Acme Natural Colors,,Spirulina,mrpeasy,999999,,,,,,,',
  'part,Acme Natural Colors,,Natural Flavor WONF,mrpeasy,201070,yes,,,,,,',
  'part,Acme Natural Colors,,Not There,mrpeasy,201071,,,,,,,',
  'relabel,,,,,,,f-q,unknown,questionnaire,,,',
  'relabel,,,,,,,f-gmp,certificate,gmp_certificate,2027-06-30,,',
  'relabel,,,,,,,f-gmp-nodate,certificate,gmp_certificate,,,',
  'relabel,,,,,,,f-wrongfrom,certificate,questionnaire,,,',
  'expiry,,,,,,,f-exp,,,2027-01-01,2026-01-01,',
  'expiry,,,,,,,f-exp2,,,2027-03-01,,',
  'lot,,,,,,,f-lot,,,,,L-12345',
  'delete,s-anc,,,,,,,,,,,',
].join('\n');
const planPath = path.join(tmp, 'plan.csv');
writeFileSync(planPath, csv);
const run = (...extra) => spawnSync(process.execPath, [SCRIPT, ...extra],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });

console.log('\nThe worklist is read-only');
let r = run('--list');
t('--list exits 0 and names the typeless suppliers', r.status === 0 && /Left Typeless/.test(r.stdout) && /Acme Natural Colors/.test(r.stdout), r.stderr);

console.log('\nThe dry run writes nothing');
r = run(planPath);
const db1 = new Database(dbPath, { readonly: true });
t('dry run exits 0 and says DRY RUN', r.status === 0 && /DRY RUN/.test(r.stdout), r.stderr || r.stdout.slice(-300));
t('it plans 2 types, 1 new material, 1 part number, 4 file corrections',
  /types: 2 · new materials: 1 · part numbers: 1 · file corrections: 4/.test(r.stdout), r.stdout.split('\n').filter(l => /Plan rows/.test(l)).join(''));
t('nothing changed', JSON.stringify(countsOf(db1)) === JSON.stringify(before));
t('no audit row written', db1.prepare('SELECT COUNT(*) n FROM audit_log').get().n === auditBefore);
t('Acme is still typeless after the dry run', db1.prepare("SELECT vendor_type FROM suppliers WHERE id = 's-anc'").get().vendor_type === null);
t('a typed supplier is reported, not retyped', /already "supplies", left alone/.test(r.stdout));
t('an unknown type is refused by name', /unknown vendor type "flavour"/.test(r.stdout));
t('a part number already set is reported, not replaced', /part number already "200500", left alone/.test(r.stdout));
t('a material not on file without create is skipped', /no such material on this supplier/.test(r.stdout));
t('a GMP certificate without a date is refused', /gmp certificate needs its date/.test(r.stdout));
t('a relabel whose from_kind no longer matches is refused', /the file is "sds" now, not "certificate"/.test(r.stdout));
t('an expiry change without its evidence is refused', /already carries 2026-03-01/.test(r.stdout));
t('an action that is not one of the five is refused (no delete)', /unknown action "delete"/.test(r.stdout));
db1.close();

console.log('\n--apply');
r = run(planPath, '--apply');
t('apply exits 0', r.status === 0, r.stderr || r.stdout.slice(-300));
t('a backup was taken first', readdirSync(path.join(tmp, 'backups')).some(f => f.startsWith('pre-supplier-step2-')));
const db2 = new Database(dbPath, { readonly: true });
const vt = (id) => db2.prepare('SELECT vendor_type FROM suppliers WHERE id = ?').get(id).vendor_type;
t('Acme is typed ingredient, National Measures packaging', vt('s-anc') === 'ingredient' && vt('s-nm') === 'packaging');
t('Cary stays supplies; the supplier not on the plan stays typeless', vt('s-cary') === 'supplies' && vt('s-left') === null);
const part = (m) => db2.prepare("SELECT part_number FROM supplier_material_parts WHERE material_id = ? AND system = 'mrpeasy'").get(m)?.part_number;
t('Beet Juice gets 201069; Spirulina keeps 200500', part('m-1') === '201069' && part('m-2') === '200500');
const created = db2.prepare("SELECT * FROM supplier_materials WHERE supplier_id = 's-anc' AND item_description = 'Natural Flavor WONF'").get();
t('the material marked create exists with its part number', !!created && part(created.id) === '201070');
const f = (id) => db2.prepare('SELECT kind, expires_on, lot_number FROM supplier_files WHERE id = ?').get(id);
t('the signed questionnaire is relabelled', f('f-q').kind === 'questionnaire');
t('the GMP certificate is counted, with its date', f('f-gmp').kind === 'gmp_certificate' && f('f-gmp').expires_on === '2027-06-30');
t('the refused rows changed nothing', f('f-gmp-nodate').kind === 'certificate' && f('f-wrongfrom').kind === 'sds' && f('f-exp2').expires_on === '2026-03-01');
t('the evidenced expiry moved', f('f-exp').expires_on === '2027-01-01');
t('the lot number is filled', f('f-lot').lot_number === 'L-12345');
const after = { suppliers: db2.prepare('SELECT COUNT(*) n FROM suppliers').get().n, files: db2.prepare('SELECT COUNT(*) n FROM supplier_files').get().n };
t('nothing deleted: same suppliers and files', after.suppliers === before.suppliers && after.files === before.files);
t('one audit row per change (2 types + 1 material + 1 part + 4 files = 8)',
  db2.prepare('SELECT COUNT(*) n FROM audit_log').get().n - auditBefore === 8, String(db2.prepare('SELECT COUNT(*) n FROM audit_log').get().n - auditBefore));
const gates = db2.prepare("SELECT key, value FROM app_settings WHERE key IN ('supplier_gmp_gate','supplier_banned_gate') ORDER BY key").all();
t('both gates are still warn', gates.length === 2 && gates.every(g => g.value === 'warn'));
const auditN = db2.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
db2.close();

console.log('\nA second --apply writes nothing');
r = run(planPath, '--apply');
const db3 = new Database(dbPath, { readonly: true });
t('it finds nothing to do', r.status === 0 && /Nothing to do/.test(r.stdout), r.stdout.slice(-300));
t('no new audit rows, no second material', db3.prepare('SELECT COUNT(*) n FROM audit_log').get().n === auditN
  && db3.prepare("SELECT COUNT(*) n FROM supplier_materials WHERE item_description = 'Natural Flavor WONF'").get().n === 1);
db3.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
