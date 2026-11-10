// Where a name is used (D-326) — READ-ONLY.
//
// Asked when the plant switched sanitizer (Sani-512 → J-512): "can the
// documents and the tasks have the new name?" The name sits in several places
// with different owners — the controlled documents (Document Control), the
// recurring task steps (whoever runs Recurring Schedules), the chemical
// register, training material, and a few definitions built into the app. This
// answers "where is it, and who changes each one?" in one list.
//
// IT WRITES NOTHING, not even an audit row: it is a search. Every query is a
// SELECT; `verify:nameusage` counts every table before and after.
//
// Matching ignores case, spaces, hyphens and underscores, so "Sani-512",
// "Sani 512" and "sani512" find each other. A term under three characters is
// refused: "J5" would match half the plant.

import { DILUTIONS } from '../shared/dilution-forms.js';

const LIMIT = 200;
const MIN_LEN = 3;

// The SQL half of the match: the column with case and separators taken out.
const compact = (col) => `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(${col},'')),'-',''),' ',''),'_','')`;
export const compactTerm = (s) => String(s || '').toLowerCase().replace(/[\s\-_]+/g, '');

// The JS half: the same match, so a snippet can show where the hit is.
export function matcher(term) {
  const chars = [...compactTerm(term)].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(chars.join('[\\s\\-_]*'), 'i');
}

function snippet(text, re) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const m = re.exec(s);
  if (!m) return null;
  const from = Math.max(0, m.index - 50);
  const to = Math.min(s.length, m.index + m[0].length + 50);
  return `${from > 0 ? '…' : ''}${s.slice(from, to)}${to < s.length ? '…' : ''}`;
}

// The first text that carries the hit, named.
function firstHit(row, cols, re) {
  for (const [col, label] of cols) {
    const v = row[col];
    const text = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
    const sn = snippet(text, re);
    if (sn) return { field: label, snippet: sn };
  }
  return null;
}

const tableExists = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const columnsOf = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));

/**
 * One section per place. `who` says who changes it and `how` what to do;
 * `open` is the screen it is changed on. Each row names the field the hit is in.
 */
function search(db, { table, cols, select, where = '1 = 1', order = 'rowid', shape }, term, re) {
  if (!tableExists(db, table)) return [];
  const have = columnsOf(db, table);
  const usable = cols.filter(([c]) => have.has(c));
  if (!usable.length) return [];
  const t = `%${compactTerm(term)}%`;
  const like = usable.map(([c]) => `${compact(c)} LIKE ?`).join(' OR ');
  const rows = db.prepare(`SELECT ${select} FROM ${table} WHERE (${where}) AND (${like}) ORDER BY ${order} LIMIT ${LIMIT}`)
    .all(...usable.map(() => t));
  return rows.map((r) => ({ ...shape(r), hit: firstHit(r, usable, re) }));
}

