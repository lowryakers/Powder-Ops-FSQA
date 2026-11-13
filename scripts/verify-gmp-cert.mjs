// Executed, not asserted: the third-party GMP certificate (D-337). Who owes one
// (raw-material and packaging suppliers we buy from), filing it with its expiry
// date through the S3 stand-in, the refusal without a date, the states, setting
// an expiry on an undated one, a general certificate with GMP in its name OFFERED
// and counted only by a person, the approval gate (off / warn / on), the
// register's count, the QA bell line, and the supplier screen in a browser.
// The letter-of-guarantee rule (D-289) is asserted unchanged alongside.
import { chromium } from 'playwright-core';
import { gmpCertRequired, gmpCertStatus, gmpCertCandidate } from '../shared/supplier-gmp-cert.js';
import { guaranteeStatus } from '../shared/supplier-guarantee.js';
const PORT = process.env.PORT || 5211;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

console.log('── the rule (pure) ──');
t('a raw-material supplier we buy from owes one', gmpCertRequired({ actively_using: 1, vendor_type: 'ingredient' }));
t('a packaging supplier we buy from owes one', gmpCertRequired({ actively_using: 1, vendor_type: 'packaging' }));
t('an imported "Raw Material" type is read the same way', gmpCertRequired({ actively_using: 1, vendor_type: 'Raw Material' }));
t('a laboratory, service or equipment supplier does not', ['laboratory', 'service', 'equipment', 'supplies', null]
  .every(v => !gmpCertRequired({ actively_using: 1, vendor_type: v })));
t('a supplier we no longer buy from does not', !gmpCertRequired({ actively_using: 0, vendor_type: 'ingredient' }));
t('a general certificate does not count by itself, whatever its name',
  gmpCertStatus({ actively_using: 1, vendor_type: 'ingredient' }, [{ kind: 'certificate', expires_on: day(300), filename: 'SQF cert.pdf' }], day(0)).status === 'missing');
t('A GFSI CERTIFICATE COUNTS (D-350) — an audit certificate on file and in date is current',
  gmpCertStatus({ actively_using: 1, vendor_type: 'ingredient' }, [{ kind: 'audit_certificate', expires_on: day(300) }], day(0)).status === 'current');
t('…and the later-dated of a GMP and a GFSI certificate is the one that counts',
  gmpCertStatus({ actively_using: 1, vendor_type: 'packaging' }, [{ kind: 'gmp_certificate', expires_on: '2020-01-01' }, { kind: 'audit_certificate', expires_on: day(90) }], day(0)).status === 'current');
t('a general certificate named GMP or SQF is a candidate; a Non-GMO one is not',
  gmpCertCandidate({ kind: 'certificate', filename: 'NSF GMP Exp 2026.pdf' })
  && gmpCertCandidate({ kind: 'certificate', filename: 'SQF Certificate.pdf' })
  && !gmpCertCandidate({ kind: 'certificate', filename: 'IM Non-GMO (Exp 8.20.25).pdf' }));
t('the letter of guarantee rule is unchanged by the shared helper',
  guaranteeStatus({ actively_using: 1, vendor_type: 'packaging' }, [{ kind: 'letter_of_guarantee', expires_on: day(10) }], day(0)).status === 'due_soon'
  && guaranteeStatus({ actively_using: 1, vendor_type: 'ingredient' }, [], day(0)).required === false);

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('gm-qa', 'Quinn Gmp', 'supervisor', 'qa', '{"suppliers":"edit"}');
  mk('gm-pur', 'Pat Gmp', 'operator', 'purchasing', '{"suppliers":"edit"}');
  mk('gm-op', 'Otto Gmp', 'operator', 'warehouse', '{"suppliers":"view"}');
  mk('gm-adm', 'Ada Gmp', 'admin', 'admin', null);
  const s = db.prepare('INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES (?,?,?,?)');
  s.run('m-whey', 'Whey Source Co', 'ingredient', 1);     // owes one, has none
  s.run('m-film', 'Film Pack Co', 'packaging', 1);        // owes one, has none
  s.run('m-lab', 'Lab Services Co', 'laboratory', 1);     // owes none
  s.run('m-old', 'Old Cocoa Co', 'ingredient', 0);        // not buying
  s.run('m-exp', 'Expired Cert Co', 'ingredient', 1);
  s.run('m-und', 'Undated Cert Co', 'ingredient', 1);
  s.run('m-cand', 'Candidate Co', 'ingredient', 1);
  const f = db.prepare('INSERT OR REPLACE INTO supplier_files (id, supplier_id, kind, expires_on, filename, source_path) VALUES (?,?,?,?,?,?)');
  f.run('gf-exp', 'm-exp', 'gmp_certificate', '2020-01-31', 'Expired GMP 2019.pdf', 'x/1');
  f.run('gf-und', 'm-und', 'gmp_certificate', null, 'Undated GMP.pdf', 'x/2');
  f.run('gf-cand', 'm-cand', 'certificate', day(500), 'NSF GMP Exp 2028.pdf', 'x/3');
  f.run('gf-sqf', 'm-cand', 'certificate', day(500), 'SQF Certificate.pdf', 'x/4');
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const qaTok = await login('gm-qa', 'Quinn Gmp', 'QuinnSecret2026');
const purTok = await login('gm-pur', 'Pat Gmp', 'PatSecret2026');
const opTok = await login('gm-op', 'Otto Gmp', 'OttoSecret2026');
const admTok = await login('gm-adm', 'Ada Gmp', 'AdaSecret2026');
t('Quality, Purchasing, a viewer and an admin signed in', !!qaTok && !!purTok && !!opTok && !!admTok);

