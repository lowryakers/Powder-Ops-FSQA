// Reading the supplier archive — the folders Quality already keeps, per vendor.
//
// PURE. Paths and filenames in, records out. No Express, no database, no zip
// library: the caller hands it entry names and it says what they are. Same
// doctrine as partner-recon.js and coa-submission.js — the thing a supplier
// qualification will be built on should be checkable without standing up a
// server, and the caller decides what filing it means.
//
// THE STRUCTURE IS THE PLANT'S, NOT A CONVENTION WE IMPOSED. Read from the real
// AIFI and Mill Haven folders, 27 Aug 2026:
//
//   AIFI/2025/RM VQ-filled-PTC.pdf                 ← loose file, kind is in the NAME
//   AIFI/2025/Potassium Citrate.zip                ← a MATERIAL bundle, kind is inside
//   AIFI/2025/Customer Documents.zip               ← a VENDOR bundle
//   Mill Haven/2025/                               ← an empty year, which is itself a fact
//
// So there is no `kind` folder level. The third path segment is either a
// document or a container named after what it is about, and the classification
// comes from the filename either way.
//
// THREE SUBJECTS, NOT TWO, and this is the finding that matters most. The
// documents are about the VENDOR (AIFI's W9, FDA registration, FSVP statement),
// the MATERIAL (Potassium Citrate specification, SDS, allergen matrix), and the
// MANUFACTURER BEHIND THE MATERIAL (Daffodil Pharmachem's BRC certificate,
// Prayon's HACCP statement, Dainty Foods' SQF audit). AIFI is a distributor.
// SOP 404 § III.A anticipates exactly this — "This may be a broker or agent, or
// the actual manufacturer" — and the quality-system evidence that qualification
// turns on belongs to the manufacturer, not to the vendor we buy from.

