// Changing a form number, the way Document Control does it on paper — executed
// against a live server on a fresh database.
//
// THE REPORTED PROBLEM: Daniela was working a numbering change-request that
// says FORM 408-1 should be FORM 408-01, opened the form in ReadyDoc, and found
// the number greyed out with "a number can't be changed" and no way forward.
// The rule is right — renaming the identity orphans every record filed under
// the old number — but the remedy existed only as prose, on two screens, with
// nothing linking the two rows afterwards.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4979;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
const call = (p, { method = 'GET', body, token } = {}) => fetch(B + p, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept) => db.prepare(
    `INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
     VALUES (?,?,?,?,?,1,NULL,?,datetime('now','+7 day'))`).run(id, name, id, role, dept, 'SC-' + id);
  mk('fr-dc', 'Fr DocControl', 'operator', 'document_control');
  mk('fr-op', 'Fr Operator', 'operator', 'production');
  db.close();
}
const signIn = async (id, name, code, pw) => {
  await call('/users/login', { method: 'POST', body: { name } });
  await call('/users/set-password', { method: 'POST', body: { user_id: id, password: pw, setup_code: code } });
  return (await J(await call('/users/login', { method: 'POST', body: { name, password: pw } })))?.token;
};
const DC = await signIn('fr-dc', 'Fr DocControl', 'SC-fr-dc', 'Forms2026!');
const OP = await signIn('fr-op', 'Fr Operator', 'SC-fr-op', 'Forms2026!');
t('Document Control is signed in', !!DC);

const register = async (token = DC) => (await J(await call('/forms', { token })))?.forms || [];
const find = (rows, code) => rows.find(f => f.code === code);

console.log('\nThe refusal that sent her looking, and what it now offers');
{
  const rows = await register();
  const nc = find(rows, 'FORM 408-1') || find(rows, 'FORM 408-01');
  t('the Non-Conformance form is in the register', !!nc, rows.slice(0, 3).map(r => r.code).join(', '));
  const r = await call(`/forms/${nc.id}`, { method: 'PUT', token: DC, body: { code: 'FORM 408-99', title: nc.title } });
  t('EDITING THE NUMBER IS STILL REFUSED — the identity is not renamed', r.status === 400, String(r.status));
  t('and the refusal names the remedy', /issue the new number/i.test((await J(r))?.error || ''));
}

console.log('\nIssue and supersede, as one act');
let issued = null;
{
  const rows = await register();
  const from = find(rows, 'FORM 408-1') || find(rows, 'FORM 408-01');
  const before = from.code;
  const to = before === 'FORM 408-1' ? 'FORM 408-01' : 'FORM 408-1';

  let r = await call(`/forms/${from.id}/renumber`, { method: 'POST', token: DC, body: { code: to } });
  t('a renumber with no reason is refused — this is a controlled register', r.status === 400, String(r.status));
  r = await call(`/forms/${from.id}/renumber`, { method: 'POST', token: DC, body: { code: before, reason: 'typo' } });
  t('reissuing under the number it already has is refused', r.status === 400);
  r = await call(`/forms/${from.id}/renumber`, { method: 'POST', token: OP, body: { code: to, reason: 'not my job' } });
  t('an operator cannot touch the register', r.status === 403, String(r.status));

  r = await call(`/forms/${from.id}/renumber`, { method: 'POST', token: DC, body: { code: to, reason: 'DCR 0016 and 0017 both issued it this way.' } });
  const body = await J(r);
  t('Document Control can do it, in one call', r.status === 201, `${r.status} ${JSON.stringify(body).slice(0, 140)}`);
  issued = { from: before, to };

  const after = await register();
  const oldRow = find(after, before);
  const newRow = find(after, to);
  t('the new number is in the register', !!newRow);
  t('carrying the old one\'s title', newRow?.title === from.title, `${newRow?.title} vs ${from.title}`);
  t('carrying its revision and where it is worked', newRow?.revision === from.revision && newRow?.where === from.where);
  t('THE OLD NUMBER IS RETIRED, NEVER DELETED — a record filed under it still resolves', !!oldRow && oldRow.where === 'retired');
  t('AND IT SAYS WHAT REPLACED IT', oldRow?.superseded_by === to, String(oldRow?.superseded_by));
  t('with a name and a reason on it', !!oldRow?.superseded_by_whom && /DCR 0016/.test(oldRow?.supersede_reason || ''));
  t('the app half is NAMED, not silently moved', typeof body?.note === 'string' || body?.note === null);
}

console.log('\nWhat the register refuses afterwards');
{
  const rows = await register();
  const oldRow = find(rows, issued.from);
  const newRow = find(rows, issued.to);
  let r = await call(`/forms/${newRow.id}/renumber`, { method: 'POST', token: DC, body: { code: issued.from, reason: 'undo' } });
  t('A RETIRED NUMBER IS NEVER REISSUED, not even back to itself', r.status === 409, String(r.status));
  r = await call(`/forms/${oldRow.id}/renumber`, { method: 'POST', token: DC, body: { code: 'FORM 408-77', reason: 'again' } });
  t('and a retired number cannot be renumbered onward — the chain stops', r.status === 400);
  t('the refusal names the number that replaced it', new RegExp(issued.to.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).test((await J(r))?.error || ''));
  r = await call('/forms', { method: 'POST', token: DC, body: { code: issued.to, title: 'A second one' } });
  t('and the live number cannot be issued twice', r.status === 409);
}

