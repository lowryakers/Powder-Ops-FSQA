// verify:provenance — D-128, live on a fresh database.
//
// Part 1: a nutrition panel says which formula produced it, approval is gated
// on that, the approval freezes what it approved, and the fill weight is
// cross-checked against the catalogue's. Part 2: the spec sheet's completeness,
// named gap by named gap, never a score. Each numbered heading is the ask's own
// acceptance criterion.
//
// Caller sets PORT + DBPATH, and PRODUCT_MASTER_TOKEN on the server (the value
// below — verify-all passes it).
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const PORT = process.env.PORT || 5047;
const URL = process.env.APP || `http://localhost:${PORT}`;
const B = `${URL}/api`;
const PT = process.env.PROOF_TOKEN || 'prov-token';
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('pv-adm','Quinn Quality','Quinn Quality','admin','qa',1,'SC-pv',datetime('now','+7 day'))`).run();
let tok = null;
const call = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => call(p, { method: 'PUT', body: JSON.stringify(b) });
await post('/users/login', { name: 'Quinn Quality' });
await post('/users/set-password', { user_id: 'pv-adm', password: 'QuinnQA2026!!', setup_code: 'SC-pv' });
tok = (await J(await post('/users/login', { name: 'Quinn Quality', password: 'QuinnQA2026!!' })))?.token;
t('signed in', !!tok);

// A whey stick (Apple Pie, the ask's own case) and a whey pouch to finish completely.
const stick = db.prepare("SELECT * FROM products WHERE category = 'Whey Protein' AND pack = 'STK' AND gtin_valid = 1 ORDER BY sku LIMIT 1").get();
const pouch = db.prepare("SELECT * FROM products WHERE category = 'Whey Protein' AND pack = 'PLG' AND gtin_valid = 1 ORDER BY sku LIMIT 1").get();
t('a whey stick and a whey pouch to work on', !!stick && !!pouch, JSON.stringify([stick?.sku, pouch?.sku]));
db.prepare('UPDATE products SET fill_weight_g = 34.86, mrp_formula_id = ?, formula_rev = ? WHERE sku = ?').run('F-00002', 'v2.0', stick.sku);

const PANEL = {
  serving_size_desc: '1 stick', serving_size_g: 34.86, servings_per_container: 1, calories: 130,
  total_fat_g: 1.5, total_fat_dv: 2, saturated_fat_g: 1, saturated_fat_dv: 5, trans_fat_g: 0,
  cholesterol_mg: 45, cholesterol_dv: 15, sodium_mg: 115, sodium_dv: 5,
  total_carbohydrate_g: 5, total_carbohydrate_dv: 2, dietary_fiber_g: 0, dietary_fiber_dv: 0,
  total_sugars_g: 2, added_sugars_g: 1, added_sugars_dv: 2, protein_g: 24,
  vitamin_d_mcg: 0, vitamin_d_dv: 0, calcium_mg: 130, calcium_dv: 10, iron_mg: 0.3, iron_dv: 0,
  potassium_mg: 160, potassium_dv: 4,
  ingredients: 'Whey protein isolate, natural flavors, guar gum, MCT oil', allergen_statement: 'Contains milk.',
  net_weight_g: 34.86, net_weight_oz: 1.23,
};
async function filePanel(sku, version, provenance) {
  const r = await post('/nfp', { sku, version, drive_url: 'https://drive.example/panel', provenance });
  return J(r);
}

console.log('── Part 1 · (6) every existing panel reads provenance_missing until someone fills it ──');
const bare = await filePanel(stick.sku, 'V1', undefined);
t('a panel filed with nothing recorded is provenance_missing: true', bare?.provenance_missing === true, JSON.stringify(bare?.provenance_missing_fields));
t('…source_system "unknown", the rest null — not guessed', bare?.provenance?.source_system === 'unknown'
  && bare.provenance.formula_ref === null && bare.provenance.bom_fill_weight_g === null, JSON.stringify(bare?.provenance));
const paper = await J(await post('/nfp', { sku: pouch.sku, version: 'P0', source: 'paper', approved_by: 'Old Signer', approved_at: '2025-11-01', drive_url: 'https://drive.example/p0' }));
t('a pre-ReadyDoc PAPER approval is still recordable — the approval happened', paper?.status === 'approved', JSON.stringify(paper).slice(0, 160));
t('…and reads provenance_missing: true, approved against nothing recorded', paper?.provenance_missing === true && paper?.approved_provenance?.recorded_from === 'paper');

console.log('\n── Part 1 · (4) approving a panel without formula_ref is refused ──');
await put(`/nfp/${bare.id}/panel`, { panel: PANEL, front_callouts: { protein_g: 24, calories: 130, added_sugar_g: 1 } });
{
  const r = await post(`/nfp/${bare.id}/decide`, { decision: 'approved' });
  const b = await J(r);
  t('REFUSED, 409, naming the three fields', r.status === 409 && JSON.stringify(b.needs_provenance) === JSON.stringify(['formula_ref', 'formula_version', 'bom_fill_weight_g']), `${r.status} ${JSON.stringify(b)}`);
  const link = await post(`/nfp/${bare.id}/send`, { sent_to: 'Matt' });
  t('the approval LINK is refused too — a link that could only be refused is not worth sending', link.status === 409 && !!(await J(link))?.needs_provenance);
  const partial = await J(await put(`/nfp/${bare.id}/provenance`, { formula_version: 'v2.0', bom_fill_weight_g: 33.32 }));
  const r2 = await post(`/nfp/${bare.id}/decide`, { decision: 'approved' });
  t('with formula_ref alone still missing, still refused — and only that one is named',
    r2.status === 409 && JSON.stringify((await J(r2)).needs_provenance) === '["formula_ref"]', JSON.stringify(partial?.provenance));
  const bad = await put(`/nfp/${bare.id}/provenance`, { bom_fill_weight_g: 'heavy' });
  t('a fill weight that is not grams is refused by name', bad.status === 400);
}

console.log('\n── Part 1 · (5) 33.32 g against a Catalogue 34.86 g warns and needs an acknowledgment ──');
{
  const saved = await J(await put(`/nfp/${bare.id}/provenance`, {
    source_system: 'Genesis R&D', formula_ref: 'F-00002', generated_by: 'Matt Schramm', generated_at: '2026-09-30', notes: 'spreadsheet copy',
  }));
  t('the card shows the gap before anybody presses Approve', saved?.fill_check_live?.status === 'mismatch' && saved.fill_check_live.diff_pct === 4.42,
    JSON.stringify(saved?.fill_check_live));
  const r = await post(`/nfp/${bare.id}/decide`, { decision: 'approved' });
  const b = await J(r);
  t('APPROVAL WARNS: 409, needs_fill_ack, both numbers named', r.status === 409 && b.needs_fill_ack === true
    && b.fill_check.bom === 33.32 && b.fill_check.catalogue === 34.86 && /33\.32 g.*34\.86 g/.test(b.error), `${r.status} ${JSON.stringify(b).slice(0, 220)}`);
  t('…and a %DV tick does not wave it through — it is its own acknowledgment',
    (await post(`/nfp/${bare.id}/decide`, { decision: 'approved', dv_ack: true })).status === 409);
  const ok = await post(`/nfp/${bare.id}/decide`, { decision: 'approved', fill_ack: true, approved_by: 'Maria Servin' });
  t('with the acknowledgment it approves', ok.ok, `HTTP ${ok.status} ${JSON.stringify(await J(ok)).slice(0, 160)}`);
  const row = db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(bare.id);
  const ap = JSON.parse(row.approved_provenance || 'null');
  t('(b) THE APPROVAL RECORDS WHAT IT APPROVED — F-00002 v2.0 at 33.32 g, by whom',
    ap?.formula_ref === 'F-00002' && ap.formula_version === 'v2.0' && ap.bom_fill_weight_g === 33.32 && ap.approved_by === 'Maria Servin', row.approved_provenance);
  t('…with the fill check as it stood and who waved it through', JSON.parse(row.fill_check).status === 'mismatch' && row.fill_ack_by === 'Maria Servin');
  const audit = db.prepare("SELECT details FROM audit_log WHERE entity_id = ? AND action LIKE '%approve%' ORDER BY rowid DESC LIMIT 1").get(bare.id);
  t('…and the audit entry carries the provenance too', /F-00002/.test(audit?.details || ''), audit?.details?.slice(0, 200));
  const edit = await put(`/nfp/${bare.id}/provenance`, { formula_version: 'v9' });
  t('an approved panel\'s provenance cannot be rewritten afterwards', edit.status === 409);
}

console.log('\n── Part 1 · (d) the read endpoint carries the block, and says when the formula has moved ──');
{
  const r = await fetch(`${B}/products/nutrition-panel?sku=${encodeURIComponent(stick.sku)}&token=${encodeURIComponent(PT)}`);
  const b = await J(r);
  t('provenance and approved_provenance are on the proofer\'s feed', r.ok && b?.provenance?.formula_ref === 'F-00002'
    && b.approved_provenance?.formula_version === 'v2.0' && b.provenance_missing === false, `${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  db.prepare("UPDATE products SET formula_rev = 'v2.1' WHERE sku = ?").run(stick.sku);
  const moved = await J(await fetch(`${B}/products/nutrition-panel?sku=${encodeURIComponent(stick.sku)}&token=${encodeURIComponent(PT)}`));
  t('THE FORMULA MOVED: "computed from v2.0; the current version is v2.1"',
    moved?.current_formula?.formula_version === 'v2.1' && moved.provenance_stale.some(x => /v2\.0.*v2\.1/.test(x)), JSON.stringify(moved?.provenance_stale));
}

