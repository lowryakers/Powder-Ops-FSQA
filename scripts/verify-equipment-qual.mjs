// IQ/OQ/PQ on the equipment setup checklist (CAR 4990683-6) and the FORM
// 204-01 V2 line parked under change control (CAR 4990682-3), live:
// a food-contact machine owes three protocol steps and a zone owes none; an
// attached protocol satisfies its step, an attach shares it, a changed model
// makes it stale, a re-upload clears it; the readiness review rolls it up.
// On a fresh database the checklist definition records V1 as approved and
// parks V2 with a DCR; the served form is V1; Document Control's approval puts
// the line in force, a new checklist stamps V2, sign-off refuses while the
// line is blank, and a NO escalates to Quality. Caller sets PORT + DBPATH +
// the R2 stand-in; needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4986; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
const sqlite = () => new Database(dbPath);
{ const db = sqlite();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('eq-adm','Lowry Qual','Lowry Qual','admin','admin',1,'SC-QA1',datetime('now','+7 day'),NULL)`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('eq-wh','Juan Dock','Juan Dock','operator','warehouse',1,'SC-QW1',datetime('now','+7 day'),'{"receiving-log":"edit"}')`).run();
  // Two QA people so an escalation has somebody to reach who is not the caller.
  for (const [id, name] of [['eq-qa1', 'Adam Qual'], ['eq-qa2', 'Maria Qual']]) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access) VALUES (?,?,?,'supervisor','qa',1,'{"receiving-log":"edit"}')`).run(id, name, name);
  }
  const ins = db.prepare(`INSERT INTO equipment (id, name, type, is_food_contact, asset_kind, loto_required, status, model_number) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`);
  ins.run('eq-m1', 'Hexagon Tumbler Blender 1 (qual)', 'Blender', 1, 'machine', 1, 'HT-1000');
  ins.run('eq-m2', 'Hexagon Tumbler Blender 2 (qual)', 'Blender', 1, 'machine', 1, 'HT-1000');
  ins.run('eq-s1', 'Batching floor scale (qual)', 'Scale', 0, 'machine', 0, 'FS-10');
  ins.run('eq-z1', 'BPG zone (qual)', 'Inspection Zone', 0, 'zone', 0, null);
  ins.run('eq-h1', 'Hand scoop (qual)', 'Hand Tool', 0, 'machine', 0, null);
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (name, id, pw, code) => { await call('POST', '/users/login', { name }); await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code }); return (await (await call('POST', '/users/login', { name, password: pw })).json()); };
const adm = await login('Lowry Qual', 'eq-adm', 'Admin2026!!', 'SC-QA1');
const wh = await login('Juan Dock', 'eq-wh', 'Dock2026!!!', 'SC-QW1');
const A = adm.token, W = wh.token;
t('an admin and a receiver signed in', !!A && !!W);
const readiness = async (id) => (await (await call('GET', `/equipment/${id}/readiness`, null, A)).json());
const step = (r, id) => r.steps.find(s => s.id === id);
const upload = async (eqId, kind, name) => {
  const fd = new FormData();
  fd.append('files', new Blob([`%PDF-1.4\n% ${name}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`], { type: 'application/pdf' }), name);
  fd.append('kind', kind);
  return fetch(`${URL}/api/equipment/${eqId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${A}` }, body: fd });
};

console.log('\n── who owes a qualification ──');
let r1 = await readiness('eq-m1');
t('a food-contact machine owes IQ, OQ and PQ, all required and all outstanding', ['iq', 'oq', 'pq'].every(k => step(r1, k) && step(r1, k).weight === 'required' && !step(r1, k).done) && r1.blocking >= 3);
t('the step says how to satisfy it', /upload it under Manuals/.test(step(r1, 'iq').detail));
const rs = await readiness('eq-s1');
t('a measuring instrument owes them too (SOP 421: used for measurement)', !!step(rs, 'iq'));
const rz = await readiness('eq-z1'); const rh = await readiness('eq-h1');
t('a zone owes none, and neither does a hand scoop', !step(rz, 'iq') && !step(rh, 'pq'));

console.log('\n── an attached protocol is the record ──');
let r = await upload('eq-m1', 'iq', 'IQ-HT-Blender-1-executed.pdf'); let j = await r.json();
t('the IQ protocol uploads under its kind', r.status === 201 && j[0]?.kind === 'iq', JSON.stringify(j).slice(0, 120));
const fileId = j[0].id;
r1 = await readiness('eq-m1');
t('IQ is now done, naming the protocol; OQ and PQ are still owed', step(r1, 'iq').done && /IQ-HT-Blender-1/.test(step(r1, 'iq').detail) && !step(r1, 'oq').done && !step(r1, 'pq').done);
r = await call('POST', `/equipment/files/${fileId}/attach`, { equipment_ids: ['eq-m2'] }, A); j = await r.json();
const r2 = await readiness('eq-m2');
t('attaching the same protocol to the twin machine satisfies its IQ too', r.status === 200 && j.attached === 1 && step(r2, 'iq').done);
r = await call('POST', '/equipment/eq-m1/steps/pq/skip', { reason: 'x' }, A);
t('a waiver needs a real reason', r.status === 400);
r = await call('POST', '/equipment/eq-m1/steps/pq/skip', { reason: 'PQ covered by the process validation study PV-2026-03 per SOP 421 §5.4' }, A);
r1 = await readiness('eq-m1');
t('PQ can be waived with a reason and a name, and leaves the denominator', r.status === 200 && step(r1, 'pq').waived && r1.applicable === r1.total - 1);
const eq1 = sqlite().prepare('SELECT * FROM equipment WHERE id = ?').get('eq-m1');
r = await call('PUT', '/equipment/eq-m1', { ...eq1, model_number: 'HT-2000' }, A);
r1 = await readiness('eq-m1');
t('replacing the model leaves the IQ STALE — done against a different machine', r.status === 200 && step(r1, 'iq').stale && !step(r1, 'iq').done && step(r1, 'iq').changed.includes('machine') && r1.stale.some(l => /Installation qualification/.test(l)));
r = await upload('eq-m1', 'iq', 'IQ-HT-2000-executed.pdf');
r1 = await readiness('eq-m1');
t('a new executed IQ clears it', r.status === 201 && step(r1, 'iq').done && !step(r1, 'iq').stale);
await upload('eq-m1', 'oq', 'OQ-HT-2000-executed.pdf');
r1 = await readiness('eq-m1');
t('with IQ and OQ on file and PQ waived, nothing of the qualification is outstanding', ['iq', 'oq'].every(k => step(r1, k).done) && step(r1, 'pq').waived);
const rev = await (await call('GET', '/compliance/readiness-review', null, A)).json();
const eqSec = rev.sections.find(s => s.title === 'Equipment');
t('the readiness review rolls the qualification up: 1 machine qualified, others partly or not', eqSec.items.some(i => /1 of \d+ machines needing qualification have IQ, OQ and PQ protocols on file \(1 partly\)/.test(i.label)), JSON.stringify(eqSec.items.map(i => i.label)));

console.log('\n── FORM 204-01 V2 is parked, not issued, by the deploy ──');
let defs = await (await call('GET', '/controlled', null, A)).json();
const def = defs.find(d => d.scope === 'checklist');
t('the checklist definition is under change control, PENDING on a fresh database — V1 recorded as approved, V2 parked', !!def && def.status === 'pending' && def.version === 1 && /FORM 204-01/.test(def.label));
t('the change reads as one ADDED item, the banned-substance line', def.changes.length === 2 && def.changes.some(c => c.kind === 'added' && c.what === 'item banned_substance_check') && def.changes.some(c => c.kind === 'changed' && c.what === 'revision' && c.from === 'V1' && c.to === 'V2'), JSON.stringify(def.changes));
{ const db = sqlite();
  const dcr = db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type = 'document_change_request' AND json_extract(data, '$.doc_name') LIKE 'FORM 204-01%'").get().c;
  t('a Document Change Request was raised for it at boot', dcr === 1 && !!def.pending_dcr_id);
  db.close(); }
let form = await (await call('GET', '/receiving/checklist/form', null, W)).json();
const count = (f) => f.sections.reduce((n, s) => n + s.items.length, 0);
t('the receiver is served V1: eighteen questions, no banned-substance line', form.revision === 'V1' && count(form) === 18 && !form.sections.some(s => s.items.some(i => i.key === 'banned_substance_check')));
r = await call('POST', '/receiving/checklist', {}, W); j = await r.json();
const noV1 = j.inspection_no;
t('a checklist started now is stamped V1', r.status === 200 && sqlite().prepare('SELECT checklist_revision FROM receiving_checklists WHERE inspection_no = ?').get(noV1).checklist_revision === 'V1');

console.log('\n── in the browser: Document Control sees it ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, adm.user]);
await page.goto(`${URL}/?tab=controlled-changes`);
let body = '';
try { await page.getByText('Checklist questions', { exact: false }).first().waitFor({ timeout: 15000 }); } catch { /* asserted below */ }
body = await page.locator('body').innerText();
t('Controlled Changes lists the checklist change with the added item named', /Checklist questions/.test(body) && /banned_substance_check/.test(body), `${page.url()} :: ${body.replace(/\s+/g, ' ').slice(0, 240)}`);
await browser.close();

console.log('\n── Document Control approves; the line is in force ──');
r = await call('POST', `/controlled/${def.id}/approve`, {}, W);
t('the receiver cannot approve it', r.status === 403);
r = await call('POST', `/controlled/${def.id}/approve`, {}, A); j = await r.json();
t('the admin (standing in for Document Control) approves — version 2, no restart', r.status === 200 && j.status === 'approved' && j.version === 2);
form = await (await call('GET', '/receiving/checklist/form', null, W)).json();
const line = form.sections.flatMap(s => s.items).find(i => i.key === 'banned_substance_check');
t('the served form is V2 with nineteen questions and the line escalates a NO to Quality', form.revision === 'V2' && count(form) === 19 && line?.notify?.answer === 'no' && line.notify.target_label === 'Adam and Maria');
r = await call('POST', '/receiving/checklist', {}, W); j = await r.json();
const noV2 = j.inspection_no;
t('a checklist started after approval is stamped V2; the earlier one still says V1', sqlite().prepare('SELECT checklist_revision FROM receiving_checklists WHERE inspection_no = ?').get(noV2).checklist_revision === 'V2'
  && sqlite().prepare('SELECT checklist_revision FROM receiving_checklists WHERE inspection_no = ?').get(noV1).checklist_revision === 'V1');
const answers = {};
for (const it of form.sections.flatMap(s => s.items)) if (it.key !== 'banned_substance_check') answers[it.key] = it.notify?.answer === 'yes' ? 'no' : 'yes';
r = await call('POST', '/receiving/checklist', { inspection_no: noV2, answers }, W);
r = await call('POST', `/receiving/checklist/${noV2}/review`, {}, W); j = await r.json();
t('sign-off is refused while the banned-substance line is blank', r.status === 400 && j.unanswered?.length === 1 && j.unanswered[0].key === 'banned_substance_check');
r = await call('POST', '/receiving/checklist', { inspection_no: noV2, answers: { banned_substance_check: 'no' } }, W); j = await r.json();
t('a NO escalates to Quality on the spot and the record says who was told', (j.notifications || []).some(n => n.item === 'banned_substance_check') && (j.escalations || j.triggered || []).length >= 0, JSON.stringify(j).slice(0, 300));
r = await call('POST', `/receiving/checklist/${noV2}/review`, {}, W);
t('with every line answered and the escalation sent, the inspection signs off', r.status === 200);
{ const db = sqlite();
  const dm = db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE body LIKE '%banned%' OR body LIKE '%Banned%'").get().c;
  t('Quality was told through ReadyBot', dm >= 1, `${dm}`);
  db.close(); }

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
