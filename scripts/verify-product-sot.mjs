// verify:productsot — R-0645 PR A (D-342), live on a fresh database.
//
// The product record as the source of truth, part A: the five statuses, the
// Active gate, the price / item-number gate, the GTIN gate (tokens and bots
// never write a GTIN; an inner or case code is CHECKED, never built), and the
// status migration script (dry run, apply, idempotent, undo, never a GTIN).
//
// People are configured by USER ID in app_settings through the admin route —
// the fixture ids below stand in for Lowry (approver) and Shalee (prices).
//
// Caller sets PORT + DBPATH. The control is `main` before this change: there is
// no /products/sot-settings route and the first assertion fails.
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const PORT = process.env.PORT || 5207;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const write = (fn) => { const d = new Database(DBP); try { return fn(d); } finally { d.close(); } };

const PEOPLE = [
  ['sot-lowry', 'Lara Approver', 'admin', 'admin'],
  ['sot-shalee', 'Shay Prices', 'supervisor', 'office'],
  ['sot-qa', 'Quinn Catalog', 'supervisor', 'qa'],
  ['sot-bot', 'Product Bot', 'operator', 'office'],
];
write((db) => {
  for (const [id, name, role, dept] of PEOPLE) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ products: 'edit' }));
  }
});
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'Products2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Products2026!!' })).json?.token;
};
const L = await signIn('sot-lowry', 'Lara Approver');
const S = await signIn('sot-shalee', 'Shay Prices');
const Q = await signIn('sot-qa', 'Quinn Catalog');
const B = await signIn('sot-bot', 'Product Bot');
t('signed in (approver admin, price editor, QA supervisor, bot account)', !!L && !!S && !!Q && !!B);

// A token on the bot account makes it a bot account, and is the token we write with.
const mint = async (userId, label) => (await call('POST', '/api-tokens', { user_id: userId, label, scopes: ['read', 'write'] }, L)).json?.plaintext;
const BT = await mint('sot-bot', 'fixture product bot');
t('a write token on the bot account (fixture database only)', !!BT);

// ── The settings: unset refuses by name ──────────────────────────────────────
let r = await call('GET', '/products/sot-settings', null, L);
t('GET /products/sot-settings lists the three settings, none set', r.status === 200 && r.json?.settings?.length === 3 && r.json.settings.every((s) => !s.user), JSON.stringify(r.json)?.slice(0, 200));

// 3. A new product starts Draft.
const SKU = 'WHY-STK-SOT';
r = await call('POST', '/products', { sku: SKU, flavor: 'Fixture Vanilla', base_flavor: 'Fixture Vanilla', category: 'Whey Protein', pack: 'STK' }, L);
t('3. a new product starts as Draft (slug "draft")', r.status === 201 && r.json?.status === 'draft', JSON.stringify(r.json)?.slice(0, 160));
t('3. … and its brand defaults to ProDough', r.json?.brand === 'ProDough');
r = await call('POST', '/products', { sku: 'WHY-STK-SOX', flavor: 'X', category: 'Whey Protein', pack: 'STK', status: 'active' }, L);
t('3. a new product cannot be created Active', r.status === 400 && r.json?.code === 'ACTIVE_ON_CREATE');

// Unset approver: the move to Active is refused and names the setting.
r = await call('PUT', `/products/${SKU}`, { status: 'active' }, L);
t('unset approver ⇒ 403 naming product_sot.active_approver_user_id, nothing written',
  r.status === 403 && r.json?.setting === 'product_sot.active_approver_user_id' && one('SELECT status FROM products WHERE sku = ?', SKU).status === 'draft', JSON.stringify(r.json));
r = await call('PUT', `/products/${SKU}`, { price_srp: 3.99 }, S);
t('unset price editor ⇒ 403 naming product_sot.price_editor_user_id', r.status === 403 && r.json?.setting === 'product_sot.price_editor_user_id');

