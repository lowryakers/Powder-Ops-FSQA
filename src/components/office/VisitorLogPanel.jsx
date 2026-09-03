import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Search, LogOut, X, FileText, Users, QrCode } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';
import { RecordCard, RecordCards } from '../common/RecordCards.jsx';

// Who has been in the building, and what they signed.
//
// The half of the visitor module that is a RECORD rather than a screen for a
// stranger. An auditor asking "show me your visitor control" wants this: who
// came, when they arrived, when they left, and the agreement they signed with
// its revision.

const shortTime = (v) => (v ? formatDateTime(v) : '—');

function SignatureView({ visit, onClose }) {
  const { data } = useApiGet(visit ? `/visitors/visits/${visit.id}` : null, [visit?.id]);
  if (!visit) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{visit.name}</h3>
            <p className="text-sm text-gray-500">
              {visit.email}{visit.company ? ` · ${visit.company}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
          <div><dt className="text-gray-500">Signed in</dt><dd className="text-gray-900">{shortTime(visit.signed_in_at)}</dd></div>
          <div><dt className="text-gray-500">Signed out</dt><dd className="text-gray-900">{shortTime(visit.signed_out_at)}</dd></div>
          <div><dt className="text-gray-500">Where</dt><dd className="text-gray-900">{visit.location}</dd></div>
          {/* Said in words. An auto sign-out is not a departure time and the
              record must not let anybody read it as one. */}
          <div><dt className="text-gray-500">How it ended</dt><dd className="text-gray-900">{visit.signed_out_label}</dd></div>
        </dl>

        <h4 className="mt-5 mb-2 text-sm font-semibold text-gray-900">Signed</h4>
        {(data?.signatures || []).length === 0 && <p className="text-sm text-gray-400">Nothing signed on this visit.</p>}
        {(data?.signatures || []).map(s => (
          <div key={s.id} className="border border-gray-200 rounded-xl p-3 mb-3">
            <p className="text-sm font-medium text-gray-900">
              {s.title} <span className="text-gray-400">· {s.agreement_code} {s.agreement_revision}</span>
            </p>
            <p className="text-xs text-gray-500">Signed by {s.signed_name} — {shortTime(s.signed_at)}</p>
            {s.signature_image && (
              <img src={s.signature_image} alt={`Signature of ${s.signed_name}`}
                className="h-20 mt-2 border border-gray-100 rounded" />
            )}
            {/* The wording as it stood when they signed it, never "the current
                NDA" — that is the whole point of freezing a revision. */}
            <details className="mt-2">
              <summary className="text-xs text-powder-700 cursor-pointer">Read what they agreed to</summary>
              <p className="whitespace-pre-line text-[12px] leading-relaxed text-gray-700 mt-2 max-h-64 overflow-y-auto">{s.body}</p>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VisitorLogPanel() {
  const { user } = useAuth() || {};
  const canManage = user?.role === 'admin' || user?.role === 'supervisor'
    || ['office', 'hr', 'qa', 'quality'].includes(String(user?.department || '').toLowerCase());
  const [filters, setFilters] = useState({ q: '', from: '', to: '', on_site: false });
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v && v !== false).map(([k, v]) => [k, String(v)])).toString();
  const { data: visits, refresh } = useApiGet(`/visitors/visits${query ? `?${query}` : ''}`, [query]);
  const { data: stats, refresh: refreshStats } = useApiGet('/visitors/stats');
  const [open, setOpen] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const rows = visits || [];

  const signOut = async (v) => {
    if (!window.confirm(`Sign ${v.name} out? The record will say a staff member did it, not the visitor.`)) return;
    await apiPost(`/visitors/visits/${v.id}/sign-out`, {});
    refresh(); refreshStats();
  };

  const kioskUrl = `${window.location.origin}/kiosk/visitor`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Visitors</h2>
          <p className="text-sm text-gray-500">Who has been in the building, and what they signed.</p>
        </div>
        <button type="button" onClick={() => setShowQr(v => !v)}
          className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-1.5">
          <QrCode size={15} /> Lobby tablet link
        </button>
      </div>

      {showQr && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-600">
            Open this on the lobby tablet and add it to the home screen. It needs no sign-in.
          </p>
          <code className="block mt-2 text-sm text-powder-700 break-all">{kioskUrl}</code>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: 'On site now', value: stats?.on_site ?? '—', tone: stats?.on_site ? 'text-green-700' : 'text-gray-900' },
          { label: 'Today', value: stats?.today ?? '—' },
          { label: 'This month', value: stats?.this_month ?? '—' },
          { label: 'People on file', value: stats?.people ?? '—' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${c.tone || 'text-gray-900'}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[13rem] flex-1">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="search" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Name or email…" className="w-full pl-8 pr-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">From</label>
          <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">To</label>
          <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={filters.on_site}
            onChange={e => setFilters(f => ({ ...f, on_site: e.target.checked }))} />
          On site now
        </label>
        <p className="w-full text-[11px] text-gray-500">
          {rows.length} visit{rows.length === 1 ? '' : 's'}
          {rows.length >= 200 ? ' · showing the most recent only — narrow the dates to see further back' : ''}
        </p>
      </div>

      <RecordCards count={rows.length} empty="No visits.">
        {rows.map(v => (
          <RecordCard key={v.id} onClick={() => setOpen(v)} stripe={v.on_site ? 'border-l-green-500' : ''}
            title={<>{v.name}{v.on_site && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">ON SITE</span>}</>}
            subtitle={`${v.email || ''}${v.company ? ` · ${v.company}` : ''}`}
            fields={[
              { label: 'Signed in', value: shortTime(v.signed_in_at) },
              { label: 'Signed out', value: v.signed_out_at
                  ? <>{shortTime(v.signed_out_at)}{v.signed_out_method === 'auto' && <span className="block text-[11px] text-amber-700">closed automatically</span>}{v.signed_out_method === 'staff' && <span className="block text-[11px] text-gray-500">by {v.signed_out_by}</span>}</>
                  : <span className="text-green-700">still on site</span> },
              { label: 'Where', value: v.location },
              { label: 'Signed', value: v.signature_count ? `${v.signature_count} agreement${v.signature_count === 1 ? '' : 's'}` : null },
            ]}
            actions={v.on_site && canManage ? (
              <button type="button" onClick={() => signOut(v)}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><LogOut size={12} /> Sign out</button>
            ) : null} />
        ))}
      </RecordCards>
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 px-3">Visitor</th>
              <th className="py-2 px-3">Signed in</th>
              <th className="py-2 px-3">Signed out</th>
              <th className="py-2 px-3">Where</th>
              <th className="py-2 px-3">Signed</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-sm text-gray-400">No visits.</td></tr>
            )}
            {rows.map(v => (
              <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => setOpen(v)}>
                <td className="py-2 px-3">
                  <span className="font-medium text-gray-900">{v.name}</span>
                  {v.on_site && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">ON SITE</span>}
                  <span className="block text-xs text-gray-500">{v.email}{v.company ? ` · ${v.company}` : ''}</span>
                </td>
                <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{shortTime(v.signed_in_at)}</td>
                <td className="py-2 px-3 text-gray-600 whitespace-nowrap">
                  {v.signed_out_at ? shortTime(v.signed_out_at) : <span className="text-green-700">—</span>}
                  {v.signed_out_method === 'auto' && (
                    <span className="block text-[11px] text-amber-700">closed automatically</span>
                  )}
                  {v.signed_out_method === 'staff' && (
                    <span className="block text-[11px] text-gray-500">by {v.signed_out_by}</span>
                  )}
                </td>
                <td className="py-2 px-3 text-gray-600">{v.location}</td>
                <td className="py-2 px-3 text-gray-600 tabular-nums">
                  {v.signature_count ? <span className="inline-flex items-center gap-1"><FileText size={13} className="text-gray-400" />{v.signature_count}</span> : '—'}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">
                  {v.on_site && canManage && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); signOut(v); }}
                      className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
                      <LogOut size={12} /> Sign out
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
        <Users size={12} />
        A visit closed automatically records when the system closed it, not when the visitor left —
        the log says which, because those are different facts.
      </p>

      {open && <SignatureView visit={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
