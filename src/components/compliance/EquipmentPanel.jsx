import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Edit2, X } from 'lucide-react';

const TYPES = [
  'A/C', 'Auger', 'Coder', 'Compressor', 'Conveyor', 'Cooler', 'Dehumidifier',
  'Dust Collector', 'Fan', 'Feeder', 'Filler', 'Forklift', 'Forklift Charger',
  'Hand Tool', 'Heat Tunnel', 'HEPA Filter', 'Hydraulic Lift', 'Metal Detector',
  'Mixer', 'Oven', 'Pallet Jack', 'Pallet Wrapper', 'Pump', 'Scale',
  'Scissor Lift', 'Sealer', 'Shop Vac', 'Sifter', 'Tank', 'Tape Machine',
  'Turn Table', 'X-Ray', 'Other'
];

function EquipmentForm({ initial, ccps, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', type: 'Conveyor', location: '', room: '', asset_id: '', manufacturer: '', model_number: '', serial_number: '', vendor: '', pm_frequency: '', is_food_contact: false, haccp_ccp_id: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Line 1 Conveyor" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Asset ID</label>
          <input value={form.asset_id || ''} onChange={e => setForm({ ...form, asset_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 91" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
          <input value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Production" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Room</label>
          <input value={form.room || ''} onChange={e => setForm({ ...form, room: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Room 3" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manufacturer</label>
          <input value={form.manufacturer || ''} onChange={e => setForm({ ...form, manufacturer: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Midea" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Model #</label>
          <input value={form.model_number || ''} onChange={e => setForm({ ...form, model_number: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. MAP14AS1TWT-C" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Serial Number</label>
          <input value={form.serial_number || ''} onChange={e => setForm({ ...form, serial_number: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
          <input value={form.vendor || ''} onChange={e => setForm({ ...form, vendor: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Uline" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">PM Frequency</label>
          <input value={form.pm_frequency || ''} onChange={e => setForm({ ...form, pm_frequency: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Daily, Weekly, Monthly" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">HACCP CCP Link</label>
          <select value={form.haccp_ccp_id || ''} onChange={e => setForm({ ...form, haccp_ccp_id: e.target.value || null })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">None</option>
            {(ccps || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_food_contact} onChange={e => setForm({ ...form, is_food_contact: e.target.checked })}
              className="rounded border-gray-300" />
            <span className="text-sm text-gray-700">Food-Contact Surface</span>
          </label>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Add Equipment'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function EquipmentPanel() {
  const { data: equipment, loading, refresh } = useApiGet('/equipment');
  const { data: ccps } = useApiGet('/haccp');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleCreate = async (form) => {
    await apiPost('/equipment', form);
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/equipment/${editing.id}`, form);
    setEditing(null);
    refresh();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading equipment...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Equipment Registry</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> Add Equipment
        </button>
      </div>

      {(showForm && !editing) && (
        <EquipmentForm ccps={ccps} onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {editing && (
        <EquipmentForm initial={editing} ccps={ccps} onSave={handleUpdate} onCancel={() => setEditing(null)} />
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Asset #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Manufacturer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden xl:table-cell">Model</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Food Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(equipment || []).map(eq => (
                <tr key={eq.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{eq.asset_id || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{eq.name}</td>
                  <td className="px-4 py-3 text-gray-600">{eq.type}</td>
                  <td className="px-4 py-3 text-gray-600">{eq.location || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{eq.manufacturer || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden xl:table-cell">{eq.model_number || '—'}</td>
                  <td className="px-4 py-3">
                    {eq.is_food_contact ? <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">Yes</span> : <span className="text-gray-400">No</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${eq.status === 'active' ? 'bg-green-100 text-green-800' : eq.status === 'partial' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                      {eq.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setEditing(eq); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                      <Edit2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {(!equipment || equipment.length === 0) && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No equipment registered yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
