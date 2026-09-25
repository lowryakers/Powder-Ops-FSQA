// The recall flow chart, recreated for Powder Ops — and mounted where the
// exercise is actually run.
//
// The chart that prompted this was the PREVIOUS OWNER'S, and it is a RECALL
// flow chart despite its filename: it starts at "Receive Complaint · is there a
// health hazard?" and ends at "Terminate Recall". SOP 415 V3 is "Recall AND
// Mock Recall Procedures" and covers both, so the honest recreation is TWO
// flows — the response, and the annual exercise that rehearses its tracking
// half, which is the one the module records.
//
// Two things are asserted and they are the whole point:
//   1. It describes POWDER OPS. Arete's chart routes through a Director of
//      Operations and an ownership/legal group this plant does not have; every
//      actor here has to be a role that exists on the org chart or in SOP 415's
//      own contact list.
//   2. It is ONE definition with TWO callers — the Auditor View's process maps
//      and the Mock Recall panel. A second renderer is how one process ends up
//      described two slightly different ways on two screens.
//
// Caller sets PORT + DBPATH. Needs a built client.
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { RECALL_CONTACTS, TRACKING_PROCEDURES } from '../server/mock-recall-form.js';
import { FLOWS } from '../src/data/processFlows.js';

const PORT = process.env.PORT || 5022;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n── the map is data, and it describes this plant ──');
// Empty stand-ins so a control run (the flows absent) reports every assertion
// it fails rather than stopping at the first.
const EMPTY = { steps: [] };
const recall = FLOWS.find(f => f.id === 'recall') || EMPTY;
const mock = FLOWS.find(f => f.id === 'mock_recall') || EMPTY;
t('there is a recall flow', recall !== EMPTY);
t('and a mock recall flow beside it — SOP 415 covers both', mock !== EMPTY);
t('every step names an actor, an action and where it is recorded',
  recall.steps.length > 0 && mock.steps.length > 0
  && [...recall.steps, ...mock.steps].every(s => s.actor && s.action && s.form));

// The roles Arete's chart routed through, which Powder Ops does not have.
const FOREIGN = [/director of operations/i, /legal counsel/i, /ownership/i, /\bArete\b/i];
// The MAP's own words, not the file's — the comment above it names the roles
// that were dropped, and should go on saying so.
const allText = JSON.stringify([recall, mock]);
t('NO ROLE FROM THE INHERITED CHART SURVIVED — a re-badged map is the aspiration the process-map header refuses',
  recall.steps.length > 0 && FOREIGN.every(rx => !rx.test(allText)),
  FOREIGN.filter(rx => rx.test(allText)).map(String).join(' '));

// Actors are roles, never people. The names on SOP 415's contact list are the
// people who hold them, and a map that names them needs editing on a job move.
const actors = [...recall.steps, ...mock.steps].map(s => s.actor);
t('actors are roles, never the people holding them',
  RECALL_CONTACTS.every(c => c.name === 'FDA' || !actors.some(a => a.includes(c.name.split(' ')[0]))),
  actors.join(' · '));
// …and the roles it does name are on the SOP's own list or the org chart.
const TITLES = RECALL_CONTACTS.map(c => c.title);
t('the escalation runs through roles SOP 415 actually names (QA Manager, CEO)',
  ['QA Manager', 'CEO'].every(r => actors.includes(r) && (TITLES.includes(r) || r === 'CEO')));

t('the recall step that finds the product points at the SOP’s four tracking procedures, not a fifth invented one',
  recall.steps.some(s => /tracking procedure/i.test(s.form)) && Object.keys(TRACKING_PROCEDURES).length === 4);
t('the FDA number on the map is the one on the controlled contact list',
  recall.steps.some(s => s.form.includes(RECALL_CONTACTS.find(c => c.name === 'FDA').phone)));
t('the no-hazard exit is marked as a branch — collapsing it into the happy path would describe a recall on every complaint',
  recall.steps.some(s => s.branch && /no health hazard/i.test(s.action)));
t('and an exercise that misses a criterion needing an investigation is a branch too',
  mock.steps.some(s => s.branch && /root cause/i.test(s.action)));
t('the mock recall map quotes the SOP’s own three criteria, in its own numbers',
  mock.steps.some(s => /99\.5/.test(s.action) && /four hours/i.test(s.action)));

