# One SKU, everywhere — the cutover runbook

**For:** Lowry and Chris. Work through it together, in order, ticking as you go.
**Status:** draft for review. Nothing below has been started.

---

## What we are actually doing

Every product gets **one** code, in the new standard, used identically in ReadyDoc,
ShipHero, Shopify and everywhere downstream.

The new standard is `<LINE>-<PACK>-<FLAVOUR>` — `WHY-PLG-BLM` is whey, large pouch,
Blueberry Muffin. No serial number, no pack hidden in a prefix.

**All 118 active products resolve to a new-standard code today, and not one of them
already matches.** So this is 118 renames, every one a real change. There is no
subset that is free.

---

## The one fact that makes this safe

**The GS1 barcode never changes.** All 118 products carry a valid GTIN and every one
of them keeps it. A scanner reads the barcode, not the SKU — so at no point in this
project is a physical pallet, case or pouch ambiguous about what it is.

That is worth saying out loud to anyone who gets nervous: **we are not relabelling
anything.** We are changing a text key inside software.

## The two facts that make it expensive

1. **ShipHero keys inventory locations and open order lines to the SKU.** Change the
   code without moving those, and on-hand quantity detaches from its bin.
2. **Shopify stamps the SKU onto each order line at the moment of sale.** Orders
   already placed keep the old code for ever. **This cannot be undone**, on any
   timeline, by anybody — so SKU-grouped sales reporting splits into two buckets at
   the cutover date and stays split.

Point 2 is the one to decide on before anything else. It is not a risk to be managed;
it is a price to be paid.

---

## Recommended shape: three waves, not one weekend

Doing 118 at once is possible and is not advisable. The mechanism is identical at any
size, so prove it on something that cannot hurt, then on something small, then finish.

- **Wave 0 — the 33 bottle drafts.** They have never been sold, never been picked, have
  no GTIN and exist nowhere but ReadyDoc. Renaming them proves the whole path with
  zero exposure. ReadyDoc already has the button.
- **Wave 1 — one active line, smallest first.** Real, reversible-ish, and it is where
  you find the thing nobody thought of.
- **Wave 2 — everything else**, once Wave 1 has been quiet for a full reporting cycle.

If a wave goes wrong, the damage is bounded by the wave.

---

## Phase 0 — Decide (before any system is touched)

- [ ] **Decide to accept the Shopify reporting split.** Write the cutover date down;
      every SKU-grouped sales report from now on is read as "before" and "after".
      *Owner: Lowry. This is the go / no-go.*
- [ ] **Decide the wave shape** (above, or something else) and which line is Wave 1.
- [ ] **Freeze the code list.** The 118 new codes come out of ReadyDoc's *New standard*
      column. Export it, read it once, and agree it is right — because a code that
      changes after Wave 1 means doing Wave 1 twice.
- [ ] **Name one owner per system.** ShipHero, Shopify, Amazon, ReadyDoc, MRP,
      packaging POs. A system with no name against it is the one that gets missed.
- [ ] **Agree the freeze window** — a period with no picking, no receiving and no
      selling. Realistically a weekend; confirm with the 3PL what notice they need.

---

## Phase 1 — Questions to answer first

These are genuinely open. Each one can change the plan, so answer them before Phase 2
rather than discovering them mid-cutover.

- [x] ~~**Is the SKU printed on the pack?**~~ **Answered: it is not.** Nothing on the film
      carries the SKU, so no pack can ever disagree with the system and no artwork
      revision is needed. **The artwork half of this project is free** — which was the
      single biggest thing that could have made it expensive, and it does not apply.
- [x] ~~**Does ReadyDoc know about Amazon?**~~ **Answered: it does now.** Every product
      carries *Sold on Amazon?* (not decided / listed / not sold), its seller SKU and its
      ASIN, and a **Listed on Amazon** readiness step that goes amber the moment the SKU
      or GTIN moves — exactly like Shopify and ShipHero. The remaining work is the
      decision, not the software.
