import { useMemo } from 'react';
import { CheckCircle2, Circle, Factory, Clock } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// The "what's done / what's left" companion to the schedule grid. Pairs every
// scheduled line for the week with its end-of-day report (if one exists), so
// the schedule can be edited without bouncing to the Production Log.
export default function ScheduleProgressPanel({ monday, assignmentMap, entryFor, entries, onOpenLog }) {
  const days = useMemo(() => {
    return DAYS.map((label, dayIndex) => {
      const lines = [];
      for (const key of Object.keys(assignmentMap)) {
        const [d, ...roomParts] = key.split('-');
        if (Number(d) !== dayIndex) continue;
        const room = roomParts.join('-');
        for (const a of assignmentMap[key]) {
          if (!a.team && !a.mo_number && !a.product_name) continue;
          lines.push({ room, a, entry: entryFor(dayIndex, room, a) });
        }
      }
      lines.sort((x, y) => x.room.localeCompare(y.room));
      return { label, dayIndex, lines };
    });
  }, [assignmentMap, entryFor]);

  const total = days.reduce((n, d) => n + d.lines.length, 0);
  const done = days.reduce((n, d) => n + d.lines.filter(l => l.entry).length, 0);
  // Reports with no matching scheduled line — unplanned runs worth seeing.
  const scheduledEntryIds = new Set(days.flatMap(d => d.lines.map(l => l.entry?.id).filter(Boolean)));
  const unplanned = (entries || []).filter(e => !scheduledEntryIds.has(e.id));

  const todayIndex = (() => {
    const start = new Date(monday); start.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date().setHours(0, 0, 0, 0) - start.getTime()) / 86400000);
    return diff >= 0 && diff <= 4 ? diff : -1;
  })();

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Factory size={15} className="text-powder-600" /> This week's progress
          </h3>
          <button onClick={onOpenLog} className="text-[11px] font-medium text-powder-700 hover:underline">Open Production Log</button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: total ? `${Math.round((done / total) * 100)}%` : '0%' }} />
          </div>
          <span className="text-[11px] font-semibold text-gray-600 shrink-0">{done} of {total} reported</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[70vh] divide-y divide-gray-100">
        {days.map(({ label, dayIndex, lines }) => (
          <div key={label} className={dayIndex === todayIndex ? 'bg-amber-50/40' : ''}>
            <div className="px-4 py-1.5 flex items-center justify-between sticky top-0 bg-inherit backdrop-blur-sm">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                {label}{dayIndex === todayIndex ? ' · today' : ''}
              </span>
              {lines.length > 0 && (
                <span className="text-[10px] text-gray-400">{lines.filter(l => l.entry).length}/{lines.length}</span>
              )}
            </div>
            {lines.length === 0 && <p className="px-4 pb-2 text-[11px] text-gray-400">Nothing scheduled.</p>}
            {lines.map(({ room, a, entry }, i) => (
              <div key={`${room}-${i}`} className="px-4 py-1.5 flex items-start gap-2">
                {entry
                  ? <CheckCircle2 size={14} className="text-green-600 mt-0.5 shrink-0" />
                  : <Circle size={14} className="text-gray-300 mt-0.5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className={`text-xs leading-snug ${entry ? 'text-gray-800' : 'text-gray-500'}`}>
                    <span className="font-medium">{a.mo_number || a.product_name || a.team}</span>
                    {a.product_name && a.mo_number ? ` — ${a.product_name}` : ''}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {room}{a.team ? ` · ${a.team}` : ''}
                    {entry?.quantity_produced ? ` · ${entry.quantity_produced} produced` : ''}
                    {entry && !entry.qa_signoff_by ? ' · awaiting QA' : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}

        {unplanned.length > 0 && (
          <div>
            <div className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50">
              Reported but not scheduled
            </div>
            {unplanned.map(e => (
              <div key={e.id} className="px-4 py-1.5 flex items-start gap-2">
                <Clock size={14} className="text-amber-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-gray-800 leading-snug font-medium">{e.mo_number || e.product_name || 'Run'}</p>
                  <p className="text-[10px] text-gray-400">{e.date} · {e.room}{e.team ? ` · ${e.team}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
