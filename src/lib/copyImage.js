/**
 * Put an IMAGE on the clipboard — the picture itself, not its link — so it can
 * be pasted straight into a text, an email or a work order.
 *
 * The bytes come through our own origin (the presigned R2 URL is cross-origin
 * and a canvas drawn from it would be tainted), get decoded once, and are
 * re-encoded as PNG — the one image type every clipboard accepts; iOS Safari
 * and Android Chrome both refuse image/jpeg.
 *
 * THE CLIPBOARD CALL HAPPENS SYNCHRONOUSLY INSIDE THE TAP. Safari only honours
 * navigator.clipboard.write() while the user gesture is live, and an `await`
 * on the fetch ends that gesture — so the ClipboardItem is handed a PROMISE of
 * the PNG and the browser waits for it. Chrome accepts the same shape.
 *
 * Returns what actually happened, so the button can say so:
 *   'copied'  — the image is on the clipboard
 *   'shared'  — no clipboard image support here; the share sheet was opened
 *   'none'    — nothing could be done (the caller offers Download)
 */
const canWriteImages = () =>
  typeof navigator !== 'undefined' && !!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined';

export const canCopyImage = canWriteImages();

async function fetchBytes(a) {
  const src = a?.download_url || a?.url;
  if (!src) throw new Error('no source');
  const token = localStorage.getItem('auth_token');
  const res = await fetch(src, a?.download_url
    ? { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    : undefined);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.blob();
}

async function toPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'));
}

export async function copyImage(a, { share } = {}) {
  if (canWriteImages()) {
    try {
      const png = fetchBytes(a).then(toPng);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return 'copied';
    } catch (err) {
      // Permission refused, or a browser that lists the API and then declines
      // the promise form — fall through to the share sheet rather than to a
      // silent nothing.
      if (err?.name === 'AbortError') return 'none';
    }
  }
  if (share && typeof navigator !== 'undefined' && navigator.share) {
    try { await share(a); return 'shared'; } catch { /* fall through */ }
  }
  return 'none';
}
