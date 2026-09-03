// Executed, not asserted: boot a real server against an S3 stand-in, import the
// plant's REAL archive listing, then attach the REAL AIFI and Mill Haven zips
// over HTTP exactly as the screen does — and check the bytes come back.
const B = `http://localhost:${process.env.PORT || 4843}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { readFileSync } = await import('fs');
const U = '/root/.claude/uploads/af00ada3-a0aa-542a-9170-4983495b696f/';
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('sup-admin','Sup Admin','Sup Admin','admin','qa',1,'SEED-CODE',datetime('now','+7 day'))`).run();
  db.close();
}
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'sup-admin', password: 'SupSecret2026', setup_code: 'SEED-CODE' }) });
token = (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Sup Admin', password: 'SupSecret2026' }) })))?.token;
t('admin signed in', !!token);

console.log('\n── the catalogue first ──');
const listing = JSON.parse(readFileSync('scripts/fixtures/supplier-archive-full.json', 'utf8'));
const mk = () => {
  const fd = new FormData();
  fd.append('files', new Blob([readFileSync(U + '64517a7d-Current_Suppliers__Updated_8_6_2026.xlsx')]), 'Current Suppliers.xlsx');
  fd.append('files', new Blob([listing.entries.join('\n')], { type: 'text/plain' }), 'supplier-listing.txt');
  return fd;
};
await up('/suppliers/import/commit', mk());
let cov = await J(await req('/suppliers/files/coverage'));
t('the catalogue has documents in it', cov.total > 500, `${cov.total}`);
t('NONE of them has bytes yet', cov.stored === 0, `${cov.stored}`);
t('storage reports itself enabled', cov.storage_enabled === true);

console.log('\n── attaching a real vendor zip ──');
const zipFd = (name) => { const fd = new FormData(); fd.append('files', new Blob([readFileSync(U + name)]), name.replace(/^[0-9a-f]+-/, '')); return fd; };

// Storing is BATCHED, so the client loops until nothing is left. The test does
// the same thing — asserting a single call finishes would be asserting the
// behaviour that caused the 502.
const commitAll = async (name) => {
  const first = await J(await up('/suppliers/files/archive/commit', zipFd(name)));
  const total = { stored: first?.result?.stored || 0, failed: [...(first?.result?.failed || [])],
                  passes: 1, plan: first?.plan };
  let id = first?.upload_id, remaining = first?.result?.remaining || 0;
  // A commit sent with the file rather than a held id has nothing to resume
  // from, so re-send it; the already-stored skip makes that cheap and correct.
  while (remaining > 0 && total.passes < 60) {
    const r = await J(await up('/suppliers/files/archive/commit', id
      ? (() => { const f = new FormData(); f.append('upload_id', id); return f; })()
      : zipFd(name)));
    total.stored += r?.result?.stored || 0;
    total.failed.push(...(r?.result?.failed || []));
    remaining = r?.result?.remaining || 0;
    id = r?.upload_id || id;
    total.passes += 1;
    if (!r?.result?.stored) break;
  }
  return total;
};
const an = await J(await up('/suppliers/files/archive/analyze', zipFd('a6011ded-AIFI20260827T204145Z1001.zip')));
t('analyze returns a plan', !!an?.plan, JSON.stringify(an).slice(0, 200));
t('analyze matched real documents', an?.plan?.counts?.store > 0, JSON.stringify(an?.plan?.counts));
t('ANALYZE STORED NOTHING', (await J(await req('/suppliers/files/coverage')))?.stored === 0);

const co = await commitAll('a6011ded-AIFI20260827T204145Z1001.zip');
t('commit stored what it planned, across batches', co.stored === an?.plan?.counts?.store,
  `${co.stored} vs ${an?.plan?.counts?.store} in ${co.passes} passes`);
t('it really did take more than one batch', co.passes > 1, `${co.passes}`);
t('nothing failed', !co.failed.length, JSON.stringify(co.failed).slice(0, 200));
cov = await J(await req('/suppliers/files/coverage'));
t('coverage moved', cov.stored === co.stored, `${cov.stored}`);
t('the byte total is real', cov.bytes > 1000, `${cov.bytes}`);

console.log('\n── re-uploading the SAME zip is safe ──');
const again = await J(await up('/suppliers/files/archive/analyze', zipFd('a6011ded-AIFI20260827T204145Z1001.zip')));
t('a second review plans NOTHING to store', again?.plan?.counts?.store === 0, JSON.stringify(again?.plan?.counts));
t('...and says "already stored" by name',
  (again?.plan?.skip || []).some(s => s.reason === 'already stored'));
const recommit = await commitAll('a6011ded-AIFI20260827T204145Z1001.zip');
t('a re-commit stores nothing and does not duplicate', recommit.stored === 0, `${recommit.stored}`);
t('coverage is unchanged', (await J(await req('/suppliers/files/coverage')))?.stored === cov.stored);

console.log('\n── a second vendor adds to it, it does not replace ──');
const mh = await commitAll('e67fe1b2-Mill_Haven20260827T204157Z1001.zip');
const cov2 = await J(await req('/suppliers/files/coverage'));
t('the second vendor added documents', cov2.stored > cov.stored, `${cov.stored} → ${cov2.stored}`);
t('the first vendor is still stored', cov2.stored === cov.stored + mh.stored);

console.log('\n── the bytes actually come back ──');
const withFiles = (await J(await req('/suppliers')))?.suppliers?.find(s => /aifi/i.test(s.name));
const detail = await J(await req(`/suppliers/${withFiles.id}`));
const stored = (detail?.files || []).filter(f => f.stored);
t('the detail marks stored files as stored', stored.length > 0, `${stored.length} of ${detail?.files?.length}`);
t('an unstored file is NOT marked stored', (detail?.files || []).some(f => !f.stored) || stored.length === detail.files.length);
const dl = await fetch(`${B}/suppliers/files/${stored[0].id}/download`, { headers: { Authorization: `Bearer ${token}` } });
t('the download answers 200', dl.status === 200, `${dl.status}`);
const bytes = Buffer.from(await dl.arrayBuffer());
t('the download returns real bytes', bytes.length > 100, `${bytes.length}`);
t('the download is named after the document',
  /filename=/.test(dl.headers.get('content-disposition') || ''), dl.headers.get('content-disposition') || '');
t('extracted text is NEVER shipped to the client',
  !JSON.stringify(detail).includes('extracted_text'));

console.log('\n── the documents inside a container zip ──');
// Ten vendors keep their questionnaire inside a zip named after a material.
// The catalogue recurses into those, so the storage walk must too — or a
// document is listed and its bytes can never be attached.
const nested = await J(await req('/suppliers/files/coverage'));
t('nested-zip documents were stored too', nested.stored > 40,
  `${nested.stored} stored — a non-recursing walk stops at about 8`);
t('the catalogue GREW to cover them', nested.total > 722, `${nested.total} catalogued`);

// The preview must predict the adoption, or a plan showing "12 not recognised"
// would be followed by a commit that stored them anyway.
{
  const fresh = await J(await up('/suppliers/files/archive/analyze', zipFd('e67fe1b2-Mill_Haven20260827T204157Z1001.zip')));
  t('a re-review of a stored vendor plans nothing', fresh?.plan?.counts?.store === 0,
    JSON.stringify(fresh?.plan?.counts));
  t('ANALYZE DID NOT CATALOGUE ANYTHING',
    (await J(await req('/suppliers/files/coverage')))?.total === nested.total);
}

console.log('\n── the text inside the PDFs ──');
// Searched, never shipped. extractInvoiceText returns a STRING; reading .text
// off it discarded every word and left every row reading "empty".
{
  const db = new Database(process.env.DBPATH);
  const ok = db.prepare("SELECT COUNT(*) c FROM supplier_files WHERE text_status = 'ok'").get().c;
  const chars = db.prepare('SELECT SUM(LENGTH(extracted_text)) n FROM supplier_files').get().n || 0;
  db.close();
  t('text was extracted from the stored PDFs', ok > 0, `${ok} rows with text`);
  t('...and it is real text, not an empty string', chars > 2000, `${chars} chars`);
}

console.log('\n── a folder the register spells differently ──');
// The archive says "Bio-Cat", the tracker says "Bio-Cat Inc". A fuzzy match is
// NEVER attached — it is named, and linking it is one deliberate act.
{
  const db = new Database(process.env.DBPATH);
  const sup = db.prepare("SELECT id, name FROM suppliers LIMIT 1").get();
  db.close();
  // Build a zip whose folder is a near-miss of a real supplier name.
  const AdmZip = (await import('adm-zip')).default;
  const z = new AdmZip();
  z.addFile(`${sup.name} Inc/2025/Kosher Certificate Exp. 12.31.2027.pdf`, Buffer.from('%PDF-1.4 test'));
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), 'near-miss.zip');
  const nm = await J(await up('/suppliers/files/archive/analyze', fd));
  t('a near-miss folder is NOT attached on a guess', nm?.plan?.counts?.store === 0,
    JSON.stringify(nm?.plan?.counts));
  const sug = (nm?.plan?.suggestions || []).find(g => g.supplier_id);
  t('...it NAMES the supplier it probably belongs to', !!sug && sug.supplier_name === sup.name,
    JSON.stringify(nm?.plan?.suggestions || []).slice(0, 200));

  // Link the name — the deliberate act — and the same zip now lands.
  await req(`/suppliers/${sug.supplier_id}/link-name`, { method: 'POST', body: JSON.stringify({ name: sug.folder }) });
  const fd2 = new FormData();
  fd2.append('files', new Blob([z.toBuffer()]), 'near-miss.zip');
  const after = await J(await up('/suppliers/files/archive/analyze', fd2));
  t('once linked, the SAME zip is recognised', after?.plan?.counts?.store === 1,
    JSON.stringify(after?.plan?.counts));
}

