import { useEffect } from 'react';
import { X, Download, ExternalLink, ChevronLeft, ChevronRight, FileText } from 'lucide-react';

// Shared in-app file preview overlay: PDFs and images render inline (dimmed
// backdrop, Esc/backdrop to close), everything else offers a download. Pass
// several items to page through them with the arrows / arrow keys.
// item: { url, name } — kind is inferred from the name/url extension.
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i;
const PDF_RE = /\.pdf(\?|$)/i;

export default function FilePreview({ items, index = 0, onClose, onNav }) {
  const list = Array.isArray(items) ? items : [items];
  const item = list[Math.max(0, Math.min(index, list.length - 1))];
  const many = list.length > 1;
  const nav = (d) => { if (many && onNav) onNav((index + d + list.length) % list.length); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, list.length]);

  if (!item || !item.url) return null;
  const probe = `${item.name || ''} ${item.url}`;
  const isImage = IMG_RE.test(probe);
  const isPdf = PDF_RE.test(probe);

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex flex-col" onClick={onClose}>
      <div className="flex items-center gap-2 px-4 py-2.5 text-white" onClick={e => e.stopPropagation()}>
        <FileText size={16} className="shrink-0 text-white/70" />
        <span className="text-sm font-medium truncate flex-1">{item.name || 'File'}</span>
        {many && <span className="text-xs text-white/60 whitespace-nowrap">{index + 1} / {list.length}</span>}
        <a href={item.url} download={item.name || true} className="p-2 hover:bg-white/10 rounded-lg" data-tip="Download" onClick={e => e.stopPropagation()}>
          <Download size={17} />
        </a>
        <a href={item.url} target="_blank" rel="noreferrer" className="p-2 hover:bg-white/10 rounded-lg" data-tip="Open in browser tab" onClick={e => e.stopPropagation()}>
          <ExternalLink size={17} />
        </a>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg"><X size={18} /></button>
      </div>
      <div className="flex-1 min-h-0 relative px-4 pb-4" onClick={e => e.stopPropagation()}>
        {isImage ? (
          <div className="w-full h-full flex items-center justify-center" onClick={onClose}>
            <img src={item.url} alt={item.name || ''} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
          </div>
        ) : isPdf ? (
          <iframe src={item.url} title={item.name || 'PDF'} className="w-full h-full bg-white rounded-lg" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="bg-white rounded-xl p-6 text-center max-w-xs">
              <FileText size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-800 break-all mb-1">{item.name || 'File'}</p>
              <p className="text-xs text-gray-500 mb-4">No inline preview for this file type.</p>
              <a href={item.url} download={item.name || true} className="inline-flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
                <Download size={15} /> Download
              </a>
            </div>
          </div>
        )}
        {many && (
          <>
            <button onClick={() => nav(-1)} className="absolute left-6 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full"><ChevronLeft size={20} /></button>
            <button onClick={() => nav(1)} className="absolute right-6 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full"><ChevronRight size={20} /></button>
          </>
        )}
      </div>
    </div>
  );
}
