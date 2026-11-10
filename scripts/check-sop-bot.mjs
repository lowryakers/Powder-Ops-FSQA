#!/usr/bin/env node
// check:sopbot — the Quality bot's SOP staging door (D-303). Pure: no server.
//
// Asserts: exactly five WRITE_AREAS entries in area 'sops', all behind the
// `sops-edit` grant; the grant exists and SCOPES is still read + write; every
// route on the NEVER list is refused to a token that HOLDS the grant (approve
// guard, deny list, or simply not on WRITE_AREAS); a token without the grant
// reaches none of the five; the five regexes miss the literal sibling paths;
// and no approve / deny list shrank.
//
// Control (self-test): the same assertions are run against an embedded copy of
// the OLD WRITE_AREAS (no sops entries) and against a copy with the five routes
// opened with NO grant and NO conditions. Both copies must FAIL; if either
// passes, this check exits non-zero, because a check the old code passes proves
// nothing.
import { WRITE_AREAS } from '../server/bot-api.js';
import { SCOPES, TOKEN_GRANTS } from '../server/api-tokens.js';
import {
  approveRouteFor, tokenDenyFor, APPROVE_SEGMENTS, APPROVE_ROUTES, DELETE_SEGMENTS, DECISION_SEGMENTS, TOKEN_DENY,
} from '../server/middleware/no-token-approve.js';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

// A stand-in database: three SOPs (draft, active, under review), one work
// instruction, and a draft and an approved revision on the active SOP.
const DOCS = {
  'd-draft': { id: 'd-draft', doc_type: 'sop', status: 'draft' },
  'd-active': { id: 'd-active', doc_type: 'sop', status: 'active' },
  'd-review': { id: 'd-review', doc_type: 'sop', status: 'under_review' },
  'd-archived': { id: 'd-archived', doc_type: 'sop', status: 'archived' },
  'd-wi': { id: 'd-wi', doc_type: 'work_instruction', status: 'draft' },
  'd-wi-active': { id: 'd-wi-active', doc_type: 'work_instruction', status: 'active' },
  'd-jd': { id: 'd-jd', doc_type: 'job_description', status: 'draft' },
  'd-jd-active': { id: 'd-jd-active', doc_type: 'job_description', status: 'active' },
  'd-policy': { id: 'd-policy', doc_type: 'policy', status: 'draft' },
};
const REVS = { 'r-draft': { document_id: 'd-active', status: 'draft' }, 'r-approved': { document_id: 'd-active', status: 'approved' },
  'r-wi': { document_id: 'd-wi-active', status: 'draft' }, 'r-jd': { document_id: 'd-jd-active', status: 'draft' } };
const db = {
  prepare(sql) {
    return {
      get(...args) {
        if (/FROM sop_documents/.test(sql)) return DOCS[args[0]];
        if (/FROM document_revisions/.test(sql)) { const r = REVS[args[0]]; return r && r.document_id === args[1] ? r : undefined; }
        return undefined;
      },
    };
  },
};

const req = (method, path, body = {}, grants = ['sops-edit']) => ({ method, path, body, auth: { kind: 'token', grants } });

/** The token door, as authenticateToken applies it, over a given WRITE_AREAS list. */
function allowedBy(areas, r) {
  if (approveRouteFor(r) || tokenDenyFor(r)) return false;
  const a = areas.find((x) => x.method === r.method && x.re.test(r.path));
  if (!a) return false;
  const need = a.grants || (a.grant ? [a.grant] : []);
  if (need.length && !need.some((g) => (r.auth?.grants || []).includes(g))) return false;
  if (!a.when) return true;
  try { return !!a.when(r, r.path.match(a.re), db); } catch { return false; }
}

