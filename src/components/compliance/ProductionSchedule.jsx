import { useState, useMemo, useCallback, useRef, useEffect, forwardRef, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { ChevronLeft, ChevronRight, Calendar, Share2, Plus, X, ChevronDown, Check, Copy, GripVertical, FileText, Camera, Download, Bell } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TEAMS = ['Batching', 'Stick Pack', 'Hand Fill', 'Kitting', 'Quality', 'Warehouse', 'Sanitation', 'Other'];
const CLEANING_LEVELS = ['N/A', 'Partial', 'Full Clean'];

const TEAM_COLORS = {
  Batching: '#ca8a04',
  'Stick Pack': '#0891b2',
  'Hand Fill': '#7c3aed',
  Kitting: '#2563eb',
  Quality: '#dc2626',
  Warehouse: '#4b5563',
  Sanitation: '#059669',
  Other: '#64748b',
};

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m ?? 0).padStart(2, '0')} ${ap}`;
}

function roomLabel(room) {
  return /batching/i.test(room) ? room : `Room ${room}`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Build a shared view of the week: only days/teams/rooms that actually have items,
// grouped Day → Team → Room + product details.
function buildShareModel(monday, assignmentMap) {
  const days = [];
  for (let d = 0; d < 5; d++) {
    const teamGroups = new Map();
    for (const section of ROOM_SECTIONS) {
      for (const room of section.rooms) {
        for (const a of assignmentMap[`${d}-${room}`] || []) {
          if (!(a.team || a.mo_number || a.product_name)) continue;
          const team = a.team || 'Unassigned';
          if (!teamGroups.has(team)) teamGroups.set(team, []);
          teamGroups.get(team).push({
            room,
            mo: a.mo_number || '',
            product: a.product_name || '',
            time: a.start_time || '',
          });
        }
      }
    }
    if (teamGroups.size === 0) continue;
    const dd = new Date(monday);
    dd.setDate(dd.getDate() + d);
    const teams = [...teamGroups.entries()]
      .sort((a, b) => {
        const ia = TEAMS.indexOf(a[0]);
        const ib = TEAMS.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([team, rows]) => ({ team, rows }));
    days.push({ dayIndex: d, label: DAYS[d], dateLabel: `${dd.getMonth() + 1}/${dd.getDate()}`, teams });
  }
  return days;
}

function buildShareText(monday, model) {
  const lines = [`Production Schedule — Week of ${formatDate(monday)}`, ''];
  if (model.length === 0) {
    lines.push('No production scheduled this week.');
    return lines.join('\n');
  }
  for (const day of model) {
    lines.push(`${day.label.toUpperCase()} ${day.dateLabel}`);
    for (const t of day.teams) {
      lines.push(`  ${t.team}`);
      for (const r of t.rows) {
        const detail = [r.mo, r.product].filter(Boolean).join(' ');
        const time = r.time ? ` @ ${fmtTime(r.time)}` : '';
        lines.push(`    • ${roomLabel(r.room)} — ${detail}${time}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// Clean, self-contained SVG snapshot of the shared model (rasterized to PNG on download).
