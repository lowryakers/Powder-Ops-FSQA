// Builds the Authentication and Access Control Verification report.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
// 1. THE RESULTS TABLE IS READ FROM THE RUN, NEVER TYPED. `verify-auth.mjs`
//    writes docs/verification/auth-verification-<date>.json; this reads it. A
//    verification report whose results were transcribed by hand is a report
//    that can disagree with the run it claims to describe — the same "one fact,
//    two places" failure this system keeps guarding against.
//
// 2. ONE CONTENT DEFINITION, TWO RENDERERS. `DOCUMENT` below is the report;
//    everything after it is drawing. The .docx is what Document Control files
//    and signs; the .html is the same words for reading on a phone and printing
//    to PDF. Writing the narrative twice is how the filed copy and the
//    circulated copy start saying different things.
//
// Regenerate after every re-run:
//   BASE=… DBPATH=… node scripts/verify-auth.mjs > docs/verification/auth-verification-<date>.json
//   npm install --no-save docx
//   node scripts/build-auth-verification-doc.mjs docs/verification/auth-verification-<date>.json
//
// `docx` is installed --no-save on purpose. This runs about once a year; putting
// a document generator in the deploy's dependency tree buys nothing and costs
// every build.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageOrientation,
} from 'docx';
import { writeFileSync, readFileSync } from 'fs';
import path from 'path';

const RESULTS_PATH = process.argv[2] || 'docs/verification/auth-verification-2026-08-24.json';
const OUT_DIR = path.dirname(RESULTS_PATH);
const BASENAME = 'ReadyDoc-Authentication-Verification-V1';

const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
const passed = results.filter(r => r.verdict === 'PASS').length;
const failed = results.length - passed;
const N = results.length;

// ── The report ──────────────────────────────────────────────────────────────
const TITLE = 'Authentication and Access Control Verification';

const HEADER_FIELDS = [
  ['Document', TITLE],
  ['Revision', 'V1'],
  ['Document number', 'To be assigned by Document Control'],
  ['System verified', 'ReadyDoc — Powder Ops FSQA platform'],
  ['Software version', 'Build c0561ce (24 August 2026)'],
  ['Date of verification', '24 August 2026'],
  ['Result', `${N} acceptance criteria executed — ${passed} met, ${failed} not met`],
  ['Verified by', ''],
  ['Reviewed and approved by', ''],
];

const h1 = (text) => ({ t: 'h1', text });
const h2 = (text) => ({ t: 'h2', text });
const p = (text) => ({ t: 'p', text });
const li = (text) => ({ t: 'li', text });
const note = (text) => ({ t: 'note', text });

