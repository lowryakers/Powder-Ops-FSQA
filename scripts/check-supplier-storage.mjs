// The archive-to-catalogue matcher, asserted against the shapes the plant's
// real folders actually produce.
import {
  normalizePath, commonPrefix, stripPrefix, matchArchiveFile,
  isSkippable, storageKeyFor, planArchiveUpload,
} from '../server/supplier-storage.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n── paths ──');
t('backslashes normalise', normalizePath('AIFI\\2025\\coa.pdf') === 'AIFI/2025/coa.pdf');
t('a leading ./ goes', normalizePath('./AIFI/coa.pdf') === 'AIFI/coa.pdf');
t('a leading slash goes', normalizePath('/AIFI/coa.pdf') === 'AIFI/coa.pdf');

// The prefix must only ever eat WHOLE segments. Two vendors sharing letters is
// the case a character-wise prefix gets wrong.
t('a shared root is found', commonPrefix(['Suppliers/AIFI/a.pdf', 'Suppliers/Mill/b.pdf']) === 'Suppliers');
t('no shared root yields none', commonPrefix(['AIFI/a.pdf', 'Mill/b.pdf']) === '');
t('a shared PREFIX of a name is not a shared segment',
  commonPrefix(['Millhaven/a.pdf', 'Mill/b.pdf']) === '', commonPrefix(['Millhaven/a.pdf', 'Mill/b.pdf']));
t('the filename is never consumed', commonPrefix(['A/x.pdf', 'A/x.pdf']) === 'A');
t('a flat zip yields no prefix', commonPrefix(['a.pdf', 'b.pdf']) === '');
t('stripPrefix only strips a whole segment', stripPrefix('Millhaven/a.pdf', 'Mill') === 'Millhaven/a.pdf');

console.log('\n── skipping ──');
t('a directory is skipped', isSkippable('AIFI/2025/', { isDirectory: true }) === 'directory');
t('__MACOSX is skipped', isSkippable('__MACOSX/AIFI/._a.pdf') === 'mac metadata');
t('a resource fork is skipped', isSkippable('AIFI/._a.pdf') === 'mac resource fork');
t('.DS_Store is skipped', isSkippable('AIFI/.DS_Store') === 'os artefact');
t('a real document is not skipped', isSkippable('AIFI/2025/coa.pdf') === null);

console.log('\n── matching ──');
const rows = [
  { id: 'f1', supplier_id: 's1', source_path: 'AIFI/2025/Kosher Exp. 12.31.2025.pdf', filename: 'Kosher Exp. 12.31.2025.pdf' },
  { id: 'f2', supplier_id: 's2', source_path: 'Mill Haven/2026/Certificate.pdf', filename: 'Certificate.pdf' },
  { id: 'f3', supplier_id: 's3', source_path: 'Daffodil/2025/Certificate.pdf', filename: 'Certificate.pdf' },
];
t('an exact path matches', matchArchiveFile('AIFI/2025/Kosher Exp. 12.31.2025.pdf', rows).row?.id === 'f1');
t('a zip root is stripped',
  matchArchiveFile('Supplier Docs/AIFI/2025/Kosher Exp. 12.31.2025.pdf', rows, { prefix: 'Supplier Docs' }).row?.id === 'f1');
// The one that matters: "Certificate.pdf" exists under two vendors, so a
// filename match would be a coin toss between them.
const amb = matchArchiveFile('Somewhere Else/Certificate.pdf', rows);
t('AN AMBIGUOUS FILENAME IS REFUSED, not guessed', amb.row === null && /ambiguous/.test(amb.reason), JSON.stringify(amb));
t('an unambiguous filename still matches',
  matchArchiveFile('Elsewhere/Kosher Exp. 12.31.2025.pdf', rows).row?.id === 'f1');
t('an unknown file is reported, not attached', matchArchiveFile('Nothing/at/all.pdf', rows).row === null);

console.log('\n── the plan ──');
const entries = [
  { path: 'Archive/AIFI/2025/', isDirectory: true },
  { path: 'Archive/AIFI/2025/Kosher Exp. 12.31.2025.pdf', size: 1200 },
  { path: 'Archive/Mill Haven/2026/Certificate.pdf', size: 900 },
  { path: 'Archive/Daffodil/2025/Certificate.pdf', size: 800 },
  { path: '__MACOSX/Archive/._x.pdf', size: 10 },
  { path: 'Archive/Unknown Vendor/spec.pdf', size: 400 },
];
const plan = planArchiveUpload(entries, rows);
t('the zip root is detected', plan.prefix === 'Archive', plan.prefix);
t('three real documents are planned', plan.counts.store === 3, JSON.stringify(plan.counts));
t('the mac fork and the directory are skipped', plan.counts.skip === 2);
t('the unknown vendor is REPORTED, not silently dropped',
  plan.counts.unmatched === 1 && plan.unmatched[0].path.includes('Unknown Vendor'));
t('the byte total is real', plan.counts.bytes === 2900, `${plan.counts.bytes}`);

// Already stored → skipped. This is what makes a timed-out upload recoverable
// by simply doing it again, and it is the whole reason a big archive is usable.
const stored = rows.map(r => (r.id === 'f1' ? { ...r, storage_key: 'suppliers/s1/f1.pdf' } : r));
const again = planArchiveUpload(entries, stored);
t('a file already stored is skipped on a re-upload', again.counts.store === 2, JSON.stringify(again.counts));
t('...and says so by name', again.skip.some(s => s.reason === 'already stored'));
t('replace:true stores it again when asked',
  planArchiveUpload(entries, stored, { replace: true }).counts.store === 3);

// Two entries for one catalogued row: the second must not overwrite the first.
const dupe = planArchiveUpload(
  [{ path: 'A/Kosher Exp. 12.31.2025.pdf', size: 1 }, { path: 'B/Kosher Exp. 12.31.2025.pdf', size: 2 }],
  [rows[0]]);
t('one catalogued row is claimed once', dupe.counts.store === 1 && dupe.counts.skip === 1);

console.log('\n── keys ──');
t('the key is stable and keyed on the row', storageKeyFor('s1', 'f1', 'A Certificate.PDF') === 'suppliers/s1/f1.pdf');
t('a file with no extension still gets a key', storageKeyFor('s1', 'f1', 'noext') === 'suppliers/s1/f1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
