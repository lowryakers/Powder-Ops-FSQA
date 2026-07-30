import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { Plus, X, ChevronUp, ChevronDown, RotateCcw, List, SlidersHorizontal, AlertTriangle } from 'lucide-react';

// Log Builder — change what a log captures without a deploy.
//
// Two tabs, matching the two things people actually need to change:
//   Lists  — the choices in a dropdown (inspection zones, UOM, statuses)
//   Fields — the questions a log asks
//
// Nothing here deletes. Retiring hides an option or field from new entries
// while every record already filed keeps rendering it, so history stays
// readable — the UI says so out loud, because "delete" is what people expect
// and the difference matters for an audit.

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox (yes/no)' },
  { value: 'date', label: 'Date' },
  { value: 'textarea', label: 'Long text' },
];

const inputCls = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';

/* ── Lists ───────────────────────────────────────────────────────────────── */

function ListEditor() {
  const { data: lists, refresh: refreshLists } = useApiGet('/structure/lists');
  const [activeKey, setActiveKey] = useState(null);
  const key = activeKey || lists?.[0]?.key || null;
  const { data: list, refresh } = useApiGet(key ? `/structure/lists/${key}?all=1` : null, [key]);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const add = async () => {
    const label = adding.trim();
    if (!label || !key) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost(`/structure/lists/${key}/options`, { label });
      setAdding('');
      setMsg({ type: 'success', text: r.revived ? `"${label}" was retired — brought back.` : `Added "${label}".` });
      refresh(); refreshLists();
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setBusy(false); }
  };

  const setOption = async (opt, patch) => {
    await apiPut(`/structure/lists/${key}/options/${opt.id}`, patch);
    refresh(); refreshLists();
  };

  const move = async (i, dir) => {
    const opts = [...(list?.options || [])];
    const j = i + dir;
    if (j < 0 || j >= opts.length) return;
    [opts[i], opts[j]] = [opts[j], opts[i]];
    await apiPost(`/structure/lists/${key}/reorder`, { ids: opts.map(o => o.id) });
    refresh();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      <div className="space-y-1">
        {(lists || []).map(l => (
          <button key={l.key} type="button" onClick={() => setActiveKey(l.key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${l.key === key ? 'bg-powder-50 text-powder-900 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
            {l.label}
            <span className="block text-[11px] text-gray-400">{l.option_count} option{l.option_count === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>

      <div>
        {list && (
          <>
            <div className="mb-2">
              <h4 className="font-semibold text-gray-900 text-sm">{list.label}</h4>
              {list.description && <p className="text-xs text-gray-500 mt-0.5">{list.description}</p>}
            </div>

            {msg && (
              <div className={`mb-2 px-3 py-2 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {msg.text}
              </div>
            )}

            <div className="flex gap-2 mb-3">
              <input value={adding} onChange={e => setAdding(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                placeholder="Add an option…" className={inputCls} />
              <button type="button" onClick={add} disabled={busy || !adding.trim()}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Plus size={14} /> Add
              </button>
            </div>

            <div className="space-y-1">
              {(list.options || []).map((o, i) => (
                <div key={o.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${o.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50'}`}>
                  <input value={o.label} onChange={e => setOption(o, { label: e.target.value })}
                    className={`flex-1 bg-transparent text-sm outline-none ${o.is_active ? 'text-gray-800' : 'text-gray-400 line-through'}`} />
                  {!o.is_active && <span className="text-[10px] font-semibold text-gray-400 uppercase">Retired</span>}
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === (list.options.length - 1)}
                    className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
                  <button type="button" onClick={() => setOption(o, { is_active: !o.is_active })}
                    className={`p-1 ${o.is_active ? 'text-gray-400 hover:text-amber-600' : 'text-gray-400 hover:text-green-600'}`}
                    title={o.is_active ? 'Retire (hides it from new entries; existing records keep it)' : 'Bring back'}>
                    {o.is_active ? <X size={14} /> : <RotateCcw size={14} />}
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-gray-500">
              Retiring hides an option from new entries. Records already filed under it keep showing it, so history stays intact.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Fields ──────────────────────────────────────────────────────────────── */

function FieldEditor() {
  const { data: scopes } = useApiGet('/structure/scopes');
  const { data: lists } = useApiGet('/structure/lists');
  const [activeScope, setActiveScope] = useState(null);
  const scope = activeScope || scopes?.[0]?.scope || null;
  const { data: fields, refresh } = useApiGet(scope ? `/structure/fields/${encodeURIComponent(scope)}?all=1` : null, [scope]);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirmRetire, setConfirmRetire] = useState(null);

  const startNew = () => setDraft({ label: '', type: 'text', options_list_key: '', options: '', required: false, help_text: '' });

  const save = async () => {
    if (!draft?.label.trim()) return;
    try {
      await apiPost(`/structure/fields/${encodeURIComponent(scope)}`, {
        label: draft.label.trim(),
        type: draft.type,
        options_list_key: draft.type === 'select' ? (draft.options_list_key || null) : null,
        options: draft.type === 'select' && !draft.options_list_key
          ? draft.options.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        required: draft.required,
        help_text: draft.help_text.trim() || undefined,
      });
      setDraft(null); setMsg({ type: 'success', text: 'Field added — it appears on the form immediately.' });
      refresh();
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };

  const patch = async (f, body) => { await apiPut(`/structure/fields/${encodeURIComponent(scope)}/${f.id}`, body); refresh(); };

  const move = async (i, dir) => {
    const list = [...(fields || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await apiPost(`/structure/fields/${encodeURIComponent(scope)}/reorder`, { ids: list.map(f => f.id) });
    refresh();
  };

  // Ask the server how many filed records already carry this field before
  // retiring it, so the cost of the decision is visible when it's made.
  const askRetire = async (f) => {
    let count = null;
    try { count = (await apiFetch(`/structure/fields/${encodeURIComponent(scope)}/${f.id}/usage`)).count; } catch { /* best effort */ }
    setConfirmRetire({ field: f, count });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      <div className="space-y-1">
        {(scopes || []).map(s => (
          <button key={s.scope} type="button" onClick={() => { setActiveScope(s.scope); setDraft(null); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${s.scope === scope ? 'bg-powder-50 text-powder-900 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
            {s.label}
            <span className="block text-[11px] text-gray-400">{s.field_count} added field{s.field_count === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>

      <div>
        {msg && (
          <div className={`mb-2 px-3 py-2 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {msg.text}
          </div>
        )}

        <div className="space-y-1.5">
          {(fields || []).length === 0 && !draft && (
            <p className="text-sm text-gray-500 text-center py-4 border border-dashed border-gray-200 rounded-lg">
              No added fields on this log yet. The built-in fields always stay.
            </p>
          )}
          {(fields || []).map((f, i) => (
            <div key={f.id}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${f.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50'}`}>
              <div className="flex-1 min-w-0">
                <input value={f.label} onChange={e => patch(f, { label: e.target.value })}
                  className={`w-full bg-transparent text-sm font-medium outline-none ${f.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`} />
                <span className="text-[11px] text-gray-400">
                  {FIELD_TYPES.find(t => t.value === f.type)?.label || f.type}
                  {f.options_list_key && ` · from list "${lists?.find(l => l.key === f.options_list_key)?.label || f.options_list_key}"`}
                  {f.required && ' · required'}
                  {!f.is_active && ' · retired'}
                </span>
              </div>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === (fields.length - 1)}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
              {f.is_active ? (
                <button type="button" onClick={() => askRetire(f)} className="p-1 text-gray-400 hover:text-amber-600" title="Retire this field"><X size={14} /></button>
              ) : (
                <button type="button" onClick={() => patch(f, { is_active: true })} className="p-1 text-gray-400 hover:text-green-600" title="Bring back"><RotateCcw size={14} /></button>
              )}
            </div>
          ))}
        </div>

        {draft ? (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Field label</label>
                <input autoFocus value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                  className={inputCls} placeholder="e.g. Pallet count" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Type</label>
                <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} className={inputCls}>
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {draft.type === 'select' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">Use a shared list</label>
                  <select value={draft.options_list_key} onChange={e => setDraft(d => ({ ...d, options_list_key: e.target.value }))} className={inputCls}>
                    <option value="">— type choices instead —</option>
                    {(lists || []).map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select>
                </div>
                {!draft.options_list_key && (
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">Choices (comma-separated)</label>
                    <input value={draft.options} onChange={e => setDraft(d => ({ ...d, options: e.target.value }))}
                      className={inputCls} placeholder="Pass, Fail, N/A" />
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={draft.required} onChange={e => setDraft(d => ({ ...d, required: e.target.checked }))} />
                Required
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="button" onClick={save} disabled={!draft.label.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Add field</button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={startNew}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Plus size={14} /> Add field
          </button>
        )}
      </div>

      {confirmRetire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-4">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Retire "{confirmRetire.field.label}"?
            </h4>
            <p className="mt-2 text-sm text-gray-600">
              It stops appearing on new entries.
              {confirmRetire.count > 0
                ? ` ${confirmRetire.count} record${confirmRetire.count === 1 ? '' : 's'} already filed with this field will keep showing it — nothing is deleted.`
                : ' Nothing has been filed with it yet.'}
              {' '}You can bring it back at any time.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmRetire(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button"
                onClick={async () => { await patch(confirmRetire.field, { is_active: false }); setConfirmRetire(null); }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700">Retire field</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

export default function LogBuilderPanel() {
  const [tab, setTab] = useState('lists');
  const tabs = [
    { id: 'lists', label: 'Dropdown Lists', icon: List },
    { id: 'fields', label: 'Log Fields', icon: SlidersHorizontal },
  ];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Log Builder</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Change what a log asks and what its dropdowns offer, without a deploy. Changes take effect immediately.
        </p>
      </div>
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'lists' ? <ListEditor /> : <FieldEditor />}
    </div>
  );
}
