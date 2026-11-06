// verify:docpdf — every page of a controlled-document PDF says which document,
// which revision, what status, which page, and CONFIDENTIAL (R-0621 / A-20261106-002, D-318).
//
// Boots its own server on a fresh database (DOCPDF_PORT), files an SOP long
// enough to run several pages with a pending draft, a WI, a JD and an SOP whose
// body carries a Word contents list, then reads every page of the exports back
// with pdfjs.
//   1. Every page carries number · Rev · title · Page x of y · status · CONFIDENTIAL.
//   2. The default export is the copy in force; ?copy=draft is the pending
//      revision, DRAFT on every page, never "Approved".
//   3. A contents list prints without the Word page numbers; the stored body is unchanged.
//   4. Several documents in one file number their pages per document.
// Control: main before D-318 — page 2 carries no number, no page x of y, no CONFIDENTIAL.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DOCPDF_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-docpdf-'));
const dbPath = path.join(dir, 'docpdf.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

let child = null; const out = [];
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set DOCPDF_PORT.`); process.exit(1); } catch { /* free */ }
child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', SIGNATURE_NAME_OPTIONAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const longBody = (label, n) => Array.from({ length: n }, (_, i) =>
  `## ${i + 1}.0 Section ${i + 1}\n${label} paragraph ${i + 1}. This line is long enough to wrap across the page so the body runs on and on, which is what a real SOP does.\n- Step one of section ${i + 1}\n- Step two of section ${i + 1}`).join('\n\n');
const TOC_BODY = `# Table of Contents\n1.0 Purpose .................... 3\n2.0 Scope ...................... 4\n3.0 Responsibilities           5\n\n| Section | Title | Page |\n|---|---|---|\n| 1.0 | Purpose | 3 |\n| 2.0 | Scope | 4 |\n\n## 1.0 Purpose\nThe purpose is stated here.`;
const ids = {};
{
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('dp-qa', 'Quinn Reader', 'Quinn Reader', 'supervisor', 'qa', 1, ?, datetime('now'), ?)`)
    .run(hashOf('Pass-word-2026'), '{"sops":"view","work-instructions":"view","job-descriptions":"view"}');
  // The batch export is a POST, which the module guard keeps for accounts with edit.
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES ('dp-dc', 'Dana Control', 'Dana Control', 'supervisor', 'document_control', 1, ?, datetime('now'), ?)`)
    .run(hashOf('Pass-word-2026'), '{"sops":"edit","work-instructions":"edit","job-descriptions":"edit"}');
  const doc = (key, type, number, title, rev, body, status = 'active') => {
    ids[key] = crypto.randomUUID();
    db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status, owner, description)
      VALUES (?, ?, ?, ?, 'quality', ?, ?, 'Dana Control', ?)`).run(ids[key], type, number, title, rev, status, body);
  };
  doc('sop', 'sop', 'SOP-104', 'Receiving of Raw Materials and Packaging', 'V3', longBody('In-force V3', 40));
  doc('wi', 'work_instruction', 'WI005', 'Operating the Auger Filler', '1.0', longBody('WI text', 18));
  doc('jd', 'job_description', 'JD-500-10', 'Warehouse Lead', 'V2', longBody('JD text', 14));
  doc('toc', 'sop', 'SOP-406', 'Allergen Control Program', 'V5', TOC_BODY);
  ids.draft = crypto.randomUUID();
  db.prepare(`INSERT INTO document_revisions (id, document_id, revision, status, source, title, description, created_by)
    VALUES (?, ?, 'V4', 'draft', 'draft', 'Receiving of Raw Materials and Packaging', ?, 'Dana Control')`)
    .run(ids.draft, ids.sop, longBody('Pending V4', 30));
  db.close();
}
const login = await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Quinn Reader', password: 'Pass-word-2026' }) })).json();
const H = { Authorization: `Bearer ${login.token}` };
const dc = await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dana Control', password: 'Pass-word-2026' }) })).json();
t('signed in', !!login.token);

async function pages(url, init) {
  const r = await fetch(`${BASE}${url}`, init || { headers: H });
  if (!r.ok) return { status: r.status, body: await r.json().catch(() => null), pages: [] };
  const buf = new Uint8Array(await r.arrayBuffer());
  const pdf = await getDocument({ data: buf }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    out.push(c.items.map(it => it.str).join(' ').replace(/\s+/g, ' '));
  }
  return { status: r.status, copy: r.headers.get('x-document-copy'), pages: out };
}
const everyPage = (ps, fn) => ps.length > 0 && ps.every((p, i) => fn(p, i));

console.log('\n── an SOP, the copy in force ──');
let r = await pages(`/documents/${ids.sop}/pdf`);
const n = r.pages.length;
t('SOP-104 runs to several pages', n >= 3, String(n));
t('the default export is the copy in force', r.copy === 'approved', r.copy);
t('every page names the document and revision', everyPage(r.pages, p => p.includes('SOP-104') && p.includes('Rev V3')));
t('every page names the title', everyPage(r.pages, p => p.includes('Receiving of Raw Materials')));
t('every page says Page x of y', everyPage(r.pages, (p, i) => p.includes(`Page ${i + 1} of ${n}`)), r.pages.map(p => (p.match(/Page \d+ of \d+/) || ['none'])[0]).join(','));
t('every page says CONFIDENTIAL', everyPage(r.pages, p => p.includes('CONFIDENTIAL')));
t('every page carries the status', everyPage(r.pages, p => p.includes('Approved / Effective')));
t('it is the V3 text, not the pending V4', r.pages.join(' ').includes('In-force V3') && !r.pages.join(' ').includes('Pending V4'));
t('it is never stamped DRAFT', !r.pages.join(' ').includes('DRAFT'));

console.log('\n── the same SOP, the pending draft ──');
r = await pages(`/documents/${ids.sop}/pdf?copy=draft`);
const dn = r.pages.length;
t('the draft is exported when asked for', r.status === 200 && r.copy === 'draft', `${r.status} ${r.copy}`);
t('every page carries the draft revision', everyPage(r.pages, p => p.includes('SOP-104') && p.includes('Rev V4')));
t('every page says DRAFT — not approved', everyPage(r.pages, p => p.includes('DRAFT — not approved')));
t('every page says Page x of y and CONFIDENTIAL', everyPage(r.pages, (p, i) => p.includes(`Page ${i + 1} of ${dn}`) && p.includes('CONFIDENTIAL')));
t('no page calls the draft approved', !r.pages.some(p => p.includes('Approved / Effective')));
t('it is the V4 text', r.pages.join(' ').includes('Pending V4') && !r.pages.join(' ').includes('In-force V3'));
t('it names the revision in force', r.pages[0].includes('V3'));
r = await pages(`/documents/${ids.sop}/pdf?revision_id=${ids.draft}`);
t('the draft can be named by its id', r.status === 200 && r.copy === 'draft');
r = await pages(`/documents/${ids.wi}/pdf?copy=draft`);
t('a document with no draft refuses a draft export', r.status === 404 && r.body?.code === 'NO_DRAFT', JSON.stringify(r.body));
r = await pages(`/documents/${ids.sop}/pdf?copy=latest`);
t('an unknown copy is refused', r.status === 400 && r.body?.code === 'BAD_COPY');

console.log('\n── a WI and a JD ──');
for (const [key, num, rev] of [['wi', 'WI005', 'Rev 1.0'], ['jd', 'JD-500-10', 'Rev V2']]) {
  r = await pages(`/documents/${ids[key]}/pdf`);
  const k = r.pages.length;
  t(`${num}: every page has number, revision, page x of ${k}, CONFIDENTIAL`, k >= 2 && everyPage(r.pages, (p, i) =>
    p.includes(num) && p.includes(rev) && p.includes(`Page ${i + 1} of ${k}`) && p.includes('CONFIDENTIAL')), `${k} pages`);
}

console.log('\n── a contents list from Word ──');
const before = one('SELECT description FROM sop_documents WHERE id = ?', ids.toc).description;
r = await pages(`/documents/${ids.toc}/pdf`);
const all = r.pages.join(' ');
t('the dot-leader page numbers are gone', all.includes('1.0 Purpose') && !/Purpose \.{3,}/.test(all) && !/Purpose\s+\.*\s*3\b/.test(all), all.slice(0, 400));
t('a line with trailing spaces loses its number too', all.includes('3.0 Responsibilities') && !/Responsibilities\s+5\b/.test(all));
t('the contents table loses its Page column', !/\bPage\b(?! \d+ of)/.test(all.replace(/Page numbers from the original layout/, '')), all.slice(0, 500));
t('the page says why', all.includes('Page numbers from the original layout are omitted'));
t('the body after the contents prints whole', all.includes('The purpose is stated here.'));
t('the stored body is unchanged', one('SELECT description FROM sop_documents WHERE id = ?', ids.toc).description === before);

console.log('\n── several documents in one file ──');
r = await pages('/documents/pdf', { method: 'POST', headers: { Authorization: `Bearer ${dc.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [ids.wi, ids.jd] }) });
const wiPages = r.pages.filter(p => p.includes('WI005'));
const jdPages = r.pages.filter(p => p.includes('JD-500-10'));
t('each document numbers its own pages', wiPages.length > 0 && jdPages.length > 0
  && wiPages.every((p, i) => p.includes(`Page ${i + 1} of ${wiPages.length}`)) && jdPages.every((p, i) => p.includes(`Page ${i + 1} of ${jdPages.length}`)));
t('no page in a batch is a draft', !r.pages.join(' ').includes('DRAFT'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
