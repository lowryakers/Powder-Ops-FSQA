/**
 * Hand a stored file to the phone's native share sheet — text it, AirDrop it,
 * drop it into WhatsApp — via the Web Share API, with the actual FILE attached,
 * not a link that would demand a ReadyDoc login from whoever receives it.
 *
 * The bytes come through our own origin where possible (same reason comms
 * downloads do — a presigned R2 URL is cross-origin). Fallback ladder: share
 * the link, then copy it — every rung ends with the person able to send
 * something.
 */
export async function shareFile(a) {
  const src = a?.download_url || a?.url;
  if (!src) return;
  try {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(src, a?.download_url
      ? { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      : undefined);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const file = new File([blob], a.filename || 'file', { type: a.content_type || blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    throw new Error('file share unsupported');
  } catch (err) {
    if (err?.name === 'AbortError') return; // the person closed the sheet
    try {
      if (navigator.share) { await navigator.share({ title: a.filename, url: a.url || src }); return; }
    } catch (e2) { if (e2?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(a.url || src); window.alert('Link copied — sharing files is not supported in this browser.'); }
    catch { window.open(a.url || src, '_blank', 'noopener'); }
  }
}

// Hidden where the API doesn't exist (desktop Firefox) rather than offered to fail.
export const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
