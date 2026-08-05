import { useState, useRef, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CustomFields, CustomFieldValues } from '../common/CustomFields';
import FormatBar from '../common/FormatBar';
import { useFormatKeys } from '../../lib/useFormatKeys.js';
import RichText from '../common/RichText';
import {
  Users, Plus, X, CalendarClock, MapPin, Download, CheckCircle2, RotateCcw,
  ArrowLeft, Trash2, CircleDot, ClipboardList, ChevronRight,
} from 'lucide-react';

// Meetings — management review, food safety team, production, safety.
//
// The list is a register; the work happens on one meeting at a time, so a row
// opens the record rather than expanding a detail strip. Three things this
// screen is careful about:
//
//   · An ACTION ITEM IS A TASK. Adding one creates a work order in Task
//     Center and shows its live status here. There is no second to-do list.
//   · ATTENDANCE IS MARKED, not assumed. Everyone on the list starts unmarked
//     and someone ticks who was actually in the room.
//   · APPROVED MINUTES ARE READ-ONLY. The server decides that (can_edit) and
//     this renders what it's told, rather than keeping its own copy of the rule.

const todayStr = () => new Date().toISOString().split('T')[0];

const STATUS_CHIP = {
  scheduled: 'bg-gray-100 text-gray-600',
  held: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
};
const STATUS_LABEL = { scheduled: 'Scheduled', held: 'Held — minutes draft', approved: 'Approved' };

const TASK_CHIP = {
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-700',
  missed: 'bg-red-100 text-red-700',
  in_progress: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-gray-100 text-gray-500',
  not_applicable: 'bg-gray-100 text-gray-500',
};

// Teams a meeting action can land in. Matches Task Center's groups.
const TASK_GROUPS = [
  ['office', 'Office'], ['qa', 'Quality'], ['maintenance', 'Maintenance'],
  ['sanitation', 'Sanitation'], ['warehouse', 'Warehouse'],
  ['production', 'Production'], ['document_control', 'Document Control'],
];

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

/* ── New meeting ─────────────────────────────────────────────────────────── */

function NewMeetingModal({ types, onClose, onCreated }) {
  const [form, setForm] = useState({
    meeting_type: types[0]?.value || 'Management Review',
    title: '', meeting_date: todayStr(), start_time: '', location: '', chair: '',
  });
  const [custom, setCustom] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true); setError('');
    try {
      // The type is the usual title, so nobody has to type "Management Review"
      // twice to file the record they came to file.
      const created = await apiPost('/meetings', {
        ...form, title: form.title.trim() || form.meeting_type, custom_data: custom,
      });
      onCreated(created);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">New meeting</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Type *">
            <select value={form.meeting_type} onChange={e => set('meeting_type', e.target.value)} className={input}>
              {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Title">
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder={form.meeting_type} className={input} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date *">
              <input type="date" value={form.meeting_date} onChange={e => set('meeting_date', e.target.value)} className={input} />
            </Field>
            <Field label="Start time">
              <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} className={input} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Conference room" className={input} />
            </Field>
            <Field label="Chaired by">
              <input value={form.chair} onChange={e => set('chair', e.target.value)} className={input} />
            </Field>
          </div>
          <CustomFields scope="meeting" values={custom} onChange={setCustom} />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving || !form.meeting_date}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Attendance ──────────────────────────────────────────────────────────── */

function Attendance({ attendees, users, editable, onChange }) {
  const [adding, setAdding] = useState('');
  const present = attendees.filter(a => a.present).length;

  const add = (name, userId) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    if (attendees.some(a => a.name.toLowerCase() === clean.toLowerCase())) return;
    onChange([...attendees, { user_id: userId || null, name: clean, present: false }]);
    setAdding('');
  };

  return (
    <section>
      <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <Users size={15} className="text-gray-400" /> Attendance
        <span className="text-xs font-normal text-gray-500">{present} of {attendees.length} present</span>
      </h4>
      {attendees.length === 0 && <p className="text-xs text-gray-500 mb-2">Nobody added yet.</p>}
      <ul className="space-y-1 mb-2">
        {attendees.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!a.present} disabled={!editable}
              onChange={() => onChange(attendees.map((x, j) => j === i ? { ...x, present: !x.present } : x))} />
            <span className={a.present ? 'text-gray-900' : 'text-gray-500'}>{a.name}</span>
            {editable && (
              <button onClick={() => onChange(attendees.filter((_, j) => j !== i))}
                className="ml-auto text-gray-300 hover:text-red-500" data-tip="Remove"><X size={13} /></button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex gap-2">
          <input list="meeting-people" value={adding} onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const u = users?.find(x => x.name === adding); add(adding, u?.id); } }}
            placeholder="Add a person" className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <datalist id="meeting-people">{(users || []).map(u => <option key={u.id} value={u.name} />)}</datalist>
          <button onClick={() => { const u = users?.find(x => x.name === adding); add(adding, u?.id); }}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">Add</button>
        </div>
      )}
    </section>
  );
}