// Only an admin chooses; a bot account cannot be chosen.
r = await call('PUT', '/products/sot-settings', { active_approver: 'sot-lowry' }, Q);
t('a non-admin cannot choose the people (403)', r.status === 403);
r = await call('PUT', '/products/sot-settings', { price_editor: 'sot-bot' }, L);
t('a bot account cannot be the price editor (400)', r.status === 400 && /bot/i.test(r.json?.error || ''));
r = await call('PUT', '/products/sot-settings', { active_approver: 'sot-lowry', price_editor: 'sot-shalee' }, L);
t('admin chooses the approver and the price editor by id', r.status === 200 && r.json?.changed === 2);
t('… stored as user ids in app_settings, audited',
  one("SELECT value FROM app_settings WHERE key = 'product_sot.active_approver_user_id'")?.value === 'sot-lowry'
  && all("SELECT 1 FROM audit_log WHERE action = 'product_sot_setting_changed'").length === 2);

// ── Pack facts, prices, item numbers ─────────────────────────────────────────
r = await call('PUT', `/products/${SKU}`, { unit_size: '1.18 OZ', units_per_case: 72, inners_per_case: 6, units_per_inner: 12, case_l: 16, case_w: 10, case_h: 7, case_weight: 7.2, ti: 8, hi: 4, pallet_qty: 32, shelf_life_months_commercial: 24 }, Q);
t('a catalog manager writes the pack and shipping facts', r.status === 200 && r.json?.units_per_case === 72 && r.json?.ti === 8, JSON.stringify(r.json)?.slice(0, 200));
r = await call('PUT', `/products/${SKU}`, { ti: -1 }, Q);
t('a negative Ti is refused by name', r.status === 400 && r.json?.field === 'ti');
r = await call('PUT', `/products/${SKU}`, { price_fob_case: 120.24 }, Q);
t('10. a canManage person who is not the price editor cannot write a price (403)', r.status === 403 && r.json?.code === 'PRICE_EDITOR_ONLY' && one('SELECT price_fob_case FROM products WHERE sku = ?', SKU).price_fob_case === null);
r = await call('PUT', `/products/${SKU}`, { price_fob_case: '$120.24', price_fob_unit: 1.67, price_srp: 3.99 }, S);
t('10. the price editor writes prices ($ stripped, stored as numbers)', r.status === 200 && r.json?.price_fob_case === 120.24 && r.json?.price_srp === 3.99, JSON.stringify(r.json)?.slice(0, 160));
r = await call('PUT', `/products/${SKU}`, { distributor_item_no: 'D-1001' }, S);
t('the price editor also writes item numbers (falls back when unset)', r.status === 200 && r.json?.distributor_item_no === 'D-1001');
r = await call('PUT', `/products/${SKU}`, { distributor_item_no: 'D-1002' }, Q);
t('… another person cannot', r.status === 403);
r = await call('PUT', `/products/${SKU}`, { price_srp: 9.99 }, BT);
t('9. a token cannot write a price (403), row unchanged', r.status === 403 && one('SELECT price_srp FROM products WHERE sku = ?', SKU).price_srp === 3.99, JSON.stringify(r.json));
r = await call('PUT', `/products/${SKU}`, { wholesale_item_no: 'W-1' }, BT);
t('9. a token cannot write an item number (403)', r.status === 403 && one('SELECT wholesale_item_no FROM products WHERE sku = ?', SKU).wholesale_item_no === null);
r = await call('POST', '/products/bulk-edit', { skus: [SKU], field: 'price_srp', value: '1.00' }, Q);
t('the fill-down is behind the same price gate', r.status === 403);
r = await call('POST', `/products/${SKU}/na`, { field: 'price_wholesale_case' }, Q);
t('marking a price N/A is behind the price gate too', r.status === 403);
r = await call('POST', `/products/${SKU}/na`, { field: 'price_wholesale_case' }, S);
const r2 = await call('POST', `/products/${SKU}/na`, { field: 'price_wholesale_unit' }, S);
t('… the price editor marks the wholesale prices N/A', r.status === 200 && r2.status === 200);

