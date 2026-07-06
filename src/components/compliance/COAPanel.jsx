import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, Search, FileText, Upload, Download, Trash2, Edit2, ChevronDown, ChevronRight, FlaskConical, Building2, ClipboardList, AlertTriangle, CheckCircle2, Clock, X, Filter, Eye } from 'lucide-react';

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' },
  sent: { label: 'Sent to Lab', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  pass: { label: 'Pass', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  fail: { label: 'Fail', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  hold: { label: 'Hold', color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  re_test: { label: 'Re-Test', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  na: { label: 'N/A', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
};

const TEST_TYPES = [
  'Heavy Metals', 'Micro', 'Gluten', 'FTIR ID', 'Potency', 'Bacillus Subtilis', 'Allergens', 'Moisture', 'Other',
];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ──────── Request Form ────────
function RequestForm({ initial, labs, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    item_number: '', item_description: '', lot_number: '', product_expiration: '',
    tests_requested: '', lab_id: '', date_sent: '', tat_days: 7,
    expected_results_date: '', requested_by: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Lab Request' : 'New Lab Request'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Item / MO # *</label>
          <input required value={form.item_number} onChange={e => set('item_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. MO01409" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Item Description *</label>
          <input required value={form.item_description} onChange={e => set('item_description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. ProDough Protein Cupcake (Vanilla)" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lot # *</label>
          <input required value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Product Expiration</label>
          <input type="date" value={form.product_expiration || ''} onChange={e => set('product_expiration', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Tests Requested *</label>
          <input required value={form.tests_requested} onChange={e => set('tests_requested', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. HM & Micro & Gluten" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lab</label>
          <select value={form.lab_id || ''} onChange={e => set('lab_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select lab...</option>
            {labs?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date Sent to Lab</label>
          <input type="date" value={form.date_sent || ''} onChange={e => set('date_sent', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">TAT (days)</label>
          <input type="number" min="1" value={form.tat_days || ''} onChange={e => set('tat_days', parseInt(e.target.value) || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Expected Results Date</label>
          <input type="date" value={form.expected_results_date || ''} onChange={e => set('expected_results_date', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Requested By</label>
          <input value={form.requested_by || ''} onChange={e => set('requested_by', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : (initial?.id ? 'Update' : 'Create Request')}
        </button>
      </div>
    </form>
  );
}

// ──────── Request Detail View ────────
function RequestDetail({ requestId, labs, onClose, onRefresh }) {
  const { data: detail, loading, refresh: refreshDetail } = useApiGet(`/coa/requests/${requestId}`, [requestId]);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [resultForm, setResultForm] = useState([{ test_type: '', result_value: '', pass_fail: '', notes: '' }]);

  if (loading || !detail) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  const handleUpdate = async (form) => {
    await apiPut(`/coa/requests/${requestId}`, form);
    setEditing(false);
    refreshDetail();
    onRefresh();
  };

  const handleStatusChange = async (status) => {
    await apiPut(`/coa/requests/${requestId}`, { status });
    refreshDetail();
    onRefresh();
  };

  const handleFileUpload = async (e, fileType) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('file_type', fileType);
      await apiUpload(`/coa/requests/${requestId}/files`, fd);
      refreshDetail();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteFile = async (fileId) => {
    if (!confirm('Delete this file?')) return;
    await apiDelete(`/coa/files/${fileId}`);
    refreshDetail();
  };

  const addResultRow = () => setResultForm(f => [...f, { test_type: '', result_value: '', pass_fail: '', notes: '' }]);

  const handleSaveResults = async () => {
    const valid = resultForm.filter(r => r.test_type);
    if (valid.length === 0) return;
    await apiPost(`/coa/requests/${requestId}/results`, { results: valid });
    setResultForm([{ test_type: '', result_value: '', pass_fail: '', notes: '' }]);
    setShowResults(false);
    refreshDetail();
    onRefresh();
  };

  if (editing) {
    return <RequestForm initial={detail} labs={labs} onSave={handleUpdate} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          <div>
            <h3 className="font-semibold text-gray-900">{detail.item_number} - {detail.item_description}</h3>
            <p className="text-xs text-gray-500">Lot: {detail.lot_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.status} />
          <button onClick={() => setEditing(true)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <Edit2 size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Info grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><span className="text-xs text-gray-500 block">Lab</span><span className="font-medium">{detail.lab_name || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Tests</span><span className="font-medium">{detail.tests_requested}</span></div>
          <div><span className="text-xs text-gray-500 block">Date Sent</span><span className="font-medium">{detail.date_sent || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">TAT</span><span className="font-medium">{detail.tat_days ? `${detail.tat_days} days` : '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Expected Results</span><span className="font-medium">{detail.expected_results_date || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Date of Results</span><span className="font-medium">{detail.date_of_results || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Requested By</span><span className="font-medium">{detail.requested_by || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Expiration</span><span className="font-medium">{detail.product_expiration || '-'}</span></div>
          {detail.invoice_amount != null && (
            <div><span className="text-xs text-gray-500 block">Invoice</span><span className="font-medium">${detail.invoice_amount}</span></div>
          )}
          {detail.retest_required ? (
            <div><span className="text-xs text-gray-500 block">Re-Test</span><span className="font-medium text-orange-600">Required</span></div>
          ) : null}
        </div>

        {detail.notes && (
          <div className="text-sm"><span className="text-xs text-gray-500 block mb-1">Notes</span><p className="text-gray-700">{detail.notes}</p></div>
        )}

        {/* Status actions */}
        <div className="flex flex-wrap gap-2">
          {detail.status === 'pending' && (
            <button onClick={() => handleStatusChange('sent')} className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">Mark as Sent</button>
          )}
          {(detail.status === 'sent' || detail.status === 'pending') && (
            <>
              <button onClick={() => handleStatusChange('pass')} className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100">Mark Pass</button>
              <button onClick={() => handleStatusChange('fail')} className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100">Mark Fail</button>
              <button onClick={() => handleStatusChange('hold')} className="px-3 py-1.5 text-xs font-medium bg-yellow-50 text-yellow-700 rounded-lg hover:bg-yellow-100">Put on Hold</button>
            </>
          )}
          {detail.status === 'fail' && (
            <button onClick={() => handleStatusChange('re_test')} className="px-3 py-1.5 text-xs font-medium bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100">Mark Re-Test</button>
          )}
        </div>

        {/* Test Results */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">Test Results</h4>
            <button onClick={() => setShowResults(!showResults)}
              className="text-xs text-powder-600 hover:text-powder-700 font-medium flex items-center gap-1">
              <Plus size={14} /> Add Results
            </button>
          </div>

          {detail.test_results?.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-2">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Test</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Result</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Pass/Fail</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detail.test_results.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium">{r.test_type}</td>
                      <td className="px-3 py-2">{r.result_value ?? '-'}{r.unit ? ` ${r.unit}` : ''}</td>
                      <td className="px-3 py-2">
                        {r.pass_fail === 'pass' && <span className="text-green-600 font-medium">Pass</span>}
                        {r.pass_fail === 'fail' && <span className="text-red-600 font-medium">Fail</span>}
                        {r.pass_fail === 'na' && <span className="text-gray-400">N/A</span>}
                        {!r.pass_fail && <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{r.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detail.specifications?.length > 0 && (
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium">Specs on file:</span> {detail.specifications.map(s => `${s.test_type} (${s.specification || `${s.min_value ?? ''}–${s.max_value ?? ''}`})`).join(', ')}
            </div>
          )}

          {showResults && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-2">
              {resultForm.map((r, i) => (
                <div key={i} className="grid grid-cols-4 gap-2">
                  <select value={r.test_type} onChange={e => {
                    const next = [...resultForm];
                    next[i] = { ...next[i], test_type: e.target.value };
                    setResultForm(next);
                  }} className="px-2 py-1.5 border border-gray-300 rounded text-xs">
                    <option value="">Test type...</option>
                    {TEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input placeholder="Result value" value={r.result_value} onChange={e => {
                    const next = [...resultForm];
                    next[i] = { ...next[i], result_value: e.target.value };
                    setResultForm(next);
                  }} className="px-2 py-1.5 border border-gray-300 rounded text-xs" />
                  <select value={r.pass_fail} onChange={e => {
                    const next = [...resultForm];
                    next[i] = { ...next[i], pass_fail: e.target.value };
                    setResultForm(next);
                  }} className="px-2 py-1.5 border border-gray-300 rounded text-xs">
                    <option value="">Auto / Manual</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="na">N/A</option>
                  </select>
                  <input placeholder="Notes" value={r.notes} onChange={e => {
                    const next = [...resultForm];
                    next[i] = { ...next[i], notes: e.target.value };
                    setResultForm(next);
                  }} className="px-2 py-1.5 border border-gray-300 rounded text-xs" />
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={addResultRow} className="text-xs text-powder-600 hover:text-powder-700">+ Add Row</button>
                <div className="flex-1" />
                <button onClick={() => setShowResults(false)} className="text-xs text-gray-500">Cancel</button>
                <button onClick={handleSaveResults} className="px-3 py-1 bg-powder-600 text-white text-xs rounded-lg hover:bg-powder-700">Save Results</button>
              </div>
            </div>
          )}
        </div>

        {/* Files */}
        <div>
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Files</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-dashed border-gray-300 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-700 mb-2">Lab Results</p>
              {detail.files?.filter(f => f.file_type === 'lab_results').map(f => (
                <div key={f.id} className="flex items-center gap-2 text-xs mb-1">
                  <FileText size={12} className="text-gray-400" />
                  <a href={`/api/coa/files/${f.id}/download`} className="text-powder-600 hover:underline flex-1 truncate">{f.original_name}</a>
                  <button onClick={() => handleDeleteFile(f.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              ))}
              <label className={`mt-2 inline-flex items-center gap-1 text-xs text-powder-600 hover:text-powder-700 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={12} /> Upload
                <input type="file" className="hidden" onChange={e => handleFileUpload(e, 'lab_results')} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx" />
              </label>
            </div>
            <div className="border border-dashed border-gray-300 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-700 mb-2">Customer COA</p>
              {detail.files?.filter(f => f.file_type === 'customer_coa').map(f => (
                <div key={f.id} className="flex items-center gap-2 text-xs mb-1">
                  <FileText size={12} className="text-gray-400" />
                  <a href={`/api/coa/files/${f.id}/download`} className="text-powder-600 hover:underline flex-1 truncate">{f.original_name}</a>
                  <button onClick={() => handleDeleteFile(f.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              ))}
              <label className={`mt-2 inline-flex items-center gap-1 text-xs text-powder-600 hover:text-powder-700 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={12} /> Upload
                <input type="file" className="hidden" onChange={e => handleFileUpload(e, 'customer_coa')} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx" />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────── Specification Form ────────
function SpecForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    item_number: '', item_description: '', test_type: '', specification: '',
    unit: '', min_value: '', max_value: '', method: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        min_value: form.min_value !== '' ? parseFloat(form.min_value) : null,
        max_value: form.max_value !== '' ? parseFloat(form.max_value) : null,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Specification' : 'Add Specification'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Item # *</label>
          <input required value={form.item_number} onChange={e => set('item_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">Item Description *</label>
          <input required value={form.item_description} onChange={e => set('item_description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Test Type *</label>
          <select value={form.test_type} onChange={e => set('test_type', e.target.value)} required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select...</option>
            {TEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Specification</label>
          <input value={form.specification || ''} onChange={e => set('specification', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. < 10 ppm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Min Value</label>
          <input type="number" step="any" value={form.min_value ?? ''} onChange={e => set('min_value', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max Value</label>
          <input type="number" step="any" value={form.max_value ?? ''} onChange={e => set('max_value', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
          <input value={form.unit || ''} onChange={e => set('unit', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. ppm, CFU/g" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
          <input value={form.method || ''} onChange={e => set('method', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. AOAC 2011.25" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Specification'}
        </button>
      </div>
    </form>
  );
}

// ──────── Lab Form ────────
function LabForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', contact_name: '', contact_email: '', contact_phone: '', address: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(form); } finally { setSaving(false); } }}
      className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Lab' : 'Add Lab'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lab Name *</label>
          <input required value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name</label>
          <input value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={form.contact_email || ''} onChange={e => set('contact_email', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
          <input value={form.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
          <input value={form.address || ''} onChange={e => set('address', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Lab'}
        </button>
      </div>
    </form>
  );
}

// ──────── Main Panel ────────
export default function COAPanel() {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState('requests');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: requests, loading: loadingReqs, refresh: refreshReqs } = useApiGet('/coa/requests' + (statusFilter !== 'all' ? `?status=${statusFilter}` : ''), [statusFilter]);
  const { data: labs, refresh: refreshLabs } = useApiGet('/coa/labs');
  const { data: specs, refresh: refreshSpecs } = useApiGet('/coa/specifications');
  const { data: summary } = useApiGet('/coa/summary');

  const filtered = useMemo(() => {
    if (!requests) return [];
    if (!search) return requests;
    const s = search.toLowerCase();
    return requests.filter(r =>
      r.item_number?.toLowerCase().includes(s) ||
      r.item_description?.toLowerCase().includes(s) ||
      r.lot_number?.toLowerCase().includes(s)
    );
  }, [requests, search]);

  const handleCreateRequest = async (form) => {
    await apiPost('/coa/requests', form);
    setShowForm(false);
    refreshReqs();
  };

  const handleCreateSpec = async (form) => {
    if (editItem?.id) {
      await apiPut(`/coa/specifications/${editItem.id}`, form);
    } else {
      await apiPost('/coa/specifications', form);
    }
    setShowForm(false);
    setEditItem(null);
    refreshSpecs();
  };

  const handleDeleteSpec = async (id) => {
    if (!confirm('Deactivate this specification?')) return;
    await apiDelete(`/coa/specifications/${id}`);
    refreshSpecs();
  };

  const handleCreateLab = async (form) => {
    if (editItem?.id) {
      await apiPut(`/coa/labs/${editItem.id}`, form);
    } else {
      await apiPost('/coa/labs', form);
    }
    setShowForm(false);
    setEditItem(null);
    refreshLabs();
  };

  // Detail view
  if (selectedId) {
    return (
      <div className="space-y-4">
        <RequestDetail requestId={selectedId} labs={labs} onClose={() => setSelectedId(null)} onRefresh={refreshReqs} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary?.totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: 'Total', value: summary.totals.total_requests, color: 'text-gray-900' },
            { label: 'Pending', value: summary.totals.pending, color: 'text-gray-600' },
            { label: 'Sent', value: summary.totals.sent, color: 'text-blue-600' },
            { label: 'Passed', value: summary.totals.passed, color: 'text-green-600' },
            { label: 'Failed', value: summary.totals.failed, color: 'text-red-600' },
            { label: 'Hold', value: summary.totals.on_hold, color: 'text-yellow-600' },
            { label: 'Re-Test', value: summary.totals.retest, color: 'text-orange-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value || 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1">
        {[
          { id: 'requests', label: 'Lab Requests', icon: FlaskConical },
          { id: 'specs', label: 'Specifications', icon: ClipboardList },
          { id: 'labs', label: 'Labs', icon: Building2 },
        ].map(t => (
          <button key={t.id} onClick={() => { setSubTab(t.id); setShowForm(false); setEditItem(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              subTab === t.id ? 'bg-powder-50 text-powder-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ───── Requests Tab ───── */}
      {subTab === 'requests' && (
        <>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item #, description, or lot..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button onClick={() => { setShowForm(true); setEditItem(null); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Plus size={16} /> New Request
            </button>
          </div>

          {showForm && <RequestForm labs={labs} onSave={handleCreateRequest} onCancel={() => setShowForm(false)} />}

          {loadingReqs ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No lab requests found</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Item #</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Description</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Lot</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Tests</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Lab</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Date Sent</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Files</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(r => (
                      <tr key={r.id} onClick={() => setSelectedId(r.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-3 py-2.5 font-medium text-powder-700">{r.item_number}</td>
                        <td className="px-3 py-2.5 text-gray-700 max-w-[200px] truncate">{r.item_description}</td>
                        <td className="px-3 py-2.5 text-gray-600">{r.lot_number}</td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-[120px] truncate">{r.tests_requested}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2.5 text-gray-600">{r.lab_name || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{r.date_sent || '-'}</td>
                        <td className="px-3 py-2.5">
                          {(r.file_counts?.lab_results || r.file_counts?.customer_coa) ? (
                            <span className="text-xs text-powder-600">
                              {r.file_counts.lab_results ? `${r.file_counts.lab_results} lab` : ''}
                              {r.file_counts.lab_results && r.file_counts.customer_coa ? ', ' : ''}
                              {r.file_counts.customer_coa ? `${r.file_counts.customer_coa} COA` : ''}
                            </span>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ───── Specifications Tab ───── */}
      {subTab === 'specs' && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{specs?.length || 0} specifications on file</p>
            <button onClick={() => { setShowForm(true); setEditItem(null); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Plus size={16} /> Add Specification
            </button>
          </div>

          {showForm && (
            <SpecForm initial={editItem} onSave={handleCreateSpec} onCancel={() => { setShowForm(false); setEditItem(null); }} />
          )}

          {specs?.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Item #</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Description</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Test Type</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Specification</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Range</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Unit</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Method</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {specs.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 font-medium">{s.item_number}</td>
                        <td className="px-3 py-2.5 text-gray-700 max-w-[200px] truncate">{s.item_description}</td>
                        <td className="px-3 py-2.5">{s.test_type}</td>
                        <td className="px-3 py-2.5 text-gray-600">{s.specification || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {s.min_value != null || s.max_value != null
                            ? `${s.min_value ?? '–'} to ${s.max_value ?? '–'}`
                            : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{s.unit || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{s.method || '-'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            <button onClick={() => { setEditItem(s); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteSpec(s.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : !showForm && (
            <div className="text-center py-8 text-gray-400">No specifications yet. Add specs per item/test to enable auto pass/fail.</div>
          )}
        </>
      )}

      {/* ───── Labs Tab ───── */}
      {subTab === 'labs' && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{labs?.length || 0} labs configured</p>
            <button onClick={() => { setShowForm(true); setEditItem(null); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Plus size={16} /> Add Lab
            </button>
          </div>

          {showForm && (
            <LabForm initial={editItem} onSave={handleCreateLab} onCancel={() => { setShowForm(false); setEditItem(null); }} />
          )}

          {labs?.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {labs.map(l => (
                <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900">{l.name}</h4>
                      {l.contact_name && <p className="text-xs text-gray-500 mt-1">{l.contact_name}</p>}
                    </div>
                    <button onClick={() => { setEditItem(l); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600">
                      <Edit2 size={14} />
                    </button>
                  </div>
                  {l.contact_email && <p className="text-xs text-gray-500 mt-1">{l.contact_email}</p>}
                  {l.contact_phone && <p className="text-xs text-gray-500">{l.contact_phone}</p>}
                  {l.address && <p className="text-xs text-gray-400 mt-1">{l.address}</p>}
                </div>
              ))}
            </div>
          ) : !showForm && (
            <div className="text-center py-8 text-gray-400">No labs configured yet.</div>
          )}
        </>
      )}
    </div>
  );
}
