// THE PREVENTIVE CONTROL CHART, as data — Protocol 003 (Food Safety Plan) V4.
//
// The plant's Food Safety Plan names four preventive controls. Until this file
// existed they were in the app in no form at all: `haccp_ccps` held zero rows,
// and neither X-ray machine was linked to anything. A hazard analysis with no
// CCP in the system has its monitoring evidence nowhere, which is the classic
// major non-conformance.
//
// >>> VERBATIM, AND PENDING VERIFICATION <<<
//
// Every string below is transcribed from the plan's Preventive Control Chart
// and kept as written, its own irregularities included — the same doctrine as
// `audit-checklist.js` (Form 403-01, typos and all) and `emp-site-list.js`
// (Form 604-01). An auditor comparing the app to Protocol 003 must find the
// same words. Correcting them here would make the app disagree with the
// approved document, and correcting the DOCUMENT is a Document Change Request.
//
// The transcription came from the PDF's text layer, which splits table cells
// across columns and occasionally mangles a character. Anywhere that produced
// a reading worth a second pair of eyes carries a `sourceNote`. THOSE ARE THE
// LINES TO CHECK AGAINST THE PDF FIRST. Until Document Control has confirmed
// the wording, treat this file as a faithful draft rather than a settled one.
//
// WHY THIS IS A TRANSCRIPTION AND NOT DATA ENTRY. `haccp_ccps` is editable in
// the app by admins, supervisors and QA. Hand-keying "NFe 2mm Fe 2mm Stainless
// Steel 4mm Ceramic 2mm Glass 2mm" into a text box is five chances to mistype a
// critical limit with nothing checking it — and a critical limit that can be
// edited without a document change is the thing `scale-forms.js` has always
// refused to allow. So the values come from the document, in code, and
// `ccpDrift()` below reports any stored row that has since wandered away from
// it. The edit guard that would refuse such a change is queued for `main`; this
// file makes the drift visible in the meantime, which is the half that can be
// built without touching live code.
//
// A NOTE ON WHERE THE RECORDS ACTUALLY ARE (24 Aug 2026). Three of the four
// controls name the batch production record or a document attached to it, and
// FORM 413-1 is the plant's own number for it (D-013). Those records are on
// PAPER today, logged in MRPEasy — not in Keychain, and not in ReadyDoc. The
// form registry marks them `keychain`, which in that file means "moving to
// Keychain", not "produced in Keychain". `recordToday` records the true present
// state per control so nothing here implies evidence the plant does not yet
// have in a system.

export const PC_DOCUMENT = 'Protocol 003';
export const PC_REVISION = 'V4';
export const PC_TITLE = 'Food Safety Plan';

/**
 * The four controls, in the chart's own order.
 *
 * Field names map onto `haccp_ccps` columns so the seeder is a straight copy —
 * a mapping layer would be one more place for the wording to change on its way
 * to the record.
 */
