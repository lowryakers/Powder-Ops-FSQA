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
// BOTH PATHS ARE CONFIRMED against ADP's API Explorer for RUN: `POST
// /hcm/v2/applicant.onboard` and `GET /hcm/v2/applicant.onboard/meta`.
//
// THE PAYLOAD IS BUILT FROM ADP'S RUN-SPECIFIC GUIDE — "Applicant Onboard V2
// API Guide for RUN Powered by ADP", last modified 19 Apr 2026, Chapter 7's
// data dictionary. That guide replaced a first cut written by inference from
// ADP's general v2 documentation, which had the wrong key in six places
// (`birthName` for `legalName`, `formattedNumber` for `dialNumber`,
// `amountValue` for `amount`, `payFrequencyCode` for `payCycleCode`, a bare
// string for the `subdivisionCode` OBJECT, and a `jobTitle` RUN has no field
// for). None of it had ever been sent, so nothing was mis-filed; it would all
// have surfaced as 400s on the first hire.
//
// `ADP_ONBOARDING_TEMPLATE_CODE` and a payroll group code came from that same
// inference and appear NOWHERE in the RUN guide. The template code is kept as
// an opt-in override in case /meta says otherwise for this account, but it no
// longer gates `adpEnabled()`.
//
// WHAT RUN REQUIRES AND READYDOC CANNOT SUPPLY IS NAMED, NEVER INVENTED —
// `missingForAdp()`. Gender is required for an employee and the wizard does not
// ask; worker type, pay type and the work-location state are company-level
// codelist values that belong in env, not in a guess. A payload that fabricates
// a pay type to satisfy a validator writes a wrong payroll record, which is
// worse than a refusal that names the field.
//
// The first live send is still checked against /meta and against ADP's own
// refusal text, which is returned verbatim.

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

/**
 * Enough to SEND a new hire. This is the four credentials and nothing else.
 *
 * It used to also require `ADP_ONBOARDING_TEMPLATE_CODE`, on the belief that
 * Applicant Onboard V2 refuses a hire without one. ADP's RUN-specific guide has
 * no such field anywhere in its data dictionary, so that gate could only ever
 * hold the integration shut over a variable RUN never asks for. The variable is
 * still honoured if set — see `applicantOnboardPayload` — it just no longer
 * decides whether the hand-off is on.
 */
