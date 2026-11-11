// Executed, not asserted: A-20261111-004 PR B (D-339). A supplier we buy from
// needs a type; the contact import keeps name/role/primary; the contact repair
// script fills only blanks; and the Quality bot's `suppliers-edit` grant opens
// the edit routes and nothing else. Throwaway tokens on this test database
// only, minted by its own test admin.
//
// Control: `main` before D-339 — the grant does not exist, so minting it is
// refused and every bot edit is 403; a typeless in-use supplier saves.
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { contactsFromRow } from '../server/supplier-import.js';

const PORT = Number(process.env.PORT || 5214);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
const PW = 'SupplierBot2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('st-admin', 'Ada Admin', 'admin', 'admin');
  mk('st-pur', 'Pat Purchasing', 'operator', 'purchasing', { suppliers: 'edit' });
  mk('st-bot', '*Quality Bot', 'operator', 'quality', { suppliers: 'edit' });
  const s = db.prepare('INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using, food_contact) VALUES (?,?,?,?,?)');
  s.run('st-typeless', 'Typeless Raw Co', null, 1, null);
  s.run('st-idle', 'Idle Typeless Co', null, 0, null);
  s.run('st-pack', 'Pack Co', null, 1, null);
  s.run('st-bot-s', 'Bot Edits Co', 'ingredient', 1, null);
  db.prepare("INSERT OR REPLACE INTO supplier_contacts (id, supplier_id, name, email) VALUES ('st-c1','st-bot-s',NULL,'orders@botedits.example')").run();
  db.prepare("INSERT OR REPLACE INTO supplier_contacts (id, supplier_id, name, email) VALUES ('st-c2','st-bot-s',NULL,'qa@botedits.example')").run();
  db.prepare("INSERT OR REPLACE INTO supplier_contacts (id, supplier_id, name, email, role) VALUES ('st-c3','st-bot-s','Kept Name','sales@botedits.example','sales')").run();
  db.prepare("INSERT OR REPLACE INTO supplier_files (id, supplier_id, kind, filename, source_path) VALUES ('st-f1','st-bot-s','unknown','Spec.pdf','x/1')").run();
  db.prepare("INSERT OR REPLACE INTO supplier_materials (id, supplier_id, item_description) VALUES ('st-m1','st-bot-s','Whey')").run();
  db.close();
}

