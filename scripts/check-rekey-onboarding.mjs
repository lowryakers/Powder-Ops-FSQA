// The onboarding re-key script (D-208), run for real against a fixture
// database. Every value here is an obvious fake.
//
// Proves: the round trip; that a second run writes nothing; that a value under
// an unrelated key is reported and left byte-identical; that one failed check
// rolls the whole run back; that null and empty columns are untouched; that a
// dry run leaves the file byte-identical; and that no plaintext, ciphertext or
// key ever reaches stdout or stderr.
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { parseKey, encryptWith, decryptWith, keyProblem, ENC_COLUMNS } from './rekey-onboarding.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const OLD = '1111111111111111111111111111111111111111111111111111111111111111';
const NEW = '2222222222222222222222222222222222222222222222222222222222222222';
const THIRD = '3333333333333333333333333333333333333333333333333333333333333333';
const oldK = parseKey(OLD), newK = parseKey(NEW), thirdK = parseKey(THIRD);
const FAKE = { ssn_enc: '000-00-0000', ein_enc: '00-0000000', dd_routing_enc: 'FAKE-RTN-000', dd_account_enc: 'FAKE-ACCT-0000' };
const FAKE_OTHER = 'FAKE-THIRD-KEY-0000';
const FAKE_ALREADY = 'FAKE-ALREADY-NEW-0000';

console.log('── the helpers match onboarding-crypto.js ──');
process.env.ONBOARDING_ENC_KEY = OLD;
const appCrypto = await import('../server/onboarding-crypto.js');
t('a value the app encrypted opens with the script\'s helper', decryptWith(oldK, appCrypto.encryptField('FAKE-COMPAT-1')).value === 'FAKE-COMPAT-1');
t('a value the script encrypted opens with the app', appCrypto.decryptField(encryptWith(oldK, 'FAKE-COMPAT-2')) === 'FAKE-COMPAT-2');
const short = 'not-hex-but-long-enough-to-be-a-key-xx';
process.env.ONBOARDING_ENC_KEY = short;
t('a non-hex key is read the same way (first 32 characters)', decryptWith(parseKey(short), appCrypto.encryptField('FAKE-COMPAT-3')).value === 'FAKE-COMPAT-3');
delete process.env.ONBOARDING_ENC_KEY;
t('a wrong key is a FAILURE, never an empty value', decryptWith(newK, encryptWith(oldK, 'x')).ok === false);
t('refused: no new key', !!keyProblem(OLD, ''));
t('refused: the same key twice', !!keyProblem(OLD, OLD));
t('refused: a new key that is not 64 hex', !!keyProblem(OLD, 'abc'));
t('refused: the same 32 bytes in two spellings', !!keyProblem(OLD.toUpperCase().replace(/1/g, 'a'), OLD.replace(/1/g, 'A')));
t('accepted: two different 64-hex keys', keyProblem(OLD, NEW) === null);

console.log('\n── a fixture database ──');
const dir = mkdtempSync(join(tmpdir(), 'rekey-'));
const DB_PATH = join(dir, 'fixture.db');
const init = spawnSync('node', ['-e', "import('./server/db.js').then(m => { m.getDb().close(); })"],
  { cwd: ROOT, env: { ...process.env, DB_PATH, NODE_ENV: 'test' }, encoding: 'utf8' });
t('the app\'s schema builds a fresh fixture', init.status === 0, (init.stderr || '').slice(0, 300));
{
  const db = new Database(DB_PATH);
  const ins = db.prepare(`INSERT INTO onboarding_records (id, first_name, ${ENC_COLUMNS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?)`);
  ins.run('rk-full', 'Fake', ...ENC_COLUMNS.map(c => encryptWith(oldK, FAKE[c])));
  ins.run('rk-third', 'Fake', encryptWith(thirdK, FAKE_OTHER), null, null, null);
  ins.run('rk-blank', 'Fake', null, '', null, null);
  ins.run('rk-mixed', 'Fake', encryptWith(oldK, FAKE.ssn_enc), null, encryptWith(newK, FAKE_ALREADY), null);
  db.pragma('journal_mode = DELETE');
  db.close();
}
const snapshot = () => {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = Object.fromEntries(db.prepare(`SELECT id, ${ENC_COLUMNS.join(', ')} FROM onboarding_records`).all().map(r => [r.id, r]));
  const audits = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'onboarding_encryption'").all();
  db.close();
  return { rows, audits };
};
const fileHash = () => createHash('sha256').update(readFileSync(DB_PATH)).digest('hex');
const backups = () => readdirSync(dir).filter(f => f.includes('.pre-rekey-'));
const outputs = [];
const run = (args, extra = {}) => {
  const r = spawnSync('node', ['scripts/rekey-onboarding.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, DB_PATH, NODE_ENV: 'test', ONBOARDING_ENC_KEY: OLD, ONBOARDING_ENC_KEY_NEW: NEW, ...extra },
  });
  outputs.push(`${r.stdout}\n${r.stderr}`);
  return r;
};
const before = snapshot();
const ciphertexts = new Set(Object.values(before.rows).flatMap(r => ENC_COLUMNS.map(c => r[c]).filter(Boolean)));

console.log('\n── refusals ──');
let r = run([], { ONBOARDING_ENC_KEY_NEW: '' });
t('no new key ⇒ refused, exit 1', r.status === 1 && /ONBOARDING_ENC_KEY_NEW/.test(r.stderr));
r = run([], { ONBOARDING_ENC_KEY_NEW: OLD });
t('the same key twice ⇒ refused', r.status === 1 && /same/.test(r.stderr));
r = run([], { ONBOARDING_ENC_KEY_NEW: 'not-hex' });
t('a non-hex new key ⇒ refused', r.status === 1 && /64 hex/.test(r.stderr));
r = run([], { ONBOARDING_ENC_KEY: '' });
t('no old key ⇒ refused', r.status === 1);

