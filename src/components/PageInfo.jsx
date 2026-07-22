import { useState, useRef, useEffect } from 'react';
import { Info, X } from 'lucide-react';

// Per-module explainer: what the page does, what it connects to, and why it
// matters for SQF. Opened from the ⓘ next to the page title.
const MODULE_INFO = {
  dashboard: {
    what: 'Live audit-readiness overview: task completion, calibration status, sanitation pass rate, chemical SDS coverage, and open issues, with a checklist of what to fix to reach a full pass.',
    links: 'Pulls from Task Center, Calibration, Sanitation, Chemicals, and the QMS logs; each checklist item links to the module that clears it.',
    sqf: 'Demonstrates management review and ongoing verification (SQF 2.1) — auditors see current compliance state at a glance.',
  },
  operator: {
    what: 'Each operator’s daily worklist: assigned tasks by team, overdue/today/this-week buckets, EN/ES toggle, and guided completion (readings, chemical verification, inspections).',
    links: 'Tasks come from Task Center PM schedules and ad-hoc assignments; completions flow back with timestamps, readings, and e-sign identity.',
    sqf: 'Captures who did what, when, and against which procedure — the operational records auditors sample (SQF 2.5, 11.2).',
  },
  'production-log': {
    what: 'End-of-day production reporting: runs by date/team/room with quantities, times, crew size, and QA sign-off. Missed-EOD tracking flags scheduled runs with no report.',
    links: 'Compares against the Schedule; QA sign-off routes to QA; entries feed Production KPIs and Team Activity.',
    sqf: 'Production records with QA verification support lot traceability and release (SQF 2.4.8, 2.6.1).',
  },
  'production-schedule': {
    what: 'The weekly production plan by room and day: products, MOs, start times, cleaning levels, multi-product days, and next-week planning. Notify publishes updates to team channels.',
    links: 'Notify posts per-team overviews to Messages; missed-EOD checks in the Production Log key off this schedule; downstream packaging steps auto-populate.',
    sqf: 'Scheduling with cleaning levels evidences sanitation planning between runs (SQF 11.2.5).',
  },
  'production-dashboard': {
    what: 'Production KPIs: output by team/week, scheduled vs actual, top products, and man-hour efficiency.',
    links: 'Aggregates Production Log entries against the Schedule.',
    sqf: 'Trend data supports management review and continuous improvement (SQF 2.1.3).',
  },
  'component-signout': {
    what: 'Sign in/out log for components with condition tracking and QA issue/retrieve verification.',
    links: 'Kiosk mode for floor use; records attach scanned forms; approvals route to QA.',
    sqf: 'Accountability for items entering production areas (foreign-material control, SQF 11.7).',
  },
  'maintenance-signout': {
    what: 'Check in/out for tools, sealers, and calibration weights, grouped by source list, with condition on issue and return.',
    links: 'Item list managed in-app; kiosk mode; calibration weights also live in the Calibration log.',
    sqf: 'Tool accountability prevents foreign-material hazards from maintenance activities (SQF 11.7.5).',
  },
  'knife-accountability': {
    what: 'Knife / razor blade / scissor issue-and-return log against a controlled masterlist.',
    links: 'Kiosk mode for the floor; masterlist seeded from the paper log.',
    sqf: 'Sharp-object control is a core foreign-material prevention program (SQF 11.7.4).',
  },
  pm: {
    what: 'The Task Center: preventive-maintenance schedules and ad-hoc tasks for every team, with completion capture, hygiene clearance, and a completed archive.',
    links: 'Tasks appear in Operator View; hygiene clearance routes to QA; equipment links to the Equipment register; documents can be attached.',
    sqf: 'Preventive maintenance with post-maintenance hygiene clearance (SQF 11.2.4) — the schedule + records auditors always ask for.',
  },
  equipment: {
    what: 'The equipment register: every asset with location, food-contact status, PM frequency, and status.',
    links: 'Feeds Task Center PM schedules, Calibration, LOTO procedures, and HACCP CCP links.',
    sqf: 'An equipment register underpins maintenance and calibration programs (SQF 11.1.7, 11.2).',
  },
  calibration: {
    what: 'Calibration log for instruments and reference weights: frequency, last/next due, results, and certificates.',
    links: 'Instruments can link to equipment and HACCP CCPs; overdue items surface on the Dashboard.',
    sqf: 'Calibration of measuring devices is mandatory (SQF 11.1.7) — status and certificate records live here.',
  },
  loto: {
    what: 'Lockout/Tagout procedures per equipment and an execution history of energy isolations.',
    links: 'Procedures generated per equipment; executions record who locked/released and why.',
    sqf: 'Worker-safety control during maintenance; supports GMP separation of maintenance from production.',
  },
  coa: {
    what: 'COA / lab testing pipeline: lab requests by lot, specs, results, files, and pass/fail status, plus lot lookup and specifications.',
    links: 'Failed results can open QMS records; files upload per request; feeds the Dashboard.',
    sqf: 'Verifies raw-material and finished-goods conformance to specification (SQF 2.3.3, 2.4.4).',
  },
  'quality-schedules': {
    what: 'Recurring quality checks (swabs, verifications, reviews) that auto-generate QA tasks on schedule.',
    links: 'Generated tasks land in the Task Center / Operator View for QA.',
    sqf: 'Scheduled verification activities (SQF 2.5.4) with an auditable cadence.',
  },
  hygienic: {
    what: 'Hygienic design assessments for equipment and areas.',
    links: 'References the Equipment register.',
    sqf: 'Equipment hygienic-design evaluation (SQF 11.1.5).',
  },
  organoleptic: {
    what: 'Sensory (taste/smell/appearance) evaluations by lot with pass/fail and shelf-life checks.',
    links: 'A FAIL can pre-fill a Disposal record, back-linked for traceability.',
    sqf: 'Finished-product verification and shelf-life validation records (SQF 2.4.5).',
  },
  capa: {
    what: 'Corrective & preventive actions and customer complaints: root cause, actions, verification, and closure.',
    links: 'Can reference any record; closure requires verification sign-off.',
    sqf: 'CAPA is a pillar SQF element (2.5.3) — auditors trace complaints to closed actions here.',
  },
  deviations: {
    what: 'Deviation log: departures from procedure with disposition and approval.',
    links: 'Approvals route to QA/admin; entries are export-ready for audits.',
    sqf: 'Documents control of nonconforming process events (SQF 2.4.8).',
  },
  'non-conformance': {
    what: 'Non-conforming product/material log with investigator, disposition, and approval.',
    links: 'Links to On Hold and Disposals for material control.',
    sqf: 'Nonconforming product control (SQF 2.4.8) with disposition evidence.',
  },
  'on-hold': {
    what: 'Product/material hold log: what’s held, why, where, and release or disposition.',
    links: 'Releases require authorization; ties to Non-Conformance and Disposals.',
    sqf: 'Hold-and-release control (SQF 2.4.8.1) — a frequent audit sample point.',
  },
  disposals: {
    what: 'Disposal log for rejected/expired material with quantities, reasons, and approval workflow.',
    links: 'Can originate from Organoleptic failures; approvals route to QA/admin.',
    sqf: 'Evidence of disposition for nonconforming goods (SQF 2.4.8).',
  },
  recall: {
    what: 'Mock recall exercises: scope, lot tracing, timing, and reconciliation results.',
    links: 'Uses production and COA lot data for tracing.',
    sqf: 'Annual recall test is required (SQF 2.6.3) — run and document it here.',
  },
  sanitation: {
    what: 'Sanitation records by area/equipment: cleans, chemicals and concentrations, ATP readings, verification, and the 72-hour idle re-clean tracker.',
    links: 'Chemicals reference the Chemical register; verification routes to QA; feeds the Dashboard pass rate.',
    sqf: 'The sanitation program with verification (SQF 11.2.5) including the 72-hour idle rule.',
  },
  chemicals: {
    what: 'Approved chemical register: SDS numbers/links, food-grade status, concentrations, and review dates.',
    links: 'Sanitation records pick from this list; missing SDS flags on the Dashboard.',
    sqf: 'Chemical control with SDS access (SQF 11.6.4) — missing SDS is a common finding.',
  },
  sops: {
    what: 'Controlled SOP registry: native documents with versions, approvals, review scheduling, and EN/ES translation.',
    links: 'Review tasks route to Document Control; training can attach SOPs; e-signed approvals.',
    sqf: 'Document control (SQF 2.2) — current, approved procedures with revision history.',
  },
  'work-instructions': {
    what: 'Controlled work instructions, versioned and approved like SOPs.',
    links: 'Attachable to training and tasks.',
    sqf: 'Documented instructions at the point of use (SQF 2.2.1).',
  },
  'job-descriptions': {
    what: 'Controlled job descriptions per role.',
    links: 'Supports the Org Chart and training requirements.',
    sqf: 'Defined responsibilities and competencies (SQF 2.1.2).',
  },
  training: {
    what: 'Training program: course catalog, per-employee completion matrix, due/overdue tracking, tests with AI generation, and group sign-in sheets.',
    links: 'Courses can attach SOPs/WIs; requirements map to departments; completions are e-signed.',
    sqf: 'Training records and competency evidence (SQF 2.9) — the matrix is what auditors sample.',
  },
  dcr: {
    what: 'Document change requests: who asked for what change, review, and approval.',
    links: 'Ties into the document registries; approvals are logged.',
    sqf: 'Controlled change management for documents (SQF 2.2.1).',
  },
  'org-chart': {
    what: 'The organizational chart with reporting lines, maintained as structured data.',
    links: 'Roles link to Job Descriptions.',
    sqf: 'Defined organizational structure and backup coverage (SQF 2.1.2).',
  },
  'team-activity': {
    what: 'Team/department activity rollups from operational task data (admin only).',
    links: 'Aggregates work orders, submissions, and production entries.',
    sqf: 'Supports management review with objective performance data (SQF 2.1.3).',
  },
  audit: {
    what: 'The immutable audit log: every create/update/delete/approval with actor identity, before/after values, and timestamps. Filterable and exportable.',
    links: 'Every module writes here automatically; entity views show per-record history.',
    sqf: 'Record integrity and traceability across the whole system (SQF 2.2.3).',
  },
  settings: {
    what: 'User management: roles, departments, per-module view/edit access, password resets, and bulk add.',
    links: 'Access levels drive what each person sees across every module.',
    sqf: 'Access control protects record integrity (SQF 2.2.3).',
  },
  'supply-orders': {
    what: 'Supply ordering: supervisors submit requests; admin manages ordering, receiving, payment, and the invoice repository. One-click reorder from history.',
    links: 'Invoices upload to the searchable repository for accounting; requests can notify Messages.',
    sqf: 'Purchasing records support approved-supplier and materials control (SQF 2.3.2).',
  },
  'time-tracking': {
    what: 'Absence/tardy reporting: supervisors log adjustments for any employee; admin reviews with auto EN translation and per-employee history counts.',
    links: 'Employee list comes from Users; Spanish submissions auto-translate for review.',
    sqf: 'Supports training/competency scheduling and staffing records.',
  },
};

export default function PageInfo({ moduleId, title }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const info = MODULE_INFO[moduleId];
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!info) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="p-1 text-gray-300 hover:text-powder-600 rounded" data-tip="About this page">
        <Info size={15} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 max-w-[85vw] bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-bold text-gray-900">{title}</h4>
            <button onClick={() => setOpen(false)} className="text-gray-300 hover:text-gray-500"><X size={15} /></button>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-gray-400 mb-0.5">What this page does</div>
            <p className="text-xs text-gray-700 leading-relaxed">{info.what}</p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-gray-400 mb-0.5">Connected to</div>
            <p className="text-xs text-gray-700 leading-relaxed">{info.links}</p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-powder-500 mb-0.5">Why it matters for SQF</div>
            <p className="text-xs text-gray-700 leading-relaxed">{info.sqf}</p>
          </div>
        </div>
      )}
    </div>
  );
}
