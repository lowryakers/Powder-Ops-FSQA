import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Shield, Wrench, Thermometer, Droplets, CheckCircle, AlertTriangle, Clock, Download, LogOut, FlaskConical, ScrollText, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';

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
    ], history.items);
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
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-600">Total WOs</p>
            <p className="text-xl font-bold">{metrics.total}</p>
          </div>
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-600">Completed</p>
            <p className="text-xl font-bold text-green-600">{metrics.completed}</p>
          </div>
          <div className={`rounded-lg p-3 ${metrics.overdue > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
            <p className="text-xs text-gray-600">Overdue</p>
            <p className="text-xl font-bold text-red-600">{metrics.overdue}</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{history?.total || 0} records in selected period</p>
        <ExportButton onClick={exportPM} />
      </div>
      {history?.items?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Title</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Equipment</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Due Date</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Completed</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">By</th>
              </tr>
            </thead>
            <tbody>
              {history.items.slice(0, 100).map(wo => (
                <tr key={wo.id} className="border-b border-gray-100">
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${wo.status === 'completed' ? 'bg-green-100 text-green-800' : wo.status === 'missed' ? 'bg-gray-200 text-gray-700' : 'bg-yellow-100 text-yellow-800'}`}>
                      {wo.status}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-gray-900">{wo.title || wo.pm_title}</td>
                  <td className="py-1.5 px-2 text-gray-600">{wo.equipment_name}</td>
                  <td className="py-1.5 px-2 text-gray-600">{wo.due_date}</td>
                  <td className="py-1.5 px-2 text-gray-600">{wo.completed_at ? new Date(wo.completed_at).toLocaleDateString() : '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{wo.completed_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.items.length > 100 && <p className="text-xs text-gray-400 mt-2">Showing 100 of {history.items.length}. Export CSV for full data.</p>}
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
      { label: 'Max Capacity', value: r => r.max_capacity || '' },
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
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-600">Total Instruments</p>
            <p className="text-xl font-bold">{summary.total}</p>
          </div>
          <div className="rounded-lg p-3 bg-green-50 border border-green-200">
            <p className="text-xs text-gray-600">Current</p>
            <p className="text-xl font-bold text-green-600">{summary.current}</p>
          </div>
          <div className={`rounded-lg p-3 ${summary.overdue > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
            <p className="text-xs text-gray-600">Overdue</p>
            <p className="text-xl font-bold text-red-600">{summary.overdue}</p>
          </div>
          <div className="rounded-lg p-3 bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-600">Due Soon (30d)</p>
            <p className="text-xl font-bold text-amber-600">{summary.due_soon}</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{instruments?.length || 0} instruments</p>
        <ExportButton onClick={exportCal} />
      </div>
      {instruments?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Asset #</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Make / Model</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Room</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Dept</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Last Cal.</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Next Due</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {instruments.map(inst => (
                <tr key={inst.id} className="border-b border-gray-100">
                  <td className="py-1.5 px-2 text-gray-900 font-medium">{inst.asset_number || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{inst.manufacturer} {inst.model}</td>
                  <td className="py-1.5 px-2 text-gray-600">{inst.room || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{inst.department || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{inst.last_calibrated || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{inst.next_due || '—'}</td>
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${inst.status === 'active' ? 'bg-green-100 text-green-800' : inst.status === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {inst.status}
                    </span>
                  </td>
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

  const exportSan = () => {
    const items = records || [];
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
      { label: 'Notes', value: r => r.notes || '' },
    ], items);
  };

  const items = records || [];
  const passCount = items.filter(r => r.result === 'pass').length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg p-3 bg-gray-50 border border-gray-200">
          <p className="text-xs text-gray-600">Total Records</p>
          <p className="text-xl font-bold">{items.length}</p>
        </div>
        <div className="rounded-lg p-3 bg-green-50 border border-green-200">
          <p className="text-xs text-gray-600">Pass Rate</p>
          <p className="text-xl font-bold text-green-600">{items.length > 0 ? ((passCount / items.length) * 100).toFixed(1) : 100}%</p>
        </div>
        <div className={`rounded-lg p-3 ${items.length - passCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
          <p className="text-xs text-gray-600">Failures</p>
          <p className="text-xl font-bold text-red-600">{items.length - passCount}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{items.length} records</p>
        <ExportButton onClick={exportSan} />
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Area / Equipment</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Chemical</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">ATP</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Result</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">By</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 100).map(r => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-1.5 px-2 text-gray-600">{r.performed_at ? new Date(r.performed_at).toLocaleDateString() : '—'}</td>
                  <td className="py-1.5 px-2 text-gray-900">{r.area || r.equipment_name || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{r.chemicals_used || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-600">{r.atp_reading ?? '—'}</td>
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.result === 'pass' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {r.result}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-gray-600">{r.performed_by || '—'}</td>
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
      { label: 'Product Code', value: r => r.product_code || '' },
      { label: 'SDS Number', value: r => r.sds_number || '' },
      { label: 'SDS URL', value: r => r.sds_url || '' },
      { label: 'Food Grade', value: r => r.is_food_grade ? 'Yes' : 'No' },
      { label: 'NSF Rating', value: r => r.nsf_rating || '' },
      { label: 'Location For Use', value: r => r.location_for_use || '' },
      { label: 'Max Concentration', value: r => r.max_concentration || '' },
      { label: 'Contact Time (min)', value: r => r.required_contact_time_minutes ?? '' },
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
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Name</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Category</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Food Grade</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Location</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">SDS</th>
              </tr>
            </thead>
            <tbody>
              {chemicals.map(c => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="py-1.5 px-2 text-gray-900">{c.name}</td>
                  <td className="py-1.5 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 capitalize">{c.category}</span></td>
                  <td className="py-1.5 px-2">{c.is_food_grade ? <span className="text-green-600 text-xs font-medium">Yes</span> : <span className="text-gray-400 text-xs">No</span>}</td>
                  <td className="py-1.5 px-2 text-gray-600 text-xs">{c.location_for_use || '—'}</td>
                  <td className="py-1.5 px-2">{c.sds_url ? <a href={c.sds_url} target="_blank" rel="noopener noreferrer" className="text-powder-600 text-xs hover:underline">View SDS</a> : c.sds_number || <span className="text-amber-500 text-xs">Missing</span>}</td>
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
      { label: 'Details', value: r => typeof r.details === 'string' ? r.details : JSON.stringify(r.details || '') },
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
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Timestamp</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Actor</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Action</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Entity</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 100).map((log, i) => (
                <tr key={log.id || i} className="border-b border-gray-100">
                  <td className="py-1.5 px-2 text-gray-600 text-xs">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</td>
                  <td className="py-1.5 px-2 text-gray-900">{log.actor}</td>
                  <td className="py-1.5 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">{log.action}</span></td>
                  <td className="py-1.5 px-2 text-gray-600 text-xs">{log.entity_type} {log.entity_id ? `(${log.entity_id.slice(0, 8)}…)` : ''}</td>
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

export default function AuditorView() {
  const { user, logout } = useAuth();
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const [dateRange, setDateRange] = useState({
    from: yearAgo.toISOString().split('T')[0],
    to: now.toISOString().split('T')[0],
  });

  const { data: dashboard } = useApiGet('/compliance/dashboard');
  const { data: auditReady } = useApiGet('/compliance/audit-ready');

  const exportFullReport = () => {
    if (!auditReady) return;
    const rows = [];
    rows.push({ section: 'PM Monthly Summary', detail: '', value: '' });
    (auditReady.monthly_pm || []).forEach(m => {
      rows.push({ section: '', detail: m.month, value: `${m.completed}/${m.total} (${m.total > 0 ? ((m.completed / m.total) * 100).toFixed(1) : 0}%)` });
    });
    rows.push({ section: '', detail: '', value: '' });
    rows.push({ section: 'Sanitation Monthly Trend', detail: '', value: '' });
    (auditReady.sanitation_trend || []).forEach(m => {
      rows.push({ section: '', detail: m.month, value: `${m.passed}/${m.total} passed` });
    });
    rows.push({ section: '', detail: '', value: '' });
    rows.push({ section: 'HACCP CCP Coverage', detail: '', value: '' });
    (auditReady.haccp_coverage || []).forEach(h => {
      rows.push({ section: '', detail: h.name, value: `${h.equipment_count} equip, ${h.pm_count} PMs, ${h.instrument_count} instruments` });
    });
    rows.push({ section: '', detail: '', value: '' });
    rows.push({ section: 'Lubricant Records', detail: '', value: '' });
    (auditReady.lubricant_records || []).forEach(l => {
      rows.push({ section: '', detail: `${l.completed_at} — ${l.equipment_name}`, value: `${l.lubricant_used}${l.lubricant_is_food_grade ? ' (Food Grade)' : ''}` });
    });
    rows.push({ section: '', detail: '', value: '' });
    rows.push({ section: 'Summary', detail: 'Total audit trail records', value: String(auditReady.total_audit_trail_records) });
    rows.push({ section: '', detail: 'Report generated', value: new Date().toISOString() });

    exportToCsv(`compliance-audit-report-${new Date().toISOString().split('T')[0]}.csv`, [
      { label: 'Section', value: r => r.section },
      { label: 'Detail', value: r => r.detail },
      { label: 'Value', value: r => r.value },
    ], rows);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Powder Ops FSQA</h1>
              <p className="text-xs text-gray-500">Audit & Compliance Portal — Read Only</p>
            </div>
          </div>
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
        {/* Date range selector + full report export */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={exportFullReport}
              className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
              <FileText size={15} /> Export Full Audit Report
            </button>
          </div>
        </div>

        {/* Compliance Summary */}
        {dashboard && (
          <div className={`rounded-xl p-4 flex items-center gap-3 ${dashboard.pm.meets_sqf_target ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            {dashboard.pm.meets_sqf_target ? <CheckCircle size={24} className="text-green-600 shrink-0" /> : <AlertTriangle size={24} className="text-red-600 shrink-0" />}
            <div>
              <p className="font-semibold text-gray-900">
                {dashboard.pm.meets_sqf_target ? 'SQF Compliance Target Met' : 'Below SQF Compliance Target'}
              </p>
              <p className="text-sm text-gray-600">
                PM Completion: {dashboard.pm.completion_rate}% (target ≥95%) · Calibration: {dashboard.calibration.overdue} overdue · Sanitation Pass Rate: {dashboard.sanitation.pass_rate}%
              </p>
            </div>
          </div>
        )}

        <Section title="Preventive Maintenance History" icon={Wrench}>
          <PMSection dateRange={dateRange} />
        </Section>

        <Section title="Calibration Instruments" icon={Thermometer}>
          <CalibrationSection />
        </Section>

        <Section title="Sanitation Records" icon={Droplets}>
          <SanitationSection dateRange={dateRange} />
        </Section>

        <Section title="Approved Chemicals Registry" icon={FlaskConical}>
          <ChemicalsSection />
        </Section>

        <Section title="Audit Trail" icon={ScrollText} defaultOpen={false}>
          <AuditLogSection dateRange={dateRange} />
        </Section>
      </main>
    </div>
  );
}
