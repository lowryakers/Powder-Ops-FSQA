import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiGet, apiPost, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { consumeParam } from '../../lib/deepLink.js';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import {
  Plus, Copy, Check, MessageSquare, ChevronDown, ChevronRight, Send,
  Paperclip, DollarSign, Bell, Inbox, CircleCheck, CircleX, CalendarClock, FileText,
} from 'lucide-react';

/**
 * Danny's List — the panel side of a text-message workflow.
 *
 * The person this list belongs to will never see this screen. He gets a text
 * in his own "Your list:" format, composed here and COPIED into the real
 * iMessage thread; his verbatim reply is pasted back and filed by hand. The
 * module owns the memory — what is outstanding, what he said, when — and
 * stays out of the conversation itself.
 *
 * Speed is the design constraint everywhere: capture in one line, copy in one
 * tap, file a reply in seconds. The moment logging feels slower than memory,
 * the module goes stale and the thread goes back to being the only record.
 */

const KIND_META = {
  approval: { label: 'Approval', chip: 'bg-violet-100 text-violet-800' },
  payment: { label: 'Payment', chip: 'bg-emerald-100 text-emerald-800' },
  action: { label: 'Action', chip: 'bg-blue-100 text-blue-800' },
  fyi: { label: 'FYI', chip: 'bg-gray-100 text-gray-700' },
  assigned_to_me: { label: 'From Danny', chip: 'bg-amber-100 text-amber-800' },
};
const STATUS_META = {
  open: { label: 'Not sent', chip: 'bg-gray-100 text-gray-700' },
  waiting: { label: 'Waiting on Danny', chip: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', chip: 'bg-green-100 text-green-800' },
  declined: { label: 'Declined', chip: 'bg-red-100 text-red-800' },
  scheduled: { label: 'Scheduled', chip: 'bg-sky-100 text-sky-800' },
  done: { label: 'Done', chip: 'bg-green-100 text-green-800' },
  dropped: { label: 'Dropped', chip: 'bg-gray-100 text-gray-500' },
};
const PRIORITY_DOT = { urgent: 'bg-red-500', high: 'bg-amber-500', normal: 'bg-gray-300', low: 'bg-gray-200' };
const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

// One clipboard helper: execCommand fallback for older iOS Safari in-PWA.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}

function CopyButton({ getText, label = 'Copy', className = '' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className || 'inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700'}
      onClick={async () => {
        const text = typeof getText === 'function' ? await getText() : getText;
        if (text && await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 2000); }
      }}>
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copied' : label}
    </button>
  );
}

/* ── Quick capture ────────────────────────────────────────────────────────── */

