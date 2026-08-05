# Connecting ReadyDoc to QuickBooks Online — step by step

The point of this is **not** to keep using QuickBooks. It's to pull your real
data out of it so the replacement can be designed against what you actually
have, rather than against a guess. Once the pull works we'll also know whether
the existing integration in `server/quickbooks.js` is sound — it was written
against the QBO v3 API but has never run against a real company.

Time: about 15 minutes. You need to be signed in to QuickBooks as the company
admin.

---

## 1. Create an Intuit developer app

1. Go to **https://developer.intuit.com** and sign in with the same Intuit
   account you use for QuickBooks.
2. **Dashboard** → **Create an app** → choose **QuickBooks Online and Payments**.
3. Name it `ReadyDoc` (the name is only visible to you).
4. On the scopes screen tick **`com.intuit.quickbooks.accounting`**. Nothing else.

## 2. Get the production keys

1. In the app, open **Keys & credentials** and switch from **Development** to
   **Production**.
   - Production may ask you to fill in a short app profile first (name, contact,
     a description, a privacy-policy URL). It's a form, not a review — you're
     the only user of this app.
   - **If the app assessment questionnaire rejects it on relevance**, see
     `docs/quickbooks-app-assessment.md` — that's a description problem, not an
     app problem, and it has the exact wording to resubmit with.
   - Meanwhile use **Development** keys: they read the sandbox company, which
     proves the integration works but cannot pull your real numbers. Set
     `QBO_ENV=sandbox` and use the SANDBOX realm id from the OAuth Playground,
     not the Company ID from your real QuickBooks settings.
2. Copy **Client ID** and **Client Secret**. These are two of the four values.

## 3. Get the Realm ID (your company ID)

Easiest route: **Settings (gear) → Account and settings → Billing & Subscription**
in QuickBooks. The **Company ID** shown there is the realm ID. Strip any spaces.

## 4. Get a refresh token

This is the fiddly one, because it requires an OAuth round trip. Intuit gives
you a tool for it:

1. On developer.intuit.com go to your app → **Tools → OAuth 2.0 Playground**.
2. Select your app, environment **Production**, scope
   `com.intuit.quickbooks.accounting`.
3. Click **Get authorization code** → sign in → pick the Powder Ops company →
   **Connect**.
4. Click **Get tokens**. You'll see an **access token** (1 hour, ignore it) and a
   **refresh token** (100 days). Copy the **refresh token**.

The playground also shows the **realm ID** on this screen, which double-checks
step 3.

## 5. Put the four values into Railway

Railway → the ReadyDoc service → **Variables** → add:

```
QBO_CLIENT_ID       = <from step 2>
QBO_CLIENT_SECRET   = <from step 2>
QBO_REFRESH_TOKEN   = <from step 4>
QBO_REALM_ID        = <from step 3>
```

Only if you used Development keys, also add `QBO_ENV = sandbox`.

Railway redeploys automatically. Nothing else in ReadyDoc changes — the whole
integration degrades gracefully, so before this the Sync button simply isn't
there.

## 6. Run it yourself — **Accounting → QuickBooks**

Once the four variables are in, an admin gets a **QuickBooks** tab in the
Accounting module with three things on it:

1. **Check** — "what is actually in these books". It counts every kind of record
   QuickBooks holds for this company and dates the transactional ones. It counts
   without downloading, so it's quick and safe to re-run. **The most useful line
   in that report is the empty one**: an entity with zero records is a whole
   feature a replacement doesn't have to carry. This is the answer to "get a
   list of what we actually use", produced from the books rather than from
   memory.
2. **Pull everything** — the migration. Every bill and invoice with no date
   cutoff, plus the chart of accounts, vendors and customers. Run it once.
   Re-running is safe: rows are matched on their QuickBooks id and updated in
   place, so nothing doubles.
3. **Sync changes** — the day-to-day version, taking only what changed since the
   last run.

Send me a screenshot of the discovery report and I can size stage 3 against real
numbers instead of an estimate.

---

## Two things worth knowing

**Refresh tokens rotate and expire.** Every refresh may hand back a *new*
refresh token, and the old one dies shortly after. ReadyDoc persists the current
one in `app_settings.qbo_refresh_token` so a restart doesn't lose the
connection. But a refresh token that goes **100 days unused** expires for good —
if the sync sits idle that long you'll have to redo step 4. That's an Intuit
rule, not ours.

**This connection is read-only.** `server/quickbooks.js` only ever pulls; it has
no code that writes back to QuickBooks. So there is no way for this to damage
your books, which is deliberate while QuickBooks is still the system of record.

**It has been tested, just not against your company.** The integration runs end
to end against a stand-in QuickBooks that holds 2,350 bills — deliberately more
than one API page — so paging, the rotating refresh token, the empty and
unreadable entities, and re-running a pull without duplicating anything are all
exercised. What that testing cannot tell us is how *your* books are shaped, which
is what step 6 is for.

## If something goes wrong

| What you see | What it means |
|---|---|
| `invalid_grant` | The refresh token is stale or was used by something else. Redo step 4. |
| `AuthenticationFailed` | Client ID/secret don't match the environment (production keys with `QBO_ENV=sandbox`, or vice versa). |
| `ApplicationAuthenticationFailed` | The realm ID doesn't belong to the account that authorised the app. |
| Sync button doesn't appear | One of the four variables is missing or misspelled. All four have to be set. |