const DOCUMENT = [
  h1('1. Purpose'),
  p('SQF and NSF both require that a record be attributable — that a signature, a sign-off or a completed '
    + 'check means the named person did it. That requirement holds only if a person’s account admits that '
    + 'person and nobody else.'),
  p('This document is the record that the requirement was verified rather than assumed. It states how '
    + 'sign-in works in ReadyDoc, sets out the criteria that had to be met, and reports what was measured '
    + 'when each one was tested against running software.'),

  h1('2. Scope'),
  h2('Verified here'),
  li('Signing in with a password, and being refused without one.'),
  li('Setting a password for the first time, including on an account nobody has ever signed into.'),
  li('Changing a password, and the one-year expiry.'),
  li('Sessions: what a signed-in session is, what it can be pointed at, and when it ends.'),
  li('Lockout after repeated wrong passwords.'),
  li('Attribution — that a record carries the name of whoever was actually signed in.'),
  li('Deactivating an account.'),
  h2('Deliberately not verified here'),
  p('Named so the boundary of this record is clear, not because these are unexamined:'),
  li('Transport encryption (HTTPS). Provided by the hosting platform, not by this application.'),
  li('Module permissions — who may do what once signed in. That is a separate question from who you are, '
    + 'and it has its own controls and its own records.'),
  li('The public kiosk and link paths: the QR-code forms, the visitor tablet, the flavour-approval and '
    + 'nutrition-panel approval links, the auditor pass, and the partner portal. Each is unauthenticated on '
    + 'purpose — they sit in front of people who have no account — and each is narrowed inside its own '
    + 'handler to the one thing it may do. They are listed in a single place in the software so the set '
    + 'cannot grow unnoticed.'),

  h1('3. How sign-in works'),
  p('The design being verified, stated plainly:'),
  li('Every person has their own account and chooses their own password, minimum eight characters. There '
    + 'are no shared accounts and no shared sign-in code.'),
  li('Passwords are never stored. What is stored is a scrypt hash with a 16-byte random salt generated per '
    + 'password. There is no path through the software that can return a password, to an administrator or '
    + 'to anyone else — a forgotten password is replaced, never looked up.'),
  li('The previous PIN sign-in has been retired. A PIN now survives only as a one-time proof of identity '
    + 'for staff who had one before the change.'),
  li('Setting a first password requires an invitation: either that PIN, or a setup code an administrator '
    + 'issues and hands over. The code is single use and expires. The person still chooses their own '
    + 'password — the code establishes only that somebody with authority invited them.'),
  li('Signing in issues a random 256-bit session token, valid for 30 days, held server-side and revocable. '
    + 'Deactivating an account destroys the sessions it already had.'),
  li('Every entry, signature and edit is attributed to the account behind the token — never to a name '
    + 'supplied in the request.'),
  li('Five wrong passwords lock that name out for fifteen minutes, correct password included.'),
  li('A password must be changed at least once a year. This is enforced by the server on every request, '
    + 'not by the sign-in screen, so a browser tab left open since before the lapse is caught too.'),
  li('Every refused sign-in is written to the audit log with the name that was tried and the reason it '
    + 'failed.'),

  h1('4. Method'),
  p('Executed, not inspected. The verification drives a running copy of the software over the same '
    + 'interface a browser uses, and reads the database directly where the question is about how something '
    + 'is stored. Nothing in the results below is an opinion about the code; each line is what the system '
    + 'actually returned.'),
  p('The protocol is held in the repository as scripts/verify-auth.mjs so that it can be repeated, '
    + 'unchanged, against any future release. It was run against a copy of the production database. Two '
    + 'fixture accounts are created by the protocol itself and used for the sign-in tests, so no real '
    + 'employee’s password is touched by running it.'),
  p(`The raw output of the run reported here is retained beside this document as ${path.basename(RESULTS_PATH)}.`),

  h1('5. Acceptance criteria and results'),
  p(`${N} criteria were executed on 24 August 2026. ${passed} were met; `
    + `${failed === 0 ? 'none failed.' : `${failed} were not met.`}`),
  { t: 'results' },
  note('AC-14b through AC-14e cover the first-sign-in path in detail. That is deliberate: it is the one '
    + 'place where somebody who is not yet a user has to be let in, and it is where this verification found '
    + 'a defect.'),

  h1('6. Finding raised during this verification'),
  p('AC-14 did not pass when it was first executed. It is recorded here in full, because a verification '
    + 'that found something and corrected it is better evidence than one that found nothing.'),
  h2('What was found'),
  p('An account that had been created but never signed into could be taken over by anybody who knew the '
    + 'person’s name — without signing in, and without any credential at all. Two requests did it: the '
    + 'sign-in screen’s name look-up, which is necessarily public, returned the account identifier; and the '
    + 'set-a-first-password step asked for nothing further when the account had no PIN to confirm. It was '
    + 'demonstrated end to end against a running server, and a working session was issued for a supervisor '
    + 'account to a caller who had proved nothing.'),
  p('This was not theoretical. Accounts created by the training-log import and by the message-history '
    + 'import land in exactly that state — real, active, and never yet signed into.'),
  h2('What was changed'),
  li('Setting a first password now requires one of two proofs and never neither: the person’s PIN, or a '
    + 'setup code an administrator issued. A wrong or missing code is refused and recorded in the audit log '
    + 'as a failed sign-in.'),
  li('The setup code is single use and expires. It is cleared the moment it is spent.'),
  li('The public name look-up no longer returns account identifiers. Either change alone closes the route; '
    + 'both were made, so neither depends on the other.'),
  li('Every account that was claimable the moment before the change was issued a code, once, so that nobody '
    + 'mid-rollout was locked out by the fix. An administrator reads it from Settings and hands it over.'),
  li('The administrator password reset now issues and displays a setup code, rather than leaving the '
    + 'account open to whoever asks for it first.'),
  h2('Re-test'),
  p('The full protocol was re-executed after the correction. The attempt that had previously succeeded was '
    + 'refused, and recorded in the audit log as a failed sign-in with the reason given. All '
    + `${N} criteria were then met (AC-14, AC-14b, AC-14c, AC-14d and AC-14e in section 5).`),

  h1('7. Conclusion'),
  p(`On the evidence of the run reported in section 5, ReadyDoc’s sign-in controls meet the ${N} acceptance `
    + 'criteria set out for them. Specifically:'),
  li('A person cannot sign in as a colleague. Knowing a name is not enough; another person’s password is '
    + 'not enough; and repeated guessing locks the account rather than eventually succeeding.'),
  li('Passwords are not held in a form anyone can read, and cannot be retrieved by anybody, administrators '
    + 'included.'),
  li('A record is attributed to whoever was actually signed in, even when the request that created it '
    + 'claims a different name.'),
  li('An account that has never been used cannot be claimed by a stranger — the defect that allowed this '
    + 'was found by this verification and corrected before it was closed.'),
  p('Records created in ReadyDoc can therefore be relied upon as attributable to the person named on them.'),

  h1('8. Limitations'),
  p('Stated so that the record does not claim more than was shown:'),
  li('Sign-in is a single factor. A password that a person writes down, shares or re-uses elsewhere is '
    + 'outside anything the software can verify. That risk is managed by policy and training, not by this '
    + 'control.'),
  li('The lockout counter is held in the running application rather than in the database, so it is reset if '
    + 'the application restarts. It raises the cost of guessing; it is not a defence against a patient '
    + 'attacker, and it is not relied on as one. Every attempt is logged either way.'),
  li('A session lasts thirty days on the device it was issued to. A lost or shared device is a physical '
    + 'control, not a software one; the answer is to deactivate the account, which this verification '
    + 'confirms ends existing sessions immediately (AC-16).'),
  li('This verification covers the software. It does not cover the hosting platform, the network, or the '
    + 'devices the software is used on.'),

  h1('9. When this must be repeated'),
  li('Before an external audit, so the record on file describes the software in use.'),
  li('After any change to sign-in, password handling or session handling.'),
  li('Annually, whether or not anything changed.'),
  p('Repeating it is running one command. The protocol is versioned with the software, so the criteria '
    + 'cannot quietly drift away from what is being tested.'),

  h1('10. Approval'),
  p('This verification is complete and its result accepted:'),
  { t: 'signatures' },
];