const reg = async () => { token = qaTok; return J(await req('/suppliers')); };
const g = (list, id) => list.suppliers.find(s => s.id === id)?.gmp_cert;

console.log('\n── who owes one, and the states ──');
let r = await reg();
t('a raw-material supplier with no certificate: missing, a gap', g(r, 'm-whey')?.required && g(r, 'm-whey').status === 'missing' && g(r, 'm-whey').gap);
t('a packaging supplier with no certificate: missing', g(r, 'm-film')?.status === 'missing');
t('a laboratory: not required', g(r, 'm-lab')?.required === false);
t('a supplier we no longer buy from: not required', g(r, 'm-old')?.required === false);
t('an expired certificate is a gap', g(r, 'm-exp')?.status === 'expired' && g(r, 'm-exp').gap);
t('a certificate with no expiry date is a gap', g(r, 'm-und')?.status === 'no_renewal_date' && g(r, 'm-und').gap);
t('a general certificate with GMP in its name does NOT count by itself', g(r, 'm-cand')?.status === 'missing');
const gaps0 = r.summary.gmp_cert_gaps;
t('the register counts the gaps', gaps0 === 5, `${gaps0}`);

console.log('\n── filing it with its expiry date ──');
const pdf = () => new Blob([Buffer.from('%PDF-1.4\n% gmp certificate\n')], { type: 'application/pdf' });
token = purTok;
let fd = new FormData(); fd.append('files', pdf(), 'Whey Source NSF GMP.pdf'); fd.append('kind', 'gmp_certificate');
let res = await up('/suppliers/m-whey/files', fd);
t('a GMP certificate with no expiry date is refused', res.status === 400 && (await J(res))?.code === 'EXPIRY_REQUIRED', `${res.status}`);
fd = new FormData(); fd.append('files', pdf(), 'Whey Source NSF GMP.pdf'); fd.append('kind', 'gmp_certificate'); fd.append('expires_on', 'next year');
res = await up('/suppliers/m-whey/files', fd);
t('an expiry that is not a date is refused', res.status === 400);
fd = new FormData(); fd.append('files', pdf(), 'Whey Source NSF GMP.pdf'); fd.append('kind', 'gmp_certificate'); fd.append('expires_on', day(400));
res = await up('/suppliers/m-whey/files', fd);
r = await reg();
t('filed with its expiry: current', res.status === 200 && g(r, 'm-whey')?.status === 'current' && g(r, 'm-whey').renews_on === day(400), JSON.stringify(g(r, 'm-whey')));
fd = new FormData(); fd.append('files', pdf(), 'Film Pack GMP certificate.pdf');
token = purTok;
res = await up('/suppliers/m-film/files', fd);
r = await reg();
t('a file uploaded without the kind is never read as the GMP certificate from its name', res.status === 200 && g(r, 'm-film')?.status === 'missing');

console.log('\n── an expiry on a certificate already on file ──');
token = opTok;
res = await req('/suppliers/files/gf-und/renewal', { method: 'PUT', body: JSON.stringify({ expires_on: day(200) }) });
t('a viewer cannot set it', res.status === 403);
token = purTok;
res = await req('/suppliers/files/gf-und/renewal', { method: 'PUT', body: JSON.stringify({ expires_on: day(200) }) });
r = await reg();
t('set: the certificate is current', res.status === 200 && g(r, 'm-und')?.status === 'current');

console.log('\n── a general certificate a person counts as the GMP certificate ──');
token = qaTok;
let d = await J(await req('/suppliers/m-cand'));
t('the supplier offers both the GMP-named and the SQF certificate',
  d?.gmp_cert?.candidates?.length === 2 && d.gmp_cert.candidates.some(c => c.id === 'gf-sqf'), JSON.stringify(d?.gmp_cert?.candidates));
