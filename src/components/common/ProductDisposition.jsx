// What happened to product measured on a device found out of calibration
// (SQF 11.2.3.4, D-154). One component file for the three places it appears:
// the Record Calibration form, the record lists (calibration and daily scale
// checks), and the open-findings strip at the top of Calibration Management.
// The rule itself is shared/product-disposition.js — the server decides, this
// renders the same words and runs the same check before it sends.

import { useState } from 'react';
import { AlertTriangle, CheckCircle, ClipboardCheck } from 'lucide-react';
import { apiPost } from '../../hooks/useApi';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { DISPOSITIONS, checkDisposition, FINAL_AFTER_HOLD } from '../../../shared/product-disposition.js';

/** The state of a record's disposition, as a chip. Nothing when none is owed. */
export function DispositionChip({ row }) {
  const s = row?.disposition_state;
  if (!s || s === 'not_required') return null;
  if (s === 'held') {
    return (
      <span data-disposition-chip="held" title={row.disposition_ref ? `On hold · ${row.disposition_ref}` : 'On hold'}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-orange-800 border border-orange-200 whitespace-nowrap">
        <AlertTriangle size={11} /> Product on hold{row.disposition_ref ? ` · ${row.disposition_ref}` : ''}
      </span>
    );
  }
  if (s === 'recorded') {
    return (
      <span data-disposition-chip="recorded" title={row.disposition_notes || ''}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-800 border border-green-200 whitespace-nowrap">
        <CheckCircle size={11} /> {row.disposition_label}
      </span>
    );
  }
  return (
    <span data-disposition-chip={s}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
      <AlertTriangle size={11} /> {s === 'pending' ? 'Product disposition owed' : 'No product disposition on record'}
    </span>
  );
}

