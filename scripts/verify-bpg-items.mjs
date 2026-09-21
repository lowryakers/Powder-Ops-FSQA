// The brittle plastic & glass zone inventories: who owns the numbers.
//
// Reported by Document Control: the quantities on several zones are wrong
// (Quality Area has 4 monitors and 16 windows, not 1 and 8), "I tried to
// modify the document, though I'm still unable to."
//
// Two defects, both of which make a correction look like it never saved:
//   1. THE SEEDER REWROTE ALL SEVENTEEN ZONES ON EVERY BOOT, so anything the
//      plant corrected was silently undone by the next deploy. Every other
//      seeder here is insert-only for exactly this reason.
//   2. THE ITEM CASCADE OMITTED 'missed' — and a monthly inspection past its
//      date is 'missed', which is the ordinary state of a BP&G zone. So the
//      correction reached the schedule and never the card being worked from.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5010;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('bp-qa','Dina Quality','Dina Quality','supervisor','qa',1,'SC-BP',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
await post('/users/login', { name: 'Dina Quality' });
await post('/users/set-password', { user_id: 'bp-qa', password: 'DinaPW2026!', setup_code: 'SC-BP' });
tok = (await J(await post('/users/login', { name: 'Dina Quality', password: 'DinaPW2026!' })))?.token;
t('QA signed in', !!tok);

console.log('\n── every zone on the form is a live inspection ──');
const zones = db.prepare("SELECT id, title, is_active, task_group FROM pm_schedules WHERE title LIKE 'Brittle Plastic%'").all();
t('all seventeen zones on FORM 431-01 are seeded', zones.length === 17, String(zones.length));
t('…every one of them active and routed to QA', zones.every(z => z.is_active === 1 && z.task_group === 'qa'));
const live = (id) => db.prepare("SELECT COUNT(*) c FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')").get(id).c;
t('AND EVERY ONE CARRIES A LIVE CARD — the reported symptom was five zones missing from the inspector’s screen, so the seeded state is asserted zone by zone rather than by a count',
  zones.every(z => live(z.id) === 1), zones.filter(z => live(z.id) !== 1).map(z => z.title).join(', '));

const quality = zones.find(z => /Quality Area/.test(z.title));
const CORRECTED = ['Lights|4|Plastic', 'Exit Signs|2|Plastic', 'Monitors|4|Plastic',
  'Printers|2|Plastic', 'Label Printers|2|Plastic', 'Windows|16|Glass'];

console.log('\n── the correction reaches the card, not just the schedule ──');
// A monthly check past its date is 'missed'. That is not an edge case here —
// it is what housekeeping does to every BP&G card the day after it is due.
db.prepare("UPDATE work_orders SET status = 'missed' WHERE pm_schedule_id = ?").run(quality.id);
const saved = await put(`/pm/schedules/${quality.id}/items`, { items: CORRECTED });
t('QA can correct a zone’s inventory', saved.status === 200, String(saved.status));
const card = db.prepare("SELECT status, procedure_steps FROM work_orders WHERE pm_schedule_id = ?").get(quality.id);
t('A MISSED CARD IS STILL THE CARD SHE IS WORKING FROM — the correction has to reach it, or she counts sixteen windows, saves, and the list in front of her still says eight',
  card.status === 'missed' && /Windows\|16/.test(card.procedure_steps), `${card.status} ${card.procedure_steps}`);
t('and the schedule carries it too, so the next month’s card is right',
  /Monitors\|4/.test(db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(quality.id).p));

console.log('\n── and a redeploy leaves it alone ──');
const { seedGlassPlasticPMSchedules } = await import('../server/cleaning-seed.js');
const { parseItems } = await import('../server/bpg-zones.js');
const { runPmHousekeeping } = await import('../server/api/pm.js');
seedGlassPlasticPMSchedules(db);
const after = db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(quality.id).p;
t('THE SEED NEVER OVERWRITES A CORRECTED INVENTORY — it used to rewrite all seventeen zones on every boot, so the plant’s own counts were undone by the next deploy and the edit read as though it had never saved',
  JSON.parse(after).includes('Windows|16|Glass') && JSON.parse(after).includes('Monitors|4|Plastic'), after);
t('a zone nobody has touched still gets the code’s transcription',
  /Walkie Talkies\|12/.test(db.prepare("SELECT procedure_steps p FROM pm_schedules WHERE title LIKE '%Gown Room'").get().p));
t('and re-running it a second time changes nothing again (idempotent by construction)',
  (() => { seedGlassPlasticPMSchedules(db); return db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(quality.id).p === after; })());

