import { CalendarHeart } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

// "Coming up" — the paid holidays in the next few weeks and what each does to
// the production week (D-175). The words come from the server, which builds
// them from shared/plant-holidays.js — the same text the Notify message and
// the announcement print — so this strip holds no holiday rules of its own.
// Renders nothing when nothing is coming up: an empty card is wallpaper.
export default function PlantHolidaysStrip({ days = 60, lang = 'en', className = '' }) {
  const { data } = useApiGet(`/plant-calendar/upcoming?days=${days}`, [days]);
  const weeks = data?.weeks || [];
  if (!weeks.length) return null;
  const es = lang === 'es';
  return (
    <section data-holidays-strip className={`rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 ${className}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
        <CalendarHeart size={16} className="shrink-0" />
        {es ? 'Días festivos pagados próximos' : 'Paid holidays coming up'}
      </div>
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
    </section>
  );
}
