// A client joins by link, and reaches exactly one channel — executed against a
// live server on a fresh database.
//
// Two halves, and the second is the one that was asked for.
//
// THE LINK: a text, one tap, a password, in. Single use, fourteen days,
// hashed, revocable, and only ever issued for an account with no password —
// because a link that can set a password on an account that already has one is
// a takeover for whoever holds the text.
//
// THE BOUNDARY: `EXTERNAL_ALLOWED` in middleware/auth.js already keeps a client
// out of every module. What it does NOT do is stop them opening a second
// channel, inviting whoever they like into it, or starting a direct message
// with any plant account whose id they read off their own channel's member
// list — and those ids are right there in `GET /channels/:id`. Every assertion
// below the "outside the channel" heading is one of those doors.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4988;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
const call = (p, { method = 'GET', body, token } = {}) => fetch(B + p, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const open = (ro = false) => new Database(process.env.DBPATH, ro ? { readonly: true } : {});

// An admin, a colleague, and a person from another company.
{
  const db = open();
  const mk = (id, name, role, dept, ext) => db.prepare(
    `INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,module_access,setup_code,setup_code_expires_at)
     VALUES (?,?,?,?,?,1,?,NULL,?,datetime('now','+7 day'))`).run(id, name, id, role, dept, ext, 'SC-' + id);
  mk('ci-admin', 'Ci Admin', 'admin', 'office', 0);
  mk('ci-plant', 'Ci Colleague', 'supervisor', 'production', 0);
  mk('ci-client', 'Ci Client (M4)', 'operator', 'client', 1);
  mk('ci-client2', 'Ci Second Client (M4)', 'operator', 'client', 1);
  db.close();
}
await call('/users/login', { method: 'POST', body: { name: 'Ci Admin' } });
await call('/users/set-password', { method: 'POST', body: { user_id: 'ci-admin', password: 'Invite2026!', setup_code: 'SC-ci-admin' } });
const admin = await J(await call('/users/login', { method: 'POST', body: { name: 'Ci Admin', password: 'Invite2026!' } }));
t('signed in as an admin', !!admin?.token);
const A = admin.token;

// The client channel and a plant channel, so "only the one channel" has
// something to be measured against.
const client = await J(await call('/comms/channels', { method: 'POST', token: A, body: { name: 'client--m4test', kind: 'private' } }));
const plant = await J(await call('/comms/channels', { method: 'POST', token: A, body: { name: 'batching-test', kind: 'public' } }));
t('a client channel and a plant channel exist', !!client?.id && !!plant?.id, JSON.stringify({ c: client?.id, p: plant?.id }).slice(0, 120));
await call(`/comms/channels/${client.id}/members`, { method: 'POST', token: A, body: { user_ids: ['ci-client', 'ci-client2', 'ci-plant'] } });

console.log('\nThe number is taken when the account is created');
{
  // The Add User form has asked for a mobile since the SMS work shipped and the
  // create handler dropped it on the floor — so adding somebody with a number
  // took two saves, and anybody who did not notice had nobody they could text.
  const made = await J(await call('/users', { method: 'POST', token: A, body: { name: 'Ci Phone Test', role: 'operator', department: 'warehouse', phone: '(801) 555-0142' } }));
  t('POST /users keeps the number, as ten digits', made?.phone === '8015550142', String(made?.phone));
  t('AND DOES NOT OPEN THE TEXTING GRANT — that is a separate, deliberate act',
    !made?.sms_access, String(made?.sms_access));
}

console.log('\nIssuing a join link');
let url = null, token = null;
{
  const r = await J(await call('/users/ci-client/invite', { method: 'POST', token: A, body: { to: null } }));
  t('the link is issued', !!r?.url && /\/join\//.test(r.url), JSON.stringify(r).slice(0, 140));
  t('it names the one channel they were added to, so the page can say so', r.channel === 'client--m4test', String(r.channel));
  t('it states fourteen days', r.expires_in_days === 14, String(r.expires_in_days));
  t('and with no number and no Twilio it is handed back to send by hand, not failed',
    r.sent === false && !!r.url);
  url = r.url; token = url.split('/join/')[1];

  const db = open(true);
  const row = db.prepare('SELECT * FROM user_invites WHERE user_id = ?').get('ci-client');
  db.close();
  t('THE TOKEN IS STORED AS A HASH AND NEVER IN CLEAR', !!row && row.token_hash !== token && row.token_hash.length === 64);
  t('and the roster reports the state, never the link', await (async () => {
    const list = await J(await call('/users', { token: A }));
    const u = list.find(x => x.id === 'ci-client');
    return u?.invite_state === 'live' && !JSON.stringify(u).includes(token);
  })());
}

console.log('\nThe text itself');
{
  const { inviteMessage, inviteSegments } = await import('../server/user-invites.js');
  const msg = inviteMessage({ name: 'Ci Client (M4)', channelLabel: 'client--m4test', url });
  t('it names the person and what the link does', /Ci, join client--m4test/.test(msg), msg.slice(0, 90));
  t('it states both limits — once, and fourteen days', /works once/i.test(msg) && /14 days/.test(msg));
  t('IT CARRIES THE OPT-OUT LINE — we started this message, to somebody who has consented to nothing',
    /Reply STOP to opt out/.test(msg), msg);
  // A long multi-segment message carrying a URL is the shape carriers filter,
  // and this message is a sentence and a URL. Measured, not hoped for.
  const seg = inviteSegments(msg);
  t('and it sends as two GSM-7 segments, not four of UCS-2',
    seg.encoding === 'GSM-7' && seg.segments <= 2, JSON.stringify(seg));
}

console.log('\nThe page it opens says who it is for and nothing else');
{
  const info = await J(await call(`/join/${token}`));
  t('it greets them by name', info?.ok === true && info.name === 'Ci Client (M4)', JSON.stringify(info).slice(0, 140));
  t('it names the channel', info.channel === 'client--m4test');
  t('IT SAYS NOTHING ABOUT THE PLANT — no modules, no roster, no members',
    !('module_access' in info) && !('members' in info) && !('users' in info), Object.keys(info).join(','));
}

console.log('\nIssuing a second link retires the first');
{
  const again = await J(await call('/users/ci-client/invite', { method: 'POST', token: A }));
  const old = await J(await call(`/join/${token}`));
  t('the old link is refused, and SAYS it was withdrawn rather than "invalid"',
    old?.ok === false && /withdrawn/i.test(old.reason), old?.reason);
  t('the new one works', (await J(await call(`/join/${again.url.split('/join/')[1]}`)))?.ok === true);
  url = again.url; token = again.url.split('/join/')[1];
}

console.log('\nSetting the password');
let clientToken = null;
{
  const short = await call(`/join/${token}`, { method: 'POST', body: { password: 'abc' } });
  t('a password under eight characters is refused', short.status === 400);
  const r = await call(`/join/${token}`, { method: 'POST', body: { password: 'ClientPass2026!' } });
  const d = await J(r);
  t('the right one is accepted and signs them straight in', r.ok && !!d?.token, JSON.stringify(d).slice(0, 120));
  clientToken = d.token;
  t('and they are the person the link named', d.user?.id === 'ci-client');
  t('THE LINK IS SPENT — a text forwarded on, or read off a lock screen next week, is dead',
    (await J(await call(`/join/${token}`)))?.ok === false);
  const second = await call(`/join/${token}`, { method: 'POST', body: { password: 'Somebody2026!' } });
  t('and it cannot set a second password', second.status === 400);
  t('the refusal says it was already used, so the office knows to reset instead',
    /already been used/i.test((await J(await call(`/join/${token}`)))?.reason || ''));
}

console.log('\nAn account that already has a password is never sent one');
{
  const r = await call('/users/ci-client/invite', { method: 'POST', token: A });
  const d = await J(r);
  t('THE BUTTON IS REFUSED — a link onto a live account is a takeover for whoever holds the text',
    r.status === 400 && /already has a password/i.test(d.error || ''), d?.error);
  t('and it names the way round it: reset the password first', /reset the password/i.test(d.error || ''));
}

console.log('\nExpiry and revocation are separate answers');
{
  const r = await J(await call('/users/ci-client2/invite', { method: 'POST', token: A }));
  const tk = r.url.split('/join/')[1];
  const db = open();
  db.prepare("UPDATE user_invites SET expires_at = datetime('now','-1 day') WHERE user_id = 'ci-client2'").run();
  db.close();
  const d = await J(await call(`/join/${tk}`));
  t('an expired link says EXPIRED, not "not recognised"', d?.ok === false && /expired/i.test(d.reason), d?.reason);
  const r2 = await J(await call('/users/ci-client2/invite', { method: 'POST', token: A }));
  const tk2 = r2.url.split('/join/')[1];
  await call('/users/ci-client2/invite', { method: 'DELETE', token: A });
  const d2 = await J(await call(`/join/${tk2}`));
  t('a withdrawn one says WITHDRAWN', d2?.ok === false && /withdrawn/i.test(d2.reason), d2?.reason);
  t('and an invented token says it is not recognised', /not recognised/i.test((await J(await call('/join/deadbeef')))?.reason || ''));
}

console.log('\n── The client reaches their one channel, and nothing else ──');
{
  const C = clientToken;
  const chans = await J(await call('/comms/channels', { token: C }));
  t('they see exactly one channel', Array.isArray(chans) && chans.length === 1, JSON.stringify((chans || []).map(c => c.name)));
  t('and it is the one they were added to', chans[0]?.name === 'client--m4test');
  t('THE BOOT AUTO-JOIN DID NOT PUT THEM IN #general (D-080)',
    !chans.some(c => /general|announcements/.test(c.name || '')));

  t('a module is 404, not 403 — they learn nothing about what this plant runs',
    (await call('/production/entries', { token: C })).status === 404);
  t('so is the roster', (await call('/users', { token: C })).status === 404);
  t('and so is the plant channel they are not in',
    (await call(`/comms/channels/${plant.id}/messages`, { token: C })).status === 404);
}

console.log('\nAnd cannot reach outside it. This is the half EXTERNAL_ALLOWED did not cover.');
{
  const C = clientToken;
  const posted = await (async () => {
    const r = await call(`/comms/channels/${client.id}/messages`, { method: 'POST', token: C, body: { body: 'Order 4471 confirmed.' } });
    t('they CAN say something in their own channel — the whole point', r.ok);
    return (await J(r))?.id;
  })();
  t('and the message really is theirs to work with', !!posted, String(posted));

  t('THEY CANNOT OPEN A CHANNEL',
    (await call('/comms/channels', { method: 'POST', token: C, body: { name: 'm4-side-room' } })).status === 404);
  t('THEY CANNOT INVITE ANYBODY, even into their own channel',
    (await call(`/comms/channels/${client.id}/members`, { method: 'POST', token: C, body: { user_ids: ['ci-plant'] } })).status === 404);

  // Their own channel's member list hands them Lowry's, Adam's and Jake's ids.
  // That is how this door was reachable at all.
  const detail = await J(await call(`/comms/channels/${client.id}`, { token: C }));
  const colleague = (detail?.members || []).find(m => m.user_id === 'ci-plant');
  t('they can read their channel roster (they are in it with those people)', !!colleague);
  t('THEY CANNOT DIRECT-MESSAGE SOMEBODY WHOSE ID THEY READ OFF IT',
    (await call('/comms/dm/ci-plant', { method: 'POST', token: C })).status === 404);
  t('nor open a group DM', (await call('/comms/dm', { method: 'POST', token: C, body: { user_ids: ['ci-plant'] } })).status === 404);
  t('nor rename the channel out of the family', (await call(`/comms/channels/${client.id}`, { method: 'PUT', token: C, body: { name: 'm4' } })).status === 404);
  t('nor turn a message into plant work', (await call(`/comms/channels/${client.id}/to-task`, { method: 'POST', token: C, body: { title: 'Run it' } })).status === 404);
  t('nor file a compliance record', (await call(`/comms/messages/${posted}/to-record`, { method: 'POST', token: C, body: { type: 'deviation' } })).status === 404);
  t('nor forward anything out of the channel', (await call(`/comms/messages/${posted}/forward`, { method: 'POST', token: C, body: { channel_id: plant.id } })).status === 404);

  // Verified against the real list, not by reading it: whatever is not GET and
  // not on EXTERNAL_MAY_WRITE is refused. This is what makes the allow list the
  // mechanism rather than the comment.
  t('an invented comms write is refused too — the list is an ALLOW list',
    (await call('/comms/sections', { method: 'POST', token: C, body: { name: 'x' } })).status === 404);
}

console.log('\nThe plant side of the same rules');
{
  t('A COLLEAGUE CANNOT DM THE CLIENT EITHER, and is told where it belongs', await (async () => {
    const r = await call('/comms/dm/ci-client', { method: 'POST', token: A });
    const d = await J(r);
    return r.status === 400 && /belongs in their channel/i.test(d?.error || '');
  })());
  t('an external account cannot be added to a plant channel by hand', await (async () => {
    const r = await call(`/comms/channels/${plant.id}/members`, { method: 'POST', token: A, body: { user_ids: ['ci-client'] } });
    const d = await J(r);
    return r.status === 400 && /another company/i.test(d?.error || '');
  })());
  t('and they really were not added', await (async () => {
    const db = open(true);
    const n = db.prepare('SELECT COUNT(*) c FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(plant.id, 'ci-client').c;
    db.close(); return n === 0;
  })());
  t('a colleague CAN still be added to a plant channel — nothing else narrowed',
    (await call(`/comms/channels/${plant.id}/members`, { method: 'POST', token: A, body: { user_ids: ['ci-plant'] } })).ok);
  t('and a colleague can still DM a colleague', (await call('/comms/dm/ci-plant', { method: 'POST', token: A })).ok);
}

console.log('\nThe company is a column, not a suffix on the name');
{
  // The first client accounts were created as "Matt (M4 Dynamic)" to tell them
  // from the plant's own Matt. Right instinct, wrong place: `users.name` is
  // what a person signs in with, and `deriveUsername` takes the first and last
  // WORD — so that account's sign-in name was `Matt Dynamic)`.
  const { repairClientAccountNames } = await import('../server/client-channel-seed.js');
  const { deriveUsername } = await import('../server/usernames.js');
  t('CONTROL: the old shape really did derive a broken sign-in name',
    deriveUsername('Matt (M4 Dynamic)') === 'Matt Dynamic)', deriveUsername('Matt (M4 Dynamic)'));

  const db = open();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,module_access)
    VALUES ('ci-org','Zed (Acme Foods)',?,'operator','client',1,1,NULL)`).run(deriveUsername('Zed (Acme Foods)'));
  // A plant employee with a parenthesis is NOT an outside account and is not
  // this repair's business.
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,module_access)
    VALUES ('ci-inside','Bob (nights)','Bob (nights)','operator','production',1,0,NULL)`).run();
  // And a client whose shortened name is already taken must not create an
  // ambiguity — two people answering to one sign-in is worse than an ugly name.
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,module_access)
    VALUES ('ci-dupe','Ci Admin (Acme Foods)','Ci Dupe','operator','client',1,1,NULL)`).run();
  const out = repairClientAccountNames(db);
  const zed = db.prepare("SELECT * FROM users WHERE id = 'ci-org'").get();
  const inside = db.prepare("SELECT * FROM users WHERE id = 'ci-inside'").get();
  const dupe = db.prepare("SELECT * FROM users WHERE id = 'ci-dupe'").get();
  t('the person keeps their name', zed.name === 'Zed', zed.name);
  t('the company moves to its own column', zed.external_org === 'Acme Foods', String(zed.external_org));
  t('AND THE SIGN-IN NAME FOLLOWS IT — no stray bracket', zed.username === 'Zed', zed.username);
  t('a plant account with a parenthesis is left completely alone', inside.name === 'Bob (nights)' && !inside.external_org);
  t('a shortening that would collide is refused and reported', dupe.name === 'Ci Admin (Acme Foods)' && out.skipped.length === 1, JSON.stringify(out.skipped));
  t('running it again changes nothing', repairClientAccountNames(db).fixed.length === 0);
  db.close();
}

console.log('\nWhat /users/me tells the shell about a guest');
{
  const me = await J(await call('/users/me', { token: clientToken }));
  t('the client account reports itself as external', me?.is_external === true, JSON.stringify(me).slice(0, 160));
  const meAdmin = await J(await call('/users/me', { token: A }));
  t('and a plant account does not', meAdmin?.is_external === false);
}

console.log('\nWhat the audit log says');
{
  const db = open(true);
  const rows = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'user_invite' ORDER BY rowid").all();
  db.close();
  t('every issue and withdrawal is on the record', rows.length >= 4, `n=${rows.length}`);
  t('AND NOT ONE OF THEM CARRIES THE TOKEN', !rows.some(r => String(r.details || '').includes(token)));
}

// ── in a real browser ────────────────────────────────────────────────────────
//
// At 390px, because the person opening a join link is holding a phone in a car
// park, which is the whole reason this is a link and not an eight-character
// code read out over the telephone.
console.log('\nOn a phone: the link, and the office screen that sends it');
{
  const fresh = await J(await call('/users/ci-client2/invite', { method: 'POST', token: A }));
  const tk = fresh.url.split('/join/')[1];
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ORIGIN = `http://localhost:${PORT}`;

  {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${ORIGIN}/join/${tk}`);
    await page.waitForTimeout(2500);
    t('the page opens with no session at all', await page.locator('[data-join-form]').count() === 1);
    const text = await page.locator('body').innerText();
    t('it greets them by name and names the channel', /Ci Second Client/.test(text) && /client--m4test/.test(text), text.slice(0, 160));
    t('IT ASKS FOR ONE THING — a password, twice, and nothing else',
      await page.locator('[data-join-form] input').count() === 2);
    t('and the page does not scroll sideways at 390px',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    t('the button is dead until the two match', await page.locator('[data-join-submit]').isDisabled());
    await page.locator('[data-join-password]').fill('PhoneJoin2026!');
    await page.locator('[data-join-confirm]').fill('PhoneJoin2026');
    await page.waitForTimeout(150);
    t('a mismatch keeps it dead and says so',
      await page.locator('[data-join-submit]').isDisabled() && /do not match/i.test(await page.locator('body').innerText()));
    await page.locator('[data-join-confirm]').fill('PhoneJoin2026!');
    await page.waitForTimeout(150);
    await page.locator('[data-join-submit]').click();
    await page.waitForTimeout(3500);
    t('SETTING IT SIGNS THEM IN AND LANDS THEM IN THE APP — no second login screen',
      !/\/join\//.test(page.url()), page.url());
    const after = await page.locator('body').innerText();
    // A POSITIVE ANCHOR FIRST. Every assertion below is an ABSENCE, and an
    // absence passes for free on a screen that is not Messages at all — which
    // is exactly where a guest lands if the shell stops treating them as one.
    t('A GUEST LANDS IN MESSAGES, not on a page explaining they have no modules',
      await page.locator('input[placeholder="Search messages…"]').count() === 1, after.slice(0, 160));
    t('and their channel is there', /client--m4test/.test(after), after.slice(0, 200));

    // WHAT A GUEST CAN SEE FROM HERE. Every control below leads somewhere they
    // have no access to, and a control that fails reads as the app being
    // broken rather than as the boundary working.
    t('NO "← ReadyDoc" — it opens a page telling them they have no modules',
      await page.locator('button[title="Switch to ReadyDoc"]').count() === 0);
    t('no Split screen', !/split screen/i.test(after));
    t('no + to open a channel, and no + to start a DM',
      await page.locator('[data-tip="New channel"]').count() === 0
      && await page.locator('[data-tip="New message or group"]').count() === 0);

    // AND WHAT THEY CAN DO: their own account. Until this existed there was no
    // way from Messages to change a password or even sign out.
    const hasMenu = await page.locator('[data-account-menu]').count() === 1;
    t('there IS an account menu', hasMenu);
    if (hasMenu) {
      await page.locator('[data-account-menu]').click();
      await page.waitForTimeout(400);
      const menu = await page.locator('body').innerText();
      t('it names them and SAYS WHAT THEY SIGN IN AS', /Signs in as/i.test(menu), menu.slice(0, 200));
      t('it offers a password change and a way out',
        await page.locator('[data-account-password]').count() === 1
        && await page.locator('[data-account-signout]').count() === 1);
      await page.locator('[data-account-password]').click();
      await page.waitForTimeout(500);
      t('and the password form actually opens',
        /change your password/i.test(await page.locator('body').innerText()));
    } else { fail += 3; console.log('  ✗ (3 more skipped — no menu to open)'); }
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${ORIGIN}/join/${tk}`);
    await page.waitForTimeout(2000);
    t('THE SAME LINK OPENED AGAIN REFUSES, IN WORDS', await page.locator('[data-join-refused]').count() === 1);
    t('and says which refusal it is', /already been used/i.test(await page.locator('body').innerText()));
    await page.close();
  }

  // Settings → Users. The control is where the problem is seen: on the person
  // who cannot sign in, beside the reset that does not suit them.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${ORIGIN}/manifest.webmanifest`);
    await page.evaluate(([tkn, u]) => { localStorage.setItem('auth_token', tkn); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, admin.user]);
    await page.goto(`${ORIGIN}/?tab=settings&section=users`);
    await page.waitForTimeout(3500);
    const row = page.locator('tr', { hasText: 'Ci Phone Test' }).first();
    await row.getByRole('button', { name: /edit/i }).first().click();
    await page.waitForTimeout(900);
    t('an account with no password is offered a join link', await page.locator('[data-invite-open]').count() >= 1);
    t('and the number typed on the Add form is on the record', await page.locator('input[value="8015550142"]').count() >= 1);
    await page.locator('[data-invite-open]').first().click();
    await page.waitForTimeout(400);
    t('the number is pre-filled from the account', /8015550142/.test(await page.locator('[data-invite-to]').first().inputValue()));
    await page.locator('[data-invite-send]').first().click();
    await page.waitForTimeout(2000);
    t('the link comes back and is shown ONCE, with a way to copy it',
      await page.locator('[data-invite-issued]').count() === 1);
    t('and it is a real join link', /\/join\/[0-9a-f]{32}/.test(await page.locator('[data-invite-url]').first().innerText()));
    await browser.close();
  }
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
