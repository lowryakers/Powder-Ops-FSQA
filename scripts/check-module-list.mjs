// check:modulelist — every module a person can be given has a box in Settings.
//
// Found 29 Oct 2026: Suppliers, Onboarding and Visitors had always needed a
// module grant (the server mounts them behind requireModuleWrite, and
// Onboarding's own door asks for the grant by name) and Settings → Users had
// never listed them, so nobody but an admin could ever be given them.
//
// Two checks, both read from source (App.jsx is JSX, so it is read as text):
//   1. every sidebar item that is opened by its own grant — no `visible` rule,
//      not admin-only, not a hub of other modules — is in MODULE_GROUPS;
//   2. every module id a server mount asks for (requireModuleWrite in
//      server.js) is in MODULE_GROUPS, unless it is listed below with why not.
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

// Server modules that are deliberately not a box in Settings, and why.
const NOT_A_BOX = {
  'supply-orders': 'admin-only screen; non-admins use the Supply Order request form (supply-requests)',
  'time-tracking': 'admin-only screen; non-admins use the Time Tracking request form (time-requests)',
  banking: 'Banking tab hidden since D-075',
};

// Sidebar items opened by something other than one box of their own.
const NAV_NOT_A_BOX = {
  'office-requests': 'opened by the two request-form boxes (supply-requests, time-requests) or by being a supervisor',
};

const app = readFileSync('src/App.jsx', 'utf8');
const navStart = app.indexOf('const NAV_GROUPS');
const nav = app.slice(navStart, app.indexOf('\n];', navStart));
// One item per `{ id: '…'` up to the next item; a multi-line item keeps its `visible:` line.
const chunks = nav.split(/(?=\{ id: ')/).slice(1);
const items = chunks.map(c => ({
  id: c.match(/^\{ id: '([^']+)'/)[1],
  gated: /\b(visible|adminOnly|anyOf|roles|aiOnly)\s*:/.test(c.split(/\n\s*\{ id:|\n\s*\],/)[0]),
}));

const us = readFileSync('src/components/settings/UsersSection.jsx', 'utf8');
const mgStart = us.indexOf('const MODULE_GROUPS');
const boxes = new Set([...us.slice(mgStart, us.indexOf('\n];', mgStart)).matchAll(/\{ id: '([^']+)'/g)].map(m => m[1]));

console.log('── sidebar items opened by their own grant ──');
const own = items.filter(i => !i.gated);
t(`found the sidebar (${items.length} items, ${own.length} opened by a grant)`, items.length > 40 && own.length > 30);
for (const i of own) {
  if (NAV_NOT_A_BOX[i.id]) { t(`"${i.id}" is deliberately not a box (${NAV_NOT_A_BOX[i.id]})`, true); continue; }
  t(`"${i.id}" has a box in Settings → Users`, boxes.has(i.id));
}

console.log('── modules the server asks for ──');
const srv = readFileSync('server.js', 'utf8');
const asked = new Set();
for (const m of srv.matchAll(/requireModuleWrite\(([^)]*)\)/g)) {
  for (const id of m[1].matchAll(/'([a-z0-9-]+)'/g)) asked.add(id[1]);
}
t(`found the server mounts (${asked.size} module ids)`, asked.size > 30);
for (const id of [...asked].sort()) {
  if (NOT_A_BOX[id]) { t(`"${id}" is deliberately not a box (${NOT_A_BOX[id]})`, true); continue; }
  t(`"${id}" (asked for by the server) has a box in Settings → Users`, boxes.has(id));
}
for (const id of Object.keys(NOT_A_BOX)) t(`the "${id}" exception still names a real mount`, asked.has(id) || items.some(i => i.id === id));

console.log('── Settings follows the sidebar, group by group (D-305) ──');
// The sidebar's groups, in order, each with its item ids in order.
const navGroups = nav.split(/\n  \{\n(?:\s*\/\/.*\n)*\s*label: /).slice(1).map(g => ({
  label: g.match(/^'([^']+)'/)[1],
  ids: [...g.matchAll(/\{ id: '([^']+)'/g)].map(m => m[1]),
}));
// Settings' groups, each reduced to the sidebar entries it names, in order:
// a heading's `nav`, a rule line, an admin line, or a box whose id is a
// sidebar item. Extra boxes (a form, a tab, a bot grant) sit between them.
const mgText = us.slice(mgStart, us.indexOf('\n];', mgStart));
const setGroups = mgText.split(/\n  \{\n\s*label: /).slice(1).map(g => {
  const label = g.match(/^'([^']+)'/)[1];
  const anchors = [];
  for (const m of g.matchAll(/\{ (?:heading: '[^']*', nav|rule|admin|id): '([^']+)'/g)) {
    if (anchors[anchors.length - 1] !== m[1]) anchors.push(m[1]);
  }
  return { label, anchors };
});
t(`found the sidebar's groups (${navGroups.length})`, navGroups.length >= 10);
t('Settings lists the same groups in the same order as the sidebar',
  JSON.stringify(setGroups.map(g => g.label)) === JSON.stringify(navGroups.map(g => g.label)),
  `sidebar: ${navGroups.map(g => g.label).join(', ')} · Settings: ${setGroups.map(g => g.label).join(', ')}`);
for (const ng of navGroups) {
  const sg = setGroups.find(g => g.label === ng.label);
  const named = (sg?.anchors || []).filter(id => ng.ids.includes(id));
  t(`"${ng.label}": every sidebar entry is in Settings, in sidebar order`,
    JSON.stringify(named) === JSON.stringify(ng.ids),
    `sidebar: ${ng.ids.join(', ')} · Settings: ${named.join(', ')}`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
