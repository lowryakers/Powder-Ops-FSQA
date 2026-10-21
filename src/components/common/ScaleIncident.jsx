// A scale dropped or damaged (D-194): the caution printed on every scale form,
// the out-of-service banner, the report form, and the open incidents on the
// Calibration screen. The rules live in shared/scale-incident.js and the
// server; this renders what it is given.

import { useState } from 'react';
import { AlertOctagon, AlertTriangle, ShieldCheck, ClipboardList } from 'lucide-react';
import { apiPost } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature.js';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { INCIDENT_KINDS, checkIncident } from '../../../shared/scale-incident.js';
import { DispositionForm, DispositionReadback, DispositionChip } from './ProductDisposition.jsx';

const docLine = (c) => (c?.document
  ? `${c.document}${c.revision ? ` ${c.revision}` : ''} — ${c.document_title}`
  : `${c?.document_title || 'Equipment Calibration'} SOP`);

/** The SOP's caution, on every scale form. Always open — it is one sentence. */
export function CautionBox({ caution, lang = 'en', compact = false }) {
  if (!caution?.text) return null;
  const text = lang === 'es' && caution.text_es ? caution.text_es : caution.text;
  return (
    <div data-scale-caution="" role="note"
      className={`flex items-start gap-2 rounded-xl border-2 border-red-300 bg-red-50 text-red-900 ${compact ? 'p-2.5 text-xs' : 'p-3 text-sm'}`}>
      <AlertOctagon size={compact ? 16 : 18} className="shrink-0 mt-0.5 text-red-600" />
      <div className="min-w-0">
        <span className="font-bold uppercase tracking-wide">{lang === 'es' ? 'Precaución' : (caution.title || 'Caution')}: </span>
        {text}
        <span className="block mt-1 text-[11px] text-red-700/80">{docLine(caution)}</span>
      </div>
    </div>
  );
}

/** Scales out of service right now — "do not use", where the check is run. */
export function OutOfServiceBanner({ scales }) {
  if (!scales?.length) return null;
  return (
    <div data-out-of-service="" className="rounded-xl border-2 border-red-500 bg-red-600 text-white p-3">
      <p className="font-bold flex items-center gap-1.5">
        <AlertTriangle size={16} /> OUT OF SERVICE — do not use
      </p>
      <ul className="mt-1 text-sm space-y-0.5">
        {scales.map(s => (
          <li key={s.id} data-out-of-service-scale={s.id}>
            {s.name}{s.asset_number ? ` #${s.asset_number}` : ''}{s.room ? ` · ${s.room}` : ''}
            {s.incident_label ? ` · ${s.incident_label.toLowerCase()} ${s.incident_at ? formatDateTime(s.incident_at) : ''}` : ''}
          </li>
        ))}
      </ul>
      <p className="text-xs text-red-100 mt-1">It returns to use only when QA/QC authorizes it after inspection and recalibration.</p>
    </div>
  );
}

// A datetime-local value for "now" in the browser's own zone.
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * Report a dropped or damaged scale. `submit(body)` does the network call —
 * the kiosk posts to the public path, the Calibration screen through apiPost.
 */
