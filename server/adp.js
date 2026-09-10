// RUN Powered by ADP — Applicant Onboarding, degrading gracefully like
// quickbooks.js and storage.js: without the env vars everything here is
// simply off, and the onboarding module runs as the collect-and-key-in packet.
//
// The credentials come from ADP API Central (api-central.adp.com → a project on
// the "New Hire Onboarding" use case), which authenticates with OAuth
// client_credentials over MUTUAL TLS — every request presents the client
// certificate API Central generates. `ADP_CERT_PEM` / `ADP_KEY_PEM` hold the
// PEMs (literal or a file path). docs/adp-run-onboarding.md is the setup guide.
//
// THE ENDPOINT IS APPLICANT ONBOARD V2, AND IT IS A DOCUMENTED **RUN** API.
// ADP's API Explorer filtered to RUN Powered by ADP lists HCM → Applicant
// Onboarding with five operations, and `GET /hcm/v2/applicant.onboard/meta` —
// what `fetchOnboardMeta()` calls — is one of them, verbatim (seen 11 Sep
// 2026). So the product question is settled: this is not a Workforce Now-only
// API. What is NOT settled is how a RUN client obtains credentials for it;
// API Central refuses the RUN administrator's sign-in. See
// docs/adp-run-onboarding.md.
//
// The first cut targeted the older event-style path; v2 is a different body
// (`applicantOnboarding` with personal / worker / payroll profiles) and it
// REQUIRES an onboarding template code, which is a RUN-side setting read from
// that /meta call and kept in `ADP_ONBOARDING_TEMPLATE_CODE`.
//
// `ONBOARD_PATH` is `/hcm/v2/applicant.onboard`, matching the "Initiate New
// Applicant Onboarding" operation by ADP's own naming, but the POST path was
// below the fold on the page that confirmed /meta — treat it as one notch less
// certain than the meta path until seen. `ADP_ONBOARD_PATH` overrides it
// without a deploy if ADP's guide says otherwise.
//
// Field names here follow ADP's v2 guide as far as it could be read. ADP
// publishes an "Applicant Onboard V2 API Guide for RUN Powered by ADP" that
// has not been read yet; read it before the first live send rather than
// learning the shape from refusals. Until then the first send is checked
// against /meta and against ADP's own refusal text, returned verbatim.

import { readFileSync } from 'fs';
import https from 'https';

const TOKEN_URL = process.env.ADP_TOKEN_URL || 'https://accounts.adp.com/auth/oauth/v2/token';
const API_BASE = process.env.ADP_API_BASE || 'https://api.adp.com';
const ONBOARD_PATH = process.env.ADP_ONBOARD_PATH || '/hcm/v2/applicant.onboard';

function pem(v) {
  if (!v) return null;
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n');
  try { return readFileSync(v, 'utf8'); } catch { return null; }
}

/** Credentials present — enough to talk to ADP (read /meta). */
export function adpConnected() {
  return !!(process.env.ADP_CLIENT_ID && process.env.ADP_CLIENT_SECRET
    && pem(process.env.ADP_CERT_PEM) && pem(process.env.ADP_KEY_PEM));
}

