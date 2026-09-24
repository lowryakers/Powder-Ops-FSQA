// Brand colours: correctable, and the correction survives a redeploy.
//
// The question this answers is the one that decides whether the field may be
// editable at all — is anything authoritative going to overwrite it? So the
// script does not reason about the seeders, it REBOOTS THE APPLICATION against
// the same database file and reads the value back. Every seeder, every repair
// and every backfill runs again in that second boot.
//
// Caller sets PORT + DBPATH and PRODUCT_MASTER_TOKEN=proof-token on the server.
//
// THE CONTROL: make `seedProducts()` re-run its colour INSERTs as an upsert —
// the shape a "sync" would have — and the four redeploy assertions fail, with
// the corrected Pantone back to what the audit shipped.
import { spawn } from 'child_process';
const PORT = process.env.PORT || 5018;
const BOOT2 = Number(PORT) + 1;
const B = `http://localhost:${PORT}/api`;
const TOKEN = 'proof-token';
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}, base = B) => fetch(base + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b, base = B) => req(p, { method: 'PUT', body: JSON.stringify(b) }, base);
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  // NULL module_access on the admin: a map on an admin is a RESTRICTION map.
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('col-admin','Colour Admin','Colour Admin','admin','qa',1,NULL,'SC-COL',datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('col-op','Colour Operator','Colour Operator','operator','warehouse',1,'{"products":"edit"}','SC-COLOP',datetime('now','+7 day'))`).run();
  db.close();
}
const signIn = async (name, id, pw, code) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await J(await post('/users/login', { name, password: pw })))?.token;
};
token = await signIn('Colour Admin', 'col-admin', 'Colour2026!', 'SC-COL');
t('signed in', !!token);

const colorsOf = async (sku) => (await J(await req(`/products/${encodeURIComponent(sku)}`)))?.colors || [];
const rowOf = (csv, sku) => csv.split('\n').find((l) => l.startsWith(`${sku},`));
const master = () => fetch(`${B}/products/master.csv?token=${TOKEN}`).then((r) => r.text());

console.log('\nThe correction: PANTONE 285 C is a blue, and this slot prints burnt orange');
let pumpkin = await colorsOf('PPM-PS');
t('the pancake Pumpkin Spice has three colours', pumpkin.length === 3, JSON.stringify(pumpkin.map((c) => c.pms)));
const slot2 = pumpkin.find((c) => c.slot === 2);
t('SLOT 2 READS PMS 7580 C, not PMS 285 C', slot2?.pms === 'PMS 7580 C', slot2?.pms);
t('and its hex is untouched — that is the evidence, not the error', slot2?.hex === 'HEX C25131', slot2?.hex);
t('the corrected value is on the feed the proofer reads',
  /PMS 158 C \| PMS 7580 C \| PMS 7506 C/.test(rowOf(await master(), 'PPM-PS') || ''),
  rowOf(await master(), 'PPM-PS'));

console.log('\nEvery OTHER row carrying 285 is a real PANTONE 285 C and was left alone');
const all = await J(await req('/products'));
const list = Array.isArray(all) ? all : (all?.products || []);
const with285 = list.flatMap((p) => (p.colors || [])
  .filter((c) => /\b285\b/.test(c.pms || '')).map((c) => ({ sku: p.sku, ...c })));
t('exactly two rows still carry it', with285.length === 2, JSON.stringify(with285.map((c) => `${c.sku} ${c.pms} ${c.hex}`)));
t('BOTH ARE BLUE (0071CE), which is what PANTONE 285 C is',
  with285.every((c) => /0071CE/i.test(c.hex || '')), JSON.stringify(with285.map((c) => c.hex)));
t('and both are Cookie Crumble, not a pumpkin product',
  with285.every((c) => ['PP-CC-04', 'PSP-CCR'].includes(c.sku)), JSON.stringify(with285.map((c) => c.sku)));

console.log('\nThe other direction: the NAME is right and the HEX was borrowed');
// Three corrections resolved against the artwork PDFs. In the first two the
// Pantone is correct and the hex beside it belongs to a different ink — the
// opposite of the pumpkin case, and the reason a correction has to say which
// of the two it moves.
for (const sku of ['PP-PC-11', 'PSP-PC']) {
  const c = (await colorsOf(sku)).find((x) => x.slot === 3);
  t(`${sku}: 9201 C is the cream F4E1CB the pack actually prints`,
    c?.pms === 'PMS 9201 C' && c?.hex === 'HEX F4E1CB', `${c?.pms} / ${c?.hex}`);
}
for (const sku of ['PP-IM-07', 'PSP-IM']) {
  const c = (await colorsOf(sku)).find((x) => x.slot === 2);
  t(`${sku}: 728 C is the tan C49873, not PMS 367 C's green`,
    c?.pms === 'PMS 728 C' && c?.hex === 'HEX C49873', `${c?.pms} / ${c?.hex}`);
}
// The Toffee Cream beef rows carried both inks correctly all along and are
// what the sweep was disagreeing with. Untouched.
t('the beef rows that were right all along are untouched',
  (await colorsOf('HBF-DDL')).find((c) => c.slot === 1)?.hex === 'HEX C49873'
  && (await colorsOf('HBF-DDL')).find((c) => c.slot === 3)?.hex === 'HEX F4E1CB');
