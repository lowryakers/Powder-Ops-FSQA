import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload } from '../../hooks/useApi';
import { getSocket } from '../../lib/socket';
import { Hash, Lock, Send, Plus, X, MessageSquare, ArrowLeft, Smile, Edit2, Trash2, Paperclip, FileText, Download, Search, Loader2, Sparkles, Languages, Bell, BellOff, Upload, CalendarDays, Home } from 'lucide-react';

// VAPID public key (base64url) → Uint8Array for PushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const EMOJI = ['👍', '✅', '❤️', '😄', '🎉', '👀', '🙏', '🔥'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Highlight @mentions of known users; the current user's own mentions stand out.
function renderBody(text, users, meName) {
  if (!text || !users?.length) return text;
  const names = users.map(u => u.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const re = new RegExp('@(' + names.map(escapeRe).join('|') + ')', 'gi');
  const out = []; let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const isMe = meName && m[1].toLowerCase() === meName.toLowerCase();
    out.push(<span key={k++} className={isMe ? 'bg-amber-200 text-amber-900 rounded px-1 font-semibold' : 'text-powder-700 font-medium'}>@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const fmtTime = (iso) => { const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'); return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const fmtSize = (n) => { if (!n && n !== 0) return ''; if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB'; };

function Attachment({ a }) {
  if (a.is_image && a.url) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block mt-1 max-w-xs">
        <img src={a.url} alt={a.filename} className="rounded-lg border border-gray-200 max-h-64 object-contain" />
      </a>
    );
  }
  return (
    <a href={a.url || undefined} target="_blank" rel="noreferrer" download={a.filename}
      className="mt-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 max-w-xs">
      <FileText size={16} className="text-powder-600 shrink-0" />
      <span className="text-sm text-gray-800 truncate">{a.filename}</span>
      <span className="text-[10px] text-gray-400 shrink-0">{fmtSize(a.size)}</span>
      <Download size={13} className="text-gray-400 shrink-0" />
    </a>
  );
}

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

function Message({ m, me, onReact, onUnreact, onEdit, onDelete, canTranslate, viewerLang, onTranslate, autoTranslate, mentionUsers }) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body || '');
  const [translated, setTranslated] = useState(null);
  const [translating, setTranslating] = useState(false);
  const mine = m.user_id === me.id;

  const doTranslate = useCallback(async () => {
    if (translating || translated) return;
    setTranslating(true);
    try { setTranslated(await onTranslate(m, viewerLang)); } catch { /* ignore */ }
    finally { setTranslating(false); }
  }, [translating, translated, onTranslate, m, viewerLang]);

  // Channel-level "translate everything" + language changes. Keyed only on the
  // toggle and language so a manual translate (which mutates local state) is not
  // wiped. Auto on → translate; auto off / lang change → clear so the next
  // request uses the current language.
  useEffect(() => {
    let cancelled = false;
    if (autoTranslate && canTranslate && m.body && !m.deleted) {
      (async () => { try { const t = await onTranslate(m, viewerLang); if (!cancelled) setTranslated(t); } catch { /* ignore */ } })();
    } else {
      setTranslated(null);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, viewerLang]);

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
          m.body && (
            <div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{renderBody(translated ?? m.body, mentionUsers, me.name)}</p>
              {translating && <span className="text-[11px] text-gray-400 italic">Translating…</span>}
              {translated && (
                <button onClick={() => setTranslated(null)} className="text-[11px] text-powder-600 hover:underline">
                  Translated to {viewerLang === 'en' ? 'English' : 'Spanish'} · Show original
                </button>
              )}
            </div>
          )
        )}
        {!m.deleted && m.attachments?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.attachments.map(a => <Attachment key={a.id} a={a} />)}
          </div>
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
          {canTranslate && m.body && !translated && <button onClick={doTranslate} className="p-1 text-gray-400 hover:text-gray-600" title="Translate"><Languages size={13} /></button>}
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

