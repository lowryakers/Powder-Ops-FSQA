// D-402: merging cells in a controlled-document table, in a real browser.
//   - the editor offers merge-left / merge-up on a cell and merge-row beside a row;
//   - a merged cell shows as "merged · split" and splitting puts it back;
//   - Preview draws the merge with colspan / rowspan;
//   - the stored Markdown carries the markers (what the PDF and reader read).
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5259;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES ('tm-dc', 'Table Merger', 'Table Merger', 'supervisor', 'document_control', 1, ?, 'SC-tm-dc', datetime('now','+7 day'))`)
  .run(JSON.stringify({ sops: 'edit' }));
const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
await call('POST', '/users/set-password', { user_id: 'tm-dc', password: 'TableMerge2026!', setup_code: 'SC-tm-dc' });
const L = await call('POST', '/users/login', { name: 'Table Merger', password: 'TableMerge2026!' });
t('signed in Document Control', !!L.body?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [L.body.token, L.body.user]);
  await page.goto(`${URL}/?tab=sops`);
  await page.getByRole('button', { name: /New SOP/ }).click();
  await page.getByRole('button', { name: /^Table$/ }).last().click();
  await page.waitForSelector('[data-table-cell="0-0"]', { timeout: 10000 });
  await page.fill('[data-table-cell="h-0"]', 'Material Format');
  await page.fill('[data-table-cell="h-1"]', 'Example');
  await page.fill('[data-table-cell="h-2"]', 'Every Batch');
  await page.fill('[data-table-cell="0-0"]', 'Raw Materials');
  await page.getByRole('button', { name: /Add row/ }).click();
  await page.getByRole('button', { name: /Add row/ }).click();
  await page.fill('[data-table-cell="1-0"]', 'Botanical Powders');
  await page.fill('[data-table-cell="1-2"]', 'organoleptic');
  await page.fill('[data-table-cell="2-0"]', 'Botanical');

  console.log('\n── merge a whole row ──');
  await page.click('[data-merge-row="0"]');
  t('the row becomes one cell: two "merged" placeholders', (await page.locator('[data-merged-cell="left"]').count()) === 2);
  t('…and the row control now offers Split', (await page.locator('[data-split-row="0"]').count()) === 1);

  console.log('\n── merge a cell up ──');
  await page.hover('[data-table-cell="2-2"]');
  await page.click('[data-table-cell="2-2"] ~ div [data-merge-up]');
  t('the cell under "organoleptic" shows merged-up', (await page.locator('[data-merged-cell="up"]').count()) === 1);

  console.log('\n── preview ──');
  await page.click('[data-body-mode="preview"]');
  const spans = await page.evaluate(() => {
    const tb = [...document.querySelectorAll('table')].find(x => x.textContent.includes('Raw Materials'));
    if (!tb) return null;
    const td = [...tb.querySelectorAll('td')];
    return {
      row: td.find(x => x.textContent === 'Raw Materials')?.colSpan,
      up: td.find(x => x.textContent === 'organoleptic')?.rowSpan,
      bodyRows: [...tb.querySelectorAll('tbody tr')].map(r => r.children.length),
    };
  });
  t('Preview: "Raw Materials" spans all 3 columns', spans?.row === 3, JSON.stringify(spans));
  t('Preview: "organoleptic" spans 2 rows', spans?.up === 2, JSON.stringify(spans));
  t('Preview: rows draw 1, 3, 2 cells', JSON.stringify(spans?.bodyRows) === '[1,3,2]', JSON.stringify(spans));

  console.log('\n── stored text ──');
  await page.click('[data-body-mode="markdown"]');
  const md = await page.locator('textarea').first().inputValue();
  t('the Markdown carries | Raw Materials | << | << |', md.includes('| Raw Materials | << | << |'), md);
  t('…and the ^^ marker', /\| Botanical \|\s*\|\s*\^\^ \|/.test(md), md);

  console.log('\n── split ──');
  await page.click('[data-body-mode="blocks"]');
  await page.click('[data-merged-cell="up"]');
  t('splitting the merged-up cell gives back an empty cell', (await page.locator('[data-merged-cell="up"]').count()) === 0 && (await page.inputValue('[data-table-cell="2-2"]')) === '');
  await page.click('[data-split-row="0"]');
  t('splitting the row gives back three cells', (await page.locator('[data-merged-cell]').count()) === 0 && (await page.locator('[data-table-cell^="0-"]').count()) === 3);
  t('…the text stays in the first cell', (await page.inputValue('[data-table-cell="0-0"]')) === 'Raw Materials');
} finally {
  await browser.close();
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
