import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CheckCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, Wrench, CalendarDays, ChevronRight, CircleDot, Filter, Search, Flag, Paperclip, Camera, Thermometer, Droplets, Lightbulb, FlaskConical, ClipboardCheck, SquareCheck, Square } from 'lucide-react';
import FileUpload from '../FileUpload';

function detectTaskType(task) {
  const t = (task.title || '').toLowerCase();
  const g = task.task_group || '';
  if (t.includes('temp') && t.includes('humid')) return 'temp_humidity';
  if (t.includes('chemical dilution')) return 'chemical_dilution';
  if (t.includes('brittle') || (t.includes('glass') && t.includes('plastic'))) return 'glass_plastic';
  if (t.includes('light') && (t.includes('inspection') || t.includes('fixture'))) return 'light_inspection';
  if (t.includes('pre-op') || t.includes('changeover') || t.includes('production line')) return 'production_clean';
  if (g === 'cleaning') return 'cleaning';
  return 'equipment_pm';
}

const FREQ_COLORS = {
  daily: 'bg-blue-500',
  weekly: 'bg-purple-500',
  monthly: 'bg-amber-500',
  quarterly: 'bg-emerald-500',
  annual: 'bg-rose-500',
};

const PRIORITY_RING = {
  critical: 'ring-2 ring-red-400 border-red-400',
  high: 'ring-2 ring-orange-300 border-orange-300',
};

function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.floor((new Date(a) - new Date(b)) / msPerDay);
}

function formatDueLabel(dueDate) {
  const today = new Date().toISOString().split('T')[0];
  const diff = daysBetween(dueDate, today);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff <= 7) return `Due in ${diff} days`;
  return `Due ${dueDate}`;
}

