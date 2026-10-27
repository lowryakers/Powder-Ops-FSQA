// The public certificate page, its JSON and its PDF (D-247, task E4). It
// renders ONLY the public snapshot built by coa-public-snapshot.js — it is
// handed that object and nothing else, so it cannot print a field the
// snapshot did not carry. Inline CSS only (the page's CSP allows nothing else),
// light and dark, readable on a phone.
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces } from './pdf-unicode.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d ? String(d) : '—';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

const CSS = `
:root{--bg:#f6f7f4;--card:#ffffff;--ink:#1d231f;--muted:#5d665f;--line:#dfe3dc;--pass:#1f7a46;--pass-bg:#e5f3ea;--fail:#a3261d;--fail-bg:#fbe8e6;--accent:#2f5d50;--warn-bg:#fff4dc;--warn:#7a5200}
@media (prefers-color-scheme:dark){:root{--bg:#111513;--card:#1a201c;--ink:#e8ece6;--muted:#a3aca4;--line:#2d3530;--pass:#7fd3a0;--pass-bg:#173525;--fail:#f19a90;--fail-bg:#3a1a17;--accent:#9cc9b8;--warn-bg:#3a2e12;--warn:#f2cf7c}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;padding:24px 16px 48px}
main{max-width:760px;margin:0 auto;display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
h1{font-size:26px;line-height:1.2;margin:4px 0 8px;text-wrap:balance}
h2{font-size:17px;margin:0 0 10px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0 0}
.facts div{min-width:0}.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:2px 0 0;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.tbl{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:15px}
th{text-align:left;font-size:12px;font-weight:600;color:var(--muted);padding:8px 8px 8px 0;border-bottom:1px solid var(--line)}
td{padding:10px 8px 10px 0;border-bottom:1px solid var(--line);vertical-align:top;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}.method{display:block;font-size:12px;color:var(--muted)}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600}
.pass{background:var(--pass-bg);color:var(--pass)}.fail{background:var(--fail-bg);color:var(--fail)}
.gf{display:flex;gap:12px;align-items:center;border-color:var(--pass)}.gf b{color:var(--pass)}
.banner{background:var(--warn-bg);color:var(--warn);border-radius:12px;padding:12px 16px}
.note{font-size:14px;color:var(--muted)}a{color:var(--accent)}
ul.list{list-style:none;padding:0;margin:0;display:grid;gap:8px}ul.list li{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:8px 0}
form{display:grid;gap:10px}label{display:grid;gap:4px;font-size:14px}input{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
button{font:inherit;font-weight:600;padding:10px 14px;border-radius:10px;border:0;background:var(--accent);color:var(--card);cursor:pointer}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
footer{max-width:760px;margin:16px auto 0;font-size:13px;color:var(--muted)}
`;

