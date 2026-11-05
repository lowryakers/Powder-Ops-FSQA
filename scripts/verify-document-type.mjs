// verify:doctype — a document filed under the wrong type is listed, and Document
// Control can move it with a reason (D-317).
//
// FORM 431-01 sat on the SOPs tab because its seed left out the type, and nothing
// in the app could change it (D-316). Boots its own server on a fresh database
// (DOCTYPE_PORT) and drives a browser at 1280.
//   1. Doc Control Review lists documents whose number contradicts their type,
//      those filed as Policy (no tab lists it) and forms with no register entry —
//      and leaves FORM 431-01 (form, with its register entry) and a correct SOP alone.
//   2. POST /documents/:id/type moves only the type, needs a reason, refuses an
//      operator, a Reference document and a type outside the four; audited.
//   3. The importer reads the type from the number (WI → Work Instruction).
//   4. In the browser: Change type on a WI filed as an SOP moves it to the
//      Work Instructions tab.
// Control: main before D-317 — the pile and the route do not exist.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DOCTYPE_PORT || 5197);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-doctype-'));
const dbPath = path.join(dir, 'doctype.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const write = (fn) => { const d = new Database(dbPath); try { return fn(d); } finally { d.close(); } };

let child = null; const out = [];
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set DOCTYPE_PORT.`); process.exit(1); } catch { /* free */ }
child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', SIGNATURE_NAME_OPTIONAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const MAP = '{"sops":"edit","work-instructions":"edit","job-descriptions":"edit"}';
const ids = {};
write(db => {
  const user = (id, name, role, dept) => db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), ?)`).run(id, name, name, role, dept, hashOf('Pass-word-2026'), MAP);
  user('dt-dc', 'Dana Control', 'supervisor', 'document_control');
  user('dt-op', 'Otto Floor', 'operator', 'filling');
  const doc = (key, number, type, status = 'active') => {
    ids[key] = crypto.randomUUID();
    db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status, owner, description)
      VALUES (?, ?, ?, ?, 'quality', 'V1', ?, 'Dana Control', 'Body text')`).run(ids[key], type, number, `Doc ${number}`, status);
  };
  doc('wi', 'WI 905', 'sop');
  doc('jd', 'JD 905', 'sop');
  doc('pol', 'POLICY 905', 'policy');
  doc('form', 'FORM 905-01', 'form');
  doc('sop', 'SOP 905', 'sop');
  doc('gone', 'WI 906', 'sop', 'archived');
});
const login = async (name) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'Pass-word-2026' }) })).json());
const DC = await login('Dana Control'); const OP = await login('Otto Floor');
const call = async (tok, m, p, b) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* none */ } return { status: r.status, json: j }; };
t('two accounts signed in', !!DC.token && !!OP.token);

console.log('\n── the pile ──');
let r = await call(DC.token, 'GET', '/doc-review?source=document-type');
const src = r.json?.sources?.find(s => s.key === 'document-type');
const listed = new Set((src?.items || []).map(i => i.id));
t('Doc Control Review has the pile', !!src, JSON.stringify(r.json).slice(0, 120));
t('a WI filed as an SOP is listed', listed.has(ids.wi));
t('a JD filed as an SOP is listed', listed.has(ids.jd));
t('a document filed as Policy is listed (no tab lists it)', listed.has(ids.pol));
t('a form with no register entry is listed', listed.has(ids.form));
const f431 = one("SELECT id FROM sop_documents WHERE doc_number = 'FORM 431-01'");
t('FORM 431-01 (a form with its register entry) is NOT listed', f431 && !listed.has(f431.id));
t('a correct SOP is NOT listed', !listed.has(ids.sop));
t('a withdrawn document is NOT listed', !listed.has(ids.gone));
t('the count matches the rows', src?.count === src?.items?.length, `${src?.count} vs ${src?.items?.length}`);
const wiItem = src?.items?.find(i => i.id === ids.wi);
t('the WI row suggests Work Instruction and opens on the SOPs tab', /suggested Work Instruction/.test(wiItem?.subtitle || '') && wiItem?.tab === 'sops', JSON.stringify(wiItem));

console.log('\n── changing the type ──');
r = await call(OP.token, 'POST', `/documents/${ids.jd}/type`, { doc_type: 'job_description', reason: 'wrong type' });
t('an operator is refused', r.status === 403, String(r.status));
r = await call(DC.token, 'POST', `/documents/${ids.jd}/type`, { doc_type: 'job_description', reason: '' });
t('no reason is refused', r.status === 400 && r.json?.code === 'REASON_REQUIRED');
r = await call(DC.token, 'POST', `/documents/${ids.jd}/type`, { doc_type: 'policy', reason: 'test' });
t('a type outside the four is refused', r.status === 400);
const ref = one("SELECT id FROM sop_documents WHERE doc_type = 'reference' LIMIT 1");
if (ref) {
  r = await call(DC.token, 'POST', `/documents/${ref.id}/type`, { doc_type: 'sop', reason: 'test' });
  t('a Reference Library document is refused', r.status === 400);
}
const before = one('SELECT * FROM sop_documents WHERE id = ?', ids.jd);
r = await call(DC.token, 'POST', `/documents/${ids.jd}/type`, { doc_type: 'job_description', reason: 'Imported under the wrong type' });
const after = one('SELECT * FROM sop_documents WHERE id = ?', ids.jd);
t('Document Control moves it', r.status === 200 && after.doc_type === 'job_description', `${r.status} ${after.doc_type}`);
const moved = Object.keys(before).filter(k => !['doc_type', 'updated_at'].includes(k) && before[k] !== after[k]);
t('…and nothing else moves', moved.length === 0, moved.join(', '));
const audit = one("SELECT details, actor FROM audit_log WHERE entity_type = 'document' AND entity_id = ? ORDER BY rowid DESC", ids.jd);
t('…audited with who, from, to and the reason', audit?.actor === 'Dana Control' && /"from":"sop"/.test(audit.details) && /Imported under the wrong type/.test(audit.details), audit?.details);
r = await call(DC.token, 'POST', `/documents/${ids.jd}/type`, { doc_type: 'job_description', reason: 'again' });
t('the same type again is a 409', r.status === 409);
r = await call(DC.token, 'GET', '/doc-review?source=document-type');
t('…and it leaves the pile', !(r.json?.sources?.find(s => s.key === 'document-type')?.items || []).some(i => i.id === ids.jd));

console.log('\n── the importer ──');
const fd = new FormData();
fd.append('files', new Blob(['WI 077 Hand Filling\n\n1. Scope\nText.'], { type: 'text/plain' }), 'WI 077 Hand Filling.txt');
fd.append('files', new Blob(['POLICY 088 Something\n\nText.'], { type: 'text/plain' }), 'POLICY 088 Something.txt');
const ex = await (await fetch(`${BASE}/documents/extract`, { method: 'POST', headers: { Authorization: `Bearer ${DC.token}` }, body: fd })).json();
const wiEx = ex.documents?.find(d => /WI/.test(d.doc_number));
const polEx = ex.documents?.find(d => /POLICY/.test(d.doc_number));
t('a file numbered WI comes back as a Work Instruction', wiEx?.doc_type === 'work_instruction', JSON.stringify(wiEx)?.slice(0, 160));
t('a POLICY number carries no type (the tab decides)', polEx && polEx.doc_type === null, JSON.stringify(polEx)?.slice(0, 160));

console.log('\n── the screen ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${ORIGIN}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.setItem('doc_focus', u._focus); }, [DC.token, { ...DC.user, _focus: ids.wi }]);
await page.goto(`${ORIGIN}/?tab=sops&doc=${ids.wi}`);
const openBtn = page.locator('[data-change-type-open]');
await openBtn.waitFor({ timeout: 20000 }).catch(() => {});
t('the document offers Change type', await openBtn.count() === 1);
await openBtn.click();
t('…suggesting Work Instruction from its number', await page.locator('[data-change-type-to]').inputValue() === 'work_instruction');
await page.locator('[data-change-type-reason]').fill('Imported as an SOP by mistake');
await page.locator('[data-change-type-save]').click();
await page.locator('[data-change-type]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await sleep(500);
t('the change is saved', one('SELECT doc_type FROM sop_documents WHERE id = ?', ids.wi)?.doc_type === 'work_instruction');
await page.goto(`${ORIGIN}/?tab=work-instructions`);
await page.getByText('Doc WI 905').first().waitFor({ timeout: 15000 }).catch(() => {});
t('…and it is listed on the Work Instructions tab', await page.getByText('Doc WI 905').count() > 0);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