token = purTok;
res = await req('/suppliers/files/gf-exp/gmp-certificate', { method: 'PUT', body: '{}' });
t('only a file catalogued as a general certificate can be counted', res.status === 400);
token = opTok;
res = await req('/suppliers/files/gf-cand/gmp-certificate', { method: 'PUT', body: '{}' });
t('a viewer cannot count it', res.status === 403);
token = purTok;
res = await req('/suppliers/files/gf-sqf/gmp-certificate', { method: 'PUT', body: JSON.stringify({ kind: 'nonsense' }) });
t('counting it as an unknown kind is refused', res.status === 400);
res = await req('/suppliers/files/gf-sqf/gmp-certificate', { method: 'PUT', body: JSON.stringify({ kind: 'audit_certificate' }) });
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const k = db.prepare("SELECT kind FROM supplier_files WHERE id = 'gf-sqf'").get()?.kind;
  db.close();
  t('the SQF certificate is counted as a GFSI certificate', res.status === 200 && k === 'audit_certificate', `${res.status} ${k}`);
}
res = await req('/suppliers/files/gf-cand/gmp-certificate', { method: 'PUT', body: '{}' });
r = await reg();
t('counted: the supplier is current, using the date already on file', res.status === 200 && g(r, 'm-cand')?.status === 'current' && g(r, 'm-cand').renews_on === day(500));
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const a = db.prepare("SELECT * FROM audit_log WHERE entity_id = 'gf-cand' ORDER BY rowid DESC LIMIT 1").get();
  db.close();
  t('counting it is audited with the kind before and after', !!a && String(a.previous_state).includes('"certificate"')
    && String(a.new_state).includes('gmp_certificate') && a.actor === 'Pat Gmp', JSON.stringify(a));
}

console.log('\n── the approval gate ──');
const RISK = Object.fromEntries((await J(await req('/suppliers'))).risk_criteria.map(c => [c.key, 'low']));
const decide = (sid, disposition = 'approved') => req(`/suppliers/${sid}/disposition`, { method: 'POST',
  body: JSON.stringify({ disposition, period_label: '2026', risk_criteria: RISK, notes: disposition === 'approved' ? '' : 'Deficiency noted.' }) });
token = qaTok;
res = await req('/suppliers/gmp-gate');
t('the gate starts at warn', (await J(res))?.mode === 'warn');
res = await req('/suppliers/gmp-gate', { method: 'PUT', body: JSON.stringify({ mode: 'on' }) });
t('only an admin moves the gate', res.status === 403);
token = admTok;
await req('/suppliers/banned-gate', { method: 'PUT', body: JSON.stringify({ mode: 'off' }) });   // isolate this gate
token = qaTok;
res = await decide('m-film');
let body = await J(res);
t('warn: a supplier with no certificate is approved and the gap is stamped', res.status === 200 && body?.gmp_gate_mode === 'warn' && body.gmp_cert_gaps?.length === 1);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const q = db.prepare("SELECT gmp_cert_gaps, gmp_gate_mode FROM supplier_qualifications WHERE supplier_id = 'm-film'").get();
  db.close();
  t('…the decision carries the gap and the mode', q?.gmp_gate_mode === 'warn' && JSON.parse(q.gmp_cert_gaps || '[]')[0]?.state === 'missing', JSON.stringify(q));
}
token = admTok;
res = await req('/suppliers/gmp-gate', { method: 'PUT', body: JSON.stringify({ mode: 'on' }) });
t('an admin turns it on', res.status === 200);
token = qaTok;
res = await decide('m-exp');
body = await J(res);
t('on: an expired certificate refuses approval, naming it', res.status === 409 && /GMP \/ GFSI certificate expired/.test(body?.error || ''), body?.error);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const st = db.prepare("SELECT status FROM suppliers WHERE id = 'm-exp'").get()?.status;
  db.close();
  t('…and nothing was written', st === 'unqualified', st);
}
res = await decide('m-exp', 'conditionally_approved');
t('on: a conditional decision is not gated', res.status === 200);
res = await decide('m-whey');
t('on: a supplier with a current certificate is approved', res.status === 200);
res = await decide('m-lab');
t('on: a supplier that owes no certificate is approved', res.status === 200);
token = admTok;
await req('/suppliers/gmp-gate', { method: 'PUT', body: JSON.stringify({ mode: 'off' }) });
token = qaTok;
res = await decide('m-exp');
body = await J(res);
t('off: approved, nothing stamped', res.status === 200 && body?.gmp_cert_gaps?.length === 0 && body.gmp_gate_mode === 'off');
token = admTok;
await req('/suppliers/gmp-gate', { method: 'PUT', body: JSON.stringify({ mode: 'warn' }) });
await req('/suppliers/banned-gate', { method: 'PUT', body: JSON.stringify({ mode: 'warn' }) });

