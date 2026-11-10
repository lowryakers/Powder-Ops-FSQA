// verify:singlespine — D-328, live on a fresh database, a reboot, and a browser.
//
// The three changes that make a rename one act:
//   1. a controlled value is changed IN THE APP: Document Control proposes, a QA
//      supervisor reviews with a password, it is approved with a password and is
//      in use at once — and a reboot does not undo it or re-park the code;
//   2. "Where is a name used?" renames it in the plain places in one act, with a
//      preview that writes nothing, leaving filed records and the dilution
//      checks alone;
//   3. a recurring task follows a document; a newer revision lists it on Doc
//      Control Review until it is marked checked.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// this change: /controlled/:id/propose does not exist.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5209;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
const BOOT2 = Number(PORT) + 400;
const PW = 'Spine2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];
const w = (sql, ...a) => { const d = new Database(DBP); try { return d.prepare(sql).run(...a); } finally { d.close(); } };

const PEOPLE = [['ss-dc', 'Dana Spine', 'operator', 'document_control'], ['ss-qa', 'Quinn Spine', 'supervisor', 'qa'],
  ['ss-op', 'Owen Spine', 'operator', 'warehouse']];
for (const [id, name, role, dept] of PEOPLE) {
  w(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`, id, name, name, role, dept, `SC-${id}`, JSON.stringify({ documents: 'edit', 'qa-review': 'view' }));
}
const mk = (base) => async (m, p, b, tok) => {
  const r = await fetch(`${base}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const call = mk(URL);
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json;
};
const dcLogin = await login('ss-dc', 'Dana Spine');
const D = dcLogin?.token, Q = (await login('ss-qa', 'Quinn Spine'))?.token, O = (await login('ss-op', 'Owen Spine'))?.token;
t('signed in (Document Control, a QA supervisor, a warehouse operator)', !!D && !!Q && !!O);
const sig = { signature_password: PW };

// ── 2: rename from the search ───────────────────────────────────────────────
console.log('\n── Rename from the search ──');
const zone = one("SELECT id FROM equipment WHERE asset_id = 'QA-CL-004'");
w(`INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active, task_group)
   VALUES ('ss-sched', ?, 'Sanitize filler with Sani-512', 'Use Sani 512 at the station', 'weekly', 1, ?, 1, 'cleaning')`,
  zone.id, JSON.stringify(['Mix Sani-512 "as labelled"', 'Spray']));
w(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, due_date, procedure_steps, task_group, status)
   VALUES ('ss-card', 'ss-sched', ?, 'Sanitize filler with Sani-512', 'Use Sani 512 at the station', date('now'), ?, 'cleaning', 'open')`,
  zone.id, JSON.stringify(['Mix Sani-512 "as labelled"', 'Spray']));
w(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, task_group, status, completed_at)
   VALUES ('ss-done', 'ss-sched', ?, 'Sanitize filler with Sani-512', date('now','-7 day'), 'cleaning', 'completed', datetime('now','-7 day'))`, zone.id);
w(`INSERT INTO approved_chemicals (id, name, category) VALUES ('ss-chem', 'Sani-512 Sanitizer (test)', 'sanitizer')`);
const dilutionTitleBefore = one("SELECT title FROM pm_schedules WHERE dilution_key = 'sani512'").title;
const auditBefore = one('SELECT COUNT(*) n FROM audit_log').n;

