import { useState, useMemo, useEffect, useRef } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';
import { useCompactLayout } from '../../lib/useCompactLayout.js';
import {
  Map as MapIcon, Layers, Printer, X, Droplets, Factory, Wrench, AlertTriangle,
  Bug, FlaskConical, CalendarDays, ExternalLink, Maximize2, Minimize2, ChevronRight,
  Pencil, Save, RotateCcw,
} from 'lucide-react';
import {
  PLAN, SPANS, ROOMS, ROOM_KINDS, FIXTURES, FIXTURE_KINDS, TRAPS, TRAPS_UNPLACED,
  ZONE_OF_ROOM, BPG_ZONE_AREAS,
} from '../../data/facilityMap.js';

// The facility map, with what ReadyDoc knows drawn on top of it.
//
// A PDF of a floor plan answers one question: where things are. This answers
// the ones people actually ask standing in front of it — when was that room
// last cleaned, is it inside the 72-hour window, what's scheduled in it, which
// brittle-plastic zone covers it. Clicking a room opens the record.
//
// LAYERS rather than one crowded drawing. The paper map carries everything at
// once because it has to; a screen doesn't, so fixtures, pest control and the
// BP&G zones each go on and off. "Show all" puts it back to the paper view for
// anyone who wants that.
//
// Geometry is data (`src/data/facilityMap.js`) — adding a fixture or fixing a
// room is an edit there, not a design exercise.

const openModule = (tab) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab } }));

// Status colouring is deliberately only about CLEANING, because that's the
// live fact a floor plan is genuinely useful for. Everything else lives in the
// detail panel rather than competing for the same colour channel.
// While this layer is on, EVERY colour on the map means a cleaning fact — a
// room with no cleaning data falls back to neutral grey, not to its room-kind
// colour. Batching's kind fill is the same amber as "no clean on record", so
// keeping the kind colour made a room the cleaning log has never heard of
// indistinguishable from one that is overdue its first record: the legend
// naming a fact the colour didn't carry.
const NO_STATUS = { fill: '#f3f4f6', stroke: '#d1d5db' };
const statusFill = (s) => {
  if (!s) return NO_STATUS;
  if (s.needs_reclean) return { fill: '#fecaca', stroke: '#ef4444' };
  if (s.reclean_status === 'clean') return { fill: '#dcfce7', stroke: '#22c55e' };
  if (s.reclean_status === 'no_clean_on_record') return { fill: '#fef3c7', stroke: '#f59e0b' };
  return NO_STATUS;
};

const STATUS_LEGEND = [
  { label: 'Needs re-cleaning', fill: '#fecaca', stroke: '#ef4444' },
  { label: 'Inside the 72-hour window', fill: '#dcfce7', stroke: '#22c55e' },
  { label: 'No clean on record', fill: '#fef3c7', stroke: '#f59e0b' },
  { label: 'No cleaning status', fill: NO_STATUS.fill, stroke: NO_STATUS.stroke },
];

// Whatever the rooms are coloured BY is what the legend explains. Showing the
// room-kind key while the map is coloured by cleaning status describes a
// scheme that isn't on screen.
function Legend({ layers }) {
  const byKind = !layers.bpg && !layers.status;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-gray-600">
      {layers.bpg && <span className="font-semibold text-gray-700">Coloured by BP&amp;G zone — key below</span>}
      {!layers.bpg && layers.status && STATUS_LEGEND.map(v => (
        <span key={v.label} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border" style={{ background: v.fill, borderColor: v.stroke }} />
          {v.label}
        </span>
      ))}
      {byKind && Object.entries(ROOM_KINDS).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border" style={{ background: v.fill, borderColor: v.stroke }} />
          {v.label}
        </span>
      ))}
      {layers.fixtures && Object.entries(FIXTURE_KINDS).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border" style={{ background: v.color, borderColor: v.edge }} />
          {v.label}
        </span>
      ))}
      {layers.traps && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-blue-600" /> Rodent station
        </span>
      )}
    </div>
  );
}

