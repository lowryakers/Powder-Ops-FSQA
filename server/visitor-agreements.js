// The documents a visitor signs at the lobby tablet.
//
// The NDA is transcribed VERBATIM from the plant's own
// Non_Disclosure_Agreement_V5_14_2025.docx, including the two typos its authors
// left in it ("III.." with the doubled period, "Recipient agreed not use") —
// the same rule the internal-audit checklist and the receiving checklist follow.
// A visitor signing this in the lobby must be agreeing to the same words as a
// visitor signing the paper copy, and quietly improving the grammar makes the
// app disagree with the executed agreement. Correcting it is a document change,
// not an edit here.
//
// SEEDED AS A REVISION, NEVER EDITED IN PLACE. `visitor_agreements` is
// insert-only on (code, revision): once anybody has signed V5.14.2025, that
// wording is frozen, because a signature is against words and not against a
// pointer. A new wording is a new revision, which supersedes the old one for
// new visitors and leaves every existing signature meaning exactly what it
// meant.
import { createHash } from 'crypto';
import { randomUUID as uuid } from 'crypto';

export const NDA_CODE = 'NDA';
export const NDA_REVISION = 'V5.14.2025';
export const NDA_TITLE = 'Non-Disclosure Agreement';

// The agreement, as written. Section headings are kept on their own lines so the
// kiosk can render it readably on a tablet without re-flowing the author's
// numbering.
export const NDA_BODY = `THIS NON DISCLOSURE AGREEMENT (the "Agreement") is entered into by the Recipient named below in regards to Powder Ops, LLC, a Utah limited liability company (the "Disclosing Party") of 281 E 1600 N Vineyard, UT 84059. The party disclosing information under this Agreement is the "Owner" and the party receiving information under this Agreement is the "Recipient."

Powder Ops (the "Disclosing Party") has requested and the Recipient agrees that the Recipient will protect the confidential material and information which may be disclosed between the Owner and the Recipient. Therefore, the parties agree as follows:

I. CONFIDENTIAL INFORMATION.
The term "Confidential Information" means any information or material which is proprietary to the Owner, whether or not owned or developed by the Owner, which is not generally known other than by the Owner, and which the Recipient may obtain through any direct or indirect contact with the Owner. Regardless of whether specifically identified as confidential or proprietary, Confidential Information shall include any information provided by the Owner concerning the business, technology and information of the Owner and any third party with which the Owner deals, including, without limitation, business records and plans, trade secrets, technical data, product ideas, contracts, financial information, pricing structure, discounts, computer programs and listings, source code and/or object code, copyrights and intellectual property, inventions, sales leads, strategic alliances, partners, and customer and client lists. The nature of the information and the manner of disclosure are such that a reasonable person would understand it to be confidential.

A. "Confidential Information" does not include:
• matters of public knowledge that result from disclosure by the Owner;
• information rightfully received by the Recipient from a third party without a duty of confidentiality;
• information independently developed by the Recipient;
• information disclosed by operation of law;
• information disclosed by the Recipient with the prior written consent of the Owner;
• and any other information that both parties agree in writing is not confidential.

II. PROTECTION OF CONFIDENTIAL INFORMATION.
The Recipient understands and acknowledges that the Confidential Information has been developed or obtained by the Owner by the investment of significant time, effort and expense, and that the Confidential Information is a valuable, special and unique asset of the Owner which provides the Owner with a significant competitive advantage, and needs to be protected from improper disclosure. In consideration for the receipt by the Recipient of the Confidential Information.

III.. UNAUTHORIZED DISCLOSURE OF INFORMATION INJUNCTION.
If it appears that the Recipient has disclosed (or has threatened to disclose) Confidential Information in violation of this Agreement, the Owner shall be entitled to an injunction to restrain the Recipient from disclosing the Confidential Information in whole or in part. The Owner shall not be prohibited by this provision from pursuing other remedies, including a claim for losses and damages.

IV. NON-CIRCUMVENTION.
For a period of five (5) years after the end of the term of this Agreement, the Recipient will not attempt to do business with or otherwise solicit any business contacts found or otherwise referred by Owner to Recipient for the purpose of circumventing, the result of which shall be to prevent the Owner from realizing or recognizing a profit, fees, or otherwise, without the specific written approval of the Owner. If such circumvention shall occur the Owner shall be entitled to any commissions due pursuant to this Agreement or relating to such transaction.

V. RETURN OF CONFIDENTIAL INFORMATION.
Upon the written request of the Owner, the Recipient shall return to the Owner all written materials containing the Confidential Information. The Recipient shall also deliver to the Owner written statements signed by the Recipient certifying that all materials have been returned within five (5) days of receipt of the request.

VI. NO WARRANTY.
The Recipient acknowledges and agrees that the Confidential Information is provided on an "AS IS" basis. THE OWNER MAKES NO WARRANTIES, EXPRESS OR IMPLIED, WITH RESPECT TO THE CONFIDENTIAL INFORMATION AND HEREBY EXPRESSLY DISCLAIMS ANY AND ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. IN NO EVENT SHALL THE OWNER BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL, OR CONSEQUENTIAL DAMAGES IN CONNECTION WITH OR ARISING OUT OF THE PERFORMANCE OR USE OF ANY PORTION OF THE CONFIDENTIAL INFORMATION. The Owner does not represent or warrant that any product or business plans disclosed to the Recipient will be marketed or carried out as disclosed, or at all. Any actions taken by the Recipient in response to the disclosure of the Confidential Information shall be solely at the risk of the Recipient.

VII. USE OF INFORMATION.
Recipient agreed not use any of the Confidential Information for any purpose other than for the business purpose expressly contemplated by the parties hereto. Recipient shall disclose the Confidential Information only to its representatives who have a reasonable need to know such information for the purpose of assisting Recipient with respect to the business purpose.

VIII. NON-COMPETE.
Recipient agrees that, for a period of 3 years from the date of this Agreement, it shall not, directly or indirectly, use any Confidential Information to develop, manufacture, market, or sell any product or service that competes directly or indirectly with any product or service of the Owner.

IX. OWNERSHIP.
Recipient agrees that the Confidential Information is and shall be and remain the property of the Owner and that the Owner has not granted and will not grant Recipient any license, copyright, or similar right with respect to any of the Confidential Information or any other material made available to the Recipient on behalf of the Owner, except as may be set forth in a separate definitive agreement between Recipient and Owner.`;

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

/**
 * Seeded once per revision. A revision already present is left completely
 * alone — somebody may have signed it, and its wording is then frozen.
 */
export function seedVisitorAgreements(db) {
  try {
    const exists = db.prepare('SELECT id FROM visitor_agreements WHERE code = ? AND revision = ?')
      .get(NDA_CODE, NDA_REVISION);
    if (exists) return 0;
    db.prepare(`INSERT INTO visitor_agreements
      (id, code, title, revision, body, body_sha256, require_signature, is_active, effective_from, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 'system')`)
      .run(uuid(), NDA_CODE, NDA_TITLE, NDA_REVISION, NDA_BODY, sha256(NDA_BODY), '2025-05-14');
    // Only one revision of a code is offered at a time; a new one supersedes.
    db.prepare('UPDATE visitor_agreements SET is_active = 0 WHERE code = ? AND revision != ?')
      .run(NDA_CODE, NDA_REVISION);
    console.log(`[visitors] Seeded ${NDA_TITLE} ${NDA_REVISION}`);
    return 1;
  } catch (err) {
    console.warn('[visitors] Agreement seed skipped:', err.message);
    return 0;
  }
}
