import { useState, useMemo } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Search, CheckCircle2, XCircle, Lightbulb, ShieldAlert } from 'lucide-react';

// QA-owned facility inspections: Light Inspection (Form 110-01/02) and Brittle
// Plastic & Glass (Form 431-02). They share a table with cleaning records for
// history's sake, but they are QA's records and live on QA's list.
const KINDS = [
  { value: 'all', label: 'All inspections' },
  { value: 'light', label: 'Light Inspection', icon: Lightbulb, match: /^light inspection/i },
  { value: 'bpg', label: 'Brittle Plastic & Glass', icon: ShieldAlert, match: /^brittle plastic/i },
];

const fmt = (ts) => (ts ? String(ts).replace('T', ' ').slice(0, 16) : '—');

export default function QAInspectionsPanel() {
  const { user } = useAuth();
  const canEdit = canEditModule(user, 'qa-inspections');
  const { data: records, loading, refresh } = useApiGet('/sanitation?group=qa');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const [verifying, setVerifying] = useState(null);

  const rows = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const kindDef = KINDS.find(k => k.value === kind);
    return (records || []).filter(r => {
      if (kindDef?.match && !kindDef.match.test(r.area || '')) return false;
      if (resultFilter !== 'all' && r.result !== resultFilter) return false;
      if (needle && ![r.area, r.performed_by, r.verified_by, r.notes].some(v => v && v.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [records, kind, q, resultFilter]);

  const fails = rows.filter(r => r.result === 'fail').length;
  const unverified = rows.filter(r => !r.verified_by).length;

  const verify = async (r) => {
    setVerifying(r.id);
    try {
      await apiPut(`/sanitation/${r.id}/verify`, { verified_by: user.name });
      refresh();
    } finally { setVerifying(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">QA Inspections</h2>
        <p className="text-sm text-gray-500">
          Light inspections (Form 110-01 / 110-02) and brittle plastic &amp; glass checks (Form 431-02).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Inspections', value: rows.length, tone: 'text-gray-900' },
          { label: 'Failures', value: fails, tone: fails ? 'text-red-600' : 'text-gray-900' },
          { label: 'Awaiting QA verify', value: unverified, tone: unverified ? 'text-amber-600' : 'text-gray-900' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map(k => (
          <button key={k.value} onClick={() => setKind(k.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${kind === k.value ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {k.label}
          </button>
        ))}
        <div className="flex gap-1 ml-auto">
          {[{ v: 'all', l: 'All' }, { v: 'pass', l: 'Pass' }, { v: 'fail', l: 'Fail' }].map(r => (
            <button key={r.v} onClick={() => setResultFilter(r.v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${resultFilter === r.v ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {r.l}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search zone, inspector, notes…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading inspections…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No inspections match these filters.</div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {rows.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.area}</p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${r.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {(r.result || '').toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">{fmt(r.performed_at)} · {r.performed_by}</p>
                <p className="text-[11px] text-gray-400">
                  {r.verified_by ? `Verified by ${r.verified_by}` : 'Not verified'}
                </p>
                {r.notes && <p className="text-[11px] text-gray-500 mt-1">{r.notes}</p>}
                {canEdit && !r.verified_by && (
                  <button onClick={() => verify(r)} disabled={verifying === r.id}
                    className="mt-2 px-3 py-1.5 bg-powder-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                    {verifying === r.id ? 'Verifying…' : 'Verify'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Zone / Area</th>
                  <th className="px-4 py-2">Performed</th>
                  <th className="px-4 py-2">By</th>
                  <th className="px-4 py-2">Result</th>
                  <th className="px-4 py-2">QA verified</th>
                  <th className="px-4 py-2">Notes</th>
                  {canEdit && <th className="px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.area}</td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmt(r.performed_at)}</td>
                    <td className="px-4 py-2 text-gray-600">{r.performed_by}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${r.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {r.result === 'fail' ? <XCircle size={11} /> : <CheckCircle2 size={11} />}
                        {(r.result || '').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{r.verified_by ? `${r.verified_by} · ${fmt(r.verified_at)}` : <span className="text-amber-600">Pending</span>}</td>
                    <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{r.notes || '—'}</td>
                    {canEdit && (
                      <td className="px-4 py-2 text-right">
                        {!r.verified_by && (
                          <button onClick={() => verify(r)} disabled={verifying === r.id}
                            className="px-2.5 py-1 bg-powder-600 text-white text-xs font-semibold rounded-md disabled:opacity-50">
                            {verifying === r.id ? '…' : 'Verify'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
