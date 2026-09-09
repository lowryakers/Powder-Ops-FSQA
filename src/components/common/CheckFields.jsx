// The fields a check that files a record asks for (D-060), rendered from the
// server's `check_form` and validated with the SAME `missingForCheck` the
// server refuses with — so neither completion form can offer a completion
// the server then rejects. Rendered by the Operator View (phone, EN/ES) and
// the Task Center's CompleteForm; a third copy is how the two screens start
// asking different questions about one check.
import { useState } from 'react';
import { missingForCheck, GMP_WALK_ANSWERS } from '../../../shared/check-forms.js';

const S = {
  sites_h: { en: 'Sites sampled', es: 'Sitios muestreados' },
  sites_hint: { en: 'Tick every site you swabbed. The lab result is entered later, on the record.', es: 'Marque cada sitio que muestreó. El resultado del laboratorio se registra después, en el registro.' },
  add_site: { en: 'Add another site…', es: 'Agregar otro sitio…' },
  add: { en: 'Add', es: 'Agregar' },
  lab: { en: 'Laboratory (optional)', es: 'Laboratorio (opcional)' },
  tests: { en: 'Each site is tested for', es: 'Cada sitio se analiza para' },
  walk_h: { en: 'GMP walk-through', es: 'Recorrido GMP' },
  area: { en: 'Area walked', es: 'Área recorrida' },
  c: { en: 'Compliant', es: 'Cumple' }, nc: { en: 'Not compliant', es: 'No cumple' }, na: { en: 'N/A', es: 'N/A' },
  seen: { en: 'What was seen', es: 'Qué se observó' },
  draft: { en: 'Draft checklist — not yet issued by Document Control', es: 'Lista borrador — aún no emitida por Control de Documentos' },
  review_h: { en: 'List review', es: 'Revisión de listas' },
  edition: { en: 'Edition or date reviewed', es: 'Edición o fecha revisada' },
  changes: { en: 'Changes found since the last review (write "none" if none)', es: 'Cambios encontrados desde la última revisión (escriba "ninguno" si no hay)' },
  actions: { en: 'Actions taken (write "none" if none)', es: 'Acciones tomadas (escriba "ninguna" si no hay)' },
  rechecked: { en: 'Approved materials list and active formulas re-checked against the changes', es: 'Lista de materiales aprobados y fórmulas activas verificadas contra los cambios' },
  still: { en: 'Still needed', es: 'Falta' },
  pull_h: { en: 'Stability pull', es: 'Muestra de estabilidad' },
  quantity: { en: 'What was pulled (quantity / container)', es: 'Qué se tomó (cantidad / envase)' },
  sent_on: { en: 'Sent to the laboratory on (optional)', es: 'Enviado al laboratorio el (opcional)' },
  from_retain: { en: 'From retention sample / box', es: 'De la muestra de retención / caja' },
};
const tr = (lang, k) => (S[k] || {})[lang] || (S[k] || {}).en || k;

export default function CheckFields({ form, value, onChange, lang = 'en' }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const missing = missingForCheck(form, v);
  if (!form) return null;

  return (
    <div className="space-y-3" data-check-fields={form.kind}>
      {form.kind === 'emp' && <EmpFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'gmp_walk' && <WalkFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'banned_list_review' && <ReviewFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'stability_pull' && <PullFields form={form} v={v} set={set} lang={lang} />}
      {missing.length > 0 && (
        <p className="text-[11px] text-amber-800" data-check-missing={missing.length}>
          {tr(lang, 'still')}: {missing.map(m => m.label).join(' · ')}
        </p>
      )}
    </div>
  );
}

