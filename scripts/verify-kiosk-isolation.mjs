// Visitor kiosk isolation — executed, not asserted.
//
// The question this answers: standing at the lobby tablet (or holding its URL
// from anywhere), what can somebody reach? Every line below is a request made
// with NO session token at all, which is exactly what the tablet has.
//
//   BASE=http://localhost:PORT/api DBPATH=/path/to.db node scripts/verify-kiosk-isolation.mjs
//
// Exit code is the number of failures, so CI can gate on it.

const B = process.env.BASE || 'http://localhost:4967/api';
const ORIGIN = B.replace(/\/api$/, '');
const DB = process.env.DBPATH;
const results = [];

const J = async (r) => { try { return await r.json(); } catch { return null; } };
// NO Authorization header anywhere in this file. That is the whole point.
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });

function check(id, title, expected, actual, ok) {
  results.push({ id, title, expected, actual, verdict: ok ? 'PASS' : 'FAIL' });
}

// A response that is 401/403 is a refusal. A 404 on a guarded mount is also a
// refusal (some routers hide existence). Anything 2xx carrying a body is not.
const REFUSED = new Set([401, 403]);

/* ── A. What the kiosk's own endpoints hand out ─────────────────────────── */

let r = await req('/visitor-kiosk/config');
let cfg = await J(r);
const cfgKeys = cfg ? Object.keys(cfg) : [];
check('VK-01', 'The kiosk config exposes only the form and the agreement text',
  'location_default, auto_signout_minutes, fields, agreements — and nothing else',
  `HTTP ${r.status}; keys: ${cfgKeys.join(', ')}`,
  r.ok && cfgKeys.length > 0
    && cfgKeys.every(k => ['location_default', 'auto_signout_minutes', 'fields', 'agreements'].includes(k)));

// The agreement is meant to be readable — that is what the visitor signs. What
// must NOT be in it is anybody else's signature or details.
const agText = JSON.stringify(cfg?.agreements || []);
check('VK-02', 'No visitor names, signatures or contact details ride along with the agreement',
  'The agreement carries its own wording only',
  `${(cfg?.agreements || []).length} agreement(s), ${agText.length} chars, no signature payload`,
  !/signature_image|data:image|signed_name|"email"/.test(agText));

/* ── B. Reading the visitor book itself ─────────────────────────────────── */

r = await req('/visitors/visits');
check('VK-03', 'The visitor LOG cannot be read from the kiosk',
  'HTTP 401/403 — the log is a separate, authenticated module',
  `HTTP ${r.status}`, REFUSED.has(r.status));

r = await req('/visitors/stats');
check('VK-04', 'Visitor statistics cannot be read from the kiosk',
  'HTTP 401/403', `HTTP ${r.status}`, REFUSED.has(r.status));

// The sign-out lookup is the one read the kiosk legitimately has. It must be
// narrow: people currently ON SITE, by name prefix, name + time only.
r = await req('/visitor-kiosk/open?q=a');
let short = await J(r);
check('VK-05', 'The sign-out lookup refuses a one-character probe',
  'Empty — a single letter would enumerate the building',
  `HTTP ${r.status}; ${Array.isArray(short) ? short.length : '?'} row(s)`,
  r.ok && Array.isArray(short) && short.length === 0);

r = await req('/visitor-kiosk/open?q=%25');           // a bare SQL wildcard
const wild = await J(r);
check('VK-06', 'A wildcard in the lookup does not return the whole book',
  'No rows — the parameter is bound, not interpolated',
  `HTTP ${r.status}; ${Array.isArray(wild) ? wild.length : '?'} row(s)`,
  r.ok && Array.isArray(wild) && wild.length === 0);

r = await req("/visitor-kiosk/open?q=' OR 1=1 --");
const inj = await J(r);
check('VK-07', 'The lookup is not SQL-injectable',
  'No rows, no error',
  `HTTP ${r.status}; ${Array.isArray(inj) ? inj.length : '?'} row(s)`,
  r.ok && Array.isArray(inj) && inj.length === 0);

// What a legitimate lookup returns, on a visit we create ourselves.
const stamp = Date.now();
// Signed properly, because the server refuses a sign-in that skips a required
// agreement — the probe has to walk the real path, not a shortcut around it.
const signatures = (cfg?.agreements || []).filter(a => a.require_signature).map(a => ({
  agreement_id: a.id, signed_name: `Probe Case${stamp}`,
  signature_image: 'data:image/png;base64,iVBORw0KGgo=',
}));
const me = { first_name: 'Probe', last_name: `Case${stamp}`, email: `probe${stamp}@example.com`, signatures };
r = await req('/visitor-kiosk/sign-in', { method: 'POST', body: JSON.stringify(me) });
const signedIn = await J(r);
check('VK-08', 'A visitor can sign themselves in — the kiosk still works',
  'HTTP 200/201', `HTTP ${r.status}`, r.ok);