const call = async (m, p, b, tok) => {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const admin = await signIn('st-admin', 'Ada Admin');
const pur = await signIn('st-pur', 'Pat Purchasing');
t('an admin and Purchasing signed in', !!admin && !!pur);

console.log('\n── a supplier we buy from needs a type ──');
let r = await call('PUT', '/suppliers/st-typeless', { notes: 'new note' }, pur);
t('saving a typeless supplier still in use without a type → 400 naming the list', r.status === 400 && r.json?.code === 'VENDOR_TYPE_REQUIRED'
  && /Ingredient/.test(r.json.error) && one("SELECT notes FROM suppliers WHERE id='st-typeless'").notes === null);
r = await call('PUT', '/suppliers/st-typeless', { vendor_type: 'ingredient' }, pur);
let d = (await call('GET', '/suppliers/st-typeless', null, pur)).json;
t('typed Ingredient → 200; it now owes a GMP certificate and NOT a letter of guarantee',
  r.status === 200 && d.gmp_cert.required === true && d.guarantee.required === false, JSON.stringify({ g: d.gmp_cert?.required, l: d.guarantee?.required }));
t('clearing the type of a supplier still in use → 400', (await call('PUT', '/suppliers/st-typeless', { vendor_type: '' }, pur)).status === 400);
await call('PUT', '/suppliers/st-pack', { vendor_type: 'packaging' }, pur);
d = (await call('GET', '/suppliers/st-pack', null, pur)).json;
t('typed Packaging → owes both a GMP certificate and a letter of guarantee', d.gmp_cert.required && d.guarantee.required);
t('a typeless supplier we no longer buy from still saves with no type',
  (await call('PUT', '/suppliers/st-idle', { notes: 'kept' }, pur)).status === 200);
t('turning "in use" off still needs a reason', (await call('PUT', '/suppliers/st-pack', { actively_using: false }, pur)).status === 400);
t('nothing was backfilled: the other typeless rows keep a blank type', one("SELECT vendor_type FROM suppliers WHERE id='st-idle'").vendor_type === null);

console.log('\n── the contact import keeps name, role and primary ──');
const cs = contactsFromRow({ Contact: 'jane@acme.example', 'Contact Name': 'Jane Roe', 'Contact Role': 'Quality / food safety', 'Primary Contact': 'yes' });
t('one address with a name, a role and "primary" keeps all three', cs.length === 1 && cs[0].name === 'Jane Roe' && cs[0].role === 'quality' && cs[0].is_primary === 1);
const cs2 = contactsFromRow({ Contact: 'orders@acme.example, help@acme.example', 'Contact Name': 'Only One' });
t('a name that does not line up with the addresses is not guessed onto either', cs2.every(c => c.name === null));
const cs3 = contactsFromRow({ Contact: 'a@x.example; b@x.example', 'Contact Name': 'Al; Bea', 'Primary Contact': 'b@x.example', 'Contact Role': 'orders; wizard' });
t('names and roles in the same order line up; the primary is the address named; an unknown role is dropped',
  cs3[0].name === 'Al' && cs3[1].name === 'Bea' && cs3[1].is_primary === 1 && cs3[0].is_primary === 0 && cs3[0].role === 'orders' && cs3[1].role === null);
t('a generic inbox with no name in the source stays nameless', contactsFromRow({ Contact: 'orders@acme.example' })[0].name === null);

console.log('\n── the contact repair script: dry run, then fill only blanks ──');
const dir = mkdtempSync(join(tmpdir(), 'st-map-'));
const map = join(dir, 'map.csv');
writeFileSync(map, 'supplier,email,name,role,primary\n'
  + 'Bot Edits Co,QA@botedits.example,Quinn Quality,quality,yes\n'
  + 'Bot Edits Co,sales@botedits.example,Overwrite Me,orders,\n'
  + 'Bot Edits Co,nobody@botedits.example,Ghost,,\n'
  + 'No Such Co,a@b.example,X,,\n');
const runRepair = (...a) => execFileSync('node', ['scripts/supplier-contacts-repair.mjs', map, ...a], { env: { ...process.env, DB_PATH: DBP }, encoding: 'utf8' });
const dry = runRepair();
t('the dry run writes nothing', /DRY RUN/.test(dry) && one("SELECT name FROM supplier_contacts WHERE id='st-c2'").name === null);
t('…and reports the fill, the field already set, the missing address and the unknown supplier',
  /to fill: 1/.test(dry) && /name already "Kept Name"/.test(dry) && /not one of this supplier/.test(dry) && /no such supplier/.test(dry), dry);
const applied = runRepair('--apply');
const c2 = one("SELECT name, role, is_primary FROM supplier_contacts WHERE id='st-c2'");
const c3 = one("SELECT name, role FROM supplier_contacts WHERE id='st-c3'");
t('--apply fills the blank name, role and primary', /APPLIED: 1/.test(applied) && c2.name === 'Quinn Quality' && c2.role === 'quality' && c2.is_primary === 1, applied);
t('…never overwrites a name or role somebody set', c3.name === 'Kept Name' && c3.role === 'sales');
t('…creates no contact and deletes none', one("SELECT COUNT(*) n FROM supplier_contacts WHERE supplier_id='st-bot-s'").n === 3);
t('…leaves an audit row with before and after', !!one("SELECT 1 FROM audit_log WHERE action='supplier_contact_repaired' AND entity_id='st-c2' AND previous_state LIKE '%null%'"));
t('a second --apply finds nothing to fill', /Nothing to fill/.test(runRepair('--apply')));

console.log('\n── the suppliers-edit grant ──');
r = await call('GET', '/api-tokens', null, admin);
t('Settings offers suppliers-edit as a tick box', (r.json?.grants || []).some(g => g.key === 'suppliers-edit'));
const mint = async (label, grants) => {
  const m = await call('POST', '/api-tokens', { user_id: 'st-bot', label, scopes: ['read', 'write'] }, admin);
  const id = m.json?.token?.id;
  if (grants.length) await call('POST', `/api-tokens/${id}/grants`, { grants }, admin);
  return m.json?.plaintext;
};
const NONE = await mint('Quality bot (no grant)', []);
const EDIT = await mint('Quality bot (suppliers)', ['suppliers-edit']);
t('a no-grant token and a suppliers-edit token minted', !!NONE && !!EDIT);
r = await call('GET', '/bot/whoami', null, EDIT);
t('whoami lists the grant', (r.json?.grants || []).includes('suppliers-edit'), JSON.stringify(r.json?.grants));
t('GET /:id: can_edit true with the grant, false without; can_decide false for both',
  (await call('GET', '/suppliers/st-bot-s', null, EDIT)).json?.can_edit === true
  && (await call('GET', '/suppliers/st-bot-s', null, NONE)).json?.can_edit === false
  && (await call('GET', '/suppliers/st-bot-s', null, EDIT)).json?.can_decide === false);

const edits = [
  ['PUT', '/suppliers/st-bot-s', { website: 'botedits.example' }],
  ['POST', '/suppliers/st-bot-s/contacts', { email: 'new@botedits.example', name: 'New Person' }],
  ['PUT', '/suppliers/contacts/st-c1', { phone: '555-0100' }],
  ['POST', '/suppliers/st-bot-s/materials', { item_description: 'Bot Cocoa', part_number: 'B-1' }],
  ['PUT', '/suppliers/materials/st-m1', { manufacturer_name: 'Maker' }],
  ['PUT', '/suppliers/files/st-f1', { kind: 'specification' }],
];
for (const [m, p, b] of edits) {
  const nr = await call(m, p, b, NONE);
  t(`without the grant: ${m} ${p} → 403 not open to tokens`, nr.status === 403 && nr.json?.error === 'token_denied' && nr.json?.category === 'not_open_to_tokens', JSON.stringify(nr.json));
}
t('…and nothing changed', one("SELECT website FROM suppliers WHERE id='st-bot-s'").website === null
  && one("SELECT kind FROM supplier_files WHERE id='st-f1'").kind === 'unknown');
for (const [m, p, b] of edits) {
  const er = await call(m, p, b, EDIT);
  t(`with the grant: ${m} ${p} → ${er.status}`, er.status === 200 || er.status === 201, JSON.stringify(er.json));
}
t('the file edit is audited with via_token', !!one("SELECT 1 FROM audit_log WHERE entity_id='st-f1' AND action='supplier_file_relabelled' AND details LIKE '%via_token%'"));

console.log('\n── what the grant never opens ──');
const sup = { status: one("SELECT status FROM suppliers WHERE id='st-bot-s'").status };
r = await call('POST', '/suppliers/st-bot-s/disposition', { disposition: 'approved' }, EDIT);
t('disposition → 403 approve_requires_human_session', r.status === 403 && r.json?.error === 'approve_requires_human_session', JSON.stringify(r.json));
t('…the supplier is unchanged and the block is audited', one("SELECT status FROM suppliers WHERE id='st-bot-s'").status === sup.status
  && !!one("SELECT 1 FROM audit_log WHERE action='api_token_approve_blocked'"));
r = await call('POST', '/suppliers/st-bot-s/materials/st-m1/banned-check', { result: 'not_listed' }, EDIT);
t('banned-list check → 403 approve_requires_human_session', r.status === 403 && r.json?.error === 'approve_requires_human_session', JSON.stringify(r.json));
for (const p of ['/suppliers/contacts/st-c1', '/suppliers/st-bot-s', '/suppliers/files/st-f1/stored']) {
  r = await call('DELETE', p, { reason: 'bot' }, EDIT);
  t(`DELETE ${p} → 403 token_denied (delete)`, r.status === 403 && r.json?.error === 'token_denied' && r.json?.category === 'delete', JSON.stringify(r.json));
}
t('…the contact and the supplier are still there', !!one("SELECT 1 FROM supplier_contacts WHERE id='st-c1'") && !!one("SELECT 1 FROM suppliers WHERE id='st-bot-s'"));
for (const p of ['/suppliers/gmp-gate', '/suppliers/banned-gate']) {
  r = await call('PUT', p, { mode: 'on' }, EDIT);
  t(`PUT ${p} → 403 for the token`, r.status === 403 && r.json?.error === 'token_denied', JSON.stringify(r.json));
}
r = await call('POST', '/suppliers/st-bot-s/questionnaire/send', {}, EDIT);
t('a questionnaire send is not open to the token', r.status === 403);
r = await call('POST', '/suppliers/questionnaires/x/revoke', {}, EDIT);
t('a questionnaire revoke is not open to the token', r.status === 403);
r = await call('PUT', '/suppliers/st-bot-s', { status: 'approved' }, EDIT);
t('status is still never set through PUT (STATUS_OWNED)', r.status === 400 && /STATUS_OWNED/.test(r.json?.error || ''));

console.log('\n── a person still edits as before ──');
t('Purchasing (no token) edits a supplier', (await call('PUT', '/suppliers/st-bot-s', { notes: 'person' }, pur)).status === 200);
t('Purchasing still sees can_edit true', (await call('GET', '/suppliers/st-bot-s', null, pur)).json?.can_edit === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
