// verify:policyacks — a policy sent to people to read and acknowledge (D-169).
//
// What this proves:
//   1. Only a PUBLISHED policy can be sent, to active employees only — a client
//      guest and an auditor pass are refused by name, and "everyone" never reaches them.
//   2. Sent by department + by name in one act; sending again skips who is waiting.
//   3. The person reads it even though it is not "employees can read", and nobody
//      else can open their copy (404).
//   4. Acknowledging needs their own name, the statement and their PASSWORD; it is
//      done once, records the version, and is audited as a verified signature.
//   5. Revising the policy turns an acknowledgement into "an earlier version", and it
//      can be sent again; remind, withdraw (reason required), retire withdraws the rest.
//   6. ReadyBot tells each person once per send and chases on each row's own clock.
//   7. In a real browser: the card, the screen, the password, the card gone; the
//      office's list and send screen; and on a phone at 390px.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5096;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const call = (tok) => (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const DBP = process.env.DBPATH || process.env.DB_PATH;

const { default: Database } = await import('better-sqlite3');
const db = new Database(DBP);
const mk = (id, name, role, dept, extra = '') => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at${extra ? ',is_external' : ''})
  VALUES (?,?,?,?,?,1,'SC-PA',datetime('now','+7 day')${extra ? ',1' : ''})`).run(id, name, name, role, dept);
mk('pa-office', 'Polly Office', 'admin', 'office');
mk('pa-op1', 'Wanda Warehouse', 'operator', 'dockside');
mk('pa-op2', 'Wes Warehouse', 'operator', 'dockside');
mk('pa-qa', 'Quinn Quality', 'supervisor', 'qa');
mk('pa-guest', 'Gina Guest', 'operator', 'dockside', 'ext');
mk('pa-aud', 'Audrey Auditor', 'auditor', 'qa');

const login = async (id, name, pw) => {
  const c = call(null);
  await c('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password: pw, setup_code: 'SC-PA' }) });
  return (await J(await c('/users/login', { method: 'POST', body: JSON.stringify({ name, password: pw }) })))?.token;
};
const officeTok = await login('pa-office', 'Polly Office', 'PollyPW2026!');
const op1Tok = await login('pa-op1', 'Wanda Warehouse', 'WandaPW2026!');
const op2Tok = await login('pa-op2', 'Wes Warehouse', 'WesPW2026!');
t('the office and two operators signed in', !!officeTok && !!op1Tok && !!op2Tok);
const office = call(officeTok), op1 = call(op1Tok), op2 = call(op2Tok);
const post = (c, p, b) => c(p, { method: 'POST', body: JSON.stringify(b || {}) });
const put = (c, p, b) => c(p, { method: 'PUT', body: JSON.stringify(b || {}) });

console.log('\n── sending ──');
const pol = await J(await post(office, '/policies', { title: 'PTO Policy', version: '1', body: 'Request PTO *two weeks* ahead.', visible_to_staff: false }));
let r = await post(office, '/policies/acknowledgements/send', { policy_ids: [pol.id], departments: ['dockside'] });
t('A DRAFT CANNOT BE SENT — only a published policy is a rule', r.status === 409, String(r.status));
await post(office, `/policies/${pol.id}/publish`);

const aud = await J(await office('/policies/acknowledgements/people'));
const names = (aud?.people || []).map(p => p.name);
t('the picker lists employees', names.includes('Wanda Warehouse') && names.includes('Quinn Quality'));
t('…and never a client guest, an auditor pass or ReadyBot',
  !names.includes('Gina Guest') && !names.includes('Audrey Auditor') && !names.includes('ReadyBot'));
t('departments are offered with how many are in each', (aud?.departments || []).some(d => d.value === 'dockside' && d.count === 2));

r = await post(office, '/policies/acknowledgements/send', { policy_ids: [pol.id], departments: ['dockside'], user_ids: ['pa-qa', 'pa-guest'], due_date: '2099-01-01', note: 'Updated rules' });
let sent = await J(r);
t('a department and two names in one act', r.status === 201, String(r.status));
t('THREE PEOPLE: the two in the department and Quinn by name', sent?.people_sent === 3 && sent?.created?.length === 3, JSON.stringify(sent).slice(0, 200));
t('THE GUEST IS REFUSED BY NAME, not silently dropped', (sent?.rejected || []).some(x => x.name === 'Gina Guest'));
t('the warehouse guest was not swept in by the department either', !sent.created.some(c => c.user_id === 'pa-guest'));

sent = await J(await post(office, '/policies/acknowledgements/send', { policy_ids: [pol.id], user_ids: ['pa-op1'] }));
t('sending again to someone already waiting skips them, and says why',
  sent?.created?.length === 0 && (sent.skipped || []).some(x => x.name === 'Wanda Warehouse' && /already waiting/.test(x.why)), JSON.stringify(sent).slice(0, 200));

const dm = db.prepare("SELECT COUNT(*) c FROM chat_messages m JOIN chat_channel_members cm ON cm.channel_id = m.channel_id WHERE cm.user_id = 'pa-op1' AND m.body LIKE '%PTO Policy%' AND m.body LIKE '%acknowledge%'");
await new Promise(res => setTimeout(res, 400));
t('READYBOT TOLD HER, in a DM naming the policy', dm.get().c >= 1, String(dm.get().c));

console.log('\n── the employee ──');
const mine = await J(await op1('/policy-acks/mine'));
const ackId = mine?.pending?.[0]?.id;
t('it is on her own list', mine?.pending?.length === 1 && mine.pending[0].title === 'PTO Policy');
const view = await J(await op1(`/policy-acks/${ackId}`));
t('SHE CAN READ IT although it is not ticked "employees can read" — sending it is showing it', /two weeks/.test(view?.body || ''));
t('the statement names the policy and its version', /PTO Policy \(version 1\)/.test(view?.attestation || ''), view?.attestation);
r = await op2(`/policy-acks/${ackId}`);
t('a colleague cannot open her copy (404, not 403)', r.status === 404, String(r.status));

r = await post(op1, `/policy-acks/${ackId}/sign`, { signed_name: 'Wanda Warehouse', attest: true });
let body = await J(r);
t('IT ASKS FOR HER PASSWORD — 403 signature_required, never 401', r.status === 403 && body?.signature_required === true, `${r.status} ${JSON.stringify(body)}`);
r = await post(op1, `/policy-acks/${ackId}/sign`, { signed_name: 'Someone Else', attest: true, signature_password: 'WandaPW2026!' });
t('somebody else\'s name is refused', r.status === 400);
r = await post(op1, `/policy-acks/${ackId}/sign`, { signed_name: 'Wanda Warehouse', attest: false, signature_password: 'WandaPW2026!' });
t('the statement must be ticked', r.status === 400);
r = await post(op1, `/policy-acks/${ackId}/sign`, { signed_name: 'wanda  warehouse', attest: true, signature_password: 'WandaPW2026!' });
t('with her name, the statement and her password it is acknowledged', r.status === 200, String(r.status));
r = await post(op1, `/policy-acks/${ackId}/sign`, { signed_name: 'Wanda Warehouse', attest: true, signature_password: 'WandaPW2026!' });
t('and only once', r.status === 409);
const audit = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'policy_acknowledgement' AND entity_id = ? AND action = 'sign'").get(ackId);
t('the audit records a verified signature and the version', /signature_verified/.test(audit?.details || '') && /"version":"1"/.test(audit?.details || ''));
t('the password is nowhere in the audit log', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE details LIKE '%WandaPW2026%'").get().c === 0);

console.log('\n── the office follows it ──');
let list = await J(await office(`/policies/${pol.id}/acknowledgements`));
t('1 acknowledged, 2 waiting — and the counts are the rows', list?.counts?.acknowledged === 1 && list?.counts?.pending === 2
  && list.rows.filter(x => x.state === 'pending').length === 2, JSON.stringify(list?.counts));
const listRow = (await J(await office('/policies'))).find(p => p.id === pol.id);
t('the policy row carries "1 of 3 acknowledged"', listRow?.acks?.acknowledged === 1 && listRow?.acks?.sent === 3, JSON.stringify(listRow?.acks));

await put(office, `/policies/${pol.id}`, { version: '2', body: 'Request PTO *three weeks* ahead.' });
list = await J(await office(`/policies/${pol.id}/acknowledgements`));
t('REVISING THE POLICY: her acknowledgement now reads as an earlier version, never as current',
  list.rows.find(x => x.user_id === 'pa-op1')?.state === 'earlier_version', list.rows.find(x => x.user_id === 'pa-op1')?.state);
sent = await J(await post(office, '/policies/acknowledgements/send', { policy_ids: [pol.id], user_ids: ['pa-op1'] }));
t('…and she can be sent version 2', sent?.created?.length === 1);

const waiting = list.rows.find(x => x.user_id === 'pa-qa');
r = await post(office, `/policies/acknowledgements/${waiting.id}/remind`);
t('remind one person', r.status === 200);
r = await post(office, `/policies/acknowledgements/${waiting.id}/cancel`, {});
t('withdrawing needs a reason', r.status === 400);
r = await post(office, `/policies/acknowledgements/${waiting.id}/cancel`, { reason: 'Quinn is on leave' });
t('…and with one it is withdrawn', r.status === 200);
r = await post(office, `/policies/acknowledgements/${ackId}/cancel`, { reason: 'test' });
t('an acknowledgement already given is a record, and is not withdrawn', r.status === 409);
r = await post(op1, '/policies/acknowledgements/send', { policy_ids: [pol.id], everyone: true });
t('an operator cannot send policies', r.status === 403 || r.status === 401, String(r.status));

console.log('\n── the reminder ──');
db.prepare("UPDATE policy_acknowledgements SET sent_at = datetime('now','-3 days'), last_nudge_at = NULL WHERE status = 'pending'").run();
const { policyAckNudges } = await import('../server/policy-acks.js');
const told = [];
const deps = { botDm: () => ({ bot: {}, dm: {} }), postMessageAs: async (_d, _dm, _b, body) => { told.push(body); }, pushToUser: async () => {} };
const n1 = await policyAckNudges(db, deps);
t('pending rows two days old are chased — one message per person', n1.people === told.length && told.length >= 2 && /Still waiting/.test(told[0]), JSON.stringify(n1));
const n2 = await policyAckNudges(db, deps);
t('and not again the next minute — each row has its own clock', n2.pending === 0);

console.log('\n── retiring ──');
const pol2 = await J(await post(office, '/policies', { title: 'Phone Use', body: 'No phones on the line.' }));
await post(office, `/policies/${pol2.id}/publish`);
sent = await J(await post(office, '/policies/acknowledgements/send', { policy_ids: [pol2.id], everyone: true }));
t('EVERYONE reaches every employee and still no guest', sent.created.length === names.length && !sent.created.some(c => c.user_id === 'pa-guest'), `${sent.created.length} vs ${names.length}`);
await post(office, `/policies/${pol2.id}/retire`);
const left = db.prepare("SELECT COUNT(*) c FROM policy_acknowledgements WHERE policy_id = ? AND status = 'pending'").get(pol2.id).c;
t('retiring a policy withdraws what was still waiting on it', left === 0, String(left));

// For the browser half: a fresh policy waiting on Wes (for the phone) and Wanda.
const pol3 = await J(await post(office, '/policies', { title: 'Visitor Rules', version: '3', body: 'Every visitor *signs in* at the lobby.' }));
await post(office, `/policies/${pol3.id}/publish`);
await post(office, '/policies/acknowledgements/send', { policy_ids: [pol3.id], user_ids: ['pa-op1', 'pa-op2'] });

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// Is the element the thing a finger on its centre actually touches?
const onTop = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
});
async function as(tok, user, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 600 });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, user]);
  return page;
}

{
  const page = await as(op1Tok, { id: 'pa-op1', name: 'Wanda Warehouse', role: 'operator', department: 'dockside' }, { width: 1280, height: 850 });
  await page.goto(URL);
  const card = page.locator('[data-policies-to-acknowledge]:visible').first();
  const ok = await card.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  t('THE CARD IS WHERE SHE IS — "Documents to sign" names the policy', ok && /Visitor Rules/.test(await card.innerText()), ok ? (await card.innerText()).slice(0, 120) : 'no card');
  if (ok) {
    await card.locator('[data-policy-ack-open-card]').filter({ hasText: 'Visitor Rules' }).first().click();
    const m = page.locator('[data-policy-ack-modal]');
    await m.waitFor({ timeout: 10000 });
    t('the screen shows the policy itself', /signs in/.test(await m.locator('[data-policy-ack-body]').innerText()));
    t('acknowledge is held until her name and the statement are there', await m.locator('[data-policy-ack-submit]').isDisabled());
    await m.locator('[data-policy-ack-name]').fill('Wanda Warehouse');
    await m.locator('[data-policy-ack-attest]').check();
    await m.locator('[data-policy-ack-submit]').click();
    await page.waitForSelector('[data-signature-prompt] input[type=password]', { timeout: 15000 });
    t('IT ASKS FOR THE PASSWORD BEFORE ANYTHING IS RECORDED', await page.locator('[data-policy-ack-done]').count() === 0);
    t('THE PASSWORD PROMPT IS ON TOP of the acknowledgement window (D-172)', await onTop(page, '[data-signature-prompt] input[type=password]'));
    // A real click, as a person does — fill() + Enter reached a prompt hidden
    // behind the sheet through the focus it was given, which is how this passed
    // while the plant was stuck on "Saving…".
    await page.locator('[data-signature-prompt] input[type=password]').click({ timeout: 5000 });
    await page.keyboard.type('WandaPW2026!');
    await page.locator('[data-signature-prompt] button[type=submit]').click({ timeout: 5000 });
    const done = await page.waitForSelector('[data-policy-ack-done]', { timeout: 15000 }).then(() => true).catch(() => false);
    t('it is acknowledged, and says which version', done && /version 3/.test(await page.locator('[data-policy-ack-done]').innerText()));
    await page.locator('[data-policy-ack-close]').click();
    await page.waitForTimeout(1500);
    const still = await page.locator('[data-policy-ack-open-card]').filter({ hasText: 'Visitor Rules' }).count();
    t('AND IT LEAVES HER CARD', still === 0, String(still));
  }
  await page.close();
}

{
  const page = await as(officeTok, { id: 'pa-office', name: 'Polly Office', role: 'admin', department: 'office' }, { width: 1280, height: 850 });
  await page.goto(`${URL}/?tab=policies`);
  const row = page.locator('button', { hasText: 'Visitor Rules' }).first();
  const ok = await row.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  t('Policies lists it with its progress', ok && /1 of 2 acknowledged/.test(await row.innerText()), ok ? (await row.innerText()).slice(0, 160) : 'no row');
  if (ok) {
    await row.click();
    const list = page.locator('[data-ack-list]');
    await list.waitFor({ timeout: 10000 });
    t('the policy shows who acknowledged and who is waiting',
      await page.locator('[data-ack-row="Wanda Warehouse"][data-ack-state="acknowledged"]').count() === 1
      && await page.locator('[data-ack-row="Wes Warehouse"][data-ack-state="pending"]').count() === 1);
    await page.locator('[data-policy-send-ack]').click();
    const m = page.locator('[data-send-ack-modal]');
    await m.waitFor({ timeout: 10000 });
    await page.waitForSelector('[data-send-ack-dept="dockside"]', { timeout: 10000 });
    t('the send screen starts on this policy', await m.locator('[data-send-ack-policy="Visitor Rules"]').isChecked());
    await m.locator('[data-send-ack-dept="dockside"]').click();
    t('picking a department counts the people it reaches', Number(await m.locator('[data-send-ack-reach]').getAttribute('data-send-ack-reach')) === 2);
    await m.locator('[data-send-ack-submit]').click();
    await page.waitForSelector('[data-send-ack-result]', { timeout: 10000 });
    t('both already handled — nothing re-sent, and the screen says so', /Not sent again/.test(await m.innerText()), (await m.innerText()).slice(0, 200));
  }
  await page.close();
}

{
  const page = await as(op2Tok, { id: 'pa-op2', name: 'Wes Warehouse', role: 'operator', department: 'dockside' }, { width: 390, height: 844 });
  await page.goto(URL);
  const card = page.locator('[data-policies-to-acknowledge]:visible').first();
  const ok = await card.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  t('ON A PHONE the card is on his page, not in a drawer', ok);
  if (ok) {
    await card.locator('[data-policy-ack-open-card]').first().click();
    await page.locator('[data-policy-ack-modal]').waitFor({ timeout: 10000 });
    t('the policy opens full width', await page.locator('[data-policy-ack-body]').isVisible());
    t('no sideways scroll at 390', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    const box = await page.locator('[data-policy-ack-attest]').boundingBox();
    t('ON A PHONE the "I have read this" box is big enough to tap (≥ 24px)', box && box.width >= 23.5 && box.height >= 23.5, JSON.stringify(box));
    await page.locator('[data-policy-ack-name]').fill('Wes Warehouse');
    // Tap the statement's words, not the box — the whole row is the target.
    await page.locator('[data-policy-ack-attest]').locator('xpath=..').locator('span').first().tap();
    t('…and tapping the statement ticks it', await page.locator('[data-policy-ack-attest]').isChecked());
    await page.locator('[data-policy-ack-submit]').tap();
    await page.waitForSelector('[data-signature-prompt] input[type=password]', { timeout: 15000 });
    t('ON A PHONE the password prompt is on top too', await onTop(page, '[data-signature-prompt] input[type=password]'));
    await page.locator('[data-signature-prompt] input[type=password]').tap({ timeout: 5000 });
    await page.keyboard.type('WesPW2026!');
    await page.locator('[data-signature-prompt] button[type=submit]').tap({ timeout: 5000 });
    const done = await page.waitForSelector('[data-policy-ack-done]', { timeout: 15000 }).then(() => true).catch(() => false);
    t('…and he is acknowledged from the phone', done);
  }
  await page.close();
}

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
