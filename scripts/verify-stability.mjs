// Stability pulls scheduled against the retention library (CAR 4990683-9),
// live: a study files its pulls; the generator raises tasks for the ones due;
// a pull nobody took reads as missed; completing the task through the
// check-record interface records the pull; a failed result raises one CAR;
// coverage names the products with no shelf-life basis; the readiness review
// reads the same rows; the tab renders it. Caller sets PORT + DBPATH; needs a
// built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4983; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('st-qa','Maria Stab','Maria Stab','supervisor','qa',1,'SC-ST',datetime('now','+7 day'),'{"pm":"edit","retention-samples":"edit","quality-schedules":"edit"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('st-op','Omar Stab','Omar Stab','operator','warehouse',1,'SC-SO',datetime('now','+7 day'),'{"retention-samples":"view"}')`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (name, id, pw, code) => { await call('POST', '/users/login', { name }); await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code }); return (await (await call('POST', '/users/login', { name, password: pw })).json()); };
const qa = await login('Maria Stab', 'st-qa', 'Quality2026!', 'SC-ST');
const op = await login('Omar Stab', 'st-op', 'Operator2026!', 'SC-SO');
const A = qa.token, O = op.token;
t('Quality and an operator signed in', !!A && !!O);
const sqlite = () => new Database(dbPath);
const today = new Date().toISOString().slice(0, 10);
// Real catalogue SKUs — coverage is derived from `products`, so invented codes would never count.
const SKUS = sqlite().prepare("SELECT sku FROM products WHERE status = 'active' ORDER BY sku LIMIT 5").all().map(r => r.sku);
t('the seeded catalogue offers SKUs to cover', SKUS.length === 5);

console.log('\n── the study files its pulls ──');
let r = await call('POST', '/stability', { title: 'Whey stick packs — real time', start_date: '2026-01-15' }, A);
t('a study with no pull points is refused', r.status === 400);
r = await call('POST', '/stability', { title: 'Whey stick packs — real time', product_family: 'Whey stick packs', product_skus: `${SKUS[0]}, ${SKUS[1]}`, lot_number: '101692', condition: 'real_time', condition_detail: '25 °C / 60 % RH', start_date: '2026-01-15', pull_months: '0, 3, 6, 12, 18, 24', tests: 'Micro, aw, organoleptic', retention_sample_id: 'Box 15' }, O);
t('an operator cannot open a study', r.status === 403);
r = await call('POST', '/stability', { title: 'Whey stick packs — real time', product_family: 'Whey stick packs', product_skus: `${SKUS[0]}, ${SKUS[1]}`, lot_number: '101692', condition: 'real_time', condition_detail: '25 °C / 60 % RH', start_date: '2026-01-15', pull_months: '0, 3, 6, 12, 18, 24', tests: 'Micro, aw, organoleptic', retention_sample_id: 'Box 15' }, A);
let j = await r.json(); const study = j.study;
t('the study is created active with six pulls dated from the start', r.status === 201 && study.status === 'active' && study.pulls.length === 6 && study.pulls[1].due_date === '2026-04-15' && study.pulls[5].due_date === '2028-01-15', JSON.stringify(j).slice(0, 200));
t('pulls already past their date read as MISSED, the rest as planned — derived, not stored', study.pulls.filter(p => p.state === 'missed').length === 3 && study.pulls[3].state === 'planned' && sqlite().prepare("SELECT COUNT(*) c FROM stability_pulls WHERE status = 'planned'").get().c === 6);
t('the generator raised a task for each pull that is due or overdue, and none for 2027', study.pulls.slice(0, 3).every(p => p.work_order_id) && !study.pulls[3].work_order_id);
const wo0 = sqlite().prepare('SELECT * FROM work_orders WHERE id = ?').get(study.pulls[0].work_order_id);
t('the task is high priority, in QA, carrying the study and the pull month', wo0.priority === 'high' && wo0.task_group === 'qa' && /0 months/.test(wo0.title) && wo0.stability_pull_id === study.pulls[0].id);
let all = Object.values(await (await call('GET', '/pm/by-frequency?group=qa', null, A)).json()).flat();
const task0 = all.find(w => w.id === wo0.id);
t('the Task Center carries the pull\'s check_form', task0?.check_form?.kind === 'stability_pull' && task0.check_form.pull_month === 0 && task0.check_form.study === study.title);
let list = await (await call('GET', '/stability', null, A)).json();
t('the module counts 3 missed and 0 awaiting a result', list.missed === 3 && list.awaiting_result === 0);

