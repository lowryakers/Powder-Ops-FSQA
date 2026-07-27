import { Languages } from 'lucide-react';

// EN / ES switch for a whole page, paired with usePageTranslation.
export default function LangToggle({ lang, setLang, translating }) {
  return (
    <div className="flex items-center gap-1.5">
      {translating && <span className="text-[10px] text-gray-400">Traduciendo…</span>}
      <div className="flex rounded-lg overflow-hidden border border-gray-300" title="English / Español">
        <span className="px-1.5 flex items-center bg-gray-50 text-gray-400"><Languages size={13} /></span>
        {['en', 'es'].map(l => (
          <button key={l} type="button" onClick={() => setLang(l)}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${lang === l ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
