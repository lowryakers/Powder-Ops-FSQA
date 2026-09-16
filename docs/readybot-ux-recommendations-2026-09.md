# ReadyBot notification UX — research + recommendations, September 2026

**Scan date:** 16 September 2026. Research sitting only — **nothing in this document has been implemented.** No
audience SQL, digest cadence, or picker logic was touched to produce it; every "as-is" claim below is read
directly from the live code (`server/readybot-audience.js`, `server/readybot-recipients.js`,
`src/components/settings/NotificationsSection.jsx`, and the individual message-composer functions cited inline),
not assumed from the brief's example list.

---

## 1. Principles (aligned with "necessary, not more" and DM-not-channel)

- **A DM is a promise, not an FYI.** ReadyDoc's own doctrine (D-079/D-086) is that every ReadyBot message is a
  private conversation with one person, chosen because that person specifically needs to act or know — never a
  broadcast dressed up as personal. Any new pattern has to keep that promise, not dilute it with more messages.
- **Urgency is a fact about the message, not a decoration on it.** PagerDuty and Android both draw a hard line:
  urgency decides *how* someone is interrupted (a call vs. an email; a heads-up vs. a full-screen alert), and
  disguising a routine reminder as urgent trains people to ignore real ones (Android's own guidance calls this
  "unnecessary alarm"; manufacturing-floor UX research calls the end state "alarm fatigue").
- **Explain yourself once, in the message, not only in a settings screen three taps away.** Slack's notification
  troubleshooting docs describe preferences stacking across three invisible layers precisely because people
  can't answer "why did I get this" without them — the fix is answering it on the thing that arrived, not
  requiring a support ticket.
- **Cadence (how often) and urgency (how loud) are two different axes, not one.** A daily digest and a same-
  second excursion alert should never look identical, and none of ReadyDoc's current messages currently say
  which kind of thing they are (see As-Is, below).
- **Progressive disclosure beats one long flat list.** Nielsen's original 1995 formulation — defer secondary
  detail until asked for — is exactly what a 12-card, ungrouped Settings screen is missing today.
- **Every control lives where the problem is seen** (ReadyDoc's own recurring lesson, restated because it applies
  here too): a mute or a "why" belongs on the message itself or one tap from it, not buried in Settings, which
  most recipients of these DMs cannot even open.
- **Mobile is not desktop with a smaller viewport.** WCAG 2.5.8 sets 24×24 CSS px as the legal minimum touch
  target and usability research puts the practical floor at 44×44; a plant floor adds gloves, glare, and someone
  reading one-handed mid-task, which only raises the bar.
- **Nothing here should cost QA a signature or an escalation.** Any snooze/mute idea has to be scoped so it can
  never quiet a compliance-critical ask (a QA correction, an environmental excursion) — that is a decision for
  Lowry, not something to default into being possible.

---

## 2. As-is skim

**Settings → ReadyBot messages** (`NotificationsSection.jsx`) is a flat, ungrouped list of **12 cards**, one per
automatic message type. **10 of the 12 are settable** (`flash_report`, `pay_actions`, `employee_documents`,
`onboarding_finished`, `eod_missed`, `cleanup_review`, `supplier_reviews`, `record_backfill`,
`controlled_changes`, `auditor_pass`); 2 are locked "By rule" (`pay_review_asks`, `qa_corrections` — messages
that reach the person the ask is actually about, correctly not offered as a setting). There is no grouping, no
collapse, and no way to see all 12 without scrolling past every card regardless of which two you actually want
to change. **Two things the brief's example list assumed are broken are actually already fixed**, confirmed by
reading the code rather than assuming: the picker is **already pre-ticked** from the card's current audience —
a code comment on the component explains this was fixed precisely because an empty picker made "add one person"
silently clear the whole list (D-086 lineage) — and a filter-by-typing box already exists **inside** the picker
once it's open.

**What a ReadyBot DM actually looks like today** (read from 22 live `postMessageAs(db, dm, bot, …)` call sites
across `server/api/production.js`, `server/env-limits.js`, `server/api/auditor-pass.js`, `server/api/qms.js`,
`server/film-draft-backfill.js`, `server/api/onboarding.js`, `server/receiving-notify.js`, and others):

- **No consistent severity marker.** Emoji lead-ins are chosen ad hoc per message: `📝` (QA correction ask),
  `⏰` (a reminder of the same), `📦` (packaging inspection), `📋` (onboarding finished), `🎫` (auditor pass),
  `👅` (sensory evaluation needed) — and **6 of the 22 composers use no leading icon at all**. Nothing about the
  glyph maps to how urgent the thing actually is; it's whatever felt right when that one function was written.
- **No digest-vs-interrupt distinction.** A once-a-shift environmental excursion, a same-second auditor-pass
  announcement, and an every-third-day "still waiting" nudge (pay reviews, supplier reviews, QA-record backfill,
  the EOD chase) all arrive as visually identical DMs. The reminder variant of the QA-correction message *does*
  reword its lead line to "Still waiting…", but that is the one place this happens — it is not a pattern.
