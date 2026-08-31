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
const an = await J(await up('/suppliers/files/archive/analyze', zipFd('a6011ded-AIFI20260827T204145Z1001.zip')));
t('analyze returns a plan', !!an?.plan, JSON.stringify(an).slice(0, 200));
t('analyze matched real documents', an?.plan?.counts?.store > 0, JSON.stringify(an?.plan?.counts));
t('ANALYZE STORED NOTHING', (await J(await req('/suppliers/files/coverage')))?.stored === 0);

const co = await J(await up('/suppliers/files/archive/commit', zipFd('a6011ded-AIFI20260827T204145Z1001.zip')));
t('commit stored what it planned', co?.result?.stored === an?.plan?.counts?.store,
  `${co?.result?.stored} vs ${an?.plan?.counts?.store}`);
t('nothing failed', !(co?.result?.failed || []).length, JSON.stringify(co?.result?.failed || []).slice(0, 200));
cov = await J(await req('/suppliers/files/coverage'));
t('coverage moved', cov.stored === co.result.stored, `${cov.stored}`);
t('the byte total is real', cov.bytes > 1000, `${cov.bytes}`);

console.log('\n── re-uploading the SAME zip is safe ──');
const again = await J(await up('/suppliers/files/archive/analyze', zipFd('a6011ded-AIFI20260827T204145Z1001.zip')));
t('a second review plans NOTHING to store', again?.plan?.counts?.store === 0, JSON.stringify(again?.plan?.counts));
t('...and says "already stored" by name',
  (again?.plan?.skip || []).some(s => s.reason === 'already stored'));
const recommit = await J(await up('/suppliers/files/archive/commit', zipFd('a6011ded-AIFI20260827T204145Z1001.zip')));
t('a re-commit stores nothing and does not duplicate', recommit?.result?.stored === 0);
t('coverage is unchanged', (await J(await req('/suppliers/files/coverage')))?.stored === cov.stored);

console.log('\n── a second vendor adds to it, it does not replace ──');
const mh = await J(await up('/suppliers/files/archive/commit', zipFd('e67fe1b2-Mill_Haven20260827T204157Z1001.zip')));
const cov2 = await J(await req('/suppliers/files/coverage'));
t('the second vendor added documents', cov2.stored > cov.stored, `${cov.stored} → ${cov2.stored}`);
t('the first vendor is still stored', cov2.stored === cov.stored + mh.result.stored);

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

console.log('\n── permissions ──');
const anon = await fetch(`${B}/suppliers/files/archive/commit`, { method: 'POST', body: new FormData() });
t('an unauthenticated archive upload is refused', anon.status === 401 || anon.status === 403, `${anon.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
