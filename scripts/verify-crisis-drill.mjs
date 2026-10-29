// verify:crisisdrill — Safety → Crisis Drills: the Crisis Management Drill and
// Product Integrity Inspection (D-265, SOP 501, SQF 2.6.4.2).
//
// Files Daniela's 21 Oct 2026 earthquake drill as she wrote it, checks the
// sign-off refusals, the two password-signed reviews, the lock, revoke, and the
// readiness line; then the screen.
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: drop the missingToSign check from the sign route — the "half-filled
// drill cannot be reviewed" assertion fails.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5159);
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('cd-dc', 'Dana Control', 'operator', 'document_control', { safety: 'edit' });
mk('cd-qa', 'Quinn Quality', 'operator', 'qa', { safety: 'edit' });
mk('cd-mgr', 'Max Manager', 'supervisor', 'production', { safety: 'edit' });
mk('cd-op', 'Oscar Floor', 'operator', 'warehouse', { safety: 'edit' });
mk('cd-admin', 'Ada Admin', 'admin', 'admin', {});
db.close();

const H = { 'Content-Type': 'application/json' };
const call = async (m, p, b, tok) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};
const PW = 'CrisisDrill2026!!';
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json;
};
const dc = await signIn('Dana Control', 'cd-dc');
const qa = await signIn('Quinn Quality', 'cd-qa');
const mgr = await signIn('Max Manager', 'cd-mgr');
const op = await signIn('Oscar Floor', 'cd-op');
const admin = await signIn('Ada Admin', 'cd-admin');

const forms = (await call('GET', '/safety/forms', null, dc.token)).json;
t('the form is served: nine inspection lines, the objective, DRAFT-1, SOP 501',
  forms?.drill?.inspection_items?.length === 9 && /identify, isolate, and protect/.test(forms.drill.objective) && forms.drill.revision === 'DRAFT-1' && forms.drill.sop === 'SOP 501');
t('Document Control may file it', forms?.drill?.can_file === true && forms?.drill?.can_sign_qa === false);

console.log('\n── filing ──');
let r = await call('POST', '/safety/drills', { drill_date: '2026-10-21' }, op.token);
t('a warehouse operator cannot file one', r.status === 403);
r = await call('POST', '/safety/drills', { drill_date: '2099-01-01' }, dc.token);
t('a drill dated in the future is refused', r.status === 400);
r = await call('POST', '/safety/drills', { drill_date: '2026-10-21', area: 'Warehouse', scenario: 'earthquake' }, dc.token);
const half = r.json;
t('a half-filled drill is saved (finished later)', r.status === 201 && half?.missing_to_sign?.length > 0);
r = await call('POST', `/safety/drills/${half.id}/sign/qa`, {}, qa.token);
t('a half-filled drill cannot be reviewed', r.status === 409 && Array.isArray(r.json?.missing), r.text.slice(0, 160));

// Daniela's sheet, as written.
const PASSES = Object.fromEntries(forms.drill.inspection_items.map(it => [it.key, 'P']));
const daniela = {
  drill_date: '2026-10-21', time_started: '10:40', time_completed: '13:00', area: 'Warehouse',
  activities: ['physical_inspection', 'practical'], scenario: 'earthquake', conducted_by: 'Daniela Servin',
  participants: [
    { name: 'Adam Bliss', role: 'Operations Manager' }, { name: 'Maria Servin', role: 'Quality Manager' },
    { name: 'Juan González', role: 'Supervisor' }, { name: 'Debora Gomez', role: 'Supervisor' },
    { name: 'Bernardo Enciso', role: 'Supervisor' }, { name: 'Jose Luna', role: 'Supervisor' },
    { name: 'Zuleika Nova', role: 'Supervisor' }, { name: 'Ricardo Avalos', role: 'Supervisor' },
  ],
  scenario_description: 'Simulated scenario: An earthquake interrupts production. A packaging pallet shifts, and debris is reported near Line 1.',
  actions: 'After simulated authorization for safe re-entry, the team identified potentially affected materials, demonstrated product-hold procedures, and reviewed contamination risks and restart requirements.',
  inspection: PASSES, product_lot: 'Course Sweetener (Powder) LOT:000151', quantity_location: '900kg/ 060802A', hold_status: 'na',
  what_worked: 'Employees correctly identified affected lots, demonstrated hold controls, and explained that product must not be used or shipped without QA approval.',
  gaps: '', result: 'effective', corrective_actions: [], retest_required: false, record_location: 'Powder Ops Vineyard',
};
r = await call('PUT', `/safety/drills/${half.id}`, daniela, dc.token);
const filled = r.json;
t('the 21 Oct drill is complete as written', r.status === 200 && filled?.missing_to_sign?.length === 0, JSON.stringify(filled?.missing_to_sign));
t('…keeping every participant and the lot', filled?.participants?.length === 8 && filled?.product_lot === daniela.product_lot);

