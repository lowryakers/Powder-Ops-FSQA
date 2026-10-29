// Training records an edit turned into a fail (D-267). READ-ONLY: every
// statement is a SELECT; it writes nothing, not even an audit row.
//
// The bug (fixed in D-264): from D-158 (7 Oct 2026) until 29 Oct 2026, saving a
// training record through Edit sent `passed: null` back, the server read it as
// 0, and a completed record with no score became `failed`. The person then read
// as "not trained" on the matrix.
//
// How such a record is told from a real fail:
//   - status failed, passed 0, not from an in-app test (no test_attempt_id);
//   - it KEEPS its completion date — a real fail is filed with none
//     (insertCompletion), so a failed row with a completion date was a
//     completion that something later turned;
//   - it has an Edit logged on or after 7 Oct 2026.
// A row whose score is BELOW the course pass mark may be a genuine fail (the
// D-158 boot repair turned those, correctly); those are listed apart, to check.

export const BUG_FROM = '2026-10-07';

const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

export function editFailedTraining(db) {
  const rows = safe(() => db.prepare(`SELECT r.*, c.title AS course_title, c.code AS course_code, c.passing_score
    FROM training_records r LEFT JOIN training_courses c ON c.id = r.course_id
    WHERE r.status = 'failed' AND r.passed = 0 AND r.test_attempt_id IS NULL
      AND r.completion_date IS NOT NULL
    ORDER BY r.employee_name, r.completion_date`).all(), []);
  const edits = db.prepare(`SELECT timestamp, actor FROM audit_log
    WHERE entity_type = 'training' AND entity_id = ? AND action IN ('update', 'training_updated') AND timestamp >= ?
    ORDER BY id`);
  const hasPass = db.prepare(`SELECT completion_date FROM training_records
    WHERE course_id = ? AND id != ? AND status = 'completed' AND COALESCE(passed, 1) = 1
      AND (LOWER(employee_name) = LOWER(?) OR (? IS NOT NULL AND employee_user_id = ?))
    ORDER BY completion_date DESC LIMIT 1`);
  const likely = [], check = [];
  for (const r of rows) {
    const e = safe(() => edits.all(r.id, BUG_FROM), []);
    if (!e.length) continue;
    const pass = r.passing_score ?? 80;
    const other = r.course_id ? safe(() => hasPass.get(r.course_id, r.id, r.employee_name, r.employee_user_id, r.employee_user_id), null) : null;
    const item = {
      id: r.id,
      person: r.employee_name,
      course: r.course_title ? `${r.course_code ? `${r.course_code} — ` : ''}${r.course_title}` : r.training_topic,
      trained: r.completion_date,
      score: r.score,
      pass_mark: pass,
      first_edit: e[0].timestamp,
      edited_by: [...new Set(e.map(x => x.actor).filter(Boolean))],
      // Another passing record for the course means the person still reads as trained.
      other_pass: other?.completion_date || null,
    };
    if (r.score != null && Number(r.score) < pass) check.push(item); else likely.push(item);
  }
  return { likely, check, bug_from: BUG_FROM, generated_at: new Date().toISOString() };
}

export function editFailedText(r, source = '') {
  const line = (x) => `  ${x.person} · ${x.course} · trained ${x.trained}`
    + `${x.score != null ? ` · score ${x.score}% (pass ${x.pass_mark}%)` : ' · no score'}`
    + ` · edited ${String(x.first_edit).slice(0, 10)} by ${x.edited_by.join(', ') || '—'}`
    + `${x.other_pass ? ` · still trained by another record (${x.other_pass})` : ' · now reads NOT TRAINED'}`;
  const out = [`Training records an edit turned into a fail${source ? ` — ${source}` : ''}`, ''];
  out.push(`Turned into a fail by the edit bug (${r.likely.length}):`);
  out.push(...(r.likely.length ? r.likely.map(line) : ['  None.']));
  out.push('', `Edited and failed, score below the pass mark — may be a real fail, check (${r.check.length}):`);
  out.push(...(r.check.length ? r.check.map(line) : ['  None.']));
  return out.join('\n');
}
