import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { usePageTranslation } from '../../lib/usePageTranslation.js';
import LangToggle from '../LangToggle.jsx';
import DataGrid from './DataGrid.jsx';
import { CHARACTERISTICS, MAX_SCORE, BANDS, bandFor, VISION, CORE_VALUES } from './payRubric.js';
import {
  AlertTriangle, Check, X, TrendingUp, Users, Clock, DollarSign, RefreshCw, FileText,
  Plus, Trash2, Pencil, ClipboardCheck,
} from 'lucide-react';

// Pay Tracking.
//
// The roster (real rates, annual cost, rate history) is admin-only. The
// evaluation tool is available to anyone granted the module and shows no pay
// data at all — only the rubric and the increase band a score lands in — so a
// supervisor can run an evaluation without company pay on their screen.
//
// Submitting an evaluation SAVES it (scores, notes, the band it landed in) so
// the admin can read every review — supervisor's and Adam's — before deciding
// an increase. A reviewer sees only their own submissions; supervisors are
// reviewed only by Adam or an admin (the picker doesn't offer them to anyone
// else, and the server enforces the same rule). No review carries pay data.

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const money0 = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);

const REVIEW_TONE = {
  due: 'bg-red-100 text-red-700',
  soon: 'bg-amber-100 text-amber-800',
  ok: 'bg-green-100 text-green-700',
  unknown: 'bg-gray-100 text-gray-500',
};
const REVIEW_LABEL = { due: 'Due', soon: 'Soon', ok: 'OK', unknown: '—' };

/* ── Evaluation ─────────────────────────────────────────── */

