import { CalendarDays } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

// Today's runs for one team, on the Operator View (D-298). Deliberately small:
// room, MO, product, start time, and the allergen / gown line when the MO has one.
// The team comes from the screen's department; anything that is not a production
// team shows nothing.
const TEAM_OF = { batching: 'Batching', filling: 'Filling', kitting: 'Kitting' };
const fmt = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return '';
  const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};
export default function TodaySchedule({ department, lang = 'en' }) {
  const team = TEAM_OF[String(department || '').toLowerCase()];
  const { data } = useApiGet(team ? `/production/schedule/today?team=${team}` : null, [team]);
  if (!team || !data || data.weekend) return null;
  const es = lang === 'es';
  const runs = data.runs || [];
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-3" data-today-schedule>
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-1.5">
        <CalendarDays size={15} className="text-powder-600" />
        {es ? `Hoy — ${team}` : `Today — ${team}`}
      </div>
      {data.holiday && <p className="text-sm text-rose-700">{data.holiday.name} — {es ? 'planta cerrada' : 'plant closed'}</p>}
      {!data.holiday && runs.length === 0 && (
        <p className="text-sm text-gray-500" data-today-empty>{es ? 'Nada programado hoy.' : 'Nothing scheduled today.'}</p>
      )}
      <ul className="divide-y divide-gray-100">
        {runs.map(r => (
          <li key={r.id} className="py-1.5 text-sm" data-today-run>
            <div className="text-gray-900">
              <span className="font-semibold">{r.room_label}</span>
              {[r.mo_number && `MO ${r.mo_number}`, r.product_name, fmt(r.start_time)].filter(Boolean).map((x, i) => <span key={i}> · {x}</span>)}
            </div>
            {r.allergen_line && <div className="text-xs font-medium text-amber-800" data-today-allergen>⚠ {r.allergen_line}</div>}
            {r.notes && <div className="text-xs text-gray-500">{r.notes}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
