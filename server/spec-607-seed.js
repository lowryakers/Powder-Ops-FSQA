// Raw-material specifications transcribed from the plant's own FORM 607-01
// sheets (Word documents, one per material), filed as DRAFTS for QA review.
//
// The same two rules as spec-seed.js, because they are what make this safe:
//
//   1. A DRAFT CAN NEVER GRADE A RESULT — `is_active = 0`, and every grading
//      path reads `is_active = 1`. Approving in the Specifications tab's
//      draft strip is the human act that turns a transcription into the spec.
//
//   2. A NUMBER IS NEVER INVENTED. `min_value`/`max_value` were derived only
//      where the sheet states a direction (NMT/NLT, </>, or an A–B range).
//      A bare figure with no direction ("14.0", "19%"), an ambiguous one
//      ("<30.000" — thirty or thirty thousand?), or a garbled one
//      ("NMT 0.1emi") is left NULL for QA to type at approval. The
//      `specification` text is the sheet's wording VERBATIM, typos included —
//      the record must read as the controlled form does, and fixing the form
//      is a Document Change Request.
//
// server/data/form-607-specs.json is the transcription (21 materials, one
// entry per sheet, per-material `flags` naming everything QA must look at).
//
// ITEM NUMBERS: the sheets don't carry them (every SKU cell was blank), and
// the item_number is what a lab result grades against — so each material is
// resolved at seed time by NORMALIZED NAME against what the plant has already
// filed: coa_requests.item_description first (most-requested item_number wins
// when two codes share one name — that's where auto-grading pays), then
// existing coa_specifications. Normalizing strips the "(CN###)"/"RAW"
// provenance prefixes and ™/® marks the requests carry. A material nothing
// matches keeps its common name as the item_number — honest, visible, and
// editable on the draft — rather than a guessed code.
//
// Idempotent per row, on test + (resolved item_number OR this import's own
// description) across EVERY status — a discarded draft stays discarded, an
// approved one is not re-filed, and a draft whose item_number QA corrected
// before approving doesn't come back under the old key. No one-time flag:
// re-running files only what is still missing, same as spec-seed.js.
//
// ONE exception to "never touch an existing row": a seed:generic draft still
// awaiting review is a PLACEHOLDER ("enter the limit before approving"), and
// where the plant's own sheet gives the real figure for the same item + test,
// the placeholder is upgraded in place. Only that exact state — anything QA
// has approved or discarded, and anything a person typed, is left alone.

import { randomUUID as uuid } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = 'import:form-607-01';

// Fold a name down to what two humans would call "the same item": case,
// ™/®, punctuation and spacing differences disappear; the "(CN###)" and
// leading "RAW" provenance markers the lab requests carry are stripped.
export function normalizeName(s) {
  return String(s || '')
    .replace(/\(CN\d+\)/gi, ' ')
    .replace(/^\s*RAW\b/i, ' ')
    .replace(/[™®]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, '');
}

function resolveItemNumbers(db, materials) {
  // name → { item_number, requests } — most-requested code wins a shared name.
  const byName = new Map();
  const claim = (desc, itemNumber, weight) => {
    const key = normalizeName(desc);
    if (!key || !itemNumber) return;
    const cur = byName.get(key);
    if (!cur || weight > cur.weight
      || (weight === cur.weight && itemNumber < cur.item_number)) {
      byName.set(key, { item_number: itemNumber, weight });
    }
  };
  try {
    for (const r of db.prepare(`
      SELECT item_number, item_description, COUNT(*) AS n FROM coa_requests
      WHERE item_number IS NOT NULL AND TRIM(item_number) != ''
      GROUP BY item_number, item_description`).all()) {
      claim(r.item_description, r.item_number, r.n);
    }
  } catch { /* fresh DB, table may be empty */ }
  try {
    for (const r of db.prepare(`
      SELECT DISTINCT item_number, item_description FROM coa_specifications
      WHERE item_number IS NOT NULL AND TRIM(item_number) != ''`).all()) {
      claim(r.item_description, r.item_number, 0);
    }
  } catch { /* ditto */ }

  const out = new Map();
  for (const m of materials) {
    const hit = byName.get(normalizeName(m.common_name));
    out.set(m.common_name, hit ? hit.item_number : m.common_name);
  }
  return out;
}

export function seedForm607Specs(db) {
  let materials;
  try {
    materials = JSON.parse(readFileSync(path.join(__dirname, 'data', 'form-607-specs.json'), 'utf8'));
  } catch (e) {
    console.warn('[seed] form 607-01 specs unreadable, skipping:', e.message);
    return 0;
  }

  const itemNumbers = resolveItemNumbers(db, materials);
  const exists = db.prepare(`
    SELECT id, source, approval_status, is_active FROM coa_specifications
    WHERE test_type = ? AND (item_number = ? OR (source = ? AND item_description = ?))
    LIMIT 1`);
  const upgrade = db.prepare(`UPDATE coa_specifications
    SET item_description = ?, specification = ?, unit = ?, min_value = ?, max_value = ?,
        method = ?, vendor = ?, revision = ?, source = '${SOURCE}',
        updated_at = datetime('now')
    WHERE id = ? AND source = 'seed:generic' AND approval_status = 'draft' AND is_active = 0`);
  const ins = db.prepare(`INSERT INTO coa_specifications
    (id, item_number, item_description, test_type, specification, unit, min_value, max_value,
     method, vendor, revision, is_active, approval_status, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', '${SOURCE}', 'system')`);

  let added = 0, upgraded = 0, matched = 0, unmatched = 0;
  const tx = db.transaction(() => {
    for (const m of materials) {
      const itemNumber = itemNumbers.get(m.common_name);
      (itemNumber === m.common_name ? unmatched++ : matched++);
      for (const t of m.tests) {
        const prior = exists.get(t.test, itemNumber, SOURCE, m.common_name);
        if (prior) {
          if (prior.source === 'seed:generic' && prior.approval_status === 'draft' && !prior.is_active) {
            const r = upgrade.run(m.common_name, t.spec || null, t.unit || null,
              t.min ?? null, t.max ?? null, t.method || null,
              m.vendor || null, m.revision || null, prior.id);
            upgraded += r.changes;
          }
          continue;
        }
        ins.run(uuid(), itemNumber, m.common_name, t.test,
          t.spec || null, t.unit || null, t.min ?? null, t.max ?? null,
          t.method || null, m.vendor || null, m.revision || null);
        added++;
      }
    }
  });
  tx();
  if (added > 0 || upgraded > 0) {
    console.log(`[seed] Filed ${added} draft specification(s) from FORM 607-01 across ${materials.length} material(s) `
      + `(${matched} matched to an existing item number, ${unmatched} kept their name as the item number`
      + `${upgraded ? `, ${upgraded} generic placeholder draft(s) upgraded to the sheet's own figures` : ''})`);
  }
  return added + upgraded;
}