// ── GTINs: checked, never built ─────────────────────────────────────────────
const UNIT = '850046726828';            // the Vanilla Bean whey stick's UPC-12, as allocated in GS1
const INNER = '30850046726829';         // its In Use inner pack, as copied from the GS1 export
const CASE = '10850046726825';          // its In Use case, as copied from the GS1 export
write((db) => db.prepare("UPDATE products SET gtin = NULL WHERE gtin = ?").run(UNIT));
r = await call('PUT', `/products/${SKU}`, { gtin: UNIT }, BT);
t('11. a token cannot write the unit GTIN (403), row unchanged', r.status === 403 && one('SELECT gtin FROM products WHERE sku = ?', SKU).gtin === null, JSON.stringify(r.json));
r = await call('PUT', `/products/${SKU}`, { gtin: UNIT }, Q);
t('a person pastes the unit GTIN', r.status === 200 && r.json?.gtin === UNIT);
const after = one('SELECT gtin_inner, gtin_case FROM products WHERE sku = ?', SKU);
t('12. pasting only the unit never fills the inner or the case', after.gtin_inner === null && after.gtin_case === null);
r = await call('PUT', `/products/${SKU}`, { gtin_inner: INNER }, BT);
t('11. a token cannot write the inner GTIN (403)', r.status === 403 && one('SELECT gtin_inner FROM products WHERE sku = ?', SKU).gtin_inner === null);
r = await call('PUT', `/products/${SKU}`, { gtin_case: CASE }, BT);
t('11. a token cannot write the case GTIN (403)', r.status === 403);
r = await call('PUT', `/products/${SKU}`, { gtin_inner: '30850046726820' }, Q);
t('11. an inner with a bad check digit is refused, nothing stored, told to copy from GS1',
  r.status === 400 && /GS1/.test(r.json?.error || '') && one('SELECT gtin_inner FROM products WHERE sku = ?', SKU).gtin_inner === null, JSON.stringify(r.json));
r = await call('PUT', `/products/${SKU}`, { gtin_inner: CASE }, Q);
t('11. an inner with the case indicator (1) is refused, naming indicator 3', r.status === 400 && /start with 3/.test(r.json?.error || ''), JSON.stringify(r.json));
r = await call('PUT', `/products/${SKU}`, { gtin_case: '10850030869828' }, Q);
t('a case GTIN from another item (different middle digits) is refused', r.status === 400 && /middle twelve digits/.test(r.json?.error || ''));
r = await call('PUT', `/products/${SKU}`, { gtin_inner: '308-50046-72682-9', gtin_case: CASE }, Q);
t('11. a person pastes the allocated inner and case (spacing removed, stored as pasted)',
  r.status === 200 && r.json?.gtin_inner === INNER && r.json?.gtin_case === CASE && r.json?.gtin_case_source === 'manual', JSON.stringify(r.json)?.slice(0, 200));
await call('POST', '/products', { sku: 'WHY-STK-SOZ', flavor: 'Fixture Clash', category: 'Whey Protein', pack: 'STK' }, L);
r = await call('PUT', '/products/WHY-STK-SOZ', { gtin_case: CASE }, Q);
t('the same case GTIN on another product is a 409', r.status === 409 && r.json?.code === 'GTIN_IN_USE');

// ── The Active gate ──────────────────────────────────────────────────────────
// Everything else on the checklist done by fixture (the NFP approval, the
// artwork release and the confirmations each have their own tested routes).
write((db) => {
  db.prepare(`UPDATE products SET spec_id = 'SPEC-STICK-LG', formula_approved_at = datetime('now'), nfp_version = 'V1', nfp_approved_at = datetime('now'),
    artwork_status = 'print_ready', shopify_listed_at = datetime('now'), shiphero_synced_at = datetime('now') WHERE sku = ?`).run(SKU);
  db.prepare("INSERT OR IGNORE INTO product_colors (sku, slot, pms, hex, pms_valid, hex_valid) VALUES (?, 1, 'PMS 485 C', 'DA291C', 1, 1)").run(SKU);
});
const open = (await call('GET', `/products/${SKU}`, null, L)).json?.readiness?.steps?.filter((s) => !s.done).map((s) => s.key) || [];
t('fixture: the only open checklist step is the distributor sheet (price_wholesale N/A, SRP etc. set)', open.length === 0 || (open.length === 1 && open[0] === 'distributor'), open.join(','));

// 5. With an item still open.
write((db) => db.prepare('UPDATE products SET shelf_life_months_commercial = NULL WHERE sku = ?').run(SKU));
r = await call('PUT', `/products/${SKU}`, { status: 'active' }, L);
t('5. approver, an item still open ⇒ 400 READINESS_OPEN naming it, row unchanged',
  r.status === 400 && r.json?.code === 'READINESS_OPEN' && (r.json?.open || []).some((o) => o.key === 'distributor') && one('SELECT status FROM products WHERE sku = ?', SKU).status === 'draft', JSON.stringify(r.json));
