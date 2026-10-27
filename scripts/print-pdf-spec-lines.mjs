#!/usr/bin/env node
// Print the specification lines of a generated PDF exactly as a reader sees
// them — the quick way to check a certificate or spec sheet prints "≤ 0.5 ppm"
// and not "\"d 0.5 ppm" (D-234, D-239).
//   node scripts/print-pdf-spec-lines.mjs <file.pdf> [pattern]
import { readFileSync } from 'fs';
import { readPdfColumns } from '../server/coa-pdf-text.js';

const [file, pattern] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/print-pdf-spec-lines.mjs <file.pdf> [pattern]'); process.exit(2); }
const re = new RegExp(pattern || '[≤≥<>µ°™]|Specification', 'u');
const { text } = await readPdfColumns(readFileSync(file));
for (const line of text.split('\n')) if (re.test(line)) console.log(line);