function EmpFields({ form, v, set, lang }) {
  const [custom, setCustom] = useState('');
  const sites = v.sites || [];
  const all = [...form.sites, ...sites.filter(s => !form.sites.some(f => f.toLowerCase() === s.toLowerCase()))];
  const toggle = (s) => set({ sites: sites.some(x => x.toLowerCase() === s.toLowerCase()) ? sites.filter(x => x.toLowerCase() !== s.toLowerCase()) : [...sites, s] });
  const addCustom = () => { const s = custom.trim(); if (!s) return; if (!sites.some(x => x.toLowerCase() === s.toLowerCase())) set({ sites: [...sites, s] }); setCustom(''); };
  return (
    <div className="bg-white rounded-lg border border-green-200 p-2 space-y-2">
      <p className="text-xs font-semibold text-gray-700">{tr(lang, 'sites_h')} <span className="font-normal text-gray-400">— {form.zone_label} · {form.form_code} {form.form_revision}</span></p>
      <p className="text-[11px] text-gray-500">{tr(lang, 'sites_hint')}</p>
      <div className="flex flex-wrap gap-1.5">
        {all.map(s => {
          const on = sites.some(x => x.toLowerCase() === s.toLowerCase());
          return (
            <button type="button" key={s} onClick={() => toggle(s)} data-emp-site={s} aria-pressed={on}
              className={`px-2.5 py-1.5 rounded-full text-xs border ${on ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}>
              {s}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder={tr(lang, 'add_site')} data-emp-custom className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        <button type="button" onClick={addCustom} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium">{tr(lang, 'add')}</button>
      </div>
      <input value={v.lab || ''} onChange={e => set({ lab: e.target.value })} placeholder={tr(lang, 'lab')} data-emp-lab
        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <p className="text-[11px] text-gray-500">{tr(lang, 'tests')}: {form.tests.join(' · ')}</p>
    </div>
  );
}

function WalkFields({ form, v, set, lang }) {
  const items = v.items || {};
  const setItem = (key, patch) => set({ items: { ...items, [key]: { ...(items[key] || {}), ...patch } } });
  return (
    <div className="bg-white rounded-lg border border-green-200 p-2 space-y-2">
      <p className="text-xs font-semibold text-gray-700">{tr(lang, 'walk_h')} <span className="font-normal text-gray-400">— {form.revision}</span></p>
      {form.draft && <p className="text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1">{tr(lang, 'draft')}</p>}
      <input value={v.area || ''} onChange={e => set({ area: e.target.value })} placeholder={tr(lang, 'area')} data-walk-area
        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <ul className="space-y-2">
        {form.items.map(it => {
          const a = items[it.key] || {};
          return (
            <li key={it.key} className="border-t border-gray-100 pt-2" data-walk-item={it.key}>
              <p className="text-xs text-gray-800 mb-1">{lang === 'es' && it.label_es ? it.label_es : it.label}</p>
              <div className="flex gap-1.5">
                {GMP_WALK_ANSWERS.map(ans => (
                  <button type="button" key={ans} onClick={() => setItem(it.key, { result: ans })} data-walk-answer={ans} aria-pressed={a.result === ans}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 ${a.result === ans
                      ? (ans === 'c' ? 'bg-green-500 text-white border-green-500' : ans === 'nc' ? 'bg-red-500 text-white border-red-500' : 'bg-gray-500 text-white border-gray-500')
                      : 'bg-white text-gray-600 border-gray-200'}`}>
                    {tr(lang, ans)}
                  </button>
                ))}
              </div>
              {a.result === 'nc' && (
                <input value={a.note || ''} onChange={e => setItem(it.key, { note: e.target.value })} placeholder={tr(lang, 'seen')} data-walk-note
                  className="mt-1 w-full px-2 py-1.5 border border-red-200 rounded-lg text-sm" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewFields({ form, v, set, lang }) {
  const ed = v.editions || {};
  return (
    <div className="bg-white rounded-lg border border-green-200 p-2 space-y-2">
      <p className="text-xs font-semibold text-gray-700">{tr(lang, 'review_h')}</p>
      {form.lists.map(l => (
        <label key={l.key} className="block" data-list={l.key}>
          <span className="text-[11px] text-gray-600">{l.label} — {tr(lang, 'edition')}</span>
          <input value={ed[l.key] || ''} onChange={e => set({ editions: { ...ed, [l.key]: e.target.value } })} data-list-edition={l.key}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 2026 edition, January 2026" />
        </label>
      ))}
      <label className="block">
        <span className="text-[11px] text-gray-600">{tr(lang, 'changes')}</span>
        <textarea value={v.changes_found || ''} onChange={e => set({ changes_found: e.target.value })} rows={2} data-list-changes
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      </label>
      <label className="block">
        <span className="text-[11px] text-gray-600">{tr(lang, 'actions')}</span>
        <textarea value={v.actions_taken || ''} onChange={e => set({ actions_taken: e.target.value })} rows={2} data-list-actions
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      </label>
      <label className="flex items-start gap-2 text-xs text-gray-700">
        <input type="checkbox" checked={!!v.materials_rechecked} onChange={e => set({ materials_rechecked: e.target.checked })} className="mt-0.5" data-list-rechecked />
        {tr(lang, 'rechecked')}
      </label>
    </div>
  );
}

function PullFields({ form, v, set, lang }) {
  return (
    <div className="bg-white rounded-lg border border-green-200 p-2 space-y-2">
      <p className="text-xs font-semibold text-gray-700">{tr(lang, 'pull_h')} <span className="font-normal text-gray-400">— {form.study} · {form.pull_month} mo · due {form.due_date}</span></p>
      {form.retention_sample_id && <p className="text-[11px] text-gray-500">{tr(lang, 'from_retain')}: {form.retention_sample_id}</p>}
      {form.tests && <p className="text-[11px] text-gray-500">{form.tests}</p>}
      <input value={v.quantity || ''} onChange={e => set({ quantity: e.target.value })} placeholder={tr(lang, 'quantity')} data-pull-quantity
        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input value={v.lab || ''} onChange={e => set({ lab: e.target.value })} placeholder={tr(lang, 'lab')} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        <input type="date" value={v.sent_on || ''} onChange={e => set({ sent_on: e.target.value })} title={tr(lang, 'sent_on')} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      </div>
    </div>
  );
}
