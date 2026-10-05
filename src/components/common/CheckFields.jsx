// The fields a check that files a record asks for (D-060), rendered from the
// server's `check_form` and validated with the SAME `missingForCheck` the
// server refuses with — so neither completion form can offer a completion
// the server then rejects. Rendered by the Operator View (phone, EN/ES) and
// the Task Center's CompleteForm; a third copy is how the two screens start
// asking different questions about one check.
import { useAuth } from '../../hooks/useAuth';
import { useState } from 'react';
import { missingForCheck, GMP_WALK_ANSWERS, REVIEW_ANSWERS } from '../../../shared/check-forms.js';

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
  train_h: { en: 'Training', es: 'Capacitación' },
  train_for: { en: 'This records the training for', es: 'Esto registra la capacitación de' },
  score: { en: 'Test score (%)', es: 'Puntaje del examen (%)' },
  score_hint: { en: 'Only for a test taken on paper: enter the score from it.', es: 'Solo para un examen hecho en papel: ingrese su puntaje.' },
  self_test: { en: 'Your score is worked out when you submit the test above, and shown to you at the end. There is nothing to type here.', es: 'Su puntaje se calcula al enviar el examen de arriba y se le muestra al final. Aquí no hay nada que escribir.' },
  trainer: { en: 'Who delivered the training', es: 'Quién impartió la capacitación' },
  method: { en: 'How (optional)', es: 'Cómo (opcional)' },
  method_person: { en: 'In person', es: 'En persona' },
  method_video: { en: 'Video', es: 'Video' },
  method_read: { en: 'Read and understood', es: 'Leído y entendido' },
  method_test: { en: 'Test taken in ReadyDoc', es: 'Examen tomado en ReadyDoc' },
  passing: { en: 'Passing score', es: 'Puntaje para aprobar' },
  renews: { en: 'Records a completion, and the next one comes due in', es: 'Registra la finalización, y la próxima vence en' },
  months: { en: 'months', es: 'meses' },
  mr_h: { en: 'Management review', es: 'Revisión por la dirección' },
  mr_hint: { en: 'The clause requires all eight. Mark one N/A only with the reason.', es: 'La cláusula exige las ocho. Marque N/A solo con el motivo.' },
  attendees: { en: 'Who took part (site management)', es: 'Quiénes participaron (dirección del sitio)' },
  done: { en: 'Reviewed', es: 'Revisado' },
  why_na: { en: 'Why it does not apply this year', es: 'Por qué no aplica este año' },
  mr_notes: { en: 'Notes, decisions and actions agreed (optional)', es: 'Notas, decisiones y acciones acordadas (opcional)' },
  fd_h: { en: 'Food Defense Plan challenge', es: 'Desafío del Plan de Defensa Alimentaria' },
  fd_team: { en: 'Food Defense Team members taking part', es: 'Miembros del Equipo de Defensa Alimentaria participantes' },
  fd_methods: { en: 'Challenge method(s) used — at least one (§ 5.2 C)', es: 'Método(s) de desafío usados — al menos uno (§ 5.2 C)' },
  fd_outcome: { en: 'Outcome and response times (§ 5.2 C)', es: 'Resultado y tiempos de respuesta (§ 5.2 C)' },
  fd_findings: { en: 'Strengths, weaknesses and gaps; strategy ratings (§ 5.2 D)', es: 'Fortalezas, debilidades y brechas; calificaciones (§ 5.2 D)' },
  fd_capa: { en: 'Corrective actions, owners and dates (write "none" if none) (§ 5.3)', es: 'Acciones correctivas, responsables y fechas (escriba "ninguna" si no hay) (§ 5.3)' },
};
const tr = (lang, k) => (S[k] || {})[lang] || (S[k] || {}).en || k;

