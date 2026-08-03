import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Download, ArrowLeft, Languages } from 'lucide-react';
import RichText from '../common/RichText.jsx';
import { CoverArt } from './NewsletterBanner.jsx';

// Reading a newsletter, in your own language.
//
// A PDF can't have a language toggle — it's a static file, so whichever
// language it was rendered in is what every reader gets. The toggle is a PAGE
// behaviour, so this is the thing #announcements links to and the PDFs are the
// download for printing and posting on the board.
//
// The translation comes from the SERVER (/issues/:id/read?lang=), the same
// call the PDF makes, so the page and the download say the same words. A
// second translation path here would drift, and the drift would only show up
// once the issue was already out.

const KIND_TONE = {
  announcement: 'bg-powder-100 text-powder-700',
  birthday: 'bg-pink-100 text-pink-700',
  anniversary: 'bg-amber-100 text-amber-700',
  win: 'bg-emerald-100 text-emerald-700',
  reminder: 'bg-blue-100 text-blue-700',
  safety: 'bg-red-100 text-red-700',
};
const KIND_LABEL = {
  announcement: { en: 'Announcement', es: 'Anuncio' },
  birthday: { en: 'Birthday', es: 'Cumpleaños' },
  anniversary: { en: 'Anniversary', es: 'Aniversario' },
  win: { en: 'Win', es: 'Logro' },
  reminder: { en: 'Reminder', es: 'Recordatorio' },
  safety: { en: 'Safety', es: 'Seguridad' },
};

const T = {
  en: { back: 'Back', download: 'Download PDF', unavailable: 'Spanish is unavailable right now — showing English.', notFound: 'That newsletter could not be found.' },
  es: { back: 'Atrás', download: 'Descargar PDF', unavailable: 'El español no está disponible ahora — se muestra en inglés.', notFound: 'No se encontró ese boletín.' },
};

export default function NewsletterReader({ id, onExit }) {
  const [lang, setLang] = useState('en');
  const { data, loading, error } = useApiGet(id ? `/newsletter/issues/${id}/read?lang=${lang}` : null, [id, lang]);
  const t = T[lang] || T.en;

  if (loading && !data) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-gray-500">{error || t.notFound}</p>
        <button onClick={onExit} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium">{t.back}</button>
      </div>
    );
  }

  // The same date the PDF prints, formatted the same way.
  const dateLabel = data.created_at
    ? new Date(data.created_at.replace(' ', 'T')).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { dateStyle: 'long' })
    : '';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky bar: back, the toggle, and the download for the language
          you're actually reading — the PDF should match the screen. */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center gap-2">
          <button onClick={onExit} className="p-1.5 -ml-1.5 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100" data-tip="Back">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 ml-auto">
            <Languages size={13} className="text-gray-400 ml-1.5" />
            {['en', 'es'].map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase ${lang === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <a href={`/api/newsletter/issues/${data.id}/pdf?lang=${lang}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700">
            <Download size={13} /> <span className="hidden sm:inline">{t.download}</span>
          </a>
        </div>
      </div>

      <article className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {lang === 'es' && data.translation_available === false && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{t.unavailable}</p>
        )}

        {/* The same header cover the PDF draws — one definition, two renderers. */}
        {data.banner_image_url ? (
          <img src={data.banner_image_url} alt="" className="w-full rounded-xl object-cover max-h-56" />
        ) : data.cover ? (
          <div className="rounded-xl overflow-hidden"><CoverArt cover={data.cover} className="w-full" /></div>
        ) : null}

        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{data.title}</h1>
          {dateLabel && <p className="text-sm text-gray-400">{dateLabel}</p>}
        </header>

        {data.intro && <RichText text={data.intro} className="text-[15px] text-gray-700 leading-relaxed space-y-2" />}

        {(data.sections || []).map((s, i) => (
          <section key={s.id || i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 mt-1 ${KIND_TONE[s.kind] || 'bg-gray-100 text-gray-600'}`}>
                {(KIND_LABEL[s.kind] || {})[lang] || s.kind}
              </span>
              <h2 className="font-semibold text-gray-900 leading-snug">{s.title}</h2>
            </div>
            {s.image_url && <img src={s.image_url} alt="" className="w-full rounded-lg object-cover max-h-72" />}
            {s.body && <RichText text={s.body} className="text-[15px] text-gray-700 leading-relaxed space-y-2" />}
          </section>
        ))}
      </article>
    </div>
  );
}
