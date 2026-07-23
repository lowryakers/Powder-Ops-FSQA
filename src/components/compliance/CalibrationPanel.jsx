import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, AlertTriangle, CheckCircle, Scale, Edit2, Search } from 'lucide-react';

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800',
  due: 'bg-yellow-100 text-yellow-800',
  overdue: 'bg-red-100 text-red-800',
  out_of_service: 'bg-gray-100 text-gray-600',
  retired: 'bg-gray-100 text-gray-400',
};

const TYPES = ['scale', 'Thermometer', 'Thermocouple', 'pH Meter', 'Pressure Gauge', 'Flow Meter', 'Hygrometer', 'Metal Detector', 'Other'];

function InstrumentForm({ initial, ccps, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', type: 'scale', serial_number: '', manufacturer: '', model: '',
    room: '', asset_number: '', max_capacity: '', calibration_frequency: 'annual',
    department: '', notes: '', haccp_ccp_id: null,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Instrument' : 'Add Instrument'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Scale-Light EG5001 #73" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Asset #</label>
          <input value={form.asset_number || ''} onChange={e => setForm({ ...form, asset_number: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Serial Number</label>
          <input value={form.serial_number || ''} onChange={e => setForm({ ...form, serial_number: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manufacturer</label>
          <input value={form.manufacturer || ''} onChange={e => setForm({ ...form, manufacturer: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
          <input value={form.model || ''} onChange={e => setForm({ ...form, model: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Room / Location</label>
          <input value={form.room || ''} onChange={e => setForm({ ...form, room: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Room #4" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
          <select value={form.department || ''} onChange={e => setForm({ ...form, department: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select...</option>
            {['Production', 'Warehouse', 'KITTING', 'QA', 'Maintenance'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max Capacity</label>
          <input value={form.max_capacity || ''} onChange={e => setForm({ ...form, max_capacity: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 500g x 0.01g" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Calibration Frequency</label>
          <select value={form.calibration_frequency} onChange={e => setForm({ ...form, calibration_frequency: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual'].map(f =>
              <option key={f} value={f}>{f.replace('_', ' ')}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">HACCP CCP Link</label>
          <select value={form.haccp_ccp_id || ''} onChange={e => setForm({ ...form, haccp_ccp_id: e.target.value || null })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">None</option>
            {(ccps || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <input value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Add Instrument'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function CalibrateForm({ instrument, onSave, onCancel }) {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const [form, setForm] = useState({
    calibrated_by: '', result: 'pass', reading_before: '', reading_after: '',
    standard_used: '', certificate_number: '', next_due: nextYear.toISOString().split('T')[0], notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, instrument_id: instrument.id }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 rounded-xl border border-blue-200 p-4 mt-3 space-y-3">
      <p className="text-sm font-semibold text-blue-800">Record Calibration: {instrument.name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Calibrated By *</label>
          <input required value={form.calibrated_by} onChange={e => setForm({ ...form, calibrated_by: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Result *</label>
          <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="adjusted_pass">Adjusted & Pass</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Next Calibration Due</label>
          <input type="date" value={form.next_due} onChange={e => setForm({ ...form, next_due: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reading Before</label>
          <input value={form.reading_before} onChange={e => setForm({ ...form, reading_before: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reading After</label>
          <input value={form.reading_after} onChange={e => setForm({ ...form, reading_after: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Standard / Cert #</label>
          <input value={form.standard_used} onChange={e => setForm({ ...form, standard_used: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Record Calibration'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function CalibrationPanel() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'calibration');
  const { data: instruments, loading, refresh } = useApiGet('/calibration/instruments');
  const { data: summary } = useApiGet('/calibration/summary');
  const { data: records, refresh: refreshRecords } = useApiGet('/calibration/records');
  const { data: ccps } = useApiGet('/haccp');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [calibrating, setCalibrating] = useState(null);
  const [tab, setTab] = useState('instruments');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');

  const handleCreate = async (form) => {
    await apiPost('/calibration/instruments', form);
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/calibration/instruments/${editing.id}`, form);
    setEditing(null);
    refresh();
  };

  const handleCalibrate = async (form) => {
    await apiPost('/calibration/records', form);
    setCalibrating(null);
    refresh();
    refreshRecords();
  };

  const filtered = (instruments || []).filter(inst => {
    if (deptFilter !== 'all' && inst.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [inst.name, inst.asset_number, inst.serial_number, inst.model, inst.manufacturer, inst.room, inst.department]
        .some(v => v && v.toLowerCase().includes(q));
    }
    return true;
  });

  const departments = [...new Set((instruments || []).map(i => i.department).filter(Boolean))];
  const today = new Date().toISOString().split('T')[0];

  if (loading) return <div className="text-center py-12 text-gray-500">Loading calibration data...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Calibration Management</h2>
          {summary && summary.overdue > 0 && (
            <p className="text-sm text-red-600 flex items-center gap-1 mt-0.5">
              <AlertTriangle size={14} /> {summary.overdue} instrument{summary.overdue !== 1 ? 's' : ''} overdue for calibration
            </p>
          )}
        </div>
        {canEdit && (
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add Instrument
          </button>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
            <p className="text-xs text-gray-500">Total Instruments</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{summary.current}</p>
            <p className="text-xs text-gray-500">Current</p>
          </div>
          <div className={`rounded-xl border p-3 text-center ${summary.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className={`text-2xl font-bold ${summary.overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>{summary.overdue}</p>
            <p className="text-xs text-gray-500">Overdue</p>
          </div>
          <div className={`rounded-xl border p-3 text-center ${summary.due_soon > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
            <p className={`text-2xl font-bold ${summary.due_soon > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{summary.due_soon}</p>
            <p className="text-xs text-gray-500">Due in 30 Days</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab('instruments')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'instruments' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Scale size={14} /> Instruments ({(instruments || []).length})
        </button>
        <button onClick={() => setTab('records')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'records' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <CheckCircle size={14} /> Calibration Records
        </button>
      </div>

      {(showForm && !editing) && <InstrumentForm ccps={ccps} onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <InstrumentForm initial={editing} ccps={ccps} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      {tab === 'instruments' && (
        <>
          {/* Search + filter bar */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, asset #, serial, model..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            {departments.length > 1 && (
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="all">All Departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {filtered.map(inst => {
              const isOverdue = inst.next_due && inst.next_due < today;
              const stripe = isOverdue ? 'border-l-red-500' : inst.status === 'retired' ? 'border-l-gray-300' : 'border-l-green-500';
              return (
                <div key={inst.id} onClick={() => { setEditing(inst); setShowForm(false); }}
                  className={`bg-white rounded-xl border border-gray-200 border-l-4 ${stripe} p-3 active:bg-gray-50`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 text-sm leading-snug">{inst.manufacturer || 'Instrument'}{inst.model ? ` · ${inst.model}` : ''}</div>
                      {inst.asset_number && <div className="text-[11px] text-gray-400 font-mono">Asset #{inst.asset_number}{inst.serial_number ? ` · SN ${inst.serial_number}` : ''}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inst.status]}`}>{inst.status}</span>
                      <button onClick={e => { e.stopPropagation(); setCalibrating(calibrating?.id === inst.id ? null : inst); }} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100">Calibrate</button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                    {inst.room && <span>{inst.room}</span>}
                    {inst.department && <span>{inst.department}</span>}
                    {inst.max_capacity && <span>Max {inst.max_capacity}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                    {inst.last_calibrated && <span className="text-gray-400">Last {inst.last_calibrated.split('T')[0]}</span>}
                    <span className={isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}>Due {inst.next_due || '—'}{isOverdue ? ' · overdue' : ''}</span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No instruments found</div>}
          </div>

          {/* Desktop: instrument table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Asset #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Serial #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Make</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Model</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Room</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Last Cal.</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Next Due</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Max Capacity</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Dept</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inst => {
                  const isOverdue = inst.next_due && inst.next_due < today;
                  return (
                    <tr key={inst.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isOverdue ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">{inst.asset_number || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{inst.serial_number || 'N/A'}</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{inst.manufacturer || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 w-full">{inst.model || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{inst.room || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{inst.last_calibrated ? inst.last_calibrated.split('T')[0] : '—'}</td>
                      <td className={`px-4 py-3 font-medium ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                        {inst.next_due || '—'}
                        {isOverdue && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{inst.max_capacity || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{inst.department || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inst.status]}`}>
                          {inst.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setCalibrating(calibrating?.id === inst.id ? null : inst)}
                            className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100">
                            Calibrate
                          </button>
                          <button onClick={() => { setEditing(inst); setShowForm(false); }}
                            className="text-gray-400 hover:text-powder-600 p-1">
                            <Edit2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">No instruments found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {calibrating && (
            <CalibrateForm instrument={calibrating} onSave={handleCalibrate} onCancel={() => setCalibrating(null)} />
          )}
        </>
      )}

      {tab === 'records' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Next Due</th>
              </tr>
            </thead>
            <tbody>
              {(records || []).map(r => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium w-full">{r.instrument_name}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{new Date(r.calibrated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.result === 'pass' ? 'bg-green-100 text-green-800' : r.result === 'fail' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {r.result}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.reading_before || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.reading_after || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.calibrated_by}</td>
                  <td className="px-4 py-3 text-gray-600">{r.standard_used || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.next_due || '—'}</td>
                </tr>
              ))}
              {(!records || records.length === 0) && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No calibration records yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
