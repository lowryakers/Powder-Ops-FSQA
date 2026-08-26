// Fetching a file the app generates and handing it to the browser.
//
// These endpoints are behind a session, and a browser following a plain <a
// href> cannot attach an Authorization header — so the bytes are fetched, held
// as a blob, and given to a synthetic link. Same reason /uploads needed a
// cookie rather than a token.
//
// COAPanel already had two private copies of this; new callers use this one.
export async function downloadFile(path, filename) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    // An error here is an ANSWER (403, 404), not a network outage — surface it
    // rather than leaving the button looking like it did nothing.
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.click();
  URL.revokeObjectURL(url);
}

export default downloadFile;
