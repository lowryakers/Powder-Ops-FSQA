// Executed, not asserted: the packaging / food-contact letter of guarantee
// (D-289). Who owes one (packaging, or a person's food-contact tick, while we buy
// from the supplier), filing it with its renewal date through the S3 stand-in,
// the refusal without a date, the states (missing / no date / expired / renews
// soon / current), setting a date on a letter already on file, the register's
// count, the QA bell line, and the supplier screen in a real browser. Needs a
// built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5170;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('log-qa', 'Quinn Guarantee', 'supervisor', 'qa', '{"suppliers":"edit"}');
  mk('log-pur', 'Pat Purchasing', 'operator', 'purchasing', '{"suppliers":"edit"}');
  mk('log-op', 'Otto Viewer', 'operator', 'warehouse', '{"suppliers":"view"}');
  const s = db.prepare('INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES (?,?,?,?)');
  s.run('g-film', 'Guarantee Film Co', 'packaging', 1);      // owes one, has none
  s.run('g-gloves', 'Glove Supply', 'ingredient', 1);        // owes one only once ticked
  s.run('g-old', 'Old Pouch Co', 'packaging', 0);            // not buying: owes nothing
  s.run('g-dated', 'Dated Bags Co', 'packaging', 1);
  s.run('g-soon', 'Soon Liners', 'packaging', 1);
  s.run('g-undated', 'Undated Wrap', 'packaging', 1);
  const f = db.prepare('INSERT OR REPLACE INTO supplier_files (id, supplier_id, kind, expires_on, filename) VALUES (?,?,?,?,?)');
  f.run('lf-expired', 'g-dated', 'letter_of_guarantee', '2020-01-31', 'Dated Bags LOG 2019.pdf');
  f.run('lf-soon', 'g-soon', 'letter_of_guarantee', day(10), 'Soon Liners LOG.pdf');
  f.run('lf-undated', 'g-undated', 'letter_of_guarantee', null, 'Undated Wrap Continuing Guarantee.pdf');
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const qaTok = await login('log-qa', 'Quinn Guarantee', 'QuinnSecret2026');
const purTok = await login('log-pur', 'Pat Purchasing', 'PatSecret2026');
const opTok = await login('log-op', 'Otto Viewer', 'OttoSecret2026');
t('Quality, Purchasing and a viewer signed in', !!qaTok && !!purTok && !!opTok);

const reg = async () => { token = qaTok; return J(await req('/suppliers')); };
const g = (list, id) => list.suppliers.find(s => s.id === id)?.guarantee;

console.log('\n── who owes one, and the states ──');
let r = await reg();
t('a packaging supplier we buy from with no letter: missing, a gap', g(r, 'g-film')?.required && g(r, 'g-film').status === 'missing' && g(r, 'g-film').gap);
t('a non-packaging supplier: not required', g(r, 'g-gloves')?.required === false);
t('a packaging supplier we no longer buy from: not required', g(r, 'g-old')?.required === false);
t('an expired letter is a gap', g(r, 'g-dated')?.status === 'expired' && g(r, 'g-dated').gap);
t('a letter renewing within 30 days is a warning, not a gap', g(r, 'g-soon')?.status === 'due_soon' && !g(r, 'g-soon').gap);
t('a letter with no renewal date is a gap', g(r, 'g-undated')?.status === 'no_renewal_date' && g(r, 'g-undated').gap);
const gaps0 = r.summary.guarantee_gaps;
t('the register counts the gaps (missing, expired, no date)', gaps0 === 3, `${gaps0}`);

console.log('\n── a person marks a supplier food-contact ──');
token = opTok;
let res = await req('/suppliers/g-gloves', { method: 'PUT', body: JSON.stringify({ food_contact: true }) });
t('a viewer cannot', res.status === 403, `${res.status}`);
token = purTok;
res = await req('/suppliers/g-gloves', { method: 'PUT', body: JSON.stringify({ food_contact: true }) });
r = await reg();
t('Purchasing ticks gloves as food-contact: now owes a letter', res.status === 200 && g(r, 'g-gloves')?.required && g(r, 'g-gloves').status === 'missing');
t('…and the count moves by one', r.summary.guarantee_gaps === gaps0 + 1);

