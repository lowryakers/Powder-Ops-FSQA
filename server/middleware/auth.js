import { getDb } from '../db.js';
import { passwordExpired } from '../password-policy.js';

const SESSION_QUERY = `
  SELECT u.id, u.name, u.role, u.department, u.module_access, u.is_active, u.password_changed_at
  FROM sessions s
  JOIN users u ON s.user_id = u.id
  WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
`;

// While a password is past its yearly change date, the session can do exactly
// one thing: change that password. Enforcing it here rather than on the login
// screen is the difference between a policy and a suggestion — an expired
// session that keeps a tab open, or one that lapses mid-week, is stopped just
// the same.
const PASSWORD_EXPIRY_ALLOWED = [
  { method: 'POST', path: '/users/me/password' },
  { method: 'GET', path: '/users/me' },
  { method: 'POST', path: '/users/logout' },
];

// Requests that must work before there is a session. Everything else under
// /api needs a valid bearer token. This is the only list — server.js asks
// isPublicPath() rather than keeping a second copy that can drift.
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/users/login' },
  { method: 'POST', path: '/users/set-password' },
  // The login screen's name type-ahead. Without it people have to type their
  // full name exactly, which is the problem short usernames exist to solve.
  // Returns at most 10 active users and needs 2+ characters to match.
  { method: 'GET', path: '/users/lookup' },
  { method: 'POST', path: '/sms/inbound' },   // Twilio — signature-checked in the handler
  { prefix: '/submit/' },                     // public kiosk forms (QR codes)
  // The partner reconciliation portal. Authenticated by a hashed token in the
  // URL and scoped to one partner account inside the handler — read, upload and
  // dispute only. See server/api/partner-portal.js for why that set is safe.
  { prefix: '/partner-portal/' },
  // The new-hire onboarding wizard (/welcome/<token>) — hashed token compared
  // in the handler, scoped to one record, writes only the fields a new hire
  // may write about themselves. See server/api/onboarding.js.
  { prefix: '/onboarding-portal/' },
  // The Artwork-Proofing service's master-list feed. Read-only, guarded by a
  // hashed token compared in the handler, and off entirely unless
  // PRODUCT_MASTER_TOKEN is set. It exposes only what a printer already holds.
  { method: 'GET', path: '/products/master.csv' },
  // The other half of the same integration: the proofing service files its
  // finished jobs here. Same token, checked in the handler.
  { prefix: '/artwork/ingest' },
  // The NFP approval link, texted to whoever signs off a nutrition panel. The
  // token is compared as a SHA-256 hash in the handler and cleared by the
  // decision, so the link is single-use. Read the panel, decide, done.
  { prefix: '/nfp-link/' },
  { path: '/version' },
  { path: '/health' },
];

export function isPublicPath(req) {
  return PUBLIC_ROUTES.some(r => {
    if (r.method && r.method !== req.method) return false;
    return r.prefix ? req.path.startsWith(r.prefix) : req.path === r.path;
  });
}

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
    password_changed_at: row.password_changed_at,
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

  if (passwordExpired(user.password_changed_at)
      && !PASSWORD_EXPIRY_ALLOWED.some(r => r.method === req.method && r.path === req.path)) {
    return res.status(403).json({
      error: 'Your password is more than a year old and must be changed before you can continue.',
      password_expired: true,
    });
  }

  req.user = user;

  // Admin "View as" preview: an admin's READ requests can be scoped to another
  // user so lists (e.g. comms channels) show what that person sees. Reads only
  // — writes always act (and are attributed) as the real signed-in admin.
  // Handlers can check req.impersonated to withhold private content (DMs).
  const viewAsId = req.headers['x-view-as'];
  if (viewAsId && req.method === 'GET' && user.role === 'admin') {
    const db = getDb();
    const target = db.prepare('SELECT id, name, role, department, module_access, is_active FROM users WHERE id = ? AND is_active = 1').get(viewAsId);
    if (target && target.role !== 'admin') {
      req.user = {
        id: target.id,
        name: target.name,
        role: target.role,
        department: target.department,
        module_access: parseModuleAccess(target.module_access),
        is_active: target.is_active,
      };
      req.impersonated = true;
      req.realAdmin = user;
    }
  }

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
