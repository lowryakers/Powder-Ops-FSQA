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
 *   management_review   — the annual site management review of the SQF System
 *                         (SQF Code 2.1.2.1). The eight items are TRANSCRIBED
 *                         from the clause; there is no numbered form for the
 *                         record yet, so it is stamped DRAFT-1.
 *   food_defense_challenge — the annual Food Defense Plan challenge
 *                         (SOP 434 V3 § 5.0). The steps are transcribed from
 *                         the plant's own controlled procedure, so the record
 *                         carries that procedure's revision rather than DRAFT-1.
 *   training            — an assigned training course. Completing the task is
 *                         what files the training record, so a course handed
 *                         to somebody cannot be "done" with nothing on the
 *                         training log to show for it.
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

/**
 * The annual site management review — SQF Code edition 9, clause 2.1.2.1.
 *
 * TRANSCRIBED FROM THE CLAUSE, VERBATIM, i–viii. This is an external standard,
 * like 29 CFR 1910.178(l)(3) behind the forklift evaluation: the eight things
 * the review "shall include" are not ours to reword, and an auditor reading the
 * record next to the code has to find the same eight.
 *
 * There is NO numbered form for the record — the clause names a review, not a
 * form — so every record is stamped DRAFT-1 and says so, the shipping-checklist
 * rule (D-052). The DCR is docs/v2/queued/dcr-management-review-record.md.
 */
export const MANAGEMENT_REVIEW_REVISION = 'DRAFT-1';
export const MANAGEMENT_REVIEW_CLAUSE = 'SQF Code 2.1.2.1';

export const MANAGEMENT_REVIEW_ITEMS = [
  { key: 'i_documentation', roman: 'i', label: 'Changes to food safety management system documentation (e.g., policies, procedures, specifications, food safety plan, food safety policy)' },
  { key: 'ii_system_tests', roman: 'ii', label: 'Results of annual system tests (e.g., food defense, crisis management, recall, and product trace)' },
  { key: 'iii_trends', roman: 'iii', label: 'Trends related to the food safety management system (e.g., audit and inspection findings, complaints, pest prevention program)' },
  { key: 'iv_culture', roman: 'iv', label: 'Performance towards food safety culture assessment plan' },
  { key: 'v_objectives', roman: 'v', label: 'Performance to food safety objectives and measures' },
  { key: 'vi_recalls', roman: 'vi', label: 'Review of recalls and regulatory issues' },
  { key: 'vii_hazard_analyses', roman: 'vii', label: 'Updates to all hazard analyses and risk assessments' },
  { key: 'viii_follow_up', roman: 'viii', label: 'Follow-up action items from previous management reviews' },
];

/**
 * EVERY ITEM IS REVIEWED, OR IT IS NOT APPLICABLE AND SAYS WHY.
 *
 * There is no third answer on purpose. The clause says the review "shall
 * include" all eight, so "skipped" is not a state the standard allows — an
 * item that genuinely does not apply this year (no recalls, no regulatory
 * issues) is `na` WITH A REASON, which is an answer an auditor can accept.
 * A blank is neither.
 */
export const REVIEW_ANSWERS = ['done', 'na'];

/**
 * The annual Food Defense Plan challenge — SOP 434 V3 § 5.0, transcribed.
 *
 * The plant's own controlled procedure (Registry 434, V3 effective 11 Sep 2026,
 * author Carol Pierce), so the steps are its words and the record carries
 * `SOP 434 V3`. Do not tidy the wording: a step re-phrased here stops matching
 * the procedure an auditor is holding. § 6.0 names the Annual Food Defense Plan
 * Challenge Report as the record; that report has no form number, which is what
 * the DCR asks Document Control to issue.
 */
export const FOOD_DEFENSE_SOP = 'SOP 434 V3';

export const FOOD_DEFENSE_ITEMS = [
  { key: 'prep_team', clause: '5.1 B', label: 'Food Defense Team assembled for a kick-off meeting' },
  { key: 'prep_documents', clause: '5.1 C', label: "Reviewed the previous year's challenge report, mitigation strategies and monitoring forms, corrective action records, and incident logs or security breaches" },
  { key: 'document_review', clause: '5.2 A', label: 'Verified the Food Defense Plan reflects current operations — ingredient suppliers, process flow, equipment, personnel assignments, facility layout and access points' },
  { key: 'kat_review', clause: '5.2 A.2', label: 'Reviewed the Key Activity Types and assessed whether vulnerabilities have changed' },
  { key: 'onsite_walkthrough', clause: '5.2 B.1', label: 'Walked the restricted areas, controlled access points, ingredient handling areas, and storage and shipping areas' },
  { key: 'mitigation_evaluated', clause: '5.2 B.2', label: 'Evaluated the mitigation strategies — access controls, seals and locks, employee authorization lists, visitor management, surveillance systems' },
  { key: 'operational_test', clause: '5.2 C', label: 'Carried out at least one operational challenge method and recorded the outcome and response times' },
  { key: 'findings_rated', clause: '5.2 D', label: 'Rated each mitigation strategy Effective / Partially Effective / Ineffective and identified any new vulnerabilities' },
  { key: 'corrective_actions', clause: '5.3', label: 'Assigned corrective actions with responsible persons and target completion dates, and updated the Plan where needed' },
];

