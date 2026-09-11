// Employee documents in a real browser, both sides.
//
// The operator, at phone width: the card is on their screen without them
// looking for it, it opens the document, the form's own boxes are there, the
// signature is DRAWN with a real pointer on the canvas, the password prompt
// asks before anything is signed, and the card goes once it is signed.
// Then the office at 1280: the Employee documents tab shows it signed with the
// name and the time. And Accounting opens on AP Drop, which is the tab it
// landed on when the intake moved into the hub.
//
// Caller sets PORT + DBPATH + the R2 stand-in; needs a built client.
import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts, PDFName, PDFString } from 'pdf-lib';

const PORT = process.env.PORT || 4994;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, code, map) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, map);
  mk('edui-office', 'Doc Office', 'admin', 'office', 'SC-DO', null);
  mk('edui-emp', 'Doc Operator', 'operator', 'batching', 'SC-DP', '{"production-log":"edit","ap-drop":"view"}');
  db.close();
}
const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
const signIn = async (id, name, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await (await post('/users/login', { name, password: pw })).json())?.token;
};
const officeTok = await signIn('edui-office', 'Doc Office', 'SC-DO', 'DocOffice2026!');
await signIn('edui-emp', 'Doc Operator', 'SC-DP', 'DocOper2026!');
t('both signed in', !!officeTok);

// A fillable stand-in for the W-4.
const pdf = await (async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Form W-4 (stand-in)', { x: 40, y: 740, size: 14, font });
  const form = doc.getForm();
  const nm = form.createTextField('f1_01'); nm.addToPage(page, { x: 40, y: 690, width: 300, height: 20 });
  nm.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(a). First name and last name'));
  const st = form.createRadioGroup('c1_1');
  st.addOptionToPage('Single', page, { x: 40, y: 640, width: 14, height: 14 });
  st.addOptionToPage('Head of household', page, { x: 40, y: 620, width: 14, height: 14 });
  st.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(c). Filing status'));
  return Buffer.from(await doc.save());
})();
{
  const fd = new FormData();
  fd.append('title', 'Form W-4 2026'); fd.append('kind', 'w4'); fd.append('instructions', 'Update your withholding for 2026.');
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'w4.pdf');
  const tpl = await (await fetch(`${URL}/api/employee-documents/templates`, { method: 'POST', headers: { Authorization: `Bearer ${officeTok}` }, body: fd })).json();
  t('the office has a template with two boxes to fill', tpl?.field_count === 2, JSON.stringify(tpl || {}).slice(0, 120));
  const sent = await (await post('/employee-documents/send', { template_id: tpl.id, user_ids: ['edui-emp'], due_date: '2026-09-30' }, officeTok)).json();
  t('and has sent it to the operator', sent?.requests?.length === 1);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

console.log('\n── the operator, on a phone ──');
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await m.goto(URL);
await m.fill('input[placeholder*="name" i], input[name=name]', 'Doc Operator').catch(() => {});
await m.fill('input[type=password]', 'DocOper2026!');
await m.keyboard.press('Enter');
// The sidebar copy is in the drawer and hidden at this width; what must be
// visible is the one on the page itself.
const card = m.locator('[data-documents-to-sign]:visible');
await card.first().waitFor({ timeout: 20000 });
t('THE CARD IS ON THEIR SCREEN WITHOUT THEM LOOKING FOR IT — no drawer to open', await card.count() === 1);
t('it names the document and who sent it', /Form W-4 2026/.test(await card.innerText()) && /Doc Office/.test(await card.innerText()));
await card.locator('[data-sign-open]').first().click();
await m.waitForSelector('[data-sign-modal]', { timeout: 15000 });
t('tapping it opens the document', await m.locator('[data-sign-modal]').count() === 1);
t('the office\'s instructions are on it', /Update your withholding/.test(await m.locator('[data-sign-modal]').innerText()));
t("THE FORM'S OWN BOXES ARE THERE, labelled from the PDF", await m.locator('[data-sign-fields]').count() === 1
  && /Step 1\(a\)/.test(await m.locator('[data-sign-fields]').innerText())
  && /Step 1\(c\)/.test(await m.locator('[data-sign-fields]').innerText()));
{
  const over = await m.evaluate(() => {
    const vw = window.innerWidth; const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      // Only the RIGHT edge: the mobile drawer is parked off-screen to the
      // left on purpose and pans nothing.
      if (!r.width || r.right <= vw + 1) continue;
      let p = el.parentElement, scroller = false;
      while (p) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') { scroller = true; break; } p = p.parentElement; }
      if (!scroller) out.push(`${el.tagName}.${String(el.className || '').slice(0, 70)} [${Math.round(r.left)}→${Math.round(r.right)}]`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, vw, out: out.slice(0, 6) };
  });
  t('and nothing on it runs off the side of the phone', over.scrollWidth <= over.vw && over.out.length === 0, JSON.stringify(over));
}

