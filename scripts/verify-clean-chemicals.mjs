// A clean names its chemical (D-349) — executed against a live server.
//
// Maria: "For the Sanitation tasks, Zuleika should be entering the type of
// chemical she is using per each area. She does not have the option." The
// Sanitation form a person fills by hand asks; the task card did not, so every
// clean finished from a task filed `chemicals_used` NULL.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5219;
const DBP = process.env.DBPATH;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const w = (fn) => { const d = new Database(DBP); try { return fn(d); } finally { d.close(); } };

w(d => {
  d.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('cc-op','Zelda Clean','Zelda Clean','operator','cleaning',1,'SC-cc-op',datetime('now','+7 day'),NULL)`).run();
  d.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,status,asset_kind,loto_required,is_food_contact)
    VALUES ('cc-eq','Warehouse & Grounds (test)','Cleaning Zone','active','zone',0,0)`).run();
  const wo = d.prepare(`INSERT OR REPLACE INTO work_orders (id,equipment_id,title,status,task_group,due_date,assigned_to,procedure_steps)
    VALUES (?, 'cc-eq', ?, 'open','cleaning', date('now','-1 day'), 'Zelda Clean', '[]')`);
  wo.run('cc-1', 'Warehouse & Grounds Daily Cleaning');
  wo.run('cc-2', 'Warehouse & Grounds Daily Cleaning');
  wo.run('cc-3', 'Restroom Daily Cleaning');
  wo.run('cc-4', 'Warehouse & Grounds Daily Cleaning');
  wo.run('cc-ui', 'Breakroom/Lobby/Office Daily Cleaning');
  wo.run('cc-batch', 'Restroom Daily Cleaning');
  // The negative control: a QA inspection files a record but owes no chemical.
  wo.run('cc-bpg', 'Brittle Plastic & Glass Inspection — Gown Room');
});
const chem = (name) => one('SELECT id, name FROM approved_chemicals WHERE name = ? AND is_active = 1', name);
const lysol = chem('Lysol Power Clean');
const simple = chem('Simple Green');
const lube = one("SELECT id FROM approved_chemicals WHERE category = 'lubricant' AND is_active = 1");

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
await call('POST', '/users/set-password', { user_id: 'cc-op', password: 'ZeldaClean2026!', setup_code: 'SC-cc-op' });
const OP = (await call('POST', '/users/login', { name: 'Zelda Clean', password: 'ZeldaClean2026!' })).json?.token;
t('a cleaner with nothing but the default Operator View signs in', !!OP);
const record = (id) => one('SELECT * FROM sanitation_records WHERE notes LIKE ? ORDER BY rowid DESC LIMIT 1', `%Filed from task ${id}%`);
const complete = (id, body) => call('POST', `/pm/work-orders/${id}/complete-and-recur`, body, OP);

console.log('\n── the task says it owes a chemical ──');
let r = await call('GET', '/pm/operator-tasks?limit=500', null, OP);
const card = (id) => (r.json || []).find(x => x.id === id);
t('the warehouse clean carries chemical_plan, naming its area', card('cc-1')?.chemical_plan?.area === 'Warehouse & Grounds', JSON.stringify(card('cc-1')?.chemical_plan));
t('the restroom clean carries one too', !!card('cc-3')?.chemical_plan);
t('a QA inspection does not', !card('cc-bpg')?.chemical_plan);
r = await call('GET', '/pm/cleaning-chemicals', null, OP);
t('the cleaner can read the approved cleaning chemicals on the floor grant alone', r.status === 200 && r.json?.some(c => c.name === 'Lysol Power Clean'), `${r.status}`);
t('…each with where it is approved for use', r.json?.find(c => c.name === 'Lysol Power Clean')?.location_for_use?.includes('warehouse'));
t('…and no lubricants or hand soap', !r.json?.some(c => c.id === lube?.id) && !r.json?.some(c => /soap/i.test(c.name)));

