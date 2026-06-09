import { useApiGet } from '../../hooks/useApi';
import { Shield, Wrench, Thermometer, ClipboardCheck, Droplets, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color = 'powder', alert }) {
  const colors = {
    powder: 'bg-powder-50 text-powder-700',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-yellow-700',
    danger: 'bg-danger-50 text-danger-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${alert ? 'border-danger-500 bg-danger-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-lg ${colors[color]}`}><Icon size={16} /></div>
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function ComplianceDashboard() {
  const { data, loading, error } = useApiGet('/compliance/dashboard');

  if (loading) return <div className="text-center py-12 text-gray-500">Loading compliance dashboard...</div>;
  if (error) return <div className="text-center py-12 text-danger-600">{error}</div>;
  if (!data) return null;

  const pmColor = data.pm.meets_sqf_target ? 'success' : data.pm.completion_rate >= 80 ? 'warning' : 'danger';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Compliance Dashboard</h2>
        <span className="text-xs text-gray-500">Last 30 days ({data.period.from} to {data.period.to})</span>
      </div>

      {/* SQF Target Banner */}
      <div className={`rounded-xl p-4 flex items-center gap-3 ${data.pm.meets_sqf_target ? 'bg-success-50 border border-green-200' : 'bg-danger-50 border border-red-200'}`}>
        {data.pm.meets_sqf_target ? <CheckCircle size={24} className="text-success-600" /> : <AlertTriangle size={24} className="text-danger-600" />}
        <div>
          <p className="font-semibold text-gray-900">
            PM Completion Rate: {data.pm.completion_rate}%
            {data.pm.meets_sqf_target ? ' — SQF Target Met' : ' — Below SQF 95% Target'}
          </p>
          <p className="text-sm text-gray-600">
            {data.pm.completed} of {data.pm.total} work orders completed | {data.pm.overdue} overdue
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Wrench} label="PM Completion" value={`${data.pm.completion_rate}%`} sub={`${data.pm.completed}/${data.pm.total} WOs`} color={pmColor} />
        <StatCard icon={Thermometer} label="Calibrations" value={data.calibration.total_instruments} sub={`${data.calibration.overdue} overdue, ${data.calibration.due_within_7_days} due soon`} color={data.calibration.overdue > 0 ? 'danger' : 'success'} alert={data.calibration.overdue > 0} />
        <StatCard icon={ClipboardCheck} label="Checklists" value={`${data.checklists.pass_rate}%`} sub={`${data.checklists.submissions_30d} submissions`} color={data.checklists.pass_rate >= 95 ? 'success' : 'warning'} />
        <StatCard icon={Droplets} label="Sanitation" value={`${data.sanitation.pass_rate}%`} sub={`${data.sanitation.records_30d} records`} color={data.sanitation.pass_rate >= 95 ? 'success' : 'warning'} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming Work Orders */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Clock size={16} /> Upcoming Work Orders (Next 7 Days)
          </h3>
          {data.upcoming_work_orders.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming work orders</p>
          ) : (
            <div className="space-y-2">
              {data.upcoming_work_orders.map(wo => (
                <div key={wo.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{wo.title}</p>
                    <p className="text-xs text-gray-500">{wo.equipment_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-gray-700">{wo.due_date}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${wo.status === 'open' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                      {wo.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Shield size={16} /> Recent Audit Trail
          </h3>
          {data.recent_activity.length === 0 ? (
            <p className="text-sm text-gray-500">No activity recorded yet</p>
          ) : (
            <div className="space-y-2">
              {data.recent_activity.map(entry => (
                <div key={entry.id} className="py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{entry.actor}</span> {entry.action}{' '}
                      <span className="text-gray-500">{entry.entity_type}</span>
                    </p>
                    <span className="text-xs text-gray-400">{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Food Contact Equipment */}
      <div className="bg-powder-50 rounded-xl border border-powder-200 p-4">
        <p className="text-sm text-powder-800">
          <Shield size={14} className="inline mr-1" />
          <strong>{data.food_contact_equipment}</strong> active food-contact equipment units tracked.
          All PM, calibration, and sanitation records for these assets are linked to your HACCP/PCP plan for audit readiness.
        </p>
      </div>
    </div>
  );
}
