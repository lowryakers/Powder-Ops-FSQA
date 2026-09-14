// The Cleanup Review digest — executed against a live database.
//
// Live on 14 September: 116 open tasks and PMs due before that day, many dated
// 24 August, and nobody being asked about any of them. The digest exists to give
// that pile a voice — and the first thing worth proving is that it gives it
// nothing else: no row is cancelled, no entry is waived, no schedule is touched.
//
// Caller sets PORT + DBPATH. Needs a fresh database (it asserts against counts
// it establishes itself).
const PORT = process.env.PORT || 4998;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { cleanupDigest, cleanupDigestRecipients, renderCleanupDigest, sendCleanupDigest, CLEANUP_BUSY_THRESHOLD, todayStr }
  = await import('../server/cleanup-digest.js');
const open = (ro = false) => new Database(process.env.DBPATH, ro ? { readonly: true } : {});
const CUT = todayStr();
const bucket = (d, k) => d.buckets.find(b => b.key === k)?.count ?? -1;

const db = open();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
  VALUES ('cd-adam','Adam Bliss','cd-adam','supervisor','production',1,NULL,'SC-cd-adam',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
  VALUES ('cd-maria','Maria Q','cd-maria','supervisor','qa',1,NULL,'SC-cd-maria',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
  VALUES ('cd-floor','Cd Floor','cd-floor','operator','production',1,NULL,'SC-cd-floor',datetime('now','+7 day'))`).run();

console.log('\nWho hears about it');
{
  const to = cleanupDigestRecipients(db).map(u => u.name);
  t('Adam is on it by name, without an email address anywhere', to.includes('Adam Bliss'), to.join(', '));
  t('QA leadership is on it', to.includes('Maria Q'));
  t('an operator is not', !to.includes('Cd Floor'));
  t('ReadyBot is never a recipient', !to.some(n => /readybot/i.test(n)));
  t('unset still reaches somebody — never nobody', to.length > 0);

  db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('cleanup_review_recipients', ?)").run(JSON.stringify(['cd-adam']));
  const narrowed = cleanupDigestRecipients(db).map(u => u.name);
  t('a chosen list narrows it to exactly that list', narrowed.length === 1 && narrowed[0] === 'Adam Bliss', narrowed.join(', '));
  db.prepare("DELETE FROM app_settings WHERE key = 'cleanup_review_recipients'").run();
}

console.log('\nThe pile is counted by the cadence it came off, read from the schedule');
{
  const before = cleanupDigest(db, CUT);
  const sched = (id, freq) => db.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
    VALUES (?, (SELECT id FROM equipment LIMIT 1), ?, ?, 1, 'maintenance', 1)`).run(id, `Cd ${freq} PM`, freq);
  sched('cd-sd', 'daily'); sched('cd-sw', 'weekly'); sched('cd-sm', 'monthly');
  const wo = (id, schedId, due) => db.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
    VALUES (?, ?, (SELECT id FROM equipment LIMIT 1), ?, 'open', 'maintenance', ?)`).run(id, schedId, `Cd task ${id}`, due);
  wo('cd-w1', 'cd-sd', '2026-08-24'); wo('cd-w2', 'cd-sd', '2026-08-24');
  wo('cd-w3', 'cd-sw', '2026-08-25');
  wo('cd-w4', 'cd-sm', '2026-08-26');
  // A task with no schedule behind it — raised from a chat message. Nothing
  // regenerates it, which makes it a different kind of backlog.
  wo('cd-w5', null, '2026-08-27');

  const d = cleanupDigest(db, CUT);
  t('the total grew by exactly the five raised', d.tasks === before.tasks + 5, `${before.tasks} → ${d.tasks}`);
  t('a Daily PM lands in Daily', bucket(d, 'daily') === bucket(before, 'daily') + 2, `daily=${bucket(d, 'daily')}`);
  t('a Weekly PM lands in Weekly', bucket(d, 'weekly') === bucket(before, 'weekly') + 1, `weekly=${bucket(d, 'weekly')}`);
  t('a Monthly PM lands in Monthly and longer', bucket(d, 'periodic') === bucket(before, 'periodic') + 1);
  t('A TASK WITH NO SCHEDULE IS ITS OWN BUCKET, not silently Daily',
    bucket(d, 'one_off') === bucket(before, 'one_off') + 1, `one_off=${bucket(d, 'one_off')}`);
  t('the buckets account for every task', d.buckets.reduce((n, b) => n + b.count, 0) === d.tasks,
    `${d.buckets.map(b => b.key + '=' + b.count).join(' ')} vs ${d.tasks}`);
  t('the oldest date is reported', d.oldest && d.oldest <= '2026-08-24', `oldest=${d.oldest}`);

  // The count the digest reports and the count the screen shows are the same
  // walk — `cleanup.js` counts() — so they cannot disagree.
  db.close();
  await post('/users/login', { name: 'Adam Bliss' });
  await post('/users/set-password', { user_id: 'cd-adam', password: 'CleanUp2026!', setup_code: 'SC-cd-adam' });
}

console.log('\nThe digest agrees with the screen it links to');
{
  const admin = open();
  admin.prepare("UPDATE users SET role = 'admin' WHERE id = 'cd-adam'").run();
  admin.close();
  token = (await J(await post('/users/login', { name: 'Adam Bliss', password: 'CleanUp2026!' })))?.token;
  t('signed in', !!token);
  // The parameter is `before`, not `cutoff`. The first version of this test asked
  // with the wrong name, got a 400, read `undefined` and passed — a test that
  // passes with the feature absent, which is the one kind this codebase refuses.
  const screen = await J(await req(`/cleanup?before=${CUT}`));
  t('the screen answered', Array.isArray(screen?.sources), JSON.stringify(screen || {}).slice(0, 120));
  const onScreen = screen?.sources?.find(s => s.key === 'work-orders')?.count;
  const d2 = cleanupDigest(open(true), CUT);
  t('THE SCREEN AND THE DIGEST REPORT THE SAME NUMBER', typeof onScreen === 'number' && onScreen === d2.tasks,
    `screen=${onScreen} digest=${d2.tasks}`);
}

console.log('\nThe message says enough to act on and no more');
{
  const d = cleanupDigest(open(true), CUT);
  const text = renderCleanupDigest(d, { base: 'https://example.test' });
  t('it leads with the count', text.includes(`${d.tasks} open task`));
  t('it names the cadences', /Daily PM: \d+/.test(text) && /Weekly PM: \d+/.test(text), text.split('\n')[1]);
  t('it gives the oldest date', text.includes(d.oldest));
  t('IT SAYS NOTHING IS CLOSED AUTOMATICALLY', /closed automatically/i.test(text));
  t('it links to Cleanup Review', text.includes('?tab=settings&section=cleanup'));
  t('it does NOT list every title — a phone wall is a message people scroll past',
    !text.includes('Cd task cd-w1'), text.slice(0, 200));
}

console.log('\nIt closes nothing. This is the assertion that matters.');
{
  const snap = () => { const d = open(true);
    const r = {
      open: d.prepare("SELECT COUNT(*) c FROM work_orders WHERE status IN ('open','in_progress','overdue','missed')").get().c,
      cancelled: d.prepare("SELECT COUNT(*) c FROM work_orders WHERE status = 'cancelled'").get().c,
      waived: d.prepare('SELECT COUNT(*) c FROM production_entries WHERE qa_waived_at IS NOT NULL').get().c,
      schedules: d.prepare('SELECT COUNT(*) c FROM pm_schedules WHERE is_active = 1').get().c,
    }; d.close(); return r; };
  const before = snap();
  const db2 = open();
  const r = await sendCleanupDigest(db2, new Date());
  db2.close();
  const after = snap();
  t('the digest was sent', r.sent > 0, `sent=${r.sent}`);
  t('NO TASK WAS CANCELLED', after.cancelled === before.cancelled, `${before.cancelled} → ${after.cancelled}`);
  t('NO TASK LEFT THE OPEN PILE', after.open === before.open, `${before.open} → ${after.open}`);
  t('NO PRODUCTION ENTRY WAS WAIVED', after.waived === before.waived);
  t('NO RECURRING SCHEDULE WAS TOUCHED', after.schedules === before.schedules);

  const d = open(true);
  const dm = d.prepare(`SELECT COUNT(*) c FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
    WHERE ch.kind = 'dm' AND ch.dm_key LIKE '%cd-adam%' AND m.body LIKE '%Cleanup Review%'`).get().c;
  d.close();
  t('and Adam has it in writing', dm > 0, `dms=${dm}`);
}

console.log('\nA quiet plant hears nothing at all');
{
  const db3 = open();
  // No pile before a cutoff older than anything filed.
  const quiet = cleanupDigest(db3, '2000-01-01');
  t('an empty cutoff counts zero', quiet.total === 0, `total=${quiet.total}`);
  const beforeDm = (() => { const d = open(true);
    const n = d.prepare(`SELECT COUNT(*) c FROM chat_messages WHERE body LIKE '%Cleanup Review%'`).get().c; d.close(); return n; })();
  // sendCleanupDigest uses today's cutoff, so drain the pile instead of faking one.
  db3.prepare("UPDATE work_orders SET status = 'completed' WHERE status IN ('open','in_progress','overdue','missed')").run();
  db3.prepare("UPDATE production_entries SET qa_waived_at = datetime('now') WHERE qa_signoff_at IS NULL").run();
  const r = await sendCleanupDigest(db3, new Date());
  db3.close();
  const afterDm = (() => { const d = open(true);
    const n = d.prepare(`SELECT COUNT(*) c FROM chat_messages WHERE body LIKE '%Cleanup Review%'`).get().c; d.close(); return n; })();
  t('nothing outstanding means NOTHING SENT', r.sent === 0, `sent=${r.sent}`);
  t('and no message was written', afterDm === beforeDm, `${beforeDm} → ${afterDm}`);
}

console.log('\nThe cadence threshold');
{
  t('the busy threshold is 25 — 116 clears it by a wide margin', CLEANUP_BUSY_THRESHOLD === 25);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
