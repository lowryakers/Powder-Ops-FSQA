// Who is a trainee (D-262).
//
// Training counted every active account that was not an outside client — so
// each bot (an ordinary non-admin account that holds an API token, D-161),
// ReadyBot and the Test Runner owed every "everyone" course and every course
// of the department they were filed under. `users.not_trainee` says an account
// is not a person who is trained. It is a fact about the account, set in
// Settings → Users; it does not deactivate anything, so a bot keeps posting in
// #ops-requests and keeps its token.
//
// ONE RULE, READ EVERYWHERE TRAINING COUNTS PEOPLE: the matrix and By person
// (training-status.js), assigning (training-assign.js), Group Training and
// Group Sheets (bulk-complete), the importers' name matching, the retraining
// list, the open-assignment list and its reminders, certification, Most missed
// and the readiness review. A second copy of this rule is how two of those
// start disagreeing about how many people owe GMP.
import { logAudit } from './db.js';

/** SQL: this users row (alias `u`) is a trainee. */
export const TRAINEE_SQL = (alias = 'u') => `COALESCE(${alias}.not_trainee, 0) = 0`;

/**
 * SQL: this training_records row (alias `tr`) belongs to a trainee. A record
 * keyed by account id is matched on the id; one keyed by name only, on the name.
 */
export const TRAINEE_RECORD_SQL = (alias = 'tr') => `NOT EXISTS (SELECT 1 FROM users nt
  WHERE COALESCE(nt.not_trainee, 0) = 1
    AND (nt.id = ${alias}.employee_user_id OR (${alias}.employee_user_id IS NULL AND LOWER(nt.name) = LOWER(${alias}.employee_name))))`;

export const isTrainee = (u) => !!u && !Number(u.not_trainee);

/** Account ids that are not trainees, for name-keyed reads. */
export function nonTraineeIds(db) {
  try { return new Set(db.prepare('SELECT id FROM users WHERE COALESCE(not_trainee, 0) = 1').all().map(r => r.id)); }
  catch { return new Set(); }
}

/** Lower-cased names of accounts that are not trainees (for rows keyed on a name only). */
export function nonTraineeNames(db) {
  try { return new Set(db.prepare('SELECT LOWER(name) n FROM users WHERE COALESCE(not_trainee, 0) = 1').all().map(r => r.n)); }
  catch { return new Set(); }
}

const OPEN = "('open','in_progress','overdue','missed')";

/**
 * Close the open training tasks an account holds, once it is marked not a
 * trainee. Cancelled with the reason, never deleted — the D-139 rule.
 */
export function closeTrainingTasksFor(db, userId, { by = 'ReadyDoc' } = {}) {
  const r = db.prepare(`UPDATE work_orders
      SET status = 'cancelled', completed_at = datetime('now'), completed_by = ?,
          notes = TRIM(COALESCE(notes, '') || char(10) || 'Cancelled: this account is not a trainee (a bot or system account).')
    WHERE training_course_id IS NOT NULL AND status IN ${OPEN} AND assigned_to_id = ?`).run(by, userId);
  return r.changes;
}

/**
 * Which accounts are bots or system accounts, found by what they ARE, not only
 * by what they are called:
 *   - any account that has ever held a bot API token (D-161, D-259's definition);
 *   - ReadyBot (comms' own bot account) and the Test Runner (D-252, by setting);
 *   - accounts named with the plant's bot prefix "*" (*Procurement Bot, *Jarvis…),
 *     which is how every bot on #ops-requests is named.
 */
export function botAccounts(db) {
  const rows = new Map();
  const add = (r, why) => { if (r && !rows.has(r.id)) rows.set(r.id, { ...r, why }); };
  const cols = 'id, name, role, department, is_active, COALESCE(not_trainee, 0) AS not_trainee';
  try {
    for (const r of db.prepare(`SELECT ${cols} FROM users WHERE id IN (SELECT DISTINCT user_id FROM api_tokens)`).all()) add(r, 'holds a bot API token');
  } catch { /* api_tokens absent */ }
  add(db.prepare(`SELECT ${cols} FROM users WHERE name = 'ReadyBot'`).get(), 'ReadyBot');
  try {
    const tr = db.prepare("SELECT value FROM app_settings WHERE key = 'test_runner_user_id'").get()?.value;
    if (tr) add(db.prepare(`SELECT ${cols} FROM users WHERE id = ?`).get(String(tr).replace(/^"|"$/g, '')), 'the Test Runner');
  } catch { /* no setting */ }
  for (const r of db.prepare(`SELECT ${cols} FROM users WHERE TRIM(name) LIKE '*%'`).all()) add(r, 'named as a bot (*)');
  return [...rows.values()].filter(r => r.role !== 'admin');
}

