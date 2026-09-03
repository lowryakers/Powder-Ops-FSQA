import { useState, useMemo } from 'react';
import { useApiGet, apiPut, apiPost } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Search, Pause, Play, Save, X, CalendarClock, AlertTriangle, CalendarPlus } from 'lucide-react';
import { RecordCard, RecordCards } from '../common/RecordCards.jsx';
import { TASK_GROUPS } from '../../../shared/task-groups.js';
import { withCurrent } from '../../lib/managedList.js';

// The recurring schedules that generate work.
//
// THIS SCREEN DID NOT EXIST. `POST /pm/schedules` and `PUT /pm/schedules/:id`
// have been in the API all along and nothing in the client ever called them, so
// there was no way to see which schedules exist, what cadence they run at, or
// whether one had been paused — let alone to put a paused one back. "Where is
// the Restroom Daily Cleaning generated from, so I can get it back on a
// repeating schedule?" had no answer on any screen.
//
// A SCHEDULE IS NOT A TASK. The distinction this screen exists to make visible:
// a `pm_schedules` row is the recurring rule, and the work orders it generates
// are the individual jobs. Pausing the rule stops new work being raised and
// leaves anything already open alone — somebody may still need to close those
// out honestly. That is why the button says "Pause" and not "Delete", and why
// the count of open work orders is shown beside it.

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Every six months' },
  { value: 'annual', label: 'Annually' },
  { value: 'as_needed', label: 'As needed (generates nothing)' },
];


const freqLabel = (v) => FREQUENCIES.find(f => f.value === v)?.label || v || '—';