console.log('\n── filing the letter with its renewal date ──');
const pdf = () => new Blob([Buffer.from('%PDF-1.4\n% letter of guarantee\n')], { type: 'application/pdf' });
token = purTok;
let fd = new FormData(); fd.append('files', pdf(), 'Guarantee Film Letter of Guarantee.pdf'); fd.append('kind', 'letter_of_guarantee');
res = await up('/suppliers/g-film/files', fd);
t('a letter of guarantee with no renewal date is refused', res.status === 400 && (await J(res))?.code === 'RENEWAL_REQUIRED', `${res.status}`);
fd = new FormData(); fd.append('files', pdf(), 'Guarantee Film Letter of Guarantee.pdf');
res = await up('/suppliers/g-film/files', fd);
t('…including when its kind is read from the filename', res.status === 400, `${res.status}`);
fd = new FormData(); fd.append('files', pdf(), 'Guarantee Film Letter of Guarantee.pdf'); fd.append('kind', 'letter_of_guarantee'); fd.append('expires_on', '31/12/2027');
res = await up('/suppliers/g-film/files', fd);
t('a renewal date that is not a date is refused', res.status === 400);
fd = new FormData(); fd.append('files', pdf(), 'Guarantee Film Letter of Guarantee.pdf'); fd.append('kind', 'letter_of_guarantee'); fd.append('expires_on', day(400));
res = await up('/suppliers/g-film/files', fd);
const saved = await J(res);
r = await reg();
t('filed with its renewal date: current', res.status === 200 && saved?.saved?.length === 1 && g(r, 'g-film')?.status === 'current'
  && g(r, 'g-film').renews_on === day(400), JSON.stringify(g(r, 'g-film')));
token = qaTok;
const detail = await J(await req('/suppliers/g-film'));
t('the supplier record carries the letter and its state', detail?.guarantee?.status === 'current' && detail.guarantee.file?.filename === 'Guarantee Film Letter of Guarantee.pdf');
const audit = await J(await req('/audit?entity_type=supplier&limit=50'));
const rows = audit?.data || [];
t('the filing is audited with the kind and the renewal date', Array.isArray(rows) && rows.some(a => JSON.stringify(a).includes('letter_of_guarantee') && JSON.stringify(a).includes(day(400))));
fd = new FormData(); fd.append('files', pdf(), 'Dated Bags spec sheet.pdf');
token = purTok;
res = await up('/suppliers/g-dated/files', fd);
t('an ordinary document still needs no date', res.status === 200);

console.log('\n── a renewal date on a letter already on file ──');
token = opTok;
res = await req('/suppliers/files/lf-undated/renewal', { method: 'PUT', body: JSON.stringify({ expires_on: day(200) }) });
t('a viewer cannot set it', res.status === 403);
token = purTok;
res = await req('/suppliers/files/lf-undated/renewal', { method: 'PUT', body: JSON.stringify({ expires_on: 'soon' }) });
t('a date that is not a date is refused', res.status === 400);
const other = (await J(await req('/suppliers/g-dated'))).files.find(f => f.kind !== 'letter_of_guarantee');
res = await req(`/suppliers/files/${other.id}/renewal`, { method: 'PUT', body: JSON.stringify({ expires_on: day(200) }) });
t('only a letter of guarantee takes a typed renewal date', res.status === 400);
res = await req('/suppliers/files/lf-undated/renewal', { method: 'PUT', body: JSON.stringify({ expires_on: day(200) }) });
r = await reg();
t('set: the letter is current', res.status === 200 && g(r, 'g-undated')?.status === 'current');

console.log('\n── the QA bell ──');
const bell = async (tok) => { token = tok; const n = await J(await req('/compliance/notifications')); return (n?.items || []).find(i => i.id === 'guarantee-missing'); };
const qaBell = await bell(qaTok);
r = await reg();
t('Quality is told how many suppliers have no current letter', qaBell?.count === r.summary.guarantee_gaps && qaBell.tab === 'suppliers', JSON.stringify(qaBell));
t('Purchasing is told too', (await bell(purTok))?.count === r.summary.guarantee_gaps);
t('the warehouse is not', !(await bell(opTok)));

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  token = purTok;
  const me = await J(await req('/users/me'));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [purTok, me]);
  await page.goto(`${URL}/?tab=suppliers`);
  await page.waitForTimeout(3000);
  if (width === 1280) {
    t('the register shows a Letter of guarantee column with the missing ones', await page.locator('[data-guarantee="missing"]').count() >= 1
      && await page.getByText('No current letter of guarantee', { exact: true }).count() === 1);
    await page.getByText('No current letter of guarantee', { exact: true }).click();
    await page.waitForTimeout(500);
    t('the count opens the list of suppliers that owe one', await page.locator('[data-guarantee-note]').count() === 1
      && await page.locator('tr', { hasText: 'Glove Supply' }).count() >= 1 && await page.locator('tr', { hasText: 'Soon Liners' }).count() === 0);
    await page.locator('tr', { hasText: 'Glove Supply' }).first().click();
    await page.waitForTimeout(1500);
    t('the supplier shows the letter section, the food-contact tick and the renewal date before attaching',
      await page.locator('[data-guarantee-section="missing"]:visible').count() === 1 && await page.locator('[data-food-contact]:visible').isChecked()
      && await page.locator('[data-guarantee-renewal]:visible').count() === 1 && await page.locator('[data-guarantee-attach]:visible').isDisabled());
    await page.locator('[data-guarantee-renewal]:visible').fill(day(300));
    t('…and the attach button wakes once a renewal date is entered', await page.locator('[data-guarantee-attach]:visible').isEnabled());
  } else {
    t('on a phone the register renders and nothing sticks out sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