/** The fields of a disposition, controlled. Used inside other forms too. */
export function DispositionFields({ value, onChange, idPrefix = 'disp', held = false }) {
  const v = value || {};
  const def = DISPOSITIONS[v.disposition];
  // A held finding takes its final answer only — the hold itself is recorded.
  const choices = Object.entries(DISPOSITIONS).filter(([key]) => !held || FINAL_AFTER_HOLD.includes(key));
  return (
    <div className="space-y-2" data-disposition-fields>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {choices.map(([key, d]) => (
          <label key={key} htmlFor={`${idPrefix}-${key}`}
            className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-sm cursor-pointer ${v.disposition === key ? 'border-powder-500 bg-white' : 'border-gray-200 bg-white/60 hover:border-gray-300'}`}>
            <input type="radio" id={`${idPrefix}-${key}`} name={`${idPrefix}-choice`} value={key}
              checked={v.disposition === key} onChange={() => onChange({ ...v, disposition: key })} className="mt-0.5" />
            <span className="text-gray-800">{d.label}</span>
          </label>
        ))}
      </div>
      {def && <p className="text-xs text-gray-500">{def.help}</p>}
      <textarea id={`${idPrefix}-notes`} value={v.notes || ''} rows={2}
        onChange={e => onChange({ ...v, notes: e.target.value })}
        placeholder="Which product and lots, and how you reached the answer"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      {def?.needsRef && (
        <input id={`${idPrefix}-ref`} value={v.ref || ''} onChange={e => onChange({ ...v, ref: e.target.value })}
          placeholder={def.refLabel}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      )}
      {/* Carol's list: affected lots, quantities, evaluation results (D-194). */}
      {def?.needsLots && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input id={`${idPrefix}-lots`} value={v.lots || ''} onChange={e => onChange({ ...v, lots: e.target.value })}
            placeholder="Affected lots (required)" data-disposition-lots=""
            className="sm:col-span-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input id={`${idPrefix}-qty`} value={v.quantity || ''} onChange={e => onChange({ ...v, quantity: e.target.value })}
            placeholder="Quantity (e.g. 3 pallets, 1,200 kg)" data-disposition-quantity=""
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      )}
      {def?.needsEvaluation && (
        <textarea id={`${idPrefix}-eval`} value={v.evaluation || ''} rows={2} onChange={e => onChange({ ...v, evaluation: e.target.value })}
          placeholder="Evaluation result — how the product was checked (reweighed on which verified scale) and what it showed"
          data-disposition-evaluation="" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      )}
    </div>
  );
}

/** A standalone form that records the decision on one filed record. */
export function DispositionForm({ source, row, onSaved, onCancel }) {
  const [value, setValue] = useState({ disposition: '', notes: '', ref: '', lots: '', quantity: '', evaluation: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const held = (row.state || row.disposition_state) === 'held';
  const save = async () => {
    const errs = checkDisposition(value, { held });
    if (errs.length) { setError(errs.join(' ')); return; }
    setSaving(true); setError('');
    try {
      await apiPost(`/calibration/dispositions/${source}/${row.id}`, value);
      onSaved?.();
    } catch (e) { setError(e.message || 'Could not save the disposition.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 space-y-2" data-disposition-form={row.id}>
      <p className="text-sm font-semibold text-gray-900">
        {held ? `Product on hold${row.disposition_ref ? ` (${row.disposition_ref})` : ''} — record how it was released, reworked or rejected` : 'What happened to the product measured on this device?'}
      </p>
      {held && <p className="text-xs text-orange-800">It stays open until this is recorded: product remains on hold until authorized release.</p>}
      <p className="text-xs text-gray-600">
        {row.affected_since
          ? <>Product measured between the last good check on <b>{formatDate(row.affected_since)}</b> and this one on <b>{formatDate(row.date || row.calibrated_at || row.performed_at)}</b> is in question.</>
          : <>No earlier good check is on record, so the window opens at the device&apos;s last known good use.</>}
      </p>
      <DispositionFields value={value} onChange={setValue} idPrefix={`disp-${row.id}`} held={held} />
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50" data-disposition-save>
          {saving ? 'Saving…' : 'Record disposition'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm">Cancel</button>}
      </div>
    </div>
  );
}

/** The recorded decision, read back on an expanded row. */
export function DispositionReadback({ row }) {
  if (!row || row.disposition_state === 'not_required') return null;
  if (row.disposition_state !== 'recorded' && row.disposition_state !== 'held') return null;
  const history = Array.isArray(row.disposition_history) ? row.disposition_history : [];
  return (
    <div className="text-xs space-y-0.5" data-disposition-readback>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Product disposition (SQF 11.2.3.4)</div>
      {history.map((h, i) => (
        <div key={i} className="text-gray-500" data-disposition-history="">
          First: {h.label || h.disposition}{h.ref ? ` · ${h.ref}` : ''}{h.lots ? ` · lots ${h.lots}` : ''} — {h.by}, {formatDateTime(h.at)}
        </div>
      ))}
      <div className="text-gray-900 font-medium">{row.disposition_label}{row.disposition_ref ? ` · ${row.disposition_ref}` : ''}</div>
      {(row.disposition_lots || row.disposition_quantity) && (
        <div className="text-gray-700">Lots: {row.disposition_lots || '—'}{row.disposition_quantity ? ` · ${row.disposition_quantity}` : ''}</div>
      )}
      {row.disposition_evaluation && <div className="text-gray-700">Evaluation: {row.disposition_evaluation}</div>}
      <div className="text-gray-700 whitespace-pre-line">{row.disposition_notes}</div>
      <div className="text-gray-500">
        {row.disposition_by} · {formatDateTime(row.disposition_at)}
        {row.affected_since ? ` · product since ${formatDate(row.affected_since)}` : ''}
      </div>
    </div>
  );
}

/**
 * The open findings across calibrations and daily scale checks, at the top of
 * Calibration Management. New ones are the queue; the ones filed before the
 * rule are listed apart, collapsed, so the history can be answered without
 * looking like a pile that appeared overnight.
 */
export function OpenDispositions({ data, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  if (!data) return null;
  // Dropped/damaged reports have their own section (OpenIncidents); only the
  // failed checks are listed here, so nothing appears twice.
  const pending = (data.pending || []).filter(r => r.source !== 'incident');
  const held = (data.held || []).filter(r => r.source !== 'incident');
  const history = data.not_recorded || [];
  if (!pending.length && !held.length && !history.length) return null;
  const row = (r) => (
    <li key={`${r.source}-${r.id}`} className="py-2 border-t border-amber-100 first:border-t-0" data-open-disposition={r.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">{r.title}</div>
          <div className="text-xs text-gray-600">{r.subtitle} · {formatDate(r.date)}{r.state === 'held' ? ` · on hold${r.disposition_ref ? ` (${r.disposition_ref})` : ''}${r.disposition_lots ? ` · lots ${r.disposition_lots}` : ''}` : ''}</div>
        </div>
        {data.can_decide && openId !== r.id && (
          <button type="button" onClick={() => setOpenId(r.id)} data-disposition-open={r.id}
            className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 rounded-md text-xs font-semibold">
            {r.state === 'held' ? 'Record release' : 'Record disposition'}
          </button>
        )}
      </div>
      {openId === r.id && (
        <div className="mt-2">
          <DispositionForm source={r.source} row={r}
            onSaved={() => { setOpenId(null); onChanged?.(); }} onCancel={() => setOpenId(null)} />
        </div>
      )}
    </li>
  );
  return (
    <section className="bg-amber-50 border border-amber-200 rounded-xl p-3" data-open-dispositions>
      <div className="flex items-start gap-2">
        <ClipboardCheck size={18} className="text-amber-700 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {pending.length
              ? `${pending.length} out-of-calibration finding${pending.length === 1 ? ' needs' : 's need'} a product disposition`
              : 'No new findings waiting on a product disposition'}
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            When a device fails its check, or has to be adjusted to pass, record what happened to the product measured on it since its last good check (SQF 11.2.3.4).
          </p>
          {pending.length > 0 && <ul className="mt-2">{pending.map(row)}</ul>}
          {held.length > 0 && (
            <div className="mt-2" data-held-dispositions="">
              <p className="text-xs font-semibold text-orange-800">{held.length} with product on hold, waiting for its release, rework or rejection to be recorded</p>
              <ul className="mt-1">{held.map(row)}</ul>
            </div>
          )}
          {history.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowHistory(s => !s)} className="text-xs font-semibold text-amber-900 underline" data-disposition-history-toggle>
                {showHistory ? 'Hide' : 'Show'} {history.length} earlier finding{history.length === 1 ? '' : 's'} filed before this was asked
              </button>
              {showHistory && <ul className="mt-1">{history.map(row)}</ul>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
