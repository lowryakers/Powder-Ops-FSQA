// Scheduled runs with no end-of-day report, chased — executed against a live server.
//
// Live on 14 September: a collapsed yellow bar reading "44 scheduled production
// runs have no end-of-day report", rendered only for admins and QA — so the
// supervisors who actually file one were the only group never told.
//
// Two things are proved here. That the chase reaches those people and files
// nothing; and that the match itself stopped counting reports which exist. The
// MO comparison was raw string equality against a free-text box, so `MO76790`
// scheduled beside `MO #MO76790` filed read as a missing report.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4996;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { normalizeMo, missedReports } = await import('../server/api/production.js');
const { eodMissedDigest, renderEodDigest, sendEodMissedDigest, eodMissedRecipients, eodEscalateHours, EOD_BUSY_THRESHOLD }
  = await import('../server/eod-chase.js');
const open = (ro = false) => new Database(process.env.DBPATH, ro ? { readonly: true } : {});

// Monday of a week comfortably in the past, so every slot is before yesterday.
const monday = (() => { const d = new Date(Date.now() - 21 * 86400000); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const dayOf = (off) => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };

{
  const db = open();
  const user = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES (?,?,?,?,?,1,NULL,?,datetime('now','+7 day'))`).run(id, name, id, role, dept, 'SC-' + id);
  user('eo-adam', 'Adam Bliss', 'supervisor', 'production');
  user('eo-sup', 'Eo Filling Sup', 'supervisor', 'production');
  user('eo-qa', 'Eo Quality', 'supervisor', 'qa');
  user('eo-admin', 'Eo Admin', 'admin', 'office');
  user('eo-floor', 'Eo Floor', 'operator', 'production');

  // Wipe the seeded schedule so the counts below are only what this test files.
  db.prepare('DELETE FROM production_schedule').run();
  db.prepare('DELETE FROM production_entries').run();
  const slot = (id, off, room, team, mo) => db.prepare(`INSERT OR REPLACE INTO production_schedule
    (id, week_start, day_of_week, room, room_type, team, mo_number, product_name, slot)
    VALUES (?,?,?,?,'production',?,?,?,0)`).run(id, monday, off, room, team, mo, 'Alkify Stick');
  slot('eo-s1', 0, '1', 'Filling', 'MO76790');   // filed, but written differently
  slot('eo-s2', 1, '2', 'Filling', 'MO76791');   // genuinely missing
  slot('eo-s3', 2, '3', 'Batching', 'MO76792');  // genuinely missing
  slot('eo-s4', 3, '4', 'Batching', 'MO76793');  // filed cleanly

  const entry = (id, date, room, team, mo) => db.prepare(`INSERT OR REPLACE INTO production_entries
    (id,date,team,room,product_name,mo_number,lot_number,start_time,end_time,quantity_completed,people_count,submitted_by)
    VALUES (?,?,?,?,'Alkify Stick',?,'L1','06:00','14:00',100,3,'Eo Filling Sup')`).run(id, date, team, room, mo);
  // THE CASE THAT MADE 44: the report exists. Its MO carries a prefix and a hash
  // the schedule does not, and raw string equality called that a missing report.
  entry('eo-e1', dayOf(0), '1', 'Filling', 'MO #MO76790');
  entry('eo-e4', dayOf(3), '4', 'Batching', 'MO76793');
  db.close();
}

console.log('\nThe MO comparison stops counting reports that exist');
{
  t('a prefix, a hash and case are noise', normalizeMo('MO #mo76790') === normalizeMo('MO76790'), normalizeMo('MO #mo76790'));
  t('a bare number is the same MO', normalizeMo('76790') === normalizeMo('MO76790'));
  t('A TRAILING CHARACTER IS NOT STRIPPED — guessing there costs a real miss',
    normalizeMo('MO76790 y') !== normalizeMo('MO76790'), normalizeMo('MO76790 y'));
  t('two different MOs stay different', normalizeMo('MO76790') !== normalizeMo('MO76791'));
  t('nothing normalises to the same thing as nothing meaningful', normalizeMo(null) === '' && normalizeMo('  ') === '');
}

console.log('\nWhat is actually missing');
{
  const rows = missedReports(open(true), {});
  const ids = rows.map(r => `${r.room}/${r.mo_number}`).sort();
  t('the differently-written report is NOT counted as missing', !ids.some(x => x.includes('MO76790')), ids.join(', '));
  t('the cleanly-filed report is not counted either', !ids.some(x => x.includes('MO76793')), ids.join(', '));
  t('the two genuinely missing ones ARE counted', rows.length === 2, ids.join(', '));
  t('and they are the right two', ids.join(',') === '2/MO76791,3/MO76792', ids.join(','));
}

console.log('\nA near-miss is reported, never resolved');
{
  const db = open();
  db.prepare(`INSERT OR REPLACE INTO production_entries
    (id,date,team,room,product_name,mo_number,lot_number,start_time,end_time,quantity_completed,people_count,submitted_by)
    VALUES ('eo-e2', ?, 'Filling','2','Alkify Stick','MO76791 y','L1','06:00','14:00',100,3,'Eo Filling Sup')`).run(dayOf(1));
  db.close();
  const rows = missedReports(open(true), {});
  const near = rows.find(r => r.mo_number === 'MO76791');
  t('it is STILL reported missing — the app does not decide a stray character for you', !!near, rows.map(r => r.mo_number).join(','));
  t('and it names the entry that nearly matches', near?.possible_typo === 'MO76791 y', `possible_typo=${near?.possible_typo}`);
}

console.log('\nWho is chased');
{
  const db = open();
  const to = eodMissedRecipients(db).map(u => u.name);
  t('the supervisors who FILE the report are on it', to.includes('Eo Filling Sup'), to.join(', '));
  t('Adam is on it by name', to.includes('Adam Bliss'));
  t('QA is on it', to.includes('Eo Quality'));
  t('an operator is not', !to.includes('Eo Floor'));
  t('unset still reaches somebody', to.length > 0);
  db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('eod_missed_recipients', ?)").run(JSON.stringify(['eo-sup']));
  t('a chosen list narrows it', eodMissedRecipients(db).length === 1);
  db.prepare("DELETE FROM app_settings WHERE key = 'eod_missed_recipients'").run();

  t('the escalation window defaults to 48h', eodEscalateHours(db) === 48);
  db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('eod_missed_escalate_hours','2')").run();
  t('and is clamped up to 24h', eodEscalateHours(db) === 24);
  db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('eod_missed_escalate_hours','400')").run();
  t('and down to 72h', eodEscalateHours(db) === 72);
  db.prepare("DELETE FROM app_settings WHERE key = 'eod_missed_escalate_hours'").run();
  db.close();
}

console.log('\nThe message');
{
  const d = eodMissedDigest(open(true));
  const text = renderEodDigest(d, { base: 'https://example.test' });
  t('it leads with the count', text.includes(`${d.total} scheduled run`));
  t('it counts by team', /Filling: \d+/.test(text) || /Batching: \d+/.test(text), text.split('\n')[1]);
  t('it counts by room', /Rooms —/.test(text));
  t('it gives the oldest date', !!d.oldest && text.includes(d.oldest));
  t('these are all older than the window, so it says so', d.overdue === d.total && text.includes('hours old'), `overdue=${d.overdue}/${d.total}`);
  t('the near-miss is called out as a typo, not as work', text.includes('differently written MO'));
  t('IT SAYS NOTHING IS FILED OR DISMISSED AUTOMATICALLY', /filed or dismissed automatically/i.test(text));
  t('it deep-links so the bar opens', text.includes('?tab=production-log&missed=1'));
  t('it does NOT list every row', !text.includes('MO76791\n'), text.slice(0, 160));
}

console.log('\nIt files nothing and dismisses nothing');
{
  const snap = () => { const d = open(true); const r = {
    entries: d.prepare('SELECT COUNT(*) c FROM production_entries').get().c,
    dismissals: d.prepare('SELECT COUNT(*) c FROM production_missed_dismissals').get().c,
    schedule: d.prepare('SELECT COUNT(*) c FROM production_schedule').get().c,
  }; d.close(); return r; };
  const before = snap();
  const db = open();
  const r = await sendEodMissedDigest(db, new Date());
  db.close();
  const after = snap();
  t('the digest was sent', r.sent > 0, `sent=${r.sent}`);
  t('NO PRODUCTION ENTRY WAS CREATED', after.entries === before.entries, `${before.entries} → ${after.entries}`);
  t('NOTHING WAS DISMISSED', after.dismissals === before.dismissals);
  t('THE SCHEDULE WAS NOT TOUCHED', after.schedule === before.schedule);
  const d = open(true);
  const dm = d.prepare(`SELECT COUNT(*) c FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
    WHERE ch.kind = 'dm' AND ch.dm_key LIKE '%eo-sup%' AND m.body LIKE '%end-of-day report%'`).get().c;
  d.close();
  t('the supervisor who files them has it in writing', dm > 0, `dms=${dm}`);
}

console.log('\nFiling the report drops it; dismissing drops it too');
{
  const db = open();
  db.prepare(`INSERT OR REPLACE INTO production_entries
    (id,date,team,room,product_name,mo_number,lot_number,start_time,end_time,quantity_completed,people_count,submitted_by)
    VALUES ('eo-e3', ?, 'Batching','3','Alkify Stick','mo 76792','L1','06:00','14:00',100,3,'Eo Filling Sup')`).run(dayOf(2));
  db.close();
  const after = missedReports(open(true), {});
  t('FILING IT DROPS IT — even written loosely', !after.some(r => r.mo_number === 'MO76792'), after.map(r => r.mo_number).join(','));
  t('the digest count follows', eodMissedDigest(open(true)).total === after.length);

  // And the dismissal path is untouched.
  await post('/users/login', { name: 'Eo Admin' });
  await post('/users/set-password', { user_id: 'eo-admin', password: 'EodChase2026!', setup_code: 'SC-eo-admin' });
  token = (await J(await post('/users/login', { name: 'Eo Admin', password: 'EodChase2026!' })))?.token;
  const row = after.find(r => r.mo_number === 'MO76791');
  const dr = await post('/production/missed-reports/dismiss', {
    date: row.date, room: row.room, mo_number: row.mo_number, team: row.team, reason: 'Run cancelled — no product made.' });
  t('a supervisor can still dismiss with a reason', dr.ok, `got ${dr.status}`);
  t('and it leaves the chase', eodMissedDigest(open(true)).total === 0, JSON.stringify(eodMissedDigest(open(true))));
}

console.log('\nA clean week says nothing at all');
{
  const db = open();
  const r = await sendEodMissedDigest(db, new Date());
  db.close();
  t('nothing outstanding means NOTHING SENT', r.sent === 0, `sent=${r.sent}`);
  t('the busy threshold is 25 — 44 clears it', EOD_BUSY_THRESHOLD === 25);
}

console.log('\nThe screen and the chase read the same list');
{
  const screen = await J(await req('/production/missed-reports'));
  t('the endpoint answers', Array.isArray(screen), JSON.stringify(screen || {}).slice(0, 100));
  t('THE SCREEN AND THE DIGEST AGREE', screen.length === eodMissedDigest(open(true)).total,
    `screen=${screen.length} digest=${eodMissedDigest(open(true)).total}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
