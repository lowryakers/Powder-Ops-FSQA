import { useState, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import { MAJOR_ALLERGENS, GOWN_TEAMS, stepFlags } from '../../../shared/schedule-allergens.js';

// A dropdown that lets several options be ticked. Drawn inline (not as a
// floating menu) because it lives inside a scrolling modal, which would clip it.
function MultiPick({ options, value, onChange, disabled, placeholder, testId }) {
  const [open, setOpen] = useState(false);
  const toggle = (o) => onChange(value.includes(o) ? value.filter(v => v !== o) : options.filter(x => value.includes(x) || x === o));
  return (
    <div className="flex-1 min-w-0" data-multipick={testId}>
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 text-left"
        data-multipick-toggle={testId} aria-expanded={open}>
        <span className="truncate">{value.length ? value.join(', ') : placeholder}</span>
        <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !disabled && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-white p-1.5 grid grid-cols-2 gap-x-2 gap-y-1" data-multipick-list={testId}>
          {options.map(o => (
            <label key={o} className="flex items-center gap-1.5 text-xs text-gray-700 px-1 py-0.5 rounded hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" checked={value.includes(o)} onChange={() => toggle(o)}
                data-multipick-option={o} />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The two boxes on the schedule cell editor (D-296). The answer belongs to the
 * MO, so it is disabled until the cell names one, and it says it applies to
 * every step of that MO.
 */
export function MoAllergenFields({ moNumber, value, onChange }) {
  const hasMo = !!String(moNumber || '').trim();
  const allergenOn = value.allergenOn;
  const gownOn = value.gownOn;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2" data-mo-allergen-fields>
      <div className="flex items-start gap-2">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-700 w-36 shrink-0 pt-2">
          <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" disabled={!hasMo} checked={allergenOn}
            onChange={e => onChange({ ...value, allergenOn: e.target.checked, allergens: e.target.checked ? value.allergens : [] })}
            data-mo-allergen-on />
          Contains an allergen
        </label>
        <MultiPick options={MAJOR_ALLERGENS} value={value.allergens} disabled={!hasMo || !allergenOn}
          onChange={allergens => onChange({ ...value, allergens })} placeholder="Choose allergens…" testId="allergens" />
      </div>
      <div className="flex items-start gap-2">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-700 w-36 shrink-0 pt-2">
          <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" disabled={!hasMo} checked={gownOn}
            onChange={e => onChange({ ...value, gownOn: e.target.checked, gown_teams: e.target.checked ? value.gown_teams : [] })}
            data-mo-gown-on />
          Disposable gown
        </label>
        <MultiPick options={GOWN_TEAMS} value={value.gown_teams} disabled={!hasMo || !gownOn}
          onChange={gown_teams => onChange({ ...value, gown_teams })} placeholder="Choose teams…" testId="gown" />
      </div>
      <p className="text-[11px] text-gray-500" data-mo-allergen-note>
        {hasMo
          ? `Applies to every step of MO ${String(moNumber).trim()} — Batching, Filling and Kitting all see the same answer.`
          : 'Enter the MO # first — the allergen belongs to the MO, so every step of it shows the same answer.'}
      </p>
    </div>
  );
}


/**
 * What one team's step is told: "Allergen: Milk · Disposable gown: YES".
 * Renders nothing when the MO carries nothing.
 */
export function MoAllergenChip({ rec, team, size = 'sm' }) {
  const f = stepFlags(rec, team);
  if (!f) return null;
  const big = size === 'lg';
  return (
    <div className={`rounded border border-amber-300 bg-amber-50 text-amber-900 ${big ? 'px-3 py-2 text-sm' : 'px-1 py-px text-[10px]'} leading-snug`}
      data-mo-allergen-chip data-gown={f.gown ? 'yes' : 'no'}>
      <span className="inline-flex items-center gap-1 font-semibold"><AlertTriangle size={big ? 14 : 9} className="shrink-0" />
        Allergen: {f.allergens.length ? f.allergens.join(', ') : 'none'}</span>
      <span className={big ? ' ml-2' : ' block'}>Disposable gown: <span className={`font-semibold ${f.gown ? 'text-red-700' : ''}`}>{f.gown ? 'YES' : 'NO'}</span></span>
    </div>
  );
}

/**
 * The same line on the end-of-day form: looks up the MO as it is typed and
 * shows what THIS team's step was told (D-296). Shows nothing for an MO with
 * no allergen record. Display only — it gates nothing.
 */
export function MoAllergenLookup({ mo, team }) {
  // Kept with the MO it answers, so a stale answer is never drawn under a new MO.
  const [found, setFound] = useState({ key: '', rec: null });
  const key = String(mo || '').trim();
  useEffect(() => {
    if (!key) return undefined;
    const t = setTimeout(() => {
      apiFetch(`/production/mo-allergens?mo=${encodeURIComponent(key)}`)
        .then(rec => setFound({ key, rec })).catch(() => setFound({ key, rec: null }));
    }, 400);
    return () => clearTimeout(t);
  }, [key]);
  if (!key || found.key !== key) return null;
  return <div className="mt-1" data-mo-allergen-lookup><MoAllergenChip rec={found.rec} team={team} size="lg" /></div>;
}
