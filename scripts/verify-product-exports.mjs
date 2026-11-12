// verify:productexports — R-0645 PR C (pack tests 21–27), live on a fresh database.
//
//   21. Shalee's preset: exactly 14 headers, byte for byte (double and trailing
//       spaces), and the Vanilla Bean fixture row renders her typography.
//   22. The XLSX the writer makes is read back by parseXlsx with the same header row.
//   23. Retailer and GS1-check presets carry the spec's columns; Full carries the
//       field table plus fill weight and spec.
//   24. master.csv still opens with MASTER_CSV_CONTRACT, in order, token-guarded.
//   25. The GS1 backfill dry run writes nothing, counts matches, lists the
//       orphans, never proposes a typo code, and picks the plant's chosen cases.
//   26. --apply writes inner/case only from the export, audited, unit GTINs
//       untouched; a differing value is a conflict and stays; a second run is a no-op.
//   27. Nothing written is absent from the export; every attached code passes its
//       check digit and shares the unit's middle twelve digits — and the GS1-check
//       preset then reads 0 check-digit failures and 0 hierarchy mismatches.
//
// Caller sets PORT + DBPATH (+ PRODUCT_MASTER_TOKEN). The control is `main`
// before PR C: GET /products/export is read as a SKU and the first export fails.
import Database from 'better-sqlite3';
import { writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { SHALEE_DISTRIBUTOR_HEADERS, shaleeRow, buildExport, GS1_CHECK_HEADERS } from '../shared/product-exports.js';
import { parseXlsx, writeXlsx, parseDelimited } from '../server/tabular.js';
import { MASTER_CSV_CONTRACT } from '../shared/product-fields.js';
import { checkDigit, gtinValid } from '../shared/gtin.js';

const PORT = process.env.PORT || 5025;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
const TOKEN = process.env.PRODUCT_MASTER_TOKEN || 'export-token';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const write = (fn) => { const d = new Database(DBP); try { return fn(d); } finally { d.close(); } };
const all = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => all(sql, ...a)[0];

// ── 21 (pure): Shalee's 14 headers and the Vanilla Bean row ─────────────────
console.log('\n── the distributor sheet ──');
const EXPECTED = ['Flavor', 'Unit Size', 'SELLING UNIT UPC', 'INTERPACK  CASE UPC', 'MASTER PACK CASE UPC ', 'MASTER PACK CASE CONTENTS',
  'FOB MASTER PACK CASE COST ', 'SRP', 'MASTER CASE DIMENSIONS', 'CASE CUBE ', 'CASE WEIGHT', 'TI/HI', 'CASE QTY ON PALLET ', 'SHELF LIFE'];
t('exactly 14 headers', SHALEE_DISTRIBUTOR_HEADERS.length === 14);
t('byte for byte, in her order (two spaces, four trailing spaces)', JSON.stringify(SHALEE_DISTRIBUTOR_HEADERS) === JSON.stringify(EXPECTED));
const vanilla = {
  sku: 'WHY-STK-VB', base_flavor: 'Vanilla Bean', flavor: 'Vanilla Bean Whey Stick', pack: 'STK', gtin: '850046726828',
  gtin_inner: '30850046726829', gtin_case: '10850046726825', unit_size: '1.18 OZ', units_per_case: 72, inners_per_case: 6,
  units_per_inner: 12, price_fob_case: 120.24, price_fob_unit: 1.67, price_srp: 3.99, case_l: 16, case_w: 10, case_h: 7,
  case_cube: 0.74, case_weight: 7.2, ti: 8, hi: 4, pallet_qty: 32, shelf_life_months_commercial: 24,
};
const row = shaleeRow(vanilla);
const want = ['Vanilla Bean', '1.18 OZ', '008-50046-72682-8', '308-50046-72682-9', '108-50046-72682-5', '72/1.18 OZ packets 6/12pks',
  '$120.24 COST / $1.67 UNIT', '3.99', '16" x 10" x 7"', '0.74', '7.2LBS / 115.2 OZ', '8/4', '32', '24 Months'];
want.forEach((w, i) => { if (row[i] !== w) t(`Vanilla column ${i + 1} (${EXPECTED[i].trim()})`, false, `${JSON.stringify(row[i])} ≠ ${JSON.stringify(w)}`); });
t('the Vanilla Bean row renders her typography (UPCs, contents, FOB, dims, weight, Ti/Hi, shelf life)', want.every((w, i) => row[i] === w));
t('prices blank for a reader who may not see them', (() => { const o = buildExport('shalee', [vanilla], { prices: false }); return o.rows[0][6] === '' && o.rows[0][7] === ''; })());
t('a blank stays blank — no code is built for a missing inner', shaleeRow({ ...vanilla, gtin_inner: null })[3] === '');

// ── 22 (pure): the XLSX round trip ───────────────────────────────────────────
const sh = buildExport('shalee', [vanilla]);
const back = parseXlsx(writeXlsx(sh.headers, sh.rows, 'Distributor sheet'));
t('22. parseXlsx reads the written header row back byte for byte', JSON.stringify(back[0]) === JSON.stringify(EXPECTED), JSON.stringify(back[0]));
t('…and the data row', JSON.stringify(back[1]) === JSON.stringify(want));

// ── 23 (pure): the other presets' columns ────────────────────────────────────
const RETAILER = ['Preferred SKU', 'Name', 'Brand', 'Line', 'Flavor', 'Pack', 'Status', 'Unit size', 'Unit GTIN-12', 'Unit GTIN-14', 'Inner GTIN-14',
  'Case GTIN-14', 'Units per inner', 'Units per case', 'Case L', 'Case W', 'Case H', 'Case cube', 'Case weight', 'Ti', 'Hi', 'Pallet qty',
  'Shelf life', 'SRP', 'FOB case', 'FOB unit', 'Wholesale case', 'Wholesale unit', 'Allergen statement', 'Shopify SKU', 'Amazon SKU',
  'Amazon ASIN', 'Distributor item no', 'Wholesale item no'];
t('23. Retailer item setup has the spec\'s 34 columns in order', JSON.stringify(buildExport('retailer', []).headers) === JSON.stringify(RETAILER));
t('GS1 check has its columns (codes, check digits, hierarchy, in export, status, level, notes)', GS1_CHECK_HEADERS.length === 22
  && ['Unit check digit OK', 'Inner matches unit (mid-12)', 'Case in GS1 export', 'Mismatch notes'].every((h) => GS1_CHECK_HEADERS.includes(h)));
const fullH = buildExport('full', []).headers;
t('Full carries the field table plus Fill weight and Spec', ['SKU', 'Preferred SKU', 'Brand', 'Inner GTIN-14', 'Case GTIN-14', 'Ti', 'Hi', 'SRP',
  'Allergen statement', 'Artwork status', 'MRPEasy formula', 'Shopify SKU', 'Amazon ASIN', 'Distributor item no', 'Fill weight (g)', 'Spec'].every((h) => fullH.includes(h)));

// ── Live: accounts ───────────────────────────────────────────────────────────
const PEOPLE = [['ex-qa', 'Xena Export', 'supervisor', 'qa', { products: 'edit' }], ['ex-view', 'Vic Viewer', 'operator', 'warehouse', { products: 'view' }]];
write((db) => {
  for (const [id, name, role, dept, map] of PEOPLE) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(map));
  }
});
const call = async (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'Products2026!!', setup_code: `SC-${id}` });
  return (await (await call('POST', '/users/login', { name, password: 'Products2026!!' })).json())?.token;
};
const Q = await signIn('ex-qa', 'Xena Export');
const V = await signIn('ex-view', 'Vic Viewer');
t('signed in (QA supervisor, view-only reader)', !!Q && !!V);

