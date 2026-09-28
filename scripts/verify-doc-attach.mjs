// Filing the signed, scanned originals against the documents they belong to.
//
// Document Control comes back from an update pass with ~100 scanned, signed
// PDFs and the only way to file them was one document at a time. This is the
// bulk path: the plan is built from FILENAMES ALONE (nothing is uploaded to
// find out what would happen), the match is the SAME matcher the revision
// upload uses, and an unmatched file is reported rather than attached to a
// guess — removing a signed original takes an admin, so a wrong one is
// expensive.
//
// Caller sets PORT + DBPATH on a FRESH database and points R2_* at
// scripts/s3-stand-in.mjs.
const PORT = process.env.PORT || 4992;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const DOCS = [
  ['da-sop401', 'SOP 401', 'cGMP Policy and Procedure', 'V3'],
  ['da-pol007', 'POLICY 007', 'Visitor and Contractor Policy', 'V3'],
  ['da-wi007', 'WI007', 'Auger Stick Pack', 'V1'],
  ['da-sop415', 'SOP 415', 'Recall and Mock Recall Procedures', 'V3'],  // browser section only
];
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('da-a','Doc Admin','Doc Admin','admin','quality',1,'{"sops":"edit","work-instructions":"edit","job-descriptions":"edit"}','SC-DA', datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('da-s','Doc Clerk','Doc Clerk','supervisor','quality',1,'{"sops":"edit","work-instructions":"edit","job-descriptions":"edit"}','SC-DS', datetime('now','+7 day'))`).run();
  const ins = db.prepare(`INSERT OR REPLACE INTO sop_documents (id, doc_type, doc_number, title, category, revision, status, owner)
    VALUES (?, 'sop', ?, ?, 'quality', ?, 'active', 'Document Control')`);
  for (const [id, num, title, rev] of DOCS) ins.run(id, num, title, rev);
  db.close();
}

const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
async function signIn(name, id, code, password) {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password, setup_code: code });
  return (await post('/users/login', { name, password })).json();
}
const auth = await signIn('Doc Admin', 'da-a', 'SC-DA', 'DocAdm2026!');
const clerk = await signIn('Doc Clerk', 'da-s', 'SC-DS', 'DocClk2026!');
const A = { ...H, Authorization: `Bearer ${auth.token}` };
const S = { ...H, Authorization: `Bearer ${clerk.token}` };
t('signed in', !!auth?.token && !!clerk?.token, JSON.stringify(auth).slice(0, 140));

// Five filenames: three that name a document, two that do not.
const NAMES = [
  'SOP-401_cGMP_Policy_V4.pdf',
  'POLICY 007 Visitor and Contractor Policy V4.pdf',
  'WI007_Auger_Stick_Pack.pdf',
  'SOP-999_Something_We_Do_Not_Have_V2.pdf',
  'scan0007.pdf',
];
const pdf = (label) => Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
  `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${label}\n` +
  `xref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF`);

const attachmentCount = () => {
  const db = new Database(process.env.DBPATH, { readonly: true });
  const c = db.prepare('SELECT COUNT(*) AS c FROM document_attachments').get().c;
  db.close();
  return c;
};

// ── The plan, from names alone ──────────────────────────────────────────────
const before = attachmentCount();
const planRes = await fetch(`${URL}/api/documents/attachments/plan`, { method: 'POST', headers: A, body: JSON.stringify({ filenames: NAMES }) });
t('the plan endpoint is not swallowed by /:id/attachments', planRes.status === 200, `HTTP ${planRes.status}`);
const plan = await planRes.json();
const byName = Object.fromEntries((plan.items || []).map(i => [i.filename, i]));
const pj = JSON.stringify(plan).slice(0, 400);

t('THE PLAN WRITES NOTHING', attachmentCount() === before, `${before} → ${attachmentCount()}`);
t('every filename is accounted for', (plan.items || []).length === NAMES.length, pj);
t('three files match a document', plan.will_attach === 3, pj);
t('two files match nothing', plan.unmatched === 2, pj);
t('a file named for SOP 401 resolves to SOP 401',
  byName['SOP-401_cGMP_Policy_V4.pdf']?.document_id === 'da-sop401', pj);
t('it matched on the document number, not a guess',
  byName['SOP-401_cGMP_Policy_V4.pdf']?.matched_on === 'document number', pj);
t('POLICY 007 is not truncated to POL — the longest prefix wins',
  byName['POLICY 007 Visitor and Contractor Policy V4.pdf']?.document_id === 'da-pol007', pj);
t('the revision in the filename travels with the signed copy',
  byName['SOP-401_cGMP_Policy_V4.pdf']?.revision === '4', pj);
t('a filename that names no revision carries none, never a guess',
  byName['WI007_Auger_Stick_Pack.pdf']?.revision === null, pj);
t('a number the registry does not hold is NAMED, not matched',
  byName['SOP-999_Something_We_Do_Not_Have_V2.pdf']?.state === 'unmatched'
  && /SOP-999/.test(byName['SOP-999_Something_We_Do_Not_Have_V2.pdf']?.reason || ''), pj);
t('a file with no document number in its name is reported as such',
  byName['scan0007.pdf']?.state === 'unmatched'
  && /no document number/i.test(byName['scan0007.pdf']?.reason || ''), pj);
t('no unmatched file is given a document id',
  (plan.items || []).filter(i => i.state === 'unmatched').every(i => i.document_id === null), pj);
t('the registry says how many documents still have no signed copy',
  plan.documents_without_signed_copy >= 3, pj);

// ── The commit ──────────────────────────────────────────────────────────────
const fd = new FormData();
for (const n of NAMES) fd.append('files', new Blob([pdf(n)], { type: 'application/pdf' }), n);
const res = await fetch(`${URL}/api/documents/attachments/bulk`, {
  method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd });
t('the bulk attach answers 201', res.status === 201, `HTTP ${res.status}`);
const out = await res.json();
const oj = JSON.stringify(out).slice(0, 400);
t('three signed copies were filed', (out.attached || []).length === 3, oj);
t('the two that matched nothing were skipped and named',
  (out.skipped || []).length === 2
  && (out.skipped || []).every(s => NAMES.includes(s.filename) && !!s.reason), oj);
t('NOTHING WAS ATTACHED TO A GUESS', attachmentCount() === before + 3, `${attachmentCount()}`);
t('the outstanding count fell by three',
  out.documents_without_signed_copy === plan.documents_without_signed_copy - 3, oj);

const listOf = async (id) => (await (await fetch(`${URL}/api/documents/${id}/attachments`, { headers: A })).json());
const sop = await listOf('da-sop401');
const pol = await listOf('da-pol007');
const wi = await listOf('da-wi007');
t('SOP 401 has exactly one signed copy', sop.length === 1, JSON.stringify(sop).slice(0, 200));
t('and it is the file named for it', sop[0]?.filename === 'SOP-401_cGMP_Policy_V4.pdf', JSON.stringify(sop[0] || {}).slice(0, 200));
t('it is filed as the signed original, not an ordinary attachment', sop[0]?.kind === 'signed_original', JSON.stringify(sop[0] || {}).slice(0, 200));
t('the attachment records which revision was signed', sop[0]?.revision === '4', JSON.stringify(sop[0] || {}).slice(0, 200));
t('a file named for SOP 401 did not land on POLICY 007',
  pol.length === 1 && pol[0].filename.startsWith('POLICY 007'), JSON.stringify(pol.map(a => a.filename)));
t('WI007 got its own copy with no revision claimed', wi.length === 1 && wi[0].revision === null, JSON.stringify(wi[0] || {}).slice(0, 200));

// The bytes an auditor is handed are the file that was uploaded.
const got = await fetch(sop[0].url);
const bytes = Buffer.from(await got.arrayBuffer());
t('the stored signed copy is the file that was uploaded',
  got.ok && bytes.equals(pdf('SOP-401_cGMP_Policy_V4.pdf')), `HTTP ${got.status} · ${bytes.length} bytes`);

// ── The trail, and re-running ───────────────────────────────────────────────
const trail = (() => {
  const db = new Database(process.env.DBPATH, { readonly: true });
  const r = db.prepare("SELECT entity_id, details FROM audit_log WHERE entity_type = 'document' AND action = 'attach'").all();
  db.close(); return r;
})();
t('a bulk attach leaves the trail a manual one would — one entry per document',
  trail.length === 3 && new Set(trail.map(r => r.entity_id)).size === 3, `${trail.length} audit rows`);
t('each entry names the file it filed and that it came through the bulk path',
  trail.every(r => /signed_original/.test(r.details || '') && /"bulk":true/.test(r.details || '')),
  JSON.stringify(trail[0] || {}).slice(0, 220));

const fd2 = new FormData();
for (const n of NAMES.slice(0, 3)) fd2.append('files', new Blob([pdf(n)], { type: 'application/pdf' }), n);
const again = await (await fetch(`${URL}/api/documents/attachments/bulk`, {
  method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd2 })).json();
t('RE-RUNNING THE SAME BATCH FILES NOTHING TWICE', (again.attached || []).length === 0, JSON.stringify(again).slice(0, 300));
t('and says why each one was skipped',
  (again.skipped || []).length === 3
  && (again.skipped || []).every(s => /already has a signed copy/i.test(s.reason || '')), JSON.stringify(again.skipped));
t('no second copy reached the shelf', attachmentCount() === before + 3, `${attachmentCount()}`);

const plan2 = await (await fetch(`${URL}/api/documents/attachments/plan`, { method: 'POST', headers: A, body: JSON.stringify({ filenames: NAMES.slice(0, 3) }) })).json();
t('the plan says so before anything is uploaded', plan2.already_attached === 3 && plan2.will_attach === 0, JSON.stringify(plan2).slice(0, 300));

// ── Undoing one is deliberately expensive, which is why the match matters ───
const del = await fetch(`${URL}/api/documents/attachments/${sop[0].id}`, { method: 'DELETE', headers: S });
t('a supervisor cannot remove a signed original', del.status === 403, `HTTP ${del.status}`);
t('it is still on file', (await listOf('da-sop401')).length === 1);

const bad = await fetch(`${URL}/api/documents/attachments/plan`, { method: 'POST', headers: A, body: JSON.stringify({}) });
t('a plan with no filenames is refused', bad.status === 400, `HTTP ${bad.status}`);

// ── In a real browser: the plan is read before a byte moves ─────────────────
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
  }, [auth.token, auth.user]);
  await page.goto(`${URL}/?tab=sops`);
  await page.waitForLoadState('networkidle');

  const btn = page.locator('[data-attach-signed]');
  const there = await btn.count() > 0;
  t('the control is where the problem is seen — on Controlled Documents', there,
    await page.locator('h2').first().innerText().catch(() => 'no heading'));

  if (there) {
    await btn.first().click();
    await page.waitForSelector('[data-signed-modal]', { timeout: 8000 });
    t('the modal opens', await page.locator('[data-signed-modal]').count() === 1);

    const countBefore = attachmentCount();
    await page.setInputFiles('[data-signed-input]', [
      { name: 'SOP-415_Recall_Procedures_V2.pdf', mimeType: 'application/pdf', buffer: pdf('SOP-415_Recall_Procedures_V2.pdf') },
      { name: 'scan0099.pdf', mimeType: 'application/pdf', buffer: pdf('scan0099.pdf') },
    ]);
    await page.waitForSelector('[data-signed-row]', { timeout: 8000 });
    const rowStates = await page.locator('[data-signed-row]').evaluateAll(els => els.map(e => e.dataset.signedState));
    t('the plan is on screen', rowStates.length === 2, JSON.stringify(rowStates));
    t('CHOOSING FILES UPLOADS NOTHING', attachmentCount() === countBefore, `${countBefore} → ${attachmentCount()}`);
    const body = await page.locator('[data-signed-modal]').innerText();
    t('the plan names the document it matched', /SOP 415/.test(body) && /Recall and Mock Recall/.test(body), body.slice(0, 300));
    t('and names the one it could not', rowStates.includes('unmatched') && /scan0099\.pdf/.test(body), body.slice(0, 300));
    t('it says removing a signed original takes an admin', /admin/i.test(body), body.slice(0, 400));

    await page.locator('[data-signed-commit]').click();
    await page.waitForSelector('[data-signed-done]', { timeout: 15000 });
    t('one signed copy was filed from the browser', (await page.locator('[data-signed-done]').innerText()) === '1');
    t('and only one — the unmatched file was not filed anywhere', attachmentCount() === countBefore + 1, `${attachmentCount()}`);
    const after = await page.locator('[data-signed-modal]').innerText();
    t('the unmatched file is named in the result with its reason',
      /scan0099\.pdf/.test(after) && /no document number/i.test(after), after.slice(0, 600));
    t('and the screen says how many documents still have no signed copy',
      /no signed copy on file/.test(after), after.slice(0, 500));
    const sop415 = await listOf('da-sop415');
    t('it landed on SOP 415 as the signed original with its revision',
      sop415.length === 1 && sop415[0].kind === 'signed_original' && sop415[0].revision === '2',
      JSON.stringify(sop415[0] || {}).slice(0, 220));
  } else {
    for (let i = 0; i < 10; i++) t('browser assertion (control could not reach the screen)', false);
  }
} finally { await browser.close(); }

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
