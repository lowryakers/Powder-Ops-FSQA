// verify:onboardingedit — D-155, live on a fresh database and a real browser.
//
// Reported (Lowry, 6 Oct): a new hire's link kept telling her the state was
// missing although she had entered it, and the office packet showed it missing
// too. Reproduced: a phone's address AutoFill fills the box without firing the
// event the page listens for, so the page showed "UT" and the save sent a blank.
// And the office had no way to fill it in for her.
//  - The wizard saves what is IN the box: any named field the form's own copy
//    has blank is read from the screen at save time.
//  - State is a list, and "Utah" / "utah" / "ut" all file as UT on the server.
//  - The office can fill in or correct the hire's answers. Each change is
//    recorded on the packet with a name; once a form is signed a reason is
//    required and the signed form stands as signed.
//
// Caller sets PORT + DBPATH (server up). Needs a built client. The control is
// `main`: the AutoFill save stores nothing and there is no edit form.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

const PORT = Number(process.env.PORT || 5074);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
const mkUser = db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,?,?,datetime('now','+7 day'),?)`);
mkUser.run('oe-admin', 'Oed Admin', 'Oed Admin', 'admin', 'office', 1, 'SC-oea', null);
mkUser.run('oe-ware', 'Wren Floor', 'Wren Floor', 'supervisor', 'warehouse', 1, 'SC-oew', JSON.stringify({ operator: 'view' }));
db.close();

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name, code) => {
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: code });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const adm = await login('oe-admin', 'Oed Admin', 'SC-oea');
const ware = await login('oe-ware', 'Wren Floor', 'SC-oew');
const A = (m, p, b) => c(m, p, b, adm?.token);
t('the office admin signs in', !!adm?.token);

const start = async (first, last) => J(await A('POST', '/onboarding', { first_name: first, last_name: last, position: 'Operator' }));
const recOf = async (id) => {
  const list = await J(await A('GET', '/onboarding'));
  return (list?.records || list || []).find(x => x.id === id);
};
const one = await start('Paula', 'Portal');
const tok1 = one.link.split('/welcome/')[1];
const W = (tok, m = 'GET', b) => c(m, `/onboarding-portal/${tok}`, b);
t('the new hire\'s link reads its record', (await W(tok1)).ok);

console.log('\n── one spelling of the state ──');
let r = await W(tok1, 'PUT', { state: 'utah' });
let pr = await J(r);
t('"utah" typed (or autofilled) on the link files as UT', r.ok && pr.state === 'UT', JSON.stringify(pr?.state));
r = await W(tok1, 'PUT', { state: ' Ut ' });
t('" Ut " files as UT', (await J(r))?.state === 'UT');
r = await W(tok1, 'PUT', { state: 'Ontario' });
t('a value that is not a US state is kept as typed, never refused', r.ok && (await J(r))?.state === 'Ontario');

console.log('\n── the office fills in what the hire could not ──');
const two = await start('Sofia', 'Stateless');
const tok2 = two.link.split('/welcome/')[1];
await W(tok2, 'PUT', { address1: '12 Main St', city: 'Provo', zip: '84601', phone: '8015551234' });
let rec = await recOf(two.id);
t('the packet shows the state missing, as the plant saw it', rec.missing.some(m => m.field === 'state'));
r = await c('PUT', `/onboarding/${two.id}`, { state: 'UT' }, ware?.token);
t('somebody without the Onboarding module cannot edit a packet', r.status === 403, String(r.status));
r = await A('PUT', `/onboarding/${two.id}`, { state: 'Utah' });
rec = await J(r);
t('the office fills the state in before anything is signed — no reason needed', r.ok && rec.state === 'UT', JSON.stringify({ s: r.status, st: rec?.state }));
t('the state leaves the missing list', !rec.missing.some(m => m.field === 'state'));
t('the change is recorded on the packet with the office\'s name, blank → UT',
  rec.office_edits?.length === 1 && rec.office_edits[0].by === 'Oed Admin'
  && rec.office_edits[0].fields.some(f => f.field === 'state' && f.from === null && f.to === 'UT'), JSON.stringify(rec.office_edits));
const p2 = await J(await W(tok2));
t('the new hire\'s link no longer asks for the state', !p2.missing.some(m => m.field === 'state'));
t('the link does not show the office\'s correction log', p2.office_edits === undefined);
r = await A('PUT', `/onboarding/${two.id}`, { position: 'Lead operator' });
rec = await J(r);
t('a job fact the office owns is not logged as a correction to the hire\'s answers', r.ok && rec.office_edits.length === 1);
r = await A('PUT', `/onboarding/${two.id}`, { state: 'UT', city: 'Provo' });
rec = await J(r);
t('re-saving the same values records nothing', rec.office_edits.length === 1);

console.log('\n── once a form is signed, a correction needs a reason ──');
{
  const d = new Database(process.env.DBPATH);
  d.prepare('UPDATE onboarding_records SET w4_signature = ? WHERE id = ?')
    .run(JSON.stringify({ name: 'Sofia Stateless', at: new Date().toISOString(), attestation: 'x' }), two.id);
  d.close();
}
r = await A('PUT', `/onboarding/${two.id}`, { phone: '8015559999' });
let j = await J(r);
t('changing the hire\'s phone after a signature without a reason is refused, saying why', r.status === 400 && j?.reason_required === true, JSON.stringify(j));
rec = await recOf(two.id);
t('…and nothing was written', rec.phone === '8015551234');
r = await A('PUT', `/onboarding/${two.id}`, { phone: '8015559999', office_reason: 'She called with her new number' });
rec = await J(r);
t('with a reason it saves, and the reason is on the record', r.ok && rec.phone === '8015559999'
  && rec.office_edits.at(-1).reason === 'She called with her new number', JSON.stringify(rec?.office_edits?.at(-1)));
t('the signed W-4 is untouched', rec.w4_signature?.name === 'Sofia Stateless');
r = await A('PUT', `/onboarding/${two.id}`, { start_date: '2026-10-20' });
t('a job fact still saves after signing without a reason', r.ok);
const audit = (() => { const d = new Database(process.env.DBPATH, { readonly: true });
  try { return d.prepare("SELECT details FROM audit_log WHERE entity_type = 'onboarding' AND entity_id = ?").all(two.id).map(x => x.details).join(' '); }
  finally { d.close(); } })();
t('the audit names the fields changed and never the values', audit.includes('office_edit') && !audit.includes('8015559999'));

console.log('\n── the packet says what the office changed ──');
r = await A('GET', `/onboarding/${two.id}/packet.pdf`);
const buf = new Uint8Array(await r.arrayBuffer());
const pdf = await pdfjs.getDocument({ data: buf, verbosity: 0 }).promise;
let text = '';
for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + ' ';
t('the packet PDF has a "Changed by the office" section', /Changed by the office/.test(text));
t('…naming who, the reason, and the before and after', /Oed Admin/.test(text) && /She called with her new number/.test(text) && /state: was \(blank\), now UT/.test(text), text.slice(text.indexOf('Changed by'), text.indexOf('Changed by') + 300));

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // THE REPORTED CASE: AutoFill puts a value in the box without the event.
  const three = await start('Ana', 'Autofill');
  const tok3 = three.link.split('/welcome/')[1];
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(`${URL}/welcome/${tok3}`);
  await phone.waitForTimeout(1500);
  await phone.locator('button', { hasText: /start|let|begin|go|empez|comenz/i }).first().click();
  await phone.waitForTimeout(800);
  t('the state is a list on the phone, not a two-letter box', await phone.locator('select[name="state"] option[value="UT"]').count() === 1);
  t('the address fields carry AutoFill names', await phone.locator('input[autocomplete="address-line1"]').count() === 1
    && await phone.locator('input[autocomplete="postal-code"]').count() === 1);
  // Write the values the way an AutoFill that fires no event does.
  await phone.evaluate(() => {
    const inSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const selSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    inSet.call(document.querySelector('input[name="city"]'), 'Orem');
    inSet.call(document.querySelector('input[name="zip"]'), '84057');
    selSet.call(document.querySelector('select[name="state"]'), 'UT');
  });
  await phone.locator('button', { hasText: /next|siguiente|continue|continuar/i }).first().click();
  await phone.waitForTimeout(1200);
  rec = await recOf(three.id);
  t('what AutoFill put in the boxes is what gets saved — state UT', rec?.state === 'UT', JSON.stringify(rec?.state));
  t('…and the city and ZIP beside it', rec?.city === 'Orem' && rec?.zip === '84057', JSON.stringify({ c: rec?.city, z: rec?.zip }));
  t('the state no longer reads missing', !rec.missing.some(m => m.field === 'state'));
  const w = await phone.evaluate(() => document.documentElement.scrollWidth);
  t('no sideways scroll on the link at 390px', w <= 390, `${w}px`);

  const four = await start('Mia', 'Missing');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [adm.token, adm.user]);
  await page.goto(`${URL}/?tab=onboarding`);
  await page.waitForSelector(`[data-onboarding="${four.id}"]`, { timeout: 15000 });
  await page.locator(`[data-onboarding="${four.id}"] > button`).first().click();
  await page.waitForTimeout(400);
  const row = page.locator(`[data-onboarding="${four.id}"]`);
  t('the packet offers "Fill it in here" beside what is missing', await row.locator('[data-fill-in]').count() === 1);
  await row.locator('[data-fill-in]').click();
  t('the edit form opens', await row.locator('[data-edit-details]').count() === 1);
  const stateSel = row.locator('[data-edit-state]');
  t('the state box is marked missing', /border-amber-500/.test(await stateSel.getAttribute('class')));
  await stateSel.selectOption('UT');
  await row.locator(`#ob-edit-${four.id}-city`).fill('Lehi');
  await row.locator('[data-edit-save]').click();
  await page.waitForTimeout(1200);
  rec = await recOf(four.id);
  t('saving from the screen fills the record', rec.state === 'UT' && rec.city === 'Lehi', JSON.stringify({ s: rec.state, c: rec.city }));
  t('the packet lists the office\'s change', await row.locator('[data-office-edits]').count() === 1
    && /Oed Admin/.test(await row.locator('[data-office-edits]').innerText()));
  t('there is an Edit details button for the next correction', await row.locator('[data-edit-open]').count() === 1);
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
