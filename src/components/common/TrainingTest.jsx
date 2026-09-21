// Taking an assigned course's test, from the task it was assigned on.
//
// Rendered by the Operator View (a phone, on the floor, EN/ES) and the Task
// Center — one component, because a test that asks different questions or
// grades differently depending on which screen it was opened from is not a
// test.
//
// It reads and submits through the WORK ORDER, never /api/training: the
// assignment is the authorization (see pm.js), and the floor has no Training
// module. The answer key never comes down.
import { useState } from 'react';
import { apiFetch, apiPost } from '../../hooks/useApi';
import { GraduationCap, Loader2, CheckCircle2, XCircle } from 'lucide-react';

const S = {
  take: { en: 'Take the test', es: 'Tomar el examen' },
  loading: { en: 'Loading the test…', es: 'Cargando el examen…' },
  of: { en: 'of', es: 'de' },
  prev: { en: 'Back', es: 'Atrás' },
  next: { en: 'Next', es: 'Siguiente' },
  submit: { en: 'Submit the test', es: 'Enviar el examen' },
  submitting: { en: 'Submitting…', es: 'Enviando…' },
  answer_all: { en: 'Answer every question before submitting.', es: 'Responda todas las preguntas antes de enviar.' },
  passed: { en: 'Passed', es: 'Aprobado' },
  failed: { en: 'Not passed', es: 'No aprobado' },
  you_scored: { en: 'You scored', es: 'Su puntaje' },
  need: { en: 'Pass mark', es: 'Puntaje para aprobar' },
  filed: { en: 'Your training record is filed and this task is done.', es: 'Su registro de capacitación quedó archivado y esta tarea está completa.' },
  retry: { en: 'You can take it again. The task stays on your list until you pass.', es: 'Puede tomarlo de nuevo. La tarea permanece en su lista hasta aprobar.' },
  again: { en: 'Try again', es: 'Intentar de nuevo' },
  close: { en: 'Close', es: 'Cerrar' },
  for: { en: 'This records the training for', es: 'Esto registra la capacitación de' },
  type_answer: { en: 'Your answer', es: 'Su respuesta' },
};
const tr = (lang, k) => (S[k] || {})[lang] || (S[k] || {}).en || k;

export default function TrainingTest({ workOrderId, lang = 'en', onDone }) {
  const [open, setOpen] = useState(false);
  const [test, setTest] = useState(null);
  const [answers, setAnswers] = useState({});
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const start = async () => {
    setOpen(true); setBusy(true); setError(''); setResult(null); setAnswers({}); setI(0);
    try { setTest(await apiFetch(`/pm/work-orders/${workOrderId}/training-test`)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!test) return;
    // Every question answered — a blank is scored as wrong, and somebody who
    // simply ran out of screen should not fail for it.
    if (test.questions.some(q => answers[q.id] === undefined || answers[q.id] === '')) {
      setError(tr(lang, 'answer_all')); return;
    }
    setBusy(true); setError('');
    try {
      const r = await apiPost(`/pm/work-orders/${workOrderId}/training-test`, { answers });
      setResult(r);
      if (r.passed) onDone?.(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={start} data-take-test
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-semibold">
        <GraduationCap size={16} /> {tr(lang, 'take')}
      </button>
    );
  }

  if (busy && !test) {
    return <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {tr(lang, 'loading')}</p>;
  }

  if (result) {
    const ok = result.passed;
    return (
      <div className={`rounded-lg border p-3 space-y-2 ${ok ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`} data-test-result={ok ? 'passed' : 'failed'}>
        <p className={`font-semibold flex items-center gap-1.5 ${ok ? 'text-green-800' : 'text-amber-900'}`}>
          {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {tr(lang, ok ? 'passed' : 'failed')}
        </p>
        <p className="text-sm text-gray-700">
          {tr(lang, 'you_scored')} <span className="font-bold">{result.score}%</span> · {tr(lang, 'need')} {result.passing_score}%
        </p>
        <p className="text-xs text-gray-600">{tr(lang, ok ? 'filed' : 'retry')}</p>
        {ok ? (
          <button type="button" onClick={() => { setOpen(false); onDone?.(result); }} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold">{tr(lang, 'close')}</button>
        ) : (
          <button type="button" onClick={start} data-test-again className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-semibold">{tr(lang, 'again')}</button>
        )}
      </div>
    );
  }

  if (!test) return <p className="text-sm text-red-700">{error}</p>;

  const q = test.questions[i];
  // The floor reads Spanish; the plant's own translation is on the question
  // where there is one, and a machine-translated safety question is not the
  // question anybody signed.
  const prompt = (lang === 'es' && q.prompt_es) ? q.prompt_es : q.prompt;
  const options = (lang === 'es' && q.options_es?.length) ? q.options_es : q.options;
  const answered = test.questions.filter(x => answers[x.id] !== undefined && answers[x.id] !== '').length;

  return (
    <div className="rounded-lg border border-powder-200 bg-white p-3 space-y-3" data-training-test>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">{test.course?.code ? `${test.course.code} — ` : ''}{test.title || test.course?.title}</p>
        <span className="text-[11px] text-gray-400">{i + 1} {tr(lang, 'of')} {test.questions.length}</span>
      </div>
      {test.for && <p className="text-[11px] text-gray-500">{tr(lang, 'for')} <span className="font-medium text-gray-700">{test.for}</span></p>}
      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-powder-500" style={{ width: `${(answered / test.questions.length) * 100}%` }} />
      </div>

      <p className="text-sm font-medium text-gray-900" data-test-prompt>{prompt}</p>
      {q.type === 'short_answer' ? (
        <input value={answers[q.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
          placeholder={tr(lang, 'type_answer')} data-test-input
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      ) : (
        <div className="space-y-1.5">
          {(options || []).map((opt, oi) => {
            // The VALUE is the English option — the answer key is in English,
            // and grading a Spanish reading against it would fail everybody
            // who reads the translation. Only the label changes language.
            const value = q.options?.[oi] ?? opt;
            const on = String(answers[q.id] ?? '') === String(value);
            return (
              <button type="button" key={oi} data-test-option={oi}
                onClick={() => setAnswers(a => ({ ...a, [q.id]: value }))}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm ${on ? 'bg-powder-600 text-white border-powder-600' : 'bg-white border-gray-300 text-gray-800'}`}>
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={i === 0} onClick={() => setI(n => n - 1)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium disabled:opacity-40">{tr(lang, 'prev')}</button>
        {i < test.questions.length - 1 ? (
          <button type="button" onClick={() => setI(n => n + 1)} data-test-next
            className="flex-1 px-3 py-2 bg-gray-800 text-white rounded-lg text-xs font-semibold">{tr(lang, 'next')}</button>
        ) : (
          <button type="button" onClick={submit} disabled={busy} data-test-submit
            className="flex-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
            {busy ? tr(lang, 'submitting') : tr(lang, 'submit')}
          </button>
        )}
      </div>
    </div>
  );
}
