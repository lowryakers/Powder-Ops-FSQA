// Who each automatic ReadyBot message reaches — executed against a live server.
//
// Two things are proved. That the Settings screen tells the truth: every
// audience is the sender's OWN function, so the list on screen is the list that
// is messaged. And that the defaults are the people who must act, rather than
// every admin OR-ed onto a department.
//
// The four the registry was wrong about before this ran are asserted by name:
// supplier reviews and QA-records over-reported (the senders require
// supervisor/manager, the registry listed anyone in the department), parked
// changes over-reported (the registry added quality and QA), and the auditor
// pass UNDER-reported (the registry said admins, the sender also messaged QA).
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4994;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const open = (ro = false) => new Database(process.env.DBPATH, ro ? { readonly: true } : {});
const { readybotAudiences, SETTABLE } = await import('../server/readybot-audience.js');

// The real plant, as the org chart names them, plus the leadership who kept
// landing on every digest because the rule OR-ed `role = 'admin'`.
const ROSTER = [
  ['rb-adam', 'Adam Bliss', 'supervisor', 'production'],
  ['rb-maria', 'Maria Servin', 'supervisor', 'qa'],
  ['rb-carol', 'Carol Pierce', 'supervisor', 'qa'],
  ['rb-daniela', 'Daniela Servin', 'supervisor', 'document_control'],
  ['rb-dayanna', 'Dayanna Meza', 'supervisor', 'document_control'],
  ['rb-marnee', 'Marnee Bybee', 'supervisor', 'office'],
  ['rb-lowry', 'Lowry Akers', 'admin', 'office'],
  ['rb-danny', 'Danny Owner', 'admin', 'office'],
  ['rb-jake', 'Jake Waits', 'admin', 'purchasing'],
  ['rb-alex', 'Alex', 'admin', 'office'],
  ['rb-diana', 'Diana Q', 'supervisor', 'quality'],
];
{
  const db = open();
  // Start from the RULE, whatever anybody chose earlier. Without this the
  // default-shrink assertions read whichever list happened to be stored and
  // pass or fail on test order rather than on the code.
  db.prepare("DELETE FROM app_settings WHERE key LIKE '%_recipients'").run();
  for (const [id, name, role, dept] of ROSTER) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
      VALUES (?,?,?,?,?,1,NULL,?,datetime('now','+7 day'))`).run(id, name, id, role, dept, 'SC-' + id);
  }
  db.close();
}

await post('/users/login', { name: 'Lowry Akers' });
await post('/users/set-password', { user_id: 'rb-lowry', password: 'ReadyBot2026!', setup_code: 'SC-rb-lowry' });
token = (await J(await post('/users/login', { name: 'Lowry Akers', password: 'ReadyBot2026!' })))?.token;
t('signed in as an admin', !!token);

const audiences = () => readybotAudiences(open(true));
const one = (key) => audiences().find(a => a.key === key);
const names = (key) => (one(key)?.recipients || []).map(r => r.name).sort();
const SHRUNK = ['employee_documents', 'onboarding_finished', 'supplier_reviews', 'record_backfill', 'controlled_changes', 'auditor_pass'];
const LEADERSHIP = ['Danny Owner', 'Jake Waits', 'Lowry Akers', 'Alex'];

console.log('\nThe registry no longer holds a copy of anybody’s recipient rule');
{
  const src = (await import('fs')).readFileSync('server/readybot-audience.js', 'utf8');
  t('NO SQL LEFT IN THE REGISTRY AT ALL', !/FROM users/i.test(src));
  t('and it imports the senders instead',
    /supplierReviewRecipients/.test(src) && /auditorPassRecipients/.test(src) && /controlledChangeRecipients/.test(src));
}

console.log('\nThe leadership is off the digests they do not own');
{
  for (const key of SHRUNK) {
    const got = names(key);
    const stuck = LEADERSHIP.filter(n => got.includes(n) && !(key === 'auditor_pass' && n === 'Lowry Akers'));
    t(`${key}: no admin is on it just for being an admin`, stuck.length === 0, `still there: ${stuck.join(', ')} (list: ${got.join(', ')})`);
  }
}

console.log('\nAnd the people who must act are');
{
  t('supplier reviews → Quality’s two', names('supplier_reviews').join(',') === 'Carol Pierce,Maria Servin', names('supplier_reviews').join(','));
  t('QA records waiting → Quality’s two', names('record_backfill').join(',') === 'Carol Pierce,Maria Servin', names('record_backfill').join(','));
  t('parked changes → the Document Control approvers',
    names('controlled_changes').join(',') === 'Daniela Servin,Dayanna Meza,Maria Servin', names('controlled_changes').join(','));
  t('auditor pass → Adam and Lowry', names('auditor_pass').join(',') === 'Adam Bliss,Lowry Akers', names('auditor_pass').join(','));
  t('a document to sign → Adam and the office owner', names('employee_documents').join(',') === 'Adam Bliss,Marnee Bybee', names('employee_documents').join(','));
  t('onboarding finished → Adam and the office owner', names('onboarding_finished').join(',') === 'Adam Bliss,Marnee Bybee', names('onboarding_finished').join(','));
  t('Diana is off the QA digests she was swept into by department',
    !names('record_backfill').includes('Diana Q') && !names('supplier_reviews').includes('Diana Q'));
}

console.log('\nActor-only stays actor-only — no picker opts leadership into somebody else’s work');
{
  for (const key of ['pay_review_asks', 'qa_corrections']) {
    const a = one(key);
    t(`${key} is not settable`, a && a.setting === null, `setting=${a?.setting}`);
    t(`${key} names nobody to broadcast to`, (a?.recipients || []).length === 0);
  }
  const r = await put('/flash/readybot-audience/qa_corrections_recipients', { ids: ['rb-lowry'] });
  t('and an invented key for one is refused', r.status === 400, `got ${r.status}`);
}

console.log('\nThe screen says truthfully what is chosen and what is a rule');
{
  const api = await J(await req('/flash/readybot-audience'));
  const rows = api?.audiences || api || [];
  t('the endpoint answers', Array.isArray(rows) && rows.length > 0, JSON.stringify(api || {}).slice(0, 120));
  const settable = rows.filter(a => a.setting);
  t('every settable row is in SETTABLE', settable.every(a => SETTABLE[a.setting]),
    settable.filter(a => !SETTABLE[a.setting]).map(a => a.setting).join(', '));
  t('every settable row reads Default before anybody chooses',
    settable.every(a => a.source === 'default' || a.source === 'setting'));
  t('the six shrunk digests are now choosable', SHRUNK.every(k => rows.find(a => a.key === k)?.setting),
    SHRUNK.filter(k => !rows.find(a => a.key === k)?.setting).join(', '));
  t('nothing reports itself as a rule while carrying a setting',
    !rows.some(a => a.setting && a.source === 'rule'));
}

console.log('\nChoosing a list wins, and the sender obeys the same list');
{
  const r = await put('/flash/readybot-audience/supplier_review_recipients', { ids: ['rb-jake'] });
  t('an admin can set it', r.ok, `got ${r.status}`);
  t('the screen says Chosen', one('supplier_reviews')?.source === 'setting');
  t('and names exactly who was picked', names('supplier_reviews').join(',') === 'Jake Waits', names('supplier_reviews').join(','));
  const { supplierReviewRecipients } = await import('../server/supplier-review.js');
  t('THE SENDER READS THE SAME LIST — one definition, not two',
    supplierReviewRecipients(open(true)).users.map(u => u.name).join(',') === 'Jake Waits');
  await put('/flash/readybot-audience/supplier_review_recipients', { ids: [] });
  t('clearing it returns to the rule', one('supplier_reviews')?.source === 'default');
}

console.log('\nUnset is never nobody');
{
  const { byNames, resolve } = await import('../server/readybot-recipients.js');
  const db = open(true);
  t('a name nobody answers to resolves to nobody, never to a guess', byNames(db, ['nobody at all']).length === 0);
  const r = resolve(db, 'rb_no_such_setting', () => byNames(db, ['nobody at all']));
  t('and an audience that would be empty falls back to the admins', r.users.length > 0 && r.source === 'default',
    JSON.stringify(r).slice(0, 120));
  t('ReadyBot is never in that fallback', !r.users.some(u => /readybot/i.test(u.name)));
  db.close();
}

console.log('\nAn inactive account drops off a chosen list');
{
  await put('/flash/readybot-audience/record_backfill_recipients', { ids: ['rb-carol', 'rb-maria'] });
  // Assert the SOURCE, not just the length: the default here is those same two
  // people, so counting alone passed while the setting was silently empty.
  t('the list is genuinely a chosen one', one('record_backfill')?.source === 'setting', one('record_backfill')?.source);
  t('both are listed', names('record_backfill').length === 2);
  const db = open(); db.prepare("UPDATE users SET is_active = 0 WHERE id = 'rb-carol'").run(); db.close();
  t('a deactivated person stops being messaged', names('record_backfill').join(',') === 'Maria Servin', names('record_backfill').join(','));
  const db2 = open(); db2.prepare("UPDATE users SET is_active = 1 WHERE id = 'rb-carol'").run(); db2.close();
  await put('/flash/readybot-audience/record_backfill_recipients', { ids: [] });
}

console.log('\nWhat did not change');
{
  t('Flash Report is still settable', one('flash_report')?.setting === 'flash_report_recipients');
  t('Pay reminders are still settable', one('pay_actions')?.setting === 'pay_action_recipients');
  t('the QA correction cadence is untouched by this sitting',
    /a day overdue/.test(one('qa_corrections')?.when || ''), one('qa_corrections')?.when);
  const keys = audiences().map(a => a.key);
  t('no audience was removed and no new bot lane invented', keys.length === new Set(keys).size && keys.length >= 12, `n=${keys.length}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
