// Write paths that bypassed the one definition — executed against a live
// server. A checklist or lockout verification is a signature by the caller;
// a version row means one thing whichever door wrote it; every product write
// stamps readiness. Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4926;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { v4: uuid } = await import('uuid');
const DB = () => new Database(process.env.DBPATH);
const PW = { admin: 'DoorsAdmin2026!', op: 'DoorsOp2026!' };
{ const db = DB();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('wd-admin','Doors Admin','Doors Admin','admin','qa',1,'SC-WA',datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('wd-op','Doors Operator','Doors Operator','operator','warehouse',1,'SC-WO',datetime('now','+7 day'),'{"pm":"edit","loto":"edit"}')`).run();
  db.close(); }
const signIn = async (name, id, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await J(await post('/users/login', { name, password: pw })))?.token;
};
const opToken = await signIn('Doors Operator', 'wd-op', 'SC-WO', PW.op);
token = await signIn('Doors Admin', 'wd-admin', 'SC-WA', PW.admin);
t('signed in', !!token && !!opToken);

console.log('\nVerifying a checklist is a signature by the caller');
const tmpl = await J(await post('/checklists/templates', { name: 'Doors daily', type: 'gmp', frequency: 'daily', items: [] }));
const sub = await J(await post('/checklists/submissions', { checklist_id: tmpl.id, submitted_by: 'Doors Operator', responses: {} }));
t('submission filed', !!sub?.id, JSON.stringify(sub).slice(0, 120));
let r = await put(`/checklists/submissions/${sub.id}/verify`, { verified_by: 'Somebody Typed' });
let body = await J(r);
t('no password → 403 signature_required', r.status === 403 && body?.signature_required === true, `${r.status} ${JSON.stringify(body).slice(0, 100)}`);
r = await put(`/checklists/submissions/${sub.id}/verify`, { verified_by: 'Somebody Typed', signature_password: 'wrong-pw' });
t('wrong password → refused', r.status === 403, String(r.status));
{ const saved = token; token = opToken;
  r = await put(`/checklists/submissions/${sub.id}/verify`, { signature_password: PW.op });
  t('a warehouse operator cannot verify a checklist', r.status === 403, String(r.status));
  token = saved; }
r = await put(`/checklists/submissions/${sub.id}/verify`, { verified_by: 'Somebody Typed', signature_password: PW.admin });
body = await J(r);
t('with the password it verifies', r.status === 200, `${r.status} ${JSON.stringify(body).slice(0, 100)}`);
t('THE VERIFIER IS THE CALLER, not the name in the body', body?.verified_by === 'Doors Admin', body?.verified_by);
{ const db = DB(); const a = db.prepare("SELECT details FROM audit_log WHERE entity_id = ? AND action LIKE '%verif%' ORDER BY rowid DESC LIMIT 1").get(sub.id); db.close();
  t('the audit entry carries the signature evidence', /signature_verified/.test(a?.details || ''), (a?.details || '').slice(0, 80)); }

console.log('\nVerifying a lockout is a signature by a second person');
const eqId = uuid(), procId = uuid(), exId = uuid();
{ const db = DB();
  db.prepare("INSERT INTO equipment (id, name, type, status) VALUES (?, 'Doors Mixer', 'Mixer', 'active')").run(eqId);
  db.prepare("INSERT INTO loto_procedures (id, equipment_id, title) VALUES (?, ?, 'Doors Mixer LOTO')").run(procId, eqId);
  db.prepare("INSERT INTO loto_executions (id, procedure_id, locked_by, reason, status) VALUES (?, ?, 'Doors Admin', 'blade change', 'locked')").run(exId, procId);
  db.close(); }
r = await put(`/loto/executions/${exId}/verify`, { verified_by: 'Somebody Typed' });
body = await J(r);
t('no password → 403 signature_required', r.status === 403 && body?.signature_required === true, `${r.status}`);
r = await put(`/loto/executions/${exId}/verify`, { signature_password: PW.admin });
body = await J(r);
t('the person who locked out cannot verify their own lockout', r.status === 400 && /different person/.test(body?.error || ''), `${r.status} ${body?.error}`);
{ const saved = token; token = opToken;
  r = await put(`/loto/executions/${exId}/verify`, { verified_by: 'Somebody Typed', signature_password: PW.op });
  body = await J(r);
  t('a second person with their password verifies', r.status === 200, `${r.status} ${JSON.stringify(body).slice(0, 100)}`);
  t('and the record names THEM, not the body', body?.verified_by === 'Doors Operator', body?.verified_by);
  token = saved; }

console.log('\nA version row means one thing whichever door wrote it');
const doc = await J(await post('/documents', { doc_number: 'SOP 777', title: 'Doors procedure', category: 'quality', revision: 'V1', status: 'active' }));
const versions = () => { const db = DB(); const v = db.prepare('SELECT revision, snapshot, change_summary FROM sop_versions WHERE sop_id = ? ORDER BY rowid').all(doc.id); db.close(); return v.map(x => ({ ...x, snapshot: JSON.parse(x.snapshot) })); };
const before = versions();
r = await post(`/documents/${doc.id}/apply-revision`, { fields: { revision: 'V2' }, filename: 'SOP_777_V2.pdf' });
body = await J(r);
t('a revision applied from the upload path', r.status === 200 && (body?.document?.revision === 'V2' || body?.revision === 'V2'), `${r.status} ${JSON.stringify(body).slice(0, 100)}`);
const after = versions();
const last = after[after.length - 1];
t('the newest version row IS the document as it now stands (V2), not the state it replaced',
  last?.revision === 'V2' && last?.snapshot?.revision === 'V2', JSON.stringify({ rev: last?.revision, snap: last?.snapshot?.revision }));
t('V1 is still recoverable from history', after.some(v => v.revision === 'V1' && v.snapshot?.revision === 'V1'), `${before.length} → ${after.length} rows`);
{ const db = DB(); const d = db.prepare('SELECT training_revision FROM sop_documents WHERE id = ?').get(doc.id); db.close();
  t('training_revision moved with the applied revision, so retraining triggers', d?.training_revision === 'V2', d?.training_revision); }
{ const db = DB();
  const n = db.prepare(`SELECT COUNT(*) AS c FROM sop_documents d WHERE d.doc_type = 'reference'
    AND NOT EXISTS (SELECT 1 FROM sop_versions v WHERE v.sop_id = d.id)`).get().c;
  const refs = db.prepare("SELECT COUNT(*) AS c FROM sop_documents WHERE doc_type = 'reference'").get().c;
  db.close();
  t('every seeded reference document has a baseline version row', refs > 0 && n === 0, `${refs} reference docs, ${n} without a version`); }

console.log('\nEvery product write stamps readiness');
const p = await J(await post('/products', { sku: 'TST-PLG-DOR', flavor: 'Doors', category: 'Whey', pack: 'PLG', status: 'Active', spec_id: 'SPEC-POUCH-LG' }));
t('product created', p?.sku === 'TST-PLG-DOR', JSON.stringify(p).slice(0, 120));
const basis = (sku) => { const db = DB(); const b = db.prepare('SELECT readiness_basis FROM products WHERE sku = ?').get(sku)?.readiness_basis; db.close(); return b ? JSON.parse(b) : null; };
t('CREATION RECORDS A BASIS for the steps it satisfied', !!basis('TST-PLG-DOR') && !!basis('TST-PLG-DOR').sku, JSON.stringify(basis('TST-PLG-DOR')));
r = await post('/products/TST-PLG-DOR/confirm/shopify', {});
t('Shopify listing confirmed', r.status === 200, String(r.status));
r = await post('/products/TST-PLG-DOR/rename', { sku: 'TST-PLG-DOS' });
t('renamed', r.status === 200, String(r.status));
const list = await J(await req('/products'));
const row = (list?.products || []).find(x => x.sku === 'TST-PLG-DOS');
const shop = row?.readiness?.steps?.find(s => s.key === 'shopify');
t('A RENAME UN-TICKS THE SHOPIFY STEP (stale) rather than leaving it describing the old code', shop?.state === 'stale', JSON.stringify(shop));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
