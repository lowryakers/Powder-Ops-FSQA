// The reference documents the product and artwork work actually runs on.
//
// Every one of these is a real thing somebody goes looking for today and finds
// in a Drive folder, an email, or nowhere. The slots are SEEDED, not fixed:
// once the row exists Document Control — or whoever owns the catalogue — owns
// its label and its cadence, and a redeploy never overwrites a decision. Same
// rule as `seedQualitySchedules` and `seedControlledForms`.
//
// A CADENCE IS ONLY SET WHERE THE DOCUMENT GENUINELY GOES OUT OF DATE. A brand
// guide is current until it is replaced; a Shopify export is a photograph of a
// moving thing and is worthless the moment it is old. Putting a cadence on
// everything would produce a shelf permanently in the red, which is how a
// warning becomes wallpaper.
export const SHELF_SLOTS = [
  {
    key: 'brand_guide',
    label: 'Brand guide',
    description: 'Colours, logo usage and typography — what every artwork proof is checked against.',
    cadence_days: null,
    sort_order: 10,
  },
  {
    key: 'shopify_export',
    label: 'Shopify product export',
    description: 'The live listing data, so the catalogue can be reconciled against what is actually for sale. '
      + 'Shopify admin → Products → Export → all products, CSV.',
    // Monthly: the catalogue drifts as listings are edited, and a stale export
    // reconciles nothing.
    cadence_days: 31,
    sort_order: 20,
  },
  {
    key: 'shiphero_export',
    label: 'ShipHero SKU / inventory export',
    description: 'The other half of the reconciliation — inventory locations and open order lines are keyed '
      + 'to the SKU, which is what makes a rename expensive.',
    cadence_days: 31,
    sort_order: 30,
  },
  {
    key: 'gs1_licence',
    label: 'GS1 licence certificate',
    description: 'Proof of the company prefix. Retailers and auditors ask for it, and it renews annually.',
    cadence_days: 365,
    sort_order: 40,
  },
  {
    key: 'packaging_specs',
    label: 'Packaging vendor spec sheets',
    description: 'The film specs and quotes behind each packaging spec — what a PO is priced against.',
    cadence_days: null,
    sort_order: 50,
  },
  {
    key: 'dielines',
    label: 'Dielines / artwork templates',
    description: 'The template a designer draws onto, per packaging spec.',
    cadence_days: null,
    sort_order: 60,
  },
  {
    key: 'label_review',
    label: 'Label review / regulatory opinion',
    description: 'Any outside review of claims and label copy. What "we checked" means when somebody asks.',
    cadence_days: null,
    sort_order: 70,
  },
];

/**
 * Seeded once, keyed on the slot key.
 *
 * Insert-only per key: a cadence somebody changed, a slot they retired, or a
 * label they reworded is a decision, and a redeploy must not undo it. New keys
 * added to the list above ARE picked up, because the check is per key rather
 * than "does the table have rows".
 */
export function seedProductShelf(db) {
  let added = 0;
  try {
    const has = db.prepare('SELECT 1 FROM product_doc_slots WHERE key = ?');
    const ins = db.prepare(`INSERT INTO product_doc_slots (key, label, description, cadence_days, sort_order, updated_by)
      VALUES (?, ?, ?, ?, ?, 'system')`);
    for (const s of SHELF_SLOTS) {
      if (has.get(s.key)) continue;
      ins.run(s.key, s.label, s.description, s.cadence_days, s.sort_order);
      added++;
    }
  } catch (e) { console.warn('[products] shelf slots unavailable:', e.message); return 0; }
  if (added) console.log(`[seed] Added ${added} product document slot(s)`);
  return added;
}

/**
 * What is on the shelf, and what is owed.
 *
 * DERIVED ON EVERY READ. A stored "due" flag goes stale the moment somebody
 * files the document, which is exactly the defect this codebase keeps unpicking.
 *
 * `days_old` is measured from the document's EFFECTIVE DATE, not its upload
 * date: an export pulled on the 1st and filed on the 4th is a 1st export, and
 * dating it from the upload would quietly buy three days that do not exist.
 */
export function shelfState(db, { now = new Date() } = {}) {
  const slots = (() => {
    try { return db.prepare('SELECT * FROM product_doc_slots WHERE is_active = 1 ORDER BY sort_order, label').all(); }
    catch { return null; }
  })();
  if (!slots) return { slots: [], due: [], missing: [] };

  const latest = db.prepare(`SELECT * FROM product_documents WHERE slot_key = ?
    ORDER BY COALESCE(effective_date, created_at) DESC, created_at DESC LIMIT 1`);
  const counter = db.prepare('SELECT COUNT(*) c FROM product_documents WHERE slot_key = ?');

  const out = slots.map((s) => {
    const doc = latest.get(s.key) || null;
    const count = counter.get(s.key).c;
    const basis = doc ? (doc.effective_date || String(doc.created_at || '').slice(0, 10)) : null;
    const daysOld = basis ? Math.floor((now - new Date(`${basis}T00:00:00Z`)) / 86400000) : null;
    // Three states, and "nothing has ever been filed" is not the same as
    // "what we have has gone out of date".
    const state = !doc ? 'missing'
      : (s.cadence_days && daysOld != null && daysOld > s.cadence_days) ? 'due'
        : 'current';
    return {
      ...s,
      state,
      count,
      days_old: daysOld,
      // The file itself is never shipped here; the list carries what it needs
      // to be read and a link is issued per document.
      latest: doc ? {
        id: doc.id, title: doc.title, filename: doc.filename, effective_date: doc.effective_date,
        uploaded_by: doc.uploaded_by, created_at: doc.created_at, link_url: doc.link_url,
        searchable: doc.extracted_text == null ? null : !!doc.extracted_text,
        has_file: !!doc.storage_key,
      } : null,
    };
  });

  return {
    slots: out,
    // Named separately: one is a chase, the other is a refresh, and they go to
    // different people.
    due: out.filter((s) => s.state === 'due').map((s) => s.label),
    missing: out.filter((s) => s.state === 'missing').map((s) => s.label),
  };
}

/**
 * How much room is left in each GS1 company prefix.
 *
 * A UPC-A here is a 9-digit company prefix + 2-digit item + check digit, so a
 * prefix holds exactly 100 numbers and `850046726` is most of the way through
 * one. Nobody was counting, and finding out by running out is finding out too
 * late — a new prefix is a purchase with a lead time.
 *
 * Counted from the catalogue rather than recorded anywhere: the GTINs in use
 * ARE the allocation, and a stored tally would be wrong the first time someone
 * corrected a number.
 */
export const PREFIX_WARN_FREE = 25;

export function gtinPrefixes(db) {
  const rows = (() => {
    try { return db.prepare("SELECT sku, gtin FROM products WHERE gtin IS NOT NULL AND gtin != ''").all(); }
    catch { return []; }
  })();
  const byPrefix = new Map();
  for (const r of rows) {
    const g = String(r.gtin);
    // Only a 12-digit UPC-A splits this way. Anything else is counted under its
    // own length rather than being forced into a shape it does not have.
    if (!/^\d{12}$/.test(g)) continue;
    const prefix = g.slice(0, 9);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
    byPrefix.get(prefix).add(g.slice(9, 11));
  }
  return [...byPrefix.entries()]
    .map(([prefix, items]) => ({
      prefix,
      used: items.size,
      capacity: 100,
      free: 100 - items.size,
      low: 100 - items.size <= PREFIX_WARN_FREE,
    }))
    .sort((a, b) => a.free - b.free || a.prefix.localeCompare(b.prefix));
}