function Fixture({ f }) {
  const k = FIXTURE_KINDS[f.type];
  if (!k) return null;
  if (f.type === 'extinguisher') {
    return (
      <g>
        <rect x={f.x - 2} y={f.y} width="4" height="9" rx="1" fill={k.color} stroke={k.edge} strokeWidth="0.6" />
        <rect x={f.x - 5} y={f.y - 2} width="10" height="2.5" rx="1" fill={k.color} stroke={k.edge} strokeWidth="0.6" />
      </g>
    );
  }
  const w = f.type === 'foursink' ? 14 : 7;
  const h = f.type === 'foursink' ? 3.5 : 7;
  return <rect x={f.x - w / 2} y={f.y - h / 2} width={w} height={h} rx="1" fill={k.color} stroke={k.edge} strokeWidth="0.7" />;
}

// The label column stacks above the value on a phone. A fixed 8rem label beside
// a 190px value turns "2026-08-01 · 2 days ago · 1 entered late" into four
// ragged lines hanging off an empty column.
function Line({ icon: Icon, label, value, tone }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon size={14} className="mt-0.5 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-2">
        <span className="block text-gray-500 text-xs sm:text-sm sm:w-32 sm:shrink-0">{label}</span>
        <span className={`block min-w-0 ${tone || 'text-gray-900'}`}>{value}</span>
      </div>
    </div>
  );
}

