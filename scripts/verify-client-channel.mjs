// The M4 client channel, end to end against a live server on a fresh database.
//
// The rules being asserted are the ones that would be expensive to get wrong:
// the channel is private and cannot be made public; the people in it are
// Messages-only and are not in #general; nothing typed in it can raise plant
// work; the guide is PINNED rather than merely first; and the Account Manager
// is called Alex and nothing else.
//
// Caller sets PORT + DBPATH + the R2 stand-in.
const PORT = process.env.PORT || 4996;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { isClientChannel } = await import('../shared/client-channels.js');
const { teamForChannel } = await import('../src/lib/taskIntent.js');
const db = new Database(process.env.DBPATH);

console.log('── what the seeder filed ──');
const ch = db.prepare('SELECT * FROM chat_channels WHERE name = ?').get('client--m4');
t('the channel exists', !!ch);
t('IT IS PRIVATE', ch?.kind === 'private');
t('it is not a default channel, so nobody is auto-joined into it', ch?.is_default === 0);
t('anyone in it may post (post_policy all)', (ch?.post_policy || 'all') === 'all');
t('the topic states the three release rules', /BOM confirmed/.test(ch?.topic || '') && /materials on-site/.test(ch?.topic || '') && /WIP≤30/.test(ch?.topic || ''));
t('AND DEFINES WIP where it uses it', /active Manufacturing Orders open at any given time \(plant-wide\)/.test(ch?.topic || ''));
t('it says the schedule is not set from chat, and who may waive a rule',
  /No schedule from chat/i.test(ch?.topic || '') && /Exceptions: Lowry only/i.test(ch?.topic || ''));

const members = db.prepare(`SELECT u.* FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ?`).all(ch.id);
const byName = (re) => members.filter(u => re.test(u.name));
t('Alex is a member', byName(/^Alex$/).length === 1);
t('THE ACCOUNT MANAGER IS CALLED "Alex" — never bot, agent or a product name',
  byName(/^Alex$/)[0] && !/bot|agent|automat|grok|assistant/i.test(byName(/^Alex$/)[0].name),
  byName(/^Alex$/)[0]?.name);
t('the five M4 people are in', members.filter(u => u.is_external).length === 5);
t('and every one of them is marked as an outside account', members.filter(u => /M4/.test(u.name)).every(u => u.is_external === 1));
t('EVERY M4 ACCOUNT IS MESSAGES-ONLY — no module map at all',
  members.filter(u => u.is_external).every(u => u.module_access === null));
t('DANNY IS NOT IN THE CHANNEL', !members.some(u => /^danny\b/i.test(u.name)));
t('nobody was given a password', members.every(u => !u.password_hash));
t('the optional coordinator@ account was not created',
  !db.prepare("SELECT 1 FROM users WHERE email = 'coordinator@m4dynamic.com'").get());

console.log('\n── the guide ──');
const pinnedRows = db.prepare('SELECT * FROM chat_messages WHERE channel_id = ? AND pinned_at IS NOT NULL').all(ch.id);
t('THE GUIDE IS PINNED, not merely the first message', pinnedRows.length === 1);
const guide = pinnedRows[0]?.body || '';
const upTo = (s) => guide.indexOf(s);
t('IT OPENS WITH HOW TO PUT READYDOC ON A PHONE — a guide whose first useful step is on page two is one nobody follows',
  upTo('Add to Home Screen') > -1 && upTo('Add to Home Screen') < 900, String(upTo('Add to Home Screen')));
t('iPhone Safari and Android Chrome are both covered, by name',
  /iPhone — Safari/.test(guide) && /Android — Chrome/.test(guide) && /start\.powder-ops\.com/.test(guide));
t('it tells them to use threads, one per MO', /Threads/.test(guide) && /One MO, one thread/.test(guide));
t('it says the schedule is not set from chat', /Do not schedule from chat/i.test(guide));
t('the three release rules are in it', /BOM confirmed/.test(guide) && /raws, film, pouches, scoops, boxes/.test(guide));
t('WIP IS DEFINED IN THE GUIDE TOO, in the same words',
  /active Manufacturing Orders open at any given time \(plant-wide\)/.test(guide));
t('there is a status update template to fill in', /MO: <number>/.test(guide) && /Blockers:/.test(guide));
t('and it says who to @ for what, including Alex as Account Manager',
  /@Lowry/.test(guide) && /@Adam/.test(guide) && /@Jake/.test(guide) && /@Alex\* — Account Manager/.test(guide));
t('attaching a document is not an approval, and it says so', /not\* an approval/.test(guide));
t('it was posted by Alex', pinnedRows[0]?.user_id === members.find(u => u.name === 'Alex')?.id);

