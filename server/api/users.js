import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import crypto from 'crypto';
import { requireRole } from '../middleware/auth.js';
import { passwordDaysLeft, passwordExpired } from '../password-policy.js';
import { ALL_MODULE_IDS } from '../module-access.js';
import { uniqueUsername, validateUsername, deriveUsername } from '../usernames.js';
import { smsEnabled, sendOptIn } from '../sms.js';

const router = Router();

// New accounts join the Slack-style default channels (#general, #announcements)
// so everyone is reachable there from day one.
function joinDefaultChannels(db, userId) {
  try {
    const add = db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, 'member')");
    for (const c of db.prepare('SELECT id FROM chat_channels WHERE is_default = 1').all()) add.run(uuid(), c.id, userId);
  } catch { /* chat tables may not exist in some contexts */ }
}

// --- Password hashing (scrypt; no external deps) ---------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}
function issueSession(db, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuid(), user.id, token, expires.toISOString());
  const moduleAccess = user.module_access ? JSON.parse(user.module_access) : null;
  let quickTabs;
  try { quickTabs = user.quick_tabs ? JSON.parse(user.quick_tabs) : null; } catch { quickTabs = null; }
  const daysLeft = passwordDaysLeft(user.password_changed_at);
  return { token, user: { id: user.id, name: user.name, username: user.username || user.name, role: user.role, department: user.department || 'warehouse', module_access: moduleAccess, home_workspace: user.home_workspace || 'fsqa', quick_tabs: quickTabs, password_days_left: daysLeft, password_expired: passwordExpired(user.password_changed_at) } };
}

// --- User CRUD ---

router.get('/', (req, res) => {
  const db = getDb();
  const { role, active } = req.query;
  let sql = 'SELECT id, name, username, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, home_workspace, quick_tabs, phone, sms_access, sms_consent_at, sms_consent_by, created_at FROM users WHERE 1=1';
  const params = [];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  if (active !== undefined) { sql += ' AND is_active = ?'; params.push(active === 'true' ? 1 : 0); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/technicians', (_req, res) => {
  const db = getDb();
  const techs = db.prepare("SELECT id, name, role, department FROM users WHERE is_active = 1 AND role IN ('operator','supervisor') ORDER BY name").all();
  res.json(techs);
});

router.get('/me', (req, res) => {
  const row = getDb().prepare('SELECT home_workspace, quick_tabs, username, password_changed_at FROM users WHERE id = ?').get(req.user.id) || {};
  let quickTabs;
  try { quickTabs = row.quick_tabs ? JSON.parse(row.quick_tabs) : null; } catch { quickTabs = null; }
  res.json({ id: req.user.id, name: req.user.name, username: row.username || req.user.name, role: req.user.role, department: req.user.department, module_access: req.user.module_access, home_workspace: row.home_workspace || 'fsqa', quick_tabs: quickTabs, password_days_left: passwordDaysLeft(row.password_changed_at), password_expired: passwordExpired(row.password_changed_at) });
});

// The caller's drawn signature — fetched only when a signing surface needs it,
// not on every /me (it's an image, and the shell doesn't want it).
router.get('/me/signature', (req, res) => {
  const row = getDb().prepare('SELECT signature_image FROM users WHERE id = ?').get(req.user.id);
  res.json({ signature_image: row?.signature_image || null });
});

// Save the caller's drawn signature. Own signature only — there is no admin
// path to set someone else's, because a signature drawn by someone else is
// not a signature. Re-drawing replaces the CURRENT image; documents already
// signed keep the snapshot they were signed with.
router.post('/me/signature', (req, res) => {
  const img = String(req.body?.image || '');
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(img)) {
    return res.status(400).json({ error: 'The signature must be a drawn PNG or JPEG image.' });
  }
  if (img.length > 200_000) {
    return res.status(400).json({ error: 'That signature image is too large — draw it again on the pad.' });
  }
  getDb().prepare("UPDATE users SET signature_image = ? WHERE id = ?").run(img, req.user.id);
  logAudit(req.user, 'signature_saved', 'user', req.user.id, {}, null, null, req.user.name);
  res.json({ ok: true });
});

// Let a user set their own default landing workspace.
router.post('/me/home', (req, res) => {
  const w = req.body?.workspace === 'messages' ? 'messages' : 'fsqa';
  getDb().prepare("UPDATE users SET home_workspace = ?, updated_at = datetime('now') WHERE id = ?").run(w, req.user.id);
  res.json({ ok: true, home_workspace: w });
});