/** Set or clear the flag on one account, audited, closing its open training tasks when set. */
export function setNotTrainee(db, userId, value, { actor = 'system', reason = null } = {}) {
  const before = db.prepare('SELECT id, name, COALESCE(not_trainee, 0) AS not_trainee FROM users WHERE id = ?').get(userId);
  if (!before) return null;
  const v = value ? 1 : 0;
  if (before.not_trainee === v) return { changed: false, closed: 0 };
  db.prepare("UPDATE users SET not_trainee = ?, updated_at = datetime('now') WHERE id = ?").run(v, userId);
  const closed = v ? closeTrainingTasksFor(db, userId, { by: typeof actor === 'object' ? actor?.name : actor }) : 0;
  logAudit(actor, 'update', 'user', userId, { not_trainee: { from: before.not_trainee, to: v }, training_tasks_closed: closed, ...(reason ? { reason } : {}) },
    { not_trainee: before.not_trainee }, { not_trainee: v }, before.name);
  return { changed: true, closed };
}

/**
 * Once per database (D-262): mark every bot and system account found by
 * botAccounts() as not a trainee, and say what it did. A person who later
 * clears the flag in Settings keeps it cleared — the marker stops this re-running.
 */
export function flagBotAccountsOnce(db, { countMatrix = null, log = console } = {}) {
  const MARK = 'training_bot_accounts_flagged_v1';
  const done = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MARK);
  if (done) return null;
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (!users) return null; // a fresh database seeds its accounts later
  const before = countMatrix ? countMatrix(db) : null;
  const bots = botAccounts(db).filter(b => !b.not_trainee);
  let closed = 0;
  db.transaction(() => {
    for (const b of bots) closed += setNotTrainee(db, b.id, true, { actor: 'system', reason: `bot or system account (${b.why})` })?.closed || 0;
  })();
  const after = countMatrix ? countMatrix(db) : null;
  const report = { flagged: bots.map(b => ({ name: b.name, why: b.why })), training_tasks_closed: closed, before, after };
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(MARK, JSON.stringify({ at: new Date().toISOString(), ...report }));
  logAudit('system', 'update', 'training', null, { event: 'bot_accounts_not_trainees', ...report });
  log.log?.(`[training] ${bots.length} bot/system account(s) marked not a trainee: ${bots.map(b => b.name).join(', ') || '—'}`
    + (before && after ? ` · matrix before ${JSON.stringify(before)} after ${JSON.stringify(after)}` : ''));
  return report;
}

/**
 * Once per database (D-273): an auditor-pass account that duplicates a staff
 * member's name and has never signed in is not a trainee. Found by what it IS —
 * role auditor, the same name as another active account that is not an
 * auditor, no login on record — never by the name itself. It is Carol Pierce's
 * second account today (D-262); the rule would catch the next one the same way.
 * It is NOT deactivated or merged: the pass may still be used. A person who
 * clears the flag in Settings keeps it cleared — the marker stops a re-run.
 */
export function flagUnusedAuditorDuplicatesOnce(db, { log = console } = {}) {
  const MARK = 'training_auditor_duplicates_flagged_v1';
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MARK)) return null;
  if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) return null; // a fresh database seeds its accounts later
  const rows = db.prepare(`SELECT a.id, a.name FROM users a
    WHERE a.role = 'auditor' AND COALESCE(a.not_trainee, 0) = 0
      AND EXISTS (SELECT 1 FROM users b WHERE b.id != a.id AND b.is_active = 1 AND b.role != 'auditor'
                  AND LOWER(TRIM(b.name)) = LOWER(TRIM(a.name)))
      AND NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.action = 'login' AND l.entity_type = 'user' AND l.entity_id = a.id)`).all();
  let closed = 0;
  db.transaction(() => {
    for (const r of rows) closed += setNotTrainee(db, r.id, true, {
      actor: 'system', reason: 'auditor account with the same name as a staff account, never signed in',
    })?.closed || 0;
  })();
  const report = { flagged: rows.map(r => ({ id: r.id, name: r.name })), training_tasks_closed: closed };
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(MARK, JSON.stringify({ at: new Date().toISOString(), ...report }));
  log.log?.(`[training] ${rows.length} unused auditor duplicate account(s) marked not a trainee`);
  for (const r of rows) log.log?.(`[training]   not a trainee: ${r.name} (account ${r.id}) — auditor account sharing a staff name, never signed in`);
  return report;
}