export function adpEnabled() {
  return adpConnected();
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
// ADP's code objects. The RUN guide is internally inconsistent about this: its
// data dictionary writes the path as `.../nameCode/code`, while the codelist
// sample and every 400 message the live API generates say `codeValue`
// ("taxWithholdingStatus->statusCode->codeValue should be ..."). The error text
// is produced by the running service, so it wins. One helper, so a first live
// refusal that proves otherwise is a one-line change rather than twenty.
function codeObj(codeValue, shortName) {
  if (codeValue === null || codeValue === undefined || codeValue === '') return null;
  return { codeValue: String(codeValue), ...(shortName ? { shortName: String(shortName) } : {}) };
}

const money = (v, currencyCode = 'USD') => {
  // An absent value is absent, not zero. `Number('')` is 0 and finite, which is
  // how a blank "other income" box became a filed $0.00 on the first cut.
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? { amount: n, currencyCode } : null;
};

// `production_entries`-style conflation in our own schema: `pay_frequency` holds
// EITHER a pay schedule (weekly, biweekly) or the word "hourly", which is a pay
// TYPE and not a schedule at all. RUN's payCycleCode wants the schedule, so
// "hourly" is not an answer to it — report it missing rather than filing a pay
// cycle RUN does not have.
const HOURLY = /hour/i;
const payCycleOf = (v) => (v && !HOURLY.test(String(v)) ? String(v) : null);

// RUN refuses more than one character here ("The Middle Initial field can
// include only one letter (A-Z)"), so a full middle name is a 400. Take the
// initial rather than dropping the field.
function middleInitial(v) {
  const m = String(v ?? '').trim().match(/[A-Za-z]/);
  return m ? m[0].toUpperCase() : null;
}

// Company-level facts RUN requires on every hire that are NOT per-person and
// that ReadyDoc has never collected. They are env, not guesses: an invented
// worker type or pay type is a wrong payroll record, and `missingForAdp` names
// them instead. Their VALUES come from RUN's codelists, not from prose.
const workLocationState = () => process.env.ADP_WORK_LOCATION_STATE || null;
const workerTypeCode = () => process.env.ADP_WORKER_TYPE_CODE || null;
// RUN distinguishes a 1099 from a W-2 by its own worker-type code, which is a
// codelist value nobody here can invent. Its own variable, so setting the
// employee one does not silently file contractors as employees.
const contractorTypeCode = () => process.env.ADP_CONTRACTOR_TYPE_CODE || null;
const payTypeCode = () => process.env.ADP_PAY_TYPE_CODE || null;

/**
 * What RUN requires that this record cannot supply. Derived on every read, the
 * `missingToFinish` rule — a gap is NAMED, never filled. Every entry here is
 * marked Required (Y) in the RUN guide's data dictionary for an employee.
 */
export function missingForAdp(rec = {}) {
  const out = [];
  if (!rec.first_name) out.push('First name');
  if (!rec.last_name) out.push('Last name');
  if (!rec.address1) out.push('Address line 1');
  if (!rec.city) out.push('City');
  if (!rec.state) out.push('State');
  if (!rec.zip) out.push('Zip');
  if (!rec.dob) out.push('Birth date');
  if (!rec.start_date) out.push('Hire date');
  if (!rec.department) out.push('Department (must match a code in RUN\u2019s Departments codelist)');
  if (!payCycleOf(rec.pay_frequency)) out.push('Pay schedule (RUN pay-cycle code; "hourly" is a pay type, not a schedule)');
  if (rec.pay_rate == null || rec.pay_rate === '') out.push('Pay rate');
  if (rec.worker_type === 'contractor') {
    if (!rec.w9_tax_classification) out.push('Federal tax classification (W-9 line 3a)');
    if (!rec.ssn && !rec.ein) out.push('Taxpayer ID number (SSN or EIN)');
  } else if (!rec.w4_filing_status) {
    out.push('Federal withholding status (W-4)');
  }
  // Not collected anywhere in ReadyDoc, and not inventable.
  // "Mandatory for employee" in RUN's dictionary — a contractor is not asked.
  if (rec.worker_type !== 'contractor' && !rec.gender && !process.env.ADP_GENDER_CODE_DEFAULT) {
    out.push('Gender (RUN requires it for an employee)');
  }
  if (rec.worker_type === 'contractor') {
    if (!contractorTypeCode()) out.push('Contractor worker type (set ADP_CONTRACTOR_TYPE_CODE from RUN\u2019s codelist)');
  } else if (!workerTypeCode()) {
    out.push('Worker type (set ADP_WORKER_TYPE_CODE from RUN\u2019s codelist)');
  }
  if (!payTypeCode()) out.push('Pay type (set ADP_PAY_TYPE_CODE from RUN\u2019s codelist)');
  if (!workLocationState()) out.push('Work location state (set ADP_WORK_LOCATION_STATE)');
  return out;
}

/**
 * The Applicant Onboard V2 body for RUN, built against ADP's "Applicant Onboard
 * V2 API Guide for RUN Powered by ADP" (last modified 19 Apr 2026), Chapter 7's
 * data dictionary. Pure: record in, body out, no network and no database.
 *
 * A field is included only when there is a value for it. RUN marks several of
 * these Required (Y); `missingForAdp` reports those rather than this function
 * inventing them, because a payload that fabricates a pay type to get past a
 * validator writes a wrong payroll record.
 */
export function applicantOnboardPayload(rec, opts = {}) {
  // Not a RUN field — it appears nowhere in the RUN guide. Kept as an opt-in
  // escape hatch in case /meta says otherwise for this account; never required.
  const templateCode = opts.templateCode ?? process.env.ADP_ONBOARDING_TEMPLATE_CODE ?? null;

  // ADP'S GUIDE SUPPORTS BOTH: "onboarding a new employee or contractor", and
  // its whole data dictionary reads "Employees (W2)/Contractors (1099s)". Two
  // things differ for a contractor and both come off that dictionary:
  // `givenName` is labelled "First name/Company name", and `familyName` is
  // required "for employee and contractor" but "Not required for company type".
  const isContractor = rec.worker_type === 'contractor';
  const companyType = isContractor && !!rec.w9_business_name
    && rec.w9_tax_classification && rec.w9_tax_classification !== 'individual_sole_proprietor';

  const mi = middleInitial(rec.middle_name);
  const personal = {
    legalName: companyType
      ? { givenName: rec.w9_business_name }
      : {
        ...(rec.first_name ? { givenName: rec.first_name } : {}),
        ...(mi ? { middleName: mi } : {}),
        ...(rec.last_name ? { familyName: rec.last_name } : {}),
      },
    ...(rec.preferred_name ? { preferredName: { formattedName: rec.preferred_name } } : {}),
    ...(rec.dob ? { birthDate: rec.dob } : {}),
    // The W-9's Part I number. A contractor may file under an EIN instead of an
    // SSN, and the two are different government IDs — sending an EIN as an SSN
    // would be a wrong taxpayer number on a 1099.
    ...(isContractor && rec.w9_tin_type === 'ein' && rec.ein
      ? { governmentIDs: [{ id: String(rec.ein).replace(/\D/g, ''), nameCode: codeObj('EIN') }] }
      : rec.ssn ? { governmentIDs: [{ id: String(rec.ssn).replace(/\D/g, ''), nameCode: codeObj('SSN') }] } : {}),
    ...(rec.gender || process.env.ADP_GENDER_CODE_DEFAULT
      ? { genderCode: codeObj(rec.gender || process.env.ADP_GENDER_CODE_DEFAULT) } : {}),
    ...(rec.email || rec.phone ? {
      communication: {
        ...(rec.email ? { emails: [{ emailUri: rec.email }] } : {}),
        // `dialNumber`, not `formattedNumber` — the guide's Personal Information table.
        ...(rec.phone ? { mobiles: [{ dialNumber: String(rec.phone) }] } : {}),
      },
    } : {}),
    ...(rec.address1 || rec.city || rec.zip ? {
      legalAddress: {
        ...(rec.address1 ? { lineOne: rec.address1 } : {}),
        ...(rec.address2 ? { lineTwo: rec.address2 } : {}),
        ...(rec.city ? { cityName: rec.city } : {}),
        // An OBJECT, not the bare string the first cut sent.
        ...(rec.state ? { subdivisionCode: codeObj(rec.state, rec.state) } : {}),
        ...(rec.zip ? { postalCode: rec.zip } : {}),
        countryCode: 'US',
      },
    } : {}),
  };

  const wtc = codeObj(isContractor ? contractorTypeCode() : workerTypeCode());
  const wls = workLocationState();
  const worker = {
    ...(rec.start_date ? { hireDate: rec.start_date } : {}),
    // Capital N on NameCode is the guide's own spelling for this one field.
    ...(rec.department ? { homeOrganizationalUnits: [{ NameCode: codeObj(rec.department, rec.department) }] } : {}),
    ...(wtc ? { workerTypeCode: wtc } : {}),
    ...(wls ? { homeWorkLocation: { address: { subdivisionCode: codeObj(wls, wls) } } } : {}),
  };

  // A rate RUN can take one of two ways: per hour, or per pay period. "hourly"
  // anywhere in the frequency means hourly; anything else is a period rate.
  const hourly = HOURLY.test(String(rec.pay_frequency || ''));
  const amt = money(rec.pay_rate);
  const ptc = codeObj(payTypeCode());
  const payroll = {
    ...(ptc ? { remunerationBasisCode: ptc } : {}),
    ...(amt ? {
      baseRemuneration: hourly ? { hourlyRateAmount: amt } : { payPeriodRateAmount: amt },
    } : {}),
    // `payCycleCode` (Pay schedule) — there is no `payFrequencyCode` in RUN.
    ...(payCycleOf(rec.pay_frequency)
      ? { payCycleCode: codeObj(payCycleOf(rec.pay_frequency), payCycleOf(rec.pay_frequency)) } : {}),
  };

  // The W-4 ReadyDoc already collects, which RUN marks Required (Y) as a whole
  // profile. Values are sent as stored; RUN's federal-tax-filing-status
  // codelist is the authority on the code and a refusal will name it.
  const fit = {
    ...(rec.w4_filing_status ? { taxFilingStatusCode: codeObj(rec.w4_filing_status) } : {}),
    ...(money(rec.w4_other_income) ? { additionalIncomeAmount: money(rec.w4_other_income) } : {}),
    ...(money(rec.w4_extra_withholding) ? { additionalTaxAmount: money(rec.w4_extra_withholding) } : {}),
  };
  // NO FEDERAL WITHHOLDING INSTRUCTION FOR A CONTRACTOR. Nothing is withheld
  // from a 1099 payment, so a tax profile here would be an instruction ADP has
  // no business acting on — and the W-4 fields it is built from are blank for a
  // contractor anyway.
  const tax = !isContractor && Object.keys(fit).length
    ? { usFederalTaxInstruction: { federalIncomeTaxInstruction: fit } } : {};

  return {
    applicantOnboarding: {
      ...(templateCode ? { onboardingTemplateCode: codeObj(templateCode) } : {}),
      applicantPersonalProfile: personal,
      ...(Object.keys(worker).length ? { applicantWorkerProfile: worker } : {}),
      ...(Object.keys(payroll).length ? { applicantPayrollProfile: payroll } : {}),
      ...(Object.keys(tax).length ? { applicantTaxProfile: tax } : {}),
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
