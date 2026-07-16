import { useState, useEffect } from 'react';
import { Wrench, CheckCircle, AlertTriangle } from 'lucide-react';

const EMPTY = { employee_name: '', item_description: '', asset_tag: '', condition_out: 'Good' };

export default function MaintenanceKiosk() {
  const [form, setForm] = useState(EMPTY);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch('/api/submit/maintenance-items').then(r => r.json()).then(d => setItems(d.items || [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/maintenance-signout', {
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
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Tool Signed Out</h1>
          <p className="text-gray-600 mb-1">{form.item_description}</p>
          <p className="text-sm text-gray-500 mb-6">Logged as <span className="font-medium">{result.record_number}</span> — return is completed by QA in the app.</p>
          <button onClick={() => { setResult(null); setForm({ ...EMPTY, employee_name: form.employee_name }); }}
            className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            Sign Out Another
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
            <Wrench size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Sign In/Out</h1>
          <p className="text-sm text-gray-500 mt-1">Sign out a tool from the tool box</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
            <input required value={form.employee_name} onChange={e => set('employee_name', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item *</label>
            <select required value={form.item_description} onChange={e => set('item_description', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base bg-white">
              <option value="">Select a tool…</option>
              {items.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Asset Tag</label>
            <input value={form.asset_tag} onChange={e => set('asset_tag', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Optional" />
          </div>

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
            {saving ? 'Saving…' : 'Sign Out Tool'}
          </button>
        </form>
      </div>
    </div>
  );
}