console.log('\n── the team cascade reads the same statuses ──');
// The owner cascade (D-094) already included 'missed'; the team cascade did
// not, so moving a schedule's team routed everything EXCEPT the outstanding
// work — which is the part that most needed to move.
const gown = zones.find(z => /Gown Room/.test(z.title));
db.prepare("UPDATE work_orders SET status = 'missed' WHERE pm_schedule_id = ?").run(gown.id);
await put(`/pm/schedules/${gown.id}`, { task_group: 'cleaning' });
t('MOVING A SCHEDULE’S TEAM REACHES ITS MISSED CARD TOO, or the overdue work stays routed to the team that no longer owns it',
  db.prepare('SELECT task_group g FROM work_orders WHERE pm_schedule_id = ?').get(gown.id).g === 'cleaning',
  db.prepare('SELECT task_group g FROM work_orders WHERE pm_schedule_id = ?').get(gown.id).g);
await put(`/pm/schedules/${gown.id}`, { task_group: 'qa' });

console.log('\n── a zone disappears from the screen for exactly two reasons ──');
// Both are the answer to "those areas did not appear on her end", and both are
// recoverable by a person rather than a deploy — which is why they are
// asserted: the backfill that keeps every schedule carrying a card is joined
// to the equipment row and skips a zone whose AREA has been retired.
const office1 = zones.find(z => /Office 1/.test(z.title));
const eq = db.prepare('SELECT equipment_id FROM pm_schedules WHERE id = ?').get(office1.id).equipment_id;
db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE pm_schedule_id = ?").run(office1.id);
db.prepare("UPDATE equipment SET status = 'out_of_service' WHERE id = ?").run(eq);
runPmHousekeeping(db, { force: true });
t('A ZONE WHOSE AREA IS OUT OF SERVICE NEVER GETS ANOTHER CARD — the orphan backfill joins the equipment row, so retiring an inspection zone in the Equipment registry silently ends its inspections',
  live(office1.id) === 0, String(live(office1.id)));
db.prepare("UPDATE equipment SET status = 'active' WHERE id = ?").run(eq);
runPmHousekeeping(db, { force: true });
t('…and putting the area back brings the inspection back by itself, with no deploy', live(office1.id) === 1, String(live(office1.id)));

db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE pm_schedule_id = ?").run(office1.id);
db.prepare('UPDATE pm_schedules SET is_active = 0 WHERE id = ?').run(office1.id);
runPmHousekeeping(db, { force: true });
t('A PAUSED ZONE likewise stops appearing — the second of the two states worth checking when an area goes quiet', live(office1.id) === 0);

console.log('\n── the zone register: the inventory AND why a zone is not being inspected ──');
// The editor used to live in exactly one place — the BP&G task card in the
// Operator View, which is department-locked to `qa` AND gated on isAdmin — so
// Document Control could not reach it from any screen, and a zone with no card
// had no card to edit, which is precisely the zone being asked about.
const reg = (await J(await req('/bpg/zones'))) || {};
const regZones = reg.zones || [];
t('the register lists every zone', regZones.length === 17, String(regZones.length));
t('…with the corrected inventory on it, not the code’s transcription',
  !!regZones.find(z => z.zone === 'Quality Area')?.items.some(i => i.name === 'Windows' && i.qty === '16'));
t('every card reconciles with the rows under it — the figure and the list come from one walk',
  regZones.length > 0
  && reg.not_inspectable === regZones.filter(z => !z.inspectable).length
  && reg.inspectable === regZones.filter(z => z.inspectable).length
  && reg.total === regZones.length);
const regOffice1 = regZones.find(z => z.zone === 'Office 1');
t('WHEN IT WAS LAST INSPECTED IS READ FROM THE RECORD, not from a completed task — this plant’s BP&G history was imported as records and never as task completions, so reading the work orders alone had every zone saying "never inspected"',
  regZones.filter(z => z.last_inspected_at).length === 16 && regZones.every(z => z.record_area),
  `${regZones.filter(z => z.last_inspected_at).length} of ${regZones.length} dated`);
t('…and the one zone with nothing on file says so rather than borrowing another zone’s date — Warehouse Area (Main) is genuinely absent from the imported history',
  regZones.find(z => z.zone === 'Warehouse Area (Main)')?.last_inspected_at === null);
t('A ZONE WITH NO CARD NAMES THE REASON rather than leaving somebody to hunt through two other screens for it',
  regOffice1 && !regOffice1.inspectable && regOffice1.gap_code === 'paused' && /paused/i.test(regOffice1.gap_reason),
  JSON.stringify(regOffice1?.gap_code));