console.log('\n── Callouts: a value, "not on this pack" (null), or not answered (absent) ──');
{
  const d = await filePanel(pouch.sku, 'V2', { formula_ref: 'F-00100', formula_version: 'v1', bom_fill_weight_g: 907 });
  await put(`/nfp/${d.id}/panel`, { front_callouts: { protein_g: 24, calories: '', added_sugar_g: null } });
  const c = JSON.parse(db.prepare('SELECT front_callouts FROM nfp_versions WHERE id = ?').get(d.id).front_callouts);
  t('a number is stored', c.protein_g === 24);
  t('an explicit null is stored as null — "not claimed on this pack"', 'added_sugar_g' in c && c.added_sugar_g === null, JSON.stringify(c));
  t('a blank box is NOT stored — nobody answered', !('calories' in c), JSON.stringify(c));
  db.prepare('DELETE FROM nfp_versions WHERE id = ?').run(d.id);
}

console.log('\n── Part 2 · (1) the completeness view loads for every SKU ──');
const comp = async () => J(await call('/products/completeness'));
{
  const c = await comp();
  const n = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  t('one row per SKU in the catalogue', c?.rows?.length === n, `${c?.rows?.length} of ${n}`);
  t('NO SCORE ANYWHERE — no percent, ratio or score in the payload', !/percent|ratio|score|"pct"/i.test(JSON.stringify(c).replace(/diff_pct/g, '')));
  t('the line roll-up counts reconcile with the rows', c.lines.reduce((a, l) => a + l.skus, 0) === c.rows.length
    && c.lines.reduce((a, l) => a + l.incomplete, 0) === c.counts.incomplete);
  t('every gap is NAMED on its row', c.rows.filter(r => r.state === 'incomplete').every(r => r.missing.length === r.gaps && r.gaps > 0));
}