function EditRow({ schedule, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: schedule.title || '',
    frequency_type: schedule.frequency_type || 'daily',
    task_group: schedule.task_group || '',
    description: schedule.description || '',
    estimated_minutes: schedule.estimated_minutes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiPut(`/pm/schedules/${schedule.id}`, {
        ...form,
        task_group: form.task_group || null,
        estimated_minutes: form.estimated_minutes === '' ? null : Number(form.estimated_minutes),
      });
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const cls = 'w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <tr className="bg-powder-50/40">
      <td colSpan={6} className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Title</span>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={cls} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">How often</span>
            <select value={form.frequency_type} onChange={e => setForm(f => ({ ...f, frequency_type: e.target.value }))} className={cls}>
              {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Team</span>
            <select value={form.task_group} onChange={e => setForm(f => ({ ...f, task_group: e.target.value }))} className={cls}>
              <option value="">Nobody — reaches no team's list</option>
              {withCurrent(TASK_GROUPS, form.task_group).map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2 lg:col-span-3">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Description</span>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={cls} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Minutes (estimate)</span>
            <input type="number" min="0" value={form.estimated_minutes}
              onChange={e => setForm(f => ({ ...f, estimated_minutes: e.target.value }))} className={cls} />
          </label>
        </div>
        {/* The procedure steps are deliberately not editable here. They are the
            written work instruction, several screens' worth, and editing them in
            a table row is how a step gets lost. They are edited from the task. */}
        <p className="text-[11px] text-gray-500 mt-2">
          {(() => { try { return (JSON.parse(schedule.procedure_steps || '[]') || []).length; } catch { return 0; } })()} procedure
          step(s) — edited from the task itself, not here.
        </p>
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={save} disabled={busy || !form.title.trim()}
            className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50 flex items-center gap-1.5">
            <Save size={14} /> {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onCancel}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1.5"><X size={14} /> Cancel</button>
        </div>
      </td>
    </tr>
  );
}

export default function PMSchedulesPanel() {
  const { user } = useAuth() || {};
  const canEdit = user?.role === 'admin' || user?.role === 'supervisor';
  const [showPaused, setShowPaused] = useState(true);
  const [raised, setRaised] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // include_inactive_equipment so a schedule on a retired machine is still
  // findable — otherwise "my schedule vanished" has no explanation on screen.
  const { data: schedules, refresh } = useApiGet('/pm/schedules?include_inactive_equipment=true');
  const { data: openWork } = useApiGet('/pm/work-orders?status=open&limit=2000');

  // How many live work orders each schedule is carrying, so pausing one says
  // what it will and will not touch.
  const openBySchedule = useMemo(() => {
    const m = {};
    for (const w of openWork || []) if (w.pm_schedule_id) m[w.pm_schedule_id] = (m[w.pm_schedule_id] || 0) + 1;
    return m;
  }, [openWork]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (schedules || [])
      .filter(s => (showPaused ? true : s.is_active))
      .filter(s => !needle
        || String(s.title || '').toLowerCase().includes(needle)
        || String(s.equipment_name || '').toLowerCase().includes(needle)
        || String(s.task_group || '').toLowerCase().includes(needle))
      .sort((a, b) => (a.is_active === b.is_active ? 0 : a.is_active ? 1 : -1)
        || String(a.title).localeCompare(String(b.title)));
  }, [schedules, q, showPaused]);

  const paused = (schedules || []).filter(s => !s.is_active).length;
  const orphaned = (schedules || []).filter(s => s.is_active && !s.task_group).length;

  const togglePause = async (s) => {
    setBusyId(s.id);
    try { await apiPut(`/pm/schedules/${s.id}`, { is_active: !s.is_active }); refresh(); }
    finally { setBusyId(null); }
  };

  // A schedule can end up owing a day no task: a completion back-dated to an
  // earlier day used to advance the schedule past the day it did not cover, and
  // POST /pm/generate skips any schedule that already has a live task — so one
  // whose next task sits in the future looks healthy while the floor has
  // nothing to complete. This is the only way to fill that gap, and it belongs
  // here because this is the screen where somebody notices it.
  const raiseToday = async (s) => {
    const today = new Date().toLocaleDateString('en-CA');
    const when = window.prompt(
      `Raise a task for “${s.title}”.\n\nWhich day is it for? (YYYY-MM-DD)`, today);
    if (!when) return;
    setBusyId(s.id);
    try {
      const r = await apiPost(`/pm/schedules/${s.id}/raise`, { due_date: when.trim() });
      setRaised(r?.existing
        ? `${s.title}: a task for ${when.trim()} was already open — nothing new was raised.`
        : `${s.title}: task raised for ${when.trim()}.`);
      refresh();
    } catch (err) {
      setRaised(err?.message || 'That task could not be raised.');
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Recurring Schedules</h2>
        <p className="text-sm text-gray-500">
          The rules that generate work. Pausing one stops new tasks being raised and leaves anything
          already open alone.
        </p>
      </div>

      {raised && (
        <div className="bg-powder-50 border border-powder-200 rounded-xl p-3 flex items-start justify-between gap-3">
          <p className="text-sm text-powder-900">{raised}</p>
          <button type="button" onClick={() => setRaised('')} className="text-powder-700 shrink-0"><X size={14} /></button>
        </div>
      )}

      {orphaned > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{orphaned} active schedule{orphaned === 1 ? '' : 's'} with no team.</span>{' '}
            {orphaned === 1 ? 'It generates' : 'They generate'} work that reaches nobody&apos;s list by name.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Title, equipment or team…"
              className="w-full pl-8 pr-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={showPaused} onChange={e => setShowPaused(e.target.checked)} />
          Include paused{paused ? ` (${paused})` : ''}
        </label>
        <p className="w-full text-[11px] text-gray-500">{rows.length} schedule{rows.length === 1 ? '' : 's'}</p>
      </div>

      <RecordCards count={rows.length} empty="No schedules match.">
        {rows.map(s => editing === s.id ? (
          // The edit form is one cell spanning the row, so it lays out as a
          // form here too — no second copy of the form.
          <div key={s.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm"><tbody>
              <EditRow schedule={s} onSaved={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
            </tbody></table>
          </div>
        ) : (
          <RecordCard key={s.id} title={s.title} muted={!s.is_active}
            subtitle={`${s.equipment_name || '—'}${s.room ? ` · ${s.room}` : ''}`}
            badge={!s.is_active ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-700">PAUSED</span> : null}
            fields={[
              { label: 'How often', value: freqLabel(s.frequency_type) },
              { label: 'Team', value: s.task_group || <span className="text-amber-700 font-medium">nobody</span> },
              { label: 'Open now', value: String(openBySchedule[s.id] || 0) },
            ]}
            actions={canEdit ? <>
              <button type="button" onClick={() => setEditing(s.id)} className="text-xs font-medium text-powder-700 hover:underline">Edit</button>
              {s.is_active && (
                <button type="button" onClick={() => raiseToday(s)} disabled={busyId === s.id}
                  className="text-xs font-medium text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><CalendarPlus size={12} /> Raise task</button>
              )}
              <button type="button" onClick={() => togglePause(s)} disabled={busyId === s.id}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
                {s.is_active ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
              </button>
            </> : null} />
        ))}
      </RecordCards>
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[46rem]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 px-3">Schedule</th>
              <th className="py-2 px-3">Equipment / area</th>
              <th className="py-2 px-3">How often</th>
              <th className="py-2 px-3">Team</th>
              <th className="py-2 px-3">Open now</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-sm text-gray-400">No schedules match.</td></tr>
            )}
            {rows.map(s => (
              editing === s.id ? (
                <EditRow key={s.id} schedule={s}
                  onSaved={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
              ) : (
                <tr key={s.id} className={`border-b border-gray-100 ${s.is_active ? '' : 'bg-gray-50 text-gray-500'}`}>
                  <td className="py-2 px-3">
                    <span className="font-medium text-gray-900">{s.title}</span>
                    {!s.is_active && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-700">PAUSED</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-gray-600">{s.equipment_name || '—'}{s.room ? ` · ${s.room}` : ''}</td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-1 text-gray-700">
                      <CalendarClock size={13} className="text-gray-400" />{freqLabel(s.frequency_type)}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    {s.task_group
                      ? <span className="text-gray-700">{s.task_group}</span>
                      : <span className="text-amber-700 font-medium">nobody</span>}
                  </td>
                  <td className="py-2 px-3 tabular-nums text-gray-600">{openBySchedule[s.id] || 0}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => setEditing(s.id)}
                          className="px-2 py-1 text-xs font-medium text-powder-700 hover:underline">Edit</button>
                        {s.is_active && (
                          <button type="button" onClick={() => raiseToday(s)} disabled={busyId === s.id}
                            title="Raise the task for a day this schedule owes"
                            className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
                            <CalendarPlus size={12} /> Raise task
                          </button>
                        )}
                        <button type="button" onClick={() => togglePause(s)} disabled={busyId === s.id}
                          className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
                          {s.is_active ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
