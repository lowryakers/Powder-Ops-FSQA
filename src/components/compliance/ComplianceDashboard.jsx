import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Shield, Wrench, Thermometer, Droplets, AlertTriangle, CheckCircle, Clock, FlaskConical, Flag, FileText, ScrollText, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, LineChart, Line } from 'recharts';

const goTo = (tab) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab } }));

function ReadinessItem({ label, status, detail, tab }) {
  const colors = {
    good: 'bg-green-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
    info: 'bg-gray-400',
  };
  return (
    <div className={`flex items-center gap-3 py-2 ${tab ? 'cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors' : ''}`}
      onClick={tab ? () => goTo(tab) : undefined}>
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors[status]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {detail && <p className="text-xs text-gray-500">{detail}</p>}
      </div>
      {tab && status !== 'good' && <ChevronRight size={14} className="text-gray-400 shrink-0" />}
    </div>
  );
}

export default function ComplianceDashboard() {
  const { data, loading, error } = useApiGet('/compliance/dashboard');
  const [showOnlyFailing, setShowOnlyFailing] = useState(false);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading compliance dashboard...</div>;
  if (error) return <div className="text-center py-12 text-danger-600">{error}</div>;
  if (!data) return null;

  const n = (v) => (v || 0).toLocaleString();
  const plur = (v, s = 's') => (v === 1 ? '' : s);
  const clearancePending = data.clearance_pending || 0;
  const sopReviewDue = data.sop_review_due || 0;

  const readinessChecks = [
    {
      label: `Task Completion: ${n(data.pm.overdue)} overdue`,
      status: data.pm.overdue === 0 ? 'good' : 'critical',
      detail: `${n(data.pm.overdue)} overdue · ${n(data.pm.due_soon)} due within 7 days · ${data.pm.completion_rate}% completed in the last 30 days.`,
      action: data.pm.overdue > 0 ? `Complete or mark N/A ${n(data.pm.overdue)} overdue task${plur(data.pm.overdue)} in Task Center` : null,
      tab: 'pm',
    },
    {
      label: `Calibration: ${n(data.calibration.overdue)} overdue`,
      status: data.calibration.overdue === 0 ? 'good' : 'critical',
      detail: `${n(data.calibration.total_instruments)} instruments · ${n(data.calibration.due_within_7_days)} due within 7 days.`,
      action: data.calibration.overdue > 0 ? `Calibrate ${n(data.calibration.overdue)} overdue instrument${plur(data.calibration.overdue)}` : null,
      tab: 'calibration',
    },
    {
      label: `Sanitation Pass Rate: ${data.sanitation.pass_rate}%`,
      status: data.sanitation.pass_rate >= 95 ? 'good' : data.sanitation.pass_rate >= 80 ? 'warning' : 'critical',
      detail: `${n(data.sanitation.records_30d)} records in the last 30 days · ${n(data.sanitation.failures_30d)} failures.`,
      action: data.sanitation.failures_30d > 0 ? `Review ${n(data.sanitation.failures_30d)} sanitation failure${plur(data.sanitation.failures_30d)} from the last 30 days` : null,
      tab: 'sanitation',
    },
    {
      label: `Chemical SDS Coverage: ${n(data.chemicals.total_approved - data.chemicals.missing_sds)}/${n(data.chemicals.total_approved)}`,
      status: data.chemicals.missing_sds === 0 ? 'good' : data.chemicals.missing_sds <= 3 ? 'warning' : 'critical',
      detail: data.chemicals.missing_sds > 0 ? `${n(data.chemicals.missing_sds)} approved chemicals missing SDS documentation.` : 'All approved chemicals have SDS documentation.',
      action: data.chemicals.missing_sds > 0 ? `Upload SDS for ${n(data.chemicals.missing_sds)} chemical${plur(data.chemicals.missing_sds)}` : null,
      tab: 'chemicals',
    },
    {
      label: `LOTO Coverage: ${n(data.loto.total_procedures)} procedures`,
      status: data.loto.equipment_without_procedure === 0 ? 'good' : 'warning',
      detail: data.loto.equipment_without_procedure > 0 ? `${n(data.loto.equipment_without_procedure)} equipment without a LOTO procedure.` : 'All equipment requiring LOTO is covered.',
      action: data.loto.equipment_without_procedure > 0 ? `Add LOTO procedures for ${n(data.loto.equipment_without_procedure)} equipment` : null,
      tab: 'loto',
    },
    {
      label: `Hygiene Clearance: ${n(clearancePending)} pending`,
      status: clearancePending === 0 ? 'good' : 'warning',
      detail: clearancePending > 0 ? `${n(clearancePending)} completed food-contact work order${plur(clearancePending)} awaiting QA clearance.` : 'No hygiene clearances pending.',
      action: clearancePending > 0 ? `QA-clear ${n(clearancePending)} food-contact work order${plur(clearancePending)}` : null,
      tab: 'pm',
    },
    {
      label: `Flagged Issues: ${n(data.flagged_issues)}`,
      status: data.flagged_issues === 0 ? 'good' : data.flagged_issues <= 2 ? 'warning' : 'critical',
      detail: data.flagged_issues > 0 ? `${n(data.flagged_issues)} open work order${plur(data.flagged_issues)} with flagged issues requiring attention.` : 'No open issues flagged.',
      action: data.flagged_issues > 0 ? `Resolve ${n(data.flagged_issues)} flagged issue${plur(data.flagged_issues)}` : null,
      tab: 'pm',
    },
    {
      label: `Document Reviews: ${n(sopReviewDue)} due`,
      status: sopReviewDue === 0 ? 'good' : 'warning',
      detail: sopReviewDue > 0 ? `${n(sopReviewDue)} controlled document${plur(sopReviewDue)} past their review date.` : 'All controlled documents are within their review cycle.',
      action: sopReviewDue > 0 ? `Review ${n(sopReviewDue)} document${plur(sopReviewDue)} past review date` : null,
      tab: 'sops',
    },
    {
      label: `Audit Trail: ${n(data.total_audit_records)} records (30d)`,
      status: 'good',
      detail: 'All system actions are logged with actor, timestamp, and entity.',
      action: null,
      tab: 'audit',
    },
  ];

  const readyCount = readinessChecks.filter(c => c.status === 'good').length;
  const totalChecks = readinessChecks.length;
  const overallReady = readyCount === totalChecks;
  const readinessPercent = Math.round((readyCount / totalChecks) * 100);
  // Prioritize critical actions first, then warnings, for the "what's needed" summary
  const todo = readinessChecks
    .filter(c => c.action)
    .sort((a, b) => (a.status === 'critical' ? 0 : 1) - (b.status === 'critical' ? 0 : 1));

  const chartData = (data.monthly_pm || []).map(m => ({
    month: m.month.slice(5),
    completed: m.completed,
    missed: m.missed || 0,
    total: m.total,
    rate: m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0,
  }));

  const sanTrend = (data.sanitation.monthly_trend || []).map(m => ({
    month: m.month.slice(5),
    rate: m.total > 0 ? Math.round((m.passed / m.total) * 100) : 100,
    total: m.total,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Audit Readiness Dashboard</h2>
        <span className="text-xs text-gray-500">Reporting period: {data.period.from} to {data.period.to}</span>
      </div>

      {/* Overall Readiness Banner */}
      <div
        onClick={!overallReady ? () => setShowOnlyFailing(prev => !prev) : undefined}
        className={`rounded-xl p-5 flex items-center gap-4 ${!overallReady ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${overallReady ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${overallReady ? 'bg-green-500' : 'bg-amber-500'}`}>
          {overallReady ? <CheckCircle size={32} className="text-white" /> : <AlertTriangle size={32} className="text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-gray-900">
            {overallReady ? 'Audit Ready' : `${readyCount} of ${totalChecks} Checks Passing`}
          </p>
          <p className="text-sm text-gray-600">
            {overallReady
              ? 'All compliance areas are meeting targets. Your documentation is up to date.'
              : `Complete the item${todo.length === 1 ? '' : 's'} below to reach a full pass.`}
          </p>
          <div className="mt-2 w-full max-w-xs bg-gray-200 rounded-full h-2.5">
            <div className={`h-2.5 rounded-full transition-all ${overallReady ? 'bg-green-500' : readinessPercent >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${readinessPercent}%` }} />
          </div>
        </div>
      </div>

      {/* What's needed for a full pass */}
      {!overallReady && todo.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" /> To reach full audit readiness
          </h3>
          <ul className="space-y-1.5">
            {todo.map((c, i) => (
              <li key={i}
                onClick={() => c.tab && goTo(c.tab)}
                className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 -mx-2 px-2 py-1 rounded-lg transition-colors">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${c.status === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="flex-1">{c.action}</span>
                <ChevronRight size={14} className="text-gray-400 shrink-0 mt-0.5" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Readiness Checklist + KPI Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Readiness Checklist */}
        <div className="md:col-span-1 bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <FileText size={16} /> Readiness Checklist
          </h3>
          <div className="divide-y divide-gray-100">
            {(showOnlyFailing ? readinessChecks.filter(c => c.status !== 'good') : readinessChecks).map((check, i) => (
              <ReadinessItem key={i} {...check} />
            ))}
          </div>
        </div>

        {/* KPI Cards Grid */}
        <div className="md:col-span-2 grid grid-cols-2 gap-3 content-start">
          <div onClick={() => goTo('pm')} className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${data.pm.overdue === 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Wrench size={15} className={data.pm.overdue === 0 ? 'text-green-600' : 'text-red-600'} />
              <span className="text-xs text-gray-600">Tasks Overdue</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{n(data.pm.overdue)}</p>
            <p className="text-xs text-gray-500">{n(data.pm.due_soon)} due within 7 days · {data.pm.completion_rate}% done (30d)</p>
          </div>

          <div onClick={() => goTo('calibration')} className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${data.calibration.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Thermometer size={15} className={data.calibration.overdue > 0 ? 'text-red-600' : 'text-green-600'} />
              <span className="text-xs text-gray-600">Calibration</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{data.calibration.total_instruments}</p>
            <p className="text-xs text-gray-500">{data.calibration.overdue} overdue · {data.calibration.due_within_7_days} due soon</p>
          </div>

          <div onClick={() => goTo('sanitation')} className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${data.sanitation.pass_rate >= 95 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Droplets size={15} className={data.sanitation.pass_rate >= 95 ? 'text-green-600' : 'text-amber-600'} />
              <span className="text-xs text-gray-600">Sanitation Pass Rate</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{data.sanitation.pass_rate}%</p>
            <p className="text-xs text-gray-500">{data.sanitation.records_30d} records · {data.sanitation.failures_30d} failures</p>
          </div>

          <div onClick={() => goTo('chemicals')} className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${data.chemicals.missing_sds === 0 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <FlaskConical size={15} className={data.chemicals.missing_sds === 0 ? 'text-green-600' : 'text-amber-600'} />
              <span className="text-xs text-gray-600">Chemical Registry</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{data.chemicals.total_approved}</p>
            <p className="text-xs text-gray-500">{data.chemicals.missing_sds > 0 ? `${data.chemicals.missing_sds} missing SDS` : 'All SDS on file'}</p>
          </div>

          <div onClick={() => goTo('pm')} className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${data.flagged_issues === 0 ? 'border-gray-200 bg-white' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Flag size={15} className={data.flagged_issues > 0 ? 'text-red-600' : 'text-gray-400'} />
              <span className="text-xs text-gray-600">Open Issues</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{data.flagged_issues}</p>
            <p className="text-xs text-gray-500">{data.flagged_issues > 0 ? 'Flagged issues need review' : 'No open issues'}</p>
          </div>

          <div onClick={() => goTo('audit')} className="rounded-xl border border-gray-200 bg-white p-4 cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-1">
              <ScrollText size={15} className="text-gray-500" />
              <span className="text-xs text-gray-600">Audit Trail</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{(data.total_audit_records || 0).toLocaleString()}</p>
            <p className="text-xs text-gray-500">Records over 12 months</p>
          </div>
        </div>
      </div>

      {/* PM Completion Trend Chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">PM Completion Trend (12 Months)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <ReferenceLine y={95} stroke="#e03131" strokeDasharray="3 3" label={{ value: '95% SQF', position: 'right', fontSize: 10 }} />
              <Bar dataKey="completed" name="Completed" fill="#40c057" radius={[2, 2, 0, 0]} />
              <Bar dataKey="missed" name="Missed" fill="#adb5bd" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sanitation Trend Chart */}
      {sanTrend.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Sanitation Pass Rate Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={sanTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${v}%`} />
              <ReferenceLine y={95} stroke="#e03131" strokeDasharray="3 3" label={{ value: '95%', position: 'right', fontSize: 10 }} />
              <Line type="monotone" dataKey="rate" stroke="#339af0" strokeWidth={2} dot={{ r: 3 }} name="Pass Rate" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Upcoming Work Orders */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Clock size={16} /> Upcoming Work Orders (7 Days)
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
            <ScrollText size={16} /> Recent Audit Trail
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

      {/* Food Contact Equipment Summary */}
      <div className="bg-powder-50 rounded-xl border border-powder-200 p-4">
        <p className="text-sm text-powder-800">
          <Shield size={14} className="inline mr-1" />
          <strong>{data.food_contact_equipment}</strong> active food-contact equipment units tracked.
          {data.loto.total_procedures > 0 && <> · <strong>{data.loto.total_procedures}</strong> LOTO procedures on file.</>}
          {' '}All PM, calibration, and sanitation records are linked for audit traceability.
        </p>
      </div>
    </div>
  );
}
