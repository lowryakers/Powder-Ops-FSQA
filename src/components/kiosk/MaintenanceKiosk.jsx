import { useState, useEffect } from 'react';
import { Wrench, CheckCircle, AlertTriangle, X } from 'lucide-react';

const EMPTY = { employee_name: '', asset_tag: '', condition_out: 'Good' };

export default function MaintenanceKiosk() {
  const [form, setForm] = useState(EMPTY);
  const [picked, setPicked] = useState([]);
  const [items, setItems] = useState([]);
  const [out, setOut] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const loadOut = () => fetch('/api/submit/maintenance-out').then(r => r.json()).then(d => setOut(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => {
    fetch('/api/submit/maintenance-items').then(r => r.json()).then(d => setItems(d.items || [])).catch(() => {});
    loadOut();
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const addItem = (name) => { if (name && !picked.includes(name)) setPicked(p => [...p, name]); };
  const removeItem = (name) => setPicked(p => p.filter(x => x !== name));

  const submit = async (e) => {
    e.preventDefault();
    if (!picked.length) { setError('Pick at least one item.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/maintenance-signout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items: picked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data);
      loadOut();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    const created = result.created || [{ record_number: result.record_number, item_description: result.item_description }];
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-3">{created.length === 1 ? 'Tool Signed Out' : `${created.length} Items Signed Out`}</h1>
          <div className="text-left bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4">
            {created.map(c => (
              <div key={c.record_number} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-gray-800">{c.item_description}</span>
                <span className="text-gray-400 font-mono text-xs shrink-0">{c.record_number}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mb-6">Return is completed by QA in the app.</p>
          <button onClick={() => { setResult(null); setPicked([]); setForm({ ...EMPTY, employee_name: form.employee_name }); }}
            className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            Sign Out More
          </button>
        </div>
      </div>
    );
  }

  const available = items.filter(n => !picked.includes(n));

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Wrench size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Sign In/Out</h1>
          <p className="text-sm text-gray-500 mt-1">Sign out one or more items from the tool box</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
            <input required value={form.employee_name} onChange={e => set('employee_name', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Items * <span className="text-gray-400 font-normal">(add as many as you're taking)</span></label>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {picked.map(n => (
                  <span key={n} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 bg-powder-50 border border-powder-200 text-powder-800 rounded-lg text-sm">
                    {n}
                    <button type="button" onClick={() => removeItem(n)} className="p-0.5 hover:bg-powder-100 rounded"><X size={13} /></button>
                  </span>
                ))}
              </div>
            )}
            <select value="" onChange={e => addItem(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base bg-white">
              <option value="">{picked.length ? 'Add another item…' : 'Select an item…'}</option>
              {available.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {picked.length === 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Asset Tag</label>
              <input value={form.asset_tag} onChange={e => set('asset_tag', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Optional" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Condition</label>
            <div className="grid grid-cols-2 gap-2">
              {['Good', 'Bad'].map(c => (
                <button key={c} type="button" onClick={() => set('condition_out', c)}
                  className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${form.condition_out === c ? (c === 'Good' ? 'border-green-500 bg-green-50 text-green-700' : 'border-red-500 bg-red-50 text-red-700') : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-4 bg-powder-600 text-white rounded-xl text-lg font-bold hover:bg-powder-700 disabled:opacity-50 transition-colors active:scale-[0.98]">
            {saving ? 'Saving…' : picked.length > 1 ? `Sign Out ${picked.length} Items` : 'Sign Out'}
          </button>
        </form>

        {out.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-sm font-semibold text-amber-800">
              Currently out ({out.length})
            </div>
            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {out.map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-gray-800 min-w-0 truncate">{o.item_description}</span>
                  <span className="text-gray-400 text-xs shrink-0">{o.record_date}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
