// verify:deviationform — D-151, live on a fresh database.
//
// Quality attaches every deviation to its MO in MRPEasy, and the export was the
// generic list layout with a garbled product description. This downloads a
// deviation the way the screen does and reads the PDF back: it must BE Form
// 442-01 (the form's sections, its own wording, its footer), and characters
// outside the old built-in font must print as themselves, not as raw bytes.
//
// Caller sets PORT + DBPATH (server up). The control is `main`: no "Deviation
// Report", no "Product Discription:", and "ÿ%ÿL…" where "Electrolyte" was typed.
import Database from 'better-sqlite3';
import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

const PORT = Number(process.env.PORT || 5067);
const B = `http://localhost:${PORT}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('dv-admin','Dev Form Admin','Dev Form Admin','admin','qa',1,'SC-dv',datetime('now','+7 day'))`).run();
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/set-password', { user_id: 'dv-admin', password: 'Passw0rd!!', setup_code: 'SC-dv' });
const me = await J(await c('POST', '/users/login', { name: 'Dev Form Admin', password: 'Passw0rd!!' }));
const A = (m, p, b) => c(m, p, b, me?.token);
t('an admin in QA signs in', !!me?.token);

// The description pasted the way product names arrive from other systems:
// full-width letters, a Cyrillic word and an emoji beside plain text.
const product = 'Ｅｌｅｃｔｒｏｌｙｔｅ Hydration Finished Pouch 30ct (Watermelon Hibiscus) Гидратация 💧';
const dev = await J(await A('POST', '/qms/deviation', {
  record_date: '2026-08-21', initiator: 'Maria Servin', change_type: 'Temporary', deviation_type: 'Bill of Material',
  product_description: product, lot: '101794', item_number: '202719',
  description: 'The formula indicated to use 202186 (CN931) Vitamin B12 (Methylcobalamin)(Pure) but there was a change to 202497 (CN931) Vitamin B12 (Methylcobalamin)(1%). Matt approved to run with that change.',
  impact: 'Different intensity on each Vitamin B12', start_date: '2026-08-21', end_date: '2026-08-21', capa_needed: false,
}));
t('a deviation is filed', !!dev?.id, JSON.stringify(dev)?.slice(0, 200));
let r = await A('POST', `/qms/deviation/${dev.id}/approve`, { role: 'qa_director', signature_password: 'Passw0rd!!' });
t('QA signs it', r.ok, String(r.status));

const pdfText = async (res) => {
  const buf = new Uint8Array(await res.arrayBuffer());
  const raw = Buffer.from(buf).toString('latin1');   // before pdf.js takes the buffer
  const doc = await pdfjs.getDocument({ data: buf, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join(' '));
  return { pages, raw };
};
r = await A('GET', `/qms/deviation/${dev.id}/pdf`);
t('the export downloads as a PDF', r.ok && /pdf/.test(r.headers.get('content-type') || ''));
const { pages, raw } = await pdfText(r);
const p1 = pages[0] || '';
console.log('\n── it is Form 442-01 ──');
for (const s of ['Deviation Report', 'Deviation Information:', 'Deviation Control #:', 'Initiator:', 'Room#:', 'Change type:',
  'Protocol Deviation:', 'Document Or Policy', 'Procedure Or Policy', 'Bill Or Material', 'Deviation Description:',
  'Product Discription:', 'Lot:', 'Item #:', 'Deviation Impact / Comments', 'Deviation Start Date:', 'Deviation End Date:',
  'Is a CAPA needed for this deviation:', 'CAPA#:', 'Comments:', 'Deviation Approval:', 'Manufacturing Manager and / or disignee:',
  'QA Director', 'Customer:', 'Form 442-01', 'Rev1']) {
  t(`page 1 carries the form's "${s}"`, p1.includes(s));
}
t('the form\'s own spellings are kept ("Discription", "disignee") — correcting them is a DCR, not an export', /Discription/.test(p1) && /disignee/.test(p1));
t('the record\'s values sit in the form', ['101794', '202719', 'Maria Servin', '08/21/2026', 'Different intensity on each Vitamin B12'].every(v => p1.includes(v)));
t('the QA signature prints with its signer', /Dev Form Admin\s+\(electronically signed in ReadyDoc\)/.test(p1));
t('the record history is on page 2, titled as NOT part of the form', pages.length === 2 && /Record history/.test(pages[1]) && /Not part of Form 442-01/.test(pages[1]));
t('the footer counts the pages truthfully', p1.includes('Page 1 of 2') && (pages[1] || '').includes('Page 2 of 2'));

console.log('\n── the product description prints as typed ──');
t('full-width letters print as the word they are ("Electrolyte")', p1.includes('Electrolyte Hydration Finished Pouch'), p1.slice(0, 600));
t('a Cyrillic word prints as itself', p1.includes('Гидратация'));
t('no raw UTF-16 bytes ("ÿ%", "Ø=") anywhere on the page', !/ÿ[%LEC]|Ø=/.test(p1));
t('the text is in the embedded Unicode font', raw.includes('LiberationSans'));

console.log('\n── every other record type gets the font too ──');
const nc = await J(await A('POST', '/qms/non_conformance', { record_date: '2026-08-22', description: 'Ｌａｂｅｌ smudged on Гидр pouch' }));
r = await A('GET', `/qms/non_conformance/${nc?.id}/pdf`);
const ncText = r.ok ? (await pdfText(r)).pages.join(' ') : '';
t('a non-conformance export prints the same characters cleanly', r.ok && ncText.includes('Label smudged on Гидр pouch') && !/ÿ|Ø=/.test(ncText),
  ncText.slice(0, 300));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
