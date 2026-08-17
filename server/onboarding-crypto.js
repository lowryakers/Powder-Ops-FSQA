// Encryption-at-rest for the two things an onboarding collects that must
// never sit in SQLite in the clear: SSN and bank numbers. AES-256-GCM under
// ONBOARDING_ENC_KEY (32 bytes, hex — `openssl rand -hex 32`).
//
// WITHOUT THE KEY, THE FIELDS ARE NOT COLLECTED AT ALL. The portal hides the
// inputs and says the office will take those details directly — a plaintext
// SSN in a database backup is a worse outcome than a form with two fewer
// fields. Decryption happens in exactly one place: building an ADP
// submission. Every screen gets last-4.

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

function key() {
  const raw = process.env.ONBOARDING_ENC_KEY || '';
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length >= 32) return Buffer.from(raw.slice(0, 32));
  return null;
}

export const cryptoEnabled = () => !!key();

export function encryptField(clear) {
  const k = key();
  if (!k || !clear) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(String(clear), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptField(stored) {
  const k = key();
  if (!k || !stored) return null;
  try {
    const [iv, tag, data] = String(stored).split('.').map(s => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch { return null; }
}

export const last4 = (v) => (v ? String(v).replace(/\D/g, '').slice(-4) : null);
