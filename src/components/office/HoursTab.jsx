import { useState, useEffect } from 'react';
import { useApiGet, apiPut, apiPost, apiFetch } from '../../hooks/useApi';
import { Users, Clock, Plus, X, Download, DollarSign } from 'lucide-react';
import { parseHours, formatHours, hoursInputValue } from '../../lib/hoursFormat';

// Hours worked vs paid non-working time, per pay period — merged in from the
// standalone tracker. The roster is live from Settings, so nobody keeps a
// second employee list, and the pay periods are the same biweekly ones the
// absence log uses.
//
// Auto-fill is the habit worth preserving: type what someone actually worked
// and the balance up to their weekly target shows as paid non-working time.
const periodLabel = (p) => {
  const f = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
  return `${f(p.start)} – ${f(p.end)}`;
};
const weekLabel = (w) => {
  const a = new Date(`${w}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86400000);
  return `${a.getUTCMonth() + 1}/${a.getUTCDate()}–${b.getUTCMonth() + 1}/${b.getUTCDate()}`;
};
const hrs = (n) => formatHours(n);
const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const money0 = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

/**
 * What to print in the Rate cell.
 *
 * A BLANK RATE AND NO PAY RECORD ARE DIFFERENT ANSWERS, and each is fixed
 * somewhere else. A Pay Tracking row with no rate is somebody SALARIED — which
 * is exactly what that column already says on the Pay Tracking roster, and
 * inventing a second word for it here would have two screens describing one
 * blank two ways. No row at all is somebody whose account nobody has linked to
 * the pay roster yet, which is the Roster tab's reconcile step.
 */
function rateLabel(p) {
  if (p.rate != null) return { text: `${money(p.rate)}/hr`, tone: 'text-gray-700', title: 'From Pay Tracking' };
  if (p.rate_linked) return { text: 'Salaried', tone: 'text-gray-400', title: 'On the pay roster with no hourly rate — no hourly cost is derived' };
  return { text: 'No pay record', tone: 'text-amber-600', title: 'Nobody has linked this account to a Pay Tracking row — link it on Pay Tracking → Roster and the rate appears here' };
}

/**
 * Add a contractor or temporary worker.
 *
 * They are STORED on the pay roster (`pay_employees`, `worker_type` =
 * contractor) because that is where a rate and its history already live — but
 * they are added and managed HERE, next to the hours they are paid for, which
 * is the question anybody actually has about a temp. Pay Tracking is raises and
 * reviews, and a contractor has neither.
 *
 * Deliberately NOT a `users` row: a temp who never signs in is not an account,
 * and giving them one would put them in the @mention list, the assignee picker,
 * Team Activity and the comms member list.
 */
function AddContractorModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', contractor_company: '', team: '', pay_rate: '', hire_date: '', ends_on: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setBusy(true); setError('');
    try {
      await apiPost('/pay/employees', {
        name: form.name.trim(), worker_type: 'contractor',
        contractor_company: form.contractor_company.trim() || null,
        team: form.team.trim() || null,
        pay_rate: form.pay_rate !== '' ? Number(form.pay_rate) : null,
        hire_date: form.hire_date || null, ends_on: form.ends_on || null,
      });
      onAdded?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const field = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  const label = 'block text-xs font-medium text-gray-700 mb-1';
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto" data-add-contractor>
        <h3 className="font-semibold text-gray-900 text-sm">Add a contractor or temporary worker</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <label className={label}>Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} className={field} data-contractor-name />
          </div>
          <div>
            <label className={label}>Agency or company</label>
            <input value={form.contractor_company} onChange={e => set('contractor_company', e.target.value)}
              className={field} placeholder="Leave blank if direct" />
          </div>
          <div>
            <label className={label}>Team</label>
            <input value={form.team} onChange={e => set('team', e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Pay rate</label>
            <input type="number" step="0.01" min="0" value={form.pay_rate} onChange={e => set('pay_rate', e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Started</label>
            <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Expected to end</label>
            <input type="date" value={form.ends_on} onChange={e => set('ends_on', e.target.value)} className={field} />
            <p className="text-[11px] text-gray-500 mt-0.5">A reminder, not a rule — nothing happens on this date by itself.</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onClick={save} disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hours are typed and shown as h:mm (39:56) and stored as decimal — see
// lib/hoursFormat. It has to be a text box, not type="number": a number input
// rejects the colon outright and a phone keyboard would never offer one.
// inputMode="text" keeps the numeric keypad's punctuation available.
function HourInput({ value, onCommit, tone = '', className = 'w-16' }) {
  const [draft, setDraft] = useState(hoursInputValue(value));
  // Re-sync when the saved value changes (a refresh after someone else's edit).
  useEffect(() => { setDraft(hoursInputValue(value)); }, [value]);

  const commit = () => {
    const next = parseHours(draft);
    // Normalize what's on screen ("39.93" → "39:56") whether or not it changed.
    setDraft(hoursInputValue(next));
    if (Math.abs(next - (Number(value) || 0)) > 0.0001) onCommit(next);
  };

  return (
    <input type="text" inputMode="text" value={draft} placeholder="0:00"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`${className} px-1.5 py-1 border border-gray-200 rounded text-sm text-right tabular-nums ${tone}`} />
  );
}

/**
 * One row of period cards for one kind of worker.
 *
 * A CONTRACTOR'S TARGET-DERIVED CARDS READ "—", NOT "0:00". Paid non-working
 * and overtime are both computed against a weekly target, and a contractor has
 * none — so those figures do not exist rather than being zero, and printing
 * 0:00 would state that none was owed when the question was never asked. Same
 * distinction the readiness model's `applies` draws, and the same one the
 * Target column already makes on every contractor row below.
 */
function TotalsRow({ label, count, totals = {}, kind }) {
  const contractor = kind === 'contractor';
  const cards = [
    { label: 'Worked', value: totals.worked, icon: Clock },
    { label: 'PTO', value: totals.pto },
    { label: 'Holiday', value: totals.holiday },
    { label: 'Paid non-working', value: totals.non_working, alert: (totals.non_working || 0) > 0, na: contractor },
    { label: 'Overtime', value: totals.overtime, alert: (totals.overtime || 0) > 0, na: contractor },
  ];
  // THE COST FIGURE SAYS HOW MANY PEOPLE IT COVERS. It is the rated people
  // only — a missing rate is not a free hour — so the figure is worth having
  // precisely because the line under it says "22 of 25". A bare total that
  // quietly left three people out would be understated and acted on.
  const unrated = totals.people_unrated || 0;
  return (
    <div data-totals-kind={kind}>
      {label && (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
          {label}
          {count != null && <span className="ml-1.5 font-normal text-gray-400">{count} {count === 1 ? 'person' : 'people'}</span>}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-3 py-2">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            {c.na
              ? <p className="text-lg font-bold text-gray-300" title="No weekly target, so there is nothing to balance up to">—</p>
              : (
                <p className={`text-lg font-bold tabular-nums ${c.alert ? 'text-amber-600' : 'text-gray-900'}`}
                  data-total={`${kind}:${c.label}`}>
                  {formatHours(c.value, { zero: '0:00' })}
                </p>
              )}
          </div>
        ))}
        <div className="bg-white rounded-xl border border-gray-200 px-3 py-2 col-span-2 sm:col-span-5">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <DollarSign size={11} /> Labour cost at the hours above
          </p>
          <p className="text-lg font-bold tabular-nums text-gray-900" data-total={`${kind}:cost`}>
            {money(totals.cost)}
          </p>
          <p className="text-[10px] text-gray-400" data-cost-basis={kind}>
            {money(totals.straight_cost)} straight
            {(totals.ot_premium || 0) > 0 && <> · <span className="text-amber-600">{money(totals.ot_premium)} overtime premium</span></>}
            {' · '}
            {unrated > 0
              ? <span className="text-amber-600">{totals.people_rated} of {totals.people} people have a rate</span>
              : <>all {totals.people_rated} {totals.people_rated === 1 ? 'person' : 'people'}</>}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The period, as a file.
 *
 * BUILT FROM WHAT IS ON THE SCREEN, not from a second endpoint. Every number
 * in the file is the number in the grid above it, so an export cannot disagree
 * with the page it was taken from — which is the whole reason anybody trusts
 * carrying it into a spreadsheet.
 */
function exportCsv(data) {
  const weeks = data?.weeks || [];
  const q = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const head = ['Name', 'Department', 'Worker type', 'Rate', 'Target/wk'];
  for (const w of weeks) head.push(`Worked ${w}`, `PTO ${w}`, `Holiday ${w}`, `Unpaid ${w}`, `Non-working ${w}`, `Overtime ${w}`, `Cost ${w}`);
  head.push('Period worked', 'Period PTO', 'Period holiday', 'Period unpaid', 'Period non-working',
    'Period overtime', 'Period paid hours', 'Straight cost', 'Overtime premium', 'Period cost');
  const lines = [head.map(q).join(',')];
  for (const p of data?.people || []) {
    const row = [p.name, p.department || p.contractor_company || '', p.is_contractor ? 'contractor' : 'employee',
      p.rate ?? '', p.target ?? ''];
    for (const w of p.weeks) row.push(w.worked, w.pto, w.holiday, w.unpaid, w.non_working, w.overtime, w.cost ?? '');
    const d = p.period;
    row.push(d.worked, d.pto, d.holiday, d.unpaid, d.non_working, d.overtime, d.total,
      d.straight_cost ?? '', d.ot_premium ?? '', d.cost ?? '');
    lines.push(row.map(q).join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `hours-${data?.period_start || 'period'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Take somebody off the Hours list.
 *
 * WHY THIS EXISTS AT ALL. The roster is derived — active accounts that are
 * not admins, auditors or guest clients, plus active contractors — and that
 * covers almost everybody correctly. What it cannot cover is the handful of
 * real judgement calls: somebody salaried, somebody whose hours are tracked
 * somewhere else, an account that is not a person. Those are decisions, so
 * they get a name, a date and a reason rather than a rule nobody agreed.
 *
 * IT IS NOT A DEACTIVATION. Their account is untouched and every hour already
 * filed stays exactly as filed — this is a payroll list, not a payroll record.
 */
function ExcludeButton({ person, onDone, className = '' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await apiPost('/office/hours/exclude', { row_id: person.user_id, reason });
      setOpen(false); setReason(''); onDone();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-exclude-open={person.user_id}
        title="Take them off this list — their account and every hour already filed are untouched"
        className={`text-[10px] text-gray-400 hover:text-red-600 ${className}`}>
        <X size={11} className="inline" /> not tracked
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3 max-h-[92vh] overflow-y-auto" data-exclude-modal>
        <p className="font-semibold text-gray-900">Take {person.name} off the Hours list</p>
        <p className="text-xs text-gray-500">
          Their account stays exactly as it is and every hour already filed is kept. They come off this
          list and out of its totals until somebody puts them back.
        </p>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Why are they not tracked here?</span>
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} data-exclude-reason
            placeholder="Salaried — not on the hourly list"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy || reason.trim().length < 3} data-exclude-save
            className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-40">
            {busy ? 'Saving…' : 'Take them off'}
          </button>
          <button type="button" onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-sm text-gray-500 rounded-lg hover:bg-gray-100">Cancel</button>
        </div>
      </div>
    </form>
  );
}

/**
 * The people who are off the list, and the way back.
 *
 * A NAME THAT SIMPLY VANISHED could never be questioned or undone — the same
 * reasoning that keeps a waived setup step on the equipment checklist and a
 * retired room in the log's filter. So the decision stays on screen, with who
 * made it and why, and putting somebody back is one click.
 */
function ExcludedStrip({ rows, onDone }) {
  const [open, setOpen] = useState(false);
  if (!rows?.length) return null;
  const restore = async (r) => {
    await apiFetch(`/office/hours/exclude/${r.row_id}`, { method: 'DELETE' });
    onDone();
  };
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3" data-excluded-strip>
      <button type="button" onClick={() => setOpen(o => !o)} data-excluded-toggle
        className="text-xs font-medium text-gray-600 hover:text-gray-900">
        {rows.length} {rows.length === 1 ? 'person is' : 'people are'} not tracked on this list
        <span className="text-gray-400"> · {open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {rows.map(r => (
            <li key={r.row_id} className="flex items-start gap-2 text-xs" data-excluded-row={r.row_id}>
              <span className="font-medium text-gray-800 shrink-0">{r.name}</span>
              <span className="text-gray-500 min-w-0">
                {r.reason}
                <span className="text-gray-400"> — {r.excluded_by || 'unknown'}{r.excluded_at ? `, ${String(r.excluded_at).slice(0, 10)}` : ''}</span>
                {!r.still_on_roster && <span className="text-gray-400"> · no longer on the roster anyway</span>}
              </span>
              <button type="button" onClick={() => restore(r)} data-excluded-restore={r.row_id}
                className="ml-auto shrink-0 text-[11px] font-medium text-powder-600 hover:text-powder-700">
                Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HoursTab() {
  const { data: periods } = useApiGet('/office/periods');
  const [period, setPeriod] = useState('');
  const activePeriod = period || periods?.[0]?.start || '';
  const { data, refresh } = useApiGet(activePeriod ? `/office/hours?period=${activePeriod}` : null, [activePeriod]);

  const save = async (userId, weekStart, patch) => {
    await apiPut('/office/hours', { user_id: userId, week_start: weekStart, ...patch });
    refresh();
  };
  // Employees first, then a labelled break, then contractors. One list rather
  // than two tables: the columns are identical and a second table would double
  // every future change to this grid.
  const people = data?.people || [];
  const employeeRows = people.filter(p => !p.is_contractor);
  const contractorRows = people.filter(p => p.is_contractor);
  const rows = [...employeeRows, { __divider: true }, ...contractorRows];
  const [addingContractor, setAddingContractor] = useState(false);

  // Taking a temp off the list DEACTIVATES rather than deletes. What we paid
  // somebody is a payroll record: the row and its rate history stay, the list
  // simply stops showing them, and the hours already logged for the period they
  // worked are untouched. Deleting outright is still possible in Pay Tracking
  // while nothing has been paid.
  const endContractor = async (p) => {
    if (!window.confirm(`Take ${p.name} off the list? Their hours and pay history are kept.`)) return;
    await apiFetch(`/pay/employees/${p.user_id}`, { method: 'PUT', body: JSON.stringify({ active: 0 }) });
    refresh();
  };

  const saveTarget = async (userId, target) => {
    await apiPut(`/office/hours/target/${userId}`, { target });
    refresh();
  };

  // Employees and contractors are totalled SEPARATELY, because they are two
  // different payroll jobs: one goes to ADP against a weekly target with PTO
  // and an overtime line, the other is hours worked on somebody's invoice. A
  // single row of cards covering both reads as the employee figure, since for
  // most periods the employees are most of it.
  //
  // The server derives both from the same rows the grid renders, so a card and
  // the column under it cannot disagree.
  const byType = data?.totals_by_type || {};
  const t = data?.totals || {};
  const hasContractors = (byType.contractor?.people || 0) > 0;
  const standardWeek = data?.standard_week ?? 40;
  const offTarget = people.filter(p => !p.is_contractor && p.target != null && p.target !== standardWeek);
  // Somebody with no Pay Tracking row at all has no rate here and never will
  // until the two are linked — so the empty cell is named, with where it is
  // fixed, rather than left reading as the rate column being broken.
  const unlinked = people.filter(p => !p.is_contractor && !p.rate_linked);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={activePeriod} onChange={e => setPeriod(e.target.value)}
          className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700">
          {(periods || []).map(p => (
            <option key={p.start} value={p.start}>{periodLabel(p)}{p.current ? ' · current' : ''}</option>
          ))}
        </select>
        <button onClick={() => exportCsv(data)} disabled={!data} data-hours-export
          className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          <Download size={13} /> Export CSV
        </button>
        <span className="text-xs text-gray-400">
          Weeks run Sunday–Saturday. Enter hours as <span className="font-medium text-gray-500">h:mm</span> (39:56) — decimals still work.
          The rest up to each person&apos;s target shows as paid non-working.
        </span>
      </div>

      {/* THE OVERTIME IN THE COST IS MEASURED AGAINST EACH PERSON'S OWN TARGET,
          which is the ordinary week for everybody unless somebody set
          otherwise — and where it is not, the money needs that said out loud
          rather than left to be inferred. Silent when every target is 40, so
          it never becomes wallpaper. */}
      {unlinked.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-unlinked-note>
          <span className="font-semibold">{unlinked.length} {unlinked.length === 1 ? 'person has' : 'people have'} no Pay Tracking record</span>
          {' '}— {unlinked.map(p => p.name).join(', ')}. Their hours are tracked; their cost cannot be, because nothing says what
          they are paid. Link the account on Pay Tracking → Roster and the rate appears here.
        </p>
      )}

      {offTarget.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-ot-basis-note>
          Overtime — and the premium inside the cost — is hours past each person&apos;s own weekly target, not past
          {' '}{standardWeek}. {offTarget.length === 1 ? `${offTarget[0].name} carries` : `${offTarget.length} people carry`}
          {' '}a different target{offTarget.length === 1 ? ` (${hrs(offTarget[0].target)})` : ''}, so their overtime here is not the same
          statement as a statutory over-{standardWeek} week.
        </p>
      )}

      {hasContractors
        ? (
          <div className="space-y-2" data-hours-totals>
            <TotalsRow label="Employees" count={byType.employee?.people} totals={byType.employee} kind="employee" />
            <TotalsRow label="Contractors &amp; temps" count={byType.contractor?.people} totals={byType.contractor} kind="contractor" />
            {/* The combined figure is kept and LABELLED, rather than removed —
                "what is the whole period" is still a question, it just must not
                be the only number on the screen. */}
            <p className="text-[11px] text-gray-500 text-right tabular-nums" data-hours-combined>
              Everyone · {byType.employee?.people + byType.contractor?.people} people ·
              {' '}<span className="font-semibold text-gray-700">{formatHours(t.worked, { zero: '0:00' })}</span> worked ·
              {' '}<span className="font-semibold text-gray-700">{formatHours(t.total, { zero: '0:00' })}</span> paid
            </p>
          </div>
        )
        : <TotalsRow totals={byType.employee || t} kind="employee" />}

      {/* Desktop: both weeks side by side */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              {/* Say how it's sorted — the names show first-name-first, so an
                  A–Z-by-surname list otherwise reads as no order at all. */}
              <th className="px-3 py-2">Employee <span className="text-gray-400 normal-case font-normal">· by last name</span></th>
              <th className="px-3 py-2">Target/wk</th>
              <th className="px-3 py-2">Rate</th>
              {(data?.weeks || []).map(w => (
                <th key={w} colSpan={5} className="px-3 py-2 text-center border-l border-gray-200">Week of {weekLabel(w)}</th>
              ))}
              <th className="px-3 py-2 text-right border-l border-gray-200">Period total</th>
            </tr>
            <tr className="text-left text-[10px] font-medium text-gray-400">
              <th className="px-3 pb-2" /><th className="px-3 pb-2" /><th className="px-3 pb-2" />
              {(data?.weeks || []).map(w => (
                <th key={w} colSpan={5} className="px-3 pb-2 border-l border-gray-200">
                  <div className="grid grid-cols-5 gap-1 text-center">
                    <span>Worked</span><span>PTO</span><span>Holiday</span><span>Unpaid</span><span>Non-work</span>
                  </div>
                </th>
              ))}
              <th className="px-3 pb-2 border-l border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (p.__divider ? (
              <tr key="contractor-divider" className="border-t-2 border-gray-300 bg-gray-50">
                <td colSpan={14} className="px-3 py-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Contractors &amp; temporary workers</span>
                    <span className="text-[11px] text-gray-400">No weekly target — their paid hours are the hours worked.</span>
                    <button onClick={() => setAddingContractor(true)} data-add-contractor-btn
                      className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
                      <Plus size={12} /> Add a contractor
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={p.user_id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="block text-[10px] text-gray-400 capitalize">
                    {p.is_contractor
                      ? (p.contractor_company || 'contractor')
                      : (p.department || '').replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  {p.is_contractor
                    ? <span className="text-[11px] text-gray-300" title="A contractor has no weekly target">—</span>
                    : <HourInput value={p.target} onCommit={v => saveTarget(p.user_id, v)} tone="text-gray-500" />}
                </td>
                <td className="px-3 py-1.5">
                  {(() => { const r = rateLabel(p); return (
                    <span className={`text-[11px] tabular-nums ${r.tone}`} title={r.title} data-rate={p.user_id}>{r.text}</span>
                  ); })()}
                </td>
                {p.weeks.map(w => (
                  <td key={w.week_start} colSpan={5} className="px-3 py-1.5 border-l border-gray-200">
                    <div className="grid grid-cols-5 gap-1 items-center">
                      <HourInput value={w.worked} onCommit={v => save(p.user_id, w.week_start, { worked: v })} />
                      <HourInput value={w.pto} onCommit={v => save(p.user_id, w.week_start, { pto: v })} />
                      <HourInput value={w.holiday} onCommit={v => save(p.user_id, w.week_start, { holiday: v })} />
                      <HourInput value={w.unpaid} onCommit={v => save(p.user_id, w.week_start, { unpaid: v })} />
                      <button
                        onClick={() => save(p.user_id, w.week_start, { auto_fill: !w.auto_fill })}
                        title={w.auto_fill ? 'Auto-filling to target — click to stop' : 'Not auto-filling — click to fill to target'}
                        className={`px-1.5 py-1 rounded text-xs font-medium ${
                          w.non_working > 0 ? 'bg-amber-100 text-amber-700'
                          : w.auto_fill ? 'text-gray-400 hover:bg-gray-100' : 'text-gray-300 line-through hover:bg-gray-100'}`}>
                        {w.non_working > 0 ? hrs(w.non_working) : (w.auto_fill ? 'auto' : 'off')}
                      </button>
                    </div>
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right border-l border-gray-200">
                  <span className="font-semibold text-gray-900">{hrs(p.period.total)}</span>
                  {p.period.overtime > 0 && <span className="block text-[10px] text-amber-600">{hrs(p.period.overtime)} OT</span>}
                  {p.period.cost != null && (
                    <span className="block text-[10px] text-gray-500 tabular-nums" data-cost={p.user_id}
                      title={p.period.ot_premium > 0
                        ? `${money(p.period.straight_cost)} straight + ${money(p.period.ot_premium)} overtime premium`
                        : 'Paid hours at their rate'}>
                      {money0(p.period.cost)}
                    </span>
                  )}
                  {p.is_contractor
                    ? (
                      <button onClick={() => endContractor(p)} title="Take them off the list — hours and pay history are kept"
                        data-end-contractor className="block ml-auto mt-0.5 text-[10px] text-gray-400 hover:text-red-600">
                        <X size={11} className="inline" /> remove
                      </button>
                    )
                    : <ExcludeButton person={p} onDone={refresh} className="block ml-auto mt-0.5" />}
                </td>
              </tr>
            )))}
            {(data?.people || []).length === 0 && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-gray-400">
                <Users size={18} className="inline mr-1" /> No active people in Settings yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phone and tablet: one card per person, one block per week. The same
          four numbers, big enough to actually tap. */}
      <div className="lg:hidden space-y-2">
        {people.map(p => (
          <div key={p.user_id} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{p.name}</p>
                <p className="text-[11px] text-gray-400 capitalize">
                  {p.is_contractor ? (p.contractor_company || 'contractor') : (p.department || '').replace('_', ' ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-gray-900">{hrs(p.period.total)}</p>
                <p className="text-[10px] text-gray-400">period total</p>
                {p.period.cost != null && (
                  <p className="text-[11px] font-semibold text-gray-600 tabular-nums">{money0(p.period.cost)}</p>
                )}
                {!p.is_contractor && <ExcludeButton person={p} onDone={refresh} className="mt-0.5" />}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Target / week</span>
              {p.is_contractor
                ? <span className="text-[11px] text-gray-300">—</span>
                : <HourInput value={p.target} onCommit={v => saveTarget(p.user_id, v)} tone="text-gray-500" />}
              {(() => { const r = rateLabel(p); return (
                <span className={`text-[11px] tabular-nums ${r.tone}`} title={r.title}>· {r.text}</span>
              ); })()}
              {p.period.overtime > 0 && (
                <span className="ml-auto text-[11px] font-semibold text-amber-600">{hrs(p.period.overtime)} OT</span>
              )}
            </div>

            {p.weeks.map(w => (
              <div key={w.week_start} className="mt-2 rounded-lg bg-gray-50 p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-gray-600">Week of {weekLabel(w.week_start)}</span>
                  <button onClick={() => save(p.user_id, w.week_start, { auto_fill: !w.auto_fill })}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      w.non_working > 0 ? 'bg-amber-100 text-amber-700'
                      : w.auto_fill ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-400 line-through'}`}>
                    {w.non_working > 0 ? `${hrs(w.non_working)} non-working` : (w.auto_fill ? 'auto-fill on' : 'auto-fill off')}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ['Worked', 'worked'], ['PTO', 'pto'], ['Holiday', 'holiday'], ['Unpaid', 'unpaid'],
                  ].map(([label, key]) => (
                    <label key={key} className="block">
                      <span className="block text-[10px] text-gray-400 mb-0.5">{label}</span>
                      <HourInput value={w[key]} className="w-full"
                        onCommit={v => save(p.user_id, w.week_start, { [key]: v })} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        {(data?.people || []).length === 0 && (
          <p className="text-center py-8 text-sm text-gray-400">No active people in Settings yet.</p>
        )}
        {/* Phone: the section header carries its own Add button, since the
            table's divider row is not rendered in this layout. */}
        <button onClick={() => setAddingContractor(true)}
          className="mt-2 w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700">
          <Plus size={13} /> Add a contractor
        </button>
      </div>

      <ExcludedStrip rows={data?.excluded} onDone={refresh} />

      {addingContractor && (
        <AddContractorModal onClose={() => setAddingContractor(false)} onAdded={refresh} />
      )}
    </div>
  );
}
