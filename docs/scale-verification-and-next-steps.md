# Scale Verification: why nobody sees it — and the step-by-step list

Written 29 September 2026, checked against the running code.

---

## Part 1 — Your question about the Daily Scale Verification

### Short answer

**It is not hidden. It was never on the operator's screen at all.**

Scale Verification is a **sidebar shortcut**, under the "Quick Forms" group. It is not a task, so
it never appears in the Operator View ("My Tasks"). I searched the Operator View code for any
mention of scale verification: there is none.

Three things follow from that:

1. **On a phone the sidebar is behind the hamburger menu.** Somebody who lives in the Operator
   View has to leave it, open the menu, scroll to Quick Forms, and tap Scale Verification. There
   is nothing on their task list telling them to.

2. **It only appears for people who have been granted it.** In Settings it is called
   *"Scale Verification (kiosk form)"*. If a supervisor's module list does not have that ticked,
   the entry is not in their sidebar at all and they cannot reach the form.

3. **Nothing anywhere tells anybody a check was missed.** I checked: the bell, the Flash Report,
   QA Review and the notification list all report scale checks **after** they happen — a failed
   reading, or one waiting for QA to counter-sign. **No part of the app reports a scale check
   that simply was not done.** The only place "Not checked today" appears is the Calibration
   screen you screenshotted, which is a QA screen, not a floor screen.

Your screenshot shows the result: Filling was last checked **9/11** — eighteen days ago.

### The part that changes my earlier advice

I told you to start by pausing the Daily Scale PM work orders. **Do not do that yet.**

Those PM cards are, right now, **the only thing that puts a scale check on an operator's phone.**
They are the wrong path — they record a second, weaker version of the check, which is exactly the
duplicate we want to remove — but if you switch them off before Scale Verification has its own
daily prompt, the floor loses the last reminder it has and the checks will lapse further, not
less.

**Correct order:** give Scale Verification a daily prompt on the Operator View first. Then retire
the Daily Scale PMs. I have put that at the top of the code list below.

---

## Part 2 — What YOU do, step by step

Five jobs. Two of them are ten minutes. None of them needs me.

---

### JOB 1 — Make sure the people who run the scale checks can actually open the form
**Who:** you, or anyone with Settings access · **Time:** 10 minutes · **Do this first.**

1. Click the **gear icon** in the top bar → **Settings**.
2. In the left list of Settings, click **Users**.
3. Find each **supervisor** who runs a morning scale check. From your screenshot, that is whoever
   covers: Batching Platform, Batching Pallet, Stick Filling, Filling, and Kitting.
4. Click **Edit** on that person.
5. In the **Module access** box, use the filter and type `scale`.
6. Tick **Scale Verification (kiosk form)**. Set it to **Edit** (not View — they have to file).
7. Save.
8. Repeat for each supervisor.

**How you know it worked:** ask one of them to open ReadyDoc on their phone, tap the menu, and
confirm **Scale Verification** now appears under *Quick Forms*.

**If it was already ticked for all of them** — then the problem is purely that nothing reminds
them, which Job 5 (my code work) fixes. Tell me either way; it tells us which of the two it is.

---

### JOB 2 — Clean up the PM checklists that ask for the wrong work
**Who:** you or Adam · **Time:** 30–45 minutes · **Nothing here is dangerous — every button shows
you a preview first and nothing is written until you confirm.**

There is a banner on the Equipment screen that has said the same thing since 5 September. The
repair buttons next to it have never been used once. That is the whole problem — it is built and
waiting.

1. Open **Equipment** from the sidebar (Maintenance group).
2. Look at the top of the screen for coloured banners. You may see up to three. Work them in this
   order, top to bottom:

   **a) Red banner — "N machines have maintenance tasks split mid-sentence"**
   - Click **Review and repair**.
   - You will see a before/after list. An import broke sentences at their commas, so one task
     reads as eight, some of them single words like "leaks".
   - Tick boxes are pre-ticked only where it is obviously safe (single-word fragments).
   - Read down the list. Untick anything that looks like a real separate task.
   - Click the confirm button at the bottom.

   **b) Amber banner — "15 PM checklists carry steps from other frequencies"**
   - Click **Review and re-sync**.
   - This one is the big one. A daily check is handing the operator the annual work too, so the
     list is far longer than it should be and the ticks stop meaning anything.
   - Review the preview, then confirm.

   **c) Red banner — "N PM checklists ask for several frequencies at once"**
   - Click **Review and split**.
   - Same idea, one level worse: a whole procedure pasted into one schedule.
   - Some of these will say **"needs a person to decide"** — leave those alone for now and tell
     me the count.