let r = await call('POST', '/doc-review/name-usage/rename', { from: 'Sani-512', to: 'J-512', preview: true }, O);
t('a warehouse operator cannot rename', r.status === 403);
r = await call('POST', '/doc-review/name-usage/rename', { from: 'Sani-512', to: 'J-512', preview: true }, D);
const preview = r.json;
t('the preview lists the task, its open card and the chemical', r.status === 200 && ['ss-sched', 'ss-card', 'ss-chem'].every((id) => preview?.rows?.some((x) => x.id === id)), JSON.stringify(preview?.by_target));
t('…not the completed card (a filed record)', !preview?.rows?.some((x) => x.id === 'ss-done'));
t('…and leaves the dilution checks to Controlled Changes', preview?.kept?.dilution_checks > 0 && !preview?.rows?.some((x) => x.id === one("SELECT id FROM pm_schedules WHERE dilution_key = 'sani512'").id));
t('the preview wrote nothing', one("SELECT title FROM pm_schedules WHERE id = 'ss-sched'").title.includes('Sani-512') && one('SELECT COUNT(*) n FROM audit_log').n === auditBefore);
r = await call('POST', '/doc-review/name-usage/rename', { from: 'Sani-512', to: 'J-512' }, D);
t('renaming needs a reason', r.status === 400 && r.json?.code === 'REASON_REQUIRED');
r = await call('POST', '/doc-review/name-usage/rename', { from: 'Sani-512', to: 'J-512', reason: 'DCR 0500' }, D);
t('Rename applies what the preview showed', r.status === 200 && r.json?.renamed === preview.total, `${r.status} ${r.json?.renamed} vs ${preview?.total}`);
const s2 = one("SELECT * FROM pm_schedules WHERE id = 'ss-sched'");
t('the schedule reads J-512 (title, description, steps)', s2.title === 'Sanitize filler with J-512' && s2.description === 'Use J-512 at the station' && JSON.parse(s2.procedure_steps)[0] === 'Mix J-512 "as labelled"', `${s2.title} | ${s2.procedure_steps}`);
t("the open card reads J-512", one("SELECT title FROM work_orders WHERE id = 'ss-card'").title === 'Sanitize filler with J-512');
t('the completed card is untouched', one("SELECT title FROM work_orders WHERE id = 'ss-done'").title.includes('Sani-512'));
t('the chemical list entry is renamed', one("SELECT name FROM approved_chemicals WHERE id = 'ss-chem'").name === 'J-512 Sanitizer (test)');
t('the dilution check is untouched', one("SELECT title FROM pm_schedules WHERE dilution_key = 'sani512'").title === dilutionTitleBefore);
t('each renamed row has its own audit entry with the reason', q("SELECT details FROM audit_log WHERE entity_id IN ('ss-sched','ss-card','ss-chem')").filter((a) => (a.details || '').includes('DCR 0500')).length === 3);

// ── 1: a controlled value changed in the app ────────────────────────────────
console.log('\n── A controlled value changed in the app ──');
r = await call('GET', '/controlled', null, O);
t('a warehouse operator cannot see Controlled Changes', r.status === 403);
r = await call('GET', '/controlled', null, Q);
t('a QA supervisor can see Controlled Changes', r.status === 200);
const list = (await call('GET', '/controlled', null, D)).json;
const dil = list.find((x) => x.key === 'dilution:FORM 106-01');
const atp = list.find((x) => x.key === 'atp:pc-1');
t('the dilution checks, ATP and scale tolerances can be changed here; a QMS form cannot', dil?.editable && atp?.editable && list.some((x) => x.key.startsWith('scale:') && x.editable) && !list.find((x) => x.scope === 'qms_form')?.editable);
r = await call('GET', `/controlled/${dil.id}/edit`, null, D);
const fields = r.json?.fields || [];
t('the edit form lists each chemical, its range and the revision', fields.some((f) => f.path === 'items[sani512].chemical' && f.value === 'Sani-512 Sanitizer') && fields.some((f) => f.path === 'revision'));
const values = { 'items[sani512].chemical': 'J-512 TM/MC Sanitizer', 'items[sani512].registry_name': 'J-512 TM/MC Sanitizer',
  'items[sani512].min': '150', 'items[sani512].max': '400', 'items[sani512].target': '150–400 ppm', revision: 'V4' };
