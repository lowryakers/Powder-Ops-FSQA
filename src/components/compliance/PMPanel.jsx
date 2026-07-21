import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, CheckCircle, Wrench, ChevronDown, ChevronUp, Archive, Paperclip, Download, Search, Users, AlertTriangle, ShieldCheck, Flag, Eye, Droplets, Thermometer, X, ListChecks, QrCode } from 'lucide-react';
import KioskQrModal from '../kiosk/KioskQrModal';
import FileUpload from '../FileUpload';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { exportToCsv } from '../../utils/exportCsv';

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
    try { await onComplete(wo.id, form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-green-50 rounded-lg border border-green-200 p-3 mt-2 space-y-2">
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
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Complete & Generate Next'}
        </button>
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
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">New Task</h3>
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
          <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Unassigned (whole team)</option>
            {(technicians || []).map(t => <option key={t.id} value={t.name}>{t.name} ({t.role})</option>)}
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
          {saving ? 'Creating...' : 'Create Task'}
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

function CompletedTaskDetail({ wo, onClose }) {
  const steps = safeParseFe(wo.procedure_steps, []);
  const stepResults = safeParseFe(wo.step_results, []);
  const readings = safeParseFe(wo.readings, {});
  const attachments = safeParseFe(wo.attachments, []);
  const issueAttachments = safeParseFe(wo.issue_attachments, []);
  const isNA = wo.status === 'not_applicable';
  const isMissed = wo.status === 'missed';

  const hasReadings = Object.keys(readings).length > 0;
  const hasSteps = steps.length > 0;

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
            {wo.task_group && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${GROUP_BADGE[wo.task_group] || 'bg-gray-100 text-gray-600'}`}>{{ maintenance: 'MNT', warehouse: 'WH', qa: 'QA', cleaning: 'CLN' }[wo.task_group] || 'WH'}</span>}
            {wo.priority === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
            {wo.priority === 'high' && <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs">High</span>}
            {wo.reading_result && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${wo.reading_result === 'pass' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {wo.reading_result.toUpperCase()}
              </span>
            )}
          </div>
          <h4 className="font-semibold text-gray-900 text-lg">{wo.title || wo.pm_title}</h4>
          <p className="text-sm text-gray-600">{wo.equipment_name} — {wo.location || 'No location'}</p>
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
            <p className="text-sm font-medium text-green-700">{new Date(wo.completed_at).toLocaleString()}</p>
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
            <p className="text-sm text-gray-600">{new Date(wo.created_at).toLocaleString()}</p>
          </div>
        )}
        {wo.started_at && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Started</p>
            <p className="text-sm text-gray-600">{new Date(wo.started_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Procedure Steps */}
      {hasSteps && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <CheckCircle size={12} /> Procedure Steps ({steps.length})
          </h5>
          <ul className="space-y-1 text-sm">
            {steps.map((step, i) => {
              const isHeader = typeof step === 'string' && step.endsWith(':');
              const result = stepResults[i];
              const done = result === true || result === 'done' || result === 'pass';
              return (
                <li key={i} className={`flex items-start gap-2 ${isHeader ? 'font-semibold text-gray-800 mt-2' : 'text-gray-600 pl-3'}`}>
                  {!isHeader && (
                    <span className={`mt-0.5 shrink-0 ${done ? 'text-green-500' : 'text-gray-300'}`}>
                      {done ? <CheckCircle size={14} /> : <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-gray-300" />}
                    </span>
                  )}
                  <span>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Readings / Inspection Data */}
      {hasReadings && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Thermometer size={12} /> Readings & Inspection Data
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

      {/* Lubricant Info */}
      {wo.lubricant_used && (
        <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-3">
          <Droplets size={16} className="text-blue-600 shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lubricant Used</p>
            <p className="text-sm font-medium text-gray-900">
              {wo.lubricant_used}
              {wo.lubricant_is_food_grade ? <span className="ml-2 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Food-Grade</span> : ''}
            </p>
          </div>
        </div>
      )}

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
            {wo.clearance_at && <div><span className="text-xs text-gray-500">At:</span> <span className="font-medium">{new Date(wo.clearance_at).toLocaleString()}</span></div>}
            {wo.clearance_notes && <div className="col-span-2"><span className="text-xs text-gray-500">Notes:</span> <span>{wo.clearance_notes}</span></div>}
          </div>
        </div>
      )}

      {/* Notes */}
      {wo.notes && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</h5>
          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{wo.notes}</p>
        </div>
      )}

      {/* Issue Flags */}
      {wo.issue_flagged === 1 && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-3">
          <p className="text-xs font-semibold text-red-800 flex items-center gap-1 mb-1"><Flag size={11} /> Issue Reported</p>
          <p className="text-sm text-red-900">{wo.issue_notes}</p>
          <p className="text-xs text-red-600 mt-1">
            Flagged by {wo.issue_flagged_by} · {wo.issue_flagged_at ? new Date(wo.issue_flagged_at).toLocaleString() : ''}
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
    </div>
  );
}

function TaskCard({ wo, onStartComplete, completing, onComplete, onCancelComplete, chemicals, flagging, onStartFlag, onFlag, onCancelFlag }) {
  const steps = wo.procedure_steps || [];
  const attachments = (() => { try { return JSON.parse(wo.attachments || '[]'); } catch { return []; } })();
  const issueAttachments = (() => { try { return JSON.parse(wo.issue_attachments || '[]'); } catch { return []; } })();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-white rounded-xl border p-4 ${wo.issue_flagged ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[wo.frequency_type] || FREQ_COLORS.unscheduled}`}>
              {wo.frequency_type || 'ad-hoc'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[wo.status]}`}>{wo.status}</span>
            {wo.issue_flagged === 1 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-semibold"><Flag size={10} /> Issue</span>}
            {wo.priority === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
            {wo.priority === 'high' && !wo.issue_flagged && <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs">High</span>}
            {attachments.length > 0 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"><Paperclip size={10} />{attachments.length}</span>}
            {wo.task_group && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${GROUP_BADGE[wo.task_group] || 'bg-gray-100 text-gray-600'}`}>{{ maintenance: 'MNT', warehouse: 'WH', qa: 'QA', cleaning: 'CLN' }[wo.task_group] || 'WH'}</span>}
          </div>
          <h4 className="font-medium text-gray-900 truncate">{wo.title}</h4>
          <p className="text-sm text-gray-500">{wo.equipment_name} — {wo.location || 'No location'}</p>
          <p className="text-xs text-gray-400 mt-0.5">Due: {wo.due_date}{wo.assigned_to ? ` · Assigned: ${wo.assigned_to}` : ''}</p>
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
          <button onClick={() => onStartComplete(wo.id, 'complete')}
            className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100 flex items-center gap-1">
            <CheckCircle size={12} /> Done
          </button>
        </div>
      </div>

      {wo.issue_flagged === 1 && (
        <div className="mt-2 bg-red-50 rounded-lg border border-red-200 p-2.5">
          <p className="text-xs font-semibold text-red-800 flex items-center gap-1 mb-1"><Flag size={11} /> Issue Reported</p>
          <p className="text-sm text-red-900">{wo.issue_notes}</p>
          <p className="text-xs text-red-600 mt-1">
            Flagged by {wo.issue_flagged_by} · {wo.issue_flagged_at ? new Date(wo.issue_flagged_at).toLocaleString() : ''}
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
  { value: 'sticks', label: 'Sticks', color: 'bg-cyan-600' },
  { value: 'hand_fill', label: 'Hand Fill', color: 'bg-purple-600' },
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
          </div>
          <h4 className="font-medium text-gray-900 truncate">{wo.title}</h4>
          <p className="text-sm text-gray-500">{wo.equipment_name} — {wo.location || 'No location'}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Due: {wo.due_date} · Completed {wo.completed_at ? new Date(wo.completed_at).toLocaleString() : '—'} by {wo.completed_by || '—'}
          </p>
        </div>
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
  const [statusFilter, setStatusFilter] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const handleCreateWO = async (form) => {
    await apiPost('/pm/work-orders', form);
    setShowWOForm(false);
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
  const today = new Date().toISOString().split('T')[0];
  const filteredGroups = grouped ? freqOrder
    .filter(f => grouped[f]?.length > 0)
    .filter(f => freqFilter === 'all' || f === freqFilter)
    .map(f => {
      let items = grouped[f];
      if (q) items = items.filter(wo => [wo.title, wo.equipment_name, wo.location, wo.assigned_to].some(v => v && v.toLowerCase().includes(q)));
      if (statusFilter === 'overdue') items = items.filter(wo => wo.due_date < today && wo.status !== 'completed' && wo.status !== 'missed');
      else if (statusFilter === 'open') items = items.filter(wo => wo.status === 'open' || wo.status === 'in_progress');
      else if (statusFilter === 'missed') items = items.filter(wo => wo.status === 'missed');
      return { freq: f, items };
    })
    .filter(g => g.items.length > 0) : [];

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
          <button onClick={() => setShowWOForm(true)}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> New Task
          </button>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
          <div onClick={() => { setStatusFilter(statusFilter === 'missed' ? null : 'missed'); setView('active'); }}
            className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${statusFilter === 'missed' ? 'ring-2 ring-gray-500' : ''} ${metrics.missed > 0 ? 'border-gray-300 bg-gray-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-600 mb-1">Missed</p>
            <p className="text-2xl font-bold text-gray-600">{metrics.missed}</p>
            {statusFilter === 'missed' && <p className="text-[10px] text-gray-600 mt-1">Filtered</p>}
          </div>
          <div onClick={() => { setStatusFilter(statusFilter === 'overdue' ? null : 'overdue'); setView('active'); }}
            className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${statusFilter === 'overdue' ? 'ring-2 ring-red-500' : ''} ${metrics.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-600 mb-1">Overdue</p>
            <p className="text-2xl font-bold text-red-600">{metrics.overdue}</p>
            {statusFilter === 'overdue' && <p className="text-[10px] text-red-600 mt-1">Filtered</p>}
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

      {/* Incomplete — single actionable worklist */}
      {view === 'incomplete' && (
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
                      onFlag={handleFlagIssue} onCancelFlag={() => setFlagging(null)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Active Tasks by Frequency */}
      {view === 'active' && (
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
                    onFlag={handleFlagIssue} onCancelFlag={() => setFlagging(null)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed Archive */}
      {view === 'completed' && (
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
                  return <CompletedTaskDetail key={wo.id} wo={wo} onClose={() => setExpandedArchive(null)} />;
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
                          {wo.task_group && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${GROUP_BADGE[wo.task_group] || 'bg-gray-100 text-gray-600'}`}>{{ maintenance: 'MNT', warehouse: 'WH', qa: 'QA', cleaning: 'CLN' }[wo.task_group] || 'WH'}</span>}
                          {wo.issue_flagged === 1 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-semibold"><Flag size={10} /> Issue</span>}
                          {wo.reading_result && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${wo.reading_result === 'pass' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {wo.reading_result.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <h4 className={`font-medium ${isMissed ? 'text-gray-600' : 'text-gray-800'}`}>{wo.title || wo.pm_title}</h4>
                        <p className="text-sm text-gray-500">{wo.equipment_name} — {wo.location}</p>
                        {isMissed ? (
                          <p className="text-xs text-gray-500 mt-1">Due: {wo.due_date}{wo.assigned_to ? ` · Assigned: ${wo.assigned_to}` : ''}</p>
                        ) : (
                          <p className="text-xs text-green-600 mt-1">
                            Completed {new Date(wo.completed_at).toLocaleString()} by {wo.completed_by}
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