- [ ] **Set the Amazon channel on every active product.** Products → open each one →
      *Sold on Amazon?*. Until that is set, the product owes no Amazon step — which is
      correct, and is also why its punch list would otherwise look empty. Data health
      reports the *Not decided yet* count; work it to zero before Wave 1.
- [ ] **Confirm what Amazon keys on, for the ones marked listed.** A listing hangs off the
      seller SKU, and FBA stock already in a fulfilment centre is bound to it — the single
      most likely place to strand inventory. Whether that seller SKU can be changed in
      place or needs a new listing is Amazon's answer, not ours.
- [ ] **Any other channel keyed on the SKU?** Faire, a broker portal, a retailer's EDI
      feed, a co-man's system. List them or confirm there are none.
- [ ] **Does anything published to GS1 carry the SKU?** The GTIN itself is unaffected.
      If the GS1 registry entry or a GDSN feed carries a "product code" field, it needs
      updating; if not, GS1 is a no-op for this project.
- [ ] **Open purchase orders.** A PO quoting the old code stays valid — `legacy_sku`
      keeps it resolvable for ever — but Mike and the packaging vendor should be told
      which code to use on the *next* one.
- [ ] **MRP.** MRPEasy is being replaced by Keychain. Ask whether the rename should
      happen before, during, or after that move; doing it twice would be avoidable work.

---

## Phase 2 — Freeze and snapshot

Nothing here changes a code. This is the material that makes a rollback possible.

- [ ] Pause the ShipHero ↔ Shopify sync. *Owner: Chris.*
- [ ] Stop picking and receiving for the window.
- [ ] **Take an on-hand inventory snapshot out of ShipHero** — SKU, location, quantity,
      lot. Save it somewhere neither system can overwrite.
- [ ] **Export the Shopify product list** (all products, CSV) and file it in ReadyDoc
      under Products → Registry, so the "before" is a record rather than a download.
- [ ] **Export the ShipHero SKU / inventory list** and file it the same way.
- [ ] **Back up ReadyDoc** (Settings → Data & backup).
- [ ] List every **open order** and every **open PO** at the freeze moment. These are
      the rows that live across the boundary, and they are where problems show up.

**Gate:** do not start Phase 3 until all three exports exist and have been opened and
looked at. An export nobody read is not a backup.

---

## Phase 3 — ShipHero first

ShipHero goes first because it holds the physical state. If it is wrong, everything
after it is wrong about real inventory.

- [ ] Rename the wave's SKUs in ShipHero. *Owner: Chris — and Chris decides the method
      (bulk update, or the SKU-change tooling ShipHero provides). The requirement is
      below, not the mechanic.*
- [ ] **Confirm each renamed SKU still holds its inventory locations**, at the same
      quantities as the Phase 2 snapshot. Location and quantity are the whole point.
- [ ] **Confirm open order lines still resolve** to the renamed SKU — no orphan lines,
      no lines pointing at a code that no longer exists.
- [ ] Confirm the barcode / GTIN mapping is untouched, so scanning still works on the
      floor exactly as before.
- [ ] Spot-check three bins physically against the system.

**Gate — stop here if anything disagrees with the snapshot.** Rolling back one system
is a bad afternoon. Rolling back three is a bad month.

---

## Phase 4 — Shopify

- [ ] Update the SKU on every affected variant. Keep the barcode field as it is.
- [ ] **Do not touch the variant IDs.** Four products carry a Shopify variant ID in
      ReadyDoc and those are the join, not the SKU.
- [ ] Confirm that orders placed *before* the cutover still show the old code. They
      should, and that is correct — it is the record of what was sold.
- [ ] Confirm a test order placed *after* the cutover carries the new code all the way
      into ShipHero.

---

## Phase 5 — ReadyDoc

ReadyDoc is deliberately last of the three. It is the only one of them that can be
put back, so it should be the one carrying the least risk.

