// The controlled-document consistency review — Daniela's starting point.
//
// She is finalising the paper copies and then bringing every digital version
// in ReadyDoc up to date. Before that, the useful question is: where do the
// documents already disagree with EACH OTHER? Duplicate numbers, two
// documents wearing one title, an SOP citing a WI number that is not in the
// registry, a WI no SOP references, shells with nothing in them. Working that
// out by reading ~100 documents is exactly the job a machine should do first.
//
// EVERYTHING IS DERIVED FROM THE REGISTRY, and nothing here writes — this is
// a report, not a repair. A finding is a place to LOOK, not a verdict: an
// unreferenced WI may be perfectly deliberate, which is why each finding says
// what was observed rather than what to do. Same doctrine as the readiness
// review and the equipment checklist.

/**
 * Normalize a document number for comparison: uppercase, separators dropped,
 * leading zeros in the numeric part removed — so "WI 007", "WI-007" and
 * "WI007" are one number, and a reference written "WI 7" still finds it.
 * The suffix (revision-ish "-1"/".2") is kept: FORM 431-01 and FORM 431-02
 * are different documents.
 */
export function normalizeDocNumber(raw) {
  const m = String(raw || '').toUpperCase().match(/^\s*(PROTOCOL|POLICY|HACCP|FORM|SOP|POL|WI|JD|QP|F)[-\s]*0*(\d{1,4})((?:[-.]\d{1,3})?)\s*$/);
  if (!m) return String(raw || '').toUpperCase().replace(/[\s-]+/g, '');
  return `${m[1]}${m[2]}${m[3].replace('.', '-')}`;
}

// Same prefix list as documents.js's numRe — longest first, so POLICY never
// truncates to POL. Global flag for scanning bodies.
const REF_RE = /\b((?:PROTOCOL|POLICY|HACCP|FORM|SOP|POL|WI|JD|QP)[-\s]?\d{1,4}(?:[-.]\d{1,3})?)\b/gi;

const normTitle = (t) => String(t || '').toLowerCase()
  .replace(/\b(v|ver|version|rev|revision)\.?\s*\d+(\.\d+)?\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

export function docConsistencyReview(db) {
  const docs = db.prepare(`SELECT id, doc_type, doc_number, title, category, revision, status,
      effective_date, review_due, gdrive_url, source_file, description
    FROM sop_documents
    WHERE status NOT IN ('archived', 'superseded') AND doc_type != 'reference'`).all();

  const live = docs.filter(d => d.status !== 'draft');
  const brief = (d) => ({ id: d.id, doc_number: d.doc_number, title: d.title, doc_type: d.doc_type, status: d.status, revision: d.revision });

  // ── 1. Duplicate document numbers ─────────────────────────────────────────
  const byNum = new Map();
  for (const d of docs) {
    const k = normalizeDocNumber(d.doc_number);
    if (!k) continue;
    if (!byNum.has(k)) byNum.set(k, []);
    byNum.get(k).push(d);
  }
  const duplicate_numbers = [...byNum.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([num, list]) => ({ number: num, documents: list.map(brief) }));

  // ── 2. One title on two numbers ───────────────────────────────────────────
  const byTitle = new Map();
  for (const d of docs) {
    const k = normTitle(d.title);
    if (!k) continue;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(d);
  }
  const duplicate_titles = [...byTitle.values()]
    .filter(list => list.length > 1 && new Set(list.map(d => normalizeDocNumber(d.doc_number))).size > 1)
    .map(list => ({ title: list[0].title, documents: list.map(brief) }));

  // ── 3. References to documents that are not in the registry ───────────────
  // A body citing "WI 12" that the registry has never heard of is either a
  // missing WI or a wrong number — both are exactly what Daniela is hunting.
  const known = new Set([...byNum.keys()]);
  // Archived/superseded numbers still resolve — citing them is a different
  // finding than citing something that never existed.
  const retired = new Map(db.prepare(
    "SELECT doc_number, status FROM sop_documents WHERE status IN ('archived','superseded')"
  ).all().map(r => [normalizeDocNumber(r.doc_number), r.status]));

  const dangling_references = [];
  const references_to_retired = [];
  const referencedBy = new Map(); // normalized number -> Set of citing doc ids
  for (const d of docs) {
    const body = `${d.description || ''}`;
    const seen = new Set();
    for (const m of body.matchAll(REF_RE)) {
      const norm = normalizeDocNumber(m[1]);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      if (norm === normalizeDocNumber(d.doc_number)) continue; // self-reference
      if (!referencedBy.has(norm)) referencedBy.set(norm, new Set());
      referencedBy.get(norm).add(d.id);
      if (known.has(norm)) continue;
      if (retired.has(norm)) {
        references_to_retired.push({ document: brief(d), cites: m[1], cited_status: retired.get(norm) });
      } else {
        dangling_references.push({ document: brief(d), cites: m[1] });
      }
    }
  }

  // ── 4. Work instructions nothing references ───────────────────────────────
  // Informational, not a defect: a stand-alone WI can be deliberate. But a WI
  // whose parent SOP forgot to cite it looks identical, so the list is worth
  // one pass of Daniela's eye.
  const orphaned_wis = live
    .filter(d => d.doc_type === 'work_instruction')
    .filter(d => !(referencedBy.get(normalizeDocNumber(d.doc_number))?.size))
    .map(brief);

  // ── 5. Shells: active documents with nothing in them ──────────────────────
  const empty_shells = live
    .filter(d => String(d.description || '').trim().length < 40 && !d.gdrive_url && !d.source_file)
    .map(brief);

  // ── 6. The routine punch list ─────────────────────────────────────────────
  const drafts = docs.filter(d => d.status === 'draft').map(brief);
  const no_effective_date = live.filter(d => !d.effective_date).map(brief);
  const past_review = live
    .filter(d => d.review_due && d.review_due < new Date().toISOString().slice(0, 10))
    .map(d => ({ ...brief(d), review_due: d.review_due }));

  const sections = [
    { key: 'duplicate_numbers', label: 'Two documents sharing one number', severity: 'critical', items: duplicate_numbers },
    { key: 'duplicate_titles', label: 'One title on two different numbers', severity: 'warning', items: duplicate_titles },
    { key: 'dangling_references', label: 'References to documents not in the registry', severity: 'warning', items: dangling_references },
    { key: 'references_to_retired', label: 'References to withdrawn/superseded documents', severity: 'warning', items: references_to_retired },
    { key: 'orphaned_wis', label: 'Work instructions no document references', severity: 'info', items: orphaned_wis },
    { key: 'empty_shells', label: 'Active documents with no body and no file', severity: 'warning', items: empty_shells },
    { key: 'drafts', label: 'Still in draft', severity: 'info', items: drafts },
    { key: 'no_effective_date', label: 'Active with no effective date', severity: 'warning', items: no_effective_date },
    { key: 'past_review', label: 'Past their review date', severity: 'info', items: past_review },
  ];

  return {
    generated_at: new Date().toISOString(),
    documents_reviewed: docs.length,
    findings: sections.reduce((n, s) => n + s.items.length, 0),
    sections,
  };
}
