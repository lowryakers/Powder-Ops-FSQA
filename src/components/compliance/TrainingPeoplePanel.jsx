// One person's training, which is the question actually asked of Document
// Control: "show me the assigned trainings for this individual."
//
// The Compliance Matrix already answers it for the whole plant as a grid —
// people down the side, courses across the top. A grid is a map; it is not an
// answer about Diana, and scanning one row of twenty cells to work out what
// somebody still owes is what sends people back to a spreadsheet.
//
// EVERY STATE HERE IS THE SERVER'S. `/training/people` and the matrix read the
// same walk (`cellFor`), so a count on this screen cannot disagree with the
// grid on the next tab — and nothing is re-decided in the browser.

import { useState, useMemo } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { Search, ChevronRight, AlertTriangle, Clock, CheckCircle2, FileText, MinusCircle } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';

// The reason a course applies, in the words somebody would use out loud.
// "Why am I being asked to do this" has an answer on the record instead of in
// somebody's head.
const WHY = {
  everyone: 'Everyone',
  role: 'Their role',
  department: 'Their department',
  position: 'The job they hold',
  named: 'Added for them by name',
  exempt: 'Exempted by name',
};

const STATE = {
  missing: { label: 'Not yet trained', cls: 'bg-gray-100 text-gray-700', Icon: AlertTriangle },
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700', Icon: AlertTriangle },
  due_soon: { label: 'Due soon', cls: 'bg-amber-100 text-amber-800', Icon: Clock },
  outdated: { label: 'Document changed', cls: 'bg-amber-100 text-amber-800', Icon: FileText },
  current: { label: 'Current', cls: 'bg-green-100 text-green-700', Icon: CheckCircle2 },
  exempt: { label: 'Exempt', cls: 'bg-gray-100 text-gray-400', Icon: MinusCircle },
};