t('5. … the refusal is audited', !!one("SELECT 1 FROM audit_log WHERE action = 'product_status_activation_refused' AND entity_id = ?", SKU));
r = await call('POST', `/products/${SKU}/na`, { field: 'shelf_life_months_commercial' }, Q);
t('the open item is marked N/A', r.status === 200);

// 6. Another person.
r = await call('PUT', `/products/${SKU}`, { status: 'active' }, Q);
t('6. another canManage person ⇒ 403 ACTIVE_APPROVER_ONLY, row unchanged', r.status === 403 && r.json?.code === 'ACTIVE_APPROVER_ONLY' && one('SELECT status FROM products WHERE sku = ?', SKU).status === 'draft');
// 8. A bot session.
r = await call('PUT', `/products/${SKU}`, { status: 'active' }, B);
t('8. a bot account\'s own session ⇒ 403 bot_account_cannot_approve', r.status === 403 && /bot_account_cannot_approve/.test(JSON.stringify(r.json)), JSON.stringify(r.json));
// 7. A token.
r = await call('PUT', `/products/${SKU}`, { status: 'Active' }, BT);
t('7. a token ⇒ 403 approve_requires_human_session, row unchanged',
  r.status === 403 && /approve_requires_human_session/.test(JSON.stringify(r.json)) && one('SELECT status FROM products WHERE sku = ?', SKU).status === 'draft', JSON.stringify(r.json));
r = await call('POST', '/products/bulk-edit', { skus: [SKU], field: 'status', value: 'active' }, BT);
t('7. … the fill-down to Active by a token is refused too', r.status === 403);
// 4. The approver, everything done or N/A.
r = await call('PUT', `/products/${SKU}`, { status: 'active' }, L);
t('4. the approver, checklist done or N/A ⇒ 200, status active', r.status === 200 && r.json?.status === 'active', JSON.stringify(r.json)?.slice(0, 300));
const act = one("SELECT actor_id, details, previous_state, new_state FROM audit_log WHERE action = 'product_status_activated' AND entity_id = ?", SKU);
t('4. audited product_status_activated with actor_id and from/to', act?.actor_id === 'sot-lowry' && /"to":"active"/.test(act?.details || '') && /"from":"draft"/.test(act?.details || ''), JSON.stringify(act));

// 7b. A token on the APPROVER'S own account is still refused. An admin holds
// no token, so the approver is moved to a non-admin account for this proof.
await call('PUT', '/products/sot-settings', { active_approver: 'sot-qa' }, L);
const QT = await mint('sot-qa', 'fixture approver token');
const SKU2 = 'WHY-STK-SOY';
await call('POST', '/products', { sku: SKU2, flavor: 'Fixture Two', category: 'Whey Protein', pack: 'STK' }, L);
r = await call('PUT', `/products/${SKU2}`, { status: 'active' }, QT);
t('7. a token on the configured approver\'s own account ⇒ 403 approve_requires_human_session', r.status === 403 && /approve_requires_human_session/.test(JSON.stringify(r.json)), JSON.stringify(r.json));
await call('PUT', '/products/sot-settings', { active_approver: 'sot-lowry' }, L);

// The status list and not_launching.
r = await call('PUT', `/products/${SKU2}`, { status: 'in_development' }, Q);
t('an old spelling sent by a client lands on its slug (in_development → ready)', r.status === 200 && r.json?.status === 'ready');
r = await call('PUT', `/products/${SKU2}`, { status: 'concept-ish' }, Q);
t('an unknown status is refused by name', r.status === 400 && r.json?.code === 'STATUS_UNKNOWN');
r = await call('PUT', `/products/${SKU2}`, { status: 'not_launching' }, Q);
t('13. typing not_launching is still 400 NOT_LAUNCHING_OWNED', r.status === 400 && r.json?.code === 'NOT_LAUNCHING_OWNED');
r = await call('POST', `/products/${SKU2}/not-launching`, { reason: 'fixture — will not ship' }, Q);
const r3 = await call('POST', `/products/${SKU2}/not-launching`, { undo: true }, Q);
t('13. Won\'t launch and Bring it back still work, back to its slug (ready)', r.status === 200 && r3.status === 200 && r3.json?.status === 'ready', JSON.stringify(r3.json)?.slice(0, 120));

