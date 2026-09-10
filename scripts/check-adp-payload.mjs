// The Applicant Onboard V2 body ReadyDoc would send to RUN, checked without
// credentials: the mapping is pure, and a wrong field name here is a 400 from
// ADP on the day somebody first presses Submit.
process.env.ADP_ONBOARDING_TEMPLATE_CODE = 'TPL-TEST';
delete process.env.ADP_ONBOARDING_STATUS; delete process.env.ADP_PAYROLL_GROUP_CODE;
const { applicantOnboardPayload, adpEnabled, adpConnected } = await import('../server/adp.js');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const rec = { first_name: 'Ana', middle_name: 'M', last_name: 'Lopez', dob: '1994-03-02', ssn: '123-45-6789',
  email: 'ana@example.com', phone: '8015551234', address1: '281 E 1600 N', city: 'Vineyard', state: 'UT', zip: '84059',
  start_date: '2026-09-21', position: 'Batching Operator', pay_rate: '19.50', pay_frequency: 'Hourly' };
const p = applicantOnboardPayload(rec).applicantOnboarding;
t('the body is the v2 applicantOnboarding shape, not the old event envelope', !!p && !('events' in applicantOnboardPayload(rec)));
t('the template code and an inprogress status are carried', p.onboardingTemplateCode.code === 'TPL-TEST' && p.onboardingStatus.statusCode.code === 'inprogress');
t('the name is a birthName with given / middle / family', p.applicantPersonalProfile.birthName.givenName === 'Ana' && p.applicantPersonalProfile.birthName.familyName === 'Lopez' && p.applicantPersonalProfile.birthName.middleName === 'M');
t('the SSN goes as a governmentID with the dashes stripped', p.applicantPersonalProfile.governmentIDs[0].id === '123456789' && p.applicantPersonalProfile.governmentIDs[0].nameCode.code === 'SSN');
t('email and phone are under communication', p.applicantPersonalProfile.communication.emails[0].emailUri === 'ana@example.com' && p.applicantPersonalProfile.communication.mobiles[0].formattedNumber === '8015551234');
t('the address carries the state as subdivisionCode and the country', p.applicantPersonalProfile.legalAddress.subdivisionCode === 'UT' && p.applicantPersonalProfile.legalAddress.countryCode === 'US' && p.applicantPersonalProfile.legalAddress.postalCode === '84059');
t('hire date and job title are on the worker profile', p.applicantWorkerProfile.hireDate === '2026-09-21' && p.applicantWorkerProfile.jobTitle === 'Batching Operator');
t('an hourly rate is hourlyRateAmount', p.applicantPayrollProfile.baseRemuneration.hourlyRateAmount.amountValue === 19.5 && !p.applicantPayrollProfile.baseRemuneration.payPeriodRateAmount);
const q = applicantOnboardPayload({ ...rec, pay_rate: '2400', pay_frequency: 'biweekly' }).applicantOnboarding;
t('a non-hourly rate is a pay-period rate carrying its frequency', q.applicantPayrollProfile.baseRemuneration.payPeriodRateAmount.amountValue === 2400 && q.applicantPayrollProfile.payFrequencyCode.code === 'biweekly');
const bare = applicantOnboardPayload({ first_name: 'B', last_name: 'C' }).applicantOnboarding;
t('a record with nothing else sends no empty strings and no empty profiles', !bare.applicantPersonalProfile.legalAddress && !bare.applicantPersonalProfile.communication && !bare.applicantWorkerProfile && !bare.applicantPayrollProfile);
t('a payroll group code is carried when set', applicantOnboardPayload(rec, { payrollGroupCode: '938' }).applicantOnboarding.applicantPayrollProfile.payrollGroupCode === '938');
t('with no credentials the integration is neither connected nor enabled', !adpConnected() && !adpEnabled());

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
