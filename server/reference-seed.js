// The external standards the plant certifies against, in the database.
//
// Three NSF booklets — Certification Guideline 306 (Certified for Sport),
// NSF/ANSI 455 Certification Policies, and the GMP for Sport Audit Guide —
// plus the SQF Food Safety Code (Food Manufacturing, Edition 9), the code the
// plant is actually audited against. Uploaded so the requirements being built
// against live beside the documents built against them. They are seeded as
// `doc_type = 'reference'`, a separate Reference Library tab in Document
// Control, NEVER mixed into the SOP registry: an auditor reading the plant's
// SOP list must not find NSF's or SQFI's own publications in it.
//
// THE TEXT GOES IN THE DATABASE, THE FILES STAY OUT OF public/. The booklets
// are licensed copies (NSF Confidential; SQFI) and public/
// is served without authentication (the BPG diagram lives there on purpose;
// these must not). The full extracted text is the document body, so it is
// readable, searchable and printable in-app behind login; the extraction
// source files live in server/assets/reference for fidelity.
//
// Insert-only, keyed on doc_number: a title Daniela edits or a booklet she
// replaces with a newer edition must survive a redeploy.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID as uuid } from 'crypto';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'reference');

const BOOKLETS = [
  {
    doc_number: 'REF-NSF-306',
    title: 'NSF Certification Guideline 306 — Certified for Sport® Program',
    revision: 'January 9, 2026',
    file: 'nsf-306-certified-for-sport.txt',
    description_intro:
      'External reference standard (NSF Confidential — the plant\'s licensed copy; do not distribute). '
      + 'The Certified for Sport® certification guideline the plant builds toward. Full text below, extracted for search and reading; page markers preserved.',
  },
  {
    doc_number: 'REF-NSF-455',
    title: 'NSF/ANSI 455 — NSF Nutrition & Wellness Certification Policies',
    revision: 'September 2, 2025',
    file: 'nsf-ansi-455-policies.txt',
    description_intro:
      'External reference standard (NSF Confidential — the plant\'s licensed copy; do not distribute). '
      + 'The NSF/ANSI 455 certification policies. Full text below, extracted for search and reading; page markers preserved.',
  },
  {
    doc_number: 'REF-NSF-GMP-AUDIT',
    title: 'NSF GMP for Sport Audit Guide',
    revision: 'Current edition on file',
    file: 'nsf-gmp-sport-audit-guide.txt',
    description_intro:
      'External reference standard (NSF Confidential — the plant\'s licensed copy; do not distribute). '
      + 'The question-by-question guide NSF auditors work from — the closest thing to the exam paper. Full text below.',
  },
  {
    // THE CODE THE PLANT IS ACTUALLY CERTIFIED AGAINST. The Food Manufacturing
    // code below carries a cover note referring dietary supplements to a
    // related code, and this is it — "Food Safety Code: Dietary Supplement
    // Manufacturing, Edition 9". Both are kept: the audit reports cite NSF/ANSI
    // 455-2, the plant's own documents cite SQF, and a reader comparing a
    // clause needs to see which book it came from.
    //
    // The System Elements clause numbering is IDENTICAL between the two
    // (2.1.1 … 2.9.2), which is what makes citing one and reading the other so
    // easy to do by accident. Two clauses genuinely differ and both matter:
    // 2.2.3.3 drops the "or established by the site" retention fallback and
    // adds an off-site backup requirement for software and electronic records;
    // 2.4.3.17 extends to "food safety and/or dietary supplement regulations",
    // which is what brings 21 CFR 111 explicitly inside the both-Codex-and-
    // regulatory rule.
    doc_number: 'REF-SQF-DSC-9',
    title: 'SQF Food Safety Code: Dietary Supplement Manufacturing — Edition 9',
    revision: 'Edition 9 (v3.2)',
    file: 'sqf-dietary-supplements-code-ed9.txt',
    description_intro:
      'External reference standard (SQFI — the plant\'s licensed copy; do not distribute). '
      + 'The SQF code for dietary supplement manufacturing — the one this facility is certified against. '
      + 'Full text below, extracted for search and reading; page markers preserved.',
  },
  {
    doc_number: 'REF-SQF-FSC-9',
    // The revision is the document's OWN words. It carries no publication date
    // anywhere in its front matter, and inventing one would put a date on a
    // reference standard that nobody can check it against.
    title: 'SQF Food Safety Code: Food Manufacturing — Edition 9',
    revision: 'Edition 9',
    file: 'sqf-food-safety-code-ed9.txt',
    description_intro:
      'External reference standard (SQFI — the plant\'s licensed copy; do not distribute). '
      + 'The SQF Food Manufacturing code. Kept for comparison — the code this facility is certified against is REF-SQF-DSC-9. '
      + 'Full text below, extracted for search and reading; page markers preserved.',
  },
  {
    doc_number: 'REF-SQF-DS-9',
    // The file arrived named "v3.2" but the document calls itself Edition 9 on
    // its cover and throughout — SQFI's own words win over a filename, the same
    // rule the document importer follows when a revision suffix disagrees with
    // what is inside.
    title: 'SQF Food Safety Code: Dietary Supplements Manufacturing — Edition 9',
    revision: 'Edition 9',
    file: 'sqf-dietary-supplements-code-v3-2.txt',
    description_intro:
      'External reference standard (SQFI — the plant\'s licensed copy; do not distribute). '
      + 'The dietary supplements manufacturing code. Read alongside REF-SQF-FSC-9 (Food Manufacturing): '
      + 'this is the one that governs the supplement side of the plant. '
      + 'Full text below, extracted for search and reading; page markers preserved.',
  },
];

export function seedReferenceLibrary(db) {
  const exists = db.prepare('SELECT 1 FROM sop_documents WHERE doc_number = ?');
  const ins = db.prepare(`INSERT INTO sop_documents
    (id, doc_type, doc_number, title, category, revision, status, owner, description, source_file, effective_date)
    VALUES (?, 'reference', ?, ?, 'quality', ?, 'active', 'QA', ?, ?, date('now'))`);
  // Every writer of a document writes its baseline version, so the history of
  // a seeded document starts where the document does.
  const baseline = db.prepare(`INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot)
    SELECT ?, id, revision, 'system', 'Seeded', json_object('id', id, 'doc_number', doc_number, 'title', title, 'revision', revision, 'status', status)
    FROM sop_documents WHERE id = ?`);
  let added = 0;
  for (const b of BOOKLETS) {
    if (exists.get(b.doc_number)) continue;
    let text;
    try { text = readFileSync(join(DIR, b.file), 'utf8'); } catch { continue; }
    const id = uuid();
    ins.run(id, b.doc_number, b.title, b.revision, `${b.description_intro}\n\n---\n\n${text}`, b.file);
    baseline.run(uuid(), id);
    added++;
  }
  if (added) console.log(`[seed] Reference Library: added ${added} external standard(s)`);
  return added;
}