/** Enough to SEND a new hire: credentials plus the RUN onboarding template code. */
export function adpEnabled() {
  return adpConnected() && !!process.env.ADP_ONBOARDING_TEMPLATE_CODE;
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
 * The Applicant Onboard V2 body, built from a decrypted onboarding record.
 * PURE — exported so the mapping is testable without credentials.
 *
 * Shape (ADP's v2 guide): `applicantOnboarding` carrying the template code and
 * the hire status (`inprogress` puts the person into RUN's New Hire wizard for
 * the office to finish, which is the honest default — ADP's I-9 and tax steps
 * complete there), then three profiles: personal (name, birth date, SSN as a
 * governmentID, email, phone, legal address), worker (hire date, job title)
 * and payroll (the rate as hourly or per-pay-period, plus the payroll group
 * when RUN needs one). Blank record fields are omitted, never sent as ''.
 */
export function applicantOnboardPayload(rec, opts = {}) {
  const templateCode = opts.templateCode ?? process.env.ADP_ONBOARDING_TEMPLATE_CODE ?? null;
  const status = opts.status ?? process.env.ADP_ONBOARDING_STATUS ?? 'inprogress';
  const payrollGroup = opts.payrollGroupCode ?? process.env.ADP_PAYROLL_GROUP_CODE ?? null;

  const personal = {
    birthName: {
      givenName: rec.first_name,
      ...(rec.middle_name ? { middleName: rec.middle_name } : {}),
      familyName: rec.last_name,
    },
    ...(rec.dob ? { birthDate: rec.dob } : {}),
    ...(rec.ssn ? { governmentIDs: [{ id: String(rec.ssn).replace(/\D/g, ''), nameCode: { code: 'SSN' } }] } : {}),
    ...(rec.email || rec.phone ? {
      communication: {
        ...(rec.email ? { emails: [{ emailUri: rec.email, notificationIndicator: true }] } : {}),
        ...(rec.phone ? { mobiles: [{ formattedNumber: rec.phone }] } : {}),
      },
    } : {}),
    ...(rec.address1 || rec.city || rec.zip ? {
      legalAddress: {
        ...(rec.address1 ? { lineOne: rec.address1 } : {}),
        ...(rec.address2 ? { lineTwo: rec.address2 } : {}),
        ...(rec.city ? { cityName: rec.city } : {}),
        ...(rec.state ? { subdivisionCode: rec.state } : {}),
        countryCode: 'US',
        ...(rec.zip ? { postalCode: rec.zip } : {}),
      },
    } : {}),
  };

  const worker = {
    ...(rec.start_date ? { hireDate: rec.start_date } : {}),
    ...(rec.position ? { jobTitle: rec.position } : {}),
  };

  const rate = rec.pay_rate != null && rec.pay_rate !== '' ? Number(rec.pay_rate) : null;
  // A rate that ADP can only take one of two ways: per hour, or per pay period.
  // "hourly" anywhere in the frequency means hourly; anything else is a period
  // rate and the frequency travels with it for the office to confirm in RUN.
  const hourly = /hour/i.test(String(rec.pay_frequency || ''));
  const payroll = {
    ...(payrollGroup ? { payrollGroupCode: payrollGroup } : {}),
    ...(rate != null && Number.isFinite(rate) ? {
      baseRemuneration: hourly
        ? { hourlyRateAmount: { amountValue: rate, currencyCode: 'USD' } }
        : { payPeriodRateAmount: { amountValue: rate, currencyCode: 'USD' } },
      ...(!hourly && rec.pay_frequency ? { payFrequencyCode: { code: String(rec.pay_frequency) } } : {}),
    } : {}),
  };

  return {
    applicantOnboarding: {
      ...(templateCode ? { onboardingTemplateCode: { code: templateCode } } : {}),
      onboardingStatus: { statusCode: { code: status, name: status } },
      applicantPersonalProfile: personal,
      ...(Object.keys(worker).length ? { applicantWorkerProfile: worker } : {}),
      ...(Object.keys(payroll).length ? { applicantPayrollProfile: payroll } : {}),
    },
  };
}

/**
 * What RUN requires for a template: `GET …/applicant.onboard/meta`. This is
 * how the template code and the required fields are read off the plant's own
 * RUN account rather than guessed — the office reads it once from Settings →
 * Integrations and sets ADP_ONBOARDING_TEMPLATE_CODE from it.
 */
export async function fetchOnboardMeta() {
  if (!adpConnected()) throw new Error('ADP credentials are not set — see docs/adp-run-onboarding.md.');
  const token = await getToken();
  return httpsJson(`${API_BASE}${ONBOARD_PATH}/meta`, 'GET', null,
    { Accept: 'application/json', Authorization: `Bearer ${token}` });
}

/** Submit one applicant into RUN's onboarding. Throws with ADP's own words on refusal. */
export async function submitApplicantOnboard(rec) {
  if (!adpConnected()) throw new Error('ADP credentials are not set — see docs/adp-run-onboarding.md.');
  if (!process.env.ADP_ONBOARDING_TEMPLATE_CODE) {
    throw new Error('ADP_ONBOARDING_TEMPLATE_CODE is not set. Read it from Settings → Integrations → ADP → "Read what RUN requires" and set it in Railway.');
  }
  const token = await getToken();
  const payload = applicantOnboardPayload(rec);
  return httpsJson(`${API_BASE}${ONBOARD_PATH}`, 'POST',
    JSON.stringify(payload), { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` });
}