// A user's reusable drawn signature for e-signing documents (COAs). Stored as
// a PNG data URL; drawn once in the sign modal and reused afterwards.
const SIGNATURE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
router.get('/me/signature', (req, res) => {
  const row = getDb().prepare('SELECT signature_image FROM users WHERE id = ?').get(req.user.id);
  res.json({ signature: row?.signature_image || null });
});
router.post('/me/signature', (req, res) => {
  const sig = req.body?.signature ?? null;
  if (sig !== null && (typeof sig !== 'string' || sig.length > 400000 || !SIGNATURE_RE.test(sig))) {
    return res.status(400).json({ error: 'Signature must be a PNG/JPEG data URL under 300 KB.' });
  }
  getDb().prepare("UPDATE users SET signature_image = ?, updated_at = datetime('now') WHERE id = ?").run(sig, req.user.id);
  logAudit(req.user, 'update', 'user_signature', req.user.id, { cleared: sig === null }, null, null, req.user.name);
  res.json({ ok: true });
});

// Self-service password change: confirm the current password, then set a new one.
// (First-time users with no password yet use /set-password instead.)
router.post('/me/password', (req, res) => {
  const db = getDb();
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < MIN_PASSWORD) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` });
  const me = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!me?.password_hash) return res.status(400).json({ error: 'No password set yet. Sign out and set one from the login screen.' });
  if (!verifyPassword(String(current_password || ''), me.password_hash)) return res.status(401).json({ error: 'Your current password is incorrect.' });
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(hashPassword(new_password), req.user.id);
  logAudit(req.user, 'password_change', 'user', req.user.id, { self: true }, null, null, req.user.name);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  if (req.user) logAudit(req.user, 'logout', 'user', req.user.id, null, null, null, req.user.name);
  res.json({ ok: true });
});

router.get('/lookup', (req, res) => {
  const db = getDb();
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const users = db.prepare(`SELECT id, name, COALESCE(username, name) AS username, department FROM users
     WHERE is_active = 1 AND (LOWER(name) LIKE LOWER(?) OR LOWER(username) LIKE LOWER(?))
     ORDER BY username LIMIT 10`).all(`%${q}%`, `%${q}%`);
  res.json(users);
});

// NOTE: must be registered before '/:id' so it isn't captured as an id.
// Report likely duplicate people so an admin can merge them. Groups by a
// normalized-name key (high confidence); then pairs remaining users whose
// normalized names are near-identical (prefix/substring or edit distance ≤ 2)
// as "possible". Each user carries its chat message count to help pick which
// record to keep.
router.get('/duplicates', requireRole('admin'), (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, name, email, role, department, is_active, created_at FROM users').all();
  const msgCount = db.prepare('SELECT COUNT(*) c FROM chat_messages WHERE user_id = ?');
  const decorate = (u) => ({ ...u, message_count: msgCount.get(u.id).c });

  const byKey = {};
  for (const u of users) { const k = normName(u.name); if (!k) continue; (byKey[k] ||= []).push(u); }

  const groups = [];
  const grouped = new Set();
  // High-confidence: same normalized key.
  for (const [, list] of Object.entries(byKey)) {
    if (list.length > 1) { groups.push({ confidence: 'high', users: list.map(decorate) }); list.forEach(u => grouped.add(u.id)); }
  }
  // Possible: near-identical normalized names across the remaining singletons.
  const singles = users.filter(u => !grouped.has(u.id) && normName(u.name));
  for (let i = 0; i < singles.length; i++) {
    if (grouped.has(singles[i].id)) continue;
    for (let j = i + 1; j < singles.length; j++) {
      if (grouped.has(singles[j].id)) continue;
      const a = normName(singles[i].name), b = normName(singles[j].name);
      const near = a === b || a.startsWith(b) || b.startsWith(a) || (Math.abs(a.length - b.length) <= 3 && levenshtein(a, b) <= 2);
      if (near) {
        groups.push({ confidence: 'possible', users: [decorate(singles[i]), decorate(singles[j])] });
        grouped.add(singles[i].id); grouped.add(singles[j].id);
      }
    }
  }
  res.json({ groups });
});

// Must precede /:id or "access-templates" would be parsed as a user id.
router.get('/access-templates', requireRole('admin'), (_req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'access_templates'").get();
  let templates;
  try { templates = row ? JSON.parse(row.value) : {}; } catch { templates = {}; }
  res.json({ templates });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, department, is_active, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.get('/:id/pin', requireRole('admin'), (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, pin FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ pin: user.pin || null });
});

router.post('/', requireRole('admin'), (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, username, email, pin, role, department, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  let signIn;
  if (username) {
    const check = validateUsername(db, username, null);
    if (check.error) return res.status(400).json({ error: check.error });
    signIn = check.username;
  } else {
    signIn = uniqueUsername(db, name, null);
  }

  const moduleAccessStr = module_access ? JSON.stringify(module_access) : null;
  db.prepare('INSERT INTO users (id, name, username, email, pin, role, department, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, signIn, email || null, pin || null, role || 'operator', department || 'warehouse', is_contractor ? 1 : 0, contractor_company || null, contractor_license || null, contractor_insurance_expiry || null, contractor_scope || null, moduleAccessStr);

  joinDefaultChannels(db, id);
  const created = db.prepare('SELECT id, name, username, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, phone, sms_access, created_at FROM users WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'user', id, { name, role: role || 'operator', department: department || 'warehouse' }, null, null, name);
  res.status(201).json(created);
});

// Bulk-add users (one per line elsewhere; here an array of {name, role, department}).
router.post('/bulk', requireRole('admin'), (req, res) => {
  const db = getDb();
  const list = Array.isArray(req.body?.users) ? req.body.users : [];
  if (!list.length) return res.status(400).json({ error: 'users array is required' });
  const ROLES = ['admin', 'supervisor', 'operator', 'auditor'];
  const ins = db.prepare('INSERT INTO users (id, name, username, email, role, department, module_access) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let created = 0; const names = [];
  const tx = db.transaction(() => {
    for (const u of list) {
      const name = (u.name || '').trim();
      if (!name) continue;
      const role = ROLES.includes(u.role) ? u.role : 'operator';
      const nid = uuid();
      ins.run(nid, name, uniqueUsername(db, name, null), u.email || null, role, u.department || 'warehouse', u.module_access ? JSON.stringify(u.module_access) : null);
      joinDefaultChannels(db, nid);
      created++; names.push(name);
    }
  });
  tx();
  logAudit(req.user, 'users_bulk_created', 'user', null, { created, names }, null, null);
  res.json({ created });
});

// Apply a module-access map to several users at once (admins are left untouched).
// mode 'merge' (default): only the modules present in the patch change — each
// user's other module settings are preserved. A user with unrestricted access
// (null) is materialized to an explicit all-edit map first so the patch can't
// silently expand or shrink anything else. Patch level 'none' removes access.
// mode 'replace': the old behavior — the map overwrites each user's access
// entirely (module_access null = reset to full access).
router.post('/bulk-access', requireRole('admin'), (req, res) => {
  const db = getDb();
  const { user_ids, module_access, mode } = req.body;
  if (!Array.isArray(user_ids) || !user_ids.length) return res.status(400).json({ error: 'user_ids is required' });
  const merge = mode !== 'replace';
  const upd = db.prepare("UPDATE users SET module_access = ?, updated_at = datetime('now') WHERE id = ? AND role != 'admin'");
  let updated = 0;
  const tx = db.transaction(() => {
    for (const id of user_ids) {
      let str;
      if (!merge) {
        str = module_access ? JSON.stringify(module_access) : null;
      } else {
        const patch = module_access || {};
        if (!Object.keys(patch).length) continue; // nothing to change
        const row = db.prepare("SELECT module_access FROM users WHERE id = ? AND role != 'admin'").get(id);
        if (!row) continue;
        let base;
        try { base = row.module_access ? JSON.parse(row.module_access) : null; } catch { base = null; }
        if (Array.isArray(base)) base = Object.fromEntries(base.map(m => [m, 'edit'])); // legacy list
        if (base == null) base = Object.fromEntries(ALL_MODULE_IDS.map(m => [m, 'edit'])); // unrestricted → explicit
        for (const [mid, lvl] of Object.entries(patch)) {
          if (lvl === 'none' || lvl == null) delete base[mid];
          else base[mid] = lvl === 'edit' ? 'edit' : 'view';
        }
        str = JSON.stringify(base);
      }
      updated += upd.run(str, id).changes;
    }
  });
  tx();
  logAudit(req.user, 'permission_change', 'user', null, { bulk: true, mode: merge ? 'merge' : 'replace', count: updated }, null, null);
  res.json({ updated });
});

// ── Access templates ─────────────────────────────────────────────────────────
// Named module-access maps ("QA Tech", "Production Operator") stored once and
// applied to users, so individuals are exceptions rather than hand-built.
// (The GET lives above the /:id route — see route order note there.)
router.put('/access-templates', requireRole('admin'), (req, res) => {
  const db = getDb();
  const { name, access } = req.body; // access null/absent deletes the template
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return res.status(400).json({ error: 'Template name is required' });
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'access_templates'").get();
  let templates;
  try { templates = row ? JSON.parse(row.value) : {}; } catch { templates = {}; }
  if (access && typeof access === 'object') templates[clean] = access;
  else delete templates[clean];
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('access_templates', ?, datetime('now'))")
    .run(JSON.stringify(templates));
  logAudit(req.user, 'permission_change', 'user', null, { template: clean, deleted: !access }, null, null);
  res.json({ templates });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, username, email, pin, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, home_workspace, quick_tabs, phone, sms_access } = req.body;

  // An admin-set username wins. Otherwise, if the full name changed and the
  // current username is still the one we derived from the old name, follow the
  // rename; a hand-picked username is left alone.
  let signIn = existing.username;
  if (username !== undefined && username !== null && username !== existing.username) {
    const check = validateUsername(db, username, req.params.id);
    if (check.error) return res.status(400).json({ error: check.error });
    signIn = check.username;
  } else if (name && name !== existing.name && existing.username === deriveUsername(existing.name)) {
    signIn = uniqueUsername(db, name, req.params.id);
  }
  if (!signIn) signIn = uniqueUsername(db, name || existing.name, req.params.id);
  const moduleAccessStr = module_access !== undefined ? (module_access ? JSON.stringify(module_access) : null) : existing.module_access;
  // Stored as the ten digits and nothing else, so what Settings holds and what
  // Twilio sends compare cleanly however either was typed.
  const phoneVal = phone !== undefined ? (String(phone).replace(/\D/g, '').slice(-10) || null) : existing.phone;
  // Texting the system is a GRANT, never a side effect of recording a number:
  // it lets an inbound text be answered with plant data.
  const smsVal = sms_access !== undefined ? (sms_access ? 1 : 0) : (existing.sms_access || 0);
  // Consent is stamped the moment it is first given and is NOT re-stamped on
  // every later edit — the date it was obtained is the fact that matters. It is
  // cleared if the grant is withdrawn, so a stale consent date can never sit
  // against somebody who has opted out.
  const hadConsent = !!existing.sms_consent_at;
  const consentAt = smsVal ? (existing.sms_consent_at || new Date().toISOString()) : null;
  const consentBy = smsVal ? (hadConsent ? existing.sms_consent_by : (req.user?.name || 'system')) : null;
  const homeWorkspace = home_workspace !== undefined ? (home_workspace === 'messages' ? 'messages' : 'fsqa') : existing.home_workspace;
  const quickTabsStr = quick_tabs !== undefined
    ? (Array.isArray(quick_tabs) && quick_tabs.length ? JSON.stringify(quick_tabs.slice(0, 4).map(String)) : null)
    : existing.quick_tabs;
  db.prepare(`UPDATE users SET name=?, username=?, email=?, pin=COALESCE(?, pin), role=?, department=?, is_active=?, is_contractor=?, contractor_company=?, contractor_license=?, contractor_insurance_expiry=?, contractor_scope=?, module_access=?, home_workspace=?, quick_tabs=?, phone=?, sms_access=?, sms_consent_at=?, sms_consent_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(name || existing.name, signIn, email ?? existing.email, pin || null, role || existing.role,
      department || existing.department || 'warehouse',
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      is_contractor !== undefined ? (is_contractor ? 1 : 0) : (existing.is_contractor || 0),
      contractor_company ?? existing.contractor_company, contractor_license ?? existing.contractor_license,
      contractor_insurance_expiry ?? existing.contractor_insurance_expiry, contractor_scope ?? existing.contractor_scope,
      moduleAccessStr, homeWorkspace, quickTabsStr, phoneVal, smsVal, consentAt, consentBy,
      req.params.id);

  const updated = db.prepare('SELECT id, name, username, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, phone, sms_access, created_at FROM users WHERE id = ?').get(req.params.id);

  // Surface security-relevant changes (role, active status, module permissions)
  // as their own explicit audit actions so they're easy to filter for.
  const changes = {};
  if (updated.role !== existing.role) changes.role = { from: existing.role, to: updated.role };
  if (updated.is_active !== existing.is_active) changes.is_active = { from: existing.is_active, to: updated.is_active };
  if (updated.username !== existing.username) changes.username = { from: existing.username, to: updated.username };
  const permsChanged = (existing.module_access || null) !== (updated.module_access || null);
  if (permsChanged) changes.module_access = { changed: true };
  const securityChange = changes.role || changes.is_active || permsChanged;
  logAudit(req.user, securityChange ? 'permission_change' : 'update', 'user', req.params.id,
    Object.keys(changes).length ? changes : null, existing, updated, updated.name);

  // THE FIRST TEXT A NEWLY CONSENTED NUMBER GETS IS THE CONFIRMATION, not an
  // approval link. Consent here is verbal, given to an administrator, so this
  // is what puts it in writing on the recipient's own phone along with the way
  // out of it. Sent once, on the transition — re-saving the record later must
  // not re-text somebody who has been on the list for months.
  //
  // The row is ALREADY WRITTEN by this point, so a Twilio outage cannot undo a
  // recorded consent; it is awaited only so the admin is told which happened.
  // Silence after pressing Save is the exact failure this whole SMS path keeps
  // running into.
  let optinSent = false, optinError = null;
  if (!hadConsent && consentAt && phoneVal && smsEnabled()) {
    try {
      const r = await sendOptIn(phoneVal);
      optinSent = true;
      logAudit(req.user, 'create', 'sms_optin', req.params.id,
        { to: `…${phoneVal.slice(-4)}`, sid: r?.sid || null, consent_recorded_by: consentBy },
        null, null, updated.name);
    } catch (e) { optinError = e.message; }
  }
  res.json({ ...updated, optin_sent: optinSent, optin_error: optinError });
});

