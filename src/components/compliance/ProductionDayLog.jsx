import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import {
  Plus, X, Sparkles, Package, RotateCcw, StickyNote, Trash2, Pencil,
  FileCheck2, Clock, AlertTriangle,
} from 'lucide-react';
import { PRODUCTION_TEAMS as TEAMS, CLEAN_SCOPE } from '../../constants/productionLines';

// The running day — what Bernardo was keeping in his phone.
//
// The entry form is one all-at-once submission, and a shift is not one moment.
// So he logged the day in Notes and re-typed a lossy summary here at 5pm. This
// is the missing half: add a line when the thing happens, walk away, come back
// to it, and build the report from what is already there.
//
// EVERY ADD SAVES IMMEDIATELY, SERVER-SIDE. Not localStorage: eight hours of a
// shift lost to a cleared browser or a swapped phone is exactly the failure
// that sends somebody back to the Notes app, and he may well log on the floor
// phone and finalise at a desk.
//
// A day log is NOT a production entry. It never appears in the log, never
// counts toward QA sign-off, never touches the KPIs. It becomes a record only
// when he presses Create EOD Report, reviews it, and submits.

const KINDS = [
  { kind: 'clean', label: 'Clean', icon: Sparkles, tone: 'text-sky-600 border-sky-200 bg-sky-50' },
  { kind: 'mo', label: 'MO run', icon: Package, tone: 'text-powder-600 border-powder-200 bg-powder-50' },
  { kind: 'adjustment', label: 'Adjustment', icon: RotateCcw, tone: 'text-amber-600 border-amber-200 bg-amber-50' },
  { kind: 'note', label: 'Note', icon: StickyNote, tone: 'text-gray-500 border-gray-200 bg-gray-50' },
];
const WORK_STAGES = ['Weighed', 'Sifted', 'Blended'];

// Logging happens as the work finishes, so "now" is nearly always the right
// end time. Pre-filling it is the single biggest saving over typing in Notes.
const now = () => new Date().toTimeString().slice(0, 5);
const today = () => new Date().toISOString().slice(0, 10);

// A new line starts in the day's room, because that is usually where he still
// is — but every line carries its own, because a shift is not one room.
const blankFor = (kind, room = '') => {
  if (kind === 'clean') return { level: 'Full Clean', scope: [], sifter_no: '', room, atp_swab: false, allergen_swab: false, start_time: '', end_time: now(), mo_number: '' };
  if (kind === 'note') return { note: '' };
  return { mo_number: '', lot_number: '', product_name: '', room, work_stages: [], portion: '', batches: '', batch_weights: '', quantity: '', start_time: '', end_time: now() };
};