function Evaluation({ people, canApply, onClose, onRecorded, tr, lang, assignments = [] }) {
  const [personId, setPersonId] = useState('');
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const person = people.find(p => p.id === personId) || null;
  const answered = CHARACTERISTICS.filter(c => scores[c.key]).length;
  const complete = answered === CHARACTERISTICS.length;
  const total = CHARACTERISTICS.reduce((s, c) => s + (scores[c.key] || 0), 0);
  const band = complete ? bandFor(total) : null;
  // The workbook singles this out in a footnote that is easy to read past, so
  // it gets its own alert rather than living inside the total.
  const hardFlag = CHARACTERISTICS.some(c => c.hardFlagAtOne && scores[c.key] === 1);

  const reset = () => { setScores({}); setNotes(''); setDone(null); setError(''); };

  // The hand-out for the meeting. It carries the descriptor picked for each
  // value — the feedback in the company's own words — plus notes and the
  // recommendation, and deliberately no numbers: no 1/2/3, no total. Nothing
  // is stored; the server renders and streams it straight back.
  const openPdf = async () => {
    if (!person || !complete) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/pay/evaluation-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({
          employee_name: person.name,
          team: person.team,
          date: todayStr(),
          lang,
          notes,
          recommendation: band ? tr(band.label) : '',
          attendance_flag: hardFlag,
          lines: CHARACTERISTICS.map(c => ({
            title: tr(c.title),
            subtitle: tr(c.subtitle),
            descriptor: tr(c.levels[scores[c.key]]),
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not build the PDF.');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const submitReview = async () => {
    if (!person || !complete) return;
    setBusy(true); setError('');
    try {
      // The recommendation is stored in English regardless of the page
      // language — it's the band label the admin reads against the rubric.
      await apiPost(`/pay/employees/${person.id}/reviews`, {
        scores, notes, review_date: todayStr(),
        recommendation: band?.label || '', attendance_flag: hardFlag,
      });
      setDone('Review submitted. The scores and notes are now visible to the admin, who decides any increase.');
      onRecorded?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
        <p className="text-sm font-semibold text-blue-900">{tr('Submitting saves this review for the admin.')}</p>
        <p className="text-xs text-blue-800 mt-0.5">
          {tr('Your scores and notes go to the admin, who reads every review — including a second reviewer’s — before deciding any increase. Nothing here shows or asks for anyone’s pay.')}
        </p>
      </div>

      {/* What has actually been asked of you. Without this the review cycle
          ran on somebody remembering to ask a supervisor in person. */}
      {assignments.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-1.5">
          <p className="text-sm font-semibold text-amber-900">
            {tr('Evaluations assigned to you')} ({assignments.length})
          </p>
          {assignments.map(a => (
            <button key={a.id} type="button"
              onClick={() => { setPersonId(a.employee_id); reset(); }}
              className={`w-full text-left flex items-center gap-2 flex-wrap rounded-lg border px-2.5 py-1.5 transition-colors ${
                personId === a.employee_id ? 'border-amber-500 bg-white ring-1 ring-amber-300' : 'border-amber-200 bg-white hover:border-amber-400'}`}>
              <span className="text-sm font-medium text-gray-900">{a.employee_name}</span>
              {a.team && <span className="text-[11px] text-gray-500">{a.team}</span>}
              <span className={`ml-auto text-[11px] ${a.overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                {a.due_date ? `${a.overdue ? tr('overdue') : tr('due')} ${fmtDate(a.due_date)}` : tr('no due date')}
              </span>
              {a.note && <span className="w-full text-[11px] text-gray-600">{a.note}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
        <label className="block text-xs font-medium text-gray-700">{tr('Employee')}</label>
        <select value={personId} onChange={e => { setPersonId(e.target.value); reset(); }}
          className="w-full sm:max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">{tr('Select an employee…')}</option>
          {people.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}{p.team ? ` — ${p.team}` : ''}{p.review?.status === 'due' ? ' (due)' : ''}
            </option>
          ))}
        </select>
        {person?.review?.days != null && (
          <p className="text-[11px] text-gray-500">
            {tr('Last raise or review')}: {fmtDate(person.review.since)} · {person.review.days} {tr('days ago')}
          </p>
        )}
      </div>

      {person && (
        <>
          {CHARACTERISTICS.map(c => (
            <div key={c.key} className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-sm font-bold text-gray-900">{tr(c.title)}</p>
              <p className="text-[11px] text-gray-500 mb-2">{tr(c.subtitle)}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[1, 2, 3].map(n => {
                  const picked = scores[c.key] === n;
                  const heading = n === 1 ? 'Below Expectation' : n === 2 ? 'Meets Expectation' : 'Exceeds Expectation';
                  return (
                    <button key={n} type="button"
                      onClick={() => setScores(s => ({ ...s, [c.key]: picked ? undefined : n }))}
                      className={`text-left rounded-lg border p-2.5 transition-colors ${picked
                        ? 'border-powder-500 bg-powder-50 ring-1 ring-powder-400'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${picked ? 'text-powder-700' : 'text-gray-500'}`}>
                        {picked && <Check size={11} />}{n} — {tr(heading)}
                      </span>
                      <span className="block mt-1 text-[11px] leading-snug text-gray-600">{tr(c.levels[n])}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {hardFlag && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-2.5 flex gap-2">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-900">{tr('Review conversation required')}</p>
                <p className="text-xs text-red-800">
                  {tr('A score of 1 in Time & Attendance triggers a review conversation regardless of the total score.')}
                </p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Notes / Feedback')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder={tr('Goes to the admin with your scores.')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className={`rounded-xl border-2 p-4 ${band ? band.tone : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold">
                {tr('Total score')}: <span className="text-2xl font-bold">{total}</span> / {MAX_SCORE}
              </p>
              {!complete && (
                <span className="text-xs font-medium opacity-80">
                  {answered} / {CHARACTERISTICS.length} {tr('scored')}
                </span>
              )}
            </div>
            {band ? (
              <div className="mt-1">
                <p className="text-sm font-medium">{tr(band.performance)}</p>
                <p className="text-lg font-bold mt-0.5">
                  {tr(band.label)}{band.approx ? <span className="ml-2 text-xs font-medium opacity-75">{tr(band.approx)}</span> : null}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-gray-500">{tr('Score every characteristic to see the recommended increase.')}</p>
            )}
          </div>

          {done && <p className="text-sm text-green-700 font-medium">{tr(done)}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button onClick={openPdf} disabled={busy || !complete}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50">
              <FileText size={14} /> {busy ? tr('Building…') : tr('PDF for the conversation')}
            </button>
            <span className="text-[11px] text-gray-500 self-center">
              {tr('The sheet carries the feedback and the recommendation — no score.')}
            </span>
            <button onClick={submitReview} disabled={busy || !complete}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              <Check size={14} /> {busy ? tr('Submitting…') : tr('Submit review')}
            </button>
            <button onClick={reset} className="px-3 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
              {tr('Clear')}
            </button>
            {canApply && band && band.increase > 0 && (
              <span className="text-[11px] text-gray-500 self-center">
                {tr('To apply the increase, open this person on the Roster tab.')}
              </span>
            )}
            {onClose && (
              <button onClick={onClose} className="ml-auto px-3 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
                {tr('Close')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Roster drawer (admin) ──────────────────────────────── */

// One submitted review, rendered for the admin: who, when, the score, the band
// it landed in, and the notes — the thing to read before deciding an increase.
function ReviewCard({ r, tr }) {
  const [showScores, setShowScores] = useState(false);
  const byKey = Object.fromEntries(CHARACTERISTICS.map(c => [c.key, c]));
  return (
    <div className={`rounded-lg border p-2.5 ${r.status === 'open' ? 'border-powder-200 bg-powder-50/40' : 'border-gray-200 bg-gray-50 opacity-80'}`}>
      <div className="flex items-baseline gap-2 flex-wrap text-xs">
        <span className="font-semibold text-gray-900">{r.reviewer_name}</span>
        <span className="text-gray-400">{fmtDate(r.review_date)}</span>
        <span className="font-bold text-gray-900">{r.total} / {MAX_SCORE}</span>
        {r.recommendation && <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 font-medium text-gray-700">{r.recommendation}</span>}
        {!!r.attendance_flag && (
          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">{tr('attendance flag')}</span>
        )}
        {r.status !== 'open' && <span className="text-gray-400">· {r.resolution || r.status}</span>}
      </div>
      {r.notes && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{r.notes}</p>}
      <button onClick={() => setShowScores(s => !s)} className="text-[11px] text-powder-600 hover:underline mt-1">
        {showScores ? tr('Hide scores') : tr('Show scores')}
      </button>
      {showScores && (
        <ul className="mt-1 space-y-0.5">
          {Object.entries(r.scores || {}).map(([k, v]) => (
            <li key={k} className="text-[11px] text-gray-600">
              <span className="font-medium">{byKey[k] ? tr(byKey[k].title) : k}</span>: {v} — {byKey[k] ? tr(byKey[k].levels[v]) : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Details an admin can correct: the review clock (a test review logged by
// mistake), hire date, PTO plan, team. Every save is the audited PUT.
function DetailsEditor({ data, onSaved, tr }) {
  const [form, setForm] = useState({
    team: data.team || '', hire_date: data.hire_date || '',
    pto_plan: data.pto_plan || '', is_supervisor: !!data.is_supervisor,
    active: !!data.active, last_reviewed_at: data.last_reviewed_at || '',
    last_increase_at: data.last_increase_at || '', notes: data.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiPut(`/pay/employees/${data.id}`, {
        team: form.team || null, hire_date: form.hire_date || null,
        pto_plan: form.pto_plan || null, is_supervisor: form.is_supervisor,
        active: form.active, last_reviewed_at: form.last_reviewed_at || null,
        last_increase_at: form.last_increase_at || null, notes: form.notes || null,
      });
      onSaved?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const field = (label, key, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={e => set(key, e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {field(tr('Team'), 'team')}
        {field(tr('Hire date'), 'hire_date', 'date')}
        {field(tr('PTO plan'), 'pto_plan', 'text', tr('e.g. 3 hr / 4 hr'))}
        {field(tr('Last review'), 'last_reviewed_at', 'date')}
        {field(tr('Last raise'), 'last_increase_at', 'date')}
        <div className="flex items-end gap-4 pb-1">
          <label className={`flex items-center gap-1.5 text-sm ${data.linked ? 'text-gray-400' : 'text-gray-700'}`}>
            <input type="checkbox" checked={form.is_supervisor} disabled={!!data.linked}
              onChange={e => set('is_supervisor', e.target.checked)} className="rounded border-gray-300" />
            {tr('Supervisor')}
            {data.linked && <span className="text-[11px]">({tr('follows their role in Settings')})</span>}
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="rounded border-gray-300" />
            {tr('Active')}
          </label>
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        {tr('Correcting the review or raise date here fixes a mistaken entry — the change is audited with the old and new values.')}
      </p>
      <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder={tr('Notes')}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={save} disabled={busy}
        className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
        {busy ? tr('Saving…') : tr('Save details')}
      </button>
    </div>
  );
}

function PersonDrawer({ id, onClose, onChanged, tr }) {
  const { data, refresh } = useApiGet(`/pay/employees/${id}`, [id]);
  const [newRate, setNewRate] = useState('');
  const [effective, setEffective] = useState(todayStr());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editDetails, setEditDetails] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  if (!data) return null;
  const rate = data.pay_rate;
  const openReviews = (data.reviews || []).filter(r => r.status === 'open');
  const earlierReviews = (data.reviews || []).filter(r => r.status !== 'open');
  const combined = openReviews.length
    ? openReviews.reduce((s, r) => s + (r.total || 0), 0) / openReviews.length : null;
  const combinedBand = combined != null ? bandFor(Math.round(combined)) : null;

  const apply = async () => {
    setBusy(true); setError('');
    try {
      await apiPost(`/pay/employees/${id}/rate`, { new_rate: Number(newRate), effective_at: effective, note });
      setNewRate(''); setNote('');
      refresh(); onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const closeFlat = async () => {
    const reason = window.prompt(tr('Close these reviews without an increase — why? (recorded as the outcome)'));
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setError('');
    try {
      await apiPost(`/pay/employees/${id}/reviews/resolve`, { resolution: reason.trim() });
      refresh(); onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const removeRow = async () => {
    if (!window.confirm(tr('Remove this person from the Pay Tracking roster? Only rows added by mistake can be removed.'))) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/pay/employees/${id}`, { method: 'DELETE' });
      onChanged?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const quick = BANDS.filter(b => b.increase > 0);

  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-start justify-center overflow-y-auto sm:p-4">
      <div className="bg-gray-50 w-full max-w-xl min-h-full sm:min-h-0 sm:rounded-2xl sm:my-6 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sm:rounded-t-2xl sticky top-0 z-10">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{data.name}</h3>
            <p className="text-[11px] text-gray-500">
              {data.team || tr('No team')} · {tr('Hired')} {fmtDate(data.hire_date)}
              {data.is_supervisor ? ` · ${tr('Supervisor')}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: tr('Rate'), value: rate != null ? money(rate) : tr('Salaried') },
              { label: tr('Annual'), value: data.annual != null ? money0(data.annual) : '—' },
              { label: tr('PTO plan'), value: data.pto_plan || '—' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">{c.label}</p>
                <p className="text-lg font-bold text-gray-900">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Submitted reviews — what to read BEFORE deciding an increase. Two
              open reviews (supervisor + Adam) show their combined average. */}
          {(openReviews.length > 0 || earlierReviews.length > 0) && (
            <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <ClipboardCheck size={14} className="text-powder-600" /> {tr('Reviews')}
                </p>
                {combined != null && (
                  <span className="text-xs text-gray-600">
                    {tr('Combined')}: <span className="font-bold text-gray-900">{combined.toFixed(1)} / {MAX_SCORE}</span>
                    {openReviews.length > 1 ? ` (${openReviews.length} ${tr('reviews')})` : ''}
                    {combinedBand ? <span className="ml-1.5 font-semibold">{tr(combinedBand.label)}</span> : null}
                  </span>
                )}
              </div>
              {openReviews.length === 0 && (
                <p className="text-xs text-gray-400">{tr('No open reviews — earlier ones are below.')}</p>
              )}
              {openReviews.map(r => <ReviewCard key={r.id} r={r} tr={tr} />)}
              {openReviews.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[11px] text-gray-500 flex-1">
                    {tr('Applying an increase below closes these reviews with the decision on them.')}
                  </p>
                  <button onClick={closeFlat} disabled={busy}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    {tr('Close without increase…')}
                  </button>
                </div>
              )}
              {earlierReviews.length > 0 && (
                <button onClick={() => setShowEarlier(s => !s)} className="text-[11px] text-powder-600 hover:underline">
                  {showEarlier ? tr('Hide earlier reviews') : `${tr('Show earlier reviews')} (${earlierReviews.length})`}
                </button>
              )}
              {showEarlier && earlierReviews.map(r => <ReviewCard key={r.id} r={r} tr={tr} />)}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <p className="text-sm font-semibold text-gray-900">{tr('Apply a pay increase')}</p>
            {rate != null && (
              <div className="flex flex-wrap gap-1.5">
                {quick.map(b => (
                  <button key={b.increase} onClick={() => setNewRate(String(rate + b.increase))}
                    className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    +{b.increase.toFixed(2)} → {money(rate + b.increase)}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{tr('New rate')}</label>
                <input type="number" step="0.01" min="0" value={newRate} onChange={e => setNewRate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={rate != null ? String(rate) : '0.00'} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Effective date')}</label>
                <input type="date" value={effective} onChange={e => setEffective(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={tr('Note (optional)')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button onClick={apply} disabled={busy || !newRate}
              className="w-full sm:w-auto px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              {busy ? tr('Applying…') : tr('Apply increase')}
            </button>
          </div>

          {/* Details — team, hire date, PTO plan, and the review-clock dates,
              so a test review or a wrong entry is correctable in place. */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">{tr('Details')}</p>
              <button onClick={() => setEditDetails(e => !e)}
                className="inline-flex items-center gap-1 text-xs font-medium text-powder-600 hover:text-powder-700">
                <Pencil size={12} /> {editDetails ? tr('Close') : tr('Edit')}
              </button>
            </div>
            {editDetails ? (
              <DetailsEditor data={data} tr={tr} onSaved={() => { setEditDetails(false); refresh(); onChanged?.(); }} />
            ) : (
              <p className="text-xs text-gray-600">
                {tr('Team')}: {data.team || '—'} · {tr('Hired')}: {fmtDate(data.hire_date)} · {tr('PTO plan')}: {data.pto_plan || '—'} ·{' '}
                {tr('Last review')}: {fmtDate(data.last_reviewed_at)} · {tr('Last raise')}: {fmtDate(data.last_increase_at)}
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-900 mb-1">{tr('Rate history')}</p>
            {(data.history || []).length === 0 ? (
              <p className="text-xs text-gray-400">{tr('No changes recorded in ReadyDoc yet.')}</p>
            ) : (
              <ol className="space-y-1.5">
                {data.history.map(h => (
                  <li key={h.id} className="text-xs text-gray-700 border-l-2 border-gray-200 pl-2">
                    <span className="font-medium">{fmtDate(h.effective_at)}</span>{' — '}
                    {h.old_rate != null ? money(h.old_rate) : tr('new')} → <span className="font-semibold">{money(h.new_rate)}</span>
                    <span className="text-gray-400"> · {h.changed_by}</span>
                    {h.note && <div className="text-gray-500">{h.note}</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Removing is for rows added by mistake (a sync add under a second
              spelling). The server refuses once rate history exists — those
              rows are deactivated in Details instead, so the history survives. */}
          <div className="flex justify-end">
            <button onClick={removeRow} disabled={busy}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600">
              <Trash2 size={12} /> {tr('Remove from roster')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Assignments (admin) ────────────────────────────────── */

// Who owes a review, and by when. Assigning DMs the reviewer through ReadyBot
// and pushes to their phone, so the ask exists somewhere other than a memory.
function AssignmentsTab({ people, tr, onChanged }) {
  const { data: rows, refresh } = useApiGet('/pay/assignments?status=all');
  // Supervisors and admins only — an operator never evaluates a colleague, and
  // the whole-roster list also offered ReadyBot.
  const { data: users } = useApiGet('/pay/reviewers');
  const [form, setForm] = useState({ employee_id: '', reviewer_id: '', due_date: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const create = async () => {
    if (!form.employee_id || !form.reviewer_id) { setError(tr('Pick the employee and the reviewer.')); return; }
    setBusy(true); setError('');
    try {
      await apiPost('/pay/assignments', form);
      setForm({ employee_id: '', reviewer_id: '', due_date: '', note: '' });
      refresh(); onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const cancel = async (a) => {
    if (!window.confirm(tr('Cancel this assignment?'))) return;
    try { await apiFetch(`/pay/assignments/${a.id}`, { method: 'DELETE' }); refresh(); }
    catch (e) { setError(e.message); }
  };

  const open = (rows || []).filter(r => r.status === 'open');
  const done = (rows || []).filter(r => r.status !== 'open');

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
        <p className="text-sm font-semibold text-gray-900">{tr('Assign an evaluation')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Employee')} *</label>
            <select value={form.employee_id} onChange={e => set('employee_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">{tr('Select an employee…')}</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.team ? ` — ${p.team}` : ''}{p.is_supervisor ? ` (${tr('Supervisor')})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Reviewer')} *</label>
            <select value={form.reviewer_id} onChange={e => set('reviewer_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">{tr('Select a reviewer…')}</option>
              {(users || []).map(u => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Due date')}</label>
            <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Note (optional)')}</label>
            <input value={form.note} onChange={e => set('note', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={tr('Anything they should know')} />
          </div>
        </div>
        <p className="text-[11px] text-gray-500">
          {tr('The reviewer gets a ReadyDoc message and a phone notification, and the evaluation shows in their own Evaluation tab.')}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={create} disabled={busy}
          className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
          {busy ? tr('Assigning…') : tr('Assign')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <p className="text-sm font-semibold text-gray-900 mb-1">{tr('Waiting on a reviewer')} ({open.length})</p>
        {open.length === 0 ? <p className="text-xs text-gray-400">{tr('Nothing outstanding.')}</p> : (
          <ul className="space-y-1.5">
            {open.map(a => (
              <li key={a.id} className="flex items-center gap-2 flex-wrap text-sm border-l-2 border-amber-300 pl-2">
                <span className="font-medium text-gray-900">{a.employee_name}</span>
                <span className="text-xs text-gray-500">← {a.reviewer_name || tr('unknown')}</span>
                <span className={`text-[11px] ${a.overdue ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                  {a.due_date ? `${a.overdue ? tr('overdue') : tr('due')} ${fmtDate(a.due_date)}` : tr('no due date')}
                </span>
                <button onClick={() => cancel(a)} className="ml-auto text-[11px] text-gray-400 hover:text-red-600">{tr('Cancel')}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {done.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-sm font-semibold text-gray-900 mb-1">{tr('Completed')} ({done.length})</p>
          <ul className="space-y-1">
            {done.slice(0, 25).map(a => (
              <li key={a.id} className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">{a.employee_name}</span> — {a.reviewer_name}
                {a.completed_at ? ` · ${fmtDate(a.completed_at)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── Add someone by hand ────────────────────────────────── */

function AddPersonModal({ onClose, onAdded, tr }) {
  const [form, setForm] = useState({ name: '', team: '', hire_date: '', pay_rate: '', pto_plan: '', is_supervisor: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setError(tr('Name is required')); return; }
    setBusy(true); setError('');
    try {
      await apiPost('/pay/employees', {
        name: form.name.trim(), team: form.team.trim() || null,
        hire_date: form.hire_date || null,
        pay_rate: form.pay_rate !== '' ? Number(form.pay_rate) : null,
        pto_plan: form.pto_plan.trim() || null, is_supervisor: form.is_supervisor,
      });
      onAdded?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        <h3 className="font-semibold text-gray-900 text-sm">{tr('Add someone to the roster')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Name')} *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Team')}</label>
            <input value={form.team} onChange={e => set('team', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Hire date')}</label>
            <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Rate')}</label>
            <input type="number" step="0.01" min="0" value={form.pay_rate} onChange={e => set('pay_rate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={tr('blank = salaried')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{tr('PTO plan')}</label>
            <input value={form.pto_plan} onChange={e => set('pto_plan', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={tr('e.g. 3 hr / 4 hr')} />
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={form.is_supervisor} onChange={e => set('is_supervisor', e.target.checked)} className="rounded border-gray-300" />
          {tr('Supervisor')}
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy}
            className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {busy ? tr('Adding…') : tr('Add to roster')}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">{tr('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Sync with Settings ─────────────────────────────────── */

function SyncPanel({ onDone, tr }) {
  const { data, refresh, loading } = useApiGet('/pay/sync');
  const [busy, setBusy] = useState(false);
  const [addSel, setAddSel] = useState(() => new Set());

  const apply = async () => {
    setBusy(true);
    try {
      await apiPost('/pay/sync', { link: data?.linkable || [], add: [...addSel] });
      setAddSel(new Set());
      refresh(); onDone?.();
    } finally { setBusy(false); }
  };

  if (loading) return <p className="text-sm text-gray-400 py-6 text-center">{tr('Checking…')}</p>;
  const { missing = [], linkable = [], unmatched = [] } = data || {};
  const clean = !missing.length && !linkable.length && !unmatched.length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {tr('Settings is the source of truth for who works here. This compares the roster against it and shows the differences rather than changing anything on its own.')}
      </p>
      {clean && (
        <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
          {tr('The roster matches the employee list in Settings.')}
        </p>
      )}
      {linkable.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-sm font-semibold text-gray-900">{tr('Can be linked by name')} ({linkable.length})</p>
          <p className="text-xs text-gray-500 mb-1">{tr('These roster rows match a Settings user exactly.')}</p>
          <p className="text-xs text-gray-700">{linkable.map(l => l.name).join(', ')}</p>
        </div>
      )}
      {missing.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-sm font-semibold text-gray-900">{tr('In Settings but not on the roster')} ({missing.length})</p>
          <p className="text-xs text-gray-500 mb-2">{tr('Tick anyone who should be tracked. They are added with no rate — you enter that deliberately.')}</p>
          <div className="space-y-1">
            {missing.map(m => (
              <label key={m.user_id} className="flex items-center gap-2 text-sm text-gray-800">
                <input type="checkbox" checked={addSel.has(m.user_id)} className="rounded border-gray-300"
                  onChange={() => setAddSel(s => { const n = new Set(s); n.has(m.user_id) ? n.delete(m.user_id) : n.add(m.user_id); return n; })} />
                {m.name} <span className="text-xs text-gray-400">{m.department || ''}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {unmatched.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">{tr('On the roster with no Settings user')} ({unmatched.length})</p>
          <p className="text-xs text-amber-800 mb-1">
            {tr('Either they have left, or the name is spelled differently in Settings. Nothing is removed automatically.')}
          </p>
          <p className="text-xs text-amber-900">{unmatched.map(u => u.name).join(', ')}</p>
        </div>
      )}
      {(linkable.length > 0 || addSel.size > 0) && (
        <button onClick={apply} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
          <RefreshCw size={14} /> {busy ? tr('Applying…') : tr('Apply')}
          {` (${linkable.length} ${tr('to link')}, ${addSel.size} ${tr('to add')})`}
        </button>
      )}
    </div>
  );
}

/* ── Panel ──────────────────────────────────────────────── */

const PAGE_STRINGS = [
  'Pay Tracking', 'Roster', 'Evaluation', 'Vision & Values', 'Sync with Settings',
  'Employee', 'Team', 'Rate', 'Annual', 'Hired', 'Last raise', 'Last review', 'Days', 'Review',
  'Due', 'Soon', 'OK', 'Supervisor', 'Salaried', 'No team',
  'Submitting saves this review for the admin.',
  'Your scores and notes go to the admin, who reads every review — including a second reviewer’s — before deciding any increase. Nothing here shows or asks for anyone’s pay.',
  'Select an employee…', 'Last raise or review', 'days ago',
  'Below Expectation', 'Meets Expectation', 'Exceeds Expectation',
  'Review conversation required',
  'A score of 1 in Time & Attendance triggers a review conversation regardless of the total score.',
  'Notes / Feedback', 'Goes to the admin with your scores.', 'Total score', 'scored',
  'Score every characteristic to see the recommended increase.',
  'PDF for the conversation', 'Building…', 'Submit review', 'Submitting…', 'Clear', 'Close',
  'To apply the increase, open this person on the Roster tab.',
  'Review submitted. The scores and notes are now visible to the admin, who decides any increase.',
  'Reviews', 'Combined', 'reviews', 'attendance flag', 'Show scores', 'Hide scores',
  'No open reviews — earlier ones are below.',
  'Applying an increase below closes these reviews with the decision on them.',
  'Close without increase…', 'Show earlier reviews', 'Hide earlier reviews',
  'Close these reviews without an increase — why? (recorded as the outcome)',
  'Details', 'Edit', 'Save details', 'Saving…', 'PTO', 'PTO plan', 'Hire date', 'Active', 'Notes',
  'e.g. 3 hr / 4 hr', 'blank = salaried',
  'Correcting the review or raise date here fixes a mistaken entry — the change is audited with the old and new values.',
  'Remove from roster',
  'Remove this person from the Pay Tracking roster? Only rows added by mistake can be removed.',
  'Add someone to the roster', 'Name', 'Name is required', 'Adding…', 'Add to roster', 'Cancel',
  'Evaluations assigned to you', 'due', 'overdue', 'no due date',
  'Assignments', 'Assign an evaluation', 'Reviewer', 'Select a reviewer…', 'Due date',
  'Anything they should know', 'Assign', 'Assigning…', 'Pick the employee and the reviewer.',
  'The reviewer gets a ReadyDoc message and a phone notification, and the evaluation shows in their own Evaluation tab.',
  'Waiting on a reviewer', 'Nothing outstanding.', 'Completed', 'unknown', 'Cancel this assignment?',
  'follows their role in Settings',
  'Tap a name to read their reviews, see rate history, correct details, or apply an increase.',
  'Apply a pay increase', 'New rate', 'Effective date', 'Note (optional)', 'Apply increase', 'Applying…',
  'Rate history', 'No changes recorded in ReadyDoc yet.', 'new', 'Days since',
  'Headcount', 'Due for review', 'Annual payroll', 'Average rate',
  'Search name or team…', 'Add someone', 'Checking…', 'Apply', 'to link', 'to add',
  'Settings is the source of truth for who works here. This compares the roster against it and shows the differences rather than changing anything on its own.',
  'The roster matches the employee list in Settings.',
  'The sheet carries the feedback and the recommendation — no score.',
  'Can be linked by name', 'These roster rows match a Settings user exactly.',
  'In Settings but not on the roster',
  'Tick anyone who should be tracked. They are added with no rate — you enter that deliberately.',
  'On the roster with no Settings user',
  'Either they have left, or the name is spelled differently in Settings. Nothing is removed automatically.',
  'Pay information is restricted to administrators.',
  'You can run a Pay Increase Evaluation here. Actual pay rates are not shown.',
  'Score', 'Performance', 'Increase', 'Cultural Score',
];

export default function PayTrackingPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'roster' : 'evaluate');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  const { data: roster, refresh: refreshRoster } = useApiGet(isAdmin ? '/pay/employees' : null);
  const { data: evaluatees, refresh: refreshEval } = useApiGet('/pay/evaluatees');
  // What has been asked of THIS person (admins see their own asks too).
  const { data: myAssignments, refresh: refreshAssign } = useApiGet('/pay/assignments?mine=true');

  const contentStrings = useMemo(() => {
    const out = [...PAGE_STRINGS];
    for (const c of CHARACTERISTICS) {
      out.push(c.title, c.subtitle, c.levels[1], c.levels[2], c.levels[3]);
    }
    for (const b of BANDS) { out.push(b.performance, b.label); if (b.approx) out.push(b.approx); }
    out.push(VISION.heading, VISION.statement, ...VISION.points);
    out.push(CORE_VALUES.heading);
    return out;
  }, []);
  const { lang, setLang, tr, translating } = usePageTranslation(contentStrings);

  // DataGrid does its own searching and filtering, so the roster goes in whole.
  const rows = roster || [];

  const kpis = useMemo(() => {
    const list = (roster || []).filter(r => r.active);
    const paid = list.filter(r => r.pay_rate != null);
    return {
      headcount: list.length,
      due: list.filter(r => r.review?.status === 'due').length,
      annual: paid.reduce((s, r) => s + (r.annual || 0), 0),
      avg: paid.length ? paid.reduce((s, r) => s + r.pay_rate, 0) / paid.length : null,
    };
  }, [roster]);

  const columns = [
    { key: 'name', label: tr('Employee'), filter: false,
      render: r => (
        <button onClick={() => setOpenId(r.id)}
          className="text-left font-medium text-gray-900 hover:text-powder-700 hover:underline">
          {r.name}
        </button>
      ) },
    { key: 'team', label: tr('Team'), filter: true },
    { key: 'pay_rate', label: tr('Rate'), type: 'money', align: 'right', edit: false,
      render: r => (r.pay_rate == null ? <span className="text-gray-400">{tr('Salaried')}</span> : money(r.pay_rate)) },
    { key: 'annual', label: tr('Annual'), type: 'money', align: 'right',
      render: r => (r.annual == null ? <span className="text-gray-300">—</span> : money0(r.annual)) },
    { key: 'hire_date', label: tr('Hired'), render: r => fmtDate(r.hire_date) },
    { key: 'pto_plan', label: tr('PTO'), filter: true, render: r => r.pto_plan || <span className="text-gray-300">—</span> },
    { key: 'last_increase_at', label: tr('Last raise'), render: r => fmtDate(r.last_increase_at) },
    { key: 'last_reviewed_at', label: tr('Last review'), render: r => fmtDate(r.last_reviewed_at) },
    { key: 'review_days', label: tr('Days'), type: 'number', align: 'right', render: r => r.review?.days ?? '—' },
    { key: 'review_status', label: tr('Review'), filter: false,
      render: r => (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${REVIEW_TONE[r.review?.status || 'unknown']}`}>
          {tr(REVIEW_LABEL[r.review?.status || 'unknown'])}
        </span>
      ) },
  ];

  const openAssigned = (myAssignments || []).filter(a => a.status === 'open');
  const evalLabel = openAssigned.length ? `Evaluation (${openAssigned.length})` : 'Evaluation';
  const tabs = isAdmin
    ? [['roster', 'Roster'], ['evaluate', evalLabel], ['assign', 'Assignments'], ['sync', 'Sync with Settings'], ['values', 'Vision & Values']]
    : [['evaluate', evalLabel], ['values', 'Vision & Values']];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{tr('Pay Tracking')}</h2>
          {!isAdmin && (
            <p className="text-sm text-gray-500">{tr('You can run a Pay Increase Evaluation here. Actual pay rates are not shown.')}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto max-w-full">
            {tabs.map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {tr(l)}
              </button>
            ))}
          </div>
          <LangToggle lang={lang} setLang={setLang} translating={translating} />
        </div>
      </div>

      {tab === 'roster' && isAdmin && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            {[
              { label: tr('Headcount'), value: kpis.headcount, icon: Users, tone: 'text-gray-900' },
              { label: tr('Due for review'), value: kpis.due, icon: Clock, tone: kpis.due ? 'text-red-600' : 'text-gray-900' },
              { label: tr('Annual payroll'), value: money0(kpis.annual), icon: DollarSign, tone: 'text-gray-900' },
              { label: tr('Average rate'), value: kpis.avg != null ? money(kpis.avg) : '—', icon: TrendingUp, tone: 'text-gray-900' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <c.icon size={13} />
                  <p className="text-[11px] font-medium uppercase tracking-wide">{c.label}</p>
                </div>
                <p className={`text-2xl font-bold ${c.tone}`}>{c.value}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
              <Plus size={13} /> {tr('Add someone')}
            </button>
          </div>
          <DataGrid
            columns={columns}
            rows={rows.map(r => ({ ...r, review_days: r.review?.days ?? null, review_status: r.review?.status }))}
            searchPlaceholder={tr('Search name or team…')}
            empty={tr('Nobody on the roster yet.')}
            initialSort={{ key: 'review_days', dir: 'desc' }}
            rowClass={r => (r.active ? '' : 'opacity-50')}
          />
          <p className="text-[11px] text-gray-400">
            {tr('Tap a name to read their reviews, see rate history, correct details, or apply an increase.')}
          </p>
        </>
      )}

      {tab === 'evaluate' && (
        <Evaluation people={evaluatees || []} canApply={isAdmin} tr={tr} lang={lang}
          assignments={openAssigned}
          onRecorded={() => { refreshEval(); refreshRoster?.(); refreshAssign(); }} />
      )}

      {tab === 'assign' && isAdmin && (
        <AssignmentsTab people={evaluatees || []} tr={tr} onChanged={refreshAssign} />
      )}

      {tab === 'sync' && isAdmin && (
        <SyncPanel tr={tr} onDone={() => { refreshRoster(); refreshEval(); }} />
      )}

      {tab === 'values' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-powder-600">{tr('Vision')}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{tr(VISION.heading)}</p>
            <ul className="mt-1.5 ml-4 list-disc text-sm text-gray-700 space-y-0.5">
              {VISION.points.map(p => <li key={p}>{tr(p)}</li>)}
            </ul>
            <p className="mt-3 text-sm text-gray-700 italic">{tr(VISION.statement)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-powder-600">{tr('Core Values')}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{tr(CORE_VALUES.heading)}</p>
            <ul className="mt-1.5 space-y-1.5">
              {CORE_VALUES.values.map(v => (
                <li key={v.title}>
                  <p className="text-sm font-semibold text-gray-900">{tr(v.title)}</p>
                  <p className="text-xs text-gray-600">{tr(v.subtitle)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-bold text-gray-900 mb-2">{tr('Pay Increase Determination')}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="py-1">{tr('Cultural Score')}</th>
                  <th className="py-1">{tr('Performance')}</th>
                  <th className="py-1">{tr('Increase')}</th>
                </tr>
              </thead>
              <tbody>
                {BANDS.map((b, i) => (
                  <tr key={b.min} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-gray-900">
                      {i === 0 ? `${b.min} – ${MAX_SCORE}` : i === BANDS.length - 1 ? `${tr('Below')} ${BANDS[i - 1].min}` : `${b.min} – ${BANDS[i - 1].min - 1}`}
                    </td>
                    <td className="py-1.5 text-gray-700">{tr(b.performance)}</td>
                    <td className="py-1.5 font-semibold text-gray-900">{tr(b.label)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openId && (
        <PersonDrawer id={openId} tr={tr} onClose={() => setOpenId(null)} onChanged={refreshRoster} />
      )}
      {adding && (
        <AddPersonModal tr={tr} onClose={() => setAdding(false)} onAdded={() => { refreshRoster(); refreshEval(); }} />
      )}
    </div>
  );
}
