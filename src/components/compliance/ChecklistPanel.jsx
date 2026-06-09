import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, ClipboardCheck, CheckCircle, XCircle, Eye } from 'lucide-react';

const TYPE_LABELS = { pre_op: 'Pre-Op', operational: 'Operational', sanitation: 'Sanitation', gmp: 'GMP', custom: 'Custom' };
const TYPE_COLORS = { pre_op: 'bg-blue-100 text-blue-800', operational: 'bg-purple-100 text-purple-800', sanitation: 'bg-teal-100 text-teal-800', gmp: 'bg-yellow-100 text-yellow-800', custom: 'bg-gray-100 text-gray-800' };

function TemplateForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: '', type: 'pre_op', frequency: 'daily', description: '', items: [{ label: '', type: 'pass_fail' }] });
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
      <h3 className="font-semibold text-gray-900">New Checklist Template</h3>
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
            <option value="daily">Daily</option>
            <option value="per_shift">Per Shift</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
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
          {saving ? 'Saving...' : 'Create Template'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function SubmissionForm({ template, onSave, onCancel }) {
  const items = JSON.parse(template.items || '[]');
  const [responses, setResponses] = useState(items.map(() => ({ value: '', passed: true })));
  const [submittedBy, setSubmittedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const updateResponse = (i, field, val) => {
    const r = [...responses];
    r[i] = { ...r[i], [field]: val };
    setResponses(r);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const hasFail = responses.some(r => !r.passed);
    try {
      await onSave({
        checklist_id: template.id,
        submitted_by: submittedBy,
        responses: responses.map((r, i) => ({ item: items[i]?.label, ...r })),
        overall_status: hasFail ? 'fail' : 'pass',
        notes,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">Submit: {template.name}</h3>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Your Name *</label>
        <input required value={submittedBy} onChange={e => setSubmittedBy(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
            <span className="text-sm flex-1">{item.label}</span>
            {(item.type === 'pass_fail' || item.type === 'yes_no') ? (
              <div className="flex gap-1">
                <button type="button" onClick={() => updateResponse(i, 'passed', true)}
                  className={`px-3 py-1 rounded text-xs font-medium ${responses[i].passed ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {item.type === 'yes_no' ? 'Yes' : 'Pass'}
                </button>
                <button type="button" onClick={() => updateResponse(i, 'passed', false)}
                  className={`px-3 py-1 rounded text-xs font-medium ${!responses[i].passed ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {item.type === 'yes_no' ? 'No' : 'Fail'}
                </button>
              </div>
            ) : (
              <input value={responses[i].value} onChange={e => updateResponse(i, 'value', e.target.value)}
                type={item.type === 'numeric' || item.type === 'temperature' ? 'number' : 'text'}
                className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
                placeholder={item.type === 'temperature' ? 'F' : ''} />
            )}
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Submitting...' : 'Submit Checklist'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function ChecklistPanel() {
  const { data: templates, loading, refresh: refreshTemplates } = useApiGet('/checklists/templates');
  const { data: submissions, refresh: refreshSubs } = useApiGet('/checklists/submissions');
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [fillingOut, setFillingOut] = useState(null);
  const [tab, setTab] = useState('templates');

  const handleCreateTemplate = async (form) => {
    await apiPost('/checklists/templates', form);
    setShowTemplateForm(false);
    refreshTemplates();
  };

  const handleSubmitChecklist = async (form) => {
    await apiPost('/checklists/submissions', form);
    setFillingOut(null);
    refreshSubs();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading checklists...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Digital Checklists</h2>
        <button onClick={() => setShowTemplateForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Template
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('templates')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'templates' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Templates
        </button>
        <button onClick={() => setTab('submissions')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'submissions' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Submissions
        </button>
      </div>

      {showTemplateForm && <TemplateForm onSave={handleCreateTemplate} onCancel={() => setShowTemplateForm(false)} />}
      {fillingOut && <SubmissionForm template={fillingOut} onSave={handleSubmitChecklist} onCancel={() => setFillingOut(null)} />}

      {tab === 'templates' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates || []).map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[t.type]}`}>{TYPE_LABELS[t.type]}</span>
                <span className="text-xs text-gray-400">{t.frequency}</span>
              </div>
              <h4 className="font-medium text-gray-900 mb-1">{t.name}</h4>
              <p className="text-xs text-gray-500 mb-3">{JSON.parse(t.items || '[]').length} items</p>
              <button onClick={() => setFillingOut(t)}
                className="w-full px-3 py-2 bg-powder-50 text-powder-700 rounded-lg text-sm font-medium hover:bg-powder-100">
                <ClipboardCheck size={14} className="inline mr-1" /> Fill Out
              </button>
            </div>
          ))}
          {(!templates || templates.length === 0) && (
            <div className="col-span-full text-center py-8 text-gray-500">No checklist templates yet</div>
          )}
        </div>
      )}

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
                  <td className="px-4 py-3 text-gray-600">{s.verified_by || <span className="text-gray-400">Pending</span>}</td>
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
