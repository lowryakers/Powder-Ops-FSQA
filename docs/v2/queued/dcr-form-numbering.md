# Document Change Request — form number conflicts

**Draft for Document Control (Daniela Servin) · raised 2 September 2026 · FORM 406-1**

Five places where one form is identified by two different numbers, and one form that has been revised
three times with no current document on file. Found by comparing the Drive document set (1,016 files),
the Document Change Request register (0001–0159) and ReadyDoc's own form index against each other.

**Each item names the two readings and the evidence, and recommends the one the change-request register
supports.** Document Control is free to overrule any of them; nothing has been changed in ReadyDoc on
account of any of them.

**A number is retired, never reissued.** Where a ruling moves a number, the losing number stays in the
Master Index marked as superseded so that records already filed under it still resolve.

---

## The restraint that matters — what is NOT in scope

Six form series are numbered **without** a leading zero and are internally consistent:
`FORM 404-1`, `404-2`, `406-1`, `411-1`, `413-1`, `415-1`, `443-1`.

**Leave them exactly as they are.** They are not in conflict with anything — they are simply a different
style from the padded series. Renaming them to `404-01` and so on would cost a change request each,
orphan every record filed under the old number, and answer no question anyone has asked. Normalise
only where one series carries two styles at once, or where two systems disagree.

That restraint is what keeps this DCR to five items instead of thirty.

---

## Item 1 — Non-Conformance: `FORM 408-01` or `FORM 408-1`?

**Evidence**

| Source | Says |
|---|---|
| DCR **0016** (V1) | `FORM 408-01` |
| DCR **0017** (V2) | `FORM 408-01` |
| Current document on Drive | `Form 408-1 Non Conformance Form V2.pdf` |
| ReadyDoc — QMS record type | `Form 408-01` |
| ReadyDoc — form index | `FORM 408-1` |

**Why it matters.** This number is printed on every non-conformance record. Two of ReadyDoc's own
components disagree, which is why the register's built-in check already flags it.

**Recommendation — `FORM 408-01`.** That is how the form was issued, twice, in the controlled register.
The document filename drifted afterwards. Correct the file name, the Master Index and ReadyDoc's form
index to match the change requests.

**Note:** its sibling `FORM 408-2` (CAPA Report) was issued unpadded in DCRs 0075 and 0127 and is
consistent with itself. Ruling 408-01 leaves 408-1 and 408-2 looking mismatched — Document Control may
prefer to move 408-2 to `408-02` in the same request. Raised for a decision, not recommended either way.

---

## Item 2 — Temperature & Humidity: `FORM 110-03` or `FORM 110-04`?

**Evidence**

| Source | Says |
|---|---|
| DCR **0116** (V2) | `FORM 110-04` |
| Current document on Drive | `FORM 110-04 V2 TEMPERATURE AND HUMIDITY CONTROLS.xlsx` |
| ReadyDoc — form index | `FORM 110-03` |

**Why it matters.** The daily temperature and humidity check files a compliance record, and the record
carries the form number. ReadyDoc is currently printing a number that neither the change request nor
the document itself uses.

**Recommendation — `FORM 110-04`.** The change request and the document agree; ReadyDoc is the outlier.
Correct ReadyDoc's form index, and the Master Index if it also reads 110-03.

---

## Item 3 — Knife accountability: one record type, two numbers

**Evidence.** ReadyDoc's knife record type is labelled `Form 440-01 / 440-02`. The two are different
documents:

- **FORM 440-01** — Knife, Razor Blades & Scissors **Master List** (the register of blades held)
- **FORM 440-02** — Knife, Razor Blade & Scissor **Accountability** (the sign-out and return log)

**Why it matters.** A record is filed under one form number. A record type carrying both prints an
ambiguous number on a compliance record, and an auditor asking for 440-02 cannot be given a list of
records that might be 440-01.

**Recommendation — split them.** The sign-out / return record is **FORM 440-02**; the master list of
blades is **FORM 440-01**. This one is a software correction as well as a documentation one, and it is
gated by Document Control's approval before it takes effect.

---

## Item 4 — Series 108 carries two styles

**Evidence**

| Form | Title | Style |
|---|---|---|
| `FORM 108-1` | Restroom Cleaning Log | bare |
| `FORM 108-2` | Breakroom, Lobby and Office Area | bare |
| `FORM 108-03` | Production Area Cleaning Log | padded |

All three hang off SOP 108 Master Sanitation. **DCR 0032 records the third as `FORM 108-031`** — a
transposition in the change request itself.

**Why it matters.** Three forms in one series, two numbering styles, and a typo in the register that
issued one of them. Anyone searching the register for 108-03 does not find DCR 0032.

**Recommendation.** Rule one style for the series. Whichever way it goes, record the DCR 0032 reading as
a known transcription error in the Master Index — **do not reissue DCR 0032**; a change request is a
record of a decision made on a date and is not rewritten after the fact.

---

## Item 5 — Series 405 and 409 each carry two styles

**Evidence**

| Form | Title | Style | Issued by |
|---|---|---|---|
| `FORM 405-1` | Product Release Form | bare | DCR 0020 |
| `FORM 405-02` | Product Release Waiver (Pending Final QA Testing) | padded | DCR 0155 |
| `FORM 409-1` | Annual (cGMP) Training Quiz | bare | DCR 0018 |
| `FORM 409-02` | Training Form | padded | DCR 0108 |

**Why it matters.** In both series the older form is bare and the newer one padded, so the style changed
somewhere between DCR 0020 and DCR 0108 without the earlier numbers being brought along. Left alone, the
next form in either series is a coin toss.

**Recommendation.** Rule one style per series, and — more importantly — **record the house rule** in
SOP 400 (Publishing, Updating and Control of SOPs) so the next form issued does not reopen the question.
The majority of the register is padded (`-01`, `-02`), which is the natural rule to adopt going forward
even where existing bare numbers are left in place.

---

## Item 6 — FORM 500-03 has three revisions and no current document

**Evidence**

| Source | Says |
|---|---|
| DCR **0062** | `FORM 500-03` V1 |
| DCR **0063** | `FORM 500-03` V2 |
| DCR **0064** | `FORM 500-03` V3 |
| Drive document set | **no file** |

**Why it matters.** This is not a numbering question. A form was issued and revised twice, and the
current revision is not in the master document set — so there is no document to print, review or file
records against. It may exist elsewhere, or it may have been withdrawn without a withdrawal being
recorded.

**Recommendation.** Locate FORM 500-03 V3 and file it in the master set, **or** record it in the Master
Index as withdrawn with a date and a reason. Either answer is fine; silence is not.

---

## Summary of what this request asks Document Control to rule

1. `FORM 408-01` over `FORM 408-1` — and whether `408-2` moves with it
2. `FORM 110-04` over `FORM 110-03`
3. Knife: `440-01` master list, `440-02` accountability — split, not combined
4. Series 108: one style, and DCR 0032's typo noted rather than reissued
5. Series 405 and 409: one style each, plus the house rule written into SOP 400
6. FORM 500-03: file the document, or record it as withdrawn

Items 1–5 are documentation changes. Items 1, 2 and 3 also require a change in ReadyDoc, which is parked
until this request is approved and applies automatically once it is.
