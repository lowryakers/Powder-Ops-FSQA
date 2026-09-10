// AP Drop, end to end on a fresh database: anyone can drop, a failed parse
// still files a row, the same bytes twice is a duplicate suspect, only the
// office moves statuses, and the audit log carries ap_drop.created.
// Caller sets PORT + DBPATH + the R2 stand-in.
const PORT = process.env.PORT || 4990; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { default: PDFDocument } = await import('pdfkit');
const db = new Database(process.env.DBPATH);
for (const [id, name, role, dept, code, ma] of [
  ['ap-admin', 'Drop Admin', 'admin', 'office', 'SC-AA', null],
  ['ap-op', 'Line Operator', 'operator', 'production', 'SC-AO', { sanitation: 'view' }],
  ['ap-office', 'Office Super', 'supervisor', 'office', 'SC-AS', { sanitation: 'view' }],
  ['ap-flag', 'Finance Flag', 'operator', 'warehouse', 'SC-AF', { 'ap-drop': 'edit' }],
]) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, ma ? JSON.stringify(ma) : null);
}
const call = async (method, p, body, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id, code) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Drop2026!!', setup_code: code });
  return (await call('POST', '/users/login', { name, password: 'Drop2026!!' })).body?.token;
};
const pdf = (lines) => new Promise(res => {
  const doc = new PDFDocument(); const chunks = [];
  doc.on('data', c => chunks.push(c)); doc.on('end', () => res(Buffer.concat(chunks)));
  lines.forEach(l => doc.text(l)); doc.end();
});
const drop = async (tok, buf, name, fields = {}, type = 'application/pdf') => {
  const fd = new FormData();
  fd.append('files', new Blob([buf], { type }), name);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  const r = await fetch(`${URL}/api/ap-drop`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  return { status: r.status, body: await r.json() };
};

const admin = await signIn('Drop Admin', 'ap-admin', 'SC-AA');
const op = await signIn('Line Operator', 'ap-op', 'SC-AO');
const office = await signIn('Office Super', 'ap-office', 'SC-AS');
const flag = await signIn('Finance Flag', 'ap-flag', 'SC-AF');
t('four people signed in', admin && op && office && flag);

// 1. An operator with no finance grant drops an invoice; it is read and lands as new.
const invoice = await pdf(['Mountain Flavor Supply', '1200 Industrial Way', 'INVOICE', 'Invoice No: MFS-10442', 'Invoice Date: 08/28/2026', 'Due Date: 09/01/2026', 'Bill To: Powder Ops LLC', 'PO # 4471-B', 'Subtotal $824.00', 'Amount Due $873.44']);
let r = await drop(op, invoice, 'mfs-10442.pdf', { notes: 'Came to my inbox by mistake' });
t('operator can drop (201)', r.status === 201, JSON.stringify(r.body).slice(0, 160));
const d1 = r.body?.drops?.[0];
t('the row is new, from the drop door', d1?.status === 'new' && d1?.source === 'drop');
t('reader ran: vendor, number, total, due date', d1?.parse_status === 'ok' && d1?.vendor_name === 'Mountain Flavor Supply' && d1?.invoice_number === 'MFS-10442' && d1?.amount === 873.44 && d1?.due_date === '2026-09-01', JSON.stringify({ v: d1?.vendor_name, n: d1?.invoice_number, a: d1?.amount, due: d1?.due_date, p: d1?.parse_status }));
t('PO reference and bill-to read', d1?.po_or_co_ref === 'PO 4471-B' && /Powder Ops/.test(d1?.bill_to || ''));
t('the note the submitter typed is on the row', d1?.notes === 'Came to my inbox by mistake');
t('the parse carries its evidence lines', d1?.parsed?.evidence?.total === 'Amount Due $873.44');
t('a due date in the past reads as overdue', d1?.overdue === true);

// 2. A typed field is kept; the reader fills blanks only.
r = await drop(op, await pdf(['Acme Packaging', 'Invoice # A-1', 'Total $50.00']), 'acme.pdf', { vendor_name: 'Acme (typed)', amount: '51' });
t('a typed vendor and amount are never overwritten by the reader', r.body?.drops?.[0]?.vendor_name === 'Acme (typed)' && r.body?.drops?.[0]?.amount === 51, JSON.stringify(r.body?.drops?.[0]).slice(0, 160));
t('…while the blank invoice number is filled from the document', r.body?.drops?.[0]?.invoice_number === 'A-1');

// 3. A file nothing can be read from still files a row.
r = await drop(op, Buffer.from('not really a pdf at all'), 'scan.pdf');
const dBad = r.body?.drops?.[0];
t('an unreadable file still creates a row (201)', r.status === 201 && !!dBad?.id);
t('…marked parse failed, status new', dBad?.parse_status === 'failed' && dBad?.status === 'new', `${dBad?.parse_status} ${dBad?.status}`);

// 4. The same bytes again is a duplicate suspect linked to the first.
r = await drop(office, invoice, 'forwarded-again.pdf');
const dDup = r.body?.drops?.[0];
t('the same file dropped again is flagged duplicate_suspect', dDup?.status === 'duplicate_suspect', dDup?.status);
t('…and linked to the earlier row', dDup?.duplicate_of === d1.id);
r = await call('GET', `/ap-drop/${dDup.id}`, null, office);
t('the detail names the earlier drop and its submitter', r.body?.duplicate_of?.id === d1.id && r.body?.duplicate_of?.submitter === 'Line Operator');

// 5. Scope: the operator sees only their own; the office sees everything.
r = await call('GET', '/ap-drop?status=all', null, op);
t('operator lists only their own drops', r.status === 200 && r.body.length === 3 && r.body.every(x => x.submitter === 'Line Operator'), String(r.body?.length));
r = await call('GET', `/ap-drop/${dDup.id}`, null, op);
t("somebody else's drop is 404 to the operator, not 403", r.status === 404);
r = await call('GET', '/ap-drop?status=all', null, office);
t('an office supervisor sees the whole queue without a grant', r.status === 200 && r.body.length === 4);
r = await call('GET', '/ap-drop/meta', null, flag);
t('the ap-drop EDIT grant is the finance flag', r.body?.can_work === true);
r = await call('GET', '/ap-drop/meta', null, op);
t('…and an operator without it is not', r.body?.can_work === false);

// 6. Only the office moves a drop or edits what was read.
r = await call('POST', `/ap-drop/${d1.id}/status`, { status: 'triaged' }, op);
t('operator cannot change status (403)', r.status === 403);
r = await call('PUT', `/ap-drop/${d1.id}`, { vendor_name: 'Nope' }, op);
t('operator cannot edit extracted fields (403)', r.status === 403);
r = await call('POST', `/ap-drop/${d1.id}/notes`, { text: 'Jake said this is for the September run' }, op);
t('operator can add a note to their own drop', r.status === 201);
r = await call('POST', `/ap-drop/${d1.id}/status`, { status: 'needs_info' }, office);
t('needs_info without a reason is refused', r.status === 400 && /why/i.test(r.body?.error || ''));
r = await call('POST', `/ap-drop/${d1.id}/status`, { status: 'needs_info', reason: 'No PO on file for 4471-B' }, office);
t('needs_info with a reason files, reason on the row', r.status === 200 && r.body.status === 'needs_info' && r.body.status_reason === 'No PO on file for 4471-B');
r = await call('GET', '/ap-drop?needs_info=1', null, admin);
t('the needs-info filter finds it', r.body?.length === 1 && r.body[0].id === d1.id);
r = await call('GET', '/ap-drop?overdue=1', null, admin);
t('the overdue filter finds it (due 09/01)', r.body?.some(x => x.id === d1.id));
r = await call('PUT', `/ap-drop/${d1.id}`, { vendor_name: 'Mountain Flavor Supply LLC', amount: '873.44', invoice_date: '2026-08-28' }, flag);
t('the finance flag can correct a field', r.status === 200 && r.body.vendor_name === 'Mountain Flavor Supply LLC');
r = await call('POST', `/ap-drop/${d1.id}/status`, { status: 'in_qbo', reason: 'Bill 1187' }, admin);
t('moved to in_qbo', r.body?.status === 'in_qbo');
r = await call('PUT', `/ap-drop/${d1.id}`, { qbo_bill_id: '1187' }, admin);
t('a QuickBooks bill id can be linked back', r.body?.qbo_bill_id === '1187');
r = await call('POST', `/ap-drop/${d1.id}/status`, { status: 'paid' }, admin);
t('paid stamps closed_at', r.body?.status === 'paid' && !!r.body?.closed_at);
r = await call('GET', '/ap-drop', null, admin);
t('outstanding excludes the paid one', !r.body.some(x => x.id === d1.id) && r.body.length === 3);
r = await call('POST', `/ap-drop/${dBad.id}/status`, { status: 'not_finance', reason: 'It is a shipping label' }, office);
t('not_finance with a reason archives it', r.body?.status === 'not_finance');
r = await call('GET', '/ap-drop', null, admin);
t('outstanding excludes not_finance too', r.body.length === 2);
r = await call('GET', '/ap-drop?status=all', null, admin);
t('"all" shows all four', r.body.length === 4);
r = await call('GET', '/ap-drop/meta', null, admin);
t('meta counts reconcile with the rows', Object.values(r.body.counts).reduce((a, b) => a + b, 0) === 4 && r.body.vendors.includes('Mountain Flavor Supply LLC'));

// 7. Re-read fills blanks only.
r = await call('POST', `/ap-drop/${d1.id}/reparse`, null, admin);
t('re-reading leaves the corrected vendor alone', r.status === 200 && r.body.drop.vendor_name === 'Mountain Flavor Supply LLC', JSON.stringify(r.body).slice(0, 160));

// 8. Activity + audit.
r = await call('GET', `/ap-drop/${d1.id}`, null, admin);
const kinds = (r.body?.events || []).map(e => e.kind);
t('activity log carries upload, parse, note, edits and status moves', ['uploaded', 'parsed', 'note', 'status_changed', 'fields_edited'].every(k => kinds.includes(k)), kinds.join(','));
t('the detail hands back a file url for the preview', typeof r.body?.file_url === 'string' && r.body.file_url.length > 10);
t('extracted text never leaves the server', !('extracted_text' in (r.body || {})) && r.body.searchable === true);
const audit = db.prepare("SELECT action, details FROM audit_log WHERE entity_type = 'ap_drop' AND entity_id = ?").all(d1.id);
t('audit: ap_drop / create with event ap_drop.created', audit.some(a => a.action === 'create' && /ap_drop\.created/.test(a.details || '')), JSON.stringify(audit).slice(0, 200));
t('audit: status moves are their own entries', audit.filter(a => a.action === 'ap_drop_status' || /"to":"paid"/.test(a.details || '')).length >= 1);
r = await call('GET', '/audit?entity_type=ap_drop&action=create', null, admin);
t('automation can poll the audit API for new drops', r.status === 200 && (r.body?.data || []).length >= 4, JSON.stringify(r.body).slice(0, 120));
r = await call('GET', '/ap-drop?q=Industrial', null, admin);
t('search reaches inside the PDF', r.status === 200 && r.body.some(x => x.id === dDup.id));
r = await call('GET', '/ap-drop/recent', null, op);
t('recent for the operator is their own drops', r.body?.length === 3);

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
