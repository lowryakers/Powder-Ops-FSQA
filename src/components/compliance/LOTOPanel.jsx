import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Lock, Unlock, ShieldCheck, AlertTriangle, Zap, Search, ChevronDown, ChevronUp } from 'lucide-react';

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
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Location" />
              <input value={src.isolation_method} onChange={e => updateSource(i, 'isolation_method', e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Isolation method" />
              {form.energy_sources.length > 1 && (
                <button type="button" onClick={() => removeSource(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addSource} className="mt-1 text-xs text-powder-600 hover:text-powder-700">+ Add Energy Source</button>
      </div>

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
    <form onSubmit={handleSubmit} className="bg-red-50 rounded-lg border border-red-200 p-3 mt-3 space-y-2">
      <p className="text-sm font-medium text-red-800"><Lock size={14} className="inline mr-1" />Execute Lockout: {procedure.equipment_name}</p>
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

function StepsList({ steps }) {
  let currentSection = null;
  const sections = [];

  for (const s of steps) {
    if (typeof s === 'string' && s.endsWith(':') && !s.startsWith('  ')) {
      currentSection = { title: s.replace(/:$/, ''), items: [] };
      sections.push(currentSection);
    } else if (currentSection) {
      currentSection.items.push(typeof s === 'string' ? s.replace(/^\s+/, '') : s);
    } else {
      if (!sections.length || sections[sections.length - 1].title !== 'Steps') {
        sections.push({ title: 'Steps', items: [] });
      }
      sections[sections.length - 1].items.push(typeof s === 'string' ? s : s);
    }
  }

  if (sections.length === 0) return null;

  const SECTION_COLORS = {
    'Preparation: Identify Energy Sources': 'bg-blue-600',
    'Notification: Inform Affected Employees': 'bg-indigo-600',
    'Shutdown: Power Down Equipment': 'bg-amber-600',
    'Isolation: Disconnect Energy Sources': 'bg-orange-600',
    'Lockout/Tagout: Apply Devices': 'bg-red-600',
    'Release Stored Energy: Ensure Zero Energy State': 'bg-purple-600',
    'Verification: Confirm Isolation': 'bg-green-600',
  };

  return (
    <div className="space-y-3 mt-3">
      {sections.map((sec, si) => (
        <div key={si}>
          <div className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white ${SECTION_COLORS[sec.title] || 'bg-gray-600'}`}>
            {si + 1}. {sec.title}
          </div>
          <ul className="mt-1.5 space-y-1 ml-1">
            {sec.items.map((item, ii) => (
              <li key={ii} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="shrink-0 w-4 h-4 rounded border border-gray-300 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ProcedureCard({ proc, onExecute, executing }) {
  const [expanded, setExpanded] = useState(false);
  const steps = JSON.parse(proc.steps || '[]');

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 flex items-center gap-2">
            <Lock size={14} className="text-red-500 shrink-0" />
            <span className="truncate">{proc.equipment_name}</span>
          </h4>
          {proc.room && <p className="text-xs text-gray-500 ml-6">{proc.room}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setExpanded(!expanded)}
            className="px-2 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 flex items-center gap-1">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {steps.length} steps
          </button>
          <button onClick={() => onExecute(proc)}
            className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center gap-1">
            <Lock size={12} /> Lockout
          </button>
        </div>
      </div>

      {expanded && <StepsList steps={steps} />}

      {executing?.id === proc.id && (
        <LockoutForm procedure={proc} onSave={(form) => onExecute(form, true)} onCancel={() => onExecute(null)} />
      )}
    </div>
  );
}

export default function LOTOPanel() {
  const { data: procedures, loading, refresh: refreshProcs } = useApiGet('/loto/procedures');
  const { data: executions, refresh: refreshExecs } = useApiGet('/loto/executions');
  const { data: equipment } = useApiGet('/equipment');
  const { data: uncovered, refresh: refreshUncovered } = useApiGet('/loto/uncovered-equipment');
  const [showForm, setShowForm] = useState(false);
  const [executing, setExecuting] = useState(null);
  const [tab, setTab] = useState('procedures');
  const [search, setSearch] = useState('');

  const handleCreate = async (form) => {
    await apiPost('/loto/procedures', form);
    setShowForm(false);
    refreshProcs();
    refreshUncovered();
  };

  const handleExecute = async (formOrProc, isSubmit) => {
    if (!isSubmit) {
      setExecuting(executing?.id === formOrProc?.id ? null : formOrProc);
      return;
    }
    await apiPost('/loto/executions', formOrProc);
    setExecuting(null);
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

  const activeExecutions = (executions || []).filter(e => e.status !== 'released');

  const filtered = (procedures || []).filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [p.equipment_name, p.title, p.room].some(v => v && v.toLowerCase().includes(q));
  });

  if (loading) return <div className="text-center py-12 text-gray-500">Loading LOTO procedures...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Lockout/Tagout (LOTO)</h2>
          <p className="text-sm text-gray-500">{(procedures || []).length} procedures &middot; 7-step checklist per equipment</p>
        </div>
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
              <div key={exec.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-red-100">
                <div>
                  <p className="text-sm font-medium">{exec.equipment_name}</p>
                  <p className="text-xs text-gray-500">Locked by {exec.locked_by} &middot; {exec.reason}</p>
                </div>
                <div className="flex gap-1 items-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[exec.status]}`}>{exec.status}</span>
                  {exec.status === 'locked' && (
                    <button onClick={() => handleVerify(exec.id)} className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded text-xs hover:bg-yellow-100 flex items-center gap-1">
                      <ShieldCheck size={12} /> Verify
                    </button>
                  )}
                  {exec.status === 'verified' && (
                    <button onClick={() => handleRelease(exec.id)} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100 flex items-center gap-1">
                      <Unlock size={12} /> Release
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uncovered Equipment Banner */}
      {(uncovered || []).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-amber-600" />
            <h3 className="font-semibold text-amber-800">{uncovered.length} Equipment Without LOTO Procedure</h3>
          </div>
          <p className="text-sm text-amber-700 mb-3">The following active equipment has no lockout/tagout procedure on file. Create one to pass the audit readiness check.</p>
          <div className="space-y-1.5">
            {uncovered.map(eq => (
              <div key={eq.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">{eq.name}</p>
                  <p className="text-xs text-gray-500">{eq.room || eq.location || 'No location'}{eq.asset_id ? ` · ${eq.asset_id}` : ''}</p>
                </div>
                <button onClick={() => { setShowForm(true); }}
                  className="px-2.5 py-1.5 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-200 flex items-center gap-1">
                  <Plus size={12} /> Add Procedure
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab('procedures')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'procedures' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Lock size={14} /> Procedures ({(procedures || []).length})
        </button>
        <button onClick={() => setTab('history')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'history' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Execution History
        </button>
      </div>

      {showForm && <ProcedureForm equipment={equipment} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      {tab === 'procedures' && (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="space-y-2">
            {filtered.map(proc => (
              <ProcedureCard key={proc.id} proc={proc} executing={executing} onExecute={handleExecute} />
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                {search ? 'No procedures match your search' : 'No LOTO procedures defined yet'}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
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
                  <td className="px-4 py-3 font-medium">{ex.equipment_name}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ex.locked_by}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{new Date(ex.locked_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600 w-full">{ex.reason}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ex.status]}`}>{ex.status}</span></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{ex.released_by ? `${ex.released_by} @ ${new Date(ex.released_at).toLocaleString()}` : '—'}</td>
                </tr>
              ))}
              {(!executions || executions.length === 0) && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No LOTO executions recorded</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