export const PREVENTIVE_CONTROLS = [
  {
    key: 'PC #1',
    step: 'Packaging Powder Filling and Rework',
    hazard: 'Pathogens',
    hazardType: 'Biological',
    criticalLimits: 'No more than 35 RLU.',
    monitoringProcedure:
      'What: Application of cleaning. Visual inspection prior to set up. '
      + 'How: Procedure as outline in cleaning SOP. '
      + 'Who: Qualified quality assurance specialist.',
    monitoringFrequency: 'At the beginning of every run.',
    correctiveAction: 'Re-clean line.',
    verificationProcedure: 'ATP swabs and visual inspection.',
    recordKeeping: 'Cleaning log Checklist in batch production record.',
    recordToday: 'Paper — batch production record (FORM 413-1). Not in ReadyDoc.',
    // The one control whose limit ReadyDoc can enforce today: the reading has
    // a home (`sanitation_records.atp_reading`) and `atp-limits.js` grades it.
    readyDocLimit: 'atp:pc-1',
  },
  {
    key: 'PC #2',
    step: 'Packaging Powder Filling and rework',
    hazard: 'Allergens',
    hazardType: 'Chemical',
    criticalLimits: 'No residual allergenic material from previous production line.',
    monitoringProcedure:
      'What: Application of cleaning. How: Allergen swab testing '
      + 'Who: Qualified quality assurance specialist.',
    monitoringFrequency: 'At the end of every run.',
    correctiveAction: 'Re-clean line.',
    verificationProcedure: 'Allergen swabs.',
    recordKeeping: 'Cleaning log Checklist in batch production record.',
    recordToday: 'Paper — batch production record (FORM 413-1). ReadyDoc holds a yes/no swab flag only.',
    // The chart's step reads "rework" in lower case here and "Rework" on PC #1.
    // Kept as written; it is the plant's document, not a typo to fix.
    sourceNote: 'Step capitalisation differs from PC #1 in the source; kept as written.',
  },
  {
    key: 'PC #3',
    step: 'Screens',
    hazard: 'Metal',
    hazardType: 'Physical',
    criticalLimits:
      'No metal fragments nor other foreign materials that would cause injury or choking '
      + 'are in the product that passes through the screen.',
    monitoringProcedure:
      'What: All product passes through a 50 or 70 mesh size screen. '
      + 'How: Raw ingredients are sifted prior going into the super sack. '
      + 'Who: Qualified line operator.',
    monitoringFrequency: 'At the beginning of every machine start up.',
    correctiveAction:
      'If metal is found in the hopper, segregate all the product produced in specific room '
      + 'during the day and put it on hold. Investigate to determine the disposition of the '
      + 'product. Identify the source of the metal found and fix damaged equipment if caused '
      + 'from wear and tear of any piece of equipment.',
    verificationProcedure: 'Review of BPR.',
    recordKeeping: 'Observations on batch record.',
    recordToday: 'Paper — batch production record (FORM 413-1). Not in ReadyDoc.',
    // The open DCR item: the Process Description says the screen is checked at
    // the beginning AND the end of each batch, recording mesh size and screen
    // condition. The chart says start-up only. Transcribed as the CHART states
    // it, because the chart is the control; the disagreement is Document
    // Control's to rule on, not this file's to resolve.
    sourceNote:
      'The plan\'s Process Description states "at the beginning and at the end of each batch" '
      + 'and also asks for mesh size and screen condition. Raised as DCR item 1; the chart\'s '
      + 'wording is what is transcribed here.',
  },
  {
    key: 'PC #4',
    step: 'X-ray',
    hazard: 'Foreign Material',
    hazardType: 'Physical',
    criticalLimits:
      'No foreign materials that would cause injury or choking are in the product. '
      + 'NFe 2mm Fe 2mm Stainless Steel 4mm Ceramic 2mm Glass 2mm',
    monitoringProcedure:
      'What: Product passes through x-ray '
      + 'How: Product is loaded onto a conveyor belt and goes through a calibrated x-ray machine '
      + 'that automatically rejects product if foreign material is captured during imaging. '
      + 'Who: Qualified quality assurance specialist.',
    monitoringFrequency: 'At the beginning of every run and every 2 to 3 hours after the initial check.',
    correctiveAction: '100 % inspection for all product from the last good check performed.',
    verificationProcedure: 'X-ray reading.',
    recordKeeping: 'X-ray Operation Record',
    recordToday: 'Paper — X-ray Operation Record (FORM 413-1 X-Ray). Not in ReadyDoc.',
    sourceNote:
      'CHECK THIS ONE FIRST. The PDF text layer renders the monitoring line as '
      + '"Product passes through r- ray", which is the word x-ray split across a cell boundary. '
      + 'Transcribed as "x-ray". Confirm against the PDF. The five limits are also run together '
      + 'in the source with no separators — confirm each figure and its material.',
  },
];

/** The equipment this control is applied on, matched by name at seed time. */
export const PC_EQUIPMENT = {
  'PC #4': [/^X-Ray Inspection Machine/i, /^X-Ray Rejection Box/i],
};

/** The name a CCP row carries. Stable — it is the seeder's identity key. */
export const ccpName = (pc) => `${pc.key} — ${pc.step} (${pc.hazard})`;

/** The columns `haccp_ccps` holds, built from one control. */
function ccpRow(pc) {
  return {
    name: ccpName(pc),
    description:
      `${PC_DOCUMENT} ${PC_REVISION} (${PC_TITLE}), Preventive Control Chart. `
      + `Operational step: ${pc.step}. Hazard: ${pc.hazard}. `
      + `Record keeping per the plan: ${pc.recordKeeping} `
      + `Where that record is today: ${pc.recordToday}`,
    hazard_type: pc.hazardType,
    critical_limits: pc.criticalLimits,
    monitoring_procedure: pc.monitoringProcedure,
    monitoring_frequency: pc.monitoringFrequency,
    corrective_action: pc.correctiveAction,
    verification_procedure: pc.verificationProcedure,
    record_keeping_requirements: pc.recordKeeping,
  };
}

