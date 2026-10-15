// ACCOUNTS BULK PERMISSIONS GAVE EVERY MODULE (D-187).
//
// Until D-187, Bulk Permissions turned a blank module map into "every module at
// Edit" before applying its patch — a rule left over from when a blank map meant
// unrestricted. Since 13 Aug a blank map means "nothing but the defaults", so
// one bulk pass (ticking Operator View for the roster, 29 Sep) gave every blank
// account every module, including Danny's List, the owner's private queue. The
// audit kept only a count, so nobody could see how anyone got anything.
//
// Two things here:
//   * `repairBulkPrivateGrants` (boot, ONCE): takes the PRIVATE modules (Danny's
//     List) off any non-admin whose map carries nearly every module — the shape
//     only that bulk path wrote; the Settings editor never puts a private
//     module into "full access". Audited per account, and remembered so Settings
//     can name who lost it (a deliberate grant is one tick to put back).
//   * `accessReview` (read): every non-admin account holding (nearly) every
//     module, with the last map somebody set on that person by hand, so an admin
//     can restore it in one click or say "intended". Derived on every read.
import { ALL_MODULE_IDS } from './module-access.js';
import { OPT_IN_SET } from '../shared/opt-in-modules.js';
import { logAudit } from './db.js';

const ORDINARY = ALL_MODULE_IDS.filter((id) => !OPT_IN_SET.has(id));
// "Nearly every module": within five of all of them, so a later bulk pass that
// set a few to None still reads as the same shape.
const SLACK = 5;
const REPAIR_FLAG = 'bulk_access_repair_v1';
const DISMISSED = 'access_review_dismissed';

const parse = (s) => { try { const v = s ? JSON.parse(s) : null; return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
export const coversNearlyAll = (map) => !!map && ORDINARY.filter((id) => map[id] === 'edit' || map[id] === 'view').length >= ORDINARY.length - SLACK;

export function repairBulkPrivateGrants(db) {
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(REPAIR_FLAG)) return [];
  const fixed = [];
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, name, module_access FROM users WHERE role NOT IN ('admin', 'auditor')").all()) {
      const map = parse(u.module_access);
      if (!coversNearlyAll(map)) continue;
      const removed = Object.keys(map).filter((k) => OPT_IN_SET.has(k));
      if (!removed.length) continue;
      const next = Object.fromEntries(Object.entries(map).filter(([k]) => !OPT_IN_SET.has(k)));
      db.prepare("UPDATE users SET module_access = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(next), u.id);
      logAudit('system', 'permission_change', 'user', u.id,
        { removed, reason: 'D-187: private module written by the Bulk Permissions full-access bug, not granted on purpose' },
        { module_access: u.module_access }, { module_access: JSON.stringify(next) }, u.name);
      fixed.push({ id: u.id, name: u.name, removed });
    }
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(REPAIR_FLAG, JSON.stringify({ at: new Date().toISOString(), fixed }));
  })();
  return fixed;
}

function lastHandSetMap(db, userId, current) {
  const rows = db.prepare(`SELECT timestamp AS created_at, actor, details, new_state FROM audit_log
    WHERE entity_type = 'user' AND entity_id = ? AND new_state IS NOT NULL ORDER BY rowid DESC LIMIT 50`).all(userId);
  for (const r of rows) {
    if (/"bulk":true|D-187/.test(r.details || '')) continue;
    const ns = (() => { try { return JSON.parse(r.new_state); } catch { return null; } })();
    if (!ns || !('module_access' in ns)) continue;
    const m = ns.module_access == null ? null : String(ns.module_access);
    if (m === (current || null)) continue;
    if (coversNearlyAll(parse(m))) continue;
    return { at: r.created_at, by: r.actor, module_access: parse(m) };
  }
  return null;
}

export function accessReview(db) {
  const dismissed = new Set((() => { try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DISMISSED)?.value || '[]'); } catch { return []; } })());
  const repaired = (() => { try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(REPAIR_FLAG)?.value || '{}').fixed || []; } catch { return []; } })();
  const accounts = [];
  for (const u of db.prepare("SELECT id, name, role, department, module_access FROM users WHERE is_active = 1 AND role NOT IN ('admin', 'auditor') AND COALESCE(is_external, 0) = 0 ORDER BY name").all()) {
    const map = parse(u.module_access);
    if (!coversNearlyAll(map) || dismissed.has(u.id)) continue;
    accounts.push({ id: u.id, name: u.name, role: u.role, department: u.department,
      modules: Object.keys(map).length, restore: lastHandSetMap(db, u.id, u.module_access) });
  }
  return { accounts, private_removed: repaired, total_modules: ORDINARY.length };
}

export function dismissReview(db, userId) {
  const cur = (() => { try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DISMISSED)?.value || '[]'); } catch { return []; } })();
  if (!cur.includes(userId)) cur.push(userId);
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
    .run(DISMISSED, JSON.stringify(cur));
}

// "Out now" was shown to any account whose NAME starts with Ricardo — a rule no
// Settings screen could show. It is an ordinary grant now; whoever the name rule
// reached keeps it, as a tick on their record. Once per database.
export function grantOutNowByName(db) {
  const FLAG = 'out_now_name_rule_v1';
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(FLAG)) return [];
  const granted = [];
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, name, role, module_access FROM users WHERE is_active = 1 AND LOWER(name) LIKE 'ricardo%' AND role != 'auditor' AND COALESCE(is_external, 0) = 0").all()) {
      let map = (() => { try { return u.module_access ? JSON.parse(u.module_access) : null; } catch { return null; } })();
      if (Array.isArray(map)) map = Object.fromEntries(map.map((m) => [m, 'edit']));
      if (map?.['currently-out']) continue;
      const next = { ...(map || {}), 'currently-out': 'view' };
      db.prepare("UPDATE users SET module_access = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(next), u.id);
      logAudit('system', 'permission_change', 'user', u.id, { module: 'currently-out', reason: 'D-187: the name rule became a grant' },
        { module_access: u.module_access }, { module_access: JSON.stringify(next) }, u.name);
      granted.push(u.name);
    }
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(FLAG, new Date().toISOString());
  })();
  return granted;
}
