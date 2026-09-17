# The artwork hand-off: what it does today, and where it's short

Written for Lowry. Everything below is checked against the code as it stands (ReadyDoc `main`,
and Artwork-Proofing at commit `f4cba69`, 16 Sept 2026) — not against what a doc from a month ago
claimed. Where a citation says `file:line`, that's the exact spot to look if this ever needs
re-checking.

**Bottom line up front:** the ReadyDoc side is in good shape — everything the 2 September sync
note (`docs/v2/landed/artwork-proofing-sync.md`) asked for has been built and verified. The real
gaps are on the *proofing* side (`lowryakers/Artwork-Proofing`), and they're both small, both
concrete, and neither needs a redesign. I can't push code there (read-only access), so those two
are written up precisely enough to hand to whoever maintains that repo.

---

## 1. ArtProof.Live ↔ ReadyDoc — pull, push, or both?

**Both — but ReadyDoc never initiates anything.** Every call in both directions is made *by* the
proofing service, outward to ReadyDoc. ReadyDoc has no webhook, no callback, nothing that reaches
into the proofing service. There are three separate calls, not one integration:

### Flow A — the catalogue (pull, on a timer)

1. The proofer holds a URL (`GTIN_SHEET_URL` — see below) and refetches it whenever its own
   5-minute in-memory cache is stale (`app.py:36-37, 302-312`).
2. It GETs that URL. ReadyDoc's `GET /api/products/master.csv` checks the token
   (`server/api/products.js:1057-1063`), then emits one CSV row per non-discontinued product with
   the **seventeen** columns the proofer's parser matches on — sixteen original contract columns
   plus `fill weight (g)` (`server/api/products.js:1071-1079, 1106`).
3. The proofer parses it into per-SKU spec rows (`app.py:171-298`) — this is the "should be" every
   artwork file gets checked against: fill weight, wind direction, PMS/hex colours, die-line
   requirement, material, dimensions.
4. If the fetch fails — wrong token, network error, or a non-CSV body (login page, JSON error) —
   the proofer **does not stop checking**. It logs the failure, shows a warning banner in its own
   UI, and keeps using the last good copy in memory (`app.py:180-195, 320-333`). A silent 401
   looks, from the outside, exactly like nothing happened — which is exactly what did happen to
   this feed for a while (see §5, item 1).

### Flow B — the prior label snapshot (pull, per file, mid-check)

1. Before running the checks that compare *this* proof against the *last* one (ingredients
   changed? claims changed? net weight still reconciling?), the proofer calls
   `GET /api/artwork/snapshot?gtin=&sku=` on ReadyDoc, using `READYDOC_URL` + `READYDOC_TOKEN`
   (`readydoc.py:77-96`, ReadyDoc side `server/api/artwork.js:131-150`).
2. ReadyDoc returns the most recent stored label content for that product — frozen from the last
   time a version was filed with a snapshot attached.
3. ReadyDoc is explicitly preferred over the proofer's own local job history; the local history is
   only a fallback if ReadyDoc has nothing or is unreachable (`proof_engine.py:2397-2408`, the
   comment literally says "Prefers ReadyDoc (the QA team's canonical artwork history)"). Nothing
   here ever raises an error that stops a check — a missing prior version just means that one
   comparison is skipped.

### Flow C — the proofing results (push, after every job)

1. When a proofing job finishes, results are handed to `publish_job_async`, which runs in a
   background thread — the person waiting on the proofing page is never blocked by this, and a
   ReadyDoc outage can never fail a job that otherwise succeeded (`proof_engine.py:280-290`,
   `readydoc.py:175-179`).
2. **Per file, not per job** — one job can carry a pouch and a stick, and those are two products
   with two separate version histories (`readydoc.py:151-153`). A file with no decoded barcode
   *and* no matched spec row is skipped outright — never filed under a guess (`readydoc.py:144-148`).
3. For everything else, it POSTs to `/api/artwork/ingest` with the job id, GTIN, SKU, a one-line
   summary, the flattened list of checks, and the label-content snapshot (`readydoc.py:150-163`).
4. ReadyDoc resolves the product (GTIN first, SKU as fallback — a decoded barcode is the only
   identification actually trusted), creates or updates the `artwork_versions` row (get-or-create
   on job id + SKU + component, so a retry never double-files), replaces that version's checks, and
   stores the snapshot — all in one transaction (`server/api/artwork.js:407-466`).
