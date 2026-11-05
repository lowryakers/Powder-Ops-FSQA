// check:form431 — FORM 431-01 is filed as a FORM, never an SOP (D-316).
//
// It showed on the SOPs tab because the seed omitted doc_type and the column
// default ('sop') applied. This runs the real seed and repair on a temporary
// database (the app's own schema), and fails if the seed would file it as
// anything but 'form', or if the repair touches anything but doc_type.
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-form431-'));
process.env.DB_PATH = path.join(dir, 'form431.db');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const { getDb } = await import('../server/db.js');
const { seedForm431, fixForm431DocType, FORM_431_NUMBER } = await import('../server/form-431-seed.js');
const db = getDb();
const row = () => db.prepare('SELECT * FROM sop_documents WHERE doc_number = ?').get(FORM_431_NUMBER);

// 1. The boot path calls the module (no second inline INSERT that could omit doc_type).
const server = readFileSync(path.join(root, 'server.js'), 'utf8');
t('server.js seeds FORM 431-01 through seedForm431', /seedForm431\(db\)/.test(server));
t('server.js runs the repair at boot', /fixForm431DocType\(db\)/.test(server));
const inline = [...server.matchAll(/INSERT INTO sop_documents[\s\S]{0,600}?'FORM 431-01'/g)];
t('server.js has no inline INSERT of FORM 431-01', inline.length === 0, `${inline.length} found`);

// 2. A fresh seed files it as a form.
db.prepare('DELETE FROM sop_documents WHERE doc_number = ?').run(FORM_431_NUMBER);
t('the seed inserts the row', seedForm431(db) === true);
t('…filed as doc_type form', row()?.doc_type === 'form', row()?.doc_type);
t('the seed is insert-only', seedForm431(db) === false);
t('the repair finds nothing to do on a correct row', fixForm431DocType(db) === 0);

// 3. A row an earlier seed filed as 'sop' is moved, and nothing else about it.
db.prepare("UPDATE sop_documents SET doc_type = 'sop', status = 'active', revision = 'V5', owner = 'Daniela Servin' WHERE doc_number = ?").run(FORM_431_NUMBER);
const before = row();
const changed = fixForm431DocType(db);
const after = row();
t('the repair changes exactly one row', changed === 1, String(changed));
t('…to doc_type form', after.doc_type === 'form');
const moved = Object.keys(before).filter(k => k !== 'doc_type' && before[k] !== after[k]);
t('…and no other column moves (id, status, revision, owner, content)', moved.length === 0, moved.join(', '));
const audit = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'document' AND entity_id = ? ORDER BY rowid DESC").get(after.id);
t('…audited as system with the reason', audit?.actor === 'system' && /seeded with wrong doc_type/.test(audit?.details || ''), audit?.details);
t('a second run changes nothing', fixForm431DocType(db) === 0);

db.close?.();
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
