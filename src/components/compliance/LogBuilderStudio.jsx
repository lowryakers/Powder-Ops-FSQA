import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../lib/datetime.js';
import { Plus, X, Check, Send, ListChecks, FormInput, ShieldCheck, RotateCcw } from 'lucide-react';

/**
 * Log Builder — the supervised path for changing what a log asks.
 *
 * Copy an existing dropdown list or a log's fields, edit the copy, submit it,
 * and an admin approves before anything goes live — the procurement copy/edit
 * shape applied to log structure. The direct editor in Settings stays for
 * admins; this is the door Document Control uses.
 *
 * Approval applies through the structure engine's own rules, so a draft can
 * add and relabel but never delete, and keys/values stay immutable.
 */
const STATUS_CHIP = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

function ListEditor({ payload, onChange, disabled }) {
  const opts = payload.options || [];
  const set = (patch) => onChange({ ...payload, ...patch });
  const setOpt = (i, label) => set({ options: opts.map((o, j) => (j === i ? { ...o, label } : o)) });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">List name</label>
          <input disabled={disabled} value={payload.label || ''} onChange={e => set({ label: e.target.value })} className={input} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Key {payload.copied_from ? '(existing list — fixed)' : ''}</label>
          <input disabled value={payload.target_key || ''} className={`${input} bg-gray-50 text-gray-500`} />
        </div>
      </div>
      <label className="block text-xs font-medium text-gray-700">Options</label>
      {opts.map((o, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input disabled={disabled} value={o.label} onChange={e => setOpt(i, e.target.value)} className={input} />
          {/* A new, unsaved option can be withdrawn; an existing one cannot be
              deleted from here — retiring stays in the live editor. */}
          {!disabled && o._new && (
            <button type="button" onClick={() => set({ options: opts.filter((_, j) => j !== i) })}
              className="p-1 text-gray-400 hover:text-red-500"><X size={14} /></button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button"
          onClick={() => set({ options: [...opts, { value: '', label: '', _new: true }] })}
          className="text-xs font-medium text-powder-600 hover:underline">+ Add option</button>
      )}
      <p className="text-[11px] text-gray-400">
        Existing options can be relabelled, never removed here — retiring one is done in the live editor,
        where the usage counts are.
      </p>
    </div>
  );
}

const FIELD_TYPES = ['text', 'number', 'select', 'checkbox', 'textarea', 'date'];

function FieldsEditor({ payload, onChange, disabled }) {
  const fields = payload.fields || [];
  const set = (patch) => onChange({ ...payload, ...patch });
  const setField = (i, patch) => set({ fields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Fields for <strong>{payload.scope}</strong></p>
      {fields.map((f, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input disabled={disabled} value={f.label} placeholder="Field label"
            onChange={e => setField(i, { label: e.target.value })} className={input} />
          <select disabled={disabled || !f._new} value={f.type} onChange={e => setField(i, { type: e.target.value })} className={input}>
            {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" disabled={disabled} checked={!!f.required}
                onChange={e => setField(i, { required: e.target.checked })} className="rounded border-gray-300" />
              Required
            </label>
            {!disabled && f._new && (
              <button type="button" onClick={() => set({ fields: fields.filter((_, j) => j !== i) })}
                className="p-1 text-gray-400 hover:text-red-500 ml-auto"><X size={14} /></button>
            )}
          </div>
          {f.type === 'select' && (
            <input disabled={disabled} value={(f.options || []).join(', ')} placeholder="Choices, comma-separated"
              onChange={e => setField(i, { options: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
              className={`${input} sm:col-span-3`} />
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => set({ fields: [...fields, { label: '', type: 'text', options: [], required: false, _new: true }] })}
          className="text-xs font-medium text-powder-600 hover:underline">+ Add field</button>
      )}
    </div>
  );
}

export default function LogBuilderStudio() {
  const { user } = useAuth() || {};
  const { data: drafts, refresh } = useApiGet('/log-builder/drafts');
  const { data: sources } = useApiGet('/log-builder/sources');
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startKind, setStartKind] = useState('list');
  const [startSource, setStartSource] = useState('');
  const [startTitle, setStartTitle] = useState('');
  const [error, setError] = useState('');

  const open = (drafts || []).find(d => d.id === openId) || null;
  const isAdmin = user?.role === 'admin';

  const act = async (fn) => {
    setError('');
    try { await fn(); refresh(); } catch (e) { setError(e.message); }
  };

  const start = () => act(async () => {
    const d = await apiPost('/log-builder/drafts', {
      kind: startKind,
      source_key: startSource || undefined,
      title: startTitle || undefined,
    });
    setStarting(false); setStartTitle(''); setStartSource('');
    setOpenId(d.id);
  });

  if (open) {
    const editable = ['draft'].includes(open.status);
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setOpenId(null)} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
          <h3 className="text-base font-semibold text-gray-900">{open.title}</h3>
          <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_CHIP[open.status]}`}>{open.status}</span>
          {open.review_note && <span className="text-xs text-red-700">“{open.review_note}”</span>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          {open.kind === 'list'
            ? <ListEditor payload={open.payload} disabled={!editable}
                onChange={p => act(() => apiPut(`/log-builder/drafts/${open.id}`, { payload: p }))} />
            : <FieldsEditor payload={open.payload} disabled={!editable}
                onChange={p => act(() => apiPut(`/log-builder/drafts/${open.id}`, { payload: p }))} />}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 flex-wrap">
          {open.status === 'draft' && (
            <button onClick={() => act(() => apiPost(`/log-builder/drafts/${open.id}/submit`, {}))}
              className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 inline-flex items-center gap-1">
              <Send size={14} /> Submit for approval
            </button>
          )}
          {open.status === 'submitted' && isAdmin && (
            <>
              <button onClick={() => act(() => apiPost(`/log-builder/drafts/${open.id}/approve`, {}))}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 inline-flex items-center gap-1">
                <ShieldCheck size={14} /> Approve &amp; apply
              </button>
              <button onClick={() => { const r = window.prompt('Why is this rejected?'); if (r) act(() => apiPost(`/log-builder/drafts/${open.id}/reject`, { reason: r })); }}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 inline-flex items-center gap-1">
                <RotateCcw size={14} /> Reject
              </button>
            </>
          )}
          {open.status === 'submitted' && !isAdmin && (
            <p className="text-xs text-gray-500 self-center">Waiting on an admin to approve. Nothing is live yet.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">Log Builder</h2>
          <p className="text-xs text-gray-500">
            Copy an existing list or a log&apos;s fields, edit the copy, and submit it. Nothing goes live until an
            admin approves — existing options are never deleted, only added to or relabelled.
          </p>
        </div>
        <button onClick={() => setStarting(s => !s)}
          className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 inline-flex items-center gap-1 sm:ml-auto">
          <Plus size={15} /> New draft
        </button>
      </div>

      {starting && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">What are you changing?</label>
              <select value={startKind} onChange={e => { setStartKind(e.target.value); setStartSource(''); }} className={input}>
                <option value="list">A dropdown list</option>
                <option value="fields">A log&apos;s extra fields</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {startKind === 'list' ? 'Copy from (or blank for a new list)' : 'Which log *'}
              </label>
              <select value={startSource} onChange={e => setStartSource(e.target.value)} className={input}>
                <option value="">{startKind === 'list' ? '— New empty list —' : '— Pick a log —'}</option>
                {(startKind === 'list' ? (sources?.lists || []).map(l => ({ value: l.key, label: l.label }))
                  : (sources?.scopes || [])).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
              <input value={startTitle} onChange={e => setStartTitle(e.target.value)} placeholder="e.g. Add Break Room to zones" className={input} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={start} disabled={startKind === 'fields' && !startSource}
              className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">Start draft</button>
            <button onClick={() => setStarting(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {(drafts || []).length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">No drafts yet.</p>}
        {(drafts || []).map(d => (
          <button key={d.id} onClick={() => setOpenId(d.id)}
            className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <div className="flex items-baseline gap-2 flex-wrap">
              {d.kind === 'list' ? <ListChecks size={14} className="text-gray-400 self-center" /> : <FormInput size={14} className="text-gray-400 self-center" />}
              <span className="text-sm font-medium text-gray-900">{d.title}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_CHIP[d.status]}`}>{d.status.toUpperCase()}</span>
              {d.status === 'approved' && <Check size={13} className="text-green-600 self-center" />}
              <span className="ml-auto text-xs text-gray-400">{d.created_by} · {formatDateTime(d.created_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