console.log('\n── a failed line needs its corrective action ──');
r = await call('PUT', `/safety/drills/${half.id}`, { inspection: { ...PASSES, controls_verified: 'F' } }, dc.token);
t('a Fail with "Effective" and no corrective action is named as unfinished',
  ['Gaps or deficiencies', 'A corrective action', 'cannot be "Effective"'].every(w => r.json?.missing_to_sign?.some(m => m.includes(w))), JSON.stringify(r.json?.missing_to_sign));
r = await call('PUT', `/safety/drills/${half.id}`, { inspection: PASSES }, dc.token);

console.log('\n── the two reviews ──');
r = await call('POST', `/safety/drills/${half.id}/sign/qa`, {}, mgr.token);
t('a production supervisor cannot sign the QA line', r.status === 403);
r = await call('POST', `/safety/drills/${half.id}/sign/qa`, {}, qa.token);
t('signing asks for the password (403, not 401)', r.status === 403 && r.json?.signature_required === true, r.text.slice(0, 120));
r = await call('POST', `/safety/drills/${half.id}/sign/qa`, { signature_password: PW }, qa.token);
t('QA signs with the password', r.status === 200 && r.json?.qa_signed_by === 'Quinn Quality');
r = await call('PUT', `/safety/drills/${half.id}`, { area: 'Production' }, dc.token);
t('a signed drill is closed to edits', r.status === 409);
r = await call('POST', `/safety/drills/${half.id}/sign/management`, { signature_password: PW }, qa.token);
t('one person cannot sign both lines', r.status === 403 || r.status === 409);
r = await call('POST', `/safety/drills/${half.id}/sign/management`, { signature_password: PW }, mgr.token);
t('management signs', r.status === 200 && r.json?.mgmt_signed_by === 'Max Manager');
const audit = q("SELECT details FROM audit_log WHERE entity_type = 'crisis_drill' AND action = 'sign' ORDER BY id DESC LIMIT 1")[0];
t('the signature is audited as password-verified', /signature_verified/.test(audit?.details || ''));
r = await call('DELETE', `/safety/drills/${half.id}`, null, admin.token);
t('a reviewed drill cannot be deleted', r.status === 409);
r = await call('DELETE', `/safety/drills/${half.id}/sign/qa`, { reason: 'x' }, qa.token);
t('revoking needs a reason', r.status === 400);
r = await call('DELETE', `/safety/drills/${half.id}/sign/management`, { reason: 'wrong date' }, qa.token);
t('only the signer or an admin may revoke', r.status === 403);
r = await call('DELETE', `/safety/drills/${half.id}/sign/qa`, { reason: 'Re-checking the lot number' }, qa.token);
t('the signer revokes with a reason', r.status === 200 && !r.json?.qa_signed_by);
await call('POST', `/safety/drills/${half.id}/sign/qa`, { signature_password: PW }, qa.token);

const ready = (await call('GET', '/compliance/readiness-review', null, admin.token));
const line = JSON.stringify(ready.json || '').match(/Crisis drill 2026-10-21[^"]*/)?.[0];
t('the readiness review names the drill as reviewed', /reviewed/.test(line || '') && !/not yet reviewed/.test(line || ''), line || ready.text.slice(0, 120));

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`http://localhost:${PORT}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [dc.token, dc.user]);
  await page.goto(`http://localhost:${PORT}/?tab=safety&view=drills`);
  await page.locator('[data-drill-list]').waitFor({ timeout: 20000 }).catch(() => {});
  t(`${width}px: the Crisis Drills tab lists the drill as reviewed`, /Reviewed by QA and management/.test(await page.locator('[data-drill-list]').innerText().catch(() => '')));
  await page.locator(`[data-drill-row="${half.id}"]`).click();
  await page.locator('[data-drill-form]').waitFor({ timeout: 10000 });
  t(`${width}px: opened, it is read-only and shows both signatures`, await page.locator('[data-drill-save]').count() === 0
    && /Quinn Quality/.test(await page.locator('[data-drill-reviews]').innerText()) && /Max Manager/.test(await page.locator('[data-drill-reviews]').innerText()));
  t(`${width}px: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://localhost:${PORT}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [dc.token, dc.user]);
  await page.goto(`http://localhost:${PORT}/?tab=safety&view=drills`);
  await page.locator('[data-drill-new]').click({ timeout: 20000 });
  await page.locator('[data-drill-field="area"]').fill('Production');
  await page.locator('[data-drill-scenario="fire"]').check();
  await page.locator('[data-drill-mark="identified:F"]').click();
  await page.locator('[data-drill-save]').click();
  await page.locator('[data-drill-missing]').waitFor({ timeout: 10000 });
  const miss = await page.locator('[data-drill-missing]').innerText();
  t('a new drill saves and names what is left before review', /corrective action/i.test(miss) && /Conducted by/.test(miss), miss.slice(0, 160));
  t('…and offers no Sign button to Document Control', await page.locator('[data-drill-sign]').count() === 0);
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
