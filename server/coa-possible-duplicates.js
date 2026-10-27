// COA possible duplicates — Maria's to decide (decision A-20261027-003, D-242).
//
// The 27 Oct 2026 review found 59 pairs of COA records that MAY be one test
// entered twice. Unlike the obvious ones (removed by an admin-run script,
// D-241), nobody can tell from the data alone, so each pair becomes an item in
// QA Review's "COA corrections" pile and Maria decides:
//
//  · "Same test": she records which record goes and why; an admin then deletes
//    it with the ordinary bulk delete. This module never deletes anything, and
//    the kind grants NO un-sign or delete permission (`authorizes: []`).
//  · "Not a duplicate": she dismisses the item with a reason.
//
// `seedCoaPossibleDuplicates` files the items once, additive (INSERT OR IGNORE
// on item_key, marker `coa_possible_duplicates_seeded_v1`, written only once
// coa_requests has rows). A pair whose records no longer exist is skipped. It
// never modifies or deletes a COA record. Progress is derived in
// `possibleProgress` (coa-review-items.js) on every read.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DUP_DECISION = 'A-20261027-003';
export const DUP_MARKER = 'coa_possible_duplicates_seeded_v1';
export const DUP_SEED_FILE = path.join(__dirname, 'seed', 'coa-possible-duplicates.json');
export const DUP_KIND = 'POSSIBLE_DUPLICATE';

export const loadPossibleDuplicates = () => JSON.parse(readFileSync(DUP_SEED_FILE, 'utf8')).items;
export const dupItemKey = (s) => (s.id_b ? `dup:${s.id_a}:${s.id_b}` : `dup-rows:${s.id_a}`);

// A Drive link typed into the lot field reads as the lot text in brackets.
const lotText = (v) => {
  const s = String(v ?? '').trim();
  if (!/https?:\/\//i.test(s)) return s;
  const m = s.slice(s.search(/https?:\/\//i)).match(/\(([^()]*)\)/);
  return m ? m[1].trim() : s.replace(/https?:\/\/\S+/gi, '').trim();
};
const day = (v) => (v ? String(v).slice(0, 10) : 'none');

/** One line naming what differs between the two records, in words. */
export function differenceLine(a, b) {
  const parts = [];
  if (String(a.item_number || '') !== String(b.item_number || '')) parts.push(`item number ${a.item_number || 'blank'} vs ${b.item_number || 'blank'}`);
  if (lotText(a.lot_number) !== lotText(b.lot_number)) parts.push(`lot "${lotText(a.lot_number)}" vs "${lotText(b.lot_number)}"`);
  if (/https?:\/\//i.test(a.lot_number || '') !== /https?:\/\//i.test(b.lot_number || '')) parts.push('one has a Drive link typed into its lot field');
  if (day(a.date_sent) !== day(b.date_sent)) parts.push(`sent ${day(a.date_sent)} vs ${day(b.date_sent)}`);
  if (day(a.date_of_results) !== day(b.date_of_results)) parts.push(`results ${day(a.date_of_results)} vs ${day(b.date_of_results)}`);
  if (String(a.tests_requested || '') !== String(b.tests_requested || '')) parts.push('different tests requested');
  if (!!a.qa_signed_at !== !!b.qa_signed_at) parts.push(`${a.qa_signed_at ? 'A' : 'B'} is signed, the other is not`);
  return parts.length ? `Record A vs record B: ${parts.join(' · ')}.` : 'Record A and record B have the same item, lot and dates.';
}

const recordLabel = (letter, r) => `Record ${letter}: item ${r.item_number || 'blank'} · lot ${lotText(r.lot_number) || 'blank'} · sent ${day(r.date_sent)}${r.qa_signed_at ? ' · signed' : ''}`;

// The review's suggestion names records by the first 8 characters of their id;
// Maria reads "record A" / "record B" instead.
const plain = (text, s) => String(text || '')
  .replaceAll(s.id_a.slice(0, 8), 'record A')
  .replaceAll(s.id_b ? s.id_b.slice(0, 8) : '\u0000', 'record B');

export function textFor(s) {
  const single = !s.id_b;
  return {
    title: `${s.product} · lot ${s.lot} · possible duplicate`,
    recommended_action: single
      ? 'Check the result lines on this record. If some were entered twice, delete the extra lines (a signed record is un-signed by an admin first); if they are not duplicates, dismiss with a reason.'
      : 'Check whether these two records are the same test. If yes, delete the one marked (or choose which to keep); if no, dismiss with a reason.',
    reason: `${s.kind}. How sure the review was: ${s.how_sure}. Suggestion: ${plain(s.suggestion, s)}. ${plain(s.why, s)}`,
    note: single ? null : 'Record A is the one the review suggests removing, unless the suggestion says Maria decides. An admin deletes the record she marks.',
  };
}

function evidenceFor(db, s) {
  const get = db.prepare('SELECT * FROM coa_requests WHERE id = ?');
  const fileOf = db.prepare('SELECT id, original_name FROM coa_files WHERE request_id = ? ORDER BY created_at DESC LIMIT 1');
  const a = get.get(s.id_a), b = s.id_b ? get.get(s.id_b) : null;
  const ev = [{ kind: 'request', request_id: a.id, label: recordLabel('A', a) }];
  if (b) ev.push({ kind: 'request', request_id: b.id, label: recordLabel('B', b) });
  for (const [letter, r] of [['A', a], ['B', b]]) {
    if (!r) continue;
    const f = fileOf.get(r.id);
    if (f) ev.push({ kind: 'file', file_id: f.id, request_id: r.id, label: `${letter} · ${f.original_name}` });
  }
  if (b) ev.push({ kind: 'line', label: differenceLine(a, b) });
  return ev;
}

/** File the items once. Additive; never touches a COA record. */
export function seedCoaPossibleDuplicates(db, logAudit, { items = loadPossibleDuplicates() } = {}) {
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DUP_MARKER)) return { already: true, inserted: 0, skipped: 0 };
  if (!db.prepare('SELECT COUNT(*) c FROM coa_requests').get().c) return { waiting: true, inserted: 0, skipped: 0 };
  const exists = db.prepare('SELECT 1 FROM coa_requests WHERE id = ?');
  const insert = db.prepare(`INSERT OR IGNORE INTO coa_review_items
    (id, item_key, kind, request_id, title, recommended_action, reason, evidence, steps, decision_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inserted = 0, skipped = 0;
  db.transaction(() => {
    for (const s of items) {
      if (!exists.get(s.id_a) || (s.id_b && !exists.get(s.id_b))) { skipped++; continue; }
      const t = textFor(s);
      const info = insert.run(uuid(), dupItemKey(s), DUP_KIND, s.id_a, t.title, t.recommended_action, t.reason,
        JSON.stringify(evidenceFor(db, s)), JSON.stringify({ steps: s.id_b ? ['decide', 'remove'] : ['results'], note: t.note, seed: s }), DUP_DECISION);
      inserted += info.changes;
    }
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(DUP_MARKER, new Date().toISOString());
  })();
  logAudit?.('system', 'create', 'coa_review_items', null,
    { message: `queued ${inserted} possible duplicates for Maria, decision ${DUP_DECISION}`, inserted, skipped, decision: DUP_DECISION });
  return { inserted, skipped };
}
