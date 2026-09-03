import { useState, useRef, useEffect } from 'react';
import { apiPost, apiDelete, useApiGet } from '../../hooks/useApi';
import { Send, Copy, Check, MessageSquare, X, Trash2, Star, ClipboardList } from 'lucide-react';
import QMSRecordsPanel from './QMSRecordsPanel.jsx';
import { SENSORY_KEYS, sensoryNoteKey, sensoryComplete } from '../../../shared/sensory.js';
import SensoryBlock from './SensoryBlock.jsx';

// Flavor Approvals: the log (generic QMS panel) plus "text it for approval".
//
// WHO IT GOES TO IS CHOSEN AT SEND TIME. It used to be one number in an env
// var, so texting a second approver meant a redeploy — and in practice the link
// got copied into a personal text, which leaves no record of who was asked.
// The number is picked here and recorded in the audit trail with the decision.
//
// Three boxes rather than one, because a phone number is read and dictated in
// three groups and typing it as ten unbroken digits is where a transposition
// hides. Numbers used more than once are saved, since there are only ever three
// or four of them.

const digitsOnly = (v) => String(v || '').replace(/\D/g, '');
const prettyPhone = (p) => {
  const d = digitsOnly(p).slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
};

function PhoneBoxes({ value, onChange }) {
  // [area, prefix, line] — kept as three strings so each box owns its own
  // length and the caret never jumps mid-group.
  const refs = [useRef(null), useRef(null), useRef(null)];
  const lens = [3, 3, 4];

  const setPart = (i, raw) => {
    const v = digitsOnly(raw).slice(0, lens[i]);
    const next = [...value];
    next[i] = v;
    onChange(next);
    // Advance only when this group is full — never on every keystroke, or a
    // correction in the middle of a group throws focus forward.
    if (v.length === lens[i] && i < 2) refs[i + 1].current?.focus();
  };

  // Backspace at the start of an empty box steps back, which is what every
  // phone-entry field people have used does.
  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) { e.preventDefault(); refs[i - 1].current?.focus(); }
  };

  // Pasting a whole number into the first box should just work.
  const onPaste = (e) => {
    const d = digitsOnly(e.clipboardData.getData('text')).slice(-10);
    if (d.length < 4) return;
    e.preventDefault();
    onChange([d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)]);
    refs[2].current?.focus();
  };

  return (
    <div className="flex items-center gap-1.5" onPaste={onPaste}>
      <span className="text-sm text-gray-400">(</span>
      {[0, 1, 2].map(i => (
        <span key={i} className="flex items-center gap-1.5">
          <input ref={refs[i]} value={value[i]} onChange={e => setPart(i, e.target.value)}
            onKeyDown={e => onKeyDown(i, e)}
            inputMode="numeric" autoComplete="off"
            // type=text, not number: a number input strips leading zeros and
            // offers a spinner nobody wants on a phone number.
            type="text" maxLength={lens[i]}
            aria-label={['Area code', 'Prefix', 'Line number'][i]}
            className={`px-2 py-2 border border-gray-300 rounded-lg text-sm text-center tracking-wider ${i === 2 ? 'w-16' : 'w-12'}`} />
          {i === 0 && <span className="text-sm text-gray-400">)</span>}
          {i === 1 && <span className="text-sm text-gray-400">–</span>}
        </span>
      ))}
    </div>
  );
}