t('and the corrected values are on the feed the proofer reads',
  /C49873/.test(rowOf(await master(), 'PP-IM-07') || '')
  && /F4E1CB/.test(rowOf(await master(), 'PP-PC-11') || ''),
  rowOf(await master(), 'PP-IM-07'));

console.log('\nPNS was a typo for PMS, and correcting it moves VALIDITY');
for (const sku of ['PP-IM-07', 'PSP-IM']) {
  const c = (await colorsOf(sku)).find((x) => x.slot === 3);
  t(`${sku}: reads PMS 9160 C`, c?.pms === 'PMS 9160 C', c?.pms);
  // The value was marked invalid because that is what it said. It names a real
  // ink now, so `pms_valid` has to move with it — re-derived, never carried.
  t(`${sku}: AND pms_valid MOVED WITH IT, 0 to 1`, c?.pms_valid === 1, String(c?.pms_valid));
}
{
  const db = new Database(process.env.DBPATH);
  const left = db.prepare("SELECT COUNT(*) n FROM product_colors WHERE pms LIKE 'PNS%'").get().n;
  db.close();
  t('no PNS value is left anywhere in the catalogue', left === 0, `${left} left`);
}

console.log('\nThe catalogue disagreeing with ITSELF is on the punch list');
// The same Pantone carrying a materially different hex on two rows is internal
// evidence of a bad transcription, and it needs no Pantone book — it is the
// check that would have caught the pumpkin row without anybody holding the pack.
const health = await J(await req('/products/data-health'));
const conflicts = (health?.issues || []).filter((i) => i.kind === 'color_conflict');
t('the sweep still runs and still reports', conflicts.length > 0, `${conflicts.length} rows`);
// Every disagreement is filed against BOTH sides, since neither is more
// suspect than the other and whoever opens the punch list has to reach either.
t('and every disagreement is filed against BOTH sides', conflicts.length % 2 === 0);
t('NOT ONE IS LEFT UNANSWERED once the corrections have landed',
  conflicts.every((i) => i.severity === 'info'),
  JSON.stringify(conflicts.filter((i) => i.severity !== 'info').map((i) => i.detail).slice(0, 2)));
t('the 9201 C and 728 C disagreements are gone entirely',
  !conflicts.some((i) => /9201|728 C/.test(i.detail)),
  conflicts.filter((i) => /9201|728 C/.test(i.detail)).map((i) => i.detail)[0] || '');

// Two are left, and they are two different reasons for being quiet.
const info123 = conflicts.filter((i) => /123 C/.test(i.detail));
const info375 = conflicts.filter((i) => /375 C/.test(i.detail));
t('PMS 123 C is 17 apart and drops on the TOLERANCE alone',
  info123.length > 0 && info123.every((i) => i.severity === 'info')
  && !/Checked against the artwork/.test(info123[0].detail), info123[0]?.detail);
// THE ONE THAT PROVES THE TOLERANCE IS NOT ENOUGH ON ITS OWN: 36 apart, all of
// it in the blue channel of a saturated green, which no number can know.
t('PMS 375 C is 36 apart and is quiet only because a PERSON CHECKED IT',
  info375.length > 0 && info375.every((i) => i.severity === 'info')
  && /Checked against the artwork by Lowry Akers/.test(info375[0].detail), info375[0]?.detail);
t('and the reason travels with it, so nobody asks again',
  /Key Lime/.test(info375[0]?.detail || ''), info375[0]?.detail);

// Work and answers are counted separately, and every figure is the size of a
// set taken off the list under it — a card cannot disagree with its own rows.
t('a checked disagreement is NOT counted as work', health?.counts?.color_conflict === 0,
  String(health?.counts?.color_conflict));
t('it is counted as an answer instead',
  health?.noted?.color_conflict === new Set(conflicts.map((i) => i.sku)).size,
  `${health?.noted?.color_conflict} vs ${new Set(conflicts.map((i) => i.sku)).size}`);
t('and no SKU is on the "needs something" number for an answered one',
  health.affected === new Set((health.issues || []).filter((i) => i.severity !== 'info').map((i) => i.sku)).size);