console.log('\n── a GFSI certificate uploaded directly ──');
token = purTok;
fd = new FormData(); fd.append('files', pdf(), 'Film Pack BRCGS 2027.pdf'); fd.append('kind', 'audit_certificate');
res = await fetch(`${URL}/api/suppliers/m-old/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
t('a GFSI certificate with no expiry date is refused too', res.status === 400 && (await J(res))?.code === 'EXPIRY_REQUIRED', `${res.status}`);

console.log('\n── adding a supplier (D-350) ──');
token = opTok;
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Shandong Test Biotech', vendor_type: 'ingredient' }) });
t('a viewer cannot add one', res.status === 403, `${res.status}`);
token = purTok;
t('Purchasing is offered the button', (await J(await req('/suppliers')))?.can_create === true);
token = opTok;
t('a viewer is not', (await J(await req('/suppliers')))?.can_create === false);
token = purTok;
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: '  ' }) });
t('a name is required', res.status === 400);
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Shandong Test Biotech' }) });
t('in use with no type is refused', res.status === 400 && (await J(res))?.code === 'VENDOR_TYPE_REQUIRED');
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Shandong Test Biotech', vendor_type: 'flavour house' }) });
t('a type not on the list is refused', res.status === 400);
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Shandong Test Biotech', vendor_type: 'ingredient', website: 'example.com' }) });
const made = await J(res);
t('Purchasing adds a supplier', res.status === 201 && !!made?.id, `${res.status} ${JSON.stringify(made)}`);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(made?.id);
  const a = db.prepare("SELECT * FROM audit_log WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1").get(made?.id);
  db.close();
  t('…it starts unqualified, in use, filed in the app', row?.status === 'unqualified' && row.actively_using === 1 && row.source === 'in_app', JSON.stringify(row));
  t('…and the adding is audited by name', a?.actor === 'Pat Gmp');
}
r = await reg();
t('…and it owes a GMP or GFSI certificate from the start', g(r, made?.id)?.status === 'missing');
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'shandong test BIOTECH', vendor_type: 'ingredient' }) });
const dup = await J(res);
t('the same name again is refused and points at the one on file', res.status === 409 && dup?.existing_id === made?.id, `${res.status} ${JSON.stringify(dup)}`);
res = await req('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Former Supplier Co', actively_using: false }) });
t('a supplier we do not buy from yet may be added with no type', res.status === 201);

console.log('\n── the QA bell ──');
const bell = async (tok) => { token = tok; const n = await J(await req('/compliance/notifications')); return (n?.items || []).find(i => i.id === 'gmp-cert-missing'); };
r = await reg();
const qaBell = await bell(qaTok);
t('Quality is told how many suppliers have no current certificate', qaBell?.count === r.summary.gmp_cert_gaps && qaBell.tab === 'suppliers', JSON.stringify(qaBell));
t('Purchasing is told too', (await bell(purTok))?.count === r.summary.gmp_cert_gaps);
t('the warehouse is not', !(await bell(opTok)));

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  token = purTok;
  const me = await J(await req('/users/me'));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [purTok, me]);
  await page.goto(`${URL}/?tab=suppliers`);
  await page.waitForTimeout(3000);
  if (width === 1280) {
    t('the register shows a GMP certificate column with the missing ones', await page.locator('[data-gmp-cert="missing"]').count() >= 1
      && await page.getByText('No current GMP or GFSI certificate', { exact: true }).count() === 1);
    await page.getByText('No current GMP or GFSI certificate', { exact: true }).click();
    await page.waitForTimeout(500);
    t('the count opens the list of suppliers that owe one', await page.locator('[data-gmp-note]').count() === 1
      && await page.locator('tr', { hasText: 'Film Pack Co' }).count() >= 1 && await page.locator('tr', { hasText: 'Whey Source Co' }).count() === 0);
    await page.locator('tr', { hasText: 'Film Pack Co' }).first().click();
    await page.waitForTimeout(1500);
    t('the supplier shows the GMP section with the expiry box before attaching',
      await page.locator('[data-gmp-section="missing"]:visible').count() === 1
      && await page.locator('[data-gmp-expiry]:visible').count() === 1 && await page.locator('[data-gmp-attach]:visible').isDisabled());
    await page.locator('[data-gmp-expiry]:visible').fill(day(300));
    t('…and the attach button wakes once an expiry date is entered', await page.locator('[data-gmp-attach]:visible').isEnabled());
    await page.goto(`${URL}/?tab=suppliers`);
    await page.waitForTimeout(2500);
    await page.locator('[data-add-supplier]').click();
    await page.locator('#add-supplier-name').fill('Darigold Test');
    await page.locator('#add-supplier-type').selectOption('ingredient');
    await page.locator('[data-add-supplier-form] button[type=submit]').click();
    await page.waitForTimeout(1500);
    t('the Add a supplier form files one and the register shows it', await page.locator('tr', { hasText: 'Darigold Test' }).count() >= 1);
  } else {
    t('on a phone the register renders and nothing sticks out sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
