// D-395 (A-20261124-003, pack 09 PR 2): FORM 100-01 V1, the Material Verification
// Checklist, is filed in ReadyDoc — one per pick, on the Manufacturing Order —
// and signed by the QA lead with the password.
//
// What this proves:
//   - the form's five questions are the sheet's own words;
//   - a pick check is filed against an MO from the Production Log module;
//   - signing is refused BEFORE the password while a question is blank, a "No"
//     has no note, or a "No" has no issue recorded for the Warehouse Team;
//   - QA signs with the password; the warehouse and a token cannot;
//   - FORM 100-01 reads as ReadyDoc's in the form register; Look up records finds it by MO;
//   - the screen: Production Log → Pick checks.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5253;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('pv-a', 'Pick Admin', 'admin', 'admin', null);
mkUser('pv-q', 'Pick QA', 'supervisor', 'qa', JSON.stringify({ 'production-log': 'edit' }));
mkUser('pv-w', 'Pick Warehouse', 'operator', 'warehouse', JSON.stringify({ 'production-log': 'edit' }));
mkUser('pv-bot', 'Pick Bot', 'supervisor', 'qa', JSON.stringify({ 'production-log': 'edit' }));

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { headers: { ...H, Authorization: `Bearer ${r.body?.token}` }, token: r.body?.token, user: r.body?.user, pw };
};
const A = await login('pv-a', 'Pick Admin', 'PickAdmin20266!');
const Q = await login('pv-q', 'Pick QA', 'PickQa2026666!');
const W = await login('pv-w', 'Pick Warehouse', 'PickWare2026!');
const BT = (await call('POST', '/api-tokens', { user_id: 'pv-bot', label: 'fixture pick bot', scopes: ['read', 'write'] }, A.headers)).body?.plaintext;
const TK = { ...H, Authorization: `Bearer ${BT}` };
t('signed in (QA, the warehouse, an admin) and a fixture token', !!Q.token && !!W.token && !!BT);

console.log('\n── the form ──');
const conf = (await call('GET', '/qms/config', undefined, Q.headers)).body;
const cfg = [].concat(conf?.types || conf || []).find(x => x?.key === 'material_verification');
const labels = (cfg?.fields || []).map(f => f.label);
t('FORM 100-01 V1 with the sheet\'s five questions, verbatim', cfg?.formCode === 'FORM 100-01 V1'
  && labels.includes("Do the part #'s on the physical pick match the part #'s on the Pick List?")
  && labels.includes('Do the part quantities match or exceed the quantities listed on the Pick List?')
  && labels.includes('Do all the boxes, bags, and containers have correct labels?')
  && labels.includes('Does the Manufacturing Order # on the Reconciliation sheet match the Pick List?')
  && labels.includes('Does the Lot # on the physical pick match the Lot # on the Pick List?'), JSON.stringify(labels).slice(0, 300));
t('…signed by the QA lead', cfg?.approvals?.length === 1 && cfg.approvals[0].key === 'qa_lead');

console.log('\n── filing and signing ──');
let r = await call('POST', '/qms/material_verification', { mo_number: 'MO76801', record_date: '2026-11-25', q_part_numbers: 'Yes', q_quantities: 'No' }, W.headers);
const rec = r.body;
t('the warehouse files a pick check for MO76801 (MV-0001)', (r.status === 201 || r.status === 200) && rec?.record_number === 'MV-0001' && rec?.mo_number === 'MO76801', `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
const approve = (h, extra = {}) => call('POST', `/qms/material_verification/${rec.id}/approve`, { role: 'qa_lead', ...extra }, h);
r = await approve(Q.headers);
t('signing with blanks is refused before the password (400, no signature_required)', r.status === 400 && !r.body?.signature_required && /still blank/.test(r.body?.error || ''), JSON.stringify(r.body));
await call('PUT', `/qms/material_verification/${rec.id}`, { q_labels: 'Yes', q_mo_reconciliation: 'Yes', q_lots: 'N/A' }, Q.headers);
r = await approve(Q.headers);
t('a "No" with no note is refused', r.status === 400 && /needs a note/.test(r.body?.error || ''));
t('…and with no issue recorded for the Warehouse Team', /Warehouse Team/.test(r.body?.error || ''));
await call('PUT', `/qms/material_verification/${rec.id}`, { q_quantities_note: '2 bags short of 40', issues: 'RM-WPI-90 · 38 of 40 bags picked' }, Q.headers);
r = await approve(Q.headers);
t('complete: QA is now asked for the password (403 signature_required)', r.status === 403 && r.body?.signature_required === true, JSON.stringify(r.body));
r = await approve(W.headers, { signature_password: W.pw });
t('the warehouse cannot sign (403)', r.status === 403 && !r.body?.signature_required);
r = await approve(TK);
t('a token cannot sign (403)', r.status === 403);
const stored = () => JSON.parse(db.prepare('SELECT approvals FROM qms_records WHERE id = ?').get(rec.id).approvals || '{}');
t('…no signature stored', !stored().qa_lead);
r = await approve(Q.headers, { signature_password: Q.pw });
t('QA signs with the password', r.status === 200 && stored().qa_lead?.name === 'Pick QA', JSON.stringify(r.body)?.slice(0, 200));

console.log('\n── found again ──');
const { FORM_REGISTRY } = await import('../shared/form-registry.js');
t('FORM 100-01 reads as ReadyDoc\'s', FORM_REGISTRY.find(f => f.code === 'FORM 100-01')?.where === 'readydoc');
r = await call('GET', '/records?qms_type=material_verification', undefined, Q.headers);
t('Look up records lists it as a QMS record', r.body?.records?.some(x => x.id === rec.id), JSON.stringify(r.body)?.slice(0, 200));

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Q.token, Q.user]);
  await page.goto(`${URL}/?tab=production-log&view=picks`);
  await page.locator('text=MV-0001 >> visible=true').first().waitFor({ timeout: 20000 });
  t('Production Log → Pick checks lists MV-0001', true);
  t('no sideways scroll at 1280', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
} catch (e) { t('the Pick checks tab rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