export default function CheckFields({ form, value, onChange, lang = 'en', assignee = null }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const missing = missingForCheck(form, v);
  if (!form) return null;

  return (
    <div className="space-y-3" data-check-fields={form.kind}>
      {form.kind === 'emp' && <EmpFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'gmp_walk' && <WalkFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'banned_list_review' && <ReviewFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'management_review' && <AnnualReviewFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'food_defense_challenge' && <AnnualReviewFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'stability_pull' && <PullFields form={form} v={v} set={set} lang={lang} />}
      {form.kind === 'training' && <TrainingFields form={form} v={v} set={set} lang={lang} assignee={assignee} />}
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

/**
 * The two annual reviews. ONE COMPONENT, because they are the same act — walk
 * a list transcribed from an external standard or the plant's own procedure,
 * mark each item reviewed or not applicable with a reason, and complete the
 * task once. A second copy would let the two screens drift into asking
 * different questions about the same shape.
 */
function AnnualReviewFields({ form, v, set, lang }) {
  const fd = form.kind === 'food_defense_challenge';
  const items = v.items || {};
  const setItem = (key, patch) => set({ items: { ...items, [key]: { ...(items[key] || {}), ...patch } } });
  const methods = v.methods || [];
  const toggleMethod = (k) => set({ methods: methods.includes(k) ? methods.filter(m => m !== k) : [...methods, k] });
  const box = 'w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm';
  return (
    <div className="bg-white rounded-lg border border-green-200 p-2 space-y-2">
      <p className="text-xs font-semibold text-gray-700">
        {tr(lang, fd ? 'fd_h' : 'mr_h')}{' '}
        <span className="font-normal text-gray-400">— {fd ? form.sop_revision : form.clause}</span>
      </p>
      {form.draft && <p className="text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1">{tr(lang, 'draft')}</p>}
      {!fd && <p className="text-[11px] text-gray-500">{tr(lang, 'mr_hint')}</p>}

      <input value={(fd ? v.team : v.attendees) || ''} onChange={e => set(fd ? { team: e.target.value } : { attendees: e.target.value })}
        placeholder={tr(lang, fd ? 'fd_team' : 'attendees')} data-review-people className={box} />

      <ul className="space-y-2">
        {form.items.map(it => {
          const a = items[it.key] || {};
          return (
            <li key={it.key} className="border-t border-gray-100 pt-2" data-review-item={it.key}>
              <p className="text-xs text-gray-800 mb-1">
                <span className="font-semibold text-gray-500">{fd ? it.clause : `${it.roman}.`}</span> {it.label}
              </p>
              <div className="flex gap-1.5">
                {REVIEW_ANSWERS.map(ans => (
                  <button type="button" key={ans} onClick={() => setItem(it.key, { result: ans })}
                    data-review-answer={ans} aria-pressed={a.result === ans}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 ${a.result === ans
                      ? (ans === 'done' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-500 text-white border-gray-500')
                      : 'bg-white text-gray-600 border-gray-200'}`}>
                    {tr(lang, ans)}
                  </button>
                ))}
              </div>
              {a.result === 'na' && (
                <input value={a.note || ''} onChange={e => setItem(it.key, { note: e.target.value })}
                  placeholder={tr(lang, 'why_na')} data-review-na-note
                  className="mt-1 w-full px-2 py-1.5 border border-amber-300 rounded-lg text-sm" />
              )}
              {a.result === 'done' && (
                <input value={a.note || ''} onChange={e => setItem(it.key, { note: e.target.value })}
                  placeholder={lang === 'es' ? 'Qué se revisó (opcional)' : 'What was reviewed (optional)'} data-review-note
                  className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
              )}
            </li>
          );
        })}
      </ul>

      {fd ? (
        <>
          <p className="text-xs font-semibold text-gray-700 pt-1">{tr(lang, 'fd_methods')}</p>
          <div className="flex flex-wrap gap-1.5">
            {form.methods.map(m => (
              <button type="button" key={m.key} onClick={() => toggleMethod(m.key)} data-fd-method={m.key} aria-pressed={methods.includes(m.key)}
                className={`px-2.5 py-1.5 rounded-full text-xs border ${methods.includes(m.key) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
          <textarea value={v.outcome || ''} onChange={e => set({ outcome: e.target.value })} rows={2} placeholder={tr(lang, 'fd_outcome')} data-fd-outcome className={box} />
          <textarea value={v.findings || ''} onChange={e => set({ findings: e.target.value })} rows={2} placeholder={tr(lang, 'fd_findings')} data-fd-findings className={box} />
          <textarea value={v.corrective_actions || ''} onChange={e => set({ corrective_actions: e.target.value })} rows={2} placeholder={tr(lang, 'fd_capa')} data-fd-capa className={box} />
        </>
      ) : (
        <textarea value={v.notes || ''} onChange={e => set({ notes: e.target.value })} rows={3} placeholder={tr(lang, 'mr_notes')} data-mr-notes className={box} />
      )}
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

/**
 * An assigned training course.
 *
 * WHAT IT ASKS FOR FOLLOWS THE COURSE, not a fixed form. A course carrying a
 * test is finished by a result; one without is finished by a person having
 * delivered it. Asking for a trainer on a self-study test, or a score on a
 * hands-on demonstration, is ceremony people learn to type anything into.
 *
 * It names WHO the record will be filed for, because the person completing
 * the task on a shared floor phone is often not the person who was trained —
 * a supervisor closing it out must be able to see that before they press it.
 */
function TrainingFields({ form, v, set, lang, assignee }) {
  // THE TRAINEE IS NEVER ASKED FOR A SCORE (D-144). A test grades itself; a
  // box under it inviting the person who took it to type a percentage is a
  // self-reported result beside a graded one, and Daniela found employees
  // filling it in. The paper route stays for somebody recording a test taken
  // on paper FOR the trainee — a supervisor — and the server refuses a typed
  // score from the assignee whatever this screen shows.
  const { user } = useAuth() || {};
  const self = !!(user?.name && assignee && user.name.toLowerCase() === String(assignee).toLowerCase());
  return (
    <div className="bg-white rounded-lg border border-green-200 p-2 space-y-2" data-training-check>
      <p className="text-xs font-semibold text-gray-700">
        {tr(lang, 'train_h')} <span className="font-normal text-gray-400">— {form.code ? `${form.code} · ` : ''}{form.title}</span>
      </p>
      {assignee && (
        <p className="text-[11px] text-gray-500" data-training-for>{tr(lang, 'train_for')} <span className="font-medium text-gray-700">{assignee}</span></p>
      )}
      {form.has_test && self ? (
        <p className="text-[11px] text-gray-600" data-training-self>{tr(lang, 'self_test')}</p>
      ) : form.has_test ? (
        <>
          <label className="block">
            <span className="text-[11px] text-gray-600">{tr(lang, 'score')}</span>
            <input type="number" min="0" max="100" step="any" inputMode="decimal" value={v.score ?? ''} data-training-score
              onChange={e => set({ score: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </label>
          <p className="text-[11px] text-gray-500">{tr(lang, 'score_hint')} {tr(lang, 'passing')}: {form.passing_score}%.</p>
        </>
      ) : (
        <>
          <input value={v.trainer || ''} onChange={e => set({ trainer: e.target.value })} placeholder={tr(lang, 'trainer')} data-training-trainer
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <select value={v.method || ''} onChange={e => set({ method: e.target.value })} data-training-method
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">{tr(lang, 'method')}</option>
            <option value="in person">{tr(lang, 'method_person')}</option>
            <option value="video">{tr(lang, 'method_video')}</option>
            <option value="read and understood">{tr(lang, 'method_read')}</option>
          </select>
        </>
      )}
      {!!form.retrain_months && (
        <p className="text-[11px] text-gray-500">{tr(lang, 'renews')} {form.retrain_months} {tr(lang, 'months')}.</p>
      )}
    </div>
  );
}
