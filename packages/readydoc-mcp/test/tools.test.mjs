// Unit tests against a mocked fetch: no ReadyDoc, no network, no MCP SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, FORBIDDEN_TOOL_NAME } from '../src/routes.mjs';
import { readConfig, makeClient, buildTools, ConfigError } from '../src/client.mjs';

const TOKEN = 'rdk_' + 'a'.repeat(43);

function mockFetch(respond) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const { status = 200, body = {}, headers = {} } = respond(url, init) || {};
    const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k) => h.get(k.toLowerCase()) ?? null } };
  };
  f.calls = calls;
  return f;
}
const tools = (f, readFile) => Object.fromEntries(buildTools(makeClient({ url: 'https://app.example', token: TOKEN, fetch: f, readFile })).map(t => [t.name, t]));
const text = (r) => r.content[0].text;

test('no tool name suggests an approval-class act', () => {
  for (const r of ROUTES) assert.doesNotMatch(r.tool, FORBIDDEN_TOOL_NAME, r.tool);
  for (const t of buildTools(makeClient({ url: 'x', token: TOKEN, fetch: () => {} }))) assert.doesNotMatch(t.name, FORBIDDEN_TOOL_NAME);
  assert.match('approve_nfp', FORBIDDEN_TOOL_NAME, 'the pattern itself catches an approve tool');
});

test('one tool per route, names unique, every schema an object', () => {
  assert.equal(new Set(ROUTES.map(r => r.tool)).size, ROUTES.length);
  for (const t of buildTools(makeClient({ url: 'x', token: TOKEN }))) {
    assert.equal(t.inputSchema.type, 'object');
    for (const req of t.inputSchema.required) assert.ok(req in t.inputSchema.properties, `${t.name}.${req}`);
  }
});

test('config fails fast and normalises the address', () => {
  assert.throws(() => readConfig({}), ConfigError);
  assert.throws(() => readConfig({ READYDOC_URL: 'https://a' }), /READYDOC_TOKEN/);
  assert.throws(() => readConfig({ READYDOC_URL: 'https://a', READYDOC_TOKEN: 'session-token' }), /rdk_/);
  assert.deepEqual(readConfig({ READYDOC_URL: 'app.powder-ops.com/', READYDOC_TOKEN: TOKEN }), { url: 'https://app.powder-ops.com', token: TOKEN });
});

test('a GET carries the bearer token, path params and only declared query params', async () => {
  const f = mockFetch(() => ({ body: [{ id: 1 }], headers: { 'X-Total-Count': 250, 'X-Limit': 200, 'X-Offset': 0 } }));
  const r = await tools(f).read_channel_messages.handler({ channel_id: 'c/1', limit: 5, junk: 'x' });
  assert.equal(f.calls[0].url, 'https://app.example/api/comms/channels/c%2F1/messages?limit=5');
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(JSON.parse(text(r)).page.total, 250);
});

test('create_nfp_draft sends only the declared fields — never status, source or approver', async () => {
  const f = mockFetch(() => ({ status: 201, body: { id: 'n1', status: 'draft' } }));
  const r = await tools(f).create_nfp_draft.handler({ sku: 'WHY-PLG-BLM', version: 'V2', status: 'approved', source: 'paper', approved_by: 'Bot' });
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(f.calls[0].body, { sku: 'WHY-PLG-BLM', version: 'V2' });
  assert.equal(r.isError, undefined);
});

test('post_channel_message posts the body to the channel', async () => {
  const f = mockFetch(() => ({ status: 201, body: { id: 'm1' } }));
  await tools(f).post_channel_message.handler({ channel_id: 'ch1', body: 'Proof finished.' });
  assert.equal(f.calls[0].url, 'https://app.example/api/comms/channels/ch1/messages');
  assert.deepEqual(f.calls[0].body, { body: 'Proof finished.' });
});

test('a missing path parameter is refused before any request', async () => {
  const f = mockFetch(() => ({}));
  const r = await tools(f).get_product.handler({});
  assert.equal(r.isError, true);
  assert.match(text(r), /sku is required/);
  assert.equal(f.calls.length, 0);
});