// --- Auth ---

// Basic brute-force protection: lock a name out after repeated bad passwords
const failedLogins = new Map(); // name(lower) -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 8;

router.post('/login', (req, res) => {
  const db = getDb();
  const { password, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const key = name.toLowerCase();
  const entry = failedLogins.get(key);
  if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
  }

  // The short username is what people are told to use, but the full name keeps
  // working — nobody gets locked out by the switch.
  const user = db.prepare(`SELECT * FROM users WHERE is_active = 1 AND (LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?))
     ORDER BY (LOWER(username) = LOWER(?)) DESC LIMIT 1`).get(name, name, name);
  if (!user) {
    logAudit(name, 'login_failed', 'user', null, { reason: 'unknown_user' }, null, null, name);
    return res.status(401).json({ error: 'User not found. Ask your admin to add you.' });
  }

  // No password yet → first-login set-password flow. has_pin means an existing
  // staffer transitioning from PIN (they must confirm their current PIN).
  if (!user.password_hash) {
    return res.status(200).json({ needs_password_setup: true, user_id: user.id, user_name: user.username || user.name, has_pin: !!user.pin });
  }

  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (!verifyPassword(password, user.password_hash)) {
    const count = (entry?.count || 0) + 1;
    const locked = count >= MAX_ATTEMPTS;
    failedLogins.set(key, { count, lockedUntil: locked ? Date.now() + LOCKOUT_MS : null });
    logAudit(user, locked ? 'login_locked' : 'login_failed', 'user', user.id,
      { reason: 'bad_password', attempt: count }, null, null, user.name);
    return res.status(401).json({ error: 'Invalid password' });
  }
  failedLogins.delete(key);

  logAudit(user, 'login', 'user', user.id, null, null, null, user.name);
  res.json(issueSession(db, user));
});