console.log('\n── taking the pull ──');
r = await call('POST', `/pm/work-orders/${wo0.id}/complete-and-recur`, { notes: 'pulled' }, A); j = await r.json();
t('completing without saying what was pulled is refused', r.status === 400 && j.requires_check && j.missing[0].key === 'quantity');
r = await call('POST', `/pm/work-orders/${wo0.id}/complete-and-recur`, { check: { quantity: '2 × 30 g sticks', lab: 'CTLA', sent_on: today } }, A); j = await r.json();
t('with the quantity it completes and the pull reads as pulled', r.status === 200 && j.check_record?.kind === 'stability_pull');
list = await (await call('GET', '/stability', null, A)).json();
let s1 = list.studies[0];
t('the study now shows 2 missed, 1 awaiting a result, pulled by Quality with the laboratory', s1.missed === 2 && s1.awaiting_result === 1 && s1.pulls[0].pulled_by === 'Maria Stab' && s1.pulls[0].lab === 'CTLA');
r = await call('POST', `/stability/pulls/${s1.pulls[1].id}/result`, { result: 'pass', result_summary: 'x' }, A);
t('a result cannot be entered on a pull that was never taken', r.status === 409);
r = await call('POST', `/stability/pulls/${s1.pulls[0].id}/result`, { result: 'pass' }, A);
t('a result without its summary is refused', r.status === 400);
const capasBefore = sqlite().prepare('SELECT COUNT(*) c FROM capas').get().c;
r = await call('POST', `/stability/pulls/${s1.pulls[0].id}/result`, { result: 'fail', result_summary: 'aw 0.72 against ≤ 0.60; TPC within spec' }, A); j = await r.json();
t('a FAIL files the result and raises a CAR', r.status === 200 && j.pull.state === 'resulted' && /^CAPA-\d+$/.test(j.capa?.capa_number || '') && sqlite().prepare('SELECT COUNT(*) c FROM capas').get().c === capasBefore + 1);
t('the CAR names stability as its source', sqlite().prepare("SELECT source_type FROM capas WHERE id = ?").get(j.capa.id).source_type === 'Stability');
r = await call('POST', `/stability/pulls/${s1.pulls[1].id}/skip`, { reason: 'x' }, A);
t('skipping a pull needs a real reason', r.status === 400);
r = await call('POST', `/stability/pulls/${s1.pulls[1].id}/skip`, { reason: 'No retain left in box 15 for the 3-month point' }, A);
t('a skipped pull stops reading as missed and cancels its task', r.status === 200 && sqlite().prepare('SELECT status FROM work_orders WHERE id = ?').get(s1.pulls[1].work_order_id).status === 'cancelled');
list = await (await call('GET', '/stability', null, A)).json();
t('the module now counts 1 missed', list.missed === 1 && list.studies[0].failed === 1);

console.log('\n── what each product\'s date rests on ──');
const before = list.coverage;
t('coverage is derived from the catalogue: two SKUs covered by the study, the rest not', before.covered === 2 && before.uncovered === before.products.length - 2 && before.products.find(p => p.sku === SKUS[0])?.covered === true);
r = await call('POST', '/stability/justifications', { product_skus: SKUS[2], shelf_life_months: 24, basis: 'short' }, A);
t('a justification with no real basis is refused', r.status === 400);
r = await call('POST', '/stability/justifications', { product_family: 'Whey pouches', product_skus: `${SKUS[2]}, ${SKUS[3]}`, shelf_life_months: 24, basis: 'Ingredient supplier stability data (24 months at ambient), aw < 0.4 measured on three lots, foil laminate pouch; to be confirmed by the real-time study.', document_ref: 'QA memo 2026-09', decided_on: '2026-09-09' }, A); j = await r.json();
t('an interim justification files and moves two more products to covered', r.status === 201 && j.coverage.covered === before.covered + 2);
r = await call('POST', '/stability/justifications', { product_skus: SKUS[2], shelf_life_months: 18, basis: 'Shortened to 18 months after the 12-month aw trend; study continues.', decided_on: '2026-09-09' }, A); j = await r.json();
const js = await (await call('GET', '/stability/justifications', null, A)).json();
t('a newer basis speaks for its SKU; the older one still speaks for the rest of the family', j.coverage.covered === before.covered + 2 && js.justifications.length === 2
  && js.justifications[0].shelf_life_months === 18 && js.justifications[0].current_for.join() === SKUS[2]
  && js.justifications[1].current_for.join() === SKUS[3]);
t('the product reads the newer basis', j.coverage.products.find(p => p.sku === SKUS[2])?.justifications?.[0]?.shelf_life_months === 18);
r = await call('POST', '/stability/justifications', { product_skus: 'PP-XX-99', shelf_life_months: 12, basis: 'Study-based justification naming no study should fail.', basis_type: 'study' }, A);
t('a study-based justification must name a real study', r.status === 400);

console.log('\n── the review reads the same rows ──');
const rev = await (await call('GET', '/compliance/readiness-review', null, A)).json();
const ret = rev.sections.find(s => s.title === 'Retention Samples');
t('the readiness review counts the study, the missed pull and the open failure', ret.items.some(i => /1 stability study/.test(i.label)) && ret.items.some(i => /1 stability pull\(s\) missed/.test(i.label)) && ret.items.some(i => /1 failed stability result/.test(i.label)));
t('and the products with no recorded basis', ret.items.some(i => /have no recorded basis for their expiration date/.test(i.label)));
{ const db = sqlite();
  // canonicalAction() folds `*_created` to `create`, so the study's line reads `create`.
  const acts = db.prepare("SELECT action FROM audit_log WHERE entity_type LIKE 'stability_%'").all().map(a => a.action);
  t('study, result, skip and justification are all audited', ['create', 'stability_result_entered', 'stability_pull_skipped', 'stability_justification_filed'].every(a => acts.includes(a)));
  db.close(); }

console.log('\n── in the browser ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, qa.user]);
await page.goto(`${URL}/?tab=retention-samples&view=stability`);
await page.waitForSelector('[data-stability-study]', { timeout: 15000 });
t('the Stability tab opens on the study with its pull states', (await page.locator('[data-pull-state="missed"]').count()) === 1 && (await page.locator('[data-pull-state="resulted"]').count()) === 1 && (await page.locator('[data-pull-state="skipped"]').count()) === 1);
t('the stat cards read the same numbers as the API', (await page.locator('[data-stability-missed]').getAttribute('data-stability-missed')) === '1');
t('the failed result and its CAR are on the card', /FAIL/.test(await page.locator('[data-stability-study]').innerText()));
await page.getByRole('tab', { name: /Stability/ }).click();
t('the tab strip carries the missed count as an alert badge', /Stability/.test(await page.getByRole('tablist').innerText()));
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
