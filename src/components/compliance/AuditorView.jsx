import { useState, useRef, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import MarkdownView from '../common/MarkdownView.jsx';
import ProcessFlows from './ProcessFlows.jsx';
import {
  Shield, Wrench, Thermometer, Droplets, CheckCircle, AlertTriangle, Download, LogOut,
  FlaskConical, ScrollText, FileText, ChevronDown, ChevronUp, ChevronRight, ArrowLeft,
  BookOpen, GraduationCap, Scissors, FileWarning, TestTubes, PackageSearch, Printer, X, ExternalLink, Workflow,
} from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { formatDateTime, formatDate } from '../../lib/datetime.js';

// ─────────────────────────────────────────────────────────────────────────────
// Auditor portal, structured like an audit binder: a Table-of-Contents cover
// page organized by audit element (SQF ed. 9 / NSF ANSI 455-2 GMP), each
// chapter opening the requisite read-only evidence with CSV exports. Strictly
// limited to audit-relevant records — no comms, schedules, or personnel data
// beyond training/certifications.
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors">
        <div className="w-8 h-8 bg-powder-50 rounded-lg flex items-center justify-center">
          <Icon size={16} className="text-powder-600" />
        </div>
        <span className="text-base font-semibold text-gray-900 flex-1 text-left">{title}</span>
        {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
}

function ExportButton({ onClick, label }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
      <Download size={13} /> {label || 'Export CSV'}
    </button>
  );
}

const Th = ({ children }) => <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">{children}</th>;
const Td = ({ children, dim, wide }) => <td className={`py-1.5 px-2 ${dim ? 'text-gray-600' : 'text-gray-900'} ${wide ? 'w-full' : 'whitespace-nowrap'}`}>{children}</td>;

