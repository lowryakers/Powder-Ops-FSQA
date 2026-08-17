import { useState, useEffect, useRef } from 'react';
import { useApiGet, apiPost, apiFetch, apiUpload } from '../../hooks/useApi';
import {
  ScanLine, X, CheckCircle2, XCircle, RotateCcw, Plus, Camera, Trash2, AlertTriangle,
} from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';

/**
 * FORM 418-01 — the QA Film/Pouch Inspection Checklist, at the pallet.
 *
 * ONE SHEET PER FLAVOUR. The paper says so and it is the record's identity: a
 * delivery is routinely several flavours of film on one PO, and one sheet
 * covering the pallet could not record that flavour three was rejected while
 * the rest were fine.
 *
 * ANSWERS SAVE AS THEY ARE TAPPED, same as FORM 204-01 — this is filled in on a
 * phone next to a pallet, and a form you have to remember to submit loses a
 * delivery's worth of checks when someone walks off to find a flashlight.
 *
 * NOTHING IS AUTO-GRADED. The form mixes lines that are good when YES ("Roll
 * tightness acceptable") with lines that are good when NO ("Material - Unusual
 * odor present") and never states which is which, so the app shows the answers
 * that stood out and QA records the ACCEPTED / REJECTED themselves — exactly as
 * the paper has them circle it.
 */

const ANSWER_STYLE = {
  yes: 'bg-green-600 text-white border-green-600',
  no: 'bg-red-600 text-white border-red-600',
  na: 'bg-gray-500 text-white border-gray-500',
};
const ANSWER_LABEL = { yes: 'Yes', no: 'No', na: 'N/A' };

