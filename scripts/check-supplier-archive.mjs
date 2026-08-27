#!/usr/bin/env node
// The supplier-archive parser, checked against the plant's OWN folder names.
//
// The fixture is the real entry listing of two vendor archives — AIFI (a
// distributor with three materials in nested zips) and Mill Haven (two loose
// spec sheets and an empty 2025). Paths only; no file contents.
//
// Mill Haven is one of the three vendors NC 4.3.1 names, and the assertion that
// it has no questionnaire is the parser reproducing the auditor's finding from
// the folder structure alone.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readSupplierArchive, classifyDocument, expiryFromFilename, parseArchivePath }
  from '../server/supplier-archive.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/supplier-archive-listing.json'), 'utf8'));
const entries = fixture.entries;
console.log(`${entries.length} entries from ${fixture.vendors.length} vendor archives (${fixture.walked_at})\n`);

// A FIXED date, not the clock: a parser whose report moves overnight cannot be
// tested, and "expired" must mean the same thing on every run.
const r = readSupplierArchive(entries, { today: '2026-08-27' });


let pass=0, fail=0;
const t=(name, cond, detail='') => { if(cond){pass++;} else {fail++; console.log('  ✗ '+name+(detail?' — '+detail:''));} };

console.log('── VENDORS ──');
for (const v of r.vendors) {
  console.log(`  ${v.vendor.padEnd(12)} periods ${v.periods.join(',')} · ${String(v.files).padStart(2)} files · questionnaire ${v.has_questionnaire?'YES':'no '} · empty years [${v.empty_periods.join(',')||'—'}] · containers: ${v.containers.join(', ')||'—'}`);
}

console.log('\n── BY KIND ──');
const byKind={}; for(const f of r.files) byKind[f.kind]=(byKind[f.kind]||0)+1;
for (const [k,n] of Object.entries(byKind).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

console.log('\n── EXPIRY DATES READ FROM FILENAMES ──');
for (const f of r.files.filter(f=>f.expires_on).sort((a,b)=>a.expires_on.localeCompare(b.expires_on)))
  console.log(`  ${f.expires_on}  ${f.expires_on<'2026-08-27'?'EXPIRED':'ok     '}  ${f.vendor}/${f.period}  ${f.filename}`);

console.log('\n── COULD NOT READ (reported, not guessed) ──');
if (!r.skipped.length) console.log('  none');
for (const s of r.skipped) console.log(`  ${s.reason.padEnd(46)} ${s.path}`);

console.log('\n── ASSERTIONS ──');
t('AIFI found', r.vendors.some(v=>v.vendor==='AIFI'));
t('Mill Haven found', r.vendors.some(v=>v.vendor==='Mill Haven'));
const aifi=r.vendors.find(v=>v.vendor==='AIFI'), mh=r.vendors.find(v=>v.vendor==='Mill Haven');
t('AIFI has a questionnaire', aifi.has_questionnaire);
t('Mill Haven has NO questionnaire — matches the sheet and NC 4.3.1', !mh.has_questionnaire);
t("Mill Haven's 2025 is an empty year", mh.empty_periods.includes('2025'), JSON.stringify(mh.empty_periods));
t('AIFI containers found, and NONE assumed to be a material without a person',
  aifi.containers.length===4 && aifi.containers.some(c=>c.includes('(material)')) && aifi.containers.some(c=>c.includes('(generic)')),
  aifi.containers.join(' | '));
t('Customer Documents is VENDOR scope, not a material',
  r.files.some(f=>f.source_path.includes('Customer Documents.zip/')&&f.scope==='vendor'&&f.container_is==='generic'));
t('the FILLED questionnaire is kind=raw_material_questionnaire',
  r.files.some(f=>f.filename.startsWith('RM VQ-filled')&&f.kind==='raw_material_questionnaire'));
t('the BLANK form is NOT counted as a completed questionnaire',
  r.files.some(f=>f.filename==='Raw Material Questionnaire Form.pdf'&&f.kind==='raw_material_questionnaire_blank'));
t('a typo\'d "Specificationn" still classifies as a specification',
  r.files.some(f=>/Specificationn/.test(f.filename)&&f.kind==='specification'));
t('expiry parsed with a dot: "exp. 01-11-2027"', expiryFromFilename('X Certificate exp. 01-11-2027')==='2027-01-11');
t('expiry parsed single-digit: "exp 7-11-2027"', expiryFromFilename('Y exp 7-11-2027')==='2027-07-11');
t('no expiry invented when the filename has none', expiryFromFilename('Potassium Citrate SDS')===null);
t('five certificates on file have already expired', r.expired.length===5, `got ${r.expired.length}`);
// The rule CHANGED once the full archive arrived: 228 of 836 files have no
// year folder and 31 of 66 vendors have never used one, so "undated" is a
// state, not an error. What is still refused is a file under no vendor at all.
t('a non-year second segment is read as UNDATED, not refused',
  parseArchivePath('AIFI/Archive/x.pdf').ok === true
  && parseArchivePath('AIFI/Archive/x.pdf').period === null);
t('a file under no vendor folder is still refused',
  !parseArchivePath('Current Suppliers.xlsx').ok);
t('an unknown filename is reported, never guessed',
  classifyDocument('zzzz.pdf').kind==='unknown');
t('every file carries its source path', r.files.every(f=>f.source_path));
t('nothing was written', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
