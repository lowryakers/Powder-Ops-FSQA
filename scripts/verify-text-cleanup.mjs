// D-403: leftover formatting from Word / Google Docs, live and in a real browser.
//   - Doc Control Review lists the documents that still carry it, checking the
//     copy a person would edit (the open draft revision when there is one);
//   - the document view already prints "\-organoleptic" as "-organoleptic";
//   - the editor's "Clean up formatting" says what it will change before it
//     changes anything, applies it to the text being edited, and saving clears
//     the document off the list. Nothing is rewritten without a person saving.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5260;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES ('tc-dc', 'Tidy Controller', 'Tidy Controller', 'supervisor', 'document_control', 1, ?, 'SC-tc-dc', datetime('now','+7 day'))`)
  .run(JSON.stringify({ sops: 'edit' }));
const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
await call('POST', '/users/set-password', { user_id: 'tc-dc', password: 'TidyDocs2026!', setup_code: 'SC-tc-dc' });
const L = await call('POST', '/users/login', { name: 'Tidy Controller', password: 'TidyDocs2026!' });
const A = { ...H, Authorization: `Bearer ${L.body?.token}` };
t('signed in Document Control', !!L.body?.token);

const MESSY = [
  '## Scope',
  '',
  'Botanical  Powders are tested on receipt.',
  '',
  '| Material  Format | Example | Every Batch |',
  '| --- | --- | --- |',
  '| **Raw Materials** |  |  |',
  '| Botanical  Powders | Ginger Powder | \\-organoleptic |',
  '|  |  |  |',
].join('\n');
const TIDY = '## Scope\n\nAll good.\n\n| a | b |\n| --- | --- |\n| x | y |';

console.log('\n── Doc Control Review lists it ──');
const messy = await call('POST', '/documents', { doc_type: 'sop', doc_number: 'SOP 901', title: 'Messy Import', category: 'quality', content: MESSY }, A);
const tidy = await call('POST', '/documents', { doc_type: 'sop', doc_number: 'SOP 902', title: 'Tidy Import', category: 'quality', content: TIDY }, A);
t('two draft documents filed', !!messy.body?.id && !!tidy.body?.id, JSON.stringify(messy.body));
// An approved document whose OPEN DRAFT revision is already tidy: the draft is what gets edited, so it is not listed.
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status, description)
  VALUES ('tc-in-force', 'sop', 'SOP 903', 'In Force', 'quality', 'V1', 'active', ?)`).run(MESSY);
db.prepare(`INSERT INTO document_revisions (id, document_id, revision, status, title, description)
  VALUES ('tc-draft', 'tc-in-force', 'V2', 'draft', 'In Force', ?)`).run(TIDY);
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status, description)
  VALUES ('tc-in-force-2', 'sop', 'SOP 904', 'In Force Messy', 'quality', 'V1', 'active', ?)`).run(MESSY);
let q = await call('GET', '/doc-review?source=formatting-leftovers', undefined, A);
const pile = () => (q.body?.sources || []).find(s => s.key === 'formatting-leftovers');
const rows = () => pile()?.items || [];
t('the pile is on Doc Control Review', !!pile(), JSON.stringify(Object.keys(q.body || {})));
const titles = rows().map(r => r.title);
t('the messy draft is listed', titles.some(x => x.includes('SOP 901')), JSON.stringify(titles));
t('the tidy one is not', !titles.some(x => x.includes('SOP 902')));
t('an approved document with a tidy draft revision is not (the draft is what gets edited)', !titles.some(x => x.includes('SOP 903')));
const row904 = rows().find(r => r.title.includes('SOP 904'));
t('an approved one with nothing staged says to start a new revision', /new revision/i.test(row904?.extra || ''), row904?.extra);
const row901 = rows().find(r => r.title.includes('SOP 901'));
t('the row names what it found', /stray backslash/.test(row901?.subtitle || '') && /empty table row/.test(row901?.subtitle || ''), row901?.subtitle);
const before = db.prepare("SELECT description FROM sop_documents WHERE id = 'tc-in-force-2'").get().description;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [L.body.token, L.body.user]);

  console.log('\n── the reader prints it tidily already ──');
  await page.goto(`${URL}/?tab=sops&doc=${messy.body.id}`);
  await page.waitForSelector('table', { timeout: 15000 });
  const shown = await page.evaluate(() => [...document.querySelectorAll('table td')].map(td => td.textContent));
  t('the document view shows "-organoleptic", not "\\-organoleptic"', shown.includes('-organoleptic') && !shown.some(x => x.includes('\\-')), JSON.stringify(shown));

  console.log('\n── Clean up formatting in the editor ──');
  await page.locator('div.fixed button', { hasText: /^\s*Edit\s*$/ }).first().click();
  await page.waitForSelector('[data-cleanup-open]', { timeout: 10000 });
  await page.click('[data-cleanup-open]');
  const kinds = await page.$$eval('[data-cleanup-kind]', els => els.map(e => e.getAttribute('data-cleanup-kind')));
  t('it says what it will change before changing anything', kinds.includes('escapes') && kinds.includes('spaces') && kinds.includes('empty_rows'), JSON.stringify(kinds));
  await page.click('[data-body-mode="markdown"]');
  const pending = await page.locator('textarea').first().inputValue();
  t('…and the text is unchanged until Apply', pending.includes('\\-organoleptic'));
  await page.click('[data-cleanup-apply]');
  const after = await page.locator('textarea').first().inputValue();
  t('Apply cleans the text being edited', after.includes('| -organoleptic |') && !after.includes('Material  Format') && !after.includes('|  |  |  |'), after);
  t('no words lost', after.includes('Botanical Powders') && after.includes('**Raw Materials**') && after.includes('Ginger Powder'));
  t('the stored document is still the messy one until Save', db.prepare('SELECT description FROM sop_documents WHERE id = ?').get(messy.body.id).description.includes('\\-organoleptic'));
  await page.click('[data-cleanup-open]');
  t('cleaning again finds nothing', await page.locator('[data-cleanup-none]').count() === 1);
  await page.getByRole('button', { name: /^Close$/ }).click();
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(800);
  const saved = db.prepare('SELECT description FROM sop_documents WHERE id = ?').get(messy.body.id).description;
  t('Save stores the clean text', saved.includes('| -organoleptic |') && !saved.includes('\\-'), saved);
} finally {
  await browser.close();
}

console.log('\n── the list clears itself; nothing else moved ──');
q = await call('GET', '/doc-review?source=formatting-leftovers', undefined, A);
t('the saved document leaves the list', !rows().some(r => r.title.includes('SOP 901')));
t('the approved document was not touched by anything', db.prepare("SELECT description FROM sop_documents WHERE id = 'tc-in-force-2'").get().description === before);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