function CaptureBar({ onCreated }) {
  const [kind, setKind] = useState('approval');
  const [title, setTitle] = useState('');
  const [more, setMore] = useState(false);
  const [extra, setExtra] = useState({ amount: '', reference: '', due_date: '', priority: 'normal', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await apiPost('/dannys-list', { kind, title: title.trim(), ...extra });
      setTitle(''); setExtra({ amount: '', reference: '', due_date: '', priority: 'normal', details: '' });
      setMore(false);
      onCreated?.();
      inputRef.current?.focus();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap gap-1">
        {Object.entries(KIND_META).map(([k, m]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${kind === k ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder={kind === 'assigned_to_me' ? 'What Danny asked you to do…' : 'Write it the way you would text it…'}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <button type="button" onClick={() => setMore(v => !v)}
          className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50" title="Amount, reference, due date">
          <DollarSign size={14} />
        </button>
        <button type="button" onClick={save} disabled={!title.trim() || busy}
          className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-40">
          <Plus size={15} />
        </button>
      </div>
      {more && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input value={extra.amount} onChange={e => setExtra({ ...extra, amount: e.target.value })}
            type="text" inputMode="decimal" placeholder="$ amount"
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <input value={extra.reference} onChange={e => setExtra({ ...extra, reference: e.target.value })}
            placeholder="Invoice / PO #" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <input value={extra.due_date} onChange={e => setExtra({ ...extra, due_date: e.target.value })}
            type="date" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <select value={extra.priority} onChange={e => setExtra({ ...extra, priority: e.target.value })}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm">
            <option value="low">Low</option><option value="normal">Normal</option>
            <option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <textarea value={extra.details} onChange={e => setExtra({ ...extra, details: e.target.value })}
            rows={2} placeholder="Details (kept here, not texted)"
            className="col-span-2 sm:col-span-4 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ── Reply triage ─────────────────────────────────────────────────────────── */

// His message on the left, the outstanding items on the right. Tap an outcome
// on each item his reply answers; his verbatim words travel onto the event.
function ReplyTriage({ reply, items, onDone, refresh }) {
  const [filedTo, setFiledTo] = useState({}); // item_id -> outcome
  const outstanding = items.filter(i => ['open', 'waiting', 'scheduled'].includes(i.status));

  const file = async (item, outcome) => {
    try {
      await apiPost(`/dannys-list/replies/${reply.id}/file`, { item_id: item.id, outcome });
      setFiledTo(f => ({ ...f, [item.id]: outcome }));
      refresh();
    } catch (e) { alert(e.message); }
  };
  const finish = async () => {
    try { await apiPost(`/dannys-list/replies/${reply.id}/handled`, {}); onDone(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
            <MessageSquare size={13} /> Danny replied · {formatDateTime(reply.created_at)}
          </p>
          {/* His words, exactly. The blue-bubble styling is deliberate — you
              are reading the thread, not a form. */}
          <p className="mt-1.5 px-3 py-2 rounded-2xl rounded-tl-sm bg-white border border-gray-200 text-sm text-gray-900 whitespace-pre-wrap">
            {reply.body}
          </p>
        </div>
        <button type="button" onClick={finish}
          className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700">
          Done filing
        </button>
      </div>
      {outstanding.length === 0 ? (
        <p className="text-xs text-amber-800">Nothing outstanding to file it against — add a note on an item if it needs keeping.</p>
      ) : (
        <div className="space-y-1.5">
          {outstanding.map(it => {
            const filed = filedTo[it.id];
            return (
              <div key={it.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${KIND_META[it.kind]?.chip || ''}`}>{KIND_META[it.kind]?.label}</span>
                <span className="text-xs text-gray-800 truncate flex-1">{it.title}{it.amount != null ? ` — ${money(it.amount)}` : ''}</span>
                {filed ? (
                  <span className="text-[11px] font-medium text-green-700 flex items-center gap-1"><Check size={12} /> {filed}</span>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => file(it, 'approved')} title="Approved" className="p-1 text-green-600 hover:bg-green-50 rounded"><CircleCheck size={15} /></button>
                    <button type="button" onClick={() => file(it, 'declined')} title="Declined" className="p-1 text-red-600 hover:bg-red-50 rounded"><CircleX size={15} /></button>
                    <button type="button" onClick={() => file(it, 'scheduled')} title="Scheduled (payments)" className="p-1 text-sky-600 hover:bg-sky-50 rounded"><CalendarClock size={15} /></button>
                    <button type="button" onClick={() => file(it, 'done')} title="Done" className="p-1 text-green-700 hover:bg-green-50 rounded"><Check size={15} /></button>
                    <button type="button" onClick={() => file(it, 'feedback')} title="File as feedback (no status change)" className="p-1 text-gray-500 hover:bg-gray-100 rounded"><MessageSquare size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── One item row ─────────────────────────────────────────────────────────── */

function ItemRow({ it, selected, onToggle, refresh }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [chase, setChase] = useState(null);
  const [attachments, setAttachments] = useState(null);
  const fileRef = useRef(null);
  const km = KIND_META[it.kind] || {};
  const sm = STATUS_META[it.status] || {};
  const outstanding = ['open', 'waiting', 'scheduled'].includes(it.status);

  const setStatus = async (status) => {
    const needsNote = ['approved', 'declined'].includes(status);
    const text = needsNote ? window.prompt(`${STATUS_META[status].label} — what did he say? (verbatim if you have it)`) : null;
    if (needsNote && text === null) return;
    try { await apiPost(`/dannys-list/${it.id}/status`, { status, note: text || '' }); refresh(); }
    catch (e) { alert(e.message); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try { await apiPost(`/dannys-list/${it.id}/note`, { note: note.trim() }); setNote(''); refresh(); }
    catch (e) { alert(e.message); }
  };
  const loadAttachments = async () => {
    try { setAttachments(await apiFetch(`/dannys-list/${it.id}/attachments`)); } catch { setAttachments([]); }
  };
  const upload = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try { await apiUpload(`/dannys-list/${it.id}/attachments`, fd, 'POST'); loadAttachments(); refresh(); }
    catch (err) { alert(err.message); }
  };

  return (
    <div className={`bg-white border rounded-xl ${selected ? 'border-powder-300 ring-1 ring-powder-200' : 'border-gray-200'}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        {outstanding && (
          <input type="checkbox" checked={selected} onChange={onToggle} className="rounded border-gray-300 shrink-0" />
        )}
        <span className={`h-2 w-2 rounded-full shrink-0 ${PRIORITY_DOT[it.priority] || PRIORITY_DOT.normal}`} title={it.priority} />
        <button type="button" onClick={() => { setOpen(v => !v); if (!open && attachments === null) loadAttachments(); }}
          className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${km.chip}`}>{km.label}</span>
            <span className="text-sm font-medium text-gray-900">{it.title}</span>
            {it.amount != null && <span className="text-xs font-semibold text-emerald-700">{money(it.amount)}</span>}
            {it.reference && <span className="text-[11px] text-gray-500">{it.reference}</span>}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
            <span className={`px-1.5 py-0.5 rounded font-medium ${sm.chip}`}>{sm.label}</span>
            {it.due_date && <span>need by {formatDate(it.due_date)}</span>}
            {it.last_sent_at && <span>texted {formatDateTime(it.last_sent_at)}</span>}
            {it.chase_count > 0 && <span className="text-amber-700">chased ×{it.chase_count}</span>}
          </div>
        </button>
        {open ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
      </div>

      {open && (
        <div className="border-t border-gray-100 px-3 py-2.5 space-y-2.5">
          {it.details && <p className="text-xs text-gray-600 whitespace-pre-wrap">{it.details}</p>}

          <div className="flex flex-wrap items-center gap-1.5">
            {outstanding && (
              <>
                {it.status !== 'open' && (
                  <button type="button" onClick={async () => { const r = await apiPost(`/dannys-list/${it.id}/chase`, {}); setChase(r.text); refresh(); }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100">
                    <Bell size={12} /> Chase
                  </button>
                )}
                {['approval', 'payment'].includes(it.kind) && (
                  <>
                    <button type="button" onClick={() => setStatus('approved')} className="px-2.5 py-1.5 border border-green-200 bg-green-50 text-green-800 rounded-lg text-xs font-medium hover:bg-green-100">Approved</button>
                    <button type="button" onClick={() => setStatus('declined')} className="px-2.5 py-1.5 border border-red-200 bg-red-50 text-red-800 rounded-lg text-xs font-medium hover:bg-red-100">Declined</button>
                  </>
                )}
                {it.kind === 'payment' && (
                  <button type="button" onClick={() => setStatus('scheduled')} className="px-2.5 py-1.5 border border-sky-200 bg-sky-50 text-sky-800 rounded-lg text-xs font-medium hover:bg-sky-100">Scheduled</button>
                )}
                <button type="button" onClick={() => setStatus('done')} className="px-2.5 py-1.5 border border-green-200 bg-green-50 text-green-800 rounded-lg text-xs font-medium hover:bg-green-100">Done</button>
                <button type="button" onClick={() => setStatus('dropped')} className="px-2.5 py-1.5 border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50">Drop</button>
              </>
            )}
            {!outstanding && (
              <button type="button" onClick={() => setStatus('open')} className="px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">Reopen</button>
            )}
            <button type="button" onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">
              <Paperclip size={12} /> Attach
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={upload} />
          </div>

          {chase && (
            <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
              <p className="text-xs text-gray-800 flex-1 whitespace-pre-wrap">{chase}</p>
              <CopyButton getText={chase} label="Copy"
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-powder-600 text-white rounded text-[11px] font-medium" />
            </div>
          )}

          {attachments?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map(a => (
                <a key={a.id} href={a.url || '#'} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 text-[11px] text-gray-700 hover:bg-gray-200">
                  <FileText size={11} /> {a.filename}
                </a>
              ))}
            </div>
          )}

          {/* The thread: captured → texted → his words → outcome. His replies
              render as quotes, because they are. */}
          <div className="space-y-1">
            {(it.events || []).map((e, i) => (
              <div key={i} className="text-[11px] text-gray-500 flex items-start gap-1.5">
                <span className="shrink-0 text-gray-400">{formatDateTime(e.at)}</span>
                <span className="min-w-0">
                  <span className="font-medium text-gray-600">{e.by}</span>
                  {' — '}{String(e.type || '').replace(/^status:/, '').replace(/_/g, ' ')}
                  {e.text && <span className="block text-gray-700 italic">“{e.text}”</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-1.5">
            <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote(); }}
              placeholder="Add an update…" className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <button type="button" onClick={addNote} disabled={!note.trim()}
              className="px-2.5 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 disabled:opacity-40">
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The panel ────────────────────────────────────────────────────────────── */

export default function DannysListPanel() {
  const { user } = useAuth() || {};
  const { data, loading, refresh } = useApiGet('/dannys-list');
  const [tab, setTab] = useState('needs_danny');
  const [selected, setSelected] = useState(new Set());
  const [replies, setReplies] = useState([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const items = useMemo(() => data?.items || [], [data]);
  const loadReplies = async () => {
    try { setReplies(await apiFetch('/dannys-list/replies')); } catch { /* module may 403 */ }
  };
  useEffect(() => { loadReplies(); }, [data]);

  // The iOS Shortcut lands here: ?tab=dannys-list&reply=<his message>. The
  // Shortcut is one action — clipboard → open URL — and this consumes it once.
  useEffect(() => {
    const text = consumeParam('reply');
    if (text && text.trim()) {
      apiPost('/dannys-list/replies', { body: text.trim(), via: 'shortcut' })
        .then(() => { refresh(); loadReplies(); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logPaste = async () => {
    if (!pasteText.trim()) return;
    try {
      await apiPost('/dannys-list/replies', { body: pasteText.trim(), via: 'manual' });
      setPasteText(''); setShowPaste(false); refresh(); loadReplies();
    } catch (e) { alert(e.message); }
  };
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) { setPasteText(text); setShowPaste(true); }
      else setShowPaste(true);
    } catch { setShowPaste(true); } // clipboard permission refused → type/paste by hand
  };

  const visible = useMemo(() => {
    if (tab === 'needs_danny') return items.filter(i => ['open', 'waiting', 'scheduled'].includes(i.status) && i.kind !== 'assigned_to_me');
    if (tab === 'mine') return items.filter(i => i.kind === 'assigned_to_me' && ['open', 'waiting', 'scheduled'].includes(i.status));
    if (tab === 'done') return items.filter(i => !['open', 'waiting', 'scheduled'].includes(i.status));
    return items;
  }, [items, tab]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedVisible = visible.filter(i => selected.has(i.id));

  const composeAndCopy = async () => {
    const r = await apiPost('/dannys-list/compose', { ids: selectedVisible.map(i => i.id) });
    setSelected(new Set());
    refresh();
    return r.text;
  };

  const TABS = [
    ['needs_danny', 'Needs Danny'],
    ['mine', 'From Danny'],
    ['done', 'Done'],
    ['all', 'All'],
  ];

  if (loading && !data) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Danny&apos;s List</h2>
          <p className="text-xs text-gray-500">
            Capture it here, text it from your phone, file what he says. The log is the memory.
          </p>
        </div>
        <button type="button" onClick={pasteFromClipboard}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg text-sm font-medium hover:bg-amber-100">
          <Inbox size={14} /> Log his reply
          {replies.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-bold">{replies.length}</span>}
        </button>
      </div>

      <CaptureBar onCreated={refresh} />

      {showPaste && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-gray-700">Paste Danny&apos;s reply</p>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={3} autoFocus
            placeholder="His message, exactly as he sent it…"
            className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowPaste(false); setPasteText(''); }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="button" onClick={logPaste} disabled={!pasteText.trim()}
              className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-40">
              Log it
            </button>
          </div>
        </div>
      )}

      {replies.map(r => (
        <ReplyTriage key={r.id} reply={r} items={items} refresh={refresh}
          onDone={() => { loadReplies(); refresh(); }} />
      ))}

      <div className="flex items-center gap-1 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => { setTab(id); setSelected(new Set()); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === id ? 'bg-powder-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {selectedVisible.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-2 bg-powder-600 text-white rounded-xl px-3 py-2 shadow-lg">
          <span className="text-sm font-medium flex-1">
            {selectedVisible.length} item{selectedVisible.length === 1 ? '' : 's'} → one text
          </span>
          <CopyButton getText={composeAndCopy} label="Copy list for Danny"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-powder-700 rounded-lg text-sm font-semibold hover:bg-powder-50" />
        </div>
      )}

      <div className="space-y-2">
        {visible.length === 0 && (
          <p className="text-sm text-gray-400 py-8 text-center">
            {tab === 'needs_danny' ? 'Nothing waiting on Danny. Capture something above.' : 'Nothing here.'}
          </p>
        )}
        {visible.map(it => (
          <ItemRow key={it.id} it={it} selected={selected.has(it.id)} onToggle={() => toggle(it.id)} refresh={refresh} />
        ))}
      </div>

      {user?.role === 'admin' && (
        <p className="text-[11px] text-gray-400">
          Tip: an iOS Shortcut with “Get clipboard → Open URL
          {' '}<span className="font-mono">https://app.powder-ops.com/?tab=dannys-list&amp;reply=[Clipboard]</span>”
          logs his reply in one tap from the Messages thread.
        </p>
      )}
    </div>
  );
}
