// Has a bot ever approved anything? (D-279) READ-ONLY.
//
// Two answers on one page:
//   1. Every bot API token — its account, role, department, scopes and grants —
//      and what it can approve, sign, verify or publish: nothing, because the
//      refusal is at the door (APPROVE_ROUTES for a token, and the same list for
//      a bot account signed in with a password), whatever the token says.
//   2. Every approval on file that names a bot account: audit entries whose
//      action is an approval and whose actor is a bot account or came through a
//      token, and the signature columns on the records themselves. Expected: none.
//
// It writes nothing — not even an audit row — so it is safe on the live database.
// The Settings card (GET /api/api-tokens/approval-check) and the CLI
// (`npm run report:bot-approvals -- <db copy>`) both call this function.
import { botAccounts } from './trainees.js';

// An audit action that records an approval, a signature, a verification or a
// publication. The refusals themselves are excluded: they are the guard working.
const APPROVAL_ACTION = /(^|_)(approve|approved|approval|sign|signed|signoff|sign_off|countersign|verify|verified|publish|published|release|released|settle|settled|decide|decided)($|_)/i;
const NOT_AN_APPROVAL = new Set(['signature_failed', 'api_token_approve_blocked', 'bot_approve_blocked', 'api_token_write_blocked']);
export const isApprovalAction = (a) => !!a && APPROVAL_ACTION.test(String(a)) && !NOT_AN_APPROVAL.has(String(a));

const parse = (raw, fb) => { try { return raw ? JSON.parse(raw) : fb; } catch { return fb; } };
const has = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const cols = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));

export function botApprovalReport(db) {
  const bots = botAccounts(db);
  const botIds = new Set(bots.map(b => b.id));
  const botNames = new Set(bots.map(b => String(b.name || '').trim().toLowerCase()).filter(Boolean));

  const tokens = has(db, 'api_tokens') ? db.prepare(`SELECT t.*, u.name AS account, u.role, u.department, u.is_active
      FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at`).all().map(t => {
    const live = !t.revoked_at && (!t.expires_at || t.expires_at > new Date().toISOString()) && !!t.is_active;
    return {
      id: t.id, label: t.label, prefix: t.token_prefix, account: t.account, role: t.role, department: t.department,
      scopes: parse(t.scopes, []), grants: parse(t.grants, []), live,
      revoked_at: t.revoked_at || null, expires_at: t.expires_at || null, last_used_at: t.last_used_at || null,
      can_approve: false,
      why: 'Refused at the door: approving, signing, verifying and publishing are never open to a token or to a bot account signed in any other way.',
    };
  }) : [];

  const findings = [];
  // Audit entries: an approval made by a bot account, or through a token.
  const audit = db.prepare(`SELECT id, timestamp, actor, actor_id, action, entity_type, entity_id, entity_label, details
    FROM audit_log WHERE actor_id IS NOT NULL OR details LIKE '%via_token%' ORDER BY id`).all();
  for (const a of audit) {
    if (!isApprovalAction(a.action)) continue;
    const viaToken = /"via_token"\s*:\s*(true|"[^"]+"|\{)/.test(a.details || '');
    if (!botIds.has(a.actor_id) && !viaToken) continue;
    findings.push({ source: 'audit_log', id: a.id, at: a.timestamp, actor: a.actor, action: a.action,
      record: `${a.entity_type}${a.entity_label ? ` — ${a.entity_label}` : ''}`, via_token: viaToken });
  }
  // The signature columns on the records themselves.
  const byId = (table, idCol, label, extra = '') => {
    if (!has(db, table) || !cols(db, table).has(idCol)) return;
    for (const r of db.prepare(`SELECT * FROM ${table} WHERE ${idCol} IS NOT NULL ${extra}`).all()) {
      if (botIds.has(r[idCol])) findings.push({ source: table, id: r.id, at: r.signed_at || r.approved_at || r.created_at || null, actor: r.name || r.approved_by || null, action: label, record: r.document_id || r.title || r.id });
    }
  };
  byId('document_signatures', 'user_id', 'signed a controlled document');
  byId('document_revisions', 'approved_by_id', 'approved a document revision');
  byId('course_drafts', 'doc_confirmed_by_id', 'confirmed a course draft matches its document');
  byId('course_drafts', 'fs_approved_by_id', 'approved a course draft\'s food safety content');
  byId('training_records', 'recorded_by_id', 'recorded a training sign-off', 'AND competence_statement IS NOT NULL');
  if (has(db, 'sop_documents')) {
    for (const d of db.prepare('SELECT id, doc_number, title, approved_by, approved_at FROM sop_documents WHERE approved_by IS NOT NULL').all()) {
      if (botNames.has(String(d.approved_by).trim().toLowerCase())) {
        findings.push({ source: 'sop_documents', id: d.id, at: d.approved_at, actor: d.approved_by, action: 'named as a document\'s approver', record: `${d.doc_number || ''} ${d.title}`.trim() });
      }
    }
  }
  if (has(db, 'qms_records')) {
    for (const r of db.prepare("SELECT id, record_type, record_number, approvals FROM qms_records WHERE approvals IS NOT NULL AND approvals != '{}' AND approvals != '[]'").all()) {
      const ap = parse(r.approvals, {});
      for (const [role, s] of Object.entries(ap || {})) {
        if (s && (botIds.has(s.user_id) || botNames.has(String(s.name || s.by || '').trim().toLowerCase()))) {
          findings.push({ source: 'qms_records', id: r.id, at: s.at || s.signed_at || null, actor: s.name || s.by, action: `signed ${role}`, record: `${r.record_type} ${r.record_number || ''}`.trim() });
        }
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    bot_accounts: bots.map(b => ({ id: b.id, name: b.name, role: b.role, department: b.department, why: b.why })),
    tokens,
    token_count: tokens.length,
    live_token_count: tokens.filter(t => t.live).length,
    approvals_by_bots: findings,
    verdict: findings.length ? `${findings.length} approval${findings.length === 1 ? '' : 's'} on file name a bot account — listed below.` : 'No approval on file was made by a bot account.',
  };
}
