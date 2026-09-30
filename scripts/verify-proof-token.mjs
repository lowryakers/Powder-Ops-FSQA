// verify:prooftoken — D-126, live on a fresh database.
//
// The Artwork-Proofing service holds ONE token and calls five routes with it.
// master.csv accepted it; /artwork/snapshot was refused by the global session
// gate before its handler ran; nutrition-panel and ingest each carried their
// own copy of the check. This asserts every route answers the token the same
// way — accepted, refused, and refused for the SAME reason — so they cannot
// drift apart again, and that nothing outside server/proof-token.js reads the
// secret, so a sixth copy of the check cannot be written without failing here.
//
// Caller sets PORT + DBPATH, and PRODUCT_MASTER_TOKEN on the server (the value
// below — verify-all passes it). The token carries '+', '/' and '=' on
// purpose: a base64 secret is what a person pastes, and those are the
// characters a query string mangles.
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PORT = process.env.PORT || 5046;
const B = `http://localhost:${PORT}/api`;
const TOKEN = process.env.PROOF_TOKEN || 'pr00f+tok/en=ab';
const Q = encodeURIComponent(TOKEN);
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
const product = db.prepare("SELECT sku, gtin FROM products WHERE gtin IS NOT NULL AND gtin != '' LIMIT 1").get();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('pt-adm','Pat Token','Pat Token','admin','admin',1,'SC-pt',datetime('now','+7 day'))`).run();
t('a catalogue product to call about', !!product?.gtin, JSON.stringify(product));

// The five calls the proofer makes (readydoc.py _get / _post / _post_multipart), each built with a
// token-carrying query string exactly as that code builds it.
let versionId = null;
const job = `pt-job-${Date.now()}`;
const calls = {
  'GET  /api/products/master.csv': (qs, h = {}) => fetch(`${B}/products/master.csv?${qs}`, { headers: h }),
  'GET  /api/products/nutrition-panel': (qs, h = {}) => fetch(`${B}/products/nutrition-panel?gtin=${product.gtin}&${qs}`, { headers: h }),
  'GET  /api/artwork/snapshot': (qs, h = {}) => fetch(`${B}/artwork/snapshot?gtin=${product.gtin}&${qs}`, { headers: h }),
  'POST /api/artwork/ingest': (qs, h = {}) => fetch(`${B}/artwork/ingest?${qs}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
    body: JSON.stringify({ job_id: job, gtin: product.gtin, sku: product.sku, component: 'primary',
      checks: [{ name: 'barcode', result: 'pass' }], snapshot: { ingredients: 'as the run read it' } }),
  }),
  'POST /api/artwork/ingest/:id/files': (qs, h = {}) => {
    const fd = new FormData();
    fd.append('kind', 'preview');
    fd.append('files', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'proof.pdf');
    return fetch(`${B}/artwork/ingest/${versionId || 'no-such-version'}/files?${qs}`, { method: 'POST', body: fd, headers: h });
  },
};

console.log('── The valid token opens all five, the same way ──');
for (const [name, call] of Object.entries(calls)) {
  const r = await call(`token=${Q}`);
  const body = r.headers.get('content-type')?.includes('json') ? await J(r) : await r.text();
  if (name.startsWith('POST /api/artwork/ingest') && !name.includes('files')) versionId = body?.version_id || body?.id || null;
  t(`${name} — NOT 401 with ?token=`, r.status !== 401, `HTTP ${r.status} ${JSON.stringify(body).slice(0, 140)}`);
}
t('the ingest filed a version to attach a file to', !!versionId);
{
  const r = await calls['POST /api/artwork/ingest/:id/files'](`token=${Q}`);
  t('POST /api/artwork/ingest/:id/files — NOT 401 against the real version', r.status !== 401, `HTTP ${r.status}`);
  const s = await calls['GET  /api/artwork/snapshot'](`token=${Q}`);
  const sb = await J(s);
  t('THE PROOFER READS BACK WHAT IT FILED — snapshot 200 with the token and no session',
    s.status === 200 && sb?.snapshot?.ingredients === 'as the run read it', `HTTP ${s.status} ${JSON.stringify(sb).slice(0, 140)}`);
  const m = await calls['GET  /api/products/master.csv'](`token=${Q}`);
  t('master.csv is unchanged: 200, the CSV with its contract header', m.status === 200 && /^sku,gtin,flavor/.test(await m.text()));
}

console.log('\n── The X-Proof-Token header carries the same secret on all five ──');
for (const [name, call] of Object.entries(calls)) {
  const r = await call('', { 'X-Proof-Token': TOKEN });
  t(`${name} — NOT 401 with the header`, r.status !== 401, `HTTP ${r.status}`);
}

console.log('\n── And every one refuses the same way, saying which refusal it is ──');
for (const [name, call] of Object.entries(calls)) {
  const none = await call('');
  t(`${name} — 401 with no token`, none.status === 401, `HTTP ${none.status}`);
  const wrong = await call('token=not-the-token');
  const wb = wrong.headers.get('content-type')?.includes('json') ? await J(wrong) : { text: await wrong.text() };
  t(`${name} — 401 with the WRONG token, naming it a mismatch`,
    wrong.status === 401 && (wb?.reason === 'mismatch' || /does not match/.test(wb?.text || '')), `HTTP ${wrong.status} ${JSON.stringify(wb).slice(0, 140)}`);
  const twice = await call(`token=${Q}&token=${Q}`);
  const tb = twice.headers.get('content-type')?.includes('json') ? await J(twice) : { text: await twice.text() };
  t(`${name} — 401 when the token is sent twice, and says so`,
    twice.status === 401 && (tb?.reason === 'repeated' || /more than once/.test(tb?.text || '')), `HTTP ${twice.status} ${JSON.stringify(tb).slice(0, 140)}`);
}
{
  const r = await calls['GET  /api/products/nutrition-panel']('token=not-the-token');
  const b = await J(r);
  t('the refusal never echoes the expected value', !JSON.stringify(b).includes(TOKEN));
}

console.log('\n── The signed-in door to /artwork/snapshot still works ──');
await fetch(`${B}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pat Token' }) });
await fetch(`${B}/users/set-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 'pt-adm', password: 'PatToken2026!!', setup_code: 'SC-pt' }) });
const session = (await J(await fetch(`${B}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pat Token', password: 'PatToken2026!!' }) })))?.token;
{
  const r = await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`, { headers: { Authorization: `Bearer ${session}` } });
  t('a signed-in screen reads the snapshot with its session and no token', r.status === 200, `HTTP ${r.status}`);
  const anon = await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`);
  t('no session and no token is still refused by the gate', anon.status === 401);
}

console.log('\n── One copy of the rule ──');
{
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) files.push(p); } };
  walk('server');
  files.push('server.js');
  const readers = files.filter(f => /process\.env\.PRODUCT_MASTER_TOKEN/.test(readFileSync(f, 'utf8')));
  t('ONLY server/proof-token.js reads PRODUCT_MASTER_TOKEN — a second copy of the check fails here',
    readers.length === 1 && readers[0] === join('server', 'proof-token.js'), JSON.stringify(readers));
}

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