r = await call('POST', `/controlled/${dil.id}/propose`, { values }, D);
t('a proposal needs a reason', r.status === 400 && r.json?.code === 'REASON_REQUIRED');
r = await call('POST', `/controlled/${dil.id}/propose`, { values: { ...values, 'items[sani512].min': '500' }, reason: 'DCR 0500' }, D);
t('a range whose lowest is above its highest is refused, in words', r.status === 400 && /above the highest/.test(r.json?.error || ''));
r = await call('POST', `/controlled/${dil.id}/propose`, { values: {}, reason: 'DCR 0500' }, D);
t('a proposal that changes nothing is refused', r.status === 400 && r.json?.code === 'NO_CHANGE');
r = await call('POST', `/controlled/${dil.id}/propose`, { values, reason: 'DCR 0500' }, Q);
t('a QA supervisor cannot propose (Document Control does)', r.status === 403);
r = await call('POST', `/controlled/${dil.id}/propose`, { values, reason: 'DCR 0500' }, D);
t('Document Control proposes the J-512 change', r.status === 200 && r.json?.status === 'pending' && r.json?.pending_source === 'app' && r.json?.changes?.length > 0, `${r.status} ${r.json?.error}`);
t('nothing changes on the floor yet', (await call('GET', '/dilution-forms', null, D)).json?.dilutions?.find((d) => d.key === 'sani512')?.chemical === 'Sani-512 Sanitizer');
const qaPile = (await call('GET', '/qa-review?source=controlled-qa-review', null, Q)).json?.sources?.find((s) => s.key === 'controlled-qa-review');
t('QA Review lists it for QA', qaPile?.count === 1 && qaPile?.items?.[0]?.link?.tab === 'controlled-changes', JSON.stringify(qaPile && { c: qaPile.count }));
r = await call('POST', `/controlled/${dil.id}/approve`, sig, D);
t('it cannot be approved before QA review', r.status === 409 && r.json?.code === 'QA_REVIEW_REQUIRED');
r = await call('POST', `/controlled/${dil.id}/qa-review`, sig, D);
t('Document Control cannot give QA review', r.status === 403);
r = await call('POST', `/controlled/${dil.id}/qa-review`, {}, Q);
t('QA review asks for the password', r.status === 403 && r.json?.signature_required);
r = await call('POST', `/controlled/${dil.id}/qa-review`, sig, Q);
t('QA reviews it with the password', r.status === 200 && r.json?.qa_reviewed_by === 'Quinn Spine');
r = await call('POST', `/controlled/${dil.id}/approve`, {}, D);
t('approving asks for the password', r.status === 403 && r.json?.signature_required);
r = await call('POST', `/controlled/${dil.id}/approve`, sig, D);
t('Document Control approves it with the password', r.status === 200 && r.json?.status === 'approved', `${r.status} ${r.json?.error}`);
const dforms = (await call('GET', '/dilution-forms', null, D)).json;
const j = dforms?.dilutions?.find((d) => d.key === 'sani512');
t('J-512 is in use at once, with its new range and revision', j?.chemical === 'J-512 TM/MC Sanitizer' && j?.min === 150 && j?.max === 400 && dforms?.form_revision === 'FORM 106-01 V4', JSON.stringify(j));
const ds = one("SELECT * FROM pm_schedules WHERE dilution_key = 'sani512'");
t('the daily dilution task and its card read J-512', ds.title === 'Chemical Dilution — J-512 TM/MC Sanitizer'
  && q("SELECT title FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')", ds.id).every((c) => c.title === ds.title));
t('the approval is in the audit log with the signature', q("SELECT details FROM audit_log WHERE entity_id = ? AND details LIKE '%from_app%'", dil.id).some((a) => a.details.includes('signature_verified')));

// ATP the same way.
r = await call('POST', `/controlled/${atp.id}/propose`, { values: { max: '25', revision: 'V6' }, reason: 'DCR 0501' }, D);
await call('POST', `/controlled/${atp.id}/qa-review`, sig, Q);
r = await call('POST', `/controlled/${atp.id}/approve`, sig, D);
t('the ATP limit changes in the app too', r.status === 200 && (await call('GET', '/atp-limit', null, D)).json?.max === 25);

