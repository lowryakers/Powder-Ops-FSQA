#!/usr/bin/env node
// Re-key the onboarding fields that are encrypted at rest (D-208).
//
// The four columns encrypted by server/onboarding-crypto.js —
// onboarding_records.ssn_enc, ein_enc, dd_routing_enc and dd_account_enc — are
// re-encrypted from ONBOARDING_ENC_KEY (the key in use) to ONBOARDING_ENC_KEY_NEW.
// There was no rotation path at all: changing the variable on its own orphans
// every stored value, because decryptField() answers null on ANY failure and a
// wrong key reads exactly like an empty field.
//
//   DB_PATH=… ONBOARDING_ENC_KEY=<old> ONBOARDING_ENC_KEY_NEW=<new> node scripts/rekey-onboarding.mjs            # dry run
//   DB_PATH=… ONBOARDING_ENC_KEY=<old> ONBOARDING_ENC_KEY_NEW=<new> node scripts/rekey-onboarding.mjs --apply
//
// RULES, each of them load-bearing:
//   - A value is tried under the NEW key first. If it opens, it is already
//     migrated and is left alone. That is what makes the script safe to run
//     again after the key swap, when packets filed in between are still under
//     the old key.
//   - A value that opens under NEITHER key is UNDECRYPTABLE: reported by row id
//     and column, never overwritten. Null from a decrypt is a failure, never an
//     empty field.
//   - A re-encrypted value is decrypted again under the new key, in memory, and
//     must equal the old plaintext before it is written.
//   - Every write is one transaction, and each UPDATE names the old ciphertext,
//     so a row that changed under us (the server is live) refuses rather than
//     being overwritten. Any failure rolls the whole run back.
//   - --apply copies the database to <DB_PATH>.pre-rekey-<timestamp> first. That
//     copy holds OLD-key ciphertext; delete it once the swap is verified.
//   - NOTHING SECRET IS EVER PRINTED: no plaintext, no ciphertext, no key — only
//     counts, row ids and column names, in errors too.
//
// Exit codes: 0 done · 1 refused / failed and rolled back · 3 finished, but some
// values open under neither key (look at the listed rows before swapping).
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

export const ENC_COLUMNS = ['ssn_enc', 'ein_enc', 'dd_routing_enc', 'dd_account_enc'];

// The same reading of a key string as onboarding-crypto.js's key(): 64 hex
// characters are 32 bytes; otherwise the first 32 characters of the string.
// Copied rather than imported because that function reads one variable only.
export function parseKey(raw) {
  const s = String(raw || '');
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  if (s.length >= 32) return Buffer.from(s.slice(0, 32));
  return null;
}

// Same stored shape as onboarding-crypto.js: "<iv b64>.<tag b64>.<data b64>",
// a 12-byte iv, AES-256-GCM.
export function encryptWith(key, clear) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(clear), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

