import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { MessageSquarePlus, Check, X, Send, RotateCcw, Trash2 } from 'lucide-react';

// ReadyDoc feedback. Two halves, on purpose:
//
//   Submitting  one box and a button. No title, no team, no assignee, no due
//               date. Every required field is a reason not to bother, and the
//               request you never hear about is the expensive one.
//   Triage      a checklist. Structure belongs here, not in the person's way.

const AREAS = ['Tasks / Operator', 'Chat / Messages', 'Logs & Forms', 'Schedule', 'Something else'];

/* ── Submit ──────────────────────────────────────────────────────────────── */

export function RequestModal({ onClose, onSent }) {
  const [body, setBody] = useState('');
  const [area, setArea] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true); setError(null);
    try {
      await apiPost('/app-requests', { body: body.trim(), area: area || undefined });
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

  const Row = ({ r }) => (
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
          {' · '}{new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}
          {r.status === 'done' && r.done_by && <> · done by {r.done_by}</>}
        </p>
      </div>
      {isAdmin && (
        <button type="button" onClick={() => remove(r)} className="p-1 text-gray-300 hover:text-red-600 shrink-0" data-tip="Delete"><Trash2 size={13} /></button>
      )}
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div>
          <h3 className="font-semibold text-gray-900">ReadyDoc Requests</h3>
          <p className="text-xs text-gray-500">
            {isAdmin ? 'What the team has asked for. Tick one off when it ships.' : 'What you have submitted.'}
          </p>
        </div>
        <button type="button" onClick={() => setShowDone(s => !s)}
          className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50">
          {showDone ? 'Hide done' : `Show done${done.length ? ` (${done.length})` : ''}`}
        </button>
      </div>

      {open.length === 0 && done.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-gray-400">Nothing open. </p>
      )}

      {open.map(r => <Row key={r.id} r={r} />)}

      {showDone && done.length > 0 && (
        <>
          <div className="px-4 py-1.5 bg-gray-50 text-[11px] font-semibold text-gray-500 flex items-center gap-1.5">
            <RotateCcw size={11} /> Done
          </div>
          {done.map(r => <Row key={r.id} r={r} />)}
        </>
      )}
    </div>
  );
}