const OPEN = [
  ['create a draft SOP', req('POST', '/documents', { title: 'X', category: 'Quality', doc_number: 'SOP 429', revision: 'V1' })],
  ['create a draft SOP with status draft', req('POST', '/documents', { title: 'X', category: 'Q', status: 'draft', doc_type: 'sop' })],
  ['edit a draft SOP', req('PUT', '/documents/d-draft', { title: 'Y', content: 'text', revision: 'V2', doc_number: 'SOP 435', effective_date: '2026-10-01', _change_summary: 'x' })],
  ['start a revision on an active SOP', req('POST', '/documents/d-active/revisions', { revision: 'V3', change_summary: 'x' })],
  ['start a revision on an under-review SOP', req('POST', '/documents/d-review/revisions', { revision: 'V3' })],
  ['edit the draft revision', req('PUT', '/documents/d-active/revisions/r-draft', { revision: 'V3', title: 'T', description: 'D', effective_date: '2026-10-01' })],
  ['attach to an active SOP', req('POST', '/documents/d-active/attachments')],
  ['attach to a draft SOP', req('POST', '/documents/d-draft/attachments')],
];

const NEVER = [
  ['approve a revision', req('POST', '/documents/d-active/revisions/r-draft/approve', {})],
  ['sign a document', req('POST', '/documents/d-active/sign', {})],
  ['create filed as active', req('POST', '/documents', { title: 'X', category: 'Q', status: 'active' })],
  ['create filed as under review', req('POST', '/documents', { title: 'X', category: 'Q', status: 'under_review' })],
  ['create naming an approver', req('POST', '/documents', { title: 'X', category: 'Q', approved_by: 'Somebody' })],
  ['create a work instruction', req('POST', '/documents', { title: 'X', category: 'Q', doc_type: 'work_instruction' })],
  ['PUT a draft to active', req('PUT', '/documents/d-draft', { status: 'active' })],
  ['PUT a draft naming an approver', req('PUT', '/documents/d-draft', { approved_at: '2026-11-01' })],
  ['PUT a draft with an unlisted field', req('PUT', '/documents/d-draft', { equipment_ids: ['e1'] })],
  ['PUT an ACTIVE SOP', req('PUT', '/documents/d-active', { title: 'Y' })],
  ['PUT an under-review SOP', req('PUT', '/documents/d-review', { content: 'Y' })],
  ['PUT a withdrawn SOP', req('PUT', '/documents/d-archived', { title: 'Y' })],
  ['PUT a work instruction', req('PUT', '/documents/d-wi', { title: 'Y' })],
  ['start a revision with an unlisted field', req('POST', '/documents/d-active/revisions', { revision: 'V3', status: 'active' })],
  ['edit an APPROVED revision', req('PUT', '/documents/d-active/revisions/r-approved', { title: 'T' })],
  ['edit a revision with an unlisted field', req('PUT', '/documents/d-active/revisions/r-draft', { status: 'approved' })],
  ['attach to a work instruction', req('POST', '/documents/d-wi/attachments')],
  ['apply a revision', req('POST', '/documents/d-active/apply-revision', {})],
  ['apply a worklist item', req('POST', '/documents/revisions/items/x/apply', {})],
  ['skip a worklist item', req('POST', '/documents/revisions/items/x/skip', {})],
  ['revision batch', req('POST', '/documents/revisions/batch', {})],
  ['propose revisions', req('POST', '/documents/propose-revisions', {})],
  ['DELETE a document (withdraw)', req('DELETE', '/documents/d-active', { reason: 'x' })],
  ['DELETE a revision', req('DELETE', '/documents/d-active/revisions/r-draft', { reason: 'x' })],
  ['DELETE an attachment', req('DELETE', '/documents/attachments/a1', {})],
  ['reinstate', req('POST', '/documents/d-archived/reinstate', {})],
  ['bulk', req('POST', '/documents/bulk', {})],
  ['bulk-update', req('POST', '/documents/bulk-update', {})],
  ['bulk-delete', req('POST', '/documents/bulk-delete', {})],
  ['attachments/bulk', req('POST', '/documents/attachments/bulk', {})],
  ['attachments/plan', req('POST', '/documents/attachments/plan', {})],
  ['the PDF export', req('POST', '/documents/pdf', {})],
  ['extract', req('POST', '/documents/extract', {})],
  ['a merge route, if one is added', req('POST', '/documents/d-active/merge', {})],
  ['a retire route, if one is added', req('POST', '/documents/d-active/retire', {})],
];

