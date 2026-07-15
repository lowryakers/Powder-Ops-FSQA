import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Edit2, UserCheck, UserX, Copy, Shield, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all features' },
  { value: 'supervisor', label: 'Supervisor', desc: 'All features except settings' },
  { value: 'operator', label: 'Operator', desc: 'Operator view only' },
  { value: 'auditor', label: 'Auditor', desc: 'Read-only compliance view' },
];

const DEPARTMENTS = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'qa', label: 'QA' },
  { value: 'document_control', label: 'Document Control' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'production', label: 'Production' },
  { value: 'maintenance', label: 'Maintenance' },
];
const deptLabel = (d) => DEPARTMENTS.find(x => x.value === d)?.label || (d ? d.charAt(0).toUpperCase() + d.slice(1) : 'Warehouse');

const MODULE_GROUPS = [
  {
    label: 'Overview',
    modules: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'operator', label: 'Operator View' },
    ],
  },
  {
    label: 'Production',
    modules: [
      { id: 'production-log', label: 'Production Log' },
      { id: 'production-schedule', label: 'Schedule' },
      { id: 'production-dashboard', label: 'Production KPIs' },
    ],
  },
  {
    label: 'Maintenance',
    modules: [
      { id: 'pm', label: 'Task Center' },
      { id: 'equipment', label: 'Equipment' },
      { id: 'calibration', label: 'Calibration' },
      { id: 'loto', label: 'Lockout / Tagout' },
    ],
  },
  {
    label: 'Quality & Safety',
    modules: [
      { id: 'sanitation', label: 'Sanitation' },
      { id: 'chemicals', label: 'Chemicals' },
      { id: 'hygienic', label: 'Hygienic Design' },
      { id: 'coa', label: 'COA / Lab Testing' },
    ],
  },
  {
    label: 'Compliance',
    modules: [
      { id: 'capa', label: 'CAPA / Complaints' },
      { id: 'sops', label: 'SOP Registry' },
      { id: 'work-instructions', label: 'Work Instructions' },
      { id: 'job-descriptions', label: 'Job Descriptions' },
      { id: 'org-chart', label: 'Org Chart' },
      { id: 'disposals', label: 'Disposals' },
      { id: 'training', label: 'Training Records' },
      { id: 'recall', label: 'Mock Recall' },
    ],
  },
  {
    label: 'Quality Records',
    modules: [
      { id: 'dcr', label: 'Document Change Requests' },
      { id: 'deviations', label: 'Deviations' },
      { id: 'non-conformance', label: 'Non-Conformance' },
      { id: 'on-hold', label: 'On Hold' },
      { id: 'component-signout', label: 'Component Sign In/Out' },
      { id: 'organoleptic', label: 'Organoleptic Sensory' },
      { id: 'knife-accountability', label: 'Knife / Blade Accountability' },
    ],
  },
];

const ALL_MODULE_IDS = MODULE_GROUPS.flatMap(g => g.modules.map(m => m.id));

// Normalize any stored form (null / legacy array / object) into a level map
function normalizeAccess(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return Object.fromEntries(value.map(id => [id, 'edit']));
  return value;
}

