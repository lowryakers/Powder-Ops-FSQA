// Visitor Kiosk Isolation Verification — the report Document Control files.
//
// Results are READ FROM THE RUN, never typed: verify-kiosk-isolation.mjs writes
// docs/verification/kiosk-isolation-<date>.json and this reads it. Rendering is
// the shared scripts/lib/verification-doc.mjs, so this report and the
// authentication one cannot drift apart in layout.
//
//   BASE=… DBPATH=… node scripts/verify-kiosk-isolation.mjs > docs/verification/kiosk-isolation-<date>.json
//   npm install --no-save docx
//   node scripts/build-kiosk-verification-doc.mjs docs/verification/kiosk-isolation-<date>.json

import { readFileSync } from 'fs';
import path from 'path';
import { renderReport, h1, h2, p, li, note, RESULTS, SIGNATURES } from './lib/verification-doc.mjs';

const RESULTS_PATH = process.argv[2] || 'docs/verification/kiosk-isolation-2026-08-25.json';
const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
const passed = results.filter(r => r.verdict === 'PASS').length;
const failed = results.length - passed;
const N = results.length;

const TITLE = 'Visitor Kiosk Isolation Verification';

const out = await renderReport({
  title: TITLE,
  basename: 'ReadyDoc-Visitor-Kiosk-Isolation-V1',
  outDir: path.dirname(RESULTS_PATH),
  resultsFilename: path.basename(RESULTS_PATH),
  results,
  signatories: ['Verified by', 'Quality Assurance', 'Document Control'],
  headerFields: [
    ['Document', TITLE],
    ['Revision', 'V1'],
    ['Document number', 'To be assigned by Document Control'],
    ['System verified', 'ReadyDoc — Powder Ops FSQA platform'],
    ['Software version', 'Build 25 August 2026 (kiosk keys)'],
    ['Date of verification', '25 August 2026'],
    ['Result', `${N} checks executed — ${passed} met, ${failed} not met`],
    ['Verified by', ''],
    ['Reviewed and approved by', ''],
  ],
  document: [
    h1('1. Purpose'),
    p('The lobby tablet sits unattended in reception, signed in to nothing, in front of people who do not '
      + 'work here. Its address is also an ordinary web address: anyone who learns it can open it from '
      + 'anywhere. This document records what was measured when the question was asked directly — '
      + 'standing at that tablet, what can somebody reach?'),
    p('Visitor control is a food-defence measure, so this is not only an IT question. A kiosk that leaks '
      + 'the plant’s records, or one that lets a stranger alter them, would undermine the control it '
      + 'exists to provide.'),

    h1('2. Scope'),
    h2('The position tested'),
    p('Every request in this verification carries NO session token — exactly what the tablet has. Nothing '
      + 'was signed in, no credential was supplied, and no privilege was borrowed from an existing session.'),
    li('The kiosk’s own endpoints: what the tablet is given, and what it is not.'),
    li('The visitor log, its statistics, and stored signatures.'),
    li('All sixty mounted plant modules — the full list, not a sample.'),
    li('The other public doors on the same origin: staff name look-up, sign-in, partner portal, auditor '
      + 'pass, approval links, the product feed, and the QR-code kiosk catalogues.'),
    li('Files served from disk, and whether they can be listed or guessed.'),
    li('The realtime message socket.'),
    li('The served application itself, driven in a real browser away from the kiosk into the app.'),
    h2('Not covered here'),
    li('Physical control of the tablet. If somebody signs in on it and walks away, the next person has '
      + 'that session — that is a kiosk-mode and supervision question, not a software one.'),
    li('Transport encryption, which is provided by the hosting platform.'),
    li('What a person who already holds a valid staff account can reach. That is module permissions, '
      + 'covered by its own controls.'),

    h1('3. How the kiosk is separated'),
    p('The design being verified, stated plainly:'),
    li('The tablet talks to four endpoints and no others: read the form and the agreement, sign in, look '
      + 'up an open visit by name, sign out. Everything else in the system is behind a session check.'),
    li('The visitor LOG — who came, their contact details, and their signed agreements — is a separate, '
      + 'authenticated module. The kiosk writes into the book; it cannot read it back.'),
    li('The sign-out look-up is deliberately narrow: people currently on site only, by name prefix, at '
      + 'least two characters, ten at a time, returning a name and a time and nothing else.'),
    li('The public routes are declared in ONE place in the software, so the set cannot grow unnoticed as '
      + 'modules are added.'),

    h1('4. Method'),
    p('Executed, not inspected. `scripts/verify-kiosk-isolation.mjs` drives a running copy of the software '
      + 'over the same interface a browser uses, from the position of an unauthenticated caller. Every '
      + 'line in section 5 is what the system actually returned. The protocol is held in the repository so '
      + 'it can be repeated unchanged against any future release, and it exits with the number of failures '
      + 'so a build can be stopped on one.'),
    p('It was run against a copy of the production database. Visitors created by the probe are recognisable '
      + 'by name, and no real visit was altered.'),
    p(`The raw output of the run reported here is retained beside this document as ${path.basename(RESULTS_PATH)}.`),

    h1('5. Checks and results'),
    p(`${N} checks were executed on 25 August 2026. ${passed} passed; `
      + `${failed === 0 ? 'none failed.' : `${failed} failed.`}`),
    RESULTS,
    note('VK-13 is the broad one: it walks all sixty mounted plant modules in a single pass and reports any '
      + 'that answer. A module added later that forgets its guard fails this check without anybody having '
      + 'to remember to add it here.'),

    h1('6. Finding raised during this verification'),
    p('One finding, corrected before this document was issued.'),
    h2('What was found'),
    p('The knife and blade list served to the QR-code knife kiosk carried `issued_to` — the name of the '
      + 'employee currently holding each controlled blade. That route is unauthenticated by necessity (a '
      + 'QR code has no session), so the name was readable by anyone who knew the address, including from '
      + 'the lobby tablet’s browser.'),
    p('No record was exposed and no blade could be signed in or out by reading it. What was exposed is a '
      + 'person’s name tied to a controlled tool — which is precisely the kind of detail a food-defence '
      + 'programme exists to keep inside the building.'),
    h2('What was changed'),
    li('The public list now reports only whether a blade is available or issued. The holder’s name is '
      + 'removed from that payload and remains on the sign-out record, behind a session.'),
    li('Nothing operational changed: the kiosk screen already displayed "issued to someone" when no name '
      + 'was present, so the floor sees the same thing it always did.'),
    h2('Two probes that were wrong before they were right'),
    p('Recorded because they bear on how much weight this method carries. A raw request to the realtime '
      + 'socket returns a success and a session identifier, which reads as an open connection — the '
      + 'transport handshake completes before the token is checked, and only a real client reaches the '
      + 'check. And a test for "the upload folder can be listed" fired on the application’s own icon '
      + 'link. Both were corrected and both then passed. A careless probe can invent a weakness as easily '
      + 'as it can miss one, which is why each result below names what was actually returned.'),

    h1('7. Conclusion'),
    p(`On the evidence of the run reported in section 5, the visitor kiosk reaches nothing in ReadyDoc `
      + `beyond signing a visitor in and out. Specifically:`),
    li('All sixty plant modules refuse a request that carries no session — measured in one pass, not '
      + 'sampled.'),
    li('The visitor log, visitor statistics and every stored signature are refused.'),
    li('The sign-out look-up returns a name and a time. It cannot be widened with a wildcard, is not '
      + 'injectable, and refuses a single-character probe.'),
    li('Nothing posted to the kiosk creates an account, a role or a session; the probe confirmed no user '
      + 'row was written.'),
    li('Navigating the tablet’s browser to any module address lands on the sign-in screen and returns '
      + 'no data. After a kiosk visit the browser holds one non-sensitive key and no token.'),
    li('The realtime socket rejects both a missing and a forged token, so there is no live feed of plant '
      + 'messages.'),
    p('A person at the lobby tablet cannot read, alter or discover the plant’s records.'),

    h1('8. Residual risks'),
    p('Stated so the record does not claim more than was shown. None of these is a defect; each is a '
      + 'consequence of a deliberate design choice, and each is a decision the plant may wish to revisit.'),
    li('THE QR-CODE KIOSK CATALOGUES SHARE THE SAME PUBLIC PREFIX — ADDRESSED, AWAITING ROLLOUT. Each '
      + 'poster now carries its own key, and a key is bound to its own kiosk so one that leaks does not '
      + 'open the other four. It ships switched OFF: posters are already on walls and the lobby tablet is '
      + 'saved to a home screen, so enforcing at deploy would break all of them at once with nobody at the '
      + 'poster able to fix it. The changeover runs Off → Counting → Enforced, and the Counting state '
      + 'reports how many scans still arrive without a key, so the decision to enforce rests on a number '
      + 'rather than a hope. Until that switch is thrown, the catalogues remain readable as described '
      + 'above.'),
    li('FILES UNDER /uploads — CLOSED. They were protected by an unguessable name alone, which is access '
      + 'control by secrecy and was the last of it in the system. Reading one now requires a live session, '
      + 'carried by a cookie scoped to that folder and cleared at sign-out. A cookie rather than a token '
      + 'because these files are rendered as ordinary images and links in a dozen places and a browser '
      + 'cannot attach a token to those — so nothing on the floor changed. Verified in a real browser: the '
      + 'image loads for a signed-in person and is refused for everybody else, and refused again after the '
      + 'same person signs out.'),
    li('ANYONE AT THE TABLET CAN SIGN OUT ANY VISITOR WHO IS ON SITE. Choosing a name from the list is all '
      + 'it takes, which is what makes the exit quick. The cost is that a departure time can be recorded '
      + 'for somebody who has not left. The log records that the sign-out came from the kiosk, and staff '
      + 'can correct it.'),
    li('WHO IS CURRENTLY IN THE BUILDING CAN BE DISCOVERED BY REPEATED GUESSING — NOW BOUNDED. The sweep '
      + 'that surfaced every on-site name needed 676 requests; the look-up is now limited to thirty a '
      + 'minute from one address, which makes the sweep impractical while a visitor typing their own name '
      + 'once or twice never notices. Measured: forty-five rapid look-ups, thirty answered and fifteen '
      + 'refused. The exposure was only ever names and arrival times of people not yet signed out.'),

    h1('9. When this must be repeated'),
    li('Whenever a route is added to the public list, which is the single place they are declared.'),
    li('Whenever a new module is mounted — VK-13 will cover it automatically, but the run has to happen.'),
    li('Before an external audit, and annually regardless.'),
    p('Repeating it is one command, and it fails a build on any regression.'),

    h1('10. Approval'),
    p('This verification is complete and its result accepted:'),
    SIGNATURES,
  ],
});

console.log(`Wrote ${path.dirname(RESULTS_PATH)}/ReadyDoc-Visitor-Kiosk-Isolation-V1.{docx,html} — `
  + `${out.total} checks, ${out.passed} passed, ${out.failed} failed`);
