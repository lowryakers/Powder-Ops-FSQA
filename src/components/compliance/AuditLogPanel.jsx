import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Shield } from 'lucide-react';

export default function AuditLogPanel() {
  const [filters, setFilters] = useState({ entity_type: '', actor: '', from: '', to: '' });
  const query = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const { data, loading } = useApiGet(`/audit?${query}`, [query]);
  const { data: auditReady, loading: arLoading } = useApiGet('/compliance/audit-ready');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Immutable Audit Log</h2>
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-powder-600" />
          <span className="text-xs text-gray-500">Append-only — records cannot be edited or deleted</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-white rounded-xl border border-gray-200 p-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Entity Type</label>
          <select value={filters.entity_type} onChange={e => setFilters({ ...filters, entity_type: e.target.value })}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">All</option>
            {['equipment', 'haccp_ccp', 'pm_schedule', 'work_order', 'checklist_template', 'checklist_submission', 'calibration_instrument', 'calibration_record', 'sanitation_record', 'loto_procedure', 'loto_execution'].map(t =>
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Actor</label>
          <input value={filters.actor} onChange={e => setFilters({ ...filters, actor: e.target.value })}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="Filter by user" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
          <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
          <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      {/* Audit-Ready Summary */}
      {!arLoading && auditReady && (
        <div className="bg-powder-50 rounded-xl border border-powder-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-2">12-Month Audit-Ready Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Audit Trail Records</p>
              <p className="text-lg font-bold">{auditReady.total_audit_trail_records}</p>
            </div>
            <div>
              <p className="text-gray-500">HACCP CCPs Tracked</p>
              <p className="text-lg font-bold">{auditReady.haccp_coverage?.length || 0}</p>
            </div>
            <div>
              <p className="text-gray-500">Lubricant Records</p>
              <p className="text-lg font-bold">{auditReady.lubricant_records?.length || 0}</p>
            </div>
            <div>
              <p className="text-gray-500">Critical Cal. Records</p>
              <p className="text-lg font-bold">{auditReady.critical_calibration_history?.length || 0}</p>
            </div>
          </div>
          {auditReady.haccp_coverage?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-700 mb-1">HACCP CCP Coverage:</p>
              <div className="flex flex-wrap gap-2">
                {auditReady.haccp_coverage.map(c => (
                  <span key={c.id} className="px-2 py-1 bg-white rounded-lg border text-xs">
                    {c.name}: {c.equipment_count} equip, {c.pm_count} PMs, {c.instrument_count} instruments
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log Entries */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading audit log...</div>
        ) : (
          <>
            <div className="px-4 py-2 bg-gray-50 border-b text-xs text-gray-500">
              {data?.total || 0} total records
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">ID</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Timestamp</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Actor</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Entity</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.data || []).map(entry => (
                    <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap">{entry.id}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{entry.actor}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{entry.action}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{entry.entity_type}{entry.entity_id ? ` #${entry.entity_id.slice(0, 8)}` : ''}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs w-full break-words">{entry.details || '—'}</td>
                    </tr>
                  ))}
                  {(!data?.data || data.data.length === 0) && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No audit log entries yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
