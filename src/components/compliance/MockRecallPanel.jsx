import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import {
  Plus, ArrowLeft, Package, Clock, Check, X, AlertTriangle, HelpCircle,
  ShieldCheck, RotateCcw, FileCheck2, Phone,
} from 'lucide-react';

/**
 * Mock Recall — Form 415-1, driven by the plant's own SOP 415 V3.
 *
 * The form the SOP actually asks for, in the SOP's own wording and order, so
 * an auditor comparing the screen to the paper finds the same list. Three
 * rules shape this and are worth keeping:
 *
 *  · The EFFECTIVENESS CHECK IS DERIVED, never typed. Mass balance, the
 *    four-hour limit and the Form 415-1 box are computed from what's on the
 *    record, so a corrected number can't leave a stale "pass" behind it.
 *  · SIGN-OFF IS REFUSED while any documented item is blank. An exercise filed
 *    with half its questions empty reads later as if those areas were covered.
 *  · An exercise that fails the criteria needs a root cause before it closes —
 *    the SOP says so, and a failed drill with no investigation is the gap the
 *    drill exists to find.
 */

const RESULT_CHIP = {
  pending: 'bg-yellow-100 text-yellow-800',
  pass: 'bg-green-100 text-green-800',
  fail: 'bg-red-100 text-red-800',
  conditional: 'bg-orange-100 text-orange-800',
};

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