function SendModal({ onClose, onSend, sending, record }) {
  const { data: contacts, refresh } = useApiGet('/qms/sms-contacts');
  const [parts, setParts] = useState(['', '', '']);
  const [save, setSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [error, setError] = useState(null);
  const phone = parts.join('');
  const complete = phone.length === 10;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!complete) { setError('Enter all ten digits.'); return; }
    if (save && !saveName.trim()) { setError('Give the number a name to save it.'); return; }
    if (save) {
      // Saving must never block the send — a duplicate or a hiccup here is not
      // a reason to fail texting the approval.
      try { await apiPost('/qms/sms-contacts', { name: saveName.trim(), phone }); refresh(); }
      catch { /* the send is what matters */ }
    }
    onSend(phone);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl w-full max-w-sm max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-gray-900">Text this for approval</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* WHERE IT WENT LAST TIME, on the screen where the number is chosen.
            "It says delivered but he never got it" is nearly always one of two
            things, and this answers the first of them without a Twilio login:
            the message went to a number that is not his. */}
        {record?.last_texted_to && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
            Last texted to <strong>{prettyPhone(record.last_texted_to)}</strong>.
            {' '}If that is not the right phone, the message was delivered to somebody else.
          </p>
        )}

        {!!contacts?.length && (
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Saved numbers</p>
            <div className="space-y-1">
              {contacts.map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <button type="button"
                    onClick={() => setParts([c.phone.slice(0, 3), c.phone.slice(3, 6), c.phone.slice(6, 10)])}
                    className={`flex-1 text-left px-3 py-2 rounded-lg border text-sm ${phone === c.phone ? 'border-powder-500 bg-powder-50 text-powder-800' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-gray-500"> · {prettyPhone(c.phone)}</span>
                  </button>
                  <button type="button" title={`Remove ${c.name}`}
                    onClick={async () => { if (window.confirm(`Remove ${c.name}?`)) { await apiDelete(`/qms/sms-contacts/${c.id}`); refresh(); } }}
                    className="p-1.5 text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            {contacts?.length ? 'Or a different number' : 'Phone number'}
          </label>
          <PhoneBoxes value={parts} onChange={setParts} />
        </div>

        {complete && !contacts?.some(c => c.phone === phone) && (
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} className="mt-0.5" />
            <span className="flex-1">
              <span className="inline-flex items-center gap-1"><Star size={11} /> Save this number for next time</span>
              {save && (
                <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Name (e.g. Danny)"
                  className="mt-1.5 w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
              )}
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={!complete || sending}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
        </div>
      </form>
    </div>
  );
}


/**
 * QA records the tasting — FORM 602-01 V2: each attribute checked against the
 * product's written specification, Matches / Doesn't match, with what was seen
 * on a fail. The same block the Organoleptic form uses, because the record
 * this produces IS an organoleptic record. A new flavour with no specification
 * on file is described here and that description becomes its draft spec.
 */
function SensoryModal({ record, onClose, onSaved }) {
  const [values, setValues] = useState(() => {
    const v = {};
    for (const k of SENSORY_KEYS) { v[k] = String(record?.[k] ?? '').toLowerCase(); v[sensoryNoteKey(k)] = record?.[sensoryNoteKey(k)] || ''; }
    return v;
  });
  const [notes, setNotes] = useState(record?.sensory_notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const complete = sensoryComplete(values);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await apiPost(`/qms/flavor_approval/${record.id}/sensory`, { ...values, sensory_notes: notes });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">Sensory evaluation</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {record?.product_name || record?.record_number}
              {record?.lot_number ? ` · Lot ${record.lot_number}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <SensoryBlock product={record?.product_name} values={values} onChange={setValues} />

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Anything the approver should know about this batch"
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </label>

        <p className="text-[11px] text-gray-500">
          Your name and the date are recorded with this evaluation. It goes to the approver with the
          batch, and it becomes the Organoleptic record when the decision is made.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={!complete || busy}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save evaluation'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
        </div>
        {!complete && <p className="text-[11px] text-gray-500">Answer all five to save — a part-checked tasting is not an evaluation.</p>}
      </form>
    </div>
  );
}

export default function FlavorPanel() {
  const [sendResult, setSendResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(null); // the record awaiting a number
  const [scoring, setScoring] = useState(null); // the record awaiting its sensory evaluation
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { setCopied(false); }, [sendResult]);

  const sendForApproval = async (recordId, to) => {
    setSending(true); setSendResult(null);
    try { setSendResult(await apiPost(`/qms/flavor_approval/${recordId}/send`, to ? { to } : {})); }
    catch (e) { setSendResult({ error: e.message }); }
    finally { setSending(false); setPending(null); setRefreshKey(k => k + 1); }
  };

  const copy = () => {
    try { navigator.clipboard?.writeText(sendResult.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3">
      {scoring && (
        <SensoryModal record={scoring} onClose={() => setScoring(null)}
          onSaved={() => { setScoring(null); setRefreshKey(k => k + 1); }} />
      )}

      {pending && (
        <SendModal onClose={() => setPending(null)} sending={sending} record={pending}
          onSend={(to) => sendForApproval(pending.id, to)} />
      )}

      {sendResult && !sendResult.error && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 text-sm space-y-2">
          {sendResult.texted ? (
            <p className="text-green-800 font-medium flex items-center gap-1.5">
              <MessageSquare size={15} /> Texted to {prettyPhone(sendResult.sent_to)} — one tap approves or denies, no login.
            </p>
          ) : (
            <p className="text-green-800 font-medium">Approval link ready — send it from any phone. One tap approves or denies, no login needed.</p>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 break-all">{sendResult.link}</code>
            <button onClick={copy} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-white border border-green-200 rounded-lg text-xs font-medium text-green-700 hover:bg-green-100">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {!sendResult.sms_configured && (
            <p className="text-[11px] text-green-700/70">Auto-texting turns on once Twilio is configured (the TWILIO_* env vars).</p>
          )}
          {sendResult.sms_error && <p className="text-[11px] text-amber-700">Text failed ({sendResult.sms_error}) — copy the link and send it manually.</p>}
        </div>
      )}
      {sendResult?.error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{sendResult.error}</div>}

      <QMSRecordsPanel key={refreshKey} recordType="flavor_approval" moduleId="flavor-approvals"
        rowAction={[
          {
            // THE EVALUATION COMES FIRST, so it is the only button offered until
            // it exists. Two buttons side by side would let somebody send an
            // unrated batch and only find out from a server error.
            label: 'Record evaluation',
            icon: ClipboardList,
            show: (r) => r.status === 'pending' && !sensoryComplete(r),
            run: (r) => { setSendResult(null); setScoring(r); },
          },
          {
            label: 'Text for approval',
            icon: Send,
            show: (r) => r.status === 'pending' && sensoryComplete(r),
            // Opens the picker rather than sending blind — the whole point is
            // that the approver is chosen, and recorded, per request.
            // The whole record, not just its id: the modal shows which number
            // this approval was last texted to.
            run: (r) => { setSendResult(null); setPending(r); },
          },
        ]} />
    </div>
  );
}
