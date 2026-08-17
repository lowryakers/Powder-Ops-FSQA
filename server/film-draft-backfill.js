// One-time repair for the deliveries caught between two behaviors.
//
// The packaging escalation now creates QA's draft FORM 418-01 sheet and links
// the alert straight to it — but the escalations that fired BEFORE that
// shipped are already recorded, so the idempotency rule (correctly) never
// fires them again, which means those deliveries would never get their draft
// and Maria's existing alerts would keep pointing at the module front page
// forever.
//
// This runs once (app_settings flag) and, for every OPEN checklist whose
// "Is the product Packaging?" is answered YES:
//   - creates the missing draft sheet on the same inspection number,
//     prefilled from the checklist header — exactly what the live path does;
//   - and ONLY where the alert already went out (a recorded is_packaging
//     notification), DMs the QA targets the corrected direct link. Sent as a
//     follow-up, not logged as a second escalation: the escalation record
//     already says they were told; this is the link that message owed them.
// Checklists that are triggered but UNSENT are left to the live machinery —
// the next answer tap or the manual Send button creates the draft and sends
// the working link in one act.

import { botDm, postMessageAs } from './api/comms.js';
import { pushToUser } from './push.js';
import { readyDocOrigin } from './links.js';
import { resolveTarget } from './receiving-notify.js';
import { ensureFilmDraft } from './api/receiving.js';
import { parseJson } from './custom-fields.js';

export async function backfillFilmDrafts(db) {
  try {
    // v2 — v1 missed production three ways, each fixed here:
    //   1. It only looked at OPEN checklists. The real ones had been signed
    //      off by the time it deployed, and a signed receiving packet does
    //      not mean QA inspected the film — the film inspection is its own
    //      record. v2 covers every packaging=yes checklist with no sheets.
    //   2. It only DM'd where the is_packaging notification was already
    //      recorded. On the real checklists that escalation was never sent
    //      (the broken "Notify undefined" button era), so Maria got nothing.
    //      v2 DMs the QA targets for every draft it creates.
    //   3. It flagged itself DONE before doing the work, so a run that found
    //      nothing never retried. v2 flags AFTER the work succeeds.
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'film_draft_backfill_v2'").get()) return 0;

    const rows = db.prepare('SELECT * FROM receiving_checklists').all();
    let drafts = 0, told = 0, candidates = 0;
    for (const row of rows) {
      const answers = parseJson(row.answers, {}) || {};
      if (answers.is_packaging !== 'yes') continue;
      candidates++;
      const had = db.prepare('SELECT 1 FROM film_pouch_inspections WHERE inspection_no = ?').get(row.inspection_no);
      if (had) continue; // QA already has sheets on this delivery — nothing owed
      const draftId = ensureFilmDraft(db, row, { name: 'system (backfill)' });
      if (!draftId) continue;
      drafts++;

      const path = `/?tab=receiving-log&view=film&film=${encodeURIComponent(draftId)}`;
      const link = `${readyDocOrigin()}${path}`;
      for (const p of resolveTarget(db, 'qa_inspection')) {
        try {
          const { bot, dm } = botDm(db, p.id);
          await postMessageAs(db, dm, bot,
            `📦 *Packaging inspection needed*\nInspection *${row.inspection_no}*${row.vendor ? ` (${row.vendor})` : ''} `
            + `was received as packaging, and no QA film/pouch inspection is on file.\n`
            + `A draft sheet is set up — this link opens it:\n${link}`);
          pushToUser(p.id, {
            title: 'Packaging inspection needed',
            body: `${row.inspection_no}: draft QA sheet is set up`.slice(0, 120),
            tag: `receiving-${row.inspection_no}-qa_inspection`, renotify: true, url: path,
          }).catch(() => {});
          told++;
        } catch { /* one recipient failing must not lose the rest */ }
      }
    }
    // Flag LAST — a run that threw above retries on the next boot instead of
    // marking a repair done that never happened.
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('film_draft_backfill_v2', ?)").run(new Date().toISOString());
    console.log(`[backfill] film drafts v2: ${candidates} packaging checklist(s) found, ${drafts} draft(s) created, ${told} recipient DM(s) sent`);
    return drafts;
  } catch (e) {
    console.warn('[backfill] film drafts failed (will retry next boot):', e.message);
    return 0;
  }
}
