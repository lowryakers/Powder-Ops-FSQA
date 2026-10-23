#!/usr/bin/env node
// report:partner-dupes — READ-ONLY. Answers "why did the 12 Oct import let in
// copies of documents already settled" from a copy of the database (D-203).
//
//   npm run report:partner-dupes -- path/to/readydoc.db
//
// Opens the file read-only and writes nothing. For every OPEN document whose
// number (folded the way `normDocNumber` folds it) and direction match a SETTLED
// one, it prints both rows side by side — the number exactly as stored, the
// amount, the source — and the audit entry that created the copy, including
// whether it came through a bot token. The difference between the two stored
// numbers or amounts is the reason the old exact-string check let it through.
import Database from 'better-sqlite3';
import { normDocNumber } from '../server/partner-recon.js';

const file = process.argv[2];
if (!file) { console.error('Usage: npm run report:partner-dupes -- <database file>'); process.exit(2); }
const db = new Database(file, { readonly: true, fileMustExist: true });

const rows = db.prepare(`SELECT d.id, d.partner_id, d.doc_number, d.amount, d.direction, d.status, d.source,
    d.created_at, d.created_by, d.settlement_id, s.period_end
  FROM partner_documents d LEFT JOIN partner_settlements s ON s.id = d.settlement_id
  WHERE d.status != 'void' AND d.doc_number IS NOT NULL`).all();
const settled = new Map();
for (const r of rows) if (r.settlement_id) settled.set(`${r.partner_id}|${r.direction}|${normDocNumber(r.doc_number)}`, r);
const copies = rows.filter(r => !r.settlement_id && settled.has(`${r.partner_id}|${r.direction}|${normDocNumber(r.doc_number)}`));

const audit = db.prepare(`SELECT timestamp, actor, details FROM audit_log
  WHERE entity_type = 'partner_document' AND entity_id = ? ORDER BY rowid LIMIT 5`);
const q = (s) => JSON.stringify(s);
if (!copies.length) console.log('No open document carries a settled document\'s number. Nothing to report.');
for (const c of copies) {
  const t = settled.get(`${c.partner_id}|${c.direction}|${normDocNumber(c.doc_number)}`);
  console.log(`\nOPEN  ${q(c.doc_number)} ${c.amount} ${c.status} source=${c.source} created ${c.created_at} by ${c.created_by} (${c.id})`);
  console.log(`PAID  ${q(t.doc_number)} ${t.amount} settled ${t.period_end} (${t.id})`);
  const why = [];
  if (c.doc_number !== t.doc_number) why.push(`the number is stored differently (${q(c.doc_number)} vs ${q(t.doc_number)})`);
  if (Math.abs(Number(c.amount) - Number(t.amount)) >= 0.005) why.push(`the amount differs (${c.amount} vs ${t.amount})`);
  for (const a of audit.all(c.id)) {
    let d = {}; try { d = JSON.parse(a.details || '{}'); } catch { /* not JSON */ }
    console.log(`  audit ${a.timestamp} ${a.actor} ${a.details}`);
    if (d.via_token) why.push('it was created through a bot token');
    if (d.allow_duplicate) why.push('allow_duplicate was set');
  }
  console.log(`  why the old check missed it: ${why.length ? why.join('; ') : 'number and amount match exactly — look at the audit rows above'}`);
}
