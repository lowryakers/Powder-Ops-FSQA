// The HTTP half: turn a tool call into one request to ReadyDoc's REST surface,
// and turn ReadyDoc's answer into something a model can act on. Pure apart from
// the injected fetch, so the test drives it with a mock.
import { readFile as fsReadFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ROUTES } from './routes.mjs';

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.heic': 'image/heic', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ai': 'application/postscript', '.eps': 'application/postscript', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

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
  if (status === 403 && code === 'token_denied') {
    return new ReadyDocError(`This needs a person in ReadyDoc (${body?.category || 'not open to tokens'}): ${body?.message || 'a bot token can never do it'}`, { status, code });
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

export function makeClient({ url, token, fetch: f = globalThis.fetch, readFile = fsReadFile }) {
  const fillPath = (template, args) => {
    let path = template;
    for (const m of template.matchAll(/:([A-Za-z_]+)/g)) {
      const v = args[m[1]];
      if (v === undefined || v === null || String(v) === '') throw new ReadyDocError(`${m[1]} is required.`);
      path = path.replace(`:${m[1]}`, encodeURIComponent(String(v)));
    }
    return path;
  };
  // The local files a tool was given: `arg` (one path) and/or `many` (a list).
  const filesFor = (spec, args) => {
    if (!spec) return [];
    const list = [];
    if (args[spec.arg]) list.push(String(args[spec.arg]));
    if (spec.many && args[spec.many] !== undefined) {
      if (!Array.isArray(args[spec.many])) throw new ReadyDocError(`${spec.many} must be a list of paths.`);
      for (const p of args[spec.many]) if (p) list.push(String(p));
    }
    if (spec.max && list.length > spec.max) throw new ReadyDocError(`At most ${spec.max} files in one call.`);
    if (spec.allow) {
      const bad = list.filter(p => !spec.allow.includes(extname(p).toLowerCase()));
      if (bad.length) throw new ReadyDocError(`Not sent: ${bad.map(p => basename(p)).join(', ')}. A bot may attach only ${spec.allow.map(e => e.slice(1)).join(', ')} files.`);
    }
    return list;
  };
  const multipart = async (spec, paths, fields = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== null) form.append(k, String(v));
    for (const p of paths) {
      let bytes;
      try { bytes = await readFile(p); }
      catch (err) { throw new ReadyDocError(`Could not read ${p}: ${err.message}`); }
      const name = basename(p);
      form.append(spec.field, new Blob([bytes], { type: MIME[extname(name).toLowerCase()] || 'application/octet-stream' }), name);
    }
    return form; // fetch sets the multipart boundary itself
  };
  async function send(method, path, init) {
    let res;
    try { res = await f(`${url}${path}`, { method, ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers || {}) } }); }
    catch (err) { throw new ReadyDocError(`Could not reach ReadyDoc at ${url}: ${err.message}`); }
    let body = null;
    try { body = await res.json(); } catch { /* an empty or non-JSON body */ }
    if (!res.ok) throw explain(res.status, body, res.headers);
    return { res, body };
  }

  async function call(route, args = {}) {
    const path = fillPath(route.path, args);
    const qs = new URLSearchParams();
    for (const k of route.query || []) if (args[k] !== undefined && args[k] !== null && args[k] !== '') qs.set(k, String(args[k]));
    const q = qs.toString();
    const init = {};
    if (route.method !== 'GET') {
      // Only the fields this tool declares are sent. A model cannot add `status`,
      // `source` or `approved_by` to a draft by inventing an argument.
      const body = {};
      for (const k of route.body || []) if (args[k] !== undefined) body[k] = args[k];
      if (route.oneOf && !route.oneOf.some(keys => keys.every(k => args[k] !== undefined && args[k] !== '' && !(Array.isArray(args[k]) && !args[k].length)))) {
        throw new ReadyDocError(`Give ${route.oneOf.map(k => k.join(' + ')).join(' or ')}.`);
      }
      const files = filesFor(route.file, args);
      const toUpload = filesFor(route.upload, args); // checked before anything is sent
      if (route.file?.required && !files.length) throw new ReadyDocError(`${route.file.arg}${route.file.many ? ` or ${route.file.many}` : ''} is required.`);
      if (toUpload.length) {
        // Upload first; the message then names what was uploaded.
        const up = await send('POST', fillPath(route.upload.path, args), { body: await multipart(route.upload, toUpload) });
        body[route.upload.ids] = (Array.isArray(up.body) ? up.body : []).map(a => a.id);
      }
      if (files.length) {
        init.body = await multipart(route.file, files, body);
      } else {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
    }
    const { res, body } = await send(route.method, `${path}${q ? `?${q}` : ''}`, init);
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
