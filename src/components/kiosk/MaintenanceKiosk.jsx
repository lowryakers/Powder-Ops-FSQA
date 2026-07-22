import { useState, useEffect } from 'react';
import { Wrench, CheckCircle, AlertTriangle, X } from 'lucide-react';

const EMPTY = { employee_name: '', tool_box: '', asset_tag: '', condition_out: 'Good' };

export default function MaintenanceKiosk() {
  const [form, setForm] = useState(EMPTY);
  // Picked items: [{ name, qty, use_spec }] — use_spec only for chemicals.
  const [picked, setPicked] = useState([]);
  const [catalog, setCatalog] = useState({ groups: [], chemicals: [], use_specs: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch('/api/submit/maintenance-items').then(r => r.json()).then(d => setCatalog({
      groups: d.groups?.length ? d.groups : [{ group: 'Items', items: d.items || [] }],
      chemicals: d.chemicals || [],
      use_specs: d.use_specs || ['Food Contact', 'Non-Food Contact', 'Food Grade', 'Non-Food Grade'],
    })).catch(() => {});
  }, []);

  const isChemical = (name) => catalog.chemicals.includes(name);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const addItem = (name) => { if (name && !picked.some(p => p.name === name)) setPicked(p => [...p, { name, qty: 1, use_spec: '' }]); };
  const patchItem = (name, patch) => setPicked(p => p.map(x => x.name === name ? { ...x, ...patch } : x));
  const removeItem = (name) => setPicked(p => p.filter(x => x.name !== name));

  const submit = async (e) => {
    e.preventDefault();
    if (!picked.length) { setError('Pick at least one item.'); return; }
    const missingSpec = picked.find(p => isChemical(p.name) && !p.use_spec);
    if (missingSpec) { setError(`Pick a use specification for ${missingSpec.name}.`); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/maintenance-signout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items: picked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data);
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
          <h1 className="text-2xl font-bold text-gray-900 mb-3">{created.length === 1 ? 'Item Signed Out' : `${created.length} Items Signed Out`}</h1>
          <div className="text-left bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4">
            {created.map(c => (
              <div key={c.record_number} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-gray-800">{c.qty > 1 ? `${c.qty}× ` : ''}{c.item_description}</span>
                <span className="text-gray-400 font-mono text-xs shrink-0">{c.record_number}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mb-6">Return is completed by QA in the app.</p>
          <button onClick={() => { setResult(null); setPicked([]); setForm({ ...EMPTY, employee_name: form.employee_name, tool_box: form.tool_box }); }}
            className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            Sign Out More
          </button>
        </div>
      </div>
    );
  }

  const pickedNames = picked.map(p => p.name);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Wrench size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Equipment/Tool/Chemical Sign In-Out</h1>
          <p className="text-sm text-gray-500 mt-1">Sign out one or more items — tools, equipment, or chemicals</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
              <input required value={form.employee_name} onChange={e => set('employee_name', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tool Box #</label>
              <input value={form.tool_box} onChange={e => set('tool_box', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="e.g. 2" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Items * <span className="text-gray-400 font-normal">(add as many as you're taking)</span></label>
            {picked.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {picked.map(p => (
                  <div key={p.name} className="rounded-xl border border-powder-200 bg-powder-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 text-sm text-powder-900 font-medium truncate">{p.name}</span>
                      <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                        Qty
                        <input type="number" min="1" value={p.qty}
                          onChange={e => patchItem(p.name, { qty: e.target.value })}
                          className="w-14 px-2 py-1 border border-gray-300 rounded-lg text-sm text-center bg-white" />
                      </label>
                      <button type="button" onClick={() => removeItem(p.name)} className="p-1 text-powder-400 hover:text-red-500 shrink-0"><X size={15} /></button>
                    </div>
                    {isChemical(p.name) && (
                      <select required value={p.use_spec} onChange={e => patchItem(p.name, { use_spec: e.target.value })}
                        className={`mt-1.5 w-full px-3 py-2 border rounded-lg text-sm bg-white ${p.use_spec ? 'border-gray-300' : 'border-amber-400'}`}>
                        <option value="">Use specification (required for chemicals)…</option>
                        {catalog.use_specs.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}
            <select value="" onChange={e => addItem(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base bg-white">
              <option value="">{picked.length ? 'Add another item…' : 'Select an item…'}</option>
              {catalog.groups.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.filter(n => !pickedNames.includes(n)).map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              ))}
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

      </div>
    </div>
  );
}