// First-login / self-serve password set. A user transitioning from a PIN must
// prove it with current_pin; a PIN-less (e.g. imported) user sets one directly.
router.post('/set-password', (req, res) => {
  const db = getDb();
  const { user_id, password, current_pin } = req.body;
  if (!user_id || !password) return res.status(400).json({ error: 'user_id and password are required' });
  if (String(password).length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.password_hash) return res.status(400).json({ error: 'Password already set. Sign in with your password.' });
  if (user.pin && current_pin !== user.pin) return res.status(401).json({ error: 'Your current PIN is incorrect.' });

  // Set the password and retire the PIN.
  db.prepare("UPDATE users SET password_hash = ?, pin = NULL, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(hashPassword(password), user_id);
  logAudit(user, 'set_password', 'user', user.id, null, null, null, user.name);
  res.json(issueSession(db, { ...user, password_hash: '1' }));
});

// Admin reset: one click clears the user's password so their next sign-in runs
// the first-time set-password flow (they choose a brand-new password themselves,
// no temporary one to hand off). Existing sessions are dropped so the reset
// takes effect everywhere immediately.
router.post('/:id/reset-password', requireRole('admin'), (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare("UPDATE users SET password_hash = NULL, pin = NULL, password_changed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // force re-auth
  logAudit(req.user, 'password_reset', 'user', user.id, { by_admin: true, mode: 'send_to_setup' }, null, null, user.name);
  res.json({ ok: true });
});

// ── Duplicate detection + merge (post-import cleanup) ─────────────────────────
// Normalize a name for comparison: lowercase, strip everything but letters/
// digits. "Adam B." and "adamb" both collapse to "adamb".
function normName(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

// Merge one user (the "from" duplicate) into another ("into" — the record to
// keep). Reassigns all chat authorship/reactions/mentions/memberships, then
// deletes the duplicate account. Chat-scoped by design: import duplicates have
// no operational (work-order/audit) history under their own id.
router.post('/:id/merge', requireRole('admin'), (req, res) => {
  const db = getDb();
  const fromId = req.params.id;
  const intoId = req.body?.into;
  if (!intoId || intoId === fromId) return res.status(400).json({ error: 'A different target user is required' });
  const from = db.prepare('SELECT * FROM users WHERE id = ?').get(fromId);
  const into = db.prepare('SELECT * FROM users WHERE id = ?').get(intoId);
  if (!from || !into) return res.status(404).json({ error: 'User not found' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE chat_messages SET user_id = ? WHERE user_id = ?').run(intoId, fromId);
    // Reactions & memberships have uniqueness constraints — move what won't
    // collide, drop the rest (the target already reacted / is a member).
    db.prepare('UPDATE OR IGNORE chat_reactions SET user_id = ? WHERE user_id = ?').run(intoId, fromId);
    db.prepare('DELETE FROM chat_reactions WHERE user_id = ?').run(fromId);
    db.prepare('UPDATE chat_mentions SET user_id = ? WHERE user_id = ?').run(intoId, fromId);
    db.prepare('UPDATE OR IGNORE chat_channel_members SET user_id = ? WHERE user_id = ?').run(intoId, fromId);
    db.prepare('DELETE FROM chat_channel_members WHERE user_id = ?').run(fromId);
    // Clean up auth artifacts, then remove the duplicate account.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(fromId);
    try { db.prepare('DELETE FROM chat_push_subscriptions WHERE user_id = ?').run(fromId); } catch { /* table may not exist */ }
    db.prepare('DELETE FROM users WHERE id = ?').run(fromId);
  });
  tx();
  logAudit(req.user, 'merge', 'user', intoId, { merged_from: from.name, merged_from_id: fromId }, null, null, into.name);
  res.json({ ok: true, merged_into: intoId });
});

// Permanently remove a user. Guarded: refuses if the person has any activity
// history (chat messages or task records) — those must be preserved, so the
// admin is told to Deactivate (or Merge) instead. Safe for erroneous/empty
// accounts (e.g. an import mistake).
router.delete('/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
  let messages = 0, tasks = 0;
  try { messages = db.prepare('SELECT COUNT(*) c FROM chat_messages WHERE user_id = ?').get(u.id).c; } catch { /* table may be absent */ }
  try { tasks = db.prepare('SELECT COUNT(*) c FROM work_orders WHERE completed_by = ? OR assigned_to = ?').get(u.name, u.name).c; } catch { /* absent */ }
  if (messages > 0 || tasks > 0) {
    return res.status(409).json({
      error: 'This person has activity history and can\'t be permanently removed. Deactivate them instead (keeps their history but blocks login), or merge them into another account.',
      messages, tasks,
    });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    for (const t of ['chat_channel_members', 'chat_push_subscriptions', 'chat_mentions', 'chat_reactions']) {
      try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id); } catch { /* table may not exist */ }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  });
  tx();
  logAudit(req.user, 'delete', 'user', u.id, { name: u.name, role: u.role }, null, null, u.name);
  res.json({ ok: true, removed: u.id });
});

export { hashPassword };
export default router;
