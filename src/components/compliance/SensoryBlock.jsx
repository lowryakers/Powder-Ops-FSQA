import { useEffect, useState } from 'react';
import { Check, X, ShieldCheck, PenLine } from 'lucide-react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { onDataChanged } from '../../lib/dataChanged.js';
import { SENSORY_ATTRIBUTES, sensoryNoteKey, RESULT_LABELS, LEGACY_SENSORY_LABELS, sensoryShape } from '../../../shared/sensory.js';

// FORM 602-01 V2, as the evaluator fills it in.
//
// Each attribute row shows the PRODUCT'S written specification and two
// buttons — Matches / Doesn't match — with a "what you saw" cell that is
// required only on a fail. Five taps for a pass.
//
// THE FIRST TEST WRITES THE SPEC. A product with nothing on file asks the
// evaluator to describe what a good one looks like, per attribute; that files
// as the product's DRAFT specification, a QA lead approves it, and every later
// test grades against it read-only. Nothing is typed twice, and no spreadsheet
// has to exist first.
//
// The block renders from the form's values object and writes back into it;
// the server validates and stores the spec snapshot on the record itself.

const inputCls = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';

function useSpec(product) {
  // Debounced: the product name is typed on the same form.
  const [q, setQ] = useState(product || '');
  useEffect(() => { const t = setTimeout(() => setQ(product || ''), 400); return () => clearTimeout(t); }, [product]);
  const { data, refresh } = useApiGet(q.trim() ? `/qms/sensory-spec?product=${encodeURIComponent(q.trim())}` : null, [q]);
  return { spec: q.trim() ? data?.spec || null : null, meta: data, refresh, ready: !q.trim() || data !== undefined };
}

export function SpecStatus({ spec, product }) {
  if (!product?.trim()) return <p className="text-[11px] text-gray-500">Enter the product first — its specification comes up here.</p>;
  if (!spec) return (
    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1 flex items-start gap-1.5">
      <PenLine size={12} className="mt-0.5 shrink-0" />
      <span><b>No specification on file for {product.trim()}.</b> Describe what a good one looks like for each attribute — this test writes the draft, and a QA lead approves it.</span>
    </p>
  );
  return spec.status === 'approved'
    ? <p className="text-[11px] text-green-800 bg-green-50 border border-green-100 rounded px-2 py-1 flex items-center gap-1.5"><ShieldCheck size={12} /> Specification approved by {spec.approved_by} on {String(spec.approved_at || '').slice(0, 10)}.</p>
    : <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1 flex items-center gap-1.5"><PenLine size={12} /> Draft specification (from {spec.drafted_by || 'QA'}) — awaiting a QA lead's approval. Tests grade against it meanwhile and say so.</p>;
}

