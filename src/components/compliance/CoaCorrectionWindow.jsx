// The COA correction window on screen (D-307), and the two small helpers that
// sit beside it: the stored-vs-printed facts in the sign dialog (D-312) and
// the history of signatures removed from a certificate.
//
// The server decides everything; these render what it says. A window is opened
// by an admin with a password; un-signing under one asks for a reason, what
// will be corrected, and the person's own password.
import { useState } from 'react';
import { useApiGet, apiFetch, apiPost } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature';
import { formatDateTime } from '../../lib/datetime';
import { AlertTriangle, Clock, X } from 'lucide-react';

const PLANT_TZ = 'America/Denver';
/** "Nov 11, 2026, 3:00 PM MT" — always the plant's clock, whatever the viewer's. */
function mtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString('en-US', { timeZone: PLANT_TZ, dateStyle: 'medium', timeStyle: 'short' })} MT`;
}

/** The amber line at the top of Lab Requests while a window covers this person. */
export function WindowBanner({ window: w }) {
  if (!w) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-window-banner>
      <Clock size={15} className="mt-0.5 shrink-0" />
      <span>
        <b>Correction window open until {mtTime(w.expires_at)}.</b> You may un-sign a certificate to correct a wrong date,
        lot, expiry or result — with a reason, what you will correct, and your password. It must be signed again.
      </span>
    </div>
  );
}

/** Un-sign, with the reason and the plan of what will be corrected. */
export function UnsignModal({ detail, correction, onClose, onDone }) {
  const underWindow = !!correction?.window_id;
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const minReason = underWindow ? 10 : 3;
  const ready = reason.trim().length >= minReason && (!underWindow || plan.trim().length >= 3);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await withSignature((extra) => apiFetch(`/coa/requests/${detail.id}/sign`, {
        method: 'DELETE', body: { reason: reason.trim(), field_plan: plan.trim() || undefined, ...extra },
      }), { title: 'Remove the signature', detail: `${detail.item_description} · Lot ${detail.lot_number}` });
      onDone();
    } catch (e) { if (!e?.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-unsign-modal>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Remove the signature</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-gray-600">
            Certificate <b>{detail.certificate_number || '—'}</b> is voided and kept on the record. When it is signed again it gets a
            new number that says which one it corrects.{underWindow ? ' Until then it is reopened for correction and its PDF is not issued.' : ''}
          </p>
          {underWindow && correction.window_expires_at && (
            <p className="text-amber-800 bg-amber-50 rounded px-2 py-1">Correction window open until {mtTime(correction.window_expires_at)}.</p>
          )}
          <label className="block">
            <span className="font-medium text-gray-800">Why is the signature being removed?</span>
            <textarea id="unsign-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5" placeholder="Wrong expiry was typed at filing" data-unsign-reason />
            <span className="text-xs text-gray-400">At least {minReason} characters.</span>
          </label>
          <label className="block">
            <span className="font-medium text-gray-800">What will you correct?{underWindow ? '' : ' (optional)'}</span>
            <textarea id="unsign-plan" value={plan} onChange={e => setPlan(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5" placeholder="Expiry 2026-10 to 2028-10; gluten <44 to <4" data-unsign-plan />
          </label>
          {error && <p className="text-red-600" data-unsign-error>{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm">Cancel</button>
          <button onClick={submit} disabled={!ready || busy} data-unsign-submit
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm disabled:opacity-40">{busy ? 'Removing…' : 'Remove signature'}</button>
        </div>
      </div>
    </div>
  );
}

/** Signatures removed from this certificate, oldest first. Nothing is ever deleted from this list. */
export function SignatureHistory({ history, reopened, supersedes }) {
  if (!history?.length && !reopened && !supersedes) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 space-y-1" data-signature-history>
      {reopened && <p className="font-semibold text-amber-800" data-reopened>Reopened for correction — sign it again to issue the certificate.</p>}
      {supersedes && <p>Corrects certificate <b>{supersedes}</b>.</p>}
      {history?.map(h => (
        <p key={h.id}>
          Certificate <b>{h.certificate_number || '—'}</b> signed by {h.qa_signed_by || '—'} {h.qa_signed_at ? `(${formatDateTime(h.qa_signed_at)})` : ''};
          signature removed by {h.unsigned_by} {formatDateTime(h.unsigned_at)}: “{h.reason}”{h.field_plan ? ` — will correct: ${h.field_plan}` : ''}
          {h.window_id ? ' · under a correction window' : ''}
        </p>
      ))}
    </div>
  );
}

/** The sign dialog's side-by-side: what is stored, what the lab printed. */
export function SignFacts({ requestId }) {
  const { data } = useApiGet(`/coa/requests/${requestId}/sign-facts`, [requestId]);
  if (!data?.facts) return null;
  const disagree = data.facts.filter(f => f.agree === false);
  return (
    <div className="rounded-lg border border-gray-200 text-xs" data-sign-facts>
      <div className="grid grid-cols-3 gap-2 px-3 py-1.5 bg-gray-50 font-semibold text-gray-600">
        <span>Check</span><span>Stored</span><span>On the lab report{data.lab_report_number ? ` (${data.lab_report_number})` : ''}</span>
      </div>
      {data.facts.map(f => (
        <div key={f.key} className={`grid grid-cols-3 gap-2 px-3 py-1.5 border-t border-gray-100 ${f.agree === false ? 'bg-red-50 text-red-800' : ''}`} data-sign-fact={f.key} data-agree={String(f.agree)}>
          <span>{f.label}</span><span className="tabular-nums">{f.stored || '—'}</span><span className="tabular-nums">{f.printed || '—'}</span>
        </div>
      ))}
      {disagree.length > 0 && (
        <p className="px-3 py-1.5 border-t border-red-100 text-red-700 flex items-center gap-1"><AlertTriangle size={12} />
          {disagree.map(f => f.label).join(', ')} {disagree.length === 1 ? 'differs' : 'differ'} from the lab report. Check before signing.</p>
      )}
      {!data.file && <p className="px-3 py-1.5 border-t border-gray-100 text-gray-500">No lab report is attached, so there is nothing printed to compare with.</p>}
    </div>
  );
}

/** Admin: open, list and close correction windows. */
export function CorrectionWindowsAdmin() {
  const { data, refresh } = useApiGet('/coa/correction-window', []);
  const [picked, setPicked] = useState([]);
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  if (!data) return null;
  const open = async () => {
    setError(null);
    try {
      await withSignature((extra) => apiPost('/coa/correction-window', { user_ids: picked, hours: hours ? Number(hours) : undefined, reason, ...extra }),
        { title: 'Open a correction window' });
      setPicked([]); setReason(''); setHours(''); refresh();
    } catch (e) { if (!e?.cancelled) setError(e.message); }
  };
  const close = async (id) => {
    const why = window.prompt('Close this window now? Say why (optional).') ;
    if (why === null) return;
    try { await apiFetch(`/coa/correction-window/${id}`, { method: 'DELETE', body: { reason: why } }); refresh(); }
    catch (e) { setError(e.message); }
  };
  const live = data.windows.filter(w => w.state === 'open');
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 text-sm" data-window-admin>
      <div>
        <h3 className="font-semibold text-gray-900">Correction windows</h3>
        <p className="text-gray-500 text-xs">A temporary door: the Quality reviewers you name may un-sign a certificate to correct it, with a reason
          and their password, until the window ends ({data.default_hours / 24} days by default, never more than {data.max_hours / 24}). Deleting is never opened.</p>
      </div>
      {live.map(w => (
        <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2" data-window-row>
          <span className="font-medium">Open until {mtTime(w.expires_at)}</span>
          <span className="text-gray-600">for {w.people.map(p => p.name).join(', ')}</span>
          <span className="text-gray-500">— “{w.reason}” ({w.opened_by})</span>
          <button onClick={() => close(w.id)} className="ml-auto text-xs px-2 py-1 rounded border border-amber-300" data-window-close>Close now</button>
        </div>
      ))}
      {data.reopened?.length > 0 && (
        <div className="text-xs text-gray-700" data-window-reopened>
          <p className="font-semibold">Reopened and not signed again ({data.reopened.length})</p>
          {data.reopened.map(r => <p key={r.id} className={r.stale ? 'text-red-700' : ''}>Lot {r.lot_number} · {r.item_description} · {r.days_open ?? '?'} days</p>)}
        </div>
      )}
      <fieldset className="space-y-2 border-t border-gray-100 pt-3">
        <legend className="font-medium text-gray-800">Open a window</legend>
        <div className="flex flex-wrap gap-2">
          {data.candidates.map(c => (
            <label key={c.id} className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1">
              <input type="checkbox" id={`win-person-${c.id}`} checked={picked.includes(c.id)}
                onChange={e => setPicked(p => e.target.checked ? [...p, c.id] : p.filter(x => x !== c.id))} className="h-4 w-4 shrink-0" />
              {c.name}
            </label>
          ))}
          {!data.candidates.length && <span className="text-gray-500">No active Quality reviewer to name.</span>}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs">Hours
            <input id="win-hours" type="number" min="1" max={data.max_hours} placeholder={String(data.default_hours)} value={hours}
              onChange={e => setHours(e.target.value)} className="block w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs flex-1 min-w-[12rem]">Why (at least 20 characters)
            <input id="win-reason" value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="Correcting expiry dates typed wrong in October" />
          </label>
          <button onClick={open} disabled={!picked.length || reason.trim().length < 20} data-window-open
            className="px-3 py-1.5 rounded-lg bg-powder-600 text-white text-sm disabled:opacity-40">Open window</button>
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
      </fieldset>
    </div>
  );
}
