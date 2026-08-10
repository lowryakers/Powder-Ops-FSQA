# Audit-readiness review — bugs swept, UX findings, recommendations

Written two weeks ahead of the audit. Part 1 is what was checked and fixed in code.
Part 2 is the UX/UI review with recommendations — what's done, what's suggested, and
what deliberately isn't.

## Part 1 — bug sweep, by class

Every bug caught to date was treated as a *class* and swept for other instances.

| Class (the bug you caught) | Sweep result |
|---|---|
| Timestamps 6h late (UTC stored, read as local) | 26 sites fixed earlier; **8 more found and fixed** this pass — `released_at` (LOTO ×3), `reviewed_at`/`started_at`/`clearance_at`/prior completions (Task Center), `issue_flagged_at` (Operator View), the Production Log's generic stamp helper. Comms was checked and was already correct (it adds the `Z` itself). |
| Raw stored strings displayed verbatim | Scale Verification + QA Inspections fixed earlier; the sweep found no others printing full timestamps raw. Date-only slices (`slice(0,10)`) of *date columns* are safe; the one on a timestamp column (equipment files) was fixed. |
| Dates a day early (UTC-midnight parse) | Swept all date-only fields — the only remaining `new Date(date)` constructions already append `T00:00:00` or build from parts. Clean. |
| Number inputs rejecting decimals (the 687.8 kg bug) | **4 more found and fixed**: `ppm_reading`, `atp_reading`, `foot_candles`, `contact_time` on the Operator View QA task forms — sanitizer ppm and contact times are routinely decimal. Counts (`fixtures_checked`, kiosk qty) deliberately stay whole-number. |
| Inner joins dropping NULL `equipment_id` (Task Center bug) | Re-swept: the four fixed joins are the only list paths; `/pm/metrics` byEquipment keeps its inner join on purpose (documented). |
| Named route shadowed by `/:id` | Swept every router mechanically. All flagged candidates are two-segment paths, which a one-segment `/:id` cannot shadow. Verified against live tests. Clean. |
| Pending-QA queries missing the waiver filter | Swept: every `qa_signoff_by IS NULL` query carries `qa_waived_at IS NULL`. Clean. |
| `<select>` silently retyping a record (retired rooms / zone types) | The two known instances fixed earlier. No further selects found whose value can be absent from their options. |
| Two mechanisms disagreeing on one fact | Fixed this cycle: LOTO checklist vs `loto_required` column; sign-out badges vs QA Review counts; readiness roll-up vs detail (same function on purpose). The pattern to watch in review: **any new count should reuse the module's own counting function.** |

### What "we track X" actually means — verified assumptions
- **PM tasks**: the equipment task lists were *not* generating work. Fixed (schedules-from-tasks, bulk review). After the audit-prep pass, verify Task Center shows daily tasks for the machines you expect.
- **Zones vs machines**: now a column, enforced, with the LOTO invariant.
- **Retired equipment**: now stops generating from both generator paths.
- **Waived setup steps**: recorded decisions with a name and reason, never hidden.
- **Every bulk action** (bulk edit, waivers, repairs, schedule creation, cleanup) audits per-record plus a summary row.

## Part 2 — UX/UI review

### Done this pass
- **Share from mobile** — images and documents in Messages, and equipment manuals, now
  have a Share button that opens the phone's native sheet with the *file itself*
  attached (text, WhatsApp, AirDrop, email). Falls back to sharing the link, then
  copying it. Hidden on browsers without the API rather than offered to fail.

### Recommendations — mobile (in priority order)
1. **Camera-first capture everywhere a record wants evidence.** Reimbursements has
   `capture="environment"`; comms attachments and equipment files don't. One
   attribute per input — cheap, and it makes "photograph the label" one tap.
2. **Operator View task list: bigger touch targets on the complete flow.** The
   readings forms are dense at 360px; group each reading with its unit on one row
   and make Complete sticky at the bottom so it never scrolls away mid-task.
3. **Offline banner visibility**: OfflineBar exists; consider a persistent small
   dot in the header when queued writes > 0, since the bar scrolls away.

### Recommendations — comms
1. **Read/unread is in good shape** (dwell-marking, thread fallbacks). The one gap:
   no way to *forward* a message to another channel — people screenshot instead.
   A "Forward to channel…" item in the message menu would close that loop.
2. **Voice notes** — the floor is gloved half the day. Web MediaRecorder → upload as
   an attachment is a modest build and heavily used in plants.

### Recommendations — recurring tasks
1. **The Task Center chips work.** The gap is *why is this task here* — each work
   order should name its schedule ("from: A/C — Weekly PM") as a tappable link.
   Partially true today; make it universal.
2. **Snooze is missing.** Operators complete or ignore; supervisors want "push to
   tomorrow with a reason". That's an audited defer, not a silent one — same shape
   as the waiver pattern.
3. **A weekly PM digest to each team channel** (like the schedule publish) would put
   recurring work where people already look. The notify machinery exists.

### GMP / SQF / auditor posture — where you're strong
Signature discipline (revoke-not-edit), per-record audit on bulk actions, controlled
changes gate, verbatim controlled text, derived (never stored) verdicts, and the
waiver pattern (recorded skips) are all stronger than typical for this size. The
biggest remaining audit risk isn't software: it's the ~110 machines whose PM
schedules were just created — **run the review screens and let the first cycle of
work orders complete before audit day**, so there's history to show, not just setup.