// ── 24: master.csv is unchanged ──────────────────────────────────────────────
console.log('\n── master.csv ──');
let r = await fetch(`${URL}/api/products/master.csv`);
t('24. master.csv refuses without the token', r.status === 401);
r = await fetch(`${URL}/api/products/master.csv?token=${TOKEN}`);
const masterHead = parseDelimited((await r.text()).split(/\r?\n/)[0])[0] || [];
t('…and with it opens with the sixteen contract names, in order', r.status === 200 && JSON.stringify(masterHead.slice(0, 16)) === JSON.stringify(MASTER_CSV_CONTRACT), masterHead.slice(0, 16).join(','));
t('MASTER_CSV_CONTRACT itself is unchanged', MASTER_CSV_CONTRACT.join(',') === 'sku,gtin,flavor,packaging type,material,zipper,print,trim length,trim width,gusset dimension,front panel dimension,wind direction,pms spot colors,hex spot colors,eye mark color,die line required');

// ── Fixture products for the export route and the backfill ──────────────────
const upc = (body11) => body11 + checkDigit(body11);
// A GS1 code for the FIXTURE file only: indicator + the unit's middle twelve + its check digit.
const lvl = (ind, u) => { const b = ind + ('0' + u.slice(0, 11)); return b + checkDigit(b); };
const U = { A: upc('85009955001'), B: upc('85009955002'), C: upc('85009955003'), D: upc('85009955004'), E: upc('85009955005') };
const fx = [
  ['WHY-STK-GSA', 'GS Alpha', 'STK', U.A], ['WHY-PLG-GSB', 'GS Bravo', 'PLG', U.B], ['WHY-STK-GSC', 'GS Charlie', 'STK', U.C],
  ['WHY-STK-GSD', 'GS Delta', 'STK', U.D], ['WHY-STK-GSE', 'GS Echo', 'STK', U.E],
];
write((db) => {
  for (const [sku, name, pack, gtin] of fx) {
    db.prepare(`INSERT INTO products (sku, flavor, base_flavor, category, pack, status, gtin, gtin_valid, brand, product_type)
      VALUES (?, ?, ?, 'Whey Protein', ?, 'draft', ?, 1, 'ProDough', 'food')`).run(sku, name, name, pack, gtin);
  }
  // D already holds an inner that DIFFERS from GS1's — a conflict, never overwritten.
  db.prepare("UPDATE products SET gtin_inner = ? WHERE sku = 'WHY-STK-GSD'").run(lvl('4', U.D));
  // The plant's two chosen cases: give those SKUs the matching units (fixture DB only).
  for (const [sku, u12] of [['CPK-PSM-PS', '850046726125'], ['DNT-BOX-CPB', '850030869821']]) {
    const cur = db.prepare('SELECT sku FROM products WHERE sku = ?').get(sku);
    const holder = db.prepare('SELECT sku FROM products WHERE gtin = ? AND sku != ?').get(u12, sku);
    if (holder) db.prepare('UPDATE products SET gtin = NULL WHERE sku = ?').run(holder.sku);
    if (cur) db.prepare("UPDATE products SET gtin = ?, gtin_case = NULL, gtin_inner = NULL WHERE sku = ?").run(u12, sku);
    else db.prepare(`INSERT INTO products (sku, flavor, base_flavor, category, pack, status, gtin, gtin_valid, product_type)
      VALUES (?, ?, ?, 'Mixes', ?, 'draft', ?, 1, 'food')`).run(sku, sku, sku, sku.split('-')[1], u12);
  }
});
t('fixture products filed', !!one("SELECT 1 FROM products WHERE sku = 'WHY-STK-GSE'"));

