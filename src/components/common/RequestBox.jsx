import { useState, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete, apiUpload } from '../../hooks/useApi';
import {
  MessageSquarePlus, Check, X, Send, RotateCcw, Trash2, Paperclip, Copy, Link2,
  Image as ImageIcon, FileText, ExternalLink,
} from 'lucide-react';

// ReadyDoc feedback. Two halves, on purpose:
//
//   Submitting  one box and a button. No title, no team, no assignee, no due
//               date. Every required field is a reason not to bother, and the
//               request you never hear about is the expensive one.
//   Triage      a checklist. Structure belongs here, not in the person's way.

const AREAS = ['Tasks / Operator', 'Chat / Messages', 'Logs & Forms', 'Schedule', 'Something else'];

const shortDate = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString() : '');

// Copy renders the list the way it is going to be READ — as a bullet list you
// can paste straight into a message or a working session. Attribution and the
// attachment names ride along, because "who asked for this" and "there's a
// screenshot" are the first two things you want when you come back to it.
function requestsAsText(rows, heading) {
  const lines = [`${heading} — ${rows.length} item${rows.length === 1 ? '' : 's'} (${new Date().toLocaleDateString()})`, ''];
  for (const r of rows) {
    lines.push(`* ${r.body}`);
    const meta = [r.submitted_by || 'Someone', shortDate(r.created_at), r.area].filter(Boolean).join(', ');
    if (meta) lines.push(`  — ${meta}${r.status === 'done' ? ' · done' : ''}`);
    for (const a of r.attachments || []) {
      lines.push(`  attached: ${a.kind === 'link' ? a.url : a.filename}`);
    }
  }
  return lines.join('\n');
}

// navigator.clipboard needs a secure context, which a plant tablet on plain
// http will not have — so fall back rather than failing silently.
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function CopyButton({ text, label = 'Copy', title, className }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title={title}
      onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1600); } }}
      className={className || 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50'}>
      {done ? <><Check size={12} className="text-green-600" /> Copied</> : <><Copy size={12} /> {label}</>}
    </button>
  );
}

const isImage = (a) => a.kind === 'file' && /^image\//.test(a.content_type || '');

