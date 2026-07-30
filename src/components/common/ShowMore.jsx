import { ChevronDown } from 'lucide-react';

/**
 * The footer for a capped list. Says how much you're looking at and how much
 * is behind the button — a bare "Show more" leaves people wondering whether
 * the record they want is even in this filter.
 *
 * Renders nothing when the whole list already fits, so it can be dropped in
 * unconditionally.
 */
export default function ShowMore({ view, noun = 'rows', className = '' }) {
  if (!view?.capped) return null;
  return (
    <div className={`flex flex-col items-center gap-1.5 py-4 ${className}`}>
      <p className="text-xs text-gray-500">
        Showing {view.shown.toLocaleString()} of {view.total.toLocaleString()} {noun}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={view.showMore}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
          <ChevronDown size={14} /> Show {Math.min(200, view.hidden).toLocaleString()} more
        </button>
        {view.hidden > 200 && (
          <button type="button" onClick={view.showAll}
            className="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
            Show all {view.total.toLocaleString()}
          </button>
        )}
      </div>
    </div>
  );
}