console.log('\n── Part 2 · (2) a SKU missing only hex_spot_colors reports exactly that ──');
{
  // Finish the pouch in every group, the way the plant would, then take one hex away.
  const spec = db.prepare('SELECT * FROM packaging_specs WHERE spec_id = ?').get(pouch.spec_id);
  db.prepare(`UPDATE packaging_specs SET trim_length_mm = COALESCE(trim_length_mm, 254), trim_width_mm = COALESCE(trim_width_mm, 254),
    material_structure = COALESCE(material_structure, 'PET/MPET/PE'), wind_direction = COALESCE(wind_direction, '#4') WHERE spec_id = ?`).run(spec.spec_id);
  db.prepare("UPDATE products SET eyemark_color = 'Black', mrp_formula_id = 'F-00100', formula_rev = 'v1', fill_weight_g = 907 WHERE sku = ?").run(pouch.sku);
  db.prepare('DELETE FROM product_colors WHERE sku = ?').run(pouch.sku);
  db.prepare(`INSERT INTO product_colors (id, sku, slot, pms, hex, pms_valid, hex_valid) VALUES ('pv-c1', ?, 1, 'PMS 7580 C', 'C25131', 1, 1)`).run(pouch.sku);
  const v = await filePanel(pouch.sku, 'V3', { formula_ref: 'F-00100', formula_version: 'v1', bom_fill_weight_g: 907, source_system: 'Genesis R&D' });
  await put(`/nfp/${v.id}/panel`, { panel: { ...PANEL, serving_size_g: 30, servings_per_container: 30, net_weight_g: 907 },
    front_callouts: { protein_g: 24, calories: 130, added_sugar_g: null } });
  const ap = await post(`/nfp/${v.id}/decide`, { decision: 'approved' });
  t('its panel approves cleanly (provenance, fill weight and %DV all in order)', ap.ok, JSON.stringify(await J(ap)).slice(0, 200));
  db.prepare(`INSERT INTO artwork_versions (id, sku, component, version, status, source, proof_job_id, nfp_version, panel_rev)
    VALUES ('pv-art', ?, 'primary', 1, 'print_ready', 'proofing', 'job-777', 'V3', 1)`).run(pouch.sku);
  // Finished includes what the date on the pack rests on (D-133): a shelf-life basis with its kind.
  const sl = await post('/stability/justifications', { product_skus: pouch.sku, shelf_life_months: 18, basis_kind: 'client_data',
    basis: 'Client real-time stability data for this pouch, 18 months at ambient.' });
  t('its shelf-life basis files (client data, so an expiration date)', sl.status === 201, `${sl.status}`);
  let row = (await comp()).rows.find(r => r.sku === pouch.sku);
  t('finished in every group, it reads COMPLETE with zero gaps', row?.state === 'complete' && row.gaps === 0, JSON.stringify(row?.missing));
  db.prepare("UPDATE product_colors SET hex = NULL WHERE sku = ?").run(pouch.sku);
  row = (await comp()).rows.find(r => r.sku === pouch.sku);
  t('WITHOUT ITS HEX IT REPORTS EXACTLY THAT FIELD — not "87%"',
    JSON.stringify(row?.missing) === JSON.stringify(['Packaging: Hex spot colors']), JSON.stringify(row?.missing));
  t('…and only the Packaging group is incomplete', Object.entries(row.groups).filter(([, g]) => g.state === 'incomplete').map(([k]) => k).join() === 'packaging');
  db.prepare("UPDATE product_colors SET hex = 'C25131' WHERE sku = ?").run(pouch.sku);
}

