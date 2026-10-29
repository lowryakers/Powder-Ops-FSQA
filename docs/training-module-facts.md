# The Training module: what it stores, what it counts, and where it falls short

Written 29 Oct 2026, read from the code on branch `claude/food-safety-preventive-controls-8y6mu2` (same as `main` for
everything in Training). Nothing was changed to write this. It is meant for reviewing the module against SQF Code
Ed. 9 (2.9 Training; 2.2.3 records) and NSF/ANSI 455-2 / GMP for Sport (personnel training) by someone who does not
read code. Each fact names the file or table it comes from so it can be checked.

In short:
- The module records who was trained, on what, when, by whom, how, whether they passed, and against which document
  revision.
- It does **not** record the language of the training, or who typed the record in (except in the audit log).
- Nothing assigns retraining automatically when a document is revised. The affected people are only flagged.
- It counts bot and auditor accounts as trainees. Phase 2 below fixes the bots.
- **Logging an old session can push a newer completion aside** (item 4 and item 8, number 1).

---

## 1. What each kind of record stores

### A course — table `training_courses`
Created in `server/db.js` (the `CREATE TABLE training_courses` block and the `addColumnIfMissing('training_courses', …)` lines).

| Field | What it means |
|---|---|
| `code`, `title`, `category`, `description` | What the course is. For a Work Instruction the code is the document number (WI007). |
| `sop_id` | The controlled document the course trains on (a row in `sop_documents`). Optional. |
| `retrain_months` | How often it must be repeated. Empty = once only. |
| `retrain_on_doc_change` | 1 = a revision of the linked document makes earlier completions "out of date". Default 1. |
| `required_roles`, `required_departments`, `required_positions` | Who must take it (lists). All three empty = **everyone**. |
| `has_test`, `passing_score` | Whether there is an in-app test and its pass mark. |
| `equipment_id` | The machine the course is about, if any. |
| `active` | Retired courses stay, with `active = 0`. |