function TaskCard({ task, onComplete, onFlagIssue, onAssign, technicians, userName }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [notes, setNotes] = useState('');
  const [readings, setReadings] = useState({});
  const [stepChecks, setStepChecks] = useState([]);
  const [issueNotes, setIssueNotes] = useState('');
  const [issueAttachments, setIssueAttachments] = useState([]);
  const [saving, setSaving] = useState(false);

  const steps = task.procedure_steps || [];
  const taskType = detectTaskType(task);
  const issuePhotos = (() => { try { return JSON.parse(task.issue_attachments || '[]'); } catch { return []; } })();
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = task.due_date < today;
  const isDueToday = task.due_date === today;
  const isCritical = task.priority === 'critical' || task.priority === 'high';

  const updateReading = (key, val) => setReadings(prev => ({ ...prev, [key]: val }));
  const toggleStep = (i) => setStepChecks(prev => {
    const next = [...prev];
    next[i] = !next[i];
    return next;
  });

  const getReadingResult = () => {
    if (taskType === 'temp_humidity') {
      const h = parseFloat(readings.humidity);
      if (isNaN(h)) return null;
      return h <= 40 ? 'pass' : 'fail';
    }
    if (taskType === 'chemical_dilution') {
      return readings.dilution_pass === 'yes' ? 'pass' : readings.dilution_pass === 'no' ? 'fail' : null;
    }
    if (taskType === 'light_inspection') {
      return readings.light_pass === 'yes' ? 'pass' : readings.light_pass === 'no' ? 'fail' : null;
    }
    if (taskType === 'glass_plastic') {
      return readings.condition === 'good' ? 'pass' : readings.condition ? 'fail' : null;
    }
    if (taskType === 'production_clean') {
      return readings.visual_pass === 'yes' ? 'pass' : readings.visual_pass === 'no' ? 'fail' : null;
    }
    return null;
  };

  const canSubmit = () => {
    if (taskType === 'temp_humidity') return readings.temperature && readings.humidity;
    if (taskType === 'chemical_dilution') return readings.chemical_name && readings.ppm_reading && readings.dilution_pass;
    if (taskType === 'light_inspection') return readings.foot_candles && readings.light_pass;
    if (taskType === 'glass_plastic') return readings.items_inspected && readings.condition;
    if (taskType === 'production_clean') return readings.visual_pass;
    return true;
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onComplete(task.id, {
        _actor: userName || 'Operator',
        notes: notes || null,
        readings: Object.keys(readings).length > 0 ? readings : undefined,
        step_results: stepChecks.length > 0 ? stepChecks : undefined,
        reading_result: getReadingResult(),
      });
      setCompleting(false);
      setNotes('');
      setReadings({});
      setStepChecks([]);
    } finally { setSaving(false); }
  };

  const handleFlagSubmit = async () => {
    setSaving(true);
    try {
      await onFlagIssue(task.id, { _actor: userName || 'Operator', notes: issueNotes, attachments: issueAttachments });
      setFlagging(false);
      setIssueNotes('');
      setIssueAttachments([]);
    } finally { setSaving(false); }
  };

  return (
    <div className={`bg-white rounded-2xl border-2 transition-all ${
      task.issue_flagged ? 'border-red-400 bg-red-50/30' :
      isOverdue ? 'border-red-400 bg-red-50/30' :
      isCritical ? (PRIORITY_RING[task.priority] || 'border-gray-200') :
      isDueToday ? 'border-powder-400' :
      'border-gray-200'
    }`}>
      {/* Main card content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Action buttons column */}
          <div className="shrink-0 flex flex-col gap-1.5 mt-0.5">
            {!completing && !flagging ? (
              <>
                <button onClick={() => { setCompleting(true); setFlagging(false); }}
                  className="w-11 h-11 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-green-500 hover:text-green-500 hover:bg-green-50 transition-all active:scale-90">
                  <CheckCircle size={22} />
                </button>
                <button onClick={() => { setFlagging(true); setCompleting(false); }}
                  className="w-11 h-11 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-red-500 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90"
                  title="Flag an issue">
                  <Flag size={18} />
                </button>
              </>
            ) : completing ? (
              <div className="w-11 h-11 rounded-full bg-green-500 flex items-center justify-center">
                <CheckCircle size={22} className="text-white" />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center">
                <Flag size={18} className="text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <h3 className="text-base font-semibold text-gray-900 leading-snug">{task.title}</h3>

            {/* Equipment + location */}
            <p className="text-sm text-gray-500 mt-0.5">
              {task.equipment_name}
              {task.location && <span className="text-gray-400"> &middot; {task.location}</span>}
            </p>

            {/* Meta row: badges + due */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {task.issue_flagged === 1 && (
                <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wide bg-red-500">
                  <Flag size={9} /> Issue
                </span>
              )}

              {task.frequency_type && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wide ${FREQ_COLORS[task.frequency_type] || 'bg-gray-400'}`}>
                  {task.frequency_type}
                </span>
              )}

              <span className={`text-xs font-medium flex items-center gap-1 ${
                isOverdue ? 'text-red-600' : isDueToday ? 'text-powder-600' : 'text-gray-400'
              }`}>
                {isOverdue ? <AlertTriangle size={11} /> : <Clock size={11} />}
                {formatDueLabel(task.due_date)}
              </span>

              {task.assigned_to && (
                <span className="text-xs text-gray-400">&middot; {task.assigned_to}</span>
              )}
            </div>
          </div>

          {/* Expand chevron if steps exist */}
          {steps.length > 0 && !completing && !flagging && (
            <button onClick={() => setExpanded(!expanded)}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 mt-0.5">
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          )}
        </div>

        {/* Existing issue display */}
        {task.issue_flagged === 1 && !flagging && (
          <div className="mt-3 ml-14 bg-red-50 rounded-xl p-3 border border-red-200">
            <p className="text-xs font-semibold text-red-800 flex items-center gap-1 mb-1"><Flag size={11} /> Issue Reported</p>
            <p className="text-sm text-red-900">{task.issue_notes}</p>
            <p className="text-xs text-red-600 mt-1">
              Flagged by {task.issue_flagged_by} &middot; {task.issue_flagged_at ? new Date(task.issue_flagged_at).toLocaleString() : ''}
            </p>
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

        {/* Steps accordion */}
        {expanded && steps.length > 0 && (
          <div className="mt-3 ml-14">
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="text-gray-600 leading-snug">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Inline issue flagging */}
        {flagging && (
          <div className="mt-3 ml-14 bg-red-50 rounded-xl p-3 space-y-2 border border-red-200">
            <h4 className="text-xs font-bold text-red-800 uppercase tracking-wide flex items-center gap-1"><Flag size={11} /> Report an Issue</h4>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">What's the issue? *</label>
              <textarea required value={issueNotes} onChange={e => setIssueNotes(e.target.value)} autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={3}
                placeholder="Describe the problem, what you observed, any safety concerns..." />
            </div>
            <FileUpload files={issueAttachments} onChange={setIssueAttachments} />
            <div className="flex gap-2">
              <button onClick={handleFlagSubmit} disabled={saving || !issueNotes.trim()}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                {saving ? 'Saving...' : 'Flag Issue'}
              </button>
              <button onClick={() => { setFlagging(false); setIssueNotes(''); setIssueAttachments([]); }}
                className="px-4 py-2.5 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Inline completion */}
        {completing && (
          <div className="mt-3 ml-14 bg-green-50 rounded-xl p-3 space-y-3 border border-green-200">
            {/* Type-specific fields */}
            {taskType === 'temp_humidity' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><Thermometer size={12} /> Record Readings</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Temperature (°F) *</label>
                    <input type="number" step="0.1" value={readings.temperature || ''} onChange={e => updateReading('temperature', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 68.5" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Humidity (%) *</label>
                    <input type="number" step="0.1" value={readings.humidity || ''} onChange={e => updateReading('humidity', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 35.2" />
                  </div>
                </div>
                {readings.humidity && parseFloat(readings.humidity) > 40 && (
                  <div className="bg-red-100 border border-red-300 rounded-lg p-2 text-xs text-red-800 font-medium">
                    Humidity exceeds 40% — notify manager and check dehumidifiers/A/C units.
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => updateReading('rolling_doors_closed', !readings.rolling_doors_closed)}
                    className="text-gray-500 hover:text-green-600">
                    {readings.rolling_doors_closed ? <SquareCheck size={18} className="text-green-600" /> : <Square size={18} />}
                  </button>
                  <span className="text-sm text-gray-700">Rolling doors verified closed</span>
                </div>
                {readings.temperature && readings.humidity && (
                  <div className={`rounded-lg p-2 text-xs font-bold text-center ${parseFloat(readings.humidity) <= 40 ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'}`}>
                    {parseFloat(readings.humidity) <= 40 ? 'PASS — Within acceptable range' : 'FAIL — Humidity above 40% threshold'}
                  </div>
                )}
              </>
            )}

            {taskType === 'chemical_dilution' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><FlaskConical size={12} /> Chemical Verification</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Chemical *</label>
                    <select value={readings.chemical_name || ''} onChange={e => updateReading('chemical_name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus>
                      <option value="">Select chemical</option>
                      <option value="Sani-512">Sani-512 (200-250 ppm)</option>
                      <option value="Chlorine">Chlorine (100-200 ppm)</option>
                      <option value="Dawn">Dawn Dish Soap</option>
                      <option value="Simple Green">Simple Green</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">PPM Reading *</label>
                    <input type="number" value={readings.ppm_reading || ''} onChange={e => updateReading('ppm_reading', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 225" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Lot Number</label>
                    <input type="text" value={readings.lot_number || ''} onChange={e => updateReading('lot_number', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Lot #" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Expiration Date</label>
                    <input type="date" value={readings.expiration_date || ''} onChange={e => updateReading('expiration_date', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Within acceptable range? *</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('dilution_pass', 'yes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.dilution_pass === 'yes' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Pass
                    </button>
                    <button onClick={() => updateReading('dilution_pass', 'no')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.dilution_pass === 'no' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Fail
                    </button>
                  </div>
                </div>
              </>
            )}

            {taskType === 'glass_plastic' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> Brittle Plastic & Glass Inspection</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Items Inspected *</label>
                    <input type="number" value={readings.items_inspected || ''} onChange={e => updateReading('items_inspected', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Total count" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Items Damaged</label>
                    <input type="number" value={readings.items_damaged || ''} onChange={e => updateReading('items_damaged', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Overall Condition *</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('condition', 'good')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.condition === 'good' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      All Good
                    </button>
                    <button onClick={() => updateReading('condition', 'needs_attention')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.condition === 'needs_attention' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Needs Attention
                    </button>
                    <button onClick={() => updateReading('condition', 'broken')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.condition === 'broken' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Broken
                    </button>
                  </div>
                </div>
                {readings.condition && readings.condition !== 'good' && (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-2 text-xs text-amber-800 font-medium">
                    Document damaged/broken items in the notes below and notify your manager.
                  </div>
                )}
              </>
            )}

            {taskType === 'light_inspection' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><Lightbulb size={12} /> Light Inspection</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Reading (foot-candles) *</label>
                    <input type="number" value={readings.foot_candles || ''} onChange={e => updateReading('foot_candles', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 220" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fixtures Checked</label>
                    <input type="number" value={readings.fixtures_checked || ''} onChange={e => updateReading('fixtures_checked', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Count" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">Production: min 30 fc | Inspection/QC: 50-130 fc</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">All fixtures pass? *</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('light_pass', 'yes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.light_pass === 'yes' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Pass
                    </button>
                    <button onClick={() => updateReading('light_pass', 'no')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.light_pass === 'no' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Fail
                    </button>
                  </div>
                </div>
              </>
            )}

            {taskType === 'production_clean' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><Droplets size={12} /> Production Line Verification</h4>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateReading('allergen_check', !readings.allergen_check)} className="text-gray-500 hover:text-green-600">
                    {readings.allergen_check ? <SquareCheck size={18} className="text-green-600" /> : <Square size={18} />}
                  </button>
                  <span className="text-sm text-gray-700">Allergen verification complete</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">ATP Reading (RLU)</label>
                    <input type="number" value={readings.atp_reading || ''} onChange={e => updateReading('atp_reading', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 10" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Sanitizer Contact (min)</label>
                    <input type="number" value={readings.contact_time || ''} onChange={e => updateReading('contact_time', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Minutes" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Visual inspection pass? *</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('visual_pass', 'yes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.visual_pass === 'yes' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Pass
                    </button>
                    <button onClick={() => updateReading('visual_pass', 'no')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.visual_pass === 'no' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      Fail
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step-by-step checkoff for cleaning and equipment PM */}
            {(taskType === 'cleaning' || taskType === 'equipment_pm') && steps.length > 0 && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> Checklist</h4>
                <div className="space-y-1">
                  {steps.map((step, i) => (
                    <button key={i} onClick={() => toggleStep(i)}
                      className="w-full flex items-start gap-2 text-left py-1.5 px-1 rounded-lg hover:bg-green-100/50 transition-colors">
                      {stepChecks[i] ? <SquareCheck size={18} className="text-green-600 shrink-0 mt-0.5" /> : <Square size={18} className="text-gray-400 shrink-0 mt-0.5" />}
                      <span className={`text-sm leading-snug ${stepChecks[i] ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{step}</span>
                    </button>
                  ))}
                </div>
                {steps.length > 0 && (
                  <p className="text-[10px] text-gray-500 text-center">{stepChecks.filter(Boolean).length} / {steps.length} steps complete</p>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes {(taskType === 'cleaning' || taskType === 'equipment_pm') ? '(optional)' : ''}</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2}
                placeholder={taskType === 'temp_humidity' ? 'Corrective actions taken, dehumidifier status...' :
                  taskType === 'glass_plastic' ? 'Describe damaged items, locations...' :
                  taskType === 'chemical_dilution' ? 'Dilution adjustments made...' :
                  'Any issues or observations...'} />
            </div>
            {technicians && technicians.length > 0 && !task.assigned_to && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Assign to</label>
                <select onChange={e => { if (e.target.value) onAssign(task.id, e.target.value); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" defaultValue="">
                  <option value="">Leave unassigned</option>
                  {technicians.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleSubmit} disabled={saving || !canSubmit()}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                {saving ? 'Saving...' : 'Mark Complete'}
              </button>
              <button onClick={() => { setCompleting(false); setNotes(''); setReadings({}); setStepChecks([]); }}
                className="px-4 py-2.5 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count, color, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-2 group">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold text-gray-900 flex-1 text-left">{title}</span>
        <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
        <ChevronRight size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="space-y-2 pb-4">{children}</div>}
    </div>
  );
}

const DEPT_OPTIONS = [
  { id: 'all', label: 'All Teams' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'qa', label: 'QA' },
  { id: 'cleaning', label: 'Cleaning' },
];

export default function OperatorView() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor';
  const [viewDept, setViewDept] = useState(isAdmin ? 'all' : (user?.department || 'warehouse'));
  const groupParam = viewDept === 'all' ? '' : `?group=${viewDept}`;
  const { data: tasks, loading, refresh } = useApiGet(`/pm/operator-tasks${groupParam}`);
  const { data: technicians } = useApiGet('/users/technicians');
  const [freqFilter, setFreqFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');

  const handleComplete = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
    refresh();
  };

  const handleFlagIssue = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/flag-issue`, form);
    refresh();
  };

  const handleAssign = async (woId, assignedTo) => {
    await apiPut(`/pm/work-orders/${woId}`, { assigned_to: assignedTo });
    refresh();
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (tasks || []).filter(t => {
      if (freqFilter !== 'all' && t.frequency_type !== freqFilter) return false;
      if (q && ![t.title, t.equipment_name, t.location, t.assigned_to].some(v => v && v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, freqFilter, search]);

  const { overdue, today, thisWeek, upcoming } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const groups = { overdue: [], today: [], thisWeek: [], upcoming: [] };
    for (const t of filtered) {
      if (t.due_date < todayStr) groups.overdue.push(t);
      else if (t.due_date === todayStr) groups.today.push(t);
      else if (t.due_date <= weekEndStr) groups.thisWeek.push(t);
      else groups.upcoming.push(t);
    }
    return groups;
  }, [filtered]);

  const freqCounts = useMemo(() => {
    const c = {};
    for (const t of (tasks || [])) {
      const f = t.frequency_type || 'other';
      c[f] = (c[f] || 0) + 1;
    }
    return c;
  }, [tasks]);

  const userName = user?.name || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-10 h-10 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            <Wrench size={20} className="text-white" />
          </div>
          <p className="text-gray-500 text-sm">Loading tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {userName ? `Hi, ${userName.split(' ')[0]}` : 'My Tasks'}
          </h1>
          <p className="text-sm text-gray-500">
            {overdue.length > 0 && <span className="text-red-600 font-semibold">{overdue.length} overdue &middot; </span>}
            {today.length} due today &middot; {filtered.length} total
          </p>
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${showFilters ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
          <Filter size={16} />
        </button>
      </div>

      {/* Admin department toggle */}
      {isAdmin && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {DEPT_OPTIONS.map(d => (
            <button
              key={d.id}
              onClick={() => setViewDept(d.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                viewDept === d.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tasks, equipment, location..."
          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500 focus:border-transparent"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium">
            Clear
          </button>
        )}
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-4 gap-2">
        <div className={`rounded-xl p-2.5 text-center ${overdue.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
          <p className={`text-lg font-bold ${overdue.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>{overdue.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">Overdue</p>
        </div>
        <div className={`rounded-xl p-2.5 text-center ${today.length > 0 ? 'bg-powder-50 border border-powder-200' : 'bg-gray-50 border border-gray-100'}`}>
          <p className={`text-lg font-bold ${today.length > 0 ? 'text-powder-600' : 'text-gray-400'}`}>{today.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">Today</p>
        </div>
        <div className="rounded-xl p-2.5 text-center bg-gray-50 border border-gray-100">
          <p className="text-lg font-bold text-gray-600">{thisWeek.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">This Week</p>
        </div>
        <div className="rounded-xl p-2.5 text-center bg-gray-50 border border-gray-100">
          <p className="text-lg font-bold text-gray-400">{upcoming.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">Later</p>
        </div>
      </div>

      {/* Collapsible filter row */}
      {showFilters && (
        <div className="flex gap-1.5 flex-wrap bg-white rounded-xl border border-gray-200 p-3">
          <button onClick={() => setFreqFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${freqFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            All ({(tasks || []).length})
          </button>
          {['daily', 'weekly', 'monthly', 'quarterly', 'annual'].map(f => freqCounts[f] ? (
            <button key={f} onClick={() => setFreqFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${freqFilter === f ? `${FREQ_COLORS[f]} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)} ({freqCounts[f]})
            </button>
          ) : null)}
        </div>
      )}

      {/* Task sections */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-3" />
          <p className="text-lg font-semibold text-gray-700">All caught up!</p>
          <p className="text-gray-500 text-sm">No {freqFilter !== 'all' ? freqFilter + ' ' : ''}tasks pending.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {overdue.length > 0 && (
            <SectionHeader icon={AlertTriangle} title="Overdue" count={overdue.length} color="bg-red-500" defaultOpen={true}>
              {overdue.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}

          {today.length > 0 && (
            <SectionHeader icon={CircleDot} title="Due Today" count={today.length} color="bg-powder-600" defaultOpen={true}>
              {today.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}

          {thisWeek.length > 0 && (
            <SectionHeader icon={CalendarDays} title="This Week" count={thisWeek.length} color="bg-gray-500" defaultOpen={overdue.length + today.length < 10}>
              {thisWeek.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}

          {upcoming.length > 0 && (
            <SectionHeader icon={Clock} title="Upcoming" count={upcoming.length} color="bg-gray-400" defaultOpen={overdue.length + today.length + thisWeek.length < 5}>
              {upcoming.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}
        </div>
      )}
    </div>
  );
}