/**
 * What the D-273 pass did on THIS database, and what the rule would match now
 * (D-274). READ-ONLY: every statement is a SELECT; it writes nothing, not even an
 * audit row. Lowry asked to see every account it matched before trusting it.
 */
export function auditorDuplicateReport(db) {
  const safe = (fn, d) => { try { return fn(); } catch { return d; } };
  const MARK = 'training_auditor_duplicates_flagged_v1';
  const raw = safe(() => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MARK)?.value, null);
  const marker = raw ? safe(() => JSON.parse(raw), null) : null;
  const describe = (id) => safe(() => db.prepare(`SELECT id, name, username, role, department, is_active,
      COALESCE(not_trainee, 0) AS not_trainee, created_at FROM users WHERE id = ?`).get(id), null);
  const twins = db.prepare(`SELECT id, name, role, department FROM users
    WHERE id != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY name`);
  const changes = db.prepare(`SELECT timestamp, actor, details FROM audit_log
    WHERE entity_type = 'user' AND entity_id = ? AND details LIKE '%not_trainee%' ORDER BY id`);
  const logins = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'login' AND entity_type = 'user' AND entity_id = ?`);
  const flagged = (marker?.flagged || []).map(f => {
    const u = describe(f.id);
    return {
      id: f.id, name: u?.name ?? f.name, username: u?.username ?? null, role: u?.role ?? null,
      department: u?.department ?? null, active: u ? !!u.is_active : null, still_not_trainee: u ? !!u.not_trainee : null,
      logins_since: safe(() => logins.get(f.id).n, null),
      same_name_accounts: safe(() => twins.all(f.id, u?.name ?? f.name), []),
      changes: safe(() => changes.all(f.id), []),
    };
  });
  // What the rule would match today (nothing is changed by asking).
  const would = safe(() => db.prepare(`SELECT a.id, a.name, a.username FROM users a
    WHERE a.role = 'auditor'
      AND EXISTS (SELECT 1 FROM users b WHERE b.id != a.id AND b.is_active = 1 AND b.role != 'auditor'
                  AND LOWER(TRIM(b.name)) = LOWER(TRIM(a.name)))
      AND NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.action = 'login' AND l.entity_type = 'user' AND l.entity_id = a.id)
    ORDER BY a.name`).all(), []);
  const flaggedIds = new Set(flagged.map(f => f.id));
  return {
    ran: !!marker, ran_at: marker?.at || null, flagged,
    would_match_now: would.map(w => ({ ...w, already_flagged: flaggedIds.has(w.id) })),
    generated_at: new Date().toISOString(),
  };
}

export function auditorDuplicateText(r, source = '') {
  const out = [`Unused auditor accounts marked not a trainee (D-273)${source ? ` — ${source}` : ''}`, ''];
  if (!r.ran) out.push('The pass has not run on this database yet (it runs once, when the app starts).');
  else {
    out.push(`The pass ran ${r.ran_at} and matched ${r.flagged.length} account(s):`);
    if (!r.flagged.length) out.push('  None.');
    for (const f of r.flagged) {
      out.push(`  ${f.name} — account ${f.id}${f.username ? `, signs in as "${f.username}"` : ''}, role ${f.role || '?'}, ${f.active ? 'active' : 'inactive'}`
        + `${f.still_not_trainee ? '' : ' — flag since cleared by hand'}${f.logins_since ? ` — has signed in ${f.logins_since} time(s) since` : ''}`);
      for (const t of f.same_name_accounts) out.push(`      same name: ${t.name} — account ${t.id}, role ${t.role}${t.department ? `, ${t.department}` : ''}`);
      for (const c of f.changes) out.push(`      change logged ${c.timestamp} by ${c.actor || 'system'}`);
    }
  }
  out.push('', `The rule would match now (${r.would_match_now.length}):`);
  out.push(...(r.would_match_now.length ? r.would_match_now.map(w => `  ${w.name} — account ${w.id}${w.already_flagged ? ' (already flagged)' : ' (NOT flagged — the pass runs once)'}`) : ['  None.']));
  return out.join('\n');
}
