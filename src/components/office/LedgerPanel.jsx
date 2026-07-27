import { useState, useMemo, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { usePageTranslation } from '../../lib/usePageTranslation.js';
import LangToggle from '../LangToggle.jsx';
import { Plus, Search, Upload, Paperclip, Trash2, X, RefreshCw, FileText } from 'lucide-react';

// Accounts Payable / Accounts Receivable, one component driven by a ledger
// config — the two sides are the same job with the money pointing the other
// way, and keeping them together means they can't drift apart.
//
// Built for Jake: three KPI cards at the top, one flat editable list under
// them, and a drop zone for a pile of invoice PDFs whose contents become
// searchable.

const AP = {
  key: 'ap',
  title: 'Accounts Payable',
  party: 'vendor',
  partyLabel: 'Vendor',
  paidField: 'amount_paid',
  paidLabel: 'Paid',
  moduleId: 'accounts-payable',
  cards: [
    { key: 'outstanding', label: 'Total amount outstanding', money: true },
    { key: 'past_due', label: 'Past due balance', money: true, alert: true },
    { key: 'pending_count', label: 'Invoices awaiting approval' },
  ],
  statuses: [
    { value: 'draft', label: 'Draft', tone: 'bg-gray-100 text-gray-600' },
    { value: 'awaiting_approval', label: 'Awaiting approval', tone: 'bg-amber-100 text-amber-700' },
    { value: 'approved', label: 'Approved', tone: 'bg-blue-100 text-blue-700' },
    { value: 'scheduled', label: 'Scheduled', tone: 'bg-indigo-100 text-indigo-700' },
    { value: 'paid', label: 'Paid', tone: 'bg-green-100 text-green-700' },
    { value: 'void', label: 'Void', tone: 'bg-gray-100 text-gray-400' },
  ],
  extraFields: [
    { name: 'category', label: 'Category' },
    { name: 'payment_method', label: 'Payment method' },
    { name: 'payment_ref', label: 'Payment ref' },
  ],
};

const AR = {
  key: 'ar',
  title: 'Accounts Receivable',
  party: 'customer',
  partyLabel: 'Customer',
  paidField: 'amount_received',
  paidLabel: 'Received',
  moduleId: 'accounts-receivable',
  cards: [
    { key: 'outstanding', label: 'Total AR outstanding', money: true },
    { key: 'past_due', label: 'Total past due', money: true, alert: true },
    { key: 'pending_count', label: 'Unbilled / pending invoices' },
  ],
  statuses: [
    { value: 'unbilled', label: 'Unbilled', tone: 'bg-amber-100 text-amber-700' },
    { value: 'sent', label: 'Sent', tone: 'bg-blue-100 text-blue-700' },
    { value: 'partial', label: 'Part paid', tone: 'bg-indigo-100 text-indigo-700' },
    { value: 'paid', label: 'Paid', tone: 'bg-green-100 text-green-700' },
    { value: 'void', label: 'Void', tone: 'bg-gray-100 text-gray-400' },
  ],
  extraFields: [],
};

const LEDGER_CONFIGS = { ap: AP, ar: AR };

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

function InvoiceForm({ cfg, initial, onSave, onCancel, tr }) {
  const [form, setForm] = useState(() => ({
    [cfg.party]: '', invoice_number: '', po_number: '', invoice_date: today(),
    due_date: '', terms: '', amount: '', [cfg.paidField]: '', status: cfg.statuses[cfg.key === 'ap' ? 1 : 0].value,
    notes: '', ...(initial || {}),
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const field = (name, label, type = 'text') => (
    <div key={name}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{tr(label)}</label>
      <input type={type} value={form[name] ?? ''} onChange={e => set(name, e.target.value)}
        step={type === 'number' ? '0.01' : undefined}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
    </div>
  );

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{tr(initial?.id ? 'Edit invoice' : 'New invoice')}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        <div className="sm:col-span-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">{tr(cfg.partyLabel)} *</label>
          <input required value={form[cfg.party] ?? ''} onChange={e => set(cfg.party, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        {field('invoice_number', 'Invoice #')}
        {field('po_number', 'PO #')}
        {field('invoice_date', 'Invoice date', 'date')}
        {field('due_date', 'Due date', 'date')}
        {field('terms', 'Terms')}
        {field('amount', 'Amount', 'number')}
        {field(cfg.paidField, cfg.paidLabel, 'number')}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Status')}</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {cfg.statuses.map(s => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
          </select>
        </div>
        {cfg.extraFields.map(f => field(f.name, f.label))}
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">{tr('Notes')}</label>
          <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
          {saving ? tr('Saving…') : tr('Save')}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 text-sm font-medium hover:bg-gray-100 rounded-lg">{tr('Cancel')}</button>
      </div>
    </form>
  );
}

function FilesTab({ cfg, canEdit, tr }) {
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const { data: files, refresh } = useApiGet(`/finance/${cfg.key}/files${q ? `?q=${encodeURIComponent(q)}` : ''}`, [q]);

  const upload = async (fileList) => {
    const list = [...(fileList || [])];
    if (!list.length) return;
    setUploading(true); setError('');
    try {
      const body = new FormData();
      for (const f of list) body.append('files', f);
      const res = await fetch(`/api/finance/${cfg.key}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
      refresh();
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  };

  const open = async (f) => {
    const { url } = await apiFetch(`/finance/${cfg.key}/files/${f.id}/url`);
    window.open(url, '_blank', 'noopener');
  };
  const remove = async (f) => {
    if (!confirm(`Delete ${f.filename}?`)) return;
    await apiFetch(`/finance/${cfg.key}/files/${f.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files); }}
          className="rounded-xl border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center">
          <Upload size={20} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">{tr('Drop invoice files here, or')}{' '}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-powder-700 font-medium hover:underline">{tr('choose files')}</button>
          </p>
          <p className="text-[11px] text-gray-400 mt-1">{tr('Up to 30 files at a time. Contents are read so search finds what is inside the invoice.')}</p>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => upload(e.target.files)} />
          {uploading && <p className="text-xs text-powder-700 mt-2">{tr('Uploading…')}</p>}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Search filenames and invoice contents…')}
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {(files || []).map(f => (
          <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
            <FileText size={15} className="text-gray-400 shrink-0" />
            <button onClick={() => open(f)} className="text-sm text-gray-800 hover:text-powder-700 truncate flex-1 text-left">{f.filename}</button>
            <span className="text-[11px] text-gray-400 shrink-0">{(f.created_at || '').slice(0, 10)}</span>
            {!f.invoice_id && <span className="text-[10px] font-bold text-amber-600 shrink-0">{tr('unlinked')}</span>}
            {canEdit && <button onClick={() => remove(f)} className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>}
          </div>
        ))}
        {(files || []).length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">{tr('No files yet.')}</p>}
      </div>
    </div>
  );
}

export default function LedgerPanel({ ledger }) {
  const cfg = LEDGER_CONFIGS[ledger];
  const { user } = useAuth();
  const canEdit = canEditModule(user, cfg.moduleId);
  const { lang, setLang, tr, translating } = usePageTranslation(useMemo(() => [
    cfg.title, 'Invoices', 'Files', 'New invoice', 'Edit invoice', 'Save', 'Saving…', 'Cancel',
    cfg.partyLabel, 'Invoice #', 'PO #', 'Invoice date', 'Due date', 'Terms', 'Amount', cfg.paidLabel,
    'Status', 'Notes', 'Outstanding', 'Past due', 'Sync with QuickBooks', 'No invoices yet.',
    'Search vendor, invoice #, PO or file contents…', 'Drop invoice files here, or', 'choose files',
    'Up to 30 files at a time. Contents are read so search finds what is inside the invoice.',
    'Search filenames and invoice contents…', 'No files yet.', 'unlinked', 'Uploading…', 'Category',
    'Payment method', 'Payment ref', ...cfg.cards.map(c => c.label), ...cfg.statuses.map(s => s.label),
  ], [cfg]));

  const [tab, setTab] = useState('list');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const listPath = `/finance/${cfg.key}?${new URLSearchParams({ ...(q ? { q } : {}), ...(statusFilter ? { status: statusFilter } : {}) })}`;
  const { data: rows, refresh } = useApiGet(listPath, [q, statusFilter]);
  const { data: summary, refresh: refreshSummary } = useApiGet(`/finance/${cfg.key}/summary`);

  const reload = () => { refresh(); refreshSummary(); };

  const save = async (form) => {
    if (form.id) await apiPut(`/finance/${cfg.key}/${form.id}`, form);
    else await apiPost(`/finance/${cfg.key}`, form);
    setEditing(null);
    reload();
  };
  const remove = async (row) => {
    if (!confirm(`Delete invoice ${row.invoice_number || ''} from ${row[cfg.party]}?`)) return;
    await apiFetch(`/finance/${cfg.key}/${row.id}`, { method: 'DELETE' });
    reload();
  };
  const sync = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await apiPost('/finance/quickbooks/sync', {});
      setSyncMsg(`QuickBooks: ${r.bills.created + r.invoices.created} new, ${r.bills.updated + r.invoices.updated} updated`);
      reload();
    } catch (e) { setSyncMsg(e.message); } finally { setSyncing(false); }
  };

  const cardValue = (c) => (c.money ? money(summary?.[c.key]) : (summary?.[c.key] ?? 0));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">{tr(cfg.title)}</h2>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto max-w-full">
            {[['list', 'Invoices'], ['files', 'Files']].map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{tr(l)}</button>
            ))}
          </div>
          {summary?.quickbooks?.enabled && user?.role === 'admin' && (
            <button onClick={sync} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {tr('Sync with QuickBooks')}
            </button>
          )}
          <LangToggle lang={lang} setLang={setLang} translating={translating} />
        </div>
      </div>

      {syncMsg && <p className="text-xs text-gray-500">{syncMsg}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cfg.cards.map(c => (
          <div key={c.key} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{tr(c.label)}</p>
            <p className={`text-2xl font-bold ${c.alert && Number(summary?.[c.key]) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {cardValue(c)}
            </p>
          </div>
        ))}
      </div>

      {tab === 'files' ? (
        <FilesTab cfg={cfg} canEdit={canEdit} tr={tr} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !editing && (
              <button onClick={() => setEditing({})}
                className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
                <Plus size={16} /> {tr('New invoice')}
              </button>
            )}
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
              <option value="">{tr('Status')}: {tr('All')}</option>
              {cfg.statuses.map(s => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
            </select>
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder={tr('Search vendor, invoice #, PO or file contents…')}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
            </div>
          </div>

          {editing && (
            <InvoiceForm cfg={cfg} initial={editing.id ? editing : null} onSave={save} onCancel={() => setEditing(null)} tr={tr} />
          )}

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {(rows || []).map(r => {
              const st = cfg.statuses.find(s => s.value === r.status) || cfg.statuses[0];
              const overdue = r.due_date && r.due_date < today() && r.status !== 'paid' && r.status !== 'void';
              return (
                <div key={r.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${overdue ? 'border-l-red-400' : 'border-l-gray-200'} p-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{r[cfg.party]}</p>
                      <p className="text-[11px] text-gray-500">{r.invoice_number || '—'} · {tr('Due')} {r.due_date || '—'}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${st.tone}`}>{tr(st.label)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">{money(r.amount - r[cfg.paidField])}</span>
                    <span className="text-[11px] text-gray-400">{money(r.amount)} {tr('total')}</span>
                  </div>
                  {canEdit && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => setEditing(r)} className="text-xs font-medium text-powder-700">{tr('Edit')}</button>
                      <button onClick={() => remove(r)} className="text-xs text-gray-400">{tr('Delete')}</button>
                    </div>
                  )}
                </div>
              );
            })}
            {(rows || []).length === 0 && <p className="text-center py-8 text-sm text-gray-400">{tr('No invoices yet.')}</p>}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-2">{tr(cfg.partyLabel)}</th>
                  <th className="px-3 py-2">{tr('Invoice #')}</th>
                  <th className="px-3 py-2">{tr('Invoice date')}</th>
                  <th className="px-3 py-2">{tr('Due date')}</th>
                  <th className="px-3 py-2 text-right">{tr('Amount')}</th>
                  <th className="px-3 py-2 text-right">{tr(cfg.paidLabel)}</th>
                  <th className="px-3 py-2 text-right">{tr('Outstanding')}</th>
                  <th className="px-3 py-2">{tr('Status')}</th>
                  {canEdit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {(rows || []).map(r => {
                  const st = cfg.statuses.find(s => s.value === r.status) || cfg.statuses[0];
                  const overdue = r.due_date && r.due_date < today() && r.status !== 'paid' && r.status !== 'void';
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {r[cfg.party]}
                        {r.file_id && <Paperclip size={11} className="inline ml-1 text-gray-400" />}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.invoice_number || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.invoice_date || '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{r.due_date || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{money(r.amount)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{money(r[cfg.paidField])}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">{money(r.amount - r[cfg.paidField])}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.tone}`}>{tr(st.label)}</span></td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setEditing(r)} className="px-2 py-1 text-xs font-medium text-powder-700 hover:underline">{tr('Edit')}</button>
                          <button onClick={() => remove(r)} className="p-1 text-gray-300 hover:text-red-500"><X size={13} /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {(rows || []).length === 0 && (
                  <tr><td colSpan={canEdit ? 9 : 8} className="px-4 py-8 text-center text-gray-400">{tr('No invoices yet.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
