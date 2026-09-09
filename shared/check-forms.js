/**
 * A scheduled check that files a RECORD — the one interface behind four
 * programs (D-060).
 *
 * The recurring defect this codebase keeps finding is a scheduled check whose
 * completion writes readings onto a work order and files nothing: the QA
 * inspections did it (fixed in fileQaInspectionRecord), the 72-hour re-clean
 * did it, and the audit found the environmental monitoring program doing it
 * with no record at all (CAR 4990683-8). Rather than a fourth private hook in
 * pm.js, a check DECLARES what its completion must carry — the form spec
 * here — and the server files the record that spec implies (check-records.js).
 *
 * In `shared/` because both sides read it: the completion form renders the
 * fields from the spec and refuses to submit while `missingForCheck` names
 * something; the server validates with the SAME function. Two copies of
 * "what a completed walk-through must contain" is how one screen offers a
 * completion the server then refuses.
 *
 * Kinds today:
 *   emp                 — an environmental monitoring sampling event
 *                         (FORM 604-01): which sites were swabbed. The RESULT
 *                         arrives from the lab later and is entered on the
 *                         record, which stays open until it does.
 *   gmp_walk            — the weekly GMP walk-through (CAR 4990683-1).
 *                         DRAFTED, not transcribed: there is no controlled form
 *                         for this yet, so every record is stamped DRAFT-1 and
 *                         says so — the shipping-checklist rule (D-052).
 *   banned_list_review  — the annual Banned/Prohibited Substance list review
 *                         (CAR 4990682-2): the edition of each list reviewed,
 *                         the changes found, the actions taken.
 *   stability_pull      — a dated pull on a stability study (CAR 4990683-9):
 *                         what was pulled and where it went; the result is
 *                         entered on the study when the laboratory reports.
 */

export const GMP_WALK_REVISION = 'DRAFT-1';

/**
 * The weekly walk-through items, in the plant's own words from the CAR
 * response: gowning, hairnets, jewelry, handwashing and footwear. Nothing is
 * added beyond what the response commits to; a sixth item is Document
 * Control's to issue when the form gets a number.
 */
export const GMP_WALK_ITEMS = [
  { key: 'gowning', label: 'Gowning — clean smocks/coats worn correctly in GMP areas', label_es: 'Vestimenta — batas limpias usadas correctamente en áreas GMP' },
  { key: 'hairnets', label: 'Hairnets and beard covers worn by everyone in GMP areas', label_es: 'Redes para el cabello y cubrebarbas usados por todos en áreas GMP' },
  { key: 'jewelry', label: 'No jewelry in GMP areas', label_es: 'Sin joyería en áreas GMP' },
  { key: 'handwashing', label: 'Handwashing observed on entry; sinks stocked with soap, towels and sanitizer', label_es: 'Lavado de manos al entrar; lavamanos con jabón, toallas y sanitizante' },
  { key: 'footwear', label: 'Footwear control at the GMP entrance in use (covers, dedicated footwear or boot wash)', label_es: 'Control de calzado en la entrada GMP en uso (cubrezapatos, calzado exclusivo o lavabotas)' },
];

export const GMP_WALK_ANSWERS = ['c', 'nc', 'na'];

/** The four lists NSF 306 names; the edition of each is what a review records. */
export const BANNED_LISTS = [
  { key: 'nsf306_annex_c', label: 'NSF/ANSI 306 Annex C' },
  { key: 'nfl_nflpa', label: 'NFL / NFLPA Prohibited Substances list' },
  { key: 'mlb', label: 'MLB Prohibited Substances list' },
  { key: 'wada', label: 'WADA Prohibited List' },
];

/**
 * The EMP zones, keyed the way `emp_samples.zone` is stored. `tests` is what
 * each sample is tested for — one record per site × test, so a Zone 1 swab
 * yields two rows (TAB and Yeast & Mold), which is how the lab reports it.
 */
export const EMP_ZONES = {
  water: { label: 'Water (potable)', tests: ['Total Aerobic Bacteria Count', 'Total Coliforms', 'Free Chlorine'] },
  air: { label: 'Air', tests: ['Settle plate'] },
  compressed_air: { label: 'Compressed air', tests: ['Compressed air quality'] },
  zone1: { label: 'Zone 1 — product contact surfaces', tests: ['Total Aerobic Bacteria Count', 'Total Yeast and Mold Count'] },
  zone2: { label: 'Zone 2 — near product contact', tests: ['Salmonella species', 'Listeria monocytogenes'] },
  zone3: { label: 'Zone 3 — remote, near processing', tests: ['Salmonella species', 'Listeria monocytogenes'] },
  zone4: { label: 'Zone 4 — outside processing', tests: ['Salmonella species', 'Listeria monocytogenes'] },
};

