// The two Google Drive vendor zips verify-supplier-storage.mjs attaches, rebuilt
// from the repository's own listing (D-125). The originals were read from one
// session's uploads folder, so the check was red for everybody else — the D-120
// rot, missed. The real zips hold vendor documents and do not belong in the
// repository, so the PATHS are the plant's (scripts/fixtures/supplier-archive-
// full.json) and the BYTES are small stand-in PDFs.
//
// The nested certificate zip is deliberately larger than one storing batch
// (STORE_BATCH = 60 in server/api/suppliers.js), because the batching is what
// the script exists to test: a vendor zip that fits in one request proves
// nothing about the 502 the batches were built to avoid.
import AdmZip from 'adm-zip';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';

const listing = JSON.parse(readFileSync(new URL('../fixtures/supplier-archive-full.json', import.meta.url), 'utf8'));

// A real PDF with a text layer: the storing path extracts text for search, and
// a stand-in with none would pass the batching and fail the extraction checks.
function pdf(label) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(14).text('ReadyDoc verification stand-in document');
    doc.fontSize(11).text(label);
    doc.text('Certificate of Analysis. Lot released. Results within specification.');
    doc.end();
  });
}

async function vendorZip(vendor, extraNested = null) {
  const zip = new AdmZip();
  for (const path of listing.entries.filter(p => p.startsWith(`${vendor}/`))) {
    if (/\.zip$/i.test(path)) {
      const inner = new AdmZip();
      const n = extraNested && path.endsWith(extraNested.name) ? extraNested.count : 2;
      for (let i = 1; i <= n; i++) inner.addFile(`Certificate of Analysis Lot ${1000 + i}.pdf`, await pdf(`${path} #${i}`));
      zip.addFile(path, inner.toBuffer());
    } else {
      zip.addFile(path, await pdf(path));
    }
  }
  return zip.toBuffer();
}

/** Keyed by the filename the script asks for. Async: the PDFs are rendered. */
export async function driveZip(name) {
  if (/AIFI/i.test(name)) return vendorZip('AIFI', { name: 'Potassium Citrate.zip', count: 75 });
  if (/Mill_Haven|Mill Haven/i.test(name)) return vendorZip('Mill Haven');
  throw new Error(`no stand-in for ${name}`);
}
