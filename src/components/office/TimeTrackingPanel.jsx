import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Check, Languages, Trash2, UserX, Clock, HelpCircle } from 'lucide-react';

const TYPES = [
  { value: 'absent', label: 'Absent', icon: UserX, tone: 'bg-red-100 text-red-700' },
  { value: 'tardy_leave_early', label: 'Tardy / Leave Early', icon: Clock, tone: 'bg-amber-100 text-amber-700' },
  { value: 'other', label: 'Other', icon: HelpCircle, tone: 'bg-gray-100 text-gray-600' },
];
const typeMeta = (v) => TYPES.find(t => t.value === v) || TYPES[2];

// Absence/tardy form — supervisors report for any employee; Spanish is fine
// (the log auto-translates for the admin).
function AdjustmentForm({ employees, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const blank = { employee_name: '', adjustment_type: 'absent', adjustment_date: today, message: '', details: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      const emp = (employees || []).find(u => u.name === form.employee_name);
      await apiPost('/office/time/adjustments', { ...form, employee_id: emp?.id || null });
      setMsg(`Logged for ${form.employee_name}`);
      setForm({ ...blank, adjustment_date: today });
      onCreated?.();
    } catch (err) { setMsg(err.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">Report an absence / tardy</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Employee *</label>
          <select required value={form.employee_name} onChange={e => setForm({ ...form, employee_name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">Select…</option>
            {(employees || []).map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.adjustment_type} onChange={e => setForm({ ...form, adjustment_type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date it applies to *</label>
          <input type="date" required value={form.adjustment_date} onChange={e => setForm({ ...form, adjustment_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <p className="text-[11px] text-gray-400 mt-0.5">Today if running late, or the future date they'll be out.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Message / reason</label>
          <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="English o español — se traduce automáticamente." />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Submitting…' : 'Submit'}
        </button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </form>
  );
}

function AdjustmentsLog() {
  const [employee, setEmployee] = useState('');
  const { data: entries, refresh } = useApiGet(`/office/time/adjustments${employee ? `?employee=${encodeURIComponent(employee)}` : ''}`, [employee]);
  const names = [...new Set((entries || []).map(e => e.employee_name))].sort();
  const markReviewed = async (e) => { await apiPut(`/office/time/adjustments/${e.id}`, { status: 'reviewed' }); refresh(); };
  const del = async (e) => {
    if (!confirm(`Delete entry for ${e.employee_name}?`)) return;
    await apiFetch(`/office/time/adjustments/${e.id}`, { method: 'DELETE' });
    refresh();
  };
  return (
    <div className="space-y-3">
      {employee && (
        <button onClick={() => setEmployee('')} className="text-xs text-powder-600 hover:underline">← All employees (filtering: {employee})</button>
      )}
      <div className="space-y-2">
        {(entries || []).map(e => {
          const t = typeMeta(e.adjustment_type);
          return (
            <div key={e.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${e.status === 'new' ? 'border-powder-400' : 'border-gray-200'} p-3 shadow-sm`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <button onClick={() => setEmployee(e.employee_name)} className="font-medium text-gray-900 hover:text-powder-700">{e.employee_name}</button>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${t.tone}`}>{t.label}</span>
                  <span className="ml-2 text-xs text-gray-400">{e.adjustment_date}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {e.status === 'new'
                    ? <button onClick={() => markReviewed(e)} className="flex items-center gap-1 px-2 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700"><Check size={12} /> Mark reviewed</button>
                    : <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Check size={12} /> Reviewed</span>}
                  <button onClick={() => del(e)} className="p-1.5 text-gray-300 hover:text-red-500" data-tip="Delete" data-tip-left><Trash2 size={13} /></button>
                </div>
              </div>
              {e.message_en && e.message_en !== e.message ? (
                <div className="mt-1.5 text-sm text-gray-800">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-powder-500 mr-1"><Languages size={10} /> EN</span>
                  {e.message_en}
                  {e.message && <div className="text-xs text-gray-400 mt-0.5 italic">Original: {e.message}</div>}
                </div>
              ) : (
                (e.message || e.details) && <p className="mt-1.5 text-sm text-gray-800">{[e.message, e.details].filter(Boolean).join(' — ')}</p>
              )}
              <div className="mt-1 text-[11px] text-gray-400">Reported by {e.submitted_by || '—'} · {(e.created_at || '').slice(0, 16).replace('T', ' ')}</div>
            </div>
          );
        })}
        {(entries || []).length === 0 && <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">No entries</div>}
      </div>
    </div>
  );
}

function StatsTab() {
  const { data: stats } = useApiGet('/office/time/stats');
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Employee', 'Last 30 days', 'Last 90 days', 'Absences (90d)', 'Tardies (90d)', 'Most recent'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(stats || []).map(s => (
              <tr key={s.employee_name} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5 font-medium text-gray-900 w-full">{s.employee_name}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.last_30 >= 3 ? 'bg-red-100 text-red-700' : s.last_30 > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{s.last_30}</span></td>
                <td className="px-3 py-2.5 text-gray-600">{s.last_90}</td>
                <td className="px-3 py-2.5 text-gray-600">{s.absences_90}</td>
                <td className="px-3 py-2.5 text-gray-600">{s.tardies_90}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{s.last_event}</td>
              </tr>
            ))}
            {(stats || []).length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No activity in the last 90 days</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TimeTrackingPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'log' : 'form');
  const { data: employees } = useApiGet('/users/technicians');

  const tabs = isAdmin ? [['log', 'Log'], ['form', 'New Report'], ['stats', 'Stats']] : [['form', 'New Report']];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Time Tracking</h2>
        {tabs.length > 1 && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {tabs.map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {tab === 'form' && <AdjustmentForm employees={employees} onCreated={() => {}} />}
      {tab === 'log' && isAdmin && <AdjustmentsLog />}
      {tab === 'stats' && isAdmin && <StatsTab />}
    </div>
  );
}