console.log('\n── Part 2 · (3) the four plant bottles can be blocked: excluded from incomplete, still visible ──');
{
  await post('/products/bottle-drafts', {});
  const bottles = db.prepare("SELECT sku FROM products WHERE category = 'Plant Protein' AND pack = 'BTL' ORDER BY sku").all().map(r => r.sku);
  t('four plant bottle drafts exist', bottles.length === 4, JSON.stringify(bottles));
  const before = await comp();
  for (const sku of bottles) {
    const r = await post(`/products/${encodeURIComponent(sku)}/completeness-block`, { reason: 'formula not final', owner: 'Danny' });
    if (!r.ok) t(`block ${sku}`, false, `${r.status}`);
  }
  const after = await comp();
  const rows = after.rows.filter(r => bottles.includes(r.sku));
  t('all four read BLOCKED, with the reason and the owner', rows.length === 4 && rows.every(r => r.state === 'blocked' && r.block.reason === 'formula not final' && r.block.owner === 'Danny'));
  t('…STILL VISIBLE, gaps named', rows.every(r => r.missing.length > 0));
  t('…and OUT of the incomplete count', after.counts.incomplete === before.counts.incomplete - 4 && after.counts.blocked === 4,
    `${before.counts.incomplete} → ${after.counts.incomplete}, blocked ${after.counts.blocked}`);
  const line = after.lines.find(l => l.line.startsWith('Plant Protein') && /Bottle/.test(l.line));
  t('the line roll-up shows them as blocked, not incomplete', line?.blocked === 4 && line.incomplete === 0, JSON.stringify(line));
  t('a block needs a reason and an owner', (await post(`/products/${encodeURIComponent(stick.sku)}/completeness-block`, { reason: 'x' })).status === 400);
}