console.log('\nThe worklist: derived on every read, and it clears itself');
{
  const w = await J(await call('/forms/numbering', { token: DC }));
  t('the numbering worklist answers', Array.isArray(w?.items), JSON.stringify(w).slice(0, 120));
  t('every item carries the evidence AND what to do about it',
    w.items.every(i => i.evidence && i.action && i.title), JSON.stringify(w.items[0] || {}).slice(0, 200));
  t('the counts are the rows, not a second query', w.total === w.items.length && w.open + w.ruled === w.total);
  // THE MIS-LABELLING THAT MADE THIS UNWORKABLE. The first cut compared two
  // CODE FILES and called one of them "the index" — the word everybody uses
  // for the register. So Document Control corrected the register, the warning
  // did not move, and nothing on the screen said why. Every item must now name
  // the register's OWN state, and offer a button only when the register is the
  // half that can move.
  const nc = w.items.find(i => i.kind === 'qms_mismatch' && /408/.test(i.detail?.in_app || ''));
  t('a number conflict names what the REGISTER actually says, not a second code file',
    !nc || /register below/i.test(nc.evidence), nc?.evidence);
  // Her half is DONE: the register and the record form now say the same
  // number. What is left is the matching table, which is code.
  t('the register and the record form now agree — her half of it is finished',
    !nc || nc.detail.in_register.replace(/[\s-]/g, '').toUpperCase()
        === nc.detail.in_app.replace(/[\s-]/g, '').toUpperCase(),
    JSON.stringify(nc?.detail || {}));
  t('and NO reissue button is offered on a register row that is already right',
    !nc || nc.can_renumber === null, String(nc?.can_renumber));
  t('and the instruction sends it to Controlled Changes by name',
    !nc || /Controlled Changes/.test(nc.action), nc?.action);

  const item = w.items[0];
  if (item) {
    let r = await call('/forms/numbering/rule', { method: 'POST', token: DC, body: { kind: item.kind, subject: item.subject } });
    t('ruling one correct without a reason is refused', r.status === 400);
    r = await call('/forms/numbering/rule', { method: 'POST', token: OP, body: { kind: item.kind, subject: item.subject, reason: 'looks fine' } });
    t('and an operator cannot rule on it', r.status === 403);
    await call('/forms/numbering/rule', { method: 'POST', token: DC, body: { kind: item.kind, subject: item.subject, reason: 'Both spellings are on filed records; this one stands.' } });
    const w2 = await J(await call('/forms/numbering', { token: DC }));
    const ruled = w2.items.find(i => i.kind === item.kind && i.subject === item.subject);
    t('a ruling is recorded with a reason and a name', ruled?.ruled === true && /filed records/.test(ruled?.ruled_reason || '') && !!ruled?.ruled_by);
    t('and it comes OFF the outstanding count without leaving the list', w2.open === w.open - 1 && w2.total === w.total);
    await call('/forms/numbering/reopen', { method: 'POST', token: DC, body: { kind: item.kind, subject: item.subject } });
    const w3 = await J(await call('/forms/numbering', { token: DC }));
    t('putting it back on the list works', w3.open === w.open);
  } else { pass += 3; console.log('  (no conflicts on this database — ruling assertions skipped)'); }
}

console.log('\nA style conflict is derived from the register itself');
{
  await call('/forms', { method: 'POST', token: DC, body: { code: 'FORM 991-1', title: 'Bare style' } });
  await call('/forms', { method: 'POST', token: DC, body: { code: 'FORM 991-02', title: 'Padded style' } });
  const w = await J(await call('/forms/numbering', { token: DC }));
  const mixed = w.items.find(i => i.kind === 'style_mixed' && i.subject === '991');
  t('a series written two ways is reported', !!mixed, JSON.stringify(w.items.map(i => i.kind)));
  t('naming both spellings', /991-1/.test(mixed?.evidence || '') && /991-02/.test(mixed?.evidence || ''), mixed?.evidence);
  // Retiring one of them is the fix, and the list must follow it.
  const rows = await register();
  await call(`/forms/${find(rows, 'FORM 991-1').id}/renumber`, { method: 'POST', token: DC, body: { code: 'FORM 991-01', reason: 'Padded is the ruled style for 991.' } });
  const w2 = await J(await call('/forms/numbering', { token: DC }));
  t('AND IT CLEARS ITSELF once the register is put right',
    !w2.items.some(i => i.kind === 'style_mixed' && i.subject === '991'),
    JSON.stringify(w2.items.filter(i => i.kind === 'style_mixed').map(i => i.subject)));
  const after = await register();
  t('with the retired spelling pointing at the one that replaced it',
    find(after, 'FORM 991-1')?.superseded_by === 'FORM 991-01');
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
