// A QA correction request reaches the named filer — executed against a live server.
//
// Reported 14 September 2026: two "Correct this entry" cards for one operator,
// dated 1 September, had sat for roughly two weeks. The question was simply
// "is she getting ReadyBot?" and nothing in the system could answer it.
//
// Three defects produced that silence and each one is asserted here:
//   1. the lookup FAILED CLOSED — an unresolvable filer sent nothing, told
//      nobody, and wrote nothing down;
//   2. the name fallback was EXACT while D-074's own link triggers resolve
//      case-insensitively;
//   3. nobody was ever told the ask had been ignored.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4997;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const open = (ro = false) => new Database(process.env.DBPATH, ro ? { readonly: true } : {});

const PW = 'QaNotify2026!';
const MAP = JSON.stringify({ 'production-log': 'edit' });

{
  const db = open();
  // `username` is UNIQUE, and INSERT OR REPLACE DELETES the row it conflicts with —
  // so giving both twins the same username quietly left one account, which is not
  // the ambiguity this test exists to exercise.
  const user = (id, name, role, dept, map = MAP) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES (?,?,?,?,?,1,?,?,datetime('now','+7 day'))`).run(id, name, id, role, dept, map, 'SC-' + id);
  user('qn-qa', 'Qn Quality', 'admin', 'qa');
  // The filer. Her account name differs in case from the name filed on the row —
  // the exact-match fallback this replaces would not have found her.
  user('qn-filer', 'Qn Filer Gomez', 'supervisor', 'production', JSON.stringify({ 'production-log': 'view' }));
  user('qn-sup', 'Qn Production Sup', 'supervisor', 'production');
  // Two accounts sharing one name: D-074's triggers resolve that to NULL rather
  // than guessing, which is exactly the row that used to go nowhere.
  user('qn-twin-a', 'Qn Twin', 'supervisor', 'production');
  user('qn-twin-b', 'Qn Twin', 'supervisor', 'production');
  db.close();
}

await post('/users/login', { name: 'Qn Quality' });
await post('/users/set-password', { user_id: 'qn-qa', password: PW, setup_code: 'SC-qn-qa' });
token = (await J(await post('/users/login', { name: 'Qn Quality', password: PW })))?.token;
t('signed in as QA', !!token);

// A production entry filed by name only — no submitted_by_id, and the stored
// name cased differently from the account. This is the D-074 row shape.
const entry = async (id, { by, mo, date = '2026-09-01' }) => {
  const db = open();
  db.prepare(`INSERT OR REPLACE INTO production_entries
    (id,date,team,room,product_name,mo_number,lot_number,start_time,end_time,quantity_completed,people_count,submitted_by,submitted_by_id)
    VALUES (?,?,'Filling','1','Alkify Stick',?,'L1','06:00','14:00',100,3,?,NULL)`)
    .run(id, date, mo, by);
  // The link trigger fires on insert; clear it so the row is genuinely name-only.
  db.prepare('UPDATE production_entries SET submitted_by_id = NULL WHERE id = ?').run(id);
  db.close();
};
const row = (id) => { const d = open(true); const r = d.prepare('SELECT * FROM production_entries WHERE id = ?').get(id); d.close(); return r; };
const dmsTo = (uid) => {
  const d = open(true);
  const n = d.prepare(`SELECT COUNT(*) c FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
    WHERE ch.kind = 'dm' AND ch.dm_key LIKE ? AND m.body LIKE '%correct%'`).get(`%${uid}%`)?.c || 0;
  d.close(); return n;
};
const flag = (id, notes) => put(`/production/entries/${id}/qa-signoff`, {
  qa_signoff_by: 'Qn Quality', qa_notes: notes, qa_action_required: true, signature_password: PW,
});

console.log('\nFlagging an entry reaches the filer, matched case-insensitively on the name');
{
  await entry('qn-1', { by: 'qn filer gomez', mo: 'MO76790' });
  const before = dmsTo('qn-filer');
  const r = await flag('qn-1', 'Weigh the qty produced today — weights were varying.');
  t('the sign-off is accepted', r.ok, `got ${r.status}`);
  await new Promise(s => setTimeout(s, 350));
  const e = row('qn-1');
  t('A DM REACHED HER', dmsTo('qn-filer') > before, `dms=${dmsTo('qn-filer')}`);
  t('the record says WHEN she was told', !!e.qa_action_notified_at);
  t('the record says WHO it reached', e.qa_action_notified_to === 'qn-filer', `to=${e.qa_action_notified_to}`);
  t('no error recorded', e.qa_action_notify_error == null, `err=${e.qa_action_notify_error}`);
  t('not escalated — she has been told and the clock has not run', e.qa_action_escalated_at == null);
}

console.log('\nAn unreachable filer ESCALATES instead of failing closed');
{
  await entry('qn-2', { by: 'Qn Twin', mo: 'MO76801' });   // two accounts, resolves to neither
  const beforeQa = dmsTo('qn-qa');
  const r = await flag('qn-2', 'Lot number does not match the batch record.');
  t('the sign-off is still accepted — a comms miss never fails a signature', r.ok, `got ${r.status}`);
  await new Promise(s => setTimeout(s, 350));
  const e = row('qn-2');
  t('THE REASON IS RECORDED, not swallowed', e.qa_action_notify_error === 'ambiguous', `err=${e.qa_action_notify_error}`);
  t('QA WAS TOLD IT COULD NOT BE DELIVERED', dmsTo('qn-qa') > beforeQa);
  t('the escalation is stamped', !!e.qa_action_escalated_at);
  t('it is audited', (() => { const d = open(true);
    const n = d.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_id = 'qn-2' AND action LIKE '%unreachable%'").get()?.c || 0;
    d.close(); return n > 0; })());
}

console.log('\nThe banner is told whose entry it is, by the server');
{
  const mine = await J(await req('/production/entries/qa-actions'));
  t('QA (admin) sees every open correction', (mine || []).length >= 2, `n=${(mine || []).length}`);
  const one = (mine || []).find(x => x.id === 'qn-1');
  t('and is told it is NOT hers', one && one.is_mine === false, `is_mine=${one?.is_mine}`);

  // The filer's own session. Her row carries no id, so this is the exact case
  // the old `submitted_by === user.name` comparison got wrong.
  await post('/users/set-password', { user_id: 'qn-filer', password: PW, setup_code: 'SC-qn-filer' });
  const keep = token;
  token = (await J(await post('/users/login', { name: 'Qn Filer Gomez', password: PW })))?.token;
  const hers = await J(await req('/production/entries/qa-actions'));
  t('SHE SEES IT AS HERS', (hers || []).some(x => x.id === 'qn-1' && x.is_mine === true),
    JSON.stringify((hers || []).map(x => [x.id, x.is_mine])));
  t('and only her own', (hers || []).every(x => x.is_mine), `n=${(hers || []).length}`);
  token = keep;
}

console.log('\nTwo cards, one shift, one note — grouped, and the MO difference is reported');
{
  await entry('qn-3a', { by: 'qn filer gomez', mo: 'MO76911' });
  await entry('qn-3b', { by: 'qn filer gomez', mo: 'MO76911 y' });
  const note = 'Weigh the qty that was produced today.';
  await flag('qn-3a', note); await flag('qn-3b', note);
  await new Promise(s => setTimeout(s, 350));
  const rows = await J(await req('/production/entries/qa-actions'));
  const a = (rows || []).find(x => x.id === 'qn-3a');
  const b = (rows || []).find(x => x.id === 'qn-3b');
  t('both are returned — nothing is deleted or merged', !!a && !!b);
  t('they share one group', a?.duplicate_group && a.duplicate_group === b?.duplicate_group);
  t('the group is counted', a?.duplicate_count === 2, `count=${a?.duplicate_count}`);
  t('THE MO DIFFERENCE IS REPORTED, not resolved', a?.mo_mismatch === true);
  t('and both MO strings travel with it', (a?.mo_variants || []).join('|').includes('MO76911 y'),
    JSON.stringify(a?.mo_variants));
  t('a lone card is not grouped', (rows || []).find(x => x.id === 'qn-1')?.duplicate_group == null);
}

console.log('\nThe SLA clock is per entry, and it chases then escalates');
{
  const { qaActionNudges, qaActionSlaHours } = await import('../server/api/production.js');
  const db = open();
  t('the SLA defaults to 24h', qaActionSlaHours(db) === 24);
  db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('qa_action_sla_hours','1')").run();
  t('and is clamped up to the 24h floor — under a day chases a shift still running',
    qaActionSlaHours(db) === 24);
  db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('qa_action_sla_hours','72')").run();
  t('and down to the 48h ceiling — beyond that is how this sat a fortnight',
    qaActionSlaHours(db) === 48);
  db.prepare("DELETE FROM app_settings WHERE key = 'qa_action_sla_hours'").run();

  // Nothing is due yet: qn-1 was messaged seconds ago.
  const quiet = await qaActionNudges(db);
  t('an entry inside its SLA is left alone', quiet.entries === 0, `due=${quiet.entries}`);

  // Age qn-1 past the SLA, on its own clock.
  db.prepare(`UPDATE production_entries SET qa_signoff_at = datetime('now','-30 hours'),
    qa_action_notified_at = datetime('now','-30 hours') WHERE id = 'qn-1'`).run();
  const beforeFiler = dmsTo('qn-filer'), beforeSup = dmsTo('qn-sup');
  const chased = await qaActionNudges(db);
  t('it comes due', chased.entries === 1, `due=${chased.entries}`);
  t('SHE IS CHASED AGAIN', dmsTo('qn-filer') > beforeFiler);
  t('AND IT IS RAISED PAST HER', chased.escalated === 1 && dmsTo('qn-sup') > beforeSup,
    `escalated=${chased.escalated}`);
  const e = row('qn-1');
  t('the escalation is stamped once', !!e.qa_action_escalated_at);

  db.prepare("UPDATE production_entries SET qa_action_notified_at = datetime('now','-30 hours') WHERE id = 'qn-1'").run();
  const again = await qaActionNudges(db);
  t('a second pass chases but does NOT escalate twice', again.sent === 1 && again.escalated === 0,
    `sent=${again.sent} esc=${again.escalated}`);
  db.close();
}

console.log('\nCorrecting the entry stops everything, permanently');
{
  const db = open();
  db.prepare("UPDATE production_entries SET qa_action_resolved_at = datetime('now'), qa_action_required = 0 WHERE id = 'qn-1'").run();
  const { qaActionNudges } = await import('../server/api/production.js');
  db.prepare("UPDATE production_entries SET qa_action_notified_at = datetime('now','-90 hours') WHERE id = 'qn-1'").run();
  const after = await qaActionNudges(db);
  t('a resolved entry is never chased again', !after.entries || !(await J(await req('/production/entries/qa-actions')))?.some(x => x.id === 'qn-1'));
  db.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
