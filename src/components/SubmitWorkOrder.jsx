import { useState, useEffect } from 'react';
import { Shield, CheckCircle, AlertTriangle } from 'lucide-react';

export default function SubmitWorkOrder() {
  const [equipment, setEquipment] = useState([]);
  const [form, setForm] = useState({ equipment_id: '', title: '', description: '', priority: 'normal', submitted_by: '' });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/submit/equipment-list').then(r => r.json()).then(setEquipment).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/submit/work-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Work Order Submitted</h1>
          <p className="text-gray-600 mb-6">Your request has been logged. The maintenance team will review it shortly.</p>
          <button onClick={() => { setSuccess(false); setForm({ equipment_id: '', title: '', description: '', priority: 'normal', submitted_by: '' }); }}
            className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            Submit Another
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
            <Shield size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Submit a Work Order</h1>
          <p className="text-sm text-gray-500 mt-1">Report equipment issues or maintenance needs</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
            <input required value={form.submitted_by} onChange={e => setForm({ ...form, submitted_by: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What's the issue? *</label>
            <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="e.g. Band sealer not heating" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Equipment (optional)</label>
            <select value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base">
              <option value="">Select equipment...</option>
              {equipment.map(eq => (
                <option key={eq.id} value={eq.id}>{eq.name} — {eq.location || eq.type}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Details (optional)</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" rows={3} placeholder="Describe the problem in more detail..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">How urgent?</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'low', label: 'Low', desc: 'When convenient' },
                { value: 'normal', label: 'Normal', desc: 'Standard timing' },
                { value: 'high', label: 'High', desc: 'Needs attention soon' },
                { value: 'critical', label: 'Critical', desc: 'Production stopped' },
              ].map(p => (
                <button key={p.value} type="button" onClick={() => setForm({ ...form, priority: p.value })}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${form.priority === p.value
                    ? p.value === 'critical' ? 'border-red-500 bg-red-50' : p.value === 'high' ? 'border-orange-500 bg-orange-50' : 'border-powder-500 bg-powder-50'
                    : 'border-gray-200 hover:border-gray-300'}`}>
                  <span className="text-sm font-bold block">{p.label}</span>
                  <span className="text-xs text-gray-500">{p.desc}</span>
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
            {saving ? 'Submitting...' : 'Submit Work Order'}
          </button>
        </form>
      </div>
    </div>
  );
}