function StatePill({ state }) {
  const s = STATE[state] || STATE.missing;
  const Icon = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`} data-training-state={state}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

function PersonDetail({ userId, onClose, onChanged }) {
  const { data, loading, refresh } = useApiGet(userId ? `/training/people/${userId}` : null);
  const [busy, setBusy] = useState(null);

  const setRule = async (courseId, rule) => {
    setBusy(courseId);
    try {
      if (rule === null) await apiFetch(`/training/courses/${courseId}/requirements/${userId}`, { method: 'DELETE' });
      else await apiFetch(`/training/courses/${courseId}/requirements`, { method: 'POST', body: JSON.stringify({ user_id: userId, rule }) });
      refresh(); onChanged?.();
    } catch (e) { window.alert(e.message); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading…</div>;
  if (!data) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-training-person={data.user.name}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-lg font-bold text-gray-900">{data.user.name}</p>
          <p className="text-xs text-gray-500 capitalize">{data.user.role}{data.user.department ? ` · ${data.user.department}` : ''}</p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800">Close</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Applies to them', value: data.applies },
          { label: 'Still owed', value: data.outstanding, tone: data.outstanding ? 'text-amber-600' : 'text-gray-900' },
          { label: 'Assigned now', value: data.assigned_open },
          { label: 'Current', value: data.counts.current, tone: 'text-green-700' },
        ].map(c => (
          <div key={c.label} className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-xl font-bold ${c.tone || 'text-gray-900'}`} data-person-card={c.label}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_auto_10rem_8rem] gap-2 bg-gray-50 px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase">
          <span>Course</span><span>State</span><span>Why it applies</span><span></span>
        </div>
        <div className="divide-y divide-gray-100">
          {data.rows.map(r => (
            <div key={r.course_id} className="sm:grid sm:grid-cols-[1fr_auto_10rem_8rem] gap-2 px-3 py-2 items-center" data-person-course={r.code || r.title}>
              <div className="min-w-0">
                <p className="text-sm text-gray-900">{r.code ? <span className="font-semibold">{r.code}</span> : null} {r.title}</p>
                <p className="text-[11px] text-gray-500">
                  {/* The document, and the revision SHE trained against —
                      never the document's current one, which would read as a
                      claim about what she was taught. */}
                  {r.document ? <>{r.document.doc_number}{r.sop_revision ? ` ${r.sop_revision}` : ''} · </> : null}
                  {r.completion_date ? `completed ${formatDate(r.completion_date)}` : 'no completion on record'}
                  {r.next_due_date ? ` · due ${formatDate(r.next_due_date)}` : ''}
                </p>
                {r.state === 'outdated' && (
                  <p className="text-[11px] text-amber-700">
                    Trained against {r.sop_revision}; the document is now {r.current_revision}.
                  </p>
                )}
                {r.assignment && (
                  <p className={`text-[11px] ${r.assignment.overdue ? 'text-red-600' : 'text-powder-700'}`}>
                    Assigned, due {formatDate(r.assignment.due_date)}{r.assignment.overdue ? ' — overdue' : ''}
                  </p>
                )}
              </div>
              <div className="mt-1 sm:mt-0"><StatePill state={r.state} /></div>
              <p className="text-[11px] text-gray-500 mt-1 sm:mt-0">{WHY[r.why] || r.why}</p>
              <div className="mt-1 sm:mt-0 sm:text-right">
                {r.why === 'exempt' || r.why === 'named' ? (
                  <button type="button" disabled={busy === r.course_id} onClick={() => setRule(r.course_id, null)}
                    className="text-[11px] text-gray-500 hover:text-gray-800 disabled:opacity-50">Remove exception</button>
                ) : (
                  <button type="button" disabled={busy === r.course_id} onClick={() => setRule(r.course_id, 'exempt')}
                    className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-50">Exempt</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        An exemption is a decision about one person and is recorded with your name against it. Removing it
        puts the course back under whatever rule the course itself carries.
      </p>
    </div>
  );
}

export default function TrainingPeoplePanel() {
  const { data, loading, refresh } = useApiGet('/training/people');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [openId, setOpenId] = useState(null);

  const departments = useMemo(() => {
    const set = new Set((data || []).map(p => p.department).filter(Boolean));
    return ['all', ...[...set].sort()];
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return (data || []).filter(p => {
      if (dept !== 'all' && p.department !== dept) return false;
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, dept]);

  if (loading) return <div className="text-center py-8 text-gray-500">Loading people…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={dept} onChange={e => setDept(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white capitalize">
          {departments.map(d => <option key={d} value={d}>{d === 'all' ? 'Every department' : d}</option>)}
        </select>
        <div className="relative w-full sm:w-64 sm:ml-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
      </div>

      {openId && <PersonDetail userId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-[1fr_4rem_4rem_4rem] sm:grid-cols-[1fr_8rem_6rem_6rem_6rem_2rem] gap-2 bg-gray-50 px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase">
          <span>Person</span>
          <span className="hidden sm:block">Department</span>
          <span>Applies</span><span>Owed</span>
          <span className="hidden sm:block">Assigned</span>
          <span className="hidden sm:block"></span>
        </div>
        <div className="divide-y divide-gray-100">
          {rows.map(p => (
            <button type="button" key={p.id} onClick={() => setOpenId(p.id === openId ? null : p.id)}
              data-training-person-row={p.name}
              className={`w-full text-left grid grid-cols-[1fr_4rem_4rem_4rem] sm:grid-cols-[1fr_8rem_6rem_6rem_6rem_2rem] gap-2 px-3 py-2 items-center hover:bg-gray-50 ${p.id === openId ? 'bg-powder-50' : ''}`}>
              <span className="text-sm text-gray-900 truncate">{p.name}</span>
              <span className="hidden sm:block text-xs text-gray-500 capitalize truncate">{p.department || '—'}</span>
              <span className="text-sm text-gray-700 tabular-nums">{p.applies}</span>
              <span className={`text-sm font-semibold tabular-nums ${p.outstanding ? 'text-amber-600' : 'text-gray-400'}`}>{p.outstanding}</span>
              <span className="hidden sm:block text-sm text-gray-700 tabular-nums">{p.assigned_open}</span>
              <ChevronRight size={14} className="hidden sm:block text-gray-300" />
            </button>
          ))}
          {rows.length === 0 && <p className="px-3 py-6 text-center text-gray-500 text-sm">Nobody matches.</p>}
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        &ldquo;Owed&rdquo; counts what is not yet trained, overdue, due soon, or trained against a document
        that has since changed. Guest accounts are not on this list — they hold no modules and reach no task.
      </p>
    </div>
  );
}
