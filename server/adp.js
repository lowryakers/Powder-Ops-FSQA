// RUN Powered by ADP — Applicant Onboarding, degrading gracefully like
// quickbooks.js and storage.js: without the four env vars everything here is
// simply off, and the onboarding module runs as the collect-and-key-in packet.
//
// ADP Marketplace apps authenticate with OAuth client_credentials over
// MUTUAL TLS — every request presents an ADP-issued client certificate.
// `ADP_CERT_PEM` / `ADP_KEY_PEM` hold the PEMs (literal or a file path).
// docs/adp-run-onboarding.md is the human setup guide.
//
// NOT YET EXERCISED AGAINST ADP — the credentials wait on Marketplace
// approval. The payload mapper is pure and tested; the field mapping gets
// finalized against the approved app's actual grant before this is wired to
// a button anyone presses in anger.

import { readFileSync } from 'fs';
import https from 'https';

const TOKEN_URL = process.env.ADP_TOKEN_URL || 'https://accounts.adp.com/auth/oauth/v2/token';
const API_BASE = process.env.ADP_API_BASE || 'https://api.adp.com';

function pem(v) {
  if (!v) return null;
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n');
  try { return readFileSync(v, 'utf8'); } catch { return null; }
}

export function adpEnabled() {
  return !!(process.env.ADP_CLIENT_ID && process.env.ADP_CLIENT_SECRET
    && pem(process.env.ADP_CERT_PEM) && pem(process.env.ADP_KEY_PEM));
}

function agent() {
  return new https.Agent({ cert: pem(process.env.ADP_CERT_PEM), key: pem(process.env.ADP_KEY_PEM) });
}

let cachedToken = null; // { token, expires_at }

async function getToken() {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) return cachedToken.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.ADP_CLIENT_ID,
    client_secret: process.env.ADP_CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    dispatcher: undefined,
    // Node fetch (undici) does not take an https.Agent; mTLS goes through the
    // https fallback below when running under plain node.
  }).catch(() => null);
  if (res && res.ok) {
    const j = await res.json();
    cachedToken = { token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
    return cachedToken.token;
  }
  // Fallback: raw https with the client cert (undici's fetch cannot carry one).
  const j = await httpsJson(TOKEN_URL, 'POST', body.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  cachedToken = { token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

function httpsJson(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method,
      headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      agent: agent(),
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({ raw: data }); }
        } else {
          reject(new Error(`ADP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * The applicant-onboard event payload, built from a decrypted onboarding
 * record. PURE — exported so the mapping is testable without credentials.
 * Field names follow ADP's applicant-onboard.process event shape; the exact
 * set the approved app may send is confirmed against its grant at
 * certification time.
 */
export function applicantEventPayload(rec) {
  const applicant = {
    givenName: rec.first_name,
    ...(rec.middle_name ? { middleName: rec.middle_name } : {}),
    familyName1: rec.last_name,
    ...(rec.email ? { email: rec.email } : {}),
    ...(rec.phone ? { landline: rec.phone } : {}),
    ...(rec.dob ? { birthDate: rec.dob } : {}),
    ...(rec.ssn ? { taxID: rec.ssn } : {}),
    legalAddress: {
      lineOne: rec.address1 || '',
      ...(rec.address2 ? { lineTwo: rec.address2 } : {}),
      cityName: rec.city || '',
      countrySubdivisionLevel1: rec.state || '',
      postalCode: rec.zip || '',
    },
    ...(rec.start_date ? { hireDate: rec.start_date } : {}),
    ...(rec.position ? { jobTitle: rec.position } : {}),
    ...(rec.pay_rate != null && rec.pay_rate !== '' ? {
      payRate: { amountValue: Number(rec.pay_rate), currencyCode: 'USD' },
      ...(rec.pay_frequency ? { payFrequency: rec.pay_frequency } : {}),
    } : {}),
  };
  return { events: [{ data: { transform: { applicant } } }] };
}

/** Submit one applicant into RUN's onboarding. Throws with ADP's own words on refusal. */
export async function submitApplicantOnboard(rec) {
  if (!adpEnabled()) throw new Error('ADP is not configured — see docs/adp-run-onboarding.md.');
  const token = await getToken();
  const payload = applicantEventPayload(rec);
  return httpsJson(`${API_BASE}/events/hr/v1/applicant-onboard.process`, 'POST',
    JSON.stringify(payload), { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
}
