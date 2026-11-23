// The modules behind the record interface's types (D-375).
//
// "Look up records" shows in the sidebar for anyone who can open at least one
// of these, because it searches only the record types that person can read.
// The server decides what each search returns (`canReadType`); this list only
// decides whether the screen is offered at all. verify:recordlookup asserts it
// is exactly the union of every RECORD_TYPES entry's `modules`, so a record
// type added later cannot leave the screen hidden from the people who need it.
export const RECORD_MODULES = Object.freeze([
  'sanitation', 'qa-inspections', 'calibration',
  'dcr', 'non-conformance', 'on-hold', 'component-signout', 'knife-accountability',
  'organoleptic', 'deviations', 'flavor-approvals', 'maintenance-signout',
  'production-log', 'quality-schedules', 'pm', 'coa', 'food-safety-culture',
  'receiving-log', 'training', 'disposals',
]);
