// "Put ReadyDoc on your phone" — one card, every door.
//
// It started on the onboarding welcome page, where a new hire finishes their
// packet. But the same three sentences are what anybody needs who has just
// been given access: go here, sign in, add it to your home screen. So it is
// shared rather than retyped — a second copy is how one door starts telling
// people to tap a menu that moved.
//
// `t` is optional: the onboarding wizard passes its own translator so its
// wording (already translated, already verified) is untouched. Everywhere
// else falls back to the strings below.
//
// WHY THE INSTRUCTIONS RENDER WHETHER OR NOT A BUTTON DOES. `beforeinstallprompt`
// fires on Chromium only, and only on the app's own origin. On iOS Safari it
// never fires at all — so on the phones half this plant carries, the written
// steps ARE the feature, not a fallback.
import { useState, useEffect } from 'react';

const S = {
  title: { en: 'Put ReadyDoc on your phone', es: 'Instala ReadyDoc en tu teléfono' },
  why: {
    en: 'ReadyDoc is where the team talks and where your tasks and training live. Add it to your home screen and it opens like an app.',
    es: 'ReadyDoc es donde se comunica el equipo y donde están tus tareas y tu capacitación. Agrégalo a tu pantalla de inicio y se abre como una aplicación.',
  },
  button: { en: 'Add ReadyDoc to my phone', es: 'Agregar ReadyDoc a mi teléfono' },
  ios: {
    en: 'On iPhone: open this page in Safari, tap the Share button at the bottom, then Add to Home Screen.',
    es: 'En iPhone: abre esta página en Safari, toca el botón Compartir abajo y luego Agregar a inicio.',
  },
  android: {
    en: 'On Android: tap the ⋮ menu at the top right, then Install app or Add to Home screen.',
    es: 'En Android: toca el menú ⋮ arriba a la derecha y luego Instalar aplicación o Agregar a pantalla principal.',
  },
  done: { en: 'Added. Look for the ReadyDoc icon on your home screen.', es: 'Listo. Busca el ícono de ReadyDoc en tu pantalla de inicio.' },
  openLink: { en: 'Or open it here:', es: 'O ábrelo aquí:' },
};
const fallback = (lang) => (k) => {
  const key = String(k).replace(/^done\./, '');
  const map = { installTitle: 'title', installWhy: 'why', installButton: 'button', installIos: 'ios', installAndroid: 'android', installDone: 'done', openLink: 'openLink', notifications: null };
  const slot = map[key] ?? key;
  if (!slot) return '';
  return (S[slot] || {})[lang] || (S[slot] || {}).en || '';
};

export default function InstallReadyDoc({ t, appUrl, lang = 'en' }) {
  const tr = t || fallback(lang);
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };
  const notifications = tr('done.notifications');
  return (
    <div className="bg-powder-50 border border-powder-200 rounded-xl p-4 space-y-3" data-install>
      <p className="text-base font-bold text-gray-900">{tr('done.installTitle')}</p>
      <p className="text-sm text-gray-700">{tr('done.installWhy')}</p>
      {installed ? (
        <p className="text-sm font-semibold text-green-800 bg-green-50 border border-green-200 rounded-lg p-2.5" data-install-done>
          ✓ {tr('done.installDone')}
        </p>
      ) : (
        <>
          {prompt && (
            <button type="button" onClick={install} data-install-button
              className="w-full py-3 bg-powder-600 text-white rounded-xl text-base font-semibold">
              {tr('done.installButton')}
            </button>
          )}
          <p className="text-sm text-gray-700">{tr(isIos ? 'done.installIos' : 'done.installAndroid')}</p>
        </>
      )}
      {notifications && <p className="text-xs text-gray-500">{notifications}</p>}
      {appUrl && (
        <p className="text-xs text-gray-500 break-all">
          {tr('done.openLink')} <a className="text-powder-700 underline" href={appUrl}>{appUrl.replace(/^https?:\/\//, '')}</a>
        </p>
      )}
    </div>
  );
}