/** Every column this file owns — the ones `ccpDrift` compares. */
const OWNED = [
  'hazard_type', 'critical_limits', 'monitoring_procedure', 'monitoring_frequency',
  'corrective_action', 'verification_procedure', 'record_keeping_requirements',
];

/**
 * Seed the four controls, and link PC #4 to the X-ray machines.
 *
 * INSERT-ONLY, keyed on the CCP's name — the same rule every other seeder in
 * this codebase follows. A row somebody has edited by hand is a decision, and a
 * redeploy must never quietly undo it; `ccpDrift()` is how such an edit becomes
 * visible instead. Equipment links are set only where the machine has none, for
 * the same reason.
 *
 * @returns {{created: string[], linked: number, alreadyLinked: number, missingEquipment: string[]}}
 */
export function seedPreventiveControls(db, { uuid }) {
  const created = [];
  const existing = db.prepare('SELECT id FROM haccp_ccps WHERE name = ?');
  const ins = db.prepare(`
    INSERT INTO haccp_ccps (id, name, description, hazard_type, critical_limits,
      monitoring_procedure, monitoring_frequency, corrective_action,
      verification_procedure, record_keeping_requirements)
    VALUES (@id, @name, @description, @hazard_type, @critical_limits,
      @monitoring_procedure, @monitoring_frequency, @corrective_action,
      @verification_procedure, @record_keeping_requirements)`);

  const idFor = {};
  for (const pc of PREVENTIVE_CONTROLS) {
    const row = ccpRow(pc);
    const found = existing.get(row.name);
    if (found) { idFor[pc.key] = found.id; continue; }
    const id = uuid();
    ins.run({ id, ...row });
    idFor[pc.key] = id;
    created.push(row.name);
  }

  let linked = 0, alreadyLinked = 0;
  const missingEquipment = [];
  for (const [key, patterns] of Object.entries(PC_EQUIPMENT)) {
    const ccpId = idFor[key];
    if (!ccpId) continue;
    for (const pattern of patterns) {
      // Matched in JS rather than SQL: the pattern is a RegExp so the rule is
      // readable beside the control it belongs to, and the equipment table is
      // small enough that reading it is free.
      const match = db.prepare('SELECT id, name, haccp_ccp_id FROM equipment').all()
        .find(e => pattern.test(e.name || ''));
      if (!match) { missingEquipment.push(String(pattern)); continue; }
      if (match.haccp_ccp_id) { alreadyLinked += 1; continue; }
      db.prepare('UPDATE equipment SET haccp_ccp_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(ccpId, match.id);
      linked += 1;
    }
  }

  if (created.length) {
    console.log(`[seed] Seeded ${created.length} preventive control(s) from ${PC_DOCUMENT} ${PC_REVISION}`
      + (linked ? `, linked ${linked} X-ray machine(s)` : ''));
  }
  return { created, linked, alreadyLinked, missingEquipment };
}

/**
 * Which stored CCP rows no longer match the document.
 *
 * `haccp_ccps` is editable in the app, so a critical limit CAN be changed
 * without a Document Change Request. This does not prevent that — preventing it
 * means guarding the write path, which is live code and lands on `main` — but
 * it makes it answerable, which is the difference between a silent divergence
 * and a visible one. A control the plan names and the database has never heard
 * of is reported too, since that is the same question asked the other way.
 *
 * @returns {{name:string, field?:string, document?:string, stored?:string, missing?:boolean}[]}
 */
export function ccpDrift(db) {
  const rows = db.prepare('SELECT * FROM haccp_ccps').all();
  const byName = new Map(rows.map(r => [r.name, r]));
  const out = [];
  for (const pc of PREVENTIVE_CONTROLS) {
    const want = ccpRow(pc);
    const got = byName.get(want.name);
    if (!got) { out.push({ name: want.name, missing: true }); continue; }
    for (const field of OWNED) {
      if ((got[field] ?? '') !== want[field]) {
        out.push({ name: want.name, field, document: want[field], stored: got[field] ?? '' });
      }
    }
  }
  return out;
}
