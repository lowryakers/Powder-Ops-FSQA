// Rendering a verification report — the docx Document Control files and signs,
// and an html copy for reading on a phone and printing to PDF.
//
// ONE RENDERER, MANY REPORTS. Each verification supplies its own content
// (`scripts/verification/*.mjs`); this draws it. The first report carried its
// renderer inline, and the second would have copied it — which is how the filed
// copy and the circulated copy start laying out differently for no reason.
//
// A report is: TITLE, HEADER_FIELDS (label/value pairs), DOCUMENT (a list of
// blocks), SIGNATORIES, and the executed results read from the run's own JSON.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageOrientation,
} from 'docx';
import { writeFileSync } from 'fs';
import path from 'path';

export const h1 = (text) => ({ t: 'h1', text });
export const h2 = (text) => ({ t: 'h2', text });
export const p = (text) => ({ t: 'p', text });
export const li = (text) => ({ t: 'li', text });
export const note = (text) => ({ t: 'note', text });
export const RESULTS = { t: 'results' };
export const SIGNATURES = { t: 'signatures' };

export async function renderReport({ title, headerFields, document: DOCUMENT, signatories, results, outDir, basename, resultsFilename }) {
  const passed = results.filter(r => r.verdict === 'PASS').length;
  const failed = results.length - passed;
  const HEADER_FIELDS = headerFields;
  const SIGNATORIES = signatories;
  const TITLE = title;
  const RESULTS_PATH = resultsFilename;
  // ── Renderer: .docx ─────────────────────────────────────────────────────────
  const CONTENT = 9360;            // Letter (12240) less 1" margins each side
  const COLS = [720, 3240, 4600, 800];
  const GREY = 'F3F4F6';
  const RULE = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  const CELL_BORDERS = { top: RULE, bottom: RULE, left: RULE, right: RULE };
  const t = (text, o = {}) => new TextRun({ text, ...o });

  const cell = (children, width, opts = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: 'auto' } : undefined,
    children,
  });

  const cellText = (text, width, opts = {}) => cell(
    [new Paragraph({ children: [t(text, { size: 18, bold: opts.bold, color: opts.color })], spacing: { line: 240 } })],
    width, opts);

  const headerTable = new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [2600, CONTENT - 2600],
    rows: HEADER_FIELDS.map(([label, value]) => new TableRow({
      children: [cellText(label, 2600, { bold: true, shade: GREY }), cellText(value, CONTENT - 2600)],
    })),
  });

  const resultsTable = new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: COLS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['Ref', 'What was tested', 'What happened', 'Result']
          .map((h, i) => cellText(h, COLS[i], { bold: true, shade: GREY })),
      }),
      ...results.map(r => new TableRow({
        children: [
          cellText(r.id, COLS[0], { bold: true }),
          cellText(r.title, COLS[1]),
          cellText(r.actual, COLS[2]),
          cellText(r.verdict === 'PASS' ? 'Met' : 'NOT MET', COLS[3],
            { bold: true, color: r.verdict === 'PASS' ? '15803D' : 'B91C1C' }),
        ],
      })),
    ],
  });

  const SIG_COL = Math.floor(CONTENT / 3);
  const signaturesTable = new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [SIG_COL, SIG_COL, CONTENT - SIG_COL * 2],
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['Role', 'Name and signature', 'Date']
          .map(h => cellText(h, SIG_COL, { bold: true, shade: GREY })),
      }),
      ...SIGNATORIES.map(role => new TableRow({
        children: [
          cellText(role, SIG_COL, { bold: true }),
          cell([new Paragraph({ children: [t('', { size: 21 })], spacing: { before: 300, after: 300 } })], SIG_COL),
          cell([new Paragraph({ children: [t('', { size: 21 })], spacing: { before: 300, after: 300 } })], SIG_COL),
        ],
      })),
    ],
  });

  function docxBlock(b) {
    switch (b.t) {
      case 'h1': return new Paragraph({
        heading: HeadingLevel.HEADING_1, spacing: { before: 340, after: 160 },
        children: [t(b.text, { size: 26, bold: true, color: '111827' })],
      });
      case 'h2': return new Paragraph({
        heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 },
        children: [t(b.text, { size: 22, bold: true, color: '374151' })],
      });
      case 'p': return new Paragraph({
        spacing: { after: 150, line: 280 }, children: [t(b.text, { size: 21 })],
      });
      case 'li': return new Paragraph({
        bullet: { level: 0 }, spacing: { after: 90, line: 280 }, children: [t(b.text, { size: 21 })],
      });
      case 'note': return new Paragraph({
        spacing: { before: 130, after: 150, line: 270 },
        children: [t(b.text, { size: 19, italics: true, color: '4B5563' })],
      });
      case 'results': return resultsTable;
      case 'signatures': return signaturesTable;
      default: throw new Error(`unknown block ${b.t}`);
    }
  }

  const doc = new Document({
    creator: 'Powder Ops',
    title: `ReadyDoc ${TITLE}`,
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
        },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 60 },
          children: [t('POWDER OPS', { size: 20, bold: true, characterSpacing: 40, color: '6B7280' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 240 },
          children: [t(TITLE, { size: 32, bold: true })],
        }),
        headerTable,
        ...DOCUMENT.map(docxBlock),
      ],
    }],
  });


  // ── Renderer: .html (same words; for reading and printing to PDF) ───────────
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function htmlBlocks(blocks) {
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    for (const b of blocks) {
      if (b.t === 'li') { (list ||= []).push(`<li>${esc(b.text)}</li>`); continue; }
      flush();
      if (b.t === 'h1') out.push(`<h2>${esc(b.text)}</h2>`);
      else if (b.t === 'h2') out.push(`<h3>${esc(b.text)}</h3>`);
      else if (b.t === 'p') out.push(`<p>${esc(b.text)}</p>`);
      else if (b.t === 'note') out.push(`<p class="note">${esc(b.text)}</p>`);
      else if (b.t === 'results') out.push(resultsHtml());
      else if (b.t === 'signatures') out.push(signaturesHtml());
    }
    flush();
    return out.join('\n');
  }

  const resultsHtml = () => `<div class="scroll"><table class="results">
  <thead><tr><th>Ref</th><th>What was tested</th><th>What happened</th><th>Result</th></tr></thead>
  <tbody>${results.map(r => `<tr>
  <td class="ref">${esc(r.id)}</td><td>${esc(r.title)}</td><td class="obs">${esc(r.actual)}</td>
  <td class="${r.verdict === 'PASS' ? 'met' : 'unmet'}">${r.verdict === 'PASS' ? 'Met' : 'NOT MET'}</td>
  </tr>`).join('')}</tbody></table></div>`;

  const signaturesHtml = () => `<table class="sig">
  <thead><tr><th>Role</th><th>Name and signature</th><th>Date</th></tr></thead>
  <tbody>${SIGNATORIES.map(r => `<tr><th scope="row">${esc(r)}</th><td></td><td></td></tr>`).join('')}</tbody></table>`;

  const html = `<title>Authentication Verification</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
  <style>
    :root{
      --ink:#1a1d21; --muted:#5b6470; --faint:#8b939e; --rule:#dfe3e8;
      --ground:#fbfaf8; --card:#ffffff; --band:#f2f0ec;
      --met:#1c6b45; --unmet:#a52222; --accent:#1c4f6b;
    }
    @media (prefers-color-scheme: dark){
      :root:not([data-theme="light"]){
        --ink:#e8eaed; --muted:#a3acb8; --faint:#7c8794; --rule:#333a42;
        --ground:#15181c; --card:#1c2026; --band:#242a31;
        --met:#5fca97; --unmet:#f08a8a; --accent:#7fb8d6;
      }
    }
    :root[data-theme="dark"]{
      --ink:#e8eaed; --muted:#a3acb8; --faint:#7c8794; --rule:#333a42;
      --ground:#15181c; --card:#1c2026; --band:#242a31;
      --met:#5fca97; --unmet:#f08a8a; --accent:#7fb8d6;
    }
    *{box-sizing:border-box}
    body{background:var(--ground);color:var(--ink);
      font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
      font-size:16px;line-height:1.6;margin:0;padding:0 1.25rem 5rem;-webkit-text-size-adjust:100%}
    .sheet{max-width:52rem;margin:0 auto;background:var(--card);border:1px solid var(--rule);
      padding:clamp(1.5rem,4vw,3.25rem);margin-top:2rem;border-radius:2px}
    .eyebrow{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);
      font-weight:600;margin:0 0 .5rem}
    h1{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:clamp(1.7rem,4.4vw,2.4rem);
      line-height:1.2;margin:0 0 1.5rem;text-wrap:balance;letter-spacing:-.01em}
    h2{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:1.3rem;line-height:1.3;
      margin:2.4rem 0 .7rem;padding-top:1.1rem;border-top:1px solid var(--rule);text-wrap:balance}
    h3{font-size:.8rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
      color:var(--muted);margin:1.5rem 0 .5rem}
    p{margin:0 0 .95rem;max-width:64ch}
    ul{margin:0 0 1.1rem;padding-left:1.15rem;max-width:64ch}
    li{margin-bottom:.5rem}
    li::marker{color:var(--faint)}
    .note{font-size:.9rem;color:var(--muted);border-left:2px solid var(--rule);
      padding-left:.9rem;margin:1.2rem 0}
    table{border-collapse:collapse;width:100%;font-size:.85rem}
    .meta{margin-bottom:1.5rem}
    .meta th{text-align:left;font-weight:600;width:34%;background:var(--band);color:var(--muted);
      font-size:.78rem}
    .meta th,.meta td{border:1px solid var(--rule);padding:.42rem .6rem;vertical-align:top}
    .meta td{font-variant-numeric:tabular-nums}
    .scroll{overflow-x:auto;margin-bottom:.4rem}
    .results{min-width:36rem}
    .results th{background:var(--band);color:var(--muted);text-align:left;font-size:.74rem;
      letter-spacing:.05em;text-transform:uppercase;font-weight:600}
    .results th,.results td{border:1px solid var(--rule);padding:.42rem .6rem;vertical-align:top}
    .results .ref{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:500;
      white-space:nowrap;color:var(--accent)}
    .results .obs{color:var(--muted);font-size:.8rem}
    .results .met,.results .unmet{font-weight:600;white-space:nowrap}
    .results .met{color:var(--met)} .results .unmet{color:var(--unmet)}
    .sig{margin-top:.5rem}
    .sig th{background:var(--band);color:var(--muted);text-align:left;font-size:.74rem;
      letter-spacing:.05em;text-transform:uppercase;font-weight:600}
    .sig th,.sig td{border:1px solid var(--rule);padding:.5rem .6rem}
    .sig tbody th{text-transform:none;letter-spacing:0;font-size:.85rem;color:var(--ink);width:30%}
    .sig tbody td{height:2.9rem}
    .foot{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--rule);
      font-size:.75rem;color:var(--faint)}
    @media print{
      body{background:#fff;padding:0}
      .sheet{border:0;margin:0;padding:0;max-width:none}
      h2{break-after:avoid} tr{break-inside:avoid}
    }
  </style>
  <div class="sheet">
    <p class="eyebrow">Powder Ops · ReadyDoc</p>
    <h1>${esc(TITLE)}</h1>
    <table class="meta"><tbody>
      ${HEADER_FIELDS.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v ? esc(v) : '&nbsp;'}</td></tr>`).join('\n    ')}
    </tbody></table>
    ${htmlBlocks(DOCUMENT)}
    <p class="foot">Uncontrolled when printed — verify the revision against the registry.
      Generated from the recorded run ${esc(RESULTS_PATH)}.</p>
  </div>`;



  writeFileSync(path.join(outDir, `${basename}.docx`), await Packer.toBuffer(doc));
  writeFileSync(path.join(outDir, `${basename}.html`), html);
  return { passed, failed, total: results.length };
}
