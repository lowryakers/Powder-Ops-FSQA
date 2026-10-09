// READ-ONLY report (D-160): AP Drop rows still Outstanding although the
// partner ledger holds them as a RECEIVABLE, and near-duplicate pairs by the
// D-160 rule (same partner or vendor, same reference, within $1, inside 24h,
// different bytes) over all time. It writes NOTHING — the database is opened
// read-only — and the office closes the rows by hand in AP Drop.
//
//   npm run report:apdrop-ar               (DB_PATH, else ./data/powder-ops.db)
//   node scripts/report-ap-drop-stuck-receivables.mjs /path/to/copy.db
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
// Pure (no database, no Express) — the same partner detector the server uses.
import { detectPartner } from '../server/ap-drop-route.js';

const path = process.argv[2] || process.env.DB_PATH || './data/compliance.db';
if (!existsSync(path)) { console.error(`No database at ${path}`); process.exit(2); }
const db = new Database(path, { readonly: true, fileMustExist: true });

// Kept in step with server/api/ap-drop.js by hand; a script must not import a
// router (it would open the app's database for writing).
const TERMINAL = ['paid', 'closed', 'not_finance', 'to_partner_ar', 'receivable_other'];
const normRef = (v) => String(v || '').trim().replace(/^(?:po|co)\s+/i, '').toLowerCase().replace(/\s+/g, '');
const id8 = (id) => String(id || '').slice(0, 8);
const money = (n) => (n == null ? '' : Number(n).toFixed(2));
const table = (rows, cols) => {
  if (!rows.length) { console.log('  (none)'); return; }
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const line = (vals) => '  ' + vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
  console.log(line(cols)); console.log(line(w.map(n => '-'.repeat(n))));
  for (const r of rows) console.log(line(cols.map(c => r[c])));
};

const stuck = db.prepare(`SELECT a.id, a.created_at, a.submitter, a.amount, a.po_or_co_ref, a.status, d.doc_number, d.id AS doc_id
    FROM ap_drops a JOIN partner_documents d ON d.id = a.partner_document_id
   WHERE d.direction = 'receivable' AND a.status NOT IN (${TERMINAL.map(() => '?').join(',')})
   ORDER BY a.created_at`).all(...TERMINAL);
console.log(`\nOutstanding drops that are RECEIVABLES on the partner ledger: ${stuck.length}`);
table(stuck.map(r => ({ id8: id8(r.id), created: r.created_at, submitter: r.submitter, amount: money(r.amount), ref: r.po_or_co_ref || '', 'ledger doc #': r.doc_number || id8(r.doc_id), status: r.status })),
  ['id8', 'created', 'submitter', 'amount', 'ref', 'ledger doc #', 'status']);

// The partner a drop was routed to, or — for one never routed, like the second
// of a near-duplicate pair — the one the detector reads off it with high
// confidence. Same rule as findNearDuplicate in server/api/ap-drop.js.
const partners = (() => { try { return db.prepare('SELECT id, name, code, terms_days FROM partner_accounts WHERE is_active = 1').all(); } catch { return []; } })();
const partnerOf = (r) => {
  try { const p = JSON.parse(r.partner_route || 'null')?.partner?.id; if (p) return p; } catch { /* fall through */ }
  const det = detectPartner({ partners, fields: { vendor_name: r.vendor_name, bill_to: r.bill_to, po_or_co_ref: r.po_or_co_ref, notes: r.notes, filename: r.filename }, text: r.extracted_text || '' });
  return det.confidence === 'high' ? det.partner?.id || null : null;
};
const all = db.prepare(`SELECT id, created_at, submitter, amount, po_or_co_ref, vendor_name, bill_to, notes, filename, extracted_text, content_sha256, partner_route, status, partner_document_id
    FROM ap_drops WHERE amount IS NOT NULL AND po_or_co_ref IS NOT NULL AND po_or_co_ref != '' ORDER BY created_at, rowid`).all();
const ms = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');
const pairs = [];
for (let i = 0; i < all.length; i++) {
  for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (ms(b.created_at) - ms(a.created_at) > 24 * 3600e3) break;
    if (a.content_sha256 === b.content_sha256 || normRef(a.po_or_co_ref) !== normRef(b.po_or_co_ref)) continue;
    if (Math.abs(a.amount - b.amount) > 1.0001) continue;
    const sameVendor = a.vendor_name && String(a.vendor_name).trim().toLowerCase() === String(b.vendor_name || '').trim().toLowerCase();
    const samePartner = partnerOf(a) && partnerOf(a) === partnerOf(b);
    if (!sameVendor && !samePartner) continue;
    pairs.push({ a, b, mins: Math.round((ms(b.created_at) - ms(a.created_at)) / 60000) });
  }
}
const ledgerNo = (id) => (id ? db.prepare('SELECT doc_number FROM partner_documents WHERE id = ?').get(id)?.doc_number || id8(id) : '');
console.log(`\nNear-duplicate pairs (same party, same ref, ≤ $1, ≤ 24h, different file): ${pairs.length}`);
table(pairs.flatMap(({ a, b, mins }) => [a, b].map((r, k) => ({
  pair: k === 0 ? `#${pairs.findIndex(p => p.a === a && p.b === b) + 1}` : `  (+${mins} min)`,
  id8: id8(r.id), created: r.created_at, submitter: r.submitter, amount: money(r.amount), ref: r.po_or_co_ref,
  'ledger doc #': ledgerNo(r.partner_document_id), status: r.status,
}))), ['pair', 'id8', 'created', 'submitter', 'amount', 'ref', 'ledger doc #', 'status']);
console.log('\nNothing was changed. Close these by hand in AP Drop.');
db.close();