export function nameUsage(db, raw) {
  const term = String(raw || '').trim();
  if (compactTerm(term).length < MIN_LEN) {
    return { term, error: `Type at least ${MIN_LEN} letters or numbers.`, sections: [], total: 0 };
  }
  const re = matcher(term);

  const openCards = tableExists(db, 'work_orders')
    ? db.prepare(`SELECT pm_schedule_id, COUNT(*) n FROM work_orders
        WHERE status IN ('open','in_progress','overdue','missed') AND pm_schedule_id IS NOT NULL GROUP BY pm_schedule_id`).all()
    : [];
  const openBySchedule = new Map(openCards.map((r) => [r.pm_schedule_id, r.n]));

  const sections = [
    {
      key: 'documents',
      label: 'Controlled documents (SOPs, WIs, JDs, forms)',
      who: 'Document Control',
      how: 'Raise a change request, then revise the document. It goes to QA review and approval.',
      open: { tab: 'document-control' },
      rows: search(db, {
        table: 'sop_documents',
        cols: [['title', 'title'], ['description', 'text'], ['description_es', 'Spanish text']],
        select: 'id, doc_number, title, revision, status, doc_type, description, description_es',
        order: 'doc_number',
        shape: (r) => ({ id: r.id, name: [r.doc_number, r.title].filter(Boolean).join(' — '),
          detail: [r.revision, r.status === 'archived' ? 'no longer in use' : r.status].filter(Boolean).join(' · '),
          inactive: r.status === 'archived' }),
      }, term, re),
    },
    {
      key: 'draft_revisions',
      label: 'Draft revisions waiting for approval',
      who: 'Document Control',
      how: 'Already being revised. Check the draft carries the new name before it is approved.',
      open: { tab: 'doc-review', view: 'draft-revisions' },
      rows: [], // filled below (a joined search)
    },
    {
      key: 'forms',
      label: 'Forms register',
      who: 'Document Control',
      how: 'Correct the form\'s entry in Controlled Documents → Forms.',
      open: { tab: 'document-control', view: 'forms' },
      rows: search(db, {
        table: 'controlled_forms',
        cols: [['title', 'title'], ['note', 'note']],
        select: 'id, code, revision, title, note, where_used',
        order: 'code',
        shape: (r) => ({ id: r.id, name: [r.code, r.title].filter(Boolean).join(' — '), detail: r.revision || '',
          inactive: r.where_used === 'retired' }),
      }, term, re),
    },
    {
      key: 'schedules',
      label: 'Recurring tasks (the steps people are given)',
      who: 'A supervisor or admin',
      how: 'Edit the schedule in Task Center → Recurring Schedules. A change reaches the open cards too.',
      open: { tab: 'pm-schedules' },
      rows: search(db, {
        table: 'pm_schedules',
        cols: [['title', 'title'], ['description', 'description'], ['procedure_steps', 'steps']],
        select: 'id, title, description, procedure_steps, is_active, task_group',
        order: 'title',
        shape: (r) => ({ id: r.id, name: r.title,
          detail: [r.is_active ? 'active' : 'paused', r.task_group, `${openBySchedule.get(r.id) || 0} open card(s)`].filter(Boolean).join(' · '),
          inactive: !r.is_active }),
      }, term, re),
    },
    {
      key: 'quality_schedules',
      label: 'Quality schedules',
      who: 'QA',
      how: 'Edit it in Quality Schedules.',
      open: { tab: 'quality-schedules' },
      rows: search(db, {
        table: 'quality_schedules',
        cols: [['title', 'title'], ['description', 'description'], ['procedure_steps', 'steps']],
        select: 'id, title, description, procedure_steps, is_active',
        order: 'title',
        shape: (r) => ({ id: r.id, name: r.title, detail: r.is_active ? 'active' : 'paused', inactive: !r.is_active }),
      }, term, re),
    },
    {
      key: 'one_off_tasks',
      label: 'Open one-off tasks (not from a schedule)',
      who: 'Whoever owns the task',
      how: 'Edit or close it in the Task Center.',
      open: { tab: 'pm' },
      rows: search(db, {
        table: 'work_orders',
        cols: [['title', 'title'], ['description', 'description'], ['procedure_steps', 'steps']],
        select: 'id, title, description, procedure_steps, status, due_date',
        where: "status IN ('open','in_progress','overdue','missed') AND pm_schedule_id IS NULL",
        order: 'due_date',
        shape: (r) => ({ id: r.id, name: r.title, detail: [r.status, r.due_date && `due ${r.due_date}`].filter(Boolean).join(' · ') }),
      }, term, re),
    },
    {
      key: 'chemicals',
      label: 'Chemical register',
      who: 'QA',
      how: 'Update or retire the entry in Chemicals.',
      open: { tab: 'chemicals' },
      rows: search(db, {
        table: 'approved_chemicals',
        cols: [['name', 'name'], ['product_code', 'product code'], ['notes', 'notes']],
        select: 'id, name, product_code, notes, is_active',
        order: 'name',
        shape: (r) => ({ id: r.id, name: r.name, detail: r.is_active ? 'active' : 'retired', inactive: !r.is_active }),
      }, term, re),
    },
    {
      key: 'signout_items',
      label: 'Sign-out catalogue (Form 703-01)',
      who: 'An admin or supervisor',
      how: 'Rename or retire the item in Sign In/Out.',
      open: { tab: 'sign-out' },
      rows: search(db, {
        table: 'maintenance_items',
        cols: [['name', 'name']],
        select: 'id, name',
        order: 'name',
        shape: (r) => ({ id: r.id, name: r.name }),
      }, term, re),
    },
    {
      key: 'courses',
      label: 'Training courses',
      who: 'Whoever owns the course (Document Control for a WI course)',
      how: 'Update the course in Training. A course built on a revised document is marked updated there.',
      open: { tab: 'training' },
      rows: search(db, {
        table: 'training_courses',
        cols: [['title', 'title'], ['description', 'description']],
        select: 'id, code, title, description, active',
        order: 'code',
        shape: (r) => ({ id: r.id, name: [r.code, r.title].filter(Boolean).join(' — '), detail: r.active ? '' : 'retired', inactive: !r.active }),
      }, term, re),
    },
    {
      key: 'questions',
      label: 'Training test questions',
      who: 'Whoever owns the course',
      how: 'Edit the test in Training.',
      open: { tab: 'training' },
      rows: [], // filled below (a joined search)
    },
    {
      key: 'eod_templates',
      label: 'End-of-day report questions',
      who: 'An admin or Production Log editor',
      how: 'Edit it in Production Log → EOD Templates.',
      open: { tab: 'production-log', view: 'templates' },
      rows: search(db, {
        table: 'eod_templates',
        cols: [['title', 'title'], ['fields', 'questions']],
        select: 'team, title, fields',
        order: 'team',
        shape: (r) => ({ id: r.team, name: `${r.team} — ${r.title || ''}`.trim() }),
      }, term, re),
    },
    {
      key: 'built_in',
      label: 'Built into the app',
      who: 'Lowry (a code change, approved by Document Control in Controlled Changes)',
      how: 'Ask Lowry. The change waits in Controlled Changes until Document Control approves it.',
      open: { tab: 'controlled-changes' },
      rows: DILUTIONS
        .map((d) => ({ d, hit: firstHit({ chemical: d.chemical, registry_name: d.registry_name, target: d.target },
          [['chemical', 'chemical'], ['registry_name', 'chemical register name'], ['target', 'target']], re) }))
        .filter((x) => x.hit)
        .map(({ d, hit }) => ({ id: d.key, name: `FORM 106-01 daily dilution check — ${d.chemical}`, detail: d.target, hit })),
    },
  ];

  // The two joined searches cannot use search()'s single-table shape; run them here.
  sections.find((s) => s.key === 'draft_revisions').rows = joined(db, term, re, {
    need: ['document_revisions', 'sop_documents'],
    from: 'document_revisions r LEFT JOIN sop_documents d ON d.id = r.document_id',
    cols: [['r.title', 'title'], ['r.description', 'text'], ['r.description_es', 'Spanish text']],
    select: 'r.id, r.revision, r.title AS title, r.description AS description, r.description_es AS description_es, d.doc_number',
    where: "r.status = 'draft'",
    order: 'd.doc_number',
    hitCols: [['title', 'title'], ['description', 'text'], ['description_es', 'Spanish text']],
    shape: (r) => ({ id: r.id, name: [r.doc_number, r.title].filter(Boolean).join(' — '), detail: `draft ${r.revision || ''}`.trim() }),
  });
  sections.find((s) => s.key === 'questions').rows = joined(db, term, re, {
    need: ['training_questions', 'training_tests', 'training_courses'],
    from: 'training_questions q LEFT JOIN training_tests t ON t.id = q.test_id LEFT JOIN training_courses c ON c.id = t.course_id',
    cols: [['q.prompt', 'question'], ['q.options', 'answers']],
    select: 'q.id, q.position, q.prompt AS prompt, q.options AS options, c.code, c.title',
    where: '1 = 1',
    order: 'c.code, q.position',
    hitCols: [['prompt', 'question'], ['options', 'answers']],
    shape: (r) => ({ id: r.id, name: `${[r.code, r.title].filter(Boolean).join(' — ') || 'A test'} · question ${r.position ?? ''}`.trim() }),
  });

  const out = sections.map((s) => ({ ...s, count: s.rows.length, rows: s.rows }));
  return { term, sections: out, total: out.reduce((n, s) => n + s.count, 0) };
}

function joined(db, term, re, q) {
  if (!q.need.every((t) => tableExists(db, t))) return [];
  const t = `%${compactTerm(term)}%`;
  const like = q.cols.map(([c]) => `${compact(c)} LIKE ?`).join(' OR ');
  try {
    const rows = db.prepare(`SELECT ${q.select} FROM ${q.from} WHERE (${q.where}) AND (${like}) ORDER BY ${q.order} LIMIT ${LIMIT}`)
      .all(...q.cols.map(() => t));
    return rows.map((r) => ({ ...q.shape(r), hit: firstHit(r, q.hitCols, re) }));
  } catch { return []; }
}
