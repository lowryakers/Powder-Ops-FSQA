#!/usr/bin/env node
// The import pipeline, end to end, against BOTH real sources and a real
// database — plan, apply, re-apply.
//
// The assertions that matter are the ones about what the import REFUSES to do:
// nothing arrives approved, no date is invented, and a disagreement between the
// tracker and the archive is carried onto the record rather than resolved by
// whichever source happened to be read second.

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { planSupplierImport, applySupplierImport, splitContacts, suggestVendorType } from '../server/supplier-import.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures', p), 'utf8'));
const tracker = read('supplier-tracker.json');
const listing = read('supplier-archive-full.json');

const plan = planSupplierImport({
  trackerRows: tracker.rows,
  archiveEntries: listing.entries,
  today: '2026-08-27',
});

console.log('── PLAN ──');
for (const [k, v] of Object.entries(plan.counts)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`  ${String(plan.unexpanded_containers).padStart(4)}  nested zips NOT expanded by a filesystem listing`);
console.log(`  ${String(plan.unreadable.length).padStart(4)}  paths reported unreadable`);

// A real database with only the tables under test.
const DB = '/tmp/supplier-import-check.db';
if (existsSync(DB)) unlinkSync(DB);
const db = new Database(DB);
db.exec(readFileSync(join(ROOT, 'scripts/fixtures/supplier-schema.sql'), 'utf8'));

let seq = 0;
const audits = [];
const opts = { actor: 'check', newId: () => `id_${++seq}`, logAudit: (...a) => audits.push(a) };
const first = applySupplierImport(db, plan, opts);
console.log('\n── FIRST APPLY ──');
for (const [k, v] of Object.entries(first)) console.log(`  ${String(v).padStart(4)}  ${k}`);
const second = applySupplierImport(db, plan, opts);
console.log('\n── RE-APPLY (idempotence) ──');
for (const [k, v] of Object.entries(second)) console.log(`  ${String(v).padStart(4)}  ${k}`);

const q = (sql, ...a) => db.prepare(sql).get(...a);
let pass = 0, fail = 0;
const t = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); } };
console.log('\n── ASSERTIONS ──');

// RULE 1 — nothing arrives approved.
t('NOTHING is imported as approved, whatever the tracker says',
  q("SELECT COUNT(*) n FROM suppliers WHERE status != 'unqualified'").n === 0);
t('no qualification arrives with a disposition',
  q('SELECT COUNT(*) n FROM supplier_qualifications WHERE disposition IS NOT NULL').n === 0);
t('the 19 tracker ticks did NOT become 19 approvals', plan.counts.approved === 0);

// RULE 2 — nothing invented.
t('no questionnaire date is invented',
  q('SELECT COUNT(*) n FROM supplier_qualifications WHERE questionnaire_received_at IS NOT NULL').n === 0);
t('a file with no expiry in its name stores none',
  q("SELECT COUNT(*) n FROM supplier_files WHERE expires_on IS NOT NULL").n
  === plan.suppliers.reduce((n, s) => n + s.files.filter(f => f.expires_on).length, 0));

// RULE 3 — disagreements carried.
t('vendors in disagreement are flagged on the plan', plan.counts.needing_attention >= 40, `${plan.counts.needing_attention}`);
const millHaven = plan.suppliers.find(s => /^Mill Haven/i.test(s.name));
t('Mill Haven is imported and still has no questionnaire either side',
  millHaven && !millHaven.tracker_questionnaire && !millHaven.folder_questionnaire);
const m4 = plan.suppliers.find(s => /^M4 Dynamic/i.test(s.name));
t('M4 Dynamic is imported from the tracker with no folder, and flagged',
  m4 && !m4.has_folder && m4.issues.includes('active_with_no_folder'));

// RULE 4 — idempotent.
t('a re-import creates no second supplier', second.suppliers_created === 0, `${second.suppliers_created}`);
t('a re-import updates every supplier instead', second.suppliers_updated === first.suppliers_created);
t('a re-import creates no duplicate contacts', second.contacts === 0, `${second.contacts}`);
t('a re-import creates no duplicate qualifications', second.qualifications === 0, `${second.qualifications}`);
t('file rows are unchanged in number after a re-import',
  q('SELECT COUNT(*) n FROM supplier_files').n === first.files, `${q('SELECT COUNT(*) n FROM supplier_files').n} vs ${first.files}`);

// The plan IS what gets written — no re-derivation.
t('every planned supplier exists', q('SELECT COUNT(*) n FROM suppliers').n === plan.counts.suppliers);
t('every planned qualification exists', q('SELECT COUNT(*) n FROM supplier_qualifications').n === plan.counts.qualifications);
t('every planned contact exists', q('SELECT COUNT(*) n FROM supplier_contacts').n === plan.counts.contacts);
t('every file is linked to its supplier',
  q('SELECT COUNT(*) n FROM supplier_files f LEFT JOIN suppliers s ON s.id = f.supplier_id WHERE s.id IS NULL').n === 0);
t('a file with a period is linked to that period\'s qualification',
  q(`SELECT COUNT(*) n FROM supplier_files WHERE period_label IS NOT NULL AND qualification_id IS NULL`).n === 0);

// Contacts split, roles NOT guessed.
t('179 jammed addresses split into rows', q('SELECT COUNT(*) n FROM supplier_contacts').n > 150);
t('NO contact role is guessed at import',
  q('SELECT COUNT(*) n FROM supplier_contacts WHERE role IS NOT NULL').n === 0);
t('a trailing comma does not create an empty contact', splitContacts('a@b.com, ').length === 1);
t('a non-address is kept as a name rather than dropped',
  splitContacts('Jane Doe, j@x.com').filter(c => c.name === 'Jane Doe').length === 1);
t('a plainly-packaging vendor is suggested, others are not',
  suggestVendorType('Boxt Packaging') === 'packaging' && suggestVendorType('Sabinsa') === null);

// The honest gaps.
t('unexpanded nested zips are reported, not silently ignored', plan.unexpanded_containers > 0);
t('unreadable paths are reported', plan.unreadable.length > 0);

// Audited per record plus a summary.
t('each supplier is audited individually', audits.filter(a => a[1] === 'supplier_imported').length === plan.counts.suppliers * 2);
t('the batch is audited too', audits.some(a => a[1] === 'supplier_import_completed'));

console.log(`\n${pass} passed, ${fail} failed`);
db.close(); unlinkSync(DB);
process.exit(fail ? 1 : 0);
