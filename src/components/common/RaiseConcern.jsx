// "Raise a concern" (D-211) — anybody who works here, about GMP, sanitation,
// safety or food defense. A button plus its form, mounted where people already
// are (the Operator View, which every employee has, and the culture page).
//
// The "leave my name off" box is shown only while the plant allows it: the
// server refuses an anonymous concern otherwise, and a box that then errors
// would read as the app breaking a promise.
import { useState } from 'react';
import { MessageSquareWarning, X, Check } from 'lucide-react';
import { useApiGet, apiPost } from '../../hooks/useApi';

const S = {
  button: { en: 'Raise a concern', es: 'Reportar una inquietud' },
  title: { en: 'Raise a food safety or safety concern', es: 'Reportar una inquietud de inocuidad o seguridad' },
  intro: { en: 'Anything about GMP, sanitation, safety or food defense. Quality reads every one and answers it.', es: 'Cualquier tema de GMP, sanitización, seguridad o defensa alimentaria. Calidad lee y responde cada una.' },
  about: { en: 'What is it about?', es: '¿De qué se trata?' },
  dept: { en: 'Where (department)', es: 'Dónde (departamento)' },
  what: { en: 'What did you see or what worries you?', es: '¿Qué vio o qué le preocupa?' },
  anon: { en: 'Leave my name off', es: 'No incluir mi nombre' },
  anon_note: { en: 'Your name will not be stored at all, so you will not be able to see the answer later.', es: 'Su nombre no se guardará, así que no podrá ver la respuesta después.' },
  send: { en: 'Send', es: 'Enviar' },
  sending: { en: 'Sending…', es: 'Enviando…' },
  cancel: { en: 'Cancel', es: 'Cancelar' },
  thanks: { en: 'Thank you. Quality will look at it.', es: 'Gracias. Calidad lo revisará.' },
};
const t = (lang, k) => (S[k] || {})[lang] || S[k]?.en || k;

export default function RaiseConcern({ user, lang = 'en', className = '' }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(false); }} data-raise-concern
        className={className || 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm font-medium hover:bg-amber-100'}>
        <MessageSquareWarning size={15} /> {t(lang, 'button')}
      </button>
      {done && !open && <span className="ml-2 text-xs text-green-700 inline-flex items-center gap-1" data-concern-thanks><Check size={13} /> {t(lang, 'thanks')}</span>}
      {open && <ConcernForm user={user} lang={lang} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setDone(true); }} />}
    </>
  );
}

function ConcernForm({ user, lang, onClose, onDone }) {
  const { data: meta } = useApiGet('/culture/meta');
  const [f, setF] = useState({ category: '', department: user?.department || '', description: '', anonymous: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    try { await apiPost('/culture/concerns', f); onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const ok = f.category && f.description.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" data-concern-form>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[92vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">{t(lang, 'title')}</h2>
          <button type="button" onClick={onClose} className="text-gray-400"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-600">{t(lang, 'intro')}</p>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">{t(lang, 'about')}</span>
          <select value={f.category} onChange={e => setF({ ...f, category: e.target.value })} data-concern-category
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">—</option>
            {(meta?.categories || []).map(c => <option key={c.key} value={c.key}>{lang === 'es' ? c.label_es : c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">{t(lang, 'dept')}</span>
          <select value={f.department} onChange={e => setF({ ...f, department: e.target.value })} data-concern-department
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">—</option>
            {(meta?.departments || []).map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">{t(lang, 'what')}</span>
          <textarea rows={4} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} data-concern-text
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </label>
        {meta?.anonymous_allowed && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.anonymous} onChange={e => setF({ ...f, anonymous: e.target.checked })} className="h-5 w-5 shrink-0 mt-0.5" data-concern-anon />
            <span>{t(lang, 'anon')}{f.anonymous && <span className="block text-[11px] text-gray-500">{t(lang, 'anon_note')}</span>}</span>
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-600">{t(lang, 'cancel')}</button>
          <button type="button" onClick={send} disabled={!ok || busy} data-concern-send
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {busy ? t(lang, 'sending') : t(lang, 'send')}
          </button>
        </div>
      </div>
    </div>
  );
}
