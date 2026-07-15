// Optional object storage for chat file uploads (Comms Phase 3).
// Backed by Cloudflare R2 via the S3-compatible API. Everything degrades
// gracefully: with no R2 credentials configured, storageEnabled() is false and
// callers surface uploads as unavailable rather than erroring.
//
// Required env vars (all four) to enable:
//   R2_ACCOUNT_ID        - Cloudflare account id (for the endpoint URL)
//   R2_ACCESS_KEY_ID     - R2 API token access key
//   R2_SECRET_ACCESS_KEY - R2 API token secret
//   R2_BUCKET            - target bucket name
// Optional:
//   R2_ENDPOINT          - override the derived https://<account>.r2.cloudflarestorage.com
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : null);

// Presigned download URLs are short-lived and only ever handed to a user who has
// already passed the channel access check in comms.js.
const DOWNLOAD_TTL_SECONDS = 10 * 60;

let client = null;

export function storageEnabled() {
  return !!(ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && ENDPOINT);
}

function getClient() {
  if (!storageEnabled()) return null;
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: ENDPOINT,
      forcePathStyle: true, // R2 supports path-style; keeps bucket in the path
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return client;
}

// Store an object and return its storage key. Throws if storage is not configured.
export async function putObject(key, body, contentType) {
  const c = getClient();
  if (!c) throw new Error('Object storage is not configured on this server.');
  await c.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType || 'application/octet-stream' }));
  return key;
}

// A short-lived signed GET url for a stored object, or null if storage is off.
export async function presignGet(key, filename) {
  const c = getClient();
  if (!c) return null;
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    // Suggest a download filename without forcing it, so images still render inline.
    ...(filename ? { ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, '')}"` } : {}),
  });
  return getSignedUrl(c, cmd, { expiresIn: DOWNLOAD_TTL_SECONDS });
}

export async function deleteObject(key) {
  const c = getClient();
  if (!c) return;
  try { await c.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch { /* best effort */ }
}
