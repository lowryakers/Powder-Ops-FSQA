// The reachability pass (D-121): two Document Control piles that were derived
// and shown only on screens Document Control does not open — the BP&G zone
// drift on QA Inspections → Zones & items, the form-numbering worklist on the
// Forms tab — now appear on the Doc Control Review Center, and "open it" lands
// on the tab where the work is done. And the draft COA specifications, which
// waited on a tab QA rarely opens, are on QA's bell.
//
// Caller sets PORT + DBPATH. Fresh database.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5042;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const PW = 'Reach2026!';
{
  const db = new Database(process.env.DBPATH);
  const ins = db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SC-RC',datetime('now','+7 day'),?)`);
  // Document Control holds QA Inspections by one tick (D-102) and the registry; no pm, no qa-review.
  ins.run('rc-dc', 'Dana Reach', 'Dana Reach', 'operator', 'document_control', JSON.stringify({ 'qa-inspections': 'view', sops: 'view' }));
  // A QA supervisor: the bell's approver audience.
  ins.run('rc-qa', 'Quinn Reach', 'Quinn Reach', 'supervisor', 'qa', JSON.stringify({ coa: 'edit', 'qa-inspections': 'edit' }));
  // An operator with the same grants and none of the department.
  ins.run('rc-op', 'Otto Reach', 'Otto Reach', 'operator', 'warehouse', JSON.stringify({ 'qa-inspections': 'view' }));
  db.close();
}
const raw = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
async function signIn(id, name) {
  await raw('/users/login', { method: 'POST', body: JSON.stringify({ name }) });
  await raw('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password: PW, setup_code: 'SC-RC' }) });
  const d = await J(await raw('/users/login', { method: 'POST', body: JSON.stringify({ name, password: PW }) }));
  if (!d?.token) throw new Error(`no token for ${name}: ${JSON.stringify(d)}`);
  return d;
}
const dc = await signIn('rc-dc', 'Dana Reach');
const qa = await signIn('rc-qa', 'Quinn Reach');
const op = await signIn('rc-op', 'Otto Reach');
const as = (tok) => ({
  get: (p) => raw(p, { headers: { Authorization: `Bearer ${tok}` } }),
  put: (p, body) => raw(p, { method: 'PUT', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) }),
});
const DC = as(dc.token), QA = as(qa.token), OP = as(op.token);

console.log('── the Doc Control Review Center carries the two piles ──');
let review = await J(await DC.get('/doc-review'));
const src = (k, r = review) => (r?.sources || []).find(s => s.key === k);
t('Document Control reaches the review center on the department alone', Array.isArray(review?.sources), JSON.stringify(review).slice(0, 120));
t('an operator with the same grants does not', (await OP.get('/doc-review')).status === 403);
const numbering = src('form-numbering');
t('the form-numbering worklist is a source', !!numbering);
t('it opens on the Forms tab of Controlled Documents (a hub tab id)', numbering?.module === 'form-registry' && !numbering?.view, JSON.stringify({ m: numbering?.module, v: numbering?.view }));
t('it is a count with a way through, not a batch action', numbering && numbering.action === null);
const worklist = await J(await DC.get('/forms/numbering'));
t('its count IS the worklist\'s open count — one derivation, two readers',
  Number.isInteger(worklist?.open) && numbering?.count === worklist.open, `${numbering?.count} vs ${worklist?.open}`);
const numberingItems = await J(await DC.get('/doc-review?source=form-numbering'));
t('and the rows are the worklist\'s open items', (src('form-numbering', numberingItems)?.items || []).length === Math.min(worklist.open, 200));

const drift = src('bpg-zone-drift');
t('the BP&G zone drift is a source', !!drift);
t('it names FORM 431-01', drift?.form === '431-01');
t('it opens QA Inspections ON the Zones & items view', drift?.module === 'qa-inspections' && drift?.view === 'zones', JSON.stringify({ m: drift?.module, v: drift?.view }));
t('on a fresh database nothing has drifted (the seed IS the transcription)', drift?.count === 0, String(drift?.count));

// POSITIVE CONTROL for that zero: move one zone away from the drawing.
const zones = await J(await DC.get('/bpg/zones'));
const zone = (zones?.zones || []).find(z => (z.items || []).length > 0);
t('a zone with items exists to move', !!zone, JSON.stringify(zones).slice(0, 160));
const original = (zone?.items || []).map(i => ({ name: i.name, qty: i.qty, material: i.material }));
const moved = original.map((i, n) => n === 0 ? { ...i, qty: String(Number(i.qty || 1) + 5) } : i);
const saved = await QA.put(`/bpg/zones/${zone.schedule_id}/items`, { items: moved });
t('QA corrects a count on it', saved.status === 200, String(saved.status));
review = await J(await DC.get('/doc-review?source=bpg-zone-drift'));
const drifted = src('bpg-zone-drift');
t('THE REVIEW CENTER NOW COUNTS ONE DRIFTED ZONE', drifted?.count === 1, String(drifted?.count));
const row = (drifted?.items || [])[0];
t('and names it', row?.title === zone.zone, JSON.stringify(row));
t('with what moved', /changed:/.test(row?.subtitle || '') && new RegExp(original[0].name).test(row?.subtitle || ''), row?.subtitle);
t('against the drawing\'s own number', /FORM 431-01/.test(row?.extra || ''), row?.extra);
t('the total on the header moved with it', review?.total >= 1);
const zonesAfter = await J(await DC.get('/bpg/zones'));
t('and the Zones & items screen reports the same zone (one function, two screens)',
  (zonesAfter?.drift || []).some(d => d.zone === zone.zone) && (zonesAfter?.drift || []).length === 1, JSON.stringify(zonesAfter?.drift));