console.log('\n── a Drive zip with a root folder over the vendors ──');
// Exactly the shape Drive produces: everything under one wrapper folder. Both
// readings of the path parse — the wrapper reads as the vendor and the year as
// the period — so the WRONG one names a company that does not exist.
{
  const AdmZip = (await import('adm-zip')).default;
  const db = new Database(process.env.DBPATH);
  const known = db.prepare("SELECT name FROM suppliers WHERE name LIKE 'AIFI%' OR name LIKE 'Mill Haven%'").all();
  db.close();
  const root = 'Supplier Qualification Questionnaire';
  const z = new AdmZip();
  for (const k of known) z.addFile(`${root}/${k.name}/2025/Wrapped ${k.name} Kosher Exp. 12.31.2027.pdf`, Buffer.from('%PDF-1.4 a'));
  // Two files under a folder that is NOT a supplier — these are the ones whose
  // reported name matters.
  z.addFile(`${root}/Nowhere Ingredients/2025/Spec.pdf`, Buffer.from('%PDF-1.4 b'));
  z.addFile(`${root}/Nowhere Ingredients/2025/SDS.pdf`, Buffer.from('%PDF-1.4 c'));
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), `${root}-20260831T214728Z-1-001.zip`);
  const w = await J(await up('/suppliers/files/archive/analyze', fd));
  t('the root folder is stripped and real vendors are found',
    w?.plan?.counts?.store === known.length, JSON.stringify(w?.plan?.counts));
  const folders = (w?.plan?.suggestions || []).map(g => g.folder);
  t('the leftovers are named by their OWN folder, not the zip root',
    folders.includes('Nowhere Ingredients'), JSON.stringify(folders));
  t('...and the zip root is never reported as a company',
    !folders.includes(root), JSON.stringify(folders));
  t('the count under that folder is right',
    (w?.plan?.suggestions || []).find(g => g.folder === 'Nowhere Ingredients')?.files === 2);
}

