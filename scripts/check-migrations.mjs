// A column added to a CREATE TABLE IF NOT EXISTS after that table first
// shipped EXISTS ONLY ON DATABASES THAT NEVER SAW THE EARLIER RELEASE — the
// CREATE is a no-op on every deployed volume, and the first explicit SELECT
// of the new column throws "no such column" in production while every fresh
// test database passes. That is exactly how partner_settlements.proof_* broke
// the partner portal: added to the CREATE with no addColumnIfMissing, caught
// only when the other company opened their link.
//
// This compares today's db.js against the go-live schema (pinned commit) and
// fails when a column added since then has no addColumnIfMissing. A NEW table
// needs nothing — its CREATE runs on every database.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const GO_LIVE_DB_COMMIT = 'd7c03b7'; // 2026-08-03 — the plant's volume predates everything after this

function parseTables(src) {
  const out = new Map();
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    let depth = 1, i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 1);
    const cols = new Set();
    let d = 0, line = '';
    const lines = [];
    for (const ch of body) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) { lines.push(line); line = ''; continue; }
      line += ch;
    }
    lines.push(line);
    for (const raw of lines) {
      const t = raw.replace(/--[^\n]*/g, '').trim();
      const cm = t.match(/^(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC|BOOLEAN|DATETIME)/i);
      if (cm) cols.add(cm[1]);
    }
    out.set(name, cols);
  }
  return out;
}

let oldSrc;
try {
  oldSrc = execSync(`git show ${GO_LIVE_DB_COMMIT}:server/db.js`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch {
  console.log('check-migrations: go-live commit not available (shallow clone?) — skipping.');
  process.exit(0);
}
const newSrc = readFileSync('server/db.js', 'utf8');
const oldT = parseTables(oldSrc), newT = parseTables(newSrc);
const added = new Set();
for (const m of newSrc.matchAll(/addColumnIfMissing\(\s*'(\w+)'\s*,\s*'(\w+)'/g)) added.add(`${m[1]}.${m[2]}`);

let bad = 0;
for (const [t, cols] of newT) {
  const old = oldT.get(t);
  if (!old) continue;
  for (const c of cols) {
    if (!old.has(c) && !added.has(`${t}.${c}`)) {
      console.error(`✗ ${t}.${c} was added to the CREATE TABLE after go-live but has no addColumnIfMissing — deployed databases will throw "no such column: ${c}".`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log(`✓ Every column added to a pre-go-live table since ${GO_LIVE_DB_COMMIT} has a migration (${[...newT.keys()].filter(t => oldT.has(t)).length} tables checked).`);