5. ReadyDoc answers with `version_id`/`version`/`failures`/`warnings`/`replaced`. **The proofer
   currently does nothing with that answer** — no follow-up call, no file attached. See §5, item 1.

### Env vars — what should be set

| Variable | Lives on | What it does |
|---|---|---|
| `PRODUCT_MASTER_TOKEN` | **ReadyDoc** (Railway → Variables) | Gates *both* `GET /api/products/master.csv` and `POST /api/artwork/ingest` — it's the same check in both files (`server/api/products.js:1057-1063`, `server/api/artwork.js:386-392`). Unset = both directions off. |
| `GTIN_SHEET_URL` | **Proofer** (Railway → Variables) | The *entire URL* the proofer pulls the catalogue from — for ReadyDoc that's `https://<readydoc-host>/api/products/master.csv?token=<PRODUCT_MASTER_TOKEN>`, token baked into the query string. This is **not** the same pair as the two below — it's a single value, and it can also legitimately point at a Google Sheet instead of ReadyDoc. |
| `READYDOC_URL` | **Proofer** (Railway → Variables) | Base URL for the ingest POST and the snapshot GET — e.g. `https://start.powder-ops.com`. |
| `READYDOC_TOKEN` | **Proofer** (Railway → Variables) | Same value as ReadyDoc's `PRODUCT_MASTER_TOKEN` — one shared secret, two names (`readydoc.py:16-19`). |

**For a working hand-off, all four need to be set, and `GTIN_SHEET_URL` needs to actually point at
ReadyDoc** (see §5, item 4 — this is the one that can silently drift). ReadyDoc's own
Settings → Integrations page (`server/api/integrations.js:150-159`) shows whether
`PRODUCT_MASTER_TOKEN` is set, but has no visibility into the proofer's three variables — those can
only be checked on the proofer's own Railway project.

### The live ArtProof.Live / Railway URL