// D-306: the same five writes for a Work Instruction (wi-edit) and a Job
// Description (jd-edit). Each must open with its own grant and with no other.
const wi = (m, p, b = {}) => req(m, p, b, ['wi-edit']);
const jd = (m, p, b = {}) => req(m, p, b, ['jd-edit']);
const OPEN_WI = [
  ['create a draft WI', wi('POST', '/documents', { title: 'X', category: 'Q', doc_type: 'work_instruction' })],
  ['edit a draft WI', wi('PUT', '/documents/d-wi', { title: 'Y', doc_number: 'WI 040' })],
  ['start a revision on an active WI', wi('POST', '/documents/d-wi-active/revisions', { revision: 'V3' })],
  ['edit the WI draft revision (doc_number staged)', wi('PUT', '/documents/d-wi-active/revisions/r-wi', { revision: 'V3', doc_number: 'WI 041' })],
  ['attach to a WI', wi('POST', '/documents/d-wi-active/attachments')],
];
const OPEN_JD = [
  ['create a draft JD', jd('POST', '/documents', { title: 'X', category: 'Q', doc_type: 'job_description' })],
  ['edit a draft JD', jd('PUT', '/documents/d-jd', { title: 'Y' })],
  ['start a revision on an active JD', jd('POST', '/documents/d-jd-active/revisions', { revision: 'V2' })],
  ['edit the JD draft revision', jd('PUT', '/documents/d-jd-active/revisions/r-jd', { doc_number: 'JD 12' })],
  ['attach to a JD', jd('POST', '/documents/d-jd-active/attachments')],
];
const NEVER_TYPED = [
  ['wi-edit: create an SOP (no doc_type)', wi('POST', '/documents', { title: 'X', category: 'Q' })],
  ['wi-edit: start a revision on an SOP', wi('POST', '/documents/d-active/revisions', { revision: 'V3' })],
  ['wi-edit: attach to an SOP', wi('POST', '/documents/d-active/attachments')],
  ['wi-edit: a JD revision', wi('POST', '/documents/d-jd-active/revisions', { revision: 'V2' })],
  ['jd-edit: a WI revision', jd('POST', '/documents/d-wi-active/revisions', { revision: 'V3' })],
  ['sops-edit: a WI revision', req('POST', '/documents/d-wi-active/revisions', { revision: 'V3' })],
  ['sops-edit: a JD revision', req('POST', '/documents/d-jd-active/revisions', { revision: 'V2' })],
  ['all three: a policy', req('PUT', '/documents/d-policy', { title: 'Y' }, ['sops-edit', 'wi-edit', 'jd-edit'])],
  ['all three: create a policy', req('POST', '/documents', { title: 'X', category: 'Q', doc_type: 'policy' }, ['sops-edit', 'wi-edit', 'jd-edit'])],
  ['wi-edit: approve a WI revision', wi('POST', '/documents/d-wi-active/revisions/r-wi/approve', {})],
  ['wi-edit: sign a WI', wi('POST', '/documents/d-wi-active/sign', {})],
  ['wi-edit: retire a WI (DELETE)', wi('DELETE', '/documents/d-wi-active', { reason: 'x' })],
  ['wi-edit: reinstate a WI', wi('POST', '/documents/d-wi-active/reinstate', {})],
  ['wi-edit: DELETE a WI revision', wi('DELETE', '/documents/d-wi-active/revisions/r-wi', { reason: 'x' })],
  ['wi-edit: PUT an active WI', wi('PUT', '/documents/d-wi-active', { title: 'Y' })],
  ['wi-edit: PUT a WI draft to active', wi('PUT', '/documents/d-wi', { status: 'active' })],
  ['wi-edit: PUT a WI draft into an SOP', wi('PUT', '/documents/d-wi', { doc_type: 'sop' })],
  ['jd-edit: approve a JD revision', jd('POST', '/documents/d-jd-active/revisions/r-jd/approve', {})],
  ['jd-edit: retire a JD (DELETE)', jd('DELETE', '/documents/d-jd-active', { reason: 'x' })],
  ['jd-edit: create filed as active', jd('POST', '/documents', { title: 'X', category: 'Q', doc_type: 'job_description', status: 'active' })],
];

