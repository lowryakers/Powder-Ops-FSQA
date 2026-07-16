import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CheckCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, Wrench, CalendarDays, ChevronRight, CircleDot, Filter, Search, Flag, Paperclip, Thermometer, Droplets, Lightbulb, FlaskConical, ClipboardCheck, SquareCheck, Square, Pencil, Plus, Trash2, MinusCircle, CircleCheck, AlertOctagon, ListChecks } from 'lucide-react';
import { localDateStr } from '../../utils/dates';
import FileUpload from '../FileUpload';
import { createTranslator, formatDueLabelI18n } from '../../i18n/operatorStrings';

function detectTaskType(task) {
  if (task.task_type === 'qa_signoff') return 'qa_signoff';
  const t = (task.title || '').toLowerCase();
  const g = task.task_group || '';
  if (t.includes('temp') && t.includes('humid')) return 'temp_humidity';
  if (t.includes('chemical dilution')) return 'chemical_dilution';
  if (t.includes('brittle') || (t.includes('glass') && t.includes('plastic'))) return 'glass_plastic';
  if (t.includes('light') && (t.includes('inspection') || t.includes('fixture'))) return 'light_inspection';
  if (t.includes('forklift') || t.includes('pallet jack') || t.includes('pallet jake')) return 'forklift_inspection';
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

function TaskCard({ task, onComplete, onFlagIssue, onSkipNA, onAssign, onUpdateItems, technicians, isAdmin, batchMode, batchSelected, onBatchToggle, t, tc = (s) => s }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [skippingNA, setSkippingNA] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [readings, setReadings] = useState({});
  const [stepChecks, setStepChecks] = useState([]);
  const [issueNotes, setIssueNotes] = useState('');
  const [issueAttachments, setIssueAttachments] = useState([]);
  const [saving, setSaving] = useState(false);

  const steps = task.procedure_steps || [];
  const taskType = detectTaskType(task);
  const issuePhotos = (() => { try { return JSON.parse(task.issue_attachments || '[]'); } catch { return []; } })();
  const today = localDateStr();
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
    if (taskType === 'forklift_inspection') {
      const ic = readings.item_conditions || {};
      if (Object.keys(ic).length === 0) return null;
      const anyBad = Object.values(ic).some(v => v === 'bad' || v === 'broken');
      return anyBad ? 'fail' : 'pass';
    }
    if (taskType === 'production_clean') {
      return readings.visual_pass === 'yes' ? 'pass' : readings.visual_pass === 'no' ? 'fail' : null;
    }
    return null;
  };

  const canSubmit = () => {
    if (taskType === 'qa_signoff') return true;
    if (taskType === 'temp_humidity') return readings.temperature && readings.humidity;
    if (taskType === 'chemical_dilution') return readings.chemical_name && readings.ppm_reading && readings.dilution_pass;
    if (taskType === 'light_inspection') return readings.foot_candles && readings.light_pass;
    if (taskType === 'glass_plastic') {
      const bpgItems = steps.filter(s => s.includes('|'));
      if (bpgItems.length > 0 && bpgItems[0] !== 'N/A|N/A|N/A') {
        const ic = readings.item_conditions || {};
        return Object.keys(ic).length === bpgItems.length;
      }
      return true;
    }
    if (taskType === 'forklift_inspection') {
      const forkItems = steps.filter(s => s.includes('|'));
      if (forkItems.length > 0) {
        const ic = readings.item_conditions || {};
        return Object.keys(ic).length === forkItems.length;
      }
      return true;
    }
    if (taskType === 'production_clean') return readings.visual_pass;
    return true;
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onComplete(task.id, {
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
      await onFlagIssue(task.id, { notes: issueNotes, attachments: issueAttachments });
      setFlagging(false);
      setIssueNotes('');
      setIssueAttachments([]);
    } finally { setSaving(false); }
  };

  const [naReason, setNaReason] = useState('');
  const handleNASubmit = async () => {
    setSaving(true);
    try {
      await onSkipNA(task.id, { reason: naReason || 'Equipment not in use' });
      setSkippingNA(false);
      setNaReason('');
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
            {batchMode && taskType === 'equipment_pm' ? (
              <button onClick={() => onBatchToggle?.(task.id)}
                className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 ${
                  batchSelected ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300 text-gray-400 hover:border-green-500 hover:text-green-500'
                }`}>
                {batchSelected ? <CircleCheck size={22} /> : <Square size={20} />}
              </button>
            ) : !completing && !flagging && !skippingNA ? (
              <>
                <button onClick={() => { setCompleting(true); setFlagging(false); setSkippingNA(false); }}
                  className="w-11 h-11 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-green-500 hover:text-green-500 hover:bg-green-50 transition-all active:scale-90"
                  title={t('complete_task')}>
                  <CircleCheck size={22} />
                </button>
                <button onClick={() => { setFlagging(true); setCompleting(false); setSkippingNA(false); }}
                  className="w-11 h-11 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-red-500 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90"
                  title={t('report_issue')}>
                  <AlertOctagon size={18} />
                </button>
                <button onClick={() => { setSkippingNA(true); setCompleting(false); setFlagging(false); }}
                  className="w-11 h-11 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-amber-500 hover:text-amber-500 hover:bg-amber-50 transition-all active:scale-90"
                  title={t('skip_na')}>
                  <MinusCircle size={18} />
                </button>
              </>
            ) : completing ? (
              <div className="w-11 h-11 rounded-full bg-green-500 flex items-center justify-center">
                <CircleCheck size={22} className="text-white" />
              </div>
            ) : skippingNA ? (
              <div className="w-11 h-11 rounded-full bg-amber-500 flex items-center justify-center">
                <MinusCircle size={18} className="text-white" />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center">
                <AlertOctagon size={18} className="text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <h3 className="text-base font-semibold text-gray-900 leading-snug">{tc(task.title)}</h3>

            {/* Equipment + location */}
            <p className="text-sm text-gray-500 mt-0.5">
              {tc(task.equipment_name)}
              {task.location && <span className="text-gray-400"> &middot; {task.location}</span>}
            </p>

            {/* Meta row: badges + due */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {task.issue_flagged === 1 && (
                <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wide bg-red-500">
                  <Flag size={9} /> {t('issue_badge')}
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
                {formatDueLabelI18n(task.due_date, t)}
              </span>

              {task.assigned_to && (
                <span className="text-xs text-gray-400">&middot; {task.assigned_to}</span>
              )}
            </div>
          </div>

          {/* Expand chevron if steps exist */}
          {steps.length > 0 && !completing && !flagging && !skippingNA && (
            <button onClick={() => setExpanded(!expanded)}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 mt-0.5">
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          )}
        </div>

        {/* Existing issue display */}
        {task.issue_flagged === 1 && !flagging && (
          <div className="mt-3 ml-14 bg-red-50 rounded-xl p-3 border border-red-200">
            <p className="text-xs font-semibold text-red-800 flex items-center gap-1 mb-1"><Flag size={11} /> {t('issue_reported')}</p>
            <p className="text-sm text-red-900">{task.issue_notes}</p>
            <p className="text-xs text-red-600 mt-1">
              {t('flagged_by')} {task.issue_flagged_by} &middot; {task.issue_flagged_at ? new Date(task.issue_flagged_at).toLocaleString() : ''}
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
                  <span className="text-gray-600 leading-snug">{tc(s)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Inline issue flagging */}
        {flagging && (
          <div className="mt-3 ml-14 bg-red-50 rounded-xl p-3 space-y-2 border border-red-200">
            <h4 className="text-xs font-bold text-red-800 uppercase tracking-wide flex items-center gap-1"><Flag size={11} /> {t('report_an_issue')}</h4>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('whats_the_issue')}</label>
              <textarea required value={issueNotes} onChange={e => setIssueNotes(e.target.value)} autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={3}
                placeholder={t('issue_placeholder')} />
            </div>
            <FileUpload files={issueAttachments} onChange={setIssueAttachments} />
            <div className="flex gap-2">
              <button onClick={handleFlagSubmit} disabled={saving || !issueNotes.trim()}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                {saving ? t('saving') : t('flag_issue')}
              </button>
              <button onClick={() => { setFlagging(false); setIssueNotes(''); setIssueAttachments([]); }}
                className="px-4 py-2.5 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                {t('cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Inline N/A skip */}
        {skippingNA && (
          <div className="mt-3 ml-14 bg-amber-50 rounded-xl p-3 space-y-2 border border-amber-200">
            <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center gap-1"><MinusCircle size={11} /> {t('na_title')}</h4>
            <p className="text-xs text-amber-700">{t('na_description')}</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('na_reason_label')}</label>
              <select value={naReason} onChange={e => setNaReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">{t('na_reason_not_in_use')}</option>
                <option value="Production schedule change">{t('na_reason_production')}</option>
                <option value="Equipment decommissioned">{t('na_reason_decommissioned')}</option>
                <option value="Seasonal shutdown">{t('na_reason_seasonal')}</option>
                <option value="Duplicate task">{t('na_reason_duplicate')}</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleNASubmit} disabled={saving}
                className="flex-1 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                {saving ? t('saving') : t('skip_na_button')}
              </button>
              <button onClick={() => { setSkippingNA(false); setNaReason(''); }}
                className="px-4 py-2.5 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                {t('cancel')}
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
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><Thermometer size={12} /> {t('record_readings')}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('temperature')}</label>
                    <input type="number" step="0.1" value={readings.temperature || ''} onChange={e => updateReading('temperature', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 68.5" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('humidity')}</label>
                    <input type="number" step="0.1" value={readings.humidity || ''} onChange={e => updateReading('humidity', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 35.2" />
                  </div>
                </div>
                {readings.humidity && parseFloat(readings.humidity) > 40 && (
                  <div className="bg-red-100 border border-red-300 rounded-lg p-2 text-xs text-red-800 font-medium">
                    {t('humidity_warning')}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => updateReading('rolling_doors_closed', !readings.rolling_doors_closed)}
                    className="text-gray-500 hover:text-green-600">
                    {readings.rolling_doors_closed ? <SquareCheck size={18} className="text-green-600" /> : <Square size={18} />}
                  </button>
                  <span className="text-sm text-gray-700">{t('rolling_doors')}</span>
                </div>
                {readings.temperature && readings.humidity && (
                  <div className={`rounded-lg p-2 text-xs font-bold text-center ${parseFloat(readings.humidity) <= 40 ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'}`}>
                    {parseFloat(readings.humidity) <= 40 ? t('pass_range') : t('fail_humidity')}
                  </div>
                )}
              </>
            )}

            {taskType === 'chemical_dilution' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><FlaskConical size={12} /> {t('chemical_verification')}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('chemical_label')}</label>
                    <select value={readings.chemical_name || ''} onChange={e => updateReading('chemical_name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus>
                      <option value="">{t('select_chemical')}</option>
                      <option value="Sani-512">Sani-512 (200-250 ppm)</option>
                      <option value="Chlorine">Chlorine (100-200 ppm)</option>
                      <option value="Dawn">Dawn Dish Soap</option>
                      <option value="Simple Green">Simple Green</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('ppm_reading')}</label>
                    <input type="number" value={readings.ppm_reading || ''} onChange={e => updateReading('ppm_reading', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 225" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('lot_number')}</label>
                    <input type="text" value={readings.lot_number || ''} onChange={e => updateReading('lot_number', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Lot #" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('expiration_date')}</label>
                    <input type="date" value={readings.expiration_date || ''} onChange={e => updateReading('expiration_date', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('acceptable_range')}</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('dilution_pass', 'yes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.dilution_pass === 'yes' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {t('pass')}
                    </button>
                    <button onClick={() => updateReading('dilution_pass', 'no')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.dilution_pass === 'no' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {t('fail')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {taskType === 'glass_plastic' && (() => {
              const bpgItems = steps.filter(s => s.includes('|')).map(s => {
                const [name, qty, material] = s.split('|');
                return { name: name.trim(), qty: qty.trim(), material: (material || '').trim() };
              });
              const hasParsedItems = bpgItems.length > 0 && bpgItems[0].name !== 'N/A';
              const itemConditions = readings.item_conditions || {};
              const setItemCondition = (idx, val) => {
                const next = { ...itemConditions, [idx]: val };
                updateReading('item_conditions', next);
                const allGood = Object.keys(next).length === bpgItems.length && Object.values(next).every(v => v === 'good');
                const anyBad = Object.values(next).some(v => v === 'bad' || v === 'broken');
                updateReading('condition', anyBad ? 'fail' : allGood ? 'good' : 'good');
              };
              const checkedCount = Object.keys(itemConditions).length;

              const startEditing = () => { setEditItems(bpgItems.map(i => ({ ...i }))); setEditingItems(true); };
              const saveItems = async () => {
                const newSteps = editItems.filter(i => i.name.trim()).map(i => `${i.name}|${i.qty}|${i.material}`);
                await onUpdateItems(task.pm_schedule_id, newSteps);
                setEditingItems(false);
              };

              return hasParsedItems ? (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> {t('item_inspection')}</h4>
                    {isAdmin && !editingItems && (
                      <button onClick={startEditing} className="text-[10px] text-gray-400 hover:text-powder-600 flex items-center gap-0.5">
                        <Pencil size={10} /> {t('edit_items')}
                      </button>
                    )}
                  </div>
                  {editingItems ? (
                    <div className="border border-powder-200 rounded-lg p-2 bg-powder-50/30 space-y-1.5">
                      {editItems.map((item, i) => (
                        <div key={i} className="grid grid-cols-[1fr_50px_70px_24px] gap-1 items-center">
                          <input value={item.name} onChange={e => { const n = [...editItems]; n[i] = { ...n[i], name: e.target.value }; setEditItems(n); }}
                            className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Item name" />
                          <input value={item.qty} onChange={e => { const n = [...editItems]; n[i] = { ...n[i], qty: e.target.value }; setEditItems(n); }}
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-center" placeholder="Qty" />
                          <select value={item.material} onChange={e => { const n = [...editItems]; n[i] = { ...n[i], material: e.target.value }; setEditItems(n); }}
                            className="px-1 py-1 border border-gray-300 rounded text-xs">
                            <option value="Plastic">Plastic</option><option value="Glass">Glass</option>
                          </select>
                          <button onClick={() => setEditItems(editItems.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => setEditItems([...editItems, { name: '', qty: '1', material: 'Plastic' }])}
                        className="w-full py-1.5 text-xs text-powder-600 hover:bg-powder-50 rounded border border-dashed border-powder-300 flex items-center justify-center gap-1">
                        <Plus size={12} /> {t('add_item')}
                      </button>
                      <div className="flex gap-2 pt-1">
                        <button onClick={saveItems} className="flex-1 py-1.5 bg-powder-600 text-white rounded text-xs font-bold hover:bg-powder-700">{t('save_changes')}</button>
                        <button onClick={() => setEditingItems(false)} className="px-3 py-1.5 bg-white text-gray-600 rounded text-xs border border-gray-200">{t('cancel')}</button>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[1fr_40px_52px_auto] gap-0 bg-gray-100 px-2 py-1.5 text-[10px] font-bold text-gray-500 uppercase">
                      <span>{t('item')}</span><span>{t('qty')}</span><span>{t('type')}</span><span className="text-center">{t('condition')}</span>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                      {bpgItems.map((item, i) => (
                        <div key={i} className={`grid grid-cols-[1fr_40px_52px_auto] gap-0 px-2 py-1.5 items-center ${itemConditions[i] === 'bad' || itemConditions[i] === 'broken' ? 'bg-red-50' : itemConditions[i] === 'good' ? 'bg-green-50/30' : ''}`}>
                          <span className="text-sm text-gray-800 truncate">{item.name}</span>
                          <span className="text-xs text-gray-500">{item.qty}</span>
                          <span className={`text-[10px] font-medium ${item.material === 'Glass' ? 'text-blue-600' : 'text-gray-500'}`}>{item.material}</span>
                          <div className="flex gap-0.5">
                            <button onClick={() => setItemCondition(i, 'good')}
                              className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${itemConditions[i] === 'good' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-green-100'}`}>G</button>
                            <button onClick={() => setItemCondition(i, 'bad')}
                              className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${itemConditions[i] === 'bad' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-amber-100'}`}>B</button>
                            <button onClick={() => setItemCondition(i, 'broken')}
                              className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${itemConditions[i] === 'broken' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-red-100'}`}>X</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 text-center">{checkedCount} / {bpgItems.length} {t('items_inspected')} — {t('gbx_legend')}</p>
                  {Object.values(itemConditions).some(v => v === 'bad' || v === 'broken') && (
                    <div className="bg-red-50 border border-red-300 rounded-lg p-2 text-xs text-red-800 font-medium">
                      {t('damaged_warning')}
                    </div>
                  )}
                  </>
                  )}
                </>
              ) : (
                <>
                  <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> {t('brittle_inspection')}</h4>
                  <p className="text-xs text-gray-500">{t('no_items_zone')}</p>
                </>
              );
            })()}

            {taskType === 'forklift_inspection' && (() => {
              const forkItems = steps.filter(s => s.includes('|')).map(s => {
                const parts = s.split('|');
                return { name: parts[0].trim(), type: (parts[1] || 'check').trim(), section: (parts[2] || '').trim() };
              });
              const hasParsedItems = forkItems.length > 0;
              const itemConditions = readings.item_conditions || {};
              const setItemCondition = (idx, val) => {
                const next = { ...itemConditions, [idx]: val };
                updateReading('item_conditions', next);
              };
              const checkedCount = Object.keys(itemConditions).length;
              let currentSection = '';

              return hasParsedItems ? (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-indigo-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> {t('daily_inspection')}</h4>
                  </div>
                  {readings.hour_meter !== undefined && (
                    <div className="bg-indigo-50 rounded-lg px-3 py-2 text-sm">
                      <span className="text-xs text-gray-500">{t('hour_meter')}: </span>
                      <span className="font-semibold text-indigo-800">{readings.hour_meter}</span>
                    </div>
                  )}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto] gap-0 bg-gray-100 px-2 py-1.5 text-[10px] font-bold text-gray-500 uppercase">
                      <span>{t('inspection_item')}</span><span className="text-center">{t('condition')}</span>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {forkItems.map((item, i) => {
                        const showSection = item.section && item.section !== currentSection;
                        if (showSection) currentSection = item.section;
                        return (
                          <div key={i}>
                            {showSection && (
                              <div className="bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 uppercase tracking-wide">{item.section}</div>
                            )}
                            <div className={`grid grid-cols-[1fr_auto] gap-0 px-2 py-1.5 items-center ${itemConditions[i] === 'bad' ? 'bg-amber-50' : itemConditions[i] === 'broken' ? 'bg-red-50' : itemConditions[i] === 'good' ? 'bg-green-50/30' : ''}`}>
                              <span className="text-sm text-gray-800">{item.name}</span>
                              <div className="flex gap-0.5">
                                {item.type === 'input' ? (
                                  <input type="text" placeholder={item.name.includes('Hour') ? 'Hours' : item.name.includes('Water') ? 'Full / Need' : 'Value'}
                                    value={readings['input_' + i] || ''}
                                    onChange={e => { updateReading('input_' + i, e.target.value); setItemCondition(i, e.target.value ? 'good' : undefined); }}
                                    className="w-24 px-2 py-1 border border-gray-300 rounded text-xs"
                                  />
                                ) : (
                                  <>
                                    <button onClick={() => setItemCondition(i, 'good')}
                                      className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${itemConditions[i] === 'good' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-green-100'}`}>G</button>
                                    <button onClick={() => setItemCondition(i, 'bad')}
                                      className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${itemConditions[i] === 'bad' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-amber-100'}`}>B</button>
                                    <button onClick={() => setItemCondition(i, 'broken')}
                                      className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${itemConditions[i] === 'broken' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-red-100'}`}>X</button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 text-center">{checkedCount} / {forkItems.length} {t('items_inspected')} — {t('gbx_fork_legend')}</p>
                  {Object.values(itemConditions).some(v => v === 'bad' || v === 'broken') && (
                    <div className="bg-red-50 border border-red-300 rounded-lg p-2 text-xs text-red-800 font-medium">
                      {t('fork_warning')}
                    </div>
                  )}
                </>
              ) : null;
            })()}

            {taskType === 'light_inspection' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><Lightbulb size={12} /> {t('light_inspection')}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('foot_candles')}</label>
                    <input type="number" value={readings.foot_candles || ''} onChange={e => updateReading('foot_candles', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 220" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('fixtures_checked')}</label>
                    <input type="number" value={readings.fixtures_checked || ''} onChange={e => updateReading('fixtures_checked', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Count" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">{t('light_spec')}</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('all_fixtures_pass')}</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('light_pass', 'yes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.light_pass === 'yes' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {t('pass')}
                    </button>
                    <button onClick={() => updateReading('light_pass', 'no')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.light_pass === 'no' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {t('fail')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {taskType === 'production_clean' && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><Droplets size={12} /> {t('production_verification')}</h4>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateReading('allergen_check', !readings.allergen_check)} className="text-gray-500 hover:text-green-600">
                    {readings.allergen_check ? <SquareCheck size={18} className="text-green-600" /> : <Square size={18} />}
                  </button>
                  <span className="text-sm text-gray-700">{t('allergen_check')}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('atp_reading')}</label>
                    <input type="number" value={readings.atp_reading || ''} onChange={e => updateReading('atp_reading', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 10" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('sanitizer_contact')}</label>
                    <input type="number" value={readings.contact_time || ''} onChange={e => updateReading('contact_time', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Minutes" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('visual_pass')}</label>
                  <div className="flex gap-2">
                    <button onClick={() => updateReading('visual_pass', 'yes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.visual_pass === 'yes' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {t('pass')}
                    </button>
                    <button onClick={() => updateReading('visual_pass', 'no')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all ${readings.visual_pass === 'no' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {t('fail')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {taskType === 'qa_signoff' && (
              <>
                <h4 className="text-xs font-bold text-teal-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> QA Production Sign-off</h4>
                {task._qa_meta && (
                  <div className="bg-teal-50 rounded-lg p-3 space-y-1 text-sm border border-teal-200">
                    <div className="flex justify-between"><span className="text-gray-500">Product:</span><span className="font-medium text-gray-900">{task._qa_meta.product_name}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">MO #:</span><span className="font-medium text-gray-900">{task._qa_meta.mo_number}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Lot #:</span><span className="font-medium text-gray-900">{task._qa_meta.lot_number}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Team:</span><span className="font-medium text-gray-900">{task._qa_meta.team}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Date:</span><span className="font-medium text-gray-900">{task._qa_meta.date}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Submitted by:</span><span className="font-medium text-gray-900">{task._qa_meta.submitted_by}</span></div>
                  </div>
                )}
              </>
            )}

            {/* Step-by-step checkoff for cleaning and equipment PM */}
            {(taskType === 'cleaning' || taskType === 'equipment_pm') && steps.length > 0 && (
              <>
                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1"><ClipboardCheck size={12} /> {t('checklist')}</h4>
                <div className="space-y-1">
                  {steps.map((step, i) => (
                    <button key={i} onClick={() => toggleStep(i)}
                      className="w-full flex items-start gap-2 text-left py-1.5 px-1 rounded-lg hover:bg-green-100/50 transition-colors">
                      {stepChecks[i] ? <SquareCheck size={18} className="text-green-600 shrink-0 mt-0.5" /> : <Square size={18} className="text-gray-400 shrink-0 mt-0.5" />}
                      <span className={`text-sm leading-snug ${stepChecks[i] ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{tc(step)}</span>
                    </button>
                  ))}
                </div>
                {steps.length > 0 && (
                  <p className="text-[10px] text-gray-500 text-center">{stepChecks.filter(Boolean).length} / {steps.length} {t('steps_complete')}</p>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('notes')} {(taskType === 'cleaning' || taskType === 'equipment_pm') ? t('notes_optional') : ''}</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2}
                placeholder={taskType === 'temp_humidity' ? t('notes_temp') :
                  taskType === 'glass_plastic' ? t('notes_glass') :
                  taskType === 'chemical_dilution' ? t('notes_chem') :
                  t('notes_general')} />
            </div>
            {technicians && technicians.length > 0 && !task.assigned_to && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('assign_to')}</label>
                <select onChange={e => { if (e.target.value) onAssign(task.id, e.target.value); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" defaultValue="">
                  <option value="">{t('leave_unassigned')}</option>
                  {technicians.map(tc => <option key={tc.id} value={tc.name}>{tc.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleSubmit} disabled={saving || !canSubmit()}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                {saving ? t('saving') : t('mark_complete')}
              </button>
              <button onClick={() => { setCompleting(false); setNotes(''); setReadings({}); setStepChecks([]); }}
                className="px-4 py-2.5 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                {t('cancel')}
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

const DEPT_KEYS = [
  { id: 'all', key: 'all_teams' },
  { id: 'maintenance', key: 'maintenance' },
  { id: 'warehouse', key: 'warehouse' },
  { id: 'qa', key: 'qa' },
  { id: 'cleaning', key: 'cleaning' },
];

export default function OperatorView() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor';
  const userDept = user?.department || 'warehouse';
  // Language is owned here so the EN/ES toggle is available in every context the
  // Operator View appears (standalone layout and the in-app tab). Shares the
  // 'op_lang' preference with the rest of the app.
  const [lang, setLang] = useState(() => localStorage.getItem('op_lang') || 'en');
  const changeLang = (l) => { setLang(l); localStorage.setItem('op_lang', l); };
  const t = useMemo(() => createTranslator(lang), [lang]);
  const [viewDept, setViewDept] = useState(isAdmin ? 'all' : userDept);
  const groupParam = viewDept === 'all' ? '' : `?group=${viewDept}`;
  const { data: tasks, loading, refresh } = useApiGet(`/pm/operator-tasks${groupParam}`);
  const { data: technicians } = useApiGet('/users/technicians');

  // AI content translation: the static UI labels come from operatorStrings, but
  // task titles / equipment names / procedure steps are DB data in English. When
  // ES is selected we translate that content on the server (cached) so Spanish-
  // speaking operators read the *whole* task, not just the chrome. Degrades to
  // English if AI is off or the request fails. requestedRef prevents re-fetching
  // strings we've already asked for as the task list refreshes.
  const [contentMap, setContentMap] = useState({});
  const requestedRef = useRef(new Set());
  useEffect(() => {
    if (lang !== 'es' || !Array.isArray(tasks)) return;
    const seen = new Set();
    const missing = [];
    for (const tk of tasks) {
      const candidates = [tk.title, tk.equipment_name, ...(Array.isArray(tk.procedure_steps) ? tk.procedure_steps : [])];
      for (const s of candidates) {
        if (typeof s === 'string' && s.trim() && !seen.has(s) && !requestedRef.current.has(s)) {
          seen.add(s);
          missing.push(s);
        }
      }
    }
    if (missing.length === 0) return;
    missing.forEach(s => requestedRef.current.add(s));
    let cancelled = false;
    apiPost('/ai/translate-content', { texts: missing, lang: 'es' })
      .then(res => {
        if (cancelled || !Array.isArray(res?.translations)) return;
        setContentMap(prev => {
          const next = { ...prev };
          missing.forEach((s, i) => { next[s] = res.translations[i] ?? s; });
          return next;
        });
      })
      .catch(() => { missing.forEach(s => requestedRef.current.delete(s)); });
    return () => { cancelled = true; };
  }, [lang, tasks]);
  // Translate task content for display (identity in EN or when not yet translated).
  const tc = useCallback((s) => (lang === 'es' && s && contentMap[s]) || s, [lang, contentMap]);
  const [freqFilter, setFreqFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState(new Set());
  const [batchSaving, setBatchSaving] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const toggleBatchItem = useCallback((id) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBatchComplete = async () => {
    if (batchSelected.size === 0) return;
    setBatchSaving(true);
    try {
      await apiPost('/pm/work-orders/batch-complete', {
        ids: [...batchSelected],
      });
      showToast(`${batchSelected.size} ${t('toast_batch')}`);
      setBatchSelected(new Set());
      setBatchMode(false);
      refresh();
    } catch {
      showToast(t('toast_batch_fail'), 'error');
    } finally {
      setBatchSaving(false);
    }
  };

  const handleComplete = async (woId, form) => {
    if (String(woId).startsWith('qa_')) {
      const entryId = String(woId).replace('qa_', '');
      await apiPut(`/production/entries/${entryId}/qa-signoff`, {
        qa_signoff_by: userName || 'QA',
        qa_notes: form.notes || null,
      });
      showToast('QA sign-off recorded');
      refresh();
      return;
    }
    await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
    showToast(t('toast_completed'));
    refresh();
  };

  const handleFlagIssue = async (woId, form) => {
    if (String(woId).startsWith('qa_')) return;
    await apiPost(`/pm/work-orders/${woId}/flag-issue`, form);
    showToast(t('toast_issue'), 'info');
    refresh();
  };

  const handleSkipNA = async (woId, form) => {
    if (String(woId).startsWith('qa_')) return;
    await apiPost(`/pm/work-orders/${woId}/not-applicable`, form);
    showToast(t('toast_na'), 'info');
    refresh();
  };

  const handleAssign = async (woId, assignedTo) => {
    await apiPut(`/pm/work-orders/${woId}`, { assigned_to: assignedTo });
    refresh();
  };

  const handleUpdateItems = async (schedId, items) => {
    await apiPut(`/pm/schedules/${schedId}/items`, { items });
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
    const todayStr = localDateStr(now);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = localDateStr(weekEnd);

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
          <p className="text-gray-500 text-sm">{t('loading_tasks')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Completion toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-semibold animate-fade-in ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-gray-800 text-white'
        }`}>
          <CircleCheck size={18} />
          {toast.message}
        </div>
      )}

      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {userName ? `${lang === 'es' ? 'Hola' : 'Hi'}, ${userName.split(' ')[0]}` : t('my_tasks')}
          </h1>
          <p className="text-sm text-gray-500">
            {overdue.length > 0 && <span className="text-red-600 font-semibold">{overdue.length} {t('overdue_count')} &middot; </span>}
            {today.length} {t('due_today_count')} &middot; {filtered.length} {t('total')}
          </p>
        </div>
        <div className="flex gap-1.5 items-center">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden mr-1">
            <button onClick={() => changeLang('en')} className={`px-2 py-1.5 text-[10px] font-bold transition-colors ${lang === 'en' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>EN</button>
            <button onClick={() => changeLang('es')} className={`px-2 py-1.5 text-[10px] font-bold transition-colors ${lang === 'es' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>ES</button>
          </div>
          <button onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}
            className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${batchMode ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
            title={t('batch_complete')}>
            <ListChecks size={16} />
          </button>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${showFilters ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            <Filter size={16} />
          </button>
        </div>
      </div>

      {/* Admin department toggle */}
      {isAdmin && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {DEPT_KEYS.map(d => (
            <button
              key={d.id}
              onClick={() => setViewDept(d.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                viewDept === d.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t(d.key)}
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
          placeholder={t('search_placeholder')}
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
          <p className="text-[10px] font-medium text-gray-500 uppercase">{t('overdue_label')}</p>
        </div>
        <div className={`rounded-xl p-2.5 text-center ${today.length > 0 ? 'bg-powder-50 border border-powder-200' : 'bg-gray-50 border border-gray-100'}`}>
          <p className={`text-lg font-bold ${today.length > 0 ? 'text-powder-600' : 'text-gray-400'}`}>{today.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">{t('today_label')}</p>
        </div>
        <div className="rounded-xl p-2.5 text-center bg-gray-50 border border-gray-100">
          <p className="text-lg font-bold text-gray-600">{thisWeek.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">{t('this_week')}</p>
        </div>
        <div className="rounded-xl p-2.5 text-center bg-gray-50 border border-gray-100">
          <p className="text-lg font-bold text-gray-400">{upcoming.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">{t('later')}</p>
        </div>
      </div>

      {/* Collapsible filter row */}
      {showFilters && (
        <div className="flex gap-1.5 flex-wrap bg-white rounded-xl border border-gray-200 p-3">
          <button onClick={() => setFreqFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${freqFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t('all_filter')} ({(tasks || []).length})
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
          <p className="text-lg font-semibold text-gray-700">{t('all_caught_up')}</p>
          <p className="text-gray-500 text-sm">{t('no_prefix')} {freqFilter !== 'all' ? t(freqFilter) + ' ' : ''}{t('no_tasks_pending')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {overdue.length > 0 && (
            <SectionHeader icon={AlertTriangle} title={t('section_overdue')} count={overdue.length} color="bg-red-500" defaultOpen={true}>
              {overdue.map(tk => (
                <TaskCard key={tk.id} task={tk} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onSkipNA={handleSkipNA} onAssign={handleAssign} onUpdateItems={handleUpdateItems} technicians={technicians || []} userName={userName} isAdmin={isAdmin} batchMode={batchMode} batchSelected={batchSelected.has(tk.id)} onBatchToggle={toggleBatchItem} t={t} tc={tc} />
              ))}
            </SectionHeader>
          )}

          {today.length > 0 && (
            <SectionHeader icon={CircleDot} title={t('section_due_today')} count={today.length} color="bg-powder-600" defaultOpen={true}>
              {today.map(tk => (
                <TaskCard key={tk.id} task={tk} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onSkipNA={handleSkipNA} onAssign={handleAssign} onUpdateItems={handleUpdateItems} technicians={technicians || []} userName={userName} isAdmin={isAdmin} batchMode={batchMode} batchSelected={batchSelected.has(tk.id)} onBatchToggle={toggleBatchItem} t={t} tc={tc} />
              ))}
            </SectionHeader>
          )}

          {thisWeek.length > 0 && (
            <SectionHeader icon={CalendarDays} title={t('section_this_week')} count={thisWeek.length} color="bg-gray-500" defaultOpen={overdue.length + today.length < 10}>
              {thisWeek.map(tk => (
                <TaskCard key={tk.id} task={tk} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onSkipNA={handleSkipNA} onAssign={handleAssign} onUpdateItems={handleUpdateItems} technicians={technicians || []} userName={userName} isAdmin={isAdmin} batchMode={batchMode} batchSelected={batchSelected.has(tk.id)} onBatchToggle={toggleBatchItem} t={t} tc={tc} />
              ))}
            </SectionHeader>
          )}

          {upcoming.length > 0 && (
            <SectionHeader icon={Clock} title={t('section_upcoming')} count={upcoming.length} color="bg-gray-400" defaultOpen={overdue.length + today.length + thisWeek.length < 5}>
              {upcoming.map(tk => (
                <TaskCard key={tk.id} task={tk} onComplete={handleComplete} onFlagIssue={handleFlagIssue} onSkipNA={handleSkipNA} onAssign={handleAssign} onUpdateItems={handleUpdateItems} technicians={technicians || []} userName={userName} isAdmin={isAdmin} batchMode={batchMode} batchSelected={batchSelected.has(tk.id)} onBatchToggle={toggleBatchItem} t={t} tc={tc} />
              ))}
            </SectionHeader>
          )}
        </div>
      )}

      {/* Batch complete floating bar */}
      {batchMode && batchSelected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-40">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <p className="text-sm font-semibold text-gray-700 flex-1">{batchSelected.size} {batchSelected.size > 1 ? t('tasks_word') : t('task_word')} {t('tasks_selected')}</p>
            <button onClick={() => { setBatchSelected(new Set()); }}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
              {t('clear')}
            </button>
            <button onClick={handleBatchComplete} disabled={batchSaving}
              className="px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <CircleCheck size={16} />
              {batchSaving ? t('completing_batch') : t('complete_all')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
