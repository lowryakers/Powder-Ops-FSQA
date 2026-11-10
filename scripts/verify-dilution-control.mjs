// verify:dilutioncontrol — D-327, live on a fresh database, then a reboot.
//
// FORM 106-01's chemicals and ranges are a controlled definition. Approving a
// change in Controlled Changes renames the untouched daily dilution schedules
// AND their open cards at once, the record files under the approved name and
// revision, a card raised before the rename still grades, a hand-edited
// schedule is named and left alone, and a reboot raises no second schedule.
//
// Caller sets PORT + DBPATH. The control is `main` before this change: there is
// no `dilution:FORM 106-01` definition to approve.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const PORT = process.env.PORT || 5208;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
const BOOT2 = Number(PORT) + 400;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];
const w = (sql, ...a) => { const d = new Database(DBP); try { return d.prepare(sql).run(...a); } finally { d.close(); } };

w(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('dc-admin','Dana Dilute','Dana Dilute','admin','document_control',1,'SC-dc-admin',datetime('now','+7 day'))`);
const mk = (base) => async (m, p, b, tok) => {
  const r = await fetch(`${base}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const call = mk(URL);
await call('POST', '/users/set-password', { user_id: 'dc-admin', password: 'Dilute2026!!', setup_code: 'SC-dc-admin' });
const A = (await call('POST', '/users/login', { name: 'Dana Dilute', password: 'Dilute2026!!' })).json?.token;
t('signed in', !!A);

console.log('\n── Before: the definition in force ──');
let r = await call('GET', '/dilution-forms', null, A);
const sani = r.json?.dilutions?.find((d) => d.key === 'sani512');
t('the API serves FORM 106-01 V3 with Sani-512', r.status === 200 && r.json?.form_revision === 'FORM 106-01 V3' && sani?.chemical === 'Sani-512 Sanitizer' && sani?.min === 200, JSON.stringify(sani));
const keyed = q("SELECT dilution_key k, title FROM pm_schedules WHERE dilution_key IS NOT NULL AND is_active = 1");
t('each of the four daily schedules carries its dilution key', ['sani512', 'chlorine', 'dawn', 'simple_green'].every((k) => keyed.some((s) => s.k === k)), JSON.stringify(keyed));
const def = one("SELECT * FROM controlled_definitions WHERE key = 'dilution:FORM 106-01'");
t('the list is a controlled definition, approved as the baseline', def?.status === 'approved', def?.status);
const saniSched = one("SELECT * FROM pm_schedules WHERE dilution_key = 'sani512'");
const oldCard = one(`SELECT * FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`, saniSched.id);
t('Sani-512 has an open card today', !!oldCard && oldCard.title === 'Chemical Dilution — Sani-512 Sanitizer');
const chlSched = one("SELECT * FROM pm_schedules WHERE dilution_key = 'chlorine'");
w("UPDATE pm_schedules SET title = 'Chemical Dilution — Bleach (our wording)' WHERE id = ?", chlSched.id);
const chlCard = one(`SELECT * FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`, chlSched.id);

console.log('\n── Document Control approves a revision that renames the sanitizer ──');
const snap = JSON.parse(def.approved_snapshot);
snap.revision = 'V4';
for (const it of snap.items) {
  if (it.key === 'sani512') { it.chemical = 'J-512 TM/MC Sanitizer'; it.registry_name = 'J-512 TM/MC Sanitizer'; }
  if (it.key === 'chlorine') it.chemical = 'Chlorine Bleach';
}
w("UPDATE controlled_definitions SET pending_snapshot = ?, pending_hash = 'test-v4', status = 'pending' WHERE id = ?", JSON.stringify(snap), def.id);
r = await call('POST', `/controlled/${def.id}/approve`, {}, A);
t('approved in Controlled Changes', r.status === 200, `${r.status} ${r.json?.error}`);
r = await call('GET', '/dilution-forms', null, A);
const sani2 = r.json?.dilutions?.find((d) => d.key === 'sani512');
t('the API now serves V4 with J-512, remembering the old name', r.json?.form_revision === 'FORM 106-01 V4' && sani2?.chemical === 'J-512 TM/MC Sanitizer' && sani2?.former?.includes('Sani-512 Sanitizer'), JSON.stringify(sani2));
const s2 = one('SELECT * FROM pm_schedules WHERE id = ?', saniSched.id);
t('the schedule is renamed on the approval, not at the next deploy', s2.title === 'Chemical Dilution — J-512 TM/MC Sanitizer' && s2.description.includes('FORM 106-01 V4') && s2.procedure_steps.includes('J-512'), s2.title);
const c2 = one('SELECT * FROM work_orders WHERE id = ?', oldCard.id);
t("today's open card is renamed too", c2.title === 'Chemical Dilution — J-512 TM/MC Sanitizer' && c2.procedure_steps.includes('J-512'), c2.title);
t('a hand-edited schedule is left as the person wrote it', one('SELECT title FROM pm_schedules WHERE id = ?', chlSched.id).title === 'Chemical Dilution — Bleach (our wording)');
t('…and its card keeps its title', one('SELECT title FROM work_orders WHERE id = ?', chlCard.id).title === chlCard.title);
t('only one Sani schedule exists', q("SELECT id FROM pm_schedules WHERE dilution_key = 'sani512'").length === 1);

console.log('\n── The floor ──');
r = await call('GET', '/pm/search?q=J-512', null, A);
const card = (r.json || []).find((x) => x.id === oldCard.id);
t('the task carries the dilution in force', card?.dilution_form?.chemical === 'J-512 TM/MC Sanitizer' && card?.dilution_form?.min === 200, JSON.stringify(card?.dilution_form));
r = await call('POST', `/pm/work-orders/${oldCard.id}/complete-and-recur`, { completed_by: 'Dana Dilute', readings: { dilution_pass: 'yes', ppm_reading: '220' } }, A);
t('completing it files the record', r.status === 200, `${r.status} ${r.json?.error}`);
const rec = one("SELECT * FROM sanitation_records WHERE notes LIKE ? ORDER BY rowid DESC", `%Filed from task ${oldCard.id}%`);
t('…under the approved name and revision', rec?.chemicals_used === 'J-512 TM/MC Sanitizer' && rec?.notes.includes('FORM 106-01 V4') && rec?.result === 'pass', JSON.stringify(rec && { c: rec.chemicals_used, n: rec.notes }));
const nextCard = one(`SELECT title FROM work_orders WHERE pm_schedule_id = ? AND status = 'open' AND id != ?`, saniSched.id, oldCard.id);
t("tomorrow's card is raised with the new name", nextCard?.title === 'Chemical Dilution — J-512 TM/MC Sanitizer', nextCard?.title);
r = await call('POST', `/pm/work-orders/${chlCard.id}/complete-and-recur`, { completed_by: 'Dana Dilute', readings: { dilution_pass: 'yes', ppm_reading: '250' } }, A);
const chlRec = one("SELECT * FROM sanitation_records WHERE notes LIKE ?", `%Filed from task ${chlCard.id}%`);
t('a card on the hand-edited schedule is still graded by its key (250 ppm is out of 100–200)', r.status === 200 && chlRec?.result === 'fail', `${r.status} ${chlRec?.result}`);

console.log('\n── A redeploy ──');
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(BOOT2), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await wait(1000); try { await fetch(`http://localhost:${BOOT2}/api/users/lookup?q=zz`); up = true; } catch { /* booting */ } }
await wait(3000);
try {
  t('the server reboots on the same database', up);
  const c3 = mk(`http://localhost:${BOOT2}`);
  r = await c3('GET', '/dilution-forms', null, A);
  t('after the reboot the approved list is still served', r.json?.dilutions?.find((d) => d.key === 'sani512')?.chemical === 'J-512 TM/MC Sanitizer');
  t('no second Sani schedule was seeded', q("SELECT id FROM pm_schedules WHERE dilution_key = 'sani512'").length === 1 && q("SELECT id FROM pm_schedules WHERE title = 'Chemical Dilution — Sani-512 Sanitizer'").length === 0);
  t('the schedule kept its approved name', one('SELECT title FROM pm_schedules WHERE id = ?', saniSched.id).title === 'Chemical Dilution — J-512 TM/MC Sanitizer');
  t('the boot log names the hand-edited schedule', log.includes('Bleach (our wording)'), log.split('\n').filter((l) => l.includes('dilution')).join(' | '));
  r = await c3('GET', '/doc-review/name-usage?q=J-512', null, A);
  t('"Where is a name used?" finds the renamed schedule', (r.json?.sections || []).find((s) => s.key === 'schedules')?.count > 0);
} finally { proc.kill(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
