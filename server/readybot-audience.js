// Who gets each automatic ReadyBot message, in one place.
//
// ReadyBot has no channel. Every message it sends is a DM between the bot and
// ONE person (`botDm`), so two people never read the same conversation — what
// made it look shared is that everybody has a DM with the same bot, and that
// several of these messages go to "all admins" by default.
//
// THE REGISTRY RESOLVES EACH AUDIENCE BY CALLING THE FUNCTION THAT ACTUALLY
// SENDS IT. A screen that described the audience with its own second copy of
// the rule would be a screen that quietly stops matching who is really being
// messaged — the defect this codebase keeps unpicking. Where an audience is a
// SQL predicate inside its sender (supplier chases, QA backfill), the same
// predicate is run here and the entry says it is fixed by rule, not settable.
//
// Two audiences are a plant decision and are stored in `app_settings`:
// the Flash Report and the pay-reminder queue. Everything else follows from
// what somebody did (the person who filed it, the person being asked) or from
// a department, and is reported rather than offered as a setting.
import { flashRecipients } from './api/flash.js';
import { payActionRecipients } from './api/pay.js';
import { cleanupDigestRecipients } from './cleanup-digest.js';
import { eodMissedRecipients } from './eod-chase.js';
import { employeeDocumentRecipients } from './api/employee-documents.js';
import { onboardingFinishedRecipients } from './api/onboarding.js';
import { supplierReviewRecipients } from './supplier-review.js';
import { recordBackfillRecipients } from './qa-record-backfill.js';
import { controlledChangeRecipients } from './api/controlled.js';
import { auditorPassRecipients } from './api/auditor-pass.js';
import { supplyCycleRecipients } from './api/office.js';

const listed = (rows) => rows.map(u => ({ id: u.id, name: u.name }));

// `people(db, sql)` and a local ACTIVE clause used to live here, to run "the
// same predicate" as a sender. Nothing uses them any more, and that is the
// point: every audience below is the sender's own exported function, so there
// is no predicate here to drift. The shared ACTIVE clause is in
// readybot-recipients.js, where the senders read it too.

/**
 * Every automatic ReadyBot message, with the people it reaches right now.
 * @returns {Array<{key:string,label:string,what:string,when:string,setting:string|null,source:string,recipients:Array,note?:string}>}
 */
