// verify:mmrgate — D-133 (roadmap C2), live on a fresh database.
//
// The run names its approved MMR, and the SKU carries its shelf-life basis.
//   · `mmr_ref` on the schedule assignment and the EOD MO line, mirrored to the
//     scalar; the gate off / warn (default) / on; warn STAMPS, on REFUSES the
//     cell and the line, naming the MO; a cleaning-only shift is not asked;
//     the edit path refuses only the REMOVAL of a reference; the report for
//     the visit reads off production_entries.
//   · `stability_justifications.basis_kind` required on a new justification;
//     the SKU's date type DERIVED from the kind in force: expiration only with
//     data, best by otherwise and for a SKU with nothing recorded; a gap on
//     Completeness; on the drawer; master.csv's eighteenth column, the first
//     sixteen byte-identical to the proofer's contract.
//   · The CSV importer recognises the packaging spec's columns (wind direction,
//     trim length, trim width, print …), names the spec they come from and
//     reports a mismatch — and writes none of them.
//   · No MMR table exists (check:ncstatus's assertion stands).
//
// Caller sets PORT + DBPATH, and PRODUCT_MASTER_TOKEN on the server. Needs a
// built client. The control is `main` before this change and fails before the
// first schedule assertion can run.
import Database from 'better-sqlite3';
import { MASTER_CSV_SOURCES } from '../shared/product-fields.js';

// The proofer's sixteen, spelled out HERE rather than imported: a control run
// on code without the export must still reach the assertion, and the contract
// is with a parser in another repository, not with our own constant.
const MASTER_CSV_CONTRACT = ['sku', 'gtin', 'flavor', 'packaging type', 'material', 'zipper', 'print', 'trim length', 'trim width', 'gusset dimension', 'front panel dimension', 'wind direction', 'pms spot colors', 'hex spot colors', 'eye mark color', 'die line required'];

const PORT = process.env.PORT || 5049;
const URL = process.env.APP || `http://localhost:${PORT}`;
const B = `${URL}/api`;
const PT = process.env.PROOF_TOKEN || 'mmr-token';
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
const GRANTS = JSON.stringify({ 'production-log': 'edit', 'production-schedule': 'edit', 'production-eod': 'edit', 'retention-samples': 'edit', products: 'edit' });
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('mg-adm','Lowry Gate','Lowry Gate','admin','qa',1,'SC-mga',datetime('now','+7 day'),NULL)`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('mg-qa','Maria Gate','Maria Gate','supervisor','qa',1,'SC-mgq',datetime('now','+7 day'),?)`).run(GRANTS);
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(B + p, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (name, id, pw, code) => { await call('POST', '/users/login', { name }); await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code }); return (await J(await call('POST', '/users/login', { name, password: pw })))?.token; };
const A = await login('Lowry Gate', 'mg-adm', 'LowryGate2026!!', 'SC-mga');
const Q = await login('Maria Gate', 'mg-qa', 'MariaGate2026!!', 'SC-mgq');
t('an admin and a QA supervisor signed in', !!A && !!Q);

const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(today);
const monday = (() => { const d = new Date(today); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0, 0, 0, 0); return d; })();
const WEEK = iso(monday);
const entryRow = (id) => db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id);
const schedRow = (id) => db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(id);
const filling = (extra = {}) => ({ date: TODAY, team: 'Filling', room: 'Room 1', line: 'sticks', product_name: 'Whey Blueberry Muffin', mo_number: 'MO-MG-F1', lot_number: 'L-F1', start_time: '06:00', end_time: '14:00', quantity_completed: 1200, people_count: 4, submitted_by: 'Maria Gate', ...extra });
const batching = (lines, extra = {}) => ({ date: TODAY, team: 'Batching', room: 'Batching 1', people_count: 2, submitted_by: 'Maria Gate',
  mo_lines: lines.map((l, i) => ({ product_name: `Blend ${i + 1}`, mo_number: `MO-MG-B${i + 1}`, lot_number: `L-B${i + 1}`, room: 'Batching 1', work_stages: ['Blended'], batches: 1, quantity: 300, start_time: `0${7 + i}:00`, end_time: `0${8 + i}:00`, ...l })), ...extra });