console.log('\n── --dry-run writes nothing ──');
const h0 = fileHash();
r = run(['--dry-run']);
t('a dry run finishes, exit 3 because one value opens under neither key', r.status === 3, `exit ${r.status}`);
t('the database file is byte-identical afterwards', fileHash() === h0);
t('the default (no flag) is a dry run too', run([]).status === 3 && fileHash() === h0);
t('it reports what it would migrate: 2 SSNs, 1 EIN, 1 routing, 1 account',
  /ssn_enc\s+2\s+0\s+1\s+1\s+0/.test(r.stdout) && /ein_enc\s+1\s+0\s+0\s+2\s+1/.test(r.stdout)
  && /dd_routing_enc\s+1\s+1\s+0\s+2\s+0/.test(r.stdout) && /dd_account_enc\s+1\s+0\s+0\s+3\s+0/.test(r.stdout), r.stdout);
t('…and names the undecryptable row and column', /rk-third · ssn_enc/.test(r.stdout));
t('no backup is taken on a dry run', backups().length === 0);

console.log('\n── one failed check rolls the whole run back ──');
r = run(['--apply'], { REKEY_FORCE_VERIFY_FAIL_AT: '3' });
t('the run fails and says it rolled back', r.status === 1 && /ROLLED BACK/.test(r.stderr), `${r.status} ${r.stderr.slice(0, 200)}`);
let now = snapshot();
t('every encrypted value is byte-identical — including the two re-keyed before the failure',
  ENC_COLUMNS.every(c => Object.keys(before.rows).every(id => now.rows[id][c] === before.rows[id][c])));
t('no audit row was written', now.audits.length === 0);
t('the backup had been taken before the attempt', backups().length === 1);

console.log('\n── --apply ──');
r = run(['--apply']);
t('it applies, exit 3 (the third-key value is still reported)', r.status === 3, `${r.status} ${r.stderr.slice(0, 200)}`);
t('it prints the backup path before writing', /Backup written: .*pre-rekey-/.test(r.stdout));
t('a second backup file exists', backups().length === 2);
now = snapshot();
const full = now.rows['rk-full'];
t('every migrated value opens under the NEW key to its original fake value',
  ENC_COLUMNS.every(c => decryptWith(newK, full[c]).value === FAKE[c]) && decryptWith(newK, now.rows['rk-mixed'].ssn_enc).value === FAKE.ssn_enc);
t('…and the OLD key no longer opens any of them',
  ENC_COLUMNS.every(c => !decryptWith(oldK, full[c]).ok) && !decryptWith(oldK, now.rows['rk-mixed'].ssn_enc).ok);
t('the value under a third key is byte-identical', now.rows['rk-third'].ssn_enc === before.rows['rk-third'].ssn_enc);
t('the already-migrated value is byte-identical', now.rows['rk-mixed'].dd_routing_enc === before.rows['rk-mixed'].dd_routing_enc);
t('null and empty columns are untouched', now.rows['rk-blank'].ssn_enc === null && now.rows['rk-blank'].ein_enc === ''
  && now.rows['rk-blank'].dd_routing_enc === null && now.rows['rk-third'].ein_enc === null);
t('one audit row, counts only', now.audits.length === 1 && /"migrated":2/.test(now.audits[0].details));
const auditText = now.audits.map(a => a.details).join(' ');
t('the audit row holds no plaintext and no ciphertext',
  ![...Object.values(FAKE), FAKE_OTHER, FAKE_ALREADY].some(v => auditText.includes(v))
  && ![...ciphertexts, ...ENC_COLUMNS.map(c => full[c])].some(v => auditText.includes(v)));

console.log('\n── a second run changes nothing ──');
const afterFirst = snapshot();
r = run(['--apply']);
t('it says nothing is under the old key', /Nothing is under the old key/.test(r.stdout), r.stdout.slice(-200));
now = snapshot();
t('every value is byte-identical to after the first run',
  ENC_COLUMNS.every(c => Object.keys(afterFirst.rows).every(id => now.rows[id][c] === afterFirst.rows[id][c])));
t('no second audit row, no third backup', now.audits.length === 1 && backups().length === 2);

console.log('\n── a packet filed under the old key after the swap ──');
{
  const db = new Database(DB_PATH);
  db.prepare('INSERT INTO onboarding_records (id, first_name, ssn_enc) VALUES (?, ?, ?)').run('rk-late', 'Fake', encryptWith(oldK, '000-00-0001'));
  db.close();
}
r = run(['--apply']);
now = snapshot();
t('a re-run migrates just the late one', decryptWith(newK, now.rows['rk-late'].ssn_enc).value === '000-00-0001'
  && ENC_COLUMNS.every(c => now.rows['rk-full'][c] === afterFirst.rows['rk-full'][c]) && now.audits.length === 2);

console.log('\n── nothing secret reached the output ──');
const all = outputs.join('\n');
const finalCipher = Object.values(snapshot().rows).flatMap(row => ENC_COLUMNS.map(c => row[c]).filter(Boolean));
t('no plaintext in any captured stdout/stderr',
  ![...Object.values(FAKE), FAKE_OTHER, FAKE_ALREADY, '000-00-0001'].some(v => all.includes(v)));
t('no ciphertext in any captured stdout/stderr', ![...ciphertexts, ...finalCipher].some(v => all.includes(v)));
t('no key in any captured stdout/stderr', ![OLD, NEW, THIRD].some(k => all.includes(k)));

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
