// verify:filmsleeve — D-332, live on a fresh database.
//
// FORM 418-01 V2 adds bottle sleeves. The code carries V2; the plant's approved
// paper is V1. So a fresh database serves V1 (no sleeve section, no "what is
// inspected", every section asked) and parks V2 for Document Control. Once
// Document Control approves V2 in Controlled Changes — no restart — a sheet says
// what it inspects and asks only that section; a sleeve sheet asks the sleeve
// lines and records the lay-flat width and cut length.
//
// Caller sets PORT + DBPATH. The control is `main` before this change: there is
// no `film:FORM 418-01` definition and no sleeve section anywhere.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5072;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];
const w = (sql, ...a) => { const d = new Database(DBP); try { return d.prepare(sql).run(...a); } finally { d.close(); } };

w(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('fs-dc','Daria Docs','Daria Docs','supervisor','document_control',1,'SC-fs-dc',datetime('now','+7 day'))`);
w(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('fs-qa','Quinn Sleeve','Quinn Sleeve','supervisor','qa',1,'SC-fs-qa',datetime('now','+7 day'),'{"qa-inspections":"edit","receiving-log":"edit"}')`);
const call = async (m, p, b, tok) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: pw })).json?.token;
};
const DC = await signIn('fs-dc', 'Daria Docs', 'DariaDocs2026!!');
const QA = await signIn('fs-qa', 'Quinn Sleeve', 'QuinnSleeve2026!!');
t('signed in (Document Control, QA)', !!DC && !!QA);

console.log('\n── deploy: V1 stays in force, V2 waits for Document Control ──');
const def = one("SELECT * FROM controlled_definitions WHERE key = 'film:FORM 418-01'");
t('FORM 418-01 is a controlled definition with V1 approved and V2 pending', def?.status === 'pending'
  && JSON.parse(def.approved_snapshot).revision === 'V1' && JSON.parse(def.pending_snapshot).revision === 'V2', def?.status);
let r = await call('GET', '/film-inspection/form', null, QA);
t('the served form is V1: film and pouch sections, no sleeve section, no "what is inspected"',
  r.json?.revision === 'V1' && r.json?.sections?.map(s => s.key).join(',') === 'film,pouch' && !(r.json?.kinds || []).length
  && !r.json?.header?.some(h => h.key === 'sleeve_layflat'), JSON.stringify({ rev: r.json?.revision, s: r.json?.sections?.map(s => s.key) }));
t('…titled as the V1 paper', r.json?.title === 'QA Film/Pouch Inspection Checklist');
const v1Items = r.json.sections.flatMap(s => s.items).length;
r = await call('POST', '/film-inspection', { inspection_no: 'A-100-0901', flavor: 'Chocolate' }, QA);
const v1Sheet = r.json;
t('a sheet started now is stamped V1 and asks every V1 question', r.status === 201 && v1Sheet?.checklist_revision === 'V1' && v1Sheet?.total === v1Items, JSON.stringify({ rev: v1Sheet?.checklist_revision, total: v1Sheet?.total, v1Items }));
r = await call('POST', '/film-inspection', { id: v1Sheet.id, material_kind: 'sleeve' }, QA);
t('…and V1 refuses a "what is inspected" it does not ask', r.status === 400);

console.log('\n── Document Control approves V2 ──');
r = await call('POST', `/controlled/${def.id}/approve`, {}, DC);
t('approved in Controlled Changes', r.status === 200, `${r.status} ${r.json?.error || ''}`);
r = await call('GET', '/film-inspection/form', null, QA);
const form = r.json;
t('the served form is now V2 with film, pouch, bottle sleeve and bottle sections (D-348)', form?.revision === 'V2' && form?.sections?.map(s => s.key).join(',') === 'film,pouch,sleeve,bottle'
  && form?.kinds?.map(k => k.key).join(',') === 'film,pouch,sleeve,bottle', JSON.stringify({ rev: form?.revision, s: form?.sections?.map(s => s.key) }));
const sleeve = form.sections.find(s => s.key === 'sleeve');
const film = form.sections.find(s => s.key === 'film');
t('the sleeve section carries the film section\'s material checks', ['discoloration', 'wrinkles', 'feel', 'odor', 'foreign', 'pinholes'].every(k => sleeve.items.some(i => i.key === `sleeve_material_${k}`))
  && film.items.filter(i => i.key.startsWith('material_')).length === 6);
