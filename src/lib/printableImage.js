// A photo the newsletter PDF can actually draw.
//
// The PDF is made with pdfkit, which draws JPEG and PNG and nothing else — a
// WebP, HEIC or GIF is skipped without a word, so the photo is on the screen
// and missing from the PDF. pdfkit also ignores a JPEG's EXIF rotation, so a
// phone photo taken upright can print on its side.
//
// So the browser, which can show all of those, redraws the photo onto a canvas
// and hands back a JPEG: upright, at most MAX_SIDE pixels on its long side.
// A PNG that is already small enough is left as it is (it may be a logo with a
// transparent background, which a JPEG would fill with black).

const MAX_SIDE = 2000;
const QUALITY = 0.85;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

export async function printableImage(file) {
  if (!file) return file;
  let img;
  try { img = await loadImage(file); } catch {
    // The browser cannot show it either — send it as it is and let the server say so.
    return file;
  }
  const w = img.naturalWidth, h = img.naturalHeight;
  const isPng = /^image\/png$/i.test(file.type);
  if (isPng && Math.max(w, h) <= MAX_SIDE) return file;

  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';                 // a transparent area becomes white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);   // the browser applies the EXIF rotation here
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
  if (!blob) return file;
  const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}
