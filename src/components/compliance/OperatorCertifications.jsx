// Who may drive the forklift, and who has only done half of it.
//
// THE UNCERTIFIED ROWS ARE THE POINT. Before this, passing the written quiz
// filed a completion and the matrix read "trained" — which is one of the three
// things 29 CFR 1910.178(l)(2)(ii) asks for, recorded as though it were all of
// them. So on the day this ships every operator who has ever passed the quiz
// reads as "evaluation not on file", and that is the finding rather than
// wallpaper: each row names a paper evaluation somebody has to file, and
// filing one takes the date it actually happened.
//
// Everything on this screen is DERIVED by the server from the two records.
// Nothing here re-decides whether somebody is certified.
import { useState, useMemo } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature.js';
import { Award, AlertTriangle, ClipboardCheck, Printer, X, Check } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';
import downloadFile from '../../lib/downloadFile.js';

const RESULT_TONE = {
  competent: 'bg-green-600 text-white border-green-600',
  needs_practice: 'bg-amber-500 text-white border-amber-500',
  not_evaluated: 'bg-gray-500 text-white border-gray-500',
};

/**
 * The evaluation itself — filled in beside the machine, so it has to work on a
 * phone: three big buttons per line and nothing to type unless the answer
 * needs explaining.
 */
function EvaluationModal({ course, preset, onClose, onSaved }) {
  const { data } = useApiGet(`/training/courses/${course.id}/practical`, [course.id]);
  const form = data?.form;
  const [header, setHeader] = useState({
    employee_name: preset?.employee_name || '',
    employee_user_id: preset?.employee_user_id || null,
    evaluator_name: '',
    evaluated_on: new Date().toLocaleDateString('en-CA'),
    truck_type: '',
    notes: '',
    source: 'in_app',
  });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState([]);

  const items = useMemo(
    () => (form?.sections || []).flatMap(s => s.items.map(i => ({ ...i, section: s.label }))), [form]);
  const answered = items.filter(i => answers[i.key]?.result).length;
  const set = (key, patch) => setAnswers(a => ({ ...a, [key]: { ...a[key], ...patch } }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setMissing([]);
    try {
      // The QA-signature gate: the first request never carries a password, the
      // server refuses with 403 + signature_required, and withSignature asks.
      await withSignature(
        (extra) => apiPost(`/training/courses/${course.id}/practical`, { ...header, answers, ...extra }),
        { title: 'Sign the practical evaluation',
          detail: `You are certifying that you watched ${header.employee_name} operate a ${header.truck_type || 'powered industrial truck'}.` },
      );
      onSaved();
    } catch (ex) {
      if (ex.cancelled) return;          // Cancelling is a choice, not a failure.
      setErr(ex.message);
      if (Array.isArray(ex.data?.missing)) setMissing(ex.data.missing);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-3">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-4" data-practical-modal>
        <div className="sticky top-0 bg-white border-b border-gray-200 rounded-t-2xl px-4 py-3 flex items-start gap-3">
          <div className="min-w-0">
            <p className="font-bold text-gray-900">{form?.title || 'Practical evaluation'}</p>
            <p className="text-[11px] text-gray-500">{answered} of {items.length} answered</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* The form is a DRAFT until Document Control issues a number, and
              the person filling it in is told so rather than only the code. */}
          {data?.draft_note && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-practical-draft>
              {data.draft_note}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Operator *</span>
              <input required value={header.employee_name} data-eval-operator
                onChange={e => setHeader(h => ({ ...h, employee_name: e.target.value, employee_user_id: null }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Evaluated by *</span>
              <input required value={header.evaluator_name} data-eval-evaluator
                onChange={e => setHeader(h => ({ ...h, evaluator_name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Date evaluated *</span>
              <input required type="date" value={header.evaluated_on} data-eval-date
                max={new Date().toLocaleDateString('en-CA')}
                onChange={e => setHeader(h => ({ ...h, evaluated_on: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Truck evaluated on *</span>
              <select required value={header.truck_type} data-eval-truck
                onChange={e => setHeader(h => ({ ...h, truck_type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">Pick one…</option>
                {(data?.truck_types || []).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-gray-400">
            The certification says which truck it was earned on — being put on a different type is its own
            reason to re-evaluate.
          </p>

          {(form?.sections || []).map(section => (
            <div key={section.key} className="border border-gray-200 rounded-xl overflow-hidden">
              <p className="bg-gray-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                {section.label} <span className="font-normal normal-case text-gray-400">· {section.label_es}</span>
              </p>
              <div className="divide-y divide-gray-100">
                {section.items.map(item => {
                  const a = answers[item.key] || {};
                  return (
                    <div key={item.key} className="p-2.5" data-eval-item={item.key}>
                      <p className="text-sm text-gray-800">{item.label}</p>
                      <p className="text-[11px] text-gray-400 mb-1.5">{item.label_es}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {Object.entries(data?.results || {}).map(([key, r]) => (
                          <button key={key} type="button" data-eval-pick={`${item.key}:${key}`}
                            onClick={() => set(item.key, { result: key })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                              a.result === key ? RESULT_TONE[key] : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                      {/* "Not evaluated" is the only answer that has to explain
                          itself — without a reason it is a box nobody read. */}
                      {a.result === 'not_evaluated' && (
                        <input value={a.note || ''} onChange={e => set(item.key, { note: e.target.value })}
                          data-eval-note={item.key} placeholder="Why not? e.g. no trailer on the dock today"
                          className="mt-1.5 w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" />
                      )}
                      {a.result === 'needs_practice' && (
                        <input value={a.note || ''} onChange={e => set(item.key, { note: e.target.value })}
                          placeholder="What to work on (optional)"
                          className="mt-1.5 w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Notes</span>
            <textarea rows={2} value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>

          {/* Filing an evaluation the plant already did on paper, with its real
              date — nobody should be asked to re-watch a driver they watched
              last year because the app arrived afterwards. */}
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={header.source === 'paper'} data-eval-paper
              onChange={e => setHeader(h => ({ ...h, source: e.target.checked ? 'paper' : 'in_app' }))}
              className="mt-0.5" />
            <span>This is an evaluation that was done on paper — file it with the date it actually happened.</span>
          </label>

          {missing.length > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-eval-missing>
              <p className="font-semibold mb-1">Still needed:</p>
              <ul className="list-disc list-inside space-y-0.5">{missing.slice(0, 8).map(m => <li key={m}>{m}</li>)}</ul>
              {missing.length > 8 && <p className="mt-1">…and {missing.length - 8} more.</p>}
            </div>
          )}
          {err && !missing.length && <p className="text-xs text-red-700">{err}</p>}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 rounded-b-2xl px-4 py-3 flex items-center gap-2">
          <button type="submit" disabled={busy} data-eval-sign
            className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {busy ? 'Filing…' : 'Sign and file'}
          </button>
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100">Cancel</button>
          <span className="ml-auto text-[11px] text-gray-400">Signing asks for your password.</span>
        </div>
      </div>
    </form>
  );
}

export default function OperatorCertifications({ course }) {
  const { data, refresh } = useApiGet(course ? `/training/courses/${course.id}/certifications` : null, [course?.id]);
  const [evaluating, setEvaluating] = useState(null);
  const [err, setErr] = useState('');
  if (!course) return null;

  const people = data?.people || [];
  const c = data?.counts || {};

  const print = async (p) => {
    setErr('');
    const q = p.employee_user_id ? `user_id=${encodeURIComponent(p.employee_user_id)}` : `name=${encodeURIComponent(p.employee_name)}`;
    try {
      await downloadFile(`/api/training/courses/${course.id}/certificate.pdf?${q}`,
        `${course.code}_Certificate_${p.employee_name.replace(/\W+/g, '_')}.pdf`);
    } catch (ex) { setErr(ex.message || 'Could not print that certificate.'); }
  };

  return (
    <div className="space-y-3" data-certifications>
      <div className="flex items-start gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900">{course.title}</h3>
          <p className="text-xs text-gray-500">
            Certified once BOTH halves are on file: the written test and a signed practical evaluation.
            29 CFR 1910.178(l)(6).
          </p>
        </div>
        <button onClick={() => setEvaluating({})} data-new-evaluation
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg">
          <ClipboardCheck size={15} /> New evaluation
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ['Certified', c.certified, 'text-green-700'],
          ['Expiring soon', c.expiring_soon, 'text-amber-700'],
          ['Need an evaluation', c.needs_evaluation, 'text-red-700'],
          ['Need the written test', c.needs_test, 'text-gray-700'],
        ].map(([label, value, tone]) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-3" data-cert-card={label}>
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className={`text-xl font-bold ${tone}`}>{value ?? 0}</p>
          </div>
        ))}
      </div>

      {err && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</p>}

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {people.map(p => (
          <div key={`${p.employee_name}`} className="p-3 flex items-start gap-3 flex-wrap" data-cert-row={p.employee_name}>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900 flex items-center gap-1.5">
                {p.certified
                  ? <Award size={14} className="text-green-600 shrink-0" />
                  : <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                {p.employee_name}
              </p>
              {p.certified ? (
                <p className="text-[11px] text-gray-500">
                  {p.truck_type} · trained {formatDate(p.trained_on)} · evaluated {formatDate(p.evaluated_on)} by {p.evaluated_by}
                  {p.expires_on && <> · valid to <span className={p.expiring_soon ? 'text-amber-700 font-semibold' : ''}>{formatDate(p.expires_on)}</span></>}
                </p>
              ) : (
                <ul className="text-[11px] text-amber-800 mt-0.5">
                  {p.gaps.map(g => <li key={g}>• {g}</li>)}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {p.certified
                ? (
                  <button onClick={() => print(p)} data-print-cert={p.employee_name}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
                    <Printer size={13} /> Certificate
                  </button>
                )
                : (
                  <button onClick={() => setEvaluating({ employee_name: p.employee_name, employee_user_id: p.employee_user_id })}
                    data-evaluate={p.employee_name}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-powder-200 text-powder-700 bg-powder-50 hover:bg-powder-100">
                    <ClipboardCheck size={13} /> Evaluate
                  </button>
                )}
            </div>
          </div>
        ))}
        {people.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">
            Nobody has a record on this course yet.
          </p>
        )}
      </div>

      {(data?.evaluations || []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Evaluations on file</p>
          <ul className="space-y-1.5">
            {data.evaluations.map(e => (
              <li key={e.id} className="text-xs text-gray-600 flex items-start gap-2" data-eval-row={e.id}>
                {e.result === 'pass'
                  ? <Check size={13} className="text-green-600 mt-0.5 shrink-0" />
                  : <X size={13} className="text-red-600 mt-0.5 shrink-0" />}
                <span>
                  <span className="font-medium text-gray-800">{e.employee_name}</span> · {formatDate(e.evaluated_on)} ·
                  {' '}{e.truck_type} · by {e.evaluator_name}
                  <span className="text-gray-400"> · {e.form_revision}{e.source === 'paper' ? ' · filed from paper' : ''}</span>
                  {e.needs_practice?.length > 0 && (
                    <span className="block text-amber-700">Needs practice: {e.needs_practice.map(n => n.label).join('; ')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluating && (
        <EvaluationModal course={course} preset={evaluating}
          onClose={() => setEvaluating(null)}
          onSaved={() => { setEvaluating(null); refresh(); }} />
      )}
    </div>
  );
}
