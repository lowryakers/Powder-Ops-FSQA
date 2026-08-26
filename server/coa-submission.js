// Asking the lab to collect samples, from records that already exist.
//
// The paper loop was: fill in CTLA's Sample Submission Form by hand, scan it,
// email the scan and ask them to pick up. Everything on that form is already in
// `coa_requests` by the time somebody reaches for a pen — sample name, lot,
// expiry, tests, and the specification the result will be graded against. So
// this composes the submission FROM the requests and the person pastes it into
// the email thread they already have open.
//
// Three rules, the same ones Danny's List composes under:
//  - PURE. Rows in, text out. No Express, no database, no writes. The thing an
//    outside lab is going to act on should be checkable without standing up a
//    server, and the caller decides what filing it means.
//  - IT FORMATS, IT DOES NOT PHRASE. Every value is the record's own value.
//    Nothing here re-words a sample name or invents a test.
//  - A GAP IS NAMED, NEVER FILLED. A request with no lot number is composed
//    with the lot line reading "NOT RECORDED" and is reported in `warnings`,
//    because a lab receiving a jar it cannot tie to a lot is the failure this
//    whole module exists to prevent. Guessing would be worse than the gap.

// The Powder Ops half of the form. This is the company's own contact block —
// the same five lines on every submission, which is why they are here rather
// than typed per request. `released_by` is the person composing, not this.
export const PLANT_CONTACT = {
  company: 'Powder Ops',
  address: '281 E 1600 N',
  city_state_zip: 'Vineyard, UT 84059',
  email: 'maria@powder-ops.com',
  phone: '801-669-3198',
  contact_name: 'Maria Servin / Adam Bliss',
};

// CTLA's own processing options, in their words and their order. Rush carries
// a fee on their form, so the label says so rather than letting somebody pick
// "Rush 1 day" believing it is free.
export const PROCESSING = [
  { value: 'normal', label: 'Normal' },
  { value: 'rush_1', label: 'Rush 1 day', fee: true },
  { value: 'rush_2_3', label: 'Rush 2–3 day', fee: true },
  { value: 'rush_3_4', label: 'Rush 3–4 day', fee: true },
  { value: 'rush_5', label: 'Rush 5 day', fee: true },
];

export const processingLabel = (v) =>
  (PROCESSING.find(p => p.value === v) || PROCESSING[0]).label;

// A date the way a person writes it to another company, from the ISO the
// records hold. Date-only values are read as local, never UTC — the
// everything-is-a-day-early trap.
function niceDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The spec a result will be graded against, in the form the Specifications tab
// already renders it. Same derivation as coa.js `specText` — a second, subtly
// different one is how the number we send a lab stops matching the number we
// grade against.
export function specText(s) {
  if (s.specification) return s.specification;
  const u = s.unit ? ` ${s.unit}` : '';
  if (s.min_value != null && s.max_value != null) return `${s.min_value} – ${s.max_value}${u}`;
  if (s.max_value != null) return `≤ ${s.max_value}${u}`;
  if (s.min_value != null) return `≥ ${s.min_value}${u}`;
  return null;
}

// "HM & Micro" is how 1,150 of the real requests are written, so the tests are
// passed through as stored. Splitting only tidies the separators.
export function testList(raw) {
  return String(raw || '')
    .split(/[,;]+/).map(t => t.trim()).filter(Boolean);
}

/**
 * One sample, as the lab will read it.
 *
 * `specs` is the ACTIVE specifications for this item, already filtered by the
 * caller. Only the ones covering a requested test are printed — sending a lab
 * the whole spec sheet for a micro-only submission is noise, and noise in a
 * document somebody is meant to act on is how the important line gets skipped.
 */
export function composeSample(req, specs = [], index = 1) {
  const warnings = [];
  const name = [req.item_number, req.item_description].filter(Boolean).join(' — ');
  const tests = testList(req.tests_requested);
  if (!tests.length) warnings.push({ id: req.id, field: 'tests_requested', message: 'No tests requested' });
  if (!req.lot_number) warnings.push({ id: req.id, field: 'lot_number', message: 'No lot number on the request' });

  const wanted = tests.map(t => t.toLowerCase());
  const relevant = (specs || []).filter(s => {
    const test = String(s.test_type || '').toLowerCase();
    return wanted.some(w => w.includes(test) || test.includes(w));
  });

  const lines = [`${index}. ${name || 'UNNAMED SAMPLE'}`];
  const lot = req.lot_number || 'NOT RECORDED';
  const exp = req.product_expiration ? `        Exp: ${niceDate(req.product_expiration)}` : '';
  lines.push(`   Lot #:  ${lot}${exp}`);
  lines.push(`   Tests:  ${tests.length ? tests.join(', ') : 'NOT RECORDED'}`);
  for (const s of relevant) {
    const t = specText(s);
    if (t) lines.push(`   Spec:   ${s.test_type} ${t}${s.method ? ` (${s.method})` : ''}`);
  }
  return { text: lines.join('\n'), warnings };
}

/**
 * The whole submission: the block that gets pasted into the email.
 *
 * Deliberately plain text with no markup. It is going into somebody else's
 * mail client and then onto a bench, and the one formatting rule that matters
 * is that it survives being pasted.
 */
export function composeSubmission({
  lab = null,
  requests = [],
  specsByItem = {},
  processing = 'normal',
  releasedBy = '',
  today = new Date(),
} = {}) {
  const rows = requests.filter(Boolean);
  const stamp = niceDate(today.toISOString().slice(0, 10));
  const warnings = [];

  const out = [];
  out.push('SAMPLE SUBMISSION — POWDER OPS');
  out.push(`Submitted ${stamp}    Processing: ${processingLabel(processing)}`);
  out.push('');
  out.push('CONTACT INFORMATION');
  out.push(`  Company:  ${PLANT_CONTACT.company}`);
  out.push(`  Address:  ${PLANT_CONTACT.address}, ${PLANT_CONTACT.city_state_zip}`);
  out.push(`  Email:    ${PLANT_CONTACT.email}`);
  out.push(`  Phone:    ${PLANT_CONTACT.phone}`);
  out.push(`  Contact:  ${PLANT_CONTACT.contact_name}`);
  out.push('');
  out.push(`SAMPLES (${rows.length})`);
  out.push('');

  rows.forEach((r, i) => {
    const { text, warnings: w } = composeSample(r, specsByItem[r.item_number] || [], i + 1);
    out.push(text);
    out.push('');
    warnings.push(...w);
  });

  out.push(`Released by: ${releasedBy || '________________________'}    Date: ${stamp}`);

  const subject = `Sample submission — ${PLANT_CONTACT.company} — ${stamp}`
    + (rows.length ? ` (${rows.length} sample${rows.length === 1 ? '' : 's'})` : '');

  return {
    subject,
    to: lab?.contact_email || null,
    lab_name: lab?.name || null,
    text: out.join('\n'),
    samples: rows.length,
    warnings,
  };
}
