import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload } from '../../hooks/useApi';
import { getSocket } from '../../lib/socket';
import { setAppBadge } from '../../lib/appBadge';
import { Hash, Lock, Send, Plus, X, MessageSquare, ArrowLeft, Smile, Edit2, Trash2, Paperclip, FileText, Download, Search, Loader2, Sparkles, Languages, Bell, BellOff, CalendarDays, Home, Settings, CheckCheck, Megaphone, UserPlus, UserMinus, Users, ChevronDown, ChevronLeft, ChevronRight, Check, LogOut, Copy, MoreVertical, ClipboardCheck, ExternalLink, Columns2 } from 'lucide-react';
import CommsSettings from './CommsSettings.jsx';
import { replaceShortcodes, PICKER_GROUPS, EMOJI_INDEX } from '../../utils/emoji.js';

// VAPID public key (base64url) → Uint8Array for PushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Render a message body: convert :shortcode: emoji and Slack <!channel>/<!here>
// refs, then tokenize @mentions and Slack *bold* / ~strike~ / `code` markup into
// styled nodes. (Italic via single underscore is intentionally left alone so
// snake_case words and channel refs aren't mangled.)
function renderBody(text, users, meName) {
  if (!text) return text;
  let s = replaceShortcodes(text)
    .replace(/<!channel>|<!everyone>/gi, '@channel')
    .replace(/<!here>/gi, '@here');

  const names = (users || []).map(u => u.name).filter(Boolean).sort((a, b) => b.length - a.length);
  const parts = [
    'https?:\\/\\/[^\\s<]+',     // clickable URL (matched first)
    names.length ? '@(?:' + names.map(escapeRe).join('|') + ')' : null,
    '@channel', '@here',
    '\\*(?=\\S)[^*\\n]*?\\S\\*', // *bold*
    '~(?=\\S)[^~\\n]*?\\S~',     // ~strike~
    '`[^`\\n]+`',               // `code`
  ].filter(Boolean);
  const re = new RegExp('(' + parts.join('|') + ')', 'g');

  const out = []; let last = 0, m, k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    let tok = m[0];
    if (/^https?:\/\//.test(tok)) {
      // Don't swallow trailing sentence punctuation into the link.
      let trail = '';
      const tm = tok.match(/[.,;:!?)\]}"']+$/);
      if (tm) { trail = tm[0]; tok = tok.slice(0, -trail.length); }
      out.push(<a key={k++} href={tok} target="_blank" rel="noopener noreferrer" className="text-powder-700 underline break-all hover:text-powder-800">{tok}</a>);
      if (trail) out.push(trail);
      last = m.index + m[0].length;
      continue;
    }
    if (tok[0] === '@') {
      const nm = tok.slice(1);
      const isMe = meName && nm.toLowerCase() === meName.toLowerCase();
      const isBroadcast = nm === 'channel' || nm === 'here';
      out.push(<span key={k++} className={isMe ? 'bg-amber-200 text-amber-900 rounded px-1 font-semibold' : isBroadcast ? 'bg-amber-100 text-amber-800 rounded px-1 font-medium' : 'text-powder-700 font-medium'}>{tok}</span>);
    } else if (tok[0] === '*') {
      out.push(<strong key={k++}>{tok.slice(1, -1)}</strong>);
    } else if (tok[0] === '~') {
      out.push(<span key={k++} className="line-through">{tok.slice(1, -1)}</span>);
    } else if (tok[0] === '`') {
      out.push(<code key={k++} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] font-mono">{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length ? out : s;
}
const parseMsgDate = (iso) => new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
const fmtTime = (iso) => parseMsgDate(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayKey = (iso) => { const d = parseMsgDate(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
// Slack-style day divider label: Today / Yesterday / weekday+date.
const dayLabel = (iso) => {
  const d = parseMsgDate(iso); const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
};
function DateDivider({ iso }) {
  return (
    <div className="flex items-center gap-3 px-4 my-2">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-[11px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-0.5 shadow-sm">{dayLabel(iso)}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}
const fmtSize = (n) => { if (!n && n !== 0) return ''; if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB'; };

function Attachment({ a, onOpen }) {
  if (a.is_image && a.url) {
    return (
      <button type="button" onClick={onOpen} className="block mt-1 max-w-xs text-left">
        <img src={a.url} alt={a.filename} className="rounded-lg border border-gray-200 max-h-64 object-contain" />
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen}
      className="mt-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 max-w-xs text-left">
      <FileText size={16} className="text-powder-600 shrink-0" />
      <span className="text-sm text-gray-800 truncate">{a.filename}</span>
      <span className="text-[10px] text-gray-400 shrink-0">{fmtSize(a.size)}</span>
      <Download size={13} className="text-gray-400 shrink-0" />
    </button>
  );
}

// Full-screen viewer for a message's attachments: ← → (buttons, keys, or swipe)
// move through every file without closing; Esc / backdrop / ✕ closes. Non-image
// files show a download card so mixed sets still page smoothly.
function Lightbox({ atts, index, onNav, onClose }) {
  const a = atts[index];
  const touchX = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNav(1);
      else if (e.key === 'ArrowLeft') onNav(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNav, onClose]);
  if (!a) return null;
  return (
    <div className="fixed inset-0 bg-black/85 z-[70] flex items-center justify-center" onClick={onClose}
      onTouchStart={e => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={e => {
        if (touchX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) onNav(dx < 0 ? 1 : -1);
      }}>
      <button onClick={e => { e.stopPropagation(); onClose(); }} className="absolute top-3 right-3 p-2 text-white/70 hover:text-white z-10"><X size={24} /></button>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 text-white/70 text-sm select-none">
        {index + 1} / {atts.length} · <span className="text-white/90">{a.filename}</span>
      </div>
      {atts.length > 1 && (
        <button onClick={e => { e.stopPropagation(); onNav(-1); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/25 z-10"><ChevronLeft size={26} /></button>
      )}
      {atts.length > 1 && (
        <button onClick={e => { e.stopPropagation(); onNav(1); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/25 z-10"><ChevronRight size={26} /></button>
      )}
      <div className="max-w-[92vw] max-h-[84vh]" onClick={e => e.stopPropagation()}>
        {a.is_image && a.url ? (
          <img src={a.url} alt={a.filename} className="max-w-[92vw] max-h-[84vh] object-contain rounded-lg" />
        ) : (
          <div className="bg-white rounded-xl p-6 flex flex-col items-center gap-3 min-w-[260px]">
            <FileText size={40} className="text-powder-600" />
            <div className="text-sm font-medium text-gray-900 text-center break-all max-w-[70vw]">{a.filename}</div>
            <div className="text-xs text-gray-400">{fmtSize(a.size)}</div>
            <a href={a.url || undefined} target="_blank" rel="noreferrer" download={a.filename}
              className="mt-1 flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Download size={15} /> Download / open
            </a>
          </div>
        )}
      </div>
      <a href={a.url || undefined} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        className="absolute bottom-4 right-4 text-white/60 hover:text-white text-xs underline">Open in new tab</a>
    </div>
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

// Channel details drawer — opened by clicking the channel title (like Slack).
// Shows privacy, topic, and members; lets members add people and lets admins
// change privacy / announcement mode / rename.
function ChannelDetails({ channel, me, users, onClose, onChanged }) {
  const { data, refresh } = useApiGet(`/comms/channels/${channel.id}`, [channel.id]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name);
  const isAdmin = me?.role === 'admin';
  const members = data?.members || [];
  const myRole = members.find(m => m.user_id === me?.id)?.role;
  const canManage = isAdmin || myRole === 'owner'; // owner can rename + manage members
  const memberIds = new Set(members.map(m => m.user_id));
  const candidates = (users || []).filter(u => u.is_active && !memberIds.has(u.id));
  const depts = [...new Set(candidates.map(u => u.department).filter(Boolean))].sort();

  const addMany = async (ids) => { if (ids.length) { await apiPost(`/comms/channels/${channel.id}/members`, { user_ids: ids }); refresh(); onChanged?.(); } };
  const removeMember = async (uid) => { await apiFetch(`/comms/channels/${channel.id}/members/${uid}`, { method: 'DELETE' }); refresh(); onChanged?.(); };
  const setField = async (patch) => { await apiPut(`/comms/channels/${channel.id}`, patch); refresh(); onChanged?.(); };
  const saveName = async () => { if (name.trim() && name.trim() !== channel.name) await setField({ name: name.trim() }); setRenaming(false); };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            {channel.post_policy === 'admins' ? <Megaphone size={17} className="text-gray-400 shrink-0" /> : channel.kind === 'private' ? <Lock size={17} className="text-gray-400 shrink-0" /> : <Hash size={17} className="text-gray-400 shrink-0" />}
            {renaming ? (
              <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false); }}
                className="font-semibold text-gray-900 border border-powder-300 rounded px-2 py-0.5 text-sm" />
            ) : (
              <h3 className="text-base font-semibold text-gray-900 truncate">{channel.name}</h3>
            )}
            {canManage && !renaming && <button onClick={() => { setName(channel.name); setRenaming(true); }} className="text-gray-300 hover:text-powder-600" data-tip="Rename"><Edit2 size={13} /></button>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {channel.topic && <p className="text-sm text-gray-600">{channel.topic}</p>}

          {/* Settings (admin) */}
          {isAdmin && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase text-gray-400">Settings</div>
              <label className="flex items-center justify-between text-sm text-gray-700">
                <span className="flex items-center gap-2"><Lock size={14} className="text-gray-400" /> Private (invite only)</span>
                <input type="checkbox" checked={channel.kind === 'private'} onChange={e => setField({ kind: e.target.checked ? 'private' : 'public' })} />
              </label>
              <label className="flex items-center justify-between text-sm text-gray-700">
                <span className="flex items-center gap-2"><Megaphone size={14} className="text-gray-400" /> Announcement (admins post only)</span>
                <input type="checkbox" checked={channel.post_policy === 'admins'} onChange={e => setField({ post_policy: e.target.checked ? 'admins' : 'all' })} />
              </label>
            </div>
          )}

          {/* Members */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold uppercase text-gray-400">Members · {members.length}</div>
              {candidates.length > 0 && <button onClick={() => setAdding(a => !a)} className="text-xs text-powder-600 hover:text-powder-700 font-medium flex items-center gap-1"><UserPlus size={13} /> Add people</button>}
            </div>

            {adding && (
              <div className="mb-3 border border-gray-200 rounded-lg p-2">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button onClick={() => addMany(candidates.map(u => u.id))} className="text-xs px-2 py-0.5 rounded-lg bg-powder-600 text-white font-medium hover:bg-powder-700">+ Everyone ({candidates.length})</button>
                  {depts.map(d => {
                    const ids = candidates.filter(u => u.department === d).map(u => u.id);
                    return <button key={d} onClick={() => addMany(ids)} className="text-xs px-2 py-0.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-powder-50 capitalize">+ {d.replace('_', ' ')} ({ids.length})</button>;
                  })}
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {candidates.map(u => (
                    <button key={u.id} onClick={() => addMany([u.id])} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-powder-50 text-left">
                      <UserPlus size={13} className="text-powder-600" />
                      <span className="text-sm text-gray-800 flex-1">{u.name}</span>
                      <span className="text-xs text-gray-400 capitalize">{(u.department || '').replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-0.5">
              {members.map(m => (
                <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                  <div className="h-7 w-7 rounded-lg bg-powder-100 text-powder-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                    {m.name?.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-800 flex-1">{m.name}{m.user_id === me.id ? ' (you)' : ''}</span>
                  {m.role === 'owner' && <span className="text-[10px] uppercase text-gray-400">owner</span>}
                  {canManage && m.user_id !== me.id && <button onClick={() => removeMember(m.user_id)} className="text-gray-300 hover:text-red-500" data-tip="Remove" data-tip-left><UserMinus size={14} /></button>}
                </div>
              ))}
            </div>
          </div>

          {/* Leave — anyone can leave a private/group conversation they're in. */}
          {channel.kind !== 'public' && memberIds.has(me.id) && (
            <button onClick={async () => { await removeMember(me.id); onClose(); }}
              className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-medium">
              <LogOut size={14} /> Leave {myRole === 'owner' ? 'group' : 'conversation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Thread drawer: a parent message and its replies, with a reply composer.
// ── @mention autocomplete (shared by the channel composer and thread replies) ──
// Slack-style: type @ plus any letters; matching is case-insensitive, and names
// whose first/last name starts with what you've typed rank first. An empty
// query (just "@") lists everyone in the channel.
function filterMentionPool(pool, query, meId) {
  if (query === null) return [];
  const q = query.toLowerCase();
  const hits = (pool || []).filter(u => u.id !== meId && u.name.toLowerCase().includes(q));
  hits.sort((a, b) => {
    const ap = a.name.toLowerCase().split(/\s+/).some(p => p.startsWith(q)) ? 0 : 1;
    const bp = b.name.toLowerCase().split(/\s+/).some(p => p.startsWith(q)) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return hits.slice(0, 6);
}
function detectMentionQuery(e) {
  const val = e.target.value;
  const caret = e.target.selectionStart ?? val.length;
  const mm = /(?:^|\s)@([^\s@]*)$/.exec(val.slice(0, caret));
  return mm ? mm[1] : null;
}
function MentionDropdown({ matches, hi, onHover, onPick }) {
  if (!matches.length) return null;
  return (
    <div className="absolute bottom-full mb-1 left-3 right-3 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20 max-h-48 overflow-y-auto">
      {matches.map((u, idx) => (
        <button key={u.id} onMouseEnter={() => onHover(idx)}
          onMouseDown={e => { e.preventDefault(); onPick(u.name); }}
          className={`w-full text-left px-3 py-1.5 text-sm ${idx === hi ? 'bg-powder-50' : 'hover:bg-gray-50'}`}>
          <span className="font-medium text-gray-800">@{u.name}</span>
        </button>
      ))}
    </div>
  );
}

// ── Drafts (Slack-style) ─────────────────────────────────────────────────────
// Unsent composer text survives navigating away — keyed by channel id (main
// composer) or `thread:<parentId>` (replies), stored per device. A Drafts
// section at the top of the channel list gets you back to them.
const DRAFTS_LS = 'comms_drafts';
function readDrafts() { try { return JSON.parse(localStorage.getItem(DRAFTS_LS) || '{}'); } catch { return {}; } }
function writeDraft(key, text) {
  if (!key) return;
  const d = readDrafts();
  if (text && text.trim()) d[key] = { text, at: Date.now() };
  else if (d[key]) delete d[key];
  else return; // nothing changed
  try { localStorage.setItem(DRAFTS_LS, JSON.stringify(d)); } catch { /* full */ }
  window.dispatchEvent(new CustomEvent('comms-drafts-changed'));
}

function ThreadPanel({ parent, me, channelName, mentionUsers, members, canTranslate, viewerLang, onTranslate, onClose, onChanged, socketRef, storageOn }) {
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState(() => readDrafts()[`thread:${parent.id}`]?.text || '');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState([]); // uploaded-but-unsent attachments
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const replyRef = useRef(null);
  const endRef = useRef(null);
  // @mention autocomplete for the reply box (same behavior as the composer).
  const [mQuery, setMQuery] = useState(null);
  const [mHi, setMHi] = useState(0);
  const mMatches = useMemo(
    () => filterMentionPool(members?.length ? members : mentionUsers, mQuery, me.id),
    [members, mentionUsers, mQuery, me.id]);
  const insertReplyMention = (name) => {
    const ta = replyRef.current;
    const caret = ta ? ta.selectionStart : body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, '@' + name + ' ');
    const after = body.slice(caret);
    setBody(before + after);
    setMQuery(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(before.length, before.length); } });
  };

  const uploadFiles = async (files) => {
    if (!files.length || !storageOn) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const uploaded = await apiUpload(`/comms/channels/${parent.channel_id}/attachments`, fd);
      setPending(p => [...p, ...uploaded]);
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };
  const onPickFiles = (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; uploadFiles(files); };
  // Paste an image/screenshot straight into the reply (text pastes normally).
  const onReplyPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length && storageOn) { e.preventDefault(); uploadFiles(files); }
  };
  const removePending = (id) => setPending(p => p.filter(x => x.id !== id));

  const load = useCallback(async () => {
    try { setThread(await apiFetch(`/comms/messages/${parent.id}/thread`)); } catch { /* gone */ }
  }, [parent.id]);
  useEffect(() => { load(); }, [load]);
  // Live-refresh when a reply to this parent arrives.
  useEffect(() => {
    const s = socketRef?.current; if (!s) return;
    const onNew = (m) => { if (m.parent_id === parent.id) load(); };
    s.on('message:new', onNew);
    return () => s.off('message:new', onNew);
  }, [parent.id, load, socketRef]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread]);

  const react = async (m, emoji) => { await apiPost(`/comms/messages/${m.id}/reactions`, { emoji }); load(); };
  const unreact = async (m, emoji) => { await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); load(); };
  const del = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); load(); onChanged?.(); };
  const edit = async (m, text) => { await apiPut(`/comms/messages/${m.id}`, { body: text }); load(); };

  const send = async () => {
    const text = body.trim();
    const attachment_ids = pending.map(p => p.id);
    if (!text && !attachment_ids.length) return;
    setSending(true);
    try {
      await apiPost(`/comms/channels/${parent.channel_id}/messages`, { body: text, parent_id: parent.id, attachment_ids });
      setBody(''); writeDraft(`thread:${parent.id}`, ''); setPending([]); await load(); onChanged?.();
    } finally { setSending(false); }
  };

  const replies = thread?.replies || [];
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">Thread</div>
            <div className="text-[11px] text-gray-400 truncate">{channelName}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {thread && <Message m={thread.parent} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
            canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />}
          {replies.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-1">
              <div className="text-[11px] text-gray-400">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</div>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          )}
          {replies.map(r => <Message key={r.id} m={r} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
            canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />)}
          <div ref={endRef} />
        </div>
        <div className="border-t border-gray-200 p-3 shrink-0 relative">
          <MentionDropdown matches={mMatches} hi={mHi} onHover={setMHi} onPick={insertReplyMention} />
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
                  className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl disabled:opacity-40" title="Attach files"><Paperclip size={16} /></button>
              </>
            )}
            <textarea ref={replyRef} value={body}
              onChange={e => { setBody(e.target.value); writeDraft(`thread:${parent.id}`, e.target.value); setMQuery(detectMentionQuery(e)); setMHi(0); }}
              onPaste={onReplyPaste} rows={1}
              onKeyDown={e => {
                if (mMatches.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMHi(h => Math.min(h + 1, mMatches.length - 1)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMHi(h => Math.max(h - 1, 0)); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertReplyMention(mMatches[mHi]?.name || mMatches[0].name); return; }
                  if (e.key === 'Escape') { setMQuery(null); return; }
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              }}
              placeholder="Reply…" className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none max-h-32" />
            <button onClick={send} disabled={sending || (!body.trim() && !pending.length)} className="p-2.5 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// One thread in the Threads inbox: channel label, parent, replies, reply box.
function ThreadInboxCard({ thread, me, refresh, mentionUsers, canTranslate, viewerLang, onTranslate, onOpenChannel }) {
  const [body, setBody] = useState('');
  const react = async (m, e) => { await apiPost(`/comms/messages/${m.id}/reactions`, { emoji: e }); refresh(); };
  const unreact = async (m, e) => { await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(e)}`, { method: 'DELETE' }); refresh(); };
  const del = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); refresh(); };
  const edit = async (m, text) => { await apiPut(`/comms/messages/${m.id}`, { body: text }); refresh(); };
  const send = async () => { const t = body.trim(); if (!t) return; await apiPost(`/comms/channels/${thread.channel_id}/messages`, { body: t, parent_id: thread.parent.id }); setBody(''); refresh(); };
  const Icon = thread.channel_kind === 'dm' ? MessageSquare : thread.channel_kind === 'private' ? Lock : Hash;
  return (
    <div className="border border-gray-200 rounded-xl m-3 overflow-hidden">
      <button onClick={() => onOpenChannel(thread.channel_id)} className="w-full flex items-center gap-1.5 px-4 py-2 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-800 hover:bg-gray-100">
        <Icon size={14} className="text-gray-400" /> {thread.channel_name}
      </button>
      <div className="py-1">
        <Message m={thread.parent} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
          canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />
        <div className="px-4 py-0.5 text-[11px] font-medium text-gray-400">{thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}</div>
        {thread.replies.map(r => <Message key={r.id} m={r} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
          canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />)}
      </div>
      <div className="flex items-end gap-2 p-2 border-t border-gray-100">
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          placeholder="Reply…" className="flex-1 px-3 py-1.5 border border-gray-300 rounded-xl text-sm resize-none max-h-24" />
        <button onClick={send} disabled={!body.trim()} className="p-2 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={15} /></button>
      </div>
    </div>
  );
}

function ThreadsView({ me, mentionUsers, canTranslate, viewerLang, onTranslate, onOpenChannel, onCloseMobile }) {
  const { data: threads, loading, refresh } = useApiGet('/comms/threads');
  const list = threads || [];
  return (
    <>
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
        <button onClick={onCloseMobile} className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-700" title="Back"><ArrowLeft size={18} /></button>
        <MessageSquare size={16} className="text-powder-600" />
        <span className="font-semibold text-gray-900">Threads</span>
        <span className="text-xs text-gray-400">{list.length ? `· ${list.length}` : ''}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? <p className="text-center text-sm text-gray-400 py-8">Loading threads…</p>
          : list.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">No threads yet. Reply to a message to start one.</p>
          : list.map(t => <ThreadInboxCard key={t.parent.id} thread={t} me={me} refresh={refresh} mentionUsers={mentionUsers}
              canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} onOpenChannel={onOpenChannel} />)}
      </div>
    </>
  );
}

// Searchable, grouped emoji picker used for reactions and the composer.
function EmojiPicker({ onPick, onClose, align = 'right', vertical = 'down' }) {
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const term = q.trim().toLowerCase();
  const searchHits = term ? EMOJI_INDEX.filter(e => e.name.includes(term)).slice(0, 48) : null;
  // Close on outside click / Escape — NOT on mouseleave (that closed the picker
  // the moment you moved the pointer to search, or when the mobile keyboard
  // opened). Using 'click' (not mousedown) so the toggle button that opened it
  // closes cleanly instead of closing-then-reopening.
  useEffect(() => {
    const onDocClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Attach on the next tick so the very click that OPENED the picker doesn't
    // immediately bubble to document and close it again.
    const tid = setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => { clearTimeout(tid); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div ref={boxRef} className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} ${vertical === 'up' ? 'bottom-8' : 'top-7'} z-30 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-2`}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search emoji…"
        className="w-full px-2 py-1.5 mb-2 border border-gray-200 rounded-lg text-xs outline-none focus:border-powder-300" />
      <div className="max-h-56 overflow-y-auto">
        {searchHits ? (
          <div className="grid grid-cols-8 gap-0.5">
            {searchHits.map(e => <button key={e.name} title={e.name} onClick={() => onPick(e.emoji)} className="p-1 text-lg hover:bg-gray-100 rounded">{e.emoji}</button>)}
            {searchHits.length === 0 && <p className="col-span-8 text-center text-xs text-gray-400 py-3">No emoji found</p>}
          </div>
        ) : PICKER_GROUPS.map(g => (
          <div key={g.label} className="mb-1.5">
            <div className="text-[10px] font-bold uppercase text-gray-400 px-1 mb-0.5">{g.label}</div>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emojis.map((e, i) => <button key={g.label + i} onClick={() => onPick(e)} className="p-1 text-lg hover:bg-gray-100 rounded">{e}</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Quick-reaction row shown at the top of the mobile action sheet.
const QUICK_EMOJIS = ['👍', '✅', '🙏', '😂', '😮', '❤️'];

// Slack-style bottom sheet for a message on mobile: quick reactions up top,
// then the actions (reply / copy / translate / mark unread / edit / delete).
// Compact row inside the desktop 3-dot message menu.
function MenuRow({ icon: Icon, label, danger, act, onAction }) {
  return (
    <button onClick={() => onAction(act)}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
      {Icon ? <Icon size={14} className={danger ? 'text-red-500' : 'text-gray-400'} />
        : <span className="block h-2.5 w-2.5 ml-0.5 mr-0.5 rounded-full border-2 border-gray-400" />}
      {label}
    </button>
  );
}

// Slack's red "unread starts here" line.
function NewDivider() {
  return (
    <div className="flex items-center gap-2 px-4 my-1">
      <div className="flex-1 h-px bg-red-400" />
      <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide">New</span>
    </div>
  );
}

function SheetRow({ icon: Icon, label, danger, act, onAction }) {
  return (
    <button onClick={() => onAction(act)}
      className={`w-full flex items-center gap-3 px-3 h-12 rounded-xl text-[15px] text-left ${danger ? 'text-red-600' : 'text-gray-800'} active:bg-gray-100`}>
      {Icon ? <Icon size={19} className={danger ? 'text-red-500' : 'text-gray-400'} />
        : <span className="block h-3 w-3 ml-0.5 mr-1 rounded-full border-2 border-gray-400" />}
      {label}
    </button>
  );
}

function MessageActionSheet({ preview, mine, canReply, canTranslate, canMarkUnread, onClose, onReact, onAction }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end md:hidden" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-t-2xl px-3 pt-2 pb-8 animate-sheet-up max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="mx-auto h-1 w-10 rounded-full bg-gray-300 mb-2.5" />
        {preview && <p className="text-xs text-gray-400 truncate px-1.5 mb-2.5">{preview}</p>}
        <div className="flex items-center justify-between px-1 mb-2">
          {QUICK_EMOJIS.map(e => (
            <button key={e} onClick={() => onReact(e)} className="h-11 w-11 rounded-full bg-gray-50 active:bg-gray-200 text-2xl flex items-center justify-center">{e}</button>
          ))}
          <button onClick={() => setShowAll(s => !s)} className={`h-11 w-11 rounded-full flex items-center justify-center ${showAll ? 'bg-powder-100 text-powder-600' : 'bg-gray-50 text-gray-500'}`}>
            <Smile size={20} />
          </button>
        </div>
        {showAll && (
          <div className="max-h-44 overflow-y-auto mb-2 border border-gray-100 rounded-xl p-1.5">
            {PICKER_GROUPS.map(g => (
              <div key={g.label} className="mb-1">
                <div className="text-[10px] font-bold uppercase text-gray-400 px-1">{g.label}</div>
                <div className="grid grid-cols-8 gap-0.5">
                  {g.emojis.map((e, i) => <button key={g.label + i} onClick={() => onReact(e)} className="p-1 text-xl">{e}</button>)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-gray-100 pt-1">
          {canReply && <SheetRow icon={MessageSquare} label="Reply in thread" act="reply" onAction={onAction} />}
          <SheetRow icon={Copy} label="Copy text" act="copy" onAction={onAction} />
          {canTranslate && <SheetRow icon={Languages} label="Translate" act="translate" onAction={onAction} />}
          {canMarkUnread && <SheetRow icon={null} label="Mark unread from here" act="unread" onAction={onAction} />}
          <SheetRow icon={ClipboardCheck} label="Create compliance record…" act="record" onAction={onAction} />
          {mine && <SheetRow icon={Edit2} label="Edit message" act="edit" onAction={onAction} />}
          {mine && <SheetRow icon={Trash2} label="Delete message" danger act="delete" onAction={onAction} />}
        </div>
      </div>
    </div>
  );
}

// Promote a chat message into a draft compliance record. The record is
// pre-filled from the message + author + timestamp and back-linked to the
// source; it lands as a draft in the owning module for QA to complete.
const RECORD_TYPES = [
  { type: 'deviation', label: 'Deviation' },
  { type: 'non_conformance', label: 'Non-Conformance' },
  { type: 'on_hold', label: 'On Hold' },
];
function ConvertRecordModal({ m, onClose }) {
  const [type, setType] = useState('deviation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // { record_number, label }

  const create = async () => {
    setBusy(true); setError('');
    try { setDone(await apiPost(`/comms/messages/${m.id}/to-record`, { type })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
        {done ? (
          <div className="text-center py-2 space-y-2">
            <ClipboardCheck size={36} className="mx-auto text-green-600" />
            <p className="text-sm font-semibold text-gray-900">{done.label} {done.record_number} created</p>
            <p className="text-xs text-gray-500">Saved as a draft in the {done.label} module, pre-filled from this message and back-linked to it. Open the module to complete and sign it.</p>
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><ClipboardCheck size={16} className="text-powder-600" /> Create compliance record</h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">{m.user_name} · {fmtTime(m.created_at)}</p>
              <p className="text-xs text-gray-700 line-clamp-4 whitespace-pre-wrap">{m.body}</p>
            </div>
            <div className="flex gap-1.5">
              {RECORD_TYPES.map(rt => (
                <button key={rt.type} onClick={() => setType(rt.type)}
                  className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-semibold transition-colors ${type === rt.type ? 'border-powder-500 bg-powder-50 text-powder-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {rt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">The message text, author, and time are copied into a draft record with an audit-trail link back to this conversation.</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={create} disabled={busy} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create draft record'}
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Message({ m, me, onReact, onUnreact, onEdit, onDelete, onReply, onMarkUnread, canTranslate, viewerLang, onTranslate, autoText, highlighted, mentionUsers }) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body || '');
  const [translated, setTranslated] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [sheet, setSheet] = useState(false); // mobile long-press action sheet
  const [menuOpen, setMenuOpen] = useState(false); // desktop 3-dot menu
  const [lightbox, setLightbox] = useState(null); // index into m.attachments
  const [convert, setConvert] = useState(false); // message → compliance record
  const mine = m.user_id === me.id;

  const doTranslate = useCallback(async () => {
    if (translating || translated) return;
    setTranslating(true);
    try { setTranslated(await onTranslate(m, viewerLang)); } catch { /* ignore */ }
    finally { setTranslating(false); }
  }, [translating, translated, onTranslate, m, viewerLang]);

  // Channel-level auto-translate arrives pre-batched from the parent (autoText);
  // a manual per-message translate (translated) always wins.
  const displayBody = translated ?? (autoText || m.body);
  const isAutoTranslated = !translated && autoText && autoText !== m.body;

  // Mobile interaction (Slack-style): quick tap opens the thread; a long-press
  // (held still ~450ms) opens the action sheet. Desktop keeps the hover bar.
  const pressTimer = useRef(null);
  const pressPos = useRef(null);
  const suppressClick = useRef(false);
  const onTouchStart = (e) => {
    if (m.deleted || editing) return;
    const t = e.touches?.[0];
    if (!t) return;
    pressPos.current = { x: t.clientX, y: t.clientY };
    pressTimer.current = setTimeout(() => { pressTimer.current = null; suppressClick.current = true; setSheet(true); }, 450);
  };
  const onTouchMove = (e) => {
    if (!pressTimer.current || !pressPos.current) return;
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - pressPos.current.x) > 10 || Math.abs(t.clientY - pressPos.current.y) > 10) {
      clearTimeout(pressTimer.current); pressTimer.current = null;
    }
  };
  const onTouchEnd = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  const onRowClick = (e) => {
    if (e.target.closest('a, button, input, textarea, select')) return;
    if (suppressClick.current) { suppressClick.current = false; return; }
    // Touch: tap opens the thread (like Slack). Desktop uses the hover bar.
    if (window.matchMedia?.('(hover: none)').matches && onReply && !m.deleted && !editing) onReply(m);
  };
  const handleSheetAction = (act) => {
    setSheet(false);
    setMenuOpen(false);
    if (act === 'reply' && onReply) onReply(m);
    else if (act === 'copy') { try { navigator.clipboard?.writeText(displayBody || m.body || ''); } catch { /* ignore */ } }
    else if (act === 'translate') doTranslate();
    else if (act === 'unread' && onMarkUnread) onMarkUnread(m);
    else if (act === 'record') setConvert(true);
    else if (act === 'edit') { setDraft(m.body || ''); setEditing(true); }
    else if (act === 'delete') onDelete(m);
  };

  return (
    <div onClick={onRowClick} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
      className={`msg-row group relative flex gap-2 px-4 py-1.5 hover:bg-gray-50 transition-colors ${highlighted ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}>
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
              <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{renderBody(displayBody, mentionUsers, me.name)}</p>
              {translating && <span className="text-[11px] text-gray-400 italic">Translating…</span>}
              {translated && (
                <button onClick={() => setTranslated(null)} className="text-[11px] text-powder-600 hover:underline">
                  Translated to {viewerLang === 'en' ? 'English' : 'Spanish'} · Show original
                </button>
              )}
              {isAutoTranslated && <span className="text-[11px] text-gray-400 italic">translated</span>}
            </div>
          )
        )}
        {!m.deleted && m.attachments?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a, i) => <Attachment key={a.id} a={a} onOpen={() => setLightbox(i)} />)}
          </div>
        )}
        {lightbox !== null && m.attachments?.length > 0 && (
          <Lightbox atts={m.attachments} index={lightbox}
            onNav={(d) => setLightbox(i => (i + d + m.attachments.length) % m.attachments.length)}
            onClose={() => setLightbox(null)} />
        )}
        {m.reactions?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {m.reactions.map(r => {
              const reacted = r.users.includes(me.id);
              return (
                <button key={r.emoji} onClick={() => reacted ? onUnreact(m, r.emoji) : onReact(m, r.emoji)}
                  className={`px-2 py-1 text-sm md:px-1.5 md:py-0.5 md:text-xs rounded-full border ${reacted ? 'bg-powder-50 border-powder-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                  {r.emoji} {r.count}
                </button>
              );
            })}
          </div>
        )}
        {onReply && m.reply_count > 0 && (
          <button onClick={() => onReply(m)} className="mt-1 inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full border border-gray-200 hover:border-powder-300 hover:bg-powder-50 text-xs">
            <MessageSquare size={12} className="text-powder-600" />
            <span className="font-medium text-powder-700">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</span>
            {m.reply_names?.length > 0 && <span className="text-gray-400">· {m.reply_names.join(', ')}</span>}
          </button>
        )}
      </div>
      {/* Desktop hover pill (Slack-style): suggested reactions, full picker,
          reply, and a 3-dot menu with the rest. On phones everything lives in
          the long-press sheet, so messages get the full width. */}
      {!m.deleted && (
        <div className={`absolute -top-3 right-3 z-10 hidden md:flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-sm px-1 py-0.5 transition-opacity ${menuOpen || showEmoji ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {['✅', '👍', '🙌'].map(e => (
            <button key={e} onClick={() => onReact(m, e)} className="px-1 py-0.5 text-[15px] hover:bg-gray-100 rounded" data-tip={`React ${e}`}>{e}</button>
          ))}
          <button onClick={() => setShowEmoji(s => !s)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" data-tip="More reactions"><Smile size={15} /></button>
          {onReply && <button onClick={() => onReply(m)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" data-tip="Reply in thread"><MessageSquare size={14} /></button>}
          <div className="relative">
            <button onClick={() => setMenuOpen(o => !o)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" data-tip="More actions" data-tip-left><MoreVertical size={14} /></button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1">
                  <MenuRow icon={Copy} label="Copy text" act="copy" onAction={handleSheetAction} />
                  {canTranslate && m.body && !translated && <MenuRow icon={Languages} label="Translate" act="translate" onAction={handleSheetAction} />}
                  {onMarkUnread && <MenuRow icon={null} label="Mark unread from here" act="unread" onAction={handleSheetAction} />}
                  {m.body && <MenuRow icon={ClipboardCheck} label="Create compliance record…" act="record" onAction={handleSheetAction} />}
                  {mine && <MenuRow icon={Edit2} label="Edit message" act="edit" onAction={handleSheetAction} />}
                  {mine && <MenuRow icon={Trash2} label="Delete message" danger act="delete" onAction={handleSheetAction} />}
                </div>
              </>
            )}
          </div>
          {showEmoji && <EmojiPicker onPick={(e) => { onReact(m, e); setShowEmoji(false); }} onClose={() => setShowEmoji(false)} />}
        </div>
      )}
      {convert && <ConvertRecordModal m={m} onClose={() => setConvert(false)} />}
      {sheet && !m.deleted && (
        <MessageActionSheet
          preview={`${m.user_name}: ${(displayBody || '').slice(0, 80)}`}
          mine={mine} canReply={!!onReply} canTranslate={canTranslate && !!m.body && !translated} canMarkUnread={!!onMarkUnread}
          onClose={() => setSheet(false)}
          onReact={(e) => { setSheet(false); onReact(m, e); }}
          onAction={handleSheetAction}
        />
      )}
    </div>
  );
}

export default function CommsView({ user, onExit, onGoToSchedule, onSplitScreen, openChannelName, openChannelId, openMessageId, backLabel, onBackToModule, homePref, onSetHome, bottomNavPadding = false }) {
  const { data: channels, refresh: refreshChannels } = useApiGet('/comms/channels');
  const { data: users } = useApiGet('/users');
  const { data: commsStatus } = useApiGet('/comms/status');
  const storageOn = !!commsStatus?.storage;
  const semanticOn = !!commsStatus?.semantic;
  const askOn = !!commsStatus?.ask;
  const translateOn = !!commsStatus?.translate;
  const pushOn = !!commsStatus?.push;
  const [viewerLang, setViewerLang] = useState(() => localStorage.getItem('op_lang') || 'en');
  // One-tap translation mode: tapping EN or ES translates the whole channel to
  // that language ("Original" turns it off). Remembered across sessions.
  const [autoTranslate, setAutoTranslate] = useState(() => (localStorage.getItem('comms_translate_mode') || 'off') !== 'off');
  const [translatingNow, setTranslatingNow] = useState(false);
  const [autoTrans, setAutoTrans] = useState({}); // `${messageId}:${lang}` -> translated text (null = failed, skip)
  const [highlightId, setHighlightId] = useState(null); // deep-linked message flash
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [activeId, setActiveId] = useState(null);
  // On phones the list and thread can't share the screen — show one at a time.
  const [mobileThread, setMobileThread] = useState(false);
  // "New" divider: where the reader left off, captured when the channel opens
  // (stays put while reading; cleared on switch). '0' = everything is new.
  const [newMarkerTs, setNewMarkerTs] = useState(null);
  // Jump-to-date: when set, the message list shows a window starting at that day.
  const [dateView, setDateView] = useState(null);
  const openChannel = (id) => {
    const ch = (channels || []).find(c => c.id === id);
    setNewMarkerTs(ch && ch.unread > 0 ? (ch.last_read_at || '0') : null);
    setDateView(null);
    setActiveId(id); setMobileThread(true); setChanFilter(''); setThreadsOpen(false);
  };
  // Sidebar channel quick-filter (type to filter, ↑/↓ + Enter to jump).
  const [chanFilter, setChanFilter] = useState('');
  const [chanHi, setChanHi] = useState(0);
  // Admin-defined sidebar sections (channel groupings) + collapse state.
  const { data: sections, refresh: refreshSections } = useApiGet('/comms/sections');
  const [collapsedSecs, setCollapsedSecs] = useState({});
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [newChannel, setNewChannel] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [dmSelected, setDmSelected] = useState([]); // user ids picked for a new (group) DM
  const [dmGroupName, setDmGroupName] = useState(''); // optional name → makes it a managed group
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
  const justOpenedRef = useRef(true); // force scroll-to-bottom on channel open
  const [showJump, setShowJump] = useState(false); // "Jump to latest" affordance
  const linkedOpenedRef = useRef(null); // guards the module→channel deep-link
  const composerRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // parent message whose thread is open
  const [threadsOpen, setThreadsOpen] = useState(false); // Threads inbox view

  const list = channels || [];
  // Keep the PWA home-screen icon badge in sync while the user is in Comms.
  const totalUnread = list.reduce((n, c) => n + (c.unread || 0), 0);
  useEffect(() => { setAppBadge(totalUnread); }, [totalUnread]);
  const publicCh = list.filter(c => c.kind === 'public');
  const privateCh = list.filter(c => c.kind === 'private');
  // DMs are conversation-driven, so surface unread first, then most recent.
  const dms = list.filter(c => c.kind === 'dm').sort((a, b) =>
    (b.unread > 0) - (a.unread > 0) || (b.last_activity || '').localeCompare(a.last_activity || ''));
  // Everything unread, floated to the very top of the sidebar (most recent first).
  const unreadList = list.filter(c => c.unread > 0)
    .sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));
  // Section grouping for the sidebar: pinned default channels first, then each
  // admin section (in order), then everything ungrouped.
  const pinned = list.filter(c => c.is_default);
  const nonDefaultCh = list.filter(c => !c.is_default && c.kind !== 'dm');
  const byOrder = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name);
  const sectionList = sections || [];
  const sectionGroups = sectionList
    .map(s => ({ ...s, channels: nonDefaultCh.filter(c => c.section_id === s.id).sort(byOrder) }))
    .filter(g => g.channels.length);
  const ungroupedCh = nonDefaultCh.filter(c => !c.section_id || !sectionList.some(s => s.id === c.section_id)).sort(byOrder);
  const active = list.find(c => c.id === activeId) || null;
  // Channel quick-filter: flat, ordered match list for keyboard jump-to.
  const chanTerm = chanFilter.trim().toLowerCase();
  const chanMatches = chanTerm
    ? [...publicCh, ...privateCh, ...dms].filter(c => (c.name || '').toLowerCase().includes(chanTerm))
    : [];
  const kindIcon = (c) => (c.kind === 'dm' ? MessageSquare : c.post_policy === 'admins' ? Megaphone : c.kind === 'private' ? Lock : Hash);
  // On phones, the main pane also needs to show when a search/ask is running.
  const searchActive = searchResults !== null || answer !== null || (searching && searchMode === 'ask');
  const showMainMobile = mobileThread || searchActive || threadsOpen;

  // Left-edge swipe (from App) steps back one level within Messages rather than
  // jumping straight out: open thread → channel → channel list → ReadyDoc.
  useEffect(() => {
    const back = () => {
      if (replyTo) { setReplyTo(null); return; }
      if (searchActive) { setSearchQ(''); setSearchResults(null); setAnswer(null); return; }
      if (threadsOpen) { setThreadsOpen(false); return; }
      if (mobileThread) { setMobileThread(false); return; }
      if (onBackToModule) { onBackToModule(); return; }
      onExit?.();
    };
    window.addEventListener('comms-back', back);
    return () => window.removeEventListener('comms-back', back);
  }, [replyTo, searchActive, threadsOpen, mobileThread, onBackToModule, onExit]);

  // Active channel's members — used to warn when @mentioning a non-member and to
  // scope the mention autocomplete to people who can actually see the channel.
  const { data: activeInfo } = useApiGet(activeId ? `/comms/channels/${activeId}` : '/comms/status', [activeId]);
  const channelMemberIds = useMemo(() => new Set((activeInfo?.members || []).map(m => m.user_id)), [activeInfo]);
  const channelMembers = useMemo(() => (activeInfo?.members || []).map(m => ({ id: m.user_id, name: m.name })), [activeInfo]);

  // Default to #general (or first channel) once loaded.
  // Pick the initial channel once the list loads: a module deep-link (e.g.
  // Schedule's "Discuss" → #production) wins, else #general, else the first.
  useEffect(() => {
    if (activeId || !list.length) return;
    // From a push notification: open the exact channel by id. Use openChannel()
    // (not bare setActiveId) so phones land in the conversation, not the list.
    if (openChannelId && linkedOpenedRef.current !== openChannelId && list.some(c => c.id === openChannelId)) {
      linkedOpenedRef.current = openChannelId; openChannel(openChannelId); return;
    }
    if (openChannelName && linkedOpenedRef.current !== openChannelName) {
      // Tolerate underscores / hyphens / spacing differences (e.g. a link to
      // "production_schedule" resolving a "#production-schedule" channel).
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const t = norm(openChannelName);
      const target = list.find(c => norm(c.name) === t) || list.find(c => norm(c.name).includes(t));
      if (target) { linkedOpenedRef.current = openChannelName; openChannel(target.id); return; }
    }
    // Bare setActiveId (not openChannel) so phones stay on the channel list —
    // but still capture the unread marker so the New divider shows.
    const target = publicCh.find(c => c.name === 'general') || list[0];
    setNewMarkerTs(target.unread > 0 ? (target.last_read_at || '0') : null);
    setActiveId(target.id);
  }, [list, activeId, openChannelName, openChannelId]); // eslint-disable-line

  // A push-notification deep-link can arrive while Comms is already open — open
  // the requested channel even if another one is active.
  useEffect(() => {
    if (!openChannelId || !list.length || linkedOpenedRef.current === openChannelId) return;
    if (list.some(c => c.id === openChannelId)) { linkedOpenedRef.current = openChannelId; openChannel(openChannelId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChannelId, list.length]);

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    try {
      const msgs = await apiFetch(`/comms/channels/${id}/messages`);
      setMessages(msgs);
      apiPost(`/comms/channels/${id}/read`, {}).then(refreshChannels).catch(() => {});
    } catch { /* channel may be inaccessible */ }
  }, [refreshChannels]);

  useEffect(() => { setMessages([]); setTypers([]); setPending([]); loadMessages(activeId); }, [activeId, loadMessages]);
  // Restore this conversation's draft (typed text was saved as you navigated away).
  useEffect(() => { setBody(readDrafts()[activeId]?.text || ''); }, [activeId]);
  // Live view of all drafts for the sidebar section + channel-row pencils.
  const [drafts, setDrafts] = useState(readDrafts);
  useEffect(() => {
    const onChange = () => setDrafts(readDrafts());
    window.addEventListener('comms-drafts-changed', onChange);
    return () => window.removeEventListener('comms-drafts-changed', onChange);
  }, []);
  const channelDrafts = useMemo(() => {
    const list = [];
    for (const [key, v] of Object.entries(drafts)) {
      if (key.startsWith('thread:')) continue; // restored in-place when the thread reopens
      const ch = (channels || []).find(c => c.id === key);
      if (ch && v?.text) list.push({ channel: ch, text: v.text, at: v.at });
    }
    return list.sort((a, b) => b.at - a.at);
  }, [drafts, channels]);

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
      if (m.channel_id !== activeId) return;
      // A threaded reply: bump the parent's reply count in the main list.
      if (m.parent_id) {
        setMessages(ms => ms.map(x => x.id === m.parent_id ? { ...x, reply_count: (x.reply_count || 0) + 1 } : x));
        return;
      }
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]);
      setTypers(t => t.filter(x => x.user_id !== m.user_id));
    };
    const onUpdate = (m) => { if (m.channel_id === activeId) setMessages(ms => ms.map(x => x.id === m.id ? m : x)); };
    const onChannels = () => { refreshChannels(); refreshSections(); };
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

  // "Pinned to latest" scroll model. A channel opens pinned to the newest
  // message and STAYS pinned through async loads and late layout (images,
  // avatars) via a ResizeObserver on the content — the previous frame-based pin
  // was consumed by the empty-list render on channel switch, which is why
  // channels kept opening on old messages. Scrolling up unpins (reading
  // history); scrolling back near the bottom re-pins.
  const pinnedRef = useRef(true);
  useEffect(() => { pinnedRef.current = true; justOpenedRef.current = true; setShowJump(false); }, [activeId]);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const content = el.firstElementChild;
    const pin = () => { if (pinnedRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; };
    pin();
    const ro = new ResizeObserver(pin);
    if (content) ro.observe(content);
    ro.observe(el); // container resizes (keyboard opening on mobile) re-pin too
    return () => ro.disconnect();
  }, [activeId]);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    if (pinnedRef.current) { el.scrollTop = el.scrollHeight; setShowJump(false); }
  }, [messages]);
  const onMessagesScroll = () => {
    const el = scrollRef.current; if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = fromBottom < 120;
    setShowJump(fromBottom > 240);
  };
  const jumpToLatest = () => {
    pinnedRef.current = true;
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
    setShowJump(false);
  };
  // Jump to a specific day: load the window starting there and land at its top.
  const jumpToDate = async (d) => {
    if (!activeId || !d) return;
    try {
      const msgs = await apiFetch(`/comms/channels/${activeId}/messages?date=${d}`);
      pinnedRef.current = false; // we're reading history, not the live bottom
      setDateView(d);
      setMessages(msgs);
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
    } catch { /* ignore */ }
  };
  const backToLatest = () => {
    setDateView(null);
    pinnedRef.current = true;
    loadMessages(activeId);
  };

  // Type-to-compose: opening a channel focuses the composer (desktop only — on
  // phones autofocus would pop the keyboard over the conversation), and any
  // stray printable keystroke is routed into it, so you can pick a channel and
  // just start typing.
  useEffect(() => {
    if (!activeId) return;
    if (window.matchMedia?.('(hover: none)').matches) return;
    const t = setTimeout(() => composerRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [activeId]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const ta = composerRef.current;
      if (!ta || ta.disabled) return;
      ta.focus(); // the keystroke then lands in the composer
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = async () => {
    const text = body.trim();
    if ((!text && pending.length === 0) || !active) return;
    const attachment_ids = pending.map(p => p.id);
    setBody(''); writeDraft(active.id, ''); setPending([]); setMentionQuery(null);
    try {
      const m = await apiPost(`/comms/channels/${active.id}/messages`, { body: text, attachment_ids });
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]);
      refreshChannels();
    } catch { setBody(text); setPending(pending); }
  };

  const uploadFiles = async (files) => {
    if (!files.length || !active || !storageOn) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const uploaded = await apiUpload(`/comms/channels/${active.id}/attachments`, fd);
      setPending(p => [...p, ...uploaded]);
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };
  const onPickFiles = (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; uploadFiles(files); };
  // Paste an image/screenshot straight into the composer (text pastes normally).
  const onComposerPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length && storageOn) { e.preventDefault(); uploadFiles(files); }
  };
  // Drag a file from the desktop / Downloads and drop it on the conversation.
  const [dropHover, setDropHover] = useState(false);
  const dragDepth = useRef(0);
  const onDragEnterMsgs = (e) => {
    if (!storageOn || !e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropHover(true);
  };
  const onDragOverMsgs = (e) => { if (storageOn && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  const onDragLeaveMsgs = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropHover(false);
  };
  const onDropMsgs = (e) => {
    if (!storageOn) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropHover(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  };
  const removePending = (id) => setPending(p => p.filter(x => x.id !== id));
  const react = async (m, emoji) => { const updated = await apiPost(`/comms/messages/${m.id}/reactions`, { emoji }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const unreact = async (m, emoji) => { const updated = await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const editMsg = async (m, text) => { if (!text.trim()) return; const updated = await apiPut(`/comms/messages/${m.id}`, { body: text }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); };
  const delMsg = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); loadMessages(activeId); };

  const onBodyChange = (e) => {
    const val = e.target.value;
    setBody(val);
    writeDraft(activeId, val); // unsent text survives navigation (Slack-style)
    // @mention autocomplete: detect an @token immediately before the caret.
    setMentionQuery(detectMentionQuery(e));
    setMentionHi(0);
    // eslint-disable-next-line react-hooks/purity -- event handler (typing throttle), not render
    const now = Date.now();
    if (activeId && socketRef.current && now - lastTypeSent.current > 1500) {
      lastTypeSent.current = now;
      socketRef.current.emit('typing', activeId);
    }
  };

  const [mentionHi, setMentionHi] = useState(0);
  const mentionMatches = useMemo(() => {
    // Suggest channel members first (they can see the channel); fall back to all
    // users only if member list hasn't loaded.
    const pool = channelMembers.length ? channelMembers : (users || []);
    return filterMentionPool(pool, mentionQuery, user.id);
  }, [mentionQuery, channelMembers, users, user.id]);

  // People typed as @Name who match a real user but aren't in this channel —
  // they won't see the message, so warn the author before they send.
  const nonMemberMentions = useMemo(() => {
    if (!body.includes('@') || !channelMemberIds.size || !active || active.kind === 'dm') return [];
    const lower = body.toLowerCase();
    return (users || [])
      .filter(u => u.id !== user.id && !channelMemberIds.has(u.id))
      .filter(u => lower.includes('@' + u.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length);
  }, [body, users, channelMemberIds, active, user.id]);

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
  // Segmented control: Original (off) / EN / ES — one tap does everything.
  const setTranslateMode = (mode) => {
    if (mode === 'off') {
      setAutoTranslate(false);
    } else {
      setAutoTranslate(true);
      setLang(mode);
    }
    localStorage.setItem('comms_translate_mode', mode);
  };
  useEffect(() => {
    // Restore the remembered language for translate mode on first load.
    const mode = localStorage.getItem('comms_translate_mode');
    if (mode === 'en' || mode === 'es') setViewerLang(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Channel auto-translate: batch-translate everything on screen in ONE request
  // (the old per-message burst rate-limited and looked broken). Cache-aware on
  // the server; results accumulate in autoTrans keyed by message+lang.
  const translatingBatch = useRef(false);
  useEffect(() => {
    if (!autoTranslate || !translateOn || !activeId || !messages.length) return;
    const need = messages.filter(m => m.body && !m.deleted && autoTrans[`${m.id}:${viewerLang}`] === undefined).map(m => m.id);
    if (!need.length || translatingBatch.current) return;
    translatingBatch.current = true;
    setTranslatingNow(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await apiPost(`/comms/channels/${activeId}/translate`, { ids: need, lang: viewerLang });
        if (cancelled) return;
        setAutoTrans(prev => {
          const n = { ...prev };
          for (const id of need) n[`${id}:${viewerLang}`] = r.translations[id] ?? null;
          return n;
        });
      } catch { /* retried on next messages/lang change */ }
      finally { translatingBatch.current = false; setTranslatingNow(false); }
    })();
    return () => { cancelled = true; };
  }, [autoTranslate, viewerLang, messages, activeId, translateOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link from a push notification: land on the exact message. If it's a
  // thread reply, open the thread drawer too. Highlight briefly either way.
  const pendingMsgRef = useRef(null);
  useEffect(() => { if (openMessageId) pendingMsgRef.current = openMessageId; }, [openMessageId]);
  useEffect(() => {
    const mid = pendingMsgRef.current;
    if (!mid || !activeId || !messages.length) return;
    const inList = messages.find(x => x.id === mid);
    const finish = (targetId) => {
      pendingMsgRef.current = null;
      pinnedRef.current = false; // we're navigating to a specific spot, not the bottom
      setHighlightId(targetId);
      requestAnimationFrame(() => {
        document.querySelector(`[data-mid="${targetId}"]`)?.scrollIntoView({ block: 'center' });
      });
      setTimeout(() => setHighlightId(null), 3000);
    };
    if (inList) { finish(mid); return; }
    // Not in the main list — likely a thread reply. Resolve its parent and open
    // the thread drawer on it.
    (async () => {
      try {
        const m = await apiFetch(`/comms/messages/${mid}`);
        if (m.channel_id !== activeId) return; // channel changed underneath us
        if (m.parent_id) {
          const parent = messages.find(x => x.id === m.parent_id) || await apiFetch(`/comms/messages/${m.parent_id}`);
          pendingMsgRef.current = null;
          setReplyTo(parent);
          if (messages.some(x => x.id === m.parent_id)) finish(m.parent_id);
        } else {
          pendingMsgRef.current = null; // older than the loaded window; give up quietly
        }
      } catch { pendingMsgRef.current = null; }
    })();
  }, [messages, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pushSupported = ('serviceWorker' in navigator) && ('PushManager' in window);

  const doSubscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    const { key } = await apiFetch('/comms/push/key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await apiPost('/comms/push/subscribe', { subscription: sub.toJSON() });
    setPushSubscribed(true);
    return true;
  }, []);

  // Reflect any existing subscription; and auto-enable notifications by default
  // (unless the user has explicitly turned them off before) so people don't miss
  // messages. Only auto-requests when the browser permission isn't already denied.
  useEffect(() => {
    if (!pushOn || !pushSupported) return;
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(async (sub) => {
      if (sub) { setPushSubscribed(true); return; }
      const optedOut = localStorage.getItem('comms_push_optout') === '1';
      if (!optedOut && (typeof Notification !== 'undefined') && Notification.permission !== 'denied') {
        try { await doSubscribe(); } catch { /* leave the bell for manual enable */ }
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushOn, pushSupported]);

  const togglePush = async () => {
    if (!pushSupported) { alert('Notifications are not supported on this device/browser.'); return; }
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await apiPost('/comms/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
        setPushSubscribed(false);
        localStorage.setItem('comms_push_optout', '1'); // remember the user's choice
      } else {
        localStorage.removeItem('comms_push_optout');
        const ok = await doSubscribe();
        if (!ok) return;
      }
    } catch (e) { alert(e.message || 'Could not update notifications'); }
    finally { setPushBusy(false); }
  };

  const markChannelRead = async (id) => { try { await apiPost(`/comms/channels/${id}/read`, {}); refreshChannels(); } catch { /* ignore */ } };
  const markUnread = async (m) => { try { await apiPost(`/comms/messages/${m.id}/unread`, {}); refreshChannels(); } catch { /* ignore */ } };

  const toggleDmPick = (id) => setDmSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  const startDm = async () => {
    if (!dmSelected.length) return;
    let ch;
    if (dmSelected.length === 1) {
      ch = await apiPost(`/comms/dm/${dmSelected[0]}`, {}); // 1:1 DM
    } else if (dmGroupName.trim()) {
      // Named multi-person group → a private, member-managed channel (Slack-style
      // group): the creator owns it and can add/remove people and rename later.
      ch = await apiPost('/comms/channels', { name: dmGroupName.trim(), kind: 'private', member_ids: dmSelected });
    } else {
      ch = await apiPost('/comms/dm', { user_ids: dmSelected }); // unnamed group DM
    }
    setShowDmPicker(false); setDmSearch(''); setDmSelected([]); setDmGroupName('');
    await refreshChannels();
    openChannel(ch.id);
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
  const openResult = (r) => { clearSearch(); openChannel(r.channel_id); };

  const ChannelBtn = ({ c, icon: Icon, highlight, onHover }) => {
    const unread = c.unread > 0;
    const mentioned = c.mentions > 0;
    const isActive = activeId === c.id;
    // Unread channels stand out: a blue dot in the gutter + bold, full-black name.
    // Hovering an unread channel swaps its count for a "mark read" checkmark
    // (per-channel — there's no global "mark everything read").
    return (
    <div onClick={() => openChannel(c.id)} onMouseEnter={onHover}
      className={`group/ch w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm cursor-pointer ${isActive ? 'bg-powder-600 text-white' : highlight ? 'bg-powder-50 text-powder-700' : unread ? 'text-gray-900 hover:bg-gray-100' : 'text-gray-600 hover:bg-gray-100'}`}>
      <span className="w-1.5 shrink-0 flex items-center justify-center">
        {unread && !isActive && <span className={`h-1.5 w-1.5 rounded-full ${mentioned ? 'bg-red-500' : 'bg-powder-500'}`} />}
      </span>
      <Icon size={14} className="shrink-0 opacity-80" />
      <span className={`truncate flex-1 text-left ${unread && !isActive ? 'font-bold' : ''}`}>{c.name}</span>
      {mentioned && <span className={`text-[10px] font-bold px-1.5 rounded-full bg-red-500 text-white ${unread ? 'group-hover/ch:hidden' : ''}`} title="You were mentioned">@{c.mentions}</span>}
      {unread && !mentioned && <span className={`text-[10px] font-bold px-1.5 rounded-full group-hover/ch:hidden ${isActive ? 'bg-white/25 text-white' : 'bg-powder-500 text-white'}`}>{c.unread}</span>}
      {unread && (
        <button onClick={(e) => { e.stopPropagation(); markChannelRead(c.id); }} title="Mark read"
          className={`hidden group-hover/ch:inline-flex items-center p-0.5 rounded ${isActive ? 'text-white hover:bg-white/20' : 'text-gray-400 hover:text-powder-600 hover:bg-gray-200'}`}>
          <CheckCheck size={13} />
        </button>
      )}
    </div>
    );
  };

  return (
    // bottomNavPadding: the app keeps its bottom tab bar visible under Messages
    // (users who navigate by quick tabs), so leave room for it on phones.
    <div className={`fixed inset-0 bg-white flex flex-col ${bottomNavPadding ? 'pb-14 md:pb-0' : ''}`}>
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-gray-200 shrink-0">
        {onBackToModule ? (
          <button onClick={onBackToModule} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-semibold text-powder-700 bg-powder-50 hover:bg-powder-100 rounded-lg shrink-0" title={`Back to ${backLabel}`}>
            <ArrowLeft size={16} /> {backLabel}
          </button>
        ) : (
        <button onClick={onExit} className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg shrink-0" title="Switch to ReadyDoc">
          <ArrowLeft size={16} /> <span className="hidden sm:inline">ReadyDoc</span>
        </button>
        )}
        {onSplitScreen && (
          <button onClick={onSplitScreen} className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg shrink-0"
            data-tip="Split screen: dock Messages beside the modules">
            <Columns2 size={15} /> Split screen
          </button>
        )}
        {onGoToSchedule && (
          <button onClick={onGoToSchedule} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg shrink-0" title="Go to the Production Schedule">
            <CalendarDays size={16} /> <span className="hidden sm:inline">Schedule</span>
          </button>
        )}
        <div className="h-5 w-px bg-gray-200 shrink-0 hidden sm:block" />
        <MessageSquare size={18} className="text-powder-600 shrink-0" />
        <span className="font-bold text-gray-900 shrink-0 hidden sm:inline">Messages</span>
        <div className="ml-2 sm:ml-4 flex items-center gap-2 flex-1 min-w-0 sm:max-w-lg">
          <div className="relative flex-1">
            {searchMode === 'ask' ? <Sparkles size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-powder-500" />
              : <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />}
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchMode === 'ask') runAsk(); }}
              placeholder={searchMode === 'ask' ? 'Ask about your messages…' : searchMode === 'smart' ? 'Smart search…' : 'Search messages…'}
              className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded-lg text-sm" />
            {searchQ && <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
          </div>
          {/* Mode tabs inline on desktop; on mobile they move to a second row (below). */}
          {(semanticOn || askOn) && (
            <div className="hidden sm:flex rounded-lg border border-gray-200 overflow-hidden text-xs shrink-0">
              {[['keyword', 'Keyword'], semanticOn && ['smart', 'Smart'], askOn && ['ask', 'Ask']].filter(Boolean).map(([m, label]) => (
                <button key={m} onClick={() => { setSearchMode(m); setSearchResults(null); setAnswer(null); }}
                  className={`px-2.5 py-1.5 font-medium ${searchMode === m ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          {onSetHome && (
            <button onClick={() => onSetHome('messages')} data-tip={homePref === 'messages' ? 'Messages is your home screen' : 'Make Messages your home screen'} data-tip-left
              className={`hidden sm:block p-2 rounded-lg ${homePref === 'messages' ? 'text-powder-600 bg-powder-50 hover:bg-powder-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              <Home size={16} />
            </button>
          )}
          {user.role === 'admin' && (
            <button onClick={() => setShowSettings(true)} data-tip="Communication settings" data-tip-left
              className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
              <Settings size={16} />
            </button>
          )}
          {pushOn && (
            <button onClick={togglePush} disabled={pushBusy} data-tip-left
              data-tip={pushSubscribed ? 'Notifications on — click to turn off' : 'Enable push notifications'}
              className={`p-2 rounded-lg ${pushSubscribed ? 'text-powder-600 bg-powder-50 hover:bg-powder-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              {pushSubscribed ? <Bell size={16} /> : <BellOff size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile: search mode tabs move to their own row so the top bar stays clean */}
      {(semanticOn || askOn) && searchQ && (
        <div className="sm:hidden flex gap-1 px-4 py-1.5 border-b border-gray-200 shrink-0">
          {[['keyword', 'Keyword'], semanticOn && ['smart', 'Smart'], askOn && ['ask', 'Ask']].filter(Boolean).map(([m, label]) => (
            <button key={m} onClick={() => { setSearchMode(m); setSearchResults(null); setAnswer(null); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${searchMode === m ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{label}</button>
          ))}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* sidebar — full width on phones, hidden there once a channel is open */}
        <div className={`w-full md:w-60 border-r border-gray-200 flex-col shrink-0 overflow-y-auto p-2 space-y-3 ${showMainMobile ? 'hidden md:flex' : 'flex'}`}>
          {/* Threads inbox shortcut (like Slack) */}
          <button onClick={() => { setThreadsOpen(true); setMobileThread(false); clearSearch(); }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium ${threadsOpen ? 'bg-powder-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
            <MessageSquare size={15} className="opacity-80" /> Threads
          </button>
          {/* Quick filter — type to filter channels & DMs, ↑/↓ + Enter to jump */}
          <div className="relative px-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={chanFilter}
              onChange={e => { setChanFilter(e.target.value); setChanHi(0); }}
              onKeyDown={e => {
                if (!chanMatches.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setChanHi(h => Math.min(h + 1, chanMatches.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setChanHi(h => Math.max(h - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); openChannel(chanMatches[chanHi].id); }
                else if (e.key === 'Escape') { setChanFilter(''); }
              }}
              placeholder="Jump to channel or person…"
              className="w-full pl-7 pr-6 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 focus:bg-white focus:border-powder-300 outline-none" />
            {chanFilter && <button onClick={() => setChanFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
          </div>

          {chanTerm ? (
            /* Filtered flat result list (quick-switcher) */
            <div className="space-y-0.5">
              {chanMatches.length === 0
                ? <p className="px-2 py-4 text-center text-xs text-gray-400">No channels or people match “{chanFilter.trim()}”.</p>
                : chanMatches.map((c, idx) => (
                    <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} highlight={idx === chanHi} onHover={() => setChanHi(idx)} />
                  ))}
            </div>
          ) : (
          <>
          {/* Drafts — unsent messages, Slack-style, above everything */}
          {channelDrafts.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[10px] font-bold uppercase text-amber-600">Drafts</div>
              <div className="space-y-0.5">
                {channelDrafts.map(d => (
                  <button key={'d' + d.channel.id} onClick={() => openChannel(d.channel.id)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                      <Edit2 size={12} className="text-amber-500 shrink-0" />
                      <span className="truncate">{d.channel.kind === 'public' ? `#${d.channel.name}` : (d.channel.name || 'Direct message')}</span>
                    </span>
                    <span className="block pl-5 text-[11px] text-gray-400 truncate">{d.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Unread — everything with new messages, floated to the top */}
          {unreadList.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[10px] font-bold uppercase text-powder-600">Unread</div>
              <div className="space-y-0.5">
                {unreadList.map(c => <ChannelBtn key={'u' + c.id} c={c} icon={kindIcon(c)} />)}
              </div>
            </div>
          )}
          {/* Pinned default channels (#general / #announcements) */}
          {pinned.length > 0 && (
            <div className="space-y-0.5">
              {pinned.map(c => <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} />)}
            </div>
          )}
          {/* Admin sections */}
          {sectionGroups.map(sec => {
            const open = !collapsedSecs[sec.id];
            return (
              <div key={sec.id}>
                <button onClick={() => setCollapsedSecs(s => ({ ...s, [sec.id]: !s[sec.id] }))} className="w-full flex items-center gap-1 px-2 mb-1 text-[10px] font-bold uppercase text-gray-400 hover:text-gray-600">
                  {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {sec.name}
                </button>
                {open && <div className="space-y-0.5">{sec.channels.map(c => <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} />)}</div>}
              </div>
            );
          })}
          {/* Ungrouped channels */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">{sectionGroups.length ? 'Channels' : 'Channels'}</span>
              <button onClick={() => setNewChannel(true)} className="text-gray-400 hover:text-powder-600" data-tip="New channel" data-tip-left><Plus size={14} /></button>
            </div>
            <div className="space-y-0.5">
              {ungroupedCh.map(c => <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} />)}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">Direct Messages</span>
              <button onClick={() => setShowDmPicker(s => !s)} className="text-gray-400 hover:text-powder-600" data-tip="New message or group" data-tip-left><Plus size={14} /></button>
            </div>
            {showDmPicker && (
              <div className="mb-1 px-1">
                <input value={dmSearch} onChange={e => setDmSearch(e.target.value)} placeholder="Search people…" className="w-full px-2 py-1 border border-gray-300 rounded text-xs mb-1" autoFocus />
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {dmCandidates.map(u => {
                    const picked = dmSelected.includes(u.id);
                    return (
                      <button key={u.id} onClick={() => toggleDmPick(u.id)} className={`w-full flex items-center gap-2 text-left px-2 py-1.5 text-sm ${picked ? 'bg-powder-50' : 'hover:bg-gray-50'}`}>
                        <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${picked ? 'bg-powder-600 border-powder-600' : 'border-gray-300'}`}>{picked && <Check size={11} className="text-white" />}</span>
                        <span className="flex-1 truncate">{u.name}</span>
                        <span className="text-[10px] text-gray-400 capitalize">{(u.department || '').replace('_', ' ')}</span>
                      </button>
                    );
                  })}
                </div>
                {dmSelected.length > 1 && (
                  <input value={dmGroupName} onChange={e => setDmGroupName(e.target.value)} placeholder="Group name (optional)…"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs mt-1" />
                )}
                <button onClick={startDm} disabled={!dmSelected.length}
                  className="w-full mt-1 px-2 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-40">
                  {dmSelected.length <= 1 ? 'Message 1 person'
                    : dmGroupName.trim() ? `Create “${dmGroupName.trim()}” group (${dmSelected.length})`
                    : `Start group message (${dmSelected.length})`}
                </button>
                {dmSelected.length > 1 && (
                  <p className="text-[10px] text-gray-400 mt-1 px-0.5">Name it to make a group you can rename and add/remove people from later.</p>
                )}
              </div>
            )}
            <div className="space-y-0.5">
              {dms.map(c => <ChannelBtn key={c.id} c={c} icon={MessageSquare} />)}
            </div>
          </div>
          </>
          )}
        </div>

        {/* main pane — hidden on phones until a channel is opened */}
        <div className={`flex-1 flex-col min-w-0 ${showMainMobile ? 'flex' : 'hidden md:flex'}`}>
          {threadsOpen ? (
            <ThreadsView me={user} mentionUsers={users} canTranslate={translateOn} viewerLang={viewerLang} onTranslate={translateMessage} onOpenChannel={openChannel} onCloseMobile={() => setThreadsOpen(false)} />
          ) : (searchResults !== null || answer !== null || (searching && searchMode === 'ask')) ? (
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
                <button onClick={() => setMobileThread(false)} className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-700" title="Back to channels"><ArrowLeft size={18} /></button>
                {active.kind === 'dm' ? <MessageSquare size={16} className="text-gray-400" /> : active.post_policy === 'admins' ? <Megaphone size={16} className="text-gray-400" /> : active.kind === 'private' ? <Lock size={16} className="text-gray-400" /> : <Hash size={16} className="text-gray-400" />}
                {active.kind === 'dm' ? (
                  <span className="font-semibold text-gray-900 truncate shrink-0 max-w-[55%] sm:max-w-none">{active.name}</span>
                ) : (
                  <button onClick={() => setShowDetails(true)} className="font-semibold text-gray-900 truncate shrink-0 max-w-[55%] sm:max-w-none hover:underline" title="Channel details & members">{active.name}</button>
                )}
                {active.topic && <span className="text-xs text-gray-400 truncate hidden sm:inline">— {active.topic}</span>}
                {active.kind !== 'dm' && (
                  <button onClick={() => setShowDetails(true)} className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100" title="Members">
                    <Users size={13} /> Details
                  </button>
                )}
                {/* Jump to a date in this channel's history */}
                <label className={`${translateOn ? '' : 'ml-auto '}relative p-1.5 rounded-lg cursor-pointer ${dateView ? 'text-powder-600 bg-powder-50' : 'text-gray-400 hover:bg-gray-100'}`} data-tip="Jump to date">
                  <CalendarDays size={15} />
                  <input type="date" value={dateView || ''} onChange={e => e.target.value && jumpToDate(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                </label>
                {/* Gmail-style popout: this conversation in its own slim window,
                    so it stays visible while working in a module. Hidden when
                    already inside the standalone /chat view (popout or dock). */}
                {!window.location.pathname.startsWith('/chat') && (
                  <button onClick={() => window.open(`/chat?cid=${active.id}`, `powderops-chat-${active.id}`, 'width=460,height=760')}
                    className="hidden md:block p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" data-tip="Open in a separate window">
                    <ExternalLink size={15} />
                  </button>
                )}
                {translateOn && (
                  <div className="ml-auto flex items-center gap-1.5">
                    {translatingNow && <span className="text-[10px] text-gray-400 hidden sm:inline">Translating…</span>}
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden" title="Show messages in their original language, or translate everything to English / Spanish">
                      <Languages size={13} className="text-gray-400 ml-1.5 mr-0.5" />
                      {[['off', 'Original'], ['en', 'EN'], ['es', 'ES']].map(([mode, label]) => {
                        const active = mode === 'off' ? !autoTranslate : (autoTranslate && viewerLang === mode);
                        return (
                          <button key={mode} onClick={() => setTranslateMode(mode)}
                            className={`px-2 py-1 text-[10px] font-bold ${active ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div ref={scrollRef} onScroll={onMessagesScroll} className="relative flex-1 overflow-y-auto py-2"
                onDragEnter={onDragEnterMsgs} onDragOver={onDragOverMsgs} onDragLeave={onDragLeaveMsgs} onDrop={onDropMsgs}>
                {dropHover && (
                  <div className="sticky top-0 z-30 mx-3 pointer-events-none">
                    <div className="border-2 border-dashed border-powder-400 bg-powder-50/90 rounded-xl py-6 text-center text-sm font-semibold text-powder-700 shadow-sm">
                      Drop files to attach to #{active?.name || 'this conversation'}
                    </div>
                  </div>
                )}
                <div>{/* single wrapper so the pinned-scroll ResizeObserver sees content height */}
                {messages.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No messages yet. Say hello 👋</p>}
                {messages.map((m, i) => {
                  const showDay = i === 0 || dayKey(m.created_at) !== dayKey(messages[i - 1].created_at);
                  const firstNew = newMarkerTs !== null && !dateView && m.created_at > newMarkerTs &&
                    (i === 0 || messages[i - 1].created_at <= newMarkerTs);
                  return (
                    <div key={m.id} data-mid={m.id}>
                      {showDay && <DateDivider iso={m.created_at} />}
                      {firstNew && <NewDivider />}
                      <Message m={m} me={user} onReact={react} onUnreact={unreact} onEdit={editMsg} onDelete={delMsg} onReply={setReplyTo} onMarkUnread={markUnread}
                        canTranslate={translateOn} viewerLang={viewerLang} onTranslate={translateMessage}
                        autoText={autoTranslate ? autoTrans[`${m.id}:${viewerLang}`] : null}
                        highlighted={highlightId === m.id} mentionUsers={users} />
                    </div>
                  );
                })}
                </div>
              </div>
              {dateView ? (
                <div className="relative">
                  <button onClick={backToLatest}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-full shadow-lg hover:bg-gray-800 whitespace-nowrap">
                    Viewing from {dateView} · Back to latest <ChevronDown size={13} />
                  </button>
                </div>
              ) : showJump && (
                <div className="relative">
                  <button onClick={jumpToLatest}
                    className="absolute bottom-2 right-4 z-10 flex items-center gap-1 px-3 py-1.5 bg-powder-600 text-white text-xs font-semibold rounded-full shadow-lg hover:bg-powder-700">
                    <ChevronDown size={14} /> Jump to latest
                  </button>
                </div>
              )}
              {active.post_policy === 'admins' && user.role !== 'admin' ? (
                <div className="border-t border-gray-200 p-3 shrink-0 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                  <Lock size={14} /> Only admins can post in #{active.name}. You can still read and react.
                </div>
              ) : (
              <div className="border-t border-gray-200 p-3 shrink-0 relative">
                <MentionDropdown matches={mentionMatches} hi={mentionHi} onHover={setMentionHi} onPick={insertMention} />
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
                {nonMemberMentions.length > 0 && (
                  <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                    <Bell size={12} className="mt-0.5 shrink-0" />
                    <span>
                      {nonMemberMentions.map(u => u.name).join(', ')} {nonMemberMentions.length === 1 ? "isn't" : "aren't"} in this channel, so {nonMemberMentions.length === 1 ? "they won't" : "they won't"} see this message.
                      {user.role === 'admin' && ' Add them from the channel title → Members.'}
                    </span>
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
                  <div className="relative">
                    <button onClick={() => setShowComposerEmoji(s => !s)}
                      className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl" title="Emoji"><Smile size={18} /></button>
                    {showComposerEmoji && (
                      <EmojiPicker align="left" vertical="up" onClose={() => setShowComposerEmoji(false)}
                        onPick={(e) => { setBody(b => b + e); setShowComposerEmoji(false); composerRef.current?.focus(); }} />
                    )}
                  </div>
                  <textarea ref={composerRef} value={body} onChange={onBodyChange} rows={1} onPaste={onComposerPaste}
                    onKeyDown={e => {
                      // While the @mention menu is open: arrows move, Enter/Tab picks.
                      if (mentionMatches.length) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHi(h => Math.min(h + 1, mentionMatches.length - 1)); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionHi(h => Math.max(h - 1, 0)); return; }
                        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionMatches[mentionHi]?.name || mentionMatches[0].name); return; }
                      }
                      if (e.key === 'Escape' && mentionQuery !== null) { setMentionQuery(null); return; }
                      // Enter makes a new line; Tab moves to the Send button (then Enter/click sends).
                    }}
                    placeholder={`Message ${active.kind === 'dm' ? active.name : '#' + active.name}`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none max-h-32" />
                  <button onClick={send} disabled={!body.trim() && pending.length === 0} className="p-2.5 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={16} /></button>
                </div>
              </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Select a channel to start.</div>
          )}
        </div>
      </div>

      {newChannel && <NewChannelModal users={users} me={user} onClose={() => setNewChannel(false)} onCreated={(ch) => { setNewChannel(false); refreshChannels(); openChannel(ch.id); }} />}
      {showSettings && <CommsSettings users={users} onClose={() => setShowSettings(false)} onChanged={refreshChannels} />}
      {showDetails && active && active.kind !== 'dm' && <ChannelDetails channel={active} me={user} users={users} onClose={() => setShowDetails(false)} onChanged={refreshChannels} />}
      {replyTo && <ThreadPanel parent={replyTo} me={user} channelName={active?.kind === 'dm' ? active.name : '#' + (active?.name || '')} mentionUsers={users} members={channelMembers}
        canTranslate={translateOn} viewerLang={viewerLang} onTranslate={translateMessage} socketRef={socketRef} storageOn={storageOn}
        onClose={() => setReplyTo(null)} onChanged={() => loadMessages(activeId)} />}
    </div>
  );
}