test('HTTP errors become clear MCP errors', async () => {
  const cases = [
    [{ status: 401, body: { error: 'Authentication required' } }, /refused this token/],
    [{ status: 403, body: { error: 'approve_requires_human_session' } }, /needs a human in ReadyDoc/],
    [{ status: 403, body: { error: 'token_scope', message: 'This token is read-only.' } }, /read-only/],
    [{ status: 403, body: { error: 'No modules have been assigned' } }, /does not have access/],
    [{ status: 404, body: { error: 'Not found' } }, /Not found/],
    [{ status: 429, body: { error: 'rate_limited' }, headers: { 'Retry-After': 17 } }, /Retry after 17 seconds/],
    [{ status: 500, body: { error: 'boom' } }, /answered 500/],
  ];
  for (const [resp, re] of cases) {
    const r = await tools(mockFetch(() => resp)).whoami.handler({});
    assert.equal(r.isError, true);
    assert.match(text(r), re);
  }
});

test('a network failure names the address it could not reach', async () => {
  const f = async () => { throw new TypeError('fetch failed'); };
  const r = await tools(f).list_products.handler({});
  assert.equal(r.isError, true);
  assert.match(text(r), /Could not reach ReadyDoc at https:\/\/app\.example/);
});

test('the extended name rule catches delete, void, revoke, settle, verify, admin and token tools', () => {
  for (const bad of ['delete_po', 'void_document', 'revoke_link', 'settle_partner', 'verify_record', 'archive_drop', 'remove_member', 'user_admin', 'mint_token']) {
    assert.match(bad, FORBIDDEN_TOOL_NAME, bad);
  }
});

test('the write tools exist and send only their declared fields', async () => {
  const names = ROUTES.map(r => r.tool);
  for (const n of ['update_product', 'attach_artwork_file', 'create_supply_order', 'update_supply_order', 'upload_ap_drop', 'add_ap_drop_note', 'add_partner_document', 'update_partner_document']) {
    assert.ok(names.includes(n), n);
  }
  const f = mockFetch(() => ({ body: { sku: 'WHY-PLG-BLM' } }));
  await tools(f).update_product.handler({ sku: 'WHY-PLG-BLM', notes: 'n', nfp_version: 'V9', artwork_status: 'print_ready', legacy_sku: '' });
  assert.equal(f.calls[0].init.method, 'PUT');
  assert.equal(f.calls[0].url, 'https://app.example/api/products/WHY-PLG-BLM');
  assert.deepEqual(f.calls[0].body, { notes: 'n' });
  const g = mockFetch(() => ({ status: 201, body: { id: 'p1' } }));
  await tools(g).create_supply_order.handler({ vendor: 'Acme', qty: 3, approved_by: 'Bot', id: 'x' });
  assert.deepEqual(g.calls[0].body, { vendor: 'Acme', qty: 3 });
});

test('a file tool uploads the local file as multipart with only its declared fields', async () => {
  const f = mockFetch(() => ({ status: 201, body: [{ id: 'd1' }] }));
  const reads = [];
  const readFile = async (p) => { reads.push(p); return Buffer.from('%PDF-1.4 fixture'); };
  const r = await tools(f, readFile).upload_ap_drop.handler({ file_path: '/tmp/inv-42.pdf', vendor_name: 'Acme', status: 'paid' });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(reads, ['/tmp/inv-42.pdf']);
  const form = f.calls[0].body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('vendor_name'), 'Acme');
  assert.equal(form.get('status'), null);
  assert.equal(form.get('files').name, 'inv-42.pdf');
  assert.equal(form.get('files').type, 'application/pdf');
  assert.equal(f.calls[0].init.headers['Content-Type'], undefined, 'fetch sets the multipart boundary');
  const none = await tools(f, readFile).attach_artwork_file.handler({ id: 'v1' });
  assert.equal(none.isError, true);
  assert.match(text(none), /file_path is required/);
  const json = mockFetch(() => ({ status: 201, body: [] }));
  await tools(json, readFile).add_partner_document.handler({ partner_id: 'p1', amount: 10 });
  assert.deepEqual(json.calls[0].body, { amount: 10 }, 'no file: plain JSON');
});

test('token_denied is worded as a person-only act with its category', async () => {
  const f = mockFetch(() => ({ status: 403, body: { error: 'token_denied', category: 'delete', message: 'Deleting needs a person.' } }));
  const r = await tools(f).update_supply_order.handler({ id: 'p1', notes: 'x' });
  assert.equal(r.isError, true);
  assert.match(text(r), /needs a person in ReadyDoc \(delete\)/);
});