console.log('\n── one definition, two callers ──');
const panel = readFileSync('src/components/compliance/MockRecallPanel.jsx', 'utf8');
t('the Mock Recall panel IMPORTS the map rather than carrying its own copy',
  /import \{ FlowMaps \} from '\.\/ProcessFlows\.jsx'/.test(panel));
t('and there is no second steps array in the panel', !/actor:/.test(panel));

const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('rf-qa','Rhea Quality','Rhea Quality','admin','qa',1,NULL,'SC-RECALL',datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Rhea Quality' });
await post('/users/set-password', { user_id: 'rf-qa', password: 'Recall2026!', setup_code: 'SC-RECALL' });
const auth = await (await post('/users/login', { name: 'Rhea Quality', password: 'Recall2026!' })).json();
t('signed in', !!auth?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);

console.log('\n── it is on the screen the drill is run from ──');
await page.goto(`${URL}/?tab=recall`);
await page.waitForTimeout(3500);
t('the Mock Recall module opens', /Mock Recall/.test(await page.locator('body').innerText()));
t('THE FLOW CHART IS ON IT — the answer to "where does this fit" is here, not only in the binder',
  await page.locator('[data-flow-maps]').count() === 1);
t('both flows are offered', await page.locator('[data-flow="recall"]').count() === 1
  && await page.locator('[data-flow="mock_recall"]').count() === 1);
t('and it says plainly it is not a controlled drawing, so nobody prints it as one',
  /not a controlled drawing/i.test(await page.locator('body').innerText()));

const hasPanelFlow = await page.locator('[data-flow-toggle="recall"]').count() > 0;
if (hasPanelFlow) { await page.locator('[data-flow-toggle="recall"]').click(); await page.waitForTimeout(500); }
const opened = hasPanelFlow ? await page.locator('[data-flow="recall"]').innerText() : '';
t('opening it walks the recall from the complaint', /customer complaint/i.test(opened));
t('…through the hold on what is still on site', /On Hold record \(424-01\)/.test(opened));
t('…to the FDA and the customers who received it', /1-866-300-4374/.test(opened));
t('…and ends at a terminated recall with a corrective action behind it',
  /CAPA \(408-2\)/.test(opened) && /terminated recall/i.test(opened));
t('the no-hazard exit reads as the exception it is', /only if it happens/i.test(opened));

console.log('\n── the binder has the same map, from the same data ──');
await page.goto(`${URL}/auditor`);
await page.waitForTimeout(3500);
// Chapter 1 carries Process Maps. Its title changes with what the plant is
// presenting on paper, so it is reached by either wording.
await page.locator('text=/How Records Move|Food Safety Documentation/').first().click();
await page.waitForTimeout(1500);
t('the binder\u2019s Process Maps section is open',
  /Process Maps/.test(await page.locator('body').innerText()));
t('Process Maps lists the recall flow', await page.locator('[data-flow="recall"]').count() >= 1);
t('and the mock recall flow', await page.locator('[data-flow="mock_recall"]').count() >= 1);
const inBinder = await page.locator('[data-flow-toggle="recall"]').count() > 0;
if (inBinder) { await page.locator('[data-flow-toggle="recall"]').first().click(); await page.waitForTimeout(500); }
const binder = inBinder ? await page.locator('[data-flow="recall"]').first().innerText() : '';
t('WORD FOR WORD THE SAME STEPS — one definition, so the two screens cannot drift',
  recall.steps.length > 0 && recall.steps.every(s => binder.includes(s.action.slice(0, 40))));

console.log('\n── on a phone ──');
const small = await browser.newPage({ viewport: { width: 390, height: 780 } });
await small.goto(`${URL}/manifest.webmanifest`);
await small.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);
await small.goto(`${URL}/?tab=recall`);
await small.waitForTimeout(3500);
const smallHas = await small.locator('[data-flow-toggle="mock_recall"]').count() > 0;
if (smallHas) { await small.locator('[data-flow-toggle="mock_recall"]').click(); await small.waitForTimeout(500); }
t('the map opens at 390px',
  smallHas && /rehears/i.test(await small.locator('[data-flow="mock_recall"]').innerText()));
const over = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
t('and nothing pans the page sideways', over <= 1, `${over}px over`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
