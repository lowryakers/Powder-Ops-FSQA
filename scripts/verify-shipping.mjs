// Executed, not asserted: the Shipping Truck Inspection end to end — numbering,
// answers saved as tapped, the QA escalation firing on the triggering answer,
// photographs through an S3 stand-in, and the sign-off gate's three refusals.
const B = `http://localhost:${process.env.PORT || 4969}/api`;
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
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('shp-wh', 'Ship Loader', 'operator', 'warehouse', '{"receiving-log":"edit"}');
  mk('shp-qa-adam', 'Adam Shipping', 'supervisor', 'qa', '{"receiving-log":"view"}');
  mk('shp-op', 'Ship Bystander', 'operator', 'batching', '{"production-log":"view"}');
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
token = await login('shp-wh', 'Ship Loader', 'LoaderSecret2026');
t('warehouse loader signed in', !!token);

console.log('\n── the form ──');
const form = await J(await req('/shipping/inspection/form'));
t('the form serves three sections', form?.sections?.length === 3, JSON.stringify(form?.sections?.map(s => s.key)));
t('it declares itself a DRAFT with no form number', form.revision === 'DRAFT-1' && form.form_code === null && /Draft/.test(form.note));
t('every escalation goes to QA', form.sections.flatMap(s => s.items).filter(i => i.notify).every(i => i.notify.target === 'shipping_qa')
  && form.sections.flatMap(s => s.items).filter(i => i.notify).length === 3);

console.log('\n── numbering ──');
const next0 = await J(await req('/shipping/next-shipment-no'));
t('the first number is S-100-0001', next0.shipment_no === 'S-100-0001', next0.shipment_no);
const s1 = await J(await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({}) }));
t('starting issues that number', s1.shipment_no === 'S-100-0001');
t('the record is stamped DRAFT-1', s1.checklist_revision === 'DRAFT-1');
const s1again = await J(await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({ shipment_no: 'S-100-0001', customer: 'Costco DC' }) }));
t('the same number is get-or-create, not a duplicate', s1again.id === s1.id && s1again.customer === 'Costco DC');
const next1 = await J(await req('/shipping/next-shipment-no'));
t('the next number advances', next1.shipment_no === 'S-100-0002');
const recvNext = await J(await req('/receiving/next-inspection-no'));
t("receiving's A-100 series is untouched by a shipping number", recvNext.inspection_no === 'A-100-0001', recvNext.inspection_no);

