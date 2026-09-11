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

const listed = (rows) => rows.map(u => ({ id: u.id, name: u.name }));

const people = (db, sql, ...args) => {
  try { return listed(db.prepare(sql).all(...args)); } catch { return []; }
};

const ACTIVE = "is_active = 1 AND name != 'ReadyBot' AND role != 'auditor'";

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
  const pay = payActionRecipients(db);

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
      key: 'employee_documents',
      label: 'A document to sign',
      what: 'The person a W-4, W-9 or policy was sent to; the office is told when it is signed or declined.',
      when: 'On send, then every other day while it is unsigned.',
      setting: null, source: 'rule',
      recipients: people(db, `SELECT id, name FROM users WHERE ${ACTIVE}
        AND (role = 'admin' OR LOWER(COALESCE(department,'')) IN ('office','hr')) ORDER BY name`),
      note: 'The employee always gets their own. The people listed are who is told when one is signed.',
    },
    {
      key: 'onboarding_finished',
      label: 'Onboarding packet finished',
      what: 'A new hire has completed their packet and it is ready for review.',
      when: 'The moment they press Finish.',
      setting: null, source: 'rule',
      recipients: people(db, `SELECT id, name FROM users WHERE ${ACTIVE}
        AND (role = 'admin' OR LOWER(COALESCE(department,'')) IN ('office','hr')) ORDER BY name`),
      note: 'Plus whoever started that onboarding, if they are not already listed.',
    },
    {
      key: 'qa_corrections',
      label: 'QA asked for a correction',
      what: 'QA flagged a production entry for the person who filed it, with QA’s own note.',
      when: 'When the flag is set, then every other day for asks at least two days old.',
      setting: null, source: 'rule',
      recipients: [],
      note: 'Goes to the person who filed the entry. Nobody else is told.',
    },
    {
      key: 'supplier_reviews',
      label: 'Supplier reviews outstanding',
      what: 'Annual vendor reviews past their date, and vendors never qualified at all.',
      when: 'Every third day while either list is not empty.',
      setting: null, source: 'rule',
      recipients: people(db, `SELECT id, name FROM users WHERE ${ACTIVE}
        AND (role = 'admin' OR LOWER(COALESCE(department,'')) IN ('qa','quality','purchasing')) ORDER BY name`),
    },
    {
      key: 'record_backfill',
      label: 'QA records waiting to be filed',
      what: 'Checks that were completed as tasks but never reached the QA record they answer.',
      when: 'Every third day while a pile is outstanding.',
      setting: null, source: 'rule',
      recipients: people(db, `SELECT id, name FROM users WHERE ${ACTIVE}
        AND (role = 'admin' OR LOWER(COALESCE(department,'')) IN ('qa','quality')) ORDER BY name`),
    },
    {
      key: 'controlled_changes',
      label: 'A change is parked for Document Control',
      what: 'A deployed form or acceptance criterion is waiting on approval, with its Document Change Request.',
      when: 'At boot, when the change is first seen.',
      setting: null, source: 'rule',
      recipients: people(db, `SELECT id, name FROM users WHERE ${ACTIVE}
        AND (role = 'admin' OR LOWER(COALESCE(department,'')) IN ('document_control','document control','quality','qa')) ORDER BY name`),
    },
    {
      key: 'auditor_pass',
      label: 'An auditor pass was issued',
      what: 'Somebody who is not an employee has been given a read-only session, and for how long.',
      when: 'The moment a pass is issued.',
      setting: null, source: 'rule',
      recipients: people(db, `SELECT id, name FROM users WHERE ${ACTIVE} AND role = 'admin' ORDER BY name`),
      note: 'The auditor is the subject of the pass and is never told about it.',
    },
  ];
}

/** The two audiences that are a plant decision rather than a rule. */
export const SETTABLE = {
  flash_report_recipients: 'Flash Report',
  pay_action_recipients: 'Pay reminders',
};
