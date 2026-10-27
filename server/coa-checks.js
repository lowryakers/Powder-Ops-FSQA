// The checks a COA result and a certificate must pass (D-243, D-244, COA
// Phase 2 tasks B and C). One module, so the scan apply, the result edit and
// the signature ask the same questions in the same words.
//
//  · WHERE A RESULT CAME FROM is recorded: `source` 'pdf' (read off a lab
//    report, with the file's SHA-256 and exactly what the reader read) or
//    'manual'. Rows written before Phase 2 carry NULL and are judged on what
//    they say, not on a source they never recorded.
//  · A HAND EDIT IS VISIBLE: a verdict a person sets that differs from what the
//    approved limit gives, or a value changed from what the PDF says, needs a
//    reason of 10+ characters and is flagged on the row. Editing back to the
//    PDF's own value and the automatic verdict clears the flag.
//  · AT SIGNING THE PDF IS READ AGAIN and compared with what is saved. A
//    difference is explained only by a flagged hand edit with a reason. An
//    unexplained difference, a line on the report that is not saved, or a
//    "from the PDF" result the PDF no longer shows blocks the signature — in
//    every gate mode, because it protects the record, not the release.
//  · A LINE THE READER COULD NOT READ is stored and becomes a QA Review item;
//    while it is open the certificate cannot be signed.
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { readPdfColumns } from './coa-pdf-text.js';
import { parseColumnarCoa } from './coa-parse.js';
import { specIndex, gradeResult } from './coa-grade.js';
import { sha256 } from './coa-certificate.js';

export const MIN_EDIT_REASON = 10;
const TEXT_LAYER_MIN = 40;
export const UNREAD_DECISION = 'D-243';

/** Compare as a reader would: case, spaces and a leading-dot MDL do not count as a difference. */
export const squash = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase().replace(/^\.(\d)/, '0.$1').replace(/^([<>]=?)\.(\d)/, '$10.$2');
const same = (a, b) => squash(a) === squash(b);

/** Read one stored lab report. Never throws; says what it found. */
export async function readLabFile(fileRow, uploadDir) {
  const p = path.join(uploadDir, fileRow.filename || '');
  if (!fileRow.filename || !existsSync(p)) return { file: fileRow, missing: true };
  const buf = readFileSync(p);
  const computed = sha256(buf);
  const hash_ok = fileRow.sha256 ? fileRow.sha256 === computed : null;   // null: attached before hashes were stored
  let text;
  try { text = (await readPdfColumns(buf)).text || ''; } catch { return { file: fileRow, sha256: computed, hash_ok, unreadable: true }; }
  if (text.replace(/\s/g, '').length < TEXT_LAYER_MIN) return { file: fileRow, sha256: computed, hash_ok, image: true };
  return { file: fileRow, sha256: computed, hash_ok, parsed: parseColumnarCoa(text) };
}

/**
 * The pure comparison: rows read off the report(s) against the saved results.
 * `read` [{ test_type, result_value, unit, mdl, file_id }], `stored` the
 * coa_test_results rows. Returns { problems, explained } in plain words.
 */
export function compareReadToStored(read, stored, { readableFileIds = [] } = {}) {
  const idx = specIndex(stored);
  const problems = []; const explained = [];
  const matched = new Set();
  for (const r of read) {
    const s = idx.find(r.test_type);
    if (!s) { problems.push(`"${r.test_type} ${r.result_value}" is on the lab report but is not saved as a result.`); continue; }
    matched.add(s.id);
    const diffs = [];
    if (!same(r.result_value, s.result_value)) diffs.push(`the report says ${r.result_value} but the saved result is ${s.result_value ?? 'blank'}`);
    if (r.unit && s.unit && !same(r.unit, s.unit)) diffs.push(`the report's unit is ${r.unit} but the saved unit is ${s.unit}`);
    if (r.mdl && s.mdl && !same(r.mdl, s.mdl)) diffs.push(`the report's detection limit is ${r.mdl} but the saved one is ${s.mdl}`);
    if (!diffs.length) continue;
    if (s.edit_reason) explained.push(`${s.test_type}: ${diffs.join('; ')} — changed by hand: ${s.edit_reason}`);
    else problems.push(`${s.test_type}: ${diffs.join('; ')}.`);
  }
  const readable = new Set(readableFileIds);
  for (const s of stored) {
    if (s.source !== 'pdf' || matched.has(s.id)) continue;
    if (s.source_file_id && readable.size && !readable.has(s.source_file_id)) continue;
    problems.push(`${s.test_type} is saved as read from the lab report, but the report no longer shows it.`);
  }
  return { problems, explained };
}