- **No "why you got this" line anywhere.** Every message states what happened and what to do; none states which
  of the 12 categories it is, or points back to the Settings card that controls it. A recipient who wants to
  know why has to already know that screen exists (admin-only) and go find the right card themselves.
- **The one existing CTA is a bare pasted link, not a button.** `notifyQaAction` ends with a raw
  `${readyDocOrigin()}/?tab=production-log` in the message text. It does work — `parseAppLink` opens it in-app
  rather than reloading the whole site — but nothing distinguishes it visually as the thing to tap, and it
  carries none of the `[label](url)` link grammar ReadyDoc's own comms composer already supports (D-079's
  `shared/rich-markup.js`). The machinery for a real "Open Production Log" button-style link already exists in
  the codebase; ReadyBot's own messages just don't use it.
- **Every DM composer checked is English-only.** Zero of the 22 send sites carry a Spanish variant, despite the
  rest of the app investing specifically in bilingual floor copy elsewhere (Operator View's `i18n/
  operatorStrings.js`, the kiosk forms, the onboarding wizard, the forklift safety quiz). Several of these 12
  categories reach exactly the people that other bilingual work was built for — the QA-correction ask goes to
  "the person who filed it," which on the floor is often an operator, not an admin.
- **A failed send is invisible to everyone except whoever reads the audit log.** `notifyQaAction` already
  distinguishes "unreachable person" from "comms outage" (`dm_failed`) and audits both — but neither the
  recipient (who by definition never got the message) nor the person who triggered the ask (QA, in that example)
  sees anything different on screen. The fact is captured; nothing surfaces it.
- **No mute, snooze, or quiet-hours mechanism exists for ReadyBot DMs at all** — confirmed by search across
  `src/` and `server/` for anything resembling do-not-disturb, per-channel mute, or a snooze on a message
  category. (PM work orders have a `snooze` endpoint; that is a different feature on a different object and does
  not touch ReadyBot messaging.) The only lever anyone has today is the global push bell (all-or-nothing) or the
  admin-only Settings picker (removes yourself from a list you may not know exists).

**What already works and shouldn't be touched:** the underlying doctrine — one audience-resolving function per
sender, no second copy of a predicate on the display side (D-086) — is exactly the "single source of truth"
shape that dense-admin-config research (Teams' split between org-wide and personal settings, Slack's layered
preferences) treats as the hard problem. ReadyDoc already solved the hard part; what's missing is entirely on
the *presentation* side; not one recommendation below asks to touch that resolver logic.

---

## 3. Prioritized backlog

| Priority | Recommendation | Desktop / Mobile / Both | Effort | Risk | Depends on Lowry decision? |
|---|---|---|---|---|---|
| P0 | Add a one-line "why you got this" footer to every ReadyBot DM, naming its category and (for admins) linking back to its Settings card | Both | S | Low — text-only addition to the shared composer path | No |
| P0 | Render the existing CTA link as a real button using ReadyDoc's own `[label](url)` grammar ("Open Production Log") instead of a bare pasted URL | Both, but the win is mostly mobile (thumb target) | S | Low — grammar already exists and is already used elsewhere in comms | No |
| P0 | Move the picker's existing "Filter people" pattern up one level, as a filter box across the 12 audience cards themselves | Desktop mainly (mobile already scrolls one at a time) | S | Low — literally the same component pattern, one level up | No |
| P1 | Adopt a small, fixed severity/urgency vocabulary (e.g. 3–4 levels, Linear's Urgent/High/Medium/Low is a reasonable model) and apply it consistently as the message's leading marker, replacing the 11+ ad hoc emoji found today | Both | M | Medium — touches the composer in ~22 call sites, though each edit is mechanical (swap a hard-coded emoji for a shared constant) | Yes — needs sign-off on which of the 12 categories gets which level; that's a judgment call, not a technical one |
| P1 | Give recurring "reminder" messages (pay/supplier/backfill/EOD nudges) a consistent lead phrase distinct from one-time event alerts, separate from the severity marker above | Both | S | Low | No |
| P1 | Group the 12 Settings cards with progressive disclosure — e.g. "You choose who gets this" vs. "Follows a rule" as two collapsed sections, or the 2 highest-traffic categories shown open and the rest one click away | Desktop mainly | M | Low — presentational only, no data model change | No |
| P1 | Surface a failed-send outcome to the person who triggered the underlying ask (not the unreachable recipient) — the fact is already audited (`qa_action_notify_failed`, `dm_failed`), it just has no UI today | Both | M | Low-Medium — needs a small new read endpoint, no new write path | No |
| P1 | Audit which of the 12 categories reach floor staff rather than office/admin staff, and translate only those into EN/ES (do not blanket-translate all 22 call sites at once) | Both | M | Low — translation is additive, existing bilingual infrastructure (`operatorStrings.js` pattern) can be reused | Yes — needs a decision on which categories actually warrant the work; not all 12 reach a Spanish-primary reader |
| P2 | Add a live copy preview on each settable Settings card ("here's roughly what this message says") before an admin commits a recipient change | Desktop mainly | M | Low — static sample text, no new data path | No |
| P2 | A self-service "snooze this category for me" control reachable from the DM itself (long-press menu, reusing the existing message 3-dot machinery), explicitly excluding compliance-critical categories | Both | L | Medium — new schema (a per-user suppression flag) and a policy question about which categories may ever be snoozed | **Yes — explicitly.** This is new product surface with a real compliance question behind it (should a QA-correction ask ever be self-mutable?), not a formatting change |

---

## 4. The ten ideas, in short

1. **"Why you got this" footer.** One line, every message: *"— you're getting this because you filed this
   entry / because you're an admin / because Settings → ReadyBot messages has you on this list."*
2. **CTA as a button, not a pasted link.** Use the link grammar the composer already has.
3. **Filter box across the 12 audience cards**, matching the picker's own existing pattern.
4. **A small, fixed severity vocabulary**, applied consistently instead of ad hoc emoji.
5. **A distinct "reminder" lead phrase** for the every-Nth-day nudges, separate from severity.
6. **Progressive disclosure on the Settings screen** — group by "you chose this" vs. "follows a rule," collapse
   the rest.
7. **Surface a failed send to the sender**, not just the audit log.
8. **A targeted EN/ES audit** of the categories that actually reach floor staff.
9. **A copy preview on each Settings card** before committing a change.
10. **A scoped, decision-gated self-mute** for non-compliance-critical categories only.

---

## 5. Reference map

| Product / pattern | Why it's a reference | ReadyBot recommendation(s) it inspired |
|---|---|---|
| Slack — layered notification preferences (global → workspace DND → per-channel mute), and its own "why am I not being notified" troubleshooting framing | Names the exact inverse of "why did I get this" as a support-documented problem worth a dedicated answer | #1, #3 |
| PagerDuty — Dynamic Notifications, severity → urgency mapping (info/warning = low-urgency email, error/critical = high-urgency call + escalation) | Concrete, named example of urgency deciding *delivery weight*, not just decoration | #4, #5 |
| Android / Material Design — notification channels, "importance chosen with consideration for the user's time," "unimportant notification disguised as urgent produces unnecessary alarm" | Direct warning against exactly the ad hoc-emoji problem found in the as-is read | #4, #5 |
| Apple HIG — Alerts ("use sparingly," "each one offers only essential information and useful actions") | Grounds the CTA-as-a-button recommendation in "useful actions," not just tap-target sizing | #2 |
| Linear — fixed five-level priority system (Urgent/High/Medium/Low/No Priority) replacing ad hoc labels | A concrete, small, named vocabulary to model ReadyBot's severity levels on, rather than inventing one from scratch | #4 |
| Nielsen Norman Group — progressive disclosure (Nielsen, 1995); "visibility of system status" heuristic | Directly names the fix for a flat 12-card settings list, and the general principle behind "why you got this" and the failed-send surfacing | #1, #6, #7, #9 |
| WCAG 2.5.8 (target size, AA) + thumb-zone/one-handed research (49% of users navigate one-handed; 44×44px practical floor vs. 24×24px legal minimum) | Grounds "CTA as a button" in a size/placement requirement, not aesthetics | #2 |
| Manufacturing-floor UX research (alarm fatigue, gloves/PPE, operators are not desk workers) | Grounds both the severity-vocabulary idea (alarm fatigue is the named failure mode of ad hoc urgency) and the EN/ES audit (this is who the floor-facing categories actually reach) | #4, #8 |
| Microsoft Teams admin center — org-wide settings vs. personal settings as two distinct, separately-scoped controls | A real precedent for "some things are the plant's decision, some are the individual's" — supports scoping the self-mute idea (#10) narrowly rather than reopening the audience picker | #10 |
| Front / shared-inbox triage practice — every item has one owner and one status, not just read/unread | Reinforces that ReadyDoc's existing "actor-only, no broadcast" audiences (`qa_corrections`, `pay_review_asks`) are already the correct pattern externally, not a gap to fix | (validates existing design; no new recommendation) |
| General empty-state / transparency UX research ("communicate what's happening... rather than leaving users wondering what went wrong") | Grounds surfacing a failed send to the sender, rather than leaving the audit log as the only record | #7 |

---

## 6. Explicit non-goals this wave

- No new ReadyBot rules or message categories.
- No change to who is on any audience list, or to any audience-resolving function.
- No change to digest cadence (Flash Report timing, the every-3rd-day / every-other-day nudges).
- No mega-mix with Comms rewrite work, Artwork-Proofing, or any FSQA plant sitting.
- No UI implementation in this sitting — every item above is a recommendation for a follow-up sitting.

---

**Await Lowry picks (list IDs). Do not implement until a follow-up sitting.**
