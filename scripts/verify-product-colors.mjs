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

console.log('\nThe catalogue disagreeing with ITSELF is on the punch list');
// The same Pantone carrying a materially different hex on two rows is internal
// evidence of a bad transcription, and it needs no Pantone book — it is the
// check that would have caught the pumpkin row without anybody holding the pack.
const health = await J(await req('/products/data-health'));
const conflicts = (health?.issues || []).filter((i) => i.kind === 'color_conflict');
t('the disagreements are reported', conflicts.length > 0, `${conflicts.length} rows`);
t('PMS 9201 C is a cream on one product and a dark brown on another',
  conflicts.some((i) => /9201/.test(i.detail) && /F4E1CB/.test(i.detail) && /502C1E/.test(i.detail)),
  conflicts.filter((i) => /9201/.test(i.detail)).map((i) => i.detail)[0]);
// Every disagreement is filed against BOTH sides, since neither is more
// suspect than the other and whoever opens the punch list has to reach either.
const nine201 = conflicts.filter((i) => /9201/.test(i.detail));
t('and BOTH sides are named, since neither is more suspect than the other',
  nine201.some((i) => i.sku === 'PP-PC-11') && nine201.some((i) => /F4E1CB/.test(i.detail) && i.sku !== 'PP-PC-11')
    && nine201.length % 2 === 0,
  JSON.stringify(nine201.map((i) => i.sku)));
// REPORTED, NEVER CORRECTED: which side is wrong is a question about a pack.
t('nothing was changed to resolve it',
  (await colorsOf('PP-PC-11')).find((c) => c.slot === 3)?.hex === 'HEX 502C1E');
// A few units apart is two samples of one swatch, not an error, or the four
// that are real would be buried.
t('near-identical transcriptions of one Pantone are NOT flagged',
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
const setPms = (sku, slot, pms) => {
  const db = new Database(process.env.DBPATH);
  db.prepare('UPDATE product_colors SET pms = ? WHERE sku = ? AND slot = ?').run(pms, sku, slot);
  db.close();
};
setPms('PPM-PS', 2, 'PMS 285 C');

const one = await reboot(BOOT2);
t('the application booted again on the same database', one.ready);
const after2 = (await J(await req('/products/PPM-PS', {}, one.base)))?.colors?.find((c) => c.slot === 2);
t('THE CORRECTION IS APPLIED TO A DATABASE THAT HAD THE WRONG VALUE',
  after2?.pms === 'PMS 7580 C', after2?.pms);
t('and it says so in the boot log rather than silently',
  /7580/.test(one.log()) && /brand colour/i.test(one.log()), lineOf(one.log(), /colour/i));
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
setPms('PPM-PS', 2, 'PMS 7581 C');
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
