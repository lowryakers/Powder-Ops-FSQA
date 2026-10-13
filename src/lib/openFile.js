// Opening a stored file INSIDE ReadyDoc rather than in a new browser tab (D-168).
//
// The in-app viewer (FilePreview) existed and five screens used it, while about
// twenty others opened the same kind of file with `window.open(url, '_blank')`
// or a plain `<a target="_blank">` — so whether a PDF opened in the app depended
// on which screen you clicked it from. One door now:
//
//   openFile({ url, name })   — for code that fetches a url and then opens it
//   <a href target="_blank">  — caught by FileViewerHost's click handler, so a
//                               link written the ordinary way opens in the app
//                               without each screen having to remember to.
//
// WHAT OPENS IN THE APP: a PDF or an image (decided from the name, then the
// url's path), at an address that will frame — this site, a blob:, or a url
// this server signed (a presigned storage url carries X-Amz-Signature). Anything
// else — a vendor's web page, a Word file, a link to somebody else's site that
// may refuse to be framed — keeps opening in a new tab, exactly as before. A
// blank frame is worse than a new tab.
//
// The way out is always there: Ctrl/Cmd/Shift/middle-click still opens a tab,
// a link carrying `download` or `data-new-tab` is left alone, and the viewer's
// own header has "Open in browser tab".

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const PDF_RE = /\.pdf$/i;

function pathOf(url) {
  try { return decodeURIComponent(new URL(url, window.location.href).pathname); } catch { return ''; }
}

/** 'pdf' | 'image' | null — the name wins, the url's path is the fallback. */
export function fileKind(url, name) {
  for (const s of [name, pathOf(url)]) {
    const v = String(s || '').trim();
    if (PDF_RE.test(v)) return 'pdf';
    if (IMG_RE.test(v)) return 'image';
  }
  return null;
}

/** Will this address render inside a frame on this page? */
export function framable(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:')) return true;
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) return true;
    return u.searchParams.has('X-Amz-Signature');
  } catch { return false; }
}

export function opensInApp(url, name) {
  return !!fileKind(url, name) && framable(url);
}

/** A display name for a url that arrived without one. */
export function nameFromUrl(url) {
  const p = pathOf(url);
  return p.slice(p.lastIndexOf('/') + 1) || 'File';
}

// How many viewers are mounted. Zero means a page outside the app shell (or a
// test harness) — fall back to a tab rather than dispatching into nothing.
let hosts = 0;
export function registerHost() { hosts += 1; return () => { hosts -= 1; }; }

export const OPEN_FILE_EVENT = 'readydoc-open-file';

export function openFile({ url, name } = {}) {
  if (!url) return;
  if (hosts > 0 && opensInApp(url, name)) {
    window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { url, name: name || nameFromUrl(url) } }));
    return;
  }
  window.open(url, '_blank', 'noopener');
}
