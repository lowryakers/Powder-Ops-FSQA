// One-time repair for the partner-ledger line summaries.
//
// The first line-item parser read the address block as merchandise: the city
// line "Vineyard, UT 84059" is "text then a number", so the ZIP code filed as
// an $84,059.00 line — twice per invoice, once for each address — and every
// document's summary claimed the same $168,118.00 of lines that were never on
// it. On the one screen two companies are supposed to trust, that is the worst
// possible cosmetic bug. The parser is fixed; this re-reads every stored
// document's text through it.
//
// Safe to replace wholesale because there is NO hand-editor for line items —
// every stored summary was machine-read from the same extracted_text this
// re-reads (or arrived via the import review, which passes the machine's
// proposal through untouched). Amounts, directions, dates and statuses are
// NEVER touched: those were reviewed by a person.
//
// It also fills `parsed_amount` / `parsed_amount_label` — what the file itself
// prints as its total — so the UI can flag a row whose amount disagrees with
// the document behind it instead of leaving the partner to find it.
//
// Runs once (app_settings flag, written AFTER the work succeeds — a run that
// throws retries on the next boot instead of marking a repair done that never
// happened).

import { parseInvoice } from './invoice-parse.js';

const FLAG = 'partner_lines_backfill_v1';
const OUR_NAMES = ['Powder Ops', 'PowderOps', 'Powder-Ops'];

export function backfillPartnerDocLines(db) {
  try {
    if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(FLAG)) return 0;

    const partners = new Map(
      db.prepare('SELECT id, name FROM partner_accounts').all().map(p => [p.id, p.name]));
    const rows = db.prepare(`SELECT id, partner_id, doc_number, extracted_text
      FROM partner_documents WHERE extracted_text IS NOT NULL AND extracted_text != ''`).all();

    const upd = db.prepare(`UPDATE partner_documents
      SET line_items = ?, lines_total = ?, parsed_amount = ?, parsed_amount_label = ?
      WHERE id = ?`);

    let reread = 0;
    for (const r of rows) {
      let parsed;
      try {
        parsed = parseInvoice(r.extracted_text, {
          usNames: OUR_NAMES,
          partnerNames: [partners.get(r.partner_id) || ''].filter(Boolean),
        });
      } catch { continue; }
      const lines = (parsed.line_items || []).slice(0, 100);
      upd.run(lines.length ? JSON.stringify(lines) : null,
        parsed.lines_total ?? null, parsed.amount ?? null, parsed.amount_label || null, r.id);
      reread++;
    }

    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(FLAG, new Date().toISOString());
    if (rows.length) console.log(`[backfill] partner document lines: re-read ${reread} of ${rows.length} document(s)`);
    return reread;
  } catch (e) {
    console.warn('[backfill] partner document lines failed (will retry next boot):', e.message);
    return 0;
  }
}
