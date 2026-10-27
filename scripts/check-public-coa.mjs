// The public certificate page reads four tables and writes none (D-247, E5).
//
// `server/api/public-coa.js` and everything it imports for the page may touch
// only `coa_publications`, `coa_brands`, `coa_settings` and `coa_products`, may
// never write, and may import nothing that does. A public route that reads a
// request, a result or a file is how internal facts reach the internet.
// Also asserts the router is mounted once, outside /api, before the app's pages.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const PUBLIC_FILES = ['server/api/public-coa.js', 'server/coa-public-render.js', 'server/coa-public-snapshot.js'];
const ALLOWED_TABLES = new Set(['coa_publications', 'coa_brands', 'coa_settings', 'coa_products']);
const ALLOWED_IMPORTS = new Set(['express', 'pdfkit', '../db.js', '../coa-public-snapshot.js', '../coa-public-render.js', './pdf-unicode.js']);

for (const f of PUBLIC_FILES) {
  const src = readFileSync(path.join(root, f), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  const tables = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1]).filter(x => !/^(json_each)$/i.test(x));
  const bad = [...new Set(tables.filter(x => !ALLOWED_TABLES.has(x)))];
  t(`${f} reads only the four public tables`, bad.length === 0, bad.join(', '));
  const writes = code.match(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|\.exec\()/gi) || [];
  t(`${f} writes nothing`, writes.length === 0, writes.join(', '));
  const imports = [...code.matchAll(/^import\s.*?from\s+'([^']+)'/gm)].map(m => m[1]);
  const strange = imports.filter(i => !ALLOWED_IMPORTS.has(i));
  t(`${f} imports nothing that writes or reads internal records`, strange.length === 0, strange.join(', '));
  t(`${f} never mentions a person's signature, the lab or a report number field`,
    !/qa_signed_by|signed_by|lab_name|lab_report_number|original_name|coa_requests|coa_test_results|coa_files|getDb\(\)\.exec/.test(code)
      || f === 'server/coa-public-snapshot.js' && !/coa_requests|coa_test_results|coa_files/.test(code));
}
const snapSrc = readFileSync(path.join(root, 'server/coa-public-snapshot.js'), 'utf8');
t('the snapshot never copies signed_by, the lab report number or a file name onto the public object',
  !/signed\.signed_by|lab_report_number:|original_name|lab_name:|item_number:/.test(snapSrc.split('export function publicSnapshot')[1].split('function limitText')[0]));

const server = readFileSync(path.join(root, 'server.js'), 'utf8');
const mounts = server.match(/app\.use\('\/tested',\s*publicCoaRoutes\)/g) || [];
t('the router is mounted exactly once, at /tested', mounts.length === 1);
t('…before the app\'s own pages (the SPA fallback)', server.indexOf("app.use('/tested'") > 0 && server.indexOf("app.use('/tested'") < server.indexOf("app.get('/{*splat}'"));
t('…and outside /api, so no session is ever asked for', !/app\.use\('\/api\/tested/.test(server));

const router = readFileSync(path.join(root, 'server/api/public-coa.js'), 'utf8');
t('every route passes the switch check first (one router.use before any route)', router.indexOf('router.use((req, res, next)') < router.indexOf("router.get('"));
t('nothing sets a cookie', !/res\.cookie\(|Set-Cookie['"]\s*,/.test(router));
t('the page carries a CSP that allows no script', /default-src 'none'/.test(router) && !/script-src/.test(router));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
