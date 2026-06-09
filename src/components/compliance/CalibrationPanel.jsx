import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Thermometer, AlertTriangle, CheckCircle } from 'lucide-react';

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800',
  due: 'bg-yellow-100 text-yellow-800',
  overdue: 'bg-red-100 text-red-800',
  out_of_service: 'bg-gray-100 text-gray-600',
  retired: 'bg-gray-100 text-gray-400',
};

function InstrumentForm({ equipment, ccps, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: '', type: 'Thermometer', serial_number: '', manufacturer: '', model: '',
    location: '', equipment_id: '', calibration_frequency: 'monthly', tolerance: '',
    unit_of_measure: '', is_critical_control: false, haccp_ccp_id: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">Add Calibration Instrument</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Line 1 Thermocouple" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {['Thermometer', 'Thermocouple', 'Scale', 'pH Meter', 'Pressure Gauge', 'Flow Meter', 'Hygrometer', 'Metal Detector', 'Other'].map(t =>
              <option key={t}>{t}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Serial Number</label>
          <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manufacturer</label>
          <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Calibration Frequency</label>
          <select value={form.calibration_frequency} onChange={e => setForm({ ...form, calibration_frequency: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual'].map(f =>
              <option key={f} value={f}>{f.replace('_', '-')}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Tolerance</label>
          <input value={form.tolerance} onChange={e => setForm({ ...form, tolerance: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. +/- 1F" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment</label>
          <select value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">None</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">HACCP CCP</label>
          <select value={form.haccp_ccp_id} onChange={e => setForm({ ...form, haccp_ccp_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">None</option>
            {(ccps || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_critical_control} onChange={e => setForm({ ...form, is_critical_control: e.target.checked })} />
            <span className="text-sm text-gray-700">Critical Control Instrument</span>
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Add Instrument'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function CalibrateForm({ instrument, onSave, onCancel }) {
  const [form, setForm] = useState({ calibrated_by: '', result: 'pass', reading_before: '', reading_after: '', standard_used: '', certificate_number: '', next_due: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, instrument_id: instrument.id }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 rounded-lg border border-blue-200 p-3 mt-2 space-y-2">
      <p className="text-sm font-medium text-blue-800">Calibrate: {instrument.name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Calibrated By *</label>
          <input required value={form.calibrated_by} onChange={e => setForm({ ...form, calibrated_by: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Result *</label>
          <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="adjusted_pass">Adjusted & Pass</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Next Due Date</label>
          <input type="date" value={form.next_due} onChange={e => setForm({ ...form, next_due: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reading Before</label>
          <input value={form.reading_before} onChange={e => setForm({ ...form, reading_before: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reading After</label>
          <input value={form.reading_after} onChange={e => setForm({ ...form, reading_after: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Standard Used</label>
          <input value={form.standard_used} onChange={e => setForm({ ...form, standard_used: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Record Calibration'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function CalibrationPanel() {
  const { data: instruments, loading, refresh } = useApiGet('/calibration/instruments');
  const { data: equipment } = useApiGet('/equipment');
  const { data: ccps } = useApiGet('/haccp');
  const { data: records, refresh: refreshRecords } = useApiGet('/calibration/records');
  const [showForm, setShowForm] = useState(false);
  const [calibrating, setCalibrating] = useState(null);
  const [tab, setTab] = useState('instruments');

  const handleCreate = async (form) => {
    await apiPost('/calibration/instruments', form);
    setShowForm(false);
    refresh();
  };

  const handleCalibrate = async (form) => {
    await apiPost('/calibration/records', form);
    setCalibrating(null);
    refresh();
    refreshRecords();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading calibration data...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Calibration Management</h2>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> Add Instrument
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('instruments')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'instruments' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Instruments
        </button>
        <button onClick={() => setTab('records')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'records' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Calibration Records
        </button>
      </div>

      {showForm && <InstrumentForm equipment={equipment} ccps={ccps} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      {tab === 'instruments' && (
        <div className="space-y-2">
          {(instruments || []).map(inst => (
            <div key={inst.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inst.status]}`}>{inst.status}</span>
                    {inst.is_critical_control === 1 && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
                  </div>
                  <h4 className="font-medium text-gray-900">{inst.name}</h4>
                  <p className="text-sm text-gray-500">{inst.type} {inst.serial_number ? `(S/N: ${inst.serial_number})` : ''}</p>
                  <div className="flex gap-4 mt-1 text-xs text-gray-500">
                    <span>Freq: {inst.calibration_frequency}</span>
                    {inst.tolerance && <span>Tolerance: {inst.tolerance}</span>}
                    {inst.last_calibrated && <span>Last: {inst.last_calibrated.split('T')[0]}</span>}
                    {inst.next_due && <span>Next Due: {inst.next_due}</span>}
                    {inst.ccp_name && <span>CCP: {inst.ccp_name}</span>}
                  </div>
                </div>
                <button onClick={() => setCalibrating(calibrating?.id === inst.id ? null : inst)}
                  className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100">
                  Calibrate
                </button>
              </div>
              {calibrating?.id === inst.id && (
                <CalibrateForm instrument={inst} onSave={handleCalibrate} onCancel={() => setCalibrating(null)} />
              )}
            </div>
          ))}
          {(!instruments || instruments.length === 0) && (
            <div className="text-center py-8 text-gray-500">No calibration instruments registered</div>
          )}
        </div>
      )}

      {tab === 'records' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Instrument</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Result</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Before</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">After</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Standard</th>
              </tr>
            </thead>
            <tbody>
              {(records || []).map(r => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{r.instrument_name}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(r.calibrated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.result === 'pass' ? 'bg-green-100 text-green-800' : r.result === 'fail' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {r.result}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.reading_before || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.reading_after || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.calibrated_by}</td>
                  <td className="px-4 py-3 text-gray-600">{r.standard_used || '—'}</td>
                </tr>
              ))}
              {(!records || records.length === 0) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No calibration records yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