function AnswerButtons({ value, onPick, disabled }) {
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

/** The two CIRCLE ONE rows, rendered inline under the item they belong to. */
function CircleOne({ label, options, value, onPick, disabled }) {
  return (
    <div className="mt-1.5">
      {/* the paper says "circle one"; on a screen it's tap one */}
      <p className="text-[11px] font-medium text-gray-600 mb-1">{label} — tap one</p>
      <div className="flex flex-wrap gap-1">
        {options.map(o => (
          <button key={o} type="button" disabled={disabled} onClick={() => onPick(o)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold border disabled:opacity-50 ${
              value === o ? 'bg-powder-600 text-white border-powder-600'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FilmPouchInspection({ id, onClose, canInspect }) {
  const { data, refresh } = useApiGet(`/film-inspection/${id}`, [id]);
  const [answers, setAnswers] = useState({});
  const [header, setHeader] = useState({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const rec = data?.inspection;
  const form = data?.form;
  const locked = !!rec?.reviewed_at || !canInspect;

  useEffect(() => {
    if (!data) return;
    setAnswers(rec?.answers || {});
    setNotes(rec?.issue_notes || '');
    // wind_direction and film_width are NOT in form.header (they render as the
    // pick-one rows), so seeding from header alone dropped them — a tapped
    // value SAVED but the refresh wiped the highlight, which read as "you
    // can't select one". Seed them explicitly.
    setHeader({
      ...Object.fromEntries((form?.header || []).map(h => [h.key, rec?.[h.key] ?? ''])),
      wind_direction: rec?.wind_direction ?? '',
      film_width: rec?.film_width ?? '',
    });
  }, [data, rec, form]);

  // Not memoized: it is only ever called from event handlers, never from an
  // effect's dependency list, and useCallback over optional-chained fields is
  // memoization the React compiler cannot preserve anyway.
  const save = async (patch) => {
    setError('');
    try {
      // Addressed by id: the sheet may be renaming its own flavor (a draft
      // born from the receiving escalation starts blank), and addressing by
      // (number, flavor) during a rename would create a second sheet.
      await apiPost('/film-inspection', {
        id: rec?.id, inspection_no: rec?.inspection_no, flavor: rec?.flavor, ...patch,
      });
    } catch (e) { setError(e.message); }
  };

  const answer = async (key, val) => {
    setAnswers(a => ({ ...a, [key]: val }));
    await save({ answers: { [key]: val } });
    refresh();
  };

  const pickCircle = async (col, val) => {
    // Tap to pick, tap again to clear a mis-tap.
    const next = header[col] === val ? '' : val;
    setHeader(h => ({ ...h, [col]: next }));
    await save({ [col]: next });
    refresh();
  };

  const decide = async (decision) => {
    setBusy(true); setError('');
    try {
      await apiPost(`/film-inspection/${id}/review`, { decision, issue_notes: notes });
      refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true); setError('');
    try { await apiFetch(`/film-inspection/${id}/review`, { method: 'DELETE' }); refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const addPhotos = async (files) => {
    if (!files?.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      await apiUpload(`/film-inspection/${id}/photos`, fd);
      refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const removePhoto = async (photoId) => {
    setError('');
    try { await apiFetch(`/film-inspection/photos/${photoId}`, { method: 'DELETE' }); refresh(); }
    catch (e) { setError(e.message); }
  };

  // The CIRCLE ONE values belong to two specific items; rendered under them so
  // the fact and the judgement about it stay together.
  const circleFor = (key) => {
    if (key === 'wind_direction_correct') {
      return { label: 'Wind direction', col: 'wind_direction', options: form?.wind_directions || [] };
    }
    if (key === 'width_matches_machine') {
      return { label: 'Film width', col: 'film_width', options: form?.film_widths || [] };
    }
    return null;
  };

  const exNo = rec?.exceptions?.no || [];

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full max-w-2xl h-full flex flex-col shadow-xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ScanLine size={18} className="text-powder-600" /> {form?.title || 'Film/Pouch Inspection'}
            </h3>
            <p className="text-xs text-gray-500">
              {rec?.inspection_no} · <span className="font-semibold text-gray-700">{rec?.flavor || '(no flavor)'}</span>
              {form ? ` · ${form.form_code} ${rec?.checklist_revision || form.revision}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!data ? <p className="p-4 text-sm text-gray-400">Loading…</p> : (
            <>
              {rec.reviewed_at && (
                <div className={`m-3 rounded-lg border px-3 py-2.5 ${rec.decision === 'accepted'
                  ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                  <p className={`text-sm font-semibold flex items-center gap-1.5 ${
                    rec.decision === 'accepted' ? 'text-green-900' : 'text-red-900'}`}>
                    {rec.decision === 'accepted' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    {form?.decisions?.[rec.decision] || rec.decision}
                  </p>
                  <p className={`text-xs ${rec.decision === 'accepted' ? 'text-green-800' : 'text-red-800'}`}>
                    {rec.reviewed_by} · {formatDateTime(rec.reviewed_at)}
                  </p>
                  {rec.issue_notes && <p className="text-xs text-gray-700 mt-1 whitespace-pre-line">{rec.issue_notes}</p>}
                </div>
              )}

              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-b border-gray-100">
                {(form?.header || []).map(h => (
                  <label key={h.key} className="block">
                    <span className="text-[11px] font-medium text-gray-600">{h.label}</span>
                    {/* The inspection # is the delivery's identity — shown, never
                        edited, because changing it moves the sheet onto another
                        delivery. FLAVOR is editable until sign-off: a draft
                        created by the packaging escalation starts blank, and a
                        flavorless item (a coffee acid reducer) legitimately
                        stays blank. Renaming is guarded server-side against
                        colliding with another flavor's sheet. */}
                    <input
                      type={h.type === 'number' ? 'number' : h.type === 'date' ? 'date' : 'text'}
                      step={h.type === 'number' ? 'any' : undefined}
                      value={h.key === 'inspection_no' ? (rec?.inspection_no || '') : (header[h.key] ?? '')}
                      disabled={locked || h.key === 'inspection_no'}
                      placeholder={h.key === 'flavor' ? 'Blank if unflavored' : undefined}
                      onChange={e => setHeader(v => ({ ...v, [h.key]: e.target.value }))}
                      onBlur={e => { save({ [h.key]: e.target.value }); if (h.key === 'flavor') refresh(); }}
                      className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50" />
                  </label>
                ))}
              </div>

              {(form?.sections || []).map(section => (
                <div key={section.key}>
                  <p className="px-3 py-1.5 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-600 border-y border-gray-100">
                    {section.title}
                    {section.note && <span className="ml-2 font-normal normal-case tracking-normal text-gray-500">{section.note}</span>}
                  </p>
                  {section.items.map(item => {
                    const circle = circleFor(item.key);
                    return (
                      <div key={item.key} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900">{item.text}</p>
                            {item.note && <p className="text-[11px] text-gray-500 mt-0.5">{item.note}</p>}
                          </div>
                          <AnswerButtons value={answers[item.key]} onPick={a => answer(item.key, a)} disabled={locked} />
                        </div>
                        {circle && (
                          <CircleOne label={circle.label} options={circle.options} disabled={locked}
                            value={header[circle.col]} onPick={v => pickCircle(circle.col, v)} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* The form's failure instruction, kept verbatim, with the notes
                  box and the photos it asks for directly under it. */}
              <div className="p-3 space-y-2 border-t border-gray-100">
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  {form?.failure_instruction}
                </p>
                <textarea value={notes} rows={3} disabled={locked}
                  onChange={e => setNotes(e.target.value)}
                  onBlur={e => save({ issue_notes: e.target.value })}
                  placeholder="Issues found — what, where, and on how many rolls"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50" />

                <div className="flex flex-wrap gap-2">
                  {(data.photos || []).map(p => (
                    <div key={p.id} className="relative">
                      {p.url
                        ? <img src={p.url} alt={p.filename} className="h-24 w-24 object-cover rounded-md border border-gray-200" />
                        : <div className="h-24 w-24 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center text-[10px] text-gray-500 p-1 text-center">{p.filename}</div>}
                      {!locked && (
                        <button type="button" onClick={() => removePhoto(p.id)}
                          className="absolute -top-1.5 -right-1.5 bg-white border border-gray-300 rounded-full p-0.5 text-gray-500 hover:text-red-600">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  {!locked && (
                    <>
                      {/* capture="environment" so a phone opens the camera — this
                          is filled in standing at the pallet. */}
                      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple
                        className="hidden" onChange={e => addPhotos(Array.from(e.target.files || []))} />
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                        className="h-24 w-24 rounded-md border-2 border-dashed border-gray-300 text-gray-500 hover:border-powder-400 hover:text-powder-700 flex flex-col items-center justify-center gap-1 text-[11px] disabled:opacity-50">
                        <Camera size={18} /> Add photo
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 p-3 space-y-2">
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
          {!locked && rec && (
            <>
              <p className="text-xs text-gray-500">
                {rec.unanswered?.length
                  ? `${rec.unanswered.length} question${rec.unanswered.length === 1 ? '' : 's'} still blank.`
                  : 'All questions answered.'}
              </p>
              {/* An aid to the decision, never the decision — see the note at
                  the top. The form does not say which answers are failures, so
                  neither does the app. */}
              {exNo.length > 0 && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />
                  Answered <strong>No</strong>: {exNo.map(e => e.text).join('; ')}
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {rec?.reviewed_at ? (
              canInspect && (
                <button onClick={revoke} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50">
                  <RotateCcw size={14} /> Revoke sign-off to correct
                </button>
              )
            ) : canInspect ? (
              <>
                <button onClick={() => decide('accepted')} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  <CheckCircle2 size={15} /> Accept — release to warehouse
                </button>
                <button onClick={() => decide('rejected')} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  <XCircle size={15} /> Reject — notify Admin
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-500">QA signs this inspection off.</p>
            )}
            {!locked && <span className="text-[11px] text-gray-400 ml-auto">Answers save as you tap them.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The list — a tab on the Receiving module, because that is where the delivery
 * is even though the work is QA's.
 *
 * Anyone who can see Receiving can READ these: the warehouse needs to know
 * whether QA has cleared the packaging before they put it away, and that
 * question having no answer in the app is why this form was living in a chat
 * channel. Only QA can start or sign one.
 */
export function FilmInspectionsTab({ canInspect, onOpen }) {
  const { data: rows, refresh } = useApiGet('/film-inspection');
  const [flavor, setFlavor] = useState('');
  const [inspectionNo, setInspectionNo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiPost('/film-inspection', {
        flavor: flavor.trim(), ...(inspectionNo.trim() ? { inspection_no: inspectionNo.trim() } : {}),
      });
      setFlavor(''); setInspectionNo('');
      refresh();
      onOpen(r.id);
    } catch (e) { setError(e.message || 'Could not start the inspection.'); }
    finally { setBusy(false); }
  };

  const open = (rows || []).filter(r => !r.reviewed_at);
  const done = (rows || []).filter(r => r.reviewed_at);

  const Card = ({ r }) => {
    const pct = r.total ? Math.round((r.answered / r.total) * 100) : 0;
    return (
      <button type="button" onClick={() => onOpen(r.id)}
        className="w-full text-left bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-powder-300 hover:bg-powder-50/40">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm">
              {r.flavor || '(no flavor)'}
              <span className="font-normal text-gray-500"> · {r.inspection_no}</span>
              {r.vendor ? <span className="font-normal text-gray-500"> · {r.vendor}</span> : ''}
            </p>
            <p className="text-xs text-gray-500">
              {r.inspection_date || '—'} · {r.qa_lead || 'unassigned'}
              {r.roll_count != null ? ` · ${r.roll_count} roll${r.roll_count === 1 ? '' : 's'}` : ''}
              {r.vendor_lot ? ` · Lot ${r.vendor_lot}` : ''}
            </p>
          </div>
          <div className="shrink-0">
            {r.reviewed_at ? (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                r.decision === 'accepted' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {r.decision === 'accepted' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                {r.decision === 'accepted' ? 'Accepted' : 'Rejected'}
              </span>
            ) : (
              <span className="text-[11px] text-gray-500 tabular-nums">{r.answered}/{r.total} answered</span>
            )}
          </div>
        </div>
        {!r.reviewed_at && (
          <div className="mt-1.5 h-1 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full ${pct === 100 ? 'bg-green-500' : 'bg-powder-500'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="bg-powder-50 border border-powder-200 rounded-lg px-3 py-2.5">
        <p className="text-xs text-powder-900">
          QA inspects film and pouches <strong>before</strong> the warehouse receives them — this is the
          inspection FORM 204-01 escalates to when a delivery is packaging. One sheet per flavor.
        </p>
      </div>

      {canInspect && (
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Start an inspection</p>
          <div className="flex flex-wrap gap-2">
            <input value={flavor} onChange={e => setFlavor(e.target.value)} placeholder="Flavor — blank if unflavored"
              className="flex-1 min-w-[10rem] px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
            <input value={inspectionNo} onChange={e => setInspectionNo(e.target.value)}
              placeholder="Inspection # (blank = issue a new one)"
              className="flex-1 min-w-[10rem] px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
            <button type="button" onClick={start} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white rounded-md text-sm font-medium disabled:opacity-50">
              <Plus size={14} /> Start
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">
            Several flavors on one delivery share an inspection # — put the same number on each sheet.
          </p>
          {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
        </div>
      )}

      {!rows ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">In progress ({open.length})</p>
            {open.length === 0 ? <p className="text-sm text-gray-400">Nothing open.</p>
              : open.map(r => <Card key={r.id} r={r} />)}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Signed off ({done.length})</p>
            {done.length === 0 ? <p className="text-sm text-gray-400">None yet.</p>
              : done.map(r => <Card key={r.id} r={r} />)}
          </div>
        </>
      )}
    </div>
  );
}