console.log('\n── Part 2 · stale ──');
{
  const row = (await comp()).rows.find(r => r.sku === stick.sku);
  t('the stick whose formula moved to v2.1 is flagged STALE, naming both versions',
    row?.stale.some(s => /v2\.0.*v2\.1/.test(s)), JSON.stringify(row?.stale));
  t('…and the 33.32 g against 34.86 g gap is named as well', row.stale.some(s => /33\.32 g.*34\.86 g/.test(s)));
}

console.log('\n── Part 2 · (7) and the screen: the CSV export, at 1280 and 390 ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'pv-adm', name: 'Quinn Quality', role: 'admin' })); }, [tok]);
    await page.goto(`${URL}/?tab=products&view=completeness`);
    await page.waitForSelector('[data-completeness]', { timeout: 20000 }).catch(() => {});
    t(`${width}px: the Completeness view renders`, await page.locator('[data-completeness]').count() === 1);
    t(`${width}px: the line roll-up is on screen`, await page.locator('[data-line-row]').count() > 3);
    t(`${width}px: the page does not pan sideways`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    if (width === 1280) {
      await page.locator('[data-filter="blocked"]').click();
      t('the Blocked filter lists the four bottles', await page.locator('[data-completeness-row][data-state="blocked"]').count() === 4);
      await page.locator('[data-filter="incomplete"]').click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export]').click()]);
      const text = await (await dl.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8'));
      const lines = text.trim().split('\n');
      const c = await comp();
      t('THE CSV HAS ONE ROW PER INCOMPLETE SKU', lines.length - 1 === c.counts.incomplete, `${lines.length - 1} rows, ${c.counts.incomplete} incomplete`);
      t('…each with its missing fields as a comma-separated list', lines[0] === 'SKU,Product,Line,Gaps,Missing fields'
        && lines.slice(1).every(l => /,"[^"]*, [^"]*"$|,[^,]+$/.test(l)), lines[1]?.slice(0, 200));
      t('…and no blocked SKU in it', !lines.some(l => /Plant Protein · Bottle/.test(l)));
      // The panel card says what it was approved against, in one line.
      await page.locator('[data-filter="all"]').click();
      await page.locator('input[placeholder="SKU, product or a missing field"]').fill(stick.sku);
      await page.waitForTimeout(400);
      await page.locator('[data-completeness-row]').first().locator('button').first().click();
      await page.locator('[data-open-sku]').first().click();
      await page.waitForSelector('[data-provenance-line]', { timeout: 8000 }).catch(() => {});
      const line = await page.locator('[data-provenance-line]').first().innerText().catch(() => '');
      t('(c) the panel shows "Approved V1 · from F-00002 v2.0 @ 33.3g · Maria Servin, <date>"',
        /Approved V1 · from F-00002 v2\.0 @ 33\.3g · Maria Servin, \d{4}-\d{2}-\d{2}/.test(line), line);
      t('…and says it is stale against the catalogue', await page.locator('[data-provenance-stale]').count() > 0);
    }
    await page.close();
  }
} finally { await browser.close(); }

console.log('\n── The old blank-callout nulls become "not answered", once ──');
{
  const v = await filePanel(stick.sku, 'V9', undefined);
  db.prepare(`UPDATE nfp_versions SET front_callouts = '{"protein_g":null,"calories":130}' WHERE id = ?`).run(v.id);
  db.prepare("DELETE FROM app_settings WHERE key = 'callout_nulls_unset_v1'").run();
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(Number(PORT) + 100), DB_PATH: DBP, DBPATH: DBP }, stdio: 'ignore' });
  for (let i = 0; i < 90; i++) { await wait(1000); try { await fetch(`http://localhost:${Number(PORT) + 100}/api/users/lookup?q=zz`); break; } catch { /* booting */ } }
  proc.kill('SIGKILL'); await wait(500);
  const c = JSON.parse(db.prepare('SELECT front_callouts FROM nfp_versions WHERE id = ?').get(v.id).front_callouts);
  t('a null stored before D-128 (a blank box) now reads as not answered', !('protein_g' in c) && c.calories === 130, JSON.stringify(c));
}

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
