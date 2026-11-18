// The weekly payment run, part B (D-361): the run is FROZEN, Lowry reviews it,
// Danny gets a text with a link, approves on a page, and says when he has sent
// the money. The experience is the flavor approval's (a text, a page with the
// details, one button, the decision logged); the code is its own — the Flavor
// Approvals module is not touched.
//
// RULES, each load-bearing:
//   - FROZEN MEANS FROZEN. A run is a table of lines copied from the derived
//     page at the moment it is prepared. Correcting a bill afterwards does not
//     move what Danny is looking at; cancel and freeze again. Runs, lines and
//     the event log refuse DELETE (triggers); the log refuses UPDATE too.
//   - WHAT DANNY SEES IS WHAT PRODOUGH OWES: the deposit (materials, D-363) (ProDough
//     material bills ticked, at cost) + open production invoices (part E; none
//     until then) + the shortfall (Powder Ops expense bills ticked, less the
//     bank balance Lowry entered — shown only above zero). One number.
//   - THE LINK IS A SECRET THAT EXPIRES. 24 random bytes, stored as SHA-256,
//     clear text returned once. Issuing another (a re-send, the reminder)
//     kills the old one. Spent when the transfer is recorded or the run is
//     cancelled. Expires five days after it is issued.
//   - A MUST-PAY CANNOT BE UNTICKED. Everything else can, until approval.
//   - THE PERSON TYPES THEIR NAME. The link cannot know who holds it (the NFP
//     and flavor rule). Every act on the page logs the name, the address and
//     the device.
//   - A BOT NEVER APPROVES. Freezing, sending and cancelling are a person's
//     acts in the app; approving is the public page's alone.
import crypto, { randomUUID } from 'crypto';
import { plantDateOf } from './plant-clock.js';
import { readyDocOrigin } from './links.js';
import { smsEnabled, sendSms, approverPhone, OPT_OUT_LINE } from './sms.js';
import { paymentRun, getSettings, notifyRecipients, money, addDays, MATERIALS_MODES } from './payment-run.js';

export const LINK_DAYS = 5;
const OPEN = ['draft', 'sent'];
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Open production invoices to ProDough. Part E creates them; until then there are none. */
export function openProductionInvoices() {
  return [];
}

