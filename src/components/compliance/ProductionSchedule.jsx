import { useState, useMemo, useCallback, Fragment } from 'react';
import { useApiGet, apiPost, apiFetch } from '../../hooks/useApi';
import { ChevronLeft, ChevronRight, Calendar, Share2, Plus, X, ChevronDown, Check, Copy } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TEAMS = ['Batching', 'Stick Pack', 'Hand Fill', 'Kitting', 'Quality', 'Warehouse', 'Sanitation', 'Other'];
const CLEANING_LEVELS = ['N/A', 'Partial', 'Full Clean'];

const ROOM_SECTIONS = [
  {
    label: 'Production Rooms',
    type: 'production',
    headerClass: 'bg-green-50 border-green-200 text-green-800',
    cellTint: 'bg-green-50/40',
    rooms: ['1', '1.2', '2', '3', '4', '4.1', '4.2', '5', '6', '7', '8-1', '8-2'],
  },
  {
    label: 'Kitting',
    type: 'kitting',
    headerClass: 'bg-blue-50 border-blue-200 text-blue-800',
    cellTint: 'bg-blue-50/40',
    rooms: ['15'],
  },
  {
    label: 'Batching Rooms',
    type: 'batching',
    headerClass: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    cellTint: 'bg-yellow-50/40',
    rooms: ['Batching 1', 'Batching 2', 'Batching 3'],
  },
];

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatWeekStart(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayDate(monday, dayIndex) {
  const d = new Date(monday);
  d.setDate(d.getDate() + dayIndex);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function CleaningCell({ value, weekStart, dayIndex, room, userName, onSaved, readOnly }) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (e) => {
    const level = e.target.value;
    setSaving(true);
    try {
      await apiPost('/production/schedule/cleaning', {
        week_start: weekStart,
        day_of_week: dayIndex,
        room,
        level,
        updated_by: userName,
      });
      onSaved();
    } catch (err) {
      console.error('Failed to save cleaning level:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={value || 'N/A'}
      onChange={handleChange}
      disabled={saving || readOnly}
      className="w-full text-xs px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-60"
    >
      {CLEANING_LEVELS.map(l => (
        <option key={l} value={l}>{l}</option>
      ))}
    </select>
  );
}

function CellModal({ cell, weekStart, dayIndex, room, roomType, slot, userName, onClose, onSaved }) {
  const [form, setForm] = useState({
    team: cell?.team || '',
    mo_number: cell?.mo_number || '',
    product_name: cell?.product_name || '',
    start_time: cell?.start_time || '',
    notes: cell?.notes || '',
  });
  const [repeatDays, setRepeatDays] = useState([]);
  const [saving, setSaving] = useState(false);

  const otherDays = DAYS.map((_, i) => i).filter(i => i !== dayIndex);

  const toggleRepeatDay = (d) => {
    setRepeatDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        week_start: weekStart,
        room,
        room_type: roomType,
        slot: slot || 0,
        team: form.team,
        mo_number: form.mo_number,
        product_name: form.product_name,
        start_time: form.start_time,
        notes: form.notes,
        updated_by: userName,
      };
      await apiPost('/production/schedule', { ...payload, day_of_week: dayIndex });
      for (const d of repeatDays) {
        await apiPost('/production/schedule', { ...payload, day_of_week: d });
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!cell?.id) return;
    setSaving(true);
    try {
      await apiFetch(`/production/schedule/${cell.id}`, { method: 'DELETE' });
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to clear:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Room {room} — {DAYS[dayIndex]}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Team</label>
            <select
              value={form.team}
              onChange={e => setForm({ ...form, team: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Select team...</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">MO #</label>
              <input
                value={form.mo_number}
                onChange={e => setForm({ ...form, mo_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="e.g. MO76721"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={e => setForm({ ...form, start_time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Product Name</label>
            <input
              value={form.product_name}
              onChange={e => setForm({ ...form, product_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="e.g. Daily Fuel Vanilla"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              rows={2}
              placeholder="Optional notes..."
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">Repeat on other days</label>
              <button
                type="button"
                onClick={() => setRepeatDays([0, 1, 2, 3].filter(d => d !== dayIndex))}
                className="text-[11px] font-medium text-blue-600 hover:underline"
              >
                Mon–Thu
              </button>
            </div>
            <div className="flex gap-1.5">
              {otherDays.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleRepeatDay(d)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    repeatDays.includes(d)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {DAY_SHORT[d]}
                </button>
              ))}
            </div>
            {repeatDays.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1">
                Saving will also apply this to {repeatDays.slice().sort().map(d => DAY_SHORT[d]).join(', ')}.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {cell?.id && (
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                className="px-4 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DuplicateDayModal({ weekStart, sourceDay, userName, onClose, onSaved }) {
  const [targetDays, setTargetDays] = useState([]);
  const [includeAssignments, setIncludeAssignments] = useState(true);
  const [includeCleaning, setIncludeCleaning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const otherDays = DAYS.map((_, i) => i).filter(i => i !== sourceDay);

  const toggleDay = (d) => {
    setTargetDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const handleDuplicate = async () => {
    if (targetDays.length === 0 || (!includeAssignments && !includeCleaning)) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost('/production/schedule/duplicate-day', {
        week_start: weekStart,
        source_day: sourceDay,
        target_days: targetDays,
        include_assignments: includeAssignments,
        include_cleaning: includeCleaning,
        updated_by: userName,
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to duplicate day:', err);
      setError('Failed to duplicate. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Duplicate {DAYS[sourceDay]}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-700">Copy to</label>
            <button
              type="button"
              onClick={() => setTargetDays([0, 1, 2, 3].filter(d => d !== sourceDay))}
              className="text-[11px] font-medium text-blue-600 hover:underline"
            >
              Mon–Thu
            </button>
          </div>
          <div className="flex gap-1.5">
            {otherDays.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  targetDays.includes(d)
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeAssignments}
              onChange={e => setIncludeAssignments(e.target.checked)}
              className="rounded border-gray-300"
            />
            Room assignments
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeCleaning}
              onChange={e => setIncludeCleaning(e.target.checked)}
              className="rounded border-gray-300"
            />
            Cleaning levels
          </label>
        </div>

        {targetDays.length > 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            This will replace anything already scheduled on {targetDays.slice().sort().map(d => DAYS[d]).join(', ')}.
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleDuplicate}
            disabled={saving || targetDays.length === 0 || (!includeAssignments && !includeCleaning)}
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Duplicating...' : 'Duplicate'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProductionSchedule({ user }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [editCell, setEditCell] = useState(null); // { dayIndex, room, roomType, slot, data }
  const [duplicateDay, setDuplicateDay] = useState(null); // day index to duplicate from
  const [collapsedSections, setCollapsedSections] = useState({});
  const [copied, setCopied] = useState(false);

  const monday = useMemo(() => {
    const m = getMonday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);

  const weekStart = formatWeekStart(monday);

  const { data, loading, error, refresh } = useApiGet(`/production/schedule?week_start=${weekStart}`, [weekStart]);

  // Each cell can hold multiple entries (slots), e.g. several Kitting products on one day
  const assignmentMap = useMemo(() => {
    if (!data?.assignments) return {};
    const map = {};
    for (const a of data.assignments) {
      const key = `${a.day_of_week}-${a.room}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((x, y) => (x.slot || 0) - (y.slot || 0));
    }
    return map;
  }, [data]);

  const cleaningMap = useMemo(() => {
    if (!data?.cleaning_levels) return {};
    const map = {};
    for (const c of data.cleaning_levels) {
      map[`${c.day_of_week}-${c.room}`] = c.level;
    }
    return map;
  }, [data]);

  const toggleSection = (label) => {
    setCollapsedSections(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const handleShare = useCallback(() => {
    const lines = [`Production Schedule — Week of ${formatDate(monday)}`, ''];

    for (let d = 0; d < 5; d++) {
      const dayEntries = [];
      for (const section of ROOM_SECTIONS) {
        for (const room of section.rooms) {
          for (const a of assignmentMap[`${d}-${room}`] || []) {
            if (a.team || a.mo_number || a.product_name) {
              const parts = [a.team, a.mo_number, a.product_name].filter(Boolean).join(' — ');
              dayEntries.push(`  Room ${room}: ${parts}${a.start_time ? ` @ ${a.start_time}` : ''}`);
            }
          }
        }
      }
      if (dayEntries.length > 0) {
        const dd = new Date(monday);
        dd.setDate(dd.getDate() + d);
        lines.push(`${DAYS[d]} ${dd.getMonth() + 1}/${dd.getDate()}:`);
        lines.push(...dayEntries);
        lines.push('');
      }
    }

    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [monday, assignmentMap]);

  const canEdit = user?.role === 'admin';

  const renderAssignmentCell = (dayIndex, room, roomType, cellTint) => {
    const key = `${dayIndex}-${room}`;
    const entries = (assignmentMap[key] || []).filter(a => a.team || a.mo_number || a.product_name);

    if (entries.length > 0) {
      const nextSlot = Math.max(...entries.map(a => a.slot || 0)) + 1;
      // Kitting can run several products in the same room on the same day
      const canAddLine = canEdit && roomType === 'kitting';
      return (
        <td key={dayIndex} className={`border border-gray-200 px-2 py-1.5 ${cellTint}`}>
          <div className="space-y-1">
            {entries.map(a => (
              <div
                key={a.id}
                className={`text-xs leading-tight space-y-0.5 rounded ${canEdit ? 'cursor-pointer hover:bg-gray-100' : ''} transition-colors`}
                onClick={canEdit ? () => setEditCell({ dayIndex, room, roomType, slot: a.slot || 0, data: a }) : undefined}
              >
                {a.team && <div className="font-semibold text-gray-900">{a.team}</div>}
                {(a.mo_number || a.product_name) && (
                  <div className="text-gray-600">
                    {a.mo_number && <span className="font-medium">{a.mo_number}</span>}
                    {a.mo_number && a.product_name && ' '}
                    {a.product_name}
                  </div>
                )}
                {a.start_time && <div className="text-gray-400">{a.start_time}</div>}
              </div>
            ))}
            {canAddLine && (
              <button
                onClick={() => setEditCell({ dayIndex, room, roomType, slot: nextSlot, data: null })}
                className="w-full flex items-center justify-center gap-1 text-[10px] font-medium text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded border border-dashed border-blue-200 py-0.5 transition-colors"
              >
                <Plus size={10} />
                Add product
              </button>
            )}
          </div>
        </td>
      );
    }

    return (
      <td
        key={dayIndex}
        className={`border border-gray-200 px-2 py-3 ${canEdit ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors text-center`}
        onClick={canEdit ? () => setEditCell({ dayIndex, room, roomType, slot: 0, data: null }) : undefined}
      >
        {canEdit && <Plus size={14} className="mx-auto text-gray-300" />}
      </td>
    );
  };

  return (
    <div className="space-y-4">
      {/* Week Navigation Bar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            title="Previous week"
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            title="Next week"
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Calendar size={14} />
            This Week
          </button>
        </div>

        <h2 className="text-sm sm:text-base font-semibold text-gray-900">
          Week of {formatDate(monday)}
        </h2>

        <button
          onClick={handleShare}
          className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {copied ? <Check size={14} className="text-green-600" /> : <Share2 size={14} />}
          {copied ? 'Copied!' : 'Share'}
        </button>
      </div>

      {/* Loading / Error */}
      {loading && <div className="text-center py-12 text-gray-500">Loading schedule...</div>}
      {error && <div className="text-center py-12 text-red-600">{error}</div>}

      {/* Schedule Grid */}
      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 w-32">
                    Room
                  </th>
                  {DAYS.map((day, i) => (
                    <th key={day} className="border border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-600">
                      <div className="flex items-center justify-center gap-1">
                        <span>{DAY_SHORT[i]}</span>
                        {canEdit && (
                          <button
                            onClick={() => setDuplicateDay(i)}
                            className="p-0.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title={`Duplicate ${day} to other days`}
                          >
                            <Copy size={11} />
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] font-normal text-gray-400">{dayDate(monday, i)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROOM_SECTIONS.map(section => {
                  const isCollapsed = collapsedSections[section.label];
                  return (
                    <Fragment key={section.label}>
                      {/* Section header */}
                      <tr
                        className={`${section.headerClass} border cursor-pointer select-none`}
                        onClick={() => toggleSection(section.label)}
                      >
                        <td colSpan={6} className="px-3 py-2 text-sm font-semibold">
                          <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            {section.label}
                            <span className="text-xs font-normal opacity-70">({section.rooms.length} room{section.rooms.length !== 1 ? 's' : ''})</span>
                          </div>
                        </td>
                      </tr>

                      {/* Room rows */}
                      {!isCollapsed && section.rooms.map(room => (
                        <Fragment key={room}>
                          <tr className="hover:bg-gray-50/50">
                            <td className="border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 whitespace-nowrap">
                              {room}
                            </td>
                            {DAYS.map((_, di) => renderAssignmentCell(di, room, section.type, section.cellTint))}
                          </tr>
                          {/* Cleaning level row */}
                          <tr className="bg-gray-50/70">
                            <td className="border border-gray-200 px-3 py-1 text-[10px] uppercase tracking-wider font-medium text-gray-400">
                              Cleaning
                            </td>
                            {DAYS.map((_, di) => (
                              <td key={di} className="border border-gray-200 px-1.5 py-1">
                                <CleaningCell
                                  value={cleaningMap[`${di}-${room}`]}
                                  weekStart={weekStart}
                                  dayIndex={di}
                                  room={room}
                                  userName={user?.name || ''}
                                  onSaved={refresh}
                                  readOnly={!canEdit}
                                />
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editCell && (
        <CellModal
          cell={editCell.data}
          weekStart={weekStart}
          dayIndex={editCell.dayIndex}
          room={editCell.room}
          roomType={editCell.roomType}
          slot={editCell.slot}
          userName={user?.name || ''}
          onClose={() => setEditCell(null)}
          onSaved={refresh}
        />
      )}

      {/* Duplicate day modal */}
      {duplicateDay != null && (
        <DuplicateDayModal
          weekStart={weekStart}
          sourceDay={duplicateDay}
          userName={user?.name || ''}
          onClose={() => setDuplicateDay(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

