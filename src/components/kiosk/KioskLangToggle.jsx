/**
 * The toggle itself. Shows the language it will SWITCH TO, not the one you are
 * in — "Español" when you are reading English — because that is what the
 * person tapping it is looking for.
 *
 * Big enough to hit with a glove on: these screens are used one-handed on a
 * phone next to a machine.
 */
export default function KioskLangToggle({ lang, onToggle, className = '' }) {
  return (
    <button type="button" onClick={onToggle}
      aria-label={lang === 'en' ? 'Cambiar a español' : 'Switch to English'}
      className={`px-3 py-2 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 ${className}`}>
      {lang === 'en' ? 'Español' : 'English'}
    </button>
  );
}
