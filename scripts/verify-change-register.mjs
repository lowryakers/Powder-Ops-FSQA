// The change register (CAR 4990683-4, software half of 4990683-5), live: a
// change is raised by anyone, refused for Quality until the impact assessment
// is complete, approved only by Quality with a password signature, cannot be
// marked implemented before approval, cannot close without approval and an
// effectiveness check (a second signature); the release the app booted is
// recorded and counted as uncontrolled until a change is linked; the bell and
// the readiness review read the same rows; the screen drives the same path.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4984; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('cg-qa','Maria Change','Maria Change','supervisor','qa',1,'SC-GQ',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('cg-mt','Ricardo Change','Ricardo Change','supervisor','maintenance',1,'SC-GM',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (name, id, pw, code) => { await call('POST', '/users/login', { name }); await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code }); return (await (await call('POST', '/users/login', { name, password: pw })).json()); };
const qa = await login('Maria Change', 'cg-qa', 'Quality2026!', 'SC-GQ');
const mt = await login('Ricardo Change', 'cg-mt', 'Maint2026!!', 'SC-GM');
const A = qa.token, M = mt.token;
t('Quality and Maintenance signed in', !!A && !!M);
const sqlite = () => new Database(dbPath);

console.log('\n── the release the app booted is on the register ──');
let reg = await (await call('GET', '/change-register', null, M)).json();
t('the booted commit is recorded once and counted as uncontrolled', reg.releases.length === 1 && reg.releases[0].sha === 'abc123def456' && reg.counts.releases_uncontrolled === 1, JSON.stringify(reg.releases));
t('Maintenance can read the register but is not Quality', reg.is_quality === false);

console.log('\n── raising a change ──');
let r = await call('POST', '/change-register', { kind: 'gizmo', title: 'x' }, M);
t('an unknown kind is refused', r.status === 400);
r = await call('POST', '/change-register', { kind: 'equipment', title: 'Replace the auger on stick pack line 2', description: 'Auger worn; new part from vendor', reason: 'Fill weight drift' }, M); let j = await r.json();
const cr = j.request;
t('Maintenance raises an equipment change as a draft, numbered CR-0001', r.status === 201 && cr.number === 'CR-0001' && cr.status === 'draft' && cr.requested_by === 'Ricardo Change');
r = await call('POST', `/change-register/${cr.id}/submit`, {}, M); j = await r.json();
t('it cannot go to Quality until the impact assessment is complete (six lines named)', r.status === 400 && j.missing.length === 6);
r = await call('PUT', `/change-register/${cr.id}`, { impact_product_safety: 'Product contact part — hygienic design check on the new auger', impact_quality: 'Fill weight re-verified after fitting', impact_validation: 'OQ re-run on line 2', documents_affected: 'WI007', training_affected: 'none', risk: 'medium' }, M);
t('the raiser completes the assessment', r.status === 200);
r = await call('POST', `/change-register/${cr.id}/implement`, { implementation_notes: 'fitted' }, M);
t('a change cannot be marked implemented before Quality approves it', r.status === 409);
r = await call('POST', `/change-register/${cr.id}/submit`, {}, M); j = await r.json();
t('with the assessment complete it goes to Quality', r.status === 200 && j.request.status === 'submitted');
let bell = JSON.stringify(await (await call('GET', '/compliance/notifications', null, A)).json());
t('the bell tells Quality a change is awaiting approval', bell.includes('change-approvals'));

console.log('\n── Quality signs ──');
r = await call('POST', `/change-register/${cr.id}/approve`, {}, M);
t('Maintenance cannot approve its own change', r.status === 403);
r = await call('POST', `/change-register/${cr.id}/approve`, {}, A); j = await r.json();
t('Quality is asked for a password (403 signature_required, not a logout)', r.status === 403 && j.signature_required === true);
r = await call('POST', `/change-register/${cr.id}/approve`, { signature_password: 'wrong' }, A);
t('a wrong password is refused', r.status === 403);
r = await call('POST', `/change-register/${cr.id}/approve`, { signature_password: 'Quality2026!', note: 'Fit outside production hours' }, A); j = await r.json();
t('the right one approves, and the approval is a signed act', r.status === 200 && j.request.status === 'approved' && j.request.approved_by === 'Maria Change');
{ const db = sqlite();
  // canonicalAction() folds `*_approved` to `approve`.
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'change_request' AND action IN ('approve','change_request_approved') ORDER BY rowid DESC LIMIT 1").get();
  t('the audit line records the signature was verified and never the password', /signature_verified/.test(a?.details || '') && !/Quality2026/.test(a?.details || ''));
  db.close(); }