r = await req(`/visitor-kiosk/open?q=probe`);
const found = await J(r);
const row = (found || [])[0] || {};
check('VK-09', 'The lookup returns a name and a time, and nothing else',
  'id, name, signed_in_at only — no email, phone, company, purpose, host or signature',
  `fields: ${Object.keys(row).join(', ') || '(no match)'}`,
  Object.keys(row).length > 0
    && Object.keys(row).every(k => ['id', 'name', 'signed_in_at'].includes(k)));

/* ── C. Can the kiosk read a signature? ─────────────────────────────────── */

const visitId = row.id;
for (const [id, path] of [
  ['VK-10', `/visitors/visits/${visitId}`],
  ['VK-11', `/visitor-kiosk/visits/${visitId}`],
  ['VK-12', `/visitors/visits/${visitId}/signatures`],
]) {
  r = await req(path);
  const body = await J(r);
  const leaks = r.ok && JSON.stringify(body || '').includes('signature');
  check(id, `A signed agreement cannot be read back through ${path.split('/')[1]}`,
    'Refused, or not a route at all',
    `HTTP ${r.status}${leaks ? ' — SIGNATURE DATA RETURNED' : ''}`,
    !r.ok || !leaks);
}

/* ── D. Every other module, with no token ───────────────────────────────── */

// The full mounted list, not a sample — the point of "fully validate".
const NAMESPACES = [
  ['activity', '/activity'], ['ai', '/ai/ask'], ['artwork', '/artwork/jobs'],
  ['audit', '/audit'], ['auditor-passes', '/auditor-passes'], ['banking', '/banking/accounts'],
  ['calibration', '/calibration/instruments'], ['candidates', '/candidates'],
  ['certifications', '/certifications'], ['checklists', '/checklists'],
  ['chemicals', '/chemicals'], ['cleanup', '/cleanup'], ['coa', '/coa/requests'],
  ['comms', '/comms/channels'], ['complaints', '/complaints'],
  ['compliance', '/compliance/notifications'], ['controlled', '/controlled'],
  ['dannys-list', '/dannys-list'], ['disposals', '/disposals'], ['doc-review', '/doc-review'],
  ['documents', '/documents'], ['equipment', '/equipment'], ['facility', '/facility/map-status'],
  ['film-inspection', '/film-inspection'], ['finance', '/finance/ap'], ['forms', '/forms'],
  ['haccp', '/haccp'], ['hygienic-design', '/hygienic-design'], ['imports', '/imports'],
  ['integrations', '/integrations'], ['internal-audits', '/internal-audits'],
  ['log-builder', '/log-builder/drafts'], ['loto', '/loto'], ['meetings', '/meetings'],
  ['mock-recalls', '/mock-recalls'], ['newsletter', '/newsletter/issues'], ['nfp', '/nfp'],
  ['office', '/office/supply'], ['org', '/org'], ['partners', '/partners'],
  ['pay', '/pay/employees'], ['pm', '/pm/work-orders'], ['policies', '/policies'],
  ['procurement', '/procurement/purchase-orders'], ['product-files', '/product-files'],
  ['production', '/production/entries'], ['products', '/products'],
  ['qa-review', '/qa-review'], ['qms', '/qms/deviation'],
  ['quality-schedules', '/quality-schedules'], ['receiving', '/receiving'],
  ['reimbursements', '/reimbursements'], ['retention', '/retention'], ['safety', '/safety'],
  ['sanitation', '/sanitation'], ['scale-verification', '/scale-verification/forms'],
  ['structure', '/structure/lists'], ['training', '/training/courses'],
  ['users', '/users'], ['visitors', '/visitors/visits'],
];

const reachable = [];
for (const [name, path] of NAMESPACES) {
  const res = await req(path);
  if (!REFUSED.has(res.status) && res.status !== 404) {
    const body = await J(res);
    const size = JSON.stringify(body ?? '').length;
    reachable.push(`${name} (HTTP ${res.status}, ${size} bytes)`);
  }
}
check('VK-13', 'No plant module answers a request that carries no session',
  `All ${NAMESPACES.length} mounted namespaces refuse`,
  reachable.length ? `REACHABLE: ${reachable.join('; ')}` : `all ${NAMESPACES.length} refused (401/403)`,
  reachable.length === 0);

/* ── E. The other public doors, from the same browser ───────────────────── */

r = await req('/users/lookup?q=adm');   // the seeded Admin — there must be a row to inspect
const look = await J(r);
check('VK-14', 'The staff name look-up hands out no account identifiers',
  'Names only — no id, no email, no phone, no role',
  Array.isArray(look) && look.length
    ? `fields: ${Object.keys(look[0]).join(', ')}`
    : `HTTP ${r.status}, ${Array.isArray(look) ? 0 : '?'} rows`,
  r.ok && Array.isArray(look) && look.length > 0
    && look.every(u => Object.keys(u).every(k => ['name', 'username', 'department'].includes(k))));