- [ ] Rename each product (Products → the product → Rename). This is its own action
      rather than an ordinary edit, so every rename lands in the audit log as a
      deliberate act with a name and a time.
- [ ] **`legacy_sku` is set automatically and is never cleared**, so a two-year-old PO,
      an old Shopify order line and any historical record still resolve. Nothing needs
      doing to make that true, and nothing should be done to undo it.
- [ ] **The renames write their own punch list.** Every renamed product's *Listed in
      Shopify*, *Synced to ShipHero* and — where the product is marked as sold there —
      *Listed on Amazon* steps go **amber (stale)** the moment the code moves, naming the
      SKU as what changed. Work that amber list down to zero — it is the re-verification
      checklist, and it is generated rather than typed.
- [ ] Re-tick each step only once you have actually looked at that product in that
      system. Ticking to clear amber is how the list stops meaning anything.
- [ ] Confirm the GS1 barcode step stayed green throughout. If it did not, something
      touched a GTIN and that needs investigating before anything else.

---

## Phase 6 — Everything downstream

- [ ] **Artwork-Proofing feed.** ReadyDoc's `master.csv` is what the proofing service checks labels
      against, and its `sku` column carries the current code. The SKU is not on the pack and ingest
      resolves by GTIN before SKU, so nothing should move — run one proof and confirm.
- [ ] **Amazon.** For every product marked *listed*, update the seller SKU, then re-tick **Listed on
      Amazon** in ReadyDoc so the amber clears. Watch FBA inventory for a week afterwards.
- [ ] **MRP / Keychain**, per the Phase 1 answer.
- [ ] **Packaging POs.** Tell Mike which code goes on the next PO.
- [ ] **Anyone who types a SKU by hand** — the office, the warehouse, whoever builds
      pick lists. They need the new list and a week of tolerance.
- [ ] **Saved reports, spreadsheets and dashboards** that group by SKU. These break
      quietly. List them now; fix them in the week after.

---

## Phase 7 — Unfreeze and watch

- [ ] Restart the ShipHero ↔ Shopify sync.
- [ ] Place one real order end to end and follow it: Shopify → ShipHero → picked →
      shipped. Watch the code at each hop.
- [ ] Receive one real pallet end to end.
- [ ] Re-run the on-hand report and reconcile against the Phase 2 snapshot, line by
      line. **Any difference is the project's fault until proven otherwise.**
- [ ] Watch for a full week before starting the next wave.

---

## Rollback

| If it breaks in… | Position |
|---|---|
| **Phase 3 (ShipHero)** | Rename back from the Phase 2 snapshot. Nothing else has moved. |
| **Phase 4 (Shopify)** | Rename back in Shopify, then in ShipHero. Orders placed in between keep whichever code they were stamped with — that is the point of no return, and it is why Phase 4 is short and immediately verified. |
| **Phase 5 (ReadyDoc)** | Rename back in ReadyDoc. `legacy_sku` keeps history resolvable either way. Cheapest of the three. |
| **After Phase 7** | There is no rollback. Forward only. |

---

## What ReadyDoc does and does not do for you

**Does:**
- Holds the agreed new code for all 118 products (*New standard* column).
- Renames as a first-class, audited act — not a field edit.
- Keeps the old code for ever (`legacy_sku`), so nothing historical stops resolving.
- **Writes the re-verification punch list itself** — Shopify, ShipHero and Amazon go stale on every
  renamed product and come back onto the list until someone confirms them.
- Holds the Amazon channel, seller SKU and ASIN, and reports how many products nobody has decided on yet.
- Files the before/after exports from both systems (Products → Registry) so the
  evidence lives with the project instead of in a downloads folder.

**Does not:**
- Touch ShipHero or Shopify. Nothing in ReadyDoc reaches either system; every rename
  in those is done by a person in that system.
- Reach Amazon, Shopify or ShipHero. It records the channel and the confirmation; every change in
  those systems is made by a person in that system.
- Decide the order. That is this document.
