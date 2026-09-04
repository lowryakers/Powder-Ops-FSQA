import { useState, useEffect, useCallback } from 'react';
import { useApiGet, apiPost, apiFetch, apiUpload } from '../../hooks/useApi';
import {
  Truck, X, CheckCircle2, RotateCcw, Trash2, AlertTriangle, ImageIcon, ExternalLink,
} from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';
import { Item, ItemNotes } from './ReceivingChecklist.jsx';
import PhotoPicker from '../common/PhotoPicker.jsx';

/**
 * The Shipping Truck Inspection — FORM 204-01's outbound twin, on the dock
 * when a shipment LEAVES.
 *
 * `Item` and `ItemNotes` are the receiving checklist's own, imported rather
 * than copied: an answer button, an escalation prompt and a notes row must
 * behave identically whichever way the truck faces, or the dock learns two
 * forms. What is new here is the photo strip — the photographs of the load
 * before the doors close, which are the evidence the form exists to produce —
 * and the draft banner, because this checklist has no controlled form number
 * yet and every record says so.
 */

function Photos({ inspection, shipmentNo, locked, storageEnabled, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const photos = inspection?.photos || [];

  const add = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('photos', f);
    setBusy(true); setError('');
    try { await apiUpload(`/shipping/inspection/${encodeURIComponent(shipmentNo)}/photos`, fd); onChanged(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const open = async (p) => {
    try {
      const { url } = await apiFetch(`/shipping/photos/${p.id}/url`);
      if (url) window.open(url, '_blank');
    } catch (err) { setError(err.message); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.filename}?`)) return;
    try { await apiFetch(`/shipping/photos/${p.id}`, { method: 'DELETE' }); onChanged(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div className="p-3 space-y-2 border-t border-gray-100" data-photos>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
          <ImageIcon size={13} /> Photos of the load ({photos.length})
        </p>
        {/* Two doors: the camera for the load in front of you, the camera
            roll for the picture already taken. One input with `capture`
            cannot offer both — on iOS it opens only the camera. */}
        {!locked && storageEnabled && <PhotoPicker name="load" onChange={add} busy={busy} />}
      </div>
      {!storageEnabled && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          File storage is not configured on this server, so photos cannot be attached here yet.
        </p>
      )}
      {photos.length === 0 ? (
        <p className="text-xs text-gray-500">
          None yet. Photograph the loaded product before the doors close — the record is only as good as its pictures.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {photos.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5">
              <button type="button" onClick={() => open(p)}
                className="min-w-0 text-left text-xs text-powder-700 hover:underline flex items-center gap-1.5">
                <ExternalLink size={11} className="shrink-0" />
                <span className="truncate">{p.filename}</span>
              </button>
              <span className="text-[10px] text-gray-400 shrink-0">{p.uploaded_by} · {formatDateTime(p.uploaded_at)}</span>
              {!locked && (
                <button type="button" onClick={() => remove(p)} title="Remove" className="text-gray-400 hover:text-red-600 shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export default function ShippingChecklist({ shipmentNo, onClose }) {
  const { data, refresh } = useApiGet(`/shipping/inspection/${encodeURIComponent(shipmentNo)}`, [shipmentNo]);
  const [answers, setAnswers] = useState({});
  const [header, setHeader] = useState({});
  const [notes, setNotes] = useState([]);
  const [notifying, setNotifying] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const insp = data?.inspection;
  const form = data?.form;
  const locked = !!insp?.reviewed_at;

  useEffect(() => {
    if (!data) return;
    setAnswers(insp?.answers || {});
    setNotes(insp?.item_notes || []);
    setHeader(Object.fromEntries((form?.header || []).map(h => [h.key, insp?.[h.key] ?? ''])));
  }, [data, insp, form]);

  const save = useCallback(async (patch) => {
    setError('');
    try { await apiPost('/shipping/inspection', { shipment_no: shipmentNo, ...patch }); }
    catch (e) { setError(e.message); }
  }, [shipmentNo]);

  const answer = async (key, val) => {
    const next = { ...answers, [key]: val };
    setAnswers(next);
    await save({ answers: { [key]: val } });
    refresh();
  };

  const notify = async (item) => {
    setNotifying(item.key); setError('');
    try {
      await apiPost(`/shipping/inspection/${encodeURIComponent(shipmentNo)}/notify`, { item: item.key });
      refresh();
    } catch (e) { setError(e.message); }
    finally { setNotifying(null); }
  };

  const signOff = async () => {
    setBusy(true); setError('');
    try { await apiPost(`/shipping/inspection/${encodeURIComponent(shipmentNo)}/review`, {}); refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError('');
    try { await apiFetch(`/shipping/inspection/${encodeURIComponent(shipmentNo)}/review`, { method: 'DELETE' }); refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const sentFor = (key) => (insp?.notifications || []).filter(n => n.item === key).slice(-1)[0] || null;
  const outstanding = (insp?.escalations || []).filter(e => !sentFor(e.key));

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full max-w-2xl h-full flex flex-col shadow-xl" data-shipping-checklist>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Truck size={18} className="text-powder-600" /> {form?.title || 'Shipping Truck Inspection'}
            </h3>
            <p className="text-xs text-gray-500">
              {shipmentNo}{form ? ` · ${form.form_code || 'no form number yet'} · ${form.revision}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!data ? <p className="p-4 text-sm text-gray-400">Loading…</p> : (
            <>
              {/* A draft checklist must say so on every record — an auditor
                  reading it later is told it predates the issued form rather
                  than left to assume it matches one. */}
              {form?.note && (
                <p className="m-3 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5" data-draft-note>
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>{form.note}</span>
                </p>
              )}
              {locked && (
                <div className="m-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-green-900 flex items-center gap-1.5">
                    <CheckCircle2 size={15} /> Released by {insp.reviewed_by}
                  </p>
                  <p className="text-xs text-green-800">{formatDateTime(insp.reviewed_at)}</p>
                </div>
              )}

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
                  {section.items.map(item => (
                    <Item key={item.key} item={item} value={answers[item.key]} sent={sentFor(item.key)}
                      onAnswer={answer} onNotify={notify} notifying={notifying} locked={locked} />
                  ))}
                  {/* The photos sit right under the question that asks for them. */}
                  {section.key === 'load' && (
                    <Photos inspection={insp} shipmentNo={shipmentNo} locked={locked}
                      storageEnabled={!!form?.storage_enabled} onChanged={refresh} />
                  )}
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
          {!locked && outstanding.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              {outstanding.length} escalation{outstanding.length === 1 ? '' : 's'} still to send before this can be released.
            </p>
          )}
          {!locked && insp?.photo_claim_unsupported && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-photo-claim>
              Marked as photographed, but no photos are attached yet.
            </p>
          )}
          {!locked && insp && (
            <p className="text-xs text-gray-500">
              {insp.unanswered?.length
                ? `${insp.unanswered.length} question${insp.unanswered.length === 1 ? '' : 's'} still blank.`
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
              <button onClick={signOff} disabled={busy || !insp}
                className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {busy ? 'Saving…' : 'Truck inspected — release shipment'}
              </button>
            )}
            <span className="text-[11px] text-gray-400 ml-auto">Answers save as you tap them.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Shipping tab: start an inspection, pick up one in progress. */
export function ShipmentsTab({ canLog, onOpen }) {
  const { data: rows, refresh } = useApiGet('/shipping/inspections');
  const { data: nextNo } = useApiGet('/shipping/next-shipment-no');
  const [starting, setStarting] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const start = async (shipment_no) => {
    setStarting(true); setError('');
    try {
      const s = await apiPost('/shipping/inspection', shipment_no ? { shipment_no } : {});
      setTyped('');
      refresh();
      onOpen(s.shipment_no);
    } catch (e) { setError(e.message || 'Could not start the inspection.'); }
    finally { setStarting(false); }
  };

  const open = (rows || []).filter(r => !r.reviewed_at);
  const done = (rows || []).filter(r => r.reviewed_at);

  const Card = ({ r }) => {
    const pct = r.total ? Math.round((r.answered / r.total) * 100) : 0;
    return (
      <button type="button" onClick={() => onOpen(r.shipment_no)} data-shipment={r.shipment_no}
        className="w-full text-left bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-powder-300 hover:bg-powder-50/40">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm">
              {r.shipment_no}
              {r.customer ? <span className="font-normal text-gray-500"> · {r.customer}</span> : ''}
              {r.bol_number ? <span className="font-normal text-gray-500"> · BOL {r.bol_number}</span> : ''}
            </p>
            <p className="text-xs text-gray-500">
              {r.ship_date || '—'} · {r.inspector || 'unassigned'}
              {' · '}{r.photo_count} photo{r.photo_count === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {r.escalations_outstanding > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
                <AlertTriangle size={11} /> {r.escalations_outstanding} to notify
              </span>
            )}
            {r.reviewed_at ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[11px] font-semibold">
                <CheckCircle2 size={11} /> Released
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
    <div className="space-y-4">
      {canLog && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Truck size={16} className="text-powder-600" /> Start a shipping inspection
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Work the truck before it is loaded, photograph the load before the doors close, then release it.
              The number is issued here and goes on the BOL.
            </p>
          </div>
          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={starting} onClick={() => start(null)} data-start-shipment
              className="px-3 py-2 rounded-lg bg-powder-600 text-white text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              {starting ? 'Starting…' : `Start ${nextNo?.shipment_no || 'a new inspection'}`}
            </button>
            <span className="text-xs text-gray-400">or</span>
            <input value={typed} onChange={e => setTyped(e.target.value)}
              placeholder="Number already on a paper form"
              className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm w-56" />
            <button type="button" disabled={starting || !typed.trim()} onClick={() => start(typed.trim())}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-40">
              Open that one
            </button>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">In progress ({open.length})</h4>
        {open.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing open. Start one when a truck backs up to the dock.</p>
        ) : (
          <div className="space-y-1.5">{open.map(r => <Card key={r.id} r={r} />)}</div>
        )}
      </div>

      {done.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Released ({done.length})</h4>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">{done.map(r => <Card key={r.id} r={r} />)}</div>
        </div>
      )}
    </div>
  );
}