export function page(title, body, { base = '/tested' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main>
<footer>Certificates of Analysis published by Powder Ops. <a href="${esc(base)}/verify">Check a certificate</a>.</footer></body></html>`;
}

const outcome = (o) => (o ? `<span class="pill ${o === 'Pass' ? 'pass' : 'fail'}">${esc(o)}</span>` : '—');

/** One batch's certificate. `banner` is the superseded notice, or null. */
export function certificateHtml(s, { base = '/tested', banner = null } = {}) {
  const rows = s.results.map(r => `<tr><td>${esc(r.test)}${r.method ? `<span class="method">${esc(r.method)}</span>` : ''}</td>
<td>${esc(r.result ?? '—')}${r.unit && r.result ? ` ${esc(r.unit)}` : ''}</td><td>${esc(r.limit ?? '—')}</td><td>${outcome(r.outcome)}</td></tr>`).join('');
  const others = s.other_batches?.length ? `<p class="note">Other batches of this lot: ${s.other_batches.map(o => `<a href="${esc(base)}/c/${esc(o.public_id)}">batch ${esc(o.batch ?? '—')}</a>`).join(', ')}.</p>` : '';
  return page(`${s.product} — lot ${s.lot_number}`, `
${banner ? `<div class="banner" role="status">${banner}</div>` : ''}
<section class="card"><p class="eyebrow">Certificate of Analysis</p><h1>${esc(s.product)}</h1>
<dl class="facts"><div><dt>Lot</dt><dd>${esc(s.lot_number)}</dd></div><div><dt>Certificate</dt><dd>${esc(s.certificate_number)}</dd></div>
<div><dt>Issued</dt><dd>${esc(fmtDate(s.date_of_issuance))}</dd></div><div><dt>Tested</dt><dd>${esc(fmtDate(s.tested_on))}</dd></div>
${s.best_by ? `<div><dt>Best by</dt><dd>${esc(fmtDate(s.best_by))}</dd></div>` : ''}</dl>${others}</section>
${s.gluten_free ? `<section class="card gf"><span class="pill pass">Gluten-free</span><b>${esc(s.gluten_free.text)}</b></section>` : ''}
<section class="card"><h2>Results</h2><div class="tbl"><table><thead><tr><th>Test</th><th>Result</th><th>Limit</th><th>Outcome</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No results to show.</td></tr>'}</tbody></table></div></section>
<section class="card"><p><b>Approved by ${esc(s.approved_by)}.</b> ${esc(s.statement)}</p>
<p class="note"><a href="${esc(base)}/c/${esc(s.public_id)}.pdf">Download as PDF</a> · <a href="${esc(base)}/lot/${esc(s.product_slug)}/${encodeURIComponent(s.lot)}">Whole lot</a> · <a href="${esc(base)}/sku/${esc(s.product_slug)}">All lots of ${esc(s.product)}</a></p></section>`, { base });
}

export function tombstoneHtml({ base = '/tested', withdrawnOn }) {
  return page('Certificate withdrawn', `<section class="card"><p class="eyebrow">Certificate of Analysis</p><h1>This certificate was withdrawn</h1>
<p>Powder Ops withdrew this certificate on ${esc(fmtDate(withdrawnOn))}. It no longer describes a released lot. Contact Powder Ops if you need to know more.</p></section>`, { base });
}

export function lotHtml({ base = '/tested', product, lot, batches }) {
  return page(`${product} — lot ${lot}`, `<section class="card"><p class="eyebrow">Lot</p><h1>${esc(product)} · lot ${esc(lot)}</h1>
<ul class="list">${batches.map(b => `<li><span>Batch ${esc(b.batch ?? '—')} · certificate ${esc(b.certificate_number)}</span><a href="${esc(base)}/c/${esc(b.public_id)}">View</a></li>`).join('')}</ul></section>`, { base });
}

export function skuHtml({ base = '/tested', product, slug, lots }) {
  return page(`${product} — certificates`, `<section class="card"><p class="eyebrow">Certificates of Analysis</p><h1>${esc(product)}</h1>
<ul class="list">${lots.map(l => `<li><span>Lot ${esc(l.base_lot)} · ${l.batches} batch${l.batches === 1 ? '' : 'es'} · issued ${esc(fmtDate(l.issued))}</span><a href="${esc(base)}/lot/${esc(slug)}/${encodeURIComponent(l.base_lot)}">View</a></li>`).join('') || '<li>No certificates published yet.</li>'}</ul></section>`, { base });
}

export function verifyHtml({ base = '/tested', cert = '', lot = '', found = null, asked = false }) {
  const answer = !asked ? '' : found
    ? `<section class="card"><h2>That certificate is genuine.</h2><p>Certificate ${esc(found.certificate_number)} for lot ${esc(found.lot_number)} of ${esc(found.product)} is published by Powder Ops. <a href="${esc(base)}/c/${esc(found.public_id)}">View it</a>.</p></section>`
    : `<section class="card"><h2>No match.</h2><p>No published certificate has that number and lot together. Check both, exactly as printed.</p></section>`;
  return page('Check a certificate', `<section class="card"><p class="eyebrow">Check a certificate</p><h1>Is this certificate genuine?</h1>
<form method="get" action="${esc(base)}/verify"><label for="cert">Certificate number<input id="cert" name="cert" value="${esc(cert)}" required inputmode="numeric" autocomplete="off"></label>
<label for="lot">Lot<input id="lot" name="lot" value="${esc(lot)}" required autocomplete="off"></label><button type="submit">Check</button></form></section>${answer}`, { base });
}

export function embedHtml({ base = '/tested', product, slug, latest }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(product)}</title>
<style>${CSS}body{padding:8px}</style></head><body><div class="card"><p class="eyebrow">Tested by Powder Ops</p><b>${esc(product)}</b>
<p class="note">${latest ? `Latest lot ${esc(latest)}. ` : ''}<a href="${esc(base)}/sku/${esc(slug)}" target="_blank" rel="noopener">See the certificates</a></p></div></body></html>`;
}

export const NOT_FOUND_HTML = page('Not found', '<section class="card"><h1>Not found</h1><p>There is nothing here.</p></section>');

/** The PDF of one public certificate. Pipes into `out`; returns the doc. */
export function certificatePdf(s, out, { banner = null } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Certificate of Analysis — ${s.product} lot ${s.lot_number}`, Author: 'Powder Ops' } });
  embedUnicodeFaces(doc);
  doc.pipe(out);
  doc.font('Helvetica').fontSize(10).fillColor('#5d665f').text('CERTIFICATE OF ANALYSIS');
  doc.moveDown(0.2).font('Helvetica-Bold').fontSize(20).fillColor('#1d231f').text(s.product);
  if (banner) doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).fillColor('#7a5200').text(banner);
  doc.moveDown(0.6).font('Helvetica').fontSize(10).fillColor('#1d231f');
  const facts = [['Lot', s.lot_number], ['Certificate', s.certificate_number], ['Issued', fmtDate(s.date_of_issuance)], ['Tested', fmtDate(s.tested_on)]];
  if (s.best_by) facts.push(['Best by', fmtDate(s.best_by)]);
  for (const [k, v] of facts) doc.text(`${k}: ${v ?? '—'}`);
  if (s.gluten_free) doc.moveDown(0.6).font('Helvetica-Bold').fillColor('#1f7a46').text(s.gluten_free.text).fillColor('#1d231f');
  doc.moveDown(0.8);
  const cols = [50, 250, 360, 480];
  const head = ['Test', 'Result', 'Limit', 'Outcome'];
  let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9);
  head.forEach((h, i) => doc.text(h, cols[i], y, { width: (cols[i + 1] || 562) - cols[i] - 6 }));
  y = doc.y + 4; doc.moveTo(50, y).lineTo(562, y).strokeColor('#dfe3dc').stroke();
  doc.font('Helvetica').fontSize(9);
  for (const r of s.results) {
    y += 6;
    if (y > 700) { doc.addPage(); y = 50; }
    const cells = [r.method ? `${r.test}\n${r.method}` : r.test, r.result ? `${r.result}${r.unit ? ` ${r.unit}` : ''}` : '—', r.limit || '—', r.outcome || '—'];
    let h = 0;
    cells.forEach((c, i) => { const w = (cols[i + 1] || 562) - cols[i] - 6; doc.text(String(c), cols[i], y, { width: w }); h = Math.max(h, doc.heightOfString(String(c), { width: w })); });
    y += h + 4; doc.moveTo(50, y).lineTo(562, y).strokeColor('#dfe3dc').stroke();
  }
  doc.x = 50; doc.y = y + 16;
  doc.font('Helvetica-Bold').fontSize(10).text(`Approved by ${s.approved_by}.`, 50, doc.y, { width: 512 });
  doc.font('Helvetica').text(s.statement, { width: 512 });
  doc.end();
  return doc;
}