// The plant writes an expiry six different ways, all of them in the filename:
//   "exp 7-11-2027"  "Exp. 12.31.2025"  "EXP 01.26.26"  "exp 12-31-25"
//   "Exp 18 Apr 2025"  "Exp 12.2024" (month and year only)
// Read from the real archive rather than assumed — a parser that handles one
// house style finds a fraction of the certificates and reports the rest as
// having no expiry, which is indistinguishable from a certificate that never
// had one.
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
const EXP_NUMERIC = /\bexp\.?(?:ir(?:es|y|ation))?\.?\s*:?\s*\(?\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/i;
const EXP_WORDY   = /\bexp\.?(?:ir(?:es|y|ation))?\.?\s*:?\s*\(?\s*(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/i;
const EXP_MONTHYR = /\bexp\.?(?:ir(?:es|y|ation))?\.?\s*:?\s*\(?\s*(\d{1,2})[-/.](\d{4})\b/i;

const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const v = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(v)) ? null : v;
};

/**
 * The expiry a filename states, or null.
 *
 * READ, NEVER GUESSED. A certificate whose filename carries no date gets no
 * expiry — an invented one would put a supplier's approval on a clock nobody
 * chose, and a lapsed certificate reading as current is worse than one with no
 * date at all.
 *
 * A month-and-year expiry is taken as the LAST day of that month, the same rule
 * retention-log.js uses for a box due "02/2028": a certificate marked
 * "Exp 12.2024" has not lapsed on the 1st.
 */
export function expiryFromFilename(name) {
  const n = String(name || '');
  let m = EXP_WORDY.exec(n);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? iso(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = EXP_NUMERIC.exec(n);
  if (m) return iso(Number(m[3]), Number(m[1]), Number(m[2]));
  m = EXP_MONTHYR.exec(n);
  if (m) {
    const mo = Number(m[1]), yr = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return iso(yr, mo, new Date(Date.UTC(yr, mo, 0)).getUTCDate());
  }
  return null;
}

// Classification is by WHOLE WORDS against the filename, most specific first.
// The lesson from suggestCourse in training-log.js: substring matching quietly
// scores "SSOP" against "SOP" and files 256 people under the wrong course.
const KINDS = [
  // The questionnaires are the point of the whole exercise, so they come first
  // and they are split — see `blank` below.
  { kind: 'questionnaire',        re: /\b(vendor|supplier)\s*(qualification)?\s*(questionnaire|vq)\b/i },
  { kind: 'raw_material_questionnaire', re: /\b(raw\s*material|rm)\b.*\b(questionnaire|vq)\b|\brm\s*vq\b/i },
  { kind: 'audit_report',         re: /\baudit\s*report\b/i },
  // A CERTIFICATE IS OFTEN NAMED BY ITS TOPIC AND NEVER SAYS "certificate".
  // "Kosher Exp. 12.31.2025.pdf", "IM Non-GMO (Exp 8.20.25).pdf", "BRCGS EN
  // (Exp 7.2.2025).pdf" — 52 of the archive's files. Requiring the word
  // reported every one of them as unreadable.
  { kind: 'certificate',          re: /\b(kosher|halal|organic|non.?gmo|gluten.?free|brcgs|brc|sqf|fssc|iso\s*\d{4,5}|gmp|nsf|utz|rainforest|fair.?trade|bioterrorism)\b/i },
  { kind: 'audit_certificate',    re: /\b(brc|sqf|fssc|gfsi|iso\s*22000)\b.*\bcertificate\b|\baudit\s*certificate\b/i },
  { kind: 'certificate',          re: /\b(certificate|certification)\b/i },
  { kind: 'registration',         re: /\b(fda\s*registration|registration)\b/i },
  // A vendor's OWN quality system, sent wholesale. Bio-Cat supplied 32 files of
  // it, Monk Fruit 31, GSO 29 — SOPs, quality manuals, org charts, master
  // lists. These are the supplier's controlled documents, not ours and not
  // per-material evidence, and they need their own kind or they drown the rest.
  { kind: 'vendor_qms_document',  re: /\b(sop|qm|wi|qa|qc|pd|gen|doc)[.\s_-]?\d{2,4}\b|\b(quality|regulatory|food\s*safety)\s*(and\s*\w+\s*)?(manual|system|policy|program)\b|\bmaster\s*list\b|\borgani[sz]ation(al)?\s*chart\b|\bprocedure\b|\bversion\s*\d+\b|\bmanual\b/i },
  { kind: 'specification',        re: /\bspecificationn?\b|\bspec\s*sheet\b|\bspec\b|\btech(nical)?\s*data\s*sheet\b|\b(pds|tds)\b|\bproduct\s*(info|data|sheet)\b/i },
  { kind: 'sds',                  re: /\bsds\b|\bsafety\s*data\s*sheet\b|\bmsds\b/i },
  { kind: 'haccp',                re: /\bhaccp\b|\bccps?\b|\bflow\s*(chart|diagram)\b|\bprocess\s*flow\b/i },
  { kind: 'nutritional',          re: /\bnutritional?\b|\bnutrition\s*facts\b/i },
  { kind: 'allergen',             re: /\ballergen\b/i },
  { kind: 'label',                re: /\blabel\b/i },
  { kind: 'coa',                  re: /\bcoa\b|\bcertificate\s*of\s*analysis\b|\bc\s*of\s*a\b|\btest\s*report\b|\banalysis\s*(report|result)/i },
  // The long tail. AIFI alone files gluten, GMO, vegan, organic, Prop 65,
  // sewage sludge, food fraud, lot code, country of origin, shelf life,
  // traceability and recall statements — 30+ of the 51 documents.
  // `statm?ent` is deliberate: the plant's own file is "Prayon Gluten
  // Statment.pdf". A classifier that refuses a typo is one that reports a real
  // gluten statement as unreadable, which is worse than tolerating the spelling.
  { kind: 'statement',            re: /\bstat[e]?m[e]?nt\b|\bprop\s*65\b|\bcountry\s*of\s*origin\b|\bcomposition\b|\bmatrix\b|\bassurance\b|\bexplanation\b|\bsop\b|\bw-?9\b|\borganizational\s*chart\b|\bcontact\s*list\b/i },
  // A contaminants declaration often names the contaminants instead of calling
  // itself a statement — "Phosphate Product Impurities Melamine, Sludge,
  // Pesticides.pdf" is one of AIFI's.
  { kind: 'statement',            re: /\bimpurit(y|ies)\b|\bmelamine\b|\bpesticides?\b|\bheavy\s*metals?\b|\baflatoxins?\b|\bsewage\s*sludge\b/i },
];

// A blank form is not evidence that anybody filled one in. "Raw Material
// Questionnaire Form.pdf" (the blank) and "RM VQ-filled-PTC.pdf" (the returned
// one) sit in the same folder, and filing the first as a completed
// questionnaire is exactly how 24 unqualified vendors would read as qualified.
const FILLED = /\b(filled|completed|signed|returned|executed)\b/i;
const BLANK  = /\b(blank|form|template)\b/i;

/**
 * What one file is, judged from its name alone.
 *
 * An unrecognised name returns kind `unknown` WITH the filename, never a guess.
 * The importer reports those and skips them; a document filed under the wrong
 * kind is worse than one a person has to look at.
 */
export function classifyDocument(filename) {
  const base = String(filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
  if (!base) return { kind: 'unknown', reason: 'no filename' };
  const hit = KINDS.find(k => k.re.test(base));
  const expires_on = expiryFromFilename(base);
  if (!hit) return { kind: 'unknown', reason: 'filename matches no known document type', expires_on };

  let kind = hit.kind;
  let filled = null;
  if (kind === 'questionnaire' || kind === 'raw_material_questionnaire') {
    // Explicitly filled wins; an unqualified "Form" is the blank.
    filled = FILLED.test(base) ? true : (BLANK.test(base) ? false : null);
    if (filled === false) kind += '_blank';
  }
  return { kind, expires_on, filled };
}

/**
 * Split one archive path into the facts it carries.
 *
 * `AIFI/2025/Potassium Citrate.zip/Potassium Citrate SDS.pdf`
 *   → vendor 'AIFI', period '2025', container 'Potassium Citrate', file 'Potassium Citrate SDS.pdf'
 *
 * The period must look like a year. Anything else is reported rather than
 * assumed to be one — the folders are the plant's and a stray directory must
 * not silently become a qualification period.
 */
export function parseArchivePath(path) {
  const parts = String(path || '').split('/').filter(p => p && p !== '.');
  if (!parts.length) return { ok: false, reason: 'empty path', path };
  if (parts.length === 1) {
    // A file sitting at the top of the archive belongs to no vendor. Three of
    // the plant's are copies of the supplier spreadsheet itself.
    return { ok: false, reason: 'not filed under a vendor folder', path };
  }
  const [vendor, second, ...rest] = parts;

  // THE PERIOD IS OPTIONAL, and this was wrong in the first cut. 228 of the
  // plant's 836 files are `Vendor/file.pdf` with no year at all — 31 of 66
  // vendor folders have never used one. Refusing those threw away a quarter of
  // the archive as unreadable when the real fact is simply "undated".
  const hasPeriod = /^(19|20)\d{2}$/.test(second);
  const period = hasPeriod ? second : null;
  const tail = hasPeriod ? rest : [second, ...rest];
  if (!tail.length) return { ok: true, vendor, period, container: null, filename: null, empty: true, path };

  const zipAt = tail.findIndex(p => /\.zip$/i.test(p));
  const container = zipAt >= 0 ? tail[zipAt].replace(/\.zip$/i, '') : null;
  const filename = tail[tail.length - 1];
  if (zipAt >= 0 && zipAt === tail.length - 1) {
    return { ok: true, vendor, period, container, filename: null, isContainer: true, path };
  }
  return { ok: true, vendor, period, container, filename, path };
}

// What a container is NAMED AFTER cannot be assumed, and the full archive is
// why. Across 41 nested zips the plant names them after a material (`Potassium
// Citrate.zip`), a manufacturer (`DAFFODILPC.zip`, `KINGDOMWAY (2).zip` — GWI
// alone has nine), an item number (`23000002 Documents.zip`), a questionnaire
// (`resupplierqualificationquestionnaire.zip`), or nothing in particular
// (`Facility Documents.zip`, `OneDrive_1_5-19-2025.zip`).
//
// So the container is a LABEL, and what it labels is a suggestion for a person
// to confirm — never a fact. Treating every container as a material would have
// invented nine materials for GWI that are actually its sub-manufacturers.
const GENERIC_CONTAINER = /^(customer|vendor|supplier|company|corporate|general|facility|statements?|documents?|onedrive|powder\s*ops|powderops)\b|documents?$/i;
const QUESTIONNAIRE_CONTAINER = /questionnaire/i;
const ITEM_NUMBER = /^\d{5,}\b/;

export function subjectOf(parsed) {
  if (!parsed?.ok) return null;
  if (!parsed.container) return { scope: 'vendor', label: null, suggestion: null };
  const c = parsed.container;
  if (QUESTIONNAIRE_CONTAINER.test(c)) return { scope: 'container', label: c, suggestion: 'questionnaire' };
  if (GENERIC_CONTAINER.test(c)) return { scope: 'vendor', label: c, suggestion: 'generic' };
  if (ITEM_NUMBER.test(c)) return { scope: 'container', label: c, suggestion: 'item_number' };
  // A single all-caps or single-word token reads as a company; words with
  // spaces read as a material. Both are SUGGESTIONS and neither is stored
  // without a person confirming it.
  const looksLikeCompany = !/\s/.test(c.replace(/\s*\(\d+\)$/, '')) && c.length > 3;
  return { scope: 'container', label: c, suggestion: looksLikeCompany ? 'manufacturer' : 'material' };
}

/**
 * Read a whole archive listing into records, plus everything it could not read.
 *
 * WRITES NOTHING and decides nothing. `entries` is a flat list of path strings,
 * which is all a zip walk or a `find` produces.
 */
export function readSupplierArchive(entries, { today = null } = {}) {
  const files = [];
  const skipped = [];
  const containers = [];
  const vendors = new Map();

  for (const raw of entries) {
    const path = String(raw).replace(/\\/g, '/');
    if (/\/__MACOSX\/|(^|\/)\.DS_Store$/i.test(path)) continue;
    const parsed = parseArchivePath(path);
    if (!parsed.ok) { skipped.push({ path, reason: parsed.reason }); continue; }

    const v = vendors.get(parsed.vendor) || { vendor: parsed.vendor, periods: new Set(), files: 0 };
    v.periods.add(parsed.period);
    vendors.set(parsed.vendor, v);

    if (parsed.isContainer) {
      const sub = subjectOf(parsed);
      containers.push({ vendor: parsed.vendor, period: parsed.period, label: sub.label,
        suggestion: sub.suggestion, source_path: path });
    }
    if (parsed.empty || parsed.isContainer || !parsed.filename) continue;
    if (path.endsWith('/')) continue;

    const doc = classifyDocument(parsed.filename);
    const subject = subjectOf(parsed);
    const rec = {
      vendor: parsed.vendor, period: parsed.period,
      scope: subject.scope, container: subject.label, container_is: subject.suggestion,
      filename: parsed.filename, kind: doc.kind,
      expires_on: doc.expires_on ?? null, filled: doc.filled ?? null,
      source_path: path,
    };
    if (doc.kind === 'unknown') skipped.push({ path, reason: doc.reason });
    files.push(rec);
    v.files += 1;
  }

  // An expired certificate is REPORTED, never corrected. `today` is passed in
  // rather than read from the clock so the same listing always produces the
  // same report — a parser whose output moves overnight cannot be tested.
  const expired = today
    ? files.filter(f => f.expires_on && f.expires_on < today)
    : [];

  return {
    files,
    skipped,
    containers,
    expired,
    vendors: [...vendors.values()].map(v => ({
      vendor: v.vendor, periods: [...v.periods].sort(), files: v.files,
      // A vendor with a year folder and nothing in it is a fact worth keeping:
      // Mill Haven's 2025 is empty, and Mill Haven is one of the three vendors
      // NC 4.3.1 names.
      empty_periods: [...v.periods].sort().filter(p => !files.some(f => f.vendor === v.vendor && f.period === p)),
      // A container NAMED after a questionnaire counts, even when the archive
      // listing does not expand it. Ten vendors keep theirs inside a zip
      // ("resupplierqualificationquestionnaire.zip", "Powder OPS.zip"), and
      // reporting those as having none would put a vendor on an unqualified
      // list because of how somebody packed a folder.
      has_questionnaire: files.some(f => f.vendor === v.vendor
          && (f.kind === 'questionnaire' || f.kind === 'raw_material_questionnaire'))
        || containers.some(c => c.vendor === v.vendor && c.suggestion === 'questionnaire'),
      unexpanded_containers: containers.filter(c => c.vendor === v.vendor).length,
      containers: [...new Set(files.filter(f => f.vendor === v.vendor && f.container)
        .map(f => `${f.container} (${f.container_is})`))].sort(),
      undated_files: files.filter(f => f.vendor === v.vendor && !f.period).length,
    })),
  };
}
