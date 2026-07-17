import { useState, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete, apiUpload } from '../../hooks/useApi';
import { Hash, Lock, X, Trash2, Archive, ArchiveRestore, Pencil, Check, Users, Upload, Loader2, UserPlus, UserMinus } from 'lucide-react';

const DEPARTMENTS = ['warehouse', 'maintenance', 'qa', 'cleaning', 'document_control', 'office'];
const ROLES = ['operator', 'supervisor', 'auditor', 'admin'];

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg ${active ? 'bg-powder-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
      <Icon size={15} /> {children}
    </button>
  );
}

/* ─────────────────────────── Channels tab ─────────────────────────── */
function ChannelsTab({ users }) {
  const { data: channels, loading, refresh } = useApiGet('/comms/admin/channels');
  const [editing, setEditing] = useState(null); // channel id being renamed
  const [editName, setEditName] = useState('');
  const [managing, setManaging] = useState(null); // channel object for member mgmt
  const [busy, setBusy] = useState(false);

  const rows = channels || [];

  const rename = async (c) => {
    if (!editName.trim() || editName.trim() === c.name) { setEditing(null); return; }
    await apiPut(`/comms/channels/${c.id}`, { name: editName.trim() });
    setEditing(null); refresh();
  };
  const togglePrivacy = async (c) => {
    setBusy(true);
    try { await apiPut(`/comms/channels/${c.id}`, { kind: c.kind === 'private' ? 'public' : 'private' }); refresh(); }
    finally { setBusy(false); }
  };
  const toggleArchive = async (c) => {
    if (c.archived) { await apiPut(`/comms/channels/${c.id}`, { archived: false }); }
    else { await apiDelete(`/comms/channels/${c.id}`); } // soft archive
    refresh();
  };
  const purge = async (c) => {
    if (!window.confirm(`Permanently delete #${c.name} and all ${c.message_count} messages? This cannot be undone.`)) return;
    await apiDelete(`/comms/channels/${c.id}?purge=true`);
    refresh();
  };

  if (managing) return <ChannelMembers channel={managing} users={users} onBack={() => { setManaging(null); refresh(); }} />;

  return (
    <div>
      {loading ? <p className="text-sm text-gray-400 py-6 text-center">Loading channels…</p> : (
        <div className="space-y-1.5">
          {rows.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No channels yet.</p>}
          {rows.map(c => (
            <div key={c.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${c.archived ? 'bg-gray-50 border-gray-200 opacity-70' : 'border-gray-200'}`}>
              {c.kind === 'private' ? <Lock size={15} className="text-gray-400 shrink-0" /> : <Hash size={15} className="text-gray-400 shrink-0" />}
              {editing === c.id ? (
                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') rename(c); if (e.key === 'Escape') setEditing(null); }}
                  className="flex-1 px-2 py-1 border border-powder-300 rounded text-sm" />
              ) : (
                <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                  {c.name}
                  {c.archived ? <span className="ml-2 text-[10px] uppercase text-gray-400">archived</span> : null}
                  <span className="ml-2 text-xs font-normal text-gray-400">{c.member_count} members · {c.message_count} msgs</span>
                </span>
              )}
              {editing === c.id ? (
                <button onClick={() => rename(c)} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Save"><Check size={15} /></button>
              ) : (
                <>
                  <button onClick={() => { setEditing(c.id); setEditName(c.name); }} className="p-1 text-gray-400 hover:text-powder-600 rounded" title="Rename"><Pencil size={14} /></button>
                  <button onClick={() => togglePrivacy(c)} disabled={busy} className="p-1 text-gray-400 hover:text-powder-600 rounded" title={c.kind === 'private' ? 'Make public' : 'Make private'}>
                    {c.kind === 'private' ? <Hash size={14} /> : <Lock size={14} />}
                  </button>
                  <button onClick={() => setManaging(c)} className="p-1 text-gray-400 hover:text-powder-600 rounded" title="Members"><Users size={14} /></button>
                  <button onClick={() => toggleArchive(c)} className="p-1 text-gray-400 hover:text-amber-600 rounded" title={c.archived ? 'Unarchive' : 'Archive'}>
                    {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                  <button onClick={() => purge(c)} className="p-1 text-gray-400 hover:text-red-600 rounded" title="Delete permanently"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-[11px] text-gray-400">
        Archiving hides a channel but keeps its history (reversible). Delete permanently removes the channel and every message — use with care.
      </p>
    </div>
  );
}

function ChannelMembers({ channel, users, onBack }) {
  const { data, refresh } = useApiGet(`/comms/channels/${channel.id}`);
  const members = data?.members || [];
  const memberIds = new Set(members.map(m => m.user_id));
  const [adding, setAdding] = useState(false);
  const candidates = (users || []).filter(u => u.is_active && !memberIds.has(u.id));

  const add = async (uid) => { await apiPost(`/comms/channels/${channel.id}/members`, { user_ids: [uid] }); refresh(); };
  const remove = async (uid) => { await apiDelete(`/comms/channels/${channel.id}/members/${uid}`); refresh(); };

  return (
    <div>
      <button onClick={onBack} className="text-sm text-powder-600 hover:text-powder-700 mb-3">← All channels</button>
      <div className="flex items-center gap-2 mb-3">
        {channel.kind === 'private' ? <Lock size={16} className="text-gray-400" /> : <Hash size={16} className="text-gray-400" />}
        <h4 className="font-semibold text-gray-900">{channel.name}</h4>
      </div>
      {channel.kind === 'public' && (
        <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
          This is a public channel — everyone can already see it. Membership only affects unread tracking here; make it private to restrict access.
        </p>
      )}
      <div className="space-y-1 mb-4">
        {members.length === 0 && <p className="text-sm text-gray-400">No members yet.</p>}
        {members.map(m => (
          <div key={m.user_id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200">
            <span className="flex-1 text-sm text-gray-800">{m.name}</span>
            {m.role === 'owner' && <span className="text-[10px] uppercase text-gray-400">owner</span>}
            <button onClick={() => remove(m.user_id)} className="p-1 text-gray-400 hover:text-red-600 rounded" title="Remove"><UserMinus size={14} /></button>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="border border-gray-200 rounded-lg p-2 max-h-52 overflow-y-auto">
          {candidates.length === 0 && <p className="text-sm text-gray-400 px-2 py-1">Everyone's already a member.</p>}
          {candidates.map(u => (
            <button key={u.id} onClick={() => add(u.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-powder-50 text-left">
              <UserPlus size={14} className="text-powder-600" />
              <span className="text-sm text-gray-800">{u.name}</span>
              <span className="text-xs text-gray-400 ml-auto">{u.department}</span>
            </button>
          ))}
          <button onClick={() => setAdding(false)} className="w-full mt-1 text-xs text-gray-400 hover:text-gray-600 py-1">Done</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-powder-600 hover:bg-powder-50 rounded-lg font-medium">
          <UserPlus size={15} /> Add members
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── People tab ─────────────────────────── */
function PeopleTab() {
  const { data: users, loading, refresh } = useApiGet('/users');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', department: 'warehouse', role: 'operator' });
  const [saving, setSaving] = useState(false);

  const active = (users || []).filter(u => u.is_active);
  const inactive = (users || []).filter(u => !u.is_active);

  const create = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/users', { name: form.name.trim(), department: form.department, role: form.role });
      setForm({ name: '', department: 'warehouse', role: 'operator' }); setShowAdd(false); refresh();
    } finally { setSaving(false); }
  };
  const setActive = async (u, val) => { await apiPut(`/users/${u.id}`, { is_active: val }); refresh(); };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">{active.length} active {inactive.length ? `· ${inactive.length} deactivated` : ''}</p>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
            <UserPlus size={15} /> Add person
          </button>
        )}
      </div>

      {showAdd && (
        <div className="border border-gray-200 rounded-lg p-3 mb-4 space-y-2">
          <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="px-2 py-2 border border-gray-300 rounded-lg text-sm">
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
            </select>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="px-2 py-2 border border-gray-300 rounded-lg text-sm">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-gray-400">They set a password the first time they log in with their name.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
            <button onClick={create} disabled={saving || !form.name.trim()} className="px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400 py-6 text-center">Loading people…</p> : (
        <div className="space-y-1">
          {active.map(u => (
            <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200">
              <span className="flex-1 text-sm font-medium text-gray-800">{u.name}</span>
              <span className="text-xs text-gray-400">{(u.department || '').replace('_', ' ')} · {u.role}</span>
              <button onClick={() => setActive(u, false)} className="p-1 text-gray-400 hover:text-red-600 rounded" title="Deactivate (removes login access)"><UserMinus size={15} /></button>
            </div>
          ))}
          {inactive.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase text-gray-400 px-1 pt-3">Deactivated</p>
              {inactive.map(u => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 opacity-75">
                  <span className="flex-1 text-sm text-gray-600">{u.name}</span>
                  <button onClick={() => setActive(u, true)} className="px-2 py-1 text-xs text-powder-600 hover:bg-powder-50 rounded font-medium">Reactivate</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <p className="mt-4 text-[11px] text-gray-400">
        Deactivating keeps a person's message history and audit trail but blocks login. History is never deleted.
      </p>
    </div>
  );
}

/* ─────────────────────────── Import tab ─────────────────────────── */
function ImportTab({ onImported }) {
  const { data: existingUsers } = useApiGet('/users');
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [privateSet, setPrivateSet] = useState(new Set());
  const [choices, setChoices] = useState({}); // slack_id -> existing user id ('' = create new)
  const [step, setStep] = useState('idle'); // idle | previewing | channels | people | importing | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const activeUsers = (existingUsers || []).filter(u => u.is_active);

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setError(''); setResult(null); setStep('previewing');
    try {
      const fd = new FormData(); fd.append('file', f);
      const p = await apiUpload('/comms/import/slack/preview', fd);
      // Seed choices: auto-matched keep their match; misses default to "create new".
      const seed = {};
      for (const u of (p.users || [])) seed[u.slack_id] = u.matched_user_id || '';
      setPreview(p); setPrivateSet(new Set()); setChoices(seed); setStep('channels');
    } catch (err) { setError(err.message || 'Could not read that file.'); setStep('idle'); }
  };

  const toggle = (name) => setPrivateSet(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allPrivate = () => setPrivateSet(new Set((preview?.channels || []).map(c => c.name)));
  const nonePrivate = () => setPrivateSet(new Set());

  const runImport = async () => {
    setStep('importing'); setError('');
    try {
      const userMap = {};
      for (const [sid, uid] of Object.entries(choices)) if (uid) userMap[sid] = uid;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('private_channels', JSON.stringify([...privateSet]));
      fd.append('user_map', JSON.stringify(userMap));
      const s = await apiUpload('/comms/import/slack', fd);
      setResult(s); setStep('done'); onImported?.();
    } catch (err) { setError(err.message || 'Import failed.'); setStep('people'); }
  };

  const reset = () => { setStep('idle'); setPreview(null); setFile(null); setResult(null); setChoices({}); };

  const users = preview?.users || [];
  const unmatched = users.filter(u => !u.matched);
  const willCreate = users.filter(u => !choices[u.slack_id]).length;
  const willMap = users.length - willCreate;

  return (
    <div>
      <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={onPick} />

      {step === 'idle' && (
        <>
          <p className="text-sm text-gray-600 mb-3">
            Upload a Slack workspace export (.zip). You'll pick which channels were private and confirm that people match up before anything is imported.
          </p>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
            <Upload size={16} /> Choose export .zip
          </button>
        </>
      )}
      {step === 'previewing' && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" /> Reading export…</p>}
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-2">{error}</p>}

      {/* Step 1 — channels */}
      {step === 'channels' && preview && (
        <div>
          <StepDots step={1} />
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-700 font-medium">{preview.channels.length} channels · {preview.userCount} people</p>
            <div className="text-xs">
              <button onClick={allPrivate} className="text-powder-600 hover:underline mr-2">All private</button>
              <button onClick={nonePrivate} className="text-gray-400 hover:underline">None</button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mb-2">Check the channels that should be <span className="font-medium">private</span> in this tool:</p>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {preview.channels.map(c => (
              <label key={c.name} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={privateSet.has(c.name)} onChange={() => toggle(c.name)} />
                {privateSet.has(c.name) ? <Lock size={13} className="text-gray-400" /> : <Hash size={13} className="text-gray-400" />}
                <span className="text-sm text-gray-800 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-gray-400">{c.messages} msgs</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => setStep('people')} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Next: match people →</button>
            <button onClick={reset} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      {/* Step 2 — people match */}
      {step === 'people' && preview && (
        <div>
          <StepDots step={2} />
          <div className={`rounded-lg px-3 py-2 mb-3 text-sm ${unmatched.length ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
            {unmatched.length === 0
              ? <>All {users.length} people match an existing account. ✓</>
              : <><span className="font-semibold">{unmatched.length}</span> of {users.length} people don't match an existing name. Map them to the right person, or leave as “Create new”.</>}
          </div>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {users.map(u => {
              const chosen = choices[u.slack_id] || '';
              return (
                <div key={u.slack_id} className="flex items-center gap-2 px-3 py-2">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${chosen ? 'bg-green-500' : 'bg-amber-400'}`} />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-gray-800 truncate block">{u.name}</span>
                    {u.handle && <span className="text-[11px] text-gray-400">@{u.handle}</span>}
                  </div>
                  <select value={chosen} onChange={e => setChoices(c => ({ ...c, [u.slack_id]: e.target.value }))}
                    className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 max-w-[52%]">
                    <option value="">➕ Create new</option>
                    {activeUsers.map(eu => <option key={eu.id} value={eu.id}>{eu.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">{willMap} mapped to existing · {willCreate} created new.</p>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => setStep('channels')} className="px-3 py-2 text-sm text-gray-500">← Back</button>
            <button onClick={runImport} className="flex items-center gap-2 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              Import {privateSet.size} private / {preview.channels.length - privateSet.size} public
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && <p className="flex items-center gap-2 text-sm text-gray-500 mt-3"><Loader2 size={15} className="animate-spin" /> Importing… this can take a moment for large histories.</p>}

      {step === 'done' && result && (
        <div className="mt-2 text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
          <p className="font-semibold mb-1">Import complete</p>
          <ul className="space-y-0.5 text-green-700">
            <li>• {result.messagesImported} messages imported</li>
            <li>• {result.channelsCreated} new channels ({result.channelsMadePrivate} set private)</li>
            <li>• {result.usersMapped} people mapped to existing · {result.usersCreated} created new</li>
            <li>• {result.skipped} skipped (duplicates / system notices)</li>
          </ul>
          <button onClick={reset} className="mt-2 text-xs text-green-700 hover:underline">Import another</button>
        </div>
      )}
    </div>
  );
}

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-2 mb-3 text-[11px] font-medium">
      <span className={step >= 1 ? 'text-powder-600' : 'text-gray-400'}>1. Channels</span>
      <span className="text-gray-300">→</span>
      <span className={step >= 2 ? 'text-powder-600' : 'text-gray-400'}>2. People</span>
      <span className="text-gray-300">→</span>
      <span className="text-gray-400">Import</span>
    </div>
  );
}

/* ─────────────────────────── Shell ─────────────────────────── */
export default function CommsSettings({ users, onClose, onChanged }) {
  const [tab, setTab] = useState('channels');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Communication Settings</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100">
          <TabButton active={tab === 'channels'} onClick={() => setTab('channels')} icon={Hash}>Channels</TabButton>
          <TabButton active={tab === 'people'} onClick={() => setTab('people')} icon={Users}>People</TabButton>
          <TabButton active={tab === 'import'} onClick={() => setTab('import')} icon={Upload}>Import</TabButton>
        </div>
        <div className="p-5 overflow-y-auto">
          {tab === 'channels' && <ChannelsTab users={users} />}
          {tab === 'people' && <PeopleTab />}
          {tab === 'import' && <ImportTab onImported={onChanged} />}
        </div>
      </div>
    </div>
  );
}
