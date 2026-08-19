// Framing a PDF without handing the reader a sidebar they didn't ask for.
//
// An <iframe> pointed at a PDF gets the browser's built-in viewer, and Chrome's
// opens its THUMBNAIL PANE by default. In a full window that is merely extra
// furniture; in the docked Split Screen panel (~420px) or a preview card it
// eats half the width, so the page itself renders as a stamp beside a strip of
// thumbnails — the "small double pane view".
//
// The PDF Open Parameters go in the FRAGMENT, after any query string, so a
// presigned R2 URL (which is nothing but query string) is untouched:
//   navpanes=0  the thumbnail/bookmark pane, which is the second pane
//   pagemode=none  the same intent for Firefox and Acrobat
//   view=FitH   fit the page WIDTH — the half of "small double pane" that
//               remains once the sidebar is gone
// The toolbar is deliberately kept: zoom, print and page number are the
// controls people actually reach for, and hiding them to gain 30px would trade
// one complaint for another.
//
// Unsupported parameters are ignored rather than erroring, so a viewer that
// doesn't implement them renders exactly as it does today.

const PDF_VIEW = 'navpanes=0&pagemode=none&view=FitH';

/**
 * Call this ONLY where the caller has already decided the file is a PDF — every
 * call site is inside its own `isPdf` branch. Deliberately no extension sniffing
 * here: a blob: URL carries no `.pdf`, and re-testing for one is the same trap
 * that made every blob-fetched PDF fall through to the download card
 * (see the note in FilePreview.jsx).
 *
 * @param url  a PDF URL — https, blob:, anything the viewer can open.
 * @returns    the URL with the viewer hints appended, or unchanged when it
 *             already carries a fragment: a caller that asked for a specific
 *             page must win, and a second `#` would navigate nowhere.
 */
export function pdfViewerUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('#')) return url;
  return `${url}#${PDF_VIEW}`;
}