// A few units apart is two samples of one swatch, not an error, or the ones
// that are real would be buried.
t('near-identical transcriptions of one Pantone are not reported at all',
  !conflicts.some((i) => /4625/.test(i.detail)),
  conflicts.filter((i) => /4625/.test(i.detail)).map((i) => i.detail)[0] || '');

console.log('\nThe field is editable, and a value the proofer could not use is refused');
let r = await put('/products/PPM-PS/colors', { colors: [
  { pms: 'PNS 9160 C', hex: 'HEX EE7623' }] });
let b = await J(r);
t('"PNS" is a typo and is refused, not stored', r.status === 400 && /PNS/.test(b?.error || ''), `${r.status} ${b?.error}`);
r = await put('/products/PPM-PS/colors', { colors: [{ pms: 'PMS 158 C', hex: 'HEX ZZZZZZ' }] });
t('a hex that is not six hex digits is refused', (await J(r))?.error?.includes('ZZZZZZ'), String(r.status));
r = await put('/products/PPM-PS/colors', { colors: [{ pms: 'CMYK 3 1 17 0', hex: 'HEX F6F4DA' }] });
t('a process build is refused — a separation name cannot be matched against it', r.status === 400);
t('and after three refusals the record is untouched',
  (await colorsOf('PPM-PS')).length === 3);

r = await put('/products/PPM-PS/colors', { colors: [
  { pms: 'PMS 158 C', hex: 'HEX EE7623' },
  { pms: 'PMS 7580 C', hex: 'HEX C25131' },
  { pms: 'PMS 7506 C', hex: 'HEX F2DAB2' },
  { pms: 'PMS Black C', hex: 'HEX 000000' },
] });
t('a fourth colour saves', r.status === 200, String(r.status));
pumpkin = await colorsOf('PPM-PS');
t('and the slots renumber 1..4', pumpkin.map((c) => c.slot).join(',') === '1,2,3,4', JSON.stringify(pumpkin.map((c) => c.slot)));
t('VALIDITY IS RECOMPUTED, never taken from the caller',
  pumpkin.every((c) => c.pms_valid === 1 && c.hex_valid === 1));
t('and the new colour is on the feed',
  /PMS Black C/.test(rowOf(await master(), 'PPM-PS') || ''));

// A removal is a real edit — a redesign drops a colour — and the audit entry
// carries the before and the after, so it is in the trail.
r = await put('/products/PPM-PS/colors', { colors: [
  { pms: 'PMS 158 C', hex: 'HEX EE7623' },
  { pms: 'PMS 7580 C', hex: 'HEX C25131' },
  { pms: 'PMS 7506 C', hex: 'HEX F2DAB2' },
] });
t('removing one saves too', r.status === 200 && (await colorsOf('PPM-PS')).length === 3);
const audit = await J(await req('/audit?entity_type=product&entity_id=PPM-PS&limit=50'));
const colourEdits = (audit?.data || []).filter((e) => /"colors"/.test(e.new_state || ''));
t('every colour change is audited', colourEdits.length >= 2, `${colourEdits.length} of ${audit?.total} entries`);
// A removal is the case the before/after matters for: the slot is gone from
// the row and the trail is the only place it still exists.
t('and the entry carries what it was before, including a colour that was removed',
  colourEdits.some((e) => /PMS Black C/.test(e.previous_state || '')),
  String(colourEdits[0]?.previous_state || '').slice(0, 140));

console.log('\nA deliberate edit puts the artwork step back on the punch list');
const stepsOf = async (sku) => (await J(await req(`/products/${encodeURIComponent(sku)}`)))?.readiness?.steps || [];
const target = list.find((p) => (p.colors || []).length > 0 && p.sku !== 'PPM-PS');
await put(`/products/${encodeURIComponent(target.sku)}/colors`, {
  colors: target.colors.map((c) => ({ pms: c.pms, hex: c.hex })) });
let steps = await stepsOf(target.sku);
t('a save that changed nothing changes nothing',
  !steps.find((s) => s.key === 'artwork')?.stale, JSON.stringify(steps.find((s) => s.key === 'artwork')?.state));
await put(`/products/${encodeURIComponent(target.sku)}/colors`, { colors: [
  ...target.colors.map((c) => ({ pms: c.pms, hex: c.hex })),
  { pms: 'PMS 300 C', hex: 'HEX 005EB8' }] });
steps = await stepsOf(target.sku);
const colorsStep = steps.find((s) => s.key === 'colors');
t('the brand-colours step is still satisfied', colorsStep?.state === 'done' || colorsStep?.ok, JSON.stringify(colorsStep?.state));

