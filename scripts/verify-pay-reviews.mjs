// verify:payreviews — D-137, live on a fresh database, two reboots, and a real browser.
//
// "Why are there 22 reviews for Rosaura? Was this prompting the supervisors
// that many times?" No — ReadyBot only ever DMs. Every one of those rows was a
// SUBMIT: the Evaluation form stayed filled in with Submit live after a
// review went in, and a submit on a dropped connection is queued and replayed.
// Nothing on the server asked whether that reviewer had already said this.
//
// The rule now: ONE OPEN REVIEW PER REVIEWER PER PERSON. The same review again
// files nothing; a different one from the same reviewer replaces theirs; a
// second reviewer is never touched; the rows already on file are superseded
// once at boot, never deleted.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// this change: the reboot supersedes nothing and Rosaura still reads 22.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5053);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = ['team', 'snipers', 'common_sense', 'productivity', 'hard_things', 'attendance'];
const all = (n) => Object.fromEntries(KEYS.map((k) => [k, n]));
const NOTE = 'Hace un excelente trabajo, es responsable y comprometida.';

const db = new Database(DBP);
const mkUser = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mkUser('pr-adm', 'Lowry Reviews', 'admin', 'executive', null);
mkUser('pr-deb', 'Debora Reviews', 'supervisor', 'filling', { 'pay-tracking': 'edit' });
mkUser('pr-zul', 'Zuleika Reviews', 'supervisor', 'cleaning', { 'pay-tracking': 'edit' });

const people = db.prepare(`SELECT id, name FROM pay_employees WHERE active = 1 AND COALESCE(is_supervisor,0) = 0
  AND user_id IS NULL AND COALESCE(worker_type,'employee') <> 'contractor' ORDER BY name LIMIT 6`).all();
const [E1, E2, E3, E4, E5] = people;
const ins = db.prepare(`INSERT INTO pay_reviews (id, employee_id, reviewer_id, reviewer_name, review_date, scores, total, recommendation, notes, attendance_flag, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,0,?)`);
// THE PLANT'S STATE. E1 is Rosaura: twenty identical copies of one
// supervisor's review (some in the same second), and two different reviews
// from a second reviewer — one without notes, then one with.
db.transaction(() => {
  for (let i = 0; i < 20; i++) {
    ins.run(`fx-deb-${i}`, E1.id, 'pr-deb', 'Debora Reviews', '2026-09-29', JSON.stringify(all(3)), 18, '$2.00 / hour', NOTE,
      `2026-09-29 15:${String(10 + Math.floor(i / 3)).padStart(2, '0')}:00`);
  }
  ins.run('fx-adm-0', E1.id, 'pr-adm', 'Lowry Reviews', '2026-09-30', JSON.stringify({ ...all(3), team: 2, snipers: 2, attendance: 2 }), 15, '$1.00 / hour', null, '2026-09-30 10:00:00');
  ins.run('fx-adm-1', E1.id, 'pr-adm', 'Lowry Reviews', '2026-09-30', JSON.stringify({ ...all(3), team: 2, snipers: 2, attendance: 2 }), 15, '$1.00 / hour', 'Good with the team.', '2026-09-30 10:05:00');
  // E2: one review by one person — must be untouched.
  ins.run('fx-zul-0', E2.id, 'pr-zul', 'Zuleika Reviews', '2026-09-28', JSON.stringify(all(2)), 12, 'No increase', null, '2026-09-28 09:00:00');
  // E3: a row filed by name with no account id, twice, identical.
  ins.run('fx-name-0', E3.id, null, 'Old Paper Name', '2026-09-20', JSON.stringify(all(2)), 12, null, 'x', '2026-09-20 09:00:00');
  ins.run('fx-name-1', E3.id, null, 'Old Paper Name', '2026-09-20', JSON.stringify(all(2)), 12, null, 'x', '2026-09-20 09:00:00');
})();
const rowsBefore = db.prepare('SELECT COUNT(*) n FROM pay_reviews').get().n;
db.close();

async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DB_PATH: DBP },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ }
  }
  return { proc, base: `http://localhost:${port}/api`, url: `http://localhost:${port}`, ready, log: () => log };
}
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

