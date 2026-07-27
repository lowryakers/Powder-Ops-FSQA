import { useState, useMemo } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { usePageTranslation } from '../../lib/usePageTranslation.js';
import LangToggle from '../LangToggle.jsx';
import DataGrid from './DataGrid.jsx';
import { CHARACTERISTICS, MAX_SCORE, BANDS, bandFor, VISION, CORE_VALUES } from './payRubric.js';
import {
  AlertTriangle, Check, X, TrendingUp, Users, Clock, DollarSign, RefreshCw, Printer,
} from 'lucide-react';

// Pay Tracking.
//
// The roster (real rates, annual cost, rate history) is admin-only. The
// evaluation tool is available to anyone granted the module and shows no pay
// data at all — only the rubric and the increase band a score lands in — so a
// supervisor can run an evaluation without company pay on their screen.
//
// Evaluations are never saved. Scores and notes live in this component's state
// for the length of the conversation and are gone when it closes. Closing one
// out can stamp a review date on the roster so the "who is due" clock resets
// without leaving a rating on anybody's file.

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

function Evaluation({ people, canApply, onClose, onRecorded, tr }) {
  const [personId, setPersonId] = useState('');
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const person = people.find(p => p.id === personId) || null;
  const answered = CHARACTERISTICS.filter(c => scores[c.key]).length;
  const complete = answered === CHARACTERISTICS.length;
  const total = CHARACTERISTICS.reduce((s, c) => s + (scores[c.key] || 0), 0);
  const band = complete ? bandFor(total) : null;
  // The workbook singles this out in a footnote that is easy to read past, so
  // it gets its own alert rather than living inside the total.
  const hardFlag = CHARACTERISTICS.some(c => c.hardFlagAtOne && scores[c.key] === 1);

  const reset = () => { setScores({}); setNotes(''); setDone(null); };

  const recordReviewDate = async () => {
    if (!person) return;
    setBusy(true);
    try {
      await apiPost(`/pay/employees/${person.id}/reviewed`, { reviewed_at: todayStr() });
      setDone('Review date recorded. The scores and notes were not saved.');
      onRecorded?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
        <p className="text-sm font-semibold text-blue-900">{tr('This evaluation is not saved.')}</p>
        <p className="text-xs text-blue-800 mt-0.5">
          {tr('Scores and notes stay on this screen for the conversation and disappear when you leave. Only the review date can be recorded, so the review clock resets without keeping a rating on file.')}
        </p>
      </div>

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
              placeholder={tr('For the conversation — not saved.')}
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

          <div className="flex flex-wrap gap-2">
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Printer size={14} /> {tr('Print for the conversation')}
            </button>
            <button onClick={recordReviewDate} disabled={busy || !complete}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              <Check size={14} /> {busy ? tr('Recording…') : tr('Record review date only')}
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

function PersonDrawer({ id, onClose, onChanged, tr }) {
  const { data, refresh } = useApiGet(`/pay/employees/${id}`, [id]);
  const [newRate, setNewRate] = useState('');
  const [effective, setEffective] = useState(todayStr());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!data) return null;
  const rate = data.pay_rate;

  const apply = async () => {
    setBusy(true); setError('');
    try {
      await apiPost(`/pay/employees/${id}/rate`, { new_rate: Number(newRate), effective_at: effective, note });
      setNewRate(''); setNote('');
      refresh(); onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
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
              { label: tr('Days since'), value: data.review?.days ?? '—' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">{c.label}</p>
                <p className="text-lg font-bold text-gray-900">{c.value}</p>
              </div>
            ))}
          </div>

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
  'Pay Tracking', 'Roster', 'Evaluation', 'Vision & Values', 'Pay ranges', 'Sync with Settings',
  'Employee', 'Team', 'Rate', 'Annual', 'Hired', 'Last raise', 'Last review', 'Days', 'Review',
  'Due', 'Soon', 'OK', 'Supervisor', 'Salaried', 'No team',
  'This evaluation is not saved.',
  'Scores and notes stay on this screen for the conversation and disappear when you leave. Only the review date can be recorded, so the review clock resets without keeping a rating on file.',
  'Select an employee…', 'Last raise or review', 'days ago',
  'Below Expectation', 'Meets Expectation', 'Exceeds Expectation',
  'Review conversation required',
  'A score of 1 in Time & Attendance triggers a review conversation regardless of the total score.',
  'Notes / Feedback', 'For the conversation — not saved.', 'Total score', 'scored',
  'Score every characteristic to see the recommended increase.',
  'Print for the conversation', 'Record review date only', 'Recording…', 'Clear', 'Close',
  'To apply the increase, open this person on the Roster tab.',
  'Review date recorded. The scores and notes were not saved.',
  'Apply a pay increase', 'New rate', 'Effective date', 'Note (optional)', 'Apply increase', 'Applying…',
  'Rate history', 'No changes recorded in ReadyDoc yet.', 'new', 'Days since',
  'Headcount', 'Due for review', 'Annual payroll', 'Average rate',
  'Search name or team…', 'Add someone', 'Checking…', 'Apply', 'to link', 'to add',
  'Settings is the source of truth for who works here. This compares the roster against it and shows the differences rather than changing anything on its own.',
  'The roster matches the employee list in Settings.',
  'Can be linked by name', 'These roster rows match a Settings user exactly.',
  'In Settings but not on the roster',
  'Tick anyone who should be tracked. They are added with no rate — you enter that deliberately.',
  'On the roster with no Settings user',
  'Either they have left, or the name is spelled differently in Settings. Nothing is removed automatically.',
  'Pay information is restricted to administrators.',
  'You can run a Pay Increase Evaluation here. Actual pay rates are not shown.',
  'Market min', 'Market max', 'Powder Ops min', 'Powder Ops max', 'Position',
  'Score', 'Performance', 'Increase', 'Cultural Score',
];

export default function PayTrackingPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'roster' : 'evaluate');
  const [openId, setOpenId] = useState(null);

  const { data: roster, refresh: refreshRoster } = useApiGet(isAdmin ? '/pay/employees' : null);
  const { data: evaluatees, refresh: refreshEval } = useApiGet('/pay/evaluatees');
  const { data: ranges } = useApiGet(isAdmin ? '/pay/ranges' : null);

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

  const tabs = isAdmin
    ? [['roster', 'Roster'], ['evaluate', 'Evaluation'], ['ranges', 'Pay ranges'], ['sync', 'Sync with Settings'], ['values', 'Vision & Values']]
    : [['evaluate', 'Evaluation'], ['values', 'Vision & Values']];

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
          <DataGrid
            columns={columns}
            rows={rows.map(r => ({ ...r, review_days: r.review?.days ?? null, review_status: r.review?.status }))}
            searchPlaceholder={tr('Search name or team…')}
            empty={tr('Nobody on the roster yet.')}
            initialSort={{ key: 'review_days', dir: 'desc' }}
            rowClass={r => (r.active ? '' : 'opacity-50')}
          />
          <p className="text-[11px] text-gray-400">
            {tr('Tap a name to see their rate history or apply an increase.')}
          </p>
        </>
      )}

      {tab === 'evaluate' && (
        <Evaluation people={evaluatees || []} canApply={isAdmin} tr={tr}
          onRecorded={() => { refreshEval(); refreshRoster?.(); }} />
      )}

      {tab === 'ranges' && isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2">{tr('Position')}</th>
                <th className="px-4 py-2 text-right">{tr('Market min')}</th>
                <th className="px-4 py-2 text-right">{tr('Market max')}</th>
              </tr>
            </thead>
            <tbody>
              {(ranges || []).map(r => (
                <tr key={r.position} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium text-gray-900">{r.position}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{r.market_min != null ? money(r.market_min) : '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{r.market_max != null ? money(r.market_max) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
