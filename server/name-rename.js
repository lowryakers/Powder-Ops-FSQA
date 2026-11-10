// Rename a name everywhere it can be renamed, from the search (D-328).
//
// "Where is a name used?" (D-326) listed every place the old name is still
// written, and Daniela then went to each screen in turn. This does the plain
// places in one act: the recurring tasks and the cards already open, quality
// schedules, the chemical list and the sign-out catalogue.
//
// WHAT IT NEVER TOUCHES:
//   - a filed record (a record says what was true on the day it was filed);
//   - a controlled document, form or course (those change by their own revision);
//   - the FORM 106-01 dilution checks, which follow their controlled definition
//     (D-327) and change in Controlled Changes.
//
// Preview and apply share `planRename`, so what is shown is what is written.
// Each row changed gets its own audit entry with the before and after.

import { compactTerm, matcher } from './name-usage.js';

const OPEN = "('open','in_progress','overdue','missed')";
const cols = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
const exists = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const compact = (col) => `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(${col},'')),'-',''),' ',''),'_','')`;

// The places a rename reaches. `json` names the columns that hold JSON text,
// where the new name is written escaped.
function targets(db) {
  const dk = exists(db, 'pm_schedules') && cols(db, 'pm_schedules').has('dilution_key');
  return [
    { key: 'schedules', label: 'Recurring tasks', table: 'pm_schedules', name: 'title',
      fields: ['title', 'description', 'procedure_steps'], json: ['procedure_steps'],
      where: dk ? 'dilution_key IS NULL' : '1=1' },
    { key: 'open_cards', label: 'Open task cards', table: 'work_orders', name: 'title',
      fields: ['title', 'description', 'procedure_steps'], json: ['procedure_steps'],
      where: `status IN ${OPEN}${dk ? ' AND (pm_schedule_id IS NULL OR pm_schedule_id NOT IN (SELECT id FROM pm_schedules WHERE dilution_key IS NOT NULL))' : ''}` },
    { key: 'quality_schedules', label: 'Quality schedules', table: 'quality_schedules', name: 'title',
      fields: ['title', 'description', 'procedure_steps'], json: ['procedure_steps'], where: '1=1' },
    { key: 'chemicals', label: 'Chemical list', table: 'approved_chemicals', name: 'name',
      fields: ['name', 'notes'], json: [], where: '1=1' },
    { key: 'signout_items', label: 'Sign-out catalogue', table: 'maintenance_items', name: 'name',
      fields: ['name'], json: [], where: '1=1' },
  ];
}

/**
 * Every change a rename would make. Returns { error } or
 * { from, to, rows:[{target,label,table,id,name,fields:{col:{from,to}}}], by_target:{key:n}, kept:{dilution_checks} }.
 */
export function planRename(db, rawFrom, rawTo) {
  const from = String(rawFrom || '').trim();
  const to = String(rawTo || '').trim();
  if (compactTerm(from).length < 3) return { error: 'Type at least 3 letters or numbers of the old name.' };
  if (!to) return { error: 'Type the new name.' };
  if (compactTerm(to) === compactTerm(from)) return { error: 'The new name is the same as the old one.' };
  const like = `%${compactTerm(from)}%`;
  const rows = [];
  const byTarget = {};
  for (const t of targets(db)) {
    if (!exists(db, t.table)) continue;
    const have = cols(db, t.table);
    const fields = t.fields.filter((f) => have.has(f));
    if (!fields.length) continue;
    const found = db.prepare(`SELECT id, ${fields.join(', ')} FROM ${t.table}
      WHERE (${t.where}) AND (${fields.map((f) => `${compact(f)} LIKE ?`).join(' OR ')}) LIMIT 1000`)
      .all(...fields.map(() => like));
    for (const r of found) {
      const changed = {};
      for (const f of fields) {
        const v = r[f];
        if (typeof v !== 'string' || !v) continue;
        const re = new RegExp(matcher(from).source, 'gi');
        const repl = t.json.includes(f) ? JSON.stringify(to).slice(1, -1) : to;
        const next = v.replace(re, () => repl);
        if (next !== v) changed[f] = { from: v, to: next };
      }
      if (Object.keys(changed).length) {
        rows.push({ target: t.key, label: t.label, table: t.table, id: r.id, name: r[t.name] ?? null, fields: changed });
        byTarget[t.key] = (byTarget[t.key] || 0) + 1;
      }
    }
  }
  // What it deliberately leaves: the dilution checks follow Controlled Changes.
  let dilution = 0;
  if (exists(db, 'pm_schedules') && cols(db, 'pm_schedules').has('dilution_key')) {
    dilution = db.prepare(`SELECT COUNT(*) n FROM pm_schedules WHERE dilution_key IS NOT NULL AND (${['title', 'description', 'procedure_steps'].map((f) => `${compact(f)} LIKE ?`).join(' OR ')})`)
      .get(like, like, like).n;
  }
  return { from, to, rows, by_target: byTarget, kept: { dilution_checks: dilution } };
}

/** Write the plan. One transaction, one audit entry per row. */
export function applyRename(db, plan, { actor, reason, logAudit }) {
  const stamp = (t) => (cols(db, t).has('updated_at') ? ", updated_at = datetime('now')" : '');
  db.transaction(() => {
    for (const r of plan.rows) {
      const fs = Object.keys(r.fields);
      db.prepare(`UPDATE ${r.table} SET ${fs.map((f) => `${f} = ?`).join(', ')}${stamp(r.table)} WHERE id = ?`)
        .run(...fs.map((f) => r.fields[f].to), r.id);
      logAudit(actor, 'update', r.table, r.id,
        { rename: { from: plan.from, to: plan.to }, reason, fields: fs },
        Object.fromEntries(fs.map((f) => [f, r.fields[f].from])),
        Object.fromEntries(fs.map((f) => [f, r.fields[f].to])), r.name);
    }
  })();
  return plan.rows.length;
}
