// A DRAFT of the Banned & Prohibited Substance Control SOP, seeded once for
// Daniela and Carol to review — the gap the NSF GMP for Sport readiness
// section flags as critical (Audit Guide §6.2.1–6.2.3.2).
//
// Rules this respects:
//   - It is a DRAFT and stays one. Making it effective is Document Control's
//     act, through the same approval every document goes through. A draft is
//     never visible as the plant's procedure, and the readiness check only
//     counts ACTIVE documents — so the critical clears when they approve it,
//     not when this seeds.
//   - Nothing plant-specific is invented. Where the plant has to decide
//     (who reviews, where the review is recorded), the text says
//     [TO CONFIRM] instead of asserting something nobody agreed to — the
//     same rule as the AI policy drafter.
//   - The document number is a placeholder; their numbering is Document
//     Control's to assign, and guessing an SOP 4xx number risks colliding
//     with a paper document the registry hasn't caught up to yet.
//   - ONE-TIME flag, and skipped entirely if any live document already
//     mentions banned/prohibited substances — if they wrote their own first,
//     this must not show up beside it.

import { randomUUID as uuid } from 'crypto';

const TITLE = 'Banned and Prohibited Substance Control Program';

const BODY = `**DRAFT for review — prepared for Daniela (Document Control) and Carol (QA). Document number to be assigned by Document Control at approval.**

## 1. Purpose

To ensure no banned or prohibited substances are present in products manufactured by Powder Ops LLC or in the facility, in accordance with the NSF GMP for Sport program (NSF GMP for Sport Audit Guide §6.2) and NSF Certification Guideline 306 (Certified for Sport®).

## 2. Scope

All raw materials, ingredients, processing aids, and finished products handled at the facility; all purchasing and supplier-approval decisions; and all materials brought into the facility.

## 3. References

- NSF GMP for Sport Audit Guide (on file in ReadyDoc as REF-NSF-GMP-AUDIT)
- NSF Certification Guideline 306 — Certified for Sport® (REF-NSF-306), including its list of substances banned by athletic organizations (Annex C)
- WADA Prohibited List (current edition, published annually by the World Anti-Doping Agency)
- MLB and NFL prohibited-substance lists (current editions)
- SOP for Purchasing and Vendor Qualification [TO CONFIRM — document number]

## 4. Responsibilities

- **QA Manager**: owns this program, maintains the current lists, performs and records the annual review, and notifies NSF of relevant changes.
- **Purchasing**: checks every new material and supplier against the current lists before approval.
- **All employees**: do not bring supplements or other products containing banned substances into production or storage areas. [TO CONFIRM — plant policy on personal supplements on site]

## 5. Procedure

### 5.1 Current lists

QA maintains access to the current editions of the WADA Prohibited List, the MLB and NFL lists, and NSF Annex C. The versions/dates in use are recorded [TO CONFIRM — where: this SOP's revision history, or a controlled log].

### 5.2 Annual documented review (Audit Guide §6.2.3.1)

At least annually, QA reviews the lists for changes, records the review (date, reviewer, lists and editions reviewed, changes found, actions taken), and notifies NSF of any changes that affect certified products. The review record is filed [TO CONFIRM — recommend: as a Quality Schedule task in ReadyDoc so the cadence generates itself].

### 5.3 Purchasing controls (Audit Guide §6.2.3.2)

Before a new raw material, ingredient, processing aid, or supplier is approved, Purchasing/QA verifies the material against the current lists. The check is recorded as part of vendor/material qualification. A material found on any list is rejected and the finding recorded.

### 5.4 Facility controls (Audit Guide §6.2.1)

No banned or prohibited substances are stored, handled, or manufactured in the facility. Contract-manufacturing inquiries for products containing listed substances are declined. [TO CONFIRM — any additional facility rules, e.g. visitor/employee personal items]

## 6. Records

- Annual list-review records (§5.2)
- Material/supplier qualification checks (§5.3)
- NSF notifications, where applicable

*Drafted from the NSF GMP for Sport Audit Guide on file. Review every statement before approval — placeholders marked [TO CONFIRM] are decisions, not facts.*`;

export function seedBannedSubstanceSopDraft(db) {
  try {
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'banned_substance_sop_seed_v1'").get()) return 0;
    const flagDone = () => db.prepare("INSERT INTO app_settings (key, value) VALUES ('banned_substance_sop_seed_v1', ?)")
      .run(new Date().toISOString());
    // If they already have a procedure (any status), don't file a rival draft.
    const existing = db.prepare(`SELECT 1 FROM sop_documents
      WHERE COALESCE(doc_type, '') != 'reference'
        AND (title LIKE '%banned%' COLLATE NOCASE OR title LIKE '%prohibited substance%' COLLATE NOCASE)`).get();
    if (existing) { flagDone(); return 0; }
    db.prepare(`INSERT INTO sop_documents
      (id, doc_number, title, category, revision, status, owner, description)
      VALUES (?, 'SOP-DRAFT-BSC', ?, 'quality', 'Draft A', 'draft', 'QA', ?)`)
      .run(uuid(), TITLE, BODY);
    flagDone();
    console.log('[seed] Filed the Banned & Prohibited Substance Control SOP draft for review');
    return 1;
  } catch (e) {
    console.warn('[seed] banned-substance SOP draft seed failed:', e.message);
    return 0;
  }
}