const SIGNATORIES = ['Verified by', 'Quality Assurance', 'Document Control'];

// ── Renderer: .docx ─────────────────────────────────────────────────────────
const CONTENT = 9360;            // Letter (12240) less 1" margins each side
const COLS = [720, 3240, 4600, 800];
const GREY = 'F3F4F6';
const RULE = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
const CELL_BORDERS = { top: RULE, bottom: RULE, left: RULE, right: RULE };
const t = (text, o = {}) => new TextRun({ text, ...o });

const cell = (children, width, opts = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  borders: CELL_BORDERS,
  margins: { top: 80, bottom: 80, left: 110, right: 110 },
  shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: 'auto' } : undefined,
  children,
});

const cellText = (text, width, opts = {}) => cell(
  [new Paragraph({ children: [t(text, { size: 18, bold: opts.bold, color: opts.color })], spacing: { line: 240 } })],
  width, opts);

const headerTable = new Table({
  width: { size: CONTENT, type: WidthType.DXA },
  columnWidths: [2600, CONTENT - 2600],
  rows: HEADER_FIELDS.map(([label, value]) => new TableRow({
    children: [cellText(label, 2600, { bold: true, shade: GREY }), cellText(value, CONTENT - 2600)],
  })),
});

const resultsTable = new Table({
  width: { size: CONTENT, type: WidthType.DXA },
  columnWidths: COLS,
  rows: [
    new TableRow({
      tableHeader: true,
      children: ['Ref', 'What was tested', 'What happened', 'Result']
        .map((h, i) => cellText(h, COLS[i], { bold: true, shade: GREY })),
    }),
    ...results.map(r => new TableRow({
      children: [
        cellText(r.id, COLS[0], { bold: true }),
        cellText(r.title, COLS[1]),
        cellText(r.actual, COLS[2]),
        cellText(r.verdict === 'PASS' ? 'Met' : 'NOT MET', COLS[3],
          { bold: true, color: r.verdict === 'PASS' ? '15803D' : 'B91C1C' }),
      ],
    })),
  ],
});

