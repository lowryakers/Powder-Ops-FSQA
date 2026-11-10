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

// 3b. A photograph of a paper invoice files like a PDF. With no AI reader on
// this server nothing can be read off it, and that is a row reading "failed",
// never a refused upload — the office types what the picture shows.
r = await drop(op, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'invoice-photo.png', { vendor_name: 'Photographed Vendor' }, 'image/png');
t('a photo of a paper invoice files as a drop', r.status === 201 && r.body?.drops?.[0]?.filename === 'invoice-photo.png', JSON.stringify(r.body).slice(0, 120));
t('…keeping the typed vendor, with the reader honest about reading nothing', r.body?.drops?.[0]?.vendor_name === 'Photographed Vendor' && ['failed', 'pending'].includes(r.body?.drops?.[0]?.parse_status), r.body?.drops?.[0]?.parse_status);
const photoId = r.body?.drops?.[0]?.id;

// 4. The same bytes again is a duplicate suspect linked to the first.
r = await drop(office, invoice, 'forwarded-again.pdf');
const dDup = r.body?.drops?.[0];
t('the same file dropped again is flagged duplicate_suspect', dDup?.status === 'duplicate_suspect', dDup?.status);
t('…and linked to the earlier row', dDup?.duplicate_of === d1.id);
r = await call('GET', `/ap-drop/${dDup.id}`, null, office);
t('the detail names the earlier drop and its submitter', r.body?.duplicate_of?.id === d1.id && r.body?.duplicate_of?.submitter === 'Line Operator');

// 5. Scope: the operator sees only their own; the office sees everything.
r = await call('GET', '/ap-drop?status=all', null, op);
t('operator lists only their own drops', r.status === 200 && r.body.length === 4 && r.body.every(x => x.submitter === 'Line Operator'), String(r.body?.length));
r = await call('GET', `/ap-drop/${dDup.id}`, null, op);
t("somebody else's drop is 404 to the operator, not 403", r.status === 404);
r = await call('GET', '/ap-drop?status=all', null, office);
t('an office supervisor sees the whole queue without a grant', r.status === 200 && r.body.length === 5);
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
t('outstanding excludes the paid one', !r.body.some(x => x.id === d1.id) && r.body.length === 4);
r = await call('POST', `/ap-drop/${dBad.id}/status`, { status: 'not_finance', reason: 'It is a shipping label' }, office);
t('not_finance with a reason archives it', r.body?.status === 'not_finance');
r = await call('GET', '/ap-drop', null, admin);
t('outstanding excludes not_finance too', r.body.length === 3);
r = await call('GET', '/ap-drop?status=all', null, admin);
t('"all" shows all five', r.body.length === 5);
r = await call('GET', '/ap-drop/meta', null, admin);
t('meta counts reconcile with the rows', Object.values(r.body.counts).reduce((a, b) => a + b, 0) === 5 && r.body.vendors.includes('Mountain Flavor Supply LLC'));

// 7. Re-read fills blanks only.
r = await call('POST', `/ap-drop/${d1.id}/reparse`, null, admin);
t('re-reading leaves the corrected vendor alone', r.status === 200 && r.body.drop.vendor_name === 'Mountain Flavor Supply LLC', JSON.stringify(r.body).slice(0, 160));

// 8. Activity + audit.
r = await call('GET', `/ap-drop/${photoId}`, null, admin);
t('the photo drop previews as an image (a file url is handed back)', r.status === 200 && typeof r.body?.file_url === 'string' && /invoice-photo\.png/.test(r.body?.filename));
r = await call('GET', `/ap-drop/${d1.id}`, null, admin);
const kinds = (r.body?.events || []).map(e => e.kind);
t('activity log carries upload, parse, note, edits and status moves', ['uploaded', 'parsed', 'note', 'status_changed', 'fields_edited'].every(k => kinds.includes(k)), kinds.join(','));
t('the detail hands back a file url for the preview', typeof r.body?.file_url === 'string' && r.body.file_url.length > 10);
t('extracted text never leaves the server', !('extracted_text' in (r.body || {})) && r.body.searchable === true);
const audit = db.prepare("SELECT action, details FROM audit_log WHERE entity_type = 'ap_drop' AND entity_id = ?").all(d1.id);
t('audit: ap_drop / create with event ap_drop.created', audit.some(a => a.action === 'create' && /ap_drop\.created/.test(a.details || '')), JSON.stringify(audit).slice(0, 200));
t('audit: status moves are their own entries', audit.filter(a => a.action === 'ap_drop_status' || /"to":"paid"/.test(a.details || '')).length >= 1);
r = await call('GET', '/audit?entity_type=ap_drop&action=create', null, admin);
t('automation can poll the audit API for new drops', r.status === 200 && (r.body?.data || []).length >= 5, JSON.stringify(r.body).slice(0, 120));
r = await call('GET', '/ap-drop?q=Industrial', null, admin);
t('search reaches inside the PDF', r.status === 200 && r.body.some(x => x.id === dDup.id));
r = await call('GET', '/ap-drop/recent', null, op);
t('recent for the operator is their own drops', r.body?.length === 4);