export default function CommsView({ user, onExit, onGoToSchedule, homePref, onSetHome }) {
  const { data: channels, refresh: refreshChannels } = useApiGet('/comms/channels');
  const { data: users } = useApiGet('/users');
  const { data: commsStatus } = useApiGet('/comms/status');
  const storageOn = !!commsStatus?.storage;
  const semanticOn = !!commsStatus?.semantic;
  const askOn = !!commsStatus?.ask;
  const translateOn = !!commsStatus?.translate;
  const pushOn = !!commsStatus?.push;
  const [viewerLang, setViewerLang] = useState(() => localStorage.getItem('op_lang') || 'en');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [newChannel, setNewChannel] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [typers, setTypers] = useState([]); // {user_id, user_name, at} of people typing in the active channel
  const [pending, setPending] = useState([]); // uploaded-but-unsent attachments for the composer
  const [uploading, setUploading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState('keyword'); // keyword | smart | ask
  const [answer, setAnswer] = useState(null); // AI answer in ask mode
  const [mentionQuery, setMentionQuery] = useState(null); // text after "@" being typed, or null
  const scrollRef = useRef(null);
  const socketRef = useRef(null);
  const lastTypeSent = useRef(0);
  const fileInputRef = useRef(null);
  const composerRef = useRef(null);
  const slackZipRef = useRef(null);
  const [importing, setImporting] = useState(false);

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

  useEffect(() => { setMessages([]); setTypers([]); setPending([]); loadMessages(activeId); }, [activeId, loadMessages]);

  // Establish the shared socket once for this view + a global @mention handler.
  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;
    const onMention = (p) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try { new Notification(`${p.from} mentioned you`, { body: p.preview, tag: p.message_id }); } catch { /* ignore */ }
      }
    };
    s.on('mention', onMention);
    return () => { s.off('mention', onMention); socketRef.current = null; };
  }, []);

  // Realtime: join the active channel's room and react to pushed events (Phase 2,
  // replacing the old 4s poll). socket.io does not auto-rejoin rooms, so we
  // re-join and resync on every (re)connect.
  useEffect(() => {
    const s = socketRef.current;
    if (!s || !activeId) return;
    s.emit('channel:join', activeId);

    const onNew = (m) => {
      if (m.channel_id !== activeId || m.parent_id) return;
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]);
      setTypers(t => t.filter(x => x.user_id !== m.user_id));
    };
    const onUpdate = (m) => { if (m.channel_id === activeId) setMessages(ms => ms.map(x => x.id === m.id ? m : x)); };
    const onChannels = () => refreshChannels();
    const onTyping = (t) => {
      if (t.channel_id !== activeId || t.user_id === user.id) return;
      setTypers(prev => [...prev.filter(x => x.user_id !== t.user_id), { ...t, at: Date.now() }]);
    };
    const onConnect = () => { s.emit('channel:join', activeId); loadMessages(activeId); refreshChannels(); };

    s.on('message:new', onNew);
    s.on('message:update', onUpdate);
    s.on('channels:changed', onChannels);
    s.on('typing', onTyping);
    s.on('connect', onConnect);
    return () => {
      s.emit('channel:leave', activeId);
      s.off('message:new', onNew); s.off('message:update', onUpdate);
      s.off('channels:changed', onChannels); s.off('typing', onTyping); s.off('connect', onConnect);
    };
  }, [activeId, refreshChannels, loadMessages, user.id]);

  // Expire typing indicators that have gone quiet for >4s.
  useEffect(() => {
    if (!typers.length) return;
    const t = setInterval(() => setTypers(prev => prev.filter(x => Date.now() - x.at < 4000)), 1500);
    return () => clearInterval(t);
  }, [typers.length]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const text = body.trim();
    if ((!text && pending.length === 0) || !active) return;
    const attachment_ids = pending.map(p => p.id);
    setBody(''); setPending([]); setMentionQuery(null);
    try {
      const m = await apiPost(`/comms/channels/${active.id}/messages`, { body: text, attachment_ids });
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]);
      refreshChannels();
    } catch { setBody(text); setPending(pending); }
  };

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !active) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const uploaded = await apiUpload(`/comms/channels/${active.id}/attachments`, fd);
      setPending(p => [...p, ...uploaded]);
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };
  const removePending = (id) => setPending(p => p.filter(x => x.id !== id));
  const react = async (m, emoji) => { const updated = await apiPost(`/comms/messages/${m.id}/reactions`, { emoji }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const unreact = async (m, emoji) => { const updated = await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const editMsg = async (m, text) => { if (!text.trim()) return; const updated = await apiPut(`/comms/messages/${m.id}`, { body: text }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const delMsg = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); loadMessages(activeId); };

  const onBodyChange = (e) => {
    const val = e.target.value;
    setBody(val);
    // @mention autocomplete: detect an @token immediately before the caret.
    const caret = e.target.selectionStart ?? val.length;
    const mm = /(?:^|\s)@([^\s@]*)$/.exec(val.slice(0, caret));
    setMentionQuery(mm ? mm[1] : null);
    const now = Date.now();
    if (activeId && socketRef.current && now - lastTypeSent.current > 1500) {
      lastTypeSent.current = now;
      socketRef.current.emit('typing', activeId);
    }
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return (users || []).filter(u => u.id !== user.id && u.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, users, user.id]);

  const insertMention = (name) => {
    const ta = composerRef.current;
    const caret = ta ? ta.selectionStart : body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, '@' + name + ' ');
    const after = body.slice(caret);
    setBody(before + after);
    setMentionQuery(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(before.length, before.length); } });
  };

  const translateMessage = useCallback(async (m, lang) => {
    const r = await apiPost(`/comms/messages/${m.id}/translate`, { lang });
    return r.text;
  }, []);
  const setLang = (l) => { setViewerLang(l); localStorage.setItem('op_lang', l); };

  // Reflect any existing push subscription in the bell state.
  useEffect(() => {
    if (!pushOn || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setPushSubscribed(!!sub)).catch(() => {});
  }, [pushOn]);

  const togglePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { alert('Notifications are not supported on this device/browser.'); return; }
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await apiPost('/comms/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
        setPushSubscribed(false);
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
        const { key } = await apiFetch('/comms/push/key');
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
        await apiPost('/comms/push/subscribe', { subscription: sub.toJSON() });
        setPushSubscribed(true);
      }
    } catch (e) { alert(e.message || 'Could not update notifications'); }
    finally { setPushBusy(false); }
  };

  const onImportSlack = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const s = await apiUpload('/comms/import/slack', fd);
      alert(`Slack import complete:\n• ${s.messagesImported} messages\n• ${s.channelsCreated} new channels\n• ${s.usersCreated} new users\n• ${s.skipped} skipped`);
      refreshChannels();
    } catch (err) { alert(err.message || 'Import failed'); }
    finally { setImporting(false); }
  };

  const openDm = async (u) => {
    const ch = await apiPost(`/comms/dm/${u.id}`, {});
    setShowDmPicker(false); setDmSearch('');
    await refreshChannels();
    setActiveId(ch.id);
  };

  const dmCandidates = useMemo(() => (users || []).filter(u => u.id !== user.id && u.name.toLowerCase().includes(dmSearch.toLowerCase())), [users, dmSearch, user.id]);

  // Debounced keyword/semantic search. Ask mode is manual (runs on Enter) since
  // it calls the AI — we don't want a request per keystroke.
  useEffect(() => {
    if (searchMode === 'ask') return;
    if (searchQ.trim().length < 2) { setSearchResults(null); setAnswer(null); setSearching(false); return; }
    setSearching(true); setAnswer(null);
    const mode = searchMode === 'smart' ? 'semantic' : 'keyword';
    const t = setTimeout(() => {
      apiFetch(`/comms/search?q=${encodeURIComponent(searchQ.trim())}&mode=${mode}`)
        .then(r => setSearchResults(r)).catch(() => setSearchResults([])).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, searchMode]);

  const runAsk = async () => {
    const question = searchQ.trim();
    if (question.length < 3) return;
    setSearching(true); setAnswer(null); setSearchResults(null);
    try {
      const r = await apiPost('/comms/ask', { question });
      setAnswer(r.answer); setSearchResults(r.sources || []);
    } catch (e) { setAnswer(`⚠️ ${e.message || 'Ask failed'}`); setSearchResults([]); }
    finally { setSearching(false); }
  };

  const clearSearch = () => { setSearchQ(''); setSearchResults(null); setAnswer(null); };
  const openResult = (r) => { clearSearch(); setActiveId(r.channel_id); };

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
        <button onClick={onExit} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg shrink-0" title="Switch to the FSQA tools">
          <ArrowLeft size={16} /> FSQA
        </button>
        {onGoToSchedule && (
          <button onClick={onGoToSchedule} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg shrink-0" title="Go to the Production Schedule">
            <CalendarDays size={16} /> <span className="hidden sm:inline">Schedule</span>
          </button>
        )}
        <div className="h-5 w-px bg-gray-200 shrink-0" />
        <MessageSquare size={18} className="text-powder-600 shrink-0" />
        <span className="font-bold text-gray-900 shrink-0">Messages</span>
        <div className="ml-4 flex items-center gap-2 flex-1 max-w-lg">
          <div className="relative flex-1">
            {searchMode === 'ask' ? <Sparkles size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-powder-500" />
              : <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />}
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchMode === 'ask') runAsk(); }}
              placeholder={searchMode === 'ask' ? 'Ask about your messages…' : searchMode === 'smart' ? 'Smart search…' : 'Search messages…'}
              className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded-lg text-sm" />
            {searchQ && <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
          </div>
          {(semanticOn || askOn) && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs shrink-0">
              {[['keyword', 'Keyword'], semanticOn && ['smart', 'Smart'], askOn && ['ask', 'Ask']].filter(Boolean).map(([m, label]) => (
                <button key={m} onClick={() => { setSearchMode(m); setSearchResults(null); setAnswer(null); }}
                  className={`px-2.5 py-1.5 font-medium ${searchMode === m ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onSetHome && (
            <button onClick={() => onSetHome('messages')} title={homePref === 'messages' ? 'Messages is your home screen' : 'Make Messages your home screen'}
              className={`p-2 rounded-lg ${homePref === 'messages' ? 'text-powder-600 bg-powder-50 hover:bg-powder-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              <Home size={16} />
            </button>
          )}
          {user.role === 'admin' && (
            <>
              <input ref={slackZipRef} type="file" accept=".zip" className="hidden" onChange={onImportSlack} />
              <button onClick={() => slackZipRef.current?.click()} disabled={importing}
                title="Import Slack export (.zip)" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-50">
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              </button>
            </>
          )}
          {pushOn && (
            <button onClick={togglePush} disabled={pushBusy}
              title={pushSubscribed ? 'Notifications on — click to turn off' : 'Enable push notifications'}
              className={`p-2 rounded-lg ${pushSubscribed ? 'text-powder-600 bg-powder-50 hover:bg-powder-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              {pushSubscribed ? <Bell size={16} /> : <BellOff size={16} />}
            </button>
          )}
        </div>
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
          {(searchResults !== null || answer !== null || (searching && searchMode === 'ask')) ? (
            <>
              <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
                {searchMode === 'ask' ? <Sparkles size={16} className="text-powder-500" /> : <Search size={16} className="text-gray-400" />}
                <span className="font-semibold text-gray-900">{searchMode === 'ask' ? 'Ask' : 'Search'}</span>
                {searching ? <Loader2 size={14} className="animate-spin text-gray-400" />
                  : searchMode === 'ask'
                    ? <span className="text-xs text-gray-400">{(searchResults?.length || 0)} source{(searchResults?.length || 0) !== 1 ? 's' : ''}</span>
                    : <span className="text-xs text-gray-400">{(searchResults?.length || 0)} result{(searchResults?.length || 0) !== 1 ? 's' : ''} for “{searchQ.trim()}”</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {searchMode === 'ask' && searching && <p className="text-center text-sm text-gray-400 py-8">Thinking…</p>}
                {answer !== null && (
                  <div className="mb-2 mx-1 p-3 rounded-xl bg-powder-50 border border-powder-100">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-powder-600 mb-1"><Sparkles size={12} /> Answer</div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{answer}</p>
                  </div>
                )}
                {answer !== null && (searchResults?.length || 0) > 0 && <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase text-gray-400">Sources</div>}
                {!searching && searchResults !== null && searchResults.length === 0 && searchMode !== 'ask' && <p className="text-center text-sm text-gray-400 py-8">No messages found.</p>}
                {(searchResults || []).map(r => (
                  <button key={r.id} onClick={() => openResult(r)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-0.5">
                      {r.channel_kind === 'dm' ? <MessageSquare size={11} /> : r.channel_kind === 'private' ? <Lock size={11} /> : <Hash size={11} />}
                      <span className="font-medium text-gray-500">{r.channel_kind === 'dm' ? r.channel_name : (r.channel_kind === 'private' ? '' : '#') + r.channel_name}</span>
                      <span>· {r.user_name} · {fmtTime(r.created_at)}</span>
                    </div>
                    <div className="text-sm text-gray-800 line-clamp-2">{r.body}</div>
                  </button>
                ))}
              </div>
            </>
          ) : active ? (
            <>
              <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
                {active.kind === 'dm' ? <MessageSquare size={16} className="text-gray-400" /> : active.kind === 'private' ? <Lock size={16} className="text-gray-400" /> : <Hash size={16} className="text-gray-400" />}
                <span className="font-semibold text-gray-900">{active.name}</span>
                {active.topic && <span className="text-xs text-gray-400 truncate">— {active.topic}</span>}
                {translateOn && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => setAutoTranslate(v => !v)} title="Translate all messages"
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${autoTranslate ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                      <Languages size={13} /> Translate
                    </button>
                    <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                      {['en', 'es'].map(l => (
                        <button key={l} onClick={() => setLang(l)} className={`px-2 py-1 text-[10px] font-bold ${viewerLang === l ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{l.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
                {messages.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No messages yet. Say hello 👋</p>}
                {messages.map(m => <Message key={m.id} m={m} me={user} onReact={react} onUnreact={unreact} onEdit={editMsg} onDelete={delMsg}
                  canTranslate={translateOn} viewerLang={viewerLang} onTranslate={translateMessage} autoTranslate={autoTranslate} mentionUsers={users} />)}
              </div>
              <div className="border-t border-gray-200 p-3 shrink-0 relative">
                {mentionMatches.length > 0 && (
                  <div className="absolute bottom-full mb-1 left-3 right-3 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20 max-h-48 overflow-y-auto">
                    {mentionMatches.map((u, idx) => (
                      <button key={u.id} onMouseDown={e => { e.preventDefault(); insertMention(u.name); }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-powder-50 ${idx === 0 ? 'bg-gray-50' : ''}`}>
                        <span className="font-medium text-gray-800">@{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="h-4 px-1 mb-0.5 text-[11px] text-gray-400 italic">
                  {typers.length === 1 ? `${typers[0].user_name} is typing…`
                    : typers.length === 2 ? `${typers[0].user_name} and ${typers[1].user_name} are typing…`
                    : typers.length > 2 ? 'Several people are typing…' : ''}
                </div>
                {(pending.length > 0 || uploading) && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pending.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border border-gray-200 bg-gray-50 text-xs">
                        {p.is_image ? <Paperclip size={12} className="text-powder-600" /> : <FileText size={12} className="text-powder-600" />}
                        <span className="max-w-[140px] truncate text-gray-700">{p.filename}</span>
                        <button onClick={() => removePending(p.id)} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
                      </div>
                    ))}
                    {uploading && <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Uploading…</div>}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  {storageOn && (
                    <>
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
                      <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl disabled:opacity-40" title="Attach files">
                        <Paperclip size={18} />
                      </button>
                    </>
                  )}
                  <textarea ref={composerRef} value={body} onChange={onBodyChange} rows={1}
                    onKeyDown={e => {
                      if (mentionMatches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insertMention(mentionMatches[0].name); return; }
                      if (e.key === 'Escape' && mentionQuery !== null) { setMentionQuery(null); return; }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    placeholder={`Message ${active.kind === 'dm' ? active.name : '#' + active.name}`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none max-h-32" />
                  <button onClick={send} disabled={!body.trim() && pending.length === 0} className="p-2.5 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={16} /></button>
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