**Not documented anywhere in either repository.** I checked both repos for `railway.app`,
`artproof`, `ArtProof`, and `.live` — no hits, and Artwork-Proofing has no README at all. Whoever
set `GTIN_SHEET_URL` (or the proofer's own `/gtin` settings page) knows the current ReadyDoc host
it points at; that's the fastest way to get the real URL, short of opening the proofing service's
Railway dashboard directly. Worth adding here once confirmed.

---

## 2. Files — does Artwork store real files, or just metadata?

**Both, but not for the same versions.** A version's *record* — status, checks, snapshot — always
exists the moment it's filed, whether by hand or by proofing. A version's *file* only exists when
someone (a person, not the proofing service) has uploaded one. Today, that means proofing-sourced
versions have checks and a snapshot but **no file** — see §5, item 1 for why.

### The four tables

| Table | Holds | Notes |
|---|---|---|
| **`artwork_versions`** | One row per SKU + component + revision number: status (`draft → in_review → approved → print_ready → superseded`, or `rejected`), which NFP version it was drawn against, who approved/released it and when, `drive_url`, `proof_job_id`. | `db.js:3021-3049`. `source` is `'upload'` or `'proofing'` — how the row came to exist, not what's attached to it. |
| **`artwork_files`** | The actual bytes, in R2 — only the storage key is in the database. `kind` is one of `print_pdf`, `preview`, `dieline`, `proof_report`, `other`. | `db.js:3055-3069`. A `preview` is meant to be a rendered PNG of page 1, "which is what lets the list show the actual pack instead of a filename" — see §5, item 1 for why that comment is currently aspirational for proofing-sourced versions. |
| **`artwork_checks`** | One row per check result: pass / fail / warn / dismissed, with detail, expected/found, who checked it, and — if dismissed — who waved it through and why (never deleted, just marked). | `db.js:3090-3104`. |
| **`artwork_snapshots`** | What the proofing run actually *saw* on the label — ingredients, claims, servings, net weight — as text, frozen at the moment of that proof. One per version; a retry of the same job replaces it rather than adding a second copy. | `db.js:3079-3088`, written in `server/api/artwork.js:460-465`. |

There's also `products.drive_url` — a separate, product-level Drive link, not tied to any one
artwork version (`ProductsPanel.jsx:327`). It's a general reference for the SKU, distinct from
`artwork_versions.drive_url`, which is per-revision and (today) always empty for proofing-sourced
rows — nothing in the proofing service tracks a Drive link per file (confirmed: no Drive reference
anywhere in `app.py` or `proof_engine.py`).

### When is there no local file?

**Right now: every single version that arrived via automatic proofing.** The proofing service's
hand-off script (`readydoc.py`) only ever posts the JSON metadata (checks + snapshot) to
`/api/artwork/ingest`; it never calls the matching file-attach route,
`POST /api/artwork/ingest/:id/files`, even though that route already exists and works
(`server/api/artwork.js:477-505`). So a version filed by proofing today has real checks, a real
snapshot, and a placeholder icon on the board where the pack should be
(`ArtworkPanel.jsx:45-62`, `Thumb` falls back to a generic image icon when there's no `preview`
file).

A file *does* land when:
- Someone attaches one by hand in the version drawer ("Attach a file",
  `ArtworkPanel.jsx:292-298` → `POST /artwork/versions/:id/files`), or
- Someone runs "Import from a folder" (`ArtworkPanel.jsx:352-364` →
  `ProductFileImport.jsx` → `server/api/product-file-import.js:84-113`) — this is the same importer
  used for nutrition panels, matches files to SKUs by GTIN/filename, and genuinely uploads the PDF
  to R2.

Neither of those is automatic. Today, "no local file" is the default for a proofing-sourced
version, not an edge case.

---

## 3. Protocol — from a product's fill weight to a PM seeing it

Roles below are named where the code or the sync notes actually name them (`readydoc.py`'s own
comment: *"already receives every file Shaun sends and every proof Mike returns"*); where nothing
says who does a step, it's left role-neutral rather than guessed.

1. **Fill weight is typed into the product record.** Someone opens the product drawer in
   Products, types the fill weight in grams — "from the production formula, confirmed by weighing
   a sealed bag," per the field's own hint — and saves. Blank until someone actually weighs a bag;
   a guess here would make the net-weight check compare the label with itself and pass everything
   (`ProductsPanel.jsx:328-337`).
2. **It reaches the proofer within 5 minutes**, the next time the proofer's cache refreshes and it
   re-pulls `master.csv` (Flow A above).
3. **Shaun sends the artwork; Mike returns a proof.** The file goes through the proofing site
   (upload/check UI in `app.py`/`templates/`), which runs the full check suite — GTIN, net weight
   vs. the fill weight from step 1, nutrition panel vs. front-of-pack, eyemark, spelling, FDA
   compliance, prep-block type, ingredient-statement changes, claims, print specs, wind direction
   — against the master row and, where a prior version exists, against ReadyDoc's stored snapshot.
4. **The job finishes → ReadyDoc gets a version.** A new `artwork_versions` row appears
   (`status: in_review`, `source: proofing`) carrying every check result and the label snapshot.
   No PM action needed for this step to happen.
5. **QA (or an admin) reviews it in the Artwork tab.** Anyone with the `qa`/`quality` department or
   `supervisor`/`admin` role can see the checks, dismiss a failing one with a reason (the reason
   stays on the record — nothing is silently waved through), and move the version through
   `in_review → approved` (`server/api/artwork.js:37, 250-285, 295-302`).
6. **Only QA or an admin releases to print.** `canRelease` is stricter than `canManage` — a
   supervisor can prepare a version but not release it (`server/api/artwork.js:40`). Release is
   **refused** if any check is still failing and undismissed, or if the version wasn't drawn
   against the product's current approved NFP (`server/api/artwork.js:304-332`).
7. **Releasing supersedes every other live version of that SKU + component**, and stamps the
   product's own `artwork_status`/`artwork_version` fields so the catalogue and the readiness
   checklist can't disagree with this table (`server/api/artwork.js:342-362`).
8. **A PM (or anyone) reads the result off the Products catalogue and readiness checklist** — no
   separate lookup, no Drive folder, no asking Shaun or Mike what the current state is.

---

## 4. PM value — what this buys over "just use Drive"

- **Missing art is a list, not a guess.** `GET /artwork` returns every active SKU with zero
  artwork versions on file, computed live (`server/api/artwork.js:113-120`, rendered as the
  "No artwork on file" counter in `ArtworkPanel.jsx:386-393`). A Drive folder can tell you what's
  *in* it; it can't tell you what's supposed to be there and isn't.
- **A print-ready gate that actually blocks.** Nothing reaches `print_ready` with an open failing
  check or against a nutrition panel that isn't the product's current approved one
  (`server/api/artwork.js:304-332`). A Drive folder has no such check — someone could send an old
  NFP to the printer and nobody would know until the boxes arrive.
- **Proof history that survives a rename or a "which version did we approve" argument.** Every
  version is kept, never overwritten; a released version supersedes rather than replaces, and every
  check — including the ones somebody dismissed, and why — stays on the record
  (`server/api/artwork.js:267-285`, `db.js:3090-3104`). A Drive folder overwrites files or
  accumulates `_v2_FINAL_final2` copies with no reasoning attached.
- **The fill-weight check is a real reconciliation, not an eyeball.** It compares the label's
  declared net weight and serving math against the actual weighed fill from the production
  formula — not against what the label itself claims (`ProductsPanel.jsx:328-335`,
  `proof_engine.py:1803-2028`). Nobody has to notice by hand that a serving size doesn't add up.
- **One place ties GTIN, SKU, spec, NFP, and artwork together.** A GTIN correction or an NFP
  revision is picked up by the readiness checklist and shows the *artwork* step as stale rather
  than leaving a green tick over a pack that must not print (per the readiness doctrine in
  `shared/product-readiness.js`, referenced from `server/api/artwork.js:352-362`). Drive has no
  concept of "this file is stale because something upstream changed."

---

## 5. Intended vs. current — what's fixed, what's still open

### Already fixed (verified against `main`, not a live gap)

Everything the 2 September sync note (`docs/v2/landed/artwork-proofing-sync.md`) flagged as missing
has since landed:

- **`master.csv` 401 for the proofer** — fixed. `GET /api/products/master.csv` is mounted *before*
  the module-access guard, the same arrangement `/api/artwork/ingest` always used
  (`server.js:1955-1956, 1970-1971`).
- **`snapshot` accepted-and-dropped on ingest** — fixed. It's stored in `artwork_snapshots` in the
  same transaction as the version (`server/api/artwork.js:436, 460-465`).
- **No `GET /api/artwork/snapshot` route** — fixed, and correctly declared ahead of `/sku/:sku` and
  `/:id` so Express doesn't read "snapshot" as one of those (`server/api/artwork.js:131-150`).
- **No fill-weight column on `master.csv`** — fixed. `products.fill_weight_g`, typed in the drawer,
  is the 17th column (`db.js` products block, `products.js:1078, 1106`).

### Live gap 1 — the proofer never sends a file (Artwork-Proofing repo — parked, not applied)

`readydoc.py`'s `publish_job()` posts only JSON to `/api/artwork/ingest` (`readydoc.py:135-172`)
and never calls `POST /api/artwork/ingest/:id/files`, even though:
- The proofing engine already rasterises page 1 of every PDF for its own use and keeps the result
  at `result['img_web']` (`proof_engine.py:846, 1276`).
- ReadyDoc's own schema comment says this file is meant to travel: *"'preview' is a rendered PNG of
  page 1... the proofing service already rasterises every page, so it costs nothing to keep one"*
  (`db.js:3051-3054`).
- The receiving endpoint already exists and works (`server/api/artwork.js:477-505`).

**Effect:** every proofing-filed version shows a placeholder icon instead of the pack on the
Artwork board (`ArtworkPanel.jsx:45-62`), which undercuts the one thing that screen is for — "the
whole point of this screen is seeing the actual pack" (`ArtworkPanel.jsx:13-14`).

**Workaround today:** someone attaches the PDF by hand (the "Attach a file" button, or the bulk
"Import from a folder" tool) — a real, working path, just not automatic.

**Smallest fix** (illustrative only — I don't have push access to `Artwork-Proofing`, so this is
not applied): after the existing `_post('/api/artwork/ingest', payload)` call succeeds, read back
`version_id` from the response and multipart-POST `result['img_web']` (and, if kept, the source
PDF) to `/api/artwork/ingest/{version_id}/files?token=...` with `kind=preview` (and `print_pdf`).
No architecture change — one more call in a function that already makes one.

### Live gap 2 — the proofer's own severity levels get flattened to PASS (Artwork-Proofing repo — parked)

This is the more consequential one. `readydoc.py`'s translation from the engine's findings to
ReadyDoc's pass/fail/warn only recognises two of the engine's five severities:

```python
_SEVERITY = {'critical': 'fail', 'warning': 'warn'}   # readydoc.py:46
```

The engine also raises `suspect` (6 places), `review` (3 places), and `error` (1 place, handled
correctly — a whole-file error is excluded from ingest entirely, `readydoc.py:141`). But `suspect`
and `review` are not in `_SEVERITY`, and `_checks_from_result()`'s fallback is: no *graded* issue
on a check means **pass** (`readydoc.py:112-113`):

```python
graded = [i for i in issues if _SEVERITY.get(i.get('severity'))]
if not graded:
    if block.get('skipped'):
        continue
    out.append({'name': label, 'result': 'pass'})   # ← a suspect- or review-only check lands here
```

The clearest case is the net-weight check itself. Its own code comment says, in capitals, exactly
the rule this breaks:

> *"'Nothing evaluated' must never read as 'evaluated and fine.'"* (`proof_engine.py:1938-1941`)

But when the check can't reconcile the panel (no fill weight on file, or the OCR-only "arithmetic
twin" case the most recent commit specifically closed a hole on), it returns `status: 'UNVERIFIED'`
or a `suspect`-severity issue with **no** `critical`/`warning` issue alongside it
(`proof_engine.py:1922-1936, 1945-1955`). Nothing in `_checks_from_result` reads that top-level
`status` field at all — only `issues[].severity` — so this reaches ReadyDoc's `artwork_checks` as
a plain `pass` on **"Nutrition panel vs net weight."** The same gap swallows `review`-severity
findings elsewhere in the engine: a missing total-carb read, a structure/function claim flagged for
labeling review, and a DSHEA disclaimer note (`proof_engine.py:2277, 2648, 2657`) all become a
silent pass in ReadyDoc's history.

**Effect:** a check the engine explicitly could not verify, or explicitly flagged for a human to
look at, shows up in ReadyDoc as passed cleanly. Anyone reading the Artwork tab — including at
release time — sees a green check where the engine itself is saying "I don't know" or "look at
this."

**Smallest fix** (illustrative, not applied — same access limit as above): either map
`suspect`/`review` to `warn` in `_SEVERITY`, or have `_checks_from_result` fall back to the block's
own `status` field (`UNVERIFIED`/`SUSPECT` → `warn`) when there's no better-classified issue. Not a
redesign — one dictionary and a few lines in one function.

### Live gap 3 — the master-list pull can silently drift off ReadyDoc (config, watch both sides)

The pull side's config (`GTIN_SHEET_URL`) is resolved in this order (`app.py:104-127`):
1. A runtime config file the proofer's own `/gtin` settings page writes — **"wiped on redeploy,"**
   by that page's own comment.
2. The `GTIN_SHEET_URL` environment variable.
3. A Google Sheets URL **baked into the Docker image** (`gtin_default_config.json`), as a last
   resort.

If someone pointed the proofer at ReadyDoc through the `/gtin` page rather than as a Railway
variable, a redeploy of the proofing service silently falls back to whichever of steps 2–3 applies
— which today, with no `GTIN_SHEET_URL` set, is the baked-in Google Sheet, **not** ReadyDoc. There
would be no error: a Google Sheet is a perfectly valid feed, just the wrong one, and the check
functions run happily against it. This is worth confirming directly against the proofing service's
actual Railway variables rather than assumed either way — I don't have access to check it from
here.

### Integrations copy — fixed in this pass

`server/api/integrations.js`'s "Artwork proofing hand-off" card said, when the token is unset:
*"The master.csv endpoint is off entirely, so proofing cannot fetch the catalogue."* True, but it
only named the read direction — the same token also gates `/api/artwork/ingest`, so the write-back
direction is equally off. Updated to name both:

> *"Both halves of the hand-off are off: proofing cannot fetch the catalogue (master.csv) and
> cannot post its results back (`/api/artwork/ingest` checks the same token)."*

(`server/api/integrations.js:150-159`.)

---

## Follow-ups, ranked

1. **Fix the severity mapping in `readydoc.py`** (gap 2). This is the one actively misrepresenting
   what the proofing engine found — worth doing before it runs on many more jobs.
2. **Send the preview image on ingest** (gap 1). Cosmetic by comparison, but it's why the Artwork
   board currently looks broken even when everything behind it is working.
3. **Confirm `GTIN_SHEET_URL` is a durable Railway variable pointed at ReadyDoc**, not a page
   setting that a redeploy can quietly undo (gap 3).
4. **Find and record the live ArtProof.Live / Railway URL** — not documented anywhere; add it here
   once known.
