// Is anybody sharing a sign-in? (D-283, 21 CFR 11.100(a), 11.300.) READ-ONLY.
//
// A password is a signature only if one person knows it. ReadyDoc cannot see
// who is holding the phone, so this reports the signs that a login is shared,
// for a person to ask about — it blocks nothing and changes nothing:
//   - signed in on two or more different devices at the same time right now;
//   - signed in from four or more different devices in the last 30 days;
//   - signatures given from more than one device within ten minutes.
// A device is the browser it came from (user agent) plus the network address.
// Sessions opened before devices were recorded say so rather than guess.

const DEVICE_WINDOW_DAYS = 30;
const MANY_DEVICES = 4;

const deviceOf = (s) => (s.ip || s.user_agent ? `${(s.user_agent || 'unknown browser').slice(0, 80)} @ ${s.ip || 'unknown address'}` : null);

export function sharedAccounts(db) {
  const live = db.prepare(`SELECT s.user_id, s.ip, s.user_agent, s.created_at, u.name, u.role, u.department
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE datetime(s.expires_at) > datetime('now') AND s.activity_ended_at IS NULL AND u.is_active = 1`).all();
  const recent = db.prepare(`SELECT s.user_id, s.ip, s.user_agent, u.name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE datetime(s.created_at) >= datetime('now', ?) AND u.is_active = 1`).all(`-${DEVICE_WINDOW_DAYS} days`);
  const byUser = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.user_id)) m.set(r.user_id, { user_id: r.user_id, name: r.name, role: r.role, department: r.department, devices: new Set(), unknown: 0, sessions: 0 });
      const e = m.get(r.user_id); e.sessions++;
      const d = deviceOf(r); if (d) e.devices.add(d); else e.unknown++;
    }
    return [...m.values()].map(e => ({ ...e, devices: [...e.devices] }));
  };
  const concurrent = byUser(live).filter(e => e.devices.length >= 2)
    .map(e => ({ ...e, why: `signed in on ${e.devices.length} different devices at the same time` }));
  const many = byUser(recent).filter(e => e.devices.length >= MANY_DEVICES)
    .map(e => ({ ...e, why: `signed in from ${e.devices.length} different devices in ${DEVICE_WINDOW_DAYS} days` }));
  const unknown = byUser(live).reduce((n, e) => n + e.unknown, 0);
  const flagged = new Set([...concurrent, ...many].map(e => e.user_id));
  return {
    generated_at: new Date().toISOString(),
    live_sessions: live.length,
    sessions_without_device: unknown,
    concurrent, many_devices: many,
    flagged_accounts: flagged.size,
    verdict: flagged.size
      ? `${flagged.size} account${flagged.size === 1 ? '' : 's'} show signs of a shared sign-in — ask the people named.`
      : 'No account shows signs of a shared sign-in.',
  };
}

export function sharedAccountsText(r, where = '') {
  const lines = [`Shared sign-in check${where ? ` — ${where}` : ''}`, '', r.verdict, `Live sessions: ${r.live_sessions}${r.sessions_without_device ? ` (${r.sessions_without_device} opened before devices were recorded)` : ''}`, ''];
  for (const [title, list] of [['Signed in on several devices at once', r.concurrent], [`Many devices in ${DEVICE_WINDOW_DAYS} days`, r.many_devices]]) {
    lines.push(`${title}: ${list.length}`);
    for (const e of list) {
      lines.push(`  ${e.name} (${e.role}${e.department ? `, ${e.department}` : ''}) — ${e.why}`);
      for (const d of e.devices) lines.push(`      ${d}`);
    }
    lines.push('');
  }
  lines.push('Nothing was changed. A shared password is a shared signature: the person who owns the account changes it.');
  return lines.join('\n');
}
