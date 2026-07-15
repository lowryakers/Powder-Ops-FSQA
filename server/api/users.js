import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import crypto from 'crypto';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// --- User CRUD ---

router.get('/', (req, res) => {
  const db = getDb();
  const { role, active } = req.query;
  let sql = 'SELECT id, name, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, created_at FROM users WHERE 1=1';
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
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role, department: req.user.department, module_access: req.user.module_access });
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
  const users = db.prepare("SELECT id, name, department FROM users WHERE is_active = 1 AND LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 10").all(`%${q}%`);
  res.json(users);
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
  const { name, email, pin, role, department, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const moduleAccessStr = module_access ? JSON.stringify(module_access) : null;
  db.prepare('INSERT INTO users (id, name, email, pin, role, department, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, email || null, pin || null, role || 'operator', department || 'warehouse', is_contractor ? 1 : 0, contractor_company || null, contractor_license || null, contractor_insurance_expiry || null, contractor_scope || null, moduleAccessStr);

  const created = db.prepare('SELECT id, name, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, created_at FROM users WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'user', id, { name, role: role || 'operator', department: department || 'warehouse' }, null, null, name);
  res.status(201).json(created);
});

// Bulk-add users (one per line elsewhere; here an array of {name, role, department}).
router.post('/bulk', requireRole('admin'), (req, res) => {
  const db = getDb();
  const list = Array.isArray(req.body?.users) ? req.body.users : [];
  if (!list.length) return res.status(400).json({ error: 'users array is required' });
  const ROLES = ['admin', 'supervisor', 'operator', 'auditor'];
  const ins = db.prepare('INSERT INTO users (id, name, email, role, department, module_access) VALUES (?, ?, ?, ?, ?, ?)');
  let created = 0; const names = [];
  const tx = db.transaction(() => {
    for (const u of list) {
      const name = (u.name || '').trim();
      if (!name) continue;
      const role = ROLES.includes(u.role) ? u.role : 'operator';
      ins.run(uuid(), name, u.email || null, role, u.department || 'warehouse', u.module_access ? JSON.stringify(u.module_access) : null);
      created++; names.push(name);
    }
  });
  tx();
  logAudit(req.user, 'users_bulk_created', 'user', null, { created, names }, null, null);
  res.json({ created });
});

// Apply a module-access map to several users at once (admins are left untouched).
router.post('/bulk-access', requireRole('admin'), (req, res) => {
  const db = getDb();
  const { user_ids, module_access } = req.body;
  if (!Array.isArray(user_ids) || !user_ids.length) return res.status(400).json({ error: 'user_ids is required' });
  const str = module_access ? JSON.stringify(module_access) : null;
  const upd = db.prepare("UPDATE users SET module_access = ?, updated_at = datetime('now') WHERE id = ? AND role != 'admin'");
  let updated = 0;
  const tx = db.transaction(() => { for (const id of user_ids) updated += upd.run(str, id).changes; });
  tx();
  logAudit(req.user, 'permission_change', 'user', null, { bulk: true, count: updated }, null, null);
  res.json({ updated });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, email, pin, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access } = req.body;
  const moduleAccessStr = module_access !== undefined ? (module_access ? JSON.stringify(module_access) : null) : existing.module_access;
  db.prepare(`UPDATE users SET name=?, email=?, pin=COALESCE(?, pin), role=?, department=?, is_active=?, is_contractor=?, contractor_company=?, contractor_license=?, contractor_insurance_expiry=?, contractor_scope=?, module_access=?, updated_at=datetime('now') WHERE id=?`)
    .run(name || existing.name, email ?? existing.email, pin || null, role || existing.role,
      department || existing.department || 'warehouse',
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      is_contractor !== undefined ? (is_contractor ? 1 : 0) : (existing.is_contractor || 0),
      contractor_company ?? existing.contractor_company, contractor_license ?? existing.contractor_license,
      contractor_insurance_expiry ?? existing.contractor_insurance_expiry, contractor_scope ?? existing.contractor_scope,
      moduleAccessStr,
      req.params.id);

  const updated = db.prepare('SELECT id, name, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, created_at FROM users WHERE id = ?').get(req.params.id);

  // Surface security-relevant changes (role, active status, module permissions)
  // as their own explicit audit actions so they're easy to filter for.
  const changes = {};
  if (updated.role !== existing.role) changes.role = { from: existing.role, to: updated.role };
  if (updated.is_active !== existing.is_active) changes.is_active = { from: existing.is_active, to: updated.is_active };
  const permsChanged = (existing.module_access || null) !== (updated.module_access || null);
  if (permsChanged) changes.module_access = { changed: true };
  const securityChange = changes.role || changes.is_active || permsChanged;
  logAudit(req.user, securityChange ? 'permission_change' : 'update', 'user', req.params.id,
    Object.keys(changes).length ? changes : null, existing, updated, updated.name);
  res.json(updated);
});

// --- Auth ---

// Basic brute-force protection: lock a name out after repeated bad PINs
const failedLogins = new Map(); // name(lower) -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

router.post('/login', (req, res) => {
  const db = getDb();
  const { pin, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const key = name.toLowerCase();
  const entry = failedLogins.get(key);
  if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(name) = LOWER(?) AND is_active = 1').get(name);
  if (!user) {
    logAudit(name, 'login_failed', 'user', null, { reason: 'unknown_user' }, null, null, name);
    return res.status(401).json({ error: 'User not found. Ask your admin to add you.' });
  }

  if (!user.pin) {
    return res.status(200).json({ needs_pin_setup: true, user_id: user.id, user_name: user.name });
  }

  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  if (user.pin !== pin) {
    const count = (entry?.count || 0) + 1;
    const locked = count >= MAX_ATTEMPTS;
    failedLogins.set(key, { count, lockedUntil: locked ? Date.now() + LOCKOUT_MS : null });
    logAudit(user, locked ? 'login_locked' : 'login_failed', 'user', user.id,
      { reason: 'bad_pin', attempt: count }, null, null, user.name);
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  failedLogins.delete(key);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), user.id, token, expires.toISOString());

  logAudit(user, 'login', 'user', user.id, null, null, null, user.name);
  const moduleAccess = user.module_access ? JSON.parse(user.module_access) : null;
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, department: user.department || 'warehouse', module_access: moduleAccess } });
});

router.post('/set-pin', (req, res) => {
  const db = getDb();
  const { user_id, pin } = req.body;
  if (!user_id || !pin) return res.status(400).json({ error: 'user_id and pin are required' });
  if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.pin) return res.status(400).json({ error: 'PIN already set. Use your existing PIN to sign in.' });

  db.prepare("UPDATE users SET pin = ?, updated_at = datetime('now') WHERE id = ?").run(pin, user_id);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), user.id, token, expires.toISOString());

  logAudit(user, 'set_pin', 'user', user.id, null, null, null, user.name);
  const moduleAccess = user.module_access ? JSON.parse(user.module_access) : null;
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, department: user.department || 'warehouse', module_access: moduleAccess } });
});

export default router;
