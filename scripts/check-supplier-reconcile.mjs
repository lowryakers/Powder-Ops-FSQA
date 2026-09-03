#!/usr/bin/env node
// The reconciliation, checked against BOTH real sources: Jake's tracker as at
// 8/6/2026 and the full 836-path archive listing.
//
// The point of the check is not that the numbers are pretty. It is that the two
// sources DISAGREE, that the disagreement is reported in both directions, and
// that no vendor is silently matched to another on a weak name similarity.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readSupplierArchive } from '../server/supplier-archive.js';
import { reconcileSuppliers, matchStrength } from '../server/supplier-reconcile.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures', p), 'utf8'));

const tracker = read('supplier-tracker.json');
const listing = read('supplier-archive-full.json');
const archive = readSupplierArchive(listing.entries, { today: '2026-08-27' });
const r = reconcileSuppliers(tracker.rows, archive);

console.log(`tracker ${tracker.rows.length} rows (${tracker.read_at}) · archive ${listing.entries.length} paths (${listing.walked_at})\n`);
console.log('── COUNTS ──');
for (const [k, v] of Object.entries(r.counts)) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log('\n── DISAGREEMENTS ──');
for (const d of r.disagreements) {
  console.log(`  ${String(d.vendors.length).padStart(3)}  ${d.label}`);
  console.log(`       ${d.vendors.slice(0, 8).join(', ')}${d.vendors.length > 8 ? `, +${d.vendors.length - 8} more` : ''}`);
}
console.log('\n── NON-EXACT MATCHES (each needs a person) ──');
const fuzzy = r.vendors.filter(v => v.matched && v.matched !== 'exact');
for (const v of fuzzy) console.log(`  ${v.matched.padEnd(9)} ${v.name}`);

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); } };

console.log('\n── ASSERTIONS ──');
// The sources disagree, and that is the finding.
t('the two sources disagree about a large share of the roster', r.counts.disagreeing >= 40, `${r.counts.disagreeing}`);
t('disagreement is reported in BOTH directions',
  r.disagreements.some(d => d.kind === 'tracker_says_no_questionnaire_but_folder_has_one')
  && r.disagreements.some(d => d.kind === 'tracker_says_questionnaire_but_none_on_file'));

// The headline is derived and honest about the union of both sources.
const sheetOnlyGap = tracker.rows.filter(x => String(x['Actively Using']).trim() === '1'
  && String(x['Questionnaire Completed']).trim() !== '1').length;
t("the tracker alone says 24 active vendors lack a questionnaire", sheetOnlyGap === 24, `${sheetOnlyGap}`);
t('reconciled, the real gap is SMALLER than the tracker claims',
  r.counts.active_with_none < sheetOnlyGap, `${r.counts.active_with_none} vs ${sheetOnlyGap}`);
t('every active vendor is either covered or counted, never both',
  r.counts.active === r.counts.active_with_questionnaire_somewhere + r.counts.active_with_none);

// Matching must be conservative. A three-letter name must NOT claim a folder.
t('a 3-character name does not match inside a longer one (GNT vs Exberry-GNT)',
  matchStrength('GNT', 'Exberry-GNT') === null);
t('a real suffix difference matches (Mill Haven vs Mill Haven Foods)',
  matchStrength('Mill Haven', 'Mill Haven Foods') === 'suffix');
t('an exact name matches exactly', matchStrength('Sabinsa', 'Sabinsa') === 'exact');
t('unrelated names never match', matchStrength('Prinova', 'Sabinsa') === null);
t('every non-exact match is surfaced for confirmation, not applied silently',
  fuzzy.length > 0 && fuzzy.every(v => v.matched === 'suffix' || v.matched === 'contains'));
t('no folder is claimed twice', new Set(r.vendors.filter(v => v.has_folder).map(v => v.name)).size
  === r.vendors.filter(v => v.has_folder).length);

// The vendors the audit named.
const byName = (n) => r.vendors.find(v => v.name.toLowerCase().startsWith(n.toLowerCase()));
t('Mill Haven — NC 4.3.1 — is reconciled and still has no questionnaire',
  byName('Mill Haven') && !byName('Mill Haven').tracker_questionnaire && !byName('Mill Haven').folder_questionnaire);
t('M4 Dynamic — NC 4.3.1 — is active with no folder at all',
  byName('M4 Dynamic')?.issues.includes('active_with_no_folder'));
t('Bay State Milling — NC 4.3.1 — appears in neither source', !byName('Bay State'));

// The evidence travels with the disagreement so nobody has to go and look.
const withFolder = r.vendors.filter(v => v.has_folder);
t('a vendor with a folder reports its file count', withFolder.every(v => typeof v.files === 'number'));
t('unexpanded containers are reported, so a false negative is visible',
  withFolder.some(v => v.unexpanded_containers > 0));
// "Nothing was written" used to be `t(..., true)` — a hardcoded pass. The
// module is PURE by doctrine, and pure is checkable: it must import nothing
// that can reach a disk or a database.
{
  const src = (await import('fs')).readFileSync(new URL('../server/supplier-reconcile.js', import.meta.url), 'utf8');
  const canWrite = /from\s+['"](fs|node:fs|fs\/promises|better-sqlite3)['"]|\bgetDb\b|\bwriteFileSync?\b|\.prepare\(/.test(src);
  t('nothing was written — the module imports no fs, no database, and prepares no SQL', src.length > 0 && !canWrite);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
