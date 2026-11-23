// D-376 (single-spine move 03, finished): the mock recall's acceptance criteria
// (SOP 414, FORM 415-1: 99.5–100.5% mass balance, four hours) and the Form 403-01
// internal audit checklist are on the document-control path (D-328), and the
// live modules read the APPROVED snapshot.
//
// What this proves:
//   - both are registered, recorded as the approved baseline on a fresh
//     database, and editable on the Controlled Changes screen;
//   - a change Document Control PROPOSES is not used: a mock recall started
//     while it is pending is judged on the approved numbers, and a new audit
//     asks the approved questions;
//   - once a QA supervisor has reviewed it and Document Control approved it, a
//     NEW mock recall is judged on the new window, and a new audit asks the new
//     question under the new revision;
//   - a record already filed keeps what it was judged on / asked: the older mock
//     recall still fails at 99.5% and says so, a recall with no stamp (filed
//     before D-376) is judged on 99.5–100.5%, and the older audit keeps its
//     question text and V1.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5242;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const PW = 'CtrlRecall2026!';
const mkUser = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept,
  JSON.stringify({ recall: 'edit', 'internal-audits': 'edit', documents: 'edit', 'qa-review': 'view' }), `SC-${id}`);
mkUser('cr-dc', 'Dana Control', 'operator', 'document_control');
mkUser('cr-qa', 'Quinn Review', 'supervisor', 'qa');

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  const tok = (await call('POST', '/users/login', { name, password: PW })).body?.token;
  return { ...H, Authorization: `Bearer ${tok}` };
};
const D = await login('cr-dc', 'Dana Control');
const Q = await login('cr-qa', 'Quinn Review');
const sig = { signature_password: PW };

console.log('── registered, baselined, editable ──');
const list = (await call('GET', '/controlled', undefined, D)).body || [];
const rec = list.find(x => x.key === 'recall:SOP 414');
const aud = list.find(x => x.key === 'audit:Form 403-01');
t('the mock recall criteria are a controlled definition', !!rec && rec.status === 'approved' && rec.editable, JSON.stringify(rec && { s: rec.status, e: rec.editable }));
t('…and the Form 403-01 checklist', !!aud && aud.status === 'approved' && aud.editable, JSON.stringify(aud && { s: aud.status, e: aud.editable }));
const baseRow = db.prepare("SELECT approved_snapshot FROM controlled_definitions WHERE key = 'recall:SOP 414'").get();
const base = JSON.parse(baseRow?.approved_snapshot || '{}');
t('the baseline approved is SOP 414\'s 99.5–100.5% and four hours', base.mass_balance_min === 99.5 && base.mass_balance_max === 100.5 && base.max_duration_minutes === 240, JSON.stringify(base));
let r = await call('GET', `/controlled/${rec?.id}/edit`, undefined, D);
t('the edit form names the three numbers', ['mass_balance_min', 'mass_balance_max', 'max_duration_minutes'].every(p => (r.body?.fields || []).some(f => f.path === p)));
r = await call('GET', `/controlled/${aud?.id}/edit`, undefined, D);
const firstQ = (r.body?.fields || []).find(f => f.path === 'sections[incoming_inspections].items[0]');
t('the checklist edit form names each question by section', firstQ?.value === 'All inbound trailers are inspected' && (r.body?.fields || []).some(f => f.path === 'revision' && f.value === 'V1'), JSON.stringify(firstQ));

console.log('\n── mock recall: a recall filed before D-376, and one started under the baseline ──');
// A recall filed before D-376 has no stamp.
db.prepare(`INSERT INTO mock_recalls (id, recall_number, date_initiated, product_name, lot_number, reason, initiated_by, started_at, ended_at,
  mass_balance_pct, summary_report_complete, form_415_1_checked, checklist_revision)
  VALUES ('cr-old', 'MR-900', '2025-11-01', 'Old Blend', 'OLD-1', 'Annual drill', 'Maria', '2025-11-01T08:00:00Z', '2025-11-01T10:00:00Z', 99.2, 1, 1, 'SOP 415 V3')`).run();
