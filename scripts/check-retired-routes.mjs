// The dead finance code and the old checklist API are retired; the live money
// screens are not (D-380, single-spine pack 6 step B).
//
// RETIRED: the AP/AR ledgers (/api/finance), the QuickBooks reader, the Monday
// ledger seed, their three hidden panels, the old checklist module
// (/api/checklists) and four files nothing imported. Their TABLES stay — rows
// already in ap_invoices, ar_invoices, finance_files, qbo_*, checklist_* are
// history, and nothing here drops or deletes them.
//
// KEPT, and asserted: AP Drop, Partner Reconciliation, the weekly payment run,
// and Banking — the payment run reads bank_accounts / bank_transactions (the
// "use the bank feed" balance and the transfer matches, D-363/D-364), and the
// Banking API is the only thing that fills them.
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const RETIRED_FILES = [
  'server/api/finance.js', 'server/finance-seed.js', 'server/quickbooks.js', 'server/seed-data/ap-ar.json',
  'server/api/checklists.js',
  'src/components/office/LedgerPanel.jsx', 'src/components/office/QuickBooksPanel.jsx',
  'src/components/compliance/QuickBooksSetupCard.jsx',
  'src/components/MOLegend.jsx', 'src/utils/moColors.js', 'src/utils/parseSheet.js',
];
const server = src('server.js');

console.log('\n── retired ──');
for (const f of RETIRED_FILES) t(`${f} is gone`, !existsSync(join(ROOT, f)));
t('/api/finance is not mounted', !/app\.use\('\/api\/finance'/.test(server));
// Wording left behind by the retirement (spine gap 05): Settings must not name
// QuickBooks as switched on, and the AI hint must not point at checklist_submissions
// as where task completion lives.
t('Settings → Integrations no longer names QuickBooks', !/QuickBooks|quickbooks|qbo/.test((src('src/components/compliance/SettingsPanel.jsx').match(/id: 'integrations'[\s\S]*?Component: IntegrationsSection/) || [''])[0].replace(/\/\/.*$/gm, '')));
t('the AI schema hint does not list checklist_submissions as a live task table', !/pm_schedules, checklist_submissions/.test(src('server/ai.js')));
t('/api/checklists is not mounted', !/app\.use\('\/api\/checklists'/.test(server));
t('the ledger seed does not run at boot', !/seedFinanceFromMonday/.test(server));
t('the old checklist templates are not seeded', !/seedCleaningChecklists/.test(server + src('server/cleaning-seed.js')));
t('the QuickBooks import targets are gone', !/qbo_accounts:|ap_invoices:\s*\{/.test(src('server/api/imports.js')));
{ const files = [];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d))) {
    const p = `${d}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) { if (f !== 'node_modules') walk(p); }
    else if (/\.(m?js|jsx)$/.test(p)) files.push(p);
  } };
  ['server', 'src', 'shared'].forEach(walk);
  // `/checklists.js` directly after a slash, so `truck-checklists.js` and the
  // other live checklist modules do not match.
  const importsRetired = files.filter(f => /from\s+['"][^'"]*\/(finance|finance-seed|quickbooks|checklists|LedgerPanel|QuickBooksPanel|QuickBooksSetupCard|MOLegend|moColors|parseSheet)(\.jsx?)?['"]/.test(src(f)));
  t('nothing imports a retired module', importsRetired.length === 0, importsRetired.join(', ')); }

console.log('\n── kept ──');
for (const [route, file] of [
  ['/api/ap-drop', 'server/api/ap-drop.js'],
  ['/api/partners', 'server/api/partners.js'],
  ['/api/partner-portal', 'server/api/partner-portal.js'],
  ['/api/payment-run', 'server/api/payment-run.js'],
  ['/api/payment-approval', 'server/api/payment-approval.js'],
  ['/api/banking', 'server/api/banking.js'],
]) {
  t(`${route} is still mounted`, new RegExp(`app\\.use\\('${route.replace(/\//g, '\\/')}'`).test(server));
  t(`${file} is still here`, existsSync(join(ROOT, file)));
}
t('the bank feed the payment run reads is still here', ['server/bank-feed.js', 'server/bank-match.js', 'server/bank-formats.js'].every(f => existsSync(join(ROOT, f))));
t('the payment run still reads bank_accounts', /FROM bank_accounts/.test(src('server/payment-run.js')));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
