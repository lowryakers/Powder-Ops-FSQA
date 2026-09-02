// The audit status document, checked against the REPOSITORY.
//
// The first version of that document was built from docs/v2/obligations.json
// and was wrong about four of the twelve findings, because the register and the
// code had drifted — the exact defect this project exists to remove, occurring
// in the project's own governance (D-045).
//
// So every "work under way" claim in the document now has to point at something
// that is actually here. This check fails if the document claims a foundation
// that does not exist, or if a file it depends on is deleted or renamed without
// the document being revisited.
import { readFileSync, existsSync } from 'fs';

const DOC = 'docs/v2/queued/audit-nc-triage.artifact.html';
const html = readFileSync(DOC, 'utf8');

// finding id → the evidence on disk that justifies calling it "under way",
// and a phrase the file must contain so a rename cannot silently pass.
const EVIDENCE = {
  '§6.2.2':  [['server/banned-substance-sop-seed.js', 'Banned and Prohibited Substance Control Program']],
  '4.3.1':   [['server/api/suppliers.js', 'disposition'], ['server/supplier-sop.js', 'RISK_CRITERIA']],
  '4.4.39':  [['server/signature.js', '11.200'], ['scripts/lib/verification-doc.mjs', '']],
  '4.3.6':   [['server/spec-seed.js', ''], ['server/api/coa.js', 'no_spec_reason']],
  '4.3.9':   [['server/controlled.js', 'Document Control approves']],
  '4.5.84':  [['server/emp-site-list.js', 'EMP_SCHEDULES']],
};

// findings the document says are NOT started — assert the thing really is absent,
// so work landing on main without the document being updated is caught.
const ABSENT = {
  '4.5.43': [['server/db.js', /CREATE TABLE IF NOT EXISTS (master_manufacturing|mmr)/]],
  '4.6.21': [['server/db.js', /CREATE TABLE IF NOT EXISTS \w*stability/]],
  '4.2.9':  [['server/db.js', /CREATE TABLE IF NOT EXISTS \w*(gmp_observation|observation)/]],
  '4.5.8':  [['server/equipment-readiness.js', /iq_oq_pq|Installation qualification/i]],
};

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

// What the document itself claims, read out of the rendered status lines.
const claimed = {};
for (const m of html.matchAll(/<span class="id">([^<]+)<\/span>[\s\S]{0,400}?<div class="st (open|part|done)"/g)) {
  claimed[m[1]] = m[2];
}
t('the document carries a status for all twelve findings', Object.keys(claimed).length === 12,
  `${Object.keys(claimed).length}`);

console.log('\n── every "under way" claim points at real code ──');
for (const [id, files] of Object.entries(EVIDENCE)) {
  t(`${id} is claimed as under way`, claimed[id] === 'part', `document says "${claimed[id]}"`);
  for (const [file, needle] of files) {
    t(`${id}: ${file} exists`, existsSync(file));
    if (needle && existsSync(file)) {
      t(`${id}: ${file} still contains "${needle}"`, readFileSync(file, 'utf8').includes(needle));
    }
  }
}

console.log('\n── every "not started" claim is still genuinely absent ──');
for (const [id, checks] of Object.entries(ABSENT)) {
  t(`${id} is claimed as not started`, claimed[id] === 'open', `document says "${claimed[id]}"`);
  for (const [file, re] of checks) {
    const found = existsSync(file) && re.test(readFileSync(file, 'utf8'));
    t(`${id}: nothing in ${file} matches ${re}`, !found,
      found ? 'IT EXISTS NOW — the document is out of date, update it' : '');
  }
}

console.log('\n── nothing claims closure ──');
t('no finding is marked closed', !/class="st done"/.test(html));
t('the header says zero closed', /<div class="v">0<\/div><div class="k">closed/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
