import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import crypto from 'crypto';

const router = Router();

// --- User CRUD ---

router.get('/', (req, res) => {
  const db = getDb();
  const { role, active } = req.query;
  let sql = 'SELECT id, name, email, role, is_active, created_at FROM users WHERE 1=1';
  const params = [];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  if (active !== undefined) { sql += ' AND is_active = ?'; params.push(active === 'true' ? 1 : 0); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/technicians', (_req, res) => {
  const db = getDb();
  const techs = db.prepare("SELECT id, name, role FROM users WHERE is_active = 1 AND role IN ('operator','supervisor') ORDER BY name").all();
  res.json(techs);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, email, pin, role } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  db.prepare('INSERT INTO users (id, name, email, pin, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, email || null, pin || null, role || 'operator');

  const created = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?').get(id);
  logAudit(req.body._actor || 'system', 'create', 'user', id, { name, role: role || 'operator' }, null, null);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, email, pin, role, is_active } = req.body;
  db.prepare(`UPDATE users SET name=?, email=?, pin=COALESCE(?, pin), role=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
    .run(name || existing.name, email ?? existing.email, pin || null, role || existing.role,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active, req.params.id);

  const updated = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'user', req.params.id, null, null, null);
  res.json(updated);
});

// --- Auth ---

router.post('/login', (req, res) => {
  const db = getDb();
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'email and pin are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
  if (!user || user.pin !== pin) return res.status(401).json({ error: 'Invalid credentials' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), user.id, token, expires.toISOString());

  logAudit(user.name, 'login', 'user', user.id, null, null, null);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const session = db.prepare("SELECT s.*, u.id as uid, u.name, u.email, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')").get(token);
  if (!session) return res.status(401).json({ error: 'Session expired' });

  res.json({ id: session.uid, name: session.name, email: session.email, role: session.role });
});

router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ ok: true });
});

export default router;
