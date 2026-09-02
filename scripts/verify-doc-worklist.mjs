// The Document Control worklist, executed against a live server on a fresh DB.
const B = `http://localhost:${process.env.PORT || 4880}/api`;
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
    VALUES ('dc','Dani Control','Dani Control','admin','document_control',1,'S','2030-01-01')`).run();
  db.close();
}
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'dc', password: 'DocSecret2026', setup_code: 'S' }) });
token = (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Dani Control', password: 'DocSecret2026' }) })))?.token;
t('document control signed in', !!token);

// A registry row to revise, and its current revision.
const before = await J(await req('/documents', { method: 'POST', body: JSON.stringify({
  doc_type: 'sop', doc_number: 'SOP 999', title: 'Worklist Test Procedure', category: 'quality',
  // The create endpoint calls the body `content`; it lands in `description`.
  // The first version of this check sent `description`, which was ignored — so
  // the assertion below passed against a body that had never been stored.
  revision: 'V1', status: 'active', content: 'The original body on file.' }) }));
t('a document exists to revise', !!before?.id, JSON.stringify(before).slice(0, 120));

console.log('\n── filing a batch writes nothing to any document ──');
const md = (name, body) => { const fd = new FormData(); fd.append('files', new Blob([body], { type: 'text/markdown' }), name); return fd; };
const batch = await J(await up('/documents/revisions/batch',
  md('SOP-999_Worklist_Test_Procedure_V4.md',
     '# Worklist Test Procedure\n\nRevision: V4\nEffective date: 2026-08-01\n\nThis is the finalised body, considerably longer than what was on file before it, so the proposal has something real to offer.')));
t('the batch is filed', batch?.filed === 1, JSON.stringify(batch));
const after1 = await J(await req(`/documents/${before.id}`));
t('THE DOCUMENT IS UNTOUCHED by filing', after1.revision === 'V1', after1.revision);

console.log('\n── the worklist ──');
let wl = await J(await req('/documents/revisions/worklist'));
t('the item is outstanding', wl?.progress?.outstanding === 1, JSON.stringify(wl?.progress));
const item = wl.items[0];
t('it matched the right document', item?.document_id === before.id);
t('a moved revision is the first kind', item?.kind === 'revision_moved', item?.kind);
t('the revision change is proposed', item.changes.some(c => c.field === 'revision' && c.to === 'V4'),
  JSON.stringify(item.changes.map(c => c.field)));
t('the extracted body is NOT shipped to the client', item.extracted === undefined || item.extracted === null);

console.log('\n── applying goes through the same writer ──');
const ap = await J(await req(`/documents/revisions/items/${item.id}/apply`, { method: 'POST',
  body: JSON.stringify({ fields: ['revision', 'effective_date'] }) }));
t('apply succeeds', ap?.ok === true, JSON.stringify(ap).slice(0, 140));
const after2 = await J(await req(`/documents/${before.id}`));
t('the revision moved', after2.revision === 'V4', after2.revision);
t('ONLY THE TICKED FIELDS APPLIED — the body was not', after2.description === 'The original body on file.',
  String(after2.description).slice(0, 40));
const versions = await J(await req(`/documents/${before.id}/versions`));
t('a version snapshot was written, as the modal does', Array.isArray(versions) ? versions.length >= 1 : !!versions,
  JSON.stringify(versions).slice(0, 90));

console.log('\n── the queue remembers ──');
wl = await J(await req('/documents/revisions/worklist'));
t('the applied item leaves the queue', wl.progress.outstanding === 0, JSON.stringify(wl.progress));
t('...and is counted as handled', wl.progress.applied === 1 && wl.progress.percent === 100);
const again = await req(`/documents/revisions/items/${item.id}/apply`, { method: 'POST', body: JSON.stringify({}) });
t('applying a decided item twice is refused', again.status === 409, `${again.status}`);

console.log('\n── a file matching no document ──');
await up('/documents/revisions/batch', md('Something Nobody Filed.md', '# A document the registry has never heard of\n\nRevision: V2'));
wl = await J(await req('/documents/revisions/worklist'));
const orphan = wl.items.find(i => /Nobody Filed/.test(i.filename));
t('it is filed as needing a person', orphan && orphan.kind === 'unmatched', orphan?.kind);
t('...and counted separately', wl.progress.needs_a_person === 1, `${wl.progress.needs_a_person}`);
const cantApply = await req(`/documents/revisions/items/${orphan.id}/apply`, { method: 'POST', body: JSON.stringify({}) });
t('APPLYING AN UNMATCHED FILE IS REFUSED, never guessed', cantApply.status === 400, `${cantApply.status}`);

console.log('\n── skipping is a decision, not a delete ──');
const noReason = await req(`/documents/revisions/items/${orphan.id}/skip`, { method: 'POST', body: JSON.stringify({}) });
t('a skip with no reason is refused', noReason.status === 400, `${noReason.status}`);
await req(`/documents/revisions/items/${orphan.id}/skip`, { method: 'POST', body: JSON.stringify({ reason: 'This is a supplier document, not ours' }) });
wl = await J(await req('/documents/revisions/worklist'));
t('the skipped row survives with its reason',
  wl.recent_done.some(r => r.id === orphan.id && /supplier document/.test(r.skip_reason || '')),
  JSON.stringify(wl.recent_done.map(r => r.state)));
t('and the queue is clear', wl.progress.outstanding === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
