// verify:orgchartpdf — the Org Chart's Export to PDF button. The PDF carries
// the chart's version, every position with whoever holds it NOW (the linked
// account's name, not the stored one), marks a vacancy, and is read-only.
// Caller sets PORT + DBPATH. Control: main before this — /api/org/pdf is 404.
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5231);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'OrgPdf2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('oc-view', 'Vera Viewer', 'operator', 'office', { 'org-chart': 'view' });
mk('oc-none', 'Nora None', 'operator', 'office', null);
mk('oc-held', 'Hana Renamed', 'operator', 'quality', { operator: 'view' });
db.prepare("INSERT OR REPLACE INTO org_chart_meta (id, version, approved_by, effective_date) VALUES (1, '9', 'Test Approver', '2026-11-01')").run();
const pos = db.prepare('INSERT OR REPLACE INTO org_positions (id, title, name, department, parent_id, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
pos.run('oc-top', 'Zz Chief Test Officer', 'Top Person', 'admin', null, 0, null);
pos.run('oc-qa', 'Zz Quality Lead', 'Old Stored Name', 'quality', 'oc-top', 0, 'oc-held');
pos.run('oc-vac', 'Zz Vacant Seat', null, 'warehouse', 'oc-top', 1, null);
db.close();

const call = async (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await (await call('POST', '/users/login', { name, password: PW })).json())?.token;
};
const view = await login('oc-view', 'Vera Viewer');
const none = await login('oc-none', 'Nora None');
t('both sign in', !!view && !!none);
t('an account with no modules assigned cannot download it (the same door as the chart itself)', (await call('GET', '/org/pdf', null, none)).status === 403);
const r = await call('GET', '/org/pdf', null, view);
const buf = Buffer.from(await r.arrayBuffer());
t('a viewer downloads it as a PDF', r.status === 200 && r.headers.get('content-type') === 'application/pdf' && buf.slice(0, 4).toString() === '%PDF');
t('…named with the version', /Org-Chart-V9-\d{4}-\d{2}-\d{2}\.pdf/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));
const dir = mkdtempSync(join(tmpdir(), 'orgpdf-'));
writeFileSync(join(dir, 'c.pdf'), buf);
const text = execFileSync('pdftotext', ['-layout', join(dir, 'c.pdf'), '-']).toString();
t('it carries the version, approver and effective date', /Version 9 · Approved by Test Approver · Effective 2026-11-01/.test(text));
t('every position is in it', ['Zz Chief Test Officer', 'Zz Quality Lead', 'Zz Vacant Seat'].every(s => text.includes(s)));
t('a linked position shows the account\'s current name, not the stored one', text.includes('Hana Renamed') && !text.includes('Old Stored Name'));
t('a position nobody holds reads Vacant', /Zz Vacant Seat\s+Vacant/.test(text));
t('the list page puts each position under its manager', text.indexOf('Zz Chief Test Officer') < text.lastIndexOf('Zz Quality Lead'));
t('pages are numbered and marked uncontrolled when printed', /Page 1 of \d/.test(text) && /uncontrolled when printed/.test(text));
const after = new Database(DBP, { readonly: true });
t('downloading changes no position and writes no org-chart audit entry', after.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type IN ('org_position','org_chart')").get().n === 0
  && after.prepare("SELECT name FROM org_positions WHERE id = 'oc-qa'").get()?.name === 'Old Stored Name');
after.close();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, acceptDownloads: true });
  const me = await (await call('GET', '/users/me', null, view)).json();
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [view, me]);
  await page.goto(`${URL}/?tab=org-chart`);
  await page.waitForSelector('[data-org-pdf]', { timeout: 15000 }).catch(() => {});
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('[data-org-pdf]').catch(() => {})]);
  t(`${w}px: a viewer (no edit rights) sees the button and it downloads the PDF`, !!dl && /Org-Chart-V9\.pdf$/.test(dl.suggestedFilename()), dl?.suggestedFilename());
  t(`${w}px: nothing pans sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
