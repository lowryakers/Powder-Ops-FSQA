// The gluten misread report (D-308). READ-ONLY — it lists, it never edits.
//
// Before D-221 the reader joined CTLA's MDL cell to its result cell, so a
// gluten result of "<4" (MDL 4) was stored as "<44", and the test name came
// out as "Gluten Allergen ReportELISA <". Unsigned requests are corrected in
// the ordinary way. A SIGNED certificate is closed, so this report lists the
// signed ones for Quality to correct inside a correction window (D-307):
// un-sign with a reason, fix the result, sign again. Nothing here writes.
import { normalizeTestName } from './coa-grade.js';

const JOINED_NAMES = new Set(['gluten allergen reportelisa', 'gluten allergen report elisa']);

/** True when a stored result looks like the "<44" misread or carries the joined name. */
export function isGlutenMisread(row) {
  const name = normalizeTestName(row?.test_type);
  const joined = JOINED_NAMES.has(name);
  const gluten = joined || /\bgluten\b/.test(name);
  const value = String(row?.result_value || '').replace(/\s+/g, '');
  const glued = gluten && /^<\s*44(\.0+)?$/.test(value);
  return joined || glued;
}

/** Signed (or reopened) requests with a misread gluten row, oldest first. SELECT only. */
export function glutenMisreadReport(db) {
  const rows = db.prepare(`
    SELECT t.id AS result_id, t.request_id, t.test_type, t.result_value, t.unit, t.pass_fail,
           r.item_number, r.item_description, r.lot_number, r.certificate_number, r.qa_signed_by, r.qa_signed_at,
           r.reopened_for_correction
      FROM coa_test_results t JOIN coa_requests r ON r.id = t.request_id
     WHERE lower(t.test_type) LIKE '%gluten%'`).all();
  const hits = rows.filter(isGlutenMisread);
  const byReq = new Map();
  for (const h of hits) {
    const k = h.request_id;
    if (!byReq.has(k)) byReq.set(k, {
      request_id: k, item_number: h.item_number, item_description: h.item_description, lot_number: h.lot_number,
      certificate_number: h.certificate_number, qa_signed_by: h.qa_signed_by, qa_signed_at: h.qa_signed_at,
      signed: !!h.qa_signed_at, reopened: !!h.reopened_for_correction, results: [],
    });
    byReq.get(k).results.push({ id: h.result_id, test_type: h.test_type, result_value: h.result_value, unit: h.unit, pass_fail: h.pass_fail,
      problem: JOINED_NAMES.has(normalizeTestName(h.test_type)) ? (/44/.test(h.result_value || '') ? 'joined name and <44' : 'joined name') : '<44 (MDL glued to result)' });
  }
  const all = [...byReq.values()].sort((a, b) => String(a.qa_signed_at || '').localeCompare(String(b.qa_signed_at || '')));
  return {
    signed: all.filter(r => r.signed),
    reopened: all.filter(r => r.reopened),
    unsigned: all.filter(r => !r.signed && !r.reopened),
    note: 'Read-only. A signed certificate is corrected inside a correction window: un-sign with a reason, correct the result to <4, sign again.',
  };
}
