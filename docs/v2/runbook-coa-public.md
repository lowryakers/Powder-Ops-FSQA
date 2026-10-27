# COA release and the public certificate page — runbook

D-246, D-247, D-248. Written for the people who run it: Lowry (admin), Maria (Quality), Carol (Quality support).

## The state after this deploy

| Thing | State | Where to see it |
|---|---|---|
| Release gate | **Warn** — records what strict would do, stops nothing | COA → Lab Requests (the strip) or COA → Release & publishing |
| Public certificate page | **Off** — every `/tested/…` address is a 404 | COA → Release & publishing → Public certificates |
| ProDough publishing | **Not allowed** | same place |
| Search engines | **Blocked** (no switch in the app) | same place |
| Gluten results on products with no gluten-free claim | **Hidden** | same place |
| Overrides | none | COA → Release & publishing → open a lot |
| Publications | none | COA → Release & publishing → Public certificates |

Nothing in this deploy changes any of these. Every change below is a person's, with a reason and their password,
and is in the audit log.

## What Maria does differently

1. **COA → Release & publishing** is new. It opens on **Ready for strict?**: one line per thing that must be true
   before the gate goes strict. A line with a tick is done; a hollow circle is not.
2. **Would strict have been right?** Each time a ProDough lot reaches a certificate signature or a production QA
   sign-off while the lot is not released, the app writes it down. For each one, type a few words and press
   **Right to block** or **Wrong — should have passed**. These also show in **QA Review → COA readiness**.
3. **Production QA sign-off** now says, under the entry, where the lot stands — for example "COA: 1 of 2 batches
   signed and passing — lot not released". On warn it signs anyway.
4. **Product names on production entries.** If the Production Log calls a product something other than its public
   name (for example "GF Flour 5 lb"), add that name to the product: COA → Specifications → Test plans and COA
   products → Edit → the small box under the name. Separate names with `;`. Only an exact name matches.
5. **Report-only tests** (Moisture, Water Activity) are hidden on the public page unless the plan ticks **show
   publicly** beside them.

## Overriding a lot (Quality, only when strict is on)

Only needed when the gate is strict and a production sign-off must go ahead for a lot that is not released.

1. COA → Release & publishing → type the item number and the lot (without the batch, e.g. `101690`) → **Open lot**.
2. Under **Override**, press **Override this lot**, type why (at least 10 characters), press **Override**, enter
   your password.
3. When the lot is released, press **Revoke the override** and say why.

An override never makes a certificate signable and never lets a lot be published.

## Recording the golden-file run (Quality)

The real lab reports stay on a computer — they never go to the server.

1. On a computer with the repository, put the real CTLA PDFs in a folder (for example `~/ctla-pdfs`).
2. In a terminal in the repository folder, run:
   ```
   COA_REAL_PDF_DIR=~/ctla-pdfs node --test scripts/test/coa-real-pdf.test.mjs
   ```
3. Note how many reports it read, how many results did not match, and how many lines it could not read.
4. COA → Release & publishing → **Record a golden-file run** → fill in the date and the three numbers → **Record**
   → your password.

## Going strict (Lowry, later — not now)

Do this only when every line of **Ready for strict?** has a tick. In particular:
- every ProDough product's plan is approved with every limit;
- every product's specifications cover all five categories (identity, purity, strength, composition,
  contaminants) — **strict holds a certificate that misses one**, and today none of them cover identity;
- a golden-file run is recorded;
- 30 days on warn, and no "wrong — should have passed" in the last 14.

Steps:
1. COA → Release & publishing → **Change the gate…** → **Strict**.
2. Type why → **Change** → your password.

To go back: the same, choosing **Warn**.

## Publishing a lot (Lowry)

1. COA → Release & publishing → type the item number and the lot → **Open lot**.
2. Press **Check whether it can be published**. Every line must have a tick. Each line says what is wrong if not.
3. Press **Preview the public page** to see exactly what the public will see. Press Esc or the × to close.
4. Press **Publish lot …** → your password. Every batch of the lot is published together.

Publishing while the page is off is allowed — the certificate waits, invisible, until the page is switched on.

## Switching the public page on (Lowry, when decided)

Both switches must be on before anyone outside can see anything.

1. COA → Release & publishing → Public certificates.
2. **Public certificate page: off → Switch on** → type why → **Change** → your password.
3. **ProDough publishing: not allowed → Allow** → type why → **Change** → your password.
4. Open `https://app.powder-ops.com/tested/sku/<the product's slug>` in a private browser window to check.

To take everything down at once: switch either one off. Every public address goes back to a 404 immediately.

## Withdrawing a certificate (Maria or Lowry)

1. COA → Release & publishing → Public certificates → **Withdraw** on the row.
2. Type why (at least 10 characters) → **Withdraw** → your password.

The public address then says "This certificate was withdrawn" with the date, never the reason. To correct a
certificate: withdraw it, un-sign it (admin, with a reason), correct, sign again, publish again.

## Public addresses

| Address | What it shows |
|---|---|
| `/tested/c/<id>` | one batch's certificate (`.json`, `.pdf` too) |
| `/tested/lot/<slug>/<lot>` | every batch of a lot |
| `/tested/sku/<slug>` | every published lot of a product |
| `/tested/verify` | "is this certificate genuine?" — needs the certificate number AND the lot |
| `/tested/embed/<slug>` | a small card for another site (framing is off until `public_coa_frame_ancestors` is set) |
| `/tested/badge/<slug>.json` | the product's latest lot, for a website |

Never on any of them: the laboratory's name, its report number, a person's name, an internal id, "accredited" or
"ISO".
