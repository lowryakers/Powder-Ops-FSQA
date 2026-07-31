import { useState, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { ImagePlus, Check, X, Upload } from 'lucide-react';

// The newsletter's header image — the "make it feel like a newsletter, not a
// policy document" feature.
//
// Covers are DRAWN from geometry the server sends (see server/newsletter-covers.js),
// not stock photos: nothing to license, nothing to ship, and the PDF draws the
// same numbers, so what Marnee picks here is exactly what comes out the other
// end. Uploading a real photo (the fireworks shot) is the other option and uses
// the image upload the newsletter already had.

/** Draw a cover from the server's shape list. Same geometry the PDF uses. */
export function CoverArt({ cover, className = '', rounded = true }) {
  if (!cover) return null;
  const { w, h } = cover.viewbox || { w: 1000, h: 300 };
  const gid = `cg-${cover.id}`;
  const stops = cover.colors || ['#0369A1'];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
      className={`${className} ${rounded ? 'rounded-lg' : ''} block w-full h-full`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          {stops.map((c, i) => (
            <stop key={i} offset={stops.length === 1 ? 0 : i / (stops.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={w} height={h} fill={`url(#${gid})`} />
      {(cover.shapes || []).map((s, i) => {
        if (s.type === 'circle') {
          return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill || cover.accent} opacity={s.opacity ?? 1} />;
        }
        if (s.type === 'line') {
          return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke={s.stroke || cover.accent} strokeWidth={s.width || 1} opacity={s.opacity ?? 1} strokeLinecap="round" />;
        }
        if (s.type === 'poly') {
          const pts = (s.points || []).map(p => p.join(',')).join(' ');
          return s.close
            ? <polygon key={i} points={pts} fill={s.fill || cover.accent} opacity={s.opacity ?? 1} />
            : <polyline key={i} points={pts} fill="none" stroke={s.stroke || cover.accent}
              strokeWidth={s.width || 1} opacity={s.opacity ?? 1} strokeLinecap="round" />;
        }
        return null;
      })}
    </svg>
  );
}

/**
 * The banner strip on the issue editor: shows what's chosen, opens the gallery.
 *
 * `value` is `{ banner_cover, banner_image_id, banner_image_url }`.
 * `onChange` gets a patch — one of the two is always cleared, because a
 * newsletter has one header.
 */
export default function NewsletterBanner({ value, onChange, onUpload, uploading, disabled, tr = (x) => x }) {
  const [picking, setPicking] = useState(false);
  const { data } = useApiGet(picking ? '/newsletter/covers' : null, [picking]);
  const covers = useMemo(() => data?.covers || [], [data]);
  const suggested = data?.suggested || [];

  const chosen = covers.find(c => c.id === value?.banner_cover) || null;
  // Before the gallery has loaded we still know the id — render the strip from
  // whatever came with the issue so it doesn't flash empty.
  const hasCover = !!value?.banner_cover;
  const hasPhoto = !!value?.banner_image_url;

  const groups = useMemo(() => {
    const by = new Map();
    for (const c of covers) {
      if (!by.has(c.group)) by.set(c.group, []);
      by.get(c.group).push(c);
    }
    return [...by.entries()];
  }, [covers]);

  return (
    <div>
      <div className="relative h-28 sm:h-32 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
        {hasPhoto ? (
          <img src={value.banner_image_url} alt="" className="w-full h-full object-cover" />
        ) : hasCover ? (
          <CoverArt cover={chosen || { id: value.banner_cover, colors: ['#0369A1', '#38A3D1'], shapes: [] }} rounded={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-gray-400">
            {tr('No header yet')}
          </div>
        )}

        {!disabled && (
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            {(hasCover || hasPhoto) && (
              <button type="button" onClick={() => onChange({ banner_cover: null, banner_image_id: null, banner_image_url: null })}
                className="px-2 py-1 rounded-lg text-xs font-medium bg-white/90 text-gray-700 hover:bg-white shadow-sm">
                {tr('Remove')}
              </button>
            )}
            <button type="button" onClick={() => setPicking(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/90 text-gray-800 hover:bg-white shadow-sm">
              <ImagePlus size={13} /> {hasCover || hasPhoto ? tr('Change header') : tr('Add a header')}
            </button>
          </div>
        )}
      </div>

      {picking && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setPicking(false)}>
          <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-2">
              <h3 className="font-bold text-gray-900">{tr('Choose a header')}</h3>
              <label className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">
                <Upload size={14} /> {uploading ? tr('Uploading…') : tr('Upload a photo')}
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => { onUpload?.(e.target.files); e.target.value = ''; setPicking(false); }} />
              </label>
              <button onClick={() => setPicking(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {suggested.length > 0 && (
                <Group label={tr('Good for this month')} covers={covers.filter(c => suggested.includes(c.id))}
                  value={value?.banner_cover} onPick={id => { onChange({ banner_cover: id, banner_image_id: null, banner_image_url: null }); setPicking(false); }} />
              )}
              {groups.map(([group, list]) => (
                <Group key={group} label={tr(group)} covers={list} value={value?.banner_cover}
                  onPick={id => { onChange({ banner_cover: id, banner_image_id: null, banner_image_url: null }); setPicking(false); }} />
              ))}
              {!covers.length && <p className="text-sm text-gray-400 text-center py-8">{tr('Loading headers…')}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ label, covers, value, onPick }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {covers.map(c => (
          <button key={c.id} type="button" onClick={() => onPick(c.id)}
            className={`relative h-20 rounded-lg overflow-hidden border-2 transition-colors ${
              value === c.id ? 'border-powder-600' : 'border-transparent hover:border-gray-300'}`}>
            <CoverArt cover={c} rounded={false} />
            <span className="absolute inset-x-0 bottom-0 bg-black/45 text-white text-[11px] font-medium py-0.5 px-1.5 text-left">
              {c.label}
            </span>
            {value === c.id && (
              <span className="absolute top-1.5 right-1.5 bg-powder-600 text-white rounded-full p-0.5">
                <Check size={12} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
