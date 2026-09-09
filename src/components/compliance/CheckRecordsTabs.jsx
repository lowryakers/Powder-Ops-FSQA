// The records the scheduled checks file (D-060), as tabs on Quality
// Schedules: environmental monitoring results, GMP walk-throughs, banned-list
// reviews. Every number is the length of the rows the endpoint returned.
import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { formatDate } from '../../lib/datetime.js';
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Plus, ShieldAlert } from 'lucide-react';

const OUTCOME = {
  pending: { label: 'Awaiting result', cls: 'bg-amber-50 text-amber-800' },
  ok: { label: 'OK', cls: 'bg-green-50 text-green-700' },
  alert: { label: 'Alert', cls: 'bg-orange-50 text-orange-800' },
  action: { label: 'ACTION', cls: 'bg-red-50 text-red-800' },
  info: { label: 'Info only', cls: 'bg-slate-100 text-slate-600' },
};
function OutcomeChip({ o }) {
  const m = OUTCOME[o] || OUTCOME.pending;
  return <span data-outcome={o} className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>{m.label}</span>;
}

/* ── EMP results ─────────────────────────────────────────────────────────── */

export function EmpResultsTab({ canAct }) {
  const { data: sum, refresh: refreshSum } = useApiGet('/check-records/emp/summary');
  const { data: zones } = useApiGet('/check-records/emp/zones');
  const [zone, setZone] = useState('');
  const [outcome, setOutcome] = useState('');
  const q = new URLSearchParams(); if (zone) q.set('zone', zone); if (outcome) q.set('outcome', outcome);
  const { data: list, refresh: refreshList } = useApiGet(`/check-records/emp/samples?${q}`, [zone, outcome]);
  const [filing, setFiling] = useState(false);
  const refresh = () => { refreshSum(); refreshList(); };
  const zoneLabel = (z) => zones?.zones?.[z]?.label || z;
  const samples = list?.samples || [];

  return (
    <div className="space-y-4" data-emp-results>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-gray-600 max-w-2xl">
          Every sample the environmental monitoring program takes, graded against the alert and action levels on {sum?.form_code} {sum?.revision}.
          A sampling task files its sites here as <b>awaiting result</b>; the laboratory's result is entered on the row and grades itself.
          An action-level result raises a CAR.
        </p>
        {canAct && (
          <button onClick={() => setFiling(f => !f)} data-emp-file className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
            <Plus size={16} /> File a result by hand
          </button>
        )}
      </div>

      {filing && <ManualSampleForm zones={zones?.zones || {}} onDone={() => { setFiling(false); refresh(); }} onCancel={() => setFiling(false)} />}

      {/* Open items first: what is awaited, and what was over the line. */}
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3" data-emp-pending={sum?.pending_count ?? 0}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 flex items-center gap-1"><Clock size={13} /> Awaiting a result · {sum?.pending_count ?? 0}</h4>
          {sum?.pending?.length ? (
            <ul className="mt-2 divide-y divide-amber-100">
              {sum.pending.slice(0, 50).map(s => <PendingRow key={s.id} s={s} canAct={canAct} zoneLabel={zoneLabel} onDone={refresh} />)}
            </ul>
          ) : <p className="text-xs text-amber-700 mt-1">Nothing waiting on the laboratory.</p>}
        </section>
        <section className="rounded-xl border border-red-200 bg-red-50/50 p-3" data-emp-open-actions={sum?.open_action_count ?? 0}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-red-800 flex items-center gap-1"><ShieldAlert size={13} /> Action level, no corrective action recorded · {sum?.open_action_count ?? 0}</h4>
          {sum?.open_actions?.length ? (
            <ul className="mt-2 divide-y divide-red-100">
              {sum.open_actions.map(s => <ActionRow key={s.id} s={s} canAct={canAct} zoneLabel={zoneLabel} onDone={refresh} />)}
            </ul>
          ) : <p className="text-xs text-red-700 mt-1">None open.</p>}
        </section>
      </div>

      {/* Trend: per site and test over the last 12 months. */}
      {sum?.sites?.length > 0 && (
        <section className="rounded-xl border border-gray-200 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Last 12 months by site</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-gray-500"><tr><th className="text-left py-1 pr-3">Zone</th><th className="text-left py-1 pr-3">Site</th><th className="text-left py-1 pr-3">Test</th><th className="text-right py-1 pr-3">Samples</th><th className="text-right py-1 pr-3">Alerts</th><th className="text-right py-1 pr-3">Actions</th><th className="text-left py-1">Last sampled</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {sum.sites.map((r, i) => (
                  <tr key={i} data-emp-site-row className={r.actions ? 'bg-red-50/40' : r.alerts ? 'bg-orange-50/40' : ''}>
                    <td className="py-1 pr-3 text-gray-500">{zoneLabel(r.zone)}</td><td className="py-1 pr-3 font-medium">{r.site}</td><td className="py-1 pr-3">{r.test}</td>
                    <td className="py-1 pr-3 text-right">{r.n}</td><td className="py-1 pr-3 text-right">{r.alerts}</td><td className="py-1 pr-3 text-right">{r.actions}</td><td className="py-1">{formatDate(r.last_sampled)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* The full log. */}
      <section className="rounded-xl border border-gray-200 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex-1">All samples</h4>
          <select value={zone} onChange={e => setZone(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-xs">
            <option value="">All zones</option>
            {Object.entries(zones?.zones || {}).map(([k, z]) => <option key={k} value={k}>{z.label}</option>)}
          </select>
          <select value={outcome} onChange={e => setOutcome(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-xs">
            <option value="">All outcomes</option>
            {Object.entries(OUTCOME).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
          </select>
        </div>
        {samples.length === 0 ? <p className="text-xs text-gray-400">No samples on record{zone || outcome ? ' for this filter' : ''}.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-gray-500"><tr><th className="text-left py-1 pr-3">Sampled</th><th className="text-left py-1 pr-3">Zone</th><th className="text-left py-1 pr-3">Site</th><th className="text-left py-1 pr-3">Test</th><th className="text-left py-1 pr-3">Result</th><th className="text-left py-1 pr-3">Outcome</th><th className="text-left py-1 pr-3">Limits</th><th className="text-left py-1">CAR</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {samples.map(s => (
                  <tr key={s.id} data-emp-sample={s.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{formatDate(s.sampled_on)}</td>
                    <td className="py-1 pr-3 text-gray-500">{zoneLabel(s.zone)}</td>
                    <td className="py-1 pr-3 font-medium">{s.site}</td>
                    <td className="py-1 pr-3">{s.test}</td>
                    <td className="py-1 pr-3">{s.result_value || '—'}</td>
                    <td className="py-1 pr-3"><OutcomeChip o={s.outcome} /></td>
                    <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{s.alert_limit && s.alert_limit !== 'NA' ? `alert ${s.alert_limit} · ` : ''}{s.action_limit ? `action ${s.action_limit}` : ''}</td>
                    <td className="py-1">{s.capa_number || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PendingRow({ s, canAct, zoneLabel, onDone }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const enter = async () => {
    setBusy(true); setErr('');
    try { await apiPost(`/check-records/emp/samples/${s.id}/result`, { result_value: val }); setVal(''); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <li className="py-1.5 text-xs" data-emp-pending-row={s.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-500 whitespace-nowrap">{formatDate(s.sampled_on)}</span>
        <span className="font-medium">{s.site}</span>
        <span className="text-gray-600">{s.test}</span>
        <span className="text-gray-400">{zoneLabel(s.zone)}</span>
        {canAct && (
          <span className="ml-auto flex items-center gap-1">
            <input value={val} onChange={e => setVal(e.target.value)} placeholder="result" data-emp-result-input
              className="w-24 px-2 py-1 border border-gray-300 rounded text-xs" onKeyDown={e => { if (e.key === 'Enter') enter(); }} />
            <button onClick={enter} disabled={busy || !val.trim()} data-emp-result-save className="px-2 py-1 bg-powder-600 text-white rounded text-xs disabled:opacity-50">Enter</button>
          </span>
        )}
      </div>
      {err && <p className="text-red-700 mt-0.5">{err}</p>}
    </li>
  );
}

function ActionRow({ s, canAct, zoneLabel, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await apiPut(`/check-records/emp/samples/${s.id}/corrective-action`, { corrective_action: text }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <li className="py-1.5 text-xs" data-emp-action-row={s.id}>
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={12} className="text-red-600" />
        <span className="text-gray-500">{formatDate(s.sampled_on)}</span>
        <span className="font-medium">{s.site}</span><span>{s.test}</span>
        <span className="font-semibold text-red-800">{s.result_value}</span>
        <span className="text-gray-400">{zoneLabel(s.zone)}{s.capa_number ? ` · ${s.capa_number}` : ''}</span>
      </div>
      {canAct && (
        <div className="mt-1 flex gap-1">
          <input value={text} onChange={e => setText(e.target.value)} placeholder="What was done (re-clean, re-swab, hold…)" data-emp-corrective-input
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" />
          <button onClick={save} disabled={busy || text.trim().length < 3} data-emp-corrective-save className="px-2 py-1 bg-red-700 text-white rounded text-xs disabled:opacity-50">Record</button>
        </div>
      )}
      {err && <p className="text-red-700 mt-0.5">{err}</p>}
    </li>
  );
}

function ManualSampleForm({ zones, onDone, onCancel }) {
  const [f, setF] = useState({ zone: 'water', site: '', test: '', sampled_on: '', result_value: '', lab: '', notes: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tests = zones[f.zone]?.tests || [];
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await apiPost('/check-records/emp/samples', { ...f, test: f.test || tests[0] }); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-powder-200 bg-powder-50/40 p-3 grid gap-2 sm:grid-cols-3" data-emp-manual-form>
      <p className="sm:col-span-3 text-xs text-gray-600">For a result the plant already holds (this year's water and air reports) or a sample taken outside a scheduled task. Graded the same way.</p>
      <select value={f.zone} onChange={e => setF({ ...f, zone: e.target.value, test: '' })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-manual-zone>
        {Object.entries(zones).map(([k, z]) => <option key={k} value={k}>{z.label}</option>)}
      </select>
      <select value={f.test || tests[0] || ''} onChange={e => setF({ ...f, test: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-manual-test>
        {tests.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input required value={f.site} onChange={e => setF({ ...f, site: e.target.value })} placeholder="Site" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-manual-site />
      <input required type="date" value={f.sampled_on} onChange={e => setF({ ...f, sampled_on: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-manual-date />
      <input value={f.result_value} onChange={e => setF({ ...f, result_value: e.target.value })} placeholder="Result (blank = awaiting)" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-manual-result />
      <input value={f.lab} onChange={e => setF({ ...f, lab: e.target.value })} placeholder="Laboratory" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      {err && <p className="sm:col-span-3 text-xs text-red-700">{err}</p>}
      <div className="sm:col-span-3 flex gap-2">
        <button type="submit" disabled={busy} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-50" data-manual-save>File</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs">Cancel</button>
      </div>
    </form>
  );
}

/* ── GMP walk-throughs ───────────────────────────────────────────────────── */

export function GmpWalksTab() {
  const { data } = useApiGet('/check-records/gmp-walks');
  const walks = data?.walks || [];
  return (
    <div className="space-y-3" data-gmp-walks={walks.length}>
      <p className="text-sm text-gray-600 max-w-2xl">
        The weekly GMP walk-through, one record per walk, signed by completing its task. Checklist <b>{data?.revision}</b> —
        drafted for the audit response and stamped as a draft on every record until Document Control issues a numbered form.
        The same item not compliant on two consecutive walks raises a CAR.
      </p>
      {walks.length === 0 ? <p className="text-xs text-gray-400">No walk-through on record yet. The first one is in the Task Center under Quality.</p> : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="text-left px-3 py-2">Walked</th><th className="text-left px-3 py-2">By</th><th className="text-left px-3 py-2">Area</th>
              {(data?.items || []).map(it => <th key={it.key} className="text-left px-3 py-2">{it.label.split(' — ')[0]}</th>)}<th className="text-left px-3 py-2">CARs</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {walks.map(w => (
                <tr key={w.id} data-gmp-walk={w.id} className={w.nc_count ? 'bg-red-50/30' : ''}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(w.walked_on)}<span className="ml-1 text-gray-400">{w.checklist_revision}</span></td>
                  <td className="px-3 py-2">{w.walked_by}</td><td className="px-3 py-2">{w.area}</td>
                  {(data?.items || []).map(it => {
                    const a = w.items.find(x => x.key === it.key);
                    const r = a?.result;
                    return <td key={it.key} className="px-3 py-2" title={a?.note || ''}>
                      {r === 'c' ? <CheckCircle2 size={14} className="text-green-600" /> : r === 'nc' ? <span className="text-red-700 font-semibold">NC{a?.note ? ` · ${a.note}` : ''}</span> : <span className="text-gray-400">N/A</span>}
                    </td>;
                  })}
                  <td className="px-3 py-2">{w.capa_ids.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Banned / prohibited substance list reviews ──────────────────────────── */

export function ListReviewsTab() {
  const { data } = useApiGet('/check-records/list-reviews');
  const reviews = data?.reviews || [];
  const cur = data?.current;
  return (
    <div className="space-y-3" data-list-reviews={reviews.length}>
      <p className="text-sm text-gray-600 max-w-2xl">
        The annual review of the NSF/ANSI 306 Annex C, NFL/NFLPA, MLB and WADA lists (NSF 306 §6.2.3.1). The latest review is the record of
        which editions are in use; each review records the changes found and what was done about them.
      </p>
      <section className="rounded-xl border border-gray-200 p-3" data-list-current={cur ? 1 : 0}>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-1"><FlaskConical size={13} /> Editions in use</h4>
        {cur ? (
          <ul className="text-sm grid sm:grid-cols-2 gap-x-6">
            {(data.lists || []).map(l => <li key={l.key}><span className="text-gray-500">{l.label}:</span> <b>{cur.editions[l.key] || '—'}</b></li>)}
            <li className="sm:col-span-2 text-xs text-gray-500 mt-1">Reviewed {formatDate(cur.reviewed_on)} by {cur.reviewed_by}</li>
          </ul>
        ) : <p className="text-xs text-amber-800">No review on record — the first one, from the Task Center, sets the baseline editions.</p>}
      </section>
      {reviews.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="text-left px-3 py-2">Reviewed</th><th className="text-left px-3 py-2">By</th><th className="text-left px-3 py-2">Changes found</th><th className="text-left px-3 py-2">Actions taken</th><th className="text-left px-3 py-2">Materials re-checked</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {reviews.map(r => (
                <tr key={r.id} data-list-review={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.reviewed_on)}</td><td className="px-3 py-2">{r.reviewed_by}</td>
                  <td className="px-3 py-2 max-w-xs">{r.changes_found}</td><td className="px-3 py-2 max-w-xs">{r.actions_taken}</td>
                  <td className="px-3 py-2">{r.materials_rechecked ? 'Yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