// The GS1 export, as the Data Hub lays it out (a banner row, then the header).
const ROWS = [
  ['GTIN', 'GTIN-12', 'Packaging Level', 'Status Label', 'Product Description'],
  ...Object.values(U).map((u) => ['00' + u, u, 'Each', 'In Use', `unit ${u}`]),
  ['00850046726125', '850046726125', 'Each', 'In Use', 'Cupcake pouch'],
  ['00850030869821', '850030869821', 'Each', 'In Use', 'Donut box'],
  // A: stick — one inner, two In Use cases (1 and 2) ⇒ indicator 1.
  [lvl('3', U.A), '', 'Inner Pack', 'In Use', 'A 12pk'], [lvl('1', U.A), '', 'Case', 'In Use', 'A case 72'], [lvl('2', U.A), '', 'Case', 'In Use', 'A case 6'],
  // B: pouch — two In Use cases ⇒ indicator 2; an indicator-0 "inner" bundle is not an inner.
  [lvl('1', U.B), '', 'Case', 'In Use', 'B case'], [lvl('2', U.B), '', 'Case', 'In Use', 'B shipper'], ['00850079939189', '', 'Inner Pack', 'PreMarket', 'bundle'],
  // C: only a PreMarket case ⇒ nothing.
  [lvl('1', U.C), '', 'Case', 'PreMarket', 'C draft case'],
  // D: an inner that differs from what ReadyDoc holds.
  [lvl('3', U.D), '', 'Inner Pack', 'In Use', 'D 12pk'], [lvl('1', U.D), '', 'Case', 'In Use', 'D case'],
  // E: a stick with In Use cases at 2 and 3 but none at 1 ⇒ ambiguous, nothing written.
  [lvl('2', U.E), '', 'Case', 'In Use', 'E case 6'], [lvl('3', U.E), '', 'Case', 'In Use', 'E case 12'],
  // The plant's chosen cases, each beside another In Use case it must win over.
  ['10850046726122', '', 'Case', 'In Use', 'Cupcake shipper'], ['20850046726129', '', 'Case', 'In Use', 'Cupcake other'],
  ['10850030869828', '', 'Case', 'In Use', 'Donut shipper'], ['30850030869822', '', 'Case', 'In Use', 'Donut other'],
  // The two typo strings from the old sheet.
  ['108500467261222', '', 'Case', 'In Use', 'typo 1'], ['10850030869622', '', 'Case', 'In Use', 'typo 2'],
  // Orphans: In Use units with no ReadyDoc product, and one PreMarket.
  ['00' + upc('85009955090'), '', 'Each', 'In Use', 'orphan 1'], ['00' + upc('85009955091'), '', 'Each', 'In Use', 'orphan 2'],
  ['00' + upc('85009955092'), '', 'Each', 'PreMarket', 'premarket orphan'],
];
const dir = mkdtempSync(path.join(os.tmpdir(), 'gs1-'));
const file = path.join(dir, 'gs1-datahub-ExportAllProducts-fixture.xlsx');
writeFileSync(file, writeXlsx(ROWS[0], ROWS.slice(1), 'Products'));
const exportCodes = new Set(ROWS.slice(1).map((x) => x[0]));

