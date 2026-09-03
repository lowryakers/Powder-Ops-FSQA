# Onboarding in ReadyDoc → ADP RUN

> The click-by-click version of this, with what to expect at each step, is
> `docs/adp-onboarding-runbook.artifact.html` (published 3 September 2026 as the
> "ADP Onboarding Runbook" artifact).

What it takes to have a new hire complete onboarding inside ReadyDoc (personal
info, direct deposit, federal W-4 inputs, emergency contact, the intro to
Messages and their modules) and have the result land in RUN Powered by ADP.

## What ADP requires (the part only Lowry can do)

RUN's APIs are reached through the **ADP Marketplace** — there is no
self-serve API key on the RUN plan. The path:

1. **Create an ADP Marketplace developer account** (developers.adp.com) and
   register an application as a *data connector* for RUN. The API in scope is
   **Applicant Onboarding** (`POST /events/hr/v1/applicant-onboard.process`).
2. ADP issues the app's **client ID and client secret**, and — this is the
   unusual part — a **mutual-TLS certificate**: every call to their API
   presents an ADP-issued client cert. They walk you through a CSR during app
   registration.
3. **Consent**: the Powder Ops RUN account authorizes the app (an admin
   clicks through ADP's consent flow), which scopes the credentials to our
   company data.
4. Expect a review/approval step on ADP's side, like the Intuit one — budget
   weeks, not days, and write the app description around what it actually
   does (a lesson from the QuickBooks review).

Once through, four env vars turn the integration on:
`ADP_CLIENT_ID`, `ADP_CLIENT_SECRET`, `ADP_CERT_PEM`, `ADP_KEY_PEM`
(optional `ADP_API_BASE`, default `https://api.adp.com`). Set them on the
ReadyDoc service in Railway (service → Variables); the PEMs can be pasted as
the literal certificate text with `\n` line breaks, or a path to a file on the
volume. **Settings → Integrations** shows which of the four are set and whether
the hand-off is on, without ever showing a value — the same screen shows the
onboarding encryption key below.

## What happens first, before ADP: the encryption key

`ONBOARDING_ENC_KEY` is independent of ADP and is the one to set today:
without it the wizard does not ask for the SSN or bank details at all.
Generate it once (`openssl rand -hex 32`), set it in Railway, and never change
it — every value already stored becomes unreadable if it moves.

## What the API actually does — and doesn't

The Applicant Onboarding API **submits the applicant into ADP's onboarding**:
name, address, DOB, SSN, contact info, hire date, rate. ADP then creates the
employee record in RUN. Two honest caveats:

- **The I-9 stays ADP's** (and legally should — verification, retention,
  E-Verify). ReadyDoc collects everything *around* it; the employee's I-9
  attestation completes in ADP's flow after the record lands.
- **W-4 handling depends on what the approved app is granted.** ReadyDoc
  collects the W-4 inputs (filing status, dependents, extra withholding) so
  the office never re-types them; whether they flow through the API or get
  keyed into RUN from ReadyDoc's completed packet is decided by the scopes
  ADP grants. Either way the data is captured once, correctly.

## What works with ZERO ADP setup (the degrade path)

The module ships dark and useful without any of the above:

- The office starts an onboarding → ReadyDoc issues a **magic link**
  (`/welcome/<token>`, same pattern as flavor approvals) — no account needed.
- The new hire works a phone-first wizard: welcome + what ReadyDoc is, their
  personal info, emergency contact, direct deposit, W-4 inputs. Answers save
  as they go.
- When they finish, the office sees a **completed packet** (sensitive fields
  masked to last-4 on screen) and keys it into RUN — once, from one screen,
  instead of chasing paper. The **Submit to ADP** button exists and simply
  says what it's waiting on until the env vars arrive.
- Completing an onboarding can create the person's ReadyDoc account on the
  spot (Messages-only until modules are granted — the NULL-map rule).

## Sensitive data

SSN, routing and account numbers are stored **encrypted at rest**
(AES-256-GCM) under `ONBOARDING_ENC_KEY` (32-byte key, `openssl rand -hex 32`).
Without that key set, the portal does not ask for those fields at all — it
says the office will collect them directly — because storing an SSN in the
clear is worse than not collecting it. The clear values are only ever
decrypted server-side at the moment of an ADP submission; every screen shows
last-4.
