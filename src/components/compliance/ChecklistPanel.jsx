import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, ClipboardCheck, CheckCircle, XCircle, AlertTriangle, Clock, SkipForward, Archive, Eye, Edit2, Power, PowerOff } from 'lucide-react';

const TYPE_LABELS = { pre_op: 'Pre-Op', operational: 'Operational', sanitation: 'Sanitation', gmp: 'GMP', custom: 'Custom' };
const TYPE_COLORS = { pre_op: 'bg-blue-100 text-blue-800', operational: 'bg-purple-100 text-purple-800', sanitation: 'bg-teal-100 text-teal-800', gmp: 'bg-yellow-100 text-yellow-800', custom: 'bg-gray-100 text-gray-800' };
const FREQ_LABELS = { per_shift: 'Per Shift', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };

function TemplateForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', type: 'pre_op', frequency: 'daily', description: '', items: [{ label: '', type: 'pass_fail' }] });
  const [saving, setSaving] = useState(false);

  const addItem = () => setForm({ ...form, items: [...form.items, { label: '', type: 'pass_fail' }] });
  const updateItem = (i, field, val) => {
    const items = [...form.items];
    items[i] = { ...items[i], [field]: val };
    setForm({ ...form, items });
  };
  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Template' : 'New Checklist Template'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Daily Pre-Op Inspection" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Frequency</label>
          <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">Checklist Items</label>
        <div className="space-y-2">
          {form.items.map((item, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
              <input value={item.label} onChange={e => updateItem(i, 'label', e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="Check item description" />
              <select value={item.type} onChange={e => updateItem(i, 'type', e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs">
                <option value="pass_fail">Pass/Fail</option>
                <option value="yes_no">Yes/No</option>
                <option value="numeric">Numeric</option>
                <option value="text">Text</option>
                <option value="temperature">Temperature</option>
              </select>
              {form.items.length > 1 && (
                <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600">
                  <XCircle size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 text-sm text-powder-600 hover:text-powder-700">+ Add Item</button>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update Template' : 'Create Template'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function InstanceCard({ instance, onFillOut, onSkip }) {
  const items = instance.items || [];
  const isOverdue = instance.status === 'overdue';
  const today = new Date().toISOString().split('T')[0];
  const isDueToday = instance.due_date === today;

  return (
    <div className={`bg-white rounded-xl border-2 p-4 ${isOverdue ? 'border-red-300 ring-2 ring-red-100' : isDueToday ? 'border-powder-300' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[instance.type]}`}>
              {TYPE_LABELS[instance.type]}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {FREQ_LABELS[instance.frequency] || instance.frequency}
            </span>
            {isOverdue && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 flex items-center gap-1">
                <AlertTriangle size={10} /> OVERDUE
              </span>
            )}
            {isDueToday && !isOverdue && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-powder-100 text-powder-700">DUE TODAY</span>
            )}
          </div>
          <h4 className="font-medium text-gray-900">{instance.name}</h4>
          {instance.description && <p className="text-xs text-gray-500 mt-0.5">{instance.description}</p>}
          <p className="text-xs text-gray-400 mt-1">
            <Clock size={10} className="inline mr-1" />
            Due {instance.due_date} &middot; {items.length} item{items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onFillOut(instance)}
            className="px-3 py-2 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 flex items-center gap-1">
            <ClipboardCheck size={14} /> Fill Out
          </button>
          <button onClick={() => onSkip(instance.id)}
            className="px-2 py-2 bg-gray-100 text-gray-500 rounded-lg text-xs hover:bg-gray-200" title="Skip this period">
            <SkipForward size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function FillOutForm({ instance, onSave, onCancel }) {
  const items = instance.items || [];
  const [responses, setResponses] = useState(items.map(() => ({ value: '', passed: true })));
  const [submittedBy, setSubmittedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [saving, setSaving] = useState(false);

  const updateResponse = (i, field, val) => {
    const r = [...responses];
    r[i] = { ...r[i], [field]: val };
    setResponses(r);
  };

  const hasFail = responses.some(r => !r.passed);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(instance.id, {
        submitted_by: submittedBy,
        responses: responses.map((r, i) => ({ item: items[i]?.label, ...r })),
        overall_status: hasFail ? 'fail' : 'pass',
        notes: notes || null,
        corrective_action_taken: correctiveAction || null,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border-2 border-powder-300 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{instance.name}</h3>
          <p className="text-xs text-gray-500">{TYPE_LABELS[instance.type]} &middot; Due {instance.due_date}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[instance.type]}`}>
          {FREQ_LABELS[instance.frequency]}
        </span>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Completed By *</label>
        <input required value={submittedBy} onChange={e => setSubmittedBy(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Your name" />
      </div>

      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${!responses[i].passed ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
            <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
            <span className="text-sm flex-1">{item.label}</span>
            {(item.type === 'pass_fail' || item.type === 'yes_no') ? (
              <div className="flex gap-1">
                <button type="button" onClick={() => updateResponse(i, 'passed', true)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${responses[i].passed ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                  {item.type === 'yes_no' ? 'Yes' : 'Pass'}
                </button>
                <button type="button" onClick={() => updateResponse(i, 'passed', false)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${!responses[i].passed ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                  {item.type === 'yes_no' ? 'No' : 'Fail'}
                </button>
              </div>
            ) : (
              <input value={responses[i].value} onChange={e => updateResponse(i, 'value', e.target.value)}
                type={item.type === 'numeric' || item.type === 'temperature' ? 'number' : 'text'}
                className="w-32 px-2 py-1.5 border border-gray-300 rounded text-sm"
                placeholder={item.type === 'temperature' ? '°F' : ''} />
            )}
          </div>
        ))}
      </div>

      {hasFail && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
            <AlertTriangle size={12} /> One or more items failed
          </p>
          <div>
            <label className="block text-xs font-medium text-red-700 mb-1">Corrective Action Taken</label>
            <textarea value={correctiveAction} onChange={e => setCorrectiveAction(e.target.value)}
              className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm" rows={2}
              placeholder="Describe the corrective action taken..." />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
          <CheckCircle size={14} /> {saving ? 'Submitting...' : 'Complete Checklist'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function ChecklistPanel() {
  const { data: templates, loading, refresh: refreshTemplates } = useApiGet('/checklists/templates');
  const { data: dueInstances, refresh: refreshDue } = useApiGet('/checklists/due');
  const { data: submissions, refresh: refreshSubs } = useApiGet('/checklists/submissions');
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [fillingOut, setFillingOut] = useState(null);
  const [tab, setTab] = useState('due');
  const [typeFilter, setTypeFilter] = useState('all');

  const handleCreateTemplate = async (form) => {
    await apiPost('/checklists/templates', form);
    setShowTemplateForm(false);
    refreshTemplates();
    refreshDue();
  };

  const handleUpdateTemplate = async (form) => {
    await apiPut(`/checklists/templates/${editingTemplate.id}`, form);
    setEditingTemplate(null);
    refreshTemplates();
    refreshDue();
  };

  const handleToggleTemplate = async (tmpl) => {
    await apiPut(`/checklists/templates/${tmpl.id}`, { is_active: !tmpl.is_active });
    refreshTemplates();
    refreshDue();
  };

  const handleCompleteInstance = async (instanceId, form) => {
    await apiPost(`/checklists/instances/${instanceId}/complete`, form);
    setFillingOut(null);
    refreshDue();
    refreshSubs();
  };

  const handleSkipInstance = async (instanceId) => {
    await apiPost(`/checklists/instances/${instanceId}/skip`, { _actor: 'system' });
    refreshDue();
  };

  const handleVerify = async (subId, verifiedBy) => {
    await apiPut(`/checklists/submissions/${subId}/verify`, { verified_by: verifiedBy });
    refreshSubs();
  };

  const filteredDue = (dueInstances || []).filter(i => typeFilter === 'all' || i.type === typeFilter);
  const overdueCount = (dueInstances || []).filter(i => i.status === 'overdue').length;

  const typeCounts = {};
  for (const i of (dueInstances || [])) {
    typeCounts[i.type] = (typeCounts[i.type] || 0) + 1;
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading checklists...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Digital Checklists</h2>
          {overdueCount > 0 && (
            <p className="text-sm text-red-600 flex items-center gap-1 mt-0.5">
              <AlertTriangle size={14} /> {overdueCount} overdue checklist{overdueCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button onClick={() => { setShowTemplateForm(true); setEditingTemplate(null); }}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Template
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('due')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'due' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <ClipboardCheck size={14} /> Due ({(dueInstances || []).length})
        </button>
        <button onClick={() => setTab('templates')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'templates' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Templates ({(templates || []).length})
        </button>
        <button onClick={() => setTab('submissions')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === 'submissions' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Archive size={14} /> History
        </button>
      </div>

      {(showTemplateForm && !editingTemplate) && <TemplateForm onSave={handleCreateTemplate} onCancel={() => setShowTemplateForm(false)} />}
      {editingTemplate && (
        <TemplateForm
          initial={{ ...editingTemplate, items: JSON.parse(editingTemplate.items || '[]') }}
          onSave={handleUpdateTemplate}
          onCancel={() => setEditingTemplate(null)}
        />
      )}

      {fillingOut && (
        <FillOutForm instance={fillingOut} onSave={handleCompleteInstance} onCancel={() => setFillingOut(null)} />
      )}

      {/* Due Tab */}
      {tab === 'due' && (
        <div className="space-y-3">
          {Object.keys(typeCounts).length > 1 && (
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setTypeFilter('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${typeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                All ({(dueInstances || []).length})
              </button>
              {Object.entries(typeCounts).map(([type, count]) => (
                <button key={type} onClick={() => setTypeFilter(type)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${typeFilter === type ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {TYPE_LABELS[type]} ({count})
                </button>
              ))}
            </div>
          )}

          {filteredDue.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle size={48} className="mx-auto text-green-400 mb-3" />
              <p className="text-lg font-semibold text-gray-700">All caught up!</p>
              <p className="text-gray-500">No checklists due right now.</p>
            </div>
          ) : (
            filteredDue.map(inst => (
              <InstanceCard key={inst.id} instance={inst} onFillOut={setFillingOut} onSkip={handleSkipInstance} />
            ))
          )}
        </div>
      )}

      {/* Templates Tab */}
      {tab === 'templates' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates || []).map(t => (
            <div key={t.id} className={`bg-white rounded-xl border border-gray-200 p-4 ${!t.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[t.type]}`}>{TYPE_LABELS[t.type]}</span>
                <span className="text-xs text-gray-400">{FREQ_LABELS[t.frequency] || t.frequency}</span>
              </div>
              <h4 className="font-medium text-gray-900 mb-1">{t.name}</h4>
              {t.description && <p className="text-xs text-gray-500 mb-1">{t.description}</p>}
              <p className="text-xs text-gray-400 mb-3">{JSON.parse(t.items || '[]').length} items</p>
              <div className="flex gap-1">
                <button onClick={() => { setEditingTemplate(t); setShowTemplateForm(false); }}
                  className="flex-1 px-2 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 flex items-center justify-center gap-1">
                  <Edit2 size={12} /> Edit
                </button>
                <button onClick={() => handleToggleTemplate(t)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${t.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                  title={t.is_active ? 'Deactivate' : 'Activate'}>
                  {t.is_active ? <PowerOff size={12} /> : <Power size={12} />}
                  {t.is_active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
          {(!templates || templates.length === 0) && (
            <div className="col-span-full text-center py-8 text-gray-500">No checklist templates yet. Create one to get started.</div>
          )}
        </div>
      )}

      {/* Submissions Tab */}
      {tab === 'submissions' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Checklist</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Verified</th>
              </tr>
            </thead>
            <tbody>
              {(submissions || []).map(s => (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.checklist_name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_COLORS[s.checklist_type]}`}>{TYPE_LABELS[s.checklist_type]}</span></td>
                  <td className="px-4 py-3 text-gray-600">{s.submitted_by}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(s.submitted_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.overall_status === 'pass' ? 'bg-green-100 text-green-800' : s.overall_status === 'fail' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {s.overall_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {s.verified_by ? (
                      <span className="text-green-600 text-xs">{s.verified_by}</span>
                    ) : (
                      <button onClick={() => {
                        const name = prompt('Verified by:');
                        if (name) handleVerify(s.id, name);
                      }} className="text-xs text-powder-600 hover:text-powder-700 underline">Verify</button>
                    )}
                  </td>
                </tr>
              ))}
              {(!submissions || submissions.length === 0) && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No submissions yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