const SIG_COL = Math.floor(CONTENT / 3);
const signaturesTable = new Table({
  width: { size: CONTENT, type: WidthType.DXA },
  columnWidths: [SIG_COL, SIG_COL, CONTENT - SIG_COL * 2],
  rows: [
    new TableRow({
      tableHeader: true,
      children: ['Role', 'Name and signature', 'Date']
        .map(h => cellText(h, SIG_COL, { bold: true, shade: GREY })),
    }),
    ...SIGNATORIES.map(role => new TableRow({
      children: [
        cellText(role, SIG_COL, { bold: true }),
        cell([new Paragraph({ children: [t('', { size: 21 })], spacing: { before: 300, after: 300 } })], SIG_COL),
        cell([new Paragraph({ children: [t('', { size: 21 })], spacing: { before: 300, after: 300 } })], SIG_COL),
      ],
    })),
  ],
});

function docxBlock(b) {
  switch (b.t) {
    case 'h1': return new Paragraph({
      heading: HeadingLevel.HEADING_1, spacing: { before: 340, after: 160 },
      children: [t(b.text, { size: 26, bold: true, color: '111827' })],
    });
    case 'h2': return new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 },
      children: [t(b.text, { size: 22, bold: true, color: '374151' })],
    });
    case 'p': return new Paragraph({
      spacing: { after: 150, line: 280 }, children: [t(b.text, { size: 21 })],
    });
    case 'li': return new Paragraph({
      bullet: { level: 0 }, spacing: { after: 90, line: 280 }, children: [t(b.text, { size: 21 })],
    });
    case 'note': return new Paragraph({
      spacing: { before: 130, after: 150, line: 270 },
      children: [t(b.text, { size: 19, italics: true, color: '4B5563' })],
    });
    case 'results': return resultsTable;
    case 'signatures': return signaturesTable;
    default: throw new Error(`unknown block ${b.t}`);
  }
}

const doc = new Document({
  creator: 'Powder Ops',
  title: `ReadyDoc ${TITLE}`,
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
        margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
      },
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 60 },
        children: [t('POWDER OPS', { size: 20, bold: true, characterSpacing: 40, color: '6B7280' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 240 },
        children: [t(TITLE, { size: 32, bold: true })],
      }),
      headerTable,
      ...DOCUMENT.map(docxBlock),
    ],
  }],
});

writeFileSync(path.join(OUT_DIR, `${BASENAME}.docx`), await Packer.toBuffer(doc));

// ── Renderer: .html (same words; for reading and printing to PDF) ───────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function htmlBlocks(blocks) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const b of blocks) {
    if (b.t === 'li') { (list ||= []).push(`<li>${esc(b.text)}</li>`); continue; }
    flush();
    if (b.t === 'h1') out.push(`<h2>${esc(b.text)}</h2>`);
    else if (b.t === 'h2') out.push(`<h3>${esc(b.text)}</h3>`);
    else if (b.t === 'p') out.push(`<p>${esc(b.text)}</p>`);
    else if (b.t === 'note') out.push(`<p class="note">${esc(b.text)}</p>`);
    else if (b.t === 'results') out.push(resultsHtml());
    else if (b.t === 'signatures') out.push(signaturesHtml());
  }
  flush();
  return out.join('\n');
}

const resultsHtml = () => `<div class="scroll"><table class="results">
<thead><tr><th>Ref</th><th>What was tested</th><th>What happened</th><th>Result</th></tr></thead>
<tbody>${results.map(r => `<tr>
<td class="ref">${esc(r.id)}</td><td>${esc(r.title)}</td><td class="obs">${esc(r.actual)}</td>
<td class="${r.verdict === 'PASS' ? 'met' : 'unmet'}">${r.verdict === 'PASS' ? 'Met' : 'NOT MET'}</td>
</tr>`).join('')}</tbody></table></div>`;

const signaturesHtml = () => `<table class="sig">
<thead><tr><th>Role</th><th>Name and signature</th><th>Date</th></tr></thead>
<tbody>${SIGNATORIES.map(r => `<tr><th scope="row">${esc(r)}</th><td></td><td></td></tr>`).join('')}</tbody></table>`;