console.log('\n── the zip in STEP ONE creates the vendors the tracker never had ──');
// 25 folders on the plant's archive have no supplier row, because step one was
// run with the spreadsheet alone. The same zip in step one creates them
// through the normal reconciliation, and then step two matches them.
{
  const AdmZip = (await import('adm-zip')).default;
  const z = new AdmZip();
  z.addFile('Root/Brand New Vendor Co/2025/Kosher Exp. 12.31.2027.pdf', Buffer.from('%PDF-1.4 n'));
  z.addFile('Root/Brand New Vendor Co/2025/SDS.pdf', Buffer.from('%PDF-1.4 m'));
  const before = (await J(await req('/suppliers')))?.suppliers?.length;

  // Step two alone cannot place it — no supplier of that name.
  const fdA = new FormData();
  fdA.append('files', new Blob([z.toBuffer()]), 'archive.zip');
  const only2 = await J(await up('/suppliers/files/archive/analyze', fdA));
  t('step two alone reports the unknown vendor', only2?.plan?.counts?.store === 0
    && (only2?.plan?.suggestions || []).some(g => g.folder === 'Brand New Vendor Co'),
    JSON.stringify(only2?.plan?.suggestions || []));

  // Step one with the SAME zip creates it.
  const fdB = new FormData();
  fdB.append('files', new Blob([z.toBuffer()]), 'archive.zip');
  const imp = await J(await up('/suppliers/import/commit', fdB));
  const after = (await J(await req('/suppliers')))?.suppliers;
  t('the commit answered with a result, and what it says it created is what the register gained',
    imp?.result?.suppliers_created >= 1 && after.length - before === imp.result.suppliers_created,
    `${JSON.stringify(imp?.result)} vs ${before} → ${after.length}`);
  t('step one with the zip created the vendor', after.length > before,
    `${before} → ${after.length}`);
  const made = after.find(x => x.name === 'Brand New Vendor Co');
  t('...and it is NOT qualified', !!made && made.status === 'unqualified', made?.status);

  // Now step two places its documents.
  const fdC = new FormData();
  fdC.append('files', new Blob([z.toBuffer()]), 'archive.zip');
  const now2 = await J(await up('/suppliers/files/archive/analyze', fdC));
  t('step two now recognises the same documents', now2?.plan?.counts?.store === 2,
    JSON.stringify(now2?.plan?.counts));
}

