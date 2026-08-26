// The Flash Report — what you could not otherwise know, pushed to you.
//
// The first design of this was a task list with a timestamp, and that was the
// wrong shape: Task Center, QA Review and the bell already carry what needs
// doing. A report that competes with a queue gets skimmed; a report that says
// something the queues cannot doesn't. So it is three things and no to-dos:
//
//   EXCEPTIONS  — a deviation from THIS PLANT'S OWN recent pattern. Not "12
//                 tasks overdue" but "Batching filed no EOD report yesterday
//                 for the first time in 40 shifts."
//   SCORECARD   — one number per domain with its direction and prior value.
//                 A figure that is fine but falling is the thing a dashboard
//                 never shows you.
//   OUTPUT      — what the plant made and what it cost. Nothing to act on;
//                 it is the picture, and ReadyDoc is the only place all of it
//                 exists together.
//
// Rules that keep it readable:
//  - A QUIET DAY PRODUCES A SHORT REPORT. A message the same length whether or
//    not anything is wrong trains the reader to skim it. `exceptions` returns
//    an empty array on a normal day and the daily report says one line.
//  - NOTHING IS INVENTED. A baseline needs enough history to mean something
//    (MIN_BASELINE); below that the check returns nothing rather than calling
//    the second day of a new team's work an anomaly.
//  - PURE. Rows in, report out — no Express, no comms, no writes. The caller
//    formats and sends. The numbers somebody is going to make decisions on
//    should be checkable without standing up a server, same as
//    `partner-recon.js` and `coa-submission.js`.

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n, from = new Date()) => iso(new Date(from.getTime() - n * DAY));

// A trend needs history behind it. Below this many prior observations a
// "first time in N" claim is not a claim, it is a coincidence.
const MIN_BASELINE = 8;

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/* ── Exceptions ───────────────────────────────────────────────────────────── */

/**
 * Each check returns null (nothing unusual) or an exception object. They are
 * deliberately narrow: a check that fires most days is noise, and noise is
 * what makes the whole report skippable.
 */
const EXCEPTION_CHECKS = [
  {
    id: 'no_production_entry',
    // A team that ran yesterday and filed nothing is a missing compliance
    // record, and it is invisible until somebody goes looking. This is the
    // single most valuable line in the report.
    run(db, { yesterday, windowStart }) {
      const teams = db.prepare(`SELECT team, COUNT(*) c FROM production_entries
        WHERE date >= ? AND date < ? GROUP BY team`).all(windowStart, yesterday);
      const filedYesterday = new Set(db.prepare('SELECT DISTINCT team FROM production_entries WHERE date = ?')
        .all(yesterday).map(r => r.team));
      const out = [];
      for (const t of teams) {
        // Only teams that normally file — a team with two entries in the
        // window has no pattern to deviate from.
        if (t.c < MIN_BASELINE || filedYesterday.has(t.team)) continue;
        const last = db.prepare('SELECT MAX(date) d FROM production_entries WHERE team = ?').get(t.team).d;
        out.push({
          id: `no_entry_${t.team}`, severity: 'high',
          text: `${t.team} filed no production entry for ${yesterday} — ${t.c} entries in the previous 30 days. Last one ${last}.`,
          tab: 'production-log',
        });
      }
      return out;
    },
  },
  {
    id: 'overdue_spike',
    // The COUNT is on every dashboard. What is not is whether it moved.
    run(db, { today }) {
      const now = db.prepare("SELECT COUNT(*) c FROM work_orders WHERE status IN ('open','in_progress','overdue','missed') AND due_date < ?").get(today).c;
      const week = db.prepare(`SELECT COUNT(*) c FROM work_orders
        WHERE status IN ('open','in_progress','overdue','missed') AND due_date < ? AND created_at < datetime('now','-7 day')`).get(today).c;
      if (now < 10 || week === 0) return null;
      const growth = pct(now - week, week);
      if (growth == null || growth < 25) return null;
      return [{
        id: 'overdue_spike', severity: 'high',
        text: `Overdue tasks are up ${growth}% in a week — ${week} → ${now}.`,
        tab: 'pm',
      }];
    },
  },
  {
    id: 'lab_overdue',
    // A sample that has been out past its expected date is money and product
    // sitting still, and nothing chases it.
    run(db, { today }) {
      const rows = db.prepare(`SELECT id, item_description, lot_number, expected_results_date
        FROM coa_requests WHERE status = 'sent' AND expected_results_date IS NOT NULL
        AND expected_results_date < ? ORDER BY expected_results_date LIMIT 5`).all(today);
      if (!rows.length) return null;
      const n = db.prepare(`SELECT COUNT(*) c FROM coa_requests WHERE status = 'sent'
        AND expected_results_date IS NOT NULL AND expected_results_date < ?`).get(today).c;
      const worst = rows[0];
      return [{
        id: 'lab_overdue', severity: 'medium',
        text: `${n} lab result${n === 1 ? '' : 's'} past the expected date — oldest is ${worst.item_description} lot ${worst.lot_number}, due ${worst.expected_results_date}.`,
        tab: 'coa',
      }];
    },
  },
  {
    id: 'excursion',
    // Yesterday's out-of-range readings. Adam is alerted live; this is the
    // record that it happened at all, for somebody who was not on shift.
    run(db, { yesterday }) {
      const n = db.prepare(`SELECT COUNT(*) c FROM scale_verifications
        WHERE date(performed_at) = ? AND result = 'fail'`).get(yesterday).c;
      if (!n) return null;
      return [{
        id: 'scale_fail', severity: 'high',
        text: `${n} scale verification${n === 1 ? '' : 's'} failed tolerance on ${yesterday}.`,
        tab: 'calibration',
      }];
    },
  },
  {
    id: 'qa_backlog_ageing',
    // The count is a badge. How OLD the oldest one is, is not.
    run(db, { today }) {
      const oldest = db.prepare(`SELECT MIN(date) d, COUNT(*) c FROM production_entries
        WHERE qa_signoff_by IS NULL AND qa_waived_at IS NULL`).get();
      if (!oldest?.d || !oldest.c) return null;
      const age = Math.floor((new Date(today) - new Date(oldest.d)) / DAY);
      if (age < 14) return null;
      return [{
        id: 'qa_ageing', severity: 'medium',
        text: `The oldest entry waiting on QA sign-off is ${age} days old (${oldest.c} waiting).`,
        tab: 'qa-review',
      }];
    },
  },
];