/** What ProDough owes Powder Ops this week, from the ticked lines. */
export function owes(lines, { bankBalance = null, production = [] } = {}) {
  const ticked = lines.filter(l => l.included);
  const sum = (arr) => round(arr.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const materials = sum(ticked.filter(l => l.bill_class === 'prodough_material'));
  const expenses = sum(ticked.filter(l => l.bill_class === 'powderops_expense'));
  const productionTotal = sum(production);
  const shortfall = bankBalance === null || bankBalance === undefined ? null : round(Math.max(0, expenses - Number(bankBalance)));
  return {
    bills: ticked.length, bills_total: sum(ticked), unticked: lines.length - ticked.length,
    materials, expenses, production: productionTotal, production_count: production.length,
    bank_balance: bankBalance === null || bankBalance === undefined ? null : round(bankBalance),
    shortfall, owes: round(materials + productionTotal + (shortfall || 0)),
  };
}

/** The one sentence Danny reads first. */
export function owesSentence(o) {
  const parts = [`deposit (materials) ${money(o.materials)}`];
  if (o.production_count) parts.push(`${o.production_count} production run${o.production_count === 1 ? '' : 's'} ${money(o.production)}`);
  if (o.shortfall > 0) parts.push(`shortfall ${money(o.shortfall)}`);
  return `ProDough owes Powder Ops ${money(o.owes)}: ${parts.join(' + ')}.`;
}

export function logEvent(db, runId, kind, { by = null, ip = null, device = null, detail = null } = {}) {
  db.prepare('INSERT INTO payment_run_events (id, run_id, kind, by_name, ip, device, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), runId, kind, by, ip ? String(ip).slice(0, 80) : null, device ? String(device).slice(0, 300) : null,
      detail === null ? null : JSON.stringify(detail));
}

const nextRunNo = (db, weekStart, kind) => {
  const base = `PR-${weekStart}${kind === 'urgent' ? '-U' : ''}`;
  const n = db.prepare('SELECT COUNT(*) n FROM payment_runs WHERE run_no LIKE ?').get(`${base}%`).n;
  return n ? `${base}-${n + 1}` : base;
};

/**
 * Freeze the run: copy what is on the page now into a run and its lines.
 * Weekly: everything on the run, one open weekly run per week. Urgent: the
 * bills named in `ids` (on the run or waiting for a later one), with a reason.
 */
export function freezeRun(db, { kind = 'weekly', ids = null, reason = null, by, today = plantDateOf() }) {
  const page = paymentRun(db, today);
  if (kind === 'urgent') {
    if (String(reason || '').trim().length < 3) throw Object.assign(new Error('Say why this run cannot wait for the weekly one.'), { status: 400 });
    if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('Pick the bills for the urgent run.'), { status: 400 });
  } else {
    const live = db.prepare("SELECT run_no, status FROM payment_runs WHERE kind = 'weekly' AND week_start = ? AND status <> 'cancelled'").get(page.run.week_start);
    if (live) throw Object.assign(new Error(`This week's run ${live.run_no} is already prepared (${live.status}). Cancel it first to prepare it again.`), { status: 409 });
  }
  const pool = kind === 'urgent' ? [...page.on_run, ...page.held] : page.on_run;
  let chosen = pool;
  if (kind === 'urgent') {
    const byId = new Map(pool.map(l => [l.id, l]));
    const missing = ids.filter(id => !byId.has(id));
    if (missing.length) throw Object.assign(new Error(`${missing.length} of the bills picked cannot be paid now (kept off the run, already on another run, or not in QuickBooks).`), { status: 400 });
    chosen = ids.map(id => byId.get(id));
  }
  if (!chosen.length) throw Object.assign(new Error('There are no bills on the run to prepare.'), { status: 400 });
  const s = getSettings(db);
  // A balance Lowry entered this week rides onto the run; an older one does not.
  const bal = s.bank_balance && plantDateOf(s.bank_balance.at) >= page.run.week_start ? s.bank_balance : null;
  const id = randomUUID();
  const runNo = nextRunNo(db, page.run.week_start, kind);
  db.transaction(() => {
    db.prepare(`INSERT INTO payment_runs (id, run_no, kind, week_start, run_date, status, reason, created_by, bank_balance, bank_balance_by, bank_balance_at, production_json)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`)
      .run(id, runNo, kind, page.run.week_start, kind === 'urgent' ? today : page.run.date, reason ? String(reason).trim().slice(0, 500) : null, by,
        bal ? bal.amount : null, bal ? bal.by : null, bal ? bal.at : null, JSON.stringify(openProductionInvoices(db)));
    const ins = db.prepare(`INSERT INTO payment_run_lines (id, run_id, drop_id, position, vendor, invoice_number, what, qty_text, amount, due_date, bill_class, must_pay, flags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    chosen.forEach((l, i) => ins.run(randomUUID(), id, l.id, i, l.vendor, l.invoice_number, l.what, l.qty, Number(l.amount) || 0, l.due_date,
      l.bill_class, l.must_pay ? 1 : 0, JSON.stringify(l.flags.map(f => ({ reason: f.reason, severity: f.severity })))));
    logEvent(db, id, 'frozen', { by, detail: { kind, bills: chosen.length, reason: reason || null } });
  })();
  return runView(db, id);
}

/** A run with its lines, the ProDough figure and its log. */
export function runView(db, id, { forApprover = false } = {}) {
  const run = db.prepare('SELECT * FROM payment_runs WHERE id = ?').get(id);
  if (!run) return null;
  const lines = db.prepare('SELECT * FROM payment_run_lines WHERE run_id = ? ORDER BY position').all(id)
    .map(l => ({ ...l, included: !!l.included, must_pay: !!l.must_pay, flags: (() => { try { return JSON.parse(l.flags_json || '[]'); } catch { return []; } })() }));
  const production = (() => { try { return JSON.parse(run.production_json || '[]'); } catch { return []; } })();
  const summary = owes(lines, { bankBalance: run.bank_balance, production });
  const view = {
    id: run.id, run_no: run.run_no, kind: run.kind, run_date: run.run_date, week_start: run.week_start, status: run.status, reason: run.reason,
    approved_name: run.approved_name, approved_at: run.approved_at, transferred_name: run.transferred_name, transferred_at: run.transferred_at,
    transferred_amount: run.transferred_amount,
    lines: lines.map(({ flags_json: _f, ...l }) => l), production, summary, sentence: owesSentence(summary),
    materials_mode: MATERIALS_MODES[getSettings(db).materials_mode] || null,
  };
  if (run.approved_totals) { try { view.approved_summary = JSON.parse(run.approved_totals); } catch { /* keep the live one */ } }
  if (forApprover) {
    // The approver sees bill lines and the money; not who prepared it, not the log.
    view.lines = view.lines.map(l => ({ id: l.id, vendor: l.vendor, invoice_number: l.invoice_number, what: l.what, qty_text: l.qty_text,
      amount: l.amount, due_date: l.due_date, bill_class: l.bill_class, must_pay: l.must_pay, flags: l.flags, included: l.included }));
    view.expires_at = run.token_expires_at;
    return view;
  }
  return {
    ...view, created_by: run.created_by, created_at: run.created_at,
    bank_balance_by: run.bank_balance_by, bank_balance_at: run.bank_balance_at,
    sent_to: run.sent_to, sent_by: run.sent_by, sent_at: run.sent_at, reviewed_by: run.reviewed_by, token_expires_at: run.token_expires_at,
    reminder_sent_at: run.reminder_sent_at, cancelled_by: run.cancelled_by, cancelled_at: run.cancelled_at, cancel_reason: run.cancel_reason,
    events: db.prepare('SELECT at, kind, by_name, ip, device, detail FROM payment_run_events WHERE run_id = ? ORDER BY at').all(id)
      .map(e => ({ ...e, detail: (() => { try { return JSON.parse(e.detail); } catch { return null; } })() })),
  };
}

export function listRuns(db, limit = 20) {
  return db.prepare('SELECT id FROM payment_runs ORDER BY created_at DESC LIMIT ?').all(limit).map(r => runView(db, r.id));
}

/** Lowry enters the balance Powder Ops can pay from. On a draft only. */
export function setBankBalance(db, runId, amount, by) {
  const run = db.prepare('SELECT * FROM payment_runs WHERE id = ?').get(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (run.status !== 'draft') throw Object.assign(new Error('The balance is set before the run goes to Danny.'), { status: 409 });
  const n = Number(amount);
  if (amount === '' || amount === null || !Number.isFinite(n)) throw Object.assign(new Error('Enter the bank balance as a number.'), { status: 400 });
  db.prepare("UPDATE payment_runs SET bank_balance = ?, bank_balance_by = ?, bank_balance_at = datetime('now') WHERE id = ?").run(round(n), by, runId);
  logEvent(db, runId, 'bank_balance', { by, detail: { from: run.bank_balance, to: round(n) } });
  return runView(db, runId);
}

function issueToken(db, runId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + LINK_DAYS * 86400000).toISOString();
  db.prepare('UPDATE payment_runs SET token_hash = ?, token_expires_at = ? WHERE id = ?').run(hash(token), expires, runId);
  return { token, link: `${readyDocOrigin()}/pay/${token}`, expires };
}

export const approverNumber = (db) => {
  const set = getSettings(db).approver_phone;
  return set ? `+1${set}` : approverPhone();
};

export function textFor(view, link) {
  const o = view.summary;
  return `Powder Ops payment run ${view.run_no}: ${owesSentence(o)} Transfer ${money(o.owes)}. ${o.bills} bill${o.bills === 1 ? '' : 's'}, ${money(o.bills_total)}. Review and approve: ${link} ${OPT_OUT_LINE}`;
}

/** Lowry's review is the send: a draft (or a re-send) gets a fresh link and the text. */
export async function sendForApproval(db, runId, { by, to = null }) {
  const run = db.prepare('SELECT * FROM payment_runs WHERE id = ?').get(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (!OPEN.includes(run.status)) throw Object.assign(new Error(`This run is ${run.status}; it cannot be sent.`), { status: 409 });
  if (run.bank_balance === null) throw Object.assign(new Error('Enter the bank balance first: the shortfall depends on it.'), { status: 400 });
  const view = runView(db, runId);
  if (!view.summary.bills) throw Object.assign(new Error('Every bill is unticked; there is nothing to approve.'), { status: 400 });
  let number = approverNumber(db);
  if (to) {
    const digits = String(to).replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) throw Object.assign(new Error('That does not look like a 10-digit phone number.'), { status: 400 });
    number = `+1${digits}`;
  }
  const { token, link, expires } = issueToken(db, runId);
  db.prepare(`UPDATE payment_runs SET status = 'sent', sent_by = ?, sent_at = datetime('now'), reviewed_by = COALESCE(reviewed_by, ?),
    reviewed_at = COALESCE(reviewed_at, datetime('now')), sent_to = ? WHERE id = ?`).run(by, by, number, runId);
  let texted = false, smsError = null;
  if (smsEnabled() && number) {
    try { await sendSms(number, textFor(view, link)); texted = true; } catch (e) { smsError = e.message; }
  }
  logEvent(db, runId, run.status === 'sent' ? 'resent' : 'sent', { by, detail: { to: number, texted, sms_error: smsError, owes: view.summary.owes, expires } });
  return { link, token, texted, sent_to: texted ? number : null, sms_configured: smsEnabled() && !!number, sms_error: smsError, expires };
}

/** The run a link opens, or why it does not. */
export function runByToken(db, token) {
  if (!token || String(token).length < 20) return { error: 'This link is not valid.', status: 404 };
  const run = db.prepare('SELECT * FROM payment_runs WHERE token_hash = ?').get(hash(token));
  if (!run) return { error: 'This link is not valid any more. A newer link may have been sent, or the run was finished.', status: 404 };
  if (run.status === 'cancelled') return { error: 'This payment run was cancelled.', status: 410 };
  if (run.token_expires_at && Date.parse(run.token_expires_at) < Date.now()) return { error: 'This link has expired. Ask Lowry to send a new one.', status: 410 };
  return { run };
}

export function untick(db, run, lineId, included, { name, ip, device }) {
  if (run.status !== 'sent') throw Object.assign(new Error('Bills can be ticked or unticked only before approval.'), { status: 409 });
  const line = db.prepare('SELECT * FROM payment_run_lines WHERE id = ? AND run_id = ?').get(lineId, run.id);
  if (!line) throw Object.assign(new Error('That bill is not on this run.'), { status: 404 });
  if (line.must_pay && !included) throw Object.assign(new Error('A must-pay bill stays on the run.'), { status: 409 });
  const want = included ? 1 : 0;
  if (line.included !== want) {
    db.prepare("UPDATE payment_run_lines SET included = ?, changed_by = ?, changed_at = datetime('now') WHERE id = ?").run(want, name || null, line.id);
    logEvent(db, run.id, want ? 'ticked' : 'unticked', { by: name || null, ip, device, detail: { line: line.id, vendor: line.vendor, invoice: line.invoice_number, amount: line.amount } });
  }
  return runView(db, run.id, { forApprover: true });
}

/** One button. The bills ticked move to `in_payment_run` against this run. */
export function approve(db, run, { name, ip, device }) {
  if (run.status !== 'sent') throw Object.assign(new Error(run.status === 'approved' || run.status === 'transferred' ? 'This run is already approved.' : 'This run is not waiting for approval.'), { status: 409 });
  const who = String(name || '').trim();
  if (who.length < 2) throw Object.assign(new Error('Type your name: an approval has to say who made it.'), { status: 400 });
  const view = runView(db, run.id);
  if (!view.summary.bills) throw Object.assign(new Error('Every bill is unticked; there is nothing to approve.'), { status: 400 });
  db.transaction(() => {
    db.prepare("UPDATE payment_runs SET status = 'approved', approved_name = ?, approved_at = datetime('now'), approved_totals = ? WHERE id = ?")
      .run(who.slice(0, 120), JSON.stringify(view.summary), run.id);
    const move = db.prepare("UPDATE ap_drops SET status = 'in_payment_run', payment_run_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'in_qbo'");
    const ev = db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_name, kind, detail) VALUES (?, ?, ?, 'payment_run_approved', ?)");
    for (const l of view.lines.filter(x => x.included)) {
      const r = move.run(run.id, l.drop_id);
      ev.run(randomUUID(), l.drop_id, who.slice(0, 120), JSON.stringify({ run: run.run_no, moved: r.changes === 1 }));
    }
    logEvent(db, run.id, 'approved', { by: who, ip, device, detail: { ...view.summary, unticked: view.lines.filter(l => !l.included).map(l => ({ vendor: l.vendor, invoice: l.invoice_number, amount: l.amount })) } });
  })();
  return runView(db, run.id, { forApprover: true });
}

/** "I've sent $X". Spends the link. */
export function recordTransfer(db, run, { name, amount, ip, device }) {
  if (run.status !== 'approved') throw Object.assign(new Error(run.status === 'transferred' ? 'The transfer is already recorded.' : 'Approve the run first.'), { status: 409 });
  const who = String(name || '').trim();
  if (who.length < 2) throw Object.assign(new Error('Type your name.'), { status: 400 });
  const expected = (() => { try { return JSON.parse(run.approved_totals).owes; } catch { return null; } })();
  const n = amount === undefined || amount === null || amount === '' ? expected : Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw Object.assign(new Error('Enter the amount you sent.'), { status: 400 });
  db.prepare("UPDATE payment_runs SET status = 'transferred', transferred_name = ?, transferred_at = datetime('now'), transferred_amount = ?, token_hash = NULL WHERE id = ?")
    .run(who.slice(0, 120), round(n), run.id);
  logEvent(db, run.id, 'transferred', { by: who, ip, device, detail: { amount: round(n), expected, differs: expected !== null && Math.abs(round(n) - expected) >= 0.01 } });
  return runView(db, run.id, { forApprover: true });
}

export function cancelRun(db, runId, { by, reason }) {
  const run = db.prepare('SELECT * FROM payment_runs WHERE id = ?').get(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (!OPEN.includes(run.status)) throw Object.assign(new Error(`A ${run.status} run cannot be cancelled.`), { status: 409 });
  if (String(reason || '').trim().length < 3) throw Object.assign(new Error('Say why the run is cancelled.'), { status: 400 });
  db.prepare("UPDATE payment_runs SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now'), cancel_reason = ?, token_hash = NULL WHERE id = ?")
    .run(by, String(reason).trim().slice(0, 500), runId);
  logEvent(db, runId, 'cancelled', { by, detail: { reason: String(reason).trim() } });
  return runView(db, runId);
}

// ── who hears what ───────────────────────────────────────────────────────────
async function tell(db, deps, users, body, title) {
  let sent = 0;
  for (const u of users) {
    try {
      const { bot, dm } = deps.botDm(db, u.id);
      await deps.postMessageAs(db, dm, bot, body);
      deps.pushToUser?.(u.id, { title, body: body.split('\n')[0].replace(/\*/g, '').slice(0, 120), tag: 'payment-run', url: '/?tab=payment-run' })?.catch?.(() => {});
      sent++;
    } catch (e) { console.warn('[payment-run] message failed:', e.message); }
  }
  return sent;
}
const withController = (db) => {
  const list = notifyRecipients(db);
  const c = getSettings(db).controller_id;
  const row = c ? db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(c) : null;
  return row && !list.some(u => u.id === row.id) ? [...list, row] : list;
};

/** After Danny approves or says he sent the money: Lowry and the Controller. */
export async function announce(db, deps, runId, kind) {
  const v = runView(db, runId);
  if (!v) return 0;
  if (kind === 'approved') {
    const off = v.lines.filter(l => !l.included);
    return tell(db, deps, withController(db), `*Payment run ${v.run_no} approved by ${v.approved_name}*\n${v.sentence}\n${v.summary.bills} bills, ${money(v.summary.bills_total)}`
      + `${off.length ? `\nUnticked (back on next week's run): ${off.map(l => `${l.vendor} ${money(l.amount)}`).join(', ')}` : ''}\nOpen: /?tab=payment-run`, 'Payment run approved');
  }
  if (kind === 'transferred') {
    const expected = v.approved_summary?.owes;
    const differs = expected !== undefined && Math.abs((v.transferred_amount || 0) - expected) >= 0.01;
    return tell(db, deps, withController(db), `*${v.transferred_name} says ${money(v.transferred_amount)} was sent* for payment run ${v.run_no}`
      + `${differs ? `\n*This is not the ${money(expected)} approved.* Check before paying.` : ''}\nNext: pay the approved bills in QuickBooks.\nOpen: /?tab=payment-run`, 'ProDough transfer sent');
  }
  return 0;
}

/**
 * On the run day, once: freeze the weekly run and tell Lowry it is ready for
 * review. With `review_before_send` off and a balance on the run, it goes to
 * Danny at once.
 */
export async function prepareWeeklyRun(db, deps, today = plantDateOf()) {
  let view;
  try { view = freezeRun(db, { kind: 'weekly', by: 'system:payment-run', today }); }
  catch (e) {
    if (e.status === 409 || /no bills/.test(e.message)) {
      const sent = await tell(db, deps, notifyRecipients(db), `*This week's payment run*: ${e.message}`, 'Payment run');
      return { frozen: false, reason: e.message, sent };
    }
    throw e;
  }
  const s = getSettings(db);
  if (!s.review_before_send && view.summary.bank_balance !== null) {
    const out = await sendForApproval(db, view.id, { by: 'system:payment-run' });
    const sent = await tell(db, deps, notifyRecipients(db), `*Payment run ${view.run_no} sent to Danny*\n${view.sentence}${out.texted ? '' : `\nThe text did not go: send this link by hand: ${out.link}`}\nOpen: /?tab=payment-run`, 'Payment run sent');
    return { frozen: true, sent_to_approver: out.texted, sent };
  }
  const sent = await tell(db, deps, notifyRecipients(db), `*This week's payment run ${view.run_no} is ready for your review*\n${view.sentence}`
    + `\n${view.summary.bills} bills, ${money(view.summary.bills_total)}${view.summary.bank_balance === null ? '\nEnter the bank balance, check the bills, then send it to Danny.' : '\nCheck the bills, then send it to Danny.'}\nOpen: /?tab=payment-run`, 'Payment run ready');
  return { frozen: true, sent };
}

/** When the reminder is due: Friday 10 AM of the run's week, or four hours after a later send. */
export function reminderDueAt(run) {
  const friday10 = `${addDays(run.week_start, 4)} 10:00`;
  const sent = run.sent_at ? new Date(Date.parse(`${run.sent_at.replace(' ', 'T')}Z`) + 4 * 3600000) : null;
  return { friday10, after_send: sent };
}

/** One reminder text to the approver and one note to Lowry, per run, if nothing is approved by then. */
export async function sendReminders(db, deps, { now = new Date(), wallDate, wallTime } = {}) {
  const due = db.prepare("SELECT * FROM payment_runs WHERE status = 'sent' AND reminder_sent_at IS NULL").all();
  let reminded = 0;
  for (const run of due) {
    const { friday10, after_send } = reminderDueAt(run);
    const pastFriday = `${wallDate} ${wallTime}` >= friday10;
    if (!pastFriday || (after_send && now < after_send)) continue;
    db.prepare("UPDATE payment_runs SET reminder_sent_at = datetime('now') WHERE id = ? AND reminder_sent_at IS NULL").run(run.id);
    const view = runView(db, run.id);
    const { link } = issueToken(db, run.id);
    let texted = false, err = null;
    const number = run.sent_to || approverNumber(db);
    if (smsEnabled() && number) {
      try { await sendSms(number, `Reminder: ${textFor(view, link)}`); texted = true; } catch (e) { err = e.message; }
    }
    logEvent(db, run.id, 'reminder', { by: 'system:payment-run', detail: { to: number, texted, sms_error: err } });
    await tell(db, deps, notifyRecipients(db), `*Payment run ${view.run_no} is not approved yet*\nDanny ${texted ? 'has been sent a reminder with a new link' : 'could not be texted a reminder'}.`
      + `${texted ? '' : `\nSend him this link by hand: ${link}`}\n${view.sentence}\nOpen: /?tab=payment-run`, 'Payment run waiting');
    reminded++;
  }
  return { reminded };
}