/**
 * Read every lab report on the request again and compare (B5). Runs at
 * signing in every mode. `{ ok, problems, explained, files }`.
 */
export async function rereadCheck(db, request, uploadDir) {
  const files = db.prepare("SELECT * FROM coa_files WHERE request_id = ? AND file_type = 'lab_results' ORDER BY created_at").all(request.id);
  const stored = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ?').all(request.id);
  const problems = []; const fileInfo = []; const read = []; const readable = [];
  for (const f of files) {
    const r = await readLabFile(f, uploadDir);
    const info = { id: f.id, name: f.original_name, sha256: r.sha256 || null, stored_sha256: f.sha256 || null,
      lab_report_number: r.parsed?.lab_report_number || f.lab_report_number || null, report_date: r.parsed?.report_date || f.lab_report_date || null };
    fileInfo.push(info);
    if (r.missing) { problems.push(`The lab report "${f.original_name}" is missing from the server.`); continue; }
    if (r.hash_ok === false) { problems.push(`The lab report "${f.original_name}" has changed since it was attached (its fingerprint no longer matches).`); continue; }
    if (r.image || r.unreadable) { info.image = true; continue; }   // an image scan cannot be checked; treated as no readable report
    readable.push(f.id);
    for (const t of r.parsed.test_results) read.push({ ...t, file_id: f.id });
  }
  if (!readable.length) {
    const fromPdf = stored.filter(s => s.source === 'pdf');
    if (fromPdf.length) problems.push(`${fromPdf.length} result${fromPdf.length === 1 ? ' says it' : 's say they'} came from a lab report, but there is no readable lab report on this request.`);
    return { ok: !problems.length, problems, explained: [], files: fileInfo, readable: 0 };
  }
  const c = compareReadToStored(read, stored, { readableFileIds: readable });
  problems.push(...c.problems);
  return { ok: !problems.length, problems, explained: c.explained, files: fileInfo, readable: readable.length };
}

/** Is this result something a person entered or decided by hand? */
export const isHandEntered = (r) => !!(r && (r.verdict_manual || r.edit_reason || r.source === 'manual'));

/**
 * Whether a write to a result needs a reason (C1), in words; null when it
 * does not. `next` is the row as it would be saved, `spec` the active spec.
 */
export function editNeedsReason({ next, spec, read }) {
  const auto = gradeResult(next.result_value, spec, null, { unit: next.unit }).pass_fail;
  const handVerdict = (next.pass_fail ?? null) !== (auto ?? null);
  const handValue = !!read && !same(next.result_value, read.result_value);
  if (!handVerdict && !handValue) return { needed: false, auto };
  return {
    needed: true, auto, handVerdict, handValue,
    why: [handValue ? `the value differs from the lab report (${read.result_value})` : null,
      handVerdict ? `the pass/fail is set by hand (the approved limit gives ${auto || 'no verdict'})` : null].filter(Boolean).join(' and '),
  };
}

