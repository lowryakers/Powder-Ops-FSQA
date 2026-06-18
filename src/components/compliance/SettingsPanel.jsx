import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Edit2, UserCheck, UserX, Copy } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all features' },
  { value: 'supervisor', label: 'Supervisor', desc: 'All features except settings' },
  { value: 'operator', label: 'Operator', desc: 'Operator view only' },
];

const DEPARTMENTS = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'qa', label: 'QA' },
  { value: 'cleaning', label: 'Cleaning' },
];

function UserForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', email: '', pin: '', role: 'operator', department: 'warehouse' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit User' : 'Add Technician / User'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Adam Bliss" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="adam@powder-ops.com" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">{initial?.id ? 'New PIN (leave blank to keep)' : 'PIN *'}</label>
          <input value={form.pin || ''} onChange={e => setForm({ ...form, pin: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono tracking-widest"
            placeholder="e.g. 1234" maxLength={8} required={!initial?.id} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Role *</label>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Department *</label>
          <select value={form.department || 'warehouse'} onChange={e => setForm({ ...form, department: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.is_contractor} onChange={e => setForm({ ...form, is_contractor: e.target.checked })}
            className="rounded border-gray-300" />
          <span className="font-medium text-gray-700">External Contractor</span>
        </label>
      </div>
      {form.is_contractor && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Company *</label>
            <input value={form.contractor_company || ''} onChange={e => setForm({ ...form, contractor_company: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Company name" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">License #</label>
            <input value={form.contractor_license || ''} onChange={e => setForm({ ...form, contractor_license: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Insurance Expiry</label>
            <input type="date" value={form.contractor_insurance_expiry || ''} onChange={e => setForm({ ...form, contractor_insurance_expiry: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Authorized Scope</label>
            <input value={form.contractor_scope || ''} onChange={e => setForm({ ...form, contractor_scope: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. HVAC, electrical" />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Add User'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function SettingsPanel() {
  const { user: currentUser } = useAuth();
  const { data: users, loading, refresh } = useApiGet('/users');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(false);

  const operatorUrl = `${window.location.origin}/operator`;
  const submitUrl = `${window.location.origin}/submit`;

  const handleCreate = async (form) => {
    await apiPost('/users', { ...form, _actor: currentUser?.name });
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/users/${editing.id}`, { ...form, _actor: currentUser?.name });
    setEditing(null);
    refresh();
  };

  const handleToggleActive = async (user) => {
    await apiPut(`/users/${user.id}`, { is_active: !user.is_active, _actor: currentUser?.name });
    refresh();
  };

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-8">
      {/* Technicians Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Technicians & Users</h2>
            <p className="text-sm text-gray-500">Manage who can access the platform</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add User
          </button>
        </div>

        {(showForm && !editing) && <UserForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}
        {editing && <UserForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Dept</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map(u => (
                <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{u.name}</span>
                    {u.is_contractor ? (
                      <span className="ml-2 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold">CONTRACTOR</span>
                    ) : null}
                    {u.contractor_company && <div className="text-[10px] text-gray-400">{u.contractor_company}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-red-100 text-red-800' : u.role === 'supervisor' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.department === 'qa' ? 'bg-teal-100 text-teal-700' : u.department === 'cleaning' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      {u.department === 'qa' ? 'QA' : u.department === 'cleaning' ? 'Cleaning' : 'Warehouse'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right flex gap-1 justify-end">
                    <button onClick={() => { setEditing(u); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleToggleActive(u)} className="text-gray-400 hover:text-gray-700" title={u.is_active ? 'Disable' : 'Enable'}>
                      {u.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Links Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Shareable Links</h2>
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Operator View</h3>
                <p className="text-sm text-gray-500">Simplified task-only view for technicians. Share this link or set it as the default on shop floor devices.</p>
                <code className="text-xs text-powder-600 mt-1 block">{operatorUrl}</code>
              </div>
              <button onClick={() => copyUrl(operatorUrl)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1">
                <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Work Order Submission</h3>
                <p className="text-sm text-gray-500">Public form for anyone to submit a work order. Accessible via QR code — no login required.</p>
                <code className="text-xs text-powder-600 mt-1 block">{submitUrl}</code>
              </div>
              <button onClick={() => copyUrl(submitUrl)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1">
                <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
