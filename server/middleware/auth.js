import { getDb } from '../db.js';

const SESSION_QUERY = `
  SELECT u.id, u.name, u.role, u.department, u.module_access, u.is_active
  FROM sessions s
  JOIN users u ON s.user_id = u.id
  WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
`;

export const PUBLIC_PATHS = new Set([
  'POST /users/login',
  'POST /users/set-password',
]);

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function lookupSession(token) {
  const db = getDb();
  const row = db.prepare(SESSION_QUERY).get(token);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    module_access: parseModuleAccess(row.module_access),
    is_active: row.is_active,
  };
}

function parseModuleAccess(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = lookupSession(token);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account deactivated' });
  }

  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const user = lookupSession(token);
    if (user && user.is_active) {
      req.user = user;
    }
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export function requireDepartment(...departments) {
  return (req, res, next) => {
    if (!req.user || !departments.includes(req.user.department)) {
      return res.status(403).json({ error: 'Department access required' });
    }
    next();
  };
}