/* ── Action items ────────────────────────────────────────────────────────── */

function Actions({ meeting, actions, editable, users, onChanged }) {
  const [form, setForm] = useState({ description: '', owner: '', due_date: '', task_group: 'office' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = async () => {
    setBusy(true); setError('');
    try {
      await apiPost(`/meetings/${meeting.id}/actions`, form);
      setForm({ description: '', owner: '', due_date: '', task_group: form.task_group });
      await onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (a) => {
    if (!confirm('Remove this action item?')) return;
    await apiDelete(`/meetings/actions/${a.id}`);
    await onChanged();
  };

  return (
    <section>
      <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <ClipboardList size={15} className="text-gray-400" /> Action items
        <span className="text-xs font-normal text-gray-500">tracked in Task Center</span>
      </h4>
      {actions.length === 0 && <p className="text-xs text-gray-500 mb-2">No actions assigned.</p>}
      <ul className="space-y-1.5 mb-3">
        {actions.map(a => (
          <li key={a.id} className="flex items-start gap-2 text-sm border border-gray-100 rounded-lg p-2">
            {a.task_status === 'completed'
              ? <CheckCircle2 size={15} className="text-green-600 mt-0.5 shrink-0" />
              : <CircleDot size={15} className="text-gray-300 mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-gray-900">{a.description}</p>
              <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2">
                <span>{a.owner || 'Unassigned'}</span>
                <span>due {a.due_date || '—'}</span>
                <span className={`px-1.5 py-0.5 rounded ${TASK_CHIP[a.task_status] || 'bg-gray-100 text-gray-600'}`}>
                  {(a.task_status || 'no task').replace('_', ' ')}
                </span>
                {a.carried_from && <span className="text-amber-700">carried forward</span>}
              </p>
            </div>
            {editable && (
              <button onClick={() => remove(a)} className="text-gray-300 hover:text-red-500" data-tip="Remove"><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
          <input value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="What needs to happen" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input list="meeting-people" value={form.owner} onChange={e => set('owner', e.target.value)}
              placeholder="Owner" className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
            <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
            <select value={form.task_group} onChange={e => set('task_group', e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
              {TASK_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <datalist id="meeting-people">{(users || []).map(u => <option key={u.id} value={u.name} />)}</datalist>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={add} disabled={busy || !form.description.trim() || !form.due_date}
            className="px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Assigning…' : 'Assign action'}
          </button>
          <p className="text-[11px] text-gray-500">A due date is required — an action without one is a note, and it won't reach anyone's task list.</p>
        </div>
      )}
    </section>
  );
}

/* ── One meeting ─────────────────────────────────────────────────────────── */

function MeetingDetail({ id, onBack, onChanged }) {
  const { user } = useAuth();
  const { data: meeting, refresh } = useApiGet(`/meetings/${id}`, [id]);
  const { data: users } = useApiGet('/users');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nextDate, setNextDate] = useState('');
  const minutesRef = useRef(null);

  const editable = !!meeting?.can_edit;
  // The unsaved edits, falling back to what's stored.
  const val = (k) => (draft && k in draft ? draft[k] : meeting?.[k]);
  const set = (k, v) => setDraft(d => ({ ...(d || {}), [k]: v }));

  // Same formatting keys as the comms composer and the newsletter.
  const minutesKeys = useFormatKeys({
    getEl: () => minutesRef.current,
    value: val('minutes') || '',
    onChange: (v) => set('minutes', v),
    enabled: editable,
  });

  const reload = async () => { setDraft(null); await refresh(); onChanged?.(); };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError('');
    try {
      // Filing minutes is what moves a meeting from scheduled to held; nobody
      // should have to remember to change a status field as well.
      const patch = { ...draft };
      if (meeting.status === 'scheduled' && String(patch.minutes ?? meeting.minutes ?? '').trim()) patch.status = 'held';
      await apiPut(`/meetings/${id}`, patch);
      await reload();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const approve = async () => {
    setError('');
    try { await apiPost(`/meetings/${id}/approve`, {}); await reload(); }
    catch (e) { setError(e.message); }
  };
  const revoke = async () => {
    if (!confirm('Revoke the approval so the minutes can be corrected?')) return;
    try { await apiDelete(`/meetings/${id}/approve`); await reload(); }
    catch (e) { setError(e.message); }
  };
  const scheduleNext = async () => {
    setError('');
    try {
      const created = await apiPost(`/meetings/${id}/next`, { meeting_date: nextDate });
      setNextDate('');
      onChanged?.();
      onBack(created.id);
    } catch (e) { setError(e.message); }
  };
  // Straight fetch, not apiFetch — that one parses JSON, and this is a PDF.
  const downloadPdf = async () => {
    const t = localStorage.getItem('auth_token');
    const r = await fetch(`/api/meetings/${id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) { setError('Could not build the PDF.'); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `Minutes_${meeting.meeting_date}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (!meeting) return <p className="text-sm text-gray-500">Loading…</p>;
  const attendees = val('attendees') || [];
  const agenda = val('agenda') || [];
  // Offered only once there are minutes to approve — the server refuses
  // otherwise, and a button whose only outcome is an error message is worse
  // than no button.
  const canApprove = meeting.status !== 'approved' && String(meeting.minutes || '').trim()
    && (user?.role === 'admin' || user?.role === 'supervisor'
      || (meeting.chair || '').trim().toLowerCase() === (user?.name || '').trim().toLowerCase());

  return (
    <div className="space-y-5 max-w-3xl">
      <button onClick={() => onBack()} className="flex items-center gap-1 text-sm text-powder-600 hover:underline">
        <ArrowLeft size={15} /> All meetings
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{meeting.title}</h2>
          <p className="text-sm text-gray-500 flex flex-wrap items-center gap-x-3">
            <span>{meeting.meeting_type}</span>
            <span className="flex items-center gap-1"><CalendarClock size={13} /> {meeting.meeting_date}{meeting.start_time ? ` · ${meeting.start_time}` : ''}</span>
            {meeting.location && <span className="flex items-center gap-1"><MapPin size={13} /> {meeting.location}</span>}
            {meeting.chair && <span>chaired by {meeting.chair}</span>}
          </p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CHIP[meeting.status]}`}>
          {STATUS_LABEL[meeting.status]}
        </span>
      </div>

      {meeting.status === 'approved' && (
        <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded-lg p-2.5">
          Approved by <span className="font-semibold">{meeting.approved_by}</span> on {String(meeting.approved_at || '').slice(0, 10)}.
          {meeting.edit_block_reason && !meeting.can_edit && ' Revoke the approval to correct them.'}
        </p>
      )}
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}

      <Attendance attendees={attendees} users={users} editable={editable} onChange={v => set('attendees', v)} />

      <section>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Agenda</h4>
        {agenda.length === 0 && !editable && <p className="text-xs text-gray-500">No agenda recorded.</p>}
        <ul className="space-y-1">
          {agenda.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400 text-xs w-4">{i + 1}.</span>
              {editable
                ? <input value={item} onChange={e => set('agenda', agenda.map((x, j) => j === i ? e.target.value : x))}
                    className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm" />
                : <span className="text-gray-800">{item}</span>}
              {editable && <button onClick={() => set('agenda', agenda.filter((_, j) => j !== i))}
                className="text-gray-300 hover:text-red-500"><X size={13} /></button>}
            </li>
          ))}
        </ul>
        {editable && (
          <button onClick={() => set('agenda', [...agenda, ''])}
            className="mt-1.5 flex items-center gap-1 text-xs text-powder-600 hover:underline"><Plus size={13} /> Add agenda item</button>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-sm font-semibold text-gray-900">Minutes</h4>
          {editable && <FormatBar getEl={() => minutesRef.current} value={val('minutes') || ''} onChange={v => set('minutes', v)} />}
        </div>
        {editable ? (
          <textarea ref={minutesRef} rows={10} value={val('minutes') || ''} onChange={e => set('minutes', e.target.value)}
            placeholder="What was discussed and decided." onKeyDown={minutesKeys}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-normal" />
        ) : (
          String(meeting.minutes || '').trim()
            ? <RichText text={meeting.minutes} className="text-sm text-gray-800 space-y-2" />
            : <p className="text-xs text-gray-500">No minutes recorded.</p>
        )}
      </section>

      <Actions meeting={meeting} actions={meeting.actions || []} editable={editable} users={users} onChanged={reload} />

      <CustomFieldValues scope="meeting" data={meeting.custom_data} />

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
        {editable && (
          <button onClick={save} disabled={saving || !draft}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {canApprove && (
          <button onClick={approve} className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
            <CheckCircle2 size={15} /> Approve minutes
          </button>
        )}
        {meeting.status === 'approved' && (
          <button onClick={revoke} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            <RotateCcw size={15} /> Revoke approval
          </button>
        )}
        <button onClick={downloadPdf} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
          <Download size={15} /> Minutes PDF
        </button>
        <span className="flex items-center gap-1.5 ml-auto">
          <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <button onClick={scheduleNext} disabled={!nextDate}
            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
            data-tip="Creates the next meeting and carries open actions forward">
            Schedule next
          </button>
        </span>
      </div>
    </div>
  );
}

/* ── Register ────────────────────────────────────────────────────────────── */

export default function MeetingsPanel() {
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const query = [type && `type=${encodeURIComponent(type)}`, status && `status=${status}`].filter(Boolean).join('&');
  const { data: meetings, loading, refresh } = useApiGet(`/meetings${query ? `?${query}` : ''}`, [type, status]);
  const { data: typeList } = useApiGet('/structure/lists/meeting_types');
  const types = useMemo(() => (typeList?.options || []).map(o => ({ value: o.value, label: o.label })), [typeList]);

  if (openId) return <MeetingDetail id={openId} onBack={(id) => setOpenId(id || null)} onChanged={refresh} />;

  const rows = meetings || [];
  // A meeting that has come and gone with no minutes is the gap worth naming —
  // an SQF management review nobody wrote up is the same as one nobody held.
  const needMinutes = rows.filter(m => m.status === 'scheduled' && m.meeting_date < todayStr());

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Meetings</h2>
          <p className="text-sm text-gray-500">{rows.length} meeting{rows.length === 1 ? '' : 's'} · minutes, attendance and the actions that came out of them</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
          <Plus size={16} /> New meeting
        </button>
      </div>

      {needMinutes.length > 0 && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <span className="font-semibold">{needMinutes.length}</span> meeting{needMinutes.length === 1 ? ' has' : 's have'} passed
          with no minutes recorded.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={e => setType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">All types</option>
          {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">Any status</option>
          <option value="scheduled">Scheduled</option>
          <option value="held">Held — minutes draft</option>
          <option value="approved">Approved</option>
        </select>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-8 text-center">
          No meetings recorded yet.
        </p>
      )}

      <div className="space-y-2">
        {rows.map(m => (
          <button key={m.id} onClick={() => setOpenId(m.id)}
            className="w-full text-left border border-gray-200 rounded-xl p-3 hover:bg-gray-50 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900 truncate">{m.title}</p>
              <p className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2.5">
                <span>{m.meeting_type}</span>
                <span>{m.meeting_date}</span>
                <span>{(m.attendees || []).filter(a => a.present).length} attended</span>
                {m.action_count > 0 && (
                  <span className={m.open_action_count > 0 ? 'text-amber-700 font-medium' : ''}>
                    {m.open_action_count > 0 ? `${m.open_action_count} of ${m.action_count} actions open` : `${m.action_count} actions done`}
                  </span>
                )}
              </p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_CHIP[m.status]}`}>
              {STATUS_LABEL[m.status]}
            </span>
            <ChevronRight size={16} className="text-gray-300 shrink-0" />
          </button>
        ))}
      </div>

      {creating && (
        <NewMeetingModal types={types} onClose={() => setCreating(false)}
          onCreated={(m) => { setCreating(false); refresh(); setOpenId(m.id); }} />
      )}
    </div>
  );
}