3. After each one, the banner should disappear or the number should drop.

**How you know it worked:** the amber banner no longer says 15. Then open Task Center and look at
a daily PM card — the step list should be short and all of it should be daily work.

---

### JOB 3 — File one real ATP reading
**Who:** whoever does the pre-op clean, with you or Adam watching · **Time:** 15 minutes ·
**Do this on a morning when a Pre-Op clean is actually due.**

Background: the box to type the ATP number in was missing from two different screens. Both are
fixed and deployed. We now need one real reading to prove it works end to end on the plant's own
database.

1. **First, have them force-refresh.** On their phone: close ReadyDoc completely and reopen it.
   If a bar appears saying *"Update available — tap to refresh"*, tap it. This matters — without
   it they are running the old version and the box will still be missing.
2. Have them open **My Tasks** (Operator View) and find a **Production Line Pre-Op** clean.
3. Tap **Complete**.
4. **Confirm the ATP box is there.** It is labelled *"ATP swab reading (RLU)"*.
5. Type the real number from the swab.
6. Confirm the green or red hint appears underneath, naming **35 RLU** as the limit.
7. Submit.
8. Now open **Sanitation Records** and find that record. It should show the number you typed and
   **35** beside it — not a dash.

9. **Then repeat once from a desk.** Open **Task Center**, find a Pre-Op card, click **Done**, and
   confirm the same ATP box is on that form too.

**How you know it worked:** one record in Sanitation Records with a real ATP number and a 35
limit. Tell me the number and I will confirm it graded correctly.

**If the box is NOT there after refreshing** — stop and tell me. That is a code problem and I
will fix it.

**If the box IS there and people still leave it blank** — that is a training matter, not a code
one, and worth knowing.

---

### JOB 4 — Calibration: already done, no action
Your screenshot confirms it: **32 total · 28 current · 0 overdue · 4 out of service**, and
28 + 4 = 32. The two instruments that were being miscounted as "current" are now in their own
Out of Service box. **Cross this off.**

---

### JOB 4b — Flat Our Feed Conveyor #49 / #50 (from your run of Job 2)
The duplicate detector only flags two rows when they share **both** the name **and** the asset number.
So those two rows currently carry the same asset number in the register. Open **Equipment**, find both
Flat Our Feed Conveyor rows, click **Edit** on each, and check the **Asset #** box — one of them almost
certainly says `49` and should say `50`. Save, and the banner clears on its own. Not a code problem.

### JOB 6 — Retire the Daily Scale PMs (do this AFTER the deploy with the new scale strip is live)
**Who:** you or Adam · **Time:** 15 minutes · **Safe:** nothing in the code re-creates these.
1. Have a supervisor open **My Tasks** on their phone and confirm an amber **"Scale checks due today"**
   box now appears at the top with a **Run the check** button. If it is not there, stop and tell me.