r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Admin' }) });
const li = await J(r);
check('VK-15', 'A name alone yields no session from the kiosk',
  'No token issued', `HTTP ${r.status}; token = ${li?.token ? 'ISSUED' : 'none'}`, !li?.token);

// The other public prefixes exist for people holding a token in the URL. From
// the kiosk, with no token, each must be a dead end.
for (const [id, path, label] of [
  ['VK-16', '/partner-portal/', 'the partner portal'],
  ['VK-17', '/auditor-pass/redeem', 'the auditor pass'],
  ['VK-18', '/nfp-link/abc', 'a nutrition-panel approval link'],
  ['VK-19', '/products/master.csv', 'the product master feed'],
]) {
  const res = await req(path);
  const body = await J(res);
  const size = JSON.stringify(body ?? '').length;
  check(id, `Without a token, ${label} returns nothing`,
    'Refused or empty',
    `HTTP ${res.status}, ${size} bytes`,
    !res.ok || size < 120);
}

/* ── F. Tampering with the kiosk's own write endpoints ──────────────────── */

r = await req('/visitor-kiosk/sign-in', {
  method: 'POST',
  body: JSON.stringify({ ...me, first_name: 'Escalate',
    signatures: signatures.map(sg => ({ ...sg, signed_name: `Escalate Case${stamp}` })),
    role: 'admin', is_active: 1, module_access: { qms: 'edit' }, custom_data: { anything: 'x' } }),
});
const esc = await J(r);
check('VK-20', 'Extra fields posted to sign-in cannot create an account or a role',
  'The visitor record is written; nothing touches users',
  `HTTP ${r.status}; response carries token = ${esc?.token ? 'YES' : 'no'}, role = ${esc?.role || 'none'}`,
  !esc?.token && !esc?.role);

let usersAfter = null;
if (DB) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  usersAfter = db.prepare("SELECT COUNT(*) c FROM users WHERE name LIKE 'Escalate%'").get().c;
  db.close();
}
check('VK-21', 'Signing in as a visitor creates no user account',
  'No row in users', `users named Escalate*: ${usersAfter}`, usersAfter === 0);

r = await req('/visitor-kiosk/sign-out', { method: 'POST', body: JSON.stringify({ visit_id: 'nope' }) });
check('VK-22', 'Signing out an unknown visit is refused',
  'HTTP 404', `HTTP ${r.status}`, r.status === 404);

// Writes the kiosk must not be able to make at all.
for (const [id, method, path, label] of [
  ['VK-23', 'POST', '/qms/deviation', 'file a quality record'],
  ['VK-24', 'POST', '/pm/work-orders', 'raise a work order'],
  ['VK-25', 'DELETE', '/visitors/visits/' + visitId, 'delete a visit'],
  ['VK-26', 'POST', '/users', 'create a user'],
  ['VK-27', 'PUT', '/visitors/agreements/1', 'rewrite the agreement being signed'],
]) {
  const res = await req(path, { method, body: JSON.stringify({ name: 'x' }) });
  check(id, `The kiosk cannot ${label}`, 'Refused', `HTTP ${res.status}`,
    !res.ok);
}

/* ── G. The served app itself ───────────────────────────────────────────── */

const page = await fetch(`${ORIGIN}/kiosk/visitor`);
const html = await page.text();
check('VK-28', 'The kiosk page ships no pre-loaded plant data',
  'The HTML shell carries no records and no token',
  `HTTP ${page.status}, ${html.length} bytes, no embedded state`,
  page.ok && !/__INITIAL_STATE__|window\.__DATA|auth_token"\s*:/.test(html) && html.length < 20000);

/* ── H. The other doors on the SAME public prefix ───────────────────────── */

// The QR-code kiosks (scale, knife, component, maintenance) share the public
// `/submit/` prefix with nothing gating them, so anybody who reaches the
// visitor tablet's browser can reach these too. They are CATALOGUES, not
// records — but what they carry is worth pinning down rather than assuming.
const CATALOGUES = [
  ['VK-29', '/submit/equipment-list', 'the equipment register'],
  ['VK-30', '/submit/knife-list', 'the knife and blade list'],
  ['VK-31', '/submit/maintenance-items', 'the tool and chemical catalogue'],
  ['VK-32', '/submit/scale-forms', 'the scale verification forms'],
];
for (const [id, path, label] of CATALOGUES) {
  const res = await req(path);
  const body = await J(res);
  const text = JSON.stringify(body ?? '');
  // The test is not "is it reachable" — it is reachable by design. The test is
  // that it carries NO PERSON and no record.
  const named = /"(employee_name|issued_to|performed_by|signed_by|completed_by|created_by)"\s*:\s*"[^"]+"/.test(text);
  check(id, `${label} is a catalogue and names nobody`,
    'Reachable by design (the QR kiosks need it) but carrying no person and no filed record',
    `HTTP ${res.status}, ${text.length} bytes, person named: ${named ? 'YES' : 'no'}`,
    !named);
}

