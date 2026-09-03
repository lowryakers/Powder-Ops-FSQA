// The organoleptic specification per product (FORM 602-01 V2).
//
// Insert-only per product: the first test of a product with no spec writes
// the DRAFT from what QA describes; a QA lead approves it — a deliberate act
// with a name and a date — and after that it is read-only on every test.
// `snapshot()` is what a record stores: the text it was graded against.
import { randomUUID as uuid } from 'crypto';
import { SENSORY_KEYS, productKey } from '../shared/sensory.js';

export function getSpec(db, productName) {
  const key = productKey(productName);
  if (!key) return null;
  try { return db.prepare('SELECT * FROM product_sensory_specs WHERE product_key = ?').get(key) || null; }
  catch { return null; }
}

export function listSpecs(db, { status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM product_sensory_specs WHERE status = ? ORDER BY product_name').all(status)
    : db.prepare('SELECT * FROM product_sensory_specs ORDER BY status, product_name').all();
  return rows;
}

const cleanText = (v) => String(v ?? '').trim().slice(0, 400);

// Draft a spec from what the evaluator wrote. Refuses to overwrite one that
// exists — a second test of the same product grades against it instead.
export function draftSpec(db, productName, texts, { by, sourceRecordId } = {}) {
  const key = productKey(productName);
  if (!key) return { error: 'A product name is needed before a specification can be drafted.' };
  const existing = getSpec(db, productName);
  if (existing) return { spec: existing, created: false };
  const attrs = Object.fromEntries(SENSORY_KEYS.map(k => [k, cleanText(texts?.[k])]));
  const missing = SENSORY_KEYS.filter(k => !attrs[k]);
  if (missing.length) return { error: `Describe every attribute for the specification — missing: ${missing.join(', ')}.` };
  const id = uuid();
  db.prepare(`INSERT INTO product_sensory_specs (id, product_key, product_name, appearance, odor, taste, color, texture, status, drafted_by, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
    .run(id, key, String(productName).trim(), attrs.appearance, attrs.odor, attrs.taste, attrs.color, attrs.texture, by || null, sourceRecordId || null);
  return { spec: getSpec(db, productName), created: true };
}

// Editable while draft only. An approved specification is what filed records
// were graded against; correcting one is a new decision, not an edit.
export function updateDraft(db, id, texts, { by } = {}) {
  const row = db.prepare('SELECT * FROM product_sensory_specs WHERE id = ?').get(id);
  if (!row) return { error: 'Specification not found.', status: 404 };
  if (row.status !== 'draft') return { error: 'This specification is approved and locked. Tests grade against it as written.', status: 409 };
  const attrs = Object.fromEntries(SENSORY_KEYS.map(k => [k, texts?.[k] !== undefined ? cleanText(texts[k]) : row[k]]));
  db.prepare(`UPDATE product_sensory_specs SET appearance = ?, odor = ?, taste = ?, color = ?, texture = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(attrs.appearance, attrs.odor, attrs.taste, attrs.color, attrs.texture, texts?.notes !== undefined ? cleanText(texts.notes) : row.notes, id);
  void by;
  return { spec: db.prepare('SELECT * FROM product_sensory_specs WHERE id = ?').get(id) };
}

export function approveSpec(db, id, { by }) {
  const row = db.prepare('SELECT * FROM product_sensory_specs WHERE id = ?').get(id);
  if (!row) return { error: 'Specification not found.', status: 404 };
  if (row.status === 'approved') return { error: `Already approved by ${row.approved_by} on ${String(row.approved_at).slice(0, 10)}.`, status: 409 };
  const blank = SENSORY_KEYS.filter(k => !cleanText(row[k]));
  if (blank.length) return { error: `Every attribute needs a specification before approval — blank: ${blank.join(', ')}.`, status: 400 };
  db.prepare(`UPDATE product_sensory_specs SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(by, id);
  return { spec: db.prepare('SELECT * FROM product_sensory_specs WHERE id = ?').get(id) };
}

// What a record stores: the words it was graded against, and whether those
// words were approved at the time.
export function snapshot(spec) {
  if (!spec) return null;
  return {
    id: spec.id, status: spec.status,
    approved_by: spec.approved_by || null, approved_at: spec.approved_at || null,
    attributes: Object.fromEntries(SENSORY_KEYS.map(k => [k, spec[k] || ''])),
  };
}
