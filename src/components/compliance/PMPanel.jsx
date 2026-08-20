import { useState, useEffect } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, CheckCircle, Wrench, ChevronDown, ChevronUp, Archive, Paperclip, Download, Search, Users, AlertTriangle, ShieldCheck, Flag, Eye, Droplets, Thermometer, X, ListChecks, QrCode, CalendarClock, Repeat } from 'lucide-react';
import KioskQrModal from '../kiosk/KioskQrModal';
import FileUpload from '../FileUpload';
import { deptLabel } from '../../constants/departments';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { exportToCsv } from '../../utils/exportCsv';
import { formatDateTime } from '../../lib/datetime.js';
import FormChip from '../common/FormChip';

const FREQ_TABS = [
  { value: 'all', label: 'All' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
  { value: 'unscheduled', label: 'Submitted' },
];

const FREQ_COLORS = {
  daily: 'bg-blue-100 text-blue-800',
  weekly: 'bg-purple-100 text-purple-800',
  monthly: 'bg-amber-100 text-amber-800',
  quarterly: 'bg-emerald-100 text-emerald-800',
  semi_annual: 'bg-cyan-100 text-cyan-800',
  annual: 'bg-rose-100 text-rose-800',
  unscheduled: 'bg-gray-100 text-gray-600',
};

const STATUS_COLORS = {
  open: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  missed: 'bg-gray-200 text-gray-700',
};

function CompleteForm({ wo, chemicals, onComplete, onCancel }) {
  const [form, setForm] = useState({ notes: '', lubricant_used: '', lubricant_is_food_grade: true, chemical_id: '' });
  const [saving, setSaving] = useState(false);
  // This form used to record no steps at all, so every task completed from the
  // Task Center reached QA's hygiene clearance with an empty step list — which
  // then read as "0 of 3 ticked". The Operator View has always asked; the
  // desktop path simply never did.
  const steps = safeParseFe(wo.procedure_steps, []);
  const isHeading = (t) => typeof t === 'string' && t.endsWith(':');
  const [stepChecks, setStepChecks] = useState([]);
  const toggleStep = (i) => setStepChecks(prev => {
    const next = [...prev];
    next[i] = !next[i];
    return next;
  });
  const realSteps = steps.filter(t => !isHeading(t));
  const tickedCount = stepChecks.filter(Boolean).length;
  // Food-contact work goes to QA for hygiene clearance, and QA cannot clear a
  // machine from a task that does not say what was done. The server enforces
  // this; the form asks for it up front so nobody fills the notes in and then
  // gets refused. `is_food_contact` is the same fact that raises the clearance.
  const stepsRequired = !!wo.is_food_contact && realSteps.length > 0;
  const allTicked = steps.every((t, i) => isHeading(t) || stepChecks[i]);
  const blockedForSteps = stepsRequired && !allTicked;

  const lubricants = (chemicals || []).filter(c => c.category === 'lubricant');

  const handleLubricantSelect = (chemId) => {
    const chem = lubricants.find(c => c.id === chemId);
    setForm({
      ...form,
      chemical_id: chemId,
      lubricant_used: chem ? chem.name : '',
      lubricant_is_food_grade: chem ? !!chem.is_food_grade : form.lubricant_is_food_grade,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Send the ticks only when there are some — an array of nothing but
      // `false` would assert every step was deliberately skipped, which is a
      // different (and worse) claim than not recording them.
      await onComplete(wo.id, {
        ...form,
        ...(stepsRequired || tickedCount > 0
          ? { step_results: steps.map((_, i) => !!stepChecks[i]) }
          : {}),
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-green-50 rounded-lg border border-green-200 p-3 mt-2 space-y-2">
      {/* Ticking is what gives QA an account of the work at hygiene clearance.
          Left optional rather than required: this is completed on the floor,
          and a form that refuses to submit is one people work around. */}
      {steps.length > 0 && (
        <div className={`bg-white rounded-lg border p-2 ${blockedForSteps ? 'border-amber-300' : 'border-green-200'}`}>
          <p className="text-xs font-semibold text-gray-700 mb-1">
            Steps done
            <span className="font-normal text-gray-400"> — {tickedCount} of {realSteps.length}</span>
            {stepsRequired && <span className="ml-1 text-amber-700 font-semibold">· required</span>}
          </p>
          {stepsRequired && (
            <p className="text-[11px] text-amber-800 mb-1.5">
              Food-contact equipment: QA signs this off before it runs again, so tick each step you did.
              If one could not be done, flag an issue instead of completing.
            </p>
          )}
          <ul className="space-y-0.5">
            {steps.map((step, i) => (isHeading(step) ? (
              <li key={i} className="text-xs font-semibold text-gray-700 pt-1">{step}</li>
            ) : (
              <li key={i}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!stepChecks[i]} onChange={() => toggleStep(i)} className="mt-0.5 shrink-0" />
                  <span className={`text-xs leading-snug ${stepChecks[i] ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{step}</span>
                </label>
              </li>
            )))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lubricant Used</label>
          <select value={form.chemical_id} onChange={e => handleLubricantSelect(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">None</option>
            {lubricants.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.is_food_grade ? ' (Food Grade)' : ''}{c.nsf_rating ? ` — ${c.nsf_rating}` : ''}</option>
            ))}
            <option value="__other">Other (type manually)</option>
          </select>
          {form.chemical_id === '__other' && (
            <input value={form.lubricant_used} onChange={e => setForm({ ...form, lubricant_used: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm mt-1" placeholder="Lubricant name" />
          )}
        </div>
      </div>
      {form.lubricant_used && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.lubricant_is_food_grade} onChange={e => setForm({ ...form, lubricant_is_food_grade: e.target.checked })} />
          <span className="text-xs text-gray-700">Food-grade lubricant (NSF H1/H2)</span>
        </label>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving || blockedForSteps}
          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Complete & Generate Next'}
        </button>
        {blockedForSteps && (
          <span className="text-[11px] text-amber-800 self-center">
            {realSteps.length - tickedCount} step{realSteps.length - tickedCount === 1 ? '' : 's'} left to tick
          </span>
        )}
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function IssueForm({ wo, onFlag, onCancel }) {
  const [form, setForm] = useState({ notes: '', attachments: [] });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onFlag(wo.id, form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-red-50 rounded-lg border border-red-200 p-3 mt-2 space-y-2">
      <h5 className="text-xs font-semibold text-red-800 uppercase tracking-wide flex items-center gap-1">
        <Flag size={12} /> Flag an Issue
      </h5>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">What's the issue? *</label>
        <textarea required value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" rows={3}
          placeholder="Describe the problem, what you observed, any safety concerns..." />
      </div>
      <FileUpload files={form.attachments} onChange={attachments => setForm({ ...form, attachments })} />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Flag Issue'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

// An audited defer — "not today, tomorrow, because X". The reason is required
// (the server refuses without one) and every push is kept in snooze_history
// with the original due date, so a deferred task can never read as one that
// was simply due later.
function SnoozeForm({ wo, onSnooze, onCancel }) {
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) { setError('A reason is required.'); return; }
    setSaving(true); setError('');
    try { await onSnooze(wo.id, { days, reason: reason.trim() }); }
    catch (err) { setError(err.message || 'Defer failed.'); setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="bg-sky-50 rounded-lg border border-sky-200 p-3 mt-2 space-y-2">
      <h5 className="text-xs font-semibold text-sky-800 uppercase tracking-wide flex items-center gap-1">
        <CalendarClock size={12} /> Push to later
      </h5>
      <div className="flex gap-2">
        {[{ d: 1, label: 'Tomorrow' }, { d: 2, label: '+2 days' }, { d: 7, label: 'Next week' }].map(o => (
          <button key={o.d} type="button" onClick={() => setDays(o.d)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${days === o.d ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-sky-50'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Why? *</label>
        <input required value={reason} onChange={e => setReason(e.target.value)}
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
          placeholder="e.g. Line running — no access until tomorrow" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Defer task'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
      <p className="text-[10px] text-sky-700">Recorded with your name and reason; the original due date stays on the task's history.</p>
    </form>
  );
}

// "Why is this task here" — the recurring schedule that generated it, and when
// it last ran. Fetched on demand so the task list itself stays light.
function ScheduleInfo({ scheduleId }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    apiFetch(`/pm/schedules/${scheduleId}`)
      .then(s => { if (!cancelled) setInfo(s); })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load the schedule.'); });
    return () => { cancelled = true; };
  }, [scheduleId]);
  if (error) return <p className="text-xs text-red-600 mt-2">{error}</p>;
  if (!info) return <p className="text-xs text-gray-400 mt-2">Loading schedule…</p>;
  const recent = (info.recent_work_orders || []).filter(w => w.completed_at).slice(0, 3);
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1.5">
      <p>
        <span className="font-semibold">{info.title}</span>
        {' — '}{info.frequency_type}{info.frequency_value > 1 ? ` ×${info.frequency_value}` : ''}
        {info.equipment_name ? ` on ${info.equipment_name}` : ''}
        {info.is_active ? '' : ' · schedule paused'}
      </p>
      {recent.length > 0 ? (
        <div className="space-y-0.5">
          <p className="font-medium text-gray-500">Recent completions</p>
          {recent.map(w => (
            <p key={w.id}>• {formatDateTime(w.completed_at)} by {w.completed_by || '—'}</p>
          ))}
        </div>
      ) : (
        <p className="text-gray-500">No completions yet — this occurrence is the first.</p>
      )}
    </div>
  );
}

function WOForm({ equipment, technicians, onSave, onCancel, user }) {
  // Document Control assignment is limited to admins + QA/DC supervisors (server
  // enforces this too); everyone else picks from the other teams.
  const canAssignDC = user?.role === 'admin' || (user?.role === 'supervisor' && ['qa', 'document_control'].includes(user?.department));
  const teamOptions = GROUP_TABS.filter(g => g.value !== 'all' && (g.value !== 'document_control' || canAssignDC));
  const defaultGroup = teamOptions.some(g => g.value === user?.department) ? user.department : 'maintenance';

  const [form, setForm] = useState({ equipment_id: '', title: '', description: '', priority: 'normal', assigned_to: '', due_date: '', attachments: [], task_group: defaultGroup });
  const [saving, setSaving] = useState(false);
  const isMaintenance = form.task_group === 'maintenance';
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } catch (saveErr) {
      // A refused save must SAY so. This was try/finally with NO catch, so a
      // 403 or a validation 400 cleared the spinner and left the modal sitting
      // there — indistinguishable from a dead button, which is how a
      // deliberate rule reads as a broken screen.
      window.alert(saveErr.message);
    } finally { setSaving(false); }
  };

  const noun = isMaintenance ? 'Work Order' : 'Task';
  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">New {noun}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Team *</label>
          <select required value={form.task_group} onChange={e => setForm({ ...form, task_group: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {teamOptions.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
          <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={isMaintenance ? 'e.g. Quarterly PM' : 'e.g. Review SOP-014'} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment{isMaintenance ? '' : ' (optional)'}</label>
          <select required={isMaintenance} value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">{isMaintenance ? 'Select...' : 'None — not tied to equipment'}</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.location || 'No location'})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Due Date *</label>
          <input type="date" required value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Assign to (direct report)</label>
          <select value={form.assigned_to}
            onChange={e => {
              const name = e.target.value;
              // Auto-set the team to the assignee's own department so the task
              // lands with the right group (only when that dept maps to a team).
              const tech = (technicians || []).find(t => t.name === name);
              const dept = tech?.department;
              setForm(f => ({ ...f, assigned_to: name, task_group: (dept && teamOptions.some(g => g.value === dept)) ? dept : f.task_group }));
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Unassigned (whole team)</option>
            {(technicians || []).map(t => <option key={t.id} value={t.name}>{t.name} ({t.role}{t.department ? ` · ${deptLabel(t.department)}` : ''})</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Description / instructions</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="What needs to be done…" />
        </div>
      </div>
      <FileUpload files={form.attachments} onChange={attachments => setForm({ ...form, attachments })} />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Creating...' : `Create ${noun}`}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function safeParseFe(val, fallback = []) {
  if (Array.isArray(val) || (typeof val === 'object' && val !== null)) return val;
  try { return JSON.parse(val || JSON.stringify(fallback)); } catch { return fallback; }
}

// A reviewer's note on finished work, and the option to send it back. A note
// on its own is feedback; "needs rework" reopens the task and puts it back on
// the person who did it, so the ask can't be missed.
function ReviewForm({ wo, onDone, onCancel }) {
  const [note, setNote] = useState('');
  const [rework, setRework] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!note.trim()) { setError('A note is required.'); return; }
    setSaving(true); setError('');
    try {
      await apiPost(`/pm/work-orders/${wo.id}/review`, { note: note.trim(), rework_required: rework });
      onDone();
    } catch (e) { setError(e.message || 'Review failed.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Review this task</p>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
        placeholder="What did you find?"
        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-white" />
      <label className="flex items-start gap-2 text-sm text-amber-900 cursor-pointer">
        <input type="checkbox" checked={rework} onChange={e => setRework(e.target.checked)} className="mt-0.5" />
        <span>
          This needs to be redone
          <span className="block text-[11px] text-amber-800/80">
            Reopens the task for {wo.completed_by || 'whoever completed it'}, with this note attached.
          </span>
        </span>
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
          {saving ? 'Saving…' : rework ? 'Send back for rework' : 'Save note'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-white">Cancel</button>
      </div>
    </div>
  );
}

// Every review round on a task, newest last — what was asked, by whom, and what
// the completion looked like before it was sent back.
function ReviewTrail({ wo }) {
  const history = (() => { try { return JSON.parse(wo.review_history || '[]'); } catch { return []; } })();
  if (!history.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Review history</h5>
      <ol className="space-y-1.5">
        {history.map((h, i) => (
          <li key={i} className="text-xs text-gray-700">
            <span className="font-medium">{h.reviewed_by}</span> · {formatDateTime(h.reviewed_at)}
            {h.rework_required && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">rework</span>}
            <div className="ml-1">{h.note}</div>
            {h.prior_completion && (
              <div className="ml-1 italic text-gray-500">
                Reopened — had been completed by {h.prior_completion.by} on {formatDateTime(h.prior_completion.at)}.
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What was actually done on a task.
 *
 * Extracted so QA's hygiene-clearance card and the completed-task view render
 * the SAME account of the work. A clearance decision made from a title and a
 * name is a rubber stamp: QA has to see which steps were ticked, what was read,
 * what was lubricated with, and whether the operator flagged anything — and
 * they should not have to know the daily and weekly procedures by heart, or go
 * to the Equipment list to look them up, to get it.
 *
 * A second copy of this would be the other half of that problem: two screens
 * describing one piece of work slightly differently.
 */
function WorkDone({ wo, compact = false }) {
  const steps = safeParseFe(wo.procedure_steps, []);
  const stepResults = safeParseFe(wo.step_results, []);
  const readings = safeParseFe(wo.readings, {});
  const issuePhotos = safeParseFe(wo.issue_attachments, []);
  const hasReadings = Object.keys(readings).length > 0;
  const done = stepResults.filter(r => r === true || r === 'done' || r === 'pass').length;

  // NOT RECORDED IS NOT THE SAME AS NOT DONE, and showing them the same way is
  // a false statement about somebody's work.
  //
  // Only the Operator View asks for steps to be ticked, and even there it is
  // optional; the desktop Task Center's Complete form does not ask at all, and
  // Batch Complete writes an empty list outright. So an empty `step_results`
  // usually means "this completion path never asked", not "the technician
  // skipped every step" — and a column of empty circles reading "0 of 3
  // ticked" says the second thing.
  const stepsRecorded = stepResults.length > 0;
  const realSteps = steps.filter(t => !(typeof t === 'string' && t.endsWith(':')));

  if (!steps.length && !hasReadings && !wo.lubricant_used && !wo.notes && wo.issue_flagged !== 1) {
    return (
      <p className="text-sm text-gray-500 italic">
        No steps, readings or notes were recorded against this task.
      </p>
    );
  }

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-4'}>
      {steps.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1 flex-wrap">
            <CheckCircle size={12} /> {stepsRecorded ? 'Procedure steps' : 'What this task called for'}
            <span className="font-normal normal-case tracking-normal text-gray-400">
              {stepsRecorded
                ? `— ${done} of ${realSteps.length} ticked`
                : `— ${realSteps.length} step${realSteps.length === 1 ? '' : 's'}, not individually recorded`}
            </span>
          </h5>
          {!stepsRecorded && (
            <p className="text-[11px] text-gray-500 mb-1.5">
              This task was completed from a screen that does not ask for each step to be ticked, so the
              record does not say which were done. The procedure is below.
            </p>
          )}
          <ul className="space-y-1 text-sm">
            {steps.map((step, i) => {
              const isHeader = typeof step === 'string' && step.endsWith(':');
              const result = stepResults[i];
              const ticked = result === true || result === 'done' || result === 'pass';
              return (
                <li key={i} className={`flex items-start gap-2 ${isHeader ? 'font-semibold text-gray-800 mt-2' : 'text-gray-600 pl-3'}`}>
                  {!isHeader && stepsRecorded && (
                    <span className={`mt-0.5 shrink-0 ${ticked ? 'text-green-500' : 'text-gray-300'}`}>
                      {ticked ? <CheckCircle size={14} /> : <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-gray-300" />}
                    </span>
                  )}
                  {!isHeader && !stepsRecorded && <span className="mt-1.5 shrink-0 w-1 h-1 rounded-full bg-gray-400" />}
                  <span>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasReadings && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Thermometer size={12} /> Readings & inspection data
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(readings).map(([key, val]) => (
              <div key={key} className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500 capitalize">{key.replace(/_/g, ' ')}</p>
                <p className="text-sm font-medium text-gray-900">
                  {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Food-grade or not is the whole question when QA is clearing a
          food-contact machine, so it is never hidden behind an expander. */}
      {wo.lubricant_used && (
        <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-3">
          <Droplets size={16} className="text-blue-600 shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lubricant used</p>
            <p className="text-sm font-medium text-gray-900">
              {wo.lubricant_used}
              {wo.lubricant_is_food_grade
                ? <span className="ml-2 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Food-grade</span>
                : <span className="ml-2 text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">Not marked food-grade</span>}
            </p>
          </div>
        </div>
      )}

      {wo.notes && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes from the technician</h5>
          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-line">{wo.notes}</p>
        </div>
      )}

      {wo.issue_flagged === 1 && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-3">
          <p className="text-xs font-semibold text-red-800 flex items-center gap-1 mb-1"><Flag size={11} /> Issue reported</p>
          <p className="text-sm text-red-900">{wo.issue_notes}</p>
          <p className="text-xs text-red-600 mt-1">
            Flagged by {wo.issue_flagged_by} · {formatDateTime(wo.issue_flagged_at, '')}
          </p>
          {/* The photos the operator took of the problem. QA clearing a machine
              needs to see them, not a count of them. */}
          {issuePhotos.length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {issuePhotos.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
                  {/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.originalName || a.filename) ? (
                    <img src={a.url} alt={a.originalName} className="h-16 w-16 object-cover rounded-lg border border-red-200 hover:ring-2 hover:ring-red-400" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg border border-red-200 flex flex-col items-center justify-center bg-white hover:ring-2 hover:ring-red-400">
                      <Paperclip size={14} className="text-red-400" />
                      <span className="text-[9px] text-red-500 truncate w-14 text-center mt-0.5">{a.originalName || a.filename}</span>
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompletedTaskDetail({ wo, onClose, canReview, onReviewed }) {
  const [reviewing, setReviewing] = useState(false);
  // Steps, readings, lubricant, notes and the issue report all render through
  // <WorkDone>, which QA's clearance card uses too.
  const attachments = safeParseFe(wo.attachments, []);
  const isNA = wo.status === 'not_applicable';
  const isMissed = wo.status === 'missed';

  return (
    <div className="bg-white rounded-xl border-2 border-powder-200 shadow-lg p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {isMissed ? (
              <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold">MISSED</span>
            ) : isNA ? (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">N/A</span>
            ) : (
              <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-semibold flex items-center gap-1"><CheckCircle size={10} /> COMPLETED</span>
            )}
            {wo.frequency_type && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[wo.frequency_type] || FREQ_COLORS.unscheduled}`}>{wo.frequency_type}</span>}
            {wo.task_group && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${GROUP_BADGE[wo.task_group] || 'bg-gray-100 text-gray-600'}`}>{{ maintenance: 'MNT', warehouse: 'WH', qa: 'QA', cleaning: 'CLN', batching: 'BAT', kitting: 'KIT', filling: 'FIL', document_control: 'DC' }[wo.task_group] || String(wo.task_group).slice(0, 3).toUpperCase()}</span>}
            {wo.priority === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
            {wo.priority === 'high' && <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs">High</span>}
            {wo.reading_result && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${wo.reading_result === 'pass' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {wo.reading_result.toUpperCase()}
              </span>
            )}
          </div>
          <h4 className="font-semibold text-gray-900 text-lg">{wo.title || wo.pm_title}</h4>
          <p className="text-sm text-gray-600">{wo.equipment_name}{wo.asset_id ? ` #${wo.asset_id}` : ''} — {wo.location || 'No location'}</p>
          {/* This is the completed record an auditor is shown, so it is the
              one place the form number matters most. */}
          <FormChip subject={{ taskTitle: wo.pm_title || wo.title }} className="mt-1" />
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>

      {/* Timestamps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</p>
          <p className="text-sm font-medium text-gray-900">{wo.due_date}</p>
        </div>
        {wo.completed_at && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Completed</p>
            <p className="text-sm font-medium text-green-700">{formatDateTime(wo.completed_at)}</p>
          </div>
        )}
        {wo.completed_by && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Completed By</p>
            <p className="text-sm font-medium text-gray-900">{wo.completed_by}</p>
          </div>
        )}
        {wo.assigned_to && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Assigned To</p>
            <p className="text-sm text-gray-700">{wo.assigned_to}</p>
          </div>
        )}
        {wo.created_at && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</p>
            <p className="text-sm text-gray-600">{formatDateTime(wo.created_at)}</p>
          </div>
        )}
        {wo.started_at && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Started</p>
            <p className="text-sm text-gray-600">{formatDateTime(wo.started_at)}</p>
          </div>
        )}
      </div>

      {/* One account of the work, shared with QA's clearance card. */}
      <WorkDone wo={wo} />

      {/* Clearance Info */}
      {wo.clearance_required === 1 && (
        <div className={`rounded-lg p-3 ${wo.clearance_status === 'cleared' ? 'bg-green-50' : wo.clearance_status === 'failed' ? 'bg-red-50' : 'bg-amber-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={14} className={wo.clearance_status === 'cleared' ? 'text-green-600' : wo.clearance_status === 'failed' ? 'text-red-600' : 'text-amber-600'} />
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Hygiene Clearance</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-xs text-gray-500">Status:</span> <span className="font-medium capitalize">{wo.clearance_status || 'pending'}</span></div>
            {wo.clearance_method && <div><span className="text-xs text-gray-500">Method:</span> <span className="font-medium">{wo.clearance_method}</span></div>}
            {wo.clearance_by && <div><span className="text-xs text-gray-500">By:</span> <span className="font-medium">{wo.clearance_by}</span></div>}
            {wo.clearance_at && <div><span className="text-xs text-gray-500">At:</span> <span className="font-medium">{formatDateTime(wo.clearance_at)}</span></div>}
            {wo.clearance_notes && <div className="col-span-2"><span className="text-xs text-gray-500">Notes:</span> <span>{wo.clearance_notes}</span></div>}
          </div>
        </div>
      )}


      {/* Attachments */}
      {attachments.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Paperclip size={12} /> Attachments ({attachments.length})
          </h5>
          <div className="flex gap-2 flex-wrap">
            {attachments.map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
                {/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.originalName || a.filename) ? (
                  <img src={a.url} alt={a.originalName} className="h-20 w-20 object-cover rounded-lg border border-gray-200 hover:ring-2 hover:ring-powder-400" />
                ) : (
                  <div className="h-20 w-20 rounded-lg border border-gray-200 flex flex-col items-center justify-center bg-gray-50 hover:ring-2 hover:ring-powder-400">
                    <Paperclip size={16} className="text-gray-400" />
                    <span className="text-[9px] text-gray-500 truncate w-16 text-center mt-1">{a.originalName || a.filename}</span>
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Review — a note on the finished work, and the option to send it back. */}
      <ReviewTrail wo={wo} />
      {canReview && !isMissed && (
        reviewing
          ? <ReviewForm wo={wo} onCancel={() => setReviewing(false)}
              onDone={() => { setReviewing(false); onReviewed?.(); }} />
          : (
            <button type="button" onClick={() => setReviewing(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 text-xs font-medium hover:bg-amber-50">
              <Flag size={12} /> Review / request rework
            </button>
          )
      )}
    </div>
  );
}

function TaskCard({ wo, onStartComplete, completing, onComplete, onCancelComplete, chemicals, flagging, onStartFlag, onFlag, onCancelFlag, canSnooze, snoozing, onStartSnooze, onSnooze, onCancelSnooze, canReassign, technicians, onReassign }) {
  const steps = wo.procedure_steps || [];
  const attachments = (() => { try { return JSON.parse(wo.attachments || '[]'); } catch { return []; } })();
  const issueAttachments = (() => { try { return JSON.parse(wo.issue_attachments || '[]'); } catch { return []; } })();
  const snoozes = (() => { try { return JSON.parse(wo.snooze_history || '[]'); } catch { return []; } })();
  const [expanded, setExpanded] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  return (
    <div className={`bg-white rounded-xl border p-4 ${wo.issue_flagged ? 'border-red-300 ring-1 ring-red-100' : wo.rework_required ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[wo.frequency_type] || FREQ_COLORS.unscheduled}`}>
              {wo.frequency_type || 'ad-hoc'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[wo.status]}`}>{wo.status}</span>
            {wo.issue_flagged === 1 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-semibold"><Flag size={10} /> Issue</span>}
            {wo.rework_required === 1 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold"><Flag size={10} /> Rework</span>}
            {/* Folded missed runs — one card, not one per day it was missed.
                The same chip the Operator View shows; without it, the Missed
                filter opens cards that never say why they qualified. */}
            {wo.missed_count > 0 && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                {wo.missed_count}× missed{wo.missed_since ? ` since ${wo.missed_since}` : ''}
              </span>
            )}
            {wo.priority === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
            {wo.priority === 'high' && !wo.issue_flagged && <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs">High</span>}
            {attachments.length > 0 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"><Paperclip size={10} />{attachments.length}</span>}
            {wo.task_group && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${GROUP_BADGE[wo.task_group] || 'bg-gray-100 text-gray-600'}`}>{{ maintenance: 'MNT', warehouse: 'WH', qa: 'QA', cleaning: 'CLN', batching: 'BAT', kitting: 'KIT', filling: 'FIL', document_control: 'DC' }[wo.task_group] || String(wo.task_group).slice(0, 3).toUpperCase()}</span>}
            {/* The controlled form this task satisfies, when it answers one.
                Matched off the SCHEDULE title in preference to the work
                order's, since that is the title the seeders control; a one-off
                task somebody typed usually maps to nothing and shows nothing. */}
            <FormChip subject={{ taskTitle: wo.pm_title || wo.title }} />
          </div>
          <h4 className="font-medium text-gray-900 truncate">{wo.title}</h4>
          <p className="text-sm text-gray-500">{wo.equipment_name}{wo.asset_id ? ` #${wo.asset_id}` : ''} — {wo.location || 'No location'}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Due: {wo.due_date}{wo.assigned_to ? ` · Assigned: ${wo.assigned_to}` : ''}
            {/* Covering an absence means handing this task to somebody else
                TODAY, without editing the schedule it came from — the schedule
                keeps generating for the usual person; only this run moves. */}
            {canReassign && ['open', 'in_progress', 'overdue', 'missed'].includes(wo.status) && (
              <button type="button" onClick={() => setReassigning(r => !r)}
                className="ml-1.5 text-powder-600 hover:text-powder-700 underline">
                {wo.assigned_to ? 'Reassign' : 'Assign'}
              </button>
            )}
          </p>
          {reassigning && (
            <select autoFocus value={wo.assigned_to || ''} onChange={(e) => { setReassigning(false); onReassign?.(wo.id, e.target.value); }}
              className="mt-1 px-2 py-1 border border-gray-300 rounded-md text-xs">
              <option value="">Unassigned (whole team)</option>
              {(technicians || []).map(u => (
                <option key={u.id} value={u.name}>{u.name}{u.department ? ` · ${String(u.department).replace(/_/g, ' ')}` : ''}</option>
              ))}
            </select>
          )}
          {snoozes.length > 0 && (
            <p className="text-xs text-sky-700 mt-0.5">
              Deferred{snoozes.length > 1 ? ` ×${snoozes.length}` : ''} by {snoozes[snoozes.length - 1].by}: {snoozes[snoozes.length - 1].reason}
            </p>
          )}
          {wo.pm_schedule_id && (
            <button onClick={() => setShowSchedule(s => !s)}
              className="text-xs text-powder-600 hover:text-powder-700 mt-0.5 flex items-center gap-1">
              <Repeat size={11} /> From schedule: {wo.pm_title || wo.title}{wo.frequency_type ? ` · ${wo.frequency_type}` : ''}
            </button>
          )}
          {showSchedule && wo.pm_schedule_id && <ScheduleInfo scheduleId={wo.pm_schedule_id} />}
        </div>
        <div className="flex gap-1 ml-2 shrink-0">
          {wo.status === 'open' && (
            <button onClick={() => onStartComplete(wo.id, 'start')}
              className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100">Start</button>
          )}
          <button onClick={() => onStartFlag(wo.id)}
            className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs hover:bg-red-100 flex items-center gap-1">
            <Flag size={12} /> Issue
          </button>
          {canSnooze && ['open', 'in_progress', 'overdue'].includes(wo.status) && (
            <button onClick={() => onStartSnooze(wo.id)}
              className="px-2 py-1 bg-sky-50 text-sky-700 rounded text-xs hover:bg-sky-100 flex items-center gap-1">
              <CalendarClock size={12} /> Later
            </button>
          )}
          <button onClick={() => onStartComplete(wo.id, 'complete')}
            className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100 flex items-center gap-1">
            <CheckCircle size={12} /> Done
          </button>
        </div>
      </div>

      {wo.rework_required === 1 && (
        <div className="mt-2 bg-amber-50 rounded-lg border border-amber-200 p-2.5">
          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1 mb-1"><Flag size={11} /> Sent back for rework</p>
          <p className="text-sm text-amber-900">{wo.review_note}</p>
          <p className="text-xs text-amber-700 mt-1">
            {wo.review_by} · {formatDateTime(wo.review_at, '')}
          </p>
        </div>
      )}

      {wo.issue_flagged === 1 && (
        <div className="mt-2 bg-red-50 rounded-lg border border-red-200 p-2.5">
          <p className="text-xs font-semibold text-red-800 flex items-center gap-1 mb-1"><Flag size={11} /> Issue Reported</p>
          <p className="text-sm text-red-900">{wo.issue_notes}</p>
          <p className="text-xs text-red-600 mt-1">
            Flagged by {wo.issue_flagged_by} · {formatDateTime(wo.issue_flagged_at, '')}
          </p>
          {issueAttachments.length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {issueAttachments.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
                  {/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.originalName || a.filename) ? (
                    <img src={a.url} alt={a.originalName} className="h-16 w-16 object-cover rounded-lg border border-red-200 hover:ring-2 hover:ring-red-400" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg border border-red-200 flex flex-col items-center justify-center bg-white hover:ring-2 hover:ring-red-400">
                      <Paperclip size={14} className="text-red-400" />
                      <span className="text-[9px] text-red-500 truncate w-14 text-center mt-0.5">{a.originalName || a.filename}</span>
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-powder-600 hover:text-powder-700 flex items-center gap-1">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {steps.length} task{steps.length > 1 ? 's' : ''}
          </button>
          {expanded && (
            <ul className="mt-1 space-y-1 text-xs text-gray-600 pl-4">
              {steps.map((s, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-gray-400 mt-0.5">•</span><span>{s}</span></li>)}
            </ul>
          )}
        </div>
      )}

      {attachments.length > 0 && expanded && (
        <div className="mt-2 flex gap-2 flex-wrap">
          {attachments.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
              {/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.originalName || a.filename) ? (
                <img src={a.url} alt={a.originalName} className="h-20 w-20 object-cover rounded-lg border border-gray-200 hover:ring-2 hover:ring-powder-400" />
              ) : (
                <div className="h-20 w-20 rounded-lg border border-gray-200 flex flex-col items-center justify-center bg-gray-50 hover:ring-2 hover:ring-powder-400">
                  <Paperclip size={16} className="text-gray-400" />
                  <span className="text-[9px] text-gray-500 truncate w-16 text-center mt-1">{a.originalName || a.filename}</span>
                </div>
              )}
            </a>
          ))}
        </div>
      )}

      {flagging === wo.id && (
        <IssueForm wo={wo} onFlag={onFlag} onCancel={onCancelFlag} />
      )}

      {snoozing === wo.id && (
        <SnoozeForm wo={wo} onSnooze={onSnooze} onCancel={onCancelSnooze} />
      )}

      {completing === wo.id && (
        <CompleteForm wo={wo} chemicals={chemicals} onComplete={onComplete} onCancel={onCancelComplete} />
      )}
    </div>
  );
}

const GROUP_TABS = [
  { value: 'all', label: 'All Groups', color: 'bg-gray-800' },
  { value: 'maintenance', label: 'Maintenance', color: 'bg-violet-600' },
  { value: 'warehouse', label: 'Warehouse', color: 'bg-indigo-600' },
  { value: 'qa', label: 'QA', color: 'bg-teal-600' },
  { value: 'document_control', label: 'Document Control', color: 'bg-sky-600' },
  { value: 'batching', label: 'Batching', color: 'bg-yellow-600' },
  { value: 'kitting', label: 'Kitting', color: 'bg-blue-600' },
  { value: 'filling', label: 'Filling', color: 'bg-cyan-600' },
  { value: 'cleaning', label: 'Cleaning', color: 'bg-amber-600' },
];

const GROUP_BADGE = {
  maintenance: 'bg-violet-100 text-violet-700',
  warehouse: 'bg-indigo-100 text-indigo-700',
  qa: 'bg-teal-100 text-teal-700',
  cleaning: 'bg-amber-100 text-amber-700',
};

const CLEARANCE_METHODS = [
  'Visual Inspection',
  'ATP Swab Test',
  'Allergen Swab',
  'Full Sanitation Cycle',
];

function ClearanceCard({ wo, onClear, user }) {
  const [method, setMethod] = useState(CLEARANCE_METHODS[0]);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('cleared');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isQA = user?.department === 'qa';
  const isSamePerson = user?.name === wo.completed_by;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      // Server expects: status, cleared_by, method, notes (see PUT /pm/work-orders/:id/clearance)
      await onClear({ status, cleared_by: user?.name, method, notes });
    } catch (err) {
      setError(err.message || 'Clearance failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">
              <ShieldCheck size={12} /> Food-Contact Equipment
            </span>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">Assigned to: QA</span>
            <FormChip subject={{ taskTitle: wo.pm_title || wo.title }} />
          </div>
          <h4 className="font-medium text-gray-900">{wo.title}</h4>
          <p className="text-sm text-gray-500">{wo.equipment_name}{wo.asset_id ? ` #${wo.asset_id}` : ''} — {wo.location || 'No location'}</p>
          {/* Which procedure this was and how often it runs. QA should not have
              to know the daily and weekly schedules by heart, or open the
              Equipment list, to know what they are clearing. */}
          {wo.pm_title && wo.pm_title !== wo.title && (
            <p className="text-xs text-gray-500 mt-0.5">From schedule: {wo.pm_title}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            {wo.frequency_type ? `${wo.frequency_type} · ` : ''}Due: {wo.due_date}
            {' · '}Completed {wo.completed_at ? formatDateTime(wo.completed_at) : '—'} by {wo.completed_by || '—'}
          </p>
        </div>
      </div>

      {/* What was actually done — the same account the completed-task view
          shows. Clearing a machine from a title and a name is a rubber stamp. */}
      <div className="rounded-lg border border-gray-200 p-3">
        <WorkDone wo={wo} compact />
      </div>

      {!isQA ? (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 flex items-start gap-2">
          <ShieldCheck size={16} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">QA Sign-Off Required</p>
            <p className="text-xs text-blue-600 mt-0.5">Only QA department users can perform hygiene clearance. Please have a QA technician sign in to complete this step.</p>
          </div>
        </div>
      ) : isSamePerson ? (
        <div className="bg-red-50 rounded-lg border border-red-200 p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Cannot Self-Clear</p>
            <p className="text-xs text-red-600 mt-0.5">Clearance must be performed by someone other than the person who completed the work order.</p>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="bg-amber-50 rounded-lg border border-amber-200 p-3 space-y-2">
        <h5 className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Hygiene Sign-Off</h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Method *</label>
            <select required value={method} onChange={e => setMethod(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
              {CLEARANCE_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status *</label>
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => setStatus('cleared')}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${status === 'cleared' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-green-50'}`}>
                Cleared
              </button>
              <button type="button" onClick={() => setStatus('failed')}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${status === 'failed' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-red-50'}`}>
                Failed
              </button>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" rows={2}
            placeholder="Observations, test results, follow-up actions..." />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${status === 'cleared' ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}`}>
            {saving ? 'Submitting...' : status === 'cleared' ? 'Submit Clearance' : 'Submit Failure'}
          </button>
        </div>
      </form>
      )}
    </div>
  );
}

export default function PMPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const canEdit = canEditModule(user, 'pm');
  const [groupFilter, setGroupFilter] = useState('all');
  const gp = groupFilter !== 'all' ? `?group=${groupFilter}` : '';
  const { data: metrics, loading: metricsLoading } = useApiGet(`/pm/metrics${gp}`);
  const { data: grouped, loading: taskLoading, refresh: refreshTasks } = useApiGet(`/pm/by-frequency${gp}`);
  const { data: clearancePending, refresh: refreshClearance } = useApiGet('/pm/clearance-pending');
  const { data: equipment } = useApiGet('/equipment');
  const { data: technicians } = useApiGet('/users/technicians');
  const { data: chemicals } = useApiGet('/chemicals');
  const [freqFilter, setFreqFilter] = useState('all');
  const [showWOForm, setShowWOForm] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [flagging, setFlagging] = useState(null);
  const [view, setView] = useState('incomplete');
  const [archiveData, setArchiveData] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [expandedArchive, setExpandedArchive] = useState(null);
  // Reviewing someone else's finished work is a QA/supervisor act, not an
  // operator one — the same people who sign off elsewhere in the app.
  const canReviewTasks = user?.role === 'admin' || user?.role === 'supervisor' || user?.department === 'qa';
  // Deferring shares the review ladder: the people who may kick work back may
  // also push it to tomorrow — with a reason, audited (server enforces both).
  const canSnooze = canReviewTasks;
  const [snoozingId, setSnoozingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const handleCreateWO = async (form) => {
    await apiPost('/pm/work-orders', form);
    setShowWOForm(false);
    refreshTasks();
  };

  const handleReassign = async (woId, name) => {
    await apiPut(`/pm/work-orders/${woId}`, { assigned_to: name || null });
    refreshTasks();
  };

  const handleStartWO = async (woId, action) => {
    if (action === 'start') {
      await apiPut(`/pm/work-orders/${woId}`, { status: 'in_progress' });
      refreshTasks();
    } else {
      setCompleting(completing === woId ? null : woId);
      setFlagging(null);
    }
  };

  const handleComplete = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
    setCompleting(null);
    refreshTasks();
  };

  const handleFlagIssue = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/flag-issue`, form);
    setFlagging(null);
    refreshTasks();
  };

  const handleSnooze = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/snooze`, form);
    setSnoozingId(null);
    refreshTasks();
  };

  const loadArchive = async (freq, from, to, grp) => {
    setArchiveLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (freq && freq !== 'all') params.set('frequency', freq);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const g = grp !== undefined ? grp : groupFilter;
      if (g && g !== 'all') params.set('group', g);
      const data = await apiFetch(`/pm/completed-history?${params}`);
      setArchiveData(data);
    } finally { setArchiveLoading(false); }
  };

  const handleViewChange = (v) => {
    setView(v);
    if (v === 'completed') loadArchive(freqFilter, dateFrom, dateTo);
  };

  const freqOrder = ['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual', 'unscheduled'];
  const q = search.toLowerCase().trim();

  // Search deliberately ignores the team tab, the frequency tabs and the status
  // filters: a task you can name is a task you should be able to find. The
  // server searches every team and status (plus the last 90 days of
  // completions), so results can include tasks the current filters hide.
  const [searchHits, setSearchHits] = useState(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.length < 2) { setSearchHits(null); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      apiFetch(`/pm/search?q=${encodeURIComponent(q)}`)
        .then(rows => { if (!cancelled) setSearchHits(rows); })
        .catch(() => { if (!cancelled) setSearchHits([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const today = new Date().toISOString().split('T')[0];
  const filteredGroups = grouped ? freqOrder
    .filter(f => grouped[f]?.length > 0)
    .filter(f => freqFilter === 'all' || f === freqFilter)
    .map(f => {
      let items = grouped[f];
      if (q) items = items.filter(wo => [wo.title, wo.equipment_name, wo.location, wo.assigned_to].some(v => v && v.toLowerCase().includes(q)));
      // Overdue = past due and not done. `missed` IS that state — housekeeping
      // flips every past-due open task to it — so excluding it here is what
      // made the Overdue card open an empty list on a plant with real overdue
      // work. It must match the server's count, which counts the same set.
      // The list is COLLAPSED: a schedule's run of missed tasks is folded onto
      // one card (missed_count on a live card, or the surviving oldest missed
      // row). So "missed" must match the folded cards too, or the count above
      // opens a list that looks empty — the card carrying 14 missed runs has
      // status 'open'. The server's /pm/metrics counts these same collapsed
      // cards; keep the two predicates in step.
      if (statusFilter === 'overdue') items = items.filter(wo => wo.status === 'missed' || wo.missed_count > 0 || (wo.due_date < today && wo.status !== 'completed' && wo.status !== 'not_applicable'));
      else if (statusFilter === 'open') items = items.filter(wo => wo.status === 'open' || wo.status === 'in_progress');
      else if (statusFilter === 'missed') items = items.filter(wo => wo.status === 'missed' || wo.missed_count > 0);
      return { freq: f, items };
    })
    .filter(g => g.items.length > 0) : [];

  const searchMode = q.length >= 2;
  const totalActive = filteredGroups.reduce((sum, g) => sum + g.items.length, 0);

  // Flat, urgency-sorted worklist of every incomplete task (overdue first, then soonest due)
  const incompleteList = (() => {
    let items = grouped ? Object.values(grouped).flat() : [];
    if (freqFilter !== 'all') items = items.filter(wo => wo.frequency_type === freqFilter);
    if (q) items = items.filter(wo => [wo.title, wo.equipment_name, wo.location, wo.assigned_to].some(v => v && v.toLowerCase().includes(q)));
    return items.slice().sort((a, b) => {
      const ao = a.due_date < today ? 0 : 1;
      const bo = b.due_date < today ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.due_date || '').localeCompare(b.due_date || '');
    });
  })();
  const incompleteOverdue = incompleteList.filter(wo => wo.due_date < today).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Task Center</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowQr(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
            <QrCode size={15} /> Kiosk QR
          </button>
          {canEdit && (
            <button onClick={() => setShowWOForm(true)}
              className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
              <Plus size={16} /> New Task
            </button>
          )}
        </div>
      </div>

      {showQr && (
        <KioskQrModal
          cfg={{ kioskPath: '/submit', label: 'Submit a Work Order', formCode: 'Maintenance Request', kioskTagline: 'Scan to Submit a Work Order', kioskBlurb: 'Print and post this QR where staff report equipment issues. Scanning it opens the work-order form — no login required.' }}
          onClose={() => setShowQr(false)}
        />
      )}

      {/* Metrics */}
      {!metricsLoading && metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div onClick={() => { setStatusFilter(null); setView('active'); }}
            className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${metrics.meets_sqf_target ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <p className="text-xs text-gray-600 mb-1">Completion Rate</p>
            <p className="text-2xl font-bold">{metrics.completion_rate}%</p>
            <p className="text-xs mt-1">{metrics.meets_sqf_target ? 'SQF Target Met' : 'Below 95% Target'}</p>
          </div>
          <div onClick={() => { setStatusFilter(null); setView('active'); }}
            className={`rounded-xl border border-gray-200 bg-white p-4 cursor-pointer hover:shadow-md transition-shadow ${statusFilter === null && view === 'active' ? 'ring-2 ring-powder-500' : ''}`}>
            <p className="text-xs text-gray-600 mb-1">Total WOs</p>
            <p className="text-2xl font-bold">{metrics.total}</p>
          </div>
          <div onClick={() => { setStatusFilter(statusFilter === 'open' ? null : 'open'); setView('active'); }}
            className={`rounded-xl border border-gray-200 bg-white p-4 cursor-pointer hover:shadow-md transition-shadow ${statusFilter === 'open' ? 'ring-2 ring-yellow-500' : ''}`}>
            <p className="text-xs text-gray-600 mb-1">Open</p>
            <p className="text-2xl font-bold text-yellow-600">{metrics.open}</p>
            {statusFilter === 'open' && <p className="text-[10px] text-yellow-600 mt-1">Filtered</p>}
          </div>
          {/* ONE card, not two. Overdue and Missed were separate cards showing
              the same fact: nothing ever writes status='overdue', so every
              past-due task becomes 'missed' — the Overdue card sat at zero and
              the Missed card opened an empty list. Missed is now the sub-line
              it always was, and still filters to exactly those. */}
          <div onClick={() => { setStatusFilter(statusFilter === 'overdue' ? null : 'overdue'); setView('active'); }}
            className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${statusFilter === 'overdue' ? 'ring-2 ring-red-500' : ''} ${metrics.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-600 mb-1">Overdue</p>
            <p className="text-2xl font-bold text-red-600">{metrics.overdue}</p>
            {metrics.missed > 0 ? (
              <button type="button"
                onClick={(e) => { e.stopPropagation(); setStatusFilter(statusFilter === 'missed' ? null : 'missed'); setView('active'); }}
                className={`text-[10px] mt-1 underline ${statusFilter === 'missed' ? 'text-gray-900 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}>
                {metrics.missed} missed
              </button>
            ) : statusFilter === 'overdue' && <p className="text-[10px] text-red-600 mt-1">Filtered</p>}
          </div>
        </div>
      )}

      {/* Trend Chart */}
      {metrics?.monthly_trend?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Monthly PM Completion Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metrics.monthly_trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <ReferenceLine y={95} stroke="#e03131" strokeDasharray="3 3" label={{ value: '95% SQF', position: 'right', fontSize: 10 }} />
              <Bar dataKey="completed" name="Completed" fill="#40c057" />
              <Bar dataKey="missed" name="Missed" fill="#868e96" />
              <Bar dataKey="total" name="Total" fill="#dee2e6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showWOForm && <WOForm equipment={equipment} technicians={technicians} user={user} onSave={handleCreateWO} onCancel={() => setShowWOForm(false)} />}

      {/* Group Filter (Admin) + View Toggle + Frequency Filter */}
      <div className="space-y-2">
        {isAdmin && (
          <div className="flex items-start gap-2">
            <Users size={14} className="text-gray-500 mt-1.5 shrink-0" />
            <div className="flex gap-1 flex-wrap">
              {GROUP_TABS.map(g => (
                <button key={g.value} onClick={() => { setGroupFilter(g.value); if (view === 'completed') loadArchive(freqFilter, dateFrom, dateTo, g.value); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${groupFilter === g.value ? `${g.color} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => handleViewChange('incomplete')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${view === 'incomplete' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <ListChecks size={14} /> Incomplete ({incompleteList.length}{incompleteOverdue > 0 ? `, ${incompleteOverdue} overdue` : ''})
          </button>
          <button onClick={() => handleViewChange('active')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${view === 'active' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <Wrench size={14} /> By Frequency ({totalActive})
          </button>
          <button onClick={() => handleViewChange('completed')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${view === 'completed' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <Archive size={14} /> Completed
          </button>
          {(clearancePending?.length > 0) && (
            <button onClick={() => setView('clearance')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${view === 'clearance' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'}`}>
              <AlertTriangle size={14} /> Clearance ({clearancePending.length})
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks, equipment, location..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500 focus:border-transparent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium">
              Clear
            </button>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          {FREQ_TABS.map(f => {
            const count = f.value === 'all'
              ? Object.values(grouped || {}).reduce((s, arr) => s + arr.length, 0)
              : (grouped?.[f.value]?.length || 0);
            return (
              <button key={f.value} onClick={() => { setFreqFilter(f.value); if (view === 'completed') loadArchive(f.value, dateFrom, dateTo); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${freqFilter === f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label} {view === 'active' && count > 0 ? `(${count})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search results — every team, every status */}
      {searchMode && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-powder-100 text-powder-700">
              Search results
            </span>
            <span className="text-sm text-gray-500">
              {searching ? 'Searching…' : `${searchHits?.length || 0} match${(searchHits?.length || 0) === 1 ? '' : 'es'} for "${search.trim()}"`}
            </span>
            <span className="text-xs text-gray-400">· all teams and statuses, plus the last 90 days of completions</span>
          </div>
          {!searching && (searchHits?.length || 0) === 0 ? (
            <div className="text-center py-8 text-gray-500">Nothing matches "{search.trim()}".</div>
          ) : (
            <div className="space-y-2">
              {(searchHits || []).map(wo => (
                <div key={wo.id}>
                  <div className="flex items-center gap-2 mb-1 ml-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{(wo.task_group || 'general').replace('_', ' ')}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      wo.status === 'completed' ? 'bg-green-100 text-green-700'
                      : wo.status === 'missed' ? 'bg-red-100 text-red-700'
                      : wo.due_date < today ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                      {wo.status === 'completed' ? `completed ${(wo.completed_at || '').slice(0, 10)}`
                        : wo.status === 'missed' ? 'missed'
                        : wo.due_date < today ? `overdue · due ${wo.due_date}` : `due ${wo.due_date}`}
                    </span>
                  </div>
                  <TaskCard wo={wo} completing={completing}
                    onStartComplete={handleStartWO} onComplete={handleComplete}
                    onCancelComplete={() => setCompleting(null)} chemicals={chemicals}
                    flagging={flagging} onStartFlag={(id) => { setFlagging(flagging === id ? null : id); setCompleting(null); }}
                    onFlag={handleFlagIssue} onCancelFlag={() => setFlagging(null)}
                    canSnooze={canSnooze} snoozing={snoozingId}
                    onStartSnooze={(id) => { setSnoozingId(snoozingId === id ? null : id); setCompleting(null); setFlagging(null); }}
                    canReassign={isAdmin} technicians={technicians} onReassign={handleReassign}
                    onSnooze={handleSnooze} onCancelSnooze={() => setSnoozingId(null)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Incomplete — single actionable worklist */}
      {view === 'incomplete' && !searchMode && (
        <div className="space-y-6">
          {taskLoading ? (
            <div className="text-center py-8 text-gray-500">Loading tasks...</div>
          ) : incompleteList.length === 0 ? (
            <div className="text-center py-8 text-gray-500">All caught up — no incomplete tasks{freqFilter !== 'all' ? ` for ${freqFilter}` : ''}.</div>
          ) : (
            [
              { key: 'overdue', label: 'Overdue', color: 'bg-red-100 text-red-700', items: incompleteList.filter(w => w.due_date < today) },
              { key: 'upcoming', label: 'Open / Upcoming', color: 'bg-gray-100 text-gray-700', items: incompleteList.filter(w => w.due_date >= today) },
            ].filter(s => s.items.length > 0).map(s => (
              <div key={s.key}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${s.color}`}>{s.label}</span>
                  <span className="text-sm text-gray-500">{s.items.length} task{s.items.length > 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-2">
                  {s.items.map(wo => (
                    <TaskCard key={wo.id} wo={wo} completing={completing}
                      onStartComplete={handleStartWO} onComplete={handleComplete}
                      onCancelComplete={() => setCompleting(null)} chemicals={chemicals}
                      flagging={flagging} onStartFlag={(id) => { setFlagging(flagging === id ? null : id); setCompleting(null); }}
                      onFlag={handleFlagIssue} onCancelFlag={() => setFlagging(null)}
                      canSnooze={canSnooze} snoozing={snoozingId}
                      onStartSnooze={(id) => { setSnoozingId(snoozingId === id ? null : id); setCompleting(null); setFlagging(null); }}
                    canReassign={isAdmin} technicians={technicians} onReassign={handleReassign}
                      onSnooze={handleSnooze} onCancelSnooze={() => setSnoozingId(null)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Active Tasks by Frequency */}
      {view === 'active' && !searchMode && (
        <div className="space-y-6">
          {taskLoading ? (
            <div className="text-center py-8 text-gray-500">Loading PM tasks...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No active PM tasks{freqFilter !== 'all' ? ` for ${freqFilter}` : ''}</div>
          ) : filteredGroups.map(({ freq, items }) => (
            <div key={freq}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${FREQ_COLORS[freq]}`}>
                  {freq.charAt(0).toUpperCase() + freq.slice(1).replace('_', '-')}
                </span>
                <span className="text-sm text-gray-500">{items.length} task{items.length > 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {items.map(wo => (
                  <TaskCard key={wo.id} wo={wo} completing={completing}
                    onStartComplete={handleStartWO} onComplete={handleComplete}
                    onCancelComplete={() => setCompleting(null)} chemicals={chemicals}
                    flagging={flagging} onStartFlag={(id) => { setFlagging(flagging === id ? null : id); setCompleting(null); }}
                    onFlag={handleFlagIssue} onCancelFlag={() => setFlagging(null)}
                    canSnooze={canSnooze} snoozing={snoozingId}
                    onStartSnooze={(id) => { setSnoozingId(snoozingId === id ? null : id); setCompleting(null); setFlagging(null); }}
                    canReassign={isAdmin} technicians={technicians} onReassign={handleReassign}
                    onSnooze={handleSnooze} onCancelSnooze={() => setSnoozingId(null)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed Archive */}
      {view === 'completed' && !searchMode && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap bg-white rounded-xl border border-gray-200 p-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); loadArchive(freqFilter, e.target.value, dateTo); }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); loadArchive(freqFilter, dateFrom, e.target.value); }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); loadArchive(freqFilter, '', ''); }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 bg-gray-100 rounded-lg">Clear dates</button>
            )}
            <div className="ml-auto">
              <button onClick={() => {
                if (!archiveData?.items?.length) return;
                exportToCsv(`pm-history-${new Date().toISOString().split('T')[0]}.csv`, [
                  { label: 'Group', value: r => (r.task_group || 'warehouse').toUpperCase() },
                  { label: 'Status', value: r => r.status },
                  { label: 'Title', value: r => r.title || r.pm_title },
                  { label: 'Equipment', value: r => r.equipment_name },
                  { label: 'Location', value: r => r.location },
                  { label: 'Frequency', value: r => r.frequency_type || 'ad-hoc' },
                  { label: 'Due Date', value: r => r.due_date },
                  { label: 'Completed At', value: r => r.completed_at || '' },
                  { label: 'Completed By', value: r => r.completed_by || '' },
                  { label: 'Assigned To', value: r => r.assigned_to || '' },
                  { label: 'Priority', value: r => r.priority },
                  { label: 'Notes', value: r => r.notes || '' },
                ], archiveData.items);
              }} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                <Download size={14} /> Export CSV
              </button>
            </div>
          </div>

          {archiveLoading ? (
            <div className="text-center py-8 text-gray-500">Loading completed tasks...</div>
          ) : !archiveData?.items?.length ? (
            <div className="text-center py-8 text-gray-500">No completed tasks{dateFrom || dateTo ? ' in selected date range' : ' yet'}</div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-gray-500">{archiveData.total} task{archiveData.total !== 1 ? 's' : ''}{dateFrom || dateTo ? ' (filtered)' : ''}</p>
                {archiveData.missed_count > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full font-medium">{archiveData.missed_count} missed total</span>
                )}
              </div>
              {archiveData.items.map(wo => {
                const isMissed = wo.status === 'missed';
                const isNA = wo.status === 'not_applicable';
                const isExpanded = expandedArchive === wo.id;

                if (isExpanded) {
                  return <CompletedTaskDetail key={wo.id} wo={wo} onClose={() => setExpandedArchive(null)}
                    canReview={canReviewTasks}
                    onReviewed={() => { setExpandedArchive(null); loadArchive(freqFilter, dateFrom, dateTo); refreshTasks(); }} />;
                }

                return (
                  <div key={wo.id}
                    onClick={() => setExpandedArchive(wo.id)}
                    className={`rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:border-powder-300 ${isMissed ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {isMissed ? (
                            <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold">MISSED</span>
                          ) : isNA ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">N/A</span>
                          ) : (
                            <CheckCircle size={14} className="text-green-600" />
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[wo.frequency_type] || FREQ_COLORS.unscheduled}`}>
                            {wo.frequency_type || 'ad-hoc'}
                          </span>
                          {wo.task_group && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${GROUP_BADGE[wo.task_group] || 'bg-gray-100 text-gray-600'}`}>{{ maintenance: 'MNT', warehouse: 'WH', qa: 'QA', cleaning: 'CLN', batching: 'BAT', kitting: 'KIT', filling: 'FIL', document_control: 'DC' }[wo.task_group] || String(wo.task_group).slice(0, 3).toUpperCase()}</span>}
                          {wo.issue_flagged === 1 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-semibold"><Flag size={10} /> Issue</span>}
                          {wo.reading_result && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${wo.reading_result === 'pass' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {wo.reading_result.toUpperCase()}
                            </span>
                          )}
                          <FormChip subject={{ taskTitle: wo.pm_title || wo.title }} />
                        </div>
                        <h4 className={`font-medium ${isMissed ? 'text-gray-600' : 'text-gray-800'}`}>{wo.title || wo.pm_title}</h4>
                        <p className="text-sm text-gray-500">{wo.equipment_name}{wo.asset_id ? ` #${wo.asset_id}` : ''} — {wo.location}</p>
                        {isMissed ? (
                          <p className="text-xs text-gray-500 mt-1">Due: {wo.due_date}{wo.assigned_to ? ` · Assigned: ${wo.assigned_to}` : ''}</p>
                        ) : (
                          <p className="text-xs text-green-600 mt-1">
                            Completed {formatDateTime(wo.completed_at)} by {wo.completed_by}
                          </p>
                        )}
                        {wo.notes && <p className="text-xs text-gray-500 mt-1 truncate max-w-md">Notes: {wo.notes}</p>}
                      </div>
                      <div className="ml-2 shrink-0 text-gray-400 hover:text-powder-600">
                        <Eye size={16} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Clearance Pending */}
      {view === 'clearance' && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" /> Pending Hygiene Clearance
          </h3>
          <p className="text-sm text-gray-500">These completed work orders on food-contact equipment require hygiene sign-off before restart.</p>
          {(clearancePending || []).length === 0 ? (
            <div className="text-center py-8 text-gray-400">No work orders pending clearance</div>
          ) : (clearancePending || []).map(wo => (
            <ClearanceCard key={wo.id} wo={wo} onClear={async (form) => {
              await apiPut(`/pm/work-orders/${wo.id}/clearance`, form);
              refreshClearance();
              refreshTasks();
            }} user={user} />
          ))}
        </div>
      )}
    </div>
  );
}