const SIBLINGS = ['/documents/revisions/batch', '/documents/revisions/items/x/apply', '/documents/attachments/plan', '/documents/attachments/bulk',
  '/documents/bulk', '/documents/bulk-update', '/documents/bulk-delete', '/documents/pdf', '/documents/extract', '/documents/propose-revisions',
  '/documents/revisions/revisions', '/documents/attachments/attachments', '/documents/bulk/revisions/r1'];

/** Every assertion over one WRITE_AREAS list; returns the names that failed. */
function assertAll(areas) {
  const failed = [];
  const sops = areas.filter((a) => a.area === 'sops');
  if (sops.length !== 5) failed.push(`five sops entries (found ${sops.length})`);
  const g3 = (a) => JSON.stringify([...(a.grants || (a.grant ? [a.grant] : []))].sort()) === '["jd-edit","sops-edit","wi-edit"]';
  if (!sops.every(g3)) failed.push('every sops entry opens to exactly sops-edit, wi-edit or jd-edit');
  if (!sops.every((a) => a.re.source.startsWith('^') && a.re.source.endsWith('$'))) failed.push('every sops regex is anchored');
  for (const [n, r] of OPEN) if (!allowedBy(areas, r)) failed.push(`open with the grant: ${n}`);
  for (const [n, r] of OPEN) if (allowedBy(areas, { ...r, auth: { kind: 'token', grants: [] } })) failed.push(`refused without the grant: ${n}`);
  for (const [n, r] of OPEN) if (allowedBy(areas, { ...r, auth: { kind: 'token', grants: ['course-drafts', 'nfp-panel'] } })) failed.push(`refused with another grant: ${n}`);
  for (const [n, r] of NEVER) if (allowedBy(areas, r)) failed.push(`never, even with the grant: ${n}`);
  for (const [n, r] of [...OPEN_WI, ...OPEN_JD]) if (!allowedBy(areas, r)) failed.push(`open with its type's grant: ${n}`);
  for (const [n, r] of [...OPEN_WI, ...OPEN_JD]) if (allowedBy(areas, { ...r, auth: { kind: 'token', grants: ['sops-edit'] } })) failed.push(`refused to an SOP-only token: ${n}`);
  for (const [n, r] of NEVER_TYPED) if (allowedBy(areas, r)) failed.push(`never: ${n}`);
  for (const p of SIBLINGS) for (const m of ['POST', 'PUT']) {
    if (sops.some((a) => a.method === m && a.re.test(p))) failed.push(`a sops regex matches the sibling ${m} ${p}`);
  }
  return failed;
}

console.log('── the grant ──');
t('SCOPES is still exactly read + write', JSON.stringify(SCOPES) === '["read","write"]', JSON.stringify(SCOPES));
t('TOKEN_GRANTS has sops-edit', !!TOKEN_GRANTS['sops-edit']);
t('…and it says it never approves, signs, makes effective, deletes, retires or merges',
  /Never approves, signs, makes effective, deletes, retires or merges/.test(TOKEN_GRANTS['sops-edit'] || ''));
for (const g of ['wi-edit', 'jd-edit']) {
  t(`TOKEN_GRANTS has ${g}`, !!TOKEN_GRANTS[g]);
  t(`…and ${g} says it never approves, signs, makes effective, deletes, retires or merges`,
    /Never approves, signs, makes effective, deletes, retires or merges/.test(TOKEN_GRANTS[g] || ''));
}
const usesG = (a, g) => (a.grants || (a.grant ? [a.grant] : [])).includes(g);
for (const g of ['sops-edit', 'wi-edit', 'jd-edit']) t(`no other area uses the ${g} grant`, WRITE_AREAS.every((a) => !usesG(a, g) || a.area === 'sops'));
t('no sops route is in the bulk rate bucket', WRITE_AREAS.filter((a) => a.area === 'sops').every((a) => !a.bulk));

