// ─────────────────────────────────────────────────────────────────────────
// QMS Records framework — one engine, many record types.
//
// Each record type is described by a small config: the body fields, which
// columns show in the flat log, the role-gated approval sign-offs, and an
// optional CSV column mapping for seeding historical paper logs. The same
// config drives the server (validation, PDF, numbering) and the client
// (which fetches it from GET /api/qms/config and renders generically).
//
// Field types: text | textarea | date | select | multiselect | checkbox | number
// Built-in columns available to `logColumns`: record_number, record_date, approvals
// Approval canSign: admin always; else match `roles` (user.role) or `departments`.
// ─────────────────────────────────────────────────────────────────────────

export const QMS_TYPES = {
  document_change_request: {
    key: 'document_change_request',
    label: 'Document Change Requests',
    singular: 'Document Change Request',
    short: 'DCR',
    moduleId: 'dcr',
    formCode: 'Form 406-1',
    numberPrefix: '',
    numberPad: 4, // 0001, 0002, …
    primaryField: 'doc_name',
    dateLabel: 'Request Date',
    fields: [
      { key: 'request_type', label: 'Request Type', type: 'select', options: ['Approval', 'Obsolescence'] },
      { key: 'initiator', label: 'Name of Initiator', type: 'text' },
      { key: 'initiator_role', label: "Initiator's Department & Title", type: 'text' },
      { key: 'doc_number', label: 'Document Number', type: 'text' },
      { key: 'doc_name', label: 'Document Name', type: 'text' },
      { key: 'revision', label: 'New Revision', type: 'text' },
      { key: 'change_type', label: 'Change', type: 'select', options: ['New Document', 'New Revision', 'Number Termination', 'Obsolescence'] },
      { key: 'reasons', label: 'Reason for Change', type: 'multiselect', options: ['Formulation Change', 'Bill of Materials Change', 'New Work Instruction', 'New SOP/Form', 'Non-conformance resolution', 'Other'] },
      { key: 'description', label: 'Description of the Change', type: 'textarea' },
      { key: 'requires_training', label: 'Change requires training', type: 'checkbox' },
    ],
    logColumns: ['record_number', 'doc_number', 'doc_name', 'revision', 'change_type', 'record_date', 'approvals'],
    approvals: [
      { key: 'quality_assurance', label: 'Quality Assurance', required: true, departments: ['qa'] },
      { key: 'document_control', label: 'Document Control', roles: ['admin', 'supervisor'] },
      { key: 'research_development', label: 'Research & Development', roles: ['admin', 'supervisor'] },
      { key: 'manufacturing', label: 'Manufacturing', roles: ['admin', 'supervisor'], departments: ['production'] },
      { key: 'quality_control', label: 'Quality Control', departments: ['qa'] },
      { key: 'maintenance', label: 'Maintenance', roles: ['admin', 'supervisor'], departments: ['maintenance'] },
    ],
    csv: {
      // maps a header (case/space-insensitive contains) -> field key
      number: ['document change request #', 'dcr'],
      map: {
        'doc number': 'doc_number',
        'doc name': 'doc_name',
        'revision': 'revision',
        'change': 'change_type',
        'date': 'record_date',
      },
    },
  },

  non_conformance: {
    key: 'non_conformance',
    label: 'Non-Conformance',
    singular: 'Non-Conformance Report',
    short: 'NC',
    moduleId: 'non-conformance',
    formCode: 'Form 408-01',
    numberPrefix: '25-',
    numberPad: 3, // 25-001, 25-002, …
    primaryField: 'product',
    dateLabel: 'Date',
    fields: [
      { key: 'work_order', label: 'Work Order Number', type: 'text' },
      { key: 'discovered_by', label: 'Who Discovered the Nonconformance', type: 'text' },
      { key: 'investigator', label: 'Quality Investigator', type: 'text' },
      { key: 'location', label: 'Where Did the Issue Occur (Location)', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'part_number', label: 'Part Number', type: 'text' },
      { key: 'lot_number', label: 'Lot Number', type: 'text' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'vendor_number', label: 'Vendor Number', type: 'text' },
      { key: 'description', label: 'Description of Non-Conformance (out of spec?)', type: 'textarea' },
      { key: 'root_cause', label: 'Root Cause Analysis (what / why)', type: 'textarea' },
      { key: 'containment', label: 'Containment (segregated? location? rationale)', type: 'textarea' },
      { key: 'previous_lot', label: 'Was the Previous Lot Implicated?', type: 'select', options: ['No', 'Yes'] },
      { key: 'mrb_resolution', label: 'MRB Resolution', type: 'select', options: ['Sort', 'Rework', 'Use As Is', 'Scrap', 'Not Applicable'] },
      { key: 'capa_required', label: 'Additional CAPA required', type: 'checkbox' },
      { key: 'capa_number', label: 'Assigned CAPA Number', type: 'text' },
      { key: 'comments', label: 'Comments', type: 'textarea' },
      { key: 'performed_by', label: 'Performed By', type: 'text' },
    ],
    logColumns: ['record_number', 'product', 'lot_number', 'work_order', 'record_date', 'approvals'],
    approvals: [
      { key: 'quality', label: 'Quality', required: true, departments: ['qa'] },
      { key: 'production_management', label: 'Production Management', roles: ['admin', 'supervisor'], departments: ['production'] },
    ],
    csv: {
      number: ['nc #', 'non conformance #'], // log's number column has a blank header → falls back to column 0
      map: {
        'lot': 'lot_number',
        'item': 'work_order',
        'production description': 'product',
        'nc description': 'description',
        'completed on': 'record_date',
        'comments': 'comments',
        'performance by': 'performed_by',
      },
    },
  },

  deviation: {
    key: 'deviation',
    label: 'Deviations',
    singular: 'Deviation',
    short: 'Deviation',
    moduleId: 'deviations',
    formCode: 'Form 442-01',
    numberPrefix: 'D',
    numberPad: 2, // D01, D02, …
    primaryField: 'product_description',
    dateLabel: 'Date',
    fields: [
      { key: 'initiator', label: 'Initiator', type: 'text' },
      { key: 'room', label: 'Room #', type: 'text' },
      { key: 'change_type', label: 'Change Type', type: 'select', options: ['Temporary', 'Long Term'] },
      { key: 'deviation_type', label: 'Deviation Type', type: 'select', options: ['Protocol', 'Document or Policy', 'Procedure or Policy', 'Bill of Material', 'Other'] },
      { key: 'product_description', label: 'Product Description', type: 'text' },
      { key: 'lot', label: 'Lot', type: 'text' },
      { key: 'item_number', label: 'Item #', type: 'text' },
      { key: 'description', label: 'Deviation Description', type: 'textarea' },
      { key: 'impact', label: 'Deviation Impact / Comments', type: 'textarea' },
      { key: 'start_date', label: 'Deviation Start Date', type: 'date' },
      { key: 'end_date', label: 'Deviation End Date', type: 'date' },
      { key: 'capa_needed', label: 'CAPA needed for this deviation', type: 'checkbox' },
      { key: 'capa_number', label: 'CAPA #', type: 'text' },
    ],
    logColumns: ['record_number', 'product_description', 'lot', 'item_number', 'record_date', 'approvals'],
    approvals: [
      { key: 'manufacturing_manager', label: 'Manufacturing Manager', roles: ['admin', 'supervisor'], departments: ['production'] },
      { key: 'qa_director', label: 'QA Director', required: true, departments: ['qa'] },
      { key: 'customer', label: 'Customer', external: true },
    ],
    csv: {
      // deviation logs vary by year; header is "Deviation Number" every year
      number: ['deviation number'],
      map: {
        'item number and name': 'product_description',
        'production description': 'product_description',
        'item #': 'item_number',
        'item number': 'item_number',
        'lot': 'lot',
        'reason for deviation': 'description',
        'deviation description': 'description',
        'deviation from manufacture order': 'impact',
        'added comments': 'impact',
        'person to authorize': 'authorized_by',
        'completed on': 'record_date',
        'date': 'record_date',
        'capa': 'capa_number',
      },
    },
  },
};

export function getType(typeKey) {
  return QMS_TYPES[typeKey] || null;
}

// Can this user sign this approval role? Admin always can; otherwise match the
// role's allowed roles or departments. `external` approvals (e.g. Customer)
// are recorded manually and cannot be self-signed in-system.
export function canSignApproval(user, appr) {
  if (!user || !appr || appr.external) return false;
  if (user.role === 'admin') return true;
  if (Array.isArray(appr.roles) && appr.roles.includes(user.role)) return true;
  if (Array.isArray(appr.departments) && appr.departments.includes(user.department)) return true;
  return false;
}