console.log('\n── the zip crosses the wire once, and storing is batched ──');
// The 502: hundreds of sequential uploads in one request is minutes of wall
// time and the proxy closes it, losing the work and forcing the whole zip to
// be sent again.
{
  const AdmZip = (await import('adm-zip')).default;
  const db0 = new Database(process.env.DBPATH);
  const vend = db0.prepare("SELECT name FROM suppliers WHERE name LIKE 'AIFI%'").get().name;
  db0.close();
  const z = new AdmZip();
  for (let i = 0; i < 25; i++) z.addFile(`Wrap/${vend}/2027/Batched ${i} Exp. 12.31.2028.pdf`, Buffer.from(`%PDF-1.4 ${i}`));
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), 'batched.zip');
  const an = await J(await up('/suppliers/files/archive/analyze', fd));
  t('review hands back an id for the held upload', !!an?.upload_id);
  t('review plans all of them', an?.plan?.counts?.store === 25, JSON.stringify(an?.plan?.counts));

  // Store in small passes, sending only the id — no re-upload.
  const pass = async (limit) => {
    const f = new FormData();
    f.append('upload_id', an.upload_id);
    f.append('limit', String(limit));
    return J(await up('/suppliers/files/archive/commit', f));
  };
  const p1 = await pass(10);
  t('a bounded pass stores exactly its limit', p1?.result?.stored === 10, JSON.stringify(p1?.result));
  t('...and reports what is left', p1?.result?.remaining === 15, `${p1?.result?.remaining}`);
  const p2 = await pass(10);
  t('the next pass skips what is stored and does the next ten',
    p2?.result?.stored === 10 && p2?.result?.remaining === 5, JSON.stringify(p2?.result));
  const p3 = await pass(10);
  t('the last pass finishes and reports nothing left',
    p3?.result?.stored === 5 && p3?.result?.remaining === 0, JSON.stringify(p3?.result));
  const p4 = await pass(10);
  t('a pass after the end is refused, not a silent no-op', p4 === null || p4?.error || p4?.result?.stored === 0,
    JSON.stringify(p4).slice(0, 120));
  t('an unknown id is refused', (await (async () => {
    const f = new FormData(); f.append('upload_id', 'nope');
    return (await up('/suppliers/files/archive/commit', f)).status; })()) === 410);
}