export function IncidentReportForm({ scales = [], caution, defaultName = '', defaultScaleId = '', submit, onDone, onCancel }) {
  const [v, setV] = useState({
    kind: 'dropped', instrument_id: defaultScaleId, scale_label: '', occurred_at: localNow(),
    reported_by: defaultName, description: '', lots_since: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, x) => setV(s => ({ ...s, [k]: x }));
  const send = async (e) => {
    e.preventDefault();
    const body = { ...v, occurred_at: v.occurred_at ? new Date(v.occurred_at).toISOString() : '' };
    const errs = checkIncident(body);
    if (errs.length) { setError(errs.join(' ')); return; }
    setSaving(true); setError('');
    try { const r = await submit(body); onDone?.(r); }
    catch (err) { setError(err.message || 'Could not file the report.'); }
    finally { setSaving(false); }
  };
  const field = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <form onSubmit={send} className="space-y-3" data-incident-form="">
      <CautionBox caution={caution} compact />
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">What happened?</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(INCIDENT_KINDS).map(([k, label]) => (
            <label key={k} className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${v.kind === k ? 'border-red-500 bg-red-50 font-semibold' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="incident-kind" value={k} checked={v.kind === k} onChange={() => set('kind', k)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="incident-scale" className="block text-sm font-medium text-gray-700 mb-1">Which scale?</label>
        <select id="incident-scale" value={v.instrument_id} onChange={e => set('instrument_id', e.target.value)} className={field}>
          <option value="">Not on this list / not sure</option>
          {scales.map(s => (
            <option key={s.id} value={s.id}>{s.name}{s.asset_number ? ` #${s.asset_number}` : ''}{s.room ? ` · ${s.room}` : ''}</option>
          ))}
        </select>
        {!v.instrument_id && (
          <input id="incident-scale-label" value={v.scale_label} onChange={e => set('scale_label', e.target.value)}
            placeholder="Describe the scale — asset tag, room" className={`${field} mt-2`} />
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="incident-when" className="block text-sm font-medium text-gray-700 mb-1">When did it happen?</label>
          <input id="incident-when" type="datetime-local" value={v.occurred_at} onChange={e => set('occurred_at', e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="incident-name" className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
          <input id="incident-name" value={v.reported_by} onChange={e => set('reported_by', e.target.value)} className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="incident-desc" className="block text-sm font-medium text-gray-700 mb-1">What you saw (optional)</label>
        <textarea id="incident-desc" rows={2} value={v.description} onChange={e => set('description', e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="incident-lots" className="block text-sm font-medium text-gray-700 mb-1">Product weighed on it since (optional)</label>
        <input id="incident-lots" value={v.lots_since} onChange={e => set('lots_since', e.target.value)}
          placeholder="MO / lot numbers, if you know them" className={field} />
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} data-incident-submit=""
          className="px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold disabled:opacity-50">
          {saving ? 'Filing…' : 'Take it out of service and tell QA'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm">Cancel</button>}
      </div>
    </form>
  );
}

function ProductControlSteps({ caution }) {
  const [open, setOpen] = useState(false);
  if (!caution?.product_control?.length) return null;
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen(o => !o)} className="font-semibold text-gray-700 underline" data-product-control-toggle="">
        {open ? 'Hide' : 'Show'} the product-control steps ({docLine(caution)})
      </button>
      {open && (
        <ol className="mt-1 space-y-1 list-decimal pl-5 text-gray-700">
          {caution.product_control.map(p => <li key={p.step}><b>{p.step}.</b> {p.text}</li>)}
        </ol>
      )}
    </div>
  );
}

function ReturnToUse({ incident, onChanged }) {
  const [inspection, setInspection] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const check = incident.return_check;
  const send = async () => {
    setSaving(true); setError('');
    try {
      await withSignature((extra) => apiPost(`/calibration/incidents/${incident.id}/return`, { inspection, ...extra }),
        { title: 'Authorize return to use', detail: incident.scale_label });
      onChanged?.();
    } catch (e) { if (!e.cancelled) setError(e.message || 'Could not return it to use.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="rounded-lg border border-green-200 bg-green-50/60 p-2.5 space-y-2" data-return-to-use={incident.id}>
      <p className="text-sm font-semibold text-gray-900 flex items-center gap-1"><ShieldCheck size={15} className="text-green-700" /> Authorize return to use</p>
      <p className="text-xs text-gray-600">
        {check
          ? <>Passing {check.kind === 'calibration' ? 'calibration' : 'verification'} on file since the incident: <b>{formatDateTime(check.at)}</b>.</>
          : <>No passing calibration or verification since the incident yet — recalibrate and verify the scale first.</>}
      </p>
      <textarea rows={2} value={inspection} onChange={e => setInspection(e.target.value)} data-return-inspection=""
        placeholder="What the inspection for damage found" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button type="button" onClick={send} disabled={saving || !check} data-return-submit=""
        className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
        {saving ? 'Signing…' : 'Return to use (signature)'}
      </button>
    </div>
  );
}

function LinkScale({ incident, scales, onChanged }) {
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const send = async () => {
    try { await apiPost(`/calibration/incidents/${incident.id}/link`, { instrument_id: id }); onChanged?.(); }
    catch (e) { setError(e.message); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-incident-link={incident.id}>
      <span className="text-amber-800 font-medium">Which scale on the list was it?</span>
      <select value={id} onChange={e => setId(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs">
        <option value="">Choose…</option>
        {scales.map(s => <option key={s.id} value={s.id}>{s.name}{s.asset_number ? ` #${s.asset_number}` : ''}{s.room ? ` · ${s.room}` : ''}</option>)}
      </select>
      <button type="button" disabled={!id} onClick={send} className="px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-50">Link</button>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}

/** The open dropped/damaged reports, at the top of Calibration Management. */
export function OpenIncidents({ data, onChanged, onReport }) {
  const [deciding, setDeciding] = useState(null);
  if (!data) return null;
  const list = data.incidents || [];
  return (
    <section className="rounded-xl border border-red-200 bg-white p-3 space-y-3" data-open-incidents="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <AlertOctagon size={16} className="text-red-600" />
          {list.length ? `${list.length} scale${list.length === 1 ? '' : 's'} reported dropped or damaged` : 'Dropped or damaged scales'}
        </p>
        {onReport && (
          <button type="button" onClick={onReport} data-incident-open-form=""
            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold">Report a dropped or damaged scale</button>
        )}
      </div>
      {list.length === 0 && <p className="text-xs text-gray-500">None open. If a scale is dropped or hit, report it here or from the scale check — it comes out of service and QA is told.</p>}
      {list.map(i => (
        <div key={i.id} className="border-t border-gray-100 pt-3 space-y-2" data-incident={i.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{i.scale_label || 'Scale not identified'} <span className="font-normal text-gray-500">· {i.kind_label}</span></p>
              <p className="text-xs text-gray-600">
                Happened {formatDateTime(i.occurred_at)} · reported by {i.reported_by}{i.source === 'kiosk' ? ' (scale kiosk)' : ''}
                {i.notified_to ? ` · told ${i.notified_to}` : ''}
              </p>
              {i.description && <p className="text-xs text-gray-700 mt-0.5">{i.description}</p>}
              {i.lots_since && <p className="text-xs text-gray-700">Reported as weighed since: {i.lots_since}</p>}
            </div>
            <DispositionChip row={i} />
          </div>
          {!i.instrument_id && data.can_decide && <LinkScale incident={i} scales={data.scales || []} onChanged={onChanged} />}
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1"><ClipboardList size={13} /> Product in question</p>
            <p>
              {i.affected_since
                ? <>Weighed between the last acceptable check on <b>{formatDate(i.affected_since)}</b> and the incident: QA reviews whether those measurements are reliable. </>
                : <>No acceptable check is on record before the incident, so hold back as far as the records allow. </>}
              Weighed <b>after {formatDateTime(i.occurred_at)}</b>: on HOLD until QA/QC evaluates it.
            </p>
            {i.possibly_affected?.length > 0 && (
              <ul className="space-y-0.5" data-possibly-affected="">
                {i.possibly_affected.slice(0, 12).map(r => (
                  <li key={r.id}>{formatDate(r.date)} · {r.team} · {r.room}{r.runs?.length ? ` · ${r.runs.join('; ')}` : ''}{r.after_incident ? ' · after the incident' : ''}</li>
                ))}
                <li className="text-amber-700">Runs logged in this room since then — a list to start from, not the affected lots.</li>
              </ul>
            )}
          </div>
          <ProductControlSteps caution={data.caution} />
          {i.disposition_state === 'recorded' && <DispositionReadback row={i} />}
          {data.can_decide && (i.disposition_state === 'pending' || i.disposition_state === 'held') && (
            deciding === i.id
              ? <DispositionForm source="incident" row={{ ...i, state: i.disposition_state }} onSaved={() => { setDeciding(null); onChanged?.(); }} onCancel={() => setDeciding(null)} />
              : <button type="button" onClick={() => setDeciding(i.id)} data-disposition-open={i.id}
                  className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 rounded-md text-xs font-semibold">
                  {i.disposition_state === 'held' ? 'Record the release, rework or rejection' : 'Record what happened to the product'}
                </button>
          )}
          {data.can_decide && i.instrument_id && <ReturnToUse incident={i} onChanged={onChanged} />}
        </div>
      ))}
    </section>
  );
}
