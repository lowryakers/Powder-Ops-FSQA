import { useState, useEffect } from 'react';
import { getTeamColor } from '../utils/parseSheet';

export default function RunLog({ runs }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [runs]);
  const pageSize = 25;
  const totalPages = Math.ceil(runs.length / pageSize);
  const pageRuns = runs.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">
          Run Log <span className="text-sm font-normal text-gray-500">({runs.length} runs)</span>
        </h3>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
          >
            ←
          </button>
          <span className="text-gray-600">
            {page + 1} / {totalPages || 1}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
          >
            →
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-2.5 font-medium text-gray-600">Date</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Team</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Product</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">MO #</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Qty</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 text-right">People</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Duration</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 text-right">U/Min</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 text-right">U/Man-Hr</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Notes</th>
            </tr>
          </thead>
          <tbody>
            {pageRuns.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: getTeamColor(r.team) }}
                  >
                    {r.team}
                  </span>
                </td>
                <td className="px-4 py-2.5 w-full min-w-[160px]" title={r.product}>
                  {r.product}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">{r.mo}</td>
                <td className="px-4 py-2.5 text-right font-medium">
                  {r.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-2.5 text-right">{r.people ?? '–'}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.duration ? `${r.duration.toFixed(1)}h` : '–'}
                </td>
                <td className="px-4 py-2.5 text-right font-medium">
                  {r.unitsPerMinute ? r.unitsPerMinute.toFixed(1) : '–'}
                </td>
                <td className="px-4 py-2.5 text-right font-medium">
                  {r.unitsPerManHour ? r.unitsPerManHour.toFixed(0) : '–'}
                </td>
                <td className="px-4 py-2.5 min-w-[150px] text-gray-500" title={r.notes}>
                  {r.notes || '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
