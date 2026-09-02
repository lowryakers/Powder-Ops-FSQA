# Artwork-Proofing sync — what ReadyDoc still owes

**Raised 2 September 2026 by the Artwork-Proofing service** (`lowryakers/Artwork-Proofing`,
branch `claude/nfp-net-weight-reconciliation`). Four new checks shipped there; three of them need
something on this side. **Verified against `main` at `6b070a8` — the status column is what the code
actually says, not what was assumed.**

Written down because a session is disposable and the repository is the thread. Nothing here is built.

---

## 1. New check keys — ✅ nothing to do

`netwt`, `prep`, `ingredients`, `claims` file without any change. `ingestRouter.post('/')` stores
`check_name` as free text capped at 120 characters, so the four new keys land beside the existing
gtin / nfp / eyemark / spelling / fda / specs / wind.

## 2. `FILL WEIGHT (g)` on `master.csv` — ❌ does not exist

`CSV_HEADERS` in `server/api/products.js` emits exactly the sixteen headers the proofer matches on.
There is no fill-weight column there and **no fill-weight column on `products` at all**.

Extra columns are free — the proofer skips headers it does not recognise — so adding one is safe.
Accepted aliases its parser takes: `Fill Weight (g)`, `Fill Weight`, `Fill Wt (g)`, `Net Fill Weight`.

**The data is the hard part, and it is not a software question.** 118 SKUs, and nobody has ever
entered a fill weight. Until they are entered the check reports UNVERIFIED, which is the honest
state — the same line the readiness checklist takes on Shopify SKU and MRP formula.

## 3. `GET /api/artwork/snapshot?gtin=&sku=` — ❌ no such route

`server/api/artwork.js` has nine routes and this is not one of them. The proofer falls back to its
own job history meanwhile, so checks 3 and 4 still run — they just cannot compare against what
ReadyDoc holds.

## 4. `snapshot` on ingest — ❌ accepted and dropped

The handler destructures `job_id, sku, gtin, component, checks, drive_url, summary`. An extra
`snapshot` field is silently ignored: backward-compatible, and stored nowhere. So there is nothing
for a future revision to compare against.

---

## What building it looks like

- `artwork_snapshots` — its own table, keyed on the artwork version, holding the label content
  (ingredients, callouts, claims, serving size) **as sent**. Frozen, like `coa_submissions.body`:
  correcting a product next week must not rewrite what a proofing run actually saw.
- Ingest stores it in the same transaction as the version and its checks.
- `GET /artwork/snapshot` returns the latest snapshot for a GTIN or SKU. **Declared before `/:sku`**
  or Express reads "snapshot" as a SKU — the `master.csv` trap, already documented.
- `products.fill_weight_g` + a `fill weight (g)` header + somewhere to type it. A nullable column and
  a blank cell, never a guess: a wrong fill weight fails a check that should have passed, which is
  how people learn to ignore a check.

## Verify once it is deployed

- A batch with a known SKU that has a fill weight → the Net Weight check reads PASS/FAIL, not
  UNVERIFIED.
- Re-proof a SKU proofed before → Ingredient and Claims checks show a comparison, not "no prior
  version on file".
- The proofed version appears in ReadyDoc's artwork history with its snapshot attached.
