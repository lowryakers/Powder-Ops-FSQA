#!/usr/bin/env node
// The annual vendor review generator, against a real database.
//
// The assertions that matter are the two that would go wrong QUIETLY:
// a second run must not double the task, and recording a review must produce
// NEXT year's task rather than being suppressed as a duplicate of this year's.

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { reviewStatus, generateSupplierReviewTasks, supplierReviewNudge, LEAD_DAYS } from '../server/supplier-review.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = '/tmp/supplier-review-check.db';
if (existsSync(DB)) unlinkSync(DB);
const db = new Database(DB);
db.exec(readFileSync(join(ROOT, 'scripts/fixtures/supplier-schema.sql'), 'utf8'));
db.exec(`CREATE TABLE work_orders (id TEXT PRIMARY KEY, equipment_id TEXT, title TEXT, description TEXT,
  priority TEXT, due_date TEXT, procedure_steps TEXT, task_group TEXT, status TEXT,
  supplier_qualification_id TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, department TEXT, is_active INTEGER);`);
db.prepare("INSERT INTO users VALUES ('u1','Adam','supervisor','qa',1)").run();

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

const sup = (id, name, active, status) =>
  db.prepare('INSERT INTO suppliers (id,name,actively_using,status) VALUES (?,?,?,?)').run(id, name, active, status);
const qual = (id, sid, period, disp, due) =>
  db.prepare(`INSERT INTO supplier_qualifications (id,supplier_id,period_label,disposition,next_review_due)
    VALUES (?,?,?,?,?)`).run(id, sid, period, disp, due);

// Overdue, due inside the lead window, due beyond it, never qualified, and a
// vendor with an older superseded period.
sup('s1', 'Overdue Vendor', 1, 'approved');            qual('q1', 's1', '2025', 'approved', day(-40));
sup('s2', 'Due Soon Vendor', 1, 'approved');           qual('q2', 's2', '2026', 'approved', day(10));
sup('s3', 'Not Due Vendor', 1, 'approved');            qual('q3', 's3', '2026', 'approved', day(200));
sup('s4', 'Never Qualified', 1, 'unqualified');
sup('s5', 'Two Periods', 1, 'approved');
qual('q5a', 's5', '2024', 'approved', day(-400));      qual('q5b', 's5', '2026', 'approved', day(300));
sup('s6', 'Not In Use', 0, 'unqualified');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const titles = () => db.prepare('SELECT title, due_date, priority FROM work_orders ORDER BY title').all();

const st = reviewStatus(db, { today: TODAY });
console.log(`lead window ${LEAD_DAYS} days · ${st.overdue.length} overdue · ${st.due.length} due · ${st.never_qualified.length} never qualified\n`);

console.log('── ASSERTIONS ──');
t('an overdue review is found', st.overdue.some(r => r.supplier_name === 'Overdue Vendor'));
t('a review inside the lead window is found', st.due.some(r => r.supplier_name === 'Due Soon Vendor'));
t('a review beyond the lead window is NOT yet due', ![...st.due, ...st.overdue].some(r => r.supplier_name === 'Not Due Vendor'));
t('a superseded earlier period does NOT also come due',
  ![...st.due, ...st.overdue].some(r => r.qualification_id === 'q5a'));
t('a never-qualified vendor is counted', st.never_qualified.some(r => r.supplier_name === 'Never Qualified'));
t('a vendor not in use is NOT counted as never-qualified',
  !st.never_qualified.some(r => r.supplier_name === 'Not In Use'));

const first = generateSupplierReviewTasks(db, { today: TODAY });
t('a task is raised for the overdue and the due-soon', first.created === 2, `${first.created}`);
t('the overdue one is high priority',
  titles().find(w => w.title.includes('Overdue')).priority === 'high');
t('the due-soon one is not', titles().find(w => w.title.includes('Due Soon')).priority === 'medium');
t('no task for the vendor that has never been qualified — a chase is not a review',
  !titles().some(w => w.title.includes('Never Qualified')));

// The two that would go wrong quietly.
const second = generateSupplierReviewTasks(db, { today: TODAY });
t('a second run raises NOTHING', second.created === 0, `${second.created}`);
t('and creates no duplicate rows', titles().length === 2);

// Recording this year's review stamps next year's date — which must produce a
// NEW task, not be suppressed as a duplicate of the one already raised.
db.prepare("UPDATE supplier_qualifications SET next_review_due = ? WHERE id = 'q1'").run(day(-1));
const third = generateSupplierReviewTasks(db, { today: TODAY });
t('moving the due date produces a new task, not a suppressed duplicate', third.created === 1, `${third.created}`);
t('and the old task is still there — history is not rewritten', titles().length === 3);

// The nudge: quiet when there is nothing to say, and it splits the two numbers.
const sent = [];
const nudge = await supplierReviewNudge(db, { botDm: async (id, body) => sent.push(body) });
t('the nudge reaches QA', nudge.sent === 1, `${nudge.sent}`);
t('it names the overdue reviews AND the never-qualified separately',
  /overdue/i.test(sent[0]) && /never qualified/i.test(sent[0]));
t('it says explicitly that no task is raised for the never-qualified',
  /no task is raised/i.test(sent[0]));

db.prepare("UPDATE supplier_qualifications SET next_review_due = ?").run(day(400));
db.prepare("UPDATE suppliers SET status = 'approved' WHERE status = 'unqualified'").run();
const quiet = await supplierReviewNudge(db, { botDm: async () => { throw new Error('should not send'); } });
t('with nothing outstanding the nudge stays SILENT', quiet.sent === 0 && quiet.quiet === true);

t('a comms failure never throws out of the job', await (async () => {
  db.prepare("UPDATE supplier_qualifications SET next_review_due = ? WHERE id = 'q2'").run(day(-5));
  try { const r = await supplierReviewNudge(db, { botDm: async () => { throw new Error('comms down'); } });
        return r.sent === 0; } catch { return false; }
})());

console.log(`\n${pass} passed, ${fail} failed`);
db.close(); unlinkSync(DB);
process.exit(fail ? 1 : 0);
