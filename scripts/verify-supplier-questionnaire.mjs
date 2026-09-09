// FORM 404-1 V2 on a signed link, end to end: Quality sends a link (shown once),
// the supplier answers on a phone, attaches a file, signs by typing the name of
// the person completing the form, and the signed PDF files against the supplier
// so the register stops reading "no questionnaire". Live server + S3 stand-in +
// a real browser at 390px. Caller sets PORT + DBPATH + the R2 stand-in; needs a
// built client.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const PORT = process.env.PORT || 4979; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
const SUP_ID = 'sq-supplier-1';
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sq-qa','Maria Test','Maria Test','supervisor','qa',1,'SC-SQ',datetime('now','+7 day'),'{"suppliers":"edit"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sq-buy','Jake Test','Jake Test','operator','purchasing',1,'SC-SB',datetime('now','+7 day'),'{"suppliers":"view"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using, source) VALUES (?, 'Mill Haven Test Foods', 'ingredient', 1, 'in_app')`).run(SUP_ID);
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await call('POST', '/users/login', { name: 'Maria Test' });
await call('POST', '/users/set-password', { user_id: 'sq-qa', password: 'Quality2026!', setup_code: 'SC-SQ' });
const qa = await (await call('POST', '/users/login', { name: 'Maria Test', password: 'Quality2026!' })).json();
t('Quality signed in', !!qa?.token);
const A = qa.token;

console.log('\n── the form is the plant\'s, word for word ──');
const { QUESTIONS, HEADER, FORM } = await import('../server/supplier-questionnaire.js');
t('41 questions transcribed, five header lines, FORM 404-1 V2', QUESTIONS.length === 41 && HEADER.length === 5 && FORM.code === 'FORM 404-1' && FORM.revision === 'V2');
t('the first and last rows read as the document does', QUESTIONS[0].text === 'Does your facility have a Food Facility Registration number?' && QUESTIONS[40].text === 'Does the company maintain records for FSVP activities?');
t('the instruction line names jake@powder-ops.com, as the form does', /jake@powder-ops\.com/.test(FORM.instruction));

console.log('\n── before: the register says no questionnaire ──');
let list = await (await call('GET', '/suppliers', null, A)).json();
let row = list.suppliers.find(s => s.id === SUP_ID);
t('the supplier is actively used with no questionnaire on file', row?.no_questionnaire === true && row.questionnaire_files === 0);

console.log('\n── Quality sends the link ──');
let r = await call('POST', `/suppliers/${SUP_ID}/questionnaire/send`, { sent_to: 'quality@millhaven.example' }, A);
const sent = await r.json();
t('a link is issued once, to a named recipient', r.status === 201 && /\/supplier-form\/[A-Za-z0-9_-]{20,}$/.test(sent.link) && sent.sent_to === 'quality@millhaven.example', JSON.stringify(sent).slice(0, 160));
const token = sent.link.split('/').pop();
let detail = await (await call('GET', `/suppliers/${SUP_ID}`, null, A)).json();
t('the record lists the link as sent and never carries the token', detail.questionnaires?.length === 1 && detail.questionnaires[0].status === 'sent' && !JSON.stringify(detail).includes(token));
t('this year\'s qualification period records the request date', detail.qualifications.some(q => q.questionnaire_requested_at));
const buyer = await (async () => { await call('POST', '/users/login', { name: 'Jake Test' }); await call('POST', '/users/set-password', { user_id: 'sq-buy', password: 'Buyer2026!!', setup_code: 'SC-SB' }); return (await (await call('POST', '/users/login', { name: 'Jake Test', password: 'Buyer2026!!' })).json()); })();
t('sending again withdraws the first link (one live link per supplier)', await (async () => {
  const r2 = await call('POST', `/suppliers/${SUP_ID}/questionnaire/send`, { sent_to: 'again@millhaven.example' }, A);
  const s2 = await r2.json();
  const gone = (await fetch(`${URL}/api/supplier-questionnaire/${token}`)).status === 404;
  // use the new one from here on
  globalThis.__tok = s2.link.split('/').pop();
  return r2.status === 201 && gone;
})());
const tok = globalThis.__tok;
t('a purchasing operator without the grant cannot send', (await call('POST', `/suppliers/${SUP_ID}/questionnaire/send`, {}, buyer.token)).status === 403);

console.log('\n── the supplier, with no account ──');
const pub = (m, p, b) => fetch(`${URL}/api/supplier-questionnaire${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
let view = await (await pub('GET', `/${tok}`)).json();
t('the public page gets the form, the supplier name and nothing else', view.form?.questions?.length === 41 && view.supplier_name === 'Mill Haven Test Foods' && !('token_hash' in view) && view.status === 'sent');
t('a wrong token is refused in words', (await pub('GET', '/not-a-real-token-at-all-xxxxxxxx')).status === 404);
r = await pub('PUT', `/${tok}`, { answers: { supplier_name: 'Mill Haven Test Foods', q01: 'yes', q01_detail: '2027-03-31', q02: 'no', q99: 'yes', nonsense: 1 } });
view = await r.json();
t('partial answers save and the status becomes in progress', r.status === 200 && view.status === 'in_progress' && view.answers.q01 === 'yes' && view.answers.q01_detail === '2027-03-31' && !('q99' in view.answers) && !('nonsense' in view.answers));
t('the still-needed list counts the blanks', view.missing.some(m => m.key === 'questions' && /39 questions/.test(m.label)) && view.missing.some(m => m.key === 'completed_by'));
r = await pub('POST', `/${tok}/submit`, { signed_name: 'Pat Quality', signed_title: 'QA Manager', attest: true });
t('submitting with blanks is refused and says what is missing', r.status === 400 && /Still needed/.test((await r.json()).error));
const all = { supplier_address: '1 Dairy Rd, WI', completed_by: 'Pat Quality', phone: '555-0100' };
for (const q of QUESTIONS) all[q.key] = q.key === 'q04' || q.key === 'q05' ? 'no' : 'yes';
all.q08_detail = '120'; all.q35_detail = 'Eurofins';
view = await (await pub('PUT', `/${tok}`, { answers: all })).json();
t('with everything answered nothing is still needed', view.missing.length === 0, JSON.stringify(view.missing));
// an attachment for the org-chart row
const fd = new FormData(); fd.append('kind', 'org_chart'); fd.append('files', new Blob(['%PDF-1.4 org chart'], { type: 'application/pdf' }), 'org-chart.pdf');
r = await fetch(`${URL}/api/supplier-questionnaire/${tok}/files`, { method: 'POST', body: fd });
view = await r.json();
t('the supplier can attach the organization chart the form asks for', r.status === 200 && view.files.length === 1 && view.files[0].kind === 'org_chart');
r = await pub('POST', `/${tok}/submit`, { signed_name: 'Someone Else', signed_title: 'QA Manager', attest: true });
t('the signature must be the name of the person completing the form', r.status === 400 && /must be the name/.test((await r.json()).error));
r = await pub('POST', `/${tok}/submit`, { signed_name: 'Pat Quality', signed_title: 'QA Manager', attest: false });
t('and the box must be ticked', r.status === 400);
r = await pub('POST', `/${tok}/submit`, { signed_name: 'pat quality', signed_title: 'QA Manager', attest: true });
view = await r.json();
t('signed and submitted; the name is recorded with time and address', r.status === 200 && view.status === 'submitted' && view.signature?.name === 'pat quality' && view.signature.title === 'QA Manager' && !!view.signature.at && view.pdf_stored === true, JSON.stringify(view).slice(0, 200));
t('after submission the link is read-only', (await pub('PUT', `/${tok}`, { answers: { q01: 'no' } })).status === 409 && (await pub('GET', `/${tok}`)).status === 200);

console.log('\n── on the record ──');
detail = await (await call('GET', `/suppliers/${SUP_ID}`, null, A)).json();
const qf = detail.files.find(f => f.kind === 'questionnaire');
t('the signed questionnaire is filed under the supplier as a stored PDF', !!qf && qf.stored === 1 && /FORM-404-1-V2/.test(qf.filename));
t('the attachment is filed too, against the same period', detail.files.some(f => f.kind === 'org_chart'));
t('the record shows the questionnaire as submitted with the signature', detail.questionnaires[0].status === 'submitted' && detail.questionnaires[0].signature.name === 'pat quality');
t('this year\'s period records the received date', detail.qualifications.some(q => q.questionnaire_received_at));
const dl = await fetch(`${URL}/api/suppliers/files/${qf.id}/download`, { headers: { Authorization: `Bearer ${A}` } });
const bytes = Buffer.from(await dl.arrayBuffer());
t('the PDF downloads through our own origin and is a PDF', dl.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-', `${dl.status} ${bytes.subarray(0, 8)}`);
list = await (await call('GET', '/suppliers', null, A)).json();
row = list.suppliers.find(s => s.id === SUP_ID);
t('the register no longer says "no questionnaire"; it now awaits a disposition', row.no_questionnaire === false && row.awaiting_disposition === true && row.questionnaire_files === 1);
{ const db = new Database(dbPath);
  const msgs = db.prepare("SELECT body FROM chat_messages WHERE body LIKE '%Supplier questionnaire received%'").all();
  t('Quality and Purchasing were told through ReadyBot', msgs.length >= 1 && /Mill Haven Test Foods/.test(msgs[0].body) && /pat quality/.test(msgs[0].body), String(msgs.length));
  const audit = db.prepare("SELECT action, actor FROM audit_log WHERE action LIKE '%questionnaire%' ORDER BY rowid").all();
  t('sent and submitted are both audited, the submission under the supplier\'s name', audit.some(a => /sent/.test(a.action)) && audit.some(a => /submitted/.test(a.action) && /supplier-link:pat quality/.test(a.actor || '')), JSON.stringify(audit));
  const stored = db.prepare('SELECT extracted_text FROM supplier_files WHERE id = ?').get(qf.id).extracted_text || '';
  t('the answers are the searchable text of the filed questionnaire', /Eurofins/.test(stored) && /Food Facility Registration number\? Yes/.test(stored));
  db.close(); }
t('a submitted questionnaire cannot be withdrawn', (await call('POST', `/suppliers/questionnaires/${detail.questionnaires[0].id}/revoke`, {}, A)).status === 409);

console.log('\n── in the browser, on a phone ──');
const s3 = await (await call('POST', `/suppliers/${SUP_ID}/questionnaire/send`, { sent_to: 'phone@millhaven.example' }, A)).json();
const tok3 = s3.link.split('/').pop();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await m.goto(`${URL}/supplier-form/${tok3}`);
await m.waitForTimeout(2500);
t('the page opens with the form title and the supplier\'s name', /Supplier Qualification Questionnaire/.test(await m.locator('body').innerText()) && /Mill Haven Test Foods/.test(await m.locator('body').innerText()));
t('nothing sticks out sideways at 390px', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
t('all 41 questions are on the page with Yes / No / N/A', await m.locator('[data-question]').count() === 41 && await m.locator('[data-question="q01"] [data-answer]').count() === 3);
await m.locator('[data-header="supplier_name"]').fill('Mill Haven Test Foods');
await m.locator('[data-header="supplier_address"]').fill('1 Dairy Rd');
await m.locator('[data-header="completed_by"]').fill('Pat Quality');
await m.locator('[data-header="phone"]').fill('555-0100');
for (const q of QUESTIONS) await m.locator(`[data-question="${q.key}"] [data-answer="yes"]`).click();
await m.waitForTimeout(1500);
t('tapping an answer marks it and it saves', (await m.locator('[data-question="q07"] [data-answer="yes"]').getAttribute('aria-pressed')) === 'true' && /All answers saved/.test(await m.locator('body').innerText()));
t('the still-needed list has gone', await m.locator('[data-missing]').count() === 0);
await m.locator('[data-sign-name]').fill('Pat Quality');
await m.locator('[data-sign-title]').fill('QA Manager');
await m.locator('[data-sign-attest]').check();
await m.locator('[data-submit]').click();
await m.waitForTimeout(2500);
t('submitting shows the thank-you with the signature', await m.locator('[data-submitted]').count() === 1 && /Signed by Pat Quality, QA Manager/.test(await m.locator('[data-submitted]').innerText()));
t('the answer buttons are now disabled', await m.locator('[data-question="q01"] [data-answer="yes"]').isDisabled());
// and the office sees it
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, qa.user]);
await page.goto(`${URL}/?tab=suppliers`);
await page.waitForTimeout(3500);
await page.locator('tr', { hasText: 'Mill Haven Test Foods' }).first().locator('td').first().click();
await page.waitForTimeout(1500);
// The list renders cards (hidden above md) and a table; both mount the detail
// when a row is expanded, so count what is VISIBLE, not what is in the DOM.
t('the supplier record shows the questionnaire section with the submission', await page.locator('[data-questionnaires]:visible').count() === 1 && await page.locator('[data-questionnaire="submitted"]:visible').count() >= 1);
t('and offers Quality the button to send another', await page.locator('[data-send-questionnaire]:visible').count() === 1);
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
