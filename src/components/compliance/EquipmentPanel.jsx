import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Edit2, ChevronUp, ChevronDown, ChevronRight, Search, X, ClipboardList, Download, ArrowLeft, CheckSquare, Square } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';

const TYPES = [
  'A/C', 'Auger', 'Coder', 'Compressor', 'Conveyor', 'Cooler', 'Dehumidifier',
  'Dust Collector', 'Fan', 'Feeder', 'Filler', 'Forklift', 'Forklift Charger',
  'Hand Tool', 'Heat Tunnel', 'HEPA Filter', 'Hydraulic Lift', 'Metal Detector',
  'Mixer', 'Oven', 'Pallet Jack', 'Pallet Wrapper', 'Pump', 'Scale',
  'Scissor Lift', 'Sealer', 'Shop Vac', 'Sifter', 'Tank', 'Tape Machine',
  'Turn Table', 'X-Ray', 'Other'
];

const FREQ_ORDER = ['Daily', 'Bi-weekly', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'As Needed'];
const FREQ_COLORS = {
  Daily: 'border-blue-300 bg-blue-50 text-blue-900',
  Weekly: 'border-purple-300 bg-purple-50 text-purple-900',
  'Bi-weekly': 'border-violet-300 bg-violet-50 text-violet-900',
  Monthly: 'border-amber-300 bg-amber-50 text-amber-900',
  Quarterly: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  'Semi-Annual': 'border-cyan-300 bg-cyan-50 text-cyan-900',
  Annual: 'border-rose-300 bg-rose-50 text-rose-900',
  'As Needed': 'border-gray-300 bg-gray-50 text-gray-800',
};
const FREQ_BADGE = {
  Daily: 'bg-blue-100 text-blue-800',
  Weekly: 'bg-purple-100 text-purple-800',
  'Bi-weekly': 'bg-violet-100 text-violet-800',
  Monthly: 'bg-amber-100 text-amber-800',
  Quarterly: 'bg-emerald-100 text-emerald-800',
  'Semi-Annual': 'bg-cyan-100 text-cyan-800',
  Annual: 'bg-rose-100 text-rose-800',
  'As Needed': 'bg-gray-100 text-gray-700',
};

function parseTasks(eq) {
  try { return JSON.parse(eq.maintenance_tasks || '{}'); } catch { return {}; }
}