console.log('\n── the redeploy: repeats already on file are superseded, never deleted ──');
const one = await reboot(BOOT2);
t('the application booted again on the same database', one.ready);
t('the boot log says how many it superseded', /Pay reviews: 20 repeat submission\(s\) and 1 earlier review\(s\) superseded/.test(one.log()),
  one.log().split('\n').filter((l) => /Pay reviews/.test(l)).join(' | ') || 'no line');
t('NOTHING was deleted', q('SELECT COUNT(*) n FROM pay_reviews')[0].n === rowsBefore);
const e1 = q("SELECT reviewer_name, status, resolution, id FROM pay_reviews WHERE employee_id = ? ORDER BY created_at, rowid", E1.id);
const e1Open = e1.filter((r) => r.status === 'open');
t('Rosaura has ONE open review per reviewer — two, not twenty-two', e1Open.length === 2, `${e1Open.length} open`);
t('the copy kept is the LATEST of the twenty', e1Open.some((r) => r.id === 'fx-deb-19'));
t('the other nineteen copies say they were identical repeats', e1.filter((r) => r.status === 'superseded' && /^Repeat submission — identical/.test(r.resolution)).length === 19);
t('the second reviewer\'s earlier, different review reads "replaced", and the later one (with notes) stays open',
  e1.find((r) => r.id === 'fx-adm-0')?.status === 'superseded' && /^Replaced by Lowry Reviews/.test(e1.find((r) => r.id === 'fx-adm-0')?.resolution || '')
  && e1.find((r) => r.id === 'fx-adm-1')?.status === 'open');
t('a person with one review is untouched', q("SELECT status FROM pay_reviews WHERE id = 'fx-zul-0'")[0].status === 'open');
t('a review filed by name with no account id is matched by name', q("SELECT status FROM pay_reviews WHERE employee_id = ? AND status = 'open'", E3.id).length === 1);
t('each reviewer-and-person pair it touched is audited with the counts (three here)', q("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'pay_review' AND details LIKE '%superseded_repeats%'")[0].n === 3);
const s1 = q("SELECT COUNT(*) n FROM pay_reviews WHERE status = 'superseded'")[0].n;
one.proc.kill('SIGKILL');

const two = await reboot(BOOT2);
t('a second boot supersedes nothing more (idempotent)', two.ready && q("SELECT COUNT(*) n FROM pay_reviews WHERE status = 'superseded'")[0].n === s1
  && !/Pay reviews:/.test(two.log()));
const B = two.base;
const signIn = async (id, name) => {
  const c = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: `SC-${id}` });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const adm = await signIn('pr-adm', 'Lowry Reviews');