console.log('\n── the reserved family ──');
t('`client--m4` is recognised as a client channel', isClientChannel('client--m4'));
t('an ordinary channel is not', !isClientChannel('batching') && !isClientChannel('general'));
t('A CLIENT CHANNEL MAPS TO NO TASK CENTER TEAM', teamForChannel('client--m4') === null);
t('not even when the client name contains a team word', teamForChannel('client--fillco-pouch') === null);
t('while an ordinary channel still maps as it always did',
  teamForChannel('batching') === 'batching' && teamForChannel('warehouse') === 'warehouse');

console.log('\n── over HTTP ──');
const mk = (id, name, role, dept, code, ext) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access,is_external)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),NULL,?)`).run(id, name, name, role, dept, code, ext);
mk('cc-admin', 'Chan Admin', 'admin', 'office', 'SC-CA', 0);
mk('cc-sup', 'Chan Super', 'supervisor', 'batching', 'SC-CS', 0);
// A real M4 account signs in and posts.
const matt = members.find(u => /^Matt \(M4/.test(u.name));
db.prepare("UPDATE users SET setup_code = 'SC-M4', setup_code_expires_at = datetime('now','+7 day') WHERE id = ?").run(matt.id);
db.close();

const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const signIn = async (id, name, code, pw) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await (await call('POST', '/users/login', { name, password: pw })).json())?.token;
};
const admin = await signIn('cc-admin', 'Chan Admin', 'SC-CA', 'ChanAdmin2026!');
const sup = await signIn('cc-sup', 'Chan Super', 'SC-CS', 'ChanSuper2026!');
const m4 = await signIn(matt.id, matt.name, 'SC-M4', 'M4Client2026!');
t('the admin, a supervisor and an M4 account all sign in', !!admin && !!sup && !!m4);

// The M4 account's own view.
const me = await (await call('GET', '/users/me', null, m4)).json();
t('THE M4 ACCOUNT HAS NO READYDOC MODULE — Messages only', !me?.user?.module_access || Object.keys(JSON.parse(me.user.module_access || '{}')).length === 0);
for (const [label, path] of [['Production', '/production/entries'], ['Accounting', '/ap-drop'], ['Partner Reconciliation', '/partners/documents'], ['Procurement', '/office/supply/orders']]) {
  const r = await call('GET', path, null, m4);
  t(`  ${label} is refused`, r.status === 401 || r.status === 403 || r.status === 404, `${r.status} ${(await r.text()).slice(0, 120)}`);
}

const chans = await (await call('GET', '/comms/channels', null, m4)).json();
const names = (chans || []).map(c => c.name);
t('the channel they can see is the client one', names.includes('client--m4'));
t('AND THEY ARE NOT IN #general OR #announcements', !names.includes('general') && !names.includes('announcements'), names.join(','));

// Posting and attaching.
const posted = await call('POST', `/comms/channels/${ch.id}/messages`, { body: 'MO 77012 — BOM confirmed, film lands Thursday.' }, m4);
t('an M4 account can post in the channel', posted.status === 201, String(posted.status));
const fd = new FormData();
fd.append('files', new Blob([Buffer.from('PO 1234')], { type: 'text/plain' }), 'po.txt');
const up = await fetch(`${URL}/api/comms/channels/${ch.id}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${m4}` }, body: fd });
const upBody = await up.json().catch(() => ({}));
t('and attach a document', up.status === 201 || up.status === 200, `${up.status} ${JSON.stringify(upBody).slice(0, 140)}`);
{
  const ids = (upBody.attachments || upBody || []).map(a => a.id).filter(Boolean);
  const withFile = await call('POST', `/comms/channels/${ch.id}/messages`, { body: 'Packing list attached.', attachment_ids: ids }, m4);
  t('and send it with the message', withFile.status === 201, String(withFile.status));
}

// The hard one: chat cannot mutate the schedule.
const task = await call('POST', `/comms/channels/${ch.id}/to-task`, { title: 'Run MO 77012 tomorrow', due_date: '2026-09-20', task_group: 'batching' }, admin);
t('NO WORK ORDER CAN BE RAISED FROM A CLIENT CHANNEL, even by an admin', task.status === 400, String(task.status));
t('and it says why', /client channel/i.test((await task.json())?.error || ''));
{
  // The admin roster, not their own channel list — an account created straight
  // in the database is in no channel at all.
  const gen = (await (await call('GET', '/comms/admin/channels', null, admin)).json()).find(c => c.name === 'general');
  const ok = await call('POST', `/comms/channels/${gen.id}/to-task`, { title: 'Sweep the dock', due_date: '2026-09-20', task_group: 'warehouse' }, admin);
  t('while an ordinary channel still raises one — the guard is the family, not the feature', ok.status === 201, String(ok.status));
}

// Privacy is structural.
const pub = await call('PUT', `/comms/channels/${ch.id}`, { kind: 'public' }, admin);
t('A CLIENT CHANNEL CANNOT BE MADE PUBLIC', pub.status === 400, String(pub.status));
const ren = await call('PUT', `/comms/channels/${ch.id}`, { name: 'm4-coordination' }, admin);
t('nor renamed out of the family, which would switch every rule off silently', ren.status === 400, String(ren.status));
const stillPrivate = await (await call('GET', `/comms/channels/${ch.id}`, null, admin)).json();
t('so it is still private and still named client--m4', stillPrivate.kind === 'private' && stillPrivate.name === 'client--m4');
const mkClient = await call('POST', '/comms/channels', { name: 'client--alkify', kind: 'public' }, sup);
t('a supervisor cannot open a client channel at all', mkClient.status === 403, String(mkClient.status));
{
  const r = await call('POST', '/comms/channels', { name: 'client--alkify', kind: 'public' }, admin);
  const made = await r.json();
  t('AND AN ADMIN OPENING ONE GETS A PRIVATE CHANNEL WHATEVER THEY TICKED', r.status === 201 && made.kind === 'private', `${r.status} ${made.kind}`);
}

// Pinning.
// The admin has to be IN the channel to act on its messages — `ownedMessage`
// gates on membership, not on being an admin. In the plant Lowry is a member;
// here that is one call.
await call('POST', `/comms/channels/${ch.id}/members`, { user_ids: ['cc-admin'] }, admin);
const pinList = await (await call('GET', `/comms/channels/${ch.id}/pinned`, null, m4)).json();
t('the guide is served to a member as a pinned message', pinList.length === 1 && /Add to Home Screen/.test(pinList[0].body));
t('and it names who pinned it', !!pinList[0].pinned_by);
const msgId = (await posted.json()).id;
t('a non-admin cannot pin', (await call('POST', `/comms/messages/${msgId}/pin`, {}, m4)).status === 403);
t('an admin can', (await call('POST', `/comms/messages/${msgId}/pin`, {}, admin)).status === 200);
t('and unpin', (await call('POST', `/comms/messages/${msgId}/pin`, { pinned: false }, admin)).status === 200);
t('leaving the guide pinned on its own',
  (await (await call('GET', `/comms/channels/${ch.id}/pinned`, null, admin)).json()).length === 1);

// A new external account added through Settings.
{
  const r = await call('POST', '/users', { name: 'New M4 Person', email: 'coordinator@m4dynamic.com', is_external: true }, admin);
  const made = await r.json();
  t('an external account created in Settings records that it is external', r.status === 201 && made.is_external === 1);
  const d2 = new Database(process.env.DBPATH);
  const joined = d2.prepare(`SELECT c.name FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id WHERE m.user_id = ?`).all(made.id).map(r => r.name);
  d2.close();
  t('AND IS NOT DROPPED INTO #general BY THE ACT OF CREATING IT', joined.length === 0, joined.join(','));
  const r2 = await call('POST', '/users', { name: 'New Plant Person' }, admin);
  const made2 = await r2.json();
  const d3 = new Database(process.env.DBPATH);
  const joined2 = d3.prepare(`SELECT c.name FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id WHERE m.user_id = ?`).all(made2.id).map(r => r.name);
  d3.close();
  t('while an ordinary new employee still joins them', joined2.length > 0, joined2.join(','));
}

console.log('\n── in a real browser, on a phone ──');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(URL);
  await page.fill('input[placeholder*="name" i], input[name=name]', matt.name).catch(() => {});
  await page.fill('input[type=password]', 'M4Client2026!');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  // A Messages-only account lands on the welcome screen; Messages is the one
  // thing it can open.
  const openMsgs = page.locator('button:has-text("Open Messages"), button:has-text("Messages")').first();
  if (await openMsgs.count()) await openMsgs.click().catch(() => {});
  await page.waitForTimeout(1500);
  const chan = page.locator('text=client--m4').first();
  if (await chan.count()) await chan.click().catch(() => {});
  await page.waitForSelector('[data-pinned-strip]', { timeout: 20000 }).catch(() => {});
  t('THE GUIDE IS ON THE SCREEN, above the conversation, without scrolling for it',
    await page.locator('[data-pinned-strip]').count() === 1);
  t('collapsed to one line until it is asked for',
    await page.locator('[data-pinned-body]').count() === 0);
  await page.locator('[data-pinned-toggle]').first().click();
  await page.waitForSelector('[data-pinned-body]', { timeout: 10000 });
  const guideText = await page.locator('[data-pinned-body]').innerText();
  t('and it opens on the Add to Home Screen steps', /Add to Home Screen/.test(guideText));
  t('with the WIP definition in it', /active Manufacturing Orders open at any given time/.test(guideText));
  t('a client cannot unpin it', await page.locator('[data-pinned-unpin]').count() === 0);
  {
    const over = await page.evaluate(() => {
      const vw = window.innerWidth; const out = [];
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= vw + 1) continue;
        let p = el.parentElement, scroller = false;
        while (p) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') { scroller = true; break; } p = p.parentElement; }
        if (!scroller) out.push(`${el.tagName}.${String(el.className || '').slice(0, 60)}`);
      }
      return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 5) };
    });
    t('and nothing on the page runs off the side of the phone', over.sw <= over.vw && over.out.length === 0, JSON.stringify(over));
  }
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