const snap = () => all('SELECT sku, gtin, gtin_inner, gtin_case FROM products ORDER BY sku');
const run = (...args) => {
  try { return { code: 0, out: execFileSync('node', ['scripts/gs1-backfill.mjs', file, ...args], { env: { ...process.env, DB_PATH: DBP }, encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};

// ── 25: dry run ──────────────────────────────────────────────────────────────
console.log('\n── the GS1 backfill, dry run ──');
const before = snap();
const dry = run();
t('25. the dry run finishes (3 = conflicts to read)', [0, 3].includes(dry.code), dry.out.slice(-300));
t('…and writes nothing: unit, inner and case unchanged on every row', JSON.stringify(snap()) === JSON.stringify(before));
t('…it reports the match count', /Matched \d+ of \d+ products/.test(dry.out));
t('…it lists the In Use orphans (2), not the PreMarket one', /no ReadyDoc product \(reported, nothing created\): 2/.test(dry.out) && /orphan 1/.test(dry.out) && !/premarket orphan/.test(dry.out.split('no ReadyDoc product')[1].split('Other GS1')[0]));
t('…the typo codes are named and not proposed', /Typo codes in the file, NOT written: .*10850030869622/.test(dry.out) && !/case write 108500467261222|case write 10850030869622/.test(dry.out));
t('…CPK-PSM-PS ⇒ 10850046726122', /CPK-PSM-PS\s.*case write 10850046726122/.test(dry.out), dry.out.split('\n').find((l) => l.startsWith('CPK-PSM-PS')));
t('…DNT-BOX-CPB ⇒ 10850030869828', /DNT-BOX-CPB\s.*case write 10850030869828/.test(dry.out), dry.out.split('\n').find((l) => l.startsWith('DNT-BOX-CPB')));
t('…a stick picks the indicator-1 case', new RegExp(`WHY-STK-GSA\\s.*case write ${lvl('1', U.A)}`).test(dry.out));
t('…a pouch picks the indicator-2 case', new RegExp(`WHY-PLG-GSB\\s.*case write ${lvl('2', U.B)}`).test(dry.out));
t('…a differing inner is a conflict', /WHY-STK-GSD\s.*inner conflict/.test(dry.out));
t('…a stick with no indicator-1 case among several In Use is ambiguous', /WHY-STK-GSE\s.*case ambiguous/.test(dry.out));
t('…a PreMarket-only case is never picked', !/WHY-STK-GSC\s.*case write/.test(dry.out));
const auditBefore = one("SELECT COUNT(*) n FROM audit_log WHERE action = 'gs1_backfill'").n;
t('…and no audit row', auditBefore === 0);

// ── 26: apply ────────────────────────────────────────────────────────────────
console.log('\n── the GS1 backfill, --apply ──');
const app1 = run('--apply');
t('26. --apply finishes', [0, 3].includes(app1.code), app1.out.slice(-400));
const after = snap();
const byS = (rows) => Object.fromEntries(rows.map((x) => [x.sku, x]));
const B4 = byS(before); const AF = byS(after);
t('…no unit GTIN moved on any row', after.every((x) => (B4[x.sku]?.gtin ?? null) === (x.gtin ?? null)));
t('…A got its inner and its indicator-1 case', AF['WHY-STK-GSA'].gtin_inner === lvl('3', U.A) && AF['WHY-STK-GSA'].gtin_case === lvl('1', U.A));
t('…B got its indicator-2 case and no inner (the indicator-0 bundle is not one)', AF['WHY-PLG-GSB'].gtin_case === lvl('2', U.B) && !AF['WHY-PLG-GSB'].gtin_inner);
t('…the differing inner on D is left as it was', AF['WHY-STK-GSD'].gtin_inner === B4['WHY-STK-GSD'].gtin_inner);
t('…E has no case (ambiguous)', !AF['WHY-STK-GSE'].gtin_case);
t('…C has no case (PreMarket only)', !AF['WHY-STK-GSC'].gtin_case);
t('…the chosen cases are written', AF['CPK-PSM-PS'].gtin_case === '10850046726122' && AF['DNT-BOX-CPB'].gtin_case === '10850030869828');
t('…the source is recorded as the GS1 export', one("SELECT gtin_case_source s FROM products WHERE sku = 'WHY-STK-GSA'").s === 'gs1_export');
const audits = all("SELECT entity_id, details FROM audit_log WHERE action = 'gs1_backfill'");
t('…one audit row per product written, with the reason', audits.length >= 4 && audits.every((a) => /source_file/.test(a.details)));
t('…nothing was created for an orphan', !one(`SELECT 1 FROM products WHERE gtin = '${upc('85009955090')}'`));
const app2 = run('--apply');
t('…a second --apply is a no-op', JSON.stringify(snap()) === JSON.stringify(after) && one("SELECT COUNT(*) n FROM audit_log WHERE action = 'gs1_backfill'").n === audits.length, app2.out.slice(-200));

// ── 27: no-generate; the GS1-check preset reads clean on what was attached ───
console.log('\n── nothing made up ──');
const attached = after.flatMap((x) => [['inner', x.sku, x.gtin_inner, B4[x.sku]?.gtin_inner], ['case', x.sku, x.gtin_case, B4[x.sku]?.gtin_case]])
  .filter(([, , now, was]) => now && now !== was);
t('27. every code the backfill wrote appears in the export', attached.length >= 6 && attached.every(([, , c]) => exportCodes.has(c)), JSON.stringify(attached));
t('…passes its check digit and shares the unit\'s middle twelve', attached.every(([, sku, c]) => gtinValid(c) && c.slice(1, 13) === ('0' + AF[sku].gtin.slice(0, 11))));

console.log('\n── the export route ──');
const filters = encodeURIComponent(JSON.stringify({ q: 'GS ', kind: 'food' }));
r = await fetch(`${URL}/api/products/export?preset=gs1&format=csv&filters=${filters}`, { headers: { Authorization: `Bearer ${Q}` } });
const gs1Text = await r.text();
const gs1Rows = parseDelimited(gs1Text);
const H = gs1Rows[0]; const body = gs1Rows.slice(1).filter((x) => x.length > 1);
t('GET /products/export?preset=gs1 answers a CSV of the filtered rows', r.status === 200 && JSON.stringify(H) === JSON.stringify(GS1_CHECK_HEADERS) && body.length === 5, `${r.status} ${body.length}`);
const col = (name) => H.indexOf(name);
const withCodes = body.filter((x) => x[col('Inner GTIN-14')] || x[col('Case GTIN-14')]);
t('…0 check-digit failures on attached codes', withCodes.every((x) => x[col('Inner check digit OK')] !== 'no' && x[col('Case check digit OK')] !== 'no'));
t('…0 hierarchy mismatches', withCodes.every((x) => x[col('Inner matches unit (mid-12)')] !== 'no' && x[col('Case matches unit (mid-12)')] !== 'no'));
t('…and it reads the last GS1 export (status per level)', withCodes.some((x) => x[col('Case GS1 status')] === 'In Use'));

r = await fetch(`${URL}/api/products/export?preset=shalee&format=xlsx&filters=${filters}`, { headers: { Authorization: `Bearer ${Q}` } });
const xb = Buffer.from(await r.arrayBuffer());
const xr = parseXlsx(xb);
t('the Shalee preset as XLSX: her 14 headers, read back', r.status === 200 && JSON.stringify(xr[0]) === JSON.stringify(EXPECTED) && xr.length === 6, `${r.status} ${xr.length}`);
r = await fetch(`${URL}/api/products/export?preset=shalee&format=csv`, { headers: { Authorization: `Bearer ${Q}` } });
const csvHead = parseDelimited((await r.text()).split(/\r?\n/)[0])[0];
t('…as CSV: the trailing spaces survive (quoted)', JSON.stringify(csvHead) === JSON.stringify(EXPECTED), JSON.stringify(csvHead));
write((db) => db.prepare("UPDATE products SET price_srp = 3.99 WHERE sku = 'WHY-STK-GSA'").run());
const srpFor = async (tok) => { const x = parseXlsx(Buffer.from(await (await fetch(`${URL}/api/products/export?preset=retailer&format=xlsx&filters=${encodeURIComponent(JSON.stringify({ q: 'GS Alpha' }))}`, { headers: { Authorization: `Bearer ${tok}` } })).arrayBuffer())); return x[1]?.[x[0].indexOf('SRP')]; };
t('a canManage reader exports the price', await srpFor(Q) === '3.99');
t('a reader who is not canManage gets the price cell blank', await srpFor(V) === '');
r = await fetch(`${URL}/api/products/export?preset=nope`, { headers: { Authorization: `Bearer ${Q}` } });
t('an unknown preset is refused by name', r.status === 400);
t('the export wrote nothing (no audit row besides the backfill\'s)', !one("SELECT 1 FROM audit_log WHERE entity_type = 'product' AND action NOT IN ('gs1_backfill') AND details LIKE '%export%'"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