/** § 5.2 C — the five methods the procedure names. At least one must be used. */
export const FOOD_DEFENSE_METHODS = [
  { key: 'unauthorized_entry', label: 'Simulated unauthorized entry attempt' },
  { key: 'access_validation', label: 'Review of employee access validation' },
  { key: 'alarm_test', label: 'Testing alarm or alert systems' },
  { key: 'mock_scenario', label: 'Mock intentional adulteration scenario discussion with staff' },
  { key: 'records_response', label: 'Testing of record-keeping and response procedures' },
];

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
  if (/management review/.test(t)) return 'management_review';
  if (/food defense plan challenge|annual food defense/.test(t)) return 'food_defense_challenge';
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
  if (form.kind === 'training') {
    // A RESULT OR A TRAINER — whichever the course actually has. A course
    // carrying a test is finished by a score: either the one the app graded,
    // or the one somebody marked on paper, because the plant does both and
    // refusing the paper route would just push the record back out of the
    // app. A course with no test is finished by a person having delivered it;
    // "trained by nobody" is not a record, and a tick with nothing behind it
    // is the fabricated-record refusal in a smaller hat.
    if (form.has_test) {
      const scored = String(c.score ?? '').trim() !== '' && Number.isFinite(Number(c.score));
      if (!c.test_attempt_id && !scored) out.push({ key: 'score', label: 'The test result (take it here, or record the score)' });
      // A SCORE UNDER THE PASS MARK DOES NOT COMPLETE THE TRAINING (D-158) —
      // the same rule the in-app test follows, where the task stays open until
      // a pass. It used to close the task and file the fail as "completed".
      else if (!c.test_attempt_id && scored && Number(c.score) < Number(form.passing_score ?? 80)) {
        out.push({ key: 'score', label: `A passing score — ${Number(c.score)}% is under the ${form.passing_score ?? 80}% pass mark, so the training stays open until it is passed` });
      }
    } else if (!String(c.trainer || '').trim()) {
      out.push({ key: 'trainer', label: 'Who delivered the training' });
    }
  } else if (form.kind === 'stability_pull') {
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
  } else if (form.kind === 'management_review') {
    const items = c.items || {};
    for (const it of form.items || MANAGEMENT_REVIEW_ITEMS) {
      const a = items[it.key]?.result;
      if (!REVIEW_ANSWERS.includes(a)) out.push({ key: it.key, label: `${it.roman}. ${it.label}` });
      // AN ITEM THE CLAUSE REQUIRES CANNOT BE WAVED THROUGH SILENTLY. "Not
      // applicable" is a statement about this year, and a statement with no
      // reason is the tick-with-nothing-behind-it this module exists to refuse.
      else if (a === 'na' && !String(items[it.key]?.note || '').trim()) out.push({ key: `${it.key}_note`, label: `Why ${it.roman} does not apply this year` });
    }
    if (!String(c.attendees || '').trim()) out.push({ key: 'attendees', label: 'Who took part in the review (site management)' });
  } else if (form.kind === 'food_defense_challenge') {
    const items = c.items || {};
    for (const it of form.items || FOOD_DEFENSE_ITEMS) {
      const a = items[it.key]?.result;
      if (!REVIEW_ANSWERS.includes(a)) out.push({ key: it.key, label: `${it.clause} — ${it.label}` });
      else if (a === 'na' && !String(items[it.key]?.note || '').trim()) out.push({ key: `${it.key}_note`, label: `Why ${it.clause} does not apply` });
    }
    // § 5.2 C is the only step the procedure writes as "must" — a challenge
    // with no method used is a review, not a challenge.
    const methods = Array.isArray(c.methods) ? c.methods.filter(Boolean) : [];
    if (!methods.length) out.push({ key: 'methods', label: 'At least one challenge method used (§ 5.2 C)' });
    if (!String(c.outcome || '').trim()) out.push({ key: 'outcome', label: 'Outcome and response times (§ 5.2 C)' });
    if (!String(c.findings || '').trim()) out.push({ key: 'findings', label: 'Strengths, weaknesses and gaps found (§ 5.2 D)' });
    if (!String(c.corrective_actions || '').trim()) out.push({ key: 'corrective_actions', label: 'Corrective actions assigned (write "none" if none)' });
    if (!String(c.team || '').trim()) out.push({ key: 'team', label: 'Food Defense Team members taking part' });
  }
  return out;
}

/** Normalise the check payload to exactly what the record stores. */
export function normalizeCheck(form, check) {
  const c = check || {};
  if (!form) return null;
  if (form.kind === 'training') {
    const raw = String(c.score ?? '').trim();
    const score = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
    return {
      test_attempt_id: String(c.test_attempt_id || '').trim().slice(0, 60) || null,
      score,
      trainer: String(c.trainer || '').trim().slice(0, 120) || null,
      method: String(c.method || '').trim().slice(0, 60) || null,
    };
  }
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
  if (form.kind === 'management_review' || form.kind === 'food_defense_challenge') {
    const list = form.items || (form.kind === 'management_review' ? MANAGEMENT_REVIEW_ITEMS : FOOD_DEFENSE_ITEMS);
    const items = {};
    for (const it of list) {
      const a = c.items?.[it.key] || {};
      items[it.key] = { result: REVIEW_ANSWERS.includes(a.result) ? a.result : null, note: String(a.note || '').trim().slice(0, 2000) || null };
    }
    if (form.kind === 'management_review') {
      return {
        items,
        attendees: String(c.attendees || '').trim().slice(0, 500),
        notes: String(c.notes || '').trim().slice(0, 8000) || null,
      };
    }
    const keys = new Set(FOOD_DEFENSE_METHODS.map(m => m.key));
    return {
      items,
      methods: [...new Set((Array.isArray(c.methods) ? c.methods : []).map(m => String(m)))].filter(m => keys.has(m)),
      outcome: String(c.outcome || '').trim().slice(0, 4000),
      findings: String(c.findings || '').trim().slice(0, 4000),
      corrective_actions: String(c.corrective_actions || '').trim().slice(0, 4000),
      team: String(c.team || '').trim().slice(0, 500),
    };
  }
  return null;
}