console.log('\n── a loose file at the top of the archive ──');
// The one that cost a whole import: step one filed 1,191 documents under a
// single supplier named after the download folder, because one spreadsheet
// sitting at the top of the archive vetoed the wrapper strip for everything.
{
  const AdmZip = (await import('adm-zip')).default;
  const db0 = new Database(process.env.DBPATH);
  const vends = db0.prepare("SELECT name FROM suppliers WHERE name LIKE 'AIFI%' OR name LIKE 'Mill Haven%'").all();
  db0.close();
  const root = 'Supplier Qualification Questionnaire';
  const z = new AdmZip();
  for (const v of vends) {
    z.addFile(`${root}/${v.name}/2029/Loose ${v.name} Kosher Exp. 12.31.2030.pdf`, Buffer.from('%PDF-1.4 x'));
    z.addFile(`${root}/${v.name}/Loose ${v.name} Spec.pdf`, Buffer.from('%PDF-1.4 y'));
  }
  z.addFile(`${root}/Current Suppliers.xlsx`, Buffer.from('loose'));   // under no vendor
  const before = (await J(await req('/suppliers')))?.suppliers?.length;
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), `${root}.zip`);
  const imp = await J(await up('/suppliers/import/commit', fd));
  t('the commit answered with a result and created nothing',
    !!imp?.result && imp.result.suppliers_created === 0, JSON.stringify(imp).slice(0, 160));
  const after = (await J(await req('/suppliers')))?.suppliers;
  t('STEP ONE DOES NOT INVENT A SUPPLIER NAMED AFTER THE DOWNLOAD',
    !after.some(x => x.name === root), after.filter(x => x.name === root).length + ' found');
  t('...and creates no new suppliers for vendors it already knows',
    after.length === before, `${before} → ${after.length}`);
  const fd2 = new FormData();
  fd2.append('files', new Blob([z.toBuffer()]), `${root}.zip`);
  const an2 = await J(await up('/suppliers/files/archive/analyze', fd2));
  t('step two places the documents under the real vendors',
    an2?.plan?.counts?.store === vends.length * 2, JSON.stringify(an2?.plan?.counts));
}

console.log('\n── undoing a mistaken import ──');
{
  const AdmZip = (await import('adm-zip')).default;
  const z = new AdmZip();
  z.addFile('Mistake Co/2025/a.pdf', Buffer.from('%PDF-1.4 q'));
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), 'mistake.zip');
  await up('/suppliers/import/commit', fd);
  const made = (await J(await req('/suppliers')))?.suppliers?.find(x => x.name === 'Mistake Co');
  t('a mistaken supplier exists to remove', !!made);

  const noReason = await req(`/suppliers/${made.id}`, { method: 'DELETE', body: JSON.stringify({}) });
  t('a delete with no reason is refused', noReason.status === 400, `${noReason.status}`);
  const ok = await req(`/suppliers/${made.id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'filed under the download folder by mistake' }) });
  t('an undecided, unstored supplier can be removed', ok.status === 200, `${ok.status}`);
  t('...and it is gone', !(await J(await req('/suppliers')))?.suppliers?.some(x => x.name === 'Mistake Co'));

  // A supplier with documents actually stored is NOT removable.
  const withBytes = (await J(await req('/suppliers')))?.suppliers?.find(x => /aifi/i.test(x.name));
  const refused = await req(`/suppliers/${withBytes.id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'testing the guard' }) });
  t('A SUPPLIER WITH STORED EVIDENCE IS REFUSED', refused.status === 409, `${refused.status}`);
}

