// Saved views on the catalogue (R-0645 PR B): a named filter + column set.
//
// Reopening a view sets the catalogue's filters and the grid's open column
// groups to what was saved — nothing else. Your own views and every shared
// one are listed; only the person who saved a view can delete it. The server
// cleans what a view may carry (shared/product-filters.js FILTER_KEYS).

import { useState } from 'react';
import { useApiGet, apiFetch, apiDelete } from '../../hooks/useApi';
import { Bookmark, Trash2, Users } from 'lucide-react';

export default function ProductSavedViews({ current, activeId, onApply }) {
  const { data, refresh } = useApiGet('/products/views');
  const views = data?.views || [];
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState('');
  const active = views.find((v) => v.id === activeId) || null;

  const save = async () => {
    setError('');
    try {
      const r = await apiFetch('/products/views', { method: 'POST', body: { name, shared, filters: current.filters, columns: current.columns } });
      setSaving(false); setName(''); setShared(false);
      refresh();
      onApply?.(r.view);
    } catch (e) { setError(e.message); }
  };
  const remove = async () => {
    if (!active?.mine) return;
    if (!window.confirm(`Delete the saved view "${active.name}"?`)) return;
    setError('');
    try { await apiDelete(`/products/views/${active.id}`); onApply?.(null); refresh(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-saved-views>
      <Bookmark size={15} className="text-gray-400" />
      <select value={activeId || ''} data-saved-view-select aria-label="Saved views"
        onChange={(e) => onApply?.(views.find((v) => v.id === e.target.value) || null)}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white max-w-[16rem]">
        <option value="">Saved views…</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>{v.name}{v.shared ? (v.mine ? ' (shared)' : ` — ${v.owner || 'team'}`) : ''}</option>
        ))}
      </select>
      {active?.mine && (
        <button type="button" onClick={remove} data-saved-view-delete
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-600">
          <Trash2 size={13} /> Delete view
        </button>
      )}
      {!saving ? (
        <button type="button" onClick={() => { setSaving(true); setError(''); }} data-saved-view-new
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium hover:bg-gray-50">Save this view</button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Active wholesale pouches" data-saved-view-name
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs w-56" />
          <label className="inline-flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} data-saved-view-shared className="h-4 w-4 shrink-0" />
            <Users size={12} /> Share with the team
          </label>
          <button type="button" onClick={save} disabled={name.trim().length < 2} data-saved-view-save
            className="px-2.5 py-1.5 rounded-lg bg-powder-600 text-white text-xs font-medium disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setSaving(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </span>
      )}
      {error && <span className="text-xs text-red-700" data-saved-view-error>{error}</span>}
    </div>
  );
}
