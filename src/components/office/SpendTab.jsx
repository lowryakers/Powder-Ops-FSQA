import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { ExternalLink, AlertTriangle } from 'lucide-react';

// Supply spend per pay period, by category. This replaces the card that used
// to pull from the Monday board — the orders are already in this app, so the
// numbers come from the Supply Orders log instead of an outside sync.
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const periodLabel = (p) => {
  const f = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
  return `${f(p.start)} – ${f(p.end)}`;
};
function externalUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?)/i.test(v)) return `https://${v}`;
  return null;
}

const TONES = ['bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700', 'bg-teal-100 text-teal-700', 'bg-gray-100 text-gray-600'];

export default function SpendTab() {
  const { data: periods } = useApiGet('/office/periods');
  const [period, setPeriod] = useState('');
  const activePeriod = period || periods?.[0]?.start || '';
  const { data } = useApiGet(activePeriod ? `/office/spend?period=${activePeriod}` : null, [activePeriod]);

  const max = Math.max(1, ...(data?.categories || []).map(c => c.amount));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={activePeriod} onChange={e => setPeriod(e.target.value)}
          className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700">
          {(periods || []).map(p => (
            <option key={p.start} value={p.start}>{periodLabel(p)}{p.current ? ' · current' : ''}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">Orders marked ordered, received or paid in this period.</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Spend this period</p>
          <p className="text-2xl font-bold text-gray-900">{money(data?.total)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Orders</p>
          <p className="text-2xl font-bold text-gray-900">{data?.order_count ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Missing a total</p>
          <p className={`text-2xl font-bold ${(data?.untotalled || 0) > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{data?.untotalled ?? 0}</p>
          {(data?.untotalled || 0) > 0 && (
            <p className="text-[11px] text-gray-400 flex items-center gap-1">
              <AlertTriangle size={11} /> not counted in the spend above
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">By category</h3>
        {(data?.categories || []).length === 0 ? (
          <p className="text-sm text-gray-400">Nothing ordered in this period.</p>
        ) : (
          <div className="space-y-2">
            {(data?.categories || []).map((c, i) => (
              <div key={c.label}>
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium truncate max-w-[45%] ${TONES[i % TONES.length]}`}>{c.label}</span>
                  <span className="text-gray-500 text-[11px] whitespace-nowrap">{c.count} order{c.count === 1 ? '' : 's'}</span>
                  <span className="font-semibold text-gray-900 ml-auto whitespace-nowrap">{money(c.amount)}</span>
                </div>
                <div className="h-1.5 mt-1 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-powder-500 rounded-full" style={{ width: `${(c.amount / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.orders || []).map(o => (
              <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  {externalUrl(o.link) ? (
                    <a href={externalUrl(o.link)} target="_blank" rel="noreferrer"
                      className="font-medium text-powder-700 hover:underline inline-flex items-center gap-1">
                      {o.item_name} <ExternalLink size={11} />
                    </a>
                  ) : <span className="font-medium text-gray-900">{o.item_name}</span>}
                </td>
                <td className="px-3 py-1.5 text-gray-600">{o.supplier || '—'}</td>
                <td className="px-3 py-1.5 text-gray-600">{o.label || 'Uncategorized'}</td>
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{(o.submitted_at || '').slice(0, 10)}</td>
                <td className={`px-3 py-1.5 text-right ${o.total == null ? 'text-amber-600' : 'text-gray-900'}`}>
                  {o.total == null ? 'no total' : money(o.total)}
                </td>
                <td className="px-3 py-1.5 text-gray-500 capitalize">{o.status}</td>
              </tr>
            ))}
            {(data?.orders || []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No orders in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phone: the same orders as cards */}
      <div className="md:hidden space-y-2">
        {(data?.orders || []).map(o => (
          <div key={o.id} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {externalUrl(o.link) ? (
                  <a href={externalUrl(o.link)} target="_blank" rel="noreferrer"
                    className="font-medium text-powder-700 break-words inline-flex items-center gap-1">
                    {o.item_name} <ExternalLink size={11} />
                  </a>
                ) : <p className="font-medium text-gray-900 break-words">{o.item_name}</p>}
                <p className="text-[11px] text-gray-500">
                  {[o.supplier, o.label || 'Uncategorized'].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`shrink-0 text-sm font-semibold ${o.total == null ? 'text-amber-600' : 'text-gray-900'}`}>
                {o.total == null ? 'no total' : money(o.total)}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1 capitalize">{o.status} · {(o.submitted_at || '').slice(0, 10)}</p>
          </div>
        ))}
        {(data?.orders || []).length === 0 && (
          <p className="text-center py-8 text-sm text-gray-400">No orders in this period.</p>
        )}
      </div>
    </div>
  );
}
