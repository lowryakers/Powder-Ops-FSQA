// Food Safety Culture (D-211, SQF 2.1.1.2): the month the review meeting reads,
// the concern log, and the supervisors' monthly checks.
//
// Every figure here comes from GET /api/culture/summary, derived from the rows
// on each read. The screen adds nothing up for itself — a total computed twice
// is how a summary and its list start disagreeing.
import { useState } from 'react';
import { HeartHandshake, MessageSquareWarning, ClipboardCheck, BarChart3 } from 'lucide-react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import ModuleTabs from '../common/ModuleTabs.jsx';
import CheckFields from '../common/CheckFields.jsx';
import RaiseConcern from '../common/RaiseConcern.jsx';
import { missingForCheck } from '../../../shared/check-forms.js';
import { formatDateTime } from '../../lib/datetime';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const STATUS = { open: 'Open', in_review: 'Being looked at', closed: 'Closed' };

export default function FoodSafetyCulturePanel({ user }) {
  const { data: meta, refresh: refreshMeta } = useApiGet('/culture/meta');
  const [view, setView] = useState('summary');
  if (!meta) return <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>;
  const tabs = [
    ...(meta.can_review ? [{ id: 'summary', label: 'This month', icon: BarChart3 }] : []),
    { id: 'concerns', label: meta.can_review ? 'Concerns' : 'My concerns', icon: MessageSquareWarning },
    ...(meta.can_review || meta.can_file_check ? [{ id: 'checks', label: 'Supervisor checks', icon: ClipboardCheck }] : []),
  ];
  const active = tabs.some(t => t.id === view) ? view : tabs[0].id;
  const label = (key) => meta.categories.find(c => c.key === key)?.label || key;
  const dept = (key) => meta.departments.find(d => d.value === key)?.label || key || '—';
  return (
    <div className="space-y-4" data-culture-panel>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <HeartHandshake size={18} className="text-powder-600" /> Food Safety Culture
          </h3>
          <p className="text-sm text-gray-500 max-w-2xl">
            What supervisors observe each month, the concerns people raise, and what was done about them —
            read together at the monthly review.
          </p>
        </div>
        <RaiseConcern user={user} />
      </div>
      <ModuleTabs value={active} onChange={setView} tabs={tabs} />
      {active === 'summary' && <Summary label={label} dept={dept} />}
      {active === 'concerns' && <Concerns meta={meta} label={label} dept={dept} />}
      {active === 'checks' && <Checks meta={meta} dept={dept} />}
      {meta.can_set_anonymous && <AnonymousSetting on={meta.anonymous_allowed} onChanged={refreshMeta} />}
    </div>
  );
}

function Figure({ label, value, before, data }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3" data-figure={data}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      {before !== undefined && <div className="text-[11px] text-gray-500">Last month {before}</div>}
    </div>
  );
}

function Breakdown({ title, counts, name }) {
  const rows = Object.entries(counts || {});
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      <ul className="text-xs text-gray-600 mt-0.5">
        {rows.map(([k, n]) => <li key={k} className="flex justify-between gap-3 max-w-xs"><span>{name(k)}</span><span className="tabular-nums">{n}</span></li>)}
      </ul>
    </div>
  );
}