/**
 * Which check a quality schedule is, from its title and module. Matched on
 * the seeded titles (quality-schedules.js / emp-site-list.js) and, for EMP,
 * on the module — a schedule Quality adds under "Environmental Monitoring"
 * files samples without anyone touching code. Anything else returns null and
 * completes exactly as before.
 */
export function checkKindFor({ title, module_id } = {}) {
  const t = String(title || '').toLowerCase();
  const m = String(module_id || '').toLowerCase();
  if (/weekly gmp walk/.test(t)) return 'gmp_walk';
  if (/banned\/?prohibited substance list review/.test(t)) return 'banned_list_review';
  if (m === 'environmental monitoring' || /^emp zone|^tap water testing|^air testing|^compressed air testing/.test(t)) return 'emp';
  return null;
}

/** Which EMP zone a schedule samples, from its title. */
export function empZoneFor(title) {
  const t = String(title || '').toLowerCase();
  if (/tap water/.test(t)) return 'water';
  if (/compressed air/.test(t)) return 'compressed_air';
  if (/air testing|settle plate/.test(t)) return 'air';
  const z = t.match(/zone\s*([1-4])/);
  if (z) return `zone${z[1]}`;
  return 'zone2';
}

/**
 * What is still needed before this check can be completed. Returns
 * `[{key, label}]`; empty means complete. The server refuses with this list
 * and the form shows the same list, so the two cannot disagree.
 */
export function missingForCheck(form, check) {
  const c = check || {};
  const out = [];
  if (!form) return out;
  if (form.kind === 'stability_pull') {
    if (!String(c.quantity || '').trim()) out.push({ key: 'quantity', label: 'What was pulled (quantity / container)' });
  } else if (form.kind === 'emp') {
    const sites = Array.isArray(c.sites) ? c.sites.map(s => String(s || '').trim()).filter(Boolean) : [];
    if (!sites.length) out.push({ key: 'sites', label: 'At least one site sampled' });
  } else if (form.kind === 'gmp_walk') {
    const items = c.items || {};
    for (const it of form.items || GMP_WALK_ITEMS) {
      const a = items[it.key]?.result;
      if (!GMP_WALK_ANSWERS.includes(a)) out.push({ key: it.key, label: it.label });
      else if (a === 'nc' && !String(items[it.key]?.note || '').trim()) out.push({ key: `${it.key}_note`, label: `What was seen — ${it.label}` });
    }
    if (!String(c.area || '').trim()) out.push({ key: 'area', label: 'Area walked' });
  } else if (form.kind === 'banned_list_review') {
    const ed = c.editions || {};
    for (const l of form.lists || BANNED_LISTS) {
      if (!String(ed[l.key] || '').trim()) out.push({ key: l.key, label: `Edition or date of the ${l.label}` });
    }
    if (!String(c.changes_found || '').trim()) out.push({ key: 'changes_found', label: 'Changes found (write "none" if none)' });
    if (!String(c.actions_taken || '').trim()) out.push({ key: 'actions_taken', label: 'Actions taken (write "none" if none)' });
  }
  return out;
}

/** Normalise the check payload to exactly what the record stores. */
export function normalizeCheck(form, check) {
  const c = check || {};
  if (!form) return null;
  if (form.kind === 'stability_pull') {
    return { quantity: String(c.quantity || '').trim().slice(0, 120), lab: String(c.lab || '').trim().slice(0, 120) || null, sent_on: /^\d{4}-\d{2}-\d{2}$/.test(String(c.sent_on || '')) ? c.sent_on : null };
  }
  if (form.kind === 'emp') {
    const seen = new Set();
    const sites = (Array.isArray(c.sites) ? c.sites : []).map(s => String(s || '').trim().slice(0, 160)).filter(s => {
      const k = s.toLowerCase(); if (!s || seen.has(k)) return false; seen.add(k); return true;
    });
    return { sites, lab: String(c.lab || '').trim().slice(0, 120) || null };
  }
  if (form.kind === 'gmp_walk') {
    const items = {};
    for (const it of form.items || GMP_WALK_ITEMS) {
      const a = c.items?.[it.key] || {};
      items[it.key] = { result: GMP_WALK_ANSWERS.includes(a.result) ? a.result : null, note: String(a.note || '').trim().slice(0, 500) || null };
    }
    return { area: String(c.area || '').trim().slice(0, 120), items };
  }
  if (form.kind === 'banned_list_review') {
    const editions = {};
    for (const l of form.lists || BANNED_LISTS) editions[l.key] = String(c.editions?.[l.key] || '').trim().slice(0, 160);
    return {
      editions,
      changes_found: String(c.changes_found || '').trim().slice(0, 4000),
      actions_taken: String(c.actions_taken || '').trim().slice(0, 4000),
      materials_rechecked: !!c.materials_rechecked,
    };
  }
  return null;
}
