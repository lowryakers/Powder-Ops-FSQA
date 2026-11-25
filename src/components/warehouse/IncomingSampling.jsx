import { useState, useEffect, useCallback } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature.js';
import { FlaskConical, X, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';

/**
 * Incoming sampling (D-394) — the step after a signed receiving inspection.
 * SOP 402 V3: sample √(N+1) containers, record each step, then release, hold
 * or reject, signed by QA with the password. DRAFT-1 until Document Control
 * issues the form number. The server decides what still stops the signature
 * (`refusals`); this screen only shows it.
 */

const DISPOSITION_TONE = { release: 'bg-green-100 text-green-800', hold: 'bg-amber-100 text-amber-900', reject: 'bg-red-100 text-red-800' };

export function SamplingTab({ onOpen }) {
  const { data } = useApiGet('/receiving/sampling');
  const rows = data?.samplings || [];
  return (
    <div className="space-y-3" data-sampling-tab>
      <p className="text-sm text-gray-600 max-w-3xl">
        Sampling is the step after a receiving inspection is signed off. Open a signed inspection and press
        <b> Sample</b> on a line, or open a record below. Packaging is inspected on Packaging QA (FORM 418-01).
      </p>
      {!data ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No lots sampled in ReadyDoc yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {rows.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen({ id: r.id })} data-sampling-row={r.sampling_no}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-gray-500">{r.sampling_no}</span>
                <span className="text-sm font-medium text-gray-900">{r.item_name || r.part_number}</span>
                <span className="text-xs text-gray-500">{r.vendor || ''}{r.vendor_lot ? ` · lot ${r.vendor_lot}` : ''} · {r.inspection_no}</span>
                <span className="ml-auto">
                  {r.signed_at
                    ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${DISPOSITION_TONE[r.disposition] || 'bg-gray-100 text-gray-700'}`}>{r.disposition}</span>
                    : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">open</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Opened with `{ id }` for a record, or `{ lineId }` to start (or reopen) the one for a receiving line. */
export function SamplingDrawer({ open, onClose }) {
  const [id, setId] = useState(open?.id || null);
  const [rec, setRec] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { apiFetch('/receiving/sampling/form').then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    if (open?.lineId && !open?.id) {
      apiPost('/receiving/sampling', { receiving_log_id: open.lineId })
        .then(r => setId(r.id)).catch(e => setError(e.message));
    }
  }, [open]);
  const load = useCallback(() => {
    if (!id) return;
    apiFetch(`/receiving/sampling/${encodeURIComponent(id)}`).then(setRec).catch(e => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setError('');
    try { setRec(r => ({ ...r, ...patch })); const out = await apiPut(`/receiving/sampling/${id}`, patch); setRec(r => ({ ...out, lab_requests: r?.lab_requests })); }
    catch (e) { setError(e.message); load(); }
  };
  const sign = async () => {
    setBusy(true); setError('');
    try {
      await withSignature((extra) => apiPost(`/receiving/sampling/${id}/sign`, extra),
        { title: 'Sign this sampling record', detail: `${rec.sampling_no} — ${rec.disposition}. Enter the password you sign in with.` });
      load();
    } catch (e) { if (!e?.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    const reason = window.prompt('Why is the signature being revoked?');
    if (!reason) return;
    setBusy(true); setError('');
    try {
      await withSignature((extra) => apiDelete(`/receiving/sampling/${id}/sign`, { reason, ...extra }),
        { title: 'Revoke this signature', detail: `${rec.sampling_no}. Enter the password you sign in with.` });
      load();
    } catch (e) { if (!e?.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };

  const locked = !!rec?.signed_at || !rec?.can_edit;
  const input = 'mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50';
  const field = (k, label, props = {}) => (
    <label className="block text-[11px] font-medium text-gray-600">{label}
      <input id={`smp-${k}`} defaultValue={rec?.[k] ?? ''} disabled={locked} data-sampling-field={k}
        onBlur={e => { if (String(e.target.value) !== String(rec?.[k] ?? '')) save({ [k]: e.target.value }); }}
        className={input} {...props} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full max-w-2xl h-full flex flex-col shadow-xl" data-sampling-drawer>
        <div className="p-3 border-b border-gray-200 flex items-start gap-2">
          <FlaskConical size={18} className="text-powder-600 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900">Incoming sampling {rec?.sampling_no || ''}</p>
            <p className="text-xs text-gray-500">{meta?.form?.procedure || 'SOP 402'} · {meta?.form?.revision || 'DRAFT-1'} — not yet a numbered form; Document Control issues the number.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2" data-sampling-error>{error}</p>}
          {!rec ? <p className="text-sm text-gray-400">Loading…</p> : (
            <>
              {rec.signed_at && (
                <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2" data-sampling-signed>
                  <p className="text-sm font-semibold text-green-900 flex items-center gap-1.5"><CheckCircle2 size={15} /> {rec.disposition} — {rec.signed_by}</p>
                  <p className="text-xs text-green-800">{rec.sign_meaning} · {formatDateTime(rec.signed_at)} · sampled {rec.containers_sampled} of {rec.containers_received} (needed {rec.containers_required})</p>
                </div>
              )}
              <p className="text-xs text-gray-500">Receiving {rec.inspection_no} · {rec.vendor || '—'}{rec.po_number ? ` · PO ${rec.po_number}` : ''}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {field('item_name', 'Material')}
                {field('vendor_lot', 'Vendor lot')}
                {field('internal_lot', 'Internal lot')}
                <label className="block text-[11px] font-medium text-gray-600">What it is
                  <select id="smp-kind" value={rec.material_kind || ''} disabled={locked} data-sampling-kind
                    onChange={e => save({ material_kind: e.target.value })} className={input}>
                    <option value="">—</option>
                    {(meta?.material_kinds || []).map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </label>
                {field('containers_received', 'Containers received (N)', { type: 'number', min: 1 })}
                <div>
                  {field('containers_sampled', 'Containers sampled', { type: 'number', min: 0 })}
                  {rec.containers_required != null && (
                    <p className="text-[11px] text-gray-600 mt-0.5" data-sampling-required>Sample at least <b>{rec.containers_required}</b> — √(N+1), rounded {meta?.rule?.round || 'up'} ({meta?.rule?.document} {meta?.rule?.revision}).</p>
                  )}
                </div>
                {field('container_numbers', 'Container numbers sampled')}
                <label className="flex items-center gap-2 text-sm text-gray-700 mt-4">
                  <input type="checkbox" className="h-4 w-4 shrink-0" checked={!!rec.composite} disabled={locked} onChange={e => save({ composite: e.target.checked })} />
                  Composite sample prepared for the lab
                </label>
              </div>

              <div className="rounded-lg border border-gray-200">
                <p className="px-3 py-1.5 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-600">How it was sampled (SOP 402 § IV.B)</p>
                {(meta?.steps || []).map(st => (
                  <div key={st.key} className="px-3 py-2 border-t border-gray-100" data-sampling-step={st.key}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 min-w-[12rem] text-sm text-gray-800">{st.text}</span>
                      {['yes', 'no'].map(a => (
                        <button key={a} type="button" disabled={locked} data-sampling-answer={`${st.key}:${a}`}
                          onClick={() => save({ steps: { ...rec.steps, [st.key]: a } })}
                          className={`px-3 py-1 rounded-md text-xs font-semibold border ${rec.steps?.[st.key] === a ? (a === 'yes' ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600') : 'border-gray-300 text-gray-700'}`}>
                          {a === 'yes' ? 'Yes' : 'No'}
                        </button>
                      ))}
                    </div>
                    {rec.steps?.[st.key] === 'no' && (
                      <input defaultValue={rec.step_notes?.[st.key] || ''} disabled={locked} placeholder="What happened?"
                        onBlur={e => save({ step_notes: { [st.key]: e.target.value } })} className={input} data-sampling-note={st.key} />
                    )}
                  </div>
                ))}
              </div>

              {rec.material_kind === 'other_ingredient' && (
                <label className="block text-[11px] font-medium text-gray-600">Visual examination acceptable? (§ IV.C.2.a)
                  <select id="smp-visual" value={rec.visual_ok || ''} disabled={locked} onChange={e => save({ visual_ok: e.target.value })} className={input} data-sampling-visual>
                    <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </label>
              )}
              {rec.material_kind === 'dietary_ingredient' && (
                <label className="block text-[11px] font-medium text-gray-600">Lab request with the identity test (§ IV.C.1.a)
                  <select id="smp-lab" value={rec.coa_request_id || ''} disabled={locked} onChange={e => save({ coa_request_id: e.target.value })} className={input} data-sampling-lab>
                    <option value="">— none linked —</option>
                    {(rec.lab_requests || []).map(l => <option key={l.id} value={l.id}>{l.tests_requested} · {l.status}</option>)}
                  </select>
                  {!(rec.lab_requests || []).length && <span className="text-gray-500">No lab request yet for this line — start one from the Receiving Log.</span>}
                </label>
              )}

              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600">Disposition (§ IV.C)</p>
                <div className="flex flex-wrap gap-2">
                  {(meta?.dispositions || []).map(d => (
                    <button key={d.value} type="button" disabled={locked} data-sampling-disposition={d.value}
                      onClick={() => save({ disposition: d.value })}
                      className={`px-3 py-1.5 rounded-md text-sm font-semibold border ${rec.disposition === d.value ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
                {['hold', 'reject'].includes(rec.disposition) && field('disposition_reason', 'Why')}
                {field('notes', 'Notes')}
              </div>

              {!rec.signed_at && rec.refusals?.length > 0 && (
                <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2 list-disc pl-5" data-sampling-refusals>
                  {rec.refusals.map(r => <li key={r}>{r}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        {rec && (
          <div className="border-t border-gray-200 p-3 flex flex-wrap items-center gap-2">
            {!rec.signed_at && rec.can_sign && (
              <button type="button" onClick={sign} disabled={busy || rec.refusals?.length > 0} data-sampling-sign
                className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Sign</button>
            )}
            {!rec.signed_at && !rec.can_sign && (
              <p className="text-xs text-gray-600"><AlertTriangle size={12} className="inline mr-1" />QA signs the sampling and its disposition.</p>
            )}
            {rec.signed_at && (
              <button type="button" onClick={revoke} disabled={busy} data-sampling-revoke
                className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"><RotateCcw size={14} /> Revoke</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
