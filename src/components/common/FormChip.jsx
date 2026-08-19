// "FORM 431-02 V5" on a task card or a record.
//
// The consultant's point, and it is a fair one: the plant's tasks came off
// numbered paper forms, and an auditor holding the Forms Master Index needs to
// see which numbered form a ReadyDoc task satisfies. Until now the task said
// "Brittle Plastic & Glass Inspection — Gown Room" and nothing else.
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO.
//
//  * It renders NOTHING when the subject maps to no form. Not "no form", not a
//    dash, not a placeholder — nothing. A guessed or empty form number on a
//    compliance record is worse than an absent one, and the unmapped ones are
//    reported to Document Control in the Form Registry panel, which is where
//    somebody can actually fix them.
//  * It fetches nothing and takes no props from the server. The match is
//    computed from what the card already has in hand, so a chip cannot put a
//    request (or a spinner, or a failure) in front of an operator.
//  * It is not a button and not a link. Display only — nothing about the
//    task's behaviour changes because it now shows its number.

import { formFor } from '../../../shared/form-registry.js';

/**
 * @param subject  what the caller knows — { taskTitle } / { sanitationArea } /
 *                 { qmsType } / { scaleForm } / { module }.
 * @param revision the revision the RECORD stored when it was filed, if it has
 *                 one (`checklist_revision` and friends). It wins over the
 *                 registry's current revision, so a record filed under V4 goes
 *                 on saying V4 after Document Control issues V5.
 */
export default function FormChip({ subject, revision = null, className = '' }) {
  const form = formFor(subject || {});
  if (!form) return null;

  const rev = revision || form.revision;
  return (
    <span
      className={`inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ${className}`}
      title={`${form.title}${rev ? ` — ${rev}` : ''}`}
    >
      {form.code}{rev ? ` ${rev}` : ''}
    </span>
  );
}
