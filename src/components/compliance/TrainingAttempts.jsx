// Every test attempt, and each one question by question (D-144).
//
// "No way for the reviewer to see which questions were scored good or bad."
// Every attempt has stored its answers since tests existed; nothing showed
// them. The list is newest first and includes FAILED attempts — a person who
// failed twice before passing is exactly who a reviewer wants to look at — and
// the detail names each question, what was given, the expected answer and
// whether it was right. An attempt filed before the outcome was frozen is
// re-graded against today's key and SAYS so.
import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { CheckCircle2, XCircle, X, Search } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime';

export function AttemptReview({ attemptId, onClose }) {
  const { data: a, error } = useApiGet(attemptId ? `/training/attempts/${attemptId}` : null, [attemptId]);
  if (!attemptId) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 space-y-3" onClick={e => e.stopPropagation()} data-attempt-review>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">{a ? `${a.employee_name} — ${a.course_code ? `${a.course_code} · ` : ''}${a.course_title || ''}` : 'Test answers'}</h3>
            {a && (
              <p className="text-xs text-gray-500">
                {formatDateTime(a.taken_at)} · <span className={a.passed ? 'text-green-700 font-medium' : 'text-amber-800 font-medium'}>{a.score}% — {a.passed ? 'passed' : 'not passed'}</span>
                {' '}· <span data-attempt-tally>{a.right} right, {a.wrong} wrong</span>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {error && <p className="text-sm text-red-700">{error.message || String(error)}</p>}
        {a?.derived && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1" data-attempt-derived>
            Taken before each question's outcome was kept with the attempt, so it is re-graded here against the test as it
            stands today. If the test has been changed since, this may differ from how it was graded at the time.
          </p>
        )}
        <ol className="space-y-2">
          {(a?.results || []).map(r => (
            <li key={r.question_id} className={`rounded-lg border p-2 text-sm ${r.correct ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`} data-attempt-q={r.number} data-attempt-correct={r.correct ? '1' : '0'}>
              <p className="font-medium text-gray-900 flex items-start gap-1.5">
                {r.correct ? <CheckCircle2 size={15} className="text-green-600 shrink-0 mt-0.5" /> : <XCircle size={15} className="text-red-600 shrink-0 mt-0.5" />}
                <span>{r.number}. {r.prompt}</span>
              </p>
              <p className="text-xs text-gray-700 ml-6">Answered: <span className="font-medium">{r.given ?? <em className="text-gray-400">nothing</em>}</span></p>
              {!r.correct && <p className="text-xs text-gray-700 ml-6">Expected: <span className="font-medium">{r.expected ?? '—'}</span></p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function TrainingAttemptsPanel() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const { data: rows, loading } = useApiGet('/training/attempts?limit=300');
  const needle = q.trim().toLowerCase();
  const list = (rows || []).filter(r => !needle
    || String(r.employee_name || '').toLowerCase().includes(needle)
    || String(r.course_title || '').toLowerCase().includes(needle)
    || String(r.course_code || '').toLowerCase().includes(needle));
  return (
    <div className="space-y-3" data-training-attempts>
      <p className="text-sm text-gray-600">Every test taken in the app, passed or not, newest first. Open one to see each question: what was answered, what was expected, and whether it was right.</p>
      <div className="relative max-w-xs">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employee or course…"
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading && <p className="px-4 py-6 text-center text-sm text-gray-400">Loading…</p>}
        {!loading && !list.length && <p className="px-4 py-6 text-center text-sm text-gray-400">No tests taken yet.</p>}
        {list.map(r => (
          <button type="button" key={r.id} onClick={() => setOpen(r.id)} data-attempt-row={r.id}
            className="w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 hover:bg-gray-50">
            <span className="font-medium text-gray-900">{r.employee_name}</span>
            <span className="text-sm text-gray-600">{r.course_code ? `${r.course_code} · ` : ''}{r.course_title}</span>
            <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${r.passed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{r.score}% · {r.passed ? 'passed' : 'not passed'}</span>
            <span className="text-[11px] text-gray-400 w-full sm:w-auto">{formatDateTime(r.taken_at)}</span>
          </button>
        ))}
      </div>
      <AttemptReview attemptId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// Most-missed questions, per course (D-159). One row per QUESTION, counted once
// per person — their latest attempt — so somebody who retook a test eleven
// times counts once. A question most people miss, where most of them chose the
// same other answer, is flagged to check the key: that is the pattern a wrong
// key makes. The app flags it; the course owner decides, in the test editor.
export function QuestionMissesPanel() {
  const [q, setQ] = useState('');
  const [old, setOld] = useState(false);
  const [open, setOpen] = useState({});
  const { data, loading, error } = useApiGet(`/training/question-misses${old ? '?include_old=1' : ''}`, [old]);
  const needle = q.trim().toLowerCase();
  const courses = (data?.courses || []).filter(c => !needle
    || String(c.course_title || '').toLowerCase().includes(needle)
    || String(c.course_code || '').toLowerCase().includes(needle));
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));
  return (
    <div className="space-y-3" data-question-misses>
      <p className="text-sm text-gray-600 max-w-3xl">
        Every question on every test, with how many people got it wrong. Each person counts once, on their latest
        attempt. When most people miss a question <em>and</em> most of them chose the same other answer, it is
        flagged: that usually means the answer key is wrong, not the people. Check it in Courses → Edit test.
      </p>
      {data && (
        <p className="text-sm font-medium text-gray-800" data-key-check-total={data.key_checks}>
          {data.key_checks
            ? `${data.key_checks} question${data.key_checks === 1 ? '' : 's'} to check the answer key on`
            : 'No question looks like a wrong answer key.'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search course…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={old} onChange={e => setOld(e.target.checked)} data-misses-old />
          Include earlier versions of a test
        </label>
      </div>
      {error && <p className="text-sm text-red-700">{error.message || String(error)}</p>}
      {loading && !data && <p className="text-sm text-gray-400">Loading…</p>}
      {data && !courses.length && <p className="text-sm text-gray-400">No tests taken yet.</p>}
      {courses.map(c => {
        const missed = c.questions.filter(x => x.missed > 0);
        const clean = c.questions.length - missed.length;
        return (
          <div key={c.test_id} className="bg-white rounded-xl border border-gray-200" data-misses-course={c.course_code || c.course_title}>
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-semibold text-gray-900">{c.course_code ? `${c.course_code} · ` : ''}{c.course_title}</h3>
              {!c.is_current && <span className="text-xs text-gray-500">earlier version (V{c.version})</span>}
              <span className="text-xs text-gray-500">
                {c.people} {c.people === 1 ? 'person' : 'people'} · {c.attempts} attempt{c.attempts === 1 ? '' : 's'} · {c.passed_people} passed · pass mark {c.passing_score}%
              </span>
              {c.key_checks > 0 && (
                <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  Check the key on {c.key_checks} question{c.key_checks === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <ul className="divide-y divide-gray-100">
              {missed.map(x => {
                const k = `${c.test_id}:${x.question_id}`;
                return (
                  <li key={x.question_id} className="px-4 py-3 space-y-1.5" data-miss-q={x.number} data-miss-rate={x.miss_rate} data-key-check={x.key_check ? '1' : '0'}>
                    <p className="text-sm text-gray-900"><span className="font-medium">Q{x.number}.</span> {x.prompt}</p>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 max-w-xs bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${x.key_check ? 'bg-red-500' : x.miss_rate >= 50 ? 'bg-amber-500' : 'bg-gray-400'}`} style={{ width: `${x.miss_rate}%` }} />
                      </div>
                      <span className="text-xs text-gray-700 tabular-nums" data-miss-count>{x.missed} of {x.people} missed it ({x.miss_rate}%)</span>
                    </div>
                    <p className="text-xs text-gray-700">Answer key: <span className="font-medium" data-miss-expected>{x.expected ?? '—'}</span></p>
                    {x.top_wrong && (
                      <p className="text-xs text-gray-700">Most common wrong answer: <span className="font-medium" data-miss-top>{x.top_wrong.answer}</span> ({x.top_wrong.people} {x.top_wrong.people === 1 ? 'person' : 'people'})</p>
                    )}
                    {x.key_check && (
                      <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                        Most people missed this, and most of them chose “{x.top_wrong.answer}”. Check whether the answer key is right before anyone retakes it.
                      </p>
                    )}
                    <button type="button" onClick={() => toggle(k)} className="text-xs text-powder-700 hover:underline" data-miss-more>
                      {open[k] ? 'Hide who and what' : 'Show who and what'}
                    </button>
                    {open[k] && (
                      <div className="text-xs text-gray-700 space-y-1" data-miss-detail>
                        <p>Wrong answers: {x.wrong_answers.map(w => `${w.answer} (${w.people})`).join(' · ')}</p>
                        <p>Missed by: {x.missed_by.join(', ')}{x.missed > x.missed_by.length ? ` and ${x.missed - x.missed_by.length} more` : ''}</p>
                      </div>
                    )}
                  </li>
                );
              })}
              {clean > 0 && (
                <li className="px-4 py-2 text-xs text-gray-500">
                  {clean} question{clean === 1 ? '' : 's'} nobody missed.
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
