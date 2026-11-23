// D-373: GET /api/records must not drop rows from a LOOKUP.
//
// Before this, every type stopped at its newest 500 rows and `truncated` only
// fired when the MERGED list passed 500 — so a lot with 863 production entries
// came back as 500, and the answer said nothing was missing. A recall built on
// that is short by a third and nobody can see it.
//
// What this proves:
//   - a lot, a person and a machine lookup each return EVERY matching row (650
//     production entries on one lot, all of them back);
//   - an unfiltered read is still capped at 500 per type, and names the type it
//     cut in `truncated_types` with `truncated: true`, even when that one type
//     is the whole answer;
//   - a smaller `limit` on an unfiltered read is honoured and reported the same way.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5180;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES ('rc-a', 'Cap Admin', 'Cap Admin', 'admin', 'quality', 1, NULL, 'SC-rc-a', datetime('now','+7 day'))`).run();

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
await call('POST', '/users/set-password', { user_id: 'rc-a', password: 'CapAdmin2026!', setup_code: 'SC-rc-a' });
const tok = (await call('POST', '/users/login', { name: 'Cap Admin', password: 'CapAdmin2026!' })).body?.token;
const A = { ...H, Authorization: `Bearer ${tok}` };

console.log('── seeding: 650 production entries on one lot, plus 30 on another ──');
const LOT = 'LOT-CAP-650';
const ins = db.prepare(`INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, start_time, end_time,
  quantity_completed, people_count, submitted_by) VALUES (?, ?, 'Batching', 'Batching 1', 'Cap Test Blend', ?, ?, '06:00', '14:00', 100, 3, ?)`);
const day = (i) => { const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000); return d.toISOString().slice(0, 10); };
db.transaction(() => {
  for (let i = 0; i < 650; i++) ins.run(`rc-${i}`, day(i), `MO-CAP-${i}`, LOT, 'Cap Filer');
  for (let i = 0; i < 30; i++) ins.run(`rc-o-${i}`, day(i), `MO-OTHER-${i}`, 'LOT-OTHER', 'Other Filer');
})();
const onLot = db.prepare('SELECT COUNT(*) n FROM production_entries WHERE lot_number = ?').get(LOT).n;
const allProd = db.prepare('SELECT COUNT(*) n FROM production_entries').get().n;
t('650 entries on the lot in the table', onLot === 650, String(onLot));

// A sanitation record on a machine, 520 of them, so the machine lookup is over the cap too.
const eq = db.prepare("SELECT id FROM equipment WHERE status = 'active' LIMIT 1").get()?.id;
const san = db.prepare(`INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, result, equipment_id)
  VALUES (?, 'Batching 1', 'pre_op', 'Cap Cleaner', ?, 'pass', ?)`);
if (eq) db.transaction(() => { for (let i = 0; i < 520; i++) san.run(`rc-s-${i}`, `${day(i)} 08:00:00`, eq); })();

console.log('\n── a lookup returns every matching row ──');
let r = await call('GET', `/records?lot=${encodeURIComponent(LOT)}`, undefined, A);
const prodRows = (r.body?.records || []).filter(x => x.type === 'production');
t('lot lookup: all 650 production entries come back', r.status === 200 && prodRows.length === 650, `${r.status} ${prodRows.length}`);
t('lot lookup: only that lot', prodRows.every(x => (x.lots || []).includes(LOT)));
t('lot lookup: uncapped and not truncated', r.body?.capped === false && r.body?.truncated === false && (r.body?.truncated_types || []).length === 0, JSON.stringify({ c: r.body?.capped, t: r.body?.truncated }));

r = await call('GET', '/records?person=Cap%20Filer&type=production', undefined, A);
t('person lookup: all 650 of that person\'s entries', r.body?.records?.length === 650 && r.body?.truncated === false, String(r.body?.records?.length));

if (eq) {
  r = await call('GET', `/records?equipment=${encodeURIComponent(eq)}&type=sanitation`, undefined, A);
  t('machine lookup: all 520 cleans on that machine', r.body?.records?.length === 520 && r.body?.truncated === false, String(r.body?.records?.length));
} else t('an active machine exists to look up', false);

console.log('\n── an unfiltered read is capped, and says so per type ──');
r = await call('GET', '/records?type=production', undefined, A);
t(`unfiltered production: 500 of ${allProd} returned`, r.body?.records?.length === 500, String(r.body?.records?.length));
t('…and production is named as truncated, with truncated=true', r.body?.truncated === true && r.body?.capped === true
  && (r.body?.truncated_types || []).includes('production'), JSON.stringify({ t: r.body?.truncated, tt: r.body?.truncated_types }));
r = await call('GET', '/records', undefined, A);
t('unfiltered across all types: production still named as cut', (r.body?.truncated_types || []).includes('production') && r.body?.truncated === true);
t('…and sanitation too', (r.body?.truncated_types || []).includes('sanitation'));
r = await call('GET', '/records?type=production&limit=20', undefined, A);
t('a smaller limit is honoured and reported', r.body?.records?.length === 20 && r.body?.truncated_types?.includes('production'));
r = await call('GET', '/records?type=production&team=Nobody', undefined, A);
t('a read under the cap is not truncated', r.body?.truncated === false && (r.body?.truncated_types || []).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
