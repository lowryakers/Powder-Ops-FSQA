// A log's rows as cards below `md`. The table stays for the desktop.
//
// `src/index.css` sets `body { overflow-x: hidden }`, so a wide table with no
// scroller does not pan on a phone — it CLIPS, and the columns past the fold
// are unreachable. Twenty-nine logs already render cards below `md` from the
// same row array as their table; this is that pattern once, so the next log
// is one `<RecordCards>` beside its `<table>` rather than a fourth hand-drawn
// card list that drifts from the table it sits beside.
//
// Rules the shape enforces:
// - The card and the row are built from the SAME row object and the SAME
//   handlers, so the two layouts cannot offer different buttons on one record.
// - Blank fields are dropped, never rendered as a dash column — a phone has no
//   room for "Notes: —" eight times.
// - `data-record-card` is on every card and `data-record-cards` on the list,
//   which is what the mobile check in scripts/verify-mobile-cards.mjs asserts.
export function RecordCard({ title, subtitle, badge, fields, actions, onClick, stripe, muted, children }) {
  const shown = (fields || []).filter(f => f
    && f.value !== null && f.value !== undefined && f.value !== '' && f.value !== false);
  const Tag = onClick ? 'button' : 'div';
  return (
    <div data-record-card
      className={`bg-white rounded-xl border border-gray-200 ${stripe ? `border-l-4 ${stripe}` : ''} ${muted ? 'opacity-70' : ''}`}>
      <Tag type={onClick ? 'button' : undefined} onClick={onClick}
        className={`block w-full text-left p-3 ${onClick ? 'active:bg-gray-50' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 text-sm leading-snug break-words">{title}</div>
            {subtitle && <div className="text-xs text-gray-500 mt-0.5 break-words">{subtitle}</div>}
          </div>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        {shown.length > 0 && (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {shown.map((f, i) => (
              <div key={f.label || i} className={f.wide ? 'col-span-2' : 'min-w-0'}>
                <dt className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{f.label}</dt>
                <dd className="text-sm text-gray-900 mt-0.5 break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </Tag>
      {actions && (
        <div className="px-3 pb-2.5 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1" onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function RecordCards({ children, empty, count, className = '' }) {
  return (
    <div data-record-cards className={`md:hidden space-y-2 ${className}`}>
      {children}
      {count === 0 && empty && <div className="text-center py-8 text-gray-400 text-sm">{empty}</div>}
    </div>
  );
}
