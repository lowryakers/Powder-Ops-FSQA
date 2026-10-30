# Part 11 check: document approvals and training sign-offs (30 Oct 2026)

Read-only review of ReadyDoc's code against five points Lowry set. **Scope:** controlled-document approvals and
signatures, and training sign-offs (the competence tick, group sign-offs, course-draft approvals, practical
evaluations). Other signatures (QA Review, QMS, COA, calibration, …) were seen in passing and are noted where it matters.

Why it applies: we make dietary supplements, so records required by 21 CFR 111 that we keep electronically must meet
21 CFR Part 11. This is an engineering reading of the code, not legal advice.

## Summary

| # | Requirement | Document approvals | Training sign-offs |
|---|---|---|---|
| 1 | Unique user per signature; no shared accounts | **Partly** | **Partly** |
| 2 | Name, date/time and meaning shown on the record and on printouts | **Partly** | **Partly** |
| 3 | Password re-entered at the moment of signing | **Partly** (revisions yes; first approval and "Sign" no) | **Partly** (drafts and practical evaluations yes; the competence tick no) |
| 4 | Signature cannot be removed, copied or moved to another record | **Missing** for the drawn "Sign" | **Partly** |
| 5 | Audit trail users cannot edit, kept as long as the record | **Partly** | **Partly** |

## 1. Unique user per signature; no shared accounts — PARTLY

What meets it:
- One account per person, with a unique sign-in name (`server/usernames.js`, unique index). Records keep the full name
  (`users.name`).
- Every signature takes the signer from the signed-in session (`req.user`), never from a name typed into the form.
  Examples: revision approval `server/api/documents.js:879–883`, course drafts `server/course-drafts.js` (`signDraft`).
- An account with history cannot be deleted, only deactivated (`server/api/users.js:813–826`).
- Passwords: scrypt hashes, at least 8 characters, expire yearly (`server/password-policy.js`), lockout after failed
  sign-ins, and failed signatures are rate-limited and audited (`server/signature.js`).
- Bots can never sign (D-161, D-279).

Gaps:
- **Nothing stops a shared login** such as one "QA tablet" account. This is a policy plus a check: there is no
  report of accounts signed in from several devices at the same time.
- **The competence statement names the `trainer` field, which is typed text** (`shared/training-record-fields.js:56`,
  `server/api/training.js:374, 591`). The person who ticked it is recorded separately (`recorded_by`, from the session),
  but the statement can name somebody else.
- **First approval of a document can name a typed approver** (`approved_by` in `POST/PUT /documents`,
  `server/api/documents.js:907, 1034`). This is meant as a transcription of the signed paper ("NOT A SIGNATURE", line
  1013), but the document still goes into force in the app on that act.
- Accounts that share a name are reported (D-262) but nothing prevents two people using one.

## 2. Name, date/time and meaning on the record and on printouts — PARTLY

