import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Droplets, CheckCircle } from 'lucide-react';

const TYPE_LABELS = { pre_op: 'Pre-Op', post_op: 'Post-Op', mid_shift: 'Mid-Shift', deep_clean: 'Deep Clean', emergency: 'Emergency' };
const TYPE_COLORS = { pre_op: 'bg-blue-100 text-blue-800', post_op: 'bg-purple-100 text-purple-800', mid_shift: 'bg-yellow-100 text-yellow-800', deep_clean: 'bg-teal-100 text-teal-800', emergency: 'bg-red-100 text-red-800' };
const RESULT_COLORS = { pass: 'bg-green-100 text-green-800', fail: 'bg-red-100 text-red-800', reclean: 'bg-yellow-100 text-yellow-800' };

function RecordForm({ equipment, chemicals, onSave, onCancel }) {
  const [form, setForm] = useState({
    area: '', type: 'pre_op', equipment_id: '', performed_by: '',
    chemical_id: '', chemicals_used: '', concentration: '', contact_time_minutes: '',
    rinse_verified: false, result: 'pass', atp_reading: '', notes: '',
  });

  const handleChemicalSelect = (chemId) => {
    const chem = (chemicals || []).find(c => c.id === chemId);
    setForm({
      ...form,
      chemical_id: chemId,
      chemicals_used: chem ? chem.name : '',
      concentration: chem?.max_concentration || form.concentration,
      contact_time_minutes: chem?.required_contact_time_minutes || form.contact_time_minutes,
    });
  };
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, contact_time_minutes: form.contact_time_minutes ? parseInt(form.contact_time_minutes) : null, atp_reading: form.atp_reading ? parseFloat(form.atp_reading) : null }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">New Sanitation Record</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Area *</label>
          <input required value={form.area} onChange={e => setForm({ ...form, area: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Room 3, Line 1" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Performed By *</label>
          <input required value={form.performed_by} onChange={e => setForm({ ...form, performed_by: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment</label>
          <select value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">N/A</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Chemical Used</label>
          <select value={form.chemical_id} onChange={e => handleChemicalSelect(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select chemical...</option>
            {(chemicals || []).filter(c => ['sanitizer', 'cleaner', 'degreaser'].includes(c.category)).map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.is_food_grade ? ' (Food Grade)' : ''}</option>
            ))}
            <option value="__other">Other (type manually)</option>
          </select>
          {form.chemical_id === '__other' && (
            <input value={form.chemicals_used} onChange={e => setForm({ ...form, chemicals_used: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" placeholder="Chemical name" />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Concentration</label>
          <input value={form.concentration} onChange={e => setForm({ ...form, concentration: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 200 ppm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contact Time (min)</label>
          <input type="number" value={form.contact_time_minutes} onChange={e => setForm({ ...form, contact_time_minutes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ATP Reading (RLU)</label>
          <input type="number" step="0.1" value={form.atp_reading} onChange={e => setForm({ ...form, atp_reading: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Result *</label>
          <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="reclean">Re-clean Required</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.rinse_verified} onChange={e => setForm({ ...form, rinse_verified: e.target.checked })} />
        <span className="text-sm text-gray-700">Rinse Verified</span>
      </label>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Record'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function SanitationPanel() {
  const { data: records, loading, refresh } = useApiGet('/sanitation');
  const { data: equipment } = useApiGet('/equipment');
  const { data: chemicals } = useApiGet('/chemicals');
  const [showForm, setShowForm] = useState(false);

  const handleCreate = async (form) => {
    await apiPost('/sanitation', form);
    setShowForm(false);
    refresh();
  };

  const handleVerify = async (id) => {
    const name = prompt('Verifier name:');
    if (!name) return;
    await apiPut(`/sanitation/${id}/verify`, { verified_by: name });
    refresh();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading sanitation records...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Sanitation Records</h2>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Record
        </button>
      </div>

      {showForm && <RecordForm equipment={equipment} chemicals={chemicals} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Area</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Equipment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Performed By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Chemical</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ATP</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Result</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Verified</th>
              </tr>
            </thead>
            <tbody>
              {(records || []).map(r => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{r.area}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_COLORS[r.type]}`}>{TYPE_LABELS[r.type]}</span></td>
                  <td className="px-4 py-3 text-gray-600">{r.equipment_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.performed_by}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(r.performed_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{r.chemicals_used || '—'}{r.concentration ? ` (${r.concentration})` : ''}</td>
                  <td className="px-4 py-3 text-gray-600">{r.atp_reading ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RESULT_COLORS[r.result]}`}>{r.result}</span></td>
                  <td className="px-4 py-3">
                    {r.verified_by ? (
                      <span className="text-green-600 text-xs"><CheckCircle size={12} className="inline mr-1" />{r.verified_by}</span>
                    ) : (
                      <button onClick={() => handleVerify(r.id)} className="text-xs text-powder-600 hover:underline">Verify</button>
                    )}
                  </td>
                </tr>
              ))}
              {(!records || records.length === 0) && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No sanitation records yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
