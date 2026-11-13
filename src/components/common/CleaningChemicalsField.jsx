import { useApiGet } from '../../hooks/useApi';
import { FlaskConical, X } from 'lucide-react';
import { chemicalAnswered } from '../../lib/cleaningChemicals.js';

/**
 * WHICH CHEMICAL WAS USED ON THIS CLEAN (D-349) — one box, both completion
 * screens (Operator View and Task Center). The server says which tasks owe it
 * (`task.chemical_plan`) and refuses the completion without an answer; this
 * only asks.
 *
 * value: { ids: [], other: '', none: false }
 */
const L = {
  en: {
    heading: 'Chemical used', pick: 'Pick a chemical…', another: 'Add another chemical…',
    other: 'Other (not on the list)', otherPh: 'Chemical name', none: 'No chemical used',
    where: 'Approved for', food: 'Food grade', need: 'Pick the chemical you used — or "No chemical used".',
  },
  es: {
    heading: 'Químico usado', pick: 'Elija un químico…', another: 'Agregar otro químico…',
    other: 'Otro (no está en la lista)', otherPh: 'Nombre del químico', none: 'No se usó químico',
    where: 'Aprobado para', food: 'Grado alimenticio', need: 'Elija el químico que usó — o "No se usó químico".',
  },
};


export default function CleaningChemicalsField({ plan, value, onChange, lang = 'en' }) {
  const t = L[lang] || L.en;
  const { data } = useApiGet('/pm/cleaning-chemicals');
  const options = data || [];
  const v = value || { ids: [], other: '', none: false };
  const ids = v.ids || [];
  const picked = ids.map(id => options.find(o => o.id === id)).filter(Boolean);
  const showOther = !!v.showOther;
  const other = v.other || '';
  const set = (patch) => onChange({ ...v, ...patch });

  return (
    <div data-chemical-block data-chemical-area={plan?.area}>
      <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1 mb-1">
        <FlaskConical size={12} /> {t.heading}{plan?.area ? ` — ${plan.area}` : ''}
      </h4>
      {!v.none && (
        <>
          {picked.length > 0 && (
            <div className="space-y-1 mb-2" data-chemical-picked>
              {picked.map(c => (
                <div key={c.id} className="flex items-start gap-2 bg-white border border-green-200 rounded-lg px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{c.name}</p>
                    {c.location_for_use && <p className="text-[11px] text-gray-500">{t.where}: {c.location_for_use}</p>}
                  </div>
                  <button type="button" aria-label="Remove" onClick={() => set({ ids: ids.filter(i => i !== c.id) })}
                    className="text-gray-400 hover:text-red-600 p-1"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <select value="" data-chemical-select
            onChange={e => {
              const id = e.target.value;
              if (id === '__other') set({ showOther: true });
              else if (id && !ids.includes(id)) set({ ids: [...ids, id] });
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">{picked.length ? t.another : t.pick}</option>
            {options.filter(o => !ids.includes(o.id)).map(o => (
              <option key={o.id} value={o.id}>{o.name}{o.is_food_grade ? ` (${t.food})` : ''}</option>
            ))}
            <option value="__other">{t.other}</option>
          </select>
          {(showOther || other) && (
            <input value={other} onChange={e => set({ other: e.target.value, showOther: true })} data-chemical-other
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={t.otherPh} />
          )}
        </>
      )}
      <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={!!v.none} data-chemical-none
          onChange={e => onChange(e.target.checked ? { ids: [], other: '', none: true } : { ids: [], other: '', none: false })} />
        {t.none}
      </label>
      {!chemicalAnswered(v) && <p className="text-[11px] text-amber-800 mt-1">{t.need}</p>}
    </div>
  );
}
