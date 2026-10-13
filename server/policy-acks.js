// A policy sent to people to read and acknowledge (D-169).
//
// The handbook told people what the rules are; nothing recorded that anybody had
// read them. The office now sends a PUBLISHED policy to a person, a department,
// a role or everyone, and each person acknowledges it in the app: their own name,
// the statement ticked, and their password — the same gate every other signature
// here goes through (server/signature.js).
//
// THE ACKNOWLEDGEMENT NAMES THE VERSION. `contentSha` is a hash of what the person
// was actually shown (the version label, the body and the stored file), frozen on
// the row. Revise the policy afterwards and the old acknowledgements read as
// "acknowledged an earlier version" — never as current, and never rewritten.
//
// The audience is resolved HERE, on the server, from the same rule the picker
// shows: active employees only. A guest client (`is_external`), an auditor pass
// and ReadyBot are not employees, so "everyone" cannot reach them.
import crypto from 'crypto';
import { randomUUID as uuid } from 'crypto';
import { logAudit } from './db.js';
import { readyDocOrigin } from './links.js';

export const ATTESTATION = (title, version) =>
  `I have read and understand ${title}${version ? ` (version ${version})` : ''}, and I agree to follow it.`;

export function contentSha(p) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([p?.version || '', p?.body || '', p?.storage_key || '']))
    .digest('hex');
}

const EMPLOYEE = "is_active = 1 AND role != 'auditor' AND name != 'ReadyBot' AND COALESCE(is_external, 0) = 0";

/** Everybody a policy can be sent to. */
export function eligiblePeople(db) {
  return db.prepare(`SELECT id, name, department, role FROM users WHERE ${EMPLOYEE} ORDER BY name`).all();
}

const today = () => new Date().toISOString().slice(0, 10);

/** Derived, never stored: pending / overdue / acknowledged / earlier version / cancelled. */
export function ackState(row, policy) {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'acknowledged') return row.ack_sha256 === contentSha(policy) ? 'acknowledged' : 'earlier_version';
  return row.due_date && row.due_date < today() ? 'overdue' : 'pending';
}

/** Counts per policy for the list — one query, not one per row. */
export function ackCounts(db, policies) {
  if (!policies.length) return new Map();
  const ids = policies.map(p => p.id);
  const rows = db.prepare(`SELECT policy_id, status, due_date, ack_sha256 FROM policy_acknowledgements
    WHERE status != 'cancelled' AND policy_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(policies.map(p => [p.id, p]));
  const out = new Map();
  for (const r of rows) {
    const c = out.get(r.policy_id) || { sent: 0, acknowledged: 0, pending: 0, overdue: 0, earlier_version: 0 };
    c.sent++; c[ackState(r, byId.get(r.policy_id))]++;
    out.set(r.policy_id, c);
  }
  return out;
}

/**
 * Who a send reaches. `everyone`, `departments` and `roles` are groups;
 * `user_ids` are people picked one by one. The union, de-duplicated.
 * An id that is not an active employee is reported, never silently dropped.
 */
export function resolveAudience(db, { everyone, departments, roles, user_ids } = {}) {
  const people = eligiblePeople(db);
  const byId = new Map(people.map(p => [p.id, p]));
  const picked = new Map();
  const depts = new Set((departments || []).map(d => String(d).toLowerCase()));
  const rls = new Set((roles || []).map(r => String(r).toLowerCase()));
  for (const p of people) {
    if (everyone || depts.has(String(p.department || '').toLowerCase()) || rls.has(String(p.role || '').toLowerCase())) picked.set(p.id, p);
  }
  const rejected = [];
  for (const id of user_ids || []) {
    const p = byId.get(id);
    if (p) picked.set(p.id, p);
    else {
      const u = db.prepare('SELECT name FROM users WHERE id = ?').get(id);
      rejected.push({ user_id: id, name: u?.name || id, why: 'not an active employee (a client, an auditor pass or a deactivated account)' });
    }
  }
  return { people: [...picked.values()], rejected };
}

/**
 * Send one or more policies to the resolved audience. Writes the rows in one
 * transaction and returns what to tell each person; the caller sends the DMs
 * after the response so a comms outage never fails the send.
 */
export function sendAcknowledgements(db, user, { policy_ids, due_date, note, ...audience }) {
  const ids = [...new Set((policy_ids || []).filter(Boolean))];
  if (!ids.length) return { error: 'Pick at least one policy.', status: 400 };
  if (!audience.everyone && !(audience.departments || []).length && !(audience.roles || []).length && !(audience.user_ids || []).length) {
    return { error: 'Pick who it goes to — everyone, a department, a role, or people by name.', status: 400 };
  }
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return { error: 'The due date must be a date.', status: 400 };
  if (due_date && due_date < today()) return { error: 'The due date is in the past.', status: 400 };

  const policies = []; const unavailable = [];
  for (const id of ids) {
    const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(id);
    if (!p) unavailable.push({ policy_id: id, why: 'not found' });
    else if (p.status !== 'published') unavailable.push({ policy_id: id, title: p.title, why: `it is ${p.status} — only a published policy can be sent` });
    else policies.push(p);
  }
  if (!policies.length) return { error: unavailable.map(u => `${u.title || 'A policy'}: ${u.why}`).join('; '), status: 409, unavailable };

  const { people, rejected } = resolveAudience(db, audience);
  if (!people.length) return { error: 'Nobody matches that — no active employee is in it.', status: 400, rejected };

  const created = []; const skipped = [];
  const tell = new Map();  // user_id -> { person, items: [] }
  db.transaction(() => {
    for (const p of policies) {
      const sha = contentSha(p);
      for (const person of people) {
        const open = db.prepare("SELECT id FROM policy_acknowledgements WHERE policy_id = ? AND user_id = ? AND status = 'pending'").get(p.id, person.id);
        if (open) { skipped.push({ policy: p.title, name: person.name, why: 'already waiting on them' }); continue; }
        const done = db.prepare("SELECT id FROM policy_acknowledgements WHERE policy_id = ? AND user_id = ? AND status = 'acknowledged' AND ack_sha256 = ?").get(p.id, person.id, sha);
        if (done) { skipped.push({ policy: p.title, name: person.name, why: 'already acknowledged this version' }); continue; }
        const id = uuid();
        db.prepare(`INSERT INTO policy_acknowledgements (id, policy_id, user_id, due_date, note, sent_version, sent_sha256, sent_by, sent_by_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.id, person.id, due_date || null, note ? String(note).slice(0, 500) : null,
          p.version || null, sha, user?.name || null, user?.id || null);
        created.push({ id, policy_id: p.id, policy: p.title, user_id: person.id, name: person.name });
        const t = tell.get(person.id) || { person, items: [] };
        t.items.push({ id, title: p.title, version: p.version });
        tell.set(person.id, t);
      }
    }
  })();
  logAudit(user, 'create', 'policy_acknowledgement', 'batch', {
    policies: policies.map(p => p.title), people: people.length, created: created.length, skipped: skipped.length,
    audience: { everyone: !!audience.everyone, departments: audience.departments || [], roles: audience.roles || [], named: (audience.user_ids || []).length },
  }, null, null, 'Policies sent for acknowledgement');
  return {
    created, skipped, rejected, unavailable,
    people_sent: tell.size, policies: policies.map(p => ({ id: p.id, title: p.title })),
    due_date: due_date || null, tell: [...tell.values()], note: note || null,
  };
}