// Rename the space, or say which line is standing in it today. Everything on
// casters means the drawing is right about the walls and out of date about the
// equipment within a month; this is how the plant keeps up without a deploy.
function RoomEditor({ room, override, onSaved, onCancel }) {
  const [label, setLabel] = useState(override?.label || room.label || '');
  const [equipment, setEquipment] = useState(override?.equipment || '');
  const [note, setNote] = useState(override?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async (reset) => {
    setBusy(true); setErr(null);
    try {
      await apiPut(`/facility/rooms/${encodeURIComponent(room.id)}`,
        reset ? { label: '', equipment: '', note: '' } : { label, equipment, note });
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="p-4 space-y-3 border-t border-gray-100 bg-gray-50/60">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Name on the map</span>
          <input value={label} onChange={e => setLabel(e.target.value)}
            placeholder={room.label} className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Equipment / line in here now</span>
          <input value={equipment} onChange={e => setEquipment(e.target.value)}
            placeholder="e.g. Bottling line, Auger stick pack"
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </label>
      </div>
      <label className="block">
        <span className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder="anything worth knowing about this space"
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
      </label>
      {room.room && (
        <p className="text-[11px] text-gray-500">
          Records for this space are filed under <span className="font-mono font-semibold">{room.room}</span>.
          That stays as it is — every clean and production entry already filed carries it, and changing it
          here would cut this room off from its own history without altering a single record.
        </p>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => save(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
          <Save size={12} /> {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-white">Cancel</button>
        {override && (
          <button type="button" disabled={busy} onClick={() => save(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-white ml-auto"
            title="Go back to what the original drawing says">
            <RotateCcw size={12} /> Reset to the drawing
          </button>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ room, status, zone, zoneInfo, onClose, override, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const s = status || {};
  // Age comes from the server (`hours_since_clean`, the same number the 72-hour
  // rule works from) rather than being computed here — reading the clock during
  // render is a side effect, and this way the map and the rule can't disagree
  // about how old a clean is.
  const days = Number.isFinite(s.hours_since_clean) ? Math.floor(s.hours_since_clean / 24) : null;

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{override?.label || room.label || room.id}</h3>
          <p className="text-xs text-gray-500">
            {ROOM_KINDS[room.kind]?.label}{room.room && room.room !== (override?.label || room.label) ? ` · recorded as "${room.room}"` : ''}
          </p>
          {override?.equipment && (
            <p className="mt-0.5 text-xs text-powder-700 font-medium flex items-center gap-1">
              <Wrench size={11} /> {override.equipment}
            </p>
          )}
          {override?.note && <p className="mt-0.5 text-xs text-gray-500">{override.note}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canEdit && (
            <button onClick={() => setEditing(e => !e)} className="p-1 hover:bg-gray-100 rounded-lg"
              data-tip="Rename this space or say what line is in it">
              <Pencil size={14} className="text-gray-400" />
            </button>
          )}
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
        </div>
      </div>

      {editing && (
        <RoomEditor room={room} override={override}
          onSaved={() => { setEditing(false); onSaved?.(); }} onCancel={() => setEditing(false)} />
      )}

      <div className="p-4 space-y-2">
        {room.note && <p className="text-xs text-gray-500">{room.note}</p>}

        {!room.room && (
          <p className="text-xs text-gray-500">
            This space isn&apos;t a record-keeping area, so there&apos;s nothing filed against it directly.
          </p>
        )}

        {room.room && (
          <>
            <Line icon={Droplets} label="Last clean"
              value={s.last_clean
                ? `${String(s.last_clean).slice(0, 10)}${days != null ? ` · ${days} day${days === 1 ? '' : 's'} ago` : ''}${s.late_entries ? ` · ${s.late_entries} entered late` : ''}`
                : 'No passed clean on record'}
              tone={s.last_clean ? 'text-gray-900' : 'text-amber-700'} />
            <Line icon={AlertTriangle} label="72-hour rule"
              value={!s.reclean_applicable ? 'Not applicable to this area'
                : s.needs_reclean ? 'Needs re-cleaning before next use'
                  : s.reclean_status === 'clean' ? 'Inside the window'
                    : s.reclean_status === 'dirty' ? 'Used since its last clean'
                      : s.reclean_status === 'no_clean_on_record' ? 'No clean on record' : '—'}
              tone={s.needs_reclean ? 'text-red-700 font-medium' : 'text-gray-900'} />
            <Line icon={Factory} label="Production"
              value={[
                s.last_run ? `last run ${s.last_run}` : 'no runs in 30 days',
                s.runs_30d ? `${s.runs_30d} in 30 days` : null,
                s.scheduled_this_week ? `${s.scheduled_this_week} scheduled this week` : null,
              ].filter(Boolean).join(' · ')} />
            {s.equipment ? <Line icon={Wrench} label="Equipment" value={`${s.equipment} active`} /> : null}
          </>
        )}

        {zone && (
          <div className="pt-2 mt-2 border-t border-gray-100">
            <Line icon={FlaskConical} label="Brittle plastic & glass"
              value={`${zone}${zoneInfo?.item_count ? ` · ${zoneInfo.item_count} items` : ''}${zoneInfo?.last_inspection ? ` · last inspected ${String(zoneInfo.last_inspection).slice(0, 10)}` : ''}`} />
            {zoneInfo?.items?.length > 0 && (
              <ul className="mt-1.5 ml-6 sm:ml-[9.5rem] space-y-0.5 max-h-40 overflow-y-auto">
                {zoneInfo.items.map((i, n) => (
                  <li key={n} className="text-xs text-gray-600">
                    {i.item}{i.qty ? ` × ${i.qty}` : ''}{i.material ? <span className="text-gray-400"> · {i.material}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/60 flex flex-wrap gap-2">
        <button onClick={() => openModule('sanitation')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50">
          <Droplets size={12} /> Sanitation
        </button>
        <button onClick={() => openModule('production-schedule')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50">
          <CalendarDays size={12} /> Schedule
        </button>
        {zone && (
          <button onClick={() => openModule('qa-inspections')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50">
            <FlaskConical size={12} /> BP&amp;G inspections
          </button>
        )}
      </div>
    </div>
  );
}

// On a phone the rooms are 7px tall — you cannot tap them, and pinching a
// floor plan to find one is not a workflow. So the compact layout gets the
// same rooms as a LIST, grouped by whatever the map is coloured by, and the
// map above it becomes the picture rather than the only control.
function statusGroupOf(s) {
  if (!s) return 'other';
  if (s.needs_reclean) return 'needs';
  if (s.reclean_status === 'clean') return 'clean';
  if (s.reclean_status === 'no_clean_on_record') return 'none';
  return 'other';
}
const STATUS_GROUPS = [
  { key: 'needs', label: 'Needs re-cleaning', dot: '#ef4444' },
  { key: 'none', label: 'No clean on record', dot: '#f59e0b' },
  { key: 'clean', label: 'Inside the 72-hour window', dot: '#22c55e' },
  { key: 'other', label: 'No cleaning status', dot: '#d1d5db' },
];

function RoomList({ status, overrides = {}, onPick }) {
  const groups = useMemo(() => {
    const out = {};
    for (const r of ROOMS) {
      const g = r.room ? statusGroupOf(status[r.room]) : 'other';
      (out[g] ||= []).push(r);
    }
    return out;
  }, [status]);

  return (
    <div className="space-y-3 md:hidden">
      <p className="text-xs text-gray-500">
        Every space on the map, by cleaning status — tap one for its detail.
      </p>
      {STATUS_GROUPS.filter(g => groups[g.key]?.length).map(g => (
        <div key={g.key} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.dot }} />
            <span className="text-xs font-semibold text-gray-700">{g.label}</span>
            <span className="text-xs text-gray-400 ml-auto">{groups[g.key].length}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {groups[g.key].map(r => (
              <li key={r.id}>
                <button onClick={() => onPick(r.id)}
                  className="w-full flex items-center gap-2 px-3 py-3 text-left active:bg-gray-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-900 truncate">{overrides[r.id]?.label || r.label || r.id}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      {overrides[r.id]?.equipment || ROOM_KINDS[r.kind]?.label}
                      {r.room && status[r.room]?.last_clean
                        ? ` · cleaned ${String(status[r.room].last_clean).slice(0, 10)}` : ''}
                    </span>
                  </span>
                  <ChevronRight size={15} className="text-gray-300 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function FacilityMapPanel({ user }) {
  const [layers, setLayers] = useState({ fixtures: false, traps: false, bpg: false, status: true });
  const [selected, setSelected] = useState(null);
  // Fit-to-width by default on a phone: seeing half a building is worse than
  // seeing all of it small. Zoom restores the readable-label size and the
  // sideways scroll that comes with it — a deliberate choice, not a surprise.
  const [zoomed, setZoomed] = useState(false);
  const compact = useCompactLayout();
  const detailRef = useRef(null);
  const { data, refresh } = useApiGet('/facility/map-status');
  const canEdit = user?.role === 'admin' || user?.role === 'supervisor';

  // On a phone the detail lands below the map, so tapping a room at the top
  // of the plan otherwise looks like nothing happened.
  useEffect(() => {
    if (!compact || !selected) return;
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [compact, selected]);

  const status = data?.rooms || {};
  const zones = data?.zones || {};
  // What the plant has renamed since the drawing was made. The map draws these
  // instead of the shipped labels, so a line moving rooms is one edit, not a
  // deploy.
  const overrides = data?.overrides || {};
  const nameOf = (r) => overrides[r.id]?.label || r.label;
  const toggle = (k) => setLayers(l => ({ ...l, [k]: !l[k] }));

  // A stable colour per BP&G zone so the same zone reads the same everywhere.
  const zoneColour = useMemo(() => {
    const palette = ['#c7d2fe', '#fbcfe8', '#bbf7d0', '#fed7aa', '#bfdbfe', '#ddd6fe',
      '#fde68a', '#a7f3d0', '#fecaca', '#e9d5ff', '#cffafe', '#d9f99d', '#fbcfe8', '#bae6fd', '#fef08a'];
    const out = {};
    Object.keys(BPG_ZONE_AREAS).forEach((z, i) => { out[z] = palette[i % palette.length]; });
    return out;
  }, []);

  const fillFor = (r) => {
    if (layers.bpg) {
      const z = ZONE_OF_ROOM[r.id];
      if (z) return { fill: zoneColour[z], stroke: '#64748b' };
    }
    // Every space, not just the ones with a room key — an office coloured by
    // its kind while the map claims to show cleaning status is the same lie.
    if (layers.status) return statusFill(r.room ? status[r.room] : null);
    const k = ROOM_KINDS[r.kind];
    return { fill: k.fill, stroke: k.stroke };
  };

  const needsClean = Object.entries(status).filter(([, s]) => s.needs_reclean).length;
  const selectedRoom = selected ? ROOMS.find(r => r.id === selected) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <MapIcon size={20} className="text-powder-600" /> Facility Map
          </h2>
          <p className="text-sm text-gray-500 max-w-2xl">
            The plant, with what ReadyDoc knows drawn on it. Click a room for its last clean, its 72-hour
            status, what&apos;s scheduled in it and the brittle-plastic zone that covers it.
          </p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 shrink-0">
          <Printer size={15} /> Print
        </button>
      </div>

      {needsClean > 0 && layers.status && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">{needsClean}</span> area{needsClean === 1 ? '' : 's'} shown in red
            need re-cleaning before next use.</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500 flex items-center gap-1 mr-1"><Layers size={13} /> Layers</span>
        {[
          ['status', 'Cleaning status', Droplets],
          ['fixtures', 'Sinks & extinguishers', Wrench],
          ['traps', 'Pest control', Bug],
          ['bpg', 'Brittle plastic & glass', FlaskConical],
        ].map(([k, label, Icon]) => (
          <button key={k} onClick={() => toggle(k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${layers[k] ? 'bg-powder-50 border-powder-300 text-powder-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
        <button onClick={() => setLayers({ fixtures: true, traps: true, bpg: false, status: false })}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
          Show all (paper view)
        </button>
      </div>

      <div className="border border-gray-200 rounded-xl bg-white p-3 overflow-x-auto relative">
        {compact && (
          <button onClick={() => setZoomed(z => !z)}
            className="absolute right-4 top-4 z-10 flex items-center gap-1 px-2.5 py-1.5 bg-white/95 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 shadow-sm">
            {zoomed ? <><Minimize2 size={12} /> Fit</> : <><Maximize2 size={12} /> Zoom</>}
          </button>
        )}
        <svg viewBox={`-6 -6 ${PLAN.width + 12} ${PLAN.height + 26}`}
          className={`w-full ${compact && !zoomed ? '' : 'min-w-[680px]'}`}
          role="img" aria-label="Facility floor plan">
          {/* building outline */}
          <rect x="0" y="0" width={PLAN.width} height={PLAN.height} fill="#fff" stroke="#334155" strokeWidth="2" />

          {ROOMS.map(r => {
            const c = fillFor(r);
            const active = selected === r.id;
            return (
              <g key={r.id} onClick={() => setSelected(active ? null : r.id)} style={{ cursor: 'pointer' }}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={c.fill}
                  stroke={active ? '#1d4ed8' : c.stroke} strokeWidth={active ? 2.4 : 0.9} rx="1.5" />
                {nameOf(r) && r.h >= 14 && (
                  <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 2.6} textAnchor="middle"
                    fontSize={r.w > 100 ? 8 : 6.2} fill={ROOM_KINDS[r.kind]?.text || '#111'}
                    style={{ pointerEvents: 'none' }}>
                    {nameOf(r).length > 22 && r.w < 120 ? `${nameOf(r).slice(0, 20)}…` : nameOf(r)}
                  </text>
                )}
              </g>
            );
          })}

          {/* dimensions from the drawing */}
          {SPANS.map((s, i) => (
            <text key={i} x={s.x} y={s.y} textAnchor="middle" fontSize="8" fill="#64748b" fontWeight="600">{s.label}</text>
          ))}

          {layers.fixtures && FIXTURES.map((f, i) => <Fixture key={i} f={f} />)}

          {layers.traps && TRAPS.map(t => (
            <g key={t.n}>
              <rect x={t.x - 5} y={t.y - 4} width="10" height="8" rx="1.5" fill="#1d4ed8" />
              <text x={t.x} y={t.y + 2.6} textAnchor="middle" fontSize="6" fill="#fff" fontWeight="700">{t.n}</text>
            </g>
          ))}
        </svg>
      </div>

      <Legend layers={layers} />

      {/* Directly under the map on every layout: tap a room, the answer is the
          next thing you see rather than something below two legend blocks. */}
      {selectedRoom && (
        <div ref={detailRef}>
          <DetailPanel room={selectedRoom} status={selectedRoom.room ? status[selectedRoom.room] : null}
            zone={ZONE_OF_ROOM[selectedRoom.id]} zoneInfo={zones[ZONE_OF_ROOM[selectedRoom.id]]}
            override={overrides[selectedRoom.id]} canEdit={canEdit} onSaved={refresh}
            onClose={() => setSelected(null)} />
        </div>
      )}

      {layers.traps && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          {TRAPS.length} of {TRAPS.length + TRAPS_UNPLACED.length} stations are placed.
          Stations <span className="font-semibold">{TRAPS_UNPLACED.join(', ')}</span> are on the paper map but
          their positions couldn&apos;t be read off it — check the drawing and they can be added.
        </p>
      )}

      {layers.bpg && (
        <div className="border border-gray-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">
            Brittle Plastic &amp; Glass zones (FORM 431-01) — {Object.keys(BPG_ZONE_AREAS).length} zones on the map
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {Object.keys(BPG_ZONE_AREAS).map(z => (
              <span key={z} className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
                <span className="w-3 h-3 rounded-sm border border-gray-400" style={{ background: zoneColour[z] }} />
                {z}
                {zones[z]?.item_count ? <span className="text-gray-400">({zones[z].item_count})</span> : null}
              </span>
            ))}
          </div>
          <button onClick={() => openModule('qa-inspections')}
            className="mt-2 flex items-center gap-1.5 text-xs text-powder-600 hover:underline">
            <ExternalLink size={12} /> Zone item lists are edited in QA Inspections
          </button>
        </div>
      )}

      <RoomList status={status} overrides={overrides} onPick={setSelected} />
    </div>
  );
}
