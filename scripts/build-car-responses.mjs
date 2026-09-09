// Renders docs/v2/car-responses/responses.mjs into the Markdown copy and the
// HTML page Carol pastes from. One source, two outputs — edit the data file.
//   node scripts/build-car-responses.mjs
import { writeFileSync } from 'fs';
import { META, AUDITS, PARTS, RESPONSES, PEOPLE } from '../docs/v2/car-responses/responses.mjs';

const MD_OUT = 'docs/v2/queued/car-responses-2026-09.md';
const HTML_OUT = 'docs/v2/queued/car-responses-2026-09.artifact.html';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const auditOf = (id) => AUDITS.find(a => a.id === id);
const fmtDue = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

// [CAROL: …] → a highlighted chip in HTML; kept verbatim in Markdown and in the copied text.
const withChips = (text) => esc(text).replace(/\[CAROL: ([^\]]+)\]/g, (_, inner) => `<mark class="dec">[CAROL: ${inner}]</mark>`);
const paras = (text) => text.split('\n').map(l => `<p>${withChips(l)}</p>`).join('');
const decisions = (r) => PARTS.reduce((n, [k]) => n + (String(r[k]).match(/\[CAROL:/g) || []).length, 0)
  + [...r.evidence_now, ...r.evidence_later].reduce((n, e) => n + (e.match(/\[CAROL:/g) || []).length, 0);

const evidenceText = (r) => `On file now:\n${r.evidence_now.map(e => `- ${e}`).join('\n')}\nTo be produced:\n${r.evidence_later.map(e => `- ${e}`).join('\n')}`;
const fieldText = (r, key) => key === 'evidence' ? evidenceText(r) : r[key];

// ── Markdown ────────────────────────────────────────────────────────────────
let md = `# NSF corrective action responses — drafts for Carol

**${META.facility}** · visit ${META.visit} · auditor ${META.auditor} · audit ${META.auditDates} · drafts prepared ${META.prepared}

> Generated from \`docs/v2/car-responses/responses.mjs\` by \`scripts/build-car-responses.mjs\`. Edit the
> data file, not this one. The HTML page beside it is the copy Carol pastes from.

**Nothing here is closed, and no response says it is.** Every answer is a plan with a named person and a
date, in the six parts NSF's *Instructions for Submitting Audit Corrective Actions* (Issue 2) require. Text in
\`[CAROL: …]\` is a decision, date or fact only the plant can supply and must be replaced before the response
is submitted — a bracket that reaches NSF Connect is a response that gets returned.

| Audit | Scheme | CARs | Response due |
|---|---|---|---|
${AUDITS.map(a => `| ${a.id} | ${a.scheme} | ${a.count} | **${a.dueLabel}** |`).join('\n')}

## People named in the responses

Names and titles are taken from **${META.orgChart}**. Confirm each is still current before submitting.

| Name | Title | Named for |
|---|---|---|
${PEOPLE.map(p => `| ${p.name} | ${p.title} | ${p.role} |`).join('\n')}

## Before submitting — from NSF's own instructions

- Log in at clients.nsf.org → Corrective Actions → open each CAR-NO. link → fill the fields → **Save** as you go → **Save & Submit**.
- Attach evidence with **Add Document**. First-time minors do not strictly require evidence, but everything listed under *on file now* should be attached — it is what makes the response credible.
- Root causes NSF returns: restating the finding; "unaware of the requirement"; "employee did not follow procedure" without asking why. Actions NSF returns: "SOP will be updated" with no specifics; "Not applicable".
- If a response comes back ADDL INFO RQSTD or REJECTED, **add** a dated reply beneath the original; never overwrite it.

`;
for (const a of AUDITS) {
  md += `\n---\n\n# ${a.scheme} — audit ${a.id} — due ${a.dueLabel}\n`;
  for (const r of RESPONSES.filter(r => r.audit === a.id)) {
    md += `\n## CAR ${r.car} · ${r.clause} · ${r.title}\n\n`;
    md += `**Finding (verbatim):** *${r.finding}*  \n**Reference:** ${r.reference}  \n**Decisions for Carol in this response:** ${decisions(r)}\n\n`;
    for (const [key, label] of PARTS) {
      md += `### ${label}\n\n${fieldText(r, key).split('\n').map(l => l).join('\n')}\n\n`;
    }
  }
}
md += `\n---\n\n*Doctrine: D-056. Triage and per-CAR status: \`docs/v2/queued/audit-nc-triage.md\`.*\n`;
writeFileSync(MD_OUT, md);

// ── HTML ────────────────────────────────────────────────────────────────────
const nav = AUDITS.map(a => `
  <div class="navgrp">
    <div class="navhd"><span>${esc(a.scheme)}</span><b>due ${esc(a.dueLabel)}</b></div>
    ${RESPONSES.filter(r => r.audit === a.id).map(r => `<a href="#car-${r.car}"><code>${r.car}</code><span>${esc(r.clause)} · ${esc(r.title)}</span></a>`).join('')}
  </div>`).join('');

const sections = AUDITS.map(a => `
<section class="audit" id="audit-${a.id}">
  <header class="audithd">
    <h2>${esc(a.scheme)}</h2>
    <div class="auditmeta"><span>Audit ${a.id}</span><span>${a.count} corrective action${a.count === 1 ? '' : 's'}</span><span class="due">Response due ${esc(a.dueLabel)}</span></div>
  </header>
  ${RESPONSES.filter(r => r.audit === a.id).map(r => `
  <article class="car" id="car-${r.car}">
    <div class="carhd">
      <div class="carid"><code>CAR ${r.car}</code><span class="clause">§ ${esc(r.clause)}</span></div>
      <h3>${esc(r.title)}</h3>
      <div class="carmeta">
        <span class="due">Due ${esc(fmtDue(r.due))}</span>
        <span class="decn" title="Decisions, dates or facts only the plant can supply">${decisions(r)} decision${decisions(r) === 1 ? '' : 's'} for Carol</span>
      </div>
    </div>
    <blockquote class="finding"><span class="lbl">Finding, verbatim</span>${esc(r.finding)}<footer>${esc(r.reference)}</footer></blockquote>
    <dl class="fields">
      ${PARTS.map(([key, label], i) => `
      <div class="field" data-field="${key}">
        <dt><span class="n">${i + 1}</span>${esc(label)}<button type="button" class="copy" data-copy="${esc(fieldText(r, key))}" aria-label="Copy ${esc(label)} for CAR ${r.car}">Copy</button></dt>
        <dd>${key === 'evidence'
          ? `<div class="ev"><div class="evcol now"><span class="evlbl">On file now</span><ul>${r.evidence_now.map(e => `<li>${withChips(e)}</li>`).join('')}</ul></div>
             <div class="evcol later"><span class="evlbl">To be produced</span><ul>${r.evidence_later.map(e => `<li>${withChips(e)}</li>`).join('')}</ul></div></div>`
          : paras(r[key])}</dd>
      </div>`).join('')}
    </dl>
  </article>`).join('')}
</section>`).join('');

const html = `<title>NSF CAR Responses</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
  :root{
    --paper:#F4F4F0; --surface:#FFFFFF; --sunken:#EBECE6;
    --ink:#171A18; --ink-2:#4A524D; --ink-3:#7B837E;
    --rule:#D9DDD8; --rule-2:#BFC6C0;
    --car:#2A5C7A; --car-bg:#E6EEF3;
    --dec:#8A5A00; --dec-bg:#FBF1DA; --dec-rule:#E7CB86;
    --now:#1F6B4E; --now-bg:#E3F0EA;
    --later:#5B6360; --later-bg:#EEF0ED;
    --due:#9A2F2F; --due-bg:#F8E6E4;
    --focus:#2A5C7A;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --paper:#121513; --surface:#1A1E1C; --sunken:#222724;
      --ink:#E8EBE8; --ink-2:#B4BBB6; --ink-3:#848C87;
      --rule:#2C322F; --rule-2:#3D4541;
      --car:#8FBEDC; --car-bg:#1B2C38;
      --dec:#F0C36A; --dec-bg:#3A2D12; --dec-rule:#6B5220;
      --now:#7FD1AE; --now-bg:#16302A;
      --later:#A9B1AC; --later-bg:#23282A;
      --due:#F0968E; --due-bg:#3A1F1F;
      --focus:#8FBEDC;
    }
  }
  :root[data-theme="dark"]{
    --paper:#121513; --surface:#1A1E1C; --sunken:#222724;
    --ink:#E8EBE8; --ink-2:#B4BBB6; --ink-3:#848C87;
    --rule:#2C322F; --rule-2:#3D4541;
    --car:#8FBEDC; --car-bg:#1B2C38;
    --dec:#F0C36A; --dec-bg:#3A2D12; --dec-rule:#6B5220;
    --now:#7FD1AE; --now-bg:#16302A;
    --later:#A9B1AC; --later-bg:#23282A;
    --due:#F0968E; --due-bg:#3A1F1F;
    --focus:#8FBEDC;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  @media (prefers-reduced-motion: reduce){ html{scroll-behavior:auto} }
  body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 "Source Sans 3",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--car)}
  code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.86em}
  :focus-visible{outline:2px solid var(--focus);outline-offset:2px}

  .shell{max-width:1240px;margin:0 auto;padding:0 20px 96px;display:grid;grid-template-columns:272px minmax(0,1fr);gap:0 40px}
  @media (max-width:900px){ .shell{grid-template-columns:minmax(0,1fr)} .rail{display:none} }

  /* rail */
  .rail{position:sticky;top:0;align-self:start;max-height:100vh;overflow-y:auto;padding:36px 0 40px;border-right:1px solid var(--rule)}
  .rail .railtitle{font-family:Spectral,Georgia,serif;font-size:18px;font-weight:600;margin:0 16px 14px 0}
  .navgrp{margin:0 16px 18px 0}
  .navhd{display:flex;flex-direction:column;gap:1px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3);padding:0 0 6px;border-bottom:1px solid var(--rule);margin-bottom:6px}
  .navhd b{color:var(--due);font-weight:600;letter-spacing:.05em}
  .navgrp a{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:baseline;padding:5px 6px;border-radius:3px;text-decoration:none;color:var(--ink-2);font-size:13px;line-height:1.3}
  .navgrp a:hover{background:var(--sunken);color:var(--ink)}
  .navgrp a code{color:var(--car);font-weight:500;font-size:11.5px}
  .navgrp a span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

  /* main */
  main{min-width:0;padding-top:36px}
  .kicker{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);margin:0 0 10px}
  h1{font-family:Spectral,Georgia,serif;font-weight:500;font-size:clamp(30px,4vw,40px);line-height:1.1;letter-spacing:-.01em;text-wrap:balance;margin:0 0 12px}
  .standfirst{font-family:Spectral,Georgia,serif;font-size:18px;color:var(--ink-2);max-width:64ch;margin:0 0 24px}

  .deadlines{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:0 0 20px}
  .dl{background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--due);padding:14px 16px;display:grid;gap:2px}
  .dl .when{font-family:"JetBrains Mono",monospace;font-size:20px;font-weight:600;color:var(--due);font-variant-numeric:tabular-nums}
  .dl .what{font-size:14px;color:var(--ink-2)}
  .dl .n{font-size:12px;color:var(--ink-3);letter-spacing:.05em;text-transform:uppercase}

  .rules{background:var(--surface);border:1px solid var(--rule);padding:16px 20px;margin:0 0 12px;max-width:none}
  .rules h2{font-family:Spectral,Georgia,serif;font-size:19px;font-weight:600;margin:0 0 8px}
  .rules ul{margin:0;padding-left:18px;font-size:15px;color:var(--ink-2)}
  .rules li{margin:4px 0}
  .rules li b{color:var(--ink)}
  .rules .note{margin:0 0 10px;font-size:14.5px;color:var(--ink-2);max-width:72ch}
  .tw{overflow-x:auto}
  .rules table{border-collapse:collapse;width:100%;font-size:14px}
  .rules th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--rule-2)}
  .rules td{padding:7px 10px;border-bottom:1px solid var(--rule);vertical-align:top;color:var(--ink-2)}
  .rules td b{color:var(--ink)}
  .legend{display:flex;flex-wrap:wrap;gap:10px 18px;font-size:13.5px;color:var(--ink-2);margin:14px 0 0;align-items:center}
  mark.dec{background:var(--dec-bg);color:var(--dec);border-bottom:1px solid var(--dec-rule);padding:0 4px;border-radius:2px;font-weight:500}
  .legend .now,.legend .later{display:inline-block;padding:1px 8px;border-radius:2px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;font-weight:600}
  .legend .now{background:var(--now-bg);color:var(--now)} .legend .later{background:var(--later-bg);color:var(--later)}

  section.audit{margin-top:48px}
  .audithd{border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:22px}
  .audithd h2{font-family:Spectral,Georgia,serif;font-size:26px;font-weight:500;margin:0 0 4px;text-wrap:balance}
  .auditmeta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--ink-3)}
  .auditmeta .due{color:var(--due);font-weight:600}

  article.car{background:var(--surface);border:1px solid var(--rule);margin:0 0 22px;scroll-margin-top:16px}
  .carhd{padding:18px 22px 14px;border-bottom:1px solid var(--rule);display:grid;gap:6px}
  .carid{display:flex;align-items:baseline;gap:12px}
  .carid code{background:var(--car-bg);color:var(--car);padding:2px 8px;border-radius:2px;font-weight:600;font-size:13px}
  .clause{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--ink-3)}
  .carhd h3{font-family:Spectral,Georgia,serif;font-size:22px;font-weight:600;margin:0;line-height:1.2;text-wrap:balance}
  .carmeta{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px}
  .carmeta span{padding:2px 9px;border-radius:2px;letter-spacing:.03em}
  .carmeta .due{background:var(--due-bg);color:var(--due);font-weight:600}
  .carmeta .decn{background:var(--dec-bg);color:var(--dec);font-weight:600}

  blockquote.finding{margin:0;padding:14px 22px;background:var(--sunken);font-family:Spectral,Georgia,serif;font-style:italic;font-size:15.5px;color:var(--ink-2);border-bottom:1px solid var(--rule)}
  blockquote.finding .lbl{display:block;font:600 10.5px/1 "Source Sans 3",sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);font-style:normal;margin-bottom:6px}
  blockquote.finding footer{font:12.5px "JetBrains Mono",monospace;font-style:normal;color:var(--ink-3);margin-top:8px}

  dl.fields{margin:0;padding:6px 22px 18px}
  .field{padding:14px 0 12px;border-bottom:1px solid var(--rule)}
  .field:last-child{border-bottom:none}
  .field dt{display:flex;align-items:center;gap:10px;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);margin:0 0 6px}
  .field dt .n{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--car);background:var(--car-bg);width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;font-weight:600}
  .field dd{margin:0;max-width:72ch}
  .field dd p{margin:0 0 8px;font-size:15.5px}
  .field dd p:last-child{margin-bottom:0}
  button.copy{margin-left:auto;font:600 11.5px/1 "Source Sans 3",sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--car);background:transparent;border:1px solid var(--rule-2);border-radius:3px;padding:5px 9px;cursor:pointer}
  button.copy:hover{background:var(--car-bg);border-color:var(--car)}
  button.copy.done{background:var(--now-bg);color:var(--now);border-color:var(--now)}

  .ev{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .evcol{padding:10px 12px;border-radius:3px}
  .evcol.now{background:var(--now-bg)} .evcol.later{background:var(--later-bg)}
  .evlbl{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-bottom:6px}
  .evcol.now .evlbl{color:var(--now)} .evcol.later .evlbl{color:var(--later)}
  .evcol ul{margin:0;padding-left:16px;font-size:14.5px}
  .evcol li{margin:2px 0}

  footer.page{margin-top:56px;padding-top:16px;border-top:1px solid var(--rule);font-size:13px;color:var(--ink-3);display:flex;flex-wrap:wrap;gap:6px 20px}
</style>

<div class="shell">
  <nav class="rail" aria-label="Corrective actions">
    <div class="railtitle">Twelve responses</div>
    ${nav}
  </nav>
  <main>
    <p class="kicker">${esc(META.facility)} · visit ${META.visit} · auditor ${esc(META.auditor)}</p>
    <h1>Corrective action responses for the August 2026 NSF audits</h1>
    <p class="standfirst">Drafts for ${esc(META.contact)} to paste into NSF Connect, one CAR at a time, in the six parts NSF asks for.
      Nothing here is closed and no response says it is: each is a plan with a named person and a date.</p>

    <div class="deadlines">
      ${AUDITS.map(a => `<div class="dl"><span class="when">${esc(a.dueLabel)}</span><span class="what">${esc(a.scheme)}</span><span class="n">${a.count} CARs · audit ${a.id}</span></div>`).join('')}
    </div>

    <div class="rules people">
      <h2>People named in the responses</h2>
      <p class="note">Names and titles are from <b>${esc(META.orgChart)}</b>. Confirm each is still current before submitting; a title that has changed since February is a fix in the data file, not in NSF Connect.</p>
      <div class="tw"><table>
        <thead><tr><th>Name</th><th>Title</th><th>Named for</th></tr></thead>
        <tbody>${PEOPLE.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.title)}</td><td>${esc(p.role)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="rules">
      <h2>Before you submit</h2>
      <ul>
        <li><b>Where:</b> clients.nsf.org → Corrective Actions → open the CAR-NO. link → fill the fields → <b>Save</b> as you go → <b>Save &amp; Submit</b>. Attach evidence with <b>Add Document</b>.</li>
        <li><b>Replace every amber bracket before submitting.</b> Each is a decision, date or fact only the plant can supply. The Copy button keeps them in the text on purpose, so one cannot slip through unnoticed.</li>
        <li><b>Root causes NSF sends back:</b> restating the finding; "unaware of the requirement"; "employee did not follow procedure" without asking why. <b>Actions NSF sends back:</b> "SOP will be updated" with no specifics; "Not applicable".</li>
        <li><b>Attach what is on file now</b> even though first-time minors do not strictly require evidence. It is what makes the plan credible.</li>
        <li><b>If a response comes back</b> ADDL INFO RQSTD or REJECTED, add a dated reply under the original. Never overwrite it.</li>
      </ul>
      <div class="legend">
        <span><mark class="dec">[CAROL: …]</mark> a decision for the plant</span>
        <span><span class="now">On file now</span> evidence that exists today</span>
        <span><span class="later">To be produced</span> evidence the plan will create</span>
      </div>
    </div>

    ${sections}

    <footer class="page">
      <span>Prepared ${esc(META.prepared)}</span>
      <span>Findings quoted verbatim from the Corrective Action Reports of 5 September 2026</span>
      <span>Doctrine: D-056 · docs/v2/queued/audit-nc-triage.md</span>
    </footer>
  </main>
</div>

<script>
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button.copy'); if (!b) return;
    const text = b.getAttribute('data-copy');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      const was = b.textContent; b.textContent = 'Copied'; b.classList.add('done');
      setTimeout(() => { b.textContent = was; b.classList.remove('done'); }, 1400);
    } catch { b.textContent = 'Select and copy'; }
  });
</script>
`;
writeFileSync(HTML_OUT, html);
console.log(`wrote ${MD_OUT} (${md.length} chars) and ${HTML_OUT} (${html.length} chars); ${RESPONSES.length} responses, ${RESPONSES.reduce((n, r) => n + decisions(r), 0)} decisions for Carol`);