// The second of the two states, reported as a different sentence because it is
// fixed in a different place.
const office2 = zones.find(z => /Office 2/.test(z.title));
const eq2 = db.prepare('SELECT equipment_id FROM pm_schedules WHERE id = ?').get(office2.id).equipment_id;
db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE pm_schedule_id = ?").run(office2.id);
db.prepare("UPDATE equipment SET status = 'out_of_service' WHERE id = ?").run(eq2);
const reg2 = (await J(await req('/bpg/zones'))) || {};
const regOffice2 = (reg2.zones || []).find(z => z.zone === 'Office 2');
t('…and an area retired in the Equipment registry says SO, naming the registry',
  regOffice2?.gap_code === 'area_out_of_service' && /Equipment registry/.test(regOffice2.gap_reason),
  JSON.stringify(regOffice2?.gap_code));
db.prepare("UPDATE equipment SET status = 'active' WHERE id = ?").run(eq2);

console.log('\n── Document Control can maintain the lists, holding no PM grant ──');
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('bp-dc','Dana Control','Dana Control','supervisor','document_control',1,'SC-DC',datetime('now','+7 day'),'{"sops":"edit","qa-inspections":"view"}')`).run();
await post('/users/set-password', { user_id: 'bp-dc', password: 'DanaPW2026!', setup_code: 'SC-DC' });
const qaTok = tok;
tok = (await J(await post('/users/login', { name: 'Dana Control', password: 'DanaPW2026!' })))?.token;
t('Document Control signs in', !!tok);
const dcPm = await put(`/pm/schedules/${quality.id}/items`, { items: [{ name: 'x', qty: '1', material: 'Glass' }] });
t('THE PM MOUNT REFUSES HER, and that is why this needed its own door — maintaining these inventories is her job and she holds no `pm` grant',
  dcPm.status === 403, String(dcPm.status));
const dcReg = await J(await req('/bpg/zones'));
t('the register answers her', Array.isArray(dcReg?.zones) && dcReg.zones.length === 17);
t('…and tells the screen she may edit', dcReg?.can_edit === true);

// Daniela's own corrections, entered through the door built for her.
const gownZone = (dcReg?.zones || []).find(z => z.zone === 'Gown Room')
  || { schedule_id: gown.id, items: parseItems(db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(gown.id).p) };
db.prepare("UPDATE work_orders SET status = 'missed' WHERE pm_schedule_id = ?").run(gownZone.schedule_id);
const gownItems = gownZone.items.map(i => (i.name === 'Walkie Talkies' ? { ...i, qty: '9' } : i));
const dcSave = await put(`/bpg/zones/${gownZone.schedule_id}/items`, { items: gownItems });
t('she corrects a count', dcSave.status === 200, String(dcSave.status));
t('AND IT REACHES THE MISSED CARD through the same one writer, so the two doors cannot disagree',
  /Walkie Talkies\|9/.test(db.prepare('SELECT procedure_steps p FROM work_orders WHERE pm_schedule_id = ?').get(gownZone.schedule_id).p));

console.log('\n── and the door is no wider than it says ──');
const badPipe = await put(`/bpg/zones/${gownZone.schedule_id}/items`, { items: [{ name: 'Win|dows', qty: '1', material: 'Glass' }] });
t('a pipe inside a value is refused by name, never silently stripped into a fourth column',
  badPipe.status === 400 && /separates the columns/.test((await J(badPipe))?.error || ''), String(badPipe.status));
const notZone = db.prepare("SELECT id FROM pm_schedules WHERE title NOT LIKE 'Brittle Plastic%' LIMIT 1").get();
t('this door edits BP&G zones and nothing else — a maintenance procedure has different owners and is edited where it lives',
  notZone ? (await put(`/bpg/zones/${notZone.id}/items`, { items: [] })).status === 400 : true);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('bp-wh','Wes Ware','Wes Ware','operator','warehouse',1,'SC-WH',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
await post('/users/set-password', { user_id: 'bp-wh', password: 'WesPW2026!', setup_code: 'SC-WH' });
tok = (await J(await post('/users/login', { name: 'Wes Ware', password: 'WesPW2026!' })))?.token;
t('a warehouse operator may READ the register — the inventory is plant reference material',
  (await req('/bpg/zones')).status === 200);
t('…and may NOT change what an inspection covers: adding or removing an item changes the scope of a controlled record, so it is Quality’s or Document Control’s decision, not the floor’s',
  (await put(`/bpg/zones/${gownZone.schedule_id}/items`, { items: [] })).status === 403);
t('…and the refusal tells them what to do instead',
  /Report a miscount/.test((await J(await put(`/bpg/zones/${gownZone.schedule_id}/items`, { items: [] })))?.error || ''));

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('bp-none','Nora None','Nora None','operator','warehouse',1,'SC-NN',datetime('now','+7 day'),NULL)`).run();
await post('/users/set-password', { user_id: 'bp-none', password: 'NoraPW2026!', setup_code: 'SC-NN' });
tok = (await J(await post('/users/login', { name: 'Nora None', password: 'NoraPW2026!' })))?.token;
t('A NOTHING-ASSIGNED ACCOUNT IS STILL REFUSED THE READ — this router skips the mount guard, so it owes that rule itself or "no modules" would answer reads anyway',
  (await req('/bpg/zones')).status === 403);