r = await req('/submit/component-options');
const opts = await J(r);
check('VK-33', 'Kiosk suggestion lists come from that log alone, not from the plant',
  'item_names / part_numbers / mo_numbers only',
  `keys: ${Object.keys(opts || {}).join(', ')}`,
  !!opts && ['item_names', 'part_numbers', 'mo_numbers'].every(k => Array.isArray(opts[k]))
    && Object.keys(opts).every(k => ['item_names', 'part_numbers', 'mo_numbers'].includes(k)));

/* ── I. Files on disk ───────────────────────────────────────────────────── */

let res = await fetch(`${ORIGIN}/uploads/`);
let text = await res.text();
// A directory listing of this folder would contain UUID filenames. The app
// shell legitimately links apple-touch-icon.png, so "contains a .png" is not
// the test — "contains a stored file's name" is.
const looksLikeListing = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+/i.test(text);
check('VK-34', 'The upload directory cannot be listed',
  'No index of what has been uploaded — the app shell is returned instead',
  `HTTP ${res.status}, ${res.headers.get('content-type')}, ${text.length} bytes; stored filenames present: ${looksLikeListing ? 'YES' : 'no'}`,
  !looksLikeListing);

res = await fetch(`${ORIGIN}/uploads/00000000-0000-0000-0000-000000000000.png`);
text = await res.text();
// The test is that no FILE comes back, not which non-file does. This used to
// fall through to the app shell; it is a 404 now that /uploads needs a session,
// and asserting on the old shape would have read as a regression when the
// behaviour had improved.
check('VK-35', 'A guessed upload filename returns no file',
  'Not an image — names are random and the folder now needs a session as well',
  `HTTP ${res.status}, ${res.headers.get('content-type')}, ${text.length} bytes`,
  !/^image\//.test(res.headers.get('content-type') || ''));

// The gate itself, which is the new part.
res = await fetch(`${ORIGIN}/uploads/anything.png`);
check('VK-35b', 'Uploaded files need a session, not just the filename',
  'Refused with 404 — a 403 would confirm the file exists',
  `HTTP ${res.status}`, res.status === 404);

/* ── J. Realtime ────────────────────────────────────────────────────────── */

// socket.io is where an unauthenticated listener would get a live feed of every
// message in the plant, so this is probed with a REAL CLIENT.
//
// A raw HTTP probe of /socket.io/ is not the test and reports the wrong answer:
// the Engine.IO transport handshake returns 200 with a session id BEFORE the
// namespace middleware runs, so it looks like a connection when it is not one.
// Only an actual client reaches `io.use()`, which is where the token is checked.
const { io } = await import('socket.io-client');
const trySocket = (auth) => new Promise((resolve) => {
  const sock = io(ORIGIN, { transports: ['polling'], reconnection: false, timeout: 4000, ...(auth ? { auth } : {}) });
  const done = (v) => { try { sock.close(); } catch { /* already closed */ } resolve(v); };
  sock.on('connect', () => done({ connected: true }));
  sock.on('connect_error', (e) => done({ connected: false, error: e.message }));
  setTimeout(() => done({ connected: false, error: 'timed out' }), 6000);
});
const anon = await trySocket(null);
const forged = await trySocket({ token: 'not-a-real-token' });
check('VK-36', 'The realtime socket refuses a client with no token and a forged one',
  'Both rejected — no live feed of plant messages',
  `no token: ${anon.connected ? 'CONNECTED' : anon.error} · forged: ${forged.connected ? 'CONNECTED' : forged.error}`,
  !anon.connected && !forged.connected);

/* ── K. The QR posters carry their own key ──────────────────────────────── */

// Ships OFF, so the checks above describe the plant as it runs today. What this
// records is that the control EXISTS and that turning it on cannot be done
// carelessly — the sequence is verified separately in the kiosk-token tests.
res = await fetch(`${ORIGIN}/api/kiosk-tokens`);
check('VK-37', 'Kiosk keys are managed by admins only',
  'Refused without an admin session',
  `HTTP ${res.status}`, REFUSED.has(res.status));

console.log(JSON.stringify(results, null, 1));
const failed = results.filter(x => x.verdict === 'FAIL');
console.error(`\n${results.length - failed.length} PASS / ${failed.length} FAIL`);
for (const f of failed) console.error(`  FAIL ${f.id} ${f.title}\n        expected: ${f.expected}\n        actual:   ${f.actual}`);
process.exit(failed.length);
