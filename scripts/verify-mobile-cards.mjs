// The floor's phones: nothing may stick past the viewport, and a log renders
// as cards where its table used to clip.
//
// `src/index.css` sets body { overflow-x: hidden }, so a wide table without a
// scroller does not pan on a phone — it CLIPS, and the columns past the fold
// (the COA lot-check's Status, the Training Due pill) are unreachable. This
// boots a real server on a fresh database, seeds one record into each log
// this pass touched, opens every screen at 360×740 in a real browser and
// asserts two things per screen: no element outside a deliberate scroller
// extends past the viewport, and the card list is on screen with the table
// hidden. Caller sets PORT + DBPATH.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 4898;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { v4: uuid } = await import('uuid');
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const seeded = {};
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('mc-ui','Mobile Cards','Mobile Cards','admin','qa',1,'SC-MC', datetime('now','+7 day'))`).run();
  const seed = (label, fn) => { try { fn(); seeded[label] = true; } catch (e) { seeded[label] = e.message; } };
  seed('calibration', () => {
    db.prepare(`INSERT INTO calibration_instruments (id, name, type) VALUES ('mc-inst', 'Batching floor scale', 'scale')`).run();
    db.prepare(`INSERT INTO calibration_records (id, instrument_id, calibrated_by, result, reading_before, reading_after, standard_used, next_due)
      VALUES ('mc-cal', 'mc-inst', 'Mobile Cards', 'pass', '24.998', '25.000', 'Cert weight 25 kg', ?)`).run(day(300));
  });
  seed('training', () => {
    const course = db.prepare("SELECT id FROM training_courses WHERE active = 1 ORDER BY code LIMIT 1").get();
    db.prepare(`INSERT INTO training_records (id, employee_name, training_topic, training_date, completion_date, status, course_id, next_due_date, score)
      VALUES ('mc-tr1', 'Maria Servin', 'GMP', ?, ?, 'completed', ?, ?, 95)`).run(day(-360), day(-360), course.id, day(5));
  });
  seed('documents', () => {
    db.prepare(`INSERT INTO sop_documents (id, doc_number, title, category, revision, status, doc_type, owner, review_due)
      VALUES ('mc-sop', 'SOP 360', 'Phone card test procedure', 'quality', 'V2', 'active', 'sop', 'QA', ?)`).run(day(200));
  });
  seed('visitors', () => {
    db.prepare(`INSERT INTO visitors (id, first_name, last_name, email, company) VALUES ('mc-vis', 'Pat', 'Visitor', 'pat@example.com', 'Example Co')`).run();
    db.prepare(`INSERT INTO visitor_visits (id, visitor_id, location) VALUES ('mc-visit', 'mc-vis', 'Front Kiosk')`).run();
  });
  seed('retention', () => {
    db.prepare(`INSERT INTO retention_boxes (id, box_no, destruction_date) VALUES ('mc-box', '99', ?)`).run(day(700));
    db.prepare(`INSERT INTO retention_samples (id, box_id, stage, item_name, lot_number, retain_count, lab_count, collected_date)
      VALUES ('mc-rs', 'mc-box', 'finished_good', 'Whey Blueberry Muffin', 'LOT-360', 3, 2, ?)`).run(today);
  });
  seed('safety', () => {
    db.prepare(`INSERT INTO first_aid_injuries (id, form_revision, employee_name, injury_date, injury_description, explanation, supervisor_name)
      VALUES ('mc-inj', 'V1', 'Sam Operator', ?, 'Left hand, minor cut on film edge', 'Changing a roll without the guard down', 'A Supervisor')`).run(today);
  });
  seed('time', () => {
    db.prepare(`INSERT INTO time_adjustments (id, employee_name, adjustment_type, adjustment_date, message, submitted_by)
      VALUES ('mc-ta', 'Sam Operator', 'absent', ?, 'sick', 'Mobile Cards')`).run(day(-3));
  });
  db.close();
}
for (const [k, v] of Object.entries(seeded)) t(`seeded ${k}`, v === true, String(v));

const api = (p, body) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
await api('/users/login', { name: 'Mobile Cards' });
await api('/users/set-password', { user_id: 'mc-ui', password: 'Cards2026!', setup_code: 'SC-MC' });
const auth = await (await api('/users/login', { name: 'Mobile Cards', password: 'Cards2026!' })).json();
t('signed in', !!auth?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
// Set the session on a same-origin page that is NOT the app: the app's own
// first render fires an unauthenticated request whose 401 clears auth_token
// from localStorage — a race that lands on the sign-in page.
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok);
  localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);

// The review's own test: walk the DOM for anything past the viewport's right
// edge, ignoring what sits inside a deliberate horizontal scroller.
const overflowers = () => page.evaluate(() => {
  const W = window.innerWidth;
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > W + 1 && !inScroller(el)) {
      out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''} right=${Math.round(r.right)}`);
    }
  }
  return { docWide: document.documentElement.scrollWidth > W, out: out.slice(0, 5) };
});
const cardState = () => page.evaluate(() => {
  const lists = [...document.querySelectorAll('[data-record-cards]')].filter(l => l.offsetParent !== null);
  const cards = lists.reduce((n, l) => n + l.querySelectorAll('[data-record-card]').length, 0);
  const visibleTables = [...document.querySelectorAll('table')].filter(tb => tb.offsetParent !== null && !tb.closest('[data-record-cards]')).length;
  return { lists: lists.length, cards, visibleTables };
});

async function screen(name, path, { cards = true, before } = {}) {
  console.log(`\n${name}`);
  await page.goto(`${URL}/${path}`);
  await page.waitForTimeout(2500);
  if (before) await before();
  const o = await overflowers();
  t('nothing sticks past the 360px viewport', !o.docWide && o.out.length === 0, o.out.join(' | ') || (o.docWide ? 'document is wider than the viewport' : ''));
  if (cards) {
    const c = await cardState();
    t('the log renders as cards', c.lists > 0 && c.cards > 0, `${c.lists} list(s), ${c.cards} card(s)`);
    t('and its table is hidden', c.visibleTables === 0, `${c.visibleTables} table(s) still visible`);
  }
}

await screen('Calibration › Records', '?tab=calibration&view=records');
await screen('Training › Retraining Due', '?tab=training&view=due');
await screen('Training › Records', '?tab=training&view=records');
await screen('SOP Registry', '?tab=sops');
await screen('Recurring Schedules', '?tab=pm-schedules');
await screen('Visitors', '?tab=visitors');
await screen('Safety › First Aid Log', '?tab=safety&view=first-aid');
await screen('Time Tracking › Stats', '?tab=time-tracking', {
  // This module keeps its own tab state rather than useModuleTabs, so the
  // deep link lands on the log; the tab is clicked as a person would.
  before: async () => { await page.getByText('Stats', { exact: true }).first().click(); await page.waitForTimeout(1200); },
});
await screen('Retention › lot trace', '?tab=retention-samples', {
  before: async () => {
    const box = page.getByPlaceholder(/Lot number/i).first();
    await box.fill('LOT-360');
    await box.press('Enter');
    await page.waitForTimeout(1200);
  },
});
// Screens whose rows need a live run to exist: the overflow rule still holds.
await screen('COA / Lab Testing (no rows — overflow only)', '?tab=coa', { cards: false });
await screen('Production Log (overflow only)', '?tab=production-log', { cards: false });

await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
