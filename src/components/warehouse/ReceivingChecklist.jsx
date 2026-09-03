import { useState, useEffect, useCallback } from 'react';
import { useApiGet, apiPost, apiFetch } from '../../hooks/useApi';
import {
  ClipboardCheck, X, AlertTriangle, BellRing, Check, CheckCircle2, RotateCcw, Plus, Trash2,
} from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';

/**
 * FORM 204-01 — the Receiving Inspection Checklist, on the dock.
 *
 * The reason this is in the app rather than on a clipboard is the escalations.
 * Nine of the eighteen lines end in "*If YES, notify Adam or QA" or "*If NO,
 * inform purchasing", and on paper that instruction depends on the receiver
 * walking off the dock to find somebody — which happens when the truck is not
 * waiting and does not when it is. Here the answer that triggers it puts the
 * button in front of them, pressing it reaches the person wherever they are,
 * and the record afterwards says who was told and when.
 *
 * ANSWERS SAVE AS THEY ARE TAPPED. This is filled in standing next to a truck
 * on a phone; a form you have to remember to submit is a form that loses a
 * delivery's worth of checks when someone walks into the cold store.
 *
 * The questions are not editable here — changing what a receiving inspection
 * asks is a Document Change Request, same as a scale tolerance.
 */

const ANSWER_STYLE = {
  yes: 'bg-green-600 text-white border-green-600',
  no: 'bg-red-600 text-white border-red-600',
  na: 'bg-gray-500 text-white border-gray-500',
};
const ANSWER_LABEL = { yes: 'Yes', no: 'No', na: 'N/A' };