console.log('\n── completing ──');
r = await complete('cc-1', { notes: '' });
t('a clean completed with no answer is refused', r.status === 400 && r.json?.chemical_required, `${r.status} ${r.json?.error}`);
t('…saying what to do', /chemical/i.test(r.json?.error || '') && /Warehouse & Grounds/.test(r.json?.error || ''), r.json?.error);
t('…and nothing was filed', !record('cc-1') && one("SELECT status FROM work_orders WHERE id='cc-1'")?.status !== 'completed');
r = await complete('cc-1', { cleaning_chemicals: { ids: ['not-a-chemical'] } });
t('an id that is not an approved chemical is refused', r.status === 400);
r = await complete('cc-1', { cleaning_chemicals: { ids: [lysol.id, simple.id] }, notes: 'floors' });
t('two chemicals from the list are accepted', r.status === 200, `${r.status} ${r.json?.error}`);
let rec = record('cc-1');
t('THE RECORD NAMES THEM', rec?.chemicals_used === 'Lysol Power Clean, Simple Green', rec?.chemicals_used);
t('…linked to the first on the approved list', rec?.chemical_id === lysol.id);
t('…on the Sanitation list, under its area', rec?.record_group === 'sanitation' && rec?.area === 'Warehouse & Grounds', `${rec?.record_group} ${rec?.area}`);
r = await complete('cc-2', { cleaning_chemicals: { ids: [], other: 'Pine-Sol' } });
rec = record('cc-2');
t('one not on the list is typed and kept as typed', r.status === 200 && rec?.chemicals_used === 'Pine-Sol' && !rec?.chemical_id, rec?.chemicals_used);
r = await complete('cc-3', { cleaning_chemicals: { none: true } });
rec = record('cc-3');
t('"No chemical used" is an answer', r.status === 200, `${r.status} ${r.json?.error}`);
t('…and the record says so in words', !rec?.chemicals_used && /No chemical used/.test(rec?.notes || ''), rec?.notes);
r = await complete('cc-bpg', { reading_result: 'pass' });
t('a QA inspection still completes without one', r.status === 200, `${r.status} ${r.json?.error}`);
r = await call('POST', '/pm/work-orders/batch-complete', { ids: ['cc-batch'] }, OP);
t('a clean is not batch-completed — it is named in skipped', (r.json?.skipped || []).some(s => s.id === 'cc-batch' && /chemical/i.test(s.reason)), JSON.stringify(r.json).slice(0, 200));

console.log('\n── on the Operator View at 390px ──');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  const me = (await call('GET', '/users/me', null, OP)).json;
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [OP, me]);
  await page.goto(`${URL}/operator`);
  await page.waitForTimeout(3500);
  const c = page.locator('[data-task-card="cc-ui"]');
  const there = await c.count() > 0;
  t('the breakroom clean is on her screen', there);
  if (there) {
    await c.scrollIntoViewIfNeeded().catch(() => {});
    await c.locator('[data-complete-task]').click().catch(() => {});
    await page.waitForTimeout(800);
  }
  t('THE CHEMICAL BOX IS ON THE CARD — the reported gap', there && await c.locator('[data-chemical-block]').count() > 0);
  const done = c.locator('button', { hasText: /Mark Complete|Marcar Completa/ }).first();
  t('Mark Complete waits for an answer', there && await done.isDisabled().catch(() => false));
  if (there) {
    await c.locator('[data-chemical-select]').selectOption({ label: 'Lysol Power Clean' }).catch(() => {});
    await page.waitForTimeout(300);
  }
  t('the picked chemical shows where it is approved for use',
    there && /Bathrooms and warehouse/.test(await c.locator('[data-chemical-picked]').innerText().catch(() => '')));
  t('…and Mark Complete lights up', there && !(await done.isDisabled().catch(() => true)));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  t('nothing pans the page sideways at 390px', !wide);
  if (there) { await done.click().catch(() => {}); await page.waitForTimeout(1500); }
  rec = record('cc-ui');
  t('completing it from the card files the chemical on the record', rec?.chemicals_used === 'Lysol Power Clean', rec?.chemicals_used);
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