function MaintenanceTasksView({ tasks }) {
  const ordered = FREQ_ORDER.filter(f => tasks[f]?.length > 0);
  if (ordered.length === 0) {
    return <p className="text-sm text-gray-400 italic">No maintenance tasks defined</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {ordered.map(freq => (
        <div key={freq} className={`rounded-lg border p-3 ${FREQ_COLORS[freq] || 'border-gray-200 bg-white'}`}>
          <h4 className="text-xs font-bold uppercase tracking-wide mb-2 opacity-80">{freq}</h4>
          <ul className="space-y-1">
            {tasks[freq].map((task, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current opacity-40 shrink-0" />
                {task}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MaintenanceTasksEditor({ tasks, onChange }) {
  const addTask = (freq) => {
    const updated = { ...tasks };
    if (!updated[freq]) updated[freq] = [];
    updated[freq] = [...updated[freq], ''];
    onChange(updated);
  };
  const updateTask = (freq, idx, value) => {
    const updated = { ...tasks, [freq]: tasks[freq].map((t, i) => i === idx ? value : t) };
    onChange(updated);
  };
  const removeTask = (freq, idx) => {
    const items = tasks[freq].filter((_, i) => i !== idx);
    const updated = { ...tasks };
    if (items.length === 0) delete updated[freq];
    else updated[freq] = items;
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-gray-700">Maintenance Tasks by Frequency</label>
      {FREQ_ORDER.map(freq => {
        const items = tasks[freq] || [];
        return (
          <div key={freq} className={`rounded-lg border p-3 ${items.length > 0 ? (FREQ_COLORS[freq] || '') : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold uppercase tracking-wide">{freq}</span>
              <button type="button" onClick={() => addTask(freq)} className="text-xs text-powder-600 hover:text-powder-700 font-medium">+ Add task</button>
            </div>
            {items.map((task, i) => (
              <div key={i} className="flex items-center gap-1 mt-1">
                <input value={task} onChange={e => updateTask(freq, i, e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm bg-white" placeholder={`${freq} task...`} />
                <button type="button" onClick={() => removeTask(freq, i)} className="text-gray-400 hover:text-red-500 p-0.5">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function EquipmentForm({ initial, ccps, onSave, onCancel }) {
  const initTasks = initial ? parseTasks(initial) : {};
  const [form, setForm] = useState(initial || { name: '', type: 'Conveyor', location: '', room: '', asset_id: '', manufacturer: '', model_number: '', serial_number: '', vendor: '', pm_frequency: '', is_food_contact: false, haccp_ccp_id: '', notes: '', maintenance_tasks: {}, task_group: '' });
  const [tasks, setTasks] = useState(initTasks);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, maintenance_tasks: tasks }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center gap-3 mb-1">
        <button type="button" onClick={onCancel} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Back
        </button>
        <h3 className="text-base font-semibold text-gray-900">{initial?.id ? `Edit: ${initial.name}` : 'Add Equipment'}</h3>
      </div>
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
          <label className="block text-xs font-medium text-gray-700 mb-1">PM Assigned To</label>
          <select value={form.task_group || ''} onChange={e => setForm({ ...form, task_group: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Unassigned</option>
            <option value="maintenance">Maintenance</option>
            <option value="warehouse">Warehouse</option>
            <option value="qa">QA</option>
            <option value="cleaning">Cleaning</option>
          </select>
          <p className="text-[10px] text-gray-400 mt-1">Who this equipment's PM tasks go to. Applies to its PM schedules and open work orders.</p>
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

      <MaintenanceTasksEditor tasks={tasks} onChange={setTasks} />

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} placeholder="General notes, observations, or comments..." />
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

function SortHeader({ label, field, sortField, sortDir, onSort, className }) {
  const active = sortField === field;
  return (
    <th className={`text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 ${className || ''}`}
      onClick={() => onSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="inline-flex flex-col leading-none">
          <ChevronUp size={10} className={active && sortDir === 'asc' ? 'text-powder-600' : 'text-gray-300'} />
          <ChevronDown size={10} className={active && sortDir === 'desc' ? 'text-powder-600' : 'text-gray-300'} />
        </span>
      </span>
    </th>
  );
}

function EquipmentDetailRow({ eq, colSpan, onEdit }) {
  const tasks = parseTasks(eq);
  const taskCount = Object.values(tasks).reduce((s, arr) => s + arr.length, 0);

  return (
    <tr className="bg-gray-50">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="max-w-5xl space-y-4">
          {/* Equipment Info Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">{eq.name}</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mt-1">
                {eq.asset_id && <span>Asset #{eq.asset_id}</span>}
                {eq.manufacturer && <span>{eq.manufacturer} {eq.model_number || ''}</span>}
                {eq.serial_number && <span>S/N: {eq.serial_number}</span>}
                {eq.location && <span>{eq.location}{eq.room ? ` — ${eq.room}` : ''}</span>}
                {eq.vendor && <span>Vendor: {eq.vendor}</span>}
              </div>
            </div>
            <button onClick={onEdit} className="px-3 py-1.5 text-xs bg-powder-50 text-powder-700 rounded-lg hover:bg-powder-100 font-medium flex items-center gap-1">
              <Edit2 size={12} /> Edit
            </button>
          </div>

          {/* Maintenance Schedule */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={16} className="text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-800">Preventive Maintenance Schedule</h4>
              {taskCount > 0 && <span className="text-xs text-gray-500">({taskCount} tasks)</span>}
              {eq.task_group && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-powder-100 text-powder-700">{{ maintenance: 'Maintenance', warehouse: 'Warehouse', qa: 'QA', cleaning: 'Cleaning' }[eq.task_group] || eq.task_group}</span>}
            </div>
            <MaintenanceTasksView tasks={tasks} />
          </div>

          {/* Notes */}
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-1">Notes</h4>
            {eq.notes ? (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{eq.notes}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">No notes</p>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

const BULK_FIELDS = [
  { key: 'type', label: 'Type', type: 'select', options: TYPES },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'room', label: 'Room', type: 'text' },
  { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
  { key: 'vendor', label: 'Vendor', type: 'text' },
  { key: 'pm_frequency', label: 'PM Frequency', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['active', 'partial', 'out_of_service'] },
  { key: 'is_food_contact', label: 'Food Contact', type: 'toggle' },
  { key: 'maintenance_tasks', label: 'Maintenance Tasks', type: 'tasks' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

function BulkEditBar({ selected, equipment, onApply, onCancel }) {
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [tasks, setTasks] = useState({});
  const [saving, setSaving] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');

  const fieldDef = BULK_FIELDS.find(f => f.key === field);

  const handleCopyTasks = (eqId) => {
    setCopyFrom(eqId);
    const eq = equipment.find(e => e.id === eqId);
    if (eq) setTasks(parseTasks(eq));
  };

  const handleApply = async () => {
    setSaving(true);
    try {
      const changes = {};
      if (field === 'maintenance_tasks') changes[field] = tasks;
      else if (field === 'is_food_contact') changes[field] = value === 'true';
      else changes[field] = value;
      await onApply(changes);
    } finally { setSaving(false); }
  };

  const selectedNames = equipment.filter(e => selected.has(e.id)).map(e => e.name);

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-powder-500 shadow-2xl z-50 p-4">
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare size={18} className="text-powder-600" />
            <span className="text-sm font-semibold text-gray-900">{selected.size} item{selected.size !== 1 ? 's' : ''} selected</span>
            <div className="flex gap-1 flex-wrap max-w-lg">
              {selectedNames.slice(0, 5).map((n, i) => (
                <span key={i} className="px-2 py-0.5 bg-powder-50 text-powder-700 rounded text-xs">{n}</span>
              ))}
              {selectedNames.length > 5 && <span className="text-xs text-gray-500">+{selectedNames.length - 5} more</span>}
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Field to update</label>
            <select value={field} onChange={e => { setField(e.target.value); setValue(''); setTasks({}); setCopyFrom(''); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[180px]">
              <option value="">Choose field...</option>
              {BULK_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>

          {fieldDef?.type === 'text' && (
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">New value</label>
              <input value={value} onChange={e => setValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={`Enter ${fieldDef.label.toLowerCase()}...`} />
            </div>
          )}

          {fieldDef?.type === 'textarea' && (
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">New value</label>
              <textarea value={value} onChange={e => setValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
            </div>
          )}

          {fieldDef?.type === 'select' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New value</label>
              <select value={value} onChange={e => setValue(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Select...</option>
                {fieldDef.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}

          {fieldDef?.type === 'toggle' && (
            <div className="flex items-center gap-3 py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="bulk-fc" value="true" checked={value === 'true'} onChange={() => setValue('true')} />
                <span className="text-sm">Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="bulk-fc" value="false" checked={value === 'false'} onChange={() => setValue('false')} />
                <span className="text-sm">No</span>
              </label>
            </div>
          )}

          {fieldDef?.type === 'tasks' && (
            <div className="flex-1 min-w-[300px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Copy tasks from existing equipment</label>
              <select value={copyFrom} onChange={e => handleCopyTasks(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2">
                <option value="">Select source equipment...</option>
                {equipment.filter(e => {
                  const t = parseTasks(e);
                  return Object.keys(t).length > 0;
                }).map(e => <option key={e.id} value={e.id}>{e.name} ({e.type})</option>)}
              </select>
              {Object.keys(tasks).length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {FREQ_ORDER.filter(f => tasks[f]?.length).map(f => (
                    <span key={f} className={`px-2 py-0.5 rounded text-xs font-medium ${FREQ_BADGE[f] || 'bg-gray-100'}`}>
                      {f}: {tasks[f].length} tasks
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={handleApply}
            disabled={saving || !field || (fieldDef?.type !== 'tasks' && fieldDef?.type !== 'toggle' && !value) || (fieldDef?.type === 'tasks' && Object.keys(tasks).length === 0) || (fieldDef?.type === 'toggle' && !value)}
            className="px-5 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
            {saving ? 'Applying...' : `Apply to ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EquipmentPanel() {
  const { data: equipment, loading, refresh } = useApiGet('/equipment');
  const { data: ccps } = useApiGet('/haccp');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const locations = useMemo(() => {
    if (!equipment) return [];
    return [...new Set(equipment.map(e => e.location).filter(Boolean))].sort();
  }, [equipment]);

  const statuses = useMemo(() => {
    if (!equipment) return [];
    return [...new Set(equipment.map(e => e.status).filter(Boolean))].sort();
  }, [equipment]);

  const typesInUse = useMemo(() => {
    if (!equipment) return [];
    return [...new Set(equipment.map(e => e.type).filter(Boolean))].sort();
  }, [equipment]);

  const filtered = useMemo(() => {
    if (!equipment) return [];
    let list = [...equipment];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.asset_id || '').toLowerCase().includes(q) ||
        (e.manufacturer || '').toLowerCase().includes(q) ||
        (e.serial_number || '').toLowerCase().includes(q) ||
        (e.model_number || '').toLowerCase().includes(q)
      );
    }
    if (filterType) list = list.filter(e => e.type === filterType);
    if (filterLocation) list = list.filter(e => e.location === filterLocation);
    if (filterStatus) list = list.filter(e => e.status === filterStatus);

    list.sort((a, b) => {
      const av = (a[sortField] || '').toString().toLowerCase();
      const bv = (b[sortField] || '').toString().toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [equipment, search, filterType, filterLocation, filterStatus, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleCreate = async (form) => { await apiPost('/equipment', form); setShowForm(false); refresh(); };
  const handleUpdate = async (form) => { await apiPut(`/equipment/${editing.id}`, form); setEditing(null); refresh(); };
  const hasFilters = search || filterType || filterLocation || filterStatus;
  const clearFilters = () => { setSearch(''); setFilterType(''); setFilterLocation(''); setFilterStatus(''); };

  const toggleExpand = (id) => {
    if (selected.size > 0) return;
    setExpandedId(expandedId === id ? null : id);
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(e => e.id)));
  };

  const handleBulkApply = async (changes) => {
    await apiPost('/equipment/bulk-update', { ids: [...selected], changes });
    setSelected(new Set());
    refresh();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading equipment...</div>;

  const COL_COUNT = 10;
  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0;

  return (
    <div className={`space-y-4 ${someSelected ? 'pb-40' : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Equipment Registry</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{filtered.length} of {(equipment || []).length}</span>
          <button onClick={() => {
            if (!filtered.length) return;
            const taskStr = (eq) => {
              try {
                const t = JSON.parse(eq.maintenance_tasks || '{}');
                return FREQ_ORDER.filter(f => t[f]?.length).map(f => `${f}: ${t[f].join('; ')}`).join(' | ');
              } catch { return ''; }
            };
            exportToCsv(`equipment-registry-${new Date().toISOString().split('T')[0]}.csv`, [
              { label: 'Asset ID', value: r => r.asset_id },
              { label: 'Name', value: r => r.name },
              { label: 'Type', value: r => r.type },
              { label: 'Location', value: r => r.location },
              { label: 'Room', value: r => r.room },
              { label: 'Manufacturer', value: r => r.manufacturer },
              { label: 'Model', value: r => r.model_number },
              { label: 'Serial Number', value: r => r.serial_number },
              { label: 'Vendor', value: r => r.vendor },
              { label: 'PM Frequency', value: r => r.pm_frequency },
              { label: 'Food Contact', value: r => r.is_food_contact ? 'Yes' : 'No' },
              { label: 'Status', value: r => r.status },
              { label: 'Maintenance Tasks', value: taskStr },
              { label: 'Notes', value: r => r.notes },
            ], filtered);
          }} className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
            <Download size={16} /> Export
          </button>
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add Equipment
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Search name, asset ID, manufacturer, serial..." />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">All Types</option>
          {typesInUse.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">All Locations</option>
          {locations.map(l => <option key={l}>{l}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">All Statuses</option>
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="px-2 py-2 text-gray-500 hover:text-gray-700" title="Clear filters">
            <X size={16} />
          </button>
        )}
      </div>

      {(showForm && !editing) && <EquipmentForm ccps={ccps} onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <EquipmentForm initial={editing} ccps={ccps} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      {/* Mobile: card list */}
      <div className="md:hidden space-y-2">
        {filtered.map(eq => {
          const isSelected = selected.has(eq.id);
          const tasks = parseTasks(eq);
          const taskCount = Object.values(tasks).reduce((s, arr) => s + arr.length, 0);
          const stripe = eq.status === 'active' ? 'border-l-green-500' : eq.status === 'partial' ? 'border-l-yellow-500' : 'border-l-red-500';
          return (
            <div key={eq.id} onClick={() => setEditing(eq)}
              className={`bg-white rounded-xl border border-gray-200 border-l-4 ${stripe} p-3 active:bg-gray-50 ${isSelected ? 'ring-2 ring-powder-300' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 text-sm leading-snug">{eq.name}</div>
                  {eq.asset_id && <div className="text-[11px] text-gray-400 font-mono">Asset #{eq.asset_id}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${eq.status === 'active' ? 'bg-green-100 text-green-800' : eq.status === 'partial' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{eq.status}</span>
                  <button onClick={e => { e.stopPropagation(); toggleSelect(eq.id); }} className="text-gray-300 hover:text-powder-600" title={isSelected ? 'Deselect' : 'Select'}>
                    {isSelected ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                {eq.type && <span>{eq.type}</span>}
                {eq.location && <span>{eq.location}</span>}
                {eq.is_food_contact ? <span className="text-blue-700">Food-contact</span> : null}
                {taskCount > 0 && <span className="inline-flex items-center gap-0.5"><ClipboardList size={11} />{taskCount} task{taskCount > 1 ? 's' : ''}</span>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">{hasFilters ? 'No equipment matches your filters' : 'No equipment registered yet'}</div>
        )}
      </div>

      {/* Desktop: full table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="w-10 px-3 py-3">
                  <button onClick={toggleSelectAll} className="text-gray-400 hover:text-powder-600">
                    {allSelected ? <CheckSquare size={16} className="text-powder-600" /> : someSelected ? <CheckSquare size={16} className="text-powder-400" /> : <Square size={16} />}
                  </button>
                </th>
                <th className="w-8 px-1"></th>
                <SortHeader label="Asset #" field="asset_id" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Type" field="type" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Location" field="location" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Manufacturer" field="manufacturer" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                <SortHeader label="Food Contact" field="is_food_contact" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            {filtered.map(eq => {
              const isExpanded = expandedId === eq.id && !someSelected;
              const isSelected = selected.has(eq.id);
              const tasks = parseTasks(eq);
              const taskCount = Object.values(tasks).reduce((s, arr) => s + arr.length, 0);
              return (
                <tbody key={eq.id}>
                  <tr className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${isExpanded ? 'bg-gray-50' : ''} ${isSelected ? 'bg-powder-50' : ''}`}
                    onClick={() => toggleExpand(eq.id)}>
                    <td className="px-3" onClick={e => { e.stopPropagation(); toggleSelect(eq.id); }}>
                      {isSelected ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} className="text-gray-300 hover:text-gray-500" />}
                    </td>
                    <td className="px-1 text-gray-400">
                      {!someSelected && <ChevronRight size={14} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{eq.asset_id || '—'}</td>
                    <td className="px-4 py-3 w-full">
                      <span className="font-medium text-gray-900">{eq.name}</span>
                      {taskCount > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-gray-500">
                          <ClipboardList size={10} />{taskCount}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{eq.type}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{eq.location || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{eq.manufacturer || '—'}</td>
                    <td className="px-4 py-3">
                      {eq.is_food_contact ? <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">Yes</span> : <span className="text-gray-400">No</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${eq.status === 'active' ? 'bg-green-100 text-green-800' : eq.status === 'partial' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                        {eq.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditing(eq); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                        <Edit2 size={14} />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <EquipmentDetailRow eq={eq} colSpan={COL_COUNT}
                      onEdit={() => { setEditing(eq); setShowForm(false); }} />
                  )}
                </tbody>
              );
            })}
            {filtered.length === 0 && (
              <tbody><tr><td colSpan={COL_COUNT} className="px-4 py-8 text-center text-gray-500">
                {hasFilters ? 'No equipment matches your filters' : 'No equipment registered yet'}
              </td></tr></tbody>
            )}
          </table>
        </div>
      </div>

      {someSelected && (
        <BulkEditBar
          selected={selected}
          equipment={equipment}
          onApply={handleBulkApply}
          onCancel={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}
