// The server half of the check-record interface (D-060; the spec is
// shared/check-forms.js).
//
// `checkFormFor(db, wo)` says what a task's completion must carry, and
// `fileCheckRecord(db, ...)` files the record that completion is evidence
// for — inside the completion's own transaction, the fileQaInspectionRecord
// rule: the task and the record are one event. Adding a program is one kind
// in the shared spec and one branch here; pm.js does not change.

import { v4 as uuid } from 'uuid';
import {
  checkKindFor, empZoneFor, EMP_ZONES, GMP_WALK_ITEMS, GMP_WALK_REVISION, BANNED_LISTS,
  missingForCheck, normalizeCheck,
} from '../shared/check-forms.js';
import { EMP_SECTIONS, EMP_FORM_CODE, EMP_REVISION } from './emp-site-list.js';
import { raiseCapa } from './capa-raise.js';

export { missingForCheck, normalizeCheck };

function scheduleFor(db, wo) {
  if (!wo?.quality_schedule_id) return null;
  try { return db.prepare('SELECT id, title, module_id FROM quality_schedules WHERE id = ?').get(wo.quality_schedule_id) || null; }
  catch { return null; }
}

/** The form's own site list for a zone, plus sites already sampled there. */
function empSitesFor(db, zone) {
  const sec = EMP_SECTIONS.find(s => s.key === zone);
  const fromForm = sec?.sites ? [...sec.sites] : [];
  const seen = (() => {
    try { return db.prepare('SELECT DISTINCT site FROM emp_samples WHERE zone = ? ORDER BY site').all(zone).map(r => r.site); }
    catch { return []; }
  })();
  const out = [];
  const have = new Set();
  for (const s of [...fromForm, ...seen]) { const k = s.toLowerCase(); if (!have.has(k)) { have.add(k); out.push(s); } }
  return out;
}

/**
 * What this work order's completion must carry, or null when it is an
 * ordinary task. Cheap enough to run per row on a task list: one schedule
 * lookup, and only for tasks that came from a quality schedule.
 */
export function checkFormFor(db, wo) {
  const sched = scheduleFor(db, wo);
  if (!sched) return null;
  const kind = checkKindFor(sched);
  if (!kind) return null;
  if (kind === 'emp') {
    const zone = empZoneFor(sched.title);
    return {
      kind, zone, zone_label: EMP_ZONES[zone]?.label || zone, tests: EMP_ZONES[zone]?.tests || [],
      sites: empSitesFor(db, zone), form_code: EMP_FORM_CODE, form_revision: EMP_REVISION,
    };
  }
  if (kind === 'gmp_walk') return { kind, items: GMP_WALK_ITEMS, revision: GMP_WALK_REVISION, draft: true };
  if (kind === 'banned_list_review') return { kind, lists: BANNED_LISTS };
  return null;
}

/** Attach `check_form` to a list of task rows (one schedule lookup each, cached). */
export function attachCheckForms(db, rows) {
  const cache = new Map();
  return rows.map(r => {
    if (!r.quality_schedule_id) return r;
    if (!cache.has(r.quality_schedule_id)) cache.set(r.quality_schedule_id, checkFormFor(db, r));
    const f = cache.get(r.quality_schedule_id);
    return f ? { ...r, check_form: f } : r;
  });
}

/**
 * File the record a completed check is evidence for. Must run inside the
 * completion's transaction. Returns { kind, ids, capas } for the audit line.
 */
export function fileCheckRecord(db, { form, check, wo, by, when, notes }) {
  const c = normalizeCheck(form, check);
  const day = (when || new Date().toISOString()).slice(0, 10);
  if (form.kind === 'emp') {
    const ins = db.prepare(`INSERT INTO emp_samples (id, work_order_id, quality_schedule_id, zone, site, test, sampled_on, sampled_by, lab, outcome, form_revision, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'task')`);
    const ids = [];
    for (const site of c.sites) {
      for (const test of form.tests) {
        const id = uuid();
        ins.run(id, wo.id, wo.quality_schedule_id, form.zone, site, test, day, by, c.lab, `${EMP_FORM_CODE} ${EMP_REVISION}`, notes || null);
        ids.push(id);
      }
    }
    return { kind: 'emp', ids, sites: c.sites.length };
  }
  if (form.kind === 'gmp_walk') {
    const id = uuid();
    const items = form.items.map(it => ({ key: it.key, label: it.label, ...c.items[it.key] }));
    const ncs = items.filter(i => i.result === 'nc');
    // A REPEATED problem raises the CAR — the same item not compliant on the
    // previous walk as well. That is the plant's own wording in the CAR
    // response, and it is the two-consecutive-ATP-swabs shape: one walk
    // catching a hairnet is a correction on the spot; two walks running is a
    // control that is not holding.
    const prev = db.prepare('SELECT items FROM gmp_walkthroughs ORDER BY walked_on DESC, created_at DESC LIMIT 1').get();
    const prevNc = new Set();
    if (prev) { try { for (const i of JSON.parse(prev.items)) if (i.result === 'nc') prevNc.add(i.key); } catch { /* unreadable */ } }
    const capas = [];
    for (const nc of ncs) {
      if (!prevNc.has(nc.key)) continue;
      const capa = raiseCapa(db, by, {
        title: `GMP walk-through: ${nc.label.split(' — ')[0]} not compliant on two consecutive walks`,
        description: `Raised from the weekly GMP walk-through (${GMP_WALK_REVISION}) of ${day}, area ${c.area}.\n\nSeen: ${nc.note || 'no note'}.\nThe same item was not compliant on the previous walk.`,
        source_type: 'GMP Walk-through', priority: 'normal', date_issued: day,
        extra: { from_gmp_walk: id, item: nc.key },
      });
      capas.push(capa.id);
      nc.capa_id = capa.id;
    }
    db.prepare(`INSERT INTO gmp_walkthroughs (id, work_order_id, quality_schedule_id, walked_on, walked_by, area, checklist_revision, items, nc_count, capa_ids, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, wo.id, wo.quality_schedule_id, day, by, c.area, GMP_WALK_REVISION, JSON.stringify(items), ncs.length, JSON.stringify(capas), notes || null);
    return { kind: 'gmp_walk', ids: [id], nc_count: ncs.length, capas };
  }
  if (form.kind === 'banned_list_review') {
    const id = uuid();
    db.prepare(`INSERT INTO banned_list_reviews (id, work_order_id, quality_schedule_id, reviewed_on, reviewed_by, editions, changes_found, actions_taken, materials_rechecked, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, wo.id, wo.quality_schedule_id, day, by, JSON.stringify(c.editions), c.changes_found, c.actions_taken, c.materials_rechecked ? 1 : 0, notes || null);
    return { kind: 'banned_list_review', ids: [id] };
  }
  return null;
}

/** The editions in use: the latest review's. Null until the first review. */
export function currentListEditions(db) {
  try {
    const r = db.prepare('SELECT * FROM banned_list_reviews ORDER BY reviewed_on DESC, created_at DESC LIMIT 1').get();
    return r ? { ...r, editions: JSON.parse(r.editions || '{}') } : null;
  } catch { return null; }
}