console.log('\n── the archive alone is compared against the REGISTER ──');
// Uploading the archive without the tracker left the tracker side empty, so
// every folder read as "a vendor the tracker has never heard of" — 72 of them,
// when 45 were already on the register.
{
  const AdmZip = (await import('adm-zip')).default;
  const db0 = new Database(process.env.DBPATH);
  const known = db0.prepare("SELECT name FROM suppliers WHERE name LIKE 'AIFI%' OR name LIKE 'Mill Haven%'").all();
  db0.close();
  const z = new AdmZip();
  for (const k of known) z.addFile(`Wrap/${k.name}/2031/Reg ${k.name} Exp. 12.31.2032.pdf`, Buffer.from('%PDF-1.4 r'));
  z.addFile('Wrap/Totally Unknown Vendor/2031/Spec.pdf', Buffer.from('%PDF-1.4 s'));
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), 'archive-only.zip');
  const an = await J(await up('/suppliers/import/analyze', fd));
  const unknown = (an?.plan?.reconciliation?.vendors || [])
    .filter(v => v.has_folder && !v.on_tracker).map(v => v.name);
  t('a vendor already on the register is NOT called unknown',
    !known.some(k => unknown.includes(k.name)), JSON.stringify(unknown));
  t('...while a genuinely new folder still is',
    unknown.includes('Totally Unknown Vendor'), JSON.stringify(unknown));
  t('the review says what it compared against',
    (an?.notes || []).some(n => /already on the register/i.test(n)), JSON.stringify(an?.notes));
}

console.log('\n── one company appearing in both lists ──');
// GNT is on the register with no folder; the archive folder is Exberry-GNT.
// matchStrength refuses a three-character name inside another ON PURPOSE, so
// importing would create a SECOND record and split the evidence.
{
  const AdmZip = (await import('adm-zip')).default;
  const db0 = new Database(process.env.DBPATH);
  // Names chosen so nothing earlier in this run can already have created them —
  // the first version of this check used GNT/Exberry-GNT and an earlier section
  // had already imported the folder, so linking was (correctly) refused as a
  // merge and the premise never held.
  db0.prepare("INSERT OR IGNORE INTO suppliers (id, name, actively_using, status) VALUES ('zzq-x','ZZQ',1,'unqualified')").run();
  db0.close();
  const z = new AdmZip();
  z.addFile('Wrap/Alpha-ZZQ/2031/Colour Spec.pdf', Buffer.from('%PDF-1.4 g'));
  z.addFile('Wrap/Some Other Vendor/2031/Spec.pdf', Buffer.from('%PDF-1.4 h'));
  const fd = new FormData();
  fd.append('files', new Blob([z.toBuffer()]), 'pair.zip');
  const an = await J(await up('/suppliers/import/analyze', fd));
  const pair = (an?.plan?.reconciliation?.likely_same || [])
    .find(k => k.archive_folder === 'Alpha-ZZQ');
  t('THE PAIR IS NAMED, not joined automatically', !!pair && pair.on_register === 'ZZQ',
    JSON.stringify(an?.plan?.reconciliation?.likely_same || []));
  t('an unrelated new folder is not paired with anything',
    !(an?.plan?.reconciliation?.likely_same || []).some(k => k.archive_folder === 'Some Other Vendor'));

  // Linking is the deliberate act; afterwards the folder resolves to GNT.
  const lk = await req('/suppliers/link-name-by-name', { method: 'POST',
    body: JSON.stringify({ supplier_name: 'ZZQ', name: 'Alpha-ZZQ' }) });
  t('linking by name succeeds', lk.status === 200, `${lk.status}`);
  const fd2 = new FormData();
  fd2.append('files', new Blob([z.toBuffer()]), 'pair.zip');
  const an2 = await J(await up('/suppliers/import/analyze', fd2));
  t('...and the pair is gone from the review',
    !(an2?.plan?.reconciliation?.likely_same || []).some(k => k.archive_folder === 'Exberry-GNT'));
  t('...and the folder is no longer unknown',
    !(an2?.plan?.reconciliation?.vendors || [])
      .some(v => v.name === 'Exberry-GNT' && (v.issues || []).includes('folder_with_no_tracker_row')));
  const bad = await req('/suppliers/link-name-by-name', { method: 'POST',
    body: JSON.stringify({ supplier_name: 'Nobody At All', name: 'x' }) });
  t('linking to a company not on the register is refused', bad.status === 404, `${bad.status}`);
}