function ModuleAccessEditor({ value, onChange, disabled }) {
  const map = normalizeAccess(value);
  const allAccess = map == null; // null = full access to everything

  const levelOf = (id) => {
    if (allAccess) return 'edit';
    return map[id] || 'none';
  };

  const setLevel = (id, level) => {
    if (disabled) return;
    const base = allAccess ? Object.fromEntries(ALL_MODULE_IDS.map(m => [m, 'edit'])) : { ...map };
    if (level === 'none') delete base[id];
    else base[id] = level;
    // Collapse back to "all access" if every module is set to Edit
    const isAllEdit = ALL_MODULE_IDS.every(m => base[m] === 'edit');
    onChange(isAllEdit ? null : base);
  };

  const toggleAll = () => {
    if (disabled) return;
    onChange(allAccess ? {} : null); // {} = no access to anything
  };

  const LEVELS = [
    { value: 'none', label: 'None' },
    { value: 'view', label: 'View' },
    { value: 'edit', label: 'Edit' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-700">Module Access</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={allAccess} onChange={toggleAll} disabled={disabled}
            className="rounded border-gray-300 text-powder-600" />
          Full access (all modules)
        </label>
      </div>
      {!allAccess && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 max-h-72 overflow-y-auto space-y-3">
          <p className="text-[11px] text-gray-500">Set each module to <strong>None</strong> (hidden), <strong>View</strong> (read-only), or <strong>Edit</strong>.</p>
          {MODULE_GROUPS.map(group => (
            <div key={group.label} className="space-y-1">
              <div className="text-[10px] font-bold uppercase text-gray-500">{group.label}</div>
              {group.modules.map(mod => {
                const lvl = levelOf(mod.id);
                return (
                  <div key={mod.id} className="flex items-center justify-between gap-2 pl-1">
                    <span className="text-xs text-gray-700">{mod.label}</span>
                    <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
                      {LEVELS.map(l => (
                        <button key={l.value} type="button" disabled={disabled}
                          onClick={() => setLevel(mod.id, l.value)}
                          className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${lvl === l.value ? (l.value === 'edit' ? 'bg-green-600 text-white' : l.value === 'view' ? 'bg-powder-600 text-white' : 'bg-gray-400 text-white') : 'bg-white text-gray-500 hover:bg-gray-100'}`}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserForm({ initial, onSave, onCancel, canViewPin }) {
  const parseModuleAccess = (val) => {
    if (val == null) return null;
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return null; } }
    return val; // already an array (legacy) or object
  };

  const [form, setForm] = useState(() => ({
    name: '', pin: '', role: 'operator', department: 'warehouse',
    ...initial,
    module_access: parseModuleAccess(initial?.module_access),
  }));
  const [saving, setSaving] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [currentPin, setCurrentPin] = useState(null);
  const [pinLoading, setPinLoading] = useState(false);

  const viewCurrentPin = async () => {
    if (pinVisible) { setPinVisible(false); return; }
    if (currentPin !== null) { setPinVisible(true); return; }
    setPinLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/users/${initial.id}/pin`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setCurrentPin(data.pin);
        setPinVisible(true);
      }
    } finally { setPinLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const isAdmin = form.role === 'admin';

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit User' : 'Add Technician / User'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Full Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Adam Bliss" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">{initial?.id ? 'Reset PIN (leave blank to keep)' : 'PIN (optional)'}</label>
          <input value={form.pin || ''} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono tracking-widest"
            placeholder={initial?.id ? '••••' : 'User sets on first login'} maxLength={8} inputMode="numeric" />
          {!initial?.id && <p className="text-[10px] text-gray-400 mt-0.5">Leave blank — user will create their PIN on first sign-in.</p>}
          {initial?.id && canViewPin && (
            <div className="flex items-center gap-2 mt-1.5">
              <button type="button" onClick={viewCurrentPin} disabled={pinLoading}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-powder-600 disabled:opacity-50">
                {pinVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                {pinLoading ? 'Loading...' : pinVisible ? 'Hide current PIN' : 'View current PIN'}
              </button>
              {pinVisible && (
                <span className="font-mono text-sm font-semibold text-gray-900 tracking-widest bg-gray-100 px-2 py-0.5 rounded">
                  {currentPin || 'Not set'}
                </span>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Role *</label>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value, module_access: e.target.value === 'admin' ? null : form.module_access })}
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

      {!isAdmin && (
        <ModuleAccessEditor
          value={form.module_access}
          onChange={(val) => setForm({ ...form, module_access: val })}
        />
      )}
      {isAdmin && (
        <p className="text-xs text-gray-400 italic">Admins have full access to all modules.</p>
      )}

      <div className="flex items-center gap-4 mt-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.is_contractor} onChange={e => setForm({ ...form, is_contractor: e.target.checked })}
            className="rounded border-gray-300" />
          <span className="font-medium text-gray-700">External Contractor</span>
        </label>
      </div>
      {!!form.is_contractor && (
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

const ROLE_CONFIG = {
  admin: { label: 'Admins', color: 'red', desc: 'Full platform access including settings' },
  supervisor: { label: 'Supervisors', color: 'purple', desc: 'Can view and manage most modules' },
  operator: { label: 'Operators', color: 'blue', desc: 'Task-focused access based on assigned modules' },
  auditor: { label: 'Auditors', color: 'emerald', desc: 'Read-only compliance view' },
};

function UserRow({ u, onEdit, onToggle }) {
  const moduleAccess = (() => {
    if (!u.module_access) return null;
    if (typeof u.module_access === 'string') { try { return JSON.parse(u.module_access); } catch { return null; } }
    return u.module_access;
  })();
  const moduleCount = !moduleAccess ? ALL_MODULE_IDS.length : (Array.isArray(moduleAccess) ? moduleAccess.length : Object.keys(moduleAccess).length);

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-3 w-full">
        <span className="font-medium text-gray-900">{u.name}</span>
        {u.is_contractor ? (
          <span className="ml-2 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold">CONTRACTOR</span>
        ) : null}
        {u.contractor_company && <div className="text-[10px] text-gray-400">{u.contractor_company}</div>}
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          u.department === 'qa' ? 'bg-teal-100 text-teal-700'
          : u.department === 'document_control' ? 'bg-purple-100 text-purple-700'
          : u.department === 'cleaning' ? 'bg-amber-100 text-amber-700'
          : u.department === 'production' ? 'bg-green-100 text-green-700'
          : u.department === 'maintenance' ? 'bg-orange-100 text-orange-700'
          : 'bg-indigo-100 text-indigo-700'
        }`}>
          {deptLabel(u.department)}
        </span>
      </td>
      <td className="px-4 py-3">
        {u.role === 'admin' ? (
          <span className="text-[10px] text-gray-400">All modules</span>
        ) : (
          <span className="text-[10px] text-gray-500">{moduleCount}/{ALL_MODULE_IDS.length} modules</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`px-2 py-0.5 rounded-full text-xs ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          {u.is_active ? 'Active' : 'Disabled'}
        </span>
      </td>
      <td className="px-4 py-3 text-right flex gap-1 justify-end">
        <button onClick={() => onEdit(u)} className="text-gray-400 hover:text-powder-600" title="Edit">
          <Edit2 size={14} />
        </button>
        <button onClick={() => onToggle(u)} className="text-gray-400 hover:text-gray-700" title={u.is_active ? 'Disable' : 'Enable'}>
          {u.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
        </button>
      </td>
    </tr>
  );
}

function RoleSection({ users, config, onEdit, onToggle, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const activeCount = users.filter(u => u.is_active).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors`}>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center bg-${config.color}-100`}>
          <Shield size={16} className={`text-${config.color}-600`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{config.label}</h3>
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold">{activeCount} active</span>
          </div>
          <p className="text-xs text-gray-500">{config.desc}</p>
        </div>
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>
      {open && users.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-t border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Name</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Dept</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Access</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Status</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => <UserRow key={u.id} u={u} onEdit={onEdit} onToggle={onToggle} />)}
          </tbody>
        </table>
      )}
      {open && users.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-gray-400 border-t">No {config.label.toLowerCase()} yet</div>
      )}
    </div>
  );
}

export default function SettingsPanel() {
  const { user: currentUser } = useAuth();
  const { data: users, loading, refresh } = useApiGet('/users');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(null);

  const submitUrl = `${window.location.origin}/submit`;
  const productionEntryUrl = `${window.location.origin}/production-entry`;
  const auditorUrl = `${window.location.origin}/auditor`;

  const handleCreate = async (form) => {
    await apiPost('/users', form);
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/users/${editing.id}`, form);
    setEditing(null);
    refresh();
  };

  const handleToggleActive = async (user) => {
    await apiPut(`/users/${user.id}`, { is_active: !user.is_active });
    refresh();
  };

  const handleEdit = (user) => {
    setEditing(user);
    setShowForm(false);
  };

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  const grouped = { admin: [], supervisor: [], operator: [], auditor: [] };
  (users || []).forEach(u => {
    const role = u.role || 'operator';
    if (grouped[role]) grouped[role].push(u);
    else grouped.operator.push(u);
  });

  return (
    <div className="space-y-8">
      {/* Users Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Technicians & Users</h2>
            <p className="text-sm text-gray-500">Manage roles, departments, and module access permissions</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add User
          </button>
        </div>

        {(showForm && !editing) && <UserForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}
        {editing && <UserForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} canViewPin={currentUser?.role === 'admin'} />}

        <div className="space-y-3">
          {['admin', 'supervisor', 'operator', 'auditor'].map(role => (
            <RoleSection
              key={role}
              role={role}
              users={grouped[role]}
              config={ROLE_CONFIG[role]}
              onEdit={handleEdit}
              onToggle={handleToggleActive}
              defaultOpen={role !== 'auditor'}
            />
          ))}
        </div>
      </div>

      {/* Links Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Shareable Links</h2>
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Work Order Submission</h3>
                <p className="text-sm text-gray-500">Public form for anyone to submit a work order. Accessible via QR code — no login required.</p>
                <code className="text-xs text-powder-600 mt-1 block">{submitUrl}</code>
              </div>
              <button onClick={() => copyUrl(submitUrl)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1">
                <Copy size={14} /> {copiedUrl === submitUrl ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-green-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">End of Day / Production Entry</h3>
                <p className="text-sm text-gray-500">SQF production report form for supervisors. Requires login — tracks who submitted each entry.</p>
                <code className="text-xs text-green-600 mt-1 block">{productionEntryUrl}</code>
              </div>
              <button onClick={() => copyUrl(productionEntryUrl)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1">
                <Copy size={14} /> {copiedUrl === productionEntryUrl ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-purple-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Auditor Portal</h3>
                <p className="text-sm text-gray-500">Read-only compliance view with export functionality. Give this link to auditors.</p>
                <code className="text-xs text-purple-600 mt-1 block">{auditorUrl}</code>
                <p className="text-xs text-gray-400 mt-1">Login: auditor@powder-ops.com / PIN: 9999</p>
              </div>
              <button onClick={() => copyUrl(auditorUrl)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1">
                <Copy size={14} /> {copiedUrl === auditorUrl ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
