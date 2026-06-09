import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Lock, Unlock, ShieldCheck, AlertTriangle, Zap } from 'lucide-react';

const ENERGY_TYPES = ['Electrical', 'Pneumatic', 'Hydraulic', 'Mechanical', 'Thermal', 'Chemical', 'Gravitational', 'Stored Energy'];
const STATUS_COLORS = { locked: 'bg-red-100 text-red-800', verified: 'bg-yellow-100 text-yellow-800', released: 'bg-green-100 text-green-800' };

function ProcedureForm({ equipment, onSave, onCancel }) {
  const [form, setForm] = useState({
    equipment_id: '', title: '', description: '',
    energy_sources: [{ type: 'Electrical', location: '', isolation_method: '' }],
    steps: [{ order: 1, instruction: '' }],
    required_locks: 1, required_tags: 1, verification_method: 'try_start',
  });
  const [saving, setSaving] = useState(false);

  const addSource = () => setForm({ ...form, energy_sources: [...form.energy_sources, { type: 'Electrical', location: '', isolation_method: '' }] });
  const updateSource = (i, field, val) => {
    const s = [...form.energy_sources];
    s[i] = { ...s[i], [field]: val };
    setForm({ ...form, energy_sources: s });
  };
  const removeSource = (i) => setForm({ ...form, energy_sources: form.energy_sources.filter((_, idx) => idx !== i) });

  const addStep = () => setForm({ ...form, steps: [...form.steps, { order: form.steps.length + 1, instruction: '' }] });
  const updateStep = (i, val) => {
    const s = [...form.steps];
    s[i] = { ...s[i], instruction: val };
    setForm({ ...form, steps: s });
  };
  const removeStep = (i) => setForm({ ...form, steps: form.steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900">New LOTO Procedure</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment *</label>
          <select required value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select...</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.room || 'No room'})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
          <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Line 1 Conveyor Belt Change LOTO" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Required Locks</label>
          <input type="number" min="1" value={form.required_locks} onChange={e => setForm({ ...form, required_locks: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Required Tags</label>
          <input type="number" min="1" value={form.required_tags} onChange={e => setForm({ ...form, required_tags: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
        </div>
      </div>

      {/* Energy Sources */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">
          <Zap size={12} className="inline mr-1" />Energy Sources *
        </label>
        <div className="space-y-2">
          {form.energy_sources.map((src, i) => (
            <div key={i} className="flex gap-2 items-center bg-yellow-50 rounded-lg p-2">
              <select value={src.type} onChange={e => updateSource(i, 'type', e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded text-xs">
                {ENERGY_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <input value={src.location} onChange={e => updateSource(i, 'location', e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Location (e.g. Panel B, Valve 3)" />
              <input value={src.isolation_method} onChange={e => updateSource(i, 'isolation_method', e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Isolation method (e.g. Breaker OFF)" />
              {form.energy_sources.length > 1 && (
                <button type="button" onClick={() => removeSource(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addSource} className="mt-1 text-xs text-powder-600 hover:text-powder-700">+ Add Energy Source</button>
      </div>

      {/* Steps */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">Lockout Steps *</label>
        <div className="space-y-2">
          {form.steps.map((step, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
              <input value={step.instruction} onChange={e => updateStep(i, e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" placeholder="Step instruction" />
              {form.steps.length > 1 && (
                <button type="button" onClick={() => removeStep(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addStep} className="mt-1 text-xs text-powder-600 hover:text-powder-700">+ Add Step</button>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Verification Method</label>
        <select value={form.verification_method} onChange={e => setForm({ ...form, verification_method: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="try_start">Try Start (attempt to energize)</option>
          <option value="voltage_test">Voltage/Pressure Test</option>
          <option value="visual">Visual Inspection</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Create Procedure'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function LockoutForm({ procedure, onSave, onCancel }) {
  const [form, setForm] = useState({ locked_by: '', reason: '', lock_numbers: '', tag_numbers: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, procedure_id: procedure.id }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-red-50 rounded-lg border border-red-200 p-3 mt-2 space-y-2">
      <p className="text-sm font-medium text-red-800"><Lock size={14} className="inline mr-1" />Execute Lockout: {procedure.title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Locked By *</label>
          <input required value={form.locked_by} onChange={e => setForm({ ...form, locked_by: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
          <input required value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Belt replacement PM" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lock Number(s)</label>
          <input value={form.lock_numbers} onChange={e => setForm({ ...form, lock_numbers: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="e.g. L-001, L-002" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Tag Number(s)</label>
          <input value={form.tag_numbers} onChange={e => setForm({ ...form, tag_numbers: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="e.g. T-001" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
          {saving ? 'Locking...' : 'Execute Lockout'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function LOTOPanel() {
  const { data: procedures, loading, refresh: refreshProcs } = useApiGet('/loto/procedures');
  const { data: executions, refresh: refreshExecs } = useApiGet('/loto/executions');
  const { data: equipment } = useApiGet('/equipment');
  const [showForm, setShowForm] = useState(false);
  const [locking, setLocking] = useState(null);
  const [tab, setTab] = useState('procedures');

  const handleCreate = async (form) => {
    await apiPost('/loto/procedures', form);
    setShowForm(false);
    refreshProcs();
  };

  const handleLockout = async (form) => {
    await apiPost('/loto/executions', form);
    setLocking(null);
    refreshExecs();
  };

  const handleVerify = async (id) => {
    const name = prompt('Verifier name (must be different from person who locked out):');
    if (!name) return;
    await apiPut(`/loto/executions/${id}/verify`, { verified_by: name, verification_result: 'zero_energy_confirmed' });
    refreshExecs();
  };

  const handleRelease = async (id) => {
    const name = prompt('Released by (must be the person who locked out):');
    if (!name) return;
    await apiPut(`/loto/executions/${id}/release`, { released_by: name });
    refreshExecs();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading LOTO procedures...</div>;

  const activeExecutions = (executions || []).filter(e => e.status !== 'released');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Lockout/Tagout (LOTO)</h2>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Procedure
        </button>
      </div>

      {/* Active Lockouts Banner */}
      {activeExecutions.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-red-600" />
            <h3 className="font-semibold text-red-800">{activeExecutions.length} Active Lockout(s)</h3>
          </div>
          <div className="space-y-2">
            {activeExecutions.map(exec => (
              <div key={exec.id} className="flex items-center justify-between bg-white rounded-lg p-2 border border-red-100">
                <div>
                  <p className="text-sm font-medium">{exec.procedure_title} — {exec.equipment_name}</p>
                  <p className="text-xs text-gray-500">Locked by {exec.locked_by} | {exec.reason}</p>
                </div>
                <div className="flex gap-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[exec.status]}`}>{exec.status}</span>
                  {exec.status === 'locked' && (
                    <button onClick={() => handleVerify(exec.id)} className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded text-xs hover:bg-yellow-100">Verify</button>
                  )}
                  {exec.status === 'verified' && (
                    <button onClick={() => handleRelease(exec.id)} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100">
                      <Unlock size={12} className="inline mr-1" />Release
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab('procedures')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'procedures' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Procedures
        </button>
        <button onClick={() => setTab('history')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'history' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Execution History
        </button>
      </div>

      {showForm && <ProcedureForm equipment={equipment} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      {tab === 'procedures' && (
        <div className="space-y-2">
          {(procedures || []).map(proc => (
            <div key={proc.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-gray-900 flex items-center gap-2">
                    <Lock size={14} className="text-red-500" /> {proc.title}
                  </h4>
                  <p className="text-sm text-gray-500">{proc.equipment_name} {proc.room ? `(${proc.room})` : ''}</p>
                  {proc.description && <p className="text-xs text-gray-400 mt-1">{proc.description}</p>}
                  <div className="flex gap-3 mt-2 text-xs text-gray-500">
                    <span>{JSON.parse(proc.energy_sources || '[]').length} energy source(s)</span>
                    <span>{JSON.parse(proc.steps || '[]').length} step(s)</span>
                    <span>{proc.required_locks} lock(s), {proc.required_tags} tag(s)</span>
                    <span>Verify: {proc.verification_method}</span>
                  </div>
                </div>
                <button onClick={() => setLocking(locking?.id === proc.id ? null : proc)}
                  className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100">
                  <Lock size={12} className="inline mr-1" />Execute
                </button>
              </div>
              {locking?.id === proc.id && (
                <LockoutForm procedure={proc} onSave={handleLockout} onCancel={() => setLocking(null)} />
              )}
            </div>
          ))}
          {(!procedures || procedures.length === 0) && (
            <div className="text-center py-8 text-gray-500">No LOTO procedures defined yet</div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Procedure</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Equipment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Locked By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Locked At</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Reason</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Released</th>
              </tr>
            </thead>
            <tbody>
              {(executions || []).map(ex => (
                <tr key={ex.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{ex.procedure_title}</td>
                  <td className="px-4 py-3 text-gray-600">{ex.equipment_name}</td>
                  <td className="px-4 py-3 text-gray-600">{ex.locked_by}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{new Date(ex.locked_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{ex.reason}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ex.status]}`}>{ex.status}</span></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{ex.released_by ? `${ex.released_by} @ ${new Date(ex.released_at).toLocaleString()}` : '—'}</td>
                </tr>
              ))}
              {(!executions || executions.length === 0) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No LOTO executions recorded</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