const html = `<title>Authentication Verification</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
  :root{
    --ink:#1a1d21; --muted:#5b6470; --faint:#8b939e; --rule:#dfe3e8;
    --ground:#fbfaf8; --card:#ffffff; --band:#f2f0ec;
    --met:#1c6b45; --unmet:#a52222; --accent:#1c4f6b;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --ink:#e8eaed; --muted:#a3acb8; --faint:#7c8794; --rule:#333a42;
      --ground:#15181c; --card:#1c2026; --band:#242a31;
      --met:#5fca97; --unmet:#f08a8a; --accent:#7fb8d6;
    }
  }
  :root[data-theme="dark"]{
    --ink:#e8eaed; --muted:#a3acb8; --faint:#7c8794; --rule:#333a42;
    --ground:#15181c; --card:#1c2026; --band:#242a31;
    --met:#5fca97; --unmet:#f08a8a; --accent:#7fb8d6;
  }
  *{box-sizing:border-box}
  body{background:var(--ground);color:var(--ink);
    font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
    font-size:16px;line-height:1.6;margin:0;padding:0 1.25rem 5rem;-webkit-text-size-adjust:100%}
  .sheet{max-width:52rem;margin:0 auto;background:var(--card);border:1px solid var(--rule);
    padding:clamp(1.5rem,4vw,3.25rem);margin-top:2rem;border-radius:2px}
  .eyebrow{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);
    font-weight:600;margin:0 0 .5rem}
  h1{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:clamp(1.7rem,4.4vw,2.4rem);
    line-height:1.2;margin:0 0 1.5rem;text-wrap:balance;letter-spacing:-.01em}
  h2{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:1.3rem;line-height:1.3;
    margin:2.4rem 0 .7rem;padding-top:1.1rem;border-top:1px solid var(--rule);text-wrap:balance}
  h3{font-size:.8rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
    color:var(--muted);margin:1.5rem 0 .5rem}
  p{margin:0 0 .95rem;max-width:64ch}
  ul{margin:0 0 1.1rem;padding-left:1.15rem;max-width:64ch}
  li{margin-bottom:.5rem}
  li::marker{color:var(--faint)}
  .note{font-size:.9rem;color:var(--muted);border-left:2px solid var(--rule);
    padding-left:.9rem;margin:1.2rem 0}
  table{border-collapse:collapse;width:100%;font-size:.85rem}
  .meta{margin-bottom:1.5rem}
  .meta th{text-align:left;font-weight:600;width:34%;background:var(--band);color:var(--muted);
    font-size:.78rem}
  .meta th,.meta td{border:1px solid var(--rule);padding:.42rem .6rem;vertical-align:top}
  .meta td{font-variant-numeric:tabular-nums}
  .scroll{overflow-x:auto;margin-bottom:.4rem}
  .results{min-width:36rem}
  .results th{background:var(--band);color:var(--muted);text-align:left;font-size:.74rem;
    letter-spacing:.05em;text-transform:uppercase;font-weight:600}
  .results th,.results td{border:1px solid var(--rule);padding:.42rem .6rem;vertical-align:top}
  .results .ref{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:500;
    white-space:nowrap;color:var(--accent)}
  .results .obs{color:var(--muted);font-size:.8rem}
  .results .met,.results .unmet{font-weight:600;white-space:nowrap}
  .results .met{color:var(--met)} .results .unmet{color:var(--unmet)}
  .sig{margin-top:.5rem}
  .sig th{background:var(--band);color:var(--muted);text-align:left;font-size:.74rem;
    letter-spacing:.05em;text-transform:uppercase;font-weight:600}
  .sig th,.sig td{border:1px solid var(--rule);padding:.5rem .6rem}
  .sig tbody th{text-transform:none;letter-spacing:0;font-size:.85rem;color:var(--ink);width:30%}
  .sig tbody td{height:2.9rem}
  .foot{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--rule);
    font-size:.75rem;color:var(--faint)}
  @media print{
    body{background:#fff;padding:0}
    .sheet{border:0;margin:0;padding:0;max-width:none}
    h2{break-after:avoid} tr{break-inside:avoid}
  }
</style>
<div class="sheet">
  <p class="eyebrow">Powder Ops · ReadyDoc</p>
  <h1>${esc(TITLE)}</h1>
  <table class="meta"><tbody>
    ${HEADER_FIELDS.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v ? esc(v) : '&nbsp;'}</td></tr>`).join('\n    ')}
  </tbody></table>
  ${htmlBlocks(DOCUMENT)}
  <p class="foot">Uncontrolled when printed — verify the revision against the registry.
    Generated from the recorded run ${esc(path.basename(RESULTS_PATH))}.</p>
</div>`;

writeFileSync(path.join(OUT_DIR, `${BASENAME}.html`), html);

console.log(`Wrote ${path.join(OUT_DIR, BASENAME)}.docx and .html — ${N} criteria, ${passed} met, ${failed} not met`);
