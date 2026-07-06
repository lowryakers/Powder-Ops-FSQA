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

router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, email, pin, role, department, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const moduleAccessStr = module_access ? JSON.stringify(module_access) : null;
  db.prepare('INSERT INTO users (id, name, email, pin, role, department, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, email || null, pin || null, role || 'operator', department || 'warehouse', is_contractor ? 1 : 0, contractor_company || null, contractor_license || null, contractor_insurance_expiry || null, contractor_scope || null, moduleAccessStr);

  const created = db.prepare('SELECT id, name, email, role, department, is_active, is_contractor, contractor_company, contractor_license, contractor_insurance_expiry, contractor_scope, module_access, created_at FROM users WHERE id = ?').get(id);
  logAudit(req.user.name, 'create', 'user', id, { name, role: role || 'operator', department: department || 'warehouse' }, null, null);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
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
  logAudit(req.user.name, 'update', 'user', req.params.id, null, null, null);
  res.json(updated);
});

// --- Auth ---

router.post('/login', (req, res) => {
  const db = getDb();
  const { pin, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const user = db.prepare('SELECT * FROM users WHERE LOWER(name) = LOWER(?) AND is_active = 1').get(name);
  if (!user) return res.status(401).json({ error: 'User not found. Ask your admin to add you.' });

  if (!user.pin) {
    return res.status(200).json({ needs_pin_setup: true, user_id: user.id, user_name: user.name });
  }

  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  if (user.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), user.id, token, expires.toISOString());

  logAudit(user.name, 'login', 'user', user.id, null, null, null);
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

  logAudit(user.name, 'set_pin', 'user', user.id, null, null, null);
  const moduleAccess = user.module_access ? JSON.parse(user.module_access) : null;
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, department: user.department || 'warehouse', module_access: moduleAccess } });
});

export default router;
