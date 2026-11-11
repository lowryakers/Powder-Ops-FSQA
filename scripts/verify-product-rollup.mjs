// Executed, not asserted: A-20261111-004 PR C (D-340). The recipe import (dry
// run writes nothing; apply is idempotent and refuses to overwrite), the
// product's read-only rollup of supplier documents, and the customer-pack export
// — which bundles COPIES and writes no row anywhere. Through the S3 stand-in.
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright-core';
import { readTable } from '../server/tabular.js';

const PORT = Number(process.env.PORT || 5215);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
const PW = 'RollupUser2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

const pickSkus = (() => { const d = new Database(DBP, { readonly: true }); try {
  return d.prepare("SELECT sku FROM products WHERE COALESCE(product_type,'food') = 'food' ORDER BY sku LIMIT 3").all().map(r => r.sku);
} finally { d.close(); } })();
const [SKU, SKU_EMPTY, SKU_YES] = pickSkus;
{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('pr-admin', 'Ada Admin', 'admin', 'admin', null);
  mk('pr-qa', 'Quinn Rollup', 'supervisor', 'qa', { products: 'edit', suppliers: 'edit' });
  mk('pr-bot', '*Reader Bot', 'operator', 'office', { products: 'view', suppliers: 'view' });
  const s = db.prepare('INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES (?,?,?,1)');
  s.run('pr-mfr', 'Prinova Shaped Co', 'ingredient');
  s.run('pr-dist', 'M4 Distributor Co', 'ingredient');
  const m = db.prepare('INSERT OR REPLACE INTO supplier_materials (id, supplier_id, item_description) VALUES (?,?,?)');
  m.run('pr-m-flavor', 'pr-mfr', 'Natural Vanilla Flavor');
  m.run('pr-m-flavor2', 'pr-dist', 'Natural Vanilla Flavor (distributed)');
  m.run('pr-m-whey', 'pr-mfr', 'Whey Isolate');
  const p = db.prepare("INSERT OR REPLACE INTO supplier_material_parts (id, material_id, system, part_number) VALUES (?,?,'mrpeasy',?)");
  p.run('pr-p1', 'pr-m-flavor', '201069'); p.run('pr-p2', 'pr-m-flavor2', '201069'); p.run('pr-p3', 'pr-m-whey', '100200');
  db.prepare("UPDATE products SET mrp_formula_id = 'Yes' WHERE sku = ?").run(SKU_YES);
  db.prepare("UPDATE products SET mrp_formula_id = NULL, formula_source_system = NULL WHERE sku IN (?, ?)").run(SKU, SKU_EMPTY);
  db.close();
}
const call = async (m, p, b, tok) => {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
  return { status: r.status, json, buf, type: r.headers.get('content-type') || '' };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const admin = await signIn('pr-admin', 'Ada Admin');
const qa = await signIn('pr-qa', 'Quinn Rollup');
t('three food SKUs to work with, and QA signed in', pickSkus.length === 3 && !!qa && !!admin);

console.log('\n── documents on the supplier register ──');
const upload = async (supplier, name, fields) => {
  const fd = new FormData(); fd.append('files', new File([Buffer.from(`%PDF-1.4\n% ${name}\n`)], name, { type: 'application/pdf' }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${URL}/api/suppliers/${supplier}/files`, { method: 'POST', headers: { Authorization: `Bearer ${qa}` }, body: fd });
  return (await r.json())?.saved?.[0]?.id;
};
const nf = await upload('pr-mfr', 'Natural Flavor Statement Vanilla.pdf', { kind: 'natural_flavor', material_id: 'pr-m-flavor' });
const coa = await upload('pr-mfr', 'COA Vanilla.pdf', { kind: 'coa', material_id: 'pr-m-flavor', lot_number: 'LOT-551' });
const spec = await upload('pr-mfr', 'Vanilla Spec.pdf', { kind: 'specification', material_id: 'pr-m-flavor', expires_on: '2020-01-01' });
const gmp = await upload('pr-mfr', 'NSF GMP 2027.pdf', { kind: 'gmp_certificate', expires_on: '2099-12-31' });
const nongmo = await upload('pr-dist', 'Non-GMO Statement.pdf', { kind: 'statement', material_id: 'pr-m-flavor2' });
t('five documents filed on two suppliers', [nf, coa, spec, gmp, nongmo].every(Boolean));
const filesBefore = one('SELECT COUNT(*) n FROM supplier_files').n;

console.log('\n── the recipe import ──');
const dir = mkdtempSync(join(tmpdir(), 'pr-bom-'));
const bom = join(dir, 'bom.csv');
writeFileSync(bom, `SKU,Part Number,Part Description,Quantity,Unit\n${SKU},201069,Natural Vanilla Flavor,2.5,kg\n${SKU},100200,Whey Isolate,40,kg\n${SKU},999999,Unknown Part,1,kg\nNO-SUCH-PRODUCT,201069,X,1,kg\n`);
const run = (...a) => execFileSync('node', ['scripts/recipe-import.mjs', bom, ...a], { env: { ...process.env, DB_PATH: DBP }, encoding: 'utf8' });
const dry = run();
t('the dry run writes nothing', /DRY RUN/.test(dry) && one('SELECT COUNT(*) n FROM product_recipe_lines').n === 0);
t('…reports the lines to add, the unmatched product and the "Yes" formula id',
  /lines to add: 3/.test(dry) && /UNMATCHED product "NO-SUCH-PRODUCT"/.test(dry) && new RegExp(`NOT AN ID: ${SKU_YES}`).test(dry), dry);
const applied = run('--apply');
t('--apply adds the three lines', /APPLIED: 3/.test(applied) && one('SELECT COUNT(*) n FROM product_recipe_lines WHERE sku = ?', SKU).n === 3, applied);
t('…stamps the formula source as a pointer and leaves mrp_formula_id alone',
  one('SELECT formula_source_system s, mrp_formula_id f, formula_synced_at a FROM products WHERE sku = ?', SKU).s === 'mrpeasy'
  && one('SELECT mrp_formula_id f FROM products WHERE sku = ?', SKU).f === null && one('SELECT mrp_formula_id f FROM products WHERE sku = ?', SKU_YES).f === 'Yes');
t('…is audited per product', !!one("SELECT 1 FROM audit_log WHERE entity_type = 'product' AND entity_id = ? AND details LIKE '%201069%'", SKU));
t('a second --apply adds nothing', /Nothing to add/.test(run('--apply')) && one('SELECT COUNT(*) n FROM product_recipe_lines').n === 3);
writeFileSync(bom, `SKU,Part Number,Part Description,Quantity,Unit\n${SKU},201069,Natural Vanilla Flavor,9.9,kg\n`);
const conflict = run('--apply');
t('a differing quantity is a CONFLICT, reported and not overwritten',
  /CONFLICT 201069/.test(conflict) && one("SELECT qty FROM product_recipe_lines WHERE sku = ? AND part_number = '201069'", SKU).qty === 2.5, conflict);
t('…and the two lines missing from that export are reported and kept', /on file, not in export 2/.test(conflict) && one('SELECT COUNT(*) n FROM product_recipe_lines WHERE retired_at IS NULL').n === 3);

console.log('\n── the product rollup ──');
let r = await call('GET', `/products/${encodeURIComponent(SKU)}`, null, qa);
const roll = r.json?.recipe;
const vanilla = roll?.lines?.find(l => l.part_number === '201069');
t('GET /:sku carries the recipe lines', roll?.lines?.length === 3);
t('a part from two suppliers lists both', vanilla?.suppliers?.length === 2
  && vanilla.suppliers.some(s => s.supplier_name === 'Prinova Shaped Co') && vanilla.suppliers.some(s => s.supplier_name === 'M4 Distributor Co'));
const mfrDocs = vanilla?.suppliers?.find(s => s.supplier_id === 'pr-mfr')?.documents || [];
t('each document appears once, by its file id, with status', mfrDocs.filter(d => d.id === nf).length === 1
  && mfrDocs.find(d => d.id === spec)?.status === 'expired' && mfrDocs.find(d => d.id === nf)?.status === 'no_date');
t('a COA carries its lot number', mfrDocs.find(d => d.id === coa)?.lot_number === 'LOT-551');
t('the GMP certificate is listed once, as supplier-level', roll.suppliers.find(s => s.id === 'pr-mfr')?.documents.filter(d => d.id === gmp).length === 1
  && !mfrDocs.some(d => d.id === gmp));
t('a part no supplier carries says so', roll.lines.find(l => l.part_number === '999999')?.suppliers.length === 0);
r = await call('GET', `/products/${encodeURIComponent(SKU_EMPTY)}`, null, qa);
t('a SKU with no recipe returns an empty rollup, no error', r.status === 200 && r.json?.recipe?.lines?.length === 0);

console.log('\n── the customer pack ──');
const pack = (fmt, tok = qa) => call('GET', `/products/customer-pack?skus=${encodeURIComponent(SKU)},${encodeURIComponent(SKU_EMPTY)}&format=${fmt}`, null, tok);
r = await pack('json');
const cols = ['sku', 'flavor_name', 'status', 'ingredient', 'part_number', 'supplier', 'natural_flavor_stmt', 'coa', 'coa_lot', 'spec', 'allergen', 'gras', 'non_gmo', 'origin', 'certificates', 'expiry_status', 'missing'];
t('the sheet has the v2 gap-list columns', JSON.stringify(r.json?.columns) === JSON.stringify(cols));
const mfrRow = r.json?.rows?.find(x => x.supplier === 'Prinova Shaped Co' && x.part_number === 'mrpeasy:201069');
t('the vanilla row names the statement, the COA and its lot, the spec', /Natural Flavor Statement/.test(mfrRow?.natural_flavor_stmt) && /COA Vanilla/.test(mfrRow?.coa)
  && mfrRow?.coa_lot === 'LOT-551' && /Vanilla Spec/.test(mfrRow?.spec), JSON.stringify(mfrRow));
t('…and its worst status is Expired (the spec)', mfrRow?.expiry_status === 'Expired');
t('the distributor row reads the non-GMO statement by name and says what is missing',
  r.json.rows.some(x => x.supplier === 'M4 Distributor Co' && /Non-GMO/.test(x.non_gmo) && /natural flavor stmt/.test(x.missing)));
t('a SKU with no recipe is a row that says so', r.json.rows.some(x => x.sku === SKU_EMPTY && x.missing === 'no recipe on file'));
r = await pack('xlsx');
const sheet = readTable(r.buf, 'x.xlsx');
t('the .xlsx reads back with the same columns and rows', JSON.stringify(sheet.headers) === JSON.stringify(cols) && sheet.rows.length >= 4, JSON.stringify(sheet.headers));
r = await pack('zip');
const zip = new AdmZip(r.buf);
const names = zip.getEntries().map(e => e.entryName);
t('the zip holds the summary and copies of the files', names.includes('summary.csv') && names.includes('summary.xlsx')
  && names.some(n => /Natural Flavor Statement Vanilla\.pdf$/.test(n)) && names.some(n => /COA Vanilla\.pdf$/.test(n)), names.join(' | '));
t('NOTHING was written: supplier_files count unchanged, no product file table', one('SELECT COUNT(*) n FROM supplier_files').n === filesBefore
  && !one("SELECT 1 FROM sqlite_master WHERE name = 'product_files'"));

console.log('\n── a read token ──');
const m = await call('POST', '/api-tokens', { user_id: 'pr-bot', label: 'reader', scopes: ['read'] }, admin);
const READ = m.json?.plaintext;
t('a read token on a products-view account reads the rollup and the pack',
  (await call('GET', `/products/${encodeURIComponent(SKU)}`, null, READ)).json?.recipe?.lines?.length === 3 && (await pack('json', READ)).status === 200);
t('…and cannot write to a product', (await call('PUT', `/products/${encodeURIComponent(SKU)}`, { notes: 'bot' }, READ)).status === 403);

console.log('\n── master.csv is unchanged ──');
r = await fetch(`${URL}/api/products/master.csv?token=${process.env.PRODUCT_MASTER_TOKEN}`);
const head = (await r.text()).split('\n')[0].split(',');
t('the first sixteen headers are the proofer\'s contract', JSON.stringify(head.slice(0, 16)) === JSON.stringify(['sku', 'gtin', 'flavor', 'packaging type', 'material', 'zipper', 'print',
  'trim length', 'trim width', 'gusset dimension', 'front panel dimension', 'wind direction', 'pms spot colors', 'hex spot colors', 'eye mark color', 'die line required']), head.slice(0, 16).join(','));

console.log('\n── the drawer ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
const me = (await call('GET', '/users/me', null, qa)).json;
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [qa, me]);
const open = async (sku) => {
  await page.goto(`${URL}/?tab=products`); await page.waitForTimeout(2500);
  await page.locator(`:text("${sku}")`).locator('visible=true').first().click({ timeout: 15000 }).catch(() => {});
  await page.locator('[data-product-drawer] [data-section="channels"]').waitFor({ timeout: 15000 }).catch(() => {});
};
await open(SKU);
const section = page.locator('[data-section="suppliers"]');
t('the product with a recipe shows a Supplier documents section', await section.count() === 1);
if (await section.count()) {
  await section.locator('button').first().click(); await page.waitForTimeout(400);
  t('…listing both suppliers of the vanilla and no upload control', await page.locator('[data-recipe-supplier]').count() >= 2
    && await page.locator('[data-recipe-rollup] input[type=file]').count() === 0);
}
await page.keyboard.press('Escape');
await open(SKU_EMPTY);
t('a product with no recipe opens with no such section', await page.locator('[data-product-drawer] [data-section="channels"]').count() === 1
  && await page.locator('[data-section="suppliers"]').count() === 0);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
