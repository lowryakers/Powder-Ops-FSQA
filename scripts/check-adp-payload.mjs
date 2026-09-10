// The Applicant Onboard V2 body ReadyDoc would send to RUN, checked without
// credentials: the mapping is pure, and a wrong field name here is a 400 from
// ADP on the day somebody first presses Submit.
//
// EVERY ASSERTION BELOW CITES ADP'S "Applicant Onboard V2 API Guide for RUN
// Powered by ADP" (last modified 19 Apr 2026), Chapter 7. The previous version
// of this file asserted the OPPOSITE of most of them and passed 12/12, because
// it was written from the same wrong inference as the code. A test derived from
// the implementation only proves the implementation is self-consistent.
delete process.env.ADP_ONBOARDING_TEMPLATE_CODE;
delete process.env.ADP_PAYROLL_GROUP_CODE;
delete process.env.ADP_WORKER_TYPE_CODE;
delete process.env.ADP_PAY_TYPE_CODE;
delete process.env.ADP_WORK_LOCATION_STATE;
delete process.env.ADP_GENDER_CODE_DEFAULT;
const { applicantOnboardPayload, missingForAdp, adpEnabled, adpConnected } = await import('../server/adp.js');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const rec = { first_name: 'Ana', middle_name: 'Maria', last_name: 'Lopez', dob: '1994-03-02', ssn: '123-45-6789',
  email: 'ana@example.com', phone: '8015551234', address1: '281 E 1600 N', city: 'Vineyard', state: 'UT', zip: '84059',
  start_date: '2026-09-21', position: 'Batching Operator', department: 'Production',
  pay_rate: '19.50', pay_frequency: 'Hourly', w4_filing_status: 'S', w4_extra_withholding: '25' };
const p = applicantOnboardPayload(rec).applicantOnboarding;
const pers = p.applicantPersonalProfile;

t('the body is the v2 applicantOnboarding shape, not the old event envelope',
  !!p && !('events' in applicantOnboardPayload(rec)));

// Personal — guide Chapter 7, "Personal Information > Employee Info".
t('the name is legalName, NOT birthName (the guide has no birthName)',
  pers.legalName.givenName === 'Ana' && pers.legalName.familyName === 'Lopez' && !pers.birthName);
t('a full middle name is cut to ONE letter — RUN 400s on more than one',
  pers.legalName.middleName === 'M');
t('the SSN goes as a governmentID with the dashes stripped',
  pers.governmentIDs[0].id === '123456789' && pers.governmentIDs[0].nameCode.codeValue === 'SSN');
t('a mobile is dialNumber, NOT formattedNumber',
  pers.communication.mobiles[0].dialNumber === '8015551234' && !('formattedNumber' in pers.communication.mobiles[0]));
t('an email is emailUri', pers.communication.emails[0].emailUri === 'ana@example.com');
t('subdivisionCode is an OBJECT carrying the code, not a bare string',
  pers.legalAddress.subdivisionCode.codeValue === 'UT' && typeof pers.legalAddress.subdivisionCode === 'object');
t('the address keeps lineOne / cityName / postalCode / countryCode',
  pers.legalAddress.lineOne === '281 E 1600 N' && pers.legalAddress.cityName === 'Vineyard'
  && pers.legalAddress.postalCode === '84059' && pers.legalAddress.countryCode === 'US');

// Worker — guide Chapter 7, "Employment Info".
t('hire date is on the worker profile', p.applicantWorkerProfile.hireDate === '2026-09-21');
t('jobTitle is NOT sent — RUN has no such field', !('jobTitle' in p.applicantWorkerProfile));
t('the department goes as homeOrganizationalUnits with the guide\'s capital-N NameCode',
  p.applicantWorkerProfile.homeOrganizationalUnits[0].NameCode.codeValue === 'Production');

// Payroll — guide Chapter 7, "Payroll Info".
t('an hourly rate is hourlyRateAmount.amount, NOT amountValue',
  p.applicantPayrollProfile.baseRemuneration.hourlyRateAmount.amount === 19.5
  && !('amountValue' in p.applicantPayrollProfile.baseRemuneration.hourlyRateAmount));