// ── 3: tasks follow a document ──────────────────────────────────────────────
console.log('\n── Recurring tasks follow a document ──');
w(`INSERT INTO sop_documents (id, doc_number, title, revision, status, doc_type, category) VALUES ('ss-doc', 'SOP 999', 'Sanitation test', 'V1', 'active', 'sop', 'sanitation')`);
r = await call('GET', '/doc-review/schedules?q=filler', null, D);
t('Document Control finds the recurring task to link', r.json?.some((s) => s.id === 'ss-sched'));
r = await call('POST', '/doc-review/document-tasks/ss-doc', { schedule_id: 'ss-sched' }, D);
t('the task is linked to SOP 999, checked against V1', r.status === 200 && r.json?.[0]?.id === 'ss-sched' && r.json[0].needs_check === false);
const pile = async () => (await call('GET', '/doc-review?source=tasks-to-check', null, D)).json?.sources?.find((s) => s.key === 'tasks-to-check');
t('nothing to check while the revision has not moved', (await pile())?.count === 0);
w("UPDATE sop_documents SET revision = 'V2' WHERE id = 'ss-doc'");
let p = await pile();
t('a new revision lists the task on Doc Control Review', p?.count === 1 && p?.items?.[0]?.id === 'ss-sched' && /SOP 999/.test(p.items[0].subtitle));
r = await call('POST', '/doc-review/act', { source: 'tasks-to-check', ids: ['ss-sched'] }, D);
t('Mark checked clears it', r.status === 200 && r.json?.done?.includes('ss-sched') && (await pile())?.count === 0);
t('…and records the revision it was checked against', one("SELECT document_revision_checked v FROM pm_schedules WHERE id = 'ss-sched'").v === 'V2');

// ── Reboot ──────────────────────────────────────────────────────────────────
console.log('\n── A redeploy ──');
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(BOOT2), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await wait(1000); try { await fetch(`http://localhost:${BOOT2}/api/users/lookup?q=zz`); up = true; } catch { /* booting */ } }
await wait(3000);
try {
  const c2 = mk(`http://localhost:${BOOT2}`);
  t('the server reboots', up);
  t('J-512 is still in use after the reboot', (await c2('GET', '/dilution-forms', null, D)).json?.dilutions?.find((d) => d.key === 'sani512')?.chemical === 'J-512 TM/MC Sanitizer');
  t('the ATP limit is still 25', (await c2('GET', '/atp-limit', null, D)).json?.max === 25);
  const rows = q("SELECT key, status FROM controlled_definitions WHERE key IN ('dilution:FORM 106-01','atp:pc-1')");
  t('the code is NOT re-parked as a change waiting for approval', rows.every((x) => x.status === 'approved'), JSON.stringify(rows));
  t('no change request was raised for it', !q("SELECT data FROM qms_records WHERE record_type = 'document_change_request'").some((x) => /dilution|ATP critical/i.test(x.data || '')));
} finally { proc.kill(); }

// ── Screens ─────────────────────────────────────────────────────────────────
console.log('\n── Screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [D, dcLogin.user]);
  await page.goto(`${URL}/?tab=controlled-changes`);
  await page.waitForSelector('[data-change="env:temp-humidity"]', { timeout: 20000 });
  await page.click('[data-change="env:temp-humidity"]');
  await page.waitForSelector('[data-propose-form="env:temp-humidity"] [data-field="humidity.procedureLimit"]', { timeout: 10000 });
  t('Controlled Changes offers Change and draws the fields', true);
  await page.fill('[data-field="humidity.procedureLimit"]', '45');
  await page.fill('[data-propose-reason]', 'DCR 0502');
  await page.click('[data-propose-submit]');
  await page.waitForSelector('[data-proposal="env:temp-humidity"]', { timeout: 10000 });
  t('the proposal shows as waiting for QA review', /Waiting for QA review/.test(await page.textContent('[data-proposal="env:temp-humidity"]')));
  await page.goto(`${URL}/?tab=doc-review`);
  await page.waitForSelector('[data-name-usage-toggle]', { timeout: 20000 });
  await page.click('[data-name-usage-toggle]');
  await page.fill('[data-name-usage-input]', 'Sani 512');
  await page.click('[data-name-usage-search]');
  await page.waitForSelector('[data-name-usage-result]', { timeout: 10000 });
  t('the search result offers the rename box', (await page.$('[data-rename-box]')) !== null || Number(await page.getAttribute('[data-name-usage-result]', 'data-total')) === 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  t('no sideways scroll', !overflow);
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
