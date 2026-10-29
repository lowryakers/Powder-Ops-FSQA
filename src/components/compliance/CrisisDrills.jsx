// Safety → Crisis Drills (D-265): the Crisis Management Drill and Product
// Integrity Inspection, SOP 501. The form's definition comes from the server
// (shared/crisis-drill.js); the screen draws it and runs the same "what is
// still missing" check the server runs before a review can be signed.
import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { Plus, X, ShieldCheck, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { cleanDrill, missingToSign, resultLabel, scenarioLabel } from '../../../shared/crisis-drill.js';
import { withSignature } from '../../lib/signature';
import { formatDateTime } from '../../lib/datetime.js';
import { localDateStr } from '../../utils/dates';

const inputCls = 'w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm';
const labelCls = 'text-[11px] font-medium text-gray-600';
const RESULT_TONE = {
  effective: 'bg-green-100 text-green-800',
  effective_with_improvements: 'bg-amber-100 text-amber-900',
  not_effective: 'bg-red-100 text-red-800',
};

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 border-b border-gray-200 pb-1">{title}</h4>
      {children}
    </section>
  );
}

const blankDrill = () => ({
  drill_date: localDateStr(), time_started: '', time_completed: '', area: '', activities: [], scenario: '', scenario_other: '',
  conducted_by: '', participants: [{ name: '', role: '' }], scenario_description: '', actions: '', inspection: {},
  product_lot: '', quantity_location: '', hold_status: '', what_worked: '', gaps: '', result: '',
  corrective_actions: [], retest_required: false, retest_date_result: '', record_location: '',
});