export function readybotAudiences(db) {
  const flash = flashRecipients(db);
  const flashSet = (() => {
    try {
      const v = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'flash_report_recipients'").get()?.value || 'null');
      return Array.isArray(v) && v.length;
    } catch { return false; }
  })();
  const cleanupSet = (() => {
    try {
      const v = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'cleanup_review_recipients'").get()?.value || 'null');
      return Array.isArray(v) && v.length;
    } catch { return false; }
  })();
  const eodSet = (() => {
    try {
      const v = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'eod_missed_recipients'").get()?.value || 'null');
      return Array.isArray(v) && v.length;
    } catch { return false; }
  })();
  const pay = payActionRecipients(db);
  // EVERY ONE OF THESE CALLS THE FUNCTION THAT ACTUALLY SENDS THE MESSAGE.
  // D-079 allowed a second copy of the predicate here for audiences that were
  // SQL inside their sender, and by 14 September four of those copies had
  // drifted from the senders they described. There are no copies now.
  const employeeDocs = employeeDocumentRecipients(db);
  const onboardingFin = onboardingFinishedRecipients(db);
  const supplierRev = supplierReviewRecipients(db);
  const recordBf = recordBackfillRecipients(db);
  const ctrlChanges = controlledChangeRecipients(db);
  const auditorPass = auditorPassRecipients(db);
  const supplyCycles = supplyCycleRecipients(db);

  return [
    {
      key: 'flash_report',
      label: 'Flash Report',
      what: 'The morning read on the plant — exceptions, a scorecard, what was produced.',
      when: 'Weekday mornings from 06:00, plus a weekly on Monday and a monthly on the last day.',
      setting: 'flash_report_recipients',
      source: flashSet ? 'setting' : 'default',
      recipients: listed(flash),
      note: flashSet ? null : 'Nobody has been chosen, so it goes to every active admin. Choose people to narrow it.',
    },
    {
      key: 'pay_actions',
      label: 'Pay reminders',
      what: 'What is waiting on the office: a submitted evaluation to decide, an assignment past its date, a review clock with nobody asked.',
      when: 'Every third day while something is outstanding.',
      setting: 'pay_action_recipients',
      source: pay.source,
      recipients: listed(pay.users),
      note: pay.source === 'default'
        ? 'Nobody has been chosen, so it goes to admins and the office / HR departments.'
        : null,
    },
    {
      key: 'pay_review_asks',
      label: 'Evaluation asked of you',
      what: 'The reviewer is told when an evaluation is assigned to them, and chased while it is open.',
      when: 'On assignment, then every third day.',
      setting: null, source: 'rule',
      recipients: [],
      note: 'Goes to the one reviewer the evaluation was assigned to. Nobody else is told.',
    },
    {
      key: 'supply_cycles',
      label: 'Standing supply list due',
      what: 'A standing list (break room, cleaning, production) has come round and nobody has said what is needed.',
      when: 'On the day it falls due, then every third day while the cycle is open.',
      setting: 'supply_cycle_recipients',
      source: supplyCycles.source,
      recipients: listed(supplyCycles.users),
      note: supplyCycles.source === 'default'
        ? 'Nobody has been chosen, so it goes to admins and the office / HR departments.'
        : null,
    },
    {
      key: 'employee_documents',
      label: 'A document to sign',
      what: 'The person a W-4, W-9 or policy was sent to; the office is told when it is signed or declined.',
      when: 'On send, then every other day while it is unsigned.',
      setting: 'employee_document_recipients',
      source: employeeDocs.source,
      recipients: listed(employeeDocs.users),
      note: 'The employee always gets their own — that follows from being asked and is not set here. '
        + 'So does whoever sent it. The people listed are who ELSE is told when one is signed or declined.',
    },
    {
      key: 'onboarding_finished',
      label: 'Onboarding packet finished',
      what: 'A new hire has completed their packet and it is ready for review.',
      when: 'The moment they press Finish.',
      setting: 'onboarding_finished_recipients',
      source: onboardingFin.source,
      recipients: listed(onboardingFin.users),
      note: 'Plus whoever started that onboarding — that follows from what they did and is not set here.',
    },
    {
      key: 'qa_corrections',
      label: 'QA asked for a correction',
      what: 'QA flagged a production entry for the person who filed it, with QA’s own note.',
      when: 'When the flag is set, then again once the correction is a day overdue (D-083).',
      setting: null, source: 'rule',
      recipients: [],
      note: 'Goes to the person who filed the entry. If they cannot be reached, or the ask goes '
        + 'unanswered past its 24-hour clock, it is raised once to the QA who signed and to '
        + 'production supervisors — otherwise nobody else is told.',
    },
    {
      key: 'eod_missed',
      label: 'End-of-day reports missing',
      what: 'Scheduled production runs with no end-of-day entry, counted by team and room with the oldest date. '
        + 'It files nothing and dismisses nothing.',
      when: 'A weekday morning each week — daily while more than 25 are outstanding. Silent at zero.',
      setting: 'eod_missed_recipients',
      source: eodSet ? 'setting' : 'default',
      recipients: listed(eodMissedRecipients(db)),
      note: eodSet
        ? 'Anything older than the escalation window still reaches QA and Adam, whatever this list says.'
        : 'Nobody has been chosen, so it goes to the production supervisors who file the reports, QA, Adam and the admins.',
    },
    {
      key: 'cleanup_review',
      label: 'Cleanup review digest',
      what: 'How much stale open work is sitting in Cleanup Review, split by cadence, with the oldest date. '
        + 'It closes nothing — somebody still picks the rows and gives a reason.',
      when: 'Weekday mornings, every fortnight — weekly while more than 25 tasks are outstanding. Silent at zero.',
      setting: 'cleanup_review_recipients',
      source: cleanupSet ? 'setting' : 'default',
      recipients: listed(cleanupDigestRecipients(db)),
      note: cleanupSet ? null
        : 'Nobody has been chosen, so it goes to the admins, QA leadership and Adam — whoever would be asked anyway.',
    },
    {
      key: 'supplier_reviews',
      label: 'Supplier reviews outstanding',
      what: 'Annual vendor reviews past their date, and vendors never qualified at all.',
      when: 'Every third day while either list is not empty.',
      setting: 'supplier_review_recipients',
      source: supplierRev.source,
      recipients: listed(supplierRev.users),
      note: supplierRev.source === 'setting' ? null
        : 'An overdue review is Quality’s work; a vendor never qualified at all is Purchasing’s chase '
          + '(D-044). Only Quality is listed by default — add Jake here if the chase should reach him.',
    },
    {
      key: 'record_backfill',
      label: 'QA records waiting to be filed',
      what: 'Checks that were completed as tasks but never reached the QA record they answer.',
      when: 'Every third day while a pile is outstanding.',
      setting: 'record_backfill_recipients',
      source: recordBf.source,
      recipients: listed(recordBf.users),
    },
    {
      key: 'controlled_changes',
      label: 'A change is parked for Document Control',
      what: 'A deployed form or acceptance criterion is waiting on approval, with its Document Change Request.',
      when: 'At boot, when the change is first seen.',
      setting: 'controlled_change_recipients',
      source: ctrlChanges.source,
      recipients: listed(ctrlChanges.users),
      note: ctrlChanges.source === 'setting' ? null
        : 'The people who approve one. The old list added every admin, so a parked form change reached '
          + 'most of the leadership and the approvers were a minority of it.',
    },
    {
      key: 'auditor_pass',
      label: 'An auditor pass was issued',
      what: 'Somebody who is not an employee has been given a read-only session, and for how long.',
      when: 'The moment a pass is issued.',
      setting: 'auditor_pass_recipients',
      source: auditorPass.source,
      recipients: listed(auditorPass.users),
      note: 'The auditor is the subject of the pass and is never told about it. Neither is whoever '
        + 'issued it — they already know. This screen used to say "every admin" while the message also '
        + 'went to QA, so it under-reported who was told.',
    },
  ];
}

/** The two audiences that are a plant decision rather than a rule. */
export const SETTABLE = {
  flash_report_recipients: 'Flash Report',
  pay_action_recipients: 'Pay reminders',
  cleanup_review_recipients: 'Cleanup review digest',
  eod_missed_recipients: 'End-of-day reports missing',
  // The six that were department-plus-admin SQL until 14 September. Settable is
  // what makes "is Marnee still the owner" a question Settings answers rather
  // than one a deploy does.
  employee_document_recipients: 'A document to sign',
  onboarding_finished_recipients: 'Onboarding packet finished',
  supplier_review_recipients: 'Supplier reviews outstanding',
  record_backfill_recipients: 'QA records waiting to be filed',
  controlled_change_recipients: 'A change is parked for Document Control',
  auditor_pass_recipients: 'An auditor pass was issued',
  supply_cycle_recipients: 'Standing supply list due',
};