console.log('── the draft specifications reach QA\'s bell ──');
let bell = await J(await QA.get('/compliance/notifications'));
const item = (b) => (b?.items || []).find(i => i.id === 'coa-draft-specs');
const draftsBefore = await J(await QA.get('/coa/specifications/drafts'));
t('with no drafts the bell says nothing about them (quiet when there is nothing to say)',
  draftsBefore?.total === 0 ? !item(bell) : item(bell)?.count === draftsBefore?.total, JSON.stringify({ total: draftsBefore?.total, item: item(bell) }));
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT INTO coa_specifications (id, item_number, item_description, test_type, approval_status, is_active)
    VALUES ('rc-spec-1', 'RC-100', 'Reach test item', 'Gluten', 'draft', 0)`).run();
  db.close();
}
bell = await J(await QA.get('/compliance/notifications'));
const drafts = await J(await QA.get('/coa/specifications/drafts'));
t('a draft specification puts a line on the bell', !!item(bell), JSON.stringify((bell?.items || []).map(i => i.id)));
t('whose count is the Specifications tab\'s own total', item(bell)?.count === drafts?.total, `${item(bell)?.count} vs ${drafts?.total}`);
t('pointing at the COA module', item(bell)?.tab === 'coa');
const opBell = await J(await OP.get('/compliance/notifications'));
t('an operator is not told about QA\'s drafts', !item(opBell));

console.log('── in a real browser: from the review center to the tab where the work is ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [dc.token, dc.user]);
await page.goto(`${URL}/?tab=doc-review`);
const srcBtn = page.locator('[data-doc-review-source="bpg-zone-drift"]');
t('the review center offers the zone-drift pile', await srcBtn.first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
t('with the count on it', /1/.test(await srcBtn.first().innerText().catch(() => '')));
await srcBtn.first().click();
await page.waitForTimeout(1200);
t('the drifted zone is listed by name', (await page.locator('body').innerText()).includes(zone.zone));
await page.locator('[data-doc-review-open="bpg-zone-drift"]').click();
const landed = await page.getByRole('tab', { name: /Zones & items/i }).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
t('"open" lands on QA Inspections', landed);
t('ON THE ZONES & ITEMS VIEW, not the module\'s first tab',
  landed && await page.getByRole('tab', { name: /Zones & items/i }).first().getAttribute('aria-selected') === 'true');
const strip = page.locator('[data-bpg-drift]');
t('where the drift strip is up and names the same zone',
  await strip.first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    && (await strip.first().innerText()).includes(zone.zone));
await page.locator('[data-bpg-drift-toggle]').first().click();
t('and opens to what changed', await page.locator(`[data-bpg-drift-zone="${zone.zone}"]`).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false));

await page.goto(`${URL}/?tab=doc-review`);
const numBtn = page.locator('[data-doc-review-source="form-numbering"]');
await numBtn.first().waitFor({ timeout: 20000 });
await numBtn.first().click();
await page.waitForTimeout(800);
await page.locator('[data-doc-review-open="form-numbering"]').click();
// THE CONTROL THAT FOUND A SECOND GAP: Document Control holds the registry on
// the sops grant, and the Forms tab (where a number is ruled on) was not
// rendered for any non-admin at all — its visibility defaulted to a grant
// nobody can be given. Asserted for a NON-admin on sops alone.
const formsTab = page.getByRole('tab', { name: /^Forms\b/ }).first();
t('a non-admin on the sops grant is shown the Forms tab at all',
  await formsTab.waitFor({ timeout: 20000 }).then(() => true).catch(() => false),
  JSON.stringify(await page.getByRole('tab').allInnerTexts().catch(() => [])));
t('the numbering pile opens Controlled Documents ON the Forms tab',
  await formsTab.getAttribute('aria-selected').catch(() => null) === 'true');
t('and the worklist is on it', await page.locator('body').innerText().then(x => /numbering|Form numbers|renumber/i.test(x)));
await browser.close();

// Put the zone back: the drift must clear ITSELF, not need a deploy.
const restored = await QA.put(`/bpg/zones/${zone.schedule_id}/items`, { items: original });
review = await J(await DC.get('/doc-review'));
t('restoring the inventory clears the pile by itself', restored.status === 200 && src('bpg-zone-drift')?.count === 0, String(src('bpg-zone-drift')?.count));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