await m.locator('[data-sign-field="f1_01"] input').fill('Doc Operator');
await m.locator('[data-sign-field="c1_1"] button', { hasText: 'Head of household' }).click();
t('Sign is held while the signature is missing', await m.locator('[data-sign-submit]').isDisabled());

// Draw on the canvas with a real pointer — the export is what gets embedded.
{
  // The pad is below the fold in a phone-height modal; a pointer aimed past
  // the viewport lands on nothing.
  await m.locator('[data-sign-modal] canvas').scrollIntoViewIfNeeded();
  const box = await m.locator('[data-sign-modal] canvas').boundingBox();
  await m.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await m.mouse.down();
  for (let i = 1; i <= 12; i++) await m.mouse.move(box.x + 30 + i * 12, box.y + box.height * (0.6 - 0.25 * Math.sin(i / 2)));
  await m.mouse.up();
  await m.locator('[data-sign-modal] button', { hasText: 'Save signature' }).click();
  await m.waitForSelector('[data-sign-drawn]', { timeout: 10000 });
  t('the drawn signature is shown back before signing', await m.locator('[data-sign-drawn] img').count() === 1);
}
await m.locator('[data-sign-name]').fill('Doc Operator');
await m.locator('[data-sign-attest]').check();
t('the statement they are signing under is on the screen, not behind a link', /electronic signature/i.test(await m.locator('[data-sign-modal]').innerText()));
t('Sign is offered once everything is there', !(await m.locator('[data-sign-submit]').isDisabled()));
await m.locator('[data-sign-submit]').click();
await m.waitForSelector('input[type=password]', { timeout: 15000 });
t('IT ASKS FOR THE PASSWORD BEFORE ANYTHING IS SIGNED', await m.locator('[data-sign-done]').count() === 0);
await m.fill('input[type=password]', 'DocOper2026!');
await m.keyboard.press('Enter');
await m.waitForSelector('[data-sign-done]', { timeout: 20000 });
t('it signs, and says so', /Signed/.test(await m.locator('[data-sign-done]').innerText()));
await m.locator('[data-sign-close]').click();
await m.waitForTimeout(1200);
t('AND THE CARD IS GONE — it stayed until it was signed, and not after',
  await m.locator('[data-documents-to-sign]:visible').count() === 0);

console.log('\n── the office, at a desk ──');
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(URL);
await page.fill('input[placeholder*="name" i], input[name=name]', 'Doc Office').catch(() => {});
await page.fill('input[type=password]', 'DocOffice2026!');
await page.keyboard.press('Enter');
await page.waitForSelector('nav', { timeout: 20000 });

await page.goto(`${URL}/?tab=onboarding&view=documents`);
await page.waitForSelector('[data-employee-documents]', { timeout: 20000 });
t('Onboarding has an Employee documents tab', await page.locator('[data-employee-documents]').count() === 1);
const listText = await page.locator('[data-employee-documents]').innerText();
t('the signed document is on it, against the person who signed it', /Doc Operator/.test(listText) && /Form W-4 2026/.test(listText));
t('and it reads as signed', await page.locator('[data-doc-status="signed"]').count() === 1);
await page.locator('[data-doc-row] button').first().click();
const row = page.locator('[data-doc-row]').first();
await page.waitForTimeout(400);
t('opening it names the signature and that the password was confirmed',
  /Signed as/.test(await row.innerText()) && /password confirmed/i.test(await row.innerText()), (await row.innerText()).slice(0, 200));
t('and offers the signed PDF', await row.locator('[data-doc-download]').count() === 1);

console.log('\n── Accounting opens on AP Drop ──');
await page.goto(`${URL}/?tab=accounting`);
await page.waitForSelector('[role=tablist]', { timeout: 20000 });
const strip = await page.locator('[role=tablist]').first().innerText();
t('AP Drop is the first tab of the Accounting hub', /AP Drop/.test(strip) && strip.trim().startsWith('AP Drop'), strip.replace(/\n/g, ' | '));
t('and it is the tab that is open', await page.locator('[role=tab][aria-selected=true]').first().innerText() === 'AP Drop',
  await page.locator('[role=tab][aria-selected=true]').first().innerText());
t('Partner Reconciliation and Reimbursements are still there beside it', /Partner Reconciliation/.test(strip) && /Reimbursements/.test(strip));
const nav = await page.locator('nav').first().innerText();
t('AP DROP IS NO LONGER A SECOND SIDEBAR ENTRY', !/AP Drop/.test(nav) && /Accounting/.test(nav));

await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
