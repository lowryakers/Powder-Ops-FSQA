import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { AtSign, MessageSquare, Hash, Bell, ArrowLeft, Loader2, Inbox, Lock, CheckCheck } from 'lucide-react';

// Activity — one feed of everything that involved you: @mentions, direct
// messages, and replies on threads you're part of. Not every message in every
// channel; that's the channel list, and repeating it here would bury the things
// that need an answer.
//
// It's also how people find a message they half-remember, so it pages back
// through history rather than only showing what's unread.

const TABS = [
  { id: 'all', label: 'All', icon: Bell },
  { id: 'mentions', label: 'Mentions', icon: AtSign },
  { id: 'dms', label: 'DMs', icon: MessageSquare },
  { id: 'threads', label: 'Threads', icon: Inbox },
];

const KIND_META = {
  mention: { icon: AtSign, label: 'Mentioned you in' },
  dm: { icon: MessageSquare, label: 'Direct message' },
  thread: { icon: Inbox, label: 'Replied in a thread in' },
};

// Group by calendar day so a long feed stays scannable — the same shape the
// channel view uses, for one less thing to learn.
function dayLabel(iso) {
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const timeLabel = (iso) => {
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// One line of message text — the feed is for scanning, so it never grows to
// full message height.
const preview = (body) => {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 160)}…` : (t || '(attachment)');
};

export default function ActivityView({ counts, onOpenMessage, onCloseMobile, refreshKey, onRead }) {
  const [tab, setTab] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async (before = null) => {
    const q = new URLSearchParams({ filter: tab, limit: '50' });
    if (unreadOnly) q.set('unread', '1');
    if (before) q.set('before', before);
    const r = await apiFetch(`/comms/activity?${q}`);
    return r;
  }, [tab, unreadOnly]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    load().then(r => {
      if (stale) return;
      setItems(r.items || []);
      setMore(!!r.has_more);
    }).catch(() => { if (!stale) setItems([]); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [load, refreshKey]);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await load(last.created_at);
      setItems(prev => [...prev, ...(r.items || [])]);
      setMore(!!r.has_more);
    } finally { setLoadingMore(false); }
  };

  // Clearing Activity stamps the channels and threads its items live in as
  // read — the feed has no read state of its own, so there is nothing else to
  // clear. Deliberately narrower than the channel list's Mark all read, which
  // would also wipe unread counts for channels you've never opened.
  const markAllRead = async () => {
    setClearing(true);
    try {
      await apiFetch('/comms/activity/read', { method: 'POST' });
      onRead?.();
      const r = await load();
      setItems(r.items || []);
      setMore(!!r.has_more);
    } catch { /* the badge just stays until the next refresh */ }
    finally { setClearing(false); }
  };

  const unreadTotal = counts?.all || 0;

  // Day headers computed once per render pass.
  const groups = [];
  for (const it of items) {
    const label = dayLabel(it.created_at);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(it);
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
        <button onClick={onCloseMobile} className="md:hidden p-1 -ml-1 text-gray-500" aria-label="Back"><ArrowLeft size={18} /></button>
        <Bell size={16} className="text-gray-400" />
        <span className="font-semibold text-gray-900">Activity</span>
        <div className="flex-1" />
        {unreadTotal > 0 && (
          <button type="button" onClick={markAllRead} disabled={clearing}
            data-tip="Mark every mention, DM and thread reply here as read"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <CheckCheck size={13} /> {clearing ? 'Clearing…' : 'Mark all read'}
          </button>
        )}
        <button type="button" onClick={() => setUnreadOnly(u => !u)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${unreadOnly ? 'bg-powder-600 text-white border-powder-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          Unreads
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 shrink-0 overflow-x-auto">
        {TABS.map(t => {
          const n = counts?.[t.id] || 0;
          const on = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm whitespace-nowrap ${on ? 'bg-gray-900 text-white font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
              <t.icon size={13} /> {t.label}
              {n > 0 && (
                <span className={`px-1.5 rounded-full text-[10px] font-bold ${on ? 'bg-white/20 text-white' : 'bg-powder-600 text-white'}`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 size={18} className="animate-spin" /></div>}

        {!loading && items.length === 0 && (
          <div className="text-center py-14 px-6">
            <Bell size={26} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm font-medium text-gray-600">
              {unreadOnly ? 'Nothing unread here.' : 'No activity yet.'}
            </p>
            <p className="mt-0.5 text-xs text-gray-400 max-w-xs mx-auto">
              Mentions, direct messages and replies to your threads collect here.
            </p>
          </div>
        )}

        {!loading && groups.map(g => (
          <div key={g.label}>
            <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-white/95 backdrop-blur">
              <span className="text-[11px] font-semibold text-gray-500">{g.label}</span>
              <span className="flex-1 h-px bg-gray-100" />
            </div>
            {g.items.map(it => {
              const meta = KIND_META[it.kind] || KIND_META.mention;
              return (
                <button key={it.id} type="button"
                  onClick={() => onOpenMessage?.(it)}
                  className={`w-full text-left flex gap-3 px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50 ${it.unread ? 'bg-powder-50/40' : ''}`}>
                  <div className="mt-0.5 shrink-0">
                    <meta.icon size={15} className={it.unread ? 'text-powder-600' : 'text-gray-400'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="font-medium text-gray-700 truncate">{it.user_name}</span>
                      <span className="text-gray-300">·</span>
                      <span className="inline-flex items-center gap-0.5 truncate">
                        {it.channel_kind === 'dm' ? <MessageSquare size={11} /> : it.channel_kind === 'private' ? <Lock size={11} /> : <Hash size={11} />}
                        {it.channel_name}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="shrink-0">{timeLabel(it.created_at)}</span>
                      {it.unread && <span className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-powder-600" />}
                    </div>
                    <p className={`mt-0.5 text-sm break-words ${it.unread ? 'text-gray-900' : 'text-gray-600'}`}>
                      {preview(it.body)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        {!loading && more && (
          <div className="p-3 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {loadingMore ? 'Loading…' : 'Load older activity'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
