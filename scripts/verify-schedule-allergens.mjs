// Executed, not asserted: an MO's allergens and disposable-gown teams on the
// schedule (D-296). The answer is stored ONCE per MO and every step of that MO
// reads it: the Batching cell where it was set, the Filling and Kitting cells
// for the same MO (spelled differently), the team messages ("Allergen: Milk ·
// Disposable gown: YES" for a gowned team, NO for one that is not), and the
// end-of-day form. Unknown allergens/teams are refused by name, a missing MO is
// refused, clearing keeps the row, every change is audited, and the cell editor
// in a real browser at 1280 and 390. Needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5174;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sa-adm','Ada Admin','Ada Admin','admin','admin',1,'SEED-CODE',datetime('now','+7 day'),NULL)`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sa-op','Fia Filler','Fia Filler','operator','filling',1,'SEED-CODE',datetime('now','+7 day'),'{"production-log":"edit"}')`).run();
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const admTok = await login('sa-adm', 'Ada Admin', 'AdaSecret2026');
const opTok = await login('sa-op', 'Fia Filler', 'FiaSecret2026');
t('an admin and a filler signed in', !!admTok && !!opTok);

// Next week's Monday, so nothing seeded collides.
const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
const WEEK = d.toISOString().slice(0, 10);
token = admTok;
const cell = (day, room, room_type, team, mo) => post('/production/schedule',
  { week_start: WEEK, day_of_week: day, room, room_type, team, mo_number: mo, product_name: 'Buttermilk Pancake', mmr_ref: 'MMR-1 rev 1', updated_by: 'Ada Admin' });
t('Batching, Filling and Kitting cells for one MO (spelled three ways)',
  (await cell(0, 'Batching 1', 'batching', 'Batching', 'MO76736')).ok
  && (await cell(1, '6', 'production', 'Filling', '76736')).ok
  && (await cell(2, '15', 'kitting', 'Kitting', 'mo 76736')).ok);

console.log('\n── the record ──');
let r = await put('/production/mo-allergens', { mo_number: '', allergens: ['Milk'] });
t('no MO is refused', r.status === 400 && (await J(r))?.code === 'MO_REQUIRED');
r = await put('/production/mo-allergens', { mo_number: 'MO76736', allergens: ['Gluten'] });
t('an allergen not on the list is refused by name', r.status === 400 && /"Gluten" is not on/.test((await J(r))?.error || ''));
r = await put('/production/mo-allergens', { mo_number: 'MO76736', allergens: ['Milk'], gown_teams: ['Quality'] });
t('a team not on the gown list is refused by name', r.status === 400 && /"Quality"/.test((await J(r))?.error || ''));
r = await put('/production/mo-allergens', { mo_number: 'MO76736', allergens: ['soy', 'Milk', 'Milk'], gown_teams: ['Filling'] });
let rec = await J(r);
t('saved, in list order, de-duplicated', r.ok && JSON.stringify(rec.allergens) === '["Milk","Soy"]' && JSON.stringify(rec.gown_teams) === '["Filling"]', JSON.stringify(rec));
rec = await J(await req('/production/mo-allergens?mo=76736'));
t('read back under another spelling of the MO', rec?.mo_key === '76736' && rec.allergens.includes('Milk'));

console.log('\n── every step reads it ──');
const week = await J(await req(`/production/schedule?week_start=${WEEK}`));
const m = week?.mo_allergens?.['76736'];
t('the week carries one record for all three cells', !!m && week.assignments.filter(a => /76736/.test(a.mo_number)).length === 3);
const { stepLine } = await import('../shared/schedule-allergens.js');
t('Filling is told YES', stepLine(m, 'Filling') === 'Allergen: Milk, Soy · Disposable gown: YES');
t('Batching and Kitting are told NO', stepLine(m, 'Batching').endsWith('Disposable gown: NO') && stepLine(m, 'Kitting').endsWith('Disposable gown: NO'));
t('an MO with nothing recorded prints nothing', stepLine(null, 'Filling') === '');
token = opTok;
rec = await J(await req('/production/mo-allergens?mo=MO76736'));
t('the floor (end-of-day form) can read it', rec?.gown_teams?.includes('Filling'));