function DrillForm({ form, initial, onClose, onSaved }) {
  const [d, setD] = useState(() => (initial ? { ...blankDrill(), ...initial, participants: initial.participants?.length ? initial.participants : [{ name: '', role: '' }] } : blankDrill()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = !!initial?.signed;
  const set = (k, v) => setD(x => ({ ...x, [k]: v }));
  const missing = missingToSign(cleanDrill(d));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const saved = initial?.id ? await apiPut(`/safety/drills/${initial.id}`, d) : await apiPost('/safety/drills', d);
      onSaved(saved);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const sign = async (review) => {
    setError('');
    try {
      const saved = await withSignature((extra) => apiPost(`/safety/drills/${initial.id}/sign/${review}`, extra),
        { title: form.reviews[review], detail: `Crisis drill ${initial.drill_date}` });
      onSaved(saved, true);
    } catch (e) { if (!e.cancelled) setError(e.message); }
  };
  const revoke = async (review) => {
    const reason = window.prompt('Why is this signature being revoked?');
    if (!reason) return;
    try { onSaved(await apiFetch(`/safety/drills/${initial.id}/sign/${review}`, { method: 'DELETE', body: { reason } }), true); }
    catch (e) { setError(e.message); }
  };

  const toggleActivity = (k) => set('activities', d.activities.includes(k) ? d.activities.filter(a => a !== k) : [...d.activities, k]);
  const setPart = (i, p) => set('participants', d.participants.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setCa = (i, p) => set('corrective_actions', d.corrective_actions.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[94vh] flex flex-col" data-drill-form>
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">{form.title}</h3>
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 mt-1 inline-block">
              {form.sop} · {form.revision}: not yet numbered by Document Control
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
        <fieldset disabled={locked} className="min-w-0 p-4 space-y-5">
          <Section title="Drill">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="block"><span className={labelCls}>Date conducted *</span>
                <input type="date" max={localDateStr()} value={d.drill_date || ''} onChange={e => set('drill_date', e.target.value)} className={inputCls} data-drill-field="drill_date" /></label>
              <label className="block"><span className={labelCls}>Time started</span>
                <input type="time" value={d.time_started || ''} onChange={e => set('time_started', e.target.value)} className={inputCls} /></label>
              <label className="block"><span className={labelCls}>Time completed</span>
                <input type="time" value={d.time_completed || ''} onChange={e => set('time_completed', e.target.value)} className={inputCls} /></label>
              <label className="block"><span className={labelCls}>Area inspected</span>
                <input value={d.area || ''} onChange={e => set('area', e.target.value)} className={inputCls} data-drill-field="area" /></label>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span className={labelCls}>Activity:</span>
              {form.activities.map(a => (
                <label key={a.key} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={d.activities.includes(a.key)} onChange={() => toggleActivity(a.key)} data-drill-activity={a.key} /> {a.label}</label>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span className={labelCls}>Scenario:</span>
              {form.scenarios.map(s => (
                <label key={s.key} className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="scenario" checked={d.scenario === s.key} onChange={() => set('scenario', s.key)} data-drill-scenario={s.key} /> {s.label}</label>
              ))}
              {d.scenario === 'other' && <input value={d.scenario_other || ''} onChange={e => set('scenario_other', e.target.value)} placeholder="Other: …" className="px-2 py-1 border border-gray-300 rounded-md text-sm" />}
            </div>
            <label className="block"><span className={labelCls}>Conducted by</span>
              <input value={d.conducted_by || ''} onChange={e => set('conducted_by', e.target.value)} className={inputCls} data-drill-field="conducted_by" /></label>
            <div>
              <span className={labelCls}>Participants</span>
              <div className="space-y-1.5 mt-1">
                {d.participants.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={p.name || ''} onChange={e => setPart(i, { name: e.target.value })} placeholder="Name" className={inputCls} data-drill-participant={i} />
                    <input value={p.role || ''} onChange={e => setPart(i, { role: e.target.value })} placeholder="Role (e.g. Supervisor)" className={inputCls} />
                    <button type="button" onClick={() => set('participants', d.participants.filter((_, j) => j !== i))} className="p-1 text-gray-300 hover:text-red-500 shrink-0"><X size={14} /></button>
                  </div>
                ))}
                <button type="button" onClick={() => set('participants', [...d.participants, { name: '', role: '' }])} className="text-xs text-powder-700 hover:underline">+ Add participant</button>
              </div>
            </div>
          </Section>

          <Section title="Objective">
            <p className="text-sm text-gray-700">{form.objective}</p>
          </Section>

          <Section title="Scenario and actions">
            <label className="block"><span className={labelCls}>Describe the simulated emergency</span>
              <textarea rows={2} value={d.scenario_description || ''} onChange={e => set('scenario_description', e.target.value)} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Actions performed or discussed</span>
              <textarea rows={2} value={d.actions || ''} onChange={e => set('actions', e.target.value)} className={inputCls} /></label>
          </Section>

          <Section title="Product integrity inspection">
            <p className="text-[11px] text-gray-500">Mark: P = Pass, F = Fail, N/A = Not Applicable</p>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {form.inspection_items.map(it => (
                <div key={it.key} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="flex gap-1 shrink-0">
                    {Object.entries(form.marks).map(([k, label]) => {
                      const on = d.inspection?.[it.key] === k;
                      const tone = k === 'P' ? 'bg-green-600' : k === 'F' ? 'bg-red-600' : 'bg-gray-500';
                      return (
                        <button key={k} type="button" title={label} onClick={() => set('inspection', { ...d.inspection, [it.key]: on ? null : k })}
                          data-drill-mark={`${it.key}:${k}`}
                          className={`w-9 py-1 rounded text-xs font-bold border ${on ? `${tone} text-white border-transparent` : 'bg-white text-gray-500 border-gray-300'}`}>
                          {k === 'NA' ? 'N/A' : k}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-sm text-gray-800">{it.label}</span>
                </div>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="block"><span className={labelCls}>Product / lot used in exercise</span>
                <input value={d.product_lot || ''} onChange={e => set('product_lot', e.target.value)} className={inputCls} /></label>
              <label className="block"><span className={labelCls}>Quantity / location</span>
                <input value={d.quantity_location || ''} onChange={e => set('quantity_location', e.target.value)} className={inputCls} /></label>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span className={labelCls}>Hold status:</span>
              {form.hold_status.map(h => (
                <label key={h.key} className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="hold" checked={d.hold_status === h.key} onChange={() => set('hold_status', h.key)} data-drill-hold={h.key} /> {h.label}</label>
              ))}
            </div>
          </Section>

          <Section title="Results and findings">
            <label className="block"><span className={labelCls}>What worked</span>
              <textarea rows={2} value={d.what_worked || ''} onChange={e => set('what_worked', e.target.value)} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Gaps or deficiencies</span>
              <textarea rows={2} value={d.gaps || ''} onChange={e => set('gaps', e.target.value)} className={inputCls} placeholder="Leave blank if none" /></label>
            <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span className={labelCls}>Overall result:</span>
              {form.results.map(r => (
                <label key={r.key} className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="result" checked={d.result === r.key} onChange={() => set('result', r.key)} data-drill-result={r.key} /> {r.label}</label>
              ))}
            </div>
          </Section>

          <Section title="Corrective actions">
            {d.corrective_actions.length === 0 && <p className="text-xs text-gray-500">None. Add one if a line failed or the result was not "Effective".</p>}
            {d.corrective_actions.map((c, i) => (
              <div key={i} className="grid sm:grid-cols-2 gap-2 border border-gray-200 rounded-lg p-2">
                <label className="block sm:col-span-2"><span className={labelCls}>Finding</span><input value={c.finding || ''} onChange={e => setCa(i, { finding: e.target.value })} className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>Action required</span><input value={c.action || ''} onChange={e => setCa(i, { action: e.target.value })} className={inputCls} /></label>
                <label className="block"><span className={labelCls}>Responsible person</span><input value={c.responsible || ''} onChange={e => setCa(i, { responsible: e.target.value })} className={inputCls} /></label>
                <label className="block"><span className={labelCls}>Due date</span><input type="date" value={c.due_date || ''} onChange={e => setCa(i, { due_date: e.target.value })} className={inputCls} /></label>
                <label className="block"><span className={labelCls}>Completion date</span><input type="date" value={c.completion_date || ''} onChange={e => setCa(i, { completion_date: e.target.value })} className={inputCls} /></label>
                <label className="block"><span className={labelCls}>Effectiveness verified by</span><input value={c.verified_by || ''} onChange={e => setCa(i, { verified_by: e.target.value })} className={inputCls} /></label>
                <label className="block"><span className={labelCls}>Verified date</span><input type="date" value={c.verified_date || ''} onChange={e => setCa(i, { verified_date: e.target.value })} className={inputCls} /></label>
                <div className="flex items-end justify-end"><button type="button" onClick={() => set('corrective_actions', d.corrective_actions.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">Remove</button></div>
              </div>
            ))}
            <button type="button" onClick={() => set('corrective_actions', [...d.corrective_actions, {}])} className="text-xs text-powder-700 hover:underline" data-drill-add-ca>+ Add corrective action</button>
            <div className="flex flex-wrap gap-x-4 items-center">
              <span className={labelCls}>Retest required?</span>
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="retest" checked={!!d.retest_required} onChange={() => set('retest_required', true)} /> Yes</label>
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="retest" checked={!d.retest_required} onChange={() => set('retest_required', false)} /> No</label>
              {!!d.retest_required && <input value={d.retest_date_result || ''} onChange={e => set('retest_date_result', e.target.value)} placeholder="Retest date / result" className="px-2 py-1 border border-gray-300 rounded-md text-sm" />}
            </div>
          </Section>

          <Section title="Review and record control">
            <label className="block"><span className={labelCls}>Record location</span>
              <input value={d.record_location || ''} onChange={e => set('record_location', e.target.value)} placeholder="e.g. Powder Ops Vineyard" className={inputCls} /></label>
            {initial?.created_by && <p className="text-xs text-gray-500">Filed by {initial.created_by}, {formatDateTime(initial.created_at)}.</p>}
          </Section>
        </fieldset>
        </div>

        <div className="p-4 border-t space-y-2">
          {initial?.id && (
            <div className="grid sm:grid-cols-2 gap-2" data-drill-reviews>
              {['qa', 'management'].map(r => {
                const by = r === 'qa' ? initial.qa_signed_by : initial.mgmt_signed_by;
                const at = r === 'qa' ? initial.qa_signed_at : initial.mgmt_signed_at;
                const may = r === 'qa' ? form.can_sign_qa : form.can_sign_management;
                return (
                  <div key={r} className="border border-gray-200 rounded-lg p-2 text-sm">
                    <p className="text-xs font-semibold text-gray-600">{form.reviews[r]}</p>
                    {by ? (
                      <p className="flex items-center gap-1.5 text-green-800"><CheckCircle2 size={14} /> {by} · {formatDateTime(at)}
                        <button type="button" onClick={() => revoke(r)} className="ml-auto text-[11px] text-gray-400 hover:text-red-600">Revoke</button></p>
                    ) : may ? (
                      <button type="button" onClick={() => sign(r)} disabled={missing.length > 0} data-drill-sign={r}
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40">
                        <ShieldCheck size={13} /> Sign
                      </button>
                    ) : <p className="text-xs text-gray-400">Not signed</p>}
                  </div>
                );
              })}
            </div>
          )}
          {initial?.id && missing.length > 0 && !locked && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2" data-drill-missing>
              Before it can be reviewed: {missing.join(' · ')}
            </p>
          )}
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
          <div className="flex gap-2">
            {!locked && (
              <button type="button" onClick={save} disabled={saving || !d.drill_date} data-drill-save
                className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            )}
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Close</button>
            {locked && <p className="text-xs text-gray-500 self-center">Signed records are closed. Revoke a signature to correct it.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CrisisDrills({ form, user }) {
  const { data, refresh } = useApiGet('/safety/drills');
  const [open, setOpen] = useState(null); // null | {} new | record
  if (!form) return null;
  const remove = async (r) => {
    if (!window.confirm(`Delete the ${r.drill_date} drill record? This cannot be undone.`)) return;
    try { await apiFetch(`/safety/drills/${r.id}`, { method: 'DELETE' }); refresh(); } catch (e) { alert(e.message); }
  };
  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-gray-700">{form.title} ({form.sop}). The annual crisis test and what it did to product and materials (SQF 2.6.4.2).</p>
        </div>
        {form.can_file && (
          <button type="button" onClick={() => setOpen({})} data-drill-new
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium shrink-0"><Plus size={15} /> Record a drill</button>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100" data-drill-list>
        {(data || []).map(r => {
          const reviewed = r.qa_signed_at && r.mgmt_signed_at;
          return (
            <div key={r.id} className="px-4 py-3 flex items-start gap-3">
              <button type="button" onClick={() => setOpen(r)} className="flex-1 text-left min-w-0" data-drill-row={r.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{r.drill_date}</span>
                  <span className="text-sm text-gray-700">{scenarioLabel(r)}{r.area ? ` · ${r.area}` : ''}</span>
                  {r.result && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${RESULT_TONE[r.result]}`}>{resultLabel(r.result)}</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  {r.conducted_by && <span>Conducted by {r.conducted_by}</span>}
                  <span>{r.participants?.length || 0} participants</span>
                  {reviewed ? <span className="text-green-700">Reviewed by QA and management</span>
                    : <span className="text-amber-800 inline-flex items-center gap-1"><AlertTriangle size={11} />
                      {r.missing_to_sign?.length ? `${r.missing_to_sign.length} item(s) to finish` : 'Waiting for review'}</span>}
                  {r.failed_lines?.length > 0 && <span className="text-red-700">{r.failed_lines.length} line(s) failed</span>}
                </p>
              </button>
              {user?.role === 'admin' && !r.signed && (
                <button type="button" onClick={() => remove(r)} className="p-1 text-gray-300 hover:text-red-500" title="Delete"><Trash2 size={14} /></button>
              )}
            </div>
          );
        })}
        {data && data.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No drills recorded yet.</p>}
      </div>
      {open && (
        <DrillForm key={open.id || 'new'} form={form} initial={open.id ? open : null} onClose={() => setOpen(null)}
          onSaved={(saved, stay) => { refresh(); setOpen(stay || !open.id ? saved : null); }} />
      )}
    </div>
  );
}
