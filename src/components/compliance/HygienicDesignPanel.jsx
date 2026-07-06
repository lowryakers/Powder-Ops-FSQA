import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, CheckCircle, Clock, XCircle, AlertTriangle } from 'lucide-react';

const TRIGGER_REASONS = [
  { value: 'new_install', label: 'New Installation' },
  { value: 'modification', label: 'Modification' },
  { value: 'relocation', label: 'Relocation' },
  { value: 'repair', label: 'Post-Repair' },
  { value: 'periodic_review', label: 'Periodic Review' },
];

const RESULT_BADGE = {
  pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, label: 'Pending' },
  approved: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Approved' },
  conditional: { color: 'bg-amber-100 text-amber-800', icon: AlertTriangle, label: 'Conditional' },
  rejected: { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Rejected' },
};

const CHECKLIST_ITEMS = [
  'Smooth, non-porous surfaces (no cracks, crevices, or pitting)',
  'Self-draining design (no pooling of water or product)',
  'Accessible for cleaning and inspection',
  'No dead legs or blind spots in piping',
  'Food-grade materials of construction (stainless steel, approved polymers)',
  'Sealed bearings and fasteners (no exposed threads)',
  'Proper gaskets and seals (no degradation)',
  'No harborage points for allergens or microorganisms',
  'Adequate clearance from walls/floor for cleaning access',
  'Lubricant points are food-grade compatible',
];

function VerificationForm({ equipment, onSave, onCancel }) {
  const { user } = useAuth() || {};
  const [form, setForm] = useState({
    equipment_id: '', trigger_reason: 'new_install', description: '', notes: '',
  });
  const [responses, setResponses] = useState(CHECKLIST_ITEMS.map(item => ({ item, result: '', notes: '' })));
  const [saving, setSaving] = useState(false);

  const setResponse = (idx, field, value) => {
    const updated = [...responses];
    updated[idx] = { ...updated[idx], [field]: value };
    setResponses(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        checklist_responses: responses,
        performed_by: user?.name,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900">New Hygienic Design Verification</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment *</label>
          <select required value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select equipment...</option>
            {(equipment || []).map(eq => (
              <option key={eq.id} value={eq.id}>{eq.asset_id} — {eq.name}{eq.is_food_contact ? ' ★' : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
          <select value={form.trigger_reason} onChange={e => setForm({ ...form, trigger_reason: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {TRIGGER_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Brief description of change" />
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Hygienic Design Checklist</h4>
        <div className="space-y-2">
          {responses.map((resp, i) => (
            <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{resp.item}</p>
                <input placeholder="Notes (optional)" value={resp.notes}
                  onChange={e => setResponse(i, 'notes', e.target.value)}
                  className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-xs" />
              </div>
              <div className="flex gap-1 shrink-0 pt-0.5">
                {['pass', 'fail', 'n/a'].map(val => (
                  <button key={val} type="button" onClick={() => setResponse(i, 'result', val)}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      resp.result === val
                        ? val === 'pass' ? 'bg-green-600 text-white' : val === 'fail' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                        : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                    }`}>{val.toUpperCase()}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Additional Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Submit Verification'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function ApprovalForm({ verification, onApprove, onCancel }) {
  const { user } = useAuth() || {};
  const [result, setResult] = useState('approved');
  const [conditions, setConditions] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onApprove({ overall_result: result, conditions, approved_by: user?.name });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 bg-blue-50 rounded-lg space-y-2">
      <div className="flex gap-2">
        {['approved', 'conditional', 'rejected'].map(val => (
          <button key={val} type="button" onClick={() => setResult(val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              result === val ? 'bg-gray-800 text-white' : 'bg-white border border-gray-300 text-gray-600'
            }`}>{val.charAt(0).toUpperCase() + val.slice(1)}</button>
        ))}
      </div>
      {result === 'conditional' && (
        <input placeholder="Conditions that must be met..." value={conditions}
          onChange={e => setConditions(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium">
          {saving ? 'Saving...' : 'Confirm'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs">Cancel</button>
      </div>
    </form>
  );
}

export default function HygienicDesignPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor';
  const { data: verifications, loading, refresh } = useApiGet('/hygienic-design');
  const { data: equipment } = useApiGet('/equipment');
  const [showForm, setShowForm] = useState(false);
  const [approving, setApproving] = useState(null);
  const [filter, setFilter] = useState('all');

  const handleCreate = async (form) => {
    await apiPost('/hygienic-design', form);
    setShowForm(false);
    refresh();
  };

  const handleApprove = async (id, form) => {
    await apiPut(`/hygienic-design/${id}/approve`, form);
    setApproving(null);
    refresh();
  };

  const filtered = (verifications || []).filter(v => filter === 'all' || v.overall_result === filter);
  const pendingCount = (verifications || []).filter(v => v.overall_result === 'pending').length;

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Hygienic Design Verifications</h2>
          <p className="text-sm text-gray-500">Equipment installation, modification, and relocation approvals</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Verification
        </button>
      </div>

      <div className="flex gap-1 flex-wrap">
        {[
          { value: 'all', label: `All (${(verifications || []).length})` },
          { value: 'pending', label: `Pending (${pendingCount})` },
          { value: 'approved', label: 'Approved' },
          { value: 'conditional', label: 'Conditional' },
          { value: 'rejected', label: 'Rejected' },
        ].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {showForm && <VerificationForm equipment={equipment} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      <div className="space-y-3">
        {filtered.map(v => {
          const badge = RESULT_BADGE[v.overall_result] || RESULT_BADGE.pending;
          const Icon = badge.icon;
          const responses = (() => { try { return JSON.parse(v.checklist_responses); } catch { return []; } })();
          const passCount = responses.filter(r => r.result === 'pass').length;
          const failCount = responses.filter(r => r.result === 'fail').length;

          return (
            <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                      <span className="inline-flex items-center gap-1"><Icon size={12} /> {badge.label}</span>
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">
                      {TRIGGER_REASONS.find(r => r.value === v.trigger_reason)?.label || v.trigger_reason}
                    </span>
                    {v.is_food_contact === 1 && <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-xs">Food Contact</span>}
                  </div>
                  <h4 className="font-medium text-gray-900">{v.equipment_name}</h4>
                  <p className="text-sm text-gray-500">{v.location}{v.description ? ` — ${v.description}` : ''}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>By: {v.performed_by}</span>
                    <span>{new Date(v.performed_at).toLocaleDateString()}</span>
                    <span className="text-green-600">{passCount} pass</span>
                    {failCount > 0 && <span className="text-red-600">{failCount} fail</span>}
                    {v.approved_by && <span>Approved by: {v.approved_by}</span>}
                  </div>
                  {v.conditions && <p className="text-xs text-amber-700 mt-1">Conditions: {v.conditions}</p>}
                  {v.notes && <p className="text-xs text-gray-500 mt-1">{v.notes}</p>}
                </div>
                {isAdmin && v.overall_result === 'pending' && approving !== v.id && (
                  <button onClick={() => setApproving(v.id)}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100">
                    Review
                  </button>
                )}
              </div>
              {approving === v.id && (
                <ApprovalForm verification={v}
                  onApprove={(form) => handleApprove(v.id, form)}
                  onCancel={() => setApproving(null)} />
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400">No verifications found</div>
        )}
      </div>
    </div>
  );
}
