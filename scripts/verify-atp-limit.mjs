// verify:atplimit — PC #1's limit moves from 35 to 30 RLU, and the move is
// PARKED for Document Control (D-180). Live, with one reboot.
//
//   1. A fresh database adopts the code's number as its baseline: 30, and the
//      wording, the endpoint the hint reads and the grade all say 30.
//   2. A database that already APPROVED 35 (every live one) is rebooted on the
//      new code: the change parks, the app goes on grading against 35, and the
//      hint's endpoint says 35 — the floor is never told a number the server
//      is not using.
//   3. Document Control approves: the next reading is graded against 30 with
//      no restart, and the record graded under 35 still says 35.
// THE CONTROL is the code before D-180: the endpoint does not exist and a
// fresh database grades a 32 RLU swab as a pass.
// Caller sets PORT + DBPATH; a second server is booted on PORT+1000.
import { spawn } from 'child_process';
const PORT = Number(process.env.PORT || 5106);
const BOOT2 = PORT + 1000;
const DBP = process.env.DBPATH;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const q1 = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('al-adm','Limit Admin','Limit Admin','admin','document_control',1,'SC-AL',datetime('now','+7 day'))`).run();
  db.close();
}
function client(base) {
  let tok = null;
  const req = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  return {
    req,
    post: (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) }),
    async login() {
      await this.post('/users/login', { name: 'Limit Admin' });
      await this.post('/users/set-password', { user_id: 'al-adm', password: 'LimitAdmin2026!', setup_code: 'SC-AL' });
      tok = (await J(await this.post('/users/login', { name: 'Limit Admin', password: 'LimitAdmin2026!' })))?.token;
      return !!tok;
    },
  };
}
const swab = async (c, reading) => {
  const r = await J(await c.post('/sanitation', { area: '6', type: 'pre_op', performed_by: 'Limit Admin', result: 'pass', atp_reading: reading }));
  const id = r?.id || r?.record?.id;
  return q1('SELECT id, result, atp_reading, atp_limit FROM sanitation_records WHERE id = ?', id);
};

console.log('\n── a fresh database starts at 30 ──');
const A = client(`http://localhost:${PORT}/api`);
t('signed in', await A.login());
let lim = await J(await A.req('/atp-limit'));
t('THE ENDPOINT THE HINT READS says 30', lim?.max === 30, JSON.stringify(lim));
t('…naming the plan revision that states it (Protocol 003 V5)', lim?.document === 'Protocol 003' && lim?.revision === 'V5');
t('…and the wording is built from the number', lim?.statement === 'No more than 30 RLU');
const fresh = await swab(A, 32);
t('A 32 RLU SWAB FAILS against 30, whatever the filer chose', fresh?.result === 'fail' && fresh?.atp_limit === 30, JSON.stringify(fresh));
const row = q1("SELECT * FROM controlled_definitions WHERE key = 'atp:pc-1'");
t('the fresh database recorded 30 as its approved baseline, nothing parked', row?.status === 'approved' && JSON.parse(row.approved_snapshot).max === 30, row?.status);

console.log('\n── a database that approved 35 is redeployed ──');
{
  const db = new Database(DBP);
  db.prepare(`UPDATE controlled_definitions SET approved_snapshot = ?, approved_hash = 'pre-d180', status = 'approved',
    pending_hash = NULL, pending_snapshot = NULL WHERE key = 'atp:pc-1'`)
    .run(JSON.stringify({ max: 35, unit: 'RLU', document: 'Protocol 003', revision: 'V4' }));
  db.close();
}
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(BOOT2), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
let ready = false;
for (let i = 0; i < 90 && !ready; i++) { await wait(1000); try { await fetch(`http://localhost:${BOOT2}/api/users/lookup?q=zz`); ready = true; } catch { /* booting */ } }
t('the redeployed server came up', ready, log.slice(-400));
const B = client(`http://localhost:${BOOT2}/api`);
await B.login().catch(() => {});
try {
  const parked = q1("SELECT * FROM controlled_definitions WHERE key = 'atp:pc-1'");
  t('THE MOVE TO 30 IS PARKED for Document Control', parked?.status === 'pending' && JSON.parse(parked.pending_snapshot || '{}').max === 30, parked?.status);
  t('…and raised a Document Change Request', !!parked?.pending_dcr_id);
  lim = await J(await B.req('/atp-limit'));
  t('THE HINT IS TOLD 35 while it is parked — the number the server grades against', lim?.max === 35 && lim?.revision === 'V4', JSON.stringify(lim));
  t('…and the wording follows the number in force', lim?.statement === 'No more than 35 RLU');
  const under35 = await swab(B, 32);
  t('A 32 RLU SWAB STILL PASSES, graded against the approved 35', under35?.result === 'pass' && under35?.atp_limit === 35, JSON.stringify(under35));

  console.log('\n── Document Control approves ──');
  const r = await B.post(`/controlled/${parked.id}/approve`, {});
  t('approval is accepted', r.status === 200, String(r.status));
  lim = await J(await B.req('/atp-limit'));
  t('THE LIMIT IS 30 with no restart', lim?.max === 30 && lim?.revision === 'V5', JSON.stringify(lim));
  const after = await swab(B, 32);
  t('the next 32 RLU swab fails against 30', after?.result === 'fail' && after?.atp_limit === 30, JSON.stringify(after));
  const old = q1('SELECT atp_limit FROM sanitation_records WHERE id = ?', under35?.id);
  t('THE RECORD GRADED UNDER 35 STILL SAYS 35', old?.atp_limit === 35);
} finally {
  proc.kill();
}
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