console.log('\n── answers and escalation ──');
const a1 = await J(await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({ shipment_no: 'S-100-0001', answers: { trailer_intact: 'yes', trailer_clean: 'yes', nonsense: 'yes', pest_evidence: 'maybe' } }) }));
t('answers save as tapped', a1.answers.trailer_intact === 'yes' && a1.answers.trailer_clean === 'yes');
t('an unknown item and an off-vocabulary answer are dropped, not stored', !('nonsense' in a1.answers) && !('pest_evidence' in a1.answers));
t('nothing escalated yet', a1.escalations.length === 0 && a1.notifications.length === 0);
const a2 = await J(await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({ shipment_no: 'S-100-0001', answers: { product_damaged: 'yes' } }) }));
t('a damaged load is a derived escalation', a2.escalations.length === 1 && a2.escalations[0].key === 'product_damaged');
t('…and it was SENT to QA automatically on the answer', a2.notifications.length === 1 && a2.notifications[0].to.includes('Adam Shipping') && a2.notifications[0].auto === true, JSON.stringify(a2.notifications));
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const dm = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channel_members cm ON cm.channel_id = m.channel_id
    WHERE cm.user_id = 'shp-qa-adam' AND m.body LIKE '%S-100-0001%' ORDER BY m.created_at DESC LIMIT 1`).get();
  t('the DM names the shipment and the shipping form, not the receiving one', !!dm && /Shipping Truck Inspection/.test(dm.body) && /Shipment held/.test(dm.body), dm?.body?.slice(0, 120));
  t('the DM deep-links to the shipping view', !!dm && /view=shipping&shipment=S-100-0001/.test(dm.body));
  db.close();
}
const a3 = await J(await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({ shipment_no: 'S-100-0001', answers: { product_damaged: 'no' } }) }));
t('correcting the answer withdraws the escalation (derived, not stored)', a3.escalations.length === 0);
t('…but the notification that went out stays on the record', a3.notifications.length === 1);
const manual = await req('/shipping/inspection/S-100-0001/notify', { method: 'POST', body: JSON.stringify({ item: 'product_damaged' }) });
t('a manual notify the answers do not support is refused', manual.status === 409, `${manual.status}`);

console.log('\n── sign-off gate ──');
const r1 = await req('/shipping/inspection/S-100-0001/review', { method: 'POST', body: '{}' });
const r1b = await J(r1);
t('refused while questions are blank, naming them', r1.status === 400 && Array.isArray(r1b.unanswered) && r1b.unanswered.length > 0);
const allYes = Object.fromEntries(form.sections.flatMap(s => s.items).map(i => [i.key, 'yes']));
const filled = { ...allYes, pest_evidence: 'no', prior_load_residue: 'no', product_damaged: 'no', temperature_ok: 'na', allergen_segregation: 'na', seal_applied: 'yes' };
await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({ shipment_no: 'S-100-0001', answers: filled }) });
const r2 = await req('/shipping/inspection/S-100-0001/review', { method: 'POST', body: '{}' });
const r2b = await J(r2);
t('refused when photos are claimed but none are attached', r2.status === 400 && r2b.photo_claim_unsupported === true, JSON.stringify(r2b));
const insp = await J(await req('/shipping/inspection/S-100-0001'));
t('the record itself reports the unsupported photo claim', insp.inspection.photo_claim_unsupported === true);

console.log('\n── photos ──');
const fd = new FormData();
fd.append('photos', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'load-front.png');
fd.append('photos', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'load-back.png');
fd.append('caption', 'Before doors closed');
const withPhotos = await J(await up('/shipping/inspection/S-100-0001/photos', fd));
t('two photos attached', withPhotos?.photos?.length === 2, JSON.stringify(withPhotos?.photos));
t('the claim is now supported', withPhotos.photo_claim_unsupported === false);
t('a photo carries who took it and the caption', withPhotos.photos[0].uploaded_by === 'Ship Loader' && withPhotos.photos[0].caption === 'Before doors closed');
const url = await J(await req(`/shipping/photos/${withPhotos.photos[0].id}/url`));
t('a photo resolves to a URL and the bytes come back', typeof url?.url === 'string' && (await (await fetch(url.url)).arrayBuffer()).byteLength === 8);
const list = await J(await req('/shipping/inspections'));
t('the list carries the photo count', list.find(r => r.shipment_no === 'S-100-0001')?.photo_count === 2);

const r3 = await J(await req('/shipping/inspection/S-100-0001/review', { method: 'POST', body: '{}' }));
t('signed off once everything is answered and evidenced', !!r3.reviewed_at && r3.reviewed_by === 'Ship Loader', JSON.stringify(r3).slice(0, 120));
const late = await up('/shipping/inspection/S-100-0001/photos', (() => { const f = new FormData(); f.append('photos', new Blob(['x'], { type: 'image/png' }), 'late.png'); return f; })());
t('a photo cannot be added to a signed-off inspection', late.status === 409, `${late.status}`);
const delPhoto = await req(`/shipping/photos/${withPhotos.photos[0].id}`, { method: 'DELETE' });
t('nor removed from one', delPhoto.status === 409, `${delPhoto.status}`);
const edit = await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({ shipment_no: 'S-100-0001', customer: 'Someone else' }) });
t('nor can the record be edited', edit.status === 409, `${edit.status}`);
const rev = await J(await req('/shipping/inspection/S-100-0001/review', { method: 'DELETE' }));
t('the signer can revoke', rev?.ok === true);
const after = await J(await req('/shipping/inspection/S-100-0001'));
t('…and the record is open again with its photos intact', !after.inspection.reviewed_at && after.inspection.photos.length === 2);

console.log('\n── the door ──');
const saved = token;
token = await login('shp-op', 'Ship Bystander', 'ByeSecret2026');
const denied = await req('/shipping/inspection', { method: 'POST', body: JSON.stringify({}) });
t('someone without the Receiving Log cannot start a shipping inspection', denied.status === 403 || denied.status === 401, `${denied.status}`);
token = saved;

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