Tests are separate: `training_tests` (one row per version of a course's test, with its own `passing_score`) and
`training_questions` (the questions, with Spanish wording in `prompt_es` / `options_es`).

### A training record (a completion) — table `training_records`
Written in exactly one place, `insertCompletion()` in `server/training-records.js`. Every door uses it: Log Completion,
Group Training, Group Sheets, a passed test, the importers, and finishing an assigned task.

| Question | Answer | Field |
|---|---|---|
| Who | Name, and the account where known | `employee_name`, `employee_user_id` |
| What | The course, plus the topic text | `course_id`, `training_topic` |
| **Document version trained on?** | **Yes.** The document's training revision at the time of filing is stamped on the record. **But** only when the course is linked to a document (`sop_id`); otherwise it is empty. Records from the Training Log import and earlier have none. | `sop_revision` (from `courseTrainingRevision()`) |
| **Date trained** | Yes | `training_date` |
| **Date recorded** | Yes, automatically, in UTC | `created_at` |
| Date completed | Yes (usually the same as the training date) | `completion_date` |
| **Trainer** | Yes, free text, optional | `trainer` |
| **Method** | Yes, optional: `in_person`, `read_and_sign`, `online_test`, `external` (no "verbal"; use in person) | `method` |
| **Competency result** | Yes: a score and pass/fail. **A blank score is filed as passed** (attendance only). A score under the pass mark files as `failed` and does not count. | `score`, `passed`, `status` |
| Next retraining date | Calculated from `retrain_months` | `next_due_date` |
| Evidence | The scanned sheet or test, kept in storage | `evidence_key`, `evidence_filename`, plus older `document_url`, `certificate_url`, `gdrive_url` |
| Link to the in-app test taken | Yes, when it came from a test | `test_attempt_id` → `training_test_attempts` |
| **Language** | **No.** Nothing records whether the training or test was in English or Spanish. The test screen has an EN/ES switch (D-144), but the attempt does not keep which one was used. | — |
| **Who entered it** | **Not on the record.** Only in the audit log (`training_created`, `training_group_completed`). A group entry's audit line gives the course and a count, not the record ids. | `audit_log` |
| Older ones replaced | Earlier completions of the same course by the same person are marked replaced | `superseded = 1` |

### An assignment — not a table of its own
An assignment is a **task (work order)** carrying the course: `work_orders.training_course_id`, with `assigned_to` /
`assigned_to_id` and `due_date`. Created by `assignTraining()` in `server/training-assign.js`. Default due date 14 days
from today (30 for a new hire). The person sees it on their task list and gets a ReadyBot message
(`server/training-notify.js`). Completing the task files the training record. Open = status `open`, `in_progress`,
`overdue` or `missed`.

### A "group training" record — also not a table of its own
**Group Training** and **Group Sheets** both create **one ordinary training record per person**
(`POST /api/training/bulk-complete` in `server/api/training.js`). There is no "session" record that ties them together.
They share only the same course, date, trainer, method and, if a sheet was attached, the same scanned file
(`POST /api/training/evidence/bulk`).

Other tables:
- `training_requirements` — a named exception for one person: "required" or "exempt".
- `training_test_attempts` — every test sitting, with each question's result frozen at the time.
- `training_practical_evaluations` — the forklift practical, see item 7.

---

## 2. How the numbers are worked out

All of it is in `server/training-status.js` (`trainingSnapshot`, `cellFor`, `personTraining`, `trainingRoster`) and
`server/training-assign.js` (`appliesReason`). The matrix, the "By person" view and the four cards at the top of
Training all use the same calculation.

**Who is counted as a trainee:** every account that is active and is not an outside client (`is_active = 1` and not
`is_external`). See item 5 for who that sweeps in.

**Applies** — the course is owed by this person, for one of these reasons, checked in this order:
1. A named exception: exempt (not counted) or required.
2. The course has no roles, departments or positions at all, so it applies to **everyone**.
3. Their role is listed.
4. Their department is listed.
5. They hold a listed org-chart position.

**For each person and course that applies, the state is:**

| State | Rule | Shown as |
|---|---|---|
| **Not yet trained** (`missing`) | No passing, un-replaced completion on file | "Not yet trained" card |
| **Overdue** | A completion exists and its `next_due_date` is before today | "Overdue" card |
| **Out of date** (`outdated`) | Not overdue, but the linked document's revision has moved past the one on the record | Orange banner on the matrix (no card) |
| **Due soon** | Next due within one month | "Due soon" card |
| **Current** | Everything else with a completion | "Current" card |
| **Exempt** | A named exemption | Not counted |

- **Owed** (per person, "By person" tab) = not yet trained + overdue + due soon + out of date.
- **Assigned** = how many of their courses have an **open assignment task** right now. Being assigned does not change
  the state: an assigned course that was never done is still "not yet trained".
- **Is "never trained but required" counted as overdue? No.** It is counted as "Not yet trained", a separate card,
  however long it has been owed, and even if the assignment task is past its due date. The person view shows
  "Assigned, due … — overdue" beside it, but the Overdue card does not include it.
- "Today" in these counts is the **UTC** date, so after 6 pm Mountain the counts are worked out for tomorrow.

---

## 3. When a document is revised

`PUT /api/documents/:id` in `server/api/documents.js` (and `applyRevision()` for the "Update from file" path).

1. If the text or revision number changed and the editor did **not** tick "minor edit", the document's
   `training_revision` moves to the new revision.
2. The response reports how many completions this made out of date (`retraining_triggered`). Nothing else happens.
3. On the matrix, those people's cells turn **out of date**, the orange banner shows the count, and they count as
   **owed** on the By person view.

What does **not** happen:
- **No retraining is assigned. No task is created and no due date is set.** Somebody has to use **Assign** by hand.
- Nobody is messaged.
- It only works when the course is **linked to the document** (`training_courses.sop_id`), and only for completions
  that carry a `sop_revision`. Imported history has none, so those people are never flagged. In D-103, no course was
  linked to its document at all; Training → Documents offers to link the obvious ones.

---

## 4. Group Training and Group Sheets (Daniela's question)

| | **Group Training** | **Group Sheets** |
|---|---|---|
| What it is for | Recording **one** training session you just held, or held in the past | Working through a **folder of scanned sign-in sheets**, one screen per sheet |
| Course | One per entry | One or more per sheet |
| Date | Typed in, any date (past dates allowed) | Read from the file name, editable |
| People | Tick them from the list | Tick them; the app can read printed names off the scan as suggestions |
| Score per person | Optional | No |
| Method | Chosen (in person, read and sign, online test, external) | Always "read and sign" |
| Evidence | Optional: one sheet attached to everyone's record | The sheet itself, attached to everyone's record |
| What it creates | One training record per person (`bulk-complete`) | The same, once per course |

**Can someone log a past verbal training session for many people at once, with the real training date? Yes, with
Group Training.** The date you type becomes the training date and completion date. The day you typed it in is kept
separately as the recorded date. The retraining clock runs from the training date.

**Step by step:**
1. Go to **Training Records** (Document Control group in the menu). You need **Edit** on Training; otherwise the
   buttons do not show.
2. Click **Group Training** (top right, next to Assign).
3. **Course:** pick the course the session covered. If it covered several, do one entry per course.
4. **Date:** change it from today to the **real date of the session**.
5. **Method:** choose **in person** (there is no "verbal" option; in person is the right one for a talk).
6. **Trainer:** type who gave it.
7. **Signed sign-in sheet:** if there is one, attach the photo or PDF; it goes on every attendee's record.
   Leave it empty if there is no sheet.
8. **Attendees:** search and tick everyone who was there. Leave the score box blank. Blank means
   attendance only, and the record is filed as passed.
9. Click **Record N completions**. A green note confirms how many were saved.

**Check this first: a past date can push aside a NEWER completion.** When a record is saved, every other completion of
that course for that person is marked "replaced", whatever its date (`supersedeOlder()` in
`server/training-records.js` never compares dates). So if someone already has a 2026 completion and you log a 2025
session for them, the 2025 one becomes their current record. Their next-due date moves earlier, and they can show as
overdue. Until that is fixed, do this before saving: open **By person** for anyone who may already have a later
completion of that course, and leave them out.

Also note: the attendee list shows **every active account**, including bot accounts, ReadyBot, auditor-pass accounts
and outside clients. Assign hides clients; Group Training does not.

---

## 5. Who counts as a trainee, and why bots and contractors are in

Training counts every account where `users.is_active = 1` and `is_external` is not set (`trainingSnapshot()`,
`server/training-status.js`). Nothing else is checked. So it includes:
- **Bot accounts.** Each bot (Procurement Bot, Controller Bot, Jarvis, …) must have its own **non-admin** ReadyDoc
  account to hold an API token (D-161). That makes it an ordinary active account. Any course that applies to
  "everyone", or to the department the bot was filed under, is then owed by the bot. **ReadyBot** (role operator,
  department office) and the **Test Runner** account are the same.
- **Contractors.** A 1099 contractor or an outside maintenance contractor set up in Settings → Users is an ordinary
  active account (`is_contractor` is a label, not an exclusion). Only **guest clients** (`is_external`, the M4
  accounts) are left out.
- **Auditor-pass accounts.** Issuing an auditor pass creates a read-only account named after the visitor, in the QA
  department (`server/api/auditor-pass.js`). It is counted too, and QA-department courses apply to it.

There has never been a way to say "this account is not a person who is trained". Phase 2A adds one.

---

## 6. Why Carol Pierce might appear twice

The code allows two separate accounts called Carol Pierce, and both would be counted. The likely causes, most likely
first:
1. **An auditor pass issued in her name.** `server/api/auditor-pass.js` deliberately creates a **new** read-only
   account named exactly as typed, role `auditor`, department QA, even when a staff account with that name exists.
   The comment above the insert says so. It stays active while the pass is live, and is reactivated by the next
   pass. Training counts it.
2. **The Slack history importer** (`server/slack-import.js`) creates an account for any Slack author whose display
   name does not match an existing account.
3. **Onboarding** creates an account when a packet is finished, and **Settings → Add user / Bulk add** create them
   by hand.

The org chart seeds her position by name only ("Quality Technical Support Manager — Carol Pierce", `server.js`) and
links it to whichever account it matches. Which of these happened can only be read from the live database. Phase 2B
shows both accounts side by side.

---

## 7. Operator certification and Most missed

**Operator certification** (Training → Operator certification; `server/training-certification.js`,
`server/practical-evaluations.js`, table `training_practical_evaluations`). Today this covers forklift **FORK-101**
only. 29 CFR 1910.178(l) requires two halves:
- the formal training (the written test, a training record);
- a practical evaluation of the person driving, observed and signed by a second person, task by task.

A person is **certified only when both are on file and current**. The 3-year clock runs from the **evaluation**, and
whichever half expires first decides. The certificate PDF is refused until both halves are there. The evaluation form
is a DRAFT-1 form the app drafted (no plant form existed); it is waiting on Document Control.

**Most missed** (Training → Most missed; `server/training-misses.js`). For each test question: how many **people** got
it wrong, counting each person's latest attempt only. It flags a question as a **possible wrong answer key** when at
least 3 people tried it, at least half missed it, and at least 60% of those who missed it chose the same other
answer. It only flags; it never changes a key.

---

## 8. Half-built, unused or inconsistent

1. **Backdated completions replace newer ones** (item 4). `supersedeOlder()` ignores dates. High impact for logging
   past sessions.
2. **The Overdue card and the list it opens disagree.** The card counts active people who owe the course
   (`/training/matrix`). Clicking it opens `/training/due`, which lists **every** record past or near its date,
   including people who have left, bots, and courses that no longer apply to them.
3. **A revised document assigns nothing** (item 3), and is only flagged for courses linked to the document and records
   that carry a revision.
4. **"Never trained" is never "overdue"**, even when an assignment for it is past due (item 2).
5. **Bot, ReadyBot, Test Runner and auditor-pass accounts are counted as trainees** (item 5), and appear in the Group
   Training and Group Sheets pick lists. Fixed by Phase 2A, except that auditor-pass accounts are left for a separate
   decision.
6. **Mixed clocks.** Group Training's default date, the matrix's "today", `/training/due` and `/training/assignments`
   use the **UTC** date. Tests and filed completions use the plant's date. After 6 pm Mountain the screen's "today" is
   tomorrow.
7. **No language** on any record or test attempt, and **no "entered by"** on the record.
8. **A blank score is filed as "passed".** Attendance and competency read the same afterwards.
9. **Unused values.** `training_records.status` allows `scheduled`, `in_progress` and `overdue`, but nothing writes
   them: overdue is worked out from dates. `employee_id` is a leftover next to `employee_user_id`. There are four
   evidence fields: `evidence_key`, `document_url`, `certificate_url`, `gdrive_url`.
10. **The Audit readiness "people with no training record" line** matches on name only. It excludes ReadyBot and the
    auditor role, but not the other bots (`server/audit-readiness.js`).
11. **No session record** ties a group training together (item 1). "Show me the attendance for the 12 March GMP
    refresher" means searching by course and date.

---

## Carol Pierce: how to see both records, and the proposal (waiting for Lowry's OK — nothing merged)

**See them side by side:** Settings → Data backup → **Accounts that share a name** → Run the report. It is read-only.
It shows, for each account: id, sign-in name, role, department, active, created date, how it was created (an auditor
pass, Settings, an import or a seed), whether it can sign in, last sign-in, live sessions, auditor passes, org chart
position, training records, open training tasks, pay roster rows, chat messages and audit entries. It also shows how
many training records carry the name with no account (those count for whichever account has the name).

The test database reproduced the reported symptom: an auditor pass issued as "Carol Pierce" makes a second account
(role **auditor**, department QA, sign-in name "Carol Pierce 2", signs in by link only), and Training lists her twice.

**Proposal, depending on what the report shows:**

- **If account 2 is an auditor-pass account (most likely): do not merge.** It is a separate read-only door for a
  visitor, and folding it into her staff account would give that pass whatever her staff account carries. Instead:
  1. Leave auditor-pass accounts out of Training, as with the bots: either tick "Not a trainee" on it, or make the
     rule "role = auditor is never a trainee" (one line in `trainingSnapshot`, plus a test).
  2. If the pass is finished, revoke it (Settings → Auditor passes), which deactivates the account. Nothing is
     deleted.
  3. Training records filed against the auditor account, if any, are moved to her staff account, as in the next
     section.
- **If both are staff accounts (an import or a second "Add user"):** keep the one that signs in (password set, latest
  sign-in, org chart position) and move the other's records onto it, in one audited transaction:
  1. `training_records.employee_user_id`, `training_test_attempts.employee_user_id`,
     `training_practical_evaluations.employee_user_id`;
  2. `work_orders.assigned_to_id`, `org_positions.user_id`, `pay_employees.user_id`, `training_requirements.user_id`
     (only where no row already exists for the kept account);
  3. chat memberships the kept account lacks.

  Then **deactivate** the other account, never delete it, so its id still resolves on old records. Write one audit
  entry per table moved, carrying the row ids, plus a summary entry ("merged account X into Y"), so the merge can be
  read back and undone. Names already written on records (`employee_name`, `actor`, signatures) are snapshots and do
  not change. It would be a one-off admin script with a dry run first, the `coa-remove-obvious-duplicates` pattern.