function Summary({ label, dept }) {
  const [month, setMonth] = useState(thisMonth());
  const { data: s } = useApiGet(`/culture/summary?month=${month}`, [month]);
  if (!s) return <p className="text-sm text-gray-500">Loading…</p>;
  const c = s.current; const p = s.previous;
  return (
    <div className="space-y-4" data-culture-summary={s.month}>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-gray-500">Month</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value || thisMonth())} data-culture-month
          className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
        <button type="button" onClick={() => window.print()} className="text-xs text-powder-700 hover:underline">Print for the review meeting</button>
      </div>
      <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{s.reading_note}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Figure label="Concerns raised" value={c.concerns.raised} before={p.concerns.raised} data="raised" />
        <Figure label="Supervisor checks filed" value={c.checks.filed} before={p.checks.filed} data="checks" />
        <Figure label="GMP walks filed" value={c.gmp_walks.filed} before={p.gmp_walks.filed} data="walks" />
        <Figure label="Concerns still open (all months)" value={s.still_open.count} data="open" />
      </div>
      <div className="grid gap-4 md:grid-cols-3 rounded-lg border border-gray-200 bg-white p-3">
        <Breakdown title="Concerns by topic" counts={c.concerns.by_category} name={label} />
        <Breakdown title="Concerns by department" counts={c.concerns.by_department} name={dept} />
        <div className="text-xs text-gray-600 space-y-0.5">
          <p className="font-semibold text-gray-700">How they came in</p>
          <p>Raised directly: {c.concerns.raised_directly}</p>
          <p>From team talks: {c.concerns.from_team_talks}</p>
          {c.concerns.anonymous > 0 && <p>Without a name: {c.concerns.anonymous}</p>}
          <p>Closed this month: {c.concerns.closed_in_month}</p>
        </div>
        <Breakdown title="Supervisor checks by department" counts={c.checks.by_department} name={dept} />
        <div className="text-xs text-gray-600 space-y-0.5">
          <p className="font-semibold text-gray-700">Observed</p>
          <p>People at team talks: {c.checks.talk_attendees}</p>
          <p>Items not compliant (supervisor checks): {c.checks.not_compliant_items}</p>
          <p>Items not compliant (GMP walks): {c.gmp_walks.not_compliant_items}</p>
        </div>
        {c.observed_not_compliant.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-700">Most often not compliant</p>
            <ul className="text-xs text-gray-600 mt-0.5">
              {c.observed_not_compliant.slice(0, 5).map(x => <li key={x.label}>{x.label.split(' — ')[0]} · {x.count}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Concerns({ meta, label, dept }) {
  const [filter, setFilter] = useState('not_closed');
  const { data: rows, refresh } = useApiGet(`/culture/concerns${meta.can_review && filter !== 'all' ? `?status=${filter}` : ''}`, [filter]);
  return (
    <div className="space-y-3">
      {meta.can_review && (
        <div className="flex gap-2 text-xs">
          {[['not_closed', 'Not closed'], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`px-2.5 py-1 rounded-full border ${filter === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>{l}</button>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {(rows || []).map(r => <ConcernRow key={r.id} r={r} meta={meta} label={label} dept={dept} onChanged={refresh} />)}
        {rows && rows.length === 0 && <li className="text-sm text-gray-400 py-6 text-center">No concerns here.</li>}
      </ul>
    </div>
  );
}

function ConcernRow({ r, meta, label, dept, onChanged }) {
  const [answering, setAnswering] = useState(false);
  const [status, setStatus] = useState(r.status === 'open' ? 'in_review' : r.status);
  const [response, setResponse] = useState(r.response || '');
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try { await apiPost(`/culture/concerns/${r.id}/respond`, { status, response }); setAnswering(false); onChanged(); }
    catch (e) { setError(e.message); }
  };
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3" data-concern-row={r.id} data-concern-status={r.status}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-500">
          {r.raised_on} · {label(r.category)} · {dept(r.department)} · {r.source === 'team_talk' ? 'from a team talk' : 'raised directly'}
          {r.anonymous ? ' · no name' : r.raised_by ? ` · ${r.raised_by}` : ''}
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${r.status === 'closed' ? 'bg-green-100 text-green-800' : r.status === 'in_review' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-900'}`}>{STATUS[r.status]}</span>
      </div>
      <p className="text-sm text-gray-900 mt-1 whitespace-pre-line">{r.description}</p>
      {r.response && <p className="text-xs text-gray-700 mt-1 bg-gray-50 rounded px-2 py-1"><span className="font-medium">Answer:</span> {r.response}{r.responded_at ? ` (${formatDateTime(r.responded_at)})` : ''}</p>}
      {meta.can_review && !answering && (
        <button type="button" onClick={() => setAnswering(true)} className="mt-1 text-xs text-powder-700 hover:underline" data-concern-answer>Answer</button>
      )}
      {answering && (
        <div className="mt-2 space-y-2">
          <select value={status} onChange={e => setStatus(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-concern-new-status>
            <option value="open">Open</option><option value="in_review">Being looked at</option><option value="closed">Closed</option>
          </select>
          <textarea rows={2} value={response} onChange={e => setResponse(e.target.value)} placeholder="What was found and what was done" data-concern-response
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium" data-concern-save>Save</button>
            <button type="button" onClick={() => setAnswering(false)} className="px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Checks({ meta, dept }) {
  const [month, setMonth] = useState(thisMonth());
  const { data: rows, refresh } = useApiGet(meta.can_review ? `/culture/checks?month=${month}` : null, [month]);
  const [filing, setFiling] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {meta.can_review && (
          <>
            <label className="text-xs text-gray-500">Month</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value || thisMonth())} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </>
        )}
        {meta.can_file_check && !filing && (
          <button type="button" onClick={() => setFiling(true)} data-file-culture-check
            className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium">File this month's check</button>
        )}
      </div>
      {filing && <FileCheck meta={meta} onDone={() => { setFiling(false); refresh?.(); }} onCancel={() => setFiling(false)} />}
      {meta.can_review && (
        <ul className="space-y-2">
          {(rows || []).map(r => (
            <li key={r.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm" data-culture-check={r.id}>
              <div className="flex justify-between gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{dept(r.department)} · {r.checked_on}</span>
                <span className="text-xs text-gray-500">{r.checked_by} · {r.checklist_revision}</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                {r.nc_count} not compliant · team talk {r.talk_date || '—'} with {r.talk_attendees ?? '—'} people · {r.concern_count} concern{r.concern_count === 1 ? '' : 's'} raised
              </p>
              <p className="text-sm text-gray-800 mt-1 whitespace-pre-line">{r.observation_note}</p>
              {r.items.some(i => i.result === 'nc') && (
                <ul className="text-xs text-red-700 mt-1">
                  {r.items.filter(i => i.result === 'nc').map(i => <li key={i.key}>{i.label.split(' — ')[0]}: {i.note}</li>)}
                </ul>
              )}
            </li>
          ))}
          {rows && rows.length === 0 && <li className="text-sm text-gray-400 py-6 text-center">No supervisor checks filed this month.</li>}
        </ul>
      )}
    </div>
  );
}

function FileCheck({ meta, onDone, onCancel }) {
  const [v, setV] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = meta.check_form;
  const missing = missingForCheck(form, v);
  const save = async () => {
    setBusy(true); setError('');
    try { await apiPost('/culture/checks', v); onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2 max-w-xl" data-culture-check-form>
      <CheckFields form={form} value={v} onChange={setV} departments={meta.departments} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || missing.length > 0} data-culture-check-save
          className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{busy ? 'Filing…' : 'File the check'}</button>
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
      </div>
    </div>
  );
}

function AnonymousSetting({ on, onChanged }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await apiPut('/culture/settings', { anonymous_allowed: !on }); onChanged(); }
    catch (e) { window.alert(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm flex items-center justify-between gap-3 flex-wrap" data-culture-anon-setting={on ? 'on' : 'off'}>
      <span className="text-gray-700">
        Concerns without a name: <span className="font-medium">{on ? 'allowed' : 'not allowed'}</span>
        <span className="block text-xs text-gray-500">When allowed, a person can leave their name off and no name is stored at all.</span>
      </span>
      <button type="button" onClick={toggle} disabled={busy} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs">{on ? 'Turn off' : 'Allow'}</button>
    </div>
  );
}
