// Putting text on the clipboard.
//
// `navigator.clipboard` is unavailable in older iOS Safari when the app is run
// from a home-screen icon — which is exactly where this gets used — so the
// textarea + execCommand fallback is load-bearing, not belt-and-braces.
//
// One definition, imported by every module that copies. Two of these drift:
// one grows the fallback, the other does not, and the module without it
// silently stops copying on somebody's phone.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}