function Attachments({ items, onRemove }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map(a => (
        <span key={a.id} className="inline-flex items-center gap-1 max-w-full">
          <a href={a.url || '#'} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-700 hover:bg-gray-100 max-w-[15rem]">
            {a.kind === 'link' ? <Link2 size={11} className="shrink-0" />
              : isImage(a) ? <ImageIcon size={11} className="shrink-0" /> : <FileText size={11} className="shrink-0" />}
            <span className="truncate">{a.filename || a.url}</span>
            <ExternalLink size={10} className="shrink-0 text-gray-400" />
          </a>
          {onRemove && (
            <button type="button" onClick={() => onRemove(a)} className="p-0.5 text-gray-300 hover:text-red-600" data-tip="Remove">
              <X size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* ── Submit ──────────────────────────────────────────────────────────────── */

export function RequestModal({ onClose, onSent }) {
  const [body, setBody] = useState('');
  const [area, setArea] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  // Attachments are picked BEFORE the request exists, so they're held here and
  // uploaded straight after it's created. Staying optional is the point — the
  // one-box-and-a-button rule is what makes people file anything at all.
  const [files, setFiles] = useState([]);
  const [link, setLink] = useState('');
  const fileRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true); setError(null);
    try {
      const created = await apiPost('/app-requests', { body: body.trim(), area: area || undefined });
      // The request is filed either way; a failed upload must not lose the text.
      if (files.length || link.trim()) {
        try {
          if (files.length) {
            const fd = new FormData();
            for (const f of files) fd.append('files', f);
            await apiUpload(`/app-requests/${created.id}/attachments`, fd);
          }
          if (link.trim()) await apiPost(`/app-requests/${created.id}/attachments`, { url: link.trim() });
        } catch (err) {
          setError(`Request sent, but an attachment did not: ${err.message}`);
        }
      }
      setSent(true);
      onSent?.();
      // Leave the confirmation up briefly rather than yanking the dialog away.
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err.message || 'Could not send that.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquarePlus size={16} /> Request a change
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {sent ? (
          <div className="px-4 py-8 text-center">
            <Check size={26} className="mx-auto text-green-600" />
            <p className="mt-2 text-sm font-medium text-gray-800">Sent — thank you.</p>
            <p className="text-xs text-gray-500">Lowry sees it on the ReadyDoc request list.</p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Anything that&apos;s broken, missing, or would make your job easier — on the task/operator side or in chat.
                One thing per request so it can be checked off.
              </p>
              <textarea autoFocus value={body} onChange={e => setBody(e.target.value)} rows={5}
                placeholder="e.g. The Kitting EOD form needs a field for pallet count"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Area (optional)</label>
                <select value={area} onChange={e => setArea(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">—</option>
                  {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* A screenshot says in one image what a paragraph struggles to. */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    <Paperclip size={12} /> Add a screenshot or file
                  </button>
                  <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden"
                    onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
                  {files.length > 0 && (
                    <span className="text-[11px] text-gray-500">{files.length} file{files.length === 1 ? '' : 's'}</span>
                  )}
                </div>
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {files.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-700 max-w-[14rem]">
                        <span className="truncate">{f.name}</span>
                        <button type="button" onClick={() => setFiles(list => list.filter((_, n) => n !== i))}
                          className="text-gray-400 hover:text-red-600"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Link2 size={13} className="text-gray-400 shrink-0" />
                  <input type="url" value={link} onChange={e => setLink(e.target.value)}
                    placeholder="or paste a Drive / SharePoint link"
                    className="flex-1 min-w-0 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" />
                </div>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving || !body.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Send size={14} /> {saving ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// Module scope on purpose. Defined inside RequestListPanel it was rebuilt on
// every render, so React saw a new component type each time and remounted every
// row — which throws away the file-input ref mid-interaction. Same rule as the
// facility map's Line.
function RequestRow({ r, isAdmin, user, toggle, remove, detach, addLink, addFiles }) {
  const pick = useRef(null);
  const canAttach = isAdmin || r.submitted_by_id === user?.id;
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0 ${r.status === 'done' ? 'opacity-60' : ''}`}>
      <button type="button" onClick={() => isAdmin && toggle(r)} disabled={!isAdmin}
        className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${r.status === 'done' ? 'bg-green-600 border-green-600' : 'border-gray-300 hover:border-powder-500'} ${isAdmin ? '' : 'cursor-default'}`}
        aria-label={r.status === 'done' ? 'Mark not done' : 'Mark done'}>
        {r.status === 'done' && <Check size={11} className="text-white" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-sm break-words ${r.status === 'done' ? 'line-through text-gray-500' : 'text-gray-900'}`}>{r.body}</p>
        <p className="mt-0.5 text-[11px] text-gray-400">
          {r.submitted_by || 'Someone'}
          {r.area && <> · {r.area}</>}
          {' · '}{shortDate(r.created_at)}
          {r.status === 'done' && r.done_by && <> · done by {r.done_by}</>}
        </p>
        <Attachments items={r.attachments} onRemove={canAttach ? detach : null} />
        {canAttach && (
          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={() => pick.current?.click()}
              className="text-[11px] text-gray-400 hover:text-powder-600 inline-flex items-center gap-1">
              <Paperclip size={10} /> File
            </button>
            <input ref={pick} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden"
              onChange={e => { addFiles(r, Array.from(e.target.files || [])); e.target.value = ''; }} />
            <button type="button" onClick={() => addLink(r)}
              className="text-[11px] text-gray-400 hover:text-powder-600 inline-flex items-center gap-1">
              <Link2 size={10} /> Link
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <CopyButton text={requestsAsText([r], 'ReadyDoc Request')} label="" title="Copy this request"
          className="p-1 text-gray-300 hover:text-powder-600" />
        {isAdmin && (
          <button type="button" onClick={() => remove(r)} className="p-1 text-gray-300 hover:text-red-600" data-tip="Delete"><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  );
}

/* ── Triage ──────────────────────────────────────────────────────────────── */

// The checklist. Open items first; ticking one moves it to Done.
export default function RequestListPanel({ user }) {
  const [showDone, setShowDone] = useState(false);
  const { data: items, refresh } = useApiGet(`/app-requests?status=${showDone ? 'all' : 'open'}`, [showDone]);
  const isAdmin = user?.role === 'admin';

  const toggle = async (r) => {
    await apiPut(`/app-requests/${r.id}`, { status: r.status === 'done' ? 'open' : 'done' });
    refresh();
  };
  const remove = async (r) => {
    if (!window.confirm('Delete this request?')) return;
    await apiDelete(`/app-requests/${r.id}`);
    refresh();
  };

  const open = (items || []).filter(r => r.status === 'open');
  const done = (items || []).filter(r => r.status === 'done');

  const detach = async (a) => {
    await apiDelete(`/app-requests/attachments/${a.id}`);
    refresh();
  };
  const addLink = async (r) => {
    const url = window.prompt('Paste a link (Drive, SharePoint, anything):');
    if (!url?.trim()) return;
    try { await apiPost(`/app-requests/${r.id}/attachments`, { url: url.trim() }); refresh(); }
    catch (err) { window.alert(err.message); }
  };
  const addFiles = async (r, list) => {
    if (!list?.length) return;
    const fd = new FormData();
    for (const f of list) fd.append('files', f);
    try { await apiUpload(`/app-requests/${r.id}/attachments`, fd); refresh(); }
    catch (err) { window.alert(err.message); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div>
          <h3 className="font-semibold text-gray-900">ReadyDoc Requests</h3>
          <p className="text-xs text-gray-500">
            {isAdmin ? 'What the team has asked for. Tick one off when it ships.' : 'What you have submitted.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Copies exactly what's on screen — so "Show done" first if you want
              those too. Copying a filtered list you can't see would be worse. */}
          <CopyButton text={requestsAsText(showDone ? [...open, ...done] : open, 'ReadyDoc Requests')}
            label={`Copy${open.length || done.length ? ` (${showDone ? open.length + done.length : open.length})` : ''}`}
            title="Copy the list shown, ready to paste" />
          <button type="button" onClick={() => setShowDone(s => !s)}
            className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50">
            {showDone ? 'Hide done' : `Show done${done.length ? ` (${done.length})` : ''}`}
          </button>
        </div>
      </div>

      {open.length === 0 && done.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-gray-400">Nothing open. </p>
      )}

      {open.map(r => <RequestRow key={r.id} r={r} isAdmin={isAdmin} user={user} toggle={toggle} remove={remove} detach={detach} addLink={addLink} addFiles={addFiles} />)}

      {showDone && done.length > 0 && (
        <>
          <div className="px-4 py-1.5 bg-gray-50 text-[11px] font-semibold text-gray-500 flex items-center gap-1.5">
            <RotateCcw size={11} /> Done
          </div>
          {done.map(r => <RequestRow key={r.id} r={r} isAdmin={isAdmin} user={user} toggle={toggle} remove={remove} detach={detach} addLink={addLink} addFiles={addFiles} />)}
        </>
      )}
    </div>
  );
}
