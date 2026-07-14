import { useState, useEffect } from 'react';
import { PackageCheck, CheckCircle, AlertTriangle, LogOut, LogIn } from 'lucide-react';

const EMPTY = { direction: 'Out', item_name: '', part_number: '', lot_number: '', qty_pulled: '', person: '' };

export default function ComponentKiosk() {
  const [form, setForm] = useState(EMPTY);
  const [options, setOptions] = useState({ item_names: [], part_numbers: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch('/api/submit/component-options').then(r => r.json()).then(setOptions).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/component-signout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Component Signed {result.direction}</h1>
          <p className="text-gray-600 mb-1">{form.item_name}</p>
          <p className="text-sm text-gray-500 mb-6">Logged as <span className="font-medium">{result.record_number}</span> — awaiting WH/QA review.</p>
          <button onClick={() => { setResult(null); setForm({ ...EMPTY, direction: form.direction, person: form.person }); }}
            className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            Log Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <PackageCheck size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Component Sign In/Out</h1>
          <p className="text-sm text-gray-500 mt-1">Log components pulled from or returned to inventory</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'Out', label: 'Sign Out', desc: 'Pulling from inventory', Icon: LogOut },
                { value: 'In', label: 'Sign In', desc: 'Returning to inventory', Icon: LogIn },
              ].map(d => (
                <button key={d.value} type="button" onClick={() => set('direction', d.value)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${form.direction === d.value ? 'border-powder-500 bg-powder-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <span className="text-sm font-bold flex items-center gap-1.5"><d.Icon size={15} /> {d.label}</span>
                  <span className="text-xs text-gray-500">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
            <input required value={form.person} onChange={e => set('person', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
            <input required list="ck-items" value={form.item_name} onChange={e => set('item_name', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="e.g. Metal detector test wand" />
            <datalist id="ck-items">{options.item_names.map(n => <option key={n} value={n} />)}</datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Part Number</label>
              <input list="ck-parts" value={form.part_number} onChange={e => set('part_number', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Optional" />
              <datalist id="ck-parts">{options.part_numbers.map(n => <option key={n} value={n} />)}</datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Qty</label>
              <input value={form.qty_pulled} onChange={e => set('qty_pulled', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="e.g. 2" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lot Number</label>
            <input value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Optional" />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-4 bg-powder-600 text-white rounded-xl text-lg font-bold hover:bg-powder-700 disabled:opacity-50 transition-colors active:scale-[0.98]">
            {saving ? 'Saving…' : `Sign ${form.direction}`}
          </button>
        </form>
      </div>
    </div>
  );
}