const cleanOnly = () => ({ date: TODAY, team: 'Batching', room: 'Batching 2', people_count: 1, submitted_by: 'Maria Gate', mo_lines: [],
  cleaning_events: [{ level: 'Full Clean', scope: ['Room'], room: 'Batching 2', atp_swab: true, allergen_swab: false, start_time: '06:30', end_time: '07:30' }] });

console.log('\n── the gate opens in warn mode ──');
let g = await J(await call('GET', '/production/mmr-gate', null, Q));
t('the gate reads WARN by default, three modes offered, the report since 14 October 2026', g?.mode === 'warn' && g?.modes?.join() === 'off,warn,on' && g?.since === '2026-10-14', JSON.stringify(g)?.slice(0, 160));
t('no MMR table exists in the database (the record is Keychain\'s — check:ncstatus\'s assertion)', db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table' AND (name LIKE '%mmr%' OR name LIKE 'master_manufacturing%')").get().c === 0);

console.log('\n── the schedule assignment names its MMR ──');
let r = await call('POST', '/production/schedule', { week_start: WEEK, day_of_week: 0, room: 'Batching 1', room_type: 'batching', team: 'Batching', mo_number: 'MO-MG-1', product_name: 'Whey Blueberry Muffin', updated_by: 'Lowry Gate' }, A);
let cell = await J(r);
t('under WARN a run is scheduled without a reference', r.status === 201 && cell?.mmr_ref === null, `${r.status} ${JSON.stringify(cell)?.slice(0, 120)}`);
r = await call('POST', '/production/schedule', { week_start: WEEK, day_of_week: 0, room: 'Batching 1', slot: 0, room_type: 'batching', team: 'Batching', mo_number: 'MO-MG-1', product_name: 'Whey Blueberry Muffin', mmr_ref: '  MMR-0042   rev 3 ', updated_by: 'Lowry Gate' }, A);
cell = await J(r);
t('the same cell takes the reference on update, trimmed and single-spaced', r.status === 200 && cell?.mmr_ref === 'MMR-0042 rev 3', `${r.status} ${cell?.mmr_ref}`);
r = await call('POST', '/production/schedule', { week_start: WEEK, day_of_week: 0, room: 'Batching 1', slot: 0, room_type: 'batching', team: 'Batching', mo_number: 'MO-MG-1', product_name: 'Whey Blueberry Muffin', notes: 'a note', updated_by: 'Lowry Gate' }, A);
t('an update that does not mention mmr_ref leaves it alone', (await J(r))?.mmr_ref === 'MMR-0042 rev 3');
const week = await J(await call('GET', `/production/schedule?week_start=${WEEK}`, null, Q));
t('the week payload carries the reference on the assignment', week?.assignments?.find(a => a.id === cell.id)?.mmr_ref === 'MMR-0042 rev 3');
r = await call('POST', '/production/schedule/duplicate-day', { week_start: WEEK, source_day: 0, target_days: [2], include_cleaning: false, updated_by: 'Lowry Gate' }, A);
const copied = db.prepare('SELECT * FROM production_schedule WHERE week_start = ? AND day_of_week = 2 AND mo_number = ?').get(WEEK, 'MO-MG-1');
t('copying the day carries the MMR reference onto the copy', r.status === 200 && copied?.mmr_ref === 'MMR-0042 rev 3', `${r.status} ${copied?.mmr_ref}`);

console.log('\n── the EOD line names its MMR; warn stamps the mode ──');
r = await call('POST', '/production/entries', filling(), Q);
const e1 = await J(r);
t('under WARN a single-MO entry files with no reference, stamped with the mode', r.status === 201 && e1?.mmr_ref === null && e1?.mmr_gate_mode === 'warn', `${r.status} ${e1?.mmr_gate_mode}`);
r = await call('POST', '/production/entries', batching([{ mmr_ref: 'MMR-0100 rev 1' }, { mmr_ref: 'MMR-0101 rev 2' }]), Q);
const e2 = await J(r);
t('a two-MO Batching entry keeps a reference per LINE…', r.status === 201 && e2?.mo_lines?.[0]?.mmr_ref === 'MMR-0100 rev 1' && e2?.mo_lines?.[1]?.mmr_ref === 'MMR-0101 rev 2', `${r.status}`);
t('…and line 0 mirrors to the scalar', e2?.mmr_ref === 'MMR-0100 rev 1', `${e2?.mmr_ref}`);
r = await call('POST', '/production/entries', cleanOnly(), Q);
const e3 = await J(r);
t('a cleaning-only shift names no run and carries no gate stamp', r.status === 201 && e3?.mmr_gate_mode === null && e3?.mmr_ref === null, `${r.status} ${e3?.mmr_gate_mode}`);
g = await J(await call('GET', `/production/mmr-gate?since=${TODAY}`, null, A));
t('the report counts three runs today: two named, one filed without', g?.runs_total === 3 && g?.runs_named === 2 && g?.runs_unnamed === 1, JSON.stringify(g)?.slice(0, 200));
t('…and names the unnamed one by its MO, date and filer', g?.unnamed?.[0]?.mo_number === 'MO-MG-F1' && g.unnamed[0].date === TODAY && g.unnamed[0].submitted_by === 'Maria Gate' && g.unnamed[0].gate_mode === 'warn');
t('every figure is the length of the rows under it', g?.runs_total === g?.runs_named + g?.runs_unnamed && g?.unnamed?.length === g?.runs_unnamed);

console.log('\n── enforcing ──');
r = await call('PUT', '/production/mmr-gate', { mode: 'on' }, Q);
t('a QA supervisor cannot move the mode — an admin decision', r.status === 403);
r = await call('PUT', '/production/mmr-gate', { mode: 'sideways' }, A);
t('an unknown mode is refused', r.status === 400);
r = await call('PUT', '/production/mmr-gate', { mode: 'on' }, A);
t('the admin enforces the gate, audited', r.status === 200 && (await J(r))?.mode === 'on' && !!db.prepare("SELECT 1 FROM audit_log WHERE action = 'mmr_gate_changed' OR entity_id = 'mmr_gate'").get());
r = await call('POST', '/production/schedule', { week_start: WEEK, day_of_week: 1, room: 'Batching 1', room_type: 'batching', team: 'Batching', mo_number: 'MO-MG-2', product_name: 'Whey Peach Cobbler', updated_by: 'Lowry Gate' }, A);
let b = await J(r);
t('a schedule cell that names a run is REFUSED without the reference (400 MMR_REQUIRED)…', r.status === 400 && b?.code === 'MMR_REQUIRED', `${r.status} ${b?.code}`);
t('…naming the MO in the refusal', /MO-MG-2/.test(b?.error || '') && b?.missing?.[0] === 'MO-MG-2', b?.error);
t('…and nothing was written', !db.prepare('SELECT 1 FROM production_schedule WHERE mo_number = ?').get('MO-MG-2'));
r = await call('POST', '/production/schedule', { week_start: WEEK, day_of_week: 1, room: 'Room 3', room_type: 'production', team: 'Kitting', updated_by: 'Lowry Gate' }, A);
t('a cell that only sets a team is not a run and is not asked', r.status === 201, `${r.status}`);
r = await call('POST', '/production/schedule', { week_start: WEEK, day_of_week: 1, room: 'Batching 1', room_type: 'batching', team: 'Batching', mo_number: 'MO-MG-2', product_name: 'Whey Peach Cobbler', mmr_ref: 'MMR-0043 rev 1', updated_by: 'Lowry Gate' }, A);
t('with the reference the cell is scheduled', r.status === 201 && (await J(r))?.mmr_ref === 'MMR-0043 rev 1', `${r.status}`);

r = await call('POST', '/production/entries', filling({ mo_number: 'MO-MG-F2' }), Q);
b = await J(r);
t('an EOD entry that names a run is REFUSED without the reference', r.status === 400 && b?.code === 'MMR_REQUIRED' && /MO-MG-F2/.test(b?.error || ''), `${r.status} ${b?.error}`);
r = await call('POST', '/production/entries', batching([{ mmr_ref: 'MMR-0100 rev 1' }, { mmr_ref: '' }]), Q);
b = await J(r);
t('a two-MO entry with one line unnamed is refused naming THAT line only', r.status === 400 && b?.missing?.length === 1 && b.missing[0] === 'MO-MG-B2', `${r.status} ${JSON.stringify(b?.missing)}`);
r = await call('POST', '/production/entries', batching([{ mmr_ref: 'MMR-0100 rev 1' }, { mmr_ref: 'MMR-0101 rev 2' }], { date: TODAY }), Q);
const e4 = await J(r);
t('with both references the entry files, stamped ON', r.status === 201 && e4?.mmr_gate_mode === 'on' && e4?.mmr_ref === 'MMR-0100 rev 1', `${r.status}`);
r = await call('POST', '/production/entries', filling({ mo_number: 'MO-MG-F3', mmr_ref: 'MMR-0044 rev 2' }), Q);
const e5 = await J(r);
t('a single-MO entry with its reference files', r.status === 201 && e5?.mmr_ref === 'MMR-0044 rev 2', `${r.status}`);
r = await call('POST', '/production/entries', cleanOnly(), Q);
t('a cleaning-only shift still files under ON — nothing to have a master record for', r.status === 201, `${r.status}`);

console.log('\n── the edit path refuses only the removal ──');
r = await call('PUT', `/production/entries/${e1.id}`, { notes: 'typo corrected', reason: 'the note named the wrong sifter' }, A);
t('an entry filed WITHOUT a reference under warn still takes an ordinary correction under ON', r.status === 200, `${r.status} ${(await J(r))?.error || ''}`);
const strip = (lines, i) => lines.map((l, j) => (j === i ? { ...l, mmr_ref: '' } : l));
r = await call('PUT', `/production/entries/${e4.id}`, { mo_lines: strip(e4.mo_lines, 1), reason: 'removing the reference from line two' }, A);
b = await J(r);
t('removing a line\'s reference on amend is refused, naming the MO', r.status === 400 && b?.code === 'MMR_REQUIRED' && b?.missing?.[0] === 'MO-MG-B2', `${r.status} ${JSON.stringify(b)?.slice(0, 160)}`);
t('…and the record is untouched', JSON.parse(entryRow(e4.id).mo_lines)[1].mmr_ref === 'MMR-0101 rev 2');
r = await call('PUT', `/production/entries/${e4.id}`, { mo_lines: e4.mo_lines.map((l, j) => (j === 0 ? { ...l, mmr_ref: 'MMR-0100 rev 2' } : l)), reason: 'line one was made to revision 2' }, A);
t('correcting line 0\'s reference is taken and the scalar follows', r.status === 200 && entryRow(e4.id).mmr_ref === 'MMR-0100 rev 2', `${r.status} ${entryRow(e4.id).mmr_ref}`);
r = await call('PUT', `/production/entries/${e5.id}`, { mmr_ref: '', reason: 'clearing the reference by mistake' }, A);
t('clearing a single-MO entry\'s reference is refused', r.status === 400 && (await J(r))?.code === 'MMR_REQUIRED', `${r.status}`);
r = await call('PUT', `/production/entries/${e5.id}`, { mmr_ref: 'MMR-0044 rev 3', reason: 'the run was made to revision 3' }, A);
t('correcting it to another reference is taken and recorded as an amendment', r.status === 200 && entryRow(e5.id).mmr_ref === 'MMR-0044 rev 3' && JSON.parse(entryRow(e5.id).amendments).some(a => a.changes.some(c => c.field === 'mmr_ref')));
r = await call('PUT', `/production/entries/${e4.id}`, { mmr_ref: 'MMR-9999 rev 9', reason: 'typing the mirror directly' }, A);
t('on a multi-MO entry the scalar is a mirror and is refused as a direct edit', r.status === 400 && (await J(r))?.mirrored?.includes('mmr_ref'), `${r.status}`);
g = await J(await call('GET', `/production/mmr-gate?since=${TODAY}`, null, A));
t('the report now reads 6 runs, 5 named, 1 without — the warn-era Filling run', g?.runs_total === 6 && g?.runs_named === 5 && g?.runs_unnamed === 1 && g.unnamed[0].mo_number === 'MO-MG-F1', JSON.stringify(g)?.slice(0, 200));

console.log('\n── the shelf-life basis, and the date type derived from it ──');
const SKUS = db.prepare("SELECT sku FROM products WHERE status = 'active' AND spec_id = 'SPEC-STICK-LG' ORDER BY sku LIMIT 4").all().map(x => x.sku);
const [SA, SB, SC, SD] = SKUS;
t('four active stick SKUs to work on', SKUS.length === 4, JSON.stringify(SKUS));
const just = (body) => call('POST', '/stability/justifications', { product_family: 'Whey sticks', shelf_life_months: 18, basis: 'Ingredient stability data on file for the whey base; packaging protection per the film spec.', ...body }, Q);
r = await just({ product_skus: SA });
b = await J(r);
t('a justification with no KIND is refused, naming the four kinds', r.status === 400 && b?.basis_kinds?.join() === 'client_data,in_house_study,read_across,none_best_by', `${r.status} ${b?.error}`);
r = await just({ product_skus: SA, basis_kind: 'guess' });
t('an unknown kind is refused', r.status === 400);
r = await just({ product_skus: SA, basis_kind: 'none_best_by', basis: 'No stability data from the client; the pack prints Best by until data arrives.' });
b = await J(r);
t('"no data — Best by" files and derives best_by', r.status === 201 && b?.justification?.basis_kind === 'none_best_by' && b?.justification?.date_type === 'best_by', `${r.status} ${JSON.stringify(b?.justification)?.slice(0, 120)}`);
r = await just({ product_skus: SB, basis_kind: 'client_data', document_ref: 'Client stability summary 2026-06' });
b = await J(r);
t('client data files and derives an expiration date', r.status === 201 && b?.justification?.date_type === 'expiration');
const pa = await J(await call('GET', `/products/${SA}`, null, Q));
const pb = await J(await call('GET', `/products/${SB}`, null, Q));
const pc = await J(await call('GET', `/products/${SC}`, null, Q));
t('GET /products/:sku carries shelf_life — Best by with its basis on A', pa?.shelf_life?.recorded === true && pa.shelf_life.date_type === 'best_by' && pa.shelf_life.basis_kind === 'none_best_by' && pa.shelf_life.basis_label === 'No data — Best by', JSON.stringify(pa?.shelf_life));
t('…an expiration date on B', pb?.shelf_life?.date_type === 'expiration' && pb.shelf_life.basis_kind === 'client_data' && pb.shelf_life.shelf_life_months === 18);
t('…and NOT RECORDED, best by, on C, which no justification names', pc?.shelf_life?.recorded === false && pc.shelf_life.date_type === 'best_by' && pc.shelf_life.basis_kind === null, JSON.stringify(pc?.shelf_life));
t('nothing was written to the product row', db.prepare('PRAGMA table_info(products)').all().every(c => !/shelf_life|date_type|basis_kind/.test(c.name)));
let comp = await J(await call('GET', '/products/completeness', null, Q));
const compOf = (s) => comp?.rows?.find(x => x.sku === s);
t('Completeness names "Shelf-life basis" as a Formula gap on C and not on A or B', compOf(SC)?.groups?.formula?.missing?.includes('Shelf-life basis') && !compOf(SA)?.missing?.some(m => /Shelf-life/.test(m)) && !compOf(SB)?.missing?.some(m => /Shelf-life/.test(m)), JSON.stringify(compOf(SC)?.groups?.formula));
t('the roll-up counts the SKUs with no basis as the length of the rows without one', comp?.counts?.no_shelf_life_basis === comp?.rows?.filter(x => !x.shelf_life?.recorded).length && comp.counts.no_shelf_life_basis === comp.rows.length - 2, `${comp?.counts?.no_shelf_life_basis} / ${comp?.rows?.length}`);
t('each row carries its date type', compOf(SA)?.shelf_life?.date_type === 'best_by' && compOf(SB)?.shelf_life?.date_type === 'expiration' && compOf(SC)?.shelf_life?.recorded === false);
r = await just({ product_skus: SA, basis_kind: 'client_data', decided_on: TODAY, basis: 'The client sent 18-month real-time data on 29 September.' });
const pa2 = await J(await call('GET', `/products/${SA}`, null, Q));
t('a later justification for A supersedes: the date type moves to expiration with nothing rewritten', r.status === 201 && pa2?.shelf_life?.date_type === 'expiration' && pa2.shelf_life.basis_kind === 'client_data');
// A row filed before kinds existed: on file, unclassified.
db.prepare(`INSERT INTO stability_justifications (id, product_family, product_skus, shelf_life_months, basis_type, basis, decided_by, decided_on) VALUES ('pre-c2', 'Legacy', ?, 12, 'interim', 'Interim justification written before kinds existed.', 'Maria', '2026-09-01')`).run(JSON.stringify([SD]));
const pd = await J(await call('GET', `/products/${SD}`, null, Q));
comp = await J(await call('GET', '/products/completeness', null, Q));
t('a pre-existing justification with no kind reads recorded, KIND MISSING, best by — never promoted to an expiration date', pd?.shelf_life?.recorded === true && pd.shelf_life.kind_missing === true && pd.shelf_life.date_type === 'best_by', JSON.stringify(pd?.shelf_life));
t('…and Completeness names "Shelf-life basis kind" on it', compOf(SD)?.groups?.formula?.missing?.includes('Shelf-life basis kind'), JSON.stringify(compOf(SD)?.groups?.formula));
const jl = await J(await call('GET', '/stability/justifications', null, Q));
t('the justification list carries kind and date type per row and offers the kinds', jl?.basis_kinds?.length === 4 && jl?.justifications?.some(j => j.basis_kind === 'client_data' && j.date_type === 'expiration'));

console.log('\n── master.csv: eighteen columns, the first sixteen untouched ──');
const csv = await (await fetch(`${B}/products/master.csv?token=${PT}`)).text();
const lines = csv.split('\n');
const headers = lines[0].split(',');
t('the header has eighteen columns', headers.length === 18, `${headers.length}: ${lines[0]}`);
t('the first sixteen are the proofer\'s contract, byte for byte', headers.slice(0, 16).join(',') === MASTER_CSV_CONTRACT.join(','), headers.slice(0, 16).join(','));
t('then fill weight (g), then date type — and MASTER_CSV_SOURCES agrees', headers[16] === 'fill weight (g)' && headers[17] === 'date type' && MASTER_CSV_SOURCES.map(([n]) => n).join(',') === headers.join(','));
const cellOf = (sku, i) => { const row = lines.find(l => l.startsWith(sku + ',')); return row ? row.split(',')[i] : undefined; };
t('the proofer reads "expiration" for A and B, "best by" for C (nothing recorded) and D (kind missing)', cellOf(SA, 17) === 'expiration' && cellOf(SB, 17) === 'expiration' && cellOf(SC, 17) === 'best by' && cellOf(SD, 17) === 'best by', [SA, SB, SC, SD].map(s => cellOf(s, 17)).join('|'));
t('every row reads one of the two values', lines.slice(1).filter(Boolean).every(l => /,(expiration|best by)$/.test(l)));

console.log('\n── the importer recognises the packaging spec\'s columns and writes none of them ──');
const spec = db.prepare("SELECT * FROM packaging_specs WHERE spec_id = 'SPEC-STICK-LG'").get();
const before = { ...spec };
const EYE = db.prepare('SELECT eyemark_color FROM products WHERE sku = ?').get(SC).eyemark_color === 'black' ? 'white' : 'black';
const file = `sku,wind direction,trim length,trim width,print,eye mark color\n${SC},${spec.wind_direction},180,${spec.trim_width_mm},Flexo,${EYE}\n`;
r = await call('POST', '/products/import/preview', { csv: file }, Q);
let plan = await J(r);
t('wind direction, trim length, trim width and print are RECOGNISED — none is "ignored"', r.status === 200 && plan?.unknown_columns?.length === 0, `${r.status} ${JSON.stringify(plan?.unknown_columns)}`);
t('the plan lists the four as packaging-spec columns, each with the column it is read from', plan?.derived_columns?.length === 4 && plan.derived_columns.every(d => /packaging_specs\./.test(d.source)) && plan.derived_columns.map(d => d.column).join() === 'wind_direction,trim_length_mm,trim_width_mm,print_process', JSON.stringify(plan?.derived_columns));
t('two cells differ from the spec and are reported as MISMATCHES naming the spec', plan?.counts?.spec_mismatches === 2 && plan.spec_mismatches.every(m => m.spec_id === 'SPEC-STICK-LG' && m.sku === SC) && plan.spec_mismatches.map(m => m.column).sort().join() === 'print_process,trim_length_mm', JSON.stringify(plan?.spec_mismatches));
t('…with the file value and the spec value side by side', plan?.spec_mismatches?.find(m => m.column === 'trim_length_mm')?.file_value === '180' && plan.spec_mismatches.find(m => m.column === 'trim_length_mm').spec_value === '175');
t('the only CHANGE is the eye mark — a products column', plan?.counts?.changes === 1 && plan.rows?.[0]?.changes?.[0]?.field === 'eyemark_color' && plan.rows[0].changes.every(c => c.field !== 'trim_length_mm'), JSON.stringify(plan?.rows));
r = await call('POST', '/products/import/commit', { csv: file }, Q);
const after = db.prepare("SELECT * FROM packaging_specs WHERE spec_id = 'SPEC-STICK-LG'").get();
t('commit writes the eye mark and NOTHING on the spec', r.status === 200 && (await J(r))?.applied === 1 && db.prepare('SELECT eyemark_color FROM products WHERE sku = ?').get(SC).eyemark_color === EYE && JSON.stringify(after) === JSON.stringify(before), `${r.status}`);
r = await call('POST', '/products/import/preview', { csv: `sku,wind_direction,trim_length_mm,material\n${SC},${spec.wind_direction},${spec.trim_length_mm},${spec.material_structure}\n` }, Q);
plan = await J(r);
t('the snake_case spellings (wind_direction, trim_length_mm) and material are recognised too', r.status === 200 && plan?.unknown_columns?.length === 0 && plan?.derived_columns?.length === 3);
t('a file carrying only spec columns that all match changes nothing and reports no mismatch', plan?.rows?.length === 0 && plan?.counts?.spec_mismatches === 0 && plan?.counts?.changes === 0);
r = await call('POST', '/products/import/preview', { csv: `sku,wind direction,made up\n${SC},9,x\n` }, Q);
plan = await J(r);
t('an unknown column is still reported as ignored; the spec column beside it is not', plan?.unknown_columns?.join() === 'made up' && plan?.derived_columns?.length === 1 && plan?.counts?.spec_mismatches === 1);

console.log('\n── in a browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'mg-adm', name: 'Lowry Gate', role: 'admin' })); }, [A]);

  await page.goto(`${URL}/?tab=production-log`);
  await page.waitForSelector('[data-mmr-gate]', { timeout: 20000 }).catch(() => {});
  t('the Production Log shows the MMR gate strip, enforcing', await page.locator('[data-mmr-gate="on"]').count() === 1);
  g = await J(await call('GET', '/production/mmr-gate', null, A));
  t('…with the named / unnamed counts the API reports', Number(await page.locator('[data-mmr-named]').getAttribute('data-mmr-named')) === g.runs_named && Number(await page.locator('[data-mmr-unnamed]').getAttribute('data-mmr-unnamed')) === g.runs_unnamed);
  t('…and the mode control for the admin', await page.locator('[data-mmr-gate-mode]').count() === 1);
  t('a filed run shows its MMR on the log', await page.locator('[data-entry-mmr]').count() >= 1 || await page.locator('[data-line-mmr]').count() >= 1);
  await page.getByRole('tab', { name: /Entry Form/ }).click();
  await page.waitForSelector('[data-entry-mmr-ref], form select', { timeout: 8000 }).catch(() => {});
  const teamSelect = page.locator('form select').filter({ has: page.locator('option[value="Batching"]') }).first();
  await teamSelect.selectOption('Filling');
  await page.waitForTimeout(200);
  t('the single-MO entry form has the Approved MMR box', await page.locator('[data-entry-mmr-ref]').count() === 1);
  await teamSelect.selectOption('Batching');
  await page.waitForTimeout(200);
  t('the Batching form has the box on each MO line', await page.locator('[data-mo-mmr-ref]').count() >= 1);

  await page.goto(`${URL}/?tab=production-schedule`);
  await page.waitForSelector('text=MO-MG-1', { timeout: 20000 }).catch(() => {});
  t('the schedule grid prints the reference under the run', await page.locator('[data-cell-mmr]', { hasText: 'MMR-0042 rev 3' }).count() >= 1);
  // The mobile day cards render the same text hidden below md; click the visible one.
  await page.locator('text=MO-MG-1 >> visible=true').first().click();
  await page.waitForSelector('[data-cell-mmr-ref]', { timeout: 8000 }).catch(() => {});
  t('the cell editor carries the Approved MMR box with the stored reference', await page.locator('[data-cell-mmr-ref]').inputValue() === 'MMR-0042 rev 3');
  t('…and says the gate is enforcing', await page.locator('[data-cell-mmr-note="on"]').count() === 1);
  await page.locator('[data-cell-mmr-ref]').fill('');
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await page.waitForSelector('[data-cell-save-error]', { timeout: 8000 }).catch(() => {});
  t('saving the cell with the reference cleared is refused ON SCREEN, naming the MO', /MO-MG-1/.test(await page.locator('[data-cell-save-error]').textContent().catch(() => '')));
  t('…and the assignment still carries it', schedRow(cell.id).mmr_ref === 'MMR-0042 rev 3');

  await page.goto(`${URL}/?tab=products`);
  await page.waitForSelector(`[data-grid-row="${SC}"] [data-open-row]`, { timeout: 20000 }).catch(() => {});
  await page.locator(`[data-grid-row="${SC}"] [data-open-row]`).click();
  await page.waitForSelector('[data-value="shelf_life"]', { timeout: 8000 }).catch(() => {});
  t('the drawer\'s Formula block says C has no basis recorded and prints Best by', await page.locator('[data-value="shelf_life"][data-basis-recorded="0"][data-date-type="best_by"]').count() === 1 && /no shelf-life basis recorded/.test(await page.locator('[data-value="shelf_life"]').textContent()));
  await page.goto(`${URL}/?tab=products&view=completeness`);
  await page.waitForSelector('[data-completeness-counts]', { timeout: 20000 }).catch(() => {});
  t('Completeness offers the no-basis chip with the roll-up\'s count', (await page.locator('[data-filter="no_basis"]').textContent().catch(() => '')).startsWith(`${comp.counts.no_shelf_life_basis} `));
  await page.locator('[data-filter="no_basis"]').click();
  await page.waitForTimeout(300);
  t('…and clicking it narrows the list to exactly those SKUs', await page.locator('[data-date-type][data-basis-recorded="0"]').count() === comp.counts.no_shelf_life_basis, `${await page.locator('[data-date-type][data-basis-recorded="0"]').count()}`);

  await page.goto(`${URL}/?tab=retention-samples&view=stability`);
  await page.waitForSelector('[data-stability-justify]', { timeout: 20000 }).catch(() => {});
  await page.locator('[data-stability-justify]').click();
  await page.waitForSelector('[data-just-kind]', { timeout: 8000 }).catch(() => {});
  t('recording a basis asks WHAT KIND it is, four kinds offered', await page.locator('[data-just-kind] option').count() === 5);
  await page.close();
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
