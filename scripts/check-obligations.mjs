#!/usr/bin/env node
// Every finding must be claimed by exactly one obligation.
//
// Findings live in several documents and the same obligation is named in more
// than one of them — the ATP limit is a walk punch-list item, a red-line
// finding, an SQF clause and a queued build. That is the defect this whole
// architecture is about, a fact in more than one place, and it had started
// happening in our own documentation.
//
// `docs/v2/obligations.json` gives each obligation ONE owner and lists the
// findings that point at it. This script is what stops the register drifting
// from the documents: a finding added to a red-line and forgotten fails the
// check, and so does a register entry citing a finding that no longer exists.
//
// Grouping findings into obligations is judgement and stays hand-maintained.
// Only the reconciliation is mechanical.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Where finding IDs are declared, and how to recognise one. */
const SOURCES = [
  {
    file: 'docs/v2/queued/plan-redline.md',
    // A finding is declared by its own heading: "### FSP-01 · title"
    re: /^### ((?:FSP|FDP|SQF|X)-\d{2})\b/gm,
  },
  {
    file: 'docs/v2/queued/audit-nc-triage.md',
    // Nonconformances are cited by clause; the register names them NC-<audit>-<clause>.
    re: /^### (§?[\d.]+) — /gm,
    map: (m, text) => {
      const clause = m.replace(/^§/, '');
      // The 306 audit's clauses are 6.2.x; 455-2's are 4.x.y.
      return clause.startsWith('6.2') ? `NC-306-${clause}` : `NC-455-${clause}`;
    },
  },
];

/** The walk's punch list is numbered, not ID'd, so the register names them WALK-nn. */
function walkItems() {
  const text = read('docs/v2/preventive-control-walk.md');
  const section = text.split('## 5. The punch list')[1]?.split('\n## ')[0] ?? '';
  const nums = [...section.matchAll(/^(\d+)\. \*\*/gm)].map(m => Number(m[1]));
  // Items 1, 10 and 25 are split across several obligations because the punch
  // list bundled unrelated work under one number. The register names the parts;
  // this keeps the check honest about which numbers are covered by a split.
  const SPLIT = { 1: ['WALK-01', 'WALK-01-exit'], 10: ['WALK-10-gmp', 'WALK-10-rest'] };
  return nums.flatMap(n => SPLIT[n] ?? [`WALK-${String(n).padStart(2, '0')}`]);
}

const declared = new Set();
for (const s of SOURCES) {
  const text = read(s.file);
  for (const m of text.matchAll(s.re)) declared.add(s.map ? s.map(m[1], text) : m[1]);
}
for (const w of walkItems()) declared.add(w);

const register = JSON.parse(read('docs/v2/obligations.json'));
const claimed = new Map(); // finding id -> [obligation ids]
for (const o of register.obligations) {
  for (const src of o.sources) {
    if (!claimed.has(src)) claimed.set(src, []);
    claimed.get(src).push(o.id);
  }
}

const unclaimed = [...declared].filter(d => !claimed.has(d)).sort();
const unknown = [...claimed.keys()].filter(c => !declared.has(c)).sort();
const twice = [...claimed.entries()].filter(([, os]) => os.length > 1);

let bad = 0;
const fail = (label, rows) => {
  if (!rows.length) return;
  bad += rows.length;
  console.error(`\n✗ ${label} (${rows.length})`);
  for (const r of rows) console.error(`    ${r}`);
};

fail('Findings in a document that no obligation claims — ADD THEM TO THE REGISTER', unclaimed);
fail('Register cites a finding that no document declares — stale reference', unknown);
fail('Findings claimed by more than one obligation — give each exactly one owner',
  twice.map(([id, os]) => `${id} → ${os.join(', ')}`));

const byStatus = {};
for (const o of register.obligations) byStatus[o.status] = (byStatus[o.status] || 0) + 1;

if (bad) {
  console.error(`\n${bad} problem(s). The register and the documents disagree.\n`);
  process.exit(1);
}
console.log(`✓ obligations register reconciles`);
console.log(`  ${register.obligations.length} obligations covering ${declared.size} findings`);
console.log(`  ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
if (!byStatus.landed) console.log(`\n  Nothing is landed. Every obligation is still ahead of you.`);