r = await call('POST', `/change-register/${cr.id}/close`, { effectiveness_check: 'ok', signature_password: 'Quality2026!' }, A);
t('an approved change cannot close before it is implemented', r.status === 409);
r = await call('POST', `/change-register/${cr.id}/implement`, { implementation_notes: 'New auger fitted 9 Sep, line 2 OQ re-run 12/12 fills in tolerance' }, M); j = await r.json();
t('Maintenance marks it implemented after approval', r.status === 200 && j.request.status === 'implemented');
r = await call('POST', `/change-register/${cr.id}/close`, { effectiveness_check: 'Fill weight checked on three runs; within spec.' }, A); j = await r.json();
t('closing asks Quality for the signature too', r.status === 403 && j.signature_required);
r = await call('POST', `/change-register/${cr.id}/close`, { effectiveness_check: 'ok', signature_password: 'Quality2026!' }, A);
t('closing without a real effectiveness check is refused', r.status === 400);
r = await call('POST', `/change-register/${cr.id}/close`, { effectiveness_check: 'Fill weight checked on three runs; within spec.', signature_password: 'Quality2026!' }, A); j = await r.json();
t('closed, with the effectiveness check and both signatures on the record', r.status === 200 && j.request.status === 'closed' && j.request.approved_at && j.request.closed_by === 'Maria Change');
r = await call('PUT', `/change-register/${cr.id}`, { title: 'edited' }, M);
t('a closed change is a record and cannot be edited', r.status === 409);

console.log('\n── a software release under change control ──');
r = await call('POST', '/change-register', { kind: 'software', title: 'ReadyDoc release: change register + EMP results', impact_product_safety: 'none', impact_quality: 'New records; no existing record altered', impact_validation: 'verify:all executed green before push', documents_affected: 'none', training_affected: 'Quality briefed on the register', risk: 'low', release_id: reg.releases[0].id }, A); j = await r.json();
const sw = j.request;
t('a software change is raised against the recorded release', r.status === 201 && sw.release_id === reg.releases[0].id);
reg = await (await call('GET', '/change-register', null, A)).json();
t('the release now reads as under change control', reg.counts.releases_uncontrolled === 0 && reg.releases[0].change_number === sw.number);
r = await call('POST', `/change-register/${sw.id}/submit`, {}, A);
r = await call('POST', `/change-register/${sw.id}/reject`, { reason: 'x' }, A);
t('a rejection needs a reason', r.status === 400);
r = await call('POST', `/change-register/${sw.id}/reject`, { reason: 'Re-submit with the verify summary attached' }, A); j = await r.json();
t('Quality can reject with a reason', r.status === 200 && j.request.status === 'rejected');

console.log('\n── the review reads the same rows ──');
const rev = await (await call('GET', '/compliance/readiness-review', null, A)).json();
const sec = rev.sections.find(s => s.title === 'Change control');
t('the readiness review counts the register and the linked release', sec?.items.some(i => /2 change request\(s\) in the register/.test(i.label)) && sec.items.some(i => /All 1 software release\(s\) are linked/.test(i.label)));

console.log('\n── in the browser ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [M, mt.user]);
await page.goto(`${URL}/?tab=change-register`);
await page.waitForSelector('[data-change-register]', { timeout: 15000 });
t('a Maintenance supervisor reaches the Change Register from the nav', await page.locator('[data-change-register]').count() === 1);
await page.locator('[data-cr-new]').click();
await page.locator('[data-cr-kind]').selectOption('utility');
await page.locator('[data-cr-title]').fill('Compressed air dryer replaced');
await page.locator('[data-cr-save]').click();
await page.waitForSelector('[data-cr-row="CR-0003"]', { timeout: 10000 });
t('a change raised on the screen is numbered and listed as a draft', (await page.locator('[data-cr-row="CR-0003"] [data-cr-status="draft"]').count()) === 1);
await page.locator('[data-cr-row="CR-0003"]').click();
await page.waitForSelector('[data-cr-detail="CR-0003"]');
t('the detail names what the assessment still needs and holds "Send to Quality"', (await page.locator('[data-cr-missing]').count()) === 1 && await page.locator('[data-cr-submit]').isDisabled());
for (const k of ['impact_product_safety', 'impact_quality', 'impact_validation', 'documents_affected', 'training_affected']) await page.locator(`[data-cr-edit="${k}"]`).fill('none');
await page.locator('[data-cr-edit="risk"]').selectOption('low');
await page.locator('[data-cr-save-assessment]').click();
await page.waitForTimeout(1200);
// The detail stays open across the refresh (clicking the row again would toggle it closed).
await page.waitForSelector('[data-cr-detail="CR-0003"] [data-cr-submit]:not([disabled])', { timeout: 10000 }).catch(() => {});
t('once assessed, Send to Quality is enabled', !(await page.locator('[data-cr-submit]').isDisabled()));
await page.locator('[data-cr-submit]').click();
await page.waitForTimeout(1200);
t('the strip counts it as awaiting Quality approval', (await page.locator('[data-cr-awaiting]').getAttribute('data-cr-awaiting')) === '1');
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