t('"hourly" is a pay TYPE and never files as a pay cycle',
  !p.applicantPayrollProfile.payCycleCode);
const q = applicantOnboardPayload({ ...rec, pay_rate: '2400', pay_frequency: 'biweekly' }).applicantOnboarding;
t('a non-hourly rate is payPeriodRateAmount.amount with payCycleCode, NOT payFrequencyCode',
  q.applicantPayrollProfile.baseRemuneration.payPeriodRateAmount.amount === 2400
  && q.applicantPayrollProfile.payCycleCode.codeValue === 'biweekly'
  && !('payFrequencyCode' in q.applicantPayrollProfile));
t('no payroll group code is invented — RUN has no such field',
  !('payrollGroupCode' in p.applicantPayrollProfile));

// Tax — guide Chapter 7, "Tax Info > Federal Tax". RUN marks the profile Y.
t('the W-4 withholding status travels as taxFilingStatusCode',
  p.applicantTaxProfile.usFederalTaxInstruction.federalIncomeTaxInstruction.taxFilingStatusCode.codeValue === 'S');
t('extra withholding is additionalTaxAmount.amount',
  p.applicantTaxProfile.usFederalTaxInstruction.federalIncomeTaxInstruction.additionalTaxAmount.amount === 25);
t('a BLANK money field is absent, never a filed $0.00',
  !('additionalIncomeAmount' in p.applicantTaxProfile.usFederalTaxInstruction.federalIncomeTaxInstruction));

// Template code: not a RUN field, opt-in only.
t('no template code is sent unless one is deliberately set', !p.onboardingTemplateCode);
t('a template code IS carried when explicitly passed',
  applicantOnboardPayload(rec, { templateCode: 'TPL-1' }).applicantOnboarding.onboardingTemplateCode.codeValue === 'TPL-1');
t('no onboardingStatus is sent — the guide has no such field', !p.onboardingStatus);

const bare = applicantOnboardPayload({ first_name: 'B', last_name: 'C' }).applicantOnboarding;
t('a record with nothing else sends no empty strings and no empty profiles',
  !bare.applicantPersonalProfile.legalAddress && !bare.applicantPersonalProfile.communication
  && !bare.applicantWorkerProfile && !bare.applicantPayrollProfile && !bare.applicantTaxProfile);

// The gaps are NAMED, never filled.
const gaps = missingForAdp(rec);
t('gender is reported missing — RUN requires it and the wizard never asks',
  gaps.some(g => /Gender/i.test(g)));
t('worker type, pay type and work-location state are reported, not guessed',
  ['Worker type', 'Pay type', 'Work location'].every(f => gaps.some(g => g.startsWith(f))));
t('none of those three is present in the payload while unset',
  !p.applicantWorkerProfile.workerTypeCode && !p.applicantWorkerProfile.homeWorkLocation
  && !p.applicantPayrollProfile.remunerationBasisCode);
t('a record missing the basics names every one of them',
  ['First name', 'Last name', 'Address line 1', 'City', 'State', 'Zip', 'Birth date', 'Hire date']
    .every(f => missingForAdp({}).some(g => g.startsWith(f))));
t('setting the company codes puts them in the payload and clears the gaps', (() => {
  process.env.ADP_WORKER_TYPE_CODE = 'F'; process.env.ADP_PAY_TYPE_CODE = 'H'; process.env.ADP_WORK_LOCATION_STATE = 'UT';
  const r = applicantOnboardPayload(rec).applicantOnboarding;
  const g = missingForAdp(rec);
  const ok = r.applicantWorkerProfile.workerTypeCode.codeValue === 'F'
    && r.applicantPayrollProfile.remunerationBasisCode.codeValue === 'H'
    && r.applicantWorkerProfile.homeWorkLocation.address.subdivisionCode.codeValue === 'UT'
    && !g.some(x => /^(Worker type|Pay type|Work location)/.test(x));
  delete process.env.ADP_WORKER_TYPE_CODE; delete process.env.ADP_PAY_TYPE_CODE; delete process.env.ADP_WORK_LOCATION_STATE;
  return ok;
})());

t('with no credentials the integration is neither connected nor enabled', !adpConnected() && !adpEnabled());

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