2. Open **Task Center** → the **Recurring Schedules** tab.
3. In the search box type `scale`.
4. For each of: **Vevor Scale — Daily PM (#148)**, **Daily PM — 81 Uline Scale**, **Counting Scale —
   Daily PM (#84)**, **Daily PM Checklist — Kitting (Warehouse) (#87)**, and **Kitchen Tour Scale
   #0151** if it is there: click **Pause**.
5. When it asks, note it says how many open cards it is leaving behind — that is the missed cards since
   8/24. They are listed under **Settings → Cleanup Review**; close them there with the reason
   *"Replaced by Scale Verification (Form 417)"*.
**How you know it worked:** the Operator View no longer shows "Vevor Scale — Daily PM" cards, and the
amber scale strip is what prompts the check instead.

### JOB 5 — The Sanitation area list: **unblocked (D-118, deploying with this push)**
**Who:** you, Adam or Maria · **Time:** 10 minutes · **After the deploy lands.**
1. Open **Sanitation** from the sidebar.
2. At the top there is an amber strip. It now says two things: how many *records* are filed under an
   odd spelling, and how many *options on the Area dropdown* the app does not recognise. Click **Review**.
3. Click **Apply**. The "Room 7 (72 hr) cleanning" and "Room 8 (72 hr) cleanning" rows fold onto Room 7
   and Room 8, their records move, **and those two options leave the dropdown** in the same click.
4. What is left are the ones the app will not decide for you — **"Simple Green"** (twice) and
   **"Sanitizer Dilution"**. Those are chemical checks, not places. Each has a **Retire from
   dropdown…** button; click it, type why (e.g. *"a chemical, not an area"*), and it leaves the form.
   Records already filed under them are left exactly as they are.
5. Open the record form and check the Area dropdown: one spelling per room, no chemical names.

**How you know it worked:** the amber strip is gone, and the dropdown reads Room 1 … Room 15, Batching
1–3, Restrooms, Breakroom, Warehouse & Grounds, QA Room, Chemical Verification, Production — nothing else.

**One decision for Maria, not for me:** the records already filed under "Simple Green" and "Sanitizer
Dilution" are chemical dilution checks (FORM 106-01). Whether they should be moved under *Chemical
Verification* is Quality's call. The app leaves them as filed until somebody says.

---

## Part 3 — What I do, in order

### 1. Put Scale Verification on the Operator View  ← **DONE 29 Sep (D-117), deploying with this push**
Give the daily scale check a card on the operator's own task screen, the way every other daily
check has one, so nobody has to know the sidebar exists. Then, and only then, the Daily Scale PM
work orders can be retired without losing the prompt.

Also: report a check that **was not done**. Right now the app can tell you a scale check failed,
and can tell you one is waiting for QA — but it cannot tell anyone one never happened. That is
why Filling went eighteen days.

### 2. Retire the Daily Scale PM programs
**Unblocked now that #1 is deployed — see the note at the bottom of Part 2 for the exact clicks.** This is the duplicate-record problem: two programs recording one activity. Safe
to do — I checked, nothing in the code re-creates these schedules, so pausing them sticks through
a deploy. The ones to retire: Vevor #148, Uline #81, Counting Scale #84 and #87, and re-check
Kitchen Tour #0151.

### 3. Fix the Sanitation area list (two bugs)  ← **DONE 29 Sep (D-118)**
- **Bug one:** the dropdown on the cleaning form and the app's real list of areas are **two
  separate lists**, and nothing compares them. So the "Normalize" button cleans up the *records*
  and leaves the *dropdown* offering all the same bad options tomorrow. That is why this has not
  cleared by itself.
- **Bug two:** the cleanup cannot recognise your most common spelling. `Room 7 (72 HR cleaning)`
  gets folded correctly; `Room 7 (72 hr) cleanning` — the one your dropdown actually shows — is
  refused outright. Every record filed that way is invisible to the 72-hour re-clean rule.

### 4. Update the obligations register  ← **DONE 29 Sep (D-119): 41 obligations, 13 landed · 23 open · 5 drafted**
It has not moved since 9 September and it undersells you. It says 5 of 33 done. But the software
has actually shipped for eight more, including the Food Defense challenge you got yesterday. The
plant half of those is genuinely still open — so the register needs to show both halves
separately, instead of showing everything as untouched.

### 5. Put 16 orphaned tests back into the main test run  ← **DONE 29 Sep (D-120): 14 scripts, 11 entries, 340 assertions; three had rotted**
Including — and this is the embarrassing part — the one covering the sanitation area list I just
found broken in two ways. A test nobody runs cannot fail.

### 6. The reachability pass
The pattern behind almost everything above: **the thing is built, it works, and it is on a screen
the person who needs it never opens.** Scale Verification is the clearest example yet. Eleven of
the last twenty fixes have been this same shape. Going forward, every mechanism should name the
screen its user actually opens, and be tested there.

---

## Part 4 — Not yours and not mine (Document Control)

Seventeen change requests are waiting on Daniela in `docs/v2/queued/`. None of them blocks
anything above. The ones that have been waiting longest:

- FORM 106-01 V4 — the dilution form (two of its four chemicals have never been logged, and
  Lysol is mixed daily with no written ratio at all)
- The forklift practical evaluation form
- The recall flow chart
- FORM 431-01 re-issue (the brittle plastic diagram)
- The two annual review record forms from yesterday

This queue is now the biggest single thing outside the app holding work up.
