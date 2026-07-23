import { useState, useMemo } from 'react';
import { useApiGet, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, BadgeCheck, AlertTriangle, FileText, Pencil, Trash2, X, Search } from 'lucide-react';
import FilePreview from '../FilePreview.jsx';

// Common cert types offered in the form (free text also allowed).
const CERT_TYPES = ['PCQI', 'HACCP', 'SQF Practitioner', 'Food Safety Manager (ServSafe)', 'Internal Auditor', 'First Aid / CPR', 'Forklift Operator', 'Other'];

const STATUS_STYLE = {
  valid: 'bg-green-100 text-green-800',
  expiring: 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-800',
};
const STATUS_LABEL = { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired' };

function CertForm({ initial, people, onClose, onSaved }) {
  const [form, setForm] = useState({
    person_name: initial?.person_name || '', cert_type: initial?.cert_type || 'PCQI',
    issuer: initial?.issuer || '', cert_number: initial?.cert_number || '',
    issued_date: initial?.issued_date || '', expiry_date: initial?.expiry_date || '', notes: initial?.notes || '',
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.person_name.trim() || !form.cert_type.trim()) { setError('Person and certification type are required.'); return; }
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      if (file) fd.append('file', file);
      await apiUpload(initial?.id ? `/certifications/${initial.id}` : '/certifications', fd, initial?.id ? 'PUT' : 'POST');
      onSaved(); onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit certification' : 'Add certification'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Person *</label>
            <input list="cert-people" value={form.person_name} onChange={set('person_name')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Name" />
            <datalist id="cert-people">{(people || []).map(p => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Certification *</label>
            <input list="cert-types" value={form.cert_type} onChange={set('cert_type')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <datalist id="cert-types">{CERT_TYPES.map(t => <option key={t} value={t} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Issuing body</label>
            <input value={form.issuer} onChange={set('issuer')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. FSPCA, NSF" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Certificate #</label>
            <input value={form.cert_number} onChange={set('cert_number')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Issued</label>
            <input type="date" value={form.issued_date} onChange={set('issued_date')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Expires</label>
            <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="text-[11px] text-gray-400 mt-0.5">Leave empty for certs that don't expire.</p>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Certificate file (PDF or photo)</label>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:border-0 file:rounded-lg file:bg-powder-50 file:text-powder-700 file:text-xs file:font-medium" />
          {initial?.has_file && !file && <p className="text-[11px] text-gray-400 mt-0.5">Current file: {initial.filename} — choose a new one to replace it.</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : initial?.id ? 'Update' : 'Add certification'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function CertificationsPanel() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'certifications');
  const { data, refresh } = useApiGet('/certifications');
  const { data: users } = useApiGet('/users');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null | {} (new) | cert (edit)
  const [preview, setPreview] = useState(null); // { url, name }

  const certs = data?.certifications || [];
  const people = useMemo(() => [...new Set([...(users || []).map(u => u.name), ...certs.map(c => c.person_name)])].sort(), [users, certs]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return certs;
    return certs.filter(c => `${c.person_name} ${c.cert_type} ${c.issuer || ''} ${c.cert_number || ''}`.toLowerCase().includes(t));
  }, [certs, q]);
  const byPerson = useMemo(() => {
    const m = new Map();
    for (const c of filtered) { if (!m.has(c.person_name)) m.set(c.person_name, []); m.get(c.person_name).push(c); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);
  const attention = certs.filter(c => c.status !== 'valid').length;

  const openFile = async (c) => {
    try {
      const { url, filename } = await apiFetch(`/certifications/${c.id}/file`);
      setPreview({ url, name: filename });
    } catch (e) { alert(e.message); }
  };
  const del = async (c) => {
    if (!confirm(`Delete ${c.person_name}'s ${c.cert_type} certification?`)) return;
    await apiFetch(`/certifications/${c.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Certifications</h2>
          <p className="text-sm text-gray-500">PCQI, HACCP, and other professional certifications — tracked by person, certificate files attached.</p>
        </div>
        {canEdit && (
          <button onClick={() => setForm({})} className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add certification
          </button>
        )}
      </div>

      {attention > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={16} /> {attention} certification{attention === 1 ? '' : 's'} expired or expiring within 90 days.
        </div>
      )}

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search person or certification…"
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {byPerson.map(([person, list]) => (
          <div key={person} className="bg-white rounded-xl border border-gray-200 p-3.5 shadow-sm">
            <div className="font-semibold text-gray-900 text-sm mb-2">{person}</div>
            <div className="space-y-2">
              {list.map(c => (
                <div key={c.id} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2">
                  <BadgeCheck size={16} className={`shrink-0 mt-0.5 ${c.status === 'expired' ? 'text-red-400' : c.status === 'expiring' ? 'text-amber-500' : 'text-green-600'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">{c.cert_type}</div>
                    <div className="text-[11px] text-gray-400">
                      {[c.issuer, c.cert_number && `#${c.cert_number}`, c.expiry_date ? `expires ${c.expiry_date}` : 'no expiry'].filter(Boolean).join(' · ')}
                    </div>
                    {c.notes && <div className="text-[11px] text-gray-400 italic">{c.notes}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    {c.has_file && <button onClick={() => openFile(c)} className="p-1 text-gray-400 hover:text-powder-600" data-tip="View certificate"><FileText size={13} /></button>}
                    {canEdit && <button onClick={() => setForm(c)} className="p-1 text-gray-400 hover:text-powder-600" data-tip="Edit"><Pencil size={13} /></button>}
                    {canEdit && <button onClick={() => del(c)} className="p-1 text-gray-400 hover:text-red-500" data-tip="Delete"><Trash2 size={13} /></button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {byPerson.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3 bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
            No certifications yet{q ? ` matching “${q}”` : ''}. {canEdit ? 'Add the team’s PCQI / HACCP certificates to start the registry.' : ''}
          </div>
        )}
      </div>

      {form !== null && <CertForm initial={form.id ? form : null} people={people} onClose={() => setForm(null)} onSaved={refresh} />}
      {preview && <FilePreview items={[preview]} index={0} onClose={() => setPreview(null)} />}
    </div>
  );
}
