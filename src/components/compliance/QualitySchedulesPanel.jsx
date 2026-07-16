import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CalendarClock, Plus, Pencil, Trash2, X, CheckCircle2, PauseCircle } from 'lucide-react';

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
];
const FREQ_LABEL = Object.fromEntries(FREQUENCIES.map(f => [f.value, f.label]));

// Quality areas a recurring check can be tagged to (for filtering/context).
const AREAS = [
  'Hygienic Design', 'Organoleptic / Shelf-life', 'Glass & Brittle Plastic',
  'Sanitation / Cleaning', 'Allergen Control', 'Pest Control',
  'Environmental Monitoring', 'Foreign Material', 'Calibration Check',
  'Label / Packaging', 'General Quality',
];

function todayStr() { return new Date().toISOString().split('T')[0]; }

function freqDescription(type, value) {
  const n = Math.max(1, parseInt(value, 10) || 1);
  if (n === 1) return `Every ${FREQ_LABEL[type]?.toLowerCase() || type}`;
  return `Every ${n} × ${FREQ_LABEL[type]?.toLowerCase() || type}`;
}

function ScheduleForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || '',
    module_id: initial?.module_id || 'General Quality',
    frequency_type: initial?.frequency_type || 'monthly',
    frequency_value: initial?.frequency_value || 1,
    first_due: initial?.next_due || todayStr(),
    description: initial?.description || '',
    steps: (() => { try { return JSON.parse(initial?.procedure_steps || '[]'); } catch { return []; } })(),
    is_active: initial ? !!initial.is_active : true,
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setStep = (i, v) => setForm(f => { const s = [...f.steps]; s[i] = v; return { ...f, steps: s }; });
  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, ''] }));
  const removeStep = (i) => setForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }));

  const submit = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        module_id: form.module_id,
        frequency_type: form.frequency_type,
        frequency_value: form.frequency_value,
        description: form.description || null,
        procedure_steps: form.steps.map(s => s.trim()).filter(Boolean),
      };
      if (initial) {
        payload.next_due = form.first_due;
        payload.is_active = form.is_active;
        await apiPut(`/quality-schedules/${initial.id}`, payload);
      } else {
        payload.first_due = form.first_due;
        await apiPost('/quality-schedules', payload);
      }
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">{initial ? 'Edit' : 'New'} Quality Check Schedule</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Check title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Weekly hygienic zoning verification"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Quality area</label>
              <select value={form.module_id} onChange={e => set('module_id', e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{initial ? 'Next due' : 'First due'}</label>
              <input type="date" value={form.first_due} onChange={e => set('first_due', e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Frequency</label>
              <select value={form.frequency_type} onChange={e => set('frequency_type', e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Every</label>
              <input type="number" min="1" value={form.frequency_value} onChange={e => set('frequency_value', e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500 -mt-2">{freqDescription(form.frequency_type, form.frequency_value)} — a QA task is generated on the due date, then the schedule advances automatically.</p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Instructions <span className="text-gray-400">(optional)</span></label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="What the operator should do / verify..." />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">Checklist steps <span className="text-gray-400">(optional)</span></label>
              <button onClick={addStep} className="text-xs text-powder-600 hover:text-powder-700 font-medium">+ Add step</button>
            </div>
            <div className="space-y-2">
              {form.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={s} onChange={e => setStep(i, e.target.value)} placeholder={`Step ${i + 1}`}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                  <button onClick={() => removeStep(i)} className="text-gray-400 hover:text-red-500"><X size={16} /></button>
                </div>
              ))}
              {form.steps.length === 0 && <p className="text-[11px] text-gray-400">No steps — a simple complete/flag task.</p>}
            </div>
          </div>
          {initial && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
              Active (generating tasks)
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={submit} disabled={saving || !form.title.trim()}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving...' : (initial ? 'Save changes' : 'Create schedule')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QualitySchedulesPanel() {
  const { user } = useAuth() || {};
  const { data: schedules, loading, refresh } = useApiGet('/quality-schedules');
  const [editing, setEditing] = useState(null); // 'new' | schedule object | null

  const canManage = user && (user.role === 'admin' || user.role === 'supervisor' || ['qa', 'quality'].includes((user.department || '').toLowerCase()));

  const remove = async (s) => {
    if (!window.confirm(`Delete the "${s.title}" schedule? Existing tasks are kept; no new ones will be generated.`)) return;
    await apiDelete(`/quality-schedules/${s.id}`);
    refresh();
  };

  const rows = schedules || [];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <CalendarClock size={20} className="text-powder-600" /> Quality Check Schedules
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Recurring quality-control verifications that auto-generate QA tasks in the Task Center on a set frequency.
          </p>
        </div>
        {canManage && (
          <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
            <Plus size={16} /> New Schedule
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading schedules...</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
          <CalendarClock size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No quality schedules yet.</p>
          {canManage && <p className="text-xs text-gray-400 mt-1">Create one to start feeding recurring checks into the QA task queue.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Check</th>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Area</th>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Frequency</th>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Next due</th>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Last done</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                {canManage && <th className="px-4 py-2.5"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(s => (
                <tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{s.title}</div>
                    {s.description && <div className="text-xs text-gray-500 truncate max-w-xs">{s.description}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{s.module_id || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{freqDescription(s.frequency_type, s.frequency_value)}</td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{s.next_due || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{s.last_completed ? s.last_completed.split('T')[0] : '—'}</td>
                  <td className="px-4 py-2.5">
                    {s.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 size={12} /> Active</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full"><PauseCircle size={12} /> Paused</span>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      <button onClick={() => setEditing(s)} className="text-gray-400 hover:text-powder-600 mr-2" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => remove(s)} className="text-gray-400 hover:text-red-500" title="Delete"><Trash2 size={15} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ScheduleForm
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async () => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}
