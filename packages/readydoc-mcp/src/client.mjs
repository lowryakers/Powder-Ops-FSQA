// The HTTP half: turn a tool call into one request to ReadyDoc's REST surface,
// and turn ReadyDoc's answer into something a model can act on. Pure apart from
// the injected fetch, so the test drives it with a mock.
import { ROUTES } from './routes.mjs';

export class ConfigError extends Error {}

/** Read READYDOC_URL + READYDOC_TOKEN. Fails fast — a server that starts without them answers every tool with a 401. */
export function readConfig(env = process.env) {
  const missing = ['READYDOC_URL', 'READYDOC_TOKEN'].filter(k => !String(env[k] || '').trim());
  if (missing.length) throw new ConfigError(`readydoc-mcp: set ${missing.join(' and ')} (see packages/readydoc-mcp/README.md).`);
  let url = String(env.READYDOC_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { new URL(url); } catch { throw new ConfigError(`readydoc-mcp: READYDOC_URL is not an address: ${env.READYDOC_URL}`); }
  const token = String(env.READYDOC_TOKEN).trim();
  if (!token.startsWith('rdk_')) throw new ConfigError('readydoc-mcp: READYDOC_TOKEN must be a ReadyDoc bot token (starts with rdk_). Mint one in Settings → Bot API tokens.');
  return { url, token };
}

/** An error the model sees, worded as what to do next. */
export class ReadyDocError extends Error {
  constructor(message, { status, code, retryAfter } = {}) {
    super(message);
    this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}

export function explain(status, body, headers) {
  const code = body?.error;
  const detail = body?.message || (typeof code === 'string' && code !== 'Not found' ? code : '');
  if (status === 401) {
    return new ReadyDocError('ReadyDoc refused this token (missing, revoked, expired, or its account was deactivated or made an admin). A person mints a new one in Settings → Bot API tokens.', { status, code });
  }
  if (status === 403 && code === 'approve_requires_human_session') {
    return new ReadyDocError('This needs a human in ReadyDoc: approving, deciding, signing or releasing is never done by a bot. Ask a person to do it in the app.', { status, code });
  }
  if (status === 403 && code === 'token_scope') {
    return new ReadyDocError(`This token may not do that: ${body?.message || 'it is outside the token scope'}.`, { status, code });
  }
  if (status === 403) {
    return new ReadyDocError(`The bot's ReadyDoc account does not have access${detail ? `: ${detail}` : ''}. Its module access is set in Settings → Users.`, { status, code });
  }
  if (status === 404) {
    return new ReadyDocError('Not found — or the bot\'s account cannot see it (a channel it is not a member of reads as not found).', { status, code });
  }
  if (status === 429) {
    const wait = Number(headers?.get?.('retry-after')) || null;
    return new ReadyDocError(`Rate limited by ReadyDoc. Retry after ${wait ?? 'a few'} seconds.`, { status, code, retryAfter: wait });
  }
  return new ReadyDocError(`ReadyDoc answered ${status}${detail ? `: ${detail}` : ''}.`, { status, code });
}

export function makeClient({ url, token, fetch: f = globalThis.fetch }) {
  async function call(route, args = {}) {
    let path = route.path;
    for (const m of route.path.matchAll(/:([A-Za-z_]+)/g)) {
      const v = args[m[1]];
      if (v === undefined || v === null || String(v) === '') throw new ReadyDocError(`${m[1]} is required.`);
      path = path.replace(`:${m[1]}`, encodeURIComponent(String(v)));
    }
    const qs = new URLSearchParams();
    for (const k of route.query || []) if (args[k] !== undefined && args[k] !== null && args[k] !== '') qs.set(k, String(args[k]));
    const q = qs.toString();
    const target = `${url}${path}${q ? `?${q}` : ''}`;
    const init = { method: route.method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } };
    if (route.method !== 'GET') {
      // Only the fields this tool declares are sent. A model cannot add `status`,
      // `source` or `approved_by` to a draft by inventing an argument.
      const body = {};
      for (const k of route.body || []) if (args[k] !== undefined) body[k] = args[k];
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try { res = await f(target, init); }
    catch (err) { throw new ReadyDocError(`Could not reach ReadyDoc at ${url}: ${err.message}`); }
    let body = null;
    try { body = await res.json(); } catch { /* an empty or non-JSON body */ }
    if (!res.ok) throw explain(res.status, body, res.headers);
    const total = res.headers?.get?.('x-total-count');
    if (total !== null && total !== undefined) {
      return { data: body, page: { total: Number(total), limit: Number(res.headers.get('x-limit')), offset: Number(res.headers.get('x-offset')) } };
    }
    return { data: body };
  }
  return { call };
}

/** Tool definitions for an MCP server: name, description, JSON-schema input, handler. */
export function buildTools(client, routes = ROUTES) {
  return routes.map(r => ({
    name: r.tool,
    description: r.description,
    inputSchema: { type: 'object', properties: r.properties, required: r.required, additionalProperties: false },
    async handler(args) {
      try {
        const out = await client.call(r, args || {});
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    },
  }));
}