// { ok: true, value } or { ok: false } — never a bare null that could be read
// as "nothing stored".
export function decryptWith(key, stored) {
  try {
    const parts = String(stored).split('.');
    if (parts.length !== 3) return { ok: false };
    const [iv, tag, data] = parts.map(s => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return { ok: true, value: Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8') };
  } catch { return { ok: false }; }
}

/** Why the two keys cannot be used, or null. Says nothing about either value. */
export function keyProblem(oldRaw, newRaw) {
  if (!oldRaw) return 'ONBOARDING_ENC_KEY (the key in use) is not set.';
  if (!newRaw) return 'ONBOARDING_ENC_KEY_NEW (the new key) is not set.';
  if (oldRaw === newRaw) return 'The new key is the same as the old one.';
  if (!/^[0-9a-f]{64}$/i.test(newRaw)) return 'The new key must be 64 hex characters (openssl rand -hex 32).';
  if (!parseKey(oldRaw)) return 'The old key is shorter than 32 characters, so the app has never been able to use it.';
  if (parseKey(oldRaw).equals(parseKey(newRaw))) return 'The new key reads as the same 32 bytes as the old one.';
  return null;
}

class VerifyFailed extends Error {}
class RowChanged extends Error {}

/**
 * Classify every encrypted value and, when `apply`, re-encrypt the ones still
 * under the old key — inside ONE transaction on `db`.
 * `onWrite(counts)` runs inside that transaction after the updates (the audit
 * entry), so it commits or rolls back with them.
 * Returns { counts, problems, migrated } — counts and ids only.
 */
export function rekey(db, { oldKey, newKey, apply = false, failVerifyAt = 0, onWrite = null }) {
  const counts = Object.fromEntries(ENC_COLUMNS.map(c => [c, { migrated: 0, already_migrated: 0, undecryptable: 0, null: 0, empty: 0 }]));
  const problems = [];
  const rows = db.prepare(`SELECT id, ${ENC_COLUMNS.join(', ')} FROM onboarding_records ORDER BY id`).all();

  const plan = [];
  for (const row of rows) {
    for (const col of ENC_COLUMNS) {
      const stored = row[col];
      if (stored === null || stored === undefined) { counts[col].null++; continue; }
      if (stored === '') { counts[col].empty++; continue; }
      if (decryptWith(newKey, stored).ok) { counts[col].already_migrated++; continue; }
      const old = decryptWith(oldKey, stored);
      if (!old.ok) { counts[col].undecryptable++; problems.push({ id: row.id, column: col, problem: 'undecryptable' }); continue; }
      plan.push({ id: row.id, col, stored, clear: old.value });
    }
  }

  if (!apply || !plan.length) {
    for (const p of plan) counts[p.col].migrated++;   // in a dry run: "would migrate"
    for (const p of plan) p.clear = null;
    return { counts, problems, migrated: 0, planned: plan.length };
  }

  let n = 0;
  const tx = db.transaction(() => {
    for (const p of plan) {
      n++;
      const next = encryptWith(newKey, p.clear);
      const back = decryptWith(newKey, next);
      const forced = failVerifyAt && n === failVerifyAt;
      if (!back.ok || back.value !== p.clear || forced) throw new VerifyFailed(`${p.id} ${p.col}`);
      const r = db.prepare(`UPDATE onboarding_records SET ${p.col} = ? WHERE id = ? AND ${p.col} = ?`).run(next, p.id, p.stored);
      if (r.changes !== 1) throw new RowChanged(`${p.id} ${p.col}`);
      counts[p.col].migrated++;
    }
    if (onWrite) onWrite(counts);
  });
  try {
    tx();
  } finally {
    for (const p of plan) p.clear = null;
  }
  return { counts, problems, migrated: plan.length, planned: plan.length };
}

export function report({ counts, problems }, { apply }) {
  const lines = [];
  lines.push(apply ? 'Re-key APPLIED.' : 'DRY RUN — nothing written. "migrated" is what --apply would re-key.');
  lines.push('column            migrated  already  undecryptable  null  empty');
  for (const col of ENC_COLUMNS) {
    const c = counts[col];
    lines.push(`${col.padEnd(16)}  ${String(c.migrated).padStart(8)}  ${String(c.already_migrated).padStart(7)}  ${String(c.undecryptable).padStart(13)}  ${String(c.null).padStart(4)}  ${String(c.empty).padStart(5)}`);
  }
  if (problems.length) {
    lines.push('', `${problems.length} value(s) open under NEITHER key and were left exactly as stored:`);
    for (const p of problems) lines.push(`  onboarding_records ${p.id} · ${p.column}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) { console.error('Pick one: --dry-run or --apply.'); process.exit(1); }
  const unknown = args.filter(a => !['--apply', '--dry-run'].includes(a));
  if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')}. Use --dry-run (default) or --apply.`); process.exit(1); }

  const dbPath = process.env.DB_PATH;
  if (!dbPath) { console.error('DB_PATH is not set.'); process.exit(1); }
  if (!existsSync(dbPath)) { console.error(`No database at ${dbPath}.`); process.exit(1); }
  const problem = keyProblem(process.env.ONBOARDING_ENC_KEY, process.env.ONBOARDING_ENC_KEY_NEW);
  if (problem) { console.error(problem); process.exit(1); }
  const oldKey = parseKey(process.env.ONBOARDING_ENC_KEY);
  const newKey = parseKey(process.env.ONBOARDING_ENC_KEY_NEW);
  // Only honoured by the test, to prove a failed check rolls everything back.
  const failVerifyAt = process.env.NODE_ENV === 'test' ? Number(process.env.REKEY_FORCE_VERIFY_FAIL_AT) || 0 : 0;

  const { default: Database } = await import('better-sqlite3');

  if (!apply) {
    const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
    const result = rekey(ro, { oldKey, newKey, apply: false });
    ro.close();
    console.log(report(result, { apply: false }));
    process.exit(result.problems.length ? 3 : 0);
  }

  // Look before writing: a second run after the swap usually has nothing to do,
  // and then it must write NOTHING — no backup, no audit row.
  const peek = new Database(dbPath, { readonly: true, fileMustExist: true });
  const preview = rekey(peek, { oldKey, newKey, apply: false });
  if (!preview.planned) {
    peek.close();
    console.log(report(preview, { apply: true }));
    console.log('\nNothing is under the old key. No backup taken and nothing written.');
    process.exit(preview.problems.length ? 3 : 0);
  }
  // The backup is a consistent single file (WAL included), taken before any write.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.pre-rekey-${stamp}`;
  await peek.backup(backupPath);
  peek.close();
  console.log(`Backup written: ${backupPath}`);
  console.log('It holds OLD-key ciphertext. Delete it once the key swap is verified.\n');

  // The app's own connection, so the audit row goes through the existing helper
  // and commits (or rolls back) with the updates.
  const { getDb, logAudit } = await import('../server/db.js');
  const db = getDb();
  try {
    const result = rekey(db, {
      oldKey, newKey, apply: true, failVerifyAt,
      onWrite: (counts) => logAudit('system:rekey-onboarding', 'rekey', 'onboarding_encryption', null,
        { columns: counts, undecryptable: preview.problems.length, backup_taken: true }, null, null, 'Onboarding encrypted fields re-keyed'),
    });
    console.log(report(result, { apply: true }));
    process.exit(result.problems.length ? 3 : 0);
  } catch (e) {
    const where = e instanceof VerifyFailed ? `the re-encrypted value did not verify (${e.message})`
      : e instanceof RowChanged ? `the row changed while the script ran (${e.message})`
        : 'an unexpected error';
    console.error(`ROLLED BACK — nothing was written: ${where}. The backup is still at ${backupPath}.`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