/** One message per person however many policies went to them. */
export async function tellPeople(db, tell, { sentBy, due, note, reminder = false } = {}, deps) {
  let sent = 0;
  for (const { person, items } of tell) {
    const link = `${readyDocOrigin()}/?ack=${items[0].id}`;
    const list = items.map(i => `• *${i.title}*${i.version ? ` (v${i.version})` : ''}`).join('\n');
    const dueLine = due ? ` Please do it by ${due}.` : '';
    const body = reminder
      ? `⏰ Still waiting: please read and acknowledge ${items.length === 1 ? 'this policy' : `these ${items.length} policies`}.${dueLine}\n${list}\nThey are under "Documents to sign" in ReadyDoc, or [open the first one here](${link}).`
      : `📘 *${sentBy || 'The office'}* has sent you ${items.length === 1 ? 'a company policy' : `${items.length} company policies`} to read and acknowledge.${dueLine}\n${list}\n${note ? `${note}\n` : ''}They stay under "Documents to sign" until you [read and acknowledge them](${link}).`;
    try {
      const { bot, dm } = deps.botDm(db, person.id);
      await deps.postMessageAs(db, dm, bot, body);
      deps.pushToUser(person.id, {
        title: reminder ? 'A policy is waiting for you' : 'A policy to read and acknowledge',
        body: items.map(i => i.title).join(', '), tag: `policy-ack-${items[0].id}`, url: `/?ack=${items[0].id}`,
      }).catch(() => {});
      sent++;
    } catch { /* one person's DM must not stop the rest */ }
  }
  return sent;
}

/** Every other day: chase acknowledgements two days old or more, on each row's own clock. */
export async function policyAckNudges(db, deps) {
  const rows = db.prepare(`SELECT a.*, p.title, p.version FROM policy_acknowledgements a JOIN policies p ON p.id = a.policy_id
    WHERE a.status = 'pending' AND p.status = 'published'
      AND a.sent_at <= datetime('now', '-2 days') AND (a.last_nudge_at IS NULL OR a.last_nudge_at <= datetime('now', '-2 days'))`).all();
  const byPerson = new Map();
  for (const r of rows) {
    const t = byPerson.get(r.user_id) || { person: { id: r.user_id }, items: [] };
    t.items.push({ id: r.id, title: r.title, version: r.version });
    byPerson.set(r.user_id, t);
  }
  const sent = await tellPeople(db, [...byPerson.values()], { reminder: true }, deps);
  if (rows.length) db.prepare(`UPDATE policy_acknowledgements SET last_nudge_at = datetime('now') WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map(r => r.id));
  return { pending: rows.length, people: byPerson.size, sent };
}