// 12. No generation in the new code.
const src = ['server/product-sot-gate.js', 'shared/level-gtin.js', 'shared/product-sot-config.js'].map((f) => readFileSync(f, 'utf8')).join('\n');
t('12. no checkDigit() in the new product-sot code (validation goes through gtinValid on a complete code)', !/checkDigit\s*\(/.test(src));
t('12. no suggest / next-number / allocate helper in the new code', !/function\s+\w*(suggest|nextGtin|allocate|buildGtin|makeGtin)/i.test(src));
const routes = readFileSync('server/api/products.js', 'utf8');
t('12. no GTIN suggest route on the products router', !/router\.(get|post)\(['"`][^'"`]*suggest/i.test(routes));

// ── The status migration script ──────────────────────────────────────────────
const LEG = [['ZZ-MIG-1', 'Draft'], ['ZZ-MIG-2', 'in_development'], ['ZZ-MIG-3', 'concept'], ['ZZ-MIG-4', 'on_hold'], ['ZZ-MIG-5', 'discontinued'], ['ZZ-MIG-6', 'active'], ['ZZ-MIG-7', 'not_launching']];
write((db) => {
  for (const [sku, st] of LEG) {
    db.prepare(`INSERT OR REPLACE INTO products (sku, gtin, gtin_valid, category, pack, flavor, base_flavor, status, created_by, not_launching_from, not_launching_reason)
      VALUES (?, NULL, 0, 'Whey Protein', 'STK', ?, ?, ?, 'fixture', ?, ?)`).run(sku, sku, sku, st, st === 'not_launching' ? 'in_development' : null, st === 'not_launching' ? 'fixture reason' : null);
  }
});
const gtinsBefore = JSON.stringify(all('SELECT sku, gtin, gtin_inner, gtin_case FROM products ORDER BY sku'));
const run = (...args) => { try { return { code: 0, out: execFileSync('node', ['scripts/product-status-migrate.mjs', ...args], { env: { ...process.env, DB_PATH: DBP }, encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const statuses = () => Object.fromEntries(all("SELECT sku, status, not_launching_from FROM products WHERE sku LIKE 'ZZ-MIG-%'").map((x) => [x.sku, `${x.status}|${x.not_launching_from ?? ''}`]));
const pre = statuses();
let m = run();
t('1. dry run reports the moves and writes nothing', m.code === 0 && /DRY RUN/.test(m.out) && /ZZ-MIG-2\s+in_development\s+→ ready/.test(m.out) && JSON.stringify(statuses()) === JSON.stringify(pre), m.out.slice(0, 400));
t('1. dry run: every GTIN unchanged', JSON.stringify(all('SELECT sku, gtin, gtin_inner, gtin_case FROM products ORDER BY sku')) === gtinsBefore);
m = run('--apply');
const post = statuses();
t('2. --apply writes the slugs', m.code === 0 && post['ZZ-MIG-1'] === 'draft|' && post['ZZ-MIG-2'] === 'ready|' && post['ZZ-MIG-3'] === 'ready|' && post['ZZ-MIG-4'] === 'hold|' && post['ZZ-MIG-5'] === 'discontinued|' && post['ZZ-MIG-6'] === 'active|', JSON.stringify(post) + m.out.slice(-300));
t('2. not_launching kept, its reason intact, its "from" moved to a slug', post['ZZ-MIG-7'] === 'not_launching|ready' && one("SELECT not_launching_reason r FROM products WHERE sku = 'ZZ-MIG-7'").r === 'fixture reason');
t('2. --apply: every GTIN unchanged', JSON.stringify(all('SELECT sku, gtin, gtin_inner, gtin_case FROM products ORDER BY sku')) === gtinsBefore);
t('2. one audit row per product moved', all("SELECT 1 FROM audit_log WHERE action = 'product_status_migrated'").length >= 5);
m = run('--apply');
t('2. a second --apply moves nothing (idempotent)', m.code === 0 && /Nothing to do/.test(m.out) && JSON.stringify(statuses()) === JSON.stringify(post));
m = run('--undo');
const undone = statuses();
t('2. --undo puts every moved row back', m.code === 0 && undone['ZZ-MIG-1'] === 'Draft|' && undone['ZZ-MIG-2'] === 'in_development|' && undone['ZZ-MIG-7'] === 'not_launching|in_development', JSON.stringify(undone));
t('2. --undo: every GTIN unchanged', JSON.stringify(all('SELECT sku, gtin, gtin_inner, gtin_case FROM products ORDER BY sku')) === gtinsBefore);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
