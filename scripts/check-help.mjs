// check:help — the Help page cannot quietly go stale (D-397).
//
// A guide that points at a screen that moved, or that nobody has walked in six
// months, is worse than no guide, because people trust it. So:
//   * every "Open it" names a screen that exists (a nav or tab id in App.jsx, a
//     Settings section, a view some screen reads, or a public path);
//   * every guide was checked within MAX_AGE_DAYS and names the team that keeps it;
//   * a guide is 3–7 steps, its title is a question, its Spanish matches step for step;
//   * every "What's new" entry names a decision that exists, newest first.
// HELP_TODAY=YYYY-MM-DD pins "today" for the control run.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { GUIDES, WHATS_NEW, HELP_AUDIENCES } from '../src/data/help.js';
import { RULES } from '../src/lib/platformRules.js';

const MAX_AGE_DAYS = 180;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const app = readFileSync('src/App.jsx', 'utf8');
const navIds = new Set([...app.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map(m => m[1]));
const settings = readFileSync('src/components/compliance/SettingsPanel.jsx', 'utf8');
const sections = new Set([...settings.matchAll(/\bid: '([a-z0-9-]+)'/g)].map(m => m[1]));
const decisions = new Set([...readFileSync('docs/v2/decisions.md', 'utf8').matchAll(/^## (D-\d+)/gm)].map(m => m[1]));

// Every quoted string in the client, to confirm a `view` is one some screen reads.
const srcText = (() => {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(f) && !p.includes('data/help.js')) out.push(readFileSync(p, 'utf8')); } };
  walk('src');
  return out.join('\n');
})();

const today = process.env.HELP_TODAY || new Date().toISOString().slice(0, 10);
const ageDays = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function checkOpen(where, open) {
  if (!open) return;
  if (open.href) { t(`${where}: href is a path`, /^\/[a-z]/.test(open.href), open.href); t(`${where}: ${open.href} is routed`, app.includes(`'${open.href}'`) || app.includes(`"${open.href}"`), open.href); return; }
  t(`${where}: opens a screen that exists`, navIds.has(open.tab), `no nav or tab id '${open.tab}' in App.jsx`);
  if (open.section) t(`${where}: Settings section exists`, sections.has(open.section), `no Settings section '${open.section}'`);
  if (open.view) t(`${where}: view '${open.view}' is read by some screen`, srcText.includes(`'${open.view}'`));
}

console.log('── guides ──');
const ids = new Set();
for (const g of GUIDES) {
  const w = `guide ${g.id}`;
  t(`${w}: id unique`, !ids.has(g.id)); ids.add(g.id);
  t(`${w}: title is a question`, /\?$/.test(g.q), g.q);
  t(`${w}: 3–7 steps`, Array.isArray(g.steps) && g.steps.length >= 3 && g.steps.length <= 7, `${g.steps?.length}`);
  t(`${w}: audience is known`, !!HELP_AUDIENCES[g.for], g.for);
  t(`${w}: names the team that keeps it`, typeof g.owner === 'string' && g.owner.length > 1 && !/lowry/i.test(g.owner), g.owner);
  t(`${w}: checked date`, ISO.test(g.checked || ''), g.checked);
  t(`${w}: checked within ${MAX_AGE_DAYS} days`, ageDays(g.checked) <= MAX_AGE_DAYS && ageDays(g.checked) >= 0, `${g.checked} is ${ageDays(g.checked)} days old — walk the steps on the real screen and update \`checked\``);
  if (g.module) t(`${w}: module is a screen`, navIds.has(g.module), g.module);
  checkOpen(w, g.open);
  if (g.es) {
    t(`${w}: Spanish title is a question`, /\?$/.test(g.es.q), g.es.q);
    t(`${w}: Spanish has the same steps`, g.es.steps?.length === g.steps.length, `${g.es.steps?.length} vs ${g.steps.length}`);
  }
}
t('there are guides', GUIDES.length >= 10, `${GUIDES.length}`);
t('the floor guides carry Spanish', GUIDES.filter(g => g.for === 'floor').every(g => g.es));

console.log("── what's new ──");
let prev = '9999-99-99';
for (const n of WHATS_NEW) {
  const w = `news ${n.d}`;
  t(`${w}: date`, ISO.test(n.date || ''), n.date);
  t(`${w}: newest first`, n.date <= prev, `${n.date} after ${prev}`); prev = n.date;
  t(`${w}: decision exists`, decisions.has(n.d), `${n.d} is not in docs/v2/decisions.md`);
  t(`${w}: title and body`, !!n.title && !!n.body);
  if (n.module) t(`${w}: module is a screen`, navIds.has(n.module), n.module);
  checkOpen(w, n.open);
}

console.log('── why the app does that ──');
for (const [id, r] of Object.entries(RULES)) t(`rule ${id}: title and body`, !!r.title && !!r.body);

console.log('── the page is wired ──');
t('the Suppliers "How this works" card reads its guide', GUIDES.some(g => g.id === 'qualify-a-supplier')
  && readFileSync('src/components/compliance/SupplierGuide.jsx', 'utf8').includes("g.id === 'qualify-a-supplier'"));
t('Help is in the sidebar', /\{ id: 'help', label: 'Help'/.test(app));
t('Help renders', app.includes("resolvedTab === 'help' && <HelpPanel"));
t('the search box finds guides', app.includes('guidesFor(canOpen)'));
t('the floor layout opens Help', app.includes('data-floor-help'));
t("the page ⓘ lists the screen's guides", readFileSync('src/components/PageInfo.jsx', 'utf8').includes('guidesForModule('));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
