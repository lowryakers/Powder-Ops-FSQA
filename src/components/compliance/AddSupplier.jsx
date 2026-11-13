import { useState } from 'react';
import { Plus } from 'lucide-react';
import { apiPost } from '../../hooks/useApi';
import { VENDOR_TYPES } from '../../../shared/supplier-fields.js';

// Add a supplier to the register (D-350). It starts unqualified; Quality
// approves it later. A name already on the register is refused by name.
export default function AddSupplier({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', vendor_type: '', actively_using: true, website: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const close = () => { setOpen(false); setError(null); setF({ name: '', vendor_type: '', actively_using: true, website: '', notes: '' }); };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await apiPost('/suppliers', f); const name = f.name.trim(); close(); onCreated?.(name); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-add-supplier
        className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 sm:ml-auto">
        <Plus className="h-4 w-4" /> Add a supplier
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={save} data-add-supplier-form
        className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
        <h3 className="text-base font-semibold">Add a supplier</h3>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs text-slate-500">Name</span>
          <input id="add-supplier-name" value={f.name} onChange={e => set('name', e.target.value)} required autoFocus
            className="w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs text-slate-500">Type</span>
          <select id="add-supplier-type" value={f.vendor_type} onChange={e => set('vendor_type', e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800">
            <option value="">Choose…</option>
            {VENDOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input id="add-supplier-using" type="checkbox" className="h-4 w-4 shrink-0" checked={f.actively_using}
            onChange={e => set('actively_using', e.target.checked)} />
          We buy from this supplier now
        </label>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs text-slate-500">Website (optional)</span>
          <input id="add-supplier-website" value={f.website} onChange={e => set('website', e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs text-slate-500">Notes (optional)</span>
          <textarea id="add-supplier-notes" value={f.notes} onChange={e => set('notes', e.target.value)} rows={2}
            className="w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <p className="text-xs text-slate-500">It starts as not yet qualified. Next: send the questionnaire and attach its documents.</p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">Cancel</button>
          <button type="submit" disabled={busy || !f.name.trim()} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900">
            {busy ? 'Adding…' : 'Add supplier'}
          </button>
        </div>
      </form>
    </div>
  );
}
