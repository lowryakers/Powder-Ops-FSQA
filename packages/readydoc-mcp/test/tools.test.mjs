// Unit tests against a mocked fetch: no ReadyDoc, no network, no MCP SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, FORBIDDEN_TOOL_NAME } from '../src/routes.mjs';
import { readConfig, makeClient, buildTools, ConfigError } from '../src/client.mjs';

const TOKEN = 'rdk_' + 'a'.repeat(43);

function mockFetch(respond) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body = {}, headers = {} } = respond(url, init) || {};
    const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k) => h.get(k.toLowerCase()) ?? null } };
  };
  f.calls = calls;
  return f;
}
const tools = (f) => Object.fromEntries(buildTools(makeClient({ url: 'https://app.example', token: TOKEN, fetch: f })).map(t => [t.name, t]));
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
