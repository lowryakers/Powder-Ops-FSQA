# Onboarding in ReadyDoc → ADP RUN

> The click-by-click version of this, with what to expect at each step, is
> `docs/adp-onboarding-runbook.artifact.html` (published 3 September 2026 as the
> "ADP Onboarding Runbook" artifact).

What it takes to have a new hire complete onboarding inside ReadyDoc (personal
info, direct deposit, federal W-4 inputs, emergency contact, the intro to
Messages and their modules) and have the result land in RUN Powered by ADP.

## What ADP requires (the part only Lowry can do) — revised 10 September 2026

The path is **ADP API Central**, ADP's own portal for clients reaching their
own company's data. It replaces the Marketplace app registration the first
version of this doc described: instant API access, the certificate generated
in the browser, no review wait.

**API Central is at `api-central.adp.com`, not developers.adp.com.** That
second site is ADP's documentation catalogue, and its "Associated APIs" pages
look like a project without being one — the first version of this doc sent
Lowry there and he could not find Projects, correctly. Steps below follow
ADP's own *API Central Quick Start Guide* (published Apr 2024, last modified
Jun 2025).

**`HTTP ERROR 431` at that address is a browser cookie problem, not an
outage.** 431 is "request header fields too large"; ADP's SSO cookies
accumulate past the server's limit. A private window loads it; clearing
adp.com site data fixes it permanently.

**`Unknown Authentication Error` after signing in is an ENTITLEMENT problem,
and it is the branch that decides this whole approach.** ADP resolved the
identity and found no API Central access behind it. Rule out the mundane
causes first — an employee self-service login rather than the RUN
administrator, and a broken half-session left over from the 431 attempts — and
if it persists, only ADP can grant it. The question to put to them is
deliberately two-part, because the second answer is worthless without the
first: *is API Central available for a RUN Powered by ADP account at all, or
is it Workforce Now only*, and *if so, please enable it and add the
administrator as a member*.

ADP's own guide gives grounds for the doubt: its Chapter 5 is "How to set
**Workforce Now** access permissions for API Central", and there is no RUN
equivalent chapter. **If ADP answers that RUN is not supported, the route back
is the ADP Marketplace partner registration** — weeks of review — which is
what this doc described before 10 September and what API Central was worth
trying in order to avoid. Do not start that until ADP has said so plainly.

1. **Open `api-central.adp.com`** signed in as the RUN administrator. It lands
   on **Members** by default. Left-hand menu: Projects · Certificate ·
   Members · Integration Services.
2. **Projects → Create a project** (blue button, top right). Name and
   description, then **Next**; then **Use case selection**, choose the new-hire
   onboarding use case, then **Create Project**. Projects **cannot be deleted**,
   so the name is a one-shot decision. The listed use cases are only ADP's most
   popular ones — if onboarding is not among them, create against the closest
   and add the rest through the **Need more APIs** link on the project page.
   The API ReadyDoc calls is `POST /hcm/v2/applicant.onboard`, alongside
   `/auth/oauth/v2/token`.
3. **Generate the certificate** — **entirely in the browser, no openssl.**
   **Certificate** in the left menu (or the project's Credentials → Step 1) →
   **Request Certificate** → a four-stage wizard: Getting started, Generate
   private key, Copy/paste private key, Generate certificate. *Every field on
   the key form is required*; Organization name is preset from ADP's records
   and cannot be edited. The private key is shown **once** and ADP can neither
   store nor retrieve it — copy it before clicking on. The signed certificate
   downloads as a `.pem` from the certificate card, which also carries the
   expiry (ADP signs for about two years) and warns everyone active on the
   Members page from 60 days out.
4. **Copy the project's client ID and client secret** — project page →
   **Credentials** tab → Step 2, "Obtain an access token from ADP". Consent is
   usually implicit for a project under the company's own account; if the
   project shows a consent step, a RUN administrator completes it.

   **Open question, deliberately not guessed at.** API Central masks sensitive
   personal information — bank account and routing number, birth date, tax ID
   — by default on a project, with a settings screen to change it. ADP
   documents that for Workforce Now only, and says nothing about whether it
   applies to a RUN project or to data being *written in* rather than read
   out. Nothing is changed on the strength of that. If the first live
   submission lands in RUN with name and address right but **SSN or bank
   details missing**, that screen is the first place to look.
5. **Set the four credentials** on the ReadyDoc service in Railway:
   `ADP_CLIENT_ID`, `ADP_CLIENT_SECRET`, `ADP_CERT_PEM`, `ADP_KEY_PEM` (PEMs
   as literal text with `\n` line breaks, or a path on the volume).
6. **Read the onboarding template code from RUN** — Settings → Integrations →
   ADP → *Read what RUN requires* (`GET /api/onboarding/adp/meta`, which calls
   `…/applicant.onboard/meta`) — and set **`ADP_ONBOARDING_TEMPLATE_CODE`**.
   Applicant Onboard V2 refuses a hire with no template code, so the hand-off
   is not *on* until this fifth variable is set. Optional:
   `ADP_PAYROLL_GROUP_CODE` (if RUN's meta says one is required),
   `ADP_ONBOARDING_STATUS` (default `inprogress`: the person lands in RUN's
   New Hire wizard for the office to finish), `ADP_ONBOARD_PATH`,
   `ADP_API_BASE`, `ADP_TOKEN_URL`.

**Settings → Integrations** shows which variables are set and whether the
hand-off is on, without ever showing a value.

**The request body is ADP's v2 shape** (`server/adp.js`
`applicantOnboardPayload`, pure, checked by `npm run check:adp`):
`applicantOnboarding` → template code, status, `applicantPersonalProfile`
(birthName, birthDate, SSN as a governmentID, communication, legalAddress),
`applicantWorkerProfile` (hireDate, jobTitle), `applicantPayrollProfile`
(hourly or per-pay-period rate, payroll group). The field names follow ADP's
Applicant Onboard V2 guide as far as it could be read; the first live send is
checked against `/meta` and ADP's refusal text, which is returned verbatim.

## What happens first, before ADP: the encryption key

`ONBOARDING_ENC_KEY` is independent of ADP and is the one to set today:
without it the wizard does not ask for the SSN or bank details at all.
Generate it once (`openssl rand -hex 32`), set it in Railway, and never change
it — every value already stored becomes unreadable if it moves.

## What the API actually does — and doesn't

Applicant Onboard V2 **submits the applicant into ADP's onboarding** as an
in-progress hire: name, address, DOB, SSN, contact info, hire date, rate. RUN
opens the person in its New Hire wizard for the office to finish. Two honest
caveats:

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
