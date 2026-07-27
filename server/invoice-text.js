// Pull the text out of an uploaded invoice so search covers what's INSIDE the
// file, not just its filename. PDFs go through pdfjs; photos and scans go
// through AI vision OCR. Shared by supply invoices and AP/AR bills.
// Failures return '' so a broken file isn't retried forever.
import { aiEnabled, transcribeImage } from './ai.js';
import { extractPdfText } from './api/documents.js';

export async function extractInvoiceText(buffer, contentType, filename) {
  try {
    const isPdf = /pdf/i.test(contentType || '') || /\.pdf$/i.test(filename || '');
    if (isPdf) {
      // extractPdfText returns { text, pages }. Scanned PDFs with no text
      // layer yield '' — nothing else to try without page rendering.
      const res = await extractPdfText(buffer);
      const text = typeof res === 'string' ? res : (res?.text || '');
      return text.trim().slice(0, 20000);
    }
    if (/^image\//i.test(contentType || '') && aiEnabled()) {
      const mediaTypes = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp', 'image/gif': 'image/gif' };
      const mt = mediaTypes[(contentType || '').toLowerCase()];
      if (mt) {
        const text = await transcribeImage(buffer, mt);
        return (text || '').trim().slice(0, 20000);
      }
    }
  } catch (e) {
    console.warn('[invoices] text extraction failed:', e.message);
  }
  return '';
}