console.log('\n── the team messages ──');
token = admTok;
for (const name of ['batching', 'filling-team', 'kitting', 'production_schedule']) await post('/comms/channels', { name });
r = await post('/production/schedule/notify', { kind: 'new', week_start: WEEK });
const posted = (await J(r))?.posted_to || [];
t('publishing posts to the three team channels', ['Batching', 'Filling', 'Kitting'].every(x => posted.includes(x)), JSON.stringify(posted));
const msgFor = (ch) => {
  const db = new Database(process.env.DBPATH, { readonly: true });
  const row = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id
    WHERE c.name = ? ORDER BY m.created_at DESC LIMIT 1`).get(ch);
  db.close();
  return row?.body || '';
};
t("Filling's message says gown YES", /Allergen: Milk, Soy · Disposable gown: YES/.test(msgFor('filling-team')), msgFor('filling-team'));
t("Batching's message says gown NO", /Allergen: Milk, Soy · Disposable gown: NO/.test(msgFor('batching')));
await put('/production/mo-allergens', { mo_number: '76736', allergens: ['Milk', 'Soy'], gown_teams: ['Filling', 'Kitting'] });
r = await post('/production/schedule/notify', { kind: 'updated', week_start: WEEK });
const posted2 = (await J(r))?.posted_to || [];
t('a changed gown answer re-announces only the team it changed for', posted2.length === 1 && posted2[0] === 'Kitting', JSON.stringify(posted2));
t("…and Kitting now hears YES", /Disposable gown: YES/.test(msgFor('kitting')));

console.log('\n── clearing and the audit trail ──');
r = await put('/production/mo-allergens', { mo_number: '76736', allergens: [], gown_teams: [] });
rec = await J(r);
t('clearing keeps the row with empty lists', r.ok && rec.allergens.length === 0 && rec.gown_teams.length === 0);
t('…and the cells print nothing again', stepLine(rec, 'Filling') === '');
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const n = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'mo_allergens' AND entity_id = '76736'`).get().n;
  db.close();
  t('every change is audited (create + 2 updates)', n === 3, String(n));
}
r = await put('/production/mo-allergens', { mo_number: '99999', allergens: [], gown_teams: [] });
t('an empty answer for an MO with no record writes nothing', r.ok && (await J(r)) === null);

console.log('\n── the cell editor, in a browser ──');
const me = { id: 'sa-adm', name: 'Ada Admin', role: 'admin', department: 'admin' };
for (const width of [1280, 390]) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [admTok, me]);
  await page.goto(`${URL}/?tab=production-schedule`);
  // Move to next week.
  await page.waitForTimeout(1500);
  const next = page.locator('button:has(svg.lucide-chevron-right)').locator('visible=true').first();
  if (await next.count()) await next.click();
  await page.waitForTimeout(1000);
  const card = page.locator('text=MO76736').locator('visible=true').first();
  t(`${width}px: the Batching card is on the grid`, await card.count() > 0);
  await card.click();
  await page.waitForSelector('[data-mo-allergen-fields]', { timeout: 5000 }).catch(() => {});
  t(`${width}px: the editor has the two boxes`, await page.locator('[data-mo-allergen-on]').count() === 1 && await page.locator('[data-mo-gown-on]').count() === 1);
  await page.waitForTimeout(500);
  if (width === 1280) {
    await page.locator('[data-mo-allergen-on]').check();
    await page.locator('[data-multipick-toggle="allergens"]').click();
    await page.locator('[data-multipick-list="allergens"] [data-multipick-option="Milk"]').check();
    await page.locator('[data-multipick-list="allergens"] [data-multipick-option="Egg"]').check();
    await page.locator('[data-mo-gown-on]').check();
    await page.locator('[data-multipick-toggle="gown"]').click();
    await page.locator('[data-multipick-list="gown"] [data-multipick-option="Filling"]').check();
    await page.locator('[data-multipick-list="gown"] [data-multipick-option="Kitting"]').check();
    await page.locator('button[type=submit]:has-text("Save")').click();
    await page.waitForTimeout(1200);
    token = admTok;
    rec = await J(await req('/production/mo-allergens?mo=76736'));
    t('1280px: saving the editor stores the MO record', JSON.stringify(rec?.allergens) === '["Milk","Egg"]' && JSON.stringify(rec?.gown_teams) === '["Filling","Kitting"]', JSON.stringify(rec));
    // The phone layout's cards are in the page too (hidden); count what is on screen.
    const chips = await page.locator('[data-mo-allergen-chip]').evaluateAll(els => els.filter(e => e.offsetParent !== null).map(e => e.getAttribute('data-gown')));
    t('1280px: all three steps show a chip — Batching NO, Filling and Kitting YES',
      chips.length === 3 && chips.filter(x => x === 'yes').length === 2 && chips.filter(x => x === 'no').length === 1, JSON.stringify(chips));
  } else {
    t('390px: the editor opens with the saved answer ticked', await page.locator('[data-mo-allergen-on]').isChecked() && await page.locator('[data-mo-gown-on]').isChecked());
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    t('390px: no sideways scroll', !over);
  }
  await browser.close();
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
