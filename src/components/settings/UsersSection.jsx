import { useState, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { Plus, Shield, ChevronDown, ChevronRight, KeyRound, Users, X } from 'lucide-react';
import { DEPARTMENTS, DEPARTMENT_GROUPS, deptLabel } from '../../constants/departments';

// Accounts, roles, departments and per-module access.
//
// Lifted out of SettingsPanel when Settings became a section list: this is by
// far the largest thing in Settings and kept the registry buried under 900
// lines of forms. Nothing here changed in the move.

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all features' },
  { value: 'supervisor', label: 'Supervisor', desc: 'All features except settings' },
  { value: 'operator', label: 'Operator', desc: 'Operator view only' },
  { value: 'auditor', label: 'Auditor', desc: 'Read-only compliance view' },
];


// Mirrors the app's own sidebar sections, in the same order and under the same
// names — an admin granting access should be looking at the list they already
// navigate every day, not a second taxonomy invented for this screen.
//
// `sub: true` indents an entry under the one above it. That is how the kiosk
// forms are shown: each sits under the log it files into, because they are
// separate grants and the difference is easy to miss when they are apart.
import { OPT_IN_MODULES, OPT_IN_SET } from '../../../shared/opt-in-modules.js';

const MODULE_GROUPS = [
  {
    label: 'Overview',
    modules: [
      { id: 'dashboard', label: 'Dashboard' },
      // Automatic for admins & supervisors; granting it here shares the
      // Critical Tracking tab (program health) with someone else.
      { id: 'critical-tracking', label: 'Critical Tracking (auto for supervisors)' },
      { id: 'operator', label: 'Operator View' },
    ],
  },
  {
    label: 'Product',
    modules: [
      { id: 'products', label: 'Products (master list)' },
      { id: 'artwork', label: 'Artwork versions & proofing' },
    ],
  },
  {
    label: 'Production',
    modules: [
      { id: 'production-log', label: 'Production Log' },
      // Submitting the EOD entry form — separate from editing the log itself.
      // Supervisors get the form automatically; edit on Production Log is what
      // allows correcting entries afterwards.
      { id: 'production-eod', label: 'EOD entry form (auto for supervisors)', sub: true, note: 'Files into the Production Log. Correcting a filed entry needs Edit above.' },
      { id: 'production-schedule', label: 'Schedule' },
      { id: 'production-dashboard', label: 'Production KPIs' },
    ],
  },
  {
    label: 'Warehouse',
    modules: [
      { id: 'receiving-log', label: 'Receiving Log' },
      { id: 'component-signout', label: 'Component Sign In/Out' },
      { id: 'form-components', label: 'Component Pull (kiosk form)', sub: true, note: 'The Quick Forms shortcut in the sidebar. Files into the log above — grant this alone for people who only submit.' },
      { id: 'maintenance-signout', label: 'Equipment, Tools & Chemicals (Form 703-01)', note: 'A tab inside Sign In/Out.' },
      { id: 'form-maintenance', label: 'Sign Out an Item (kiosk form)', sub: true, note: 'The Quick Forms shortcut in the sidebar. Files into the log above — grant this alone for people who only submit.' },
      { id: 'knife-accountability', label: 'Knives & Blades (Form 440-02 / 440-01)', note: 'A tab inside Sign In/Out.' },
      { id: 'form-knife', label: 'Knife Sign In/Out (kiosk form)', sub: true, note: 'The Quick Forms shortcut in the sidebar. Files into the log above — grant this alone for people who only submit.' },
      { id: 'currently-out', label: 'Out now (summary view)', sub: true, note: 'The read-only "what is signed out right now" tab, across both forms. Grant this alone for someone who only needs the floor check.' },
    ],
  },
  {
    label: 'Maintenance',
    modules: [
      { id: 'pm', label: 'Task Center' },
      { id: 'equipment', label: 'Equipment' },
      { id: 'calibration', label: 'Calibration' },
      { id: 'form-scale', label: 'Scale Verification (kiosk form)', sub: true, note: 'The Quick Forms shortcut in the sidebar. Files into Calibration \u2192 Scale Verification \u2014 grant this alone for supervisors who only run the daily check.' },
      { id: 'loto', label: 'Lockout / Tagout' },
    ],
  },
  {
    label: 'Quality',
    modules: [
      // Automatic for the QA/quality department and admins. Granting it here
      // is how someone outside QA — a supervisor who genuinely counter-signs —
      // gets the queue. Without this entry the rule had no checkbox at all,
      // which is why every supervisor had it by role and Settings looked wrong.
      { id: 'qa-review', label: 'QA Review Center (auto for QA / quality)', note: 'The counter-signature queue: production entries, QA inspections, cleaning records, scale checks and sign-out returns. Signing a single module’s records is separately allowed by Edit on that module.' },
      { id: 'coa', label: 'COA / Lab Testing' },
      { id: 'hygienic', label: 'Hygienic Design' },
      { id: 'qa-inspections', label: 'QA Inspections (light, brittle plastic & glass)' },
      { id: 'organoleptic', label: 'Organoleptic Sensory' },
      { id: 'flavor-approvals', label: 'Flavor Approvals' },
      { id: 'capa', label: 'CAPA / Complaints' },
      { id: 'deviations', label: 'Deviations' },
      { id: 'non-conformance', label: 'Non-Conformance' },
      { id: 'on-hold', label: 'On Hold' },
      { id: 'disposals', label: 'Disposals' },
      { id: 'recall', label: 'Mock Recall' },
      { id: 'meetings', label: 'Meetings (minutes, attendance, actions)' },
      { id: 'internal-audits', label: 'Internal Audits (Form 403-01)' },
      { id: 'safety', label: 'Safety (crisis contacts, evacuations, first aid)' },
      { id: 'retention-samples', label: 'Retention Samples (retains, lab pulls, boxes)' },
      // These three are ordinary nav modules with no special gating, and they
      // simply had no checkbox — so there was no way to grant them to anybody
      // and they read as missing. Quality Schedules is the one that surfaced it.
      { id: 'quality-schedules', label: 'Quality Schedules (EMP swabs, water & air testing)', note: 'The recurring quality checks from FORM 604-01 — they generate QA tasks in the Task Center.' },
      { id: 'facility-map', label: 'Facility Map (floor plan, cleaning status, pest, BP&G zones)' },
    ],
  },
  {
    label: 'Cleaning',
    modules: [
      { id: 'sanitation', label: 'Sanitation' },
      { id: 'chemicals', label: 'Chemicals' },
    ],
  },
  {
    label: 'Document Control',
    modules: [
      { id: 'sops', label: 'SOP Registry' },
      { id: 'work-instructions', label: 'Work Instructions' },
      { id: 'job-descriptions', label: 'Job Descriptions' },
      { id: 'training', label: 'Training Records' },
      { id: 'certifications', label: 'Certifications' },
      { id: 'dcr', label: 'Document Change Requests' },
      { id: 'org-chart', label: 'Org Chart' },
      { id: 'audit', label: 'Audit Log', note: 'Read-only history of every change: who did what, when, and what the value was before. What an auditor asks to see.' },
    ],
  },
  {
    label: 'Office',
    modules: [
      // Requests is automatic for every supervisor; granting it here extends
      // the Supply Order + Time Tracking forms to a non-supervisor (e.g. office
      // staff). The full Supply Orders / Time Tracking modules stay admin-only.
      { id: 'supply-requests', label: 'Supply Order request form' },
      { id: 'time-requests', label: 'Time Tracking request form' },
      { id: 'accounts-payable', label: 'Accounts Payable' },
      { id: 'accounts-receivable', label: 'Accounts Receivable' },
      { id: 'partner-reconciliation', label: 'Partner Reconciliation (what we owe / are owed net)', note: 'View reads the number and the documents behind it; Edit adds and disputes documents. Approving one as final, settling a period and creating a partner link stay with admins and office supervisors whatever is granted here.' },
      { id: 'reimbursements', label: 'Reimbursements (personal card spend)', note: 'A person with this only ever sees their OWN claims. Approving and marking paid is admin / office supervisor, whatever is granted here.' },
      { id: 'banking', label: 'Banking & Reconciliation', note: 'View sees the accounts and whether they balance. Matching a line, closing a period and connecting a bank stay with admins and office supervisors.' },
      { id: 'procurement', label: 'Procurement & Demand Planning' },
      { id: 'newsletter', label: 'Newsletter' },
      { id: 'pay-tracking', label: 'Pay Tracking (evaluations; rates stay admin-only)' },
      { id: 'dannys-list', label: "Danny's List (the owner's text-message request log)", note: 'One person\'s working queue — grant it to whoever tracks what Danny owes and is owed, not by role.' },
      { id: 'policies', label: 'Policies (handbook; edit = upload and publish)' },
    ],
  },
  {
    label: 'System',
    modules: [
      { id: 'log-builder', label: 'Log Builder (edit form fields & dropdown lists)', note: 'Grant Edit to let someone add fields and list options to any log without a deploy. Changes the shape of records, so give it to leads you trust with document control.' },
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

// `additive` mode (bulk merge): the map holds ONLY the modules to change —
// everything else on each user stays as it is. A fourth "Keep" level marks
// "leave this module alone" (absent from the map).
function ModuleAccessEditor({ value, onChange, disabled, additive = false }) {
  const map = additive ? (value || {}) : normalizeAccess(value);
  // 54 modules, one per row, in a 288px scroller was about five screens of
  // scrolling to reach the bottom group. A filter is the fastest way to one
  // module; the column flow below is what makes the whole list visible at once.
  const [q, setQ] = useState('');
  // OPT-IN MODULES LIVE OUTSIDE "full access". A map holding nothing but
  // opt-in grants is still full access — otherwise granting an admin Danny's
  // List would silently strip their whole nav — and the collapse-to-null
  // below must never swallow an opt-in grant as "all edit anyway".
  const ORDINARY_IDS = ALL_MODULE_IDS.filter(id => !OPT_IN_SET.has(id));
  const optInEntries = (m) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => OPT_IN_SET.has(k)));
  const allAccess = !additive && (map == null || Object.keys(map).every(k => OPT_IN_SET.has(k)));

  const levelOf = (id) => {
    if (additive) return map[id] || 'keep';
    if (allAccess) return 'edit';
    return map[id] || 'none';
  };

  const setLevel = (id, level) => {
    if (disabled) return;
    if (additive) {
      const base = { ...map };
      if (level === 'keep') delete base[id];
      else base[id] = level;
      onChange(base);
      return;
    }
    const base = allAccess ? { ...Object.fromEntries(ORDINARY_IDS.map(m => [m, 'edit'])), ...optInEntries(map) } : { ...map };
    if (level === 'none') delete base[id];
    else base[id] = level;
    // Collapse back to "all access" if every ORDINARY module is Edit — the
    // opt-in grants ride along untouched.
    const isAllEdit = ORDINARY_IDS.every(m => base[m] === 'edit');
    onChange(isAllEdit ? (Object.keys(optInEntries(base)).length ? optInEntries(base) : null) : base);
  };

  const toggleAll = () => {
    if (disabled) return;
    const grants = optInEntries(map);
    onChange(allAccess ? { ...grants } : (Object.keys(grants).length ? grants : null));
  };

  const toggleOptIn = (id) => {
    if (disabled) return;
    const base = map == null ? {} : { ...map };
    if (base[id]) delete base[id]; else base[id] = 'edit';
    // Under full access the map holds only the grants; otherwise it is the map.
    if (allAccess) onChange(Object.keys(optInEntries(base)).length ? optInEntries(base) : null);
    else onChange(base);
  };

  // Set every module in a group to one level at once — the main simplification.
  const setGroup = (ids, level) => {
    if (disabled) return;
    if (additive) {
      const base = { ...map };
      ids.forEach(id => { if (level === 'keep') delete base[id]; else base[id] = level; });
      onChange(base);
      return;
    }
    const base = allAccess ? { ...Object.fromEntries(ORDINARY_IDS.map(m => [m, 'edit'])), ...optInEntries(map) } : { ...map };
    ids.forEach(id => { if (level === 'none') delete base[id]; else base[id] = level; });
    const isAllEdit = ORDINARY_IDS.every(m => base[m] === 'edit');
    onChange(isAllEdit ? (Object.keys(optInEntries(base)).length ? optInEntries(base) : null) : base);
  };

  // Filtering hides a group entirely once nothing in it matches, so the
  // remaining columns stay short rather than leaving empty headings behind.
  const needle = q.trim().toLowerCase();
  const withoutOptIns = MODULE_GROUPS
    .map(g => ({ ...g, modules: g.modules.filter(m => !OPT_IN_SET.has(m.id)) }))
    .filter(g => g.modules.length);
  const visibleGroups = needle
    ? withoutOptIns
      .map(g => ({ ...g, modules: g.modules.filter(m => `${m.label} ${m.id} ${m.note || ''}`.toLowerCase().includes(needle)) }))
      .filter(g => g.modules.length)
    : withoutOptIns;
  const optInDefs = OPT_IN_MODULES.map(id =>
    MODULE_GROUPS.flatMap(g => g.modules).find(m => m.id === id) || { id, label: id });

  const LEVELS = additive ? [
    { value: 'keep', label: 'Keep' },
    { value: 'none', label: 'None' },
    { value: 'view', label: 'View' },
    { value: 'edit', label: 'Edit' },
  ] : [
    { value: 'none', label: 'None' },
    { value: 'view', label: 'View' },
    { value: 'edit', label: 'Edit' },
  ];

  return (
    <div className="space-y-2">
      {!additive && (
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-gray-700">Module Access</label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={allAccess} onChange={toggleAll} disabled={disabled}
              className="rounded border-gray-300 text-powder-600" />
            Full access (all modules)
          </label>
        </div>
      )}
      {/* Grants that "Full access" deliberately does NOT include — one person's
          private queue is opted into by name, admins included. Shown even when
          everything else is on, so granting it never means ticking 54 boxes. */}
      {!additive && optInDefs.length > 0 && (
        <div className="p-2.5 bg-amber-50/60 border border-amber-200 rounded-lg space-y-1">
          <p className="text-[11px] font-semibold text-amber-900">Private modules (never included in full access)</p>
          {optInDefs.map(m => (
            <label key={m.id} className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={!!(map && map[m.id])} onChange={() => toggleOptIn(m.id)} disabled={disabled}
                className="mt-0.5 rounded border-gray-300 text-powder-600" />
              <span>
                <span className="font-medium">{m.label}</span>
                {m.note && <span className="block text-gray-500">{m.note}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {!allAccess && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-[11px] text-gray-500 max-w-lg">
              {additive
                ? <>Modules left on <strong>Keep</strong> are not changed for anyone. Set a module to None / View / Edit to apply just that change.</>
                : <>Set each module to <strong>None</strong> (hidden), <strong>View</strong> (read-only), or <strong>Edit</strong>.</>}
            </p>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a module…"
              className="px-2.5 py-1 border border-gray-300 rounded-lg text-xs w-44 bg-white" />
          </div>
          {visibleGroups.length === 0 && (
            <p className="text-xs text-gray-400 py-4 text-center">No module matches “{q}”.</p>
          )}
          {/* A column FLOW rather than a grid: each group keeps its heading with
              its own modules and the columns fill unevenly, which is right when
              the groups are different lengths.

              COLUMN WIDTH, NOT A COLUMN COUNT. This used to be
              `columns-1 md:columns-2 2xl:columns-3`, which picks the count from
              the VIEWPORT — but the editor is also mounted inside the Bulk
              Permissions modal, in a pane about half the width. On a desktop
              the viewport said "two columns" while the pane could only give
              each one ~150px, and a row (label + the Keep/None/View/Edit
              control) needs ~280px. CSS columns don't shrink their contents:
              the rows overflowed into each other and the panel rendered as
              overlapping text. `columns-[17rem]` states the width a row needs
              and lets the browser fit as many as the CONTAINER actually has,
              so it's correct in both places with no breakpoint guessing. */}
          <div className="columns-[17rem] gap-4 space-y-3">
          {visibleGroups.map(group => (
            <div key={group.label} className="space-y-1 break-inside-avoid mb-3">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
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
                  <div key={mod.id} className={`flex items-start justify-between gap-2 ${mod.sub ? 'pl-4 border-l-2 border-gray-200 ml-1' : 'pl-1'}`}>
                    <span className="text-xs text-gray-700 min-w-0">
                      {mod.label}
                      {mod.note && <span className="block text-[10px] text-gray-400">{mod.note}</span>}
                    </span>
                    <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
                      {LEVELS.map(l => (
                        <button key={l.value} type="button" disabled={disabled}
                          onClick={() => setLevel(mod.id, l.value)}
                          className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${lvl === l.value ? (l.value === 'edit' ? 'bg-green-600 text-white' : l.value === 'view' ? 'bg-powder-600 text-white' : l.value === 'keep' ? 'bg-gray-200 text-gray-700' : 'bg-gray-400 text-white') : 'bg-white text-gray-500 hover:bg-gray-100'}`}>
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
        </div>
      )}
    </div>
  );
}

// Admin password reset — one click. It clears the user's password and issues a
// SETUP CODE, which the admin reads out to them. The person still chooses their
// own password; the code only proves somebody with authority invited them.
//
// Clearing the password alone used to be enough, which meant anyone who knew a
// colleague's name could set a password on their account. The code closes that,
// so this control has to SHOW it — a reset that issues a credential the admin
// never sees is a reset that strands the person.
function ResetPasswordControl({ userId, userName }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { setup_code, expires_in_days }
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not reset password.'); return; }
      setDone(data); setConfirming(false);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="mt-1.5 bg-green-50 border border-green-200 rounded-lg p-2.5 space-y-2">
        <p className="text-[11px] text-green-800 leading-relaxed">
          Password cleared for <span className="font-medium">{userName || 'this user'}</span>. Give them this
          setup code — they’ll enter their name, click <span className="font-medium">Sign In</span>, type the
          code and then choose their own password.
        </p>
        {done.setup_code && (
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 bg-white border border-green-300 rounded font-mono text-sm tracking-widest text-green-900">
              {done.setup_code}
            </code>
            <button type="button"
              onClick={() => { navigator.clipboard?.writeText(done.setup_code); setCopied(true); }}
              className="text-[11px] font-medium text-green-800 hover:text-green-900 underline">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        {/* Said plainly, because this is the one thing that goes wrong: the code
            is shown here once and is not recoverable from the roster. */}
        <p className="text-[10px] text-green-700">
          Single use, expires in {done.expires_in_days ?? 14} days, and it is not shown again — reset
          again if it gets lost.
        </p>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="mt-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2.5 space-y-2">
        <p className="text-[11px] text-gray-600 leading-relaxed">
          Reset <span className="font-medium">{userName || 'this user'}</span>’s password? They’ll be signed out, and you’ll get a one-time setup code to give them so they can create a new password.
        </p>
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={submit} disabled={busy}
            className="px-2.5 py-1 bg-red-600 text-white text-xs font-medium rounded-md hover:bg-red-700 disabled:opacity-50">
            {busy ? 'Resetting…' : 'Reset password'}
          </button>
          <button type="button" onClick={() => { setConfirming(false); setErr(null); }}
            className="px-2.5 py-1 text-gray-500 text-xs font-medium rounded-md hover:bg-gray-100">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setConfirming(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-powder-600 hover:text-powder-700">
        <KeyRound size={13} /> Reset password
      </button>
      <p className="text-[10px] text-gray-400 mt-0.5">Clears it so they set a new one on next sign-in.</p>
    </div>
  );
}

// Per-user mobile bottom-bar tabs. The four picks are shown across the top in
// the order they'll appear, can be reordered or removed there, and choosing a
// fifth swaps out the last one — so the bar is always exactly what you see.
// Empty = the automatic role-aware picks.
const QUICK_TAB_OPTIONS = [
  { id: 'home', label: 'Home' },
  { id: 'messages', label: 'Messages' },
  { id: 'operator', label: 'Operator View' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'production-schedule', label: 'Schedule' },
  { id: 'production-log', label: 'Production Log' },
  { id: 'pm', label: 'Task Center' },
  { id: 'maintenance-signout', label: 'Sign In-Out' },
  { id: 'currently-out', label: 'Checked Out' },
  { id: 'component-signout', label: 'Component Sign In/Out' },
  { id: 'sanitation', label: 'Sanitation' },
  { id: 'qa-inspections', label: 'QA Inspections' },
  { id: 'coa', label: 'COA / Lab Testing' },
  { id: 'supply-orders', label: 'Supply Orders' },
  { id: 'time-tracking', label: 'Time Tracking' },
];
const QUICK_TAB_LABEL = Object.fromEntries(QUICK_TAB_OPTIONS.map(o => [o.id, o.label]));

function QuickTabsEditor({ value, onChange }) {
  const picked = Array.isArray(value) ? value : [];

  const toggle = (id) => {
    if (picked.includes(id)) return onChange(picked.filter(x => x !== id));
    // Four is the whole bar, so a fifth pick replaces the last one rather than
    // silently doing nothing.
    if (picked.length < 4) return onChange([...picked, id]);
    onChange([...picked.slice(0, 3), id]);
  };

  const move = (idx, dir) => {
    const next = [...picked];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-700">
          Mobile bottom-bar tabs <span className="text-gray-400 font-normal">(max 4, left to right)</span>
        </label>
        {picked.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-[11px] text-gray-400 hover:text-gray-600">Reset to automatic</button>
        )}
      </div>

      {/* The bar as it will look, in order */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
        {picked.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-2">Automatic — picked from what this user can access.</p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {picked.map((id, i) => (
              <div key={id} className="bg-white rounded-lg border border-powder-200 px-1.5 py-1.5 text-center">
                <p className="text-[11px] font-semibold text-gray-800 truncate">{QUICK_TAB_LABEL[id] || id}</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move left">←</button>
                  <button type="button" onClick={() => toggle(id)}
                    className="px-1 text-gray-400 hover:text-red-600" title="Remove">×</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1}
                    className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move right">→</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_TAB_OPTIONS.map(o => {
          const idx = picked.indexOf(o.id);
          return (
            <button key={o.id} type="button" onClick={() => toggle(o.id)}
              className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${idx >= 0 ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {idx >= 0 && <span className="font-bold mr-1">{idx + 1}</span>}{o.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400">
        Home opens this user&apos;s home workspace. Picking a fifth tab replaces the last one. Only modules they can access will actually show.
      </p>
    </div>
  );
}

function UserForm({ initial, onSave, onCancel, canViewPin }) {
  const parseModuleAccess = (val) => {
    if (val == null) return null;
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return null; } }
    return val; // already an array (legacy) or object
  };
  const parseQuickTabs = (val) => {
    if (!val) return [];
    if (typeof val === 'string') { try { return JSON.parse(val) || []; } catch { return []; } }
    return Array.isArray(val) ? val : [];
  };

  const [form, setForm] = useState(() => ({
    name: '', role: 'operator', department: 'warehouse',
    ...initial,
    home_workspace: initial?.home_workspace || 'fsqa',
    phone: initial?.phone || '',
    sms_access: initial?.sms_access ? 1 : 0,
    module_access: parseModuleAccess(initial?.module_access),
    quick_tabs: parseQuickTabs(initial?.quick_tabs),
  }));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } catch (saveErr) {
      // A refused save must SAY so. This was try/finally with NO catch, so a
      // 403 or a validation 400 cleared the spinner and left the modal sitting
      // there — indistinguishable from a dead button, which is how a
      // deliberate rule reads as a broken screen.
      window.alert(saveErr.message);
    } finally { setSaving(false); }
  };

  const isAdmin = form.role === 'admin';

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit User' : 'Add Technician / User'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Full Name *</label>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Adam Bliss" />
          <p className="text-[11px] text-gray-400 mt-1">Appears on records and signatures.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Username (sign-in)</label>
          <input value={form.username || ''} onChange={e => setForm({ ...form, username: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="First Last" />
          <p className="text-[11px] text-gray-400 mt-1">
            Leave blank for first + last name. Set it by hand when someone goes by a different surname.
          </p>
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
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Mobile number</label>
          <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })}
            type="text" inputMode="numeric" placeholder="(801) 555-0100"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <p className="text-[11px] text-gray-400 mt-1">Used for approval texts. Stored as ten digits.</p>
        </div>
        <div className="sm:col-span-2">
          {/* A GRANT, NOT A CONSEQUENCE OF HAVING A NUMBER.
              This is what lets an incoming text be answered with plant data, so
              it is deliberately its own checkbox and defaults to off: recording
              somebody's mobile must never quietly open that door. */}
          <label className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 bg-gray-50">
            <input type="checkbox" checked={!!form.sms_access} disabled={!String(form.phone || '').trim()}
              onChange={e => setForm({ ...form, sms_access: e.target.checked ? 1 : 0 })} className="mt-0.5" />
            <span className="text-xs text-gray-700">
              <span className="font-medium">This person has agreed to receive ReadyDoc texts</span>
              {/* THE WORDING IS THE CONSENT RECORD, not a label.
                  A2P 10DLC registration asks how recipients consent, and the
                  answer has to be something the system actually holds. Ticking
                  this stamps the date and who recorded it; untucking clears
                  both, so a stale consent date can never sit against someone
                  who has opted out. */}
              <span className="block text-gray-500 mt-0.5">
                Tick only after they have agreed. They will receive approval links and can text
                questions to the ReadyDoc number; replies are answered with plant data (read-only).
                Message and data rates may apply, frequency varies, and they can reply STOP at any
                time. Consent is not a condition of employment.
                {!String(form.phone || '').trim() && ' Add a mobile number first.'}
              </span>
              {!initial?.sms_consent_at && (
                <span className="block text-gray-500 mt-1">
                  Saving sends them a one-off confirmation text, so the agreement and the way to
                  stop it are on their own phone in writing.
                </span>
              )}
              {initial?.sms_consent_at && (
                <span className="block text-gray-400 mt-1">
                  Recorded {String(initial.sms_consent_at).slice(0, 10)}
                  {initial.sms_consent_by ? ` by ${initial.sms_consent_by}` : ''}
                </span>
              )}
            </span>
          </label>
        </div>
      </div>

      <ModuleAccessEditor
        value={form.module_access}
        onChange={(val) => setForm({ ...form, module_access: val })}
      />
      <TemplateTools current={form.module_access} onApply={(map) => setForm({ ...form, module_access: map })} />
      {isAdmin && (
        <p className="text-[11px] text-gray-400 italic -mt-1">Admins default to full access — uncheck "Full access" to hide specific modules from this admin. Settings always stays enabled.</p>
      )}

      <QuickTabsEditor value={form.quick_tabs} onChange={(val) => setForm({ ...form, quick_tabs: val })} />

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

// The roster is a table on a wide screen and a list of cards on a phone, so the
// pieces of a row live here rather than in either layout. Two copies of the
// department colour map is how the two views start disagreeing about who is in
// QA.
function moduleCountOf(u) {
  const access = (() => {
    if (!u.module_access) return null;
    if (typeof u.module_access === 'string') { try { return JSON.parse(u.module_access); } catch { return null; } }
    return u.module_access;
  })();
  return {
    access,
    // A missing map is an EMPTY account now, not "all modules" — a roster row
    // reading 58/58 for someone who can open nothing is the wrong warning.
    count: !access
      ? (u.role === 'admin' ? ALL_MODULE_IDS.length : 0)
      : (Array.isArray(access) ? access.length : Object.keys(access).length),
  };
}

function DeptChip({ department }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
      department === 'qa' ? 'bg-teal-100 text-teal-700'
      : department === 'document_control' ? 'bg-purple-100 text-purple-700'
      : department === 'cleaning' ? 'bg-amber-100 text-amber-700'
      : department === 'production' ? 'bg-green-100 text-green-700'
      : department === 'maintenance' ? 'bg-orange-100 text-orange-700'
      : department === 'office' ? 'bg-slate-100 text-slate-700'
      : 'bg-indigo-100 text-indigo-700'
    }`}>
      {deptLabel(department)}
    </span>
  );
}

function AccessNote({ u }) {
  const { access, count } = moduleCountOf(u);
  if (u.role === 'admin' && !access) return <span className="text-[10px] text-gray-400">All modules</span>;
  // Amber, because this account can open nothing until someone acts.
  if (count === 0) return <span className="text-[10px] font-semibold text-amber-600">No modules assigned</span>;
  return <span className="text-[10px] text-gray-500">{count}/{ALL_MODULE_IDS.length} modules</span>;
}

function StatusChip({ active }) {
  return active
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Active</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-600"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Inactive</span>;
}

function UserName({ u }) {
  return (
    <>
      <span className="font-medium text-gray-900">{u.name}</span>
      {u.username && u.username !== u.name && (
        <span className="ml-2 text-[11px] text-gray-400">signs in as {u.username}</span>
      )}
      {u.is_contractor ? (
        <span className="ml-2 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold">CONTRACTOR</span>
      ) : null}
      {u.contractor_company && <div className="text-[10px] text-gray-400">{u.contractor_company}</div>}
    </>
  );
}

function UserActions({ u, onEdit, onToggle, onRemove, isEditing, className = '' }) {
  return (
    <div className={`flex gap-1.5 items-center ${className}`}>
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
  );
}

function UserRow({ u, onEdit, onToggle, onRemove, isEditing }) {
  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50 ${isEditing ? 'bg-powder-50' : ''}`}>
      <td className="px-4 py-3 w-full"><UserName u={u} /></td>
      <td className="px-4 py-3"><DeptChip department={u.department} /></td>
      <td className="px-4 py-3"><AccessNote u={u} /></td>
      <td className="px-4 py-3 whitespace-nowrap"><StatusChip active={u.is_active} /></td>
      <td className="px-4 py-3 text-right">
        <UserActions u={u} onEdit={onEdit} onToggle={onToggle} onRemove={onRemove} isEditing={isEditing} className="justify-end" />
      </td>
    </tr>
  );
}

function UserCard({ u, onEdit, onToggle, onRemove, isEditing }) {
  return (
    <div className={`px-4 py-3 ${isEditing ? 'bg-powder-50' : ''}`}>
      <div className="min-w-0"><UserName u={u} /></div>
      <div className="flex items-center gap-2 flex-wrap mt-1.5">
        <DeptChip department={u.department} />
        <StatusChip active={u.is_active} />
        <AccessNote u={u} />
      </div>
      <UserActions u={u} onEdit={onEdit} onToggle={onToggle} onRemove={onRemove} isEditing={isEditing} className="mt-2 flex-wrap" />
    </div>
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
      {/* The table needs 560px to lay out, so on a phone it sat in a horizontal
          scroller — which put Status and the Edit / Deactivate buttons off the
          right edge, and swallowed the inline edit form with them. A form you
          can only reach by discovering a sideways scroll is a form nobody
          edits. Below md the same rows are cards, and the edit form is a plain
          full-width block underneath. */}
      {open && users.length > 0 && (
        <div className="hidden md:block overflow-x-auto">
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
      {open && users.length > 0 && (
        <div className="md:hidden border-t divide-y divide-gray-100">
          {users.map(u => (
            <Fragment key={u.id}>
              <UserCard u={u} onEdit={onEdit} onToggle={onToggle} onRemove={onRemove} isEditing={u.id === editingId} />
              {u.id === editingId && (
                <div className="p-3 bg-gray-50">
                  <UserForm initial={u} onSave={onSave} onCancel={onCancel} canViewPin={canViewPin} />
                </div>
              )}
            </Fragment>
          ))}
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
      {/* max-h + scroll: a fixed, centred flex box CLIPS content taller than the
          viewport rather than scrolling it, so on a short phone the Add button
          was simply gone. */}
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto">
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

// Named access templates ("QA Tech", "Production Operator"): save a full
// module map once, apply it anywhere a ModuleAccessEditor appears.
function TemplateTools({ current, onApply }) {
  const { data, refresh } = useApiGet('/users/access-templates');
  const templates = data?.templates || {};
  const names = Object.keys(templates).sort();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    // A full-access (null) map saves as explicit all-edit so it round-trips.
    const access = current == null ? Object.fromEntries(ALL_MODULE_IDS.map(m => [m, 'edit'])) : current;
    await apiPut('/users/access-templates', { name: n, access });
    setSaveOpen(false); setName(''); refresh();
  };
  const remove = async (n) => { await apiPut('/users/access-templates', { name: n, access: null }); refresh(); };

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      {names.length > 0 && (
        <select defaultValue="" onChange={e => { const n = e.target.value; if (n) { onApply({ ...templates[n] }); e.target.value = ''; } }}
          className="px-2 py-1 border border-gray-200 rounded-md text-xs text-gray-600 bg-white">
          <option value="">Apply template…</option>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
      {saveOpen ? (
        <span className="inline-flex items-center gap-1">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            className="px-2 py-1 border border-gray-300 rounded-md text-xs w-32" />
          <button type="button" onClick={save} className="px-2 py-1 bg-powder-600 text-white rounded-md">Save</button>
          <button type="button" onClick={() => setSaveOpen(false)} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-md">✕</button>
        </span>
      ) : (
        <button type="button" onClick={() => setSaveOpen(true)}
          className="px-2 py-1 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">Save as template</button>
      )}
      {names.length > 0 && (
        <details className="inline-block">
          <summary className="px-2 py-1 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 cursor-pointer list-none">Manage</summary>
          <div className="absolute mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1 z-10">
            {names.map(n => (
              <div key={n} className="flex items-center gap-2 px-2 py-1">
                <span className="text-xs text-gray-700 flex-1">{n}</span>
                <button type="button" onClick={() => remove(n)} className="text-[11px] text-red-500 hover:text-red-700">delete</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// Downloads the admin full-data ZIP (auth header required, so plain <a> won't do).
function BulkAccessModal({ users, onClose, onDone }) {
  const [selected, setSelected] = useState({});
  // Merge mode (default): `access` holds only the changes to apply. Overwrite
  // mode: `access` is the complete map every selected user ends up with.
  const [overwrite, setOverwrite] = useState(false);
  const [access, setAccess] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const eligible = (users || []).filter(u => u.role !== 'admin');
  const chosen = Object.keys(selected).filter(id => selected[id]);
  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const changeCount = Object.keys(access || {}).length;

  const switchMode = (ow) => { setOverwrite(ow); setAccess({}); };
  const applyTemplate = (map) => { setOverwrite(true); setAccess(map); };

  const apply = async () => {
    if (!chosen.length) { setError('Select at least one user.'); return; }
    if (!overwrite && !changeCount) { setError('Set at least one module (everything is on Keep).'); return; }
    setSaving(true); setError('');
    try {
      await apiPost('/users/bulk-access', { user_ids: chosen, module_access: access, mode: overwrite ? 'replace' : 'merge' });
      onDone();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Wider than a normal modal: the right pane holds the full module
          editor, and squeezing 50-odd modules into half of max-w-2xl is what
          made this unreadable. */}
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">Bulk module permissions</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {/* The people list is a fixed, narrow column; the module editor takes
            the rest, which is what it needs to lay out without overlapping. */}
        <div className="p-4 grid lg:grid-cols-[18rem_1fr] gap-4 overflow-y-auto">
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-medium text-gray-700">{overwrite ? 'Access to apply (replaces everything)' : 'Changes to apply'}</p>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" data-tip="Off: only the modules you set here change; each user's other settings are kept. On: the map below replaces each user's entire access.">
                <input type="checkbox" checked={overwrite} onChange={e => switchMode(e.target.checked)} className="rounded border-gray-300 text-powder-600" />
                Overwrite entire access
              </label>
            </div>
            <TemplateTools current={overwrite ? access : null} onApply={applyTemplate} />
            {!overwrite && (
              <p className="text-[11px] text-gray-500 bg-powder-50 border border-powder-100 rounded-lg p-2">
                Safe by default: modules on <strong>Keep</strong> are untouched, so per-person tweaks survive. {changeCount ? `${changeCount} module${changeCount === 1 ? '' : 's'} will change.` : ''}
              </p>
            )}
            <ModuleAccessEditor value={access} onChange={setAccess} additive={!overwrite} />
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


// The Settings section itself — everything above is what it is built from.
export default function UsersSection({ user: currentUser }) {
  const { data: users, loading, refresh } = useApiGet('/users');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [bulkAdd, setBulkAdd] = useState(false);
  const [bulkAccess, setBulkAccess] = useState(false);

  const handleCreate = async (form) => {
    await apiPost('/users', form);
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    const saved = await apiPut(`/users/${editing.id}`, form);
    setEditing(null);
    refresh();
    // Ticking the consent box texts a confirmation. Say which happened —
    // "nothing was sent and nothing said why" is the failure this SMS path has
    // hit at every other step.
    if (saved?.optin_sent) {
      window.alert(`Consent recorded, and a confirmation text has been sent to ${form.name || 'that number'}. They can reply STOP at any time.`);
    } else if (saved?.optin_error) {
      window.alert(`Consent was recorded, but the confirmation text did not send:\n\n${saved.optin_error}`);
    }
  };

  const handleToggleActive = async (u) => {
    await apiPut(`/users/${u.id}`, { is_active: !u.is_active });
    refresh();
  };

  const handleRemove = async (u) => {
    if (!window.confirm(`Permanently remove ${u.name}? This only works if they have no message or task history — otherwise deactivate them instead.`)) return;
    try {
      await apiDelete(`/users/${u.id}`);
      refresh();
    } catch (e) {
      window.alert(e.message || 'Could not remove this person. Deactivate them instead to keep their history.');
    }
  };

  const handleEdit = (u) => {
    setEditing(prev => (prev?.id === u.id ? null : u));
    setShowForm(false);
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  const grouped = { admin: [], supervisor: [], operator: [], auditor: [] };
  (users || []).forEach(u => {
    const role = u.role || 'operator';
    if (grouped[role]) grouped[role].push(u);
    else grouped.operator.push(u);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setBulkAccess(true)}
          className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
          <Shield size={15} /> Bulk Permissions
        </button>
        <button onClick={() => { setBulkAdd(true); setEditing(null); setShowForm(false); }}
          className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
          <Users size={15} /> Bulk Add
        </button>
        {/* `ml-auto` pushes this to the right on a wide header; on a phone the
            row wraps and that left it stranded on a line of its own. */}
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 sm:ml-auto">
          <Plus size={16} /> Add User
        </button>
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

      {bulkAdd && <BulkAddModal onClose={() => setBulkAdd(false)} onDone={() => { setBulkAdd(false); refresh(); }} />}
      {bulkAccess && <BulkAccessModal users={users || []} onClose={() => setBulkAccess(false)} onDone={() => { setBulkAccess(false); refresh(); }} />}
    </div>
  );
}
