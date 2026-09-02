// A stand-in for R2 so the real upload path runs locally. In-memory, ignores
// signatures, speaks just enough S3 for @aws-sdk/client-s3 + lib-storage:
// PUT / GET / HEAD / DELETE on a key, and the multipart trio lib-storage uses
// once a body passes its part size. This used to live in a session's scratch
// directory and had to be rewritten from the CLAUDE.md note; a test harness a
// session can lose is a test nobody re-runs.
//
//   node scripts/s3-stand-in.mjs            # PORT defaults to 9099
//   R2_ENDPOINT=http://127.0.0.1:9099 R2_ACCOUNT_ID=x R2_ACCESS_KEY_ID=x \
//   R2_SECRET_ACCESS_KEY=x R2_BUCKET=test node server.js
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 9099);
const objects = new Map();   // key -> { body: Buffer, type }
const uploads = new Map();   // uploadId -> { key, parts: Map<number, Buffer> }
let nextUpload = 1;

const readBody = (req) => new Promise((resolve) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks)));
});
const xml = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/xml' }); res.end(body); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  // Path-style: /<bucket>/<key...>. Virtual-host style would put the bucket in
  // the Host header; forcePathStyle is what a local endpoint gets.
  const key = decodeURIComponent(u.pathname.replace(/^\/[^/]+\//, ''));
  const q = u.searchParams;

  if (req.method === 'POST' && q.has('uploads')) {
    const id = String(nextUpload++); uploads.set(id, { key, parts: new Map() });
    return xml(res, 200, `<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
  }
  if (req.method === 'PUT' && q.has('uploadId')) {
    const up = uploads.get(q.get('uploadId')); if (!up) return xml(res, 404, '<Error/>');
    up.parts.set(Number(q.get('partNumber')), await readBody(req));
    res.writeHead(200, { ETag: `"p${q.get('partNumber')}"` }); return res.end();
  }
  if (req.method === 'POST' && q.has('uploadId')) {
    const up = uploads.get(q.get('uploadId')); if (!up) return xml(res, 404, '<Error/>');
    await readBody(req);
    const body = Buffer.concat([...up.parts.keys()].sort((a, b) => a - b).map(n => up.parts.get(n)));
    objects.set(up.key, { body, type: 'application/octet-stream' }); uploads.delete(q.get('uploadId'));
    return xml(res, 200, `<CompleteMultipartUploadResult><Key>${up.key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`);
  }
  if (req.method === 'DELETE' && q.has('uploadId')) { uploads.delete(q.get('uploadId')); res.writeHead(204); return res.end(); }

  if (req.method === 'PUT') {
    objects.set(key, { body: await readBody(req), type: req.headers['content-type'] || 'application/octet-stream' });
    res.writeHead(200, { ETag: '"ok"' }); return res.end();
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const o = objects.get(key);
    if (!o) return xml(res, 404, '<Error><Code>NoSuchKey</Code></Error>');
    res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': o.body.length, ETag: '"ok"' });
    return res.end(req.method === 'HEAD' ? undefined : o.body);
  }
  if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
  xml(res, 400, '<Error><Code>Unsupported</Code></Error>');
}).listen(PORT, '127.0.0.1', () => console.log(`[s3-stand-in] listening on ${PORT}`));