What meets it:
- Approved revisions store who, when and the text approved (`document_revisions.approved_by`, `approved_at`, the
  revision's own text; `server/document-revisions.js:145`).
- The drawn "Sign" row stores name, capacity and time (`document_signatures`).
- The competence statement records its meaning in words ("I confirm this person understands this training.").
- Course drafts store both signers and times, with fixed meanings ("matches the document" / "food safety content").

Gaps:
- **The document PDF prints "Approved By: name" with no approval date/time and no meaning**
  (`server/api/documents.js:1209`).
- **The drawn signatures on the PDF show the date only, no time** (`documents.js:1286`, `String(s.signed_at).slice(0, 10)`).
- **The meaning of a drawn signature is a typed "capacity" ("CEO")**, not what the signature means (approved,
  reviewed).
- **No printout of a training record shows the sign-off.** The only training PDF is the forklift certificate.
  The record screens show the trainer, but not "signed by X at date/time, meaning: trained/competent".

## 3. Password re-entered at the moment of signing — PARTLY

Meets it: approving a document revision (`documents.js:879`), both course-draft signatures (`training.js:1468`), the
practical evaluation (`training.js:1829`), and the sign routes in about 25 other modules
(`gateSignature`, `server/signature.js`). The prompt comes after every other check, and a batch counts as one act.

Gaps:
- **The drawn "Sign" on a controlled document asks for no password** (`POST /documents/:id/sign`, `documents.js:771`).
- **A document's first approval (status → active) asks for no password** (`POST /documents`, `PUT /documents/:id`).
- **The competence tick asks for no password** — single records (`POST/PUT /api/training`) and group sign-offs
  (`POST /training/bulk-complete`).

## 4. Signature cannot be removed, copied or moved — MISSING for the drawn "Sign", PARTLY elsewhere

What meets it:
- An approved revision cannot be edited (`409 APPROVED_REVISION_LOCKED`); its text is kept with the approval.
- Signed QMS records are closed; revoking is a separate, audited act (D-195, `server/api/qms.js`).
- Employee documents and COAs store a SHA-256 of what was signed (`employee-documents.js`, `coa_requests.signed_content_hash`).

Gaps:
- **The drawn signature is drawn once and then copied onto every document signed** (`users.signature_image` →
  `document_signatures.signature_image`, `documents.js:783–791`). Under Part 11 a handwritten signature is the act of
  signing preserved; a stored picture applied by a click is a copy. It is also signed with no password.
- **The "Sign" row is not tied to a revision.** It points at the document, not at the revision, so after the document
  is revised the old signature prints on the new text.
- **Revoking a drawn signature deletes the row** (`documents.js:805`). The audit log keeps the old row, but the
  record itself loses it.
- **The competence statement can be removed or changed by editing the training record** (`PUT /api/training/:id`,
  `training.js:591`). This is audited, but it is not a revoke with a reason.
- Only some signatures are bound to a fingerprint of what was signed (employee documents, COAs). Document revisions
  rely on the revision row being immutable, which is fine. Training records have no such binding.

## 5. Audit trail users cannot edit, kept as long as the record — PARTLY

What meets it:
- Every change goes through `logAudit` (`server/db.js:7301`) with the actor, role, time, and the before and after state.
- No route edits or deletes audit entries (`server/api/audit.js` has only GET routes), and nothing prunes them.
- The separate activity log is append-only, enforced by database triggers (D-261).

Gaps:
- **`audit_log` itself is not locked.** There are no triggers refusing UPDATE or DELETE, unlike `user_activity`.
- **Two boot steps rewrite old audit rows**: `backfillAuditActorIdentity()` fills in actor ids
  (`db.js:7090`), and `normalizeAuditActions()` renames old action words (`db.js:7116`). They are well meant, but they
  edit the trail.
- **Keeping it as long as the record** depends on backups. There is no stated retention period, and no check that a
  restored backup still has the trail.
- **Hard deletes still exist** for some unsigned records. The audit row keeps what was deleted, but the record itself
  is gone.

## Drawn signature instead of an electronic signature?

Short answer: it would save one letter, and it would not reduce the rest.

- **The only FDA "submission" is a one-time letter** (21 CFR 11.100(c)). Before using electronic signatures, the company
  certifies in writing that they are meant to be the legal equivalent of handwritten ones. It is one page, signed on
  paper, sent once to FDA. **FDA does not review or approve anything.** There is no submission of the system.
- **A signature drawn fresh on a screen each time counts as a handwritten signature** under Part 11 (11.3(b)(8)).
  So it does not need the letter or the ID-plus-password rules (11.200, 11.300).
- **Everything else still applies to a drawn signature on an electronic record**: name, date/time and meaning (11.50);
  binding to the record so it can't be removed, copied or moved (11.70); the audit trail, validation and access
  controls (11.10).
- **What ReadyDoc has today is neither.** The drawn picture is drawn once and re-used, which is a copy, not the act of
  signing. Without a password it isn't a proper electronic signature either.
- **Practical cost:** drawing on a phone for every sign-off (a QA Review batch of 40, every training record) is slower
  than typing a password, which already works on about 25 routes.

**Recommendation:** keep the password as the signature (most of it is built), send the one-page certification letter,
and fix the drawn "Sign" so it is either drawn fresh at the moment of signing or replaced by a password signature.

## Plan for the gaps

Each item touches records, so each goes to review (D-274).

1. **Password at every remaining signing act**: the document "Sign", a document's first approval, the competence tick
   (single and group). Use the same `gateSignature`, asked last.
2. **The signer is the signed-in person.** The competence statement names `recorded_by` (the session), not the typed
   trainer. The trainer field stays as a separate fact.
3. **The drawn "Sign"**: draw fresh each time (no stored image re-used), ask for the password, tie it to the revision
   in force, and turn revoke into a status with a reason instead of a delete. Old rows stay as filed.
4. **Meaning on every signature, printed**: the document PDF prints each approval and signature as "name · date and
   time (plant time) · meaning". Meanings are fixed words (Approved / Reviewed / Trained / Competent), not free text.
5. **A training record printout**: a one-page PDF per record (or per person) showing the sign-off with name, date and
   time, and meaning.
6. **A fingerprint of what was signed** on training sign-offs and drawn document signatures (SHA-256 of the signed
   fields), checked on read: "changed since signed".
7. **A locked audit log**: triggers refusing UPDATE and DELETE on `audit_log`. The two boot rewrites become read-time
   mappings, run once and then stopped.
8. **Shared-account check**: a read-only report of accounts with live sessions on several devices at once, plus a
   one-line policy in the handbook. No automatic blocking.
9. **The certification letter** (if passwords stay the signature): a one-page draft for Maria or the owner to sign and send.
   It is not code.

Not in scope here: the validation package (CAR 4990683-5 / SOP 444), which is the separate CSV/validation work.