r = await call('GET', '/mock-recalls/cr-old', undefined, D);
t('a recall with no stamp is judged on 99.5–100.5% (what was in force before D-376)', r.body?.effectiveness?.judged_on?.mass_balance_min === 99.5 && r.body?.effectiveness?.judged_on?.legacy === true
  && r.body?.effectiveness?.criteria?.find(c => c.id === 'mass_balance')?.met === false, JSON.stringify(r.body?.effectiveness?.judged_on));

const drill = async (label) => {
  const c = await call('POST', '/mock-recalls', { product_name: `Drill ${label}`, lot_number: `CR-${label}`, reason: 'Annual drill' }, D);
  const id = c.body?.id;
  const u = await call('PUT', `/mock-recalls/${id}`, { started_at: '2026-11-20T08:00:00Z', ended_at: '2026-11-20T11:00:00Z', mass_balance_pct: 99.2, summary_report_complete: true, form_415_1_checked: true }, D);
  return { id, body: u.body, created: c };
};
const mb = (b) => b?.effectiveness?.criteria?.find(c => c.id === 'mass_balance');
const A = await drill('A');
t('a recall started now is stamped with the criteria in force', A.created.status === 201 && JSON.parse(db.prepare('SELECT criteria FROM mock_recalls WHERE id = ?').get(A.id).criteria || '{}').mass_balance_min === 99.5);
t('99.2% fails against 99.5–100.5%', mb(A.body)?.met === false && /99\.5–100\.5%/.test(mb(A.body)?.label || ''), JSON.stringify(mb(A.body)));