console.log('\n── the shared writer leaves another team’s procedure alone ──');
tok = qaTok;
const maint = db.prepare("SELECT id, procedure_steps p FROM pm_schedules WHERE procedure_steps IS NOT NULL AND procedure_steps NOT LIKE '%|%' AND procedure_steps NOT LIKE '[]' AND title NOT LIKE 'Brittle Plastic%' LIMIT 1").get();
if (maint) {
  const steps = JSON.parse(maint.p);
  await put(`/pm/schedules/${maint.id}/items`, { items: steps });
  t('A PLAIN STEP PASSES THROUGH VERBATIM — "Check the drive belt" is a maintenance step, and a shared writer that turned it into "Check the drive belt|1|Plastic" would quietly rewrite another team’s procedure',
    db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(maint.id).p === JSON.stringify(steps),
    db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(maint.id).p);
} else {
  t('a plain-step schedule exists to test the passthrough against', false, 'none found in the seed');
}

console.log('\n── in a real browser ──');
const dcTok = (await J(await post('/users/login', { name: 'Dana Control', password: 'DanaPW2026!' })))?.token;
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [dcTok, { id: 'bp-dc', name: 'Dana Control', role: 'supervisor', department: 'document_control', module_access: { sops: 'edit', 'qa-inspections': 'view' } }]);
await page.goto(`${URL}/?tab=qa-inspections&view=zones`);

const tabShown = await page.getByRole('tab', { name: /Zones & items/i }).first()
  .waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
t('QA Inspections carries a Zones & items view', tabShown);

const zoneCard = page.locator('[data-bpg-zone="Quality Area"]');
const rendered = await zoneCard.first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
t('the register renders the zones', rendered);

if (rendered) {
  t('…with the inventory on the card, so the numbers are read where they are corrected',
    /Windows\s*16/.test((await zoneCard.innerText()).replace(/\n/g, ' ')), (await zoneCard.innerText()).replace(/\n/g, ' ').slice(0, 160));

  const office1Card = page.locator('[data-bpg-zone="Office 1"]');
  t('A ZONE NOBODY IS INSPECTING SAYS SO ON ITS FACE, and says why — "those areas did not appear on her end" is answered on the screen instead of by a hunt',
    /Not being inspected/i.test(await office1Card.innerText()) && /paused/i.test(await office1Card.innerText()),
    (await office1Card.innerText()).replace(/\n/g, ' ').slice(0, 160));

  // Daniela's own correction, typed the way she would type it.
  await zoneCard.locator('[data-bpg-edit]').click();
  const rows = zoneCard.locator('[data-bpg-item-name]');
  let idx = -1;
  for (let i = 0; i < await rows.count(); i++) if ((await rows.nth(i).inputValue()) === 'Printers') idx = i;
  t('DOCUMENT CONTROL CAN OPEN THE EDITOR — the only one before this was on the BP&G task card in the Operator View, which is department-locked to QA and gated on isAdmin, so she had no door from any screen',
    idx >= 0, `printer row ${idx}`);
  if (idx >= 0) {
    await zoneCard.locator('[data-bpg-item-qty]').nth(idx).fill('2');
    await zoneCard.locator('[data-bpg-save]').click();
    await page.waitForTimeout(1200);
    t('…and the correction sticks without a reload',
      /Printers\s*2/.test((await zoneCard.innerText()).replace(/\n/g, ' ')), (await zoneCard.innerText()).replace(/\n/g, ' ').slice(0, 160));
    t('…and is on the schedule, which is what next month’s card is built from',
      /Printers\|2/.test(db.prepare("SELECT procedure_steps p FROM pm_schedules WHERE title LIKE '%Quality Area'").get().p));
  }
}

// One tick in Settings reaches the SCREEN; it is not what opens the editor.
await page.goto(`${URL}/?tab=qa-inspections&view=records`);
await page.waitForTimeout(800);
t('…while the RECORDS stay read-only to her — the grant that reaches the screen is not the door that verifies an inspection',
  (await page.getByRole('button', { name: /^Verify$/ }).count()) === 0);

await page.goto(`${URL}/?tab=qa-inspections&view=zones`);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
t('no sideways page scroll at 390px', overflow <= 1, `${overflow}px`);
await browser.close();

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
