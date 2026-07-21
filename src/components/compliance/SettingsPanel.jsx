import { useState, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { Plus, Copy, Shield, ChevronDown, ChevronRight, KeyRound, Users, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { DEPARTMENTS, DEPARTMENT_GROUPS, deptLabel } from '../../constants/departments';

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all features' },
  { value: 'supervisor', label: 'Supervisor', desc: 'All features except settings' },
  { value: 'operator', label: 'Operator', desc: 'Operator view only' },
  { value: 'auditor', label: 'Auditor', desc: 'Read-only compliance view' },
];


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
      { id: 'maintenance-signout', label: 'Maintenance Sign In/Out' },
      { id: 'organoleptic', label: 'Organoleptic Sensory' },
      { id: 'knife-accountability', label: 'Knife / Razor Blade / Scissor' },
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

  // Set every module in a group to one level at once — the main simplification.
  const setGroup = (ids, level) => {
    if (disabled) return;
    const base = allAccess ? Object.fromEntries(ALL_MODULE_IDS.map(m => [m, 'edit'])) : { ...map };
    ids.forEach(id => { if (level === 'none') delete base[id]; else base[id] = level; });
    const isAllEdit = ALL_MODULE_IDS.every(m => base[m] === 'edit');
    onChange(isAllEdit ? null : base);
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
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase text-gray-500">{group.label}</div>
                {!disabled && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <span>set all:</span>
                    {LEVELS.map(l => (
                      <button key={l.value} type="button" onClick={() => setGroup(group.modules.map(m => m.id), l.value)}
                        className="px-1.5 py-0.5 rounded border border-gray-200 bg-white hover:bg-gray-100 text-gray-500">{l.label}</button>
                    ))}
                  </div>
                )}
              </div>
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

// Admin-only password reset. One button expands an inline form; the acting
// admin must re-enter their own password to authorize the change.
function ResetPasswordControl({ userId, userName }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [adminPw, setAdminPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null); setMsg(null);
    if (pw.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: pw, admin_password: adminPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not reset password.'); return; }
      setMsg(`Password reset. Share it with ${userName || 'the user'}.`);
      setPw(''); setAdminPw(''); setOpen(false);
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="mt-1.5">
        <button type="button" onClick={() => { setOpen(true); setMsg(null); }}
          className="flex items-center gap-1.5 text-xs font-medium text-powder-600 hover:text-powder-700">
          <KeyRound size={13} /> Reset password
        </button>
        {msg && <p className="text-[11px] text-green-600 mt-1">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2">
      <input type="text" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password"
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm" placeholder="New password (min 8)" />
      <input type="password" value={adminPw} onChange={e => setAdminPw(e.target.value)} autoComplete="current-password"
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm" placeholder="Confirm with YOUR password" />
      {err && <p className="text-[11px] text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className="px-2.5 py-1 bg-powder-600 text-white text-xs font-medium rounded-md hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Set password'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(null); setPw(''); setAdminPw(''); }}
          className="px-2.5 py-1 text-gray-500 text-xs font-medium rounded-md hover:bg-gray-100">Cancel</button>
      </div>
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
    name: '', role: 'operator', department: 'warehouse',
    ...initial,
    home_workspace: initial?.home_workspace || 'fsqa',
    module_access: parseModuleAccess(initial?.module_access),
  }));
  const [saving, setSaving] = useState(false);

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
          <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
          {initial?.id ? (
            canViewPin ? (
              <ResetPasswordControl userId={initial.id} userName={initial.name} />
            ) : (
              <p className="text-[11px] text-gray-400 mt-2">Only an admin can reset passwords.</p>
            )
          ) : (
            <p className="text-[11px] text-gray-400 mt-2">The user creates their own password the first time they sign in.</p>
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
            {DEPARTMENT_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Home screen</label>
          <select value={form.home_workspace || 'fsqa'} onChange={e => setForm({ ...form, home_workspace: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="fsqa">ReadyDoc</option>
            <option value="messages">Messages</option>
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Where this user lands after signing in.</p>
        </div>
      </div>

      <ModuleAccessEditor
        value={form.module_access}
        onChange={(val) => setForm({ ...form, module_access: val })}
      />
      {isAdmin && (
        <p className="text-[11px] text-gray-400 italic -mt-1">Admins default to full access — uncheck "Full access" to hide specific modules from this admin. Settings always stays enabled.</p>
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

function UserRow({ u, onEdit, onToggle, onRemove, isEditing }) {
  const moduleAccess = (() => {
    if (!u.module_access) return null;
    if (typeof u.module_access === 'string') { try { return JSON.parse(u.module_access); } catch { return null; } }
    return u.module_access;
  })();
  const moduleCount = !moduleAccess ? ALL_MODULE_IDS.length : (Array.isArray(moduleAccess) ? moduleAccess.length : Object.keys(moduleAccess).length);

  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50 ${isEditing ? 'bg-powder-50' : ''}`}>
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
          : u.department === 'office' ? 'bg-slate-100 text-slate-700'
          : 'bg-indigo-100 text-indigo-700'
        }`}>
          {deptLabel(u.department)}
        </span>
      </td>
      <td className="px-4 py-3">
        {u.role === 'admin' && !moduleAccess ? (
          <span className="text-[10px] text-gray-400">All modules</span>
        ) : (
          <span className="text-[10px] text-gray-500">{moduleCount}/{ALL_MODULE_IDS.length} modules</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {u.is_active ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Active</span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-600"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Inactive</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex gap-1.5 justify-end items-center">
          <button onClick={() => onEdit(u)} className={`px-2 py-1 rounded-lg text-xs font-medium border ${isEditing ? 'border-powder-300 text-powder-700 bg-powder-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`} title="Edit role, department, access">
            {isEditing ? 'Close' : 'Edit'}
          </button>
          {u.is_active ? (
            <button onClick={() => onToggle(u)} className="px-2 py-1 rounded-lg text-xs font-medium border border-amber-200 text-amber-700 hover:bg-amber-50" title="Blocks login but keeps all history">
              Deactivate
            </button>
          ) : (
            <>
              <button onClick={() => onToggle(u)} className="px-2 py-1 rounded-lg text-xs font-medium border border-green-200 text-green-700 hover:bg-green-50" title="Restore login access">
                Activate
              </button>
              <button onClick={() => onRemove(u)} className="px-2 py-1 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50" title="Permanently delete (only if they have no history)">
                Remove
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function RoleSection({ users, config, onEdit, onToggle, onRemove, defaultOpen, editingId, onSave, onCancel, canViewPin }) {
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
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
            {users.map(u => (
              <Fragment key={u.id}>
                <UserRow u={u} onEdit={onEdit} onToggle={onToggle} onRemove={onRemove} isEditing={u.id === editingId} />
                {u.id === editingId && (
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-4 py-3 border-b border-gray-200">
                      <UserForm initial={u} onSave={onSave} onCancel={onCancel} canViewPin={canViewPin} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {open && users.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-gray-400 border-t">No {config.label.toLowerCase()} yet</div>
      )}
    </div>
  );
}

function BulkAddModal({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const ROLE_VALS = ['admin', 'supervisor', 'operator', 'auditor'];
  const DEPT_VALS = DEPARTMENTS.map(d => d.value);

  const parsed = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [name, role, dept] = l.split(',').map(s => (s || '').trim());
    return {
      name,
      role: ROLE_VALS.includes((role || '').toLowerCase()) ? role.toLowerCase() : 'operator',
      department: DEPT_VALS.includes((dept || '').toLowerCase().replace(/\s+/g, '_')) ? dept.toLowerCase().replace(/\s+/g, '_') : 'warehouse',
    };
  }).filter(u => u.name);

  const save = async () => {
    if (!parsed.length) { setError('Add at least one name.'); return; }
    setSaving(true); setError('');
    try { setResult(await apiPost('/users/bulk', { users: parsed })); }
    catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Bulk add users</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {result ? (
          <div className="space-y-3">
            <div className="text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">Added {result.created} user{result.created === 1 ? '' : 's'}. They’ll set their password on first sign-in.</div>
            <button onClick={onDone} className="w-full px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500">One person per line. Optionally add role and department: <code className="bg-gray-100 px-1 rounded">Name, role, department</code>. Defaults are operator / warehouse. Roles: admin, supervisor, operator, auditor.</p>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
              placeholder={'Adam Bliss\nMaria Lopez, supervisor, production\nDevon Kim, operator, warehouse'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
            <p className="text-xs text-gray-500">{parsed.length} user{parsed.length === 1 ? '' : 's'} ready to add.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving || !parsed.length} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Adding…' : `Add ${parsed.length || ''} user${parsed.length === 1 ? '' : 's'}`}</button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BulkAccessModal({ users, onClose, onDone }) {
  const [selected, setSelected] = useState({});
  const [access, setAccess] = useState({}); // {} = no access; configured below (null = full)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const eligible = (users || []).filter(u => u.role !== 'admin');
  const chosen = Object.keys(selected).filter(id => selected[id]);
  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));

  const apply = async () => {
    if (!chosen.length) { setError('Select at least one user.'); return; }
    setSaving(true); setError('');
    try { await apiPost('/users/bulk-access', { user_ids: chosen, module_access: access }); onDone(); }
    catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">Bulk module permissions</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="p-4 grid md:grid-cols-2 gap-4 overflow-y-auto">
          <div>
            <p className="text-xs font-medium text-gray-700 mb-1">Apply to ({chosen.length} selected)</p>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {eligible.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!selected[u.id]} onChange={() => toggle(u.id)} />
                  <span className="text-sm text-gray-800">{u.name}</span>
                  <span className="text-[11px] text-gray-400 capitalize ml-auto">{u.role}</span>
                </label>
              ))}
              {eligible.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No non-admin users.</p>}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Admins always have full access and are excluded.</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700 mb-1">Access to apply</p>
            <ModuleAccessEditor value={access} onChange={setAccess} />
          </div>
        </div>
        {error && <p className="px-4 text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-2 p-4 border-t">
          <button onClick={apply} disabled={saving || !chosen.length} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Applying…' : `Apply to ${chosen.length || ''} user${chosen.length === 1 ? '' : 's'}`}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const { user: currentUser } = useAuth();
  const { data: users, loading, refresh } = useApiGet('/users');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [bulkAdd, setBulkAdd] = useState(false);
  const [bulkAccess, setBulkAccess] = useState(false);
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

  const handleRemove = async (user) => {
    if (!window.confirm(`Permanently remove ${user.name}? This only works if they have no message or task history — otherwise deactivate them instead.`)) return;
    try {
      await apiDelete(`/users/${user.id}`);
      refresh();
    } catch (e) {
      alert(e.message || 'Could not remove this person. Deactivate them instead to keep their history.');
    }
  };

  const handleEdit = (user) => {
    setEditing(prev => (prev?.id === user.id ? null : user));
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
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Technicians & Users</h2>
            <p className="text-sm text-gray-500">Manage roles, departments, and module access permissions</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setBulkAccess(true)}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Shield size={15} /> Bulk Permissions
            </button>
            <button onClick={() => { setBulkAdd(true); setEditing(null); setShowForm(false); }}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Users size={15} /> Bulk Add
            </button>
            <button onClick={() => { setShowForm(true); setEditing(null); }}
              className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
              <Plus size={16} /> Add User
            </button>
          </div>
        </div>

        {(showForm && !editing) && <UserForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}

        <div className="space-y-3">
          {['admin', 'supervisor', 'operator', 'auditor'].map(role => (
            <RoleSection
              key={role}
              role={role}
              users={grouped[role]}
              config={ROLE_CONFIG[role]}
              onEdit={handleEdit}
              onToggle={handleToggleActive}
              onRemove={handleRemove}
              defaultOpen={role !== 'auditor'}
              editingId={editing?.id}
              onSave={handleUpdate}
              onCancel={() => setEditing(null)}
              canViewPin={currentUser?.role === 'admin'}
            />
          ))}
        </div>
      </div>

      {bulkAdd && <BulkAddModal onClose={() => setBulkAdd(false)} onDone={() => { setBulkAdd(false); refresh(); }} />}
      {bulkAccess && <BulkAccessModal users={users || []} onClose={() => setBulkAccess(false)} onDone={() => { setBulkAccess(false); refresh(); }} />}

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
                <p className="text-xs text-gray-400 mt-1">Auditor signs in as <span className="font-medium">auditor@powder-ops.com</span> and sets a password on first sign-in.</p>
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
