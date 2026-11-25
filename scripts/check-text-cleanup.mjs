// D-403: leftover formatting in a controlled document. Pure — no server.
//   - the clean-up removes stray backslashes, extra spaces, invisible characters,
//     extra blank lines, empty table rows and columns, and changes no words;
//   - it leaves structure alone ("\- " at a line start, "1\." , "\|" in a cell,
//     a "\*" that could pair up);
//   - the readers (screen splitter, PDF text and table cells) print it tidily
//     even before the text is cleaned.
import PDFDocument from 'pdfkit';
import { cleanDocumentText, unescapeMarkdown, plainInline, splitTableRow, isWholeBold } from '../shared/markdown-text.js';
import { parseBlocks, serializeBlocks } from '../shared/markdown-blocks.js';
import { tableAt, drawTable } from '../server/pdf-table.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const words = (s) => s.replace(/[\\|*\-+\s ​-‍﻿]+/g, ' ').trim().split(' ').filter(Boolean).filter(w => !/^-+$/.test(w));

const SOURCE = [
  '## Scope',
  '',
  'Botanical  Powders \\- organoleptic test​  ',
  '',
  '',
  '',
  '- item one',
  '\\- not a list',
  '1\\. one',
  '',
  '| Material  Format | Example | Every Batch |  |',
  '| --- | --- | --- | --- |',
  '| **Raw Materials** |  |  |  |',
  '|  |  |  |  |',
  '| Botanical  Powders | Ginger Powder | \\-organoleptic | |',
  '| Mix a\\|b | Chromium | \\-Micro Panel\\* \\+ coli | |',
].join('\n');

console.log('\n── the clean-up ──');
const r = cleanDocumentText(SOURCE);
t('it finds something to do', r.total > 0, JSON.stringify(r.changes));
t('stray backslashes counted', r.changes.escapes >= 4, String(r.changes.escapes));
t('a cell\'s "\\-organoleptic" becomes "-organoleptic"', r.text.includes('| -organoleptic |'), r.text);
t('a lone footnote star loses its backslash', r.text.includes('-Micro Panel* + coli'), r.text);
t('"\\- " at the start of a line stays (it would become a bullet)', r.text.includes('\n\\- not a list'));
t('"1\\." stays (it would become a numbered list)', r.text.includes('\n1\\. one'));
t('an escaped pipe inside a cell stays', r.text.includes('Mix a\\|b'));
t('doubled spaces collapse', r.text.includes('Botanical Powders') && !r.text.includes('Material  Format'));
t('a non-breaking space becomes a space, an invisible character goes', r.text.includes('organoleptic test') && !/[​ ]/.test(r.text));
t('extra blank lines go', !r.text.includes('\n\n\n'));
t('the empty table row goes', r.changes.empty_rows === 1 && !r.text.includes('|  |  |  |'));
t('the empty column goes', r.changes.empty_columns === 1 && r.text.includes('| Material Format | Example | Every Batch |\n'), r.text);
t('NO WORD IS ADDED OR LOST', JSON.stringify(words(SOURCE)) === JSON.stringify(words(r.text)), `${words(SOURCE).length} vs ${words(r.text).length}`);
const again = cleanDocumentText(r.text);
t('cleaning twice changes nothing more', again.total === 0 && again.text === r.text, JSON.stringify(again.changes));
const tidy = '## A\n\n| a | b |\n| --- | --- |\n| x | y |';
t('tidy text: nothing to do, text untouched', cleanDocumentText(tidy).total === 0 && cleanDocumentText(tidy).text === tidy);
t('an unpaired ** is reported, never changed', cleanDocumentText('**Raw Material\n').checks.unmatched_bold === 1
  && cleanDocumentText('**Raw Material\n').text.includes('**Raw Material'));
t('a \\* that could pair with another star stays escaped', cleanDocumentText('a \\*b\\* c').text === 'a \\*b\\* c');

console.log('\n── the readers ──');
t('unescapeMarkdown: "\\-" → "-", "\\\\" → "\\"', unescapeMarkdown('a\\-b \\\\c') === 'a-b \\c');
t('plainInline: markers off, escapes undone, an escaped star is not italics', plainInline('\\*x\\* **bold** *it*') === '*x* bold it');
t('splitTableRow keeps "\\|" inside its cell', JSON.stringify(splitTableRow('| a\\|b | c |')) === JSON.stringify(['a|b', 'c']));
const blk = parseBlocks('| h1 | h2 |\n| --- | --- |\n| a\\|b | c |')[0];
t('the block editor reads "\\|" as one cell…', JSON.stringify(blk.rows[0]) === JSON.stringify(['a|b', 'c']), JSON.stringify(blk.rows));
t('…and writes it back the same', serializeBlocks([blk]).includes('| a\\|b | c |'));
t('a whole-bold cell is bold', isWholeBold('**Raw Materials**') && !isWholeBold('**Raw** Materials x'));
const pdf = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
const drawn = [];
const realText = pdf.text.bind(pdf);
pdf.text = (str, ...rest) => { drawn.push({ str: String(str), font: pdf._font?.name || '' }); return realText(str, ...rest); };
const lines = SOURCE.split('\n');
const at = lines.findIndex(l => l.startsWith('| Material'));
drawTable(pdf, tableAt(lines, at), { left: 50, width: 512, pageBottom: 742 });
const printed = drawn.map(d => d.str);
t('the PDF prints "-organoleptic", not "\\-organoleptic"', printed.includes('-organoleptic') && !printed.some(x => x.includes('\\-')), JSON.stringify(printed));
t('the PDF prints the pipe inside a cell as one cell', printed.includes('Mix a|b'));
const rawBold = drawn.find(d => d.str === 'Raw Materials');
t('the PDF prints "**Raw Materials**" as bold words, without stars', !!rawBold && /Bold/i.test(rawBold.font), JSON.stringify(rawBold));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
