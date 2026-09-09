// The change register — the parts that are not a router.
//
// 21 CFR 111.130(e) (finding 4.3.9) wants change control over equipment,
// processes, software, utilities and the physical plant. The plant had it for
// controlled definitions (controlled.js parks a deployed form change until
// Document Control approves) and for documents (the DCR). This widens it to
// everything else the rule names, with the one thing the old flow did not
// enforce: QUALITY APPROVAL on every change, as a signature, and no close
// without it.
//
// A software release is recorded here at boot from the deploy's own commit.
// That is the honest half of software change control: the app can prove what
// ran and when; whether a change request was raised for it is the register's
// question, and a release with none is counted, not hidden.

import { randomUUID as uuid } from 'crypto';

export const KINDS = ['equipment', 'process', 'software', 'utility', 'facility', 'document', 'other'];
export const KIND_LABEL = {
  equipment: 'Equipment', process: 'Process', software: 'Software (ReadyDoc, ERP)', utility: 'Utility',
  facility: 'Physical plant / facility', document: 'Controlled document', other: 'Other',
};
export const RISKS = ['low', 'medium', 'high'];

/** What an impact assessment must say before a change can be submitted. */
export function assessmentMissing(r) {
  const out = [];
  const need = (k, label) => { if (!String(r?.[k] || '').trim()) out.push({ key: k, label }); };
  need('impact_product_safety', 'Impact on product safety (write "none" if none)');
  need('impact_quality', 'Impact on quality (write "none" if none)');
  need('impact_validation', 'Impact on validation / qualification (write "none" if none)');
  need('documents_affected', 'Documents affected (write "none" if none)');
  need('training_affected', 'Training affected (write "none" if none)');
  if (!RISKS.includes(r?.risk)) out.push({ key: 'risk', label: 'Risk (low / medium / high)' });
  return out;
}

export function nextChangeNumber(db) {
  const rows = db.prepare("SELECT number FROM change_requests WHERE number LIKE 'CR-%'").all();
  let max = 0;
  for (const r of rows) { const m = String(r.number).match(/(\d+)/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `CR-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Record the running build once. Railway sets RAILWAY_GIT_COMMIT_SHA; a
 * developer box usually has neither, and then nothing is recorded — a made-up
 * release id would be a fact nobody can check.
 */
export function recordRelease(db, { env = process.env, version = null } = {}) {
  const sha = env.RAILWAY_GIT_COMMIT_SHA || env.GIT_SHA || env.SOURCE_COMMIT || null;
  if (!sha) return null;
  const existing = db.prepare('SELECT * FROM software_releases WHERE sha = ?').get(sha);
  if (existing) return { ...existing, first_seen: false };
  const id = uuid();
  db.prepare('INSERT INTO software_releases (id, sha, version, node_version, environment) VALUES (?, ?, ?, ?, ?)')
    .run(id, sha, version, process.version, env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || null);
  return { ...db.prepare('SELECT * FROM software_releases WHERE id = ?').get(id), first_seen: true };
}

/** The register's numbers, derived on every read. */
export function changeStatus(db) {
  const c = (sql) => { try { return db.prepare(sql).get().c; } catch { return 0; } };
  return {
    drafts: c("SELECT COUNT(*) c FROM change_requests WHERE status = 'draft'"),
    awaiting_approval: c("SELECT COUNT(*) c FROM change_requests WHERE status = 'submitted'"),
    approved_open: c("SELECT COUNT(*) c FROM change_requests WHERE status = 'approved'"),
    awaiting_close: c("SELECT COUNT(*) c FROM change_requests WHERE status = 'implemented'"),
    parked_definitions: c("SELECT COUNT(*) c FROM controlled_definitions WHERE status = 'pending'"),
    releases: c('SELECT COUNT(*) c FROM software_releases'),
    releases_uncontrolled: c('SELECT COUNT(*) c FROM software_releases r WHERE NOT EXISTS (SELECT 1 FROM change_requests q WHERE q.release_id = r.id)'),
  };
}