const deb = await signIn('pr-deb', 'Debora Reviews');
const zul = await signIn('pr-zul', 'Zuleika Reviews');
const call = (tok) => (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
const A = call(adm.token), D = call(deb.token), Z = call(zul.token);

console.log('\n── what the office reads ──');
const acts = await J(await A('GET', '/pay/actions'));
const dec = (acts.items || []).find((i) => i.kind === 'decide' && i.employee_id === E1.id);
t('the strip says 2 reviews in for Rosaura, not 22', dec?.reviews === 2, JSON.stringify(dec));
t('and the combined score is the two reviewers\' (18 + 15) / 2 = 16.5, not 17.7', dec?.avg_total === 16.5, String(dec?.avg_total));
const drawer = await J(await A('GET', `/pay/employees/${E1.id}`));
t('the drawer still holds every row — the superseded ones under earlier reviews', drawer.reviews.length === 22
  && drawer.reviews.filter((r) => r.status === 'open').length === 2);

console.log('\n── submitting: a repeat files nothing, a change replaces ──');
const count = (emp, who) => q("SELECT COUNT(*) n FROM pay_reviews WHERE employee_id = ? AND reviewer_id = ?", emp, who)[0].n;
const body = { scores: all(3), notes: 'Strong week', review_date: '2026-10-01', recommendation: '$2.00 / hour', attendance_flag: false };
let r = await D('POST', `/pay/employees/${E2.id}/reviews`, body);
const first = await J(r);
t('the first submit files a review (201)', r.status === 201 && !!first?.id);
r = await D('POST', `/pay/employees/${E2.id}/reviews`, body);
const again = await J(r);
t('the SAME review again files nothing and answers with the one on file', r.status === 200 && again?.duplicate === true && again?.id === first.id && count(E2.id, 'pr-deb') === 1);
const reordered = Object.fromEntries([...KEYS].reverse().map((k) => [k, 3]));
r = await D('POST', `/pay/employees/${E2.id}/reviews`, { ...body, scores: reordered });
t('the same scores in a different key order are still the same review', (await J(r))?.duplicate === true && count(E2.id, 'pr-deb') === 1);
t('a repeat writes no audit entry', q("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'pay_review' AND entity_id = ? AND action = 'create'", first.id)[0].n === 1);
r = await D('POST', `/pay/employees/${E2.id}/reviews`, { ...body, scores: { ...all(3), attendance: 2 } });
const changed = await J(r);
t('a DIFFERENT review from the same reviewer is filed and replaces theirs', r.status === 201 && changed?.superseded === 1
  && q('SELECT status FROM pay_reviews WHERE id = ?', first.id)[0].status === 'superseded'
  && q("SELECT COUNT(*) n FROM pay_reviews WHERE employee_id = ? AND reviewer_id = 'pr-deb' AND status = 'open'", E2.id)[0].n === 1);
t('a second reviewer\'s review of the same person is never touched', q("SELECT status FROM pay_reviews WHERE id = 'fx-zul-0'")[0].status === 'open');
r = await Z('POST', `/pay/employees/${E2.id}/reviews`, { ...body, notes: 'Second opinion' });
t('and a second reviewer filing replaces only their own', r.status === 201 && (await J(r))?.superseded === 1
  && q("SELECT COUNT(*) n FROM pay_reviews WHERE employee_id = ? AND status = 'open'", E2.id)[0].n === 2);

console.log('\n── an assignment still closes, on a repeat too ──');
const asg = await J(await A('POST', '/pay/assignments', { reviewer_id: 'pr-deb', employee_id: E3.id, due_date: '2026-10-15' }));
await D('POST', `/pay/employees/${E3.id}/reviews`, body);
t('submitting closes the assignment', q('SELECT status FROM pay_review_assignments WHERE id = ?', asg.id)[0]?.status === 'completed');

console.log('\n── in the browser, at 390px ──');
const a4 = await J(await A('POST', '/pay/assignments', { reviewer_id: 'pr-deb', employee_id: E4.id, due_date: '2026-10-15' }));
const a5 = await J(await A('POST', '/pay/assignments', { reviewer_id: 'pr-deb', employee_id: E5.id, due_date: '2026-10-15' }));
t('two evaluations assigned to the supervisor', !!a4?.id && !!a5?.id);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${two.url}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [deb.token, deb.user]);
  await page.goto(`${two.url}/?tab=pay-tracking`);
  const score = async () => { for (const k of KEYS) await page.locator(`[data-score-key="${k}"][data-score="3"]`).click(); };

  await page.getByRole('button', { name: new RegExp(E4.name) }).first().click();
  await score();
  await page.locator('[data-review-submit]').click();
  await page.locator('[data-review-done]').waitFor({ timeout: 8000 });
  t('after Submit the form CLOSES — there is no Submit button left to press again', await page.locator('[data-review-submit]').count() === 0);
  t('and the screen says the review went in, naming the person', new RegExp(E4.name).test(await page.locator('[data-review-done]').innerText()));
  t('one review filed', count(E4.id, 'pr-deb') === 1);

  // The replay hazard: the request REACHES the server, the answer is lost, the
  // client queues it and sends it again on reconnect.
  await page.route('**/api/pay/employees/*/reviews', async (route) => { await route.fetch(); await route.abort('connectionreset'); });
  await page.getByRole('button', { name: new RegExp(E5.name) }).first().click();
  await score();
  await page.locator('[data-review-submit]').click();
  await page.locator('[data-review-done]').waitFor({ timeout: 8000 });
  const msg = await page.locator('[data-review-done]').innerText();
  t('a submit on a dropped answer reads as saved, and the form closes', /Saved on this device/.test(msg) && await page.locator('[data-review-submit]').count() === 0, msg);
  await page.unroute('**/api/pay/employees/*/reviews');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await wait(2500);
  t('the replay reaches the server and files NOTHING twice', count(E5.id, 'pr-deb') === 1, `${count(E5.id, 'pr-deb')} rows`);
  t('the page did not pan sideways at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
} finally { await browser.close(); two.proc.kill('SIGKILL'); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