function Field({ label, children, wide = false }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

/** One documented item, rendered from the server's own field definition. */
function ItemInput({ item, value, onChange, disabled }) {
  const common = { disabled, value: value ?? '', onChange: e => onChange(item.key, e.target.value), className: input };
  if (item.kind === 'textarea') {
    return <Field label={item.label} wide><textarea rows={2} {...common} /></Field>;
  }
  if (item.kind === 'date') return <Field label={item.label}><input type="date" {...common} /></Field>;
  if (item.kind === 'datetime') {
    // A datetime-local input needs "YYYY-MM-DDTHH:mm"; stored values are ISO.
    const v = value ? String(value).slice(0, 16) : '';
    return (
      <Field label={item.label}>
        <input type="datetime-local" disabled={disabled} value={v}
          onChange={e => onChange(item.key, e.target.value ? new Date(e.target.value).toISOString() : '')}
          className={input} />
      </Field>
    );
  }
  return <Field label={item.label}><input {...common} /></Field>;
}

function CriteriaCard({ effectiveness }) {
  if (!effectiveness) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-900">Effectiveness check</h4>
        {effectiveness.complete ? (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${effectiveness.successful ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
            {effectiveness.successful ? 'SUCCESSFUL' : 'NOT SUCCESSFUL'}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">IN PROGRESS</span>
        )}
      </div>
      {effectiveness.criteria.map(c => {
        const Icon = c.met === true ? Check : c.met === false ? X : HelpCircle;
        const tone = c.met === true ? 'text-green-600' : c.met === false ? 'text-red-500' : 'text-gray-300';
        return (
          <div key={c.id} className="flex items-start gap-2">
            <Icon size={14} className={`${tone} shrink-0 mt-0.5`} />
            <div className="min-w-0">
              <p className="text-xs text-gray-800">{c.label}</p>
              <p className="text-[11px] text-gray-500">{c.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContactsCard({ contacts, sopRevision }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-2">
        <Phone size={14} className="text-gray-400" /> Recall contacts
        <span className="text-[10px] font-normal text-gray-400">from SOP 415 {sopRevision}</span>
      </h4>
      <div className="space-y-1">
        {(contacts || []).map(c => (
          <div key={c.name} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-gray-900 font-medium">{c.name}</span>
            <span className="text-gray-500 flex-1 truncate">{c.title}</span>
            <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-powder-600 hover:underline whitespace-nowrap">{c.phone}</a>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── One exercise ─────────────────────────────────────────────────────────── */

function RecallDetail({ id, form, onBack, onChanged }) {
  const { data: recall, refresh } = useApiGet(`/mock-recalls/${id}`, [id]);
  const { user } = useAuth() || {};
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!recall || !form) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;

  const locked = !!recall.approved_at;
  const val = (k) => (k in draft ? draft[k] : recall[k]);
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true); setError('');
    try { await apiPut(`/mock-recalls/${id}`, draft); setDraft({}); await refresh(); onChanged?.(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const act = async (fn) => {
    setError('');
    try { await fn(); await refresh(); onChanged?.(); }
    catch (e) { setError(e.message); }
  };

  const proc = form.tracking_procedures?.[val('tracking_procedure')];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Back
        </button>
        <h3 className="text-base font-semibold text-gray-900">{recall.recall_number}</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs ${RESULT_CHIP[recall.result] || RESULT_CHIP.pending}`}>{recall.result}</span>
        {recall.checklist_revision && <span className="text-[10px] text-gray-400">run against {recall.checklist_revision}</span>}
      </div>

      {locked && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-center gap-2 flex-wrap">
          <ShieldCheck size={14} />
          Authorized by {recall.approved_by} on {new Date(recall.approved_at).toLocaleString()}.
          {recall.filed_with_dc_at
            ? <> Filed with Document Control by {recall.filed_with_dc_by}.</>
            : <> Not yet filed with Document Control.</>}
        </div>
      )}

      {recall.investigation_required && !String(val('root_cause') || '').trim() && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            This exercise did not meet the effectiveness criteria. SOP 415 requires an investigation —
            record the root cause and the actions taken before it can be signed off.
          </span>
        </div>
      )}

      <CriteriaCard effectiveness={recall.effectiveness} />

      {recall.missing_items?.length > 0 && !locked && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
          <p className="text-xs font-medium text-gray-700 mb-1">
            {recall.missing_items.length} item{recall.missing_items.length === 1 ? '' : 's'} the SOP requires are still blank
          </p>
          <p className="text-[11px] text-gray-500">{recall.missing_items.map(m => m.label).join(' · ')}</p>
        </div>
      )}

      {/* The SOP's documented items, in the SOP's order. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">The mock recall will document</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {form.documented_items.map(item => (
            <ItemInput key={item.key} item={item} value={val(item.key)} onChange={set} disabled={locked} />
          ))}
        </div>
      </div>

      {/* Tracking procedure walked. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tracking procedure walked">
            <select disabled={locked} value={val('tracking_procedure') || ''} onChange={e => set('tracking_procedure', e.target.value)} className={input}>
              <option value="">— Not recorded —</option>
              {Object.entries(form.tracking_procedures || {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Reason for the exercise">
            <input disabled={locked} value={val('reason') || ''} onChange={e => set('reason', e.target.value)} className={input} />
          </Field>
        </div>
        {proc && (
          <ol className="text-xs text-gray-600 space-y-1 list-decimal pl-5">
            {proc.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        )}
      </div>

      {/* The three effectiveness inputs. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Effectiveness criteria</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={`Mass balance recovery % (${form.criteria.mass_balance_min}–${form.criteria.mass_balance_max})`}>
            <input type="number" step="any" disabled={locked} value={val('mass_balance_pct') ?? ''}
              onChange={e => set('mass_balance_pct', e.target.value === '' ? null : Number(e.target.value))} className={input} />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" disabled={locked} checked={!!val('summary_report_complete')}
                onChange={e => set('summary_report_complete', e.target.checked)} className="rounded border-gray-300" />
              Summary report complete
            </label>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" disabled={locked} checked={!!val('form_415_1_checked')}
                onChange={e => set('form_415_1_checked', e.target.checked)} className="rounded border-gray-300" />
              Mock recall box checked on {form.form_code}
            </label>
          </div>
          <Field label="Root cause (required if not successful)" wide>
            <textarea rows={2} disabled={locked} value={val('root_cause') || ''} onChange={e => set('root_cause', e.target.value)} className={input} />
          </Field>
          <Field label="Actions taken" wide>
            <textarea rows={2} disabled={locked} value={val('corrective_actions') || ''} onChange={e => set('corrective_actions', e.target.value)} className={input} />
          </Field>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!locked && (
          <button onClick={save} disabled={saving || !dirty}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {!locked && (
          <button onClick={() => act(() => apiPost(`/mock-recalls/${id}/approve`, {}))}
            disabled={dirty || !recall.can_sign}
            title={dirty ? 'Save your changes first' : (recall.sign_block_reason || 'Authorize this mock recall')}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1">
            <ShieldCheck size={15} /> Authorize
          </button>
        )}
        {locked && (
          <button onClick={() => act(() => apiFetch(`/mock-recalls/${id}/approve`, { method: 'DELETE' }))}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 inline-flex items-center gap-1">
            <RotateCcw size={15} /> Revoke sign-off
          </button>
        )}
        {locked && !recall.filed_with_dc_at && (
          <button onClick={() => act(() => apiPost(`/mock-recalls/${id}/file-with-dc`, {}))}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 inline-flex items-center gap-1">
            <FileCheck2 size={15} /> Mark filed with Document Control
          </button>
        )}
      </div>
      {!locked && recall.sign_block_reason && (
        <p className="text-[11px] text-gray-500">{recall.sign_block_reason}.</p>
      )}
      {!user && null}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export default function MockRecallPanel() {
  const { data: form } = useApiGet('/mock-recalls/form');
  const { data: recalls, refresh } = useApiGet('/mock-recalls');
  const { data: status, refresh: refreshStatus } = useApiGet('/mock-recalls/status');
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState({ product_name: '', item_number: '', lot_number: '', reason: '' });
  const [error, setError] = useState('');

  const changed = () => { refresh(); refreshStatus(); };

  const start = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const created = await apiPost('/mock-recalls', draft);
      setStarting(false);
      setDraft({ product_name: '', item_number: '', lot_number: '', reason: '' });
      changed();
      setOpenId(created.id);
    } catch (err) { setError(err.message); }
  };

  if (openId) {
    return <RecallDetail id={openId} form={form} onBack={() => { setOpenId(null); changed(); }} onChanged={changed} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">Mock Recall</h2>
          <p className="text-xs text-gray-500">
            Form 415-1, run against SOP 415 {form?.sop_revision || ''}. At least once a year, rotating products.
          </p>
        </div>
        <button onClick={() => setStarting(s => !s)}
          className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 inline-flex items-center gap-1 sm:ml-auto">
          <Plus size={16} /> Start exercise
        </button>
      </div>

      {/* The annual cadence, reported rather than enforced. */}
      {status && (
        <div className={`rounded-xl border p-4 ${status.overdue ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-start gap-2">
            <Clock size={16} className={status.overdue ? 'text-amber-600 shrink-0 mt-0.5' : 'text-gray-400 shrink-0 mt-0.5'} />
            <div className="min-w-0">
              {status.last_completed ? (
                <p className="text-sm text-gray-900">
                  Last completed exercise: <strong>{status.last_completed.recall_number}</strong> on {status.last_completed.date_initiated}
                  {' '}({status.days_since} days ago).
                </p>
              ) : (
                <p className="text-sm text-gray-900">No mock recall has been signed off yet.</p>
              )}
              <p className="text-xs text-gray-600">
                {status.overdue
                  ? 'SOP 415 requires this at least once a year — it is overdue.'
                  : `Next one due in ${status.due_in_days} days.`}
                {status.open_exercises > 0 && ` ${status.open_exercises} exercise${status.open_exercises === 1 ? '' : 's'} in progress.`}
              </p>
              {status.recent_products?.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Recently exercised (rotate to a different type): {status.recent_products.join(' · ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {starting && (
        <form onSubmit={start} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="font-semibold text-gray-900">Start a mock recall</h3>
          <p className="text-xs text-gray-500">
            The rest of Form 415-1 is filled in as the exercise runs — the clock starts now.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Product name *">
              <input required value={draft.product_name} onChange={e => setDraft({ ...draft, product_name: e.target.value })} className={input} />
            </Field>
            <Field label="Item number">
              <input value={draft.item_number} onChange={e => setDraft({ ...draft, item_number: e.target.value })} className={input} />
            </Field>
            <Field label="Lot number *">
              <input required value={draft.lot_number} onChange={e => setDraft({ ...draft, lot_number: e.target.value })} className={input} />
            </Field>
            <Field label="Reason *">
              <input required value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} className={input} placeholder="e.g. Annual traceability exercise" />
            </Field>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">Start</button>
            <button type="button" onClick={() => setStarting(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {(recalls || []).length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-gray-400">No mock recalls on record yet.</p>
        )}
        {(recalls || []).map(r => (
          <button key={r.id} onClick={() => setOpenId(r.id)}
            className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <div className="flex items-start gap-2 flex-wrap">
              <Package size={15} className="text-gray-400 shrink-0 mt-0.5" />
              <span className="font-medium text-gray-900">{r.recall_number}</span>
              <span className="text-sm text-gray-600 min-w-0 truncate">{r.product_name}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${RESULT_CHIP[r.result] || RESULT_CHIP.pending}`}>{r.result}</span>
              {r.approved_at && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">SIGNED</span>}
              {r.investigation_required && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">INVESTIGATION</span>}
              {!r.approved_at && r.missing_items?.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                  {r.missing_items.length} blank
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{r.date_initiated}</span>
            </div>
          </button>
        ))}
      </div>

      {form && <ContactsCard contacts={form.contacts} sopRevision={form.sop_revision} />}
    </div>
  );
}