export function AnswerButtons({ value, onPick, disabled }) {
  return (
    <div className="flex gap-1 shrink-0">
      {['yes', 'no', 'na'].map(a => (
        <button key={a} type="button" disabled={disabled} onClick={() => onPick(a)}
          className={`px-2.5 py-1.5 rounded-md text-xs font-bold border min-w-[44px] disabled:opacity-50 ${
            value === a ? ANSWER_STYLE[a] : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {ANSWER_LABEL[a]}
        </button>
      ))}
    </div>
  );
}

export function Item({ item, value, sent, onAnswer, onNotify, notifying, locked }) {
  // The escalation now SENDS ITSELF when the answer that fires it is tapped —
  // so the "*If YES, notify Adam…" instruction is no longer rendered (the app
  // performs it), and the amber prompt only appears when the automatic send
  // could not reach anyone. Plain instruction notes (seal, allergen placards,
  // paperwork) still render: those tell the receiver to DO something the app
  // can't do for them.
  const triggered = item.notify && value === item.notify.answer;
  return (
    <div className={`px-3 py-2.5 border-b border-gray-100 last:border-0 ${triggered && !sent ? 'bg-amber-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-900">{item.text}</p>
          {item.note && <p className="text-[11px] text-gray-500 mt-0.5">*{item.note}</p>}
        </div>
        <AnswerButtons value={value} onPick={(a) => onAnswer(item.key, a)} disabled={locked} />
      </div>

      {triggered && !sent && !locked && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-amber-900 font-medium flex items-center gap-1">
            <AlertTriangle size={13} /> {item.notify.target_label || 'Someone'} needs to know — the automatic message didn't go through.
          </span>
          <button type="button" onClick={() => onNotify(item)} disabled={notifying === item.key}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50">
            <BellRing size={13} /> {notifying === item.key ? 'Sending…' : `Send to ${item.notify.target_label || 'them'}`}
          </button>
        </div>
      )}

      {sent && (
        <p className="mt-1.5 text-[11px] text-green-800 flex items-center gap-1">
          <Check size={12} /> Told {sent.to.join(', ')} — {formatDateTime(sent.at)}{sent.auto ? ' · sent automatically' : ''}
        </p>
      )}
    </div>
  );
}

/** The form's NOTES table: part #, description, and what was wrong with it. */
export function ItemNotes({ rows, onChange, locked }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_2fr_auto] gap-1.5 items-center">
          {['part_number', 'description', 'issue'].map((k, j) => (
            <input key={k} value={r[k] || ''} disabled={locked}
              onChange={e => set(i, k, e.target.value)}
              placeholder={['Part #', 'Item description', 'Issues / notes'][j]}
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50" />
          ))}
          <button type="button" disabled={locked} onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="text-gray-400 hover:text-red-600 disabled:opacity-40 px-1"><Trash2 size={14} /></button>
        </div>
      ))}
      {!locked && (
        <button type="button" onClick={() => onChange([...rows, { part_number: '', description: '', issue: '' }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-powder-700 hover:underline">
          <Plus size={13} /> Add a line
        </button>
      )}
    </div>
  );
}

export default function ReceivingChecklist({ inspectionNo, onClose, onAddLine }) {
  const { data, refresh } = useApiGet(`/receiving/checklist/${encodeURIComponent(inspectionNo)}`, [inspectionNo]);
  const [answers, setAnswers] = useState({});
  const [header, setHeader] = useState({});
  const [notes, setNotes] = useState([]);
  const [notifying, setNotifying] = useState(null);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(null);
  const [busy, setBusy] = useState(false);

  const cl = data?.checklist;
  const form = data?.form;
  const locked = !!cl?.reviewed_at;

  // Seed local state once the record arrives, and again after a refresh — the
  // server is the authority on what has been saved.
  useEffect(() => {
    if (!data) return;
    setAnswers(cl?.answers || {});
    setNotes(cl?.item_notes || []);
    setHeader(Object.fromEntries((form?.header || []).map(h => [h.key, cl?.[h.key] ?? ''])));
  }, [data, cl, form]);

  const save = useCallback(async (patch) => {
    setError('');
    try { await apiPost('/receiving/checklist', { inspection_no: inspectionNo, ...patch }); }
    catch (e) { setError(e.message); }
  }, [inspectionNo]);

  // Tapping an answer writes it immediately — see the note at the top.
  const answer = async (key, val) => {
    const next = { ...answers, [key]: val };
    setAnswers(next);
    await save({ answers: { [key]: val } });
    refresh();
  };

  const notify = async (item) => {
    setNotifying(item.key); setError('');
    try {
      await apiPost(`/receiving/checklist/${encodeURIComponent(inspectionNo)}/notify`, { item: item.key });
      refresh();
    } catch (e) { setError(e.message); }
    finally { setNotifying(null); }
  };

  const signOff = async () => {
    setBusy(true); setError(''); setBlocked(null);
    try {
      await apiPost(`/receiving/checklist/${encodeURIComponent(inspectionNo)}/review`,
        { system_status: header.system_status });
      refresh();
    } catch (e) {
      // The server names exactly what is missing; show that rather than a
      // generic refusal the receiver has to go hunting behind.
      setError(e.message);
      setBlocked(e.message);
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch(`/receiving/checklist/${encodeURIComponent(inspectionNo)}/review`, { method: 'DELETE' });
      refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const sentFor = (key) => (cl?.notifications || []).filter(n => n.item === key).slice(-1)[0] || null;
  const outstanding = (cl?.escalations || []).filter(e => !sentFor(e.key));

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full max-w-2xl h-full flex flex-col shadow-xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck size={18} className="text-powder-600" /> {form?.title || 'Receiving Inspection Checklist'}
            </h3>
            <p className="text-xs text-gray-500">
              {inspectionNo}
              {form ? ` · ${form.form_code} ${form.revision}` : ''}
              {data?.lines?.length ? ` · ${data.lines.length} line${data.lines.length === 1 ? '' : 's'} on this receipt` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!data ? <p className="p-4 text-sm text-gray-400">Loading…</p> : (
            <>
              {locked && (
                <div className="m-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-green-900 flex items-center gap-1.5">
                    <CheckCircle2 size={15} /> Reviewed by {cl.reviewed_by}
                  </p>
                  <p className="text-xs text-green-800">{formatDateTime(cl.reviewed_at)}
                    {cl.system_status ? ` · ${cl.system_status}` : ''}</p>
                </div>
              )}

              {/* Header block, matching the top of the paper form. */}
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-b border-gray-100">
                {(form?.header || []).map(h => (
                  <label key={h.key} className="block">
                    <span className="text-[11px] font-medium text-gray-600">{h.label}</span>
                    <input type={h.type === 'number' ? 'number' : 'text'} step="any"
                      value={header[h.key] ?? ''} disabled={locked}
                      onChange={e => setHeader(v => ({ ...v, [h.key]: e.target.value }))}
                      onBlur={e => save({ [h.key]: e.target.value })}
                      className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50" />
                  </label>
                ))}
              </div>

              {(form?.sections || []).map(section => (
                <div key={section.key}>
                  <p className="px-3 py-1.5 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-600 border-y border-gray-100">
                    {section.title}
                  </p>
                  {/* The DATA ENTRY section is the step where the items go into
                      the ERP and then into ReadyDoc, so the lines filed against
                      this inspection belong here — right beside the question
                      that asks whether they were entered. Answering
                      "Receiving information entered into system?" without being
                      able to see what was entered is guesswork. */}
                  {section.key === 'data_entry' && (
                    <div className="px-3 py-2.5 bg-blue-50/60 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-700 mb-1">
                        Receiving lines on this inspection ({data.lines.length})
                      </p>
                      {data.lines.length === 0 ? (
                        <p className="text-xs text-gray-500 mb-1.5">
                          None yet. Enter the items in the ERP, then file them here.
                        </p>
                      ) : (
                        <ul className="space-y-0.5 mb-1.5">
                          {data.lines.map(l => (
                            <li key={l.id} className="text-xs text-gray-700">
                              <span className="font-medium">{l.part_number}</span>
                              {l.part_description ? ` — ${l.part_description}` : ''}
                              {l.quantity_received != null ? ` · ${l.quantity_received} ${l.uom || ''}`.trimEnd() : ''}
                              {l.vendor_lot ? ` · Lot ${l.vendor_lot}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {!locked && (
                        <button type="button" onClick={() => onAddLine?.(inspectionNo)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-powder-700 hover:underline">
                          <Plus size={12} /> Add a receiving line to {inspectionNo}
                        </button>
                      )}
                    </div>
                  )}
                  {section.items.map(item => (
                    <Item key={item.key} item={item} value={answers[item.key]} sent={sentFor(item.key)}
                      onAnswer={answer} onNotify={notify} notifying={notifying} locked={locked} />
                  ))}
                </div>
              ))}

              <div className="p-3 space-y-2 border-t border-gray-100">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600">Notes</p>
                <ItemNotes rows={notes} locked={locked}
                  onChange={(rows) => { setNotes(rows); save({ item_notes: rows }); }} />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 p-3 space-y-2">
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
          {!locked && outstanding.length > 0 && !blocked && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              {outstanding.length} escalation{outstanding.length === 1 ? '' : 's'} still to send before this can be signed off.
            </p>
          )}
          {!locked && cl && (
            <p className="text-xs text-gray-500">
              {cl.unanswered?.length
                ? `${cl.unanswered.length} question${cl.unanswered.length === 1 ? '' : 's'} still blank.`
                : 'All questions answered.'}
            </p>
          )}
          <div className="flex items-center gap-2">
            {locked ? (
              <button onClick={revoke} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50">
                <RotateCcw size={14} /> Revoke sign-off to correct
              </button>
            ) : (
              <button onClick={signOff} disabled={busy || !cl}
                className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {busy ? 'Saving…' : 'Packet reviewed — sign off'}
              </button>
            )}
            <span className="text-[11px] text-gray-400 ml-auto">Answers save as you tap them.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