// 9. ONE DROP → SCAN → ROUTE. A drop that names M4 becomes a DRAFT on the
// partner ledger with the same file; the drop stays and says so. A mention in
// the body alone is a question, not a draft. Same bytes, or the same number
// and amount, link the document already there rather than filing a second.
const m4 = db.prepare("SELECT id, name FROM partner_accounts WHERE code = 'M4'").get();
t('M4 Dynamics is seeded as the reconciliation partner', !!m4);
const m4Invoice = await pdf(['M4 Dynamic', '88 Formulation Drive', 'INVOICE', 'Invoice No: M4-2210', 'Invoice Date: 09/03/2026', 'Due Date: 10/03/2026', 'Bill To: Powder Ops LLC', 'Amount Due $4,500.00']);
r = await drop(op, m4Invoice, 'm4-2210.pdf');
const dM4 = r.body?.drops?.[0];
t('an M4 invoice drops like any other (201, status new — nothing is auto-approved)', r.status === 201 && dM4?.status === 'new', JSON.stringify(dM4).slice(0, 160));
t('…and is routed: the drop carries the partner document id and the verdict', !!dM4?.partner_document_id && dM4?.partner_route?.confidence === 'high' && dM4?.partner_route?.direction === 'payable' && dM4?.partner_route?.partner?.name === 'M4 Dynamics', JSON.stringify(dM4?.partner_route).slice(0, 200));
let pdoc = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(dM4?.partner_document_id);
t('the partner document is a DRAFT payable with the invoice number, amount and file', pdoc?.status === 'draft' && pdoc?.direction === 'payable' && pdoc?.doc_number === 'M4-2210' && pdoc?.amount === 4500 && pdoc?.filename === 'm4-2210.pdf' && pdoc?.source === 'ap-drop' && !pdoc?.finalized_at, JSON.stringify(pdoc).slice(0, 200));
t('the ledger holds its own copy of the file (a second key, not the drop\'s)', typeof pdoc?.storage_key === 'string' && pdoc.storage_key.startsWith(`partners/${m4.id}/`) && pdoc.storage_key !== dM4.storage_key);
t('the ledger copy is searchable like the drop', /M4-2210/.test(pdoc?.extracted_text || ''));
r = await call('GET', `/ap-drop/${dM4.id}`, null, admin);
t('the drop detail names the ledger document and the partner', r.body?.partner_document?.partner_name === 'M4 Dynamics' && r.body?.partner_document?.status === 'draft' && (r.body?.events || []).some(e => e.kind === 'routed_partner' && e.detail?.created === true));
t('audit: ap_drop.routed, and the partner document\'s own create entry', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'ap_drop' AND entity_id = ? AND details LIKE '%ap_drop.routed%'").get(dM4.id).c === 1 && db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'partner_document' AND entity_id = ? AND action = 'create'").get(pdoc.id).c === 1);
r = await call('GET', `/partners/${m4.id}/documents`, null, admin);
t('it shows on the Partner Reconciliation ledger as a draft', r.status === 200 && (r.body?.documents || []).some(x => x.id === pdoc.id && x.status === 'draft'), JSON.stringify(r.body).slice(0, 160));
r = await call('GET', `/partners/${m4.id}/reconcile`, null, admin);
t('a draft never touches the settlement number', r.status === 200 && r.body?.net_amount === 0, JSON.stringify(r.body).slice(0, 120));
// A normal vendor: nothing.
r = await call('GET', `/ap-drop/${d1.id}`, null, admin);
t('an ordinary vendor\'s drop has no partner document and no verdict', !r.body?.partner_document_id && !r.body?.partner_route);
// Same bytes again: linked, not doubled.
r = await drop(office, m4Invoice, 'm4-forwarded-again.pdf');
const dM4b = r.body?.drops?.[0];
t('the same M4 file again is a duplicate suspect linked to the SAME ledger document', dM4b?.status === 'duplicate_suspect' && dM4b?.partner_document_id === pdoc.id, JSON.stringify({ s: dM4b?.status, p: dM4b?.partner_document_id }));
t('…and the ledger still holds ONE document for it', db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE partner_id = ? AND doc_number = 'M4-2210'").get(m4.id).c === 1);
r = await call('GET', `/ap-drop/${dM4b.id}`, null, admin);
t('the link says how it was found (same file)', (r.body?.events || []).some(e => e.kind === 'routed_partner' && e.detail?.created === false && e.detail?.linked_how === 'same file'));
// Same number and amount already keyed on the ledger by hand, different bytes: linked too.
const fd = new FormData(); fd.append('direction', 'payable'); fd.append('doc_number', 'M4-2299'); fd.append('amount', '750'); fd.append('issued_date', '2026-09-05');
r = await fetch(`${URL}/api/partners/${m4.id}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: fd });
const handKeyed = (await r.json())?.[0];
t('a document keyed by hand on the ledger exists', r.status === 201 && !!handKeyed?.id);
r = await drop(op, await pdf(['M4 Dynamics', 'INVOICE', 'Invoice No: M4-2299', 'Bill To: Powder Ops', 'Amount Due $750.00']), 'm4-2299.pdf');
t('a drop matching that number and amount links to the hand-keyed document rather than doubling it', r.body?.drops?.[0]?.partner_document_id === handKeyed.id && db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE partner_id = ? AND doc_number = 'M4-2299'").get(m4.id).c === 1);
// A mention in the body: a question on the queue, never a draft.
r = await drop(op, await pdf(['Acme Packaging Co', 'INVOICE', 'Invoice No: ACME-91', 'Bill To: Powder Ops LLC', 'Ship To: M4 Dynamics warehouse, Suite 4', 'Amount Due $210.00']), 'acme-91.pdf');
const dLow = r.body?.drops?.[0];
t('a vendor that merely MENTIONS M4 is parked as needs_info "M4 Dynamics partner?"', dLow?.status === 'needs_info' && /^M4 Dynamics partner\?/.test(dLow?.status_reason || '') && dLow?.partner_route?.confidence === 'low', JSON.stringify({ s: dLow?.status, r: dLow?.status_reason }).slice(0, 200));
t('…with no partner document filed', !dLow?.partner_document_id && db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE doc_number = 'ACME-91'").get().c === 0);
r = await call('POST', `/ap-drop/${dLow.id}/route-partner`, {}, op);
t('an operator cannot answer the question (403)', r.status === 403);
r = await call('POST', `/ap-drop/${dLow.id}/route-partner`, {}, office);
t('saying yes WITHOUT a direction is refused — nothing assumes payable (D-160)', r.status === 400 && r.body?.needs_direction === true, JSON.stringify(r.body).slice(0, 160));
r = await call('POST', `/ap-drop/${dLow.id}/route-partner`, { direction: 'payable' }, office);
t('the office saying yes files the draft and moves the drop to triaged', r.status === 200 && r.body?.routed === true && r.body?.created === true && r.body?.drop?.status === 'triaged' && !!r.body?.drop?.partner_document_id, JSON.stringify(r.body).slice(0, 200));
pdoc = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(r.body?.document_id);
t('…as a draft, marked as routed by the office', pdoc?.status === 'draft' && pdoc?.doc_number === 'ACME-91' && (await call('GET', `/ap-drop/${dLow.id}`, null, admin)).body?.partner_route?.forced === true);
r = await call('POST', `/ap-drop/${dLow.id}/route-partner`, { direction: 'payable' }, office);
t('routing it twice is refused (409)', r.status === 409);
// The queue and the vendor filter still reconcile with everything above.
r = await call('GET', '/ap-drop?status=all', null, admin);
t('"all" now shows every drop including the routed ones', r.body.length === 9, String(r.body?.length));


// ── D-160: receivables leave AP, the direction is asked, terms beat a bad due
// date, a near-duplicate is flagged, our own letterhead is the vendor ────────
console.log('\n── D-160 ──');
const audits = (id, ev) => db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'ap_drop' AND entity_id = ? AND details LIKE ?").get(id, `%${ev}%`).c;
const events = (id, kind) => db.prepare('SELECT COUNT(*) c FROM ap_drop_events WHERE drop_id = ? AND kind = ?').get(id, kind).c;
const outstandingIds = async () => (await call('GET', '/ap-drop', null, admin)).body.map(x => x.id);
const m4terms = db.prepare("SELECT terms_days FROM partner_accounts WHERE id = ?").get(m4.id).terms_days;
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// 1. Our own invoice to M4: a receivable, handed to Partner Recon, gone from AP.
const ourInv = ['Powder Ops LLC', '1150 W 2700 S', 'USA', 'INVOICE', 'Invoice No: I-7001', 'Invoice Date: 09/24/2026', 'Bill To: M4 Dynamics', 'Amount Due $2,100.00'];
r = await drop(office, await pdf(ourInv), 'i-7001.pdf');
const dAr = r.body?.drops?.[0];
t('1 our own invoice reads the Powder Ops letterhead as the vendor, flagged ours', dAr?.vendor_name === 'Powder Ops LLC' && dAr?.parsed?.fields?.vendor_ours === true, dAr?.vendor_name);
let ardoc = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(dAr?.partner_document_id);
t('1 it is a DRAFT RECEIVABLE on the M4 ledger', ardoc?.direction === 'receivable' && ardoc?.status === 'draft' && ardoc?.doc_number === 'I-7001', JSON.stringify(ardoc && { d: ardoc.direction, s: ardoc.status }));
t('1 the drop moved to to_partner_ar, terminal, with the ledger number in the reason', dAr?.status === 'to_partner_ar' && /^Receivable — on M4 Dynamics ledger as I-7001/.test(dAr?.status_reason || '') && dAr?.outstanding === false && !!dAr?.closed_at, JSON.stringify({ s: dAr?.status, r: dAr?.status_reason }));
t('1 one auto status_changed event and ONE audit row (ap_drop.to_partner_ar)', events(dAr.id, 'status_changed') === 1 && audits(dAr.id, 'ap_drop.to_partner_ar') === 1);
t('1 it is not in AP Outstanding', !(await outstandingIds()).includes(dAr.id));
r = await call('GET', '/ap-drop?status=to_partner_ar', null, admin);
t('1 the "Receivables → Partner Recon" filter lists it', r.body.some(x => x.id === dAr.id));
r = await call('POST', `/ap-drop/${dAr.id}/reparse`, null, admin);
t('1 routing again (a re-read) writes no second event or audit', r.status === 200 && events(dAr.id, 'status_changed') === 1 && audits(dAr.id, 'ap_drop.to_partner_ar') === 1 && r.body?.drop?.status === 'to_partner_ar');
r = await call('POST', `/ap-drop/${dAr.id}/status`, { status: 'to_partner_ar', reason: 'by hand' }, admin);
t('1 to_partner_ar cannot be picked by hand (only routing sets it)', r.status === 400);
// Linking the document already there gives the same result.
r = await drop(office, await pdf([...ourInv, 'Thank you']), 'i-7001-resent.pdf');
const dAr2 = r.body?.drops?.[0];
t('1 the same invoice resent (different bytes) LINKS the ledger document and also leaves AP', dAr2?.partner_document_id === ardoc.id && dAr2?.status === 'to_partner_ar' && db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE doc_number = 'I-7001'").get().c === 1, JSON.stringify({ s: dAr2?.status, p: dAr2?.partner_document_id }));
// A human terminal status is left alone.
db.prepare("UPDATE ap_drops SET status = 'closed', partner_document_id = NULL WHERE id = ?").run(dAr2.id);
r = await call('POST', `/ap-drop/${dAr2.id}/reparse`, null, admin);
t('1 a drop a person closed is not moved by routing', r.body?.drop?.status === 'closed', r.body?.drop?.status);

// 2. Unclear direction: asked, never filed as payable.
r = await drop(op, await pdf(['INVOICE', 'Invoice No: X-55', 'Amount Due $300.00']), 'm4-scan-0917.pdf');
const dQ = r.body?.drops?.[0];
t('2 a partner document with no direction parks as needs_info "Receivable or payable? (M4 Dynamics)"', dQ?.status === 'needs_info' && /^Receivable or payable\? \(M4 Dynamics\)/.test(dQ?.status_reason || ''), JSON.stringify({ s: dQ?.status, r: dQ?.status_reason }));
t('2 …with no partner document and a needs_direction event', !dQ?.partner_document_id && db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE doc_number = 'X-55'").get().c === 0 && events(dQ.id, 'needs_direction') === 1);
r = await call('POST', `/ap-drop/${dQ.id}/route-partner`, {}, office);
t('2 route-partner without a direction → 400', r.status === 400 && r.body?.needs_direction === true);
r = await call('POST', `/ap-drop/${dQ.id}/route-partner`, { direction: 'sideways' }, office);
t('2 a direction that is neither → 400', r.status === 400);
r = await call('POST', `/ap-drop/${dQ.id}/route-partner`, { direction: 'receivable' }, office);
const qdoc = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(r.body?.document_id);
t('2 with "receivable" → a receivable draft and the drop leaves AP (to_partner_ar)', r.status === 200 && qdoc?.direction === 'receivable' && r.body?.drop?.status === 'to_partner_ar', JSON.stringify({ st: r.status, d: qdoc?.direction, s: r.body?.drop?.status }));

// 3. I136: a due date before the issue date. Typed by a person, so it is kept
// on the drop; the ledger copy takes M4's terms, and says so.
const i136 = ['Powder Ops LLC', '1150 W 2700 S', 'USA', 'INVOICE', 'Invoice No: I136', 'Invoice Date: 09/24/2026', 'Due Date: 05/26/2026', 'Bill To: M4 Dynamics', 'Amount Due $1,051.92'];
r = await drop(office, await pdf(i136), 'I136.pdf', { due_date: '2026-05-26' });
const dI = r.body?.drops?.[0];
const idoc = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(dI?.partner_document_id);
t('3 I136: the vendor is Powder Ops, never "USA"', dI?.vendor_name === 'Powder Ops LLC', dI?.vendor_name);
t('3 I136: the typed due date stays on the drop', dI?.due_date === '2026-05-26');
t(`3 I136: the ledger due date is issue + ${m4terms} days`, idoc?.issued_date === '2026-09-24' && idoc?.due_date === plusDays('2026-09-24', m4terms), JSON.stringify({ i: idoc?.issued_date, d: idoc?.due_date }));
const dc = db.prepare("SELECT detail FROM ap_drop_events WHERE drop_id = ? AND kind = 'due_date_corrected'").get(dI.id);
t('3 I136: a due_date_corrected event names parsed, used and the terms', !!dc && JSON.parse(dc.detail).parsed === '2026-05-26' && JSON.parse(dc.detail).used === idoc?.due_date && JSON.parse(dc.detail).terms_days === m4terms);
r = await drop(office, await pdf(['Powder Ops LLC', 'INVOICE', 'Invoice No: I137', 'Invoice Date: 09/24/2026', 'Due Date: 05/26/2026', 'Bill To: M4 Dynamics', 'Amount Due $90.00']), 'I137.pdf');
const dI2 = r.body?.drops?.[0];
t('3 a PRINTED due date before the issue date is not applied to the drop, with a parse note', dI2?.due_date == null && /before the invoice date/.test((dI2?.parsed?.notes || []).join()), JSON.stringify({ d: dI2?.due_date, n: dI2?.parsed?.notes }));

// 4. Jake's pair: $7,464.34 then $7,464.49 on PO-01231, four minutes apart.
const jake = (amt, head = 'M4 Dynamic') => pdf([head, 'INVOICE', 'Invoice No: M4-3301', 'Invoice Date: 09/23/2026', 'Bill To: Powder Ops LLC', `Amount Due $${amt}`]);
r = await drop(office, await jake('7,464.34'), 'po-01231.pdf', { po_or_co_ref: 'PO-01231' });
const j1 = r.body?.drops?.[0];
db.prepare("UPDATE ap_drops SET created_at = datetime('now', '-4 minutes') WHERE id = ?").run(j1.id);
r = await drop(office, await jake('7,464.49', 'M4 Dynamics Inc'), 'po-01231 (1).pdf', { po_or_co_ref: 'PO 01231'.replace(' ', '-') });
const j2 = r.body?.drops?.[0];
t('4 the first of Jake\'s pair is routed as usual', !!j1?.partner_document_id);
t('4 the second is duplicate_suspect, linked to the first, reason names both amounts and the gap', j2?.status === 'duplicate_suspect' && j2?.duplicate_of === j1.id
  && new RegExp(`^Near-duplicate of ${j1.id.slice(0, 8)}: same ref, \\$7464\\.34 vs \\$7464\\.49, 4 min apart`).test(j2?.status_reason || ''), JSON.stringify({ s: j2?.status, r: j2?.status_reason }));
t('4 matched on the PARTNER (the vendor lines differ: "M4 Dynamic" vs "M4 Dynamics Inc")', j1?.vendor_name !== j2?.vendor_name);
t('4 the second is NOT routed — one document on the ledger', !j2?.partner_document_id && db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE doc_number = 'M4-3301'").get().c === 1 && events(j2.id, 'near_duplicate') === 1);
// Controls: none of these is flagged.
const acme = (amt, inv) => pdf(['Acme Films Co', 'INVOICE', `Invoice No: ${inv}`, 'Bill To: Powder Ops LLC', `Amount Due $${amt}`]);
const pair = async (a1, a2, ref1, ref2, hoursApart = 0) => {
  const x = (await drop(office, await acme(a1, `A-${ref1}-1`), `a-${ref1}-1.pdf`, { po_or_co_ref: ref1 })).body.drops[0];
  if (hoursApart) db.prepare('UPDATE ap_drops SET created_at = datetime(\'now\', ?) WHERE id = ?').run(`-${hoursApart} hours`, x.id);
  const y = (await drop(office, await acme(a2, `A-${ref2}-2`), `a-${ref2}-2.pdf`, { po_or_co_ref: ref2 })).body.drops[0];
  return [x, y];
};
let [x, y] = await pair('100.00', '100.80', 'PO-02000', 'po 02000'.replace(' ', '-'));
t('4 same vendor, same ref (case-insensitive), 80¢ apart → flagged', y.status === 'duplicate_suspect' && y.duplicate_of === x.id, y.status);
[x, y] = await pair('100.00', '102.00', 'PO-02001', 'PO-02001');
t('4 control: $2 apart → not flagged', y.status === 'new', y.status);
[x, y] = await pair('200.00', '200.10', 'PO-02002', 'PO-02002', 25);
t('4 control: 25 hours apart → not flagged', y.status === 'new', y.status);
[x, y] = await pair('300.00', '300.00', 'PO-02003', 'PO-020031');
t('4 control: a different ref (one a prefix of the other) → not flagged', y.status === 'new', y.status);
t('4 nothing is deleted: both of Jake\'s rows and files are still there', db.prepare('SELECT COUNT(*) c FROM ap_drops WHERE id IN (?, ?)').get(j1.id, j2.id).c === 2);
r = await call('POST', `/ap-drop/${j2.id}/route-partner`, { direction: 'payable' }, office);
t('4 confirming the second without saying it is a separate document is refused: same number, different amount (400)', r.status === 400 && !!r.body?.possible_duplicate, JSON.stringify(r.body).slice(0, 120));
r = await call('POST', `/ap-drop/${j2.id}/route-partner`, { direction: 'payable', confirm_new_document: true }, office);
t('4 the office can still confirm the second (route-partner, "file as a separate document") — a deliberate act', r.status === 200 && r.body?.drop?.status === 'triaged', JSON.stringify(r.body).slice(0, 120));

// 5. A payable is unchanged end to end: still on the AP track.
r = await call('GET', `/ap-drop/${dM4.id}`, null, admin);
t('5 an M4 bill to us stays payable, status new, in Outstanding', r.body?.status === 'new' && r.body?.partner_document?.direction === 'payable' && (await outstandingIds()).includes(dM4.id));
r = await call('POST', `/ap-drop/${dM4.id}/status`, { status: 'in_qbo', reason: 'Bill 2210' }, admin);
t('5 …and moves to in_qbo as before', r.body?.status === 'in_qbo');

// 6. "Not AP: this is a receivable" for a customer who is not a partner.
r = await call('POST', `/ap-drop/${x.id}/receivable-other`, {}, office);
t('6 receivable_other needs a reason (400)', r.status === 400);
r = await call('POST', `/ap-drop/${x.id}/receivable-other`, { reason: 'x' }, op);
t('6 an operator cannot (not theirs: 404)', r.status === 404 || r.status === 403);
r = await call('POST', `/ap-drop/${x.id}/receivable-other`, { reason: 'Gym client owes us for samples' }, office);
t('6 with a reason: terminal, out of Outstanding, one audit row', r.status === 200 && r.body?.status === 'receivable_other' && r.body?.outstanding === false && audits(x.id, 'ap_drop.receivable_other') === 1 && !(await outstandingIds()).includes(x.id));
r = await call('POST', `/ap-drop/${dM4.id}/receivable-other`, { reason: 'not really' }, office);
t('6 refused on a drop that is on the partner ledger (409)', r.status === 409);

// 8. Invoice numbers folded on the link (INV-1589 = 1589), the amount must
// agree, and Paid waits for a Partner Rec settlement. Fixtures only.
{
  const { classify, normDocNumber } = await import('../server/partner-recon.js');
  const addDoc = (pid, num, amount, extra = {}) => {
    const id = `fx-${num}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO partner_documents (id, partner_id, direction, doc_type, doc_number, amount, status, issued_date, terms_days, due_date, source, created_by, settlement_id)
      VALUES (?,?,?,'invoice',?,?,?,?,30,?,?,'fixture',?)`).run(id, pid, extra.direction || 'payable', num, amount, extra.status || 'final',
      '2026-09-01', '2026-10-01', extra.source || 'partner-portal', extra.settlement_id || null);
    return id;
  };
  const count = (pid, key) => db.prepare('SELECT doc_number FROM partner_documents WHERE partner_id = ? AND status != \'void\'').all(pid)
    .filter(x => normDocNumber(x.doc_number) === key).length;
  const m4drop = async (num, amount, name) => (await drop(op, await pdf(['M4 Dynamics', '88 Formulation Drive', 'INVOICE', `Invoice No: ${num}`, 'Invoice Date: 09/30/2026', 'Bill To: Powder Ops LLC', `Amount Due $${amount}`]), name)).body?.drops?.[0];

  const portal1589 = addDoc(m4.id, '1589', 43582.34);
  const a = await m4drop('INV-1589', '43,582.34', 'INV-1589 (1).pdf');
  t('8.1 a drop read as INV-1589 links the portal document 1589 (same amount) — no second document', a?.invoice_number === 'INV-1589' && a?.partner_document_id === portal1589 && count(m4.id, '1589') === 1, JSON.stringify({ n: a?.invoice_number, p: a?.partner_document_id, c: count(m4.id, '1589') }));
  t('8.1 …the link says it was found by number and amount', events(a.id, 'routed_partner') === 1 && db.prepare("SELECT detail FROM ap_drop_events WHERE drop_id = ? AND kind = 'routed_partner'").get(a.id).detail.includes('same number and amount'));
  t('8.1 …and the stored numbers are not rewritten', db.prepare('SELECT doc_number FROM partner_documents WHERE id = ?').get(portal1589).doc_number === '1589' && a.invoice_number === 'INV-1589');

  const portal1600 = addDoc(m4.id, '1600', 1200);
  // The reader does not read "Invoice #1600" as a number, so the office types it
  // on a drop the reader did not route, then routes it by hand.
  let b2 = (await drop(op, await pdf(['Some Stationer', 'INVOICE', 'Bill To: Powder Ops LLC', 'Amount Due $1,200.00']), 'stationer.pdf')).body?.drops?.[0];
  await call('PUT', `/ap-drop/${b2.id}`, { invoice_number: 'Invoice #1600', amount: '1200' }, office);
  b2 = (await call('POST', `/ap-drop/${b2.id}/route-partner`, { direction: 'payable', partner_id: m4.id }, office)).body?.drop;
  t('8.2 "Invoice #1600" links 1600', b2?.partner_document_id === portal1600 && count(m4.id, '1600') === 1, JSON.stringify({ n: b2?.invoice_number, p: b2?.partner_document_id }));
  const portal1601 = addDoc(m4.id, '1601', 990);
  const b3 = await m4drop('01601', '990.00', 'inv-01601.pdf');
  t('8.3 "01601" (leading zero) links 1601', b3?.partner_document_id === portal1601 && count(m4.id, '1601') === 1, JSON.stringify({ n: b3?.invoice_number, p: b3?.partner_document_id }));

  const other = 'fx-partner-b';
  db.prepare("INSERT OR IGNORE INTO partner_accounts (id, name, code, terms_days) VALUES (?, 'Other Partner Co', 'OPC', 30)").run(other);
  const b1777 = addDoc(other, '1777', 500);
  const c = await m4drop('INV-1777', '500.00', 'inv-1777.pdf');
  t('8.4 another partner\'s 1777 is never linked: M4 gets its own draft, the other ledger is untouched', !!c?.partner_document_id && c.partner_document_id !== b1777 && count(other, '1777') === 1 && count(m4.id, '1777') === 1, JSON.stringify({ p: c?.partner_document_id }));

  const before1589 = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(portal1589);
  const dDiff = await m4drop('INV-1589', '100.00', 'inv-1589-wrong.pdf');
  t('8.5 same number, different amount: not linked, and no second document filed', !dDiff?.partner_document_id && count(m4.id, '1589') === 1, JSON.stringify({ p: dDiff?.partner_document_id, c: count(m4.id, '1589') }));
  t('8.5 …the drop says so: needs_info "Possible duplicate", the conflict on its verdict, one event', dDiff?.status === 'needs_info' && /^Possible duplicate: M4 Dynamics already has invoice #1589/.test(dDiff?.status_reason || '') && dDiff?.partner_route?.number_conflict?.document_id === portal1589 && events(dDiff.id, 'possible_number_duplicate') === 1, JSON.stringify({ s: dDiff?.status, r: dDiff?.status_reason }));
  t('8.5 …and the ledger row is unchanged', JSON.stringify(db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(portal1589)) === JSON.stringify(before1589));
  r = await call('POST', `/ap-drop/${dDiff.id}/route-partner`, { direction: 'payable' }, office);
  t('8.5 routing it by hand is refused the same way (400, names the document)', r.status === 400 && r.body?.possible_duplicate?.document_id === portal1589 && count(m4.id, '1589') === 1);
  r = await call('PUT', `/ap-drop/${dDiff.id}`, { amount: '43582.34' }, office);
  r = await call('POST', `/ap-drop/${dDiff.id}/route-partner`, { direction: 'payable' }, office);
  t('8.5 corrected to the right amount, it links the one already there', r.status === 200 && r.body?.created === false && r.body?.document_id === portal1589 && count(m4.id, '1589') === 1, JSON.stringify(r.body).slice(0, 160));
  const dSep = await m4drop('INV-1600', '50.00', 'inv-1600-credit.pdf');
  r = await call('POST', `/ap-drop/${dSep.id}/route-partner`, { direction: 'payable', confirm_new_document: true }, office);
  t('8.5 "File as a separate document" is the office\'s deliberate act: a second draft, not final', r.status === 200 && r.body?.created === true && count(m4.id, '1600') === 2 && db.prepare('SELECT status FROM partner_documents WHERE id = ?').get(r.body.document_id).status === 'draft');

  t('8.6 the exact-string M4-2299 and same-bytes links still hold', db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE partner_id = ? AND doc_number = 'M4-2299'").get(m4.id).c === 1 && db.prepare("SELECT COUNT(*) c FROM partner_documents WHERE partner_id = ? AND doc_number = 'M4-2210'").get(m4.id).c === 1);

  const plain = await drop(op, await pdf(['Mountain Flavor Supply', 'INVOICE', 'Invoice No: MFS-20001', 'Bill To: Powder Ops LLC', 'Amount Due $12.00']), 'mfs-20001.pdf');
  r = await call('POST', `/ap-drop/${plain.body.drops[0].id}/status`, { status: 'paid' }, admin);
  t('8.7 a drop that is not on a partner ledger is still marked paid, closed_at stamped', r.status === 200 && r.body?.status === 'paid' && !!r.body?.closed_at);

  const settlementsBefore = db.prepare('SELECT COUNT(*) c FROM partner_settlements').get().c;
  const paidEventsBefore = db.prepare("SELECT COUNT(*) c FROM ap_drop_events WHERE drop_id = ? AND kind = 'status_changed'").get(a.id).c;
  const statusBefore = db.prepare('SELECT status FROM ap_drops WHERE id = ?').get(a.id).status;
  r = await call('POST', `/ap-drop/${a.id}/status`, { status: 'paid', reason: 'September settlement' }, admin);
  t('8.8 Paid on a drop routed to an unsettled ledger document is refused (409, points at Partner Rec)', r.status === 409 && r.body?.code === 'SETTLE_ON_PARTNER_REC' && /Partner Reconciliation/.test(r.body?.error || '') && r.body?.partner_document_id === portal1589 && r.body?.partner_id === m4.id, JSON.stringify(r.body).slice(0, 200));
  t('8.8 …nothing moved: status, settlement_id, settlements, events', db.prepare('SELECT status FROM ap_drops WHERE id = ?').get(a.id).status === statusBefore
    && db.prepare('SELECT settlement_id FROM partner_documents WHERE id = ?').get(portal1589).settlement_id === null
    && db.prepare('SELECT COUNT(*) c FROM partner_settlements').get().c === settlementsBefore
    && db.prepare("SELECT COUNT(*) c FROM ap_drop_events WHERE drop_id = ? AND kind = 'status_changed'").get(a.id).c === paidEventsBefore);
  r = await call('POST', `/ap-drop/${a.id}/status`, { status: 'in_qbo', reason: 'Bill 1589' }, admin);
  t('8.8 other moves on a routed drop are unchanged (in_qbo)', r.status === 200 && r.body?.status === 'in_qbo');
  t('8.10 classify() still counts the ledger document: the AP Drop status means nothing to it', classify(db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(portal1589), '2026-12-31').included === true);

  db.prepare("INSERT INTO partner_settlements (id, partner_id, period_end, owed_to, status) VALUES ('fx-settle-1', ?, '2026-10-31', 'them', 'open')").run(m4.id);
  db.prepare("UPDATE partner_documents SET settlement_id = 'fx-settle-1' WHERE id = ?").run(portal1589);
  r = await call('POST', `/ap-drop/${a.id}/status`, { status: 'paid', reason: 'Settled on Partner Rec' }, admin);
  t('8.9 once the ledger document is settled, Paid on the drop is housekeeping (200) and writes no settlement', r.status === 200 && r.body?.status === 'paid' && db.prepare('SELECT settlement_id FROM partner_documents WHERE id = ?').get(portal1589).settlement_id === 'fx-settle-1');

  // Partner Rec: two FINAL unsettled documents with one folded number + amount → the read-only list.
  addDoc(m4.id, '2001', 77.5); addDoc(m4.id, 'INV-2001', 77.5); addDoc(m4.id, 'INV-2001', 78);
  r = await call('GET', `/partners/${m4.id}/documents`, null, admin);
  const twin = (r.body?.open_twins || []).find(g => g.number === '2001');
  t('8.11 Partner Rec lists 2001 and INV-2001 at the same amount as possibly on the ledger twice (not the 78.00 one)', twin?.documents?.length === 2 && twin.documents.every(x => x.amount === 77.5), JSON.stringify(r.body?.open_twins));
}

// 7. The Controller's contract: one ap_drop.created per drop, shape unchanged.
const created = db.prepare("SELECT action, details FROM audit_log WHERE entity_type = 'ap_drop' AND details LIKE '%ap_drop.created%'").all();
const nDrops = db.prepare('SELECT COUNT(*) c FROM ap_drops').get().c;
t('7 one ap_drop.created audit row per drop, action create', created.length === nDrops && created.every(a => a.action === 'create'), `${created.length} vs ${nDrops}`);
t('7 …with exactly the keys it always had', created.every(a => JSON.stringify(Object.keys(JSON.parse(a.details)).sort()) === JSON.stringify(['duplicate_of', 'event', 'filename', 'sha256', 'size', 'status'])), created[0]?.details);


// 9. The email door (D-333): source=email records the message; the same
// message + the same file is a no-op; a different message is still a duplicate.
{
  const rows = () => db.prepare('SELECT COUNT(*) c FROM ap_drops').get().c;
  const auditCreates = (id) => db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'ap_drop' AND entity_id = ? AND details LIKE '%ap_drop.created%'").get(id).c;
  const evCount = (id, kind) => db.prepare('SELECT COUNT(*) c FROM ap_drop_events WHERE drop_id = ? AND kind = ?').get(id, kind).c;
  const mailA = await pdf(['Sierra Packaging Co', 'INVOICE', 'Invoice No: SPC-7781', 'Bill To: Powder Ops LLC', 'Amount Due $1,240.00']);
  const mailB = await pdf(['Sierra Packaging Co', 'INVOICE', 'Invoice No: SPC-7782', 'Bill To: Powder Ops LLC', 'Amount Due $310.00']);
  const MSG = '<CAF+abc123@mail.gmail.com>';
  const em = { source: 'email', email_message_id: `  ${MSG} `, email_from: 'avery@sierrapack.example', email_subject: 'Invoice SPC-7781' };

  let e1 = await drop(op, mailA, 'spc-7781.pdf', em);
  const m1 = e1.body?.drops?.[0];
  t('9.1 source=email files a new drop (201) from the email door, the message id normalised', e1.status === 201 && m1?.source === 'email' && m1?.status === 'new'
    && m1?.email_message_id === 'CAF+abc123@mail.gmail.com' && m1?.email_from === 'avery@sierrapack.example' && m1?.email_subject === 'Invoice SPC-7781', JSON.stringify(m1).slice(0, 200));
  const before = rows();
  const parsesBefore = evCount(m1.id, 'parsed') + evCount(m1.id, 'parse_failed');
  let e2 = await drop(op, mailA, 'spc-7781-again.pdf', { ...em, email_message_id: 'CAF+abc123@mail.gmail.com' });
  t('9.2 the same message + the same file again returns the SAME drop (200, reused), no second row', e2.status === 200 && e2.body?.drops?.[0]?.id === m1.id && e2.body?.drops?.[0]?.reused === true && rows() === before, `${e2.status} rows ${before}->${rows()}`);
  t('9.2 …no second ap_drop.created, no second upload or read event', auditCreates(m1.id) === 1 && evCount(m1.id, 'uploaded') === 1 && evCount(m1.id, 'parsed') + evCount(m1.id, 'parse_failed') === parsesBefore);
  let e3 = await drop(op, mailB, 'spc-7782.pdf', em);
  const m3 = e3.body?.drops?.[0];
  t('9.3 the same message + a different file is a new drop, not a duplicate', e3.status === 201 && m3?.id !== m1.id && m3?.source === 'email' && m3?.email_message_id === m1.email_message_id && m3?.status !== 'duplicate_suspect'
    && db.prepare('SELECT COUNT(*) c FROM ap_drops WHERE email_message_id = ?').get(m1.email_message_id).c === 2);
  let e4 = await drop(op, mailA, 'fwd-spc-7781.pdf', { ...em, email_message_id: '<other-message@mail.example>' });
  const m4d = e4.body?.drops?.[0];
  t('9.4 the same file from a DIFFERENT message is still filed as duplicate_suspect, linked to the first (Jake forwarding)', e4.status === 201 && m4d?.status === 'duplicate_suspect' && m4d?.duplicate_of === m1.id);
  let e4b = await drop(op, mailA, 'spc-7781-hand.pdf', {});
  t('9.4 …and dropped by hand with no message id, the same', e4b.status === 201 && e4b.body?.drops?.[0]?.status === 'duplicate_suspect' && e4b.body?.drops?.[0]?.source === 'drop' && e4b.body?.drops?.[0]?.email_message_id === null);
  let e5 = await drop(op, mailB, 'not-email.pdf', { email_message_id: 'ignored@x', email_from: 'x@y' });
  t('9.5 email fields without source=email are ignored: a plain drop', e5.status === 201 && e5.body?.drops?.[0]?.source === 'drop' && e5.body?.drops?.[0]?.email_message_id === null && e5.body?.drops?.[0]?.email_from === null);
  const mailC = await pdf(['Sierra Packaging Co', 'INVOICE', 'Invoice No: SPC-7790', 'Amount Due $55.00']);
  let e6 = await drop(op, mailC, 'blank-id.pdf', { source: 'email', email_message_id: '   ', email_from: 'avery@sierrapack.example' });
  let e6b = await drop(op, mailC, 'blank-id-2.pdf', { source: 'email', email_message_id: '' });
  t('9.6 source=email with a blank message id files (stored as null), and the same file again is a duplicate, not a silent no-op',
    e6.status === 201 && e6.body?.drops?.[0]?.email_message_id === null && e6.body?.drops?.[0]?.source === 'email'
    && e6b.status === 201 && e6b.body?.drops?.[0]?.status === 'duplicate_suspect' && e6b.body?.drops?.[0]?.id !== e6.body?.drops?.[0]?.id);
  const n7 = rows();
  let e7 = await drop(op, mailC, 'fax.pdf', { source: 'fax' });
  t('9.7 an unknown source is 400 and files nothing', e7.status === 400 && rows() === n7);
  let g = await call('GET', '/ap-drop?status=all', null, admin);
  const listed = (g.body?.drops || g.body || []).find?.(x => x.id === m1.id);
  t('9.8 the list carries source and the three email fields', listed?.source === 'email' && listed?.email_message_id === 'CAF+abc123@mail.gmail.com' && listed?.email_from === 'avery@sierrapack.example' && listed?.email_subject === 'Invoice SPC-7781', JSON.stringify(listed || g.body).slice(0, 160));
  g = await call('GET', `/ap-drop/${m1.id}`, null, admin);
  const one = g.body?.drop || g.body;
  t('9.8 …and so does GET /ap-drop/:id', one?.source === 'email' && one?.email_message_id === 'CAF+abc123@mail.gmail.com' && 'email_subject' in (one || {}));
  const plain = await call('GET', `/ap-drop/${d1.id}`, null, admin);
  t('9.8 …a drop-door row reads null for them', (plain.body?.drop || plain.body)?.email_from === null);
  // A token whose account works the queue (ap-drop edit) can already write
  // qbo_bill_id: PUT /ap-drop/:id is on WRITE_AREAS and EDITABLE has it.
  const minted = (await call('POST', '/api-tokens', { user_id: 'ap-flag', label: 'Controller (verify)', scopes: ['read', 'write'] }, admin)).body?.plaintext;
  let pq = await call('PUT', `/ap-drop/${m3.id}`, { qbo_bill_id: 'QBO-2210' }, minted);
  t('9.9 a write token on a queue account sets qbo_bill_id', !!minted && pq.status === 200 && (pq.body?.drop || pq.body)?.qbo_bill_id === 'QBO-2210', `${pq.status} ${JSON.stringify(pq.body).slice(0, 120)}`);
  pq = await call('POST', `/ap-drop/${m3.id}/status`, { status: 'in_qbo' }, minted);
  t('9.9 …and with the bill id stored, moves it to in_qbo (D-335)', pq.status === 200 && (pq.body?.drop || pq.body)?.status === 'in_qbo', `${pq.status} ${JSON.stringify(pq.body).slice(0, 120)}`);
  const stAt = (id) => db.prepare('SELECT status, qbo_bill_id FROM ap_drops WHERE id = ?').get(id);
  const stBefore = stAt(m1.id);
  pq = await call('POST', `/ap-drop/${m1.id}/status`, { status: 'in_qbo', qbo_bill_id: '   ' }, minted);
  t('9.10 a token in_qbo with no bill id (blank counts) is 400 and changes nothing', pq.status === 400 && pq.body?.code === 'QBO_BILL_ID_REQUIRED' && JSON.stringify(stAt(m1.id)) === JSON.stringify(stBefore), `${pq.status} ${JSON.stringify(pq.body).slice(0, 120)}`);
  pq = await call('POST', `/ap-drop/${m1.id}/status`, { status: 'in_qbo', qbo_bill_id: ' QBO-3301 ' }, minted);
  t('9.10 …with qbo_bill_id in the body it is 200 and the id is stored', pq.status === 200 && stAt(m1.id).status === 'in_qbo' && stAt(m1.id).qbo_bill_id === 'QBO-3301', `${pq.status} ${JSON.stringify(stAt(m1.id))}`);
  pq = await call('POST', `/ap-drop/${m3.id}/status`, { status: 'triaged' }, minted);
  pq = await call('POST', `/ap-drop/${m3.id}/status`, { status: 'in_qbo', qbo_bill_id: '' }, minted);
  t('9.10 a blank body id never clears a stored one', pq.status === 200 && stAt(m3.id).qbo_bill_id === 'QBO-2210', JSON.stringify(stAt(m3.id)));
  for (const st of ['paid', 'closed']) {
    pq = await call('POST', `/ap-drop/${m3.id}/status`, { status: st }, minted);
    t(`9.10 a token move to ${st} is still 403 token_denied`, pq.status === 403 && pq.body?.error === 'token_denied' && stAt(m3.id).status === 'in_qbo', `${pq.status} ${JSON.stringify(pq.body).slice(0, 100)}`);
  }
  pq = await call('POST', `/ap-drop/${d1.id}/status`, { status: 'in_qbo' }, admin);
  t('9.10 a person\'s session may still mark in_qbo without a bill id', pq.status === 200, `${pq.status}`);
}

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
