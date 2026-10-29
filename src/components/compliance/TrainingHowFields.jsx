// How somebody was trained (D-264): method, trainer, language, the trainer's
// statement of competence, the document revision and the change request.
// One component, used by the single-record form AND the session form, so the
// two cannot ask for different things.
import { useEffect, useMemo, useState } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { Video, FileText } from 'lucide-react';
import {
  METHODS, LEGACY_METHODS, LANGUAGES, methodLabel, languageLabel, COMPETENCE_TICK,
} from '../../../shared/training-record-fields.js';
import { formatDateTime } from '../../lib/datetime';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

/**
 * `quizPassed` — the record already carries a passed quiz, so the tick is not
 * needed. `group` — the session form, where the tick covers each attendee
 * without a passing score.
 */
export function HowTrainedFields({ value, onChange, legacyMethod = null, quizPassed = false, group = false }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const { data: dcrs } = useApiGet('/training/change-requests');
  return (
    <div className="grid grid-cols-2 gap-3" data-how-trained>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Method *</label>
        <select required value={value.method || ''} onChange={e => set('method', e.target.value)} className={inputCls} data-field="method">
          {!value.method && <option value="">— Select —</option>}
          {/* An older record keeps the value it was filed with; it is shown, not offered for new ones. */}
          {legacyMethod && LEGACY_METHODS[legacyMethod] && <option value={legacyMethod}>{LEGACY_METHODS[legacyMethod]}</option>}
          {METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Language</label>
        <select value={value.language || ''} onChange={e => set('language', e.target.value)} className={inputCls} data-field="language">
          <option value="">Not recorded</option>
          {LANGUAGES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1">Trainer</label>
        <input value={value.trainer || ''} onChange={e => set('trainer', e.target.value)} className={inputCls} data-field="trainer" />
      </div>
      <label className={`col-span-2 flex items-start gap-2 rounded-lg border p-2.5 text-sm text-gray-700 ${
        quizPassed || value.competence_confirmed ? 'border-gray-200 bg-gray-50' : 'border-amber-300 bg-amber-50'}`} data-field="competence">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={!!value.competence_confirmed}
          onChange={e => set('competence_confirmed', e.target.checked)} />
        <span>
          <span className="font-medium">&ldquo;{COMPETENCE_TICK}&rdquo;</span>
          <span className="block text-[11px] text-gray-500 mt-0.5">
            {quizPassed
              ? 'Not needed — this record has a passed quiz.'
              : group
                ? 'The trainer ticks this. Required for everyone on this session who did not pass a quiz.'
                : 'The trainer ticks this. Required unless the record has a passed quiz — a record cannot be saved without one or the other.'}
          </span>
        </span>
      </label>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Document revision trained on</label>
        <input value={value.sop_revision || ''} onChange={e => set('sop_revision', e.target.value)} className={inputCls}
          placeholder="The document's current revision" data-field="sop_revision" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Change request (DCR)</label>
        <select value={value.dcr_id || ''} onChange={e => set('dcr_id', e.target.value)} className={inputCls} data-field="dcr_id">
          <option value="">None</option>
          {(dcrs || []).map(d => (
            <option key={d.id} value={d.id}>
              {[d.record_number, d.doc_number, d.doc_name, d.revision ? `rev ${d.revision}` : null].filter(Boolean).join(' · ')}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** "Recorded 29 Oct 2026 2:14 PM by Daniela Servin" — the system's half, read-only. */
export function RecordedLine({ record }) {
  if (!record?.created_at) return null;
  return (
    <p className="text-xs text-gray-500" data-recorded-line>
      Recorded {formatDateTime(record.created_at)}{record.recorded_by ? ` by ${record.recorded_by}` : ''}. Set by ReadyDoc; it cannot be edited.
    </p>
  );
}

/** Method and language as a short line, with the missing-statement flag. */
export function HowChips({ record }) {
  const missing = !record.competence_statement && !record.test_attempt_id && !(record.score != null && record.passed);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-xs text-gray-600">{methodLabel(record.method)}</span>
      {record.language && <span className="text-[11px] text-gray-400">· {languageLabel(record.language)}</span>}
      {missing && (
        <span className="text-[10px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-full" data-competence-missing>
          no competence statement
        </span>
      )}
    </span>
  );
}

const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

/** The course's videos and handouts, on the trainee's own task (D-264). */
export function TaskMaterials({ workOrderId, lang = 'en' }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    apiFetch(`/pm/work-orders/${workOrderId}/training-materials`).then(r => { if (live) setItems(r || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [workOrderId]);
  if (!items?.length) return null;
  return (
    <div className="space-y-2" data-task-materials>
      <p className="text-xs font-semibold text-gray-700">{lang === 'es' ? 'Material del curso' : 'Course material'}</p>
      {items.map(m => (
        <div key={m.id} className="rounded-lg border border-gray-200 bg-white p-2">
          {m.is_video && m.url && <video src={m.url} controls playsInline preload="metadata" className="w-full max-h-64 rounded bg-black" data-task-video />}
          <div className="flex items-center gap-2 mt-1">
            {m.is_video ? <Video size={14} className="text-powder-600 shrink-0" /> : <FileText size={14} className="text-powder-600 shrink-0" />}
            <a href={m.url || undefined} target="_blank" rel="noreferrer" className="text-sm text-gray-800 truncate hover:underline flex-1">{m.title || m.filename}</a>
            <span className="text-[10px] text-gray-400 shrink-0">{fmtBytes(m.size)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Training sessions, newest first (D-264). "Show me the attendance for the
 * 12 March GMP refresher" is one row here: the course, the document revision,
 * the change request, how and by whom, and every attendee.
 */
export function TrainingSessions() {
  const { data, loading } = useApiGet('/training/sessions');
  const [open, setOpen] = useState(null);
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!data?.length) {
    return <p className="text-sm text-gray-500 bg-white rounded-xl border border-gray-200 p-6 text-center">
      No sessions yet. A session is saved each time training is recorded for a group (Group training, or a group sign-in sheet).
    </p>;
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100" data-sessions>
      {data.map(s => {
        const missing = !s.competence_statement;
        return (
          <div key={s.id} className="px-4 py-3">
            <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full text-left" data-session={s.id}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-gray-900">{s.training_date}</span>
                <span className="text-sm text-gray-800">{s.course_code ? `${s.course_code} — ` : ''}{s.course_title}</span>
                <span className="text-xs text-gray-500">{s.attendee_count} {s.attendee_count === 1 ? 'person' : 'people'}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                <span>{methodLabel(s.method)}{s.language ? ` · ${languageLabel(s.language)}` : ''}</span>
                {s.trainer && <span>Trainer: {s.trainer}</span>}
                {(s.doc_number || s.sop_revision) && <span>{s.doc_number || 'Document'}{s.sop_revision ? ` rev ${s.sop_revision}` : ''}</span>}
                {s.dcr_number && <span>DCR {s.dcr_number}</span>}
                <span>Recorded {String(s.created_at || '').slice(0, 10)}{s.recorded_by ? ` by ${s.recorded_by}` : ''}</span>
                {missing && <span className="text-amber-800">no competence statement</span>}
              </div>
            </button>
            {open === s.id && (
              <div className="mt-2 space-y-1">
                {s.competence_statement && <p className="text-xs text-gray-600 italic">&ldquo;{s.competence_statement}&rdquo;</p>}
                <ul className="text-sm text-gray-700 columns-[14rem]">
                  {s.attendees.map(a => (
                    <li key={a.id}>{a.employee_name}{a.score != null ? ` · ${a.score}%` : ''}{a.passed === 0 ? ' · did not pass' : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const pretty = (s) => String(s || '').replace(/_/g, ' ');

/**
 * Who was trained, for the group entry and Group Sheets (D-270): filter by
 * department and role, "Select all" ticks everyone the filters show, then
 * untick the people who were not there. Picking by who a document revision
 * affects is NOT built — course–document links are being corrected first.
 *
 * Trainees only: inactive, outside-client and not-a-trainee accounts (bots)
 * are never offered. `isChecked(id)` / `setChecked(users, on)` keep the
 * caller's own selection shape.
 */
export function PeoplePicker({ users, isChecked, setChecked, renderExtra = null, heightCls = 'max-h-56' }) {
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [role, setRole] = useState('');
  const pool = useMemo(() => (users || []).filter(u => u.is_active !== 0 && !u.is_external && !u.not_trainee), [users]);
  const depts = useMemo(() => [...new Set(pool.map(u => u.department).filter(Boolean))].sort(), [pool]);
  const roles = useMemo(() => [...new Set(pool.map(u => u.role).filter(Boolean))].sort(), [pool]);
  const shown = useMemo(() => pool.filter(u =>
    (!dept || u.department === dept) && (!role || u.role === role)
    && (!search || u.name.toLowerCase().includes(search.toLowerCase()))), [pool, dept, role, search]);
  const ticked = pool.filter(u => isChecked(u.id)).length;
  const allShownTicked = shown.length > 0 && shown.every(u => isChecked(u.id));
  const sel = 'px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white';
  return (
    <div data-people-picker>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
        <span className="text-xs font-medium text-gray-700" data-picked-count>{ticked} selected</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <select value={dept} onChange={e => setDept(e.target.value)} className={sel} data-filter-dept aria-label="Department">
            <option value="">All departments</option>
            {depts.map(d => <option key={d} value={d} className="capitalize">{pretty(d)}</option>)}
          </select>
          <select value={role} onChange={e => setRole(e.target.value)} className={sel} data-filter-role aria-label="Role">
            <option value="">All roles</option>
            {roles.map(r => <option key={r} value={r}>{pretty(r)}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className={`${sel} w-28`} />
        </div>
      </div>
      <div className="flex items-center gap-3 mb-1 text-xs">
        <button type="button" data-select-all disabled={!shown.length || allShownTicked}
          onClick={() => setChecked(shown, true)} className="text-powder-700 font-medium hover:underline disabled:text-gray-300 disabled:no-underline">
          Select all{dept || role || search ? ` ${shown.length} shown` : ` (${shown.length})`}
        </button>
        <button type="button" data-clear-all disabled={!ticked}
          onClick={() => setChecked(pool.filter(u => isChecked(u.id)), false)} className="text-gray-500 hover:underline disabled:text-gray-300 disabled:no-underline">
          Clear
        </button>
      </div>
      <div className={`border border-gray-200 rounded-lg divide-y divide-gray-100 ${heightCls} overflow-y-auto`}>
        {shown.map(u => (
          <div key={u.id} className="flex items-center gap-2 px-3 py-1.5" data-person={u.name}>
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={!!isChecked(u.id)} onChange={() => setChecked([u], !isChecked(u.id))} />
            <span className="flex-1 text-sm text-gray-800">{u.name} <span className="text-[11px] text-gray-400 capitalize">{pretty(u.department)}{u.role ? ` · ${pretty(u.role)}` : ''}</span></span>
            {renderExtra && isChecked(u.id) && renderExtra(u)}
          </div>
        ))}
        {shown.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No matching people.</p>}
      </div>
    </div>
  );
}
