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
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'film_draft_backfill_v1'").get()) return 0;
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('film_draft_backfill_v1', ?)").run(new Date().toISOString());

    const open = db.prepare('SELECT * FROM receiving_checklists WHERE reviewed_at IS NULL').all();
    let drafts = 0, relinked = 0;
    for (const row of open) {
      const answers = parseJson(row.answers, {}) || {};
      if (answers.is_packaging !== 'yes') continue;
      const had = db.prepare('SELECT 1 FROM film_pouch_inspections WHERE inspection_no = ?').get(row.inspection_no);
      const draftId = ensureFilmDraft(db, row, { name: 'system (backfill)' });
      if (!draftId) continue;
      if (!had) drafts++;

      const alerted = (parseJson(row.notifications, []) || []).some(n => n.item === 'is_packaging');
      if (!alerted) continue; // the live escalation path will carry the link when it fires
      const path = `/?tab=receiving-log&view=film&film=${encodeURIComponent(draftId)}`;
      const link = `${readyDocOrigin()}${path}`;
      for (const p of resolveTarget(db, 'qa_inspection')) {
        try {
          const { bot, dm } = botDm(db, p.id);
          await postMessageAs(db, dm, bot,
            `📦 *Packaging inspection ready to work*\nInspection *${row.inspection_no}* — the draft QA sheet is set up`
            + `${row.vendor ? ` (${row.vendor})` : ''}.\nThe earlier alert's link stopped at the front page — this one opens the sheet:\n${link}`);
          pushToUser(p.id, {
            title: 'Packaging inspection ready to work',
            body: `${row.inspection_no}: draft QA sheet is set up`.slice(0, 120),
            tag: `receiving-${row.inspection_no}-qa_inspection`, renotify: true, url: path,
          }).catch(() => {});
          relinked++;
        } catch { /* one recipient failing must not lose the rest */ }
      }
    }
    if (drafts || relinked) {
      console.log(`[backfill] film drafts: ${drafts} draft(s) created, corrected link sent to ${relinked} recipient(s)`);
    }
    return drafts;
  } catch (e) {
    console.warn('[backfill] film drafts failed:', e.message);
    return 0;
  }
}