// ── Lines the reader could not read (B4) ─────────────────────────────────────
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Store the unread lines of one applied report and file (once) its QA Review item. */
export function recordUnreadRows(db, request, fileRow, unread, logAudit, user) {
  if (!unread?.length) return { stored: 0, item: null };
  const ins = db.prepare('INSERT OR IGNORE INTO coa_unread_rows (id, request_id, file_id, line_text, test_name, reason) VALUES (?, ?, ?, ?, ?, ?)');
  let stored = 0;
  db.transaction(() => { for (const u of unread) stored += ins.run(uuid(), request.id, fileRow?.id || null, u.line, u.test || null, u.reason).changes; })();
  const key = `unread:${request.id}:${fileRow?.id || 'none'}`;
  const n = db.prepare("SELECT COUNT(*) c FROM coa_unread_rows WHERE request_id = ? AND COALESCE(file_id,'none') = ?").get(request.id, fileRow?.id || 'none').c;
  const item = db.prepare(`INSERT OR IGNORE INTO coa_review_items (id, item_key, kind, request_id, title, recommended_action, reason, evidence, steps, decision_ref)
    VALUES (?, ?, 'UNREAD_ROWS', ?, ?, ?, ?, ?, ?, ?)`).run(uuid(), key, request.id,
    [request.item_number, request.lot_number ? `lot ${request.lot_number}` : null, 'lines the app could not read'].filter(Boolean).join(' · '),
    `The lab report has ${n} line${n === 1 ? '' : 's'} the app could not read. Add each as a result, or say why it is not a result.`,
    'Until every line is added or answered, the certificate cannot be signed — a test the app did not read must not look like a test the lab never ran.',
    JSON.stringify([{ kind: 'request', request_id: request.id, label: 'Open the request' },
      ...(fileRow ? [{ kind: 'file', file_id: fileRow.id, label: fileRow.original_name }] : [])]),
    JSON.stringify({ steps: ['resolve'], file_id: fileRow?.id || null }), UNREAD_DECISION);
  if (item.changes) logAudit?.(user, 'create', 'coa_review_item', key, { kind: 'UNREAD_ROWS', request_id: request.id, lines: n });
  return { stored, item: key };
}

/** Each unread row's state, derived: added once a result with that test name exists. */
export function unreadRowsFor(db, requestId, fileId) {
  const rows = db.prepare(`SELECT * FROM coa_unread_rows WHERE request_id = ?${fileId !== undefined ? " AND COALESCE(file_id,'none') = COALESCE(?, 'none')" : ''} ORDER BY created_at, line_text`)
    .all(...(fileId !== undefined ? [requestId, fileId] : [requestId]));
  const stored = db.prepare('SELECT test_type FROM coa_test_results WHERE request_id = ?').all(requestId);
  const idx = specIndex(stored);
  const names = new Set(stored.map(s => nameKey(s.test_type)));
  return rows.map(r => {
    const added = r.status === 'added' || (r.status !== 'dismissed' && !!r.test_name && (names.has(nameKey(r.test_name)) || !!idx.find(r.test_name)));
    return { ...r, state: r.status === 'dismissed' ? 'dismissed' : added ? 'added' : 'open' };
  });
}

/** Open, unfinished "could not read" items on a request — each blocks signing. */
export function openUnreadItems(db, requestId) {
  let items;
  try { items = db.prepare("SELECT * FROM coa_review_items WHERE request_id = ? AND kind = 'UNREAD_ROWS' AND status = 'open'").all(requestId); } catch { return []; }
  return items.filter(i => {
    const fileId = (() => { try { return JSON.parse(i.steps || '{}').file_id ?? null; } catch { return null; } })();
    return unreadRowsFor(db, requestId, fileId).some(r => r.state === 'open');
  });
}

/** Everything that blocks the signature beyond `signRefusals`: unread lines and the re-read. */
export async function signChecks(db, request, uploadDir) {
  const problems = [];
  const unread = openUnreadItems(db, request.id);
  if (unread.length) {
    const n = unread.reduce((m, i) => m + unreadRowsFor(db, request.id, (() => { try { return JSON.parse(i.steps || '{}').file_id ?? null; } catch { return null; } })()).filter(r => r.state === 'open').length, 0);
    problems.push(`${n} line${n === 1 ? '' : 's'} of the lab report could not be read and ${n === 1 ? 'has' : 'have'} not been added or answered yet (QA Review)`);
  }
  const reread = await rereadCheck(db, request, uploadDir);
  problems.push(...reread.problems);
  return { problems, reread };
}