const cls = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';
const Chip = ({ on, children, ...p }) => (
  <button type="button" {...p}
    className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${on ? 'border-powder-400 bg-powder-50 text-powder-800' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
    {children}
  </button>
);

/* ── Adding / editing one line ────────────────────────────────────────────── */

function ItemSheet({ kind, initial, moOptions, rooms = [], defaultRoom = '', onClose, onSave }) {
  const [d, setD] = useState(() => ({ ...blankFor(kind, defaultRoom), ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const meta = KINDS.find(k => k.kind === kind);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await onSave(d); } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-3 overflow-y-auto" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <meta.icon size={16} /> {initial ? `Edit ${meta.label.toLowerCase()}` : meta.label}
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {kind === 'note' && (
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">What happened</span>
              <textarea autoFocus required rows={3} value={d.note} onChange={e => set('note', e.target.value)}
                className={cls} placeholder="Sifter 160 jammed, cleared it — 10 min down" />
            </label>
          )}

          {kind === 'clean' && (<>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Level</span>
                <select value={d.level} onChange={e => set('level', e.target.value)} className={cls}>
                  <option>Full Clean</option><option>Partial Clean</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Sifter #</span>
                <input value={d.sifter_no} onChange={e => set('sifter_no', e.target.value)} className={cls} placeholder="160" />
              </label>
            </div>
            <div>
              <span className="block text-[11px] text-gray-600 mb-1">What was cleaned at this level</span>
              <div className="flex flex-wrap gap-1.5">
                {CLEAN_SCOPE.map(x => (
                  <Chip key={x} on={(d.scope || []).includes(x)}
                    onClick={() => set('scope', (d.scope || []).includes(x) ? d.scope.filter(y => y !== x) : [...(d.scope || []), x])}>
                    {x}
                  </Chip>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Add a second clean if the room and the equipment were done to different levels.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-gray-700">
                <input type="checkbox" checked={!!d.atp_swab} onChange={e => set('atp_swab', e.target.checked)} /> ATP swab
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-700">
                <input type="checkbox" checked={!!d.allergen_swab} onChange={e => set('allergen_swab', e.target.checked)} /> Allergen swab
              </label>
            </div>
          </>)}

          {(kind === 'mo' || kind === 'adjustment') && (<>
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Product</span>
              <input value={d.product_name} onChange={e => set('product_name', e.target.value)} className={cls}
                placeholder="PRO Whey Protein Iso Blend Peach Cobbler" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">MO #</span>
                <input autoFocus value={d.mo_number} onChange={e => set('mo_number', e.target.value)} className={cls} placeholder="MO76736" />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Lot #</span>
                <input value={d.lot_number} onChange={e => set('lot_number', e.target.value)} className={cls} placeholder="101692" />
              </label>
            </div>
            {kind === 'mo' && (
              <div>
                <span className="block text-[11px] text-gray-600 mb-1">Work done</span>
                <div className="flex flex-wrap gap-1.5">
                  {WORK_STAGES.map(w => (
                    <Chip key={w} on={(d.work_stages || []).includes(w)}
                      onClick={() => set('work_stages', (d.work_stages || []).includes(w) ? d.work_stages.filter(x => x !== w) : [...(d.work_stages || []), w])}>
                      {w}
                    </Chip>
                  ))}
                  <input value={d.portion} onChange={e => set('portion', e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded-lg text-xs w-28" placeholder="100% / 80% Left" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Batches</span>
                <input type="number" min="0" value={d.batches} onChange={e => set('batches', e.target.value)} className={cls} placeholder="1" />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">
                  Quantity {kind === 'adjustment' && <span className="text-gray-400">(not counted)</span>}
                </span>
                <input type="number" min="0" step="any" value={d.quantity} onChange={e => set('quantity', e.target.value)}
                  className={cls} disabled={kind === 'adjustment'} placeholder={kind === 'adjustment' ? 'rework' : '0'} />
              </label>
            </div>
            {kind === 'mo' && (
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Batch weights</span>
                <input value={d.batch_weights} onChange={e => set('batch_weights', e.target.value)} className={cls}
                  placeholder="No.1=343.4kg, No.2=344.4kg" />
              </label>
            )}
          </>)}

          {kind !== 'note' && rooms.length > 0 && (
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Main room</span>
              <select value={d.room || ''} onChange={e => set('room', e.target.value)} className={cls}>
                <option value="">Room not set</option>
                {rooms.map(r => <option key={r} value={r}>{r}</option>)}
                {d.room && !rooms.includes(d.room) && <option value={d.room}>{d.room}</option>}
              </select>
            </label>
          )}

          {kind !== 'note' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Started</span>
                <input type="time" value={d.start_time} onChange={e => set('start_time', e.target.value)} className={cls} />
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-600 mb-0.5">Finished</span>
                <input type="time" value={d.end_time} onChange={e => set('end_time', e.target.value)} className={cls} />
              </label>
            </div>
          )}

          {kind === 'clean' && moOptions?.length > 0 && (
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Was this for one MO?</span>
              <select value={d.mo_number} onChange={e => set('mo_number', e.target.value)} className={cls}>
                <option value="">No — for the shift</option>
                {moOptions.map(mo => <option key={mo} value={mo}>{mo}</option>)}
              </select>
            </label>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 safe-area-bottom">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : initial ? 'Save' : 'Add to the day'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── One logged line ──────────────────────────────────────────────────────── */

function ItemRow({ item, onEdit, onRemove }) {
  const meta = KINDS.find(k => k.kind === item.kind) || KINDS[3];
  const d = item.data || {};
  const window = (d.start_time || d.end_time) ? `${d.start_time || '?'}–${d.end_time || '?'}` : null;

  const body = item.kind === 'note' ? d.note
    : item.kind === 'clean'
      ? [d.level, d.room, d.scope?.join(', '), d.sifter_no && `Sifter ${d.sifter_no}`,
        [d.atp_swab && 'ATP', d.allergen_swab && 'Allergen'].filter(Boolean).join(' + ') || null,
        d.mo_number && `for ${d.mo_number}`].filter(Boolean).join(' · ')
      : [d.mo_number, d.room, d.lot_number && `Lot ${d.lot_number}`, d.product_name,
        d.work_stages?.length && `${d.work_stages.join(', ')}${d.portion ? ` ${d.portion}` : ''}`,
        d.batches && `${d.batches} batch${Number(d.batches) === 1 ? '' : 'es'}`,
        d.batch_weights].filter(Boolean).join(' · ');

  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className={`shrink-0 mt-0.5 p-1.5 rounded-lg border ${meta.tone}`}><meta.icon size={13} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 break-words">
          {item.kind === 'adjustment' && <span className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">ADJUSTMENT</span>}
          {body || <span className="text-gray-400">(empty)</span>}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {window && <span className="mr-2">{window}</span>}
          <span title="when it was written down">logged {(item.logged_at || '').slice(11, 16)}</span>
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={onEdit} className="p-1 text-gray-300 hover:text-powder-600" aria-label="Edit"><Pencil size={13} /></button>
        <button onClick={onRemove} className="p-1 text-gray-300 hover:text-red-600" aria-label="Remove"><Trash2 size={13} /></button>
      </div>
    </li>
  );
}

/* ── The day ──────────────────────────────────────────────────────────────── */

export default function ProductionDayLog({ teams = TEAMS, rooms = [], defaultTeam = 'Batching', onCreateReport }) {
  const { data: logs, refresh } = useApiGet('/production/day-log');
  const [adding, setAdding] = useState(null);   // kind
  const [editing, setEditing] = useState(null); // item
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState(defaultTeam);

  // The open log for today, if there is one. Older open logs are surfaced
  // separately — a shift left half-logged yesterday should be visible rather
  // than silently abandoned.
  const list = useMemo(() => logs || [], [logs]);
  const log = list.find(l => l.log_date === today()) || null;
  const earlier = list.filter(l => l.log_date !== today());

  const start = async () => {
    setBusy(true);
    try { await apiPost('/production/day-log', { team, date: today() }); refresh(); }
    catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };

  // The header saves on change/blur rather than behind a Save button — the
  // whole premise is that nothing here needs finishing before you walk away.
  const saveHeader = async (patch) => {
    try { await apiPut(`/production/day-log/${log.id}`, patch); refresh(); }
    catch (e) { window.alert(e.message); }
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); refresh(); setAdding(null); setEditing(null); }
    catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };

  const moOptions = useMemo(() => [...new Set((log?.items || [])
    .filter(i => i.kind === 'mo' || i.kind === 'adjustment')
    .map(i => i.data.mo_number).filter(Boolean))], [log]);

  const roomsUsed = useMemo(() => {
    const seen = [];
    for (const i of log?.items || []) if (i.data?.room && !seen.includes(i.data.room)) seen.push(i.data.room);
    return seen;
  }, [log]);
  // A new line starts wherever the last one was — most work continues in the
  // same room, and there is no shift-level room to inherit.
  const lastRoom = useMemo(
    () => [...(log?.items || [])].reverse().map(i => i.data?.room).find(Boolean) || '',
    [log]);

  if (!log) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
          <Clock size={26} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-700 font-medium">Nothing logged for today yet.</p>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Start the day and add each clean, MO and adjustment as it happens. It saves as you go — close
            the app, come back later, it&apos;s still here. At the end, turn it into the EOD report.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <select value={team} onChange={e => setTeam(e.target.value)}
              className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={start} disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
              <Plus size={15} /> Start today&apos;s log
            </button>
          </div>
        </div>
        {earlier.length > 0 && <EarlierLogs logs={earlier} onOpen={onCreateReport} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {earlier.length > 0 && <EarlierLogs logs={earlier} onOpen={onCreateReport} />}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-gray-900">Today — {log.log_date}</h3>
          <p className="text-xs text-gray-500">
            {log.items.length} line{log.items.length === 1 ? '' : 's'} logged · saves as you go
          </p>
        </div>
        <button onClick={() => onCreateReport(log)} disabled={!log.items.length}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-40 shrink-0">
          <FileCheck2 size={15} /> Create EOD Report
        </button>
      </div>

      {/* The two shift facts the logged lines can't imply. Set once in the
          morning, or left for the review screen — either is fine, which is why
          nothing here is required. */}
      {/* Headcount is genuinely a shift fact. The room is not — it belongs to
          each line, so it is set there and only summarised here. */}
      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-gray-200 p-3">
        <label className="block">
          <span className="block text-[11px] text-gray-600 mb-0.5">People on shift</span>
          <input type="number" min="1" defaultValue={log.people_count ?? ''}
            onBlur={e => saveHeader({ people_count: e.target.value })}
            className="w-24 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="—" />
        </label>
        <div className="pb-1.5">
          <span className="block text-[11px] text-gray-600 mb-0.5">Rooms so far</span>
          <span className="text-sm text-gray-800">
            {roomsUsed.length ? roomsUsed.join(', ') : <span className="text-gray-400">set on each line</span>}
          </span>
        </div>
        <span className="text-[11px] text-gray-400 pb-2 ml-auto">{log.team}</span>
      </div>

      {/* The add buttons stay at the top so they're reachable without scrolling
          past a long day. */}
      <div className="flex flex-wrap gap-2">
        {KINDS.map(k => (
          <button key={k.kind} onClick={() => setAdding(k.kind)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium ${k.tone} hover:brightness-95`}>
            <k.icon size={15} /> {k.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {log.items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-gray-400">
            Nothing yet. Add the first clean or MO above.
          </p>
        ) : (
          <ul>
            {log.items.map(item => (
              <ItemRow key={item.id} item={item}
                onEdit={() => setEditing(item)}
                onRemove={() => { if (window.confirm('Remove this line from the day?')) act(() => apiDelete(`/production/day-log/items/${item.id}`)); }} />
            ))}
          </ul>
        )}
      </div>

      {log.items.length > 0 && (
        <p className="text-[11px] text-gray-400">
          This is a working note, not a filed record — nothing here counts until you create the report and
          submit it.
        </p>
      )}

      {adding && (
        <ItemSheet kind={adding} moOptions={moOptions} rooms={rooms} defaultRoom={lastRoom}
          onClose={() => setAdding(null)}
          onSave={(data) => act(() => apiPost(`/production/day-log/${log.id}/items`, { kind: adding, data }))} />
      )}
      {editing && (
        <ItemSheet kind={editing.kind} initial={editing.data} moOptions={moOptions} rooms={rooms}
          defaultRoom={lastRoom} onClose={() => setEditing(null)}
          onSave={(data) => act(() => apiPut(`/production/day-log/items/${editing.id}`, { data }))} />
      )}
    </div>
  );
}

// A day left open from before. Named rather than hidden: an unfinished shift is
// either a report nobody filed or a log somebody meant to discard, and both
// need a person to decide.
function EarlierLogs({ logs, onOpen }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
        <AlertTriangle size={14} /> {logs.length} earlier day{logs.length === 1 ? '' : 's'} still open
      </p>
      <ul className="mt-1.5 space-y-1">
        {logs.map(l => (
          <li key={l.id} className="flex items-center justify-between gap-3 text-xs text-amber-900">
            <span>{l.log_date} · {l.items.length} line{l.items.length === 1 ? '' : 's'}</span>
            <button onClick={() => onOpen(l)} className="underline shrink-0">Finish it</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
