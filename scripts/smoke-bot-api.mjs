#!/usr/bin/env node
// Post-deploy smoke test for the bot API (D-163). Run by hand after a deploy:
//
//   READYDOC_URL=https://app.powder-ops.com \
//   READYDOC_ADMIN_TOKEN=<an admin's session token> \
//   SMOKE_BOT_USER="<name or id of a non-admin bot account>" \
//   node scripts/smoke-bot-api.mjs
//
// It mints a temporary READ + WRITE token for the smoke bot account, proves the
// token reads, proves an approve-class act is refused with approve_requires_
// human_session, proves a delete and a token listing are refused with
// token_denied (D-164), revokes the token, and proves the revoked token is
// refused with 401.
// The token is ALWAYS revoked in `finally`, whatever failed. Nothing else is
// written: no NFP draft, no message — production data is untouched apart from
// the token row itself and its audit entries, which are the record of the run.
//
// The approve and delete attempts name ids that do not exist on purpose: the
// guard refuses on the PATH before any handler looks the record up, so the
// check proves the refusal without there being anything a mistake could
// approve or delete. A write token is minted so the refusals are the person-only
// rule speaking, not the read-only scope.

const env = process.env;
const missing = ['READYDOC_URL', 'READYDOC_ADMIN_TOKEN', 'SMOKE_BOT_USER'].filter(k => !String(env[k] || '').trim());
if (missing.length) {
  console.error(`smoke-bot-api: set ${missing.join(', ')}. See docs/bot-api.md → "After a deploy".`);
  process.exit(2);
}
let BASE = String(env.READYDOC_URL).trim().replace(/\/+$/, '');
if (!/^https?:\/\//i.test(BASE)) BASE = `https://${BASE}`;
const ADMIN = String(env.READYDOC_ADMIN_TOKEN).trim();
const BOT = String(env.SMOKE_BOT_USER).trim();

const rows = [];
const record = (step, ok, detail = '') => rows.push({ step, ok, detail });

async function call(method, path, auth, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

let tokenId = null;
let revoked = false;
try {
  // Resolve the smoke bot account by id or by name.
  const users = await call('GET', '/api/users', ADMIN);
  if (users.status !== 200 || !Array.isArray(users.body)) throw new Error(`admin session refused listing users (${users.status}) — is READYDOC_ADMIN_TOKEN an admin's live session?`);
  const bot = users.body.find(u => u.id === BOT) || users.body.find(u => String(u.name).toLowerCase() === BOT.toLowerCase());
  if (!bot) throw new Error(`no account "${BOT}"`);
  record('smoke bot account found', bot.role !== 'admin' && !!bot.is_active, `${bot.name} (${bot.role})`);

  const made = await call('POST', '/api/api-tokens', ADMIN, { user_id: bot.id, label: `smoke ${new Date().toISOString().slice(0, 16)}`, scopes: ['read', 'write'] });
  tokenId = made.body?.token?.id || null;
  const tok = made.body?.plaintext;
  record('temporary read + write token minted', made.status === 201 && !!tok && JSON.stringify(made.body?.token?.scopes) === '["read","write"]', `${made.status} ${made.body?.token?.token_prefix || made.body?.error || ''}`);
  if (!tok) throw new Error('no token to test with');

  const who = await call('GET', '/api/bot/whoami', tok);
  record('GET /api/bot/whoami → 200 as the bot', who.status === 200 && who.body?.user?.id === bot.id && who.body?.auth === 'token', `${who.status} ${who.body?.user?.name || ''}`);
  const prods = await call('GET', '/api/products', tok);
  record('GET /api/products → 200', prods.status === 200, `${prods.status}${prods.status !== 200 ? ` ${prods.body?.error || ''} (the bot account needs the products module)` : ''}`);

  const decide = await call('POST', '/api/nfp/smoke-no-such-panel/decide', tok, { decision: 'approved', approver_name: 'smoke' });
  record('POST /api/nfp/:id/decide → 403 approve_requires_human_session', decide.status === 403 && decide.body?.error === 'approve_requires_human_session', `${decide.status} ${decide.body?.error || ''}`);
  const art = await call('POST', '/api/artwork/versions/smoke-no-such-version/status', tok, { status: 'approved' });
  record('artwork approve → 403 approve_requires_human_session', art.status === 403 && art.body?.error === 'approve_requires_human_session', `${art.status} ${art.body?.error || ''}`);

  const del = await call('DELETE', '/api/procurement/pos/smoke-no-such-po', tok);
  record('DELETE /api/procurement/pos/:id → 403 token_denied (delete)', del.status === 403 && del.body?.error === 'token_denied' && del.body?.category === 'delete', `${del.status} ${del.body?.error || ''} ${del.body?.category || ''}`);
  const list = await call('GET', '/api/api-tokens', tok);
  record('GET /api/api-tokens → 403 token_denied (token_admin)', list.status === 403 && list.body?.error === 'token_denied' && list.body?.category === 'token_admin', `${list.status} ${list.body?.error || ''} ${list.body?.category || ''}`);

  const rev = await call('POST', `/api/api-tokens/${tokenId}/revoke`, ADMIN);
  revoked = rev.status === 200 && !!rev.body?.revoked_at;
  record('token revoked', revoked, `${rev.status}`);

  const after = await call('GET', '/api/bot/whoami', tok);
  record('revoked token → 401', after.status === 401, `${after.status}`);
} catch (err) {
  record('run', false, err.message);
} finally {
  if (tokenId && !revoked) {
    try {
      const rev = await call('POST', `/api/api-tokens/${tokenId}/revoke`, ADMIN);
      record('cleanup: token revoked in finally', rev.status === 200, `${rev.status}`);
    } catch (err) { record('cleanup: token revoked in finally', false, `${err.message} — REVOKE IT BY HAND in Settings → Bot API tokens`); }
  }
}

const w = Math.max(...rows.map(r => r.step.length));
console.log(`\nBot API smoke test — ${BASE}\n`);
for (const r of rows) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step.padEnd(w)}  ${r.detail}`);
const failed = rows.filter(r => !r.ok).length;
console.log(`\n${rows.length - failed} PASS / ${failed} FAIL`);
process.exit(failed ? 1 : 0);
