import { useState, useMemo, useEffect } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete, apiUpload, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, Search, FileText, Upload, Download, Trash2, Edit2, FlaskConical, Building2, ClipboardList, CheckCircle2, X, PackageSearch, AlertTriangle, ChevronUp, ChevronDown, CheckSquare, Square } from 'lucide-react';

// Typed-confirmation dialog for permanent, irreversible bulk deletion.
function ConfirmDeleteModal({ count, onConfirm, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = text.trim().toUpperCase() === 'DELETE';
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center gap-2 text-red-600"><Trash2 size={18} /><h3 className="font-semibold">Permanently delete {count} lab request{count === 1 ? '' : 's'}</h3></div>
        <p className="text-sm text-gray-600">This removes the selected request{count === 1 ? '' : 's'}, their test results, and attached files for good. This cannot be undone. Type <span className="font-mono font-semibold">DELETE</span> to confirm.</p>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="DELETE" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus />
        <div className="flex items-center gap-2">
          <button disabled={!ok || busy} onClick={go} className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-40">{busy ? 'Deleting…' : `Delete ${count} permanently`}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

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
  'Total Aerobic Microbial Count (USP)', 'Total Coliforms (BAM) (MOD)', 'E. Coli BAM (MOD)',
  'Salmonella', 'Staphylococcus aureus <2022>', 'Rapid Yeast and Mold',
  'Arsenic', 'Cadmium', 'Mercury', 'Lead',
  'Gluten', 'FTIR ID', 'Potency', 'Bacillus Subtilis', 'Allergens', 'Moisture', 'Other',
];

// Left-edge accent for the mobile cards, keyed to status.
const statusStripe = (s) => ({
  pass: 'border-l-green-500', fail: 'border-l-red-500', hold: 'border-l-yellow-500',
  sent: 'border-l-blue-500', re_test: 'border-l-orange-500',
}[s] || 'border-l-gray-300');

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function SortHeader({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-900"
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

// ──────── Lot Lookup ────────
function LotLookup() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/coa/lot-lookup?lot=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      setResult(await res.json());
    } catch { setResult({ error: 'Search failed' }); }
    finally { setSearching(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Vendor Lot Lookup</h3>
        <p className="text-sm text-gray-500 mb-3">Check if an incoming lot has already been tested. Enter any lot number (internal, manufacturer, or vendor lot).</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Enter lot number..."
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <button onClick={handleSearch} disabled={searching || !query.trim()}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {searching ? 'Searching...' : 'Look Up'}
          </button>
        </div>
      </div>

      {result && !result.error && (
        <div className={`rounded-xl border-2 p-4 ${
          result.failed ? 'border-red-300 bg-red-50' :
          result.passed ? 'border-green-300 bg-green-50' :
          result.tested ? 'border-blue-300 bg-blue-50' :
          'border-yellow-300 bg-yellow-50'
        }`}>
          <div className="flex items-start gap-3">
            {result.passed && !result.failed && <CheckCircle2 size={24} className="text-green-600 flex-shrink-0 mt-0.5" />}
            {result.failed && <AlertTriangle size={24} className="text-red-600 flex-shrink-0 mt-0.5" />}
            {!result.tested && <PackageSearch size={24} className="text-yellow-600 flex-shrink-0 mt-0.5" />}
            {result.tested && !result.passed && !result.failed && <FlaskConical size={24} className="text-blue-600 flex-shrink-0 mt-0.5" />}
            <div>
              <p className={`font-semibold ${
                result.failed ? 'text-red-800' : result.passed ? 'text-green-800' : result.tested ? 'text-blue-800' : 'text-yellow-800'
              }`}>{result.recommendation}</p>
              <p className="text-sm text-gray-600 mt-1">{result.total_matches} matching test record{result.total_matches !== 1 ? 's' : ''} found</p>
            </div>
          </div>

          {result.matches?.length > 0 && (
            <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Item #</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Description</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Lot</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Tests</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Status</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.matches.map(m => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{m.item_number}</td>
                      <td className="px-3 py-2 text-gray-700 w-full">{m.item_description}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{m.lot_number}</td>
                      <td className="px-3 py-2 text-gray-600">{m.tests_requested}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={m.status} /></td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{m.date_sent || m.date_of_results || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────── COA Upload & Parse ────────
function COAUploadModal({ onClose, onImported }) {
  const [step, setStep] = useState('upload'); // upload | review | saving
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleUpload = async () => {
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/coa/parse-coa', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Parse failed');
      const data = await res.json();
      setUploadedFile(data._uploaded_file);
      const fields = { ...data };
      delete fields.raw_text;
      delete fields.page_count;
      delete fields._uploaded_file;
      setParsed(data);
      setForm(fields);
      setStep('review');
    } catch (e) { setError(e.message); }
    finally { setParsing(false); }
  };

  const handleImport = async () => {
    setStep('saving');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/coa/import-parsed-coa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ parsed: form, uploaded_file: uploadedFile }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Import failed');
      onImported();
    } catch (e) { setError(e.message); setStep('review'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Upload size={18} /> Upload Lab COA (PDF)
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>

        {step === 'upload' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">Upload a COA PDF from CTLA or any lab. The system will extract product info, lot numbers, test results, and pass/fail status automatically.</p>
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
              <input type="file" accept=".pdf" onChange={e => setFile(e.target.files[0])} className="hidden" id="coa-upload-input" />
              <label htmlFor="coa-upload-input" className="cursor-pointer">
                <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600">{file ? file.name : 'Click to select a PDF file'}</p>
                <p className="text-xs text-gray-400 mt-1">Supports CTLA and standard lab report formats</p>
              </label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleUpload} disabled={!file || parsing}
                className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
                {parsing ? 'Parsing PDF...' : 'Parse & Extract'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600">Review the extracted data below. Edit any fields before importing into your log.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                ['item_description', 'Product Name'],
                ['item_number', 'Item / Product #'],
                ['lot_number', 'Lot #'],
                ['manufacturer_lot', 'Manufacturer Lot'],
                ['vendor_lot', 'Vendor Lot'],
                ['supplier', 'Supplier'],
                ['origin', 'Origin'],
                ['product_code', 'Product Code'],
                ['received_date', 'Received Date'],
                ['product_expiration', 'Expiration Date'],
                ['date_of_results', 'Results Date'],
                ['tests_requested', 'Tests Requested'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                  <input value={form[key] || ''} onChange={e => set(key, e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg text-sm ${form[key] ? 'border-green-300 bg-green-50' : 'border-gray-300'}`} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Overall Status</label>
                <select value={form.status || 'pending'} onChange={e => set('status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>

            {form.test_results?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Extracted Test Results ({form.test_results.length})</h4>
                <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Test</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Result</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Unit</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Pass/Fail</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {form.test_results.map((tr, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">
                            <input value={tr.test_type} onChange={e => {
                              const updated = [...form.test_results];
                              updated[i] = { ...updated[i], test_type: e.target.value };
                              set('test_results', updated);
                            }} className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                          </td>
                          <td className="px-3 py-2">
                            <input value={tr.result_value || ''} onChange={e => {
                              const updated = [...form.test_results];
                              updated[i] = { ...updated[i], result_value: e.target.value };
                              set('test_results', updated);
                            }} className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                          </td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{tr.unit || '-'}</td>
                          <td className="px-3 py-2">
                            <select value={tr.pass_fail || ''} onChange={e => {
                              const updated = [...form.test_results];
                              updated[i] = { ...updated[i], pass_fail: e.target.value };
                              set('test_results', updated);
                            }} className="px-2 py-1 border border-gray-200 rounded text-xs">
                              <option value="">-</option>
                              <option value="pass">Pass</option>
                              <option value="fail">Fail</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => {
                              const updated = form.test_results.filter((_, j) => j !== i);
                              set('test_results', updated);
                            }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {parsed?.raw_text && (
              <details className="text-xs">
                <summary className="text-gray-500 cursor-pointer">View raw extracted text</summary>
                <pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{parsed.raw_text}</pre>
              </details>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => setStep('upload')} className="px-3 py-2 text-sm text-gray-600">Back</button>
              <button onClick={handleImport}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                Import to Log
              </button>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="p-8 text-center text-gray-500">Importing to COA log...</div>
        )}
      </div>
    </div>
  );
}

// ──────── Request Form ────────
function RequestForm({ initial, labs, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    item_number: '', item_description: '', lot_number: '', product_expiration: '',
    tests_requested: '', lab_id: '', date_sent: '', tat_days: 7,
    expected_results_date: '', requested_by: '', notes: '',
    origin: '', supplier: '', product_code: '', manufacturer_lot: '', vendor_lot: '', received_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [specInfo, setSpecInfo] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Pull the material spec for this item and pre-fill the test panel, so tests
  // aren't re-typed. Results then auto pass/fail against this spec (server side).
  const loadSpec = async (itemNum) => {
    const item = String(itemNum ?? form.item_number).trim();
    if (!item) { setSpecInfo(null); return; }
    try {
      const specs = await apiFetch(`/coa/specifications?item_number=${encodeURIComponent(item)}`);
      if (Array.isArray(specs) && specs.length) {
        const tests = [...new Set(specs.map(s => s.test_type))];
        const meta = specs[0];
        setSpecInfo({ count: specs.length, tests, sku: meta.sku_number, vendor: meta.vendor, revision: meta.revision, item_description: meta.item_description });
        setForm(f => ({
          ...f,
          tests_requested: f.tests_requested?.trim() ? f.tests_requested : tests.join(', '),
          item_description: f.item_description?.trim() ? f.item_description : (meta.item_description || ''),
        }));
      } else {
        setSpecInfo({ count: 0 });
      }
    } catch { setSpecInfo(null); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Lab Request' : 'New Lab Request'}</h3>
      {specInfo?.count > 0 && (
        <div className="text-[12px] text-powder-800 bg-powder-50 border border-powder-100 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <span>Spec on file{specInfo.revision ? ` (${specInfo.revision})` : ''}{specInfo.vendor ? ` · ${specInfo.vendor}` : ''} — {specInfo.count} test{specInfo.count === 1 ? '' : 's'}. Results will auto pass/fail against it.</span>
          <button type="button" onClick={() => setForm(f => ({ ...f, tests_requested: specInfo.tests.join(', ') }))} className="text-powder-600 hover:underline font-medium shrink-0">Reload tests</button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Item / MO # *</label>
          <input required value={form.item_number} onChange={e => set('item_number', e.target.value)} onBlur={() => loadSpec()}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. MO01409" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Item Description *</label>
          <input required value={form.item_description} onChange={e => set('item_description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. ProDough Protein Cupcake (Vanilla)" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Product Code</label>
          <input value={form.product_code || ''} onChange={e => set('product_code', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lot # *</label>
          <input required value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manufacturer Lot #</label>
          <input value={form.manufacturer_lot || ''} onChange={e => set('manufacturer_lot', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Vendor Lot</label>
          <input value={form.vendor_lot || ''} onChange={e => set('vendor_lot', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Supplier</label>
          <input value={form.supplier || ''} onChange={e => set('supplier', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Honeyville" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Origin</label>
          <input value={form.origin || ''} onChange={e => set('origin', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. United States" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Received Date</label>
          <input type="date" value={form.received_date || ''} onChange={e => set('received_date', e.target.value)}
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

  const downloadPdf = async () => {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`/api/coa/requests/${requestId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `COA-${requestId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
            <p className="text-xs text-gray-500">Lot: {detail.lot_number}{detail.manufacturer_lot ? ` | Mfg Lot: ${detail.manufacturer_lot}` : ''}{detail.vendor_lot ? ` | Vendor: ${detail.vendor_lot}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.status} />
          <button onClick={downloadPdf}
            className="p-1.5 text-gray-400 hover:text-powder-600 rounded-lg hover:bg-gray-100" title="Export Powder Ops COA PDF">
            <Download size={14} />
          </button>
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
          <div><span className="text-xs text-gray-500 block">Supplier</span><span className="font-medium">{detail.supplier || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Origin</span><span className="font-medium">{detail.origin || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Product Code</span><span className="font-medium">{detail.product_code || detail.item_number}</span></div>
          <div><span className="text-xs text-gray-500 block">Mfg Lot #</span><span className="font-medium">{detail.manufacturer_lot || detail.lot_number}</span></div>
          <div><span className="text-xs text-gray-500 block">Vendor Lot</span><span className="font-medium">{detail.vendor_lot || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Received</span><span className="font-medium">{detail.received_date || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Date Sent</span><span className="font-medium">{detail.date_sent || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">TAT</span><span className="font-medium">{detail.tat_days ? `${detail.tat_days} days` : '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Date of Results</span><span className="font-medium">{detail.date_of_results || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Expiration</span><span className="font-medium">{detail.product_expiration || '-'}</span></div>
          <div><span className="text-xs text-gray-500 block">Requested By</span><span className="font-medium">{detail.requested_by || '-'}</span></div>
          {detail.certificate_number && (
            <div><span className="text-xs text-gray-500 block">Certificate #</span><span className="font-medium">{detail.certificate_number}</span></div>
          )}
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

        {/* Status actions + PDF export */}
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
          <button onClick={downloadPdf}
            className="px-3 py-1.5 text-xs font-medium bg-powder-50 text-powder-700 rounded-lg hover:bg-powder-100 flex items-center gap-1">
            <Download size={12} /> Export Powder Ops COA
          </button>
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
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.test_type}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.result_value ?? '-'}{r.unit ? ` ${r.unit}` : ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.pass_fail === 'pass' && <span className="text-green-600 font-medium">Pass</span>}
                        {r.pass_fail === 'fail' && <span className="text-red-600 font-medium">Fail</span>}
                        {r.pass_fail === 'na' && <span className="text-gray-400">N/A</span>}
                        {!r.pass_fail && <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 w-full">{r.notes || '-'}</td>
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
                  <input placeholder="Method (e.g. USP &lt;2021&gt;)" value={r.notes} onChange={e => {
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
          <div>
            <div className="border border-dashed border-gray-300 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-700 mb-2">Lab Results (from CTLA)</p>
              {detail.files?.filter(f => f.file_type === 'lab_results').map(f => (
                <div key={f.id} className="flex items-center gap-2 text-xs mb-1">
                  <FileText size={12} className="text-gray-400" />
                  <a href={`/api/coa/files/${f.id}/download`} className="text-powder-600 hover:underline flex-1 truncate">{f.original_name}</a>
                  <button onClick={() => handleDeleteFile(f.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              ))}
              <label className={`mt-2 inline-flex items-center gap-1 text-xs text-powder-600 hover:text-powder-700 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={12} /> Upload Lab Results
                <input type="file" className="hidden" onChange={e => handleFileUpload(e, 'lab_results')} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx" />
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
    sku_number: '', vendor: '', revision: '',
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
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Item Description *</label>
          <input required value={form.item_description} onChange={e => set('item_description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">SKU Number</label>
          <input value={form.sku_number || ''} onChange={e => set('sku_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
          <input value={form.vendor || ''} onChange={e => set('vendor', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Revision</label>
          <input value={form.revision || ''} onChange={e => set('revision', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. V1" />
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. NMT 1.0" />
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. ppm, cfu/g" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
          <input value={form.method || ''} onChange={e => set('method', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. USP <2021>" />
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
// ──────── Material Requirements (Form 607-01 sections 2–5) ────────
const MAT_607_DEFAULTS = {
  packaging: 'The product shall be packaged and transported in containers secured to protect the contents from extraneous materials and from loss under normal handling, shipment and storage. Packaging materials shall not transmit contaminants or objectionable substances to the product.',
  labeling: 'Each container is to be clearly labeled with: Product name, Manufacturer, Date Manufactured, Batch Number, and Net Weight.',
  desiccant: 'Label each container with a brightly colored sticker stating "desiccant included" if desiccant is added to the container.',
  storage: 'All products shall be stored and protected from foreign odors, moisture, contaminants, and light.',
  handling: 'Refer to the Material Safety Data Sheet.',
  safety: 'Refer to the Material Safety Data Sheet.',
  acceptance_criteria: 'A Certificate of Analysis (COA) is required with each batch. All incoming batches shall be sampled for full testing and released according to the specification results. No damaged or improperly labeled containers are acceptable. Material missing a COA is not acceptable and will not be received in the facility.',
  retest_panel: 'Organoleptic, Identification, APC, and Yeast & Mold',
  treatment_note: 'If treatment is necessary to meet the microbiology specifications, the process used must be noted on the COA. Ethylene oxide and gamma irradiation are not allowed processes.',
};
const MAT_SECTIONS = [
  { key: 'packaging', label: 'Packaging' },
  { key: 'labeling', label: 'Labeling' },
  { key: 'desiccant', label: 'Desiccant Requirements' },
  { key: 'storage', label: 'Storage' },
  { key: 'handling', label: 'Handling' },
  { key: 'safety', label: 'Safety' },
  { key: 'acceptance_criteria', label: 'Acceptance Criteria' },
  { key: 'treatment_note', label: 'Treatment (microbiology)' },
];

function MaterialSpecModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiFetch(`/coa/material-spec?item_number=${encodeURIComponent(item.item_number)}`)
      .then(existing => setForm(existing || { item_number: item.item_number, common_name: item.item_description || '', ...MAT_607_DEFAULTS }))
      .catch(() => setForm({ item_number: item.item_number, common_name: item.item_description || '', ...MAT_607_DEFAULTS }));
  }, [item.item_number, item.item_description]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await apiPut('/coa/material-spec', { ...form, item_number: item.item_number }); onSaved?.(); onClose(); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-6 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Material Requirements — {item.item_number}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">Form 607-01 sections 2–5 for this material. Prefilled with the standard text — edit as needed per material.</p>
        {form === null ? <p className="text-sm text-gray-400 py-6 text-center">Loading…</p> : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className="block text-xs font-medium text-gray-700 mb-1">Common Name</label><input value={form.common_name || ''} onChange={e => set('common_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label><input value={form.vendor || ''} onChange={e => set('vendor', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-700 mb-1">Max Shelf Life</label><input value={form.max_shelf_life || ''} onChange={e => set('max_shelf_life', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 2 years" /></div>
            </div>
            {MAT_SECTIONS.map(s => (
              <div key={s.key}>
                <label className="block text-xs font-medium text-gray-700 mb-1">{s.label}</label>
                <textarea value={form[s.key] || ''} onChange={e => set(s.key, e.target.value)} rows={2} spellCheck="true" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            ))}
            <div><label className="block text-xs font-medium text-gray-700 mb-1">Retest Panel</label><input value={form.retest_panel || ''} onChange={e => set('retest_panel', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving || form === null} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save requirements'}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function COAPanel() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'coa');
  const isAdmin = user?.role === 'admin';
  const [subTab, setSubTab] = useState('requests');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [matReqItem, setMatReqItem] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showUploadCoa, setShowUploadCoa] = useState(false);
  const [sortField, setSortField] = useState('date_sent');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [msg, setMsg] = useState(null);

  const { data: requests, loading: loadingReqs, refresh: refreshReqs } = useApiGet('/coa/requests' + (statusFilter !== 'all' ? `?status=${statusFilter}` : ''), [statusFilter]);
  const { data: labs, refresh: refreshLabs } = useApiGet('/coa/labs');
  const { data: specs, refresh: refreshSpecs } = useApiGet('/coa/specifications');
  const { data: summary, refresh: refreshSummary } = useApiGet('/coa/summary');

  const filtered = useMemo(() => {
    if (!requests) return [];
    let list = requests;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r =>
        r.item_number?.toLowerCase().includes(s) ||
        r.item_description?.toLowerCase().includes(s) ||
        r.lot_number?.toLowerCase().includes(s) ||
        r.manufacturer_lot?.toLowerCase().includes(s) ||
        r.vendor_lot?.toLowerCase().includes(s) ||
        r.supplier?.toLowerCase().includes(s)
      );
    }
    list = [...list].sort((a, b) => {
      const av = (a[sortField] || '').toString().toLowerCase();
      const bv = (b[sortField] || '').toString().toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [requests, search, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleCreateRequest = async (form) => {
    await apiPost('/coa/requests', form);
    setShowForm(false);
    refreshReqs();
    refreshSummary();
  };

  // --- Bulk selection (Lab Requests) ---
  const visibleIds = filtered.map(r => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev);
    if (allVisibleSelected) visibleIds.forEach(id => n.delete(id));
    else visibleIds.forEach(id => n.add(id));
    return n;
  });
  const clearSelection = () => setSelected(new Set());
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };

  const handleBulkStatus = async (status) => {
    if (!status) return;
    const res = await apiPost('/coa/requests/bulk-update', { ids: [...selected], patch: { status } });
    setBulkStatus(''); clearSelection(); flash(`Updated ${res.updated} request${res.updated === 1 ? '' : 's'}.`); refreshReqs(); refreshSummary();
  };
  const handleBulkDelete = async () => {
    const res = await apiPost('/coa/requests/bulk-delete', { ids: [...selected] });
    setConfirmDelete(false); clearSelection(); flash(`Permanently deleted ${res.deleted} request${res.deleted === 1 ? '' : 's'}.`); refreshReqs(); refreshSummary();
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

  if (selectedId) {
    return (
      <div className="space-y-4">
        <RequestDetail requestId={selectedId} labs={labs} onClose={() => setSelectedId(null)} onRefresh={() => { refreshReqs(); refreshSummary(); }} />
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
      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1 overflow-x-auto">
        {[
          { id: 'requests', label: 'Lab Requests', icon: FlaskConical },
          { id: 'lot-lookup', label: 'Lot Lookup', icon: PackageSearch },
          { id: 'specs', label: 'Specifications', icon: ClipboardList },
          { id: 'labs', label: 'Labs', icon: Building2 },
        ].map(t => (
          <button key={t.id} onClick={() => { setSubTab(t.id); setShowForm(false); setEditItem(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
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
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item #, description, lot, supplier..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button onClick={() => setShowUploadCoa(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
              <Upload size={16} /> Upload COA
            </button>
            <button onClick={() => { setShowForm(true); setEditItem(null); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Plus size={16} /> New Request
            </button>
          </div>

          {showUploadCoa && (
            <COAUploadModal labs={labs} onClose={() => setShowUploadCoa(false)}
              onImported={() => { setShowUploadCoa(false); refreshReqs(); refreshSummary(); }} />
          )}

          {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-2">{msg}</div>}

          {canEdit && selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap bg-powder-50 border border-powder-200 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-powder-800">{selected.size} selected</span>
              <div className="flex-1" />
              <select value={bulkStatus} onChange={e => handleBulkStatus(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">Set status…</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              {isAdmin && (
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"><Trash2 size={14} /> Delete permanently</button>
              )}
              <button onClick={clearSelection} className="px-3 py-1.5 text-gray-500 text-sm font-medium rounded-lg hover:bg-gray-100">Clear</button>
            </div>
          )}

          {showForm && <RequestForm labs={labs} onSave={handleCreateRequest} onCancel={() => setShowForm(false)} />}

          {loadingReqs ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No lab requests found</div>
          ) : (
            <>
            {/* Mobile: card list (search + status filter above still apply) */}
            <div className="md:hidden space-y-2">
              {filtered.map(r => (
                <div key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`bg-white rounded-xl border border-gray-200 border-l-4 ${statusStripe(r.status)} p-3 active:bg-gray-50 ${selected.has(r.id) ? 'ring-2 ring-powder-300' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-powder-700 text-sm">{r.item_number}</div>
                      <div className="text-gray-800 text-sm leading-snug">{r.item_description}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={r.status} />
                      {canEdit && (
                        <button onClick={e => { e.stopPropagation(); toggleOne(r.id); }} className="text-gray-300 hover:text-powder-600" title={selected.has(r.id) ? 'Deselect' : 'Select'}>
                          {selected.has(r.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                    {r.lot_number && <span>Lot <span className="font-medium text-gray-700">{r.lot_number}</span></span>}
                    {r.tests_requested && <span>{r.tests_requested}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
                    {r.lab_name && <span>{r.lab_name}</span>}
                    {r.date_sent && <span>Sent {r.date_sent}</span>}
                    {r.file_counts?.lab_results ? <span className="text-powder-600">{r.file_counts.lab_results} lab file{r.file_counts.lab_results > 1 ? 's' : ''}</span> : null}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: full table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {canEdit && (
                        <th className="px-3 py-2.5 w-8">
                          <button onClick={toggleAll} className="text-gray-400 hover:text-powder-600 align-middle" title={allVisibleSelected ? 'Deselect all' : 'Select all'}>
                            {allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                        </th>
                      )}
                      <SortHeader label="Item #" field="item_number" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Description" field="item_description" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Lot" field="lot_number" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Tests" field="tests_requested" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Lab" field="lab_name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Date Sent" field="date_sent" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Files</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(r => (
                      <tr key={r.id} onClick={() => setSelectedId(r.id)}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${selected.has(r.id) ? 'bg-powder-50' : ''}`}>
                        {canEdit && (
                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <button onClick={() => toggleOne(r.id)} className="text-gray-400 hover:text-powder-600 align-middle" title={selected.has(r.id) ? 'Deselect' : 'Select'}>
                              {selected.has(r.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
                            </button>
                          </td>
                        )}
                        <td className="px-3 py-2.5 font-medium text-powder-700 whitespace-nowrap">{r.item_number}</td>
                        <td className="px-3 py-2.5 text-gray-700 w-full">{r.item_description}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.lot_number}</td>
                        <td className="px-3 py-2.5 text-gray-600">{r.tests_requested}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.lab_name || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.date_sent || '-'}</td>
                        <td className="px-3 py-2.5">
                          {r.file_counts?.lab_results ? (
                            <span className="text-xs text-powder-600">{r.file_counts.lab_results} lab</span>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}
        </>
      )}

      {/* ───── Lot Lookup Tab ───── */}
      {subTab === 'lot-lookup' && <LotLookup />}

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
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">{s.item_number}</td>
                        <td className="px-3 py-2.5 text-gray-700 w-full">{s.item_description}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{s.test_type}</td>
                        <td className="px-3 py-2.5 text-gray-600">{s.specification || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                          {s.min_value != null || s.max_value != null
                            ? `${s.min_value ?? '–'} to ${s.max_value ?? '–'}`
                            : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{s.unit || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{s.method || '-'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            <button onClick={() => setMatReqItem({ item_number: s.item_number, item_description: s.item_description })} title="Material requirements (607-01)" className="p-1 text-gray-400 hover:text-powder-600"><ClipboardList size={14} /></button>
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

      {matReqItem && <MaterialSpecModal item={matReqItem} onClose={() => setMatReqItem(null)} onSaved={refreshSpecs} />}

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

      {confirmDelete && (
        <ConfirmDeleteModal count={selected.size} onConfirm={handleBulkDelete} onClose={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}