const ScheduleSnapshot = forwardRef(function ScheduleSnapshot({ model, weekLabel }, ref) {
  const W = 840;
  const M = 28;
  const contentW = W - M * 2;
  const els = [];
  let y = 34;

  els.push(<text key="title" x={M} y={y} fontFamily="Arial, sans-serif" fontSize="22" fontWeight="700" fill="#0f172a">Production Schedule</text>);
  y += 20;
  els.push(<text key="sub" x={M} y={y} fontFamily="Arial, sans-serif" fontSize="13" fill="#64748b">Week of {weekLabel}</text>);
  y += 22;

  model.forEach((day, di) => {
    els.push(<rect key={`dh${di}`} x={M} y={y} width={contentW} height={30} rx={6} fill="#0f172a" />);
    els.push(<text key={`dt${di}`} x={M + 12} y={y + 20} fontFamily="Arial, sans-serif" fontSize="14" fontWeight="700" fill="#ffffff">{day.label} · {day.dateLabel}</text>);
    y += 42;
    day.teams.forEach((t, ti) => {
      const color = TEAM_COLORS[t.team] || '#64748b';
      els.push(<rect key={`tcc${di}-${ti}`} x={M} y={y - 10} width={11} height={11} rx={2} fill={color} />);
      els.push(<text key={`tt${di}-${ti}`} x={M + 20} y={y} fontFamily="Arial, sans-serif" fontSize="13" fontWeight="700" fill={color}>{t.team}</text>);
      y += 20;
      t.rows.forEach((r, ri) => {
        const detail = [r.mo, r.product].filter(Boolean).join('  ');
        els.push(
          <text key={`r${di}-${ti}-${ri}`} x={M + 20} y={y} fontFamily="Arial, sans-serif" fontSize="13" fill="#334155">
            <tspan fontWeight="600" fill="#0f172a">{roomLabel(r.room)}</tspan>
            <tspan>{'  —  '}{truncate(detail, 72)}</tspan>
          </text>
        );
        if (r.time) {
          els.push(<text key={`rt${di}-${ti}-${ri}`} x={W - M} y={y} textAnchor="end" fontFamily="Arial, sans-serif" fontSize="12" fill="#64748b">{fmtTime(r.time)}</text>);
        }
        y += 20;
      });
      y += 8;
    });
    y += 10;
  });

  const H = Math.max(y + 4, 120);

  return (
    <svg ref={ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {els}
    </svg>
  );
});

function SnapshotModal({ model, weekLabel, weekStartStr, onClose }) {
  const svgRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    setBusy(true);
    const xml = new XMLSerializer().serializeToString(svg);
    const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) { setBusy(false); return; }
        const purl = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = purl;
        a.download = `production-schedule-${weekStartStr}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(purl);
        setBusy(false);
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); setBusy(false); };
    img.src = url;
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Schedule Snapshot</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="overflow-auto p-4 bg-gray-100 flex-1">
          <div className="mx-auto bg-white shadow rounded overflow-hidden" style={{ maxWidth: 840 }}>
            {model.length === 0
              ? <div className="p-10 text-center text-gray-400">No production scheduled this week.</div>
              : <ScheduleSnapshot ref={svgRef} model={model} weekLabel={weekLabel} />}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            Close
          </button>
          <button
            onClick={download}
            disabled={busy || model.length === 0}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Download size={14} />
            {busy ? 'Preparing...' : 'Download PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}

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

const PRODUCTION_ROOMS = ROOM_SECTIONS.find(s => s.type === 'production')?.rooms || [];
const KITTING_ROOMS = ROOM_SECTIONS.find(s => s.type === 'kitting')?.rooms || [];
// Downstream packaging lines a batched product can flow to (Pouch = Hand Fill)
const PACKAGING_TEAMS = [
  { value: 'Stick Pack', label: 'Stick Pack' },
  { value: 'Hand Fill', label: 'Hand Fill (Pouch)' },
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

function CellModal({ cell, weekStart, nextWeekStart, nextWeekLabel, dayIndex, room, roomType, slot, userName, onClose, onSaved, onSetupDownstream }) {
  const [form, setForm] = useState({
    team: cell?.team || (roomType === 'batching' ? 'Batching' : ''),
    mo_number: cell?.mo_number || '',
    product_name: cell?.product_name || '',
    start_time: cell?.start_time || '',
    notes: cell?.notes || '',
  });
  const [repeatDays, setRepeatDays] = useState([]);
  const [repeatNextDays, setRepeatNextDays] = useState([]); // days in the following week
  const [showNextWeek, setShowNextWeek] = useState(false);
  const [setupDownstream, setSetupDownstream] = useState(roomType === 'batching' && !cell?.id);
  const [saving, setSaving] = useState(false);

  const otherDays = DAYS.map((_, i) => i).filter(i => i !== dayIndex);
  const isBatching = roomType === 'batching';

  const toggleRepeatDay = (d) => {
    setRepeatDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };
  const toggleRepeatNextDay = (d) => {
    setRepeatNextDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
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
      await apiPost('/production/schedule', { ...payload, week_start: weekStart, day_of_week: dayIndex });
      for (const d of repeatDays) {
        await apiPost('/production/schedule', { ...payload, week_start: weekStart, day_of_week: d });
      }
      // Copy into next week (slot 0 in the target cells — they're a fresh week)
      for (const d of repeatNextDays) {
        await apiPost('/production/schedule', { ...payload, week_start: nextWeekStart, day_of_week: d, slot: 0 });
      }
      onSaved();
      onClose();
      if (isBatching && setupDownstream && (form.product_name || form.mo_number)) {
        onSetupDownstream?.({ product_name: form.product_name, mo_number: form.mo_number, batchDay: dayIndex });
      }
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
            {/* Push into next week */}
            <button
              type="button"
              onClick={() => setShowNextWeek(v => !v)}
              className="mt-2 flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
            >
              <Calendar size={12} />
              {showNextWeek ? 'Hide next week' : 'Also add to next week…'}
            </button>
            {showNextWeek && (
              <div className="mt-1.5 rounded-lg border border-blue-100 bg-blue-50/40 p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-gray-600">Week of {nextWeekLabel}</span>
                  <button
                    type="button"
                    onClick={() => setRepeatNextDays([0, 1, 2, 3, 4])}
                    className="text-[11px] font-medium text-blue-600 hover:underline"
                  >
                    Mon–Fri
                  </button>
                </div>
                <div className="flex gap-1.5">
                  {DAYS.map((_, d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleRepeatNextDay(d)}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        repeatNextDays.includes(d)
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {DAY_SHORT[d]}
                    </button>
                  ))}
                </div>
                {repeatNextDays.length > 0 && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Also adds to {repeatNextDays.slice().sort().map(d => DAY_SHORT[d]).join(', ')} next week.
                  </p>
                )}
              </div>
            )}
          </div>
          {isBatching && (
            <label className="flex items-start gap-2 text-xs text-gray-600 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
              <input
                type="checkbox"
                checked={setupDownstream}
                onChange={e => setSetupDownstream(e.target.checked)}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>After saving, set up downstream steps (Stick Pack / Pouch → Kitting) for this product.</span>
            </label>
          )}
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

// Per-item prompt to auto-populate downstream steps for a batched product:
// Batching → Pouch (Hand Fill) / Stick Pack → Kitting
function DownstreamModal({ product, batchDay, weekStart, userName, nextSlotFor, onClose, onSaved }) {
  const [pkgTeam, setPkgTeam] = useState('Stick Pack');
  const [pkgDay, setPkgDay] = useState(batchDay);
  const [pkgRoom, setPkgRoom] = useState('');
  const [pkgTime, setPkgTime] = useState('');
  const [includeKitting, setIncludeKitting] = useState(true);
  const [kitDay, setKitDay] = useState(batchDay);
  const [kitRoom, setKitRoom] = useState(KITTING_ROOMS[0] || '15');
  const [kitTime, setKitTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const productLabel = [product.mo_number, product.product_name].filter(Boolean).join(' — ') || 'this product';

  const handleConfirm = async () => {
    if (!pkgRoom) { setError('Pick a room for the packaging step.'); return; }
    setSaving(true);
    setError(null);
    const steps = [
      { day: pkgDay, room: pkgRoom, room_type: 'production', team: pkgTeam, time: pkgTime },
    ];
    if (includeKitting) {
      steps.push({ day: kitDay, room: kitRoom, room_type: 'kitting', team: 'Kitting', time: kitTime });
    }
    try {
      for (const s of steps) {
        await apiPost('/production/schedule', {
          week_start: weekStart,
          day_of_week: s.day,
          room: s.room,
          room_type: s.room_type,
          slot: nextSlotFor(s.day, s.room),
          team: s.team,
          mo_number: product.mo_number || '',
          product_name: product.product_name || '',
          start_time: s.time || '',
          updated_by: userName,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to create downstream steps:', err);
      setError('Failed to add downstream steps. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const dayOptions = DAYS.map((d, i) => <option key={i} value={i}>{d}</option>);

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Set up downstream steps</h3>
            <p className="text-xs text-gray-500 mt-0.5">{productLabel}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Packaging step */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">1 · Packaging</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Line</label>
              <select value={pkgTeam} onChange={e => setPkgTeam(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                {PACKAGING_TEAMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Day</label>
              <select value={pkgDay} onChange={e => setPkgDay(Number(e.target.value))}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                {dayOptions}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Room</label>
              <select value={pkgRoom} onChange={e => setPkgRoom(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                <option value="">Select room...</option>
                {PRODUCTION_ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Start time</label>
              <input type="time" value={pkgTime} onChange={e => setPkgTime(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {/* Kitting step */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input type="checkbox" checked={includeKitting} onChange={e => setIncludeKitting(e.target.checked)}
              className="rounded border-gray-300" />
            2 · Kitting
          </label>
          {includeKitting && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Day</label>
                <select value={kitDay} onChange={e => setKitDay(Number(e.target.value))}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                  {dayOptions}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Room</label>
                <select value={kitRoom} onChange={e => setKitRoom(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                  {KITTING_ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Start time</label>
                <input type="time" value={kitTime} onChange={e => setKitTime(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleConfirm} disabled={saving || !pkgRoom}
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Adding...' : 'Add downstream steps'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            Skip
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
  const [shareOpen, setShareOpen] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [downstreamFor, setDownstreamFor] = useState(null); // { product_name, mo_number, batchDay }

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notified, setNotified] = useState(false);

  const monday = useMemo(() => {
    const m = getMonday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);

  const nextMonday = useMemo(() => {
    const m = new Date(monday);
    m.setDate(m.getDate() + 7);
    return m;
  }, [monday]);

  const weekStart = formatWeekStart(monday);
  const nextWeekStart = formatWeekStart(nextMonday);

  // Opening the schedule clears the New/Updated badge for this user.
  useEffect(() => {
    apiPost('/production/schedule/seen', {})
      .then(() => window.dispatchEvent(new CustomEvent('schedule-notice-changed')))
      .catch(() => {});
  }, []);

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

  const shareModel = useMemo(() => buildShareModel(monday, assignmentMap), [monday, assignmentMap]);

  const handleShareText = useCallback(() => {
    const text = buildShareText(monday, shareModel);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [monday, shareModel]);

  const canEdit = user?.role === 'admin';

  const handleNotify = useCallback(async (kind) => {
    setNotifyOpen(false);
    try {
      await apiPost('/production/schedule/notify', { kind, week_start: weekStart });
      setNotified(true);
      window.dispatchEvent(new CustomEvent('schedule-notice-changed'));
      setTimeout(() => setNotified(false), 2500);
    } catch (err) {
      console.error('Failed to notify:', err);
    }
  }, [weekStart]);

  // View-only users get a decluttered schedule: rooms with no work that week are
  // hidden, and a room's Cleaning row is hidden when every day is N/A. Editors
  // (admins) always see the full grid so they can fill empty cells.
  const roomHasWork = useCallback((room) =>
    DAYS.some((_, di) => (assignmentMap[`${di}-${room}`] || []).some(a => a.team || a.mo_number || a.product_name)),
    [assignmentMap]);
  const roomHasCleaning = useCallback((room) =>
    DAYS.some((_, di) => { const v = cleaningMap[`${di}-${room}`]; return v && v !== 'N/A'; }),
    [cleaningMap]);

  const nextSlotFor = useCallback((dayIndex, roomName) => {
    const entries = assignmentMap[`${dayIndex}-${roomName}`] || [];
    return entries.length ? Math.max(...entries.map(a => a.slot || 0)) + 1 : 0;
  }, [assignmentMap]);

  const handleMove = useCallback(async (id, targetDay, targetRoom, targetRoomType) => {
    try {
      await apiPut(`/production/schedule/${id}/move`, {
        day_of_week: targetDay,
        room: targetRoom,
        room_type: targetRoomType,
        updated_by: user?.name || '',
      });
      refresh();
    } catch (err) {
      console.error('Failed to move assignment:', err);
    }
  }, [refresh, user]);

  // Drop-target props shared by filled and empty cells
  const dropProps = (dayIndex, room, roomType) => {
    if (!canEdit) return {};
    const key = `${dayIndex}-${room}`;
    return {
      onDragOver: (e) => {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverKey !== key) setDragOverKey(key);
      },
      onDrop: (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || draggingId;
        setDragOverKey(null);
        setDraggingId(null);
        if (id) handleMove(id, dayIndex, room, roomType);
      },
    };
  };

  const renderAssignmentCell = (dayIndex, room, roomType, cellTint) => {
    const key = `${dayIndex}-${room}`;
    const entries = (assignmentMap[key] || []).filter(a => a.team || a.mo_number || a.product_name);
    const isDropTarget = canEdit && draggingId && dragOverKey === key;
    const dropHighlight = isDropTarget ? 'ring-2 ring-inset ring-blue-400 bg-blue-50' : '';

    if (entries.length > 0) {
      const nextSlot = Math.max(...entries.map(a => a.slot || 0)) + 1;
      // Any room can run several products on the same day — Kitting/Batching, and
      // production rooms running Stick Pack / Hand Fill, etc.
      const canAddLine = canEdit;
      return (
        <td key={dayIndex} className={`border border-gray-200 px-2 py-1.5 ${cellTint} ${dropHighlight}`} {...dropProps(dayIndex, room, roomType)}>
          <div className="space-y-1">
            {entries.map(a => (
              <div
                key={a.id}
                draggable={canEdit}
                onDragStart={canEdit ? (e) => {
                  e.dataTransfer.setData('text/plain', a.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingId(a.id);
                } : undefined}
                onDragEnd={() => { setDraggingId(null); setDragOverKey(null); }}
                className={`group/entry flex items-start gap-1 text-xs leading-tight rounded px-1 -mx-1 transition-colors ${canEdit ? 'cursor-grab active:cursor-grabbing hover:bg-gray-100' : ''} ${draggingId === a.id ? 'opacity-40' : ''}`}
                onClick={canEdit ? () => setEditCell({ dayIndex, room, roomType, slot: a.slot || 0, data: a }) : undefined}
                title={canEdit ? 'Drag to move · click to edit' : undefined}
              >
                {canEdit && <GripVertical size={11} className="text-gray-300 mt-0.5 shrink-0 opacity-0 group-hover/entry:opacity-100" />}
                <div className="space-y-0.5 min-w-0">
                  {a.team && <div className="font-semibold text-gray-900">{a.team}</div>}
                  {(a.mo_number || a.product_name) && (
                    <div className="text-gray-600">
                      {a.mo_number && <span className="font-medium">{a.mo_number}</span>}
                      {a.mo_number && a.product_name && ' '}
                      {a.product_name}
                    </div>
                  )}
                  {a.start_time && <div className="text-gray-400">{fmtTime(a.start_time)}</div>}
                </div>
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
        className={`border border-gray-200 px-2 py-3 ${canEdit ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors text-center ${dropHighlight}`}
        onClick={canEdit ? () => setEditCell({ dayIndex, room, roomType, slot: 0, data: null }) : undefined}
        {...dropProps(dayIndex, room, roomType)}
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

        <div className="flex items-center gap-1.5">
        {canEdit && (
          <div className="relative">
            <button
              onClick={() => setNotifyOpen(o => !o)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${notified ? 'text-emerald-700 bg-emerald-50' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Notify the team that the schedule is ready"
            >
              {notified ? <Check size={14} className="text-emerald-600" /> : <Bell size={14} />}
              {notified ? 'Team notified' : 'Notify'}
              {!notified && <ChevronDown size={12} />}
            </button>
            {notifyOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifyOpen(false)} />
                <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                  <div className="px-3 py-1.5 text-[11px] text-gray-400">Show a badge on everyone's Schedule tab</div>
                  <button
                    onClick={() => handleNotify('new')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="h-[16px] flex items-center rounded-full bg-emerald-500 text-white text-[9px] font-bold uppercase px-1.5">New</span>
                    New schedule posted
                  </button>
                  <button
                    onClick={() => handleNotify('updated')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="h-[16px] flex items-center rounded-full bg-emerald-500 text-white text-[9px] font-bold uppercase px-1.5">Upd</span>
                    Schedule updated
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <div className="relative">
          <button
            onClick={() => setShareOpen(o => !o)}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {copied ? <Check size={14} className="text-green-600" /> : <Share2 size={14} />}
            {copied ? 'Copied!' : 'Share'}
            <ChevronDown size={12} />
          </button>
          {shareOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} />
              <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                <button
                  onClick={() => { handleShareText(); setShareOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <FileText size={14} className="text-gray-400" /> Copy as text
                </button>
                <button
                  onClick={() => { setShowSnapshot(true); setShareOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Camera size={14} className="text-gray-400" /> Snapshot image
                </button>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && <div className="text-center py-12 text-gray-500">Loading schedule...</div>}
      {error && <div className="text-center py-12 text-red-600">{error}</div>}

      {/* Schedule Grid */}
      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-13rem)]">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky top-0 z-20 bg-gray-50 border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 w-32">
                    Room
                  </th>
                  {DAYS.map((day, i) => (
                    <th key={day} className="sticky top-0 z-20 bg-gray-50 border border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-600">
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
                  // Viewers only see rooms that have work scheduled this week.
                  const rooms = canEdit ? section.rooms : section.rooms.filter(roomHasWork);
                  if (rooms.length === 0) return null; // hide fully-empty sections for viewers
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
                            <span className="text-xs font-normal opacity-70">({rooms.length} room{rooms.length !== 1 ? 's' : ''})</span>
                          </div>
                        </td>
                      </tr>

                      {/* Room rows */}
                      {!isCollapsed && rooms.map(room => (
                        <Fragment key={room}>
                          <tr className="hover:bg-gray-50/50">
                            <td className="border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 whitespace-nowrap">
                              {room}
                            </td>
                            {DAYS.map((_, di) => renderAssignmentCell(di, room, section.type, section.cellTint))}
                          </tr>
                          {/* Cleaning level row — hidden for viewers when all N/A */}
                          {(canEdit || roomHasCleaning(room)) && (
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
                          )}
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
          nextWeekStart={nextWeekStart}
          nextWeekLabel={formatDate(nextMonday)}
          dayIndex={editCell.dayIndex}
          room={editCell.room}
          roomType={editCell.roomType}
          slot={editCell.slot}
          userName={user?.name || ''}
          onClose={() => setEditCell(null)}
          onSaved={refresh}
          onSetupDownstream={(p) => setDownstreamFor(p)}
        />
      )}

      {/* Downstream auto-populate modal */}
      {downstreamFor && (
        <DownstreamModal
          product={downstreamFor}
          batchDay={downstreamFor.batchDay}
          weekStart={weekStart}
          userName={user?.name || ''}
          nextSlotFor={nextSlotFor}
          onClose={() => setDownstreamFor(null)}
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

      {/* Snapshot modal */}
      {showSnapshot && (
        <SnapshotModal
          model={shareModel}
          weekLabel={formatDate(monday)}
          weekStartStr={weekStart}
          onClose={() => setShowSnapshot(false)}
        />
      )}
    </div>
  );
}