console.log('\n── permissions ──');
const anon = await fetch(`${B}/suppliers/files/archive/commit`, { method: 'POST', body: new FormData() });
t('an unauthenticated archive upload is refused', anon.status === 401 || anon.status === 403, `${anon.status}`);

console.log(`\n${pass} passed, ${fail} failed`);

console.log('\n── the manual door: attach a document to ONE supplier ──');
{
  // The server has had POST /suppliers/:id/files since the archive import
  // shipped; the drawer never called it. This drives it the way the new button
  // does, and asserts the file is catalogued like an archived one.
  const before = await J(await req(`/suppliers/${withFiles.id}`));
  t('the detail says whether the caller may attach', before?.can_edit === true, `can_edit=${before?.can_edit}`);
  const nBefore = (before?.files || []).length;

  const fd = new FormData();
  fd.append('files', new Blob(['%PDF-1.4 questionnaire'], { type: 'application/pdf' }), 'Supplier Questionnaire Exp 12.31.2027.pdf');
  const r = await up(`/suppliers/${withFiles.id}/files`, fd);
  const b = await J(r);
  t('one file attaches', r.ok && b?.saved?.length === 1, `got ${r.status} ${JSON.stringify(b || {}).slice(0, 80)}`);

  const after = await J(await req(`/suppliers/${withFiles.id}`));
  const row = (after?.files || []).find(f => f.filename === 'Supplier Questionnaire Exp 12.31.2027.pdf');
  t('it appears on that supplier, and only that supplier', !!row && (after.files.length === nBefore + 1));
  t('it is STORED, not merely catalogued', !!row?.stored, `stored=${row?.stored}`);
  t('the kind was read from the filename, same as the archive walk', row?.kind === 'questionnaire', `kind=${row?.kind}`);
  t('the expiry was read from the filename', String(row?.expires_on || '').startsWith('2027-12-31'), `expires_on=${row?.expires_on}`);

  // No file at all is refused, not silently accepted.
  const empty = await up(`/suppliers/${withFiles.id}/files`, new FormData());
  t('attaching nothing is refused', empty.status === 400, `got ${empty.status}`);

  // A person outside the edit ladder gets a 403 and — the same fact — no button.
  const d = new Database(process.env.DBPATH);
  d.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('sup-op','Sup Operator','Sup Operator','operator','warehouse',1,'SC-SOP',datetime('now','+7 day'),'{"suppliers":"view"}')`).run();
  d.close();
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'sup-op', password: 'OpSecret2026', setup_code: 'SC-SOP' }) });
  const opTok = (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Sup Operator', password: 'OpSecret2026' }) })))?.token;
  t('the viewer could sign in', !!opTok, 'no token — set-password or login failed');
  const opRes = await fetch(`${B}/suppliers/${withFiles.id}`, { headers: { Authorization: `Bearer ${opTok}` } });
  const opDetail = await J(opRes);
  t('a viewer can READ the supplier', opRes.ok, `got ${opRes.status} ${JSON.stringify(opDetail || {}).slice(0, 80)}`);
  t('and is told they may NOT attach', opDetail?.can_edit === false, `can_edit=${opDetail?.can_edit}`);
  const fd2 = new FormData(); fd2.append('files', new Blob(['x']), 'x.pdf');
  const denied = await fetch(`${B}/suppliers/${withFiles.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${opTok}` }, body: fd2 });
  t('and the server refuses them too', denied.status === 403, `got ${denied.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);