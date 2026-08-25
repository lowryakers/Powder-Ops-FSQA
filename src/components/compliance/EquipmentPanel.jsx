import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, Edit2, ChevronUp, ChevronDown, ChevronRight, Search, X, ClipboardList, Download, ArrowLeft, CheckSquare, Square, ShieldCheck, AlertTriangle, Trash2, Link2 } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import EquipmentSetupChecklist from './EquipmentSetupChecklist.jsx';
import SchedulesFromTasksModal, { RepairTaskTextModal, SplitMergedStepsModal } from './SchedulesFromTasksModal.jsx';
import EquipmentFiles, { ManualSearch } from './EquipmentFiles.jsx';
import { MACHINE_TYPES, ZONE_TYPES, defaultAssetKind } from '../../../shared/equipment-types.js';
import { keepCurrent } from '../../lib/selectOptions.js';
import ResyncStepsModal from './ResyncStepsModal.jsx';

// Types come from shared/equipment-types.js so the form, the setup checklist
// and the boot migrations all speak the same vocabulary. The type only sets the
// DEFAULT classification; `asset_kind` and `loto_required` are the columns that
// actually decide what a row is asked for.
const TYPES = [...MACHINE_TYPES, ...ZONE_TYPES];

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
  const [form, setForm] = useState(initial || { name: '', type: 'Conveyor', location: '', room: '', asset_id: '', manufacturer: '', model_number: '', serial_number: '', vendor: '', pm_frequency: '', is_food_contact: false, haccp_ccp_id: '', notes: '', maintenance_tasks: {}, task_group: '', asset_kind: 'machine', loto_required: true, status: 'active' });
  const [tasks, setTasks] = useState(initTasks);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, maintenance_tasks: tasks }); } catch (saveErr) {
      // A refused save must SAY so. This was try/finally with NO catch, so a
      // 403 or a validation 400 cleared the spinner and left the modal sitting
      // there — indistinguishable from a dead button, which is how a
      // deliberate rule reads as a broken screen.
      window.alert(saveErr.message);
    } finally { setSaving(false); }
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
          {/* Grouped so the area types are visibly a different sort of thing —
              and PRESENT at all: they were missing from this list, so opening a
              BPG zone here and saving silently retyped it as the first option. */}
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, asset_kind: defaultAssetKind(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <optgroup label="Equipment">
              {MACHINE_TYPES.map(t => <option key={t}>{t}</option>)}
            </optgroup>
            <optgroup label="Areas & zones">
              {ZONE_TYPES.map(t => <option key={t}>{t}</option>)}
            </optgroup>
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
          {/* Built from PM_ASSIGNEES — this select used to carry its own
              hardcoded copy of four teams, which is how "assign the forklift
              to Batching" stayed impossible after the shared list gained the
              production teams. One list, both forms. */}
          <select value={form.task_group || ''} onChange={e => setForm({ ...form, task_group: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Unassigned</option>
            {keepCurrent(PM_ASSIGNEES, form.task_group).map(t => <option key={t} value={t}>{TEAM_LABEL[t] || t}</option>)}
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
        <div>
          {/* Status was on the list but not in this form, so the only way to
              retire a machine was bulk edit. Out of service also stops it
              generating new PM tasks, which is the point of retiring it. */}
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="active">Active</option>
            <option value="partial">Partially operational</option>
            <option value="out_of_service">Out of service</option>
          </select>
          {form.status && form.status !== 'active' && (
            <p className="text-[11px] text-gray-500 mt-1">
              No new PM tasks are generated while this is not active. Open tasks stay open.
            </p>
          )}
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_food_contact} onChange={e => setForm({ ...form, is_food_contact: e.target.checked })}
              className="rounded border-gray-300" />
            <span className="text-sm text-gray-700">Food-Contact Surface</span>
          </label>
        </div>
      </div>

      {/* The two classifications that decide what this row is asked for.
          They are columns, not guesses from the type — the type only sets the
          default above, and either can be corrected here. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">This record is</label>
          <select value={form.asset_kind || defaultAssetKind(form.type)}
            onChange={e => setForm({ ...form, asset_kind: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="machine">Equipment — operated, maintained, locked out</option>
            <option value="zone">Area or zone — inspected and cleaned on a schedule</option>
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            A zone is scheduled and inspected. It isn&apos;t asked for a lockout procedure, a training
            course or a work instruction.
          </p>
        </div>
        <div className="flex flex-col justify-start">
          <label className="block text-xs font-medium text-gray-700 mb-1">Lockout / tagout</label>
          <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <input type="checkbox"
              checked={(form.asset_kind || defaultAssetKind(form.type)) === 'zone' ? false : form.loto_required !== 0 && form.loto_required !== false}
              disabled={(form.asset_kind || defaultAssetKind(form.type)) === 'zone'}
              onChange={e => setForm({ ...form, loto_required: e.target.checked })}
              className="rounded border-gray-300" />
            <span className="text-gray-700">Needs a LOTO procedure</span>
          </label>
          <p className="text-[11px] text-gray-500 mt-1">
            On by default, because the safe mistake is asking. Drives the LOTO coverage badge and the
            setup checklist.
          </p>
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

function EquipmentDetailRow({ eq, colSpan, onEdit, canEditFiles }) {
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
              {eq.task_group && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-powder-100 text-powder-700">{TEAM_LABEL[eq.task_group] || eq.task_group}</span>}
            </div>
            <MaintenanceTasksView tasks={tasks} />
          </div>

          {/* What this machine still needs. Deliberately on EVERY row, not only
              on newly-added equipment — the hundred pieces already in the system
              are the ones most likely to be missing something. */}
          <EquipmentSetupChecklist equipmentId={eq.id} />

          <EquipmentFiles equipmentId={eq.id} equipmentName={eq.name} canEdit={canEditFiles} />

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

// How many setup steps this machine still owes, from /equipment/readiness.
// Only ever shown when something is missing — a chip on every row saying
// "0 missing" is noise, and the absence of the chip is the good news.
function SetupGapChip({ counts, onClick, className = '' }) {
  if (!counts || !counts.blocking) return null;
  const label = `${counts.blocking} setup step${counts.blocking === 1 ? '' : 's'} needed`;
  if (!onClick) {
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 whitespace-nowrap ${className}`}>{label}</span>;
  }
  return (
    <button type="button" onClick={onClick} title="What this equipment still needs"
      className={`px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap ${className}`}>
      {label}
    </button>
  );
}

// `task_group` is who this equipment's PM work goes to. Reassigning a whole
// department's kit one row at a time is exactly what bulk edit is for, and the
// server already accepted the field and propagated it to the PM schedules and
// open work orders (syncTaskGroupToPM) — only the picker was missing.
// Every team that owns recurring PM work. Batching runs the PM on the
// forklift that lives in the production room — a list without them meant the
// machine could only ever be assigned to Warehouse, who never touch it.
const PM_ASSIGNEES = ['maintenance', 'warehouse', 'qa', 'cleaning', 'batching', 'kitting', 'filling'];
const TEAM_LABEL = { maintenance: 'Maintenance', warehouse: 'Warehouse', qa: 'QA', cleaning: 'Cleaning', batching: 'Batching', kitting: 'Kitting', filling: 'Filling' };

const BULK_FIELDS = [
  { key: 'type', label: 'Type', type: 'select', options: TYPES },
  { key: 'task_group', label: 'PM Assigned To', type: 'select', options: PM_ASSIGNEES },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'room', label: 'Room', type: 'text' },
  { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
  { key: 'vendor', label: 'Vendor', type: 'text' },
  { key: 'pm_frequency', label: 'PM Frequency', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['active', 'partial', 'out_of_service'] },
  { key: 'is_food_contact', label: 'Food Contact', type: 'toggle' },
  // Reclassifying a batch of rows in one go is exactly what this is for — the
  // 39 zones were classified by a one-time backfill, and correcting a wrong one
  // shouldn't mean opening 39 forms.
  { key: 'asset_kind', label: 'Equipment or Area', type: 'select', options: ['machine', 'zone'] },
  { key: 'loto_required', label: 'Needs LOTO', type: 'toggle' },
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
      else if (field === 'is_food_contact' || field === 'loto_required') changes[field] = value === 'true';
      else changes[field] = value;
      await onApply(changes);
    } finally { setSaving(false); }
  };

  const selectedNames = equipment.filter(e => selected.has(e.id)).map(e => e.name);

  return (
    <div className="fixed bottom-14 md:bottom-0 left-0 right-0 bg-white border-t-2 border-powder-500 shadow-2xl z-50 p-4 safe-area-bottom">
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

// HACCP CCP definitions: name, hazard, critical limits, monitoring and
// corrective action — plus how many equipment items / calibration instruments
// are linked as monitoring evidence (links are set on the equipment form and
// the calibration instrument form). Feeds the Critical Tracking CCP card.
const CCP_FIELDS = [
  ['name', 'CCP Name *', 'e.g. CCP 1 — Metal Detection'],
  ['hazard_type', 'Hazard Type', 'e.g. Physical — metal fragments'],
  ['critical_limits', 'Critical Limits *', 'e.g. Fe 1.5mm / NonFe 2.0mm / SS 2.5mm test pieces rejected'],
  ['monitoring_procedure', 'Monitoring Procedure *', 'e.g. Pass all 3 test pieces at startup, every 2h, and end of run'],
  ['monitoring_frequency', 'Monitoring Frequency', 'e.g. Startup + every 2 hours'],
  ['corrective_action', 'Corrective Action *', 'e.g. Stop line, hold back to last good check, notify QA'],
  ['verification_procedure', 'Verification', 'e.g. QA reviews detector log daily'],
  ['record_keeping_requirements', 'Records', 'e.g. Metal detector log, calibration certificates'],
];

function CcpManager({ ccps, equipment, onClose, onChanged }) {
  const [editing, setEditing] = useState(null); // null | {} (new) | ccp row
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const linkedCount = (id) => (equipment || []).filter(e => e.haccp_ccp_id === id).length;

  const open = (ccp) => { setEditing(ccp || {}); setForm(ccp || {}); setError(null); };
  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (editing?.id) await apiPut(`/haccp/${editing.id}`, form);
      else await apiPost('/haccp', form);
      setEditing(null); onChanged();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck size={18} className="text-powder-600" /> HACCP Critical Control Points</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {!editing && (
            <>
              {(ccps || []).length === 0 && (
                <p className="text-sm text-gray-500">No CCPs defined yet. Add each Critical Control Point from your HACCP plan, then link its monitoring equipment (Equipment form → HACCP CCP Link) and instruments (Calibration → instrument form).</p>
              )}
              {(ccps || []).map(c => (
                <div key={c.id} className="border border-gray-200 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.hazard_type || 'hazard not set'} · limits: {c.critical_limits || '—'}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{linkedCount(c.id)} equipment linked</p>
                  </div>
                  <button onClick={() => open(c)} className="p-1.5 text-gray-400 hover:text-powder-600 rounded" data-tip="Edit CCP"><Edit2 size={14} /></button>
                </div>
              ))}
              <button onClick={() => open(null)}
                className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
                <Plus size={16} /> Add CCP
              </button>
            </>
          )}
          {editing && (
            <div className="space-y-3">
              {CCP_FIELDS.map(([key, label, ph]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                  {['critical_limits', 'monitoring_procedure', 'corrective_action'].includes(key) || key.startsWith('verification') || key.startsWith('record') ? (
                    <textarea value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={ph} />
                  ) : (
                    <input value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={ph} />
                  )}
                </div>
              ))}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(null)} className="px-4 py-2 text-gray-600 text-sm font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={save} disabled={saving || !form.name}
                  className="px-5 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-40">
                  {saving ? 'Saving…' : editing.id ? 'Update CCP' : 'Add CCP'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EquipmentPanel() {
  const { data: equipment, loading, refresh } = useApiGet('/equipment');
  const { data: ccps, refresh: refreshCcps } = useApiGet('/haccp');
  // One request for the whole list, not one per row: "what is this machine
  // missing" is worth seeing before you decide which row to open.
  const { data: readiness } = useApiGet('/equipment/readiness');
  const { data: fromTasks, refresh: refreshFromTasks } = useApiGet('/equipment/schedules-from-tasks/preview');
  const { data: textRepair, refresh: refreshTextRepair } = useApiGet('/equipment/maintenance-tasks/repair/preview');
  const { data: stepSplit, refresh: refreshStepSplit } = useApiGet('/pm/schedules/step-split/preview');
  const { data: stepsOutOfStep, refresh: refreshStepsOutOfStep } = useApiGet('/equipment/procedure-steps/resync/preview');
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'equipment');
  const canCcp = !!user && (['admin', 'supervisor'].includes(user.role) || user.department === 'qa');
  const [showCcps, setShowCcps] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [justAdded, setJustAdded] = useState(null);
  const [buildSchedules, setBuildSchedules] = useState(false);
  const [manualSearch, setManualSearch] = useState(false);
  const [repairText, setRepairText] = useState(false);
  const [splitSteps, setSplitSteps] = useState(false);
  const [resyncSteps, setResyncSteps] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const { data: review, refresh: refreshReview } = useApiGet('/equipment/registry-review');

  // The server refuses a machine with compliance history and says why; the
  // dialog relays that rather than a generic failure, because "set it Out of
  // service instead" is the actual next step.
  const handleDeleteEquipment = async (eq) => {
    if (!window.confirm(`Delete "${eq.name}"${eq.asset_id ? ` (asset ${eq.asset_id})` : ''}? This is for rows added twice or typed wrong.`)) return;
    try {
      await apiFetch(`/equipment/${eq.id}`, { method: 'DELETE' });
      refresh(); refreshReview();
    } catch (e) { alert(e.message); }
  };
  const [selected, setSelected] = useState(new Set());

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  // 39 of the 183 rows are areas rather than machines, which is legitimate but
  // makes "show me the equipment" a different question from "show me the
  // registry". Nothing is hidden by default — a filter people can see is
  // honest, a list quietly missing a fifth of its rows is not.
  const [filterKind, setFilterKind] = useState('');
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
    if (filterKind) list = list.filter(e => (e.asset_kind || 'machine') === filterKind);
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
  }, [equipment, search, filterKind, filterType, filterLocation, filterStatus, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Adding equipment is the START of a chain — a PM schedule, a team to own it,
  // LOTO, a course, the work instruction. None of that used to be mentioned
  // anywhere, so a machine went in and the PM schedule turned up months later
  // when somebody noticed the task list was thin. The create response carries
  // the checklist, and we put it straight in front of whoever just saved.
  const handleCreate = async (form) => {
    const created = await apiPost('/equipment', form);
    setShowForm(false);
    refresh();
    if (created?.id) {
      setJustAdded(created);
      setExpandedId(created.id);
    }
  };
  const handleUpdate = async (form) => { await apiPut(`/equipment/${editing.id}`, form); setEditing(null); refresh(); };
  const hasFilters = search || filterKind || filterType || filterLocation || filterStatus;
  const clearFilters = () => { setSearch(''); setFilterKind(''); setFilterType(''); setFilterLocation(''); setFilterStatus(''); };

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
              { label: 'Record Type', value: r => (r.asset_kind === 'zone' ? 'Area / zone' : 'Equipment') },
              { label: 'Needs LOTO', value: r => (r.loto_required === 0 ? 'No' : 'Yes') },
              { label: 'Status', value: r => r.status },
              { label: 'Maintenance Tasks', value: taskStr },
              { label: 'Notes', value: r => r.notes },
            ], filtered);
          }} className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
            <Download size={16} /> Export
          </button>
          {canCcp && (
            <button onClick={() => setShowCcps(true)}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200" data-tip="Define HACCP CCPs and their monitoring evidence">
              <ShieldCheck size={16} /> Manage CCPs
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setShowForm(true); setEditing(null); }}
              className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
              <Plus size={16} /> Add Equipment
            </button>
          )}
        </div>
      </div>

      {showCcps && <CcpManager ccps={ccps} equipment={equipment} onClose={() => setShowCcps(false)} onChanged={refreshCcps} />}

      {/* Search and Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Search name, asset ID, manufacturer, serial..." />
        </div>
        <select value={filterKind} onChange={e => setFilterKind(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" title="Equipment or areas">
          <option value="">Equipment &amp; areas</option>
          <option value="machine">Equipment only</option>
          <option value="zone">Areas &amp; zones only</option>
        </select>
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

      {/* Searching inside the manuals is a cross-machine question ("which
          filter does the auger take?"), so it lives on the list, not on a row. */}
      <div>
        <button onClick={() => setManualSearch(v => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-powder-700 hover:underline">
          <Search size={12} /> {manualSearch ? 'Hide manual search' : 'Search inside the manuals'}
        </button>
        {manualSearch && <div className="mt-2"><ManualSearch /></div>}
      </div>

      {/* An import split these sentences at their commas, so a single task
          reads as several — many of them single words. Offered as a reviewed
          repair because it rewrites a maintenance procedure. */}
      {!!textRepair?.total_machines && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 flex-wrap">
          <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-red-900">
              {textRepair.total_machines} machine{textRepair.total_machines === 1 ? '' : 's'} have maintenance tasks split mid-sentence
            </h3>
            <p className="text-xs text-red-800">
              An import broke these at their commas, so one task reads as several — many of them single
              words like &ldquo;leaks&rdquo;. {textRepair.total_joined} fragments can be put back into the original wording.
            </p>
          </div>
          <button onClick={() => setRepairText(true)}
            className="shrink-0 px-3 py-2 bg-white border border-red-300 text-red-900 rounded-lg text-sm font-medium hover:bg-red-100">
            Review and repair
          </button>
        </div>
      )}

      {repairText && (
        <RepairTaskTextModal onClose={() => setRepairText(false)} onDone={() => { refresh(); refreshTextRepair(); refreshFromTasks(); }} />
      )}

      {/* A schedule's steps are a COPY of the machine's written tasks for that
          cadence. A bug used to write EVERY cadence into EVERY schedule, so a
          daily task of 11 items reached the floor as 39 lines including the
          annual work. The cause is fixed; these were flattened before that. */}
      {!!stepsOutOfStep?.extra_schedules && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 flex-wrap">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-amber-900">
              {stepsOutOfStep.extra_schedules} PM checklist{stepsOutOfStep.extra_schedules === 1 ? '' : 's'} carry steps from other frequencies
            </h3>
            <p className="text-xs text-amber-800">
              Across {stepsOutOfStep.extra_machines} machine{stepsOutOfStep.extra_machines === 1 ? '' : 's'} — a daily check
              asking for the annual work, so the operator sees a far longer list than the Equipment list shows.
              Re-syncing puts each schedule back to the tasks written under its own frequency.
            </p>
          </div>
          <button onClick={() => setResyncSteps(true)}
            className="shrink-0 px-3 py-2 bg-white border border-amber-300 text-amber-900 rounded-lg text-sm font-medium hover:bg-amber-100">
            Review and re-sync
          </button>
        </div>
      )}

      {resyncSteps && (
        <ResyncStepsModal onClose={() => setResyncSteps(false)}
          onDone={() => { refresh(); refreshStepsOutOfStep(); refreshStepSplit(); }} />
      )}

      {/* A whole written procedure pasted into one schedule: the weekly task
          asks for the annual load test too. The count that matters is the open
          tasks, because those are the checklists people are working from now. */}
      {!!stepSplit?.total && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 flex-wrap">
          <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-red-900">
              {stepSplit.total} PM checklist{stepSplit.total === 1 ? '' : 's'} ask for several frequencies at once
            </h3>
            <p className="text-xs text-red-800">
              A weekly task is handing the technician the monthly, quarterly and annual steps as well — so most
              of the list is work that isn&apos;t due, and the ticks stop meaning anything.
              {stepSplit.actionable > 0 && ` Splitting ${stepSplit.actionable} would remove ${stepSplit.total_steps_removed} steps that don't belong and create ${stepSplit.total_new_schedules} schedule${stepSplit.total_new_schedules === 1 ? '' : 's'} at the right cadence.`}
              {stepSplit.needs_a_look > 0 && ` ${stepSplit.needs_a_look} need a person to decide.`}
            </p>
          </div>
          <button onClick={() => setSplitSteps(true)}
            className="shrink-0 px-3 py-2 bg-white border border-red-300 text-red-900 rounded-lg text-sm font-medium hover:bg-red-100">
            Review and split
          </button>
        </div>
      )}

      {splitSteps && (
        <SplitMergedStepsModal onClose={() => setSplitSteps(false)} onDone={() => { refresh(); refreshStepSplit(); refreshFromTasks(); }} />
      )}

      {/* Duplicates and the instrument overlap. Shown only when there is
          something to act on — a banner that is always there is wallpaper. */}
      {!!(review?.duplicates?.length || review?.linkable) && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-start gap-3 flex-wrap">
          <Link2 size={18} className="text-sky-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-sky-900">
              {review.duplicates.length > 0 && `${review.duplicates.length} duplicate row${review.duplicates.length === 1 ? '' : 's'}`}
              {review.duplicates.length > 0 && review.linkable > 0 && ' · '}
              {review.linkable > 0 && `${review.linkable} instrument${review.linkable === 1 ? '' : 's'} are the same object as a machine here`}
            </h3>
            <p className="text-xs text-sky-800">
              A repeated name is usually several real machines; a repeated name AND asset number is one row twice.
              Calibration instruments match this list by asset number, not by name.
            </p>
          </div>
          <button onClick={() => setShowReview(true)}
            className="shrink-0 px-3 py-2 bg-white border border-sky-300 text-sky-900 rounded-lg text-sm font-medium hover:bg-sky-100">
            Review
          </button>
        </div>
      )}

      {showReview && review && (
        <RegistryReviewModal review={review} onClose={() => setShowReview(false)}
          onDone={() => { refresh(); refreshReview(); }} />
      )}

      {/* The plant wrote maintenance tasks expecting them to BE the PM schedule.
          They never were, so this offers the one-pass fix — reviewed, never
          automatic. Only shown while there is actually something to create. */}
      {!!fromTasks?.total_machines && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 flex-wrap">
          <ClipboardList size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-amber-900">
              {fromTasks.total_machines} machine{fromTasks.total_machines === 1 ? '' : 's'} have maintenance tasks that generate nothing
            </h3>
            <p className="text-xs text-amber-800">
              The tasks are written on the equipment record, but no recurring schedule turns them into work.
              Creating {fromTasks.total_schedules} schedule{fromTasks.total_schedules === 1 ? '' : 's'} would put them in Task Center, using the tasks exactly as written.
            </p>
          </div>
          <button onClick={() => setBuildSchedules(true)}
            className="shrink-0 px-3 py-2 bg-white border border-amber-300 text-amber-900 rounded-lg text-sm font-medium hover:bg-amber-100">
            Review and create
          </button>
        </div>
      )}

      {buildSchedules && (
        <SchedulesFromTasksModal onClose={() => setBuildSchedules(false)} onDone={() => { refresh(); refreshFromTasks(); }} />
      )}

      {justAdded && (
        <div className="bg-powder-50 border border-powder-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">{justAdded.name} added</h3>
              <p className="text-xs text-gray-600">
                It won&apos;t generate any maintenance, training or documents on its own. Here&apos;s what it still needs —
                you can do it now or come back to this list from the equipment row any time.
              </p>
            </div>
            <button onClick={() => setJustAdded(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white shrink-0" title="Dismiss">
              <X size={16} />
            </button>
          </div>
          <EquipmentSetupChecklist equipmentId={justAdded.id} initial={justAdded.readiness} />
        </div>
      )}

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
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                {eq.type && <span>{eq.type}</span>}
                {eq.location && <span>{eq.location}</span>}
                {eq.is_food_contact ? <span className="text-blue-700">Food-contact</span> : null}
                {taskCount > 0 && <span className="inline-flex items-center gap-0.5"><ClipboardList size={11} />{taskCount} task{taskCount > 1 ? 's' : ''}</span>}
                {/* The card itself opens the edit form, so the chip has to stop
                    the click or you can never read the checklist on a phone. */}
                <SetupGapChip counts={readiness?.[eq.id]}
                  onClick={e => { e.stopPropagation(); setExpandedId(expandedId === eq.id ? null : eq.id); }} />
              </div>
              {expandedId === eq.id && (
                <div onClick={e => e.stopPropagation()} className="mt-2 pt-2 border-t border-gray-100">
                  <EquipmentSetupChecklist equipmentId={eq.id} compact />
                </div>
              )}
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
                      {/* Plain text, not a button — the row already expands to
                          the checklist, and a button inside a clickable row is
                          two targets doing one job. */}
                      <SetupGapChip counts={readiness?.[eq.id]} className="ml-2" />
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
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditing(eq); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                          <Edit2 size={14} />
                        </button>
                        {canEdit && (
                          <button onClick={() => handleDeleteEquipment(eq)}
                            className="text-gray-300 hover:text-red-600" data-tip="Delete this row">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <EquipmentDetailRow eq={eq} colSpan={COL_COUNT} canEditFiles={canEdit}
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

/**
 * What the two registries actually contain — the three numbers kept apart.
 *
 * The temptation is to call every repeated name a duplicate and offer to merge.
 * On this plant's data that would have proposed collapsing ten A/C units into
 * one. So: true duplicates (name AND asset) get a delete, same-name-different-
 * asset is reported as information only, and the instrument overlap gets a
 * LINK — never a merge, because an instrument row holds tolerance, capacity
 * and a due date that no equipment row has anywhere to put.
 */
function RegistryReviewModal({ review, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const linkable = (review.cross || []).filter(m => !m.already_linked);
  const selected = picked === null ? new Set(linkable.map(m => m.instrument.id)) : picked;

  const linkNow = async () => {
    setBusy(true);
    try {
      await apiPost('/equipment/registry-review/link', {
        pairs: linkable.filter(m => selected.has(m.instrument.id))
          .map(m => ({ instrument_id: m.instrument.id, equipment_id: m.equipment.id })),
      });
      onDone(); onClose();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Equipment &amp; instruments — what is actually duplicated</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {review.equipment_count} equipment rows · {review.instrument_count} calibration instruments
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-red-700">
              Same row twice ({review.duplicates.length})
            </h4>
            <p className="text-[11px] text-gray-500 mb-1.5">Same name AND same asset number — delete the extras from the list below.</p>
            {review.duplicates.length === 0
              ? <p className="text-xs text-gray-400">None.</p>
              : review.duplicates.map(d => (
                <p key={`${d.name}|${d.asset}`} className="text-xs text-gray-800">
                  • <span className="font-medium">{d.name}</span> — asset {d.asset} × {d.rows.length}
                </p>
              ))}
          </section>

          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-600">
              Same name, different machines ({review.same_name.length})
            </h4>
            <p className="text-[11px] text-gray-500 mb-1.5">
              Not duplicates — each has its own asset number. Worth renaming only if a task list reads ambiguously.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {review.same_name.map(g => (
                <span key={g.name} className="px-2 py-0.5 rounded bg-gray-100 text-[11px] text-gray-700">
                  {g.name} ×{g.count}
                </span>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-sky-700">
              The same object in both lists ({review.cross.length})
            </h4>
            <p className="text-[11px] text-gray-500 mb-1.5">
              Matched by asset number — the names differ, which is why nothing ever connected them.
              Linking keeps both rows: the instrument keeps its tolerance and due date, the machine keeps its schedules.
            </p>
            {review.cross.map(m => (
              <label key={m.instrument.id} className="flex items-center gap-2 text-xs text-gray-800 py-0.5">
                <input type="checkbox" disabled={m.already_linked}
                  checked={m.already_linked || selected.has(m.instrument.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(m.instrument.id)) next.delete(m.instrument.id); else next.add(m.instrument.id);
                    setPicked(next);
                  }}
                  className="rounded border-gray-300" />
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{m.instrument.name}</span>
                  <span className="text-gray-400"> ↔ </span>
                  <span>{m.equipment.name}</span>
                  <span className="text-gray-400"> · asset {m.equipment.asset}</span>
                  {m.already_linked && <span className="text-green-700 font-medium"> · linked</span>}
                </span>
              </label>
            ))}
            {review.cross_unmatched.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">
                {review.cross_unmatched.length} instrument{review.cross_unmatched.length === 1 ? ' is' : 's are'} not
                in the equipment list at all — reference weights and hand-held gauges live only in Calibration, which is correct.
              </p>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Close</button>
          {linkable.length > 0 && (
            <button onClick={linkNow} disabled={busy || selected.size === 0}
              className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Linking…' : `Link ${selected.size}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