t('…and the sleeve\'s own: type/thickness, seam, perforation, lay-flat, cut length, barcode, shrink test',
  ['sleeve_material_type', 'sleeve_seam', 'sleeve_perforation', 'sleeve_layflat_correct', 'sleeve_length_correct', 'sleeve_barcode', 'sleeve_shrink_test'].every(k => sleeve.items.some(i => i.key === k)));
t('the V1 film and pouch lines are unchanged', JSON.stringify(form.sections.filter(s => !['sleeve', 'bottle'].includes(s.key)).map(s => s.items.map(i => [i.key, i.text]))) === JSON.stringify(JSON.parse(def.approved_snapshot).sections.map(s => s.items.map(i => [i.key, i.text]))));
t('the header adds the two sleeve measurements, for sleeves only', ['sleeve_layflat', 'sleeve_length'].every(k => form.header.find(h => h.key === k)?.kinds?.[0] === 'sleeve'));

console.log('\n── a bottle sleeve sheet ──');
r = await call('POST', '/film-inspection', { inspection_no: 'A-100-0902', flavor: 'Blueberry Muffin' }, QA);
const sheet = r.json;
t('a new sheet is stamped V2', r.status === 201 && sheet?.checklist_revision === 'V2');
r = await call('POST', '/film-inspection', { id: sheet.id, material_kind: 'carton' }, QA);
t('an unknown kind is refused', r.status === 400);
r = await call('POST', `/film-inspection/${sheet.id}/review`, { decision: 'accepted' }, QA);
t('sign-off is refused until the sheet says what it inspects', r.status === 400 && r.json?.code === 'KIND_REQUIRED', JSON.stringify(r.json));
r = await call('POST', '/film-inspection', { id: sheet.id, material_kind: 'sleeve', sleeve_layflat: '118', sleeve_length: '165' }, QA);
t('marked as bottle sleeves, with the lay-flat width and cut length', r.status === 200 && r.json?.material_kind === 'sleeve' && r.json?.sleeve_layflat === '118' && r.json?.sleeve_length === '165');
t('…it asks the sleeve lines only', r.json?.total === sleeve.items.length && r.json?.unanswered?.every(u => u.section === 'BOTTLE SLEEVE Inspection'), `${r.json?.total} vs ${sleeve.items.length}`);
const answers = Object.fromEntries(sleeve.items.map(i => [i.key, 'yes']));
answers.sleeve_material_odor = 'no'; answers.sleeve_perforation = 'na';
r = await call('POST', '/film-inspection', { id: sheet.id, answers }, QA);
t('all sleeve lines answered', r.json?.unanswered?.length === 0 && r.json?.answered === sleeve.items.length);
t('…the No answers are listed for whoever signs (an aid, never a verdict)', r.json?.exceptions?.no?.some(e => e.key === 'sleeve_material_odor'));
r = await call('POST', `/film-inspection/${sheet.id}/review`, { decision: 'accepted' }, QA);
t('signed off accepted with only the sleeve section answered', r.status === 200 && r.json?.decision === 'accepted', JSON.stringify(r.json).slice(0, 160));

console.log('\n── film and pouch sheets ask their own section ──');
r = await call('POST', '/film-inspection', { inspection_no: 'A-100-0903', flavor: 'Vanilla', material_kind: 'film' }, QA);
t('a film sheet asks the film lines only', r.json?.total === film.items.length, `${r.json?.total}`);
r = await call('POST', '/film-inspection', { inspection_no: 'A-100-0903', flavor: 'Cocoa', material_kind: 'pouch' }, QA);
t('a pouch sheet asks the pouch lines only', r.json?.total === form.sections.find(s => s.key === 'pouch').items.length);

console.log('\n── a sheet started under V1 ──');
r = await call('GET', `/film-inspection/${v1Sheet.id}`, null, QA);
t('keeps its V1 stamp', r.json?.inspection?.checklist_revision === 'V1');
r = await call('POST', `/film-inspection/${v1Sheet.id}/review`, { decision: 'accepted' }, QA);
t('…and is asked what it inspects before sign-off, like any V2 sheet', r.status === 400 && r.json?.code === 'KIND_REQUIRED');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
