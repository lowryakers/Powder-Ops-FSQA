// Executed, not asserted: the People module's tags and files, against a real
// server and an S3 stand-in. A tag is a category somebody can be called from;
// a file is a résumé that must live with the person and die with them.
const B = `http://localhost:${process.env.PORT || 4968}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('ppl-admin','Ppl Admin','Ppl Admin','admin','office',1,'SEED-CODE',datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('ppl-sup','Ppl Super','Ppl Super','supervisor','warehouse',1,'SEED-CODE',datetime('now','+7 day'),'{"candidates":"edit"}')`).run();
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
token = await login('ppl-admin', 'Ppl Admin', 'PplSecret2026');
t('admin signed in', !!token);

console.log('\n── tags ──');
const meta0 = await J(await req('/candidates/meta'));
t('meta offers the plant teams as tag suggestions', meta0.tags.some(x => x.name === 'Warehouse' && x.suggested) && meta0.tags.some(x => x.name === 'Kitting' && x.suggested));
t('meta offers Temp / 1099', meta0.tags.some(x => x.name === 'Temp / 1099' && x.suggested));
t('a suggestion with nobody tagged still appears, at zero', meta0.tags.find(x => x.name === 'Kitting')?.count === 0);
t('meta reports storage enabled', meta0.storage_enabled === true);

const a = await J(await req('/candidates', { method: 'POST', body: JSON.stringify({ name: 'Vanessa T', tags: ['warehouse', 'Temp / 1099', 'Forklift certified'] }) }));
t('created with tags', Array.isArray(a.tags) && a.tags.length === 3, JSON.stringify(a.tags));
t('a lower-case team files under the canonical label', a.tags.includes('Warehouse') && !a.tags.includes('warehouse'));
t('a free tag is kept as typed', a.tags.includes('Forklift certified'));
const dup = await J(await req(`/candidates/${a.id}`, { method: 'PUT', body: JSON.stringify({ tags: ['Warehouse', 'WAREHOUSE', 'Temp / 1099'] }) }));
t('a duplicate tag in two spellings collapses to one', dup.tags.filter(x => x.toLowerCase() === 'warehouse').length === 1);
t('an edit that names tags replaces them (Forklift dropped)', !dup.tags.includes('Forklift certified'));
const keep = await J(await req(`/candidates/${a.id}`, { method: 'PUT', body: JSON.stringify({ notes: 'called her' }) }));
t('an edit that does not mention tags leaves them alone', keep.tags.length === 2 && keep.tags.includes('Temp / 1099'));

const b = await J(await req('/candidates', { method: 'POST', body: JSON.stringify({ name: 'Quality Assurance Lead Bob', tags: ['Quality Assurance Lead'] }) }));
const byQa = await J(await req('/candidates?tag=QA'));
t('?tag matches a whole tag, not a substring (QA does not hit "Quality Assurance Lead")', !byQa.some(r => r.id === b.id));
const byTemp = await J(await req('/candidates?tag=temp%20%2F%201099'));
t('?tag is case-insensitive and finds the temp pool', byTemp.length === 1 && byTemp[0].id === a.id);
const meta1 = await J(await req('/candidates/meta'));
t('meta counts reflect the tags filed', meta1.tags.find(x => x.name === 'Temp / 1099')?.count === 1 && meta1.tags.find(x => x.name === 'Warehouse')?.count === 1);
t('a free tag joins the suggestion list after the built-ins', meta1.tags.some(x => x.name === 'Quality Assurance Lead' && !x.suggested));

console.log('\n── files ──');
const fd = new FormData();
fd.append('files', new Blob(['%PDF-1.4 resume bytes'], { type: 'application/pdf' }), 'Vanessa Resume.pdf');
fd.append('files', new Blob(['ref letter'], { type: 'text/plain' }), 'reference.txt');
const withFiles = await J(await up(`/candidates/${a.id}/files`, fd));
t('two files attached', withFiles?.files?.length === 2, JSON.stringify(withFiles));
t('the file rows carry the filename and who attached it', withFiles.files.every(f => f.filename && f.uploaded_by === 'Ppl Admin' && f.has_file));
const listed = await J(await req('/candidates'));
t('the list carries the files with each person', listed.find(r => r.id === a.id)?.files?.length === 2 && listed.find(r => r.id === b.id)?.files?.length === 0);
const urlRes = await J(await req(`/candidates/files/${withFiles.files[0].id}/url`));
t('a file resolves to a download URL', typeof urlRes?.url === 'string' && urlRes.url.length > 10);
const bytes = await (await fetch(urlRes.url)).text();
t('the bytes that come back are the bytes that went in', bytes.includes('resume bytes'), bytes.slice(0, 40));
const del = await J(await req(`/candidates/files/${withFiles.files[1].id}`, { method: 'DELETE' }));
t('a file can be removed', del?.ok === true);
const one = await J(await req(`/candidates/${a.id}`));
t('one file remains on the person', one.files.length === 1 && one.files[0].filename === 'Vanessa Resume.pdf');

// Deleting the person takes the file with them — the row must not outlive the
// person it belonged to, and neither may the bytes.
const key = new Database(process.env.DBPATH, { readonly: true }).prepare('SELECT storage_key FROM candidate_files WHERE candidate_id = ?').get(a.id)?.storage_key;
await req(`/candidates/${a.id}`, { method: 'DELETE' });
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  t('the file rows are gone with the person', db.prepare('SELECT COUNT(*) c FROM candidate_files WHERE candidate_id = ?').get(a.id).c === 0);
  db.close();
}
const gone = await fetch(`${process.env.R2_ENDPOINT}/test/${key}`);
t('the object is gone from storage too', gone.status === 404, `${gone.status}`);

console.log('\n── the door ──');
const supTok = await login('ppl-sup', 'Ppl Super', 'SupSecret2026');
const saved = token; token = supTok;
const denied = await req('/candidates/meta');
t('a warehouse supervisor with the module grant is still refused (office/HR only)', denied.status === 403, `${denied.status}`);
const deniedUp = await up(`/candidates/${b.id}/files`, new FormData());
t('…and cannot attach a file either', deniedUp.status === 403, `${deniedUp.status}`);
token = saved;

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
