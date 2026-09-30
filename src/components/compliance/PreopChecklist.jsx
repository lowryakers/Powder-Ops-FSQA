// FORM 117.21 V5 on a production pre-op clean (D-125, shared/preop-form.js).
//
// `PreopFields` is the section of the Sanitation record form; `PreopAnswers`
// is the same section read back on the record. Both iterate the ONE list in
// shared/, so the record reads the questions the form asked.
//
// Three of the paper boxes are the record's own fields and are not asked twice:
// Room number is the Area, "Did the cleaning Pass?" is the Result, and ATP
// swab 1's result is the graded reading — so that input lives HERE, inside the
// ATP section, and the form does not render its general ATP box as well.

import AtpLimitHint from '../common/AtpLimitHint.jsx';
import {
  PREOP_FORM, PREOP_SETUP, PREOP_ALLERGENS, PREOP_CLEAN_LEVELS, PREOP_CHECKS,
  YES_NO_NA, CONDITIONS, SWAB_RESULTS,
} from '../../../shared/preop-form.js';

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
const label = 'block text-xs font-medium text-gray-700 mb-1';

function Segmented({ options, value, onChange, name }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden shrink-0" role="radiogroup" aria-label={name}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          onClick={() => onChange(value === o.value ? '' : o.value)}
          className={`px-3 py-1.5 text-xs font-medium border-l first:border-l-0 border-gray-300 ${value === o.value
            ? 'bg-powder-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Heading({ children }) {
  return <p className="text-xs font-semibold text-gray-800 uppercase tracking-wide pt-1">{children}</p>;
}

export function PreopFields({ value, onChange, atpReading, onAtpReading }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setLine = (key, i, patch) => set({ [key]: value[key].map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const toggleAllergen = (a) => set({
    allergens: value.allergens.includes(a) ? value.allergens.filter(x => x !== a) : [...value.allergens, a],
  });

  return (
    <fieldset className="border border-blue-200 bg-blue-50/40 rounded-xl p-3 space-y-3" data-preop-form>
      <legend className="px-1 text-sm font-semibold text-blue-900">
        {PREOP_FORM.code} {PREOP_FORM.revision} — {PREOP_FORM.title}
      </legend>
      <p className="text-[11px] text-gray-600 -mt-1">
        Room number is the Area above; “Did the cleaning Pass?” is the Result. Nothing here is required —
        a blank is recorded as not answered. A swab over the limit, or an allergen swab marked No pass,
        stores the clean as a fail.
      </p>

      <Heading>Setup</Heading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PREOP_SETUP.map(f => (
          <div key={f.key}>
            <label className={label} htmlFor={`preop-${f.key}`}>{f.label}</label>
            <input id={`preop-${f.key}`} value={value[f.key]} onChange={e => set({ [f.key]: e.target.value })} className={input} />
          </div>
        ))}
      </div>
      <div>
        <span className={label}>Allergens present</span>
        <div className="flex flex-wrap gap-1.5">
          {PREOP_ALLERGENS.map(a => (
            <label key={a} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs cursor-pointer ${value.allergens.includes(a)
              ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-700'}`}>
              <input type="checkbox" className="sr-only" checked={value.allergens.includes(a)} onChange={() => toggleAllergen(a)} />
              {a}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-700">Partial clean #1 or Full clean #2?</span>
        <Segmented name="clean level" options={PREOP_CLEAN_LEVELS} value={value.clean_level} onChange={v => set({ clean_level: v })} />
      </div>

      <Heading>Cleaning Verification</Heading>
      <div className="space-y-2">
        {PREOP_CHECKS.map(c => (
          <div key={c.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 justify-between" data-preop-check={c.key}>
            <span className="text-sm text-gray-800">{c.label}</span>
            <Segmented name={c.label} options={YES_NO_NA} value={value.checks[c.key]}
              onChange={v => set({ checks: { ...value.checks, [c.key]: v } })} />
          </div>
        ))}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className={label} htmlFor="preop-asset">Machine Asset tag #</label>
            <input id="preop-asset" value={value.asset_tag} onChange={e => set({ asset_tag: e.target.value })} className={input} />
          </div>
          <div>
            <span className={label}>Condition (Good/Poor)</span>
            <Segmented name="condition" options={CONDITIONS.map(c => ({ value: c, label: c }))}
              value={value.condition} onChange={v => set({ condition: v })} />
          </div>
        </div>
      </div>

      <Heading>ATP Test</Heading>
      <div className="space-y-2">
        {value.atp.map((l, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start" data-preop-atp={i + 1}>
            <input aria-label={`ATP Test — Location ${i + 1}`} placeholder={`Location ${i + 1}`} value={l.location}
              onChange={e => setLine('atp', i, { location: e.target.value })} className={input} />
            <input aria-label={`ATP Test — Swab Number ${i + 1}`} placeholder={`Swab # ${i + 1}`} value={l.swab_no}
              onChange={e => setLine('atp', i, { swab_no: e.target.value })} className={input} />
            <div>
              <input type="number" step="0.1" aria-label={`ATP Test — Reading ${i + 1} (RLU)`} placeholder="Reading (RLU)"
                value={i === 0 ? atpReading : l.reading}
                onChange={e => (i === 0 ? onAtpReading(e.target.value) : setLine('atp', i, { reading: e.target.value }))}
                className={input} data-preop-atp-reading={i + 1} />
              <AtpLimitHint value={i === 0 ? atpReading : l.reading} />
            </div>
          </div>
        ))}
      </div>

      <Heading>Allergen Test</Heading>
      <div className="space-y-2">
        {value.allergen.map((l, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center" data-preop-allergen={i + 1}>
            <input aria-label={`Allergen Test — Location ${i + 1}`} placeholder={`Location ${i + 1}`} value={l.location}
              onChange={e => setLine('allergen', i, { location: e.target.value })} className={input} />
            <input aria-label={`Allergen Test — Swab Number ${i + 1}`} placeholder={`Swab # ${i + 1}`} value={l.swab_no}
              onChange={e => setLine('allergen', i, { swab_no: e.target.value })} className={input} />
            <Segmented name={`Allergen Test — Result ${i + 1}`} options={SWAB_RESULTS} value={l.result}
              onChange={v => setLine('allergen', i, { result: v })} />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

const optLabel = (opts, v) => opts.find(o => o.value === v)?.label || v;
const shown = (v) => (v == null || v === '' ? <span className="text-gray-400">—</span> : v);

export function PreopAnswers({ form, atpReading }) {
  if (!form) return null;
  return (
    <div className="bg-white rounded-lg border border-blue-200 p-3 space-y-3" data-preop-answers>
      <p className="text-xs font-semibold text-blue-900">
        {PREOP_FORM.code} {form.revision || PREOP_FORM.revision} — {PREOP_FORM.title}
      </p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {PREOP_SETUP.map(f => (
          <div key={f.key} className="flex gap-2"><dt className="text-gray-500">{f.label}:</dt><dd className="text-gray-900">{shown(form[f.key])}</dd></div>
        ))}
        <div className="flex gap-2"><dt className="text-gray-500">Allergens present:</dt><dd className="text-gray-900">{shown((form.allergens || []).join(', '))}</dd></div>
        <div className="flex gap-2"><dt className="text-gray-500">Clean:</dt><dd className="text-gray-900">{shown(optLabel(PREOP_CLEAN_LEVELS, form.clean_level))}</dd></div>
      </dl>
      <ul className="text-sm divide-y divide-gray-100">
        {PREOP_CHECKS.map(c => (
          <li key={c.key} className="flex justify-between gap-3 py-1">
            <span className="text-gray-700">{c.label}</span>
            <span className={`font-medium shrink-0 ${form.checks?.[c.key] === 'no' ? 'text-red-700' : 'text-gray-900'}`}>
              {shown(optLabel(YES_NO_NA, form.checks?.[c.key]))}
            </span>
          </li>
        ))}
        <li className="flex justify-between gap-3 py-1">
          <span className="text-gray-700">Machine Asset tag # and Condition</span>
          <span className="font-medium text-gray-900 shrink-0">{shown([form.asset_tag, form.condition].filter(Boolean).join(' · '))}</span>
        </li>
      </ul>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">ATP Test</p>
          {(form.atp || []).map((l, i) => (
            <p key={i} className="text-gray-800">
              {i + 1}. {shown(l.location)} · swab {shown(l.swab_no)} · {shown(i === 0 ? atpReading : l.reading)} RLU
            </p>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Allergen Test</p>
          {(form.allergen || []).map((l, i) => (
            <p key={i} className={l.result === 'no_pass' ? 'text-red-700 font-medium' : 'text-gray-800'}>
              {i + 1}. {shown(l.location)} · swab {shown(l.swab_no)} · {shown(optLabel(SWAB_RESULTS, l.result))}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
