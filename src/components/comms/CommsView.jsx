import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut } from '../../hooks/useApi';
import { Hash, Lock, Send, Plus, X, MessageSquare, ArrowLeft, Smile, Edit2, Trash2 } from 'lucide-react';

const EMOJI = ['👍', '✅', '❤️', '😄', '🎉', '👀', '🙏', '🔥'];
const fmtTime = (iso) => { const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'); return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

function NewChannelModal({ users, me, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('public');
  const [members, setMembers] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const chosen = Object.keys(members).filter(id => members[id]);

  const create = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const ch = await apiPost('/comms/channels', { name, kind, member_ids: kind === 'private' ? chosen : [] });
      onCreated(ch);
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">New channel</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. shipping" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="flex gap-2">
          {[['public', 'Public — anyone can join'], ['private', 'Private — invite only']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setKind(v)} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${kind === v ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300'}`}>{l}</button>
          ))}
        </div>
        {kind === 'private' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Members ({chosen.length})</label>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {(users || []).filter(u => u.id !== me.id).map(u => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm">
                  <input type="checkbox" checked={!!members[u.id]} onChange={() => setMembers(m => ({ ...m, [u.id]: !m[u.id] }))} />
                  {u.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={create} disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create channel'}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Message({ m, me, onReact, onUnreact, onEdit, onDelete }) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body || '');
  const mine = m.user_id === me.id;

  return (
    <div className="group flex gap-2 px-4 py-1.5 hover:bg-gray-50">
      <div className="h-8 w-8 rounded-lg bg-powder-100 text-powder-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        {m.user_name?.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-900 text-sm">{m.user_name}</span>
          <span className="text-[11px] text-gray-400">{fmtTime(m.created_at)}{m.edited ? ' · edited' : ''}</span>
        </div>
        {m.deleted ? (
          <p className="text-sm text-gray-400 italic">message deleted</p>
        ) : editing ? (
          <div className="flex items-center gap-2 mt-1">
            <input value={draft} onChange={e => setDraft(e.target.value)} className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
              onKeyDown={e => { if (e.key === 'Enter') { onEdit(m, draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} autoFocus />
            <button onClick={() => { onEdit(m, draft); setEditing(false); }} className="text-xs text-powder-600">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-400">Cancel</button>
          </div>
        ) : (
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{m.body}</p>
        )}
        {m.reactions?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {m.reactions.map(r => {
              const reacted = r.users.includes(me.id);
              return (
                <button key={r.emoji} onClick={() => reacted ? onUnreact(m, r.emoji) : onReact(m, r.emoji)}
                  className={`px-1.5 py-0.5 rounded-full text-xs border ${reacted ? 'bg-powder-50 border-powder-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                  {r.emoji} {r.count}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!m.deleted && (
        <div className="relative opacity-0 group-hover:opacity-100 flex items-start gap-1 shrink-0">
          <button onClick={() => setShowEmoji(s => !s)} className="p-1 text-gray-400 hover:text-gray-600" title="React"><Smile size={14} /></button>
          {mine && <button onClick={() => { setDraft(m.body || ''); setEditing(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 size={13} /></button>}
          {(mine) && <button onClick={() => onDelete(m)} className="p-1 text-gray-400 hover:text-red-500" title="Delete"><Trash2 size={13} /></button>}
          {showEmoji && (
            <div className="absolute right-0 top-6 z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-1 flex gap-0.5">
              {EMOJI.map(e => <button key={e} onClick={() => { onReact(m, e); setShowEmoji(false); }} className="p-1 hover:bg-gray-100 rounded">{e}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommsView({ user, onExit }) {
  const { data: channels, refresh: refreshChannels } = useApiGet('/comms/channels');
  const { data: users } = useApiGet('/users');
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [newChannel, setNewChannel] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [showDmPicker, setShowDmPicker] = useState(false);
  const scrollRef = useRef(null);

  const list = channels || [];
  const publicCh = list.filter(c => c.kind === 'public');
  const privateCh = list.filter(c => c.kind === 'private');
  const dms = list.filter(c => c.kind === 'dm');
  const active = list.find(c => c.id === activeId) || null;

  // Default to #general (or first channel) once loaded.
  useEffect(() => { if (!activeId && list.length) setActiveId((publicCh.find(c => c.name === 'general') || list[0]).id); }, [list, activeId]); // eslint-disable-line

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    try {
      const msgs = await apiFetch(`/comms/channels/${id}/messages`);
      setMessages(msgs);
      apiPost(`/comms/channels/${id}/read`, {}).then(refreshChannels).catch(() => {});
    } catch { /* channel may be inaccessible */ }
  }, [refreshChannels]);

  useEffect(() => { setMessages([]); loadMessages(activeId); }, [activeId, loadMessages]);
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => { apiFetch(`/comms/channels/${activeId}/messages`).then(setMessages).catch(() => {}); refreshChannels(); }, 4000);
    return () => clearInterval(t);
  }, [activeId, refreshChannels]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const text = body.trim();
    if (!text || !active) return;
    setBody('');
    try { const m = await apiPost(`/comms/channels/${active.id}/messages`, { body: text }); setMessages(ms => [...ms, m]); refreshChannels(); }
    catch { setBody(text); }
  };
  const react = async (m, emoji) => { const updated = await apiPost(`/comms/messages/${m.id}/reactions`, { emoji }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const unreact = async (m, emoji) => { const updated = await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const editMsg = async (m, text) => { if (!text.trim()) return; const updated = await apiPut(`/comms/messages/${m.id}`, { body: text }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const delMsg = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); loadMessages(activeId); };

  const openDm = async (u) => {
    const ch = await apiPost(`/comms/dm/${u.id}`, {});
    setShowDmPicker(false); setDmSearch('');
    await refreshChannels();
    setActiveId(ch.id);
  };

  const dmCandidates = useMemo(() => (users || []).filter(u => u.id !== user.id && u.name.toLowerCase().includes(dmSearch.toLowerCase())), [users, dmSearch, user.id]);

  const ChannelBtn = ({ c, icon: Icon }) => (
    <button onClick={() => setActiveId(c.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${activeId === c.id ? 'bg-powder-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
      <Icon size={14} className="shrink-0 opacity-80" />
      <span className="truncate flex-1 text-left">{c.name}</span>
      {c.unread > 0 && <span className={`text-[10px] font-bold px-1.5 rounded-full ${activeId === c.id ? 'bg-white/25' : 'bg-red-500 text-white'}`}>{c.unread}</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-white flex flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-gray-200 shrink-0">
        <MessageSquare size={18} className="text-powder-600" />
        <span className="font-bold text-gray-900">Messages</span>
        <button onClick={onExit} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={15} /> Back to Compliance
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* sidebar */}
        <div className="w-60 border-r border-gray-200 flex flex-col shrink-0 overflow-y-auto p-2 space-y-3">
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">Channels</span>
              <button onClick={() => setNewChannel(true)} className="text-gray-400 hover:text-powder-600" title="New channel"><Plus size={14} /></button>
            </div>
            <div className="space-y-0.5">
              {publicCh.map(c => <ChannelBtn key={c.id} c={c} icon={Hash} />)}
              {privateCh.map(c => <ChannelBtn key={c.id} c={c} icon={Lock} />)}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">Direct Messages</span>
              <button onClick={() => setShowDmPicker(s => !s)} className="text-gray-400 hover:text-powder-600" title="New DM"><Plus size={14} /></button>
            </div>
            {showDmPicker && (
              <div className="mb-1 px-1">
                <input value={dmSearch} onChange={e => setDmSearch(e.target.value)} placeholder="Search people…" className="w-full px-2 py-1 border border-gray-300 rounded text-xs mb-1" autoFocus />
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {dmCandidates.map(u => <button key={u.id} onClick={() => openDm(u)} className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50">{u.name}</button>)}
                </div>
              </div>
            )}
            <div className="space-y-0.5">
              {dms.map(c => <ChannelBtn key={c.id} c={c} icon={MessageSquare} />)}
            </div>
          </div>
        </div>

        {/* main pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {active ? (
            <>
              <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
                {active.kind === 'dm' ? <MessageSquare size={16} className="text-gray-400" /> : active.kind === 'private' ? <Lock size={16} className="text-gray-400" /> : <Hash size={16} className="text-gray-400" />}
                <span className="font-semibold text-gray-900">{active.name}</span>
                {active.topic && <span className="text-xs text-gray-400 truncate">— {active.topic}</span>}
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
                {messages.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No messages yet. Say hello 👋</p>}
                {messages.map(m => <Message key={m.id} m={m} me={user} onReact={react} onUnreact={unreact} onEdit={editMsg} onDelete={delMsg} />)}
              </div>
              <div className="border-t border-gray-200 p-3 shrink-0">
                <div className="flex items-end gap-2">
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={1}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={`Message ${active.kind === 'dm' ? active.name : '#' + active.name}`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none max-h-32" />
                  <button onClick={send} disabled={!body.trim()} className="p-2.5 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={16} /></button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Select a channel to start.</div>
          )}
        </div>
      </div>

      {newChannel && <NewChannelModal users={users} me={user} onClose={() => setNewChannel(false)} onCreated={(ch) => { setNewChannel(false); refreshChannels(); setActiveId(ch.id); }} />}
    </div>
  );
}
