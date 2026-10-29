# The Training module: what it stores, what it counts, and where it falls short

Describes the module **as it works after the training update (D-262, D-264, D-267, D-269 – D-273, 29 Oct 2026)**.
It is written for reviewing the module against SQF Code Ed. 9 (2.9 Training; 2.2.3 records) and NSF/ANSI 455-2 /
GMP for Sport (personnel training) by someone who does not read code. Each fact names the file or table it comes
from so it can be checked. The earlier version of this file, which described the module before the update, is in
the git history; the decisions it led to are D-262 to D-273 in `docs/v2/decisions.md`.

In short:
- Every training record says who was trained, on what, on which document revision, when it was trained and when it
  was recorded, by whom it was recorded, who trained them, how, in what language, whether they passed, and the
  change request it answers, if any.
- **Competence is required.** A record saves only with a passed quiz or the trainer's tick, *"I confirm this person
  understands this training."*
- A group session is stored once, with everyone on it (Training → Sessions).
- Bots and other "not a trainee" accounts are left out of every count, list, reminder and report.
- Nothing assigns retraining automatically when a document is revised. The affected people are flagged, and the
  office assigns it (the group entry's filters make that a few clicks).

---

## 1. What each kind of record stores

### A course — table `training_courses`

| Field | What it means |
|---|---|
| `code`, `title`, `category`, `description` | What the course is. For a Work Instruction the code is the document number (WI007). |
| `sop_id` | The controlled document the course trains on (a row in `sop_documents`). Optional. **Some of these links are wrong and are being corrected next.** |
| `retrain_months` | How often it must be repeated. Empty = once only. |
| `retrain_on_doc_change` | 1 = a revision of the linked document makes earlier completions "out of date". Default 1. |
| `required_roles`, `required_departments`, `required_positions` | Who must take it. All three empty = **everyone**. |
| `has_test`, `passing_score` | Whether there is an in-app test, and its pass mark. |
| `equipment_id` | The machine the course is about, if any. |
| `active` | Retired courses stay, with `active = 0`. |

Tests are separate: `training_tests` (one row per version, with its own pass mark) and `training_questions` (with the
plant's Spanish in `prompt_es` / `options_es`). Course videos and handouts are in `training_materials` (item 9).

### A training record — table `training_records`
Written in one place, `insertCompletion()` in `server/training-records.js`. Every door uses it: Log Completion, Group
Training, Group Sheets, a passed test, finishing an assigned task, and the importers.

| Question | Field | Notes |
|---|---|---|
| Who | `employee_name`, `employee_user_id` | The account where known. |
| What | `course_id`, `training_topic` | |
| Document and revision trained on | `sop_id`, `sop_revision` | The course's document; the revision typed on the form, or the document's current training revision. |
| **Date trained** | `training_date`, `completion_date` | Can be in the past; never in the future. |
| **Date recorded** | `created_at` | Set by ReadyDoc. Cannot be edited (`400 SYSTEM_SET`). |
| **Recorded by** | `recorded_by`, `recorded_by_id` | The signed-in person who saved it. Set by ReadyDoc, never from the form. |
| Trainer | `trainer` | Free text. |
| **Method** | `method` | Verbal, hands-on, read and sign, or quiz. Records filed earlier keep their old value (in person, online test, external). |
| **Language** | `language` | English, Spanish, or both. Optional. |
| **Competence** | `competence_statement`, or a passed quiz | See item 2. |
| Result | `score`, `passed`, `status` | A score under the pass mark files as `failed`: it does not count as trained and starts no retraining clock. |
| Change request | `dcr_id` | Links to a Document Change Request (a QMS record). Optional. |
| Session | `session_id` | The group session the record came from, if any. |
| Next retraining date | `next_due_date` | Worked out from `retrain_months`. |
| Evidence | `evidence_key` and older `document_url` / `certificate_url` / `gdrive_url` | The scanned sheet or test. |
| In-app test | `test_attempt_id` | The test sitting, with each question's answer frozen. |
| Current or replaced | `superseded` | The record with the **latest date trained** is current; logging an older session never pushes a newer one aside. |

Editing a record (`PUT /api/training/:id`) is audited with every field that changed, from and to.

### A training session — table `training_sessions`
Group Training and Group Sheets save **one session** (course, document and revision, change request, date, trainer,
method, language, competence statement, notes, how many attended, who recorded it), and **one record per person**
pointing back to it. Training → **Sessions** lists them; opening one lists who attended.

### An assignment — not a table of its own
A **task (work order)** carrying the course: `work_orders.training_course_id`, with `assigned_to` / `assigned_to_id`
and `due_date`. Created by `assignTraining()` in `server/training-assign.js`. The person gets a ReadyBot message and a
phone notification, and is chased every other day until it is done (`server/training-notify.js`). The task shows the
course's videos and handouts. Completing the task files the training record.

Other tables: `training_requirements` (a named exception for one person: required or exempt) and
`training_practical_evaluations` (the forklift practical, item 7).

---

## 2. Competence is required (D-269)

A record a person files saves only when it carries **one** of:
- a **passed quiz** — an in-app test, or a score at or above the course's pass mark; or
- the **trainer's tick**: *"I confirm this person understands this training."* It is stored in words with the
  trainer's name: `Adam Bliss: "I confirm this person understands this training."`

This applies on every door a person uses:
- **Log Completion / Edit**: the Save button stays off until there is one or the other. The server refuses it too
  (`400 COMPETENCE_REQUIRED`).
- **Group Training**: anyone without a passing score needs the tick; the server names who is missing it.
- **Group Sheets**: a sign-in sheet has no quiz, so the trainer ticks it for the sheet.
- **An assigned training task**: a course with a test is finished by passing it; a course without a test needs the
  trainer and the tick.

Not asked:
- a **failed** result (it is not a completion);
- the **importers** (Training Log, scanned tests), which file history as it was.

Records filed before 29 Oct 2026 without either are left as they are, and the record list marks them
**"no competence statement"**. Editing one of them asks for the tick before it saves.

---

## 3. How the numbers are worked out

All of it is in `server/training-status.js` (`trainingSnapshot`, `cellFor`, `personTraining`, `trainingRoster`) and
`server/training-assign.js` (`appliesReason`). The matrix, By person and the four cards all use the same calculation.

**Who is a trainee:** every active account that is not an outside client and is not marked **"Not a trainee"**
(`users.not_trainee`, item 5).

**A course applies** to a person for one of these reasons, checked in this order:
1. a named exception (exempt = not counted; required = counted);
2. the course lists no roles, departments or positions, so it applies to **everyone**;
3. their role is listed;
4. their department is listed;
5. they hold a listed org-chart position.

**For each person and course that applies:**

| State | Rule |
|---|---|
| **Not yet trained** | No passing, current completion on file. |
| **Overdue** | The current completion's next due date is before today. |
| **Out of date** | Not overdue, but the linked document's revision has moved past the one on the record. |
| **Due soon** | Next due within one month. |
| **Current** | Everything else with a completion. |
| **Exempt** | A named exemption. Not counted. |

- **Owed** (By person) = not yet trained + overdue + due soon + out of date.
- **Assigned** = how many of their courses have an open assignment task. Being assigned does not change the state.
- "Never trained but required" is counted as **Not yet trained**, not as Overdue, however long it has been owed.
- "Today" in these counts is the **UTC** date, so after 6 pm Mountain they are worked out for tomorrow (item 8).

---

## 4. When a document is revised

`PUT /api/documents/:id` (and **Update from file**).
1. If the text or revision changed and "minor edit" is not ticked, the document's `training_revision` moves on.
2. The response says how many completions this made out of date (`retraining_triggered`); bots are not counted.
3. Those people's cells turn **out of date**, and they count as **owed** on By person.

What does **not** happen: nothing is assigned and nobody is messaged. The office assigns the retraining with **Assign**,
or records it afterwards with **Group Training** (item 6). Only courses linked to the document, and records carrying a
revision, are flagged. **Picking the affected people automatically is deliberately not built yet**: the course-to-
document links are being corrected first, and a list built on wrong links would be wrong.

**Document versions.** The importer now keeps the version in the filename (`…_V4.pdf` → 4). Documents imported earlier
read 1.0 until Document Control sets the right version (Update from file with the signed files is quickest).

---

## 5. Who is not a trainee

`users.not_trainee` says an account is not a person who is trained (`server/trainees.js`). It does not deactivate
anything. Such an account is left out of:
- the matrix, By person, the four cards and the readiness review;
- the pick lists in Assign, Group Training and Group Sheets (and the server skips it if sent);
- the **retraining list** (`/training/due`) and the count a document revision reports;
- **reminders**: the assignment message and the every-other-day chase;
- **Most missed**;
- certification and the importers' name matching.

Setting it closes the account's open training tasks (cancelled with the reason, never deleted).

Who has it:
- **Bots and system accounts**, set once per database (D-262): any account that holds a bot API token, ReadyBot, the
  Test Runner, and accounts named with the "*" bot prefix. A new bot is flagged when its first token is made.
- **An unused auditor account that duplicates a staff member's name** (D-273), set once per database: role auditor, the
  same name as an active staff account, and never signed in. This is **Carol Pierce's second account**. It is found by
  those facts, never by her name, and it is not deactivated or merged. **Settings → Data backup → "Unused auditor
  accounts marked not a trainee"** lists every account it matched on that database, each change it logged, and what
  the rule would match now (D-274).
- Anyone else ticked by hand in Settings → Users.

Other auditor-pass accounts are still counted while they are active (a pending decision). "Accounts that share a
name" (Settings → Data backup) lays any two same-named accounts side by side; it changes nothing.

---

## 6. Recording training for a group

| | **Group Training** | **Group Sheets** |
|---|---|---|
| What it is for | One session you held, today or in the past | A folder of scanned sign-in sheets, one screen per sheet |
| Course | One per entry | One or more per sheet; each course's document is named |
| Date trained | Typed, can be in the past | Read from the filename, editable, can be in the past |
| How it was trained | Method, language, trainer, document revision, change request, competence | The same fields; method starts on "read and sign" |
| Score per person | Optional | No |
| Evidence | Optional sheet, attached to everyone's record | The sheet itself, attached to everyone's record |
| Who recorded it, and when | Set by ReadyDoc | Set by ReadyDoc |

**Picking people (D-270).** Both screens have the same picker: filter by **department** and **role**, **Select all**
ticks everyone the filters show, then untick who was not there. Only trainees are offered.

**Step by step (Group Training):**
1. Training → **Group Training** (needs Edit on Training).
2. Pick the course and the **real date** of the session.
3. Method, language, trainer; the document revision and the change request if this training answers one.
4. Pick the people: filter by department and role, **Select all**, untick who was absent.
5. Optional score per person. A score at or above the pass mark is a passed quiz.
6. Tick **"I confirm this person understands this training."** unless everyone passed a quiz. The Record button stays
   off until then.
7. Attach the signed sheet if there is one, and click **Record N completions**.

With several courses on one sheet, each record takes its own course's current revision; the revision box is used only
for a one-course sheet.

---

## 7. Operator certification and Most missed

**Operator certification** (forklift **FORK-101** only; `server/training-certification.js`). 29 CFR 1910.178(l) needs
the written training *and* a practical evaluation observed and signed by a second person. A person is certified only
when both are on file and current; the 3-year clock runs from the evaluation. The certificate is refused until both
are there. The evaluation form is DRAFT-1, waiting on Document Control.

**Most missed** (`server/training-misses.js`). For each test question, how many **people** got it wrong (each person's
latest attempt; bots left out). It flags a possible wrong answer key when at least 3 people tried it, at least half
missed it, and at least 60% of those chose the same other answer. It never changes a key.

---

## 8. What is still open

1. **A revised document assigns nothing.** Automatic "who is affected by this revision" waits on the course-document
   links being corrected.
2. **"Never trained" is never "overdue"**, even when its assignment is past due.
3. **The retraining list (`/training/due`)** still lists people who have left and courses that no longer apply to
   them; the Overdue card does not. Bots are out of both.
4. **Mixed clocks.** The matrix's "today", `/training/due` and `/training/assignments` use the UTC date; tests and
   filed records use the plant's date.
5. **Other auditor-pass accounts** are counted as trainees while active.
6. **The language of an in-app test** is not kept on the attempt.
7. **Unused values.** `status` allows `scheduled` / `in_progress` / `overdue` but nothing writes them; `employee_id` is a
   leftover; there are four evidence fields.
8. **Nothing records that a video was watched.** Read-and-sign or a test is what records the training.
9. **A record dated in the past takes the document's CURRENT revision** (next round, D-274). When the date trained
   is in the past, the record should carry the revision that was in effect on that date (from `sop_versions`), not
   today's. Until then, type the right revision into the revision box when logging an old session.

---

## 9. Course videos

- **Where:** Training → open a course → **Course material**. Videos, PDFs and handouts; stored in `training_materials`
  and the plant's file storage (R2).
- **Size:** a video up to **2 GB** (about 15 minutes of 1080p phone video); other files 25 MB; 5 per upload.
- **Who sees them:** the course form, and **the trainee's own training task** (Operator View and the Task Center).
  mp4, mov and webm play in place; other formats download.
- **Needs** file storage switched on (the four `R2_*` settings).

---

## 10. Training records the edit bug turned into fails

From 7 to 29 October 2026, saving a record through Edit could mark it failed (D-264 fixed it). **Settings → Data backup
→ "Training records an edit turned into a fail"** lists them (D-267):
- **turned by the edit bug**: failed, with no in-app test, still carrying its completion date, and edited in that
  window;
- **to check**: the same, but with a score below the pass mark. These may be real fails and are never restored from
  here.

**Restore (D-271):** type a reason and press **Restore N records**. Admin only. Each listed record goes back to
completed with its own date trained, its retraining clock recomputed, and which record is current re-settled; one audit
entry per record carries the reason. The server re-checks every record against the list, so a real fail, one already
restored, or one changed since is skipped and named.