console.log('\nCorrecting a colour is not an operator\'s call');
const opToken = await signIn('Colour Operator', 'col-op', 'Colour2026!', 'SC-COLOP');
r = await fetch(`${B}/products/PPM-PS/colors`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
  body: JSON.stringify({ colors: [{ pms: 'PMS 1 C', hex: 'HEX 000000' }] }) });
t('an operator holding the module is refused', r.status === 403, String(r.status));
t('and the record is unchanged', (await colorsOf('PPM-PS')).length === 3);

console.log('\nTHE REDEPLOY: every seeder and every repair runs again on this database');

/** Boot the application again on the same file, and hand back its log. */
async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DB_PATH: process.env.DBPATH, PRODUCT_MASTER_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://localhost:${port}/api`;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`${base}/users/lookup?q=zz`); ready = true; break; } catch { /* still booting */ }
  }
  return { proc, base, ready, log: () => log };
}
const lineOf = (log, re) => log.split('\n').filter((l) => re.test(l)).join(' | ').slice(0, 220);

// Put the wrong value back by hand, exactly as the audit shipped it.
const setSlot = (sku, slot, pms, hex) => {
  const db = new Database(process.env.DBPATH);
  const cur = db.prepare('SELECT * FROM product_colors WHERE sku = ? AND slot = ?').get(sku, slot);
  db.prepare('UPDATE product_colors SET pms = ?, hex = ?, pms_valid = ? WHERE sku = ? AND slot = ?')
    .run(pms, hex ?? cur.hex, /^PMS /.test(pms) ? 1 : 0, sku, slot);
  db.close();
};
setSlot('PPM-PS', 2, 'PMS 285 C');
// The three other corrections, put back exactly as the audit shipped them —
// one that moves a hex, and one that moves a value from unusable to an ink.
setSlot('PP-PC-11', 3, 'PMS 9201 C', 'HEX 502C1E');
setSlot('PP-IM-07', 3, 'PNS 9160 C', 'HEX EDEDB2');

const one = await reboot(BOOT2);
t('the application booted again on the same database', one.ready);
const after2 = (await J(await req('/products/PPM-PS', {}, one.base)))?.colors?.find((c) => c.slot === 2);
t('THE CORRECTION IS APPLIED TO A DATABASE THAT HAD THE WRONG VALUE',
  after2?.pms === 'PMS 7580 C', after2?.pms);
t('and it says so in the boot log rather than silently',
  /7580/.test(one.log()) && /brand colour/i.test(one.log()), lineOf(one.log(), /colour/i));
// A correction that moves the HEX, on a database that had the wrong one.
const pc3 = (await J(await req('/products/PP-PC-11', {}, one.base)))?.colors?.find((c) => c.slot === 3);
t('A HEX CORRECTION LANDS THE SAME WAY', pc3?.hex === 'HEX F4E1CB', `${pc3?.pms} / ${pc3?.hex}`);
// And the one that moves validity: the stored verdict is re-derived on the
// repair, not carried in it, or a corrected typo stays marked unusable.
const im3 = (await J(await req('/products/PP-IM-07', {}, one.base)))?.colors?.find((c) => c.slot === 3);
t('AND THE TYPO FIX RE-DERIVES pms_valid rather than leaving it at 0',
  im3?.pms === 'PMS 9160 C' && im3?.pms_valid === 1, `${im3?.pms} valid=${im3?.pms_valid}`);
// The whole point of making the field editable: nothing re-imports it.
const edited = await J(await req(`/products/${encodeURIComponent(target.sku)}`, {}, one.base));
t('AND THE EDIT MADE THROUGH THE APP SURVIVED THE REBOOT',
  (edited?.colors || []).some((c) => c.pms === 'PMS 300 C'),
  JSON.stringify((edited?.colors || []).map((c) => c.pms)));
one.proc.kill('SIGKILL');
await wait(600);

console.log('\nAnd a value a PERSON set is never overwritten by the correction');
// The other half of the same rule, and it needs its own boot: the same row
// cannot be both "still wrong" and "already corrected by somebody".
setSlot('PPM-PS', 2, 'PMS 7581 C');
const two = await reboot(BOOT2);
t('it booted', two.ready);
const held = (await J(await req('/products/PPM-PS', {}, two.base)))?.colors?.find((c) => c.slot === 2);
t('THE PERSON\'S VALUE STANDS — the repair does not undo a correction',
  held?.pms === 'PMS 7581 C', held?.pms);
t('and the skip is reported in the boot log, never swallowed',
  /SKIPPED/i.test(two.log()) && /PPM-PS/.test(two.log()) && /7581/.test(two.log()),
  lineOf(two.log(), /SKIPPED/i));
two.proc.kill('SIGKILL');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