console.log('\n── proposed: 99.0–101.0% ──');
r = await call('POST', `/controlled/${rec?.id}/propose`, { values: { mass_balance_min: '101', mass_balance_max: '100', max_duration_minutes: '240' }, reason: 'DCR 0601 — SOP 414 V4' }, D);
t('a window whose top is below its bottom is refused in words', r.status === 400 && /highest recovery/.test(r.body?.error || ''), JSON.stringify(r.body));
r = await call('POST', `/controlled/${rec?.id}/propose`, { values: { mass_balance_min: '99.0', mass_balance_max: '101.0', max_duration_minutes: '240' }, reason: 'DCR 0601 — SOP 414 V4' }, D);
t('Document Control proposes the wider window', r.status === 200 && r.body?.status === 'pending', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', '/mock-recalls/form', undefined, D);
t('the form still offers the approved window while the change waits', r.body?.criteria?.mass_balance_min === 99.5);
const B = await drill('B');
t('a recall started while the change is pending is judged on the approved numbers', mb(B.body)?.met === false && B.body?.criteria?.mass_balance_min === 99.5, JSON.stringify(B.body?.criteria));

r = await call('POST', `/controlled/${rec?.id}/approve`, sig, D);
t('it cannot be approved before QA review', r.status === 409);
r = await call('POST', `/controlled/${rec?.id}/qa-review`, sig, Q);
t('a QA supervisor reviews it with the password', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call('POST', `/controlled/${rec?.id}/approve`, sig, D);
t('Document Control approves it with the password', r.status === 200 && r.body?.status === 'approved', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

console.log('\n── approved ──');
r = await call('GET', '/mock-recalls/form', undefined, D);
t('the form offers 99–101% at once, no restart', r.body?.criteria?.mass_balance_min === 99 && r.body?.criteria?.mass_balance_max === 101, JSON.stringify(r.body?.criteria));
const C = await drill('C');
t('a NEW recall at 99.2% now meets the mass balance', mb(C.body)?.met === true && /99–101%/.test(mb(C.body)?.label || ''), JSON.stringify(mb(C.body)));
t('…and is stamped with the new numbers and the definition version', (() => { const c = JSON.parse(db.prepare('SELECT criteria FROM mock_recalls WHERE id = ?').get(C.id).criteria); return c.mass_balance_min === 99 && c.definition_version >= 2; })());
r = await call('GET', `/mock-recalls/${A.id}`, undefined, D);
t('the recall started before still fails at 99.5% and says so', mb(r.body)?.met === false && /99\.5–100\.5%/.test(mb(r.body)?.label || ''), JSON.stringify(mb(r.body)));
r = await call('GET', `/mock-recalls/${B.id}`, undefined, D);
t('…and so does the one started while it was pending', mb(r.body)?.met === false);
r = await call('GET', '/mock-recalls/cr-old', undefined, D);
t('the unstamped one is still judged on 99.5–100.5%', mb(r.body)?.met === false);

console.log('\n── Form 403-01 ──');
const today = new Date().toISOString().slice(0, 10);
const audit = async () => (await call('POST', '/internal-audits', { audit_date: today, sections: ['incoming_inspections'] }, D)).body;
const a1 = await audit();
r = await call('GET', `/internal-audits/${a1?.id}`, undefined, D);
const q1 = (r.body?.items || []).find(i => i.item_key === 'incoming_inspections.0');
t('an audit asks the approved question under V1', a1?.checklist_revision === 'V1' && q1?.prompt === 'All inbound trailers are inspected', JSON.stringify({ rev: a1?.checklist_revision, q: q1?.prompt }));
const NEWQ = 'All inbound trailers are inspected and the inspection is recorded on FORM 204-01';
r = await call('POST', `/controlled/${aud?.id}/propose`, { values: { 'sections[incoming_inspections].items[0]': NEWQ, revision: 'V2' }, reason: 'DCR 0602 — 403-01 V2' }, D);
t('Document Control proposes a reworded question and V2', r.status === 200 && r.body?.status === 'pending', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await call('GET', '/internal-audits/checklist', undefined, D);
t('the checklist served is still V1 while it waits', r.body?.revision === 'V1' && r.body?.sections?.[0]?.items?.[0] === 'All inbound trailers are inspected', JSON.stringify(r.body?.sections?.[0]?.items?.[0]));
const a2 = await audit();
r = await call('GET', `/internal-audits/${a2?.id}`, undefined, D);
t('a new audit while it is pending asks the approved (V1) question', a2?.checklist_revision === 'V1' && (r.body?.items || []).find(i => i.item_key === 'incoming_inspections.0')?.prompt === 'All inbound trailers are inspected');
r = await call('POST', `/controlled/${aud?.id}/qa-review`, sig, Q);
t('QA reviews it', r.status === 200, `${r.status}`);
r = await call('POST', `/controlled/${aud?.id}/approve`, sig, D);
t('Document Control approves it', r.status === 200 && r.body?.status === 'approved', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call('GET', '/internal-audits/checklist', undefined, D);
t('the checklist served is V2 with the new wording, at once', r.body?.revision === 'V2' && r.body?.sections?.[0]?.items?.[0] === NEWQ);
const a3 = await audit();
r = await call('GET', `/internal-audits/${a3?.id}`, undefined, D);
t('a new audit is stamped V2 and asks the new question', a3?.checklist_revision === 'V2' && (r.body?.items || []).find(i => i.item_key === 'incoming_inspections.0')?.prompt === NEWQ);
r = await call('GET', `/internal-audits/${a1?.id}`, undefined, D);
t('the audit filed under V1 keeps V1 and the words it was asked', r.body?.checklist_revision === 'V1' && (r.body?.items || []).find(i => i.item_key === 'incoming_inspections.0')?.prompt === 'All inbound trailers are inspected');
t('no other question moved', (r.body?.items || []).length === (await call('GET', `/internal-audits/${a3?.id}`, undefined, D)).body?.items?.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
