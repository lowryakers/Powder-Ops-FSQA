// Accounts that share a name, side by side (D-262). READ-ONLY: every statement
// is a SELECT; it writes nothing, not even an audit row.
//
// Asked because Carol Pierce appears twice in Training. Two accounts with one
// name are not always a mistake — an auditor pass deliberately makes its own
// read-only account even when the visitor has a staff account — so this never
// merges anything. It lays the two side by side so a person can decide:
// which one signs in, how each was created, what is filed against each, and
// what is filed against the NAME only (which neither account can claim alone).
import { personKey } from './person-key.js';

const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const count = (db, sql, ...a) => safe(() => db.prepare(sql).get(...a)?.n ?? 0, null);

/** How an account came to exist, from its first audit entry. */
function howCreated(db, u) {
  const row = safe(() => db.prepare(`SELECT timestamp, actor, action, details FROM audit_log
    WHERE entity_type = 'user' AND entity_id = ? ORDER BY id LIMIT 1`).get(u.id), null);
  const d = safe(() => JSON.parse(row?.details || '{}'), {}) || {};
  if (String(u.password_hash || '').startsWith('pass:') || d.reason === 'auditor_pass') return { how: 'an auditor pass (read-only account, signs in by link)', by: row?.actor || null, at: row?.timestamp || null };
  if (row && row.action === 'create') return { how: d.reason ? `created (${d.reason})` : 'created in Settings → Users', by: row.actor, at: row.timestamp };
  if (row) return { how: 'no creation entry; first audit entry is an update', by: row.actor, at: row.timestamp };
  return { how: 'no audit entry (created before the audit log, by an import, or by a seed)', by: null, at: null };
}

function describe(db, u) {
  const created = howCreated(db, u);
  const lastLogin = safe(() => db.prepare(`SELECT MAX(timestamp) t FROM audit_log WHERE action = 'login' AND entity_type = 'user' AND entity_id = ?`).get(u.id)?.t, null);
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    department: u.department,
    active: !!u.is_active,
    client: !!u.is_external,
    not_trainee: !!u.not_trainee,
    created_at: u.created_at,
    created_how: created.how,
    created_by: created.by,
    can_sign_in: u.password_hash ? (String(u.password_hash).startsWith('pass:') ? 'auditor pass link only' : 'yes (password set)') : (u.pin ? 'PIN' : 'no password yet'),
    last_login: lastLogin,
    live_sessions: count(db, "SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND datetime(expires_at) > datetime('now')", u.id),
    auditor_passes: count(db, 'SELECT COUNT(*) n FROM auditor_passes WHERE user_id = ?', u.id),
    org_positions: safe(() => db.prepare('SELECT title FROM org_positions WHERE user_id = ?').all(u.id).map(r => r.title), []),
    training_records: count(db, 'SELECT COUNT(*) n FROM training_records WHERE employee_user_id = ?', u.id),
    training_tasks_open: count(db, "SELECT COUNT(*) n FROM work_orders WHERE training_course_id IS NOT NULL AND assigned_to_id = ? AND status IN ('open','in_progress','overdue','missed')", u.id),
    tasks_assigned: count(db, 'SELECT COUNT(*) n FROM work_orders WHERE assigned_to_id = ?', u.id),
    pay_roster: count(db, 'SELECT COUNT(*) n FROM pay_employees WHERE user_id = ?', u.id),
    chat_messages: count(db, 'SELECT COUNT(*) n FROM chat_messages WHERE user_id = ?', u.id),
    audit_entries: count(db, 'SELECT COUNT(*) n FROM audit_log WHERE actor_id = ?', u.id),
  };
}

/** Every group of two or more accounts whose names are the same person (personKey). */
export function sameNameAccounts(db, { name = null } = {}) {
  const users = db.prepare('SELECT * FROM users').all();
  const groups = new Map();
  for (const u of users) {
    const k = personKey(u.name);
    if (!k || (name && k !== personKey(name))) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  const out = [];
  for (const [k, list] of groups) {
    if (list.length < 2 && !name) continue;
    const names = [...new Set(list.map(u => u.name.toLowerCase()))];
    out.push({
      key: k,
      accounts: list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(u => describe(db, u)),
      // Filed under the NAME with no account on it — neither account owns these
      // until somebody decides which person they are.
      training_records_name_only: count(db, `SELECT COUNT(*) n FROM training_records
        WHERE employee_user_id IS NULL AND LOWER(employee_name) IN (${names.map(() => '?').join(',')})`, ...names),
    });
  }
  return { groups: out.sort((a, b) => a.key.localeCompare(b.key)), generated_at: new Date().toISOString() };
}

const ROWS = [
  ['Account id', 'id'], ['Name', 'name'], ['Signs in as', 'username'], ['Role', 'role'], ['Department', 'department'],
  ['Active', 'active'], ['Client account', 'client'], ['Not a trainee', 'not_trainee'],
  ['Created', 'created_at'], ['How created', 'created_how'], ['Created by', 'created_by'],
  ['Can sign in', 'can_sign_in'], ['Last sign-in', 'last_login'], ['Live sessions', 'live_sessions'],
  ['Auditor passes', 'auditor_passes'], ['Org chart position', 'org_positions'],
  ['Training records', 'training_records'], ['Open training tasks', 'training_tasks_open'],
  ['Tasks ever assigned', 'tasks_assigned'], ['Pay roster rows', 'pay_roster'],
  ['Chat messages', 'chat_messages'], ['Audit entries as actor', 'audit_entries'],
];

/** The side-by-side as plain text, for the Settings card and the CLI. */
export function sameNameText(r, source = '') {
  const lines = [`Accounts that share a name${source ? ` — ${source}` : ''}`, ''];
  if (!r.groups.length) return [...lines, 'None. Every account has its own name.'].join('\n');
  for (const g of r.groups) {
    const w = 30;
    const cell = (v) => (Array.isArray(v) ? (v.join(', ') || '—') : v === true ? 'yes' : v === false ? 'no' : v == null || v === '' ? '—' : String(v));
    const colW = Math.max(18, ...g.accounts.flatMap(a => ROWS.map(([, k]) => Math.min(64, cell(a[k]).length)))) + 2;
    lines.push(`■ ${g.accounts[0]?.name || g.key} — ${g.accounts.length} accounts`);
    lines.push(`${''.padEnd(w)}${g.accounts.map((_, i) => `Account ${i + 1}`.padEnd(colW)).join('')}`);
    for (const [label, k] of ROWS) {
      lines.push(`${label.padEnd(w)}${g.accounts.map(a => cell(a[k]).slice(0, 64).padEnd(colW)).join('')}`);
    }
    lines.push(`${'Training filed by NAME only'.padEnd(w)}${g.training_records_name_only ?? '—'} (counted for whichever account carries the name)`);
    lines.push('');
  }
  return lines.join('\n');
}
