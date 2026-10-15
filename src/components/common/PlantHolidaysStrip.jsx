import { useState } from 'react';
import { CalendarHeart, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

// "Coming up" — the paid holidays in the next few weeks and what each does to
// the production week (D-175). The words come from the server, which builds
// them from shared/plant-holidays.js — the same text the Notify message and
// the announcement print — so this strip holds no holiday rules of its own.
//
// THE CARD IS THE WAY INTO THE FULL LIST (D-176): clicking it opens every paid
// holiday the plant observes, by year. On the Operator View it renders nothing
// when nothing is coming up (an empty card is wallpaper); on the schedule
// (`alwaysShow`) it shrinks to one line naming the next holiday, so the list
// stays reachable in the long gap between New Year's Day and Memorial Day.
export default function PlantHolidaysStrip({ days = 60, lang = 'en', className = '', alwaysShow = false }) {
  const { data } = useApiGet(`/plant-calendar/upcoming?days=${days}`, [days]);
  const [open, setOpen] = useState(false);
  const weeks = data?.weeks || [];
  const es = lang === 'es';
  if (!weeks.length && !(alwaysShow && data?.next)) return null;
  const openList = () => setOpen(true);
  return (
    <>
      <section
        data-holidays-strip role="button" tabIndex={0}
        onClick={openList}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(); } }}
        title={es ? 'Ver todos los días festivos pagados' : 'See every paid holiday we observe'}
        className={`cursor-pointer rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 transition-colors hover:bg-rose-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${className}`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
          <CalendarHeart size={16} className="shrink-0" />
          <span className="flex-1">{weeks.length
            ? (es ? 'Días festivos pagados próximos' : 'Paid holidays coming up')
            : (es ? 'Próximo día festivo pagado' : 'Next paid holiday')}</span>
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-700">
            {es ? 'Ver todos' : 'See all'} <ChevronRight size={14} />
          </span>
        </div>
        {weeks.length ? (
          <ul className="mt-2 space-y-2">
            {weeks.map(w => (
              <li key={w.week_start} data-holiday-week={w.week_start} className="text-sm text-rose-950">
                {w.this_week && (
                  <span className="mr-1.5 inline-block rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {es ? 'Esta semana' : 'This week'}
                  </span>
                )}
                {(es ? w.summary_es : w.summary).map((line, i) => (
                  // The holiday lines come first; what follows is the effect on
                  // production, which is the part people plan around.
                  <div key={i} className={i >= w.holidays.length ? 'font-semibold' : ''}>{line}</div>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p data-holiday-next className="mt-1 text-sm text-rose-950">
            {es ? data.next.name_es : data.next.name} — {fmtDate(data.next.date, es)}
          </p>
        )}
      </section>
      {open && <HolidayList es={es} onClose={() => setOpen(false)} />}
    </>
  );
}

function fmtDate(d, es) {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString(es ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

// Every paid holiday the plant observes in one year, with the date it is
// observed on. Read from the same calendar the grid and the reminders use.
function HolidayList({ es, onClose }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data } = useApiGet(`/plant-calendar?year=${year}`, [year]);
  const rows = (data?.holidays || []).filter(h => !h.cancelled);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div data-holiday-list role="dialog" aria-modal="true" aria-label={es ? 'Días festivos pagados' : 'Paid holidays'}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{es ? 'Días festivos pagados' : 'Paid holidays we observe'}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100" aria-label={es ? 'Cerrar' : 'Close'}>
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label={es ? 'Año anterior' : 'Previous year'}><ChevronLeft size={18} /></button>
          <span data-holiday-list-year className="text-lg font-semibold tabular-nums">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label={es ? 'Año siguiente' : 'Next year'}><ChevronRight size={18} /></button>
        </div>
        <ul className="mt-2 divide-y divide-gray-100">
          {rows.map(h => (
            <li key={h.key} data-holiday-item={h.key} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{es ? h.name_es : h.name}</div>
                {h.moved && (
                  <div className="text-xs text-gray-500">
                    {es ? `Cae en ${fmtDate(h.natural_date, es)}; se observa este día` : `Falls on ${fmtDate(h.natural_date, es)}; observed this day`}
                  </div>
                )}
                {h.shift_week && (
                  <div className="text-xs font-medium text-emerald-700">
                    {es ? 'Producción de martes a viernes esa semana' : 'Production runs Tuesday–Friday that week'}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right tabular-nums text-gray-700">{fmtDate(h.date, es)}</div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          {es
            ? `Cada día festivo pagado cuenta ${data?.holiday_hours ?? 8} horas. Un día festivo en fin de semana se observa el viernes anterior.`
            : `Each paid holiday counts as ${data?.holiday_hours ?? 8} hours. A holiday on a weekend is observed the Friday before.`}
        </p>
      </div>
    </div>
  );
}
