import { useState, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Search, RefreshCw, PackageSearch } from 'lucide-react';

// Ultra-simple "what's checked out right now" view — one big, thumb-friendly
// row per open sign-out: qty × item and the date it went out. Built for the
// floor (Ricardo's quick check), not for record admin — that lives in the
// Equipment/Tool/Chemical Sign In-Out module.
export default function CheckedOutPanel() {
  const { data: records, loading, refresh } = useApiGet('/qms/maintenance_sign_out');
  const [q, setQ] = useState('');

  const out = useMemo(() => {
    let l = (records || []).filter(r => r.status === 'out');
    const needle = q.trim().toLowerCase();
    if (needle) l = l.filter(r => [r.item_description, r.employee_name, r.tool_box].filter(Boolean).join(' ').toLowerCase().includes(needle));
    return l;
  }, [records, q]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Checked Out</h2>
          <p className="text-sm text-gray-500">{out.length} item{out.length === 1 ? '' : 's'} currently out</p>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" data-tip="Refresh" data-tip-left>
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, name, tool box…"
          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : out.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <PackageSearch size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium">Nothing is checked out right now.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {out.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-gray-900 leading-snug">
                  {Number(r.qty) > 1 ? `${r.qty}× ` : ''}{r.item_description}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {[r.employee_name, r.tool_box ? `Box ${r.tool_box}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="shrink-0 text-sm text-gray-500 tabular-nums">{r.record_date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