export function exceptions(db, now = new Date()) {
  const ctx = {
    today: iso(now),
    yesterday: daysAgo(1, now),
    windowStart: daysAgo(31, now),
  };
  const out = [];
  for (const check of EXCEPTION_CHECKS) {
    // One failing check must never cost the whole report — a schema that
    // differs on an older deploy should lose a line, not the message.
    try {
      const r = check.run(db, ctx);
      if (Array.isArray(r)) out.push(...r.filter(Boolean));
      else if (r) out.push(r);
    } catch { /* a check that cannot run says nothing */ }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

/* ── Scorecard ────────────────────────────────────────────────────────────── */

/**
 * One number per domain, each with the prior period's value so the DIRECTION
 * is visible. A percentage with no previous value beside it is a fact; with
 * one it is information.
 *
 * `prior` is null when there is no comparable prior period — rendered as "—",
 * never as a 0% change, which would read as "flat" when it means "unknown".
 */
export function scorecard(db, { days = 7, now = new Date() } = {}) {
  const end = iso(now);
  const start = daysAgo(days, now);
  const priorStart = daysAgo(days * 2, now);

  const wo = (from, to) => db.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) done,
      SUM(CASE WHEN status = 'completed' AND date(completed_at) <= due_date THEN 1 ELSE 0 END) on_time
    FROM work_orders WHERE due_date >= ? AND due_date < ?`).get(from, to);
  const a = wo(start, end), b = wo(priorStart, start);

  const kg = (from, to) => db.prepare(`SELECT COALESCE(SUM(quantity_completed), 0) q
    FROM production_entries WHERE date >= ? AND date < ?`).get(from, to).q;

  const labTat = (from, to) => db.prepare(`SELECT AVG(julianday(date_of_results) - julianday(date_sent)) t
    FROM coa_requests WHERE date_of_results IS NOT NULL AND date_sent IS NOT NULL
      AND date_of_results >= ? AND date_of_results < ?`).get(from, to).t;

  const qaWaiting = db.prepare(`SELECT COUNT(*) c FROM production_entries
    WHERE qa_signoff_by IS NULL AND qa_waived_at IS NULL`).get().c;

  const rows = [
    {
      id: 'pm_completion', label: 'PM completion', unit: '%',
      value: pct(a.done, a.total), prior: pct(b.done, b.total), better: 'up', tab: 'pm',
    },
    {
      id: 'pm_on_time', label: 'On time', unit: '%',
      value: pct(a.on_time, a.done), prior: pct(b.on_time, b.done), better: 'up', tab: 'pm',
    },
    {
      id: 'output', label: 'Output', unit: ' kg',
      value: Math.round(kg(start, end)), prior: Math.round(kg(priorStart, start)), better: 'up', tab: 'production-kpis',
    },
    {
      id: 'lab_tat', label: 'Lab turnaround', unit: ' d',
      value: round1(labTat(start, end)), prior: round1(labTat(priorStart, start)), better: 'down', tab: 'coa',
    },
    {
      id: 'qa_waiting', label: 'Waiting on QA', unit: '',
      value: qaWaiting, prior: null, better: 'down', tab: 'qa-review',
    },
  ];
  return rows.map(r => ({
    ...r,
    // The DELTA is the point, so it is computed here rather than left to the
    // renderer — two renderers subtracting in different orders is how a
    // report starts saying "up" about a number that fell.
    delta: (r.value != null && r.prior != null) ? round1(r.value - r.prior) : null,
    direction: (r.value == null || r.prior == null) ? null
      : (r.value > r.prior ? 'up' : r.value < r.prior ? 'down' : 'flat'),
  }));
}

/* ── What the plant produced ──────────────────────────────────────────────── */

export function output(db, { from, to, now = new Date() } = {}) {
  const start = from || daysAgo(1, now);
  const end = to || iso(now);
  const entries = db.prepare(`SELECT * FROM production_entries WHERE date >= ? AND date < ?`).all(start, end);

  const byTeam = new Map();
  for (const e of entries) {
    const t = byTeam.get(e.team) || { team: e.team, entries: 0, kg: 0, mos: 0, rooms: new Set() };
    t.entries += 1;
    t.kg += Number(e.quantity_completed || 0);
    if (e.room) t.rooms.add(e.room);
    const lines = (() => {
      try { return JSON.parse(e.mo_lines || '[]') || []; } catch { return []; }
    })();
    // An ADJUSTMENT reworks product already counted on the day it was made.
    // Counting it as an MO run here would inflate the week, the same reason
    // `lineQuantity()` gives it zero.
    t.mos += lines.length ? lines.filter(l => !l.is_adjustment).length : (e.mo_number ? 1 : 0);
    byTeam.set(e.team, t);
  }

  // COUNT ONLY. `disposals` carries no value column, and a dollar figure this
  // report cannot source is worse than no dollar figure — "what it cost" is
  // answered in weight and in how many write-offs happened, not invented.
  const disposals = db.prepare(`SELECT COUNT(*) c FROM disposals
    WHERE disposal_date >= ? AND disposal_date < ?`).get(start, end);

  return {
    from: start, to: end,
    teams: [...byTeam.values()].map(t => ({ ...t, kg: round1(t.kg), rooms: [...t.rooms] }))
      .sort((x, y) => y.kg - x.kg),
    total_kg: round1([...byTeam.values()].reduce((s, t) => s + t.kg, 0)),
    entries: entries.length,
    disposals: { count: disposals.c },
  };
}

/* ── Assembling one report ────────────────────────────────────────────────── */

export function buildReport(db, { period = 'daily', now = new Date() } = {}) {
  const days = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 1;
  return {
    period,
    generated_at: now.toISOString(),
    exceptions: exceptions(db, now),
    // The daily report carries a 7-day scorecard on purpose: a one-day
    // completion rate swings on a single task and says nothing.
    scorecard: scorecard(db, { days: period === 'daily' ? 7 : days, now }),
    output: output(db, {
      from: period === 'daily' ? daysAgo(1, now) : daysAgo(days, now),
      to: iso(now), now,
    }),
  };
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

const ARROW = { up: '▲', down: '▼', flat: '▬' };

// Bot bold is *text*, not **text** — the chat renderer is not markdown.
function scoreLine(r) {
  const v = r.value == null ? '—' : `${r.value}${r.unit}`;
  if (r.direction == null || r.direction === 'flat') return `${r.label}: ${v}`;
  const good = r.direction === r.better;
  const arrow = ARROW[r.direction];
  const delta = Math.abs(r.delta);
  return `${r.label}: ${v} ${arrow}${delta}${r.unit.trim()} ${good ? '' : '⚠️'}`.trim();
}

export function renderReport(report, { base = '' } = {}) {
  const { period, exceptions: ex, scorecard: sc, output: out } = report;
  const title = period === 'daily' ? '⚡ *Daily flash*'
    : period === 'weekly' ? '📊 *Weekly flash*' : '📆 *Monthly flash*';
  const lines = [title];

  // A QUIET DAY IS ONE LINE. This is the rule that keeps the report read.
  if (!ex.length) {
    lines.push('Nothing unusual.');
  } else {
    lines.push('', `*${ex.length} thing${ex.length === 1 ? '' : 's'} out of pattern*`);
    for (const e of ex) lines.push(`• ${e.text}${base && e.tab ? ` → ${base}/?tab=${e.tab}` : ''}`);
  }

  const scored = sc.filter(r => r.value != null);
  if (scored.length) {
    lines.push('', `*Where things stand* (vs the previous period)`);
    lines.push(scored.map(scoreLine).join('  ·  '));
  }

  if (out.entries) {
    lines.push('', `*${period === 'daily' ? 'Yesterday' : 'This period'}* — ${out.total_kg} kg over ${out.entries} entr${out.entries === 1 ? 'y' : 'ies'}`);
    for (const t of out.teams) {
      lines.push(`• ${t.team}: ${t.kg} kg · ${t.mos} MO${t.mos === 1 ? '' : 's'}${t.rooms.length ? ` · ${t.rooms.join(', ')}` : ''}`);
    }
    if (out.disposals.count) {
      lines.push(`• Disposals filed: ${out.disposals.count}`);
    }
  } else if (period === 'daily') {
    lines.push('', 'No production filed yesterday.');
  }

  return lines.join('\n');
}
