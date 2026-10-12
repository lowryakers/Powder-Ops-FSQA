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

test('post_channel_message with file_path uploads first, then posts with the attachment ids', async () => {
  const f = mockFetch((url) => url.endsWith('/attachments')
    ? { status: 201, body: [{ id: 'a1', filename: 'PO-4471.pdf' }] }
    : { status: 201, body: { id: 'm1', attachments: [{ id: 'a1', download_url: '/api/comms/attachments/a1/download' }] } });
  const reads = [];
  const readFile = async (p) => { reads.push(p); return Buffer.from('%PDF-1.4 fixture'); };
  const r = await tools(f, readFile).post_channel_message.handler({ channel_id: 'po', body: 'PO 4471 attached.', file_path: '/tmp/PO-4471.pdf' });
  assert.equal(r.isError, undefined, text(r));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, 'https://app.example/api/comms/channels/po/attachments');
  assert.ok(f.calls[0].body instanceof FormData);
  assert.equal(f.calls[0].body.get('files').name, 'PO-4471.pdf');
  assert.equal(f.calls[0].body.get('files').type, 'application/pdf');
  assert.equal(f.calls[0].body.get('body'), null, 'the upload carries only the file');
  assert.equal(f.calls[1].url, 'https://app.example/api/comms/channels/po/messages');
  assert.deepEqual(f.calls[1].body, { body: 'PO 4471 attached.', attachment_ids: ['a1'] });
  assert.equal(JSON.parse(text(r)).data.attachments[0].download_url, '/api/comms/attachments/a1/download');
  assert.deepEqual(reads, ['/tmp/PO-4471.pdf']);
});

test('post_channel_message: several files, no body; and the old call is unchanged', async () => {
  const f = mockFetch((url) => url.endsWith('/attachments') ? { status: 201, body: [{ id: 'a1' }, { id: 'a2' }] } : { status: 201, body: { id: 'm1' } });
  const readFile = async () => Buffer.from('x');
  const r = await tools(f, readFile).post_channel_message.handler({ channel_id: 'po', file_paths: ['/tmp/a.csv', '/tmp/b.xlsx'] });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(f.calls[0].body.getAll('files').map(x => [x.name, x.type]),
    [['a.csv', 'text/csv'], ['b.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);
  assert.deepEqual(f.calls[1].body, { attachment_ids: ['a1', 'a2'] });
  const plain = mockFetch(() => ({ status: 201, body: { id: 'm2' } }));
  await tools(plain).post_channel_message.handler({ channel_id: 'po', body: 'No file.' });
  assert.equal(plain.calls.length, 1);
  assert.deepEqual(plain.calls[0].body, { body: 'No file.' }, 'no file: one JSON request exactly as before');
});

test('post_channel_message refuses a disallowed type, too many files, or nothing to post — before any request', async () => {
  const f = mockFetch(() => ({ status: 201, body: [] }));
  const readFile = async () => Buffer.from('x');
  let r = await tools(f, readFile).post_channel_message.handler({ channel_id: 'po', body: 'x', file_path: '/tmp/page.html' });
  assert.equal(r.isError, true); assert.match(text(r), /page\.html.*pdf, png, jpg, jpeg, csv, xlsx, docx/);
  r = await tools(f, readFile).post_channel_message.handler({ channel_id: 'po', file_paths: Array.from({ length: 11 }, (_, i) => `/tmp/${i}.pdf`) });
  assert.equal(r.isError, true); assert.match(text(r), /At most 10/);
  r = await tools(f, readFile).post_channel_message.handler({ channel_id: 'po' });
  assert.equal(r.isError, true); assert.match(text(r), /body or file_path or file_paths/);
  assert.equal(f.calls.length, 0, 'nothing was sent');
});

test('a failed upload posts nothing, and upload_channel_attachments uploads alone', async () => {
  const f = mockFetch(() => ({ status: 415, body: { error: 'unsupported_type', message: 'fake.pdf: the contents are not a .pdf file.' } }));
  const readFile = async () => Buffer.from('<html>');
  const r = await tools(f, readFile).post_channel_message.handler({ channel_id: 'po', body: 'x', file_path: '/tmp/fake.pdf' });
  assert.equal(r.isError, true);
  assert.match(text(r), /not a \.pdf/);
  assert.equal(f.calls.length, 1, 'the message was never posted');
  const u = mockFetch(() => ({ status: 201, body: [{ id: 'a9' }] }));
  const up = await tools(u, readFile).upload_channel_attachments.handler({ channel_id: 'po', file_path: '/tmp/x.png' });
  assert.equal(up.isError, undefined, text(up));
  assert.equal(u.calls.length, 1);
  assert.equal(u.calls[0].url, 'https://app.example/api/comms/channels/po/attachments');
  assert.equal(u.calls[0].body.get('files').type, 'image/png');
  const none = await tools(u, readFile).upload_channel_attachments.handler({ channel_id: 'po' });
  assert.equal(none.isError, true); assert.match(text(none), /file_path or file_paths is required/);
});