export default function SensoryBlock({ product, values, onChange, readOnly = false }) {
  const { spec, ready } = useSpec(product);
  const drafting = ready && !!product?.trim() && !spec;
  const draft = values?.sensory_spec_draft || {};
  const set = (k, v) => onChange({ ...values, [k]: v });
  const setDraft = (k, v) => onChange({ ...values, sensory_spec_draft: { ...draft, [k]: v } });

  return (
    <div className="sm:col-span-2 rounded-lg border border-gray-200 overflow-hidden" data-sensory-block>
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 space-y-1">
        <p className="text-xs font-semibold text-gray-800">Checked against the product specification</p>
        <SpecStatus spec={spec} product={product} />
      </div>
      <div className="divide-y divide-gray-100">
        {SENSORY_ATTRIBUTES.map(a => {
          const v = String(values?.[a.key] || '').toLowerCase();
          const note = values?.[sensoryNoteKey(a.key)] || '';
          return (
            <div key={a.key} className="px-3 py-2.5 grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-start" data-sensory-row={a.key}>
              <div className="text-sm font-medium text-gray-800 pt-1.5">{a.label}</div>
              <div className="min-w-0">
                {drafting && !readOnly ? (
                  <input value={draft[a.key] || ''} onChange={e => setDraft(a.key, e.target.value)}
                    placeholder={`What a good ${a.label.toLowerCase()} is, in words`} className={inputCls} data-spec-draft={a.key} />
                ) : (
                  <p className="text-sm text-gray-600 whitespace-pre-line pt-1.5">{spec?.[a.key] || <span className="text-gray-400">—</span>}</p>
                )}
                {(v === 'fail' || note) && (
                  <input value={note} onChange={e => set(sensoryNoteKey(a.key), e.target.value)} readOnly={readOnly}
                    placeholder="What you saw" required={v === 'fail'} className={`${inputCls} mt-1.5`} data-sensory-note={a.key} />
                )}
              </div>
              {!readOnly && (
                <div className="flex gap-1.5 sm:justify-end">
                  <button type="button" onClick={() => set(a.key, 'pass')} aria-pressed={v === 'pass'} data-sensory-pass={a.key}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium ${v === 'pass' ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                    <Check size={14} /> Matches
                  </button>
                  <button type="button" onClick={() => set(a.key, 'fail')} aria-pressed={v === 'fail'} data-sensory-fail={a.key}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium ${v === 'fail' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                    <X size={14} /> Doesn't match
                  </button>
                </div>
              )}
              {readOnly && <div className="text-sm font-medium">{v ? <span className={v === 'fail' ? 'text-red-700' : 'text-green-700'}>{RESULT_LABELS[v]}</span> : <span className="text-gray-400">—</span>}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A filed record, read back: the result beside the words it was graded
// against. A V1 record shows its five scores as filed — history is not
// re-judged by a rule written after it.
export function SensoryResults({ rec }) {
  const shape = sensoryShape(rec);
  if (shape === 'v1') {
    return (
      <div className="sm:col-span-2 rounded-lg border border-gray-200 p-3" data-sensory-results="v1">
        <p className="text-[11px] font-medium text-gray-500 mb-1.5">Sensory scores — filed on FORM 602-01 V1 (1–5, below 3 fails)</p>
        <div className="grid grid-cols-5 gap-2 text-center">
          {LEGACY_SENSORY_LABELS.map(([k, label]) => (
            <div key={k}><p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p><p className={`text-lg font-semibold ${Number(rec[k]) < 3 ? 'text-red-700' : 'text-gray-900'}`}>{rec[k] ?? '—'}</p></div>
          ))}
        </div>
      </div>
    );
  }
  if (shape !== 'v2') return null;
  const spec = rec.sensory_spec;
  return (
    <div className="sm:col-span-2 rounded-lg border border-gray-200 overflow-hidden" data-sensory-results="v2">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
        <p className="text-[11px] font-medium text-gray-600">
          Checked against the product specification
          {spec?.status === 'approved' ? ` · approved by ${spec.approved_by} on ${String(spec.approved_at || '').slice(0, 10)}` : spec ? ' · DRAFT at the time of this test' : ' · no specification was on file'}
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {SENSORY_ATTRIBUTES.map(a => {
          const v = String(rec[a.key] || '').toLowerCase();
          return (
            <div key={a.key} className="px-3 py-2 grid gap-1 sm:grid-cols-[7rem_1fr_9rem] sm:items-start text-sm">
              <div className="font-medium text-gray-800">{a.label}</div>
              <div className="text-gray-600 min-w-0">
                <span className="whitespace-pre-line">{spec?.attributes?.[a.key] || <span className="text-gray-400">—</span>}</span>
                {rec[sensoryNoteKey(a.key)] && <p className="text-gray-800 mt-0.5"><span className="text-gray-500">Seen:</span> {rec[sensoryNoteKey(a.key)]}</p>}
              </div>
              <div className={`font-medium sm:text-right ${v === 'fail' ? 'text-red-700' : v === 'pass' ? 'text-green-700' : 'text-gray-400'}`}>{RESULT_LABELS[v] || '—'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Draft specifications waiting on a QA lead, at the top of the Organoleptic
// log — where the person who approves them already is.
export function SpecApprovalStrip() {
  const { data, refresh } = useApiGet('/qms/sensory-specs?status=draft');
  // A test filed on this screen may have just drafted a spec; the strip has
  // its own query, so it listens for the app-wide write signal.
  useEffect(() => onDataChanged(refresh), [refresh]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const drafts = data?.specs || [];
  if (!drafts.length) return null;
  const approve = async (id) => {
    setBusy(id); setErr('');
    try {
      await apiPost(`/qms/sensory-specs/${id}/approve`, {});
      refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2" data-spec-strip>
      <p className="text-sm font-medium text-amber-900">{drafts.length} product specification{drafts.length === 1 ? '' : 's'} drafted by a test and waiting on a QA lead</p>
      <p className="text-[11px] text-amber-800">Until approved, tests grade against the draft and say so on the record. Approving locks the wording.</p>
      <ul className="space-y-1.5">
        {drafts.map(sp => (
          <li key={sp.id} className="bg-white rounded-lg border border-amber-100 px-3 py-2 flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{sp.product_name}</p>
              <p className="text-[11px] text-gray-500">Drafted by {sp.drafted_by || 'QA'} on {String(sp.drafted_at || '').slice(0, 10)}</p>
              <dl className="mt-1 grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[12px]">
                {SENSORY_ATTRIBUTES.map(a => <div key={a.key}><dt className="inline text-gray-500">{a.label}: </dt><dd className="inline text-gray-800">{sp[a.key] || '—'}</dd></div>)}
              </dl>
            </div>
            {data?.can_approve && (
              <button type="button" onClick={() => approve(sp.id)} disabled={busy === sp.id} data-approve-spec={sp.product_name}
                className="px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50 inline-flex items-center gap-1">
                <ShieldCheck size={13} /> {busy === sp.id ? 'Approving…' : 'Approve specification'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
