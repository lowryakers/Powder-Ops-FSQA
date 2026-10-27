// How an audit action reads on the audit screen (D-239). The stored rows are
// never rewritten — the 10 specifications retired on 202532 before `retire`
// existed are recorded as `delete`, and stay so; they READ as what they were.
const LABELS = {
  retire: 'Retired',
  unsign: 'Un-signed',
  void: 'Voided',
  dismiss: 'Dismissed',
};

const detailsOf = (entry) => {
  const d = entry?.details;
  if (!d) return {};
  if (typeof d === 'object') return d;
  try { return JSON.parse(d) || {}; } catch { return {}; }
};

/** The label for one audit row's action. */
export function actionLabel(entry) {
  const action = String(entry?.action || '');
  if (action === 'delete' && /^Retired by ReadyDoc/i.test(String(detailsOf(entry).reason || ''))) return 'Retired (recorded as delete)';
  return LABELS[action] || action.replace(/_/g, ' ');
}