// ── Generic QMS record table (config-driven, read-only) ──────────────────────
function QmsSection({ type }) {
  const { data: config } = useApiGet('/qms/config');
  const { data: records } = useApiGet(`/qms/${type}`);
  const cfg = (config?.types || []).find(t => t.key === type);
  if (!cfg) return <p className="text-sm text-gray-400">Loading…</p>;
  const rows = records || [];
  const cols = cfg.logColumns.filter(c => c !== 'approvals');
  const label = (c) => c === 'record_number' ? '#' : c === 'record_date' ? cfg.dateLabel || 'Date' : c === 'status' ? 'Status'
    : (cfg.fields.find(f => f.key === c)?.label || c);
  const statusLabel = (v) => (cfg.statuses || []).find(s => s.value === v)?.label || v || '—';
  const val = (r, c) => c === 'status' ? statusLabel(r.status) : (Array.isArray(r[c]) ? r[c].join(', ') : (r[c] ?? '—'));
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv(`${type}-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      [{ label: '#', value: r => r.record_number }, { label: 'Date', value: r => r.record_date || '' },
       { label: 'Status', value: r => statusLabel(r.status) },
       ...cfg.fields.map(f => ({ label: f.label, value: r => Array.isArray(r[f.key]) ? r[f.key].join('; ') : (r[f.key] ?? '') })),
       { label: 'Notes', value: r => r.notes || '' }], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} record{rows.length === 1 ? '' : 's'} · {cfg.formCode}</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200">{cols.map(c => <Th key={c}>{label(c)}</Th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 100).map((r, i) => (
                <tr key={r.id || i} className="border-b border-gray-100">
                  {cols.map((c, ci) => <Td key={c} dim={ci > 0} wide={c === cfg.primaryField}>{String(val(r, c)).slice(0, 120)}</Td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {rows.length}. Export CSV for full data.</p>}
        </div>
      )}
    </div>
  );
}


// ── Reading an actual controlled document (and printing it) ─────────────────
//
// The registry used to show only the row — number, title, revision, status. An
// auditor asking "show me SOP 401" wants the document, not its metadata, and
// asking someone to fetch it on another screen is the moment the binder stops
// being self-service.
//
// Printing opens a clean window rather than styling the app for print: an
// auditor asking for a paper copy should get the document, not a screenshot of
// software. The header carries the number, revision and effective date so the
// paper says which version it is.
function printDocument(doc, bodyEl) {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return;
  const meta = [
    doc.doc_number && `Document #: ${doc.doc_number}`,
    doc.revision && `Revision: ${doc.revision}`,
    doc.effective_date && `Effective: ${doc.effective_date}`,
    doc.status && `Status: ${doc.status}`,
    doc.owner && `Owner: ${doc.owner}`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  // A withdrawn document must never print looking current. The banner goes at
  // the top of the paper, not only in the footer stamp — somebody reading a
  // printout of a Work Instruction has to know at a glance that it no longer
  // applies, and why.
  const withdrawn = doc.status === 'archived' ? `
    <div class="withdrawn">
      <strong>NO LONGER IN USE</strong>
      ${doc.archived_at ? ` — withdrawn ${doc.archived_at}` : ''}${doc.archived_by ? ` by ${doc.archived_by}` : ''}.
      ${doc.archive_reason ? `<br>${doc.archive_reason}` : ''}
      <br>Do not work to this document. Check the registry for the current one.
    </div>` : '';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${doc.doc_number || ''} ${doc.title}</title>
    <style>
      body { font: 12pt/1.5 Georgia, serif; margin: 0.75in; color: #111; }
      h1 { font-size: 16pt; margin: 0 0 4px; }
      .meta { font: 9pt/1.4 Helvetica, Arial, sans-serif; color: #444; border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 16px; }
      .withdrawn { font: 10pt/1.45 Helvetica, Arial, sans-serif; border: 2px solid #b91c1c; color: #7f1d1d; padding: 8px 10px; margin: 0 0 16px; }
      .foot { position: fixed; bottom: 0.4in; left: 0.75in; right: 0.75in; font: 8pt Helvetica, Arial, sans-serif; color: #777; border-top: 1px solid #ccc; padding-top: 4px; }
      table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 4px 6px; font-size: 10pt; }
      h3, h4, h5 { margin: 12px 0 4px; } p { margin: 6px 0; } ul, ol { margin: 6px 0 6px 20px; }
    </style></head><body>
    <h1>${doc.title}</h1>
    <div class="meta">${meta}</div>
    ${withdrawn}
    <div>${bodyEl ? bodyEl.innerHTML : ''}</div>
    <div class="foot">Printed from ReadyDoc ${new Date().toLocaleString()} — uncontrolled when printed. Verify the revision against the registry.</div>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function DocumentViewer({ id, onClose }) {
  const { data: doc } = useApiGet(id ? `/documents/${id}` : null);
  const bodyRef = useRef(null);
  if (!id) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-200">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900">{doc?.title || 'Loading…'}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {[doc?.doc_number, doc?.revision && `Rev ${doc.revision}`, doc?.effective_date && `Effective ${doc.effective_date}`,
                doc?.owner].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {doc && (
              <button onClick={() => printDocument(doc, bodyRef.current)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200">
                <Printer size={14} /> Print
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-500" /></button>
          </div>
        </div>
        <div className="p-5">
          {doc?.gdrive_url && (
            <a href={doc.gdrive_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline mb-3">
              <ExternalLink size={13} /> Open the source file
            </a>
          )}
          <div ref={bodyRef} className="prose-sm max-w-none">
            <MarkdownView text={doc?.description} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Controlled documents registry ────────────────────────────────────────────
function DocumentsSection({ docType, title, noun = 'controlled documents' }) {
  const { data: docs } = useApiGet(docType ? `/documents?doc_type=${docType}` : '/documents');
  const rows = docs || [];
  const [openId, setOpenId] = useState(null);
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv(`${title.toLowerCase().replace(/\W+/g, '-')}-registry.csv`, [
      { label: 'Doc #', value: r => r.doc_number || '' },
      { label: 'Title', value: r => r.title },
      { label: 'Revision', value: r => r.revision || '' },
      { label: 'Status', value: r => r.status || '' },
      { label: 'Effective', value: r => r.effective_date || '' },
      { label: 'Review Due', value: r => r.review_due || '' },
      { label: 'Owner', value: r => r.owner || '' },
    ], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} {noun}</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Doc #</Th><Th>Title</Th><Th>Rev</Th><Th>Status</Th><Th>Effective</Th><Th>Review Due</Th><Th>Owner</Th></tr></thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setOpenId(d.id)} title="Open the document">
                  <Td>{d.doc_number || '—'}</Td>
                  <Td wide><span className="text-powder-700 hover:underline">{d.title}</span></Td>
                  <Td dim>{d.revision || '—'}</Td>
                  <Td dim><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${d.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{d.status}</span></Td>
                  <Td dim>{d.effective_date || '—'}</Td>
                  <Td dim>{d.review_due || '—'}</Td>
                  <Td dim>{d.owner || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DocumentViewer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ── Training completions ─────────────────────────────────────────────────────
function TrainingSection() {
  const { data } = useApiGet('/training?limit=500');
  const rows = Array.isArray(data) ? data : (data?.items || []);
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv('training-records-audit.csv', [
      { label: 'Person', value: r => r.person_name || r.user_name || '' },
      { label: 'Course', value: r => r.course_title || r.course_name || '' },
      { label: 'Completed', value: r => r.completed_at || r.completion_date || '' },
      { label: 'Score', value: r => r.score ?? '' },
      { label: 'Trainer', value: r => r.trainer || r.verified_by || '' },
    ], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} training completions</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Person</Th><Th>Course</Th><Th>Completed</Th><Th>Score</Th></tr></thead>
            <tbody>
              {rows.slice(0, 100).map((r, i) => (
                <tr key={r.id || i} className="border-b border-gray-100">
                  <Td>{r.person_name || r.user_name || '—'}</Td>
                  <Td wide dim>{r.course_title || r.course_name || '—'}</Td>
                  <Td dim>{(r.completed_at || r.completion_date || '').slice(0, 10) || '—'}</Td>
                  <Td dim>{r.score ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {rows.length}. Export CSV for full data.</p>}
        </div>
      )}
    </div>
  );
}

// ── Certifications ───────────────────────────────────────────────────────────
function CertificationsSection() {
  const { data } = useApiGet('/certifications');
  const rows = data?.certifications || [];
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv('certifications-audit.csv', [
      { label: 'Person', value: r => r.person_name },
      { label: 'Certification', value: r => r.cert_type },
      { label: 'Issuer', value: r => r.issuer || '' },
      { label: 'Cert #', value: r => r.cert_number || '' },
      { label: 'Issued', value: r => r.issued_date || '' },
      { label: 'Expires', value: r => r.expiry_date || '' },
      { label: 'Status', value: r => r.status },
    ], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} certifications on file (PCQI, HACCP, …)</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Person</Th><Th>Certification</Th><Th>Issuer</Th><Th>Expires</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className="border-b border-gray-100">
                  <Td>{c.person_name}</Td>
                  <Td wide dim>{c.cert_type}</Td>
                  <Td dim>{c.issuer || '—'}</Td>
                  <Td dim>{c.expiry_date || 'No expiry'}</Td>
                  <Td dim><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c.status === 'valid' ? 'bg-green-100 text-green-800' : c.status === 'expiring' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{c.status}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── CAPAs ────────────────────────────────────────────────────────────────────
function CapaSection() {
  const { data } = useApiGet('/complaints/capas/all');
  const rows = data || [];
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv('capa-audit.csv', [
      { label: 'CAPA #', value: r => r.capa_number },
      { label: 'Title', value: r => r.title },
      { label: 'Status', value: r => r.status },
      { label: 'Priority', value: r => r.priority || '' },
      { label: 'Issued', value: r => r.date_issued || '' },
      { label: 'Assigned To', value: r => r.assigned_to || '' },
      { label: 'Root Cause', value: r => r.root_cause || '' },
      { label: 'Corrective Action', value: r => r.corrective_action || '' },
      { label: 'Preventive Action', value: r => r.preventive_action || '' },
    ], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} CAPAs</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>CAPA #</Th><Th>Title</Th><Th>Status</Th><Th>Issued</Th><Th>Assigned</Th></tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className="border-b border-gray-100">
                  <Td>{c.capa_number}</Td>
                  <Td wide dim>{c.title}</Td>
                  <Td dim><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c.status === 'closed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{c.status}</span></Td>
                  <Td dim>{c.date_issued || '—'}</Td>
                  <Td dim>{c.assigned_to || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Disposals ────────────────────────────────────────────────────────────────
function DisposalsSection() {
  const { data } = useApiGet('/disposals');
  const rows = Array.isArray(data) ? data : (data?.items || []);
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv('disposals-audit.csv', [
      { label: 'Disposal #', value: r => r.disposal_number },
      { label: 'Date', value: r => r.disposal_date || r.created_at?.slice(0, 10) || '' },
      { label: 'Reason', value: r => r.reason || '' },
      { label: 'Status', value: r => r.status || '' },
      { label: 'Witness', value: r => r.witness || '' },
    ], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} disposal records</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>#</Th><Th>Reason</Th><Th>Date</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.slice(0, 100).map(d => (
                <tr key={d.id} className="border-b border-gray-100">
                  <Td>{d.disposal_number}</Td>
                  <Td wide dim>{d.reason || '—'}</Td>
                  <Td dim>{d.disposal_date || (d.created_at || '').slice(0, 10) || '—'}</Td>
                  <Td dim>{d.status || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── COA / lab testing ────────────────────────────────────────────────────────
function CoaSection() {
  // Tolerates the array shape too — the endpoint now answers
  // { requests, total, shown } so a capped list can say so.
  const { data: coaPayload } = useApiGet('/coa/requests');
  const data = Array.isArray(coaPayload) ? coaPayload : (coaPayload?.requests || null);
  const rows = data || [];
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv('coa-lab-audit.csv', [
      { label: 'Item #', value: r => r.item_number || '' },
      { label: 'Description', value: r => r.item_description || '' },
      { label: 'Lot', value: r => r.lot_number || '' },
      { label: 'Tests', value: r => r.tests_requested || '' },
      { label: 'Lab', value: r => r.lab_name || '' },
      { label: 'Date Sent', value: r => r.date_sent || '' },
      { label: 'Results Date', value: r => r.date_of_results || '' },
      { label: 'Status', value: r => r.status || '' },
    ], rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} lab test records</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Item</Th><Th>Lot</Th><Th>Tests</Th><Th>Lab</Th><Th>Results</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.slice(0, 100).map(r => (
                <tr key={r.id} className="border-b border-gray-100">
                  <Td wide>{r.item_description || r.item_number || '—'}</Td>
                  <Td dim>{r.lot_number || '—'}</Td>
                  <Td dim>{r.tests_requested || '—'}</Td>
                  <Td dim>{r.lab_name || '—'}</Td>
                  <Td dim>{r.date_of_results || '—'}</Td>
                  <Td dim><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.status === 'pass' ? 'bg-green-100 text-green-800' : r.status === 'fail' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>{r.status || 'pending'}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {rows.length}. Export CSV for full data.</p>}
        </div>
      )}
    </div>
  );
}

// ── Mock recalls ─────────────────────────────────────────────────────────────
function RecallSection() {
  const { data } = useApiGet('/mock-recalls');
  const rows = Array.isArray(data) ? data : (data?.items || []);
  const doExport = () => {
    if (!rows.length) return;
    exportToCsv('mock-recalls-audit.csv', Object.keys(rows[0] || {}).map(k => ({ label: k, value: r => typeof r[k] === 'object' ? JSON.stringify(r[k] ?? '') : (r[k] ?? '') })), rows);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} mock recall exercises</p>
        <ExportButton onClick={doExport} />
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Date</Th><Th>Product / Lot</Th><Th>Recovery</Th><Th>Duration</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} className="border-b border-gray-100">
                  <Td>{r.recall_date || r.date || (r.created_at || '').slice(0, 10) || '—'}</Td>
                  <Td wide dim>{[r.product_name || r.product, r.lot_number || r.lot].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td dim>{r.recovery_percent != null ? `${r.recovery_percent}%` : '—'}</Td>
                  <Td dim>{r.duration_minutes != null ? `${r.duration_minutes} min` : '—'}</Td>
                  <Td dim>{r.status || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-gray-400">No mock recall exercises recorded yet.</p>}
    </div>
  );
}

// (Existing evidence sections — PM, calibration, sanitation, chemicals, audit
// trail — unchanged in substance, now living inside chapters.)
function PMSection({ dateRange }) {
  const { data: history } = useApiGet(`/pm/completed-history?limit=500&from=${dateRange.from}&to=${dateRange.to}`);
  const { data: metrics } = useApiGet('/pm/metrics');
  const exportPM = () => {
    if (!history?.items?.length) return;
    exportToCsv(`pm-audit-${dateRange.from}-to-${dateRange.to}.csv`, [
      { label: 'Status', value: r => r.status },
      { label: 'Title', value: r => r.title || r.pm_title },
      { label: 'Equipment', value: r => r.equipment_name },
      { label: 'Location', value: r => r.location },
      { label: 'Frequency', value: r => r.frequency_type || 'ad-hoc' },
      { label: 'Due Date', value: r => r.due_date },
      { label: 'Completed At', value: r => r.completed_at || '' },
      { label: 'Completed By', value: r => r.completed_by || '' },
      { label: 'Notes', value: r => r.notes || '' },
      { label: 'Lubricant Used', value: r => r.lubricant_used || '' },
      { label: 'Food Grade Lubricant', value: r => r.lubricant_is_food_grade ? 'Yes' : '' },
      { label: 'Issue Flagged', value: r => r.issue_flagged ? 'Yes' : 'No' },
      { label: 'Issue Notes', value: r => r.issue_notes || '' },
    ], history?.items || []);
  };
  return (
    <div className="space-y-3">
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`rounded-lg p-3 ${metrics.meets_sqf_target ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <p className="text-xs text-gray-600">Completion Rate</p>
            <p className="text-xl font-bold">{metrics.completion_rate}%</p>
            <p className="text-[10px] text-gray-500">{metrics.meets_sqf_target ? 'SQF Target Met (≥95%)' : 'Below 95% SQF Target'}</p>
          </div>
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200"><p className="text-xs text-gray-600">Total WOs</p><p className="text-xl font-bold">{metrics.total}</p></div>
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200"><p className="text-xs text-gray-600">Completed</p><p className="text-xl font-bold text-green-600">{metrics.completed}</p></div>
          <div className={`rounded-lg p-3 ${metrics.overdue > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}><p className="text-xs text-gray-600">Overdue</p><p className="text-xl font-bold text-red-600">{metrics.overdue}</p></div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{history?.total || 0} records in selected period</p>
        <ExportButton onClick={exportPM} />
      </div>
      {history?.items?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Status</Th><Th>Title</Th><Th>Equipment</Th><Th>Due Date</Th><Th>Completed</Th><Th>By</Th></tr></thead>
            <tbody>
              {(history?.items || []).slice(0, 100).map(wo => (
                <tr key={wo.id} className="border-b border-gray-100">
                  <Td><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${wo.status === 'completed' ? 'bg-green-100 text-green-800' : wo.status === 'missed' ? 'bg-gray-200 text-gray-700' : 'bg-yellow-100 text-yellow-800'}`}>{wo.status}</span></Td>
                  <Td wide>{wo.title || wo.pm_title}</Td>
                  <Td dim>{wo.equipment_name}</Td>
                  <Td dim>{wo.due_date}</Td>
                  <Td dim>{wo.completed_at ? formatDate(wo.completed_at) : '—'}</Td>
                  <Td dim>{wo.completed_by || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {history?.items?.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {history.items.length}. Export CSV for full data.</p>}
        </div>
      )}
    </div>
  );
}

function CalibrationSection() {
  const { data: instruments } = useApiGet('/calibration/instruments');
  const { data: summary } = useApiGet('/calibration/summary');
  const exportCal = () => {
    if (!instruments?.length) return;
    exportToCsv(`calibration-audit-${new Date().toISOString().split('T')[0]}.csv`, [
      { label: 'Asset #', value: r => r.asset_number || '' },
      { label: 'Name', value: r => r.name },
      { label: 'Serial #', value: r => r.serial_number || '' },
      { label: 'Manufacturer', value: r => r.manufacturer || '' },
      { label: 'Model', value: r => r.model || '' },
      { label: 'Room', value: r => r.room || '' },
      { label: 'Department', value: r => r.department || '' },
      { label: 'Last Calibrated', value: r => r.last_calibrated || '' },
      { label: 'Next Due', value: r => r.next_due || '' },
      { label: 'Status', value: r => r.status },
      { label: 'Frequency', value: r => r.calibration_frequency || '' },
    ], instruments);
  };
  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200"><p className="text-xs text-gray-600">Total Instruments</p><p className="text-xl font-bold">{summary.total}</p></div>
          <div className="rounded-lg p-3 bg-green-50 border border-green-200"><p className="text-xs text-gray-600">Current</p><p className="text-xl font-bold text-green-600">{summary.current}</p></div>
          <div className={`rounded-lg p-3 ${summary.overdue > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}><p className="text-xs text-gray-600">Overdue</p><p className="text-xl font-bold text-red-600">{summary.overdue}</p></div>
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200"><p className="text-xs text-gray-600">Due Soon (30d)</p><p className="text-xl font-bold text-amber-600">{summary.due_soon}</p></div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{instruments?.length || 0} instruments</p>
        <ExportButton onClick={exportCal} />
      </div>
      {instruments?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Asset #</Th><Th>Make / Model</Th><Th>Room</Th><Th>Dept</Th><Th>Last Cal.</Th><Th>Next Due</Th><Th>Status</Th></tr></thead>
            <tbody>
              {instruments.map(inst => (
                <tr key={inst.id} className="border-b border-gray-100">
                  <Td>{inst.asset_number || '—'}</Td>
                  <Td wide dim>{inst.manufacturer} {inst.model}</Td>
                  <Td dim>{inst.room || '—'}</Td>
                  <Td dim>{inst.department || '—'}</Td>
                  <Td dim>{inst.last_calibrated || '—'}</Td>
                  <Td dim>{inst.next_due || '—'}</Td>
                  <Td><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${inst.status === 'active' ? 'bg-green-100 text-green-800' : inst.status === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{inst.status}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SanitationSection({ dateRange }) {
  const { data: records } = useApiGet(`/sanitation?from=${dateRange.from}&to=${dateRange.to}&limit=500`);
  const items = records || [];
  const passCount = items.filter(r => r.result === 'pass').length;
  const exportSan = () => {
    if (!items.length) return;
    exportToCsv(`sanitation-audit-${dateRange.from}-to-${dateRange.to}.csv`, [
      { label: 'Date', value: r => r.performed_at },
      { label: 'Equipment', value: r => r.equipment_name || '' },
      { label: 'Area', value: r => r.area || '' },
      { label: 'Type', value: r => r.type },
      { label: 'Chemical', value: r => r.chemicals_used || '' },
      { label: 'Concentration', value: r => r.concentration || '' },
      { label: 'Contact Time (min)', value: r => r.contact_time_minutes ?? '' },
      { label: 'ATP Reading', value: r => r.atp_reading ?? '' },
      { label: 'Result', value: r => r.result },
      { label: 'Performed By', value: r => r.performed_by || '' },
      { label: 'Verified By', value: r => r.verified_by || '' },
    ], items);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg p-3 bg-gray-50 border border-gray-200"><p className="text-xs text-gray-600">Total Records</p><p className="text-xl font-bold">{items.length}</p></div>
        <div className="rounded-lg p-3 bg-green-50 border border-green-200"><p className="text-xs text-gray-600">Pass Rate</p><p className="text-xl font-bold text-green-600">{items.length > 0 ? ((passCount / items.length) * 100).toFixed(1) : 100}%</p></div>
        <div className={`rounded-lg p-3 ${items.length - passCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}><p className="text-xs text-gray-600">Failures</p><p className="text-xl font-bold text-red-600">{items.length - passCount}</p></div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{items.length} records</p>
        <ExportButton onClick={exportSan} />
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Date</Th><Th>Area / Equipment</Th><Th>Chemical</Th><Th>ATP</Th><Th>Result</Th><Th>By</Th></tr></thead>
            <tbody>
              {items.slice(0, 100).map(r => (
                <tr key={r.id} className="border-b border-gray-100">
                  <Td dim>{r.performed_at ? formatDate(r.performed_at) : '—'}</Td>
                  <Td wide>{r.area || r.equipment_name || '—'}</Td>
                  <Td dim>{r.chemicals_used || '—'}</Td>
                  <Td dim>{r.atp_reading ?? '—'}</Td>
                  <Td><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.result === 'pass' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{r.result}</span></Td>
                  <Td dim>{r.performed_by || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {items.length}. Export CSV for full data.</p>}
        </div>
      )}
    </div>
  );
}

function ChemicalsSection() {
  const { data: chemicals } = useApiGet('/chemicals');
  const exportChemicals = () => {
    if (!chemicals?.length) return;
    exportToCsv(`approved-chemicals-${new Date().toISOString().split('T')[0]}.csv`, [
      { label: 'Name', value: r => r.name },
      { label: 'Category', value: r => r.category },
      { label: 'Manufacturer', value: r => r.manufacturer || '' },
      { label: 'SDS Number', value: r => r.sds_number || '' },
      { label: 'Food Grade', value: r => r.is_food_grade ? 'Yes' : 'No' },
      { label: 'NSF Rating', value: r => r.nsf_rating || '' },
      { label: 'Location For Use', value: r => r.location_for_use || '' },
      { label: 'Active', value: r => r.is_active ? 'Yes' : 'No' },
    ], chemicals);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{chemicals?.length || 0} approved chemicals</p>
        <ExportButton onClick={exportChemicals} />
      </div>
      {chemicals?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Name</Th><Th>Category</Th><Th>Food Grade</Th><Th>Location</Th><Th>SDS</Th></tr></thead>
            <tbody>
              {chemicals.map(c => (
                <tr key={c.id} className="border-b border-gray-100">
                  <Td wide>{c.name}</Td>
                  <Td><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 capitalize">{c.category}</span></Td>
                  <Td>{c.is_food_grade ? <span className="text-green-600 text-xs font-medium">Yes</span> : <span className="text-gray-400 text-xs">No</span>}</Td>
                  <Td dim>{c.location_for_use || '—'}</Td>
                  <Td>{c.sds_url ? <a href={c.sds_url} target="_blank" rel="noopener noreferrer" className="text-powder-600 text-xs hover:underline">View SDS</a> : c.sds_number || <span className="text-amber-500 text-xs">Missing</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditLogSection({ dateRange }) {
  const { data: logs } = useApiGet(`/audit?from=${dateRange.from}&to=${dateRange.to}&limit=200`);
  const items = logs?.data || logs?.items || logs || [];
  const exportAudit = () => {
    if (!items.length) return;
    exportToCsv(`audit-log-${dateRange.from}-to-${dateRange.to}.csv`, [
      { label: 'Timestamp', value: r => r.timestamp },
      { label: 'Actor', value: r => r.actor },
      { label: 'Action', value: r => r.action },
      { label: 'Entity Type', value: r => r.entity_type },
      { label: 'Entity ID', value: r => r.entity_id },
    ], items);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{items.length} log entries</p>
        <ExportButton onClick={exportAudit} />
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200"><Th>Timestamp</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th></tr></thead>
            <tbody>
              {items.slice(0, 100).map((log, i) => (
                <tr key={log.id || i} className="border-b border-gray-100">
                  <Td dim>{log.timestamp ? formatDateTime(log.timestamp) : '—'}</Td>
                  <Td>{log.actor}</Td>
                  <Td><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">{log.action}</span></Td>
                  <Td wide dim>{log.entity_type} {log.entity_id ? `(${String(log.entity_id).slice(0, 8)}…)` : ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {items.length}. Export CSV for full data.</p>}
        </div>
      )}
    </div>
  );
}

// ── The binder ───────────────────────────────────────────────────────────────
// Chapter definitions: number, standard references, and the evidence sections.
const CHAPTERS = [
  {
    id: 'docs', title: 'Food Safety Documentation & Document Control',
    ref: 'SQF 2.2 / NSF 455-2 Documentation Requirements', icon: BookOpen,
    desc: 'Controlled SOPs, policies, and work instructions with revision control, plus the document change request log.',
    // When the registry and the change log are both hidden, this chapter is
    // about how records move rather than about documents — so it says so.
    // A chapter heading promising a document registry above a page with no
    // registry on it reads as something failing to load.
    descWhenHidden: 'How records move through the plant and who owns each step. Controlled documents and change requests are being presented on paper this audit.',
    titleWhenHidden: 'How Records Move',
    sections: () => [
      ['Controlled Document Registry', BookOpen, <DocumentsSection key="d" title="Documents" />, 'documents'],
      ['Document Change Requests', FileText, <QmsSection key="dcr" type="document_change_request" />, 'dcr'],
      // How the records actually move, and who owns what. Sits in chapter 1
      // because it is the orientation an auditor wants before opening any log.
      ['Process Maps — how records move, who does what', Workflow, <ProcessFlows key="pf" />, 'process-maps'],
    ],
  },
  {
    id: 'people', title: 'Personnel: Training, Job Descriptions & Certifications',
    ref: 'SQF 2.9 / NSF 455-2 Personnel & Training', icon: GraduationCap,
    desc: 'GMP and role training completions, the job descriptions those roles are defined by, and professional certifications (PCQI, HACCP) with certificate files on record.',
    sections: () => [
      ['Training Records', GraduationCap, <TrainingSection key="t" />],
      // Job descriptions live in sop_documents like every other controlled
      // document, but they belong to the PERSONNEL chapter, not the document
      // registry: an auditor asks for a JD next to that person's training, and
      // "who is responsible for X" is a personnel question. Its own section id
      // so it is independent of the registry toggle — hiding the registry while
      // the plant works from paper must not take the job descriptions with it,
      // which is exactly what happened.
      ['Job Descriptions', GraduationCap, <DocumentsSection key="jd" docType="job_description" title="Job Descriptions" noun="job descriptions" />, 'job-descriptions'],
      ['Certifications (PCQI / HACCP / other)', CheckCircle, <CertificationsSection key="c" />],
    ],
  },
  {
    id: 'pm', title: 'Preventive Maintenance Program',
    ref: 'SQF 11.2 / NSF 455-2 Equipment & Maintenance', icon: Wrench,
    desc: 'PM completion history with SQF 95% target tracking, food-grade lubricant records, and flagged issues. Includes glass & brittle plastic and light inspections (scheduled tasks).',
    sections: (dr) => [['PM History & Completion Rate', Wrench, <PMSection key="pm" dateRange={dr} />]],
  },
  {
    id: 'cal', title: 'Calibration',
    ref: 'SQF 11.1.4 / NSF 455-2 Calibration', icon: Thermometer,
    desc: 'Instrument register with calibration status, last/next due dates, and frequencies.',
    sections: () => [['Calibration Instruments', Thermometer, <CalibrationSection key="c" />]],
  },
  {
    id: 'san', title: 'Sanitation & Chemical Control',
    ref: 'SQF 11.1 / NSF 455-2 Cleaning & Sanitation', icon: Droplets,
    desc: 'Cleaning and sanitation records with ATP verification and pass rates, plus the approved chemical registry with SDS references.',
    sections: (dr) => [
      ['Sanitation Records', Droplets, <SanitationSection key="s" dateRange={dr} />],
      ['Approved Chemicals Registry', FlaskConical, <ChemicalsSection key="c" />],
    ],
  },
  {
    id: 'foreign', title: 'Foreign Material Prevention',
    ref: 'SQF 11.7.4 / NSF 455-2 Foreign Material Control', icon: Scissors,
    desc: 'Knife / razor blade / scissor master list and per-transaction accountability log with QA review.',
    sections: () => [
      ['Knife / Blade Master List', Scissors, <QmsSection key="m" type="knife_accountability" />],
      ['Knife / Blade Sign In-Out Log', Scissors, <QmsSection key="l" type="knife_sign_out" />],
    ],
  },
  {
    id: 'quality', title: 'Quality Events & Corrective Action',
    ref: 'SQF 2.5.3 / NSF 455-2 Nonconformance & CAPA', icon: FileWarning,
    desc: 'Non-conformances, deviations, product holds, CAPAs, and witnessed disposals.',
    sections: () => [
      ['Non-Conformance Reports', FileWarning, <QmsSection key="nc" type="non_conformance" />],
      ['Deviations', FileWarning, <QmsSection key="dev" type="deviation" />],
      ['On Hold Log', AlertTriangle, <QmsSection key="oh" type="on_hold" />],
      ['CAPAs', CheckCircle, <CapaSection key="capa" />],
      ['Disposals', FileText, <DisposalsSection key="disp" />],
    ],
  },
  {
    id: 'testing', title: 'Product Testing & Release',
    ref: 'SQF 2.5.6 / NSF 455-2 Testing & Release', icon: TestTubes,
    desc: 'Third-party lab testing (COA) records, organoleptic sensory tests, and flavor approval sign-offs.',
    sections: () => [
      ['COA / Lab Testing', TestTubes, <CoaSection key="coa" />],
      ['Organoleptic Sensory Tests', TestTubes, <QmsSection key="org" type="organoleptic" />],
      ['Flavor Approvals', CheckCircle, <QmsSection key="fa" type="flavor_approval" />],
    ],
  },
  {
    id: 'trace', title: 'Traceability & Recall Readiness',
    ref: 'SQF 2.6 / NSF 455-2 Traceability & Recall', icon: PackageSearch,
    desc: 'Mock recall exercises and component lot sign in/out records supporting lot traceability.',
    sections: () => [
      ['Mock Recall Exercises', PackageSearch, <RecallSection key="r" />],
      ['Component Sign In/Out', PackageSearch, <QmsSection key="cso" type="component_sign_out" />],
    ],
  },
  {
    id: 'trail', title: 'System Audit Trail',
    ref: 'Data integrity — who did what, when', icon: ScrollText,
    desc: 'The immutable change log behind every record in this system.',
    sections: (dr) => [['Audit Trail', ScrollText, <AuditLogSection key="a" dateRange={dr} />]],
  },
];

// A chapter with every section hidden is dropped from the binder entirely —
// a numbered chapter that opens on nothing is worse than one that isn't there,
// because the auditor is left wondering what was meant to be in it.
function visibleChapters(hidden) {
  const out = [];
  for (const c of CHAPTERS) {
    const sections = c.sections(null).filter(([, , , id]) => !id || !hidden.includes(id));
    if (!sections.length) continue;
    const reduced = sections.length < c.sections(null).length;
    out.push({
      ...c,
      title: reduced && c.titleWhenHidden ? c.titleWhenHidden : c.title,
      desc: reduced && c.descWhenHidden ? c.descWhenHidden : c.desc,
      sections: (dr) => c.sections(dr).filter(([, , , id]) => !id || !hidden.includes(id)),
    });
  }
  return out;
}

export default function AuditorView() {
  const { user, logout } = useAuth();
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const [dateRange, setDateRange] = useState({
    from: yearAgo.toISOString().split('T')[0],
    to: now.toISOString().split('T')[0],
  });
  const [chapterId, setChapterId] = useState(null); // null = table of contents
  // Which sections the plant is presenting from the system this time. Set in
  // Settings → Shareable Links, so it changes without a deploy.
  const { data: binder } = useApiGet('/compliance/binder');
  const hidden = useMemo(() => binder?.hidden || [], [binder]);
  const chapters = useMemo(() => visibleChapters(hidden), [hidden]);

  const chapter = chapters.find(c => c.id === chapterId) || null;
  const chapterIndex = chapter ? chapters.indexOf(chapter) : -1;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <button onClick={() => setChapterId(null)} className="flex items-center gap-3 text-left">
            <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Powder Ops FSQA</h1>
              <p className="text-xs text-gray-500">Audit Evidence Binder — Read Only</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">AUDITOR</span>
            <span className="text-xs text-gray-500 hidden sm:inline">{user?.name}</span>
            <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {chapter === null ? (
          <>
            {/* ── Cover / Table of Contents ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-powder-600 mb-1">Powder Ops LLC · Vineyard, UT</p>
                  <h2 className="text-2xl font-bold text-gray-900">Food Safety & Quality Audit Binder</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Table of contents for the on-site audit. Every chapter opens live records from the operating system —
                    nothing here is staged for the audit. Generated {now.toLocaleDateString()} for {user?.name}.
                  </p>
                </div>
                <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 print:hidden">
                  <Printer size={15} /> Print this page
                </button>
              </div>
              {/* The plant's own pass/fail verdict does not belong on the cover
                  of the binder. It was a self-assessment computed from a
                  thirty-day window, printed in red, above the records — which
                  reads as a finding the auditor did not make and cannot check
                  from the sentence itself. The evidence is in the chapters:
                  the PM chapter still shows the completion rate with the
                  history behind it, calibration still shows what is overdue,
                  and sanitation still shows its pass rate. Removing the verdict
                  hides no record; it stops the binder arguing with itself. */}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {chapters.map((c, i) => (
                <button key={c.id} onClick={() => setChapterId(c.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-powder-50/50 transition-colors group">
                  <span className="text-lg font-bold text-gray-300 group-hover:text-powder-400 w-7 shrink-0 tabular-nums">{i + 1}</span>
                  <div className="w-9 h-9 bg-powder-50 rounded-lg flex items-center justify-center shrink-0">
                    <c.icon size={17} className="text-powder-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{c.title}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{c.ref}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{c.desc}</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-powder-500 shrink-0" />
                </button>
              ))}
            </div>

            <p className="text-[11px] text-gray-400 text-center pb-2">
              This portal shows requisite audit evidence only. Facility SOP hard copies, HACCP plan, and supplier documentation are available from the SQF Practitioner on request.
            </p>
          </>
        ) : (
          <>
            {/* ── Chapter view ── */}
            <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
              <button onClick={() => setChapterId(null)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                <ArrowLeft size={15} /> Table of Contents
              </button>
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">From</label>
                  <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
                    className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">To</label>
                  <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
                    className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-powder-600">Chapter {chapterIndex + 1} · {chapter.ref}</p>
              <h2 className="text-xl font-bold text-gray-900 mt-0.5">{chapter.title}</h2>
              <p className="text-sm text-gray-500 mt-1">{chapter.desc}</p>
            </div>

            {chapter.sections(dateRange).map(([title, icon, node]) => (
              <Section key={title} title={title} icon={icon}>{node}</Section>
            ))}

            <div className="flex items-center justify-between print:hidden">
              {chapterIndex > 0 ? (
                <button onClick={() => setChapterId(chapters[chapterIndex - 1].id)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-powder-700">
                  <ArrowLeft size={14} /> {chapterIndex}. {chapters[chapterIndex - 1].title}
                </button>
              ) : <span />}
              {chapterIndex < chapters.length - 1 && (
                <button onClick={() => setChapterId(chapters[chapterIndex + 1].id)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-powder-700 text-right">
                  {chapterIndex + 2}. {chapters[chapterIndex + 1].title} <ChevronRight size={14} />
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
