// /install — the page you text somebody so they can get ReadyDoc on their
// phone and sign in.
//
// WHY IT IS NOT JUST THE JOIN LINK. A join link is single-use, expires in
// fourteen days, and only works for an account with no password yet — all
// deliberate, and all wrong for the other half of the cases: somebody who got
// a new phone, somebody who deleted the icon, somebody who was set up months
// ago and never installed it. There was nothing to send those people except a
// bare address and a verbal explanation.
//
// Public on purpose, and it gives nothing away: the plant's own name is not on
// it, there is no roster, no list of modules and no way in — it is three
// instructions and a link to the sign-in screen everybody can already reach.
//
// It does NOT try to sign anybody in. Passwords are set by the office or on a
// join link; a page that asked for one here would be a second, weaker door
// into the same accounts.
import { useState } from 'react';
import { Smartphone, LogIn } from 'lucide-react';
import InstallReadyDoc from './common/InstallReadyDoc.jsx';

const S = {
  en: {
    heading: 'Get ReadyDoc on your phone',
    lead: 'Three steps. It takes about a minute.',
    s1h: '1. You are already here',
    s1: 'This page is ReadyDoc. Keep it open for the next two steps.',
    s2h: '2. Add it to your home screen',
    s3h: '3. Sign in',
    s3: 'Open the icon you just added and sign in with your name and the password you were given. No password yet, or forgotten it? Ask the office — they can send you a fresh sign-in link by text.',
    open: 'Open the sign-in screen',
    lang: 'Español',
  },
  es: {
    heading: 'Instala ReadyDoc en tu teléfono',
    lead: 'Tres pasos. Toma como un minuto.',
    s1h: '1. Ya estás aquí',
    s1: 'Esta página es ReadyDoc. Déjala abierta para los siguientes dos pasos.',
    s2h: '2. Agrégalo a tu pantalla de inicio',
    s3h: '3. Inicia sesión',
    s3: 'Abre el ícono que acabas de agregar e inicia sesión con tu nombre y la contraseña que te dieron. ¿Todavía no tienes contraseña, o se te olvidó? Pídele a la oficina que te mande un enlace de acceso por mensaje.',
    open: 'Abrir la pantalla de acceso',
    lang: 'English',
  },
};

export default function InstallPage() {
  // Defaults to the phone's own language, because the floor reads Spanish and
  // a page that opens in English is one half the plant closes.
  const [lang, setLang] = useState(() => (
    typeof navigator !== 'undefined' && /^es/i.test(navigator.language || '') ? 'es' : 'en'
  ));
  const t = S[lang];
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8" data-install-page>
      <div className="max-w-sm mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-gray-900 font-bold text-lg">
            <Smartphone size={20} className="text-powder-600" /> ReadyDoc
          </span>
          <button type="button" onClick={() => setLang(l => (l === 'en' ? 'es' : 'en'))} data-install-lang
            className="text-xs font-semibold text-powder-700 underline">{t.lang}</button>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-1">
          <h1 className="text-xl font-bold text-gray-900">{t.heading}</h1>
          <p className="text-sm text-gray-600">{t.lead}</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
          <p className="font-semibold text-gray-900 text-sm">{t.s1h}</p>
          <p className="text-sm text-gray-700">{t.s1}</p>
        </div>

        <div className="space-y-1">
          <p className="font-semibold text-gray-900 text-sm px-1">{t.s2h}</p>
          <InstallReadyDoc lang={lang} />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <p className="font-semibold text-gray-900 text-sm">{t.s3h}</p>
          <p className="text-sm text-gray-700">{t.s3}</p>
          <a href="/" data-install-signin
            className="w-full inline-flex items-center justify-center gap-2 py-3 bg-powder-600 text-white rounded-xl text-base font-semibold">
            <LogIn size={16} /> {t.open}
          </a>
        </div>
      </div>
    </div>
  );
}
