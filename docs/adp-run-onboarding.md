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

## The forms the new hire completes (3 September 2026)

The wizard is seven steps: welcome · about you · emergency contact · how you're
paid · **Form W-4** · **Form I-9 Section 1** · done.

- **Nothing finishes half done.** The server keeps one list of what the forms
  still need (`missing`, derived on every read) and refuses Finish while any of
  it is blank — SSN (when the key is set), date of birth, pay method, the
  direct-deposit numbers or a voided-check photo, a W-4 filing status, the
  I-9 status and whatever that status demands, and both signatures.
- **Signatures.** The employee types their full legal name under the form's own
  perjury statement and ticks that they read it; the server records name, time,
  network address and device, and refuses a name that is not the one on the
  record. The W-4 and I-9 attestation texts are stored with each signature.
- **Pictures.** ID documents (List A, or B + C) and a voided check are
  photographed from the wizard straight into R2 (`onboarding_files`); the
  office can add its own and open any of them from the packet.
- **I-9 Section 2 is the employer's**, on the packet in the office: the
  documents examined (one List A, or one B and one C — the form's rule,
  enforced), the first day, and a signature under ReadyDoc's password gate.
- **The packet PDF** (`Packet PDF` on the row) prints everything entered and
  signed, with SSN and account numbers as last-4 only.

**What this is not, yet.** An electronic I-9 that REPLACES the paper form has
to meet 8 CFR 274a.2's rules for electronic systems (signature attribution,
audit trail, integrity, retention, printability). ReadyDoc records the
attestations, the audit trail and the PDF, but nobody has reviewed it against
those rules. Until HR or counsel does, treat the packet as the source the
office completes the official I-9 from — in ADP's onboarding, which carries its
own I-9 flow, or on paper — and keep the originals policy: the employer must
examine the original documents in person within three business days; the
photos are for reference, not the examination.

## What works with ZERO ADP setup (the degrade path)

The module ships dark and useful without any of the above:

- The office starts an onboarding → ReadyDoc issues a **magic link**
  (`/welcome/<token>`, same pattern as flavor approvals) — no account needed.
- The new hire works a phone-first wizard: welcome + what ReadyDoc is, their
  personal info, emergency contact, how they're paid, the full W-4 and I-9
  Section 1, each signed, with photos of their documents. Answers save as
  they go.
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