console.log('── the five routes, and everything that stays shut ──');
const real = assertAll(WRITE_AREAS);
t(`all ${OPEN.length * 3 + NEVER.length + (OPEN_WI.length + OPEN_JD.length) * 2 + NEVER_TYPED.length + SIBLINGS.length * 2 + 3} assertions hold on the code as it is`, real.length === 0, real.join('; '));
for (const [n, r] of OPEN) t(`open with the grant: ${n}`, allowedBy(WRITE_AREAS, r));
for (const [n, r] of NEVER) t(`never, even with the grant: ${n}`, !allowedBy(WRITE_AREAS, r));
for (const [n, r] of [...OPEN_WI, ...OPEN_JD]) t(`open with its type's grant: ${n}`, allowedBy(WRITE_AREAS, r));
for (const [n, r] of NEVER_TYPED) t(`never: ${n}`, !allowedBy(WRITE_AREAS, r));
t('an SOP-only token on a WI is told it needs wi-edit', (() => {
  const r = req('POST', '/documents/d-wi-active/revisions', { revision: 'V3' }); allowedBy(WRITE_AREAS, r);
  return /sops-edit grant covers SOPs only; a Work Instruction needs the wi-edit grant/.test(r.tokenWriteRefusal || '');
})(), 'reason was not as expected');
t('a refusal from a condition says why (req.tokenWriteRefusal)', (() => {
  const r = req('PUT', '/documents/d-active', { title: 'Y' }); allowedBy(WRITE_AREAS, r); return /draft/.test(r.tokenWriteRefusal || '');
})());

console.log('── the deny lists did not shrink (counts at the base commit) ──');
t('APPROVE_SEGMENTS is 31', APPROVE_SEGMENTS.length === 31, String(APPROVE_SEGMENTS.length));
t('APPROVE_ROUTES is 24 (D-328 added controlled QA review)', APPROVE_ROUTES.length === 24, String(APPROVE_ROUTES.length));
t('DELETE_SEGMENTS is 15', DELETE_SEGMENTS.length === 15, String(DELETE_SEGMENTS.length));
t('DECISION_SEGMENTS is 9', DECISION_SEGMENTS.length === 9, String(DECISION_SEGMENTS.length));
t('TOKEN_DENY is 12', TOKEN_DENY.length === 12, String(TOKEN_DENY.length));
for (const seg of ['approve', 'sign']) t(`APPROVE_SEGMENTS still holds "${seg}"`, APPROVE_SEGMENTS.includes(seg));
for (const seg of ['archive', 'withdraw', 'retire', 'deactivate']) t(`DELETE_SEGMENTS still holds "${seg}"`, DELETE_SEGMENTS.includes(seg));
t('APPROVE_ROUTES still holds the four document entries', APPROVE_ROUTES.filter((r) => /documents/.test(r.label)).length === 4);

console.log('── control: the old code must fail these checks ──');
const OLD = WRITE_AREAS.filter((a) => a.area !== 'sops');
const oldFailed = assertAll(OLD);
t('the OLD WRITE_AREAS (no sops entries) FAILS', oldFailed.length > 0, 'it passed — the check proves nothing');
console.log(`    (old code: ${oldFailed.length} assertions fail, e.g. "${oldFailed[0] || ''}")`);
const OPENED = [...OLD, ...WRITE_AREAS.filter((a) => a.area === 'sops').map(({ grant: _g, grants: _gs, when: _w, ...rest }) => rest)];
const openedFailed = assertAll(OPENED);
t('the five routes opened with no grant and no conditions FAILS', openedFailed.length > 0, 'it passed — the check proves nothing');
console.log(`    (opened copy: ${openedFailed.length} assertions fail, e.g. "${openedFailed[0] || ''}")`);

const SOP_ONLY = [...OLD, ...WRITE_AREAS.filter((a) => a.area === 'sops').map(({ grants: _gs, ...rest }) => ({ ...rest, grant: 'sops-edit' }))];
const sopOnlyFailed = assertAll(SOP_ONLY);
t('the D-303 shape (one sops-edit grant on all five) FAILS', sopOnlyFailed.length > 0, 'it passed — the check proves nothing');
console.log(`    (sops-only copy: ${sopOnlyFailed.length} assertions fail, e.g. "${sopOnlyFailed[0] || ''}")`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
