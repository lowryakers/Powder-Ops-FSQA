
// One tab strip for every module.
//
// Nine modules had grown their own — in four different visual styles (filled
// pills, underlines, two flavours of segmented control) — and each one re-solved
// the same four problems slightly differently: which tabs a given person may
// see, how a count is shown, what happens on a 360px phone, and what the strip
// does when only one tab survives the permission filter.
//
// Getting that wrong is not cosmetic. The Training strip was six pixels wider
// than a small Android and panned the entire page sideways; a strip built once
// can only have that bug once.
//
// THE SEGMENTED CONTROL IS THE HOUSE STYLE. It was already the most-used shape
// (Production Log, Time Tracking, the ledgers, and the shared ModuleHub) and it
// is the calmest — a tab strip is orientation, not a call to action, so it
// should not shout louder than the buttons that actually do something.
//
// Deliberately NOT consolidated: Task Center's group and frequency chips. Those
// are colour-coded FILTERS that narrow one list, not navigation between views,
// and flattening them into this would throw away the per-team colour that makes
// that screen scannable. A filter and a tab are different things.
//
// THIS COMPONENT DOES NOT DECIDE WHO SEES WHAT. It renders the tabs it is
// handed. Working out which tabs a person gets belongs to useModuleTabs (or to
// the caller building the array), and splitting it that way is not tidiness —
// it is the fix for a real bug: while this filtered by `visible(user)` too, any
// caller that forgot to pass `user` ran every predicate against undefined,
// which quietly hid the entire strip. One owner for the rule means it cannot be
// evaluated with the wrong argument.

/* ── The strip ────────────────────────────────────────────────────────────── */

export default function ModuleTabs({
  tabs, value, onChange,
  // A single tab is not a choice. Hiding the strip is usually right (Time
  // Tracking did this by hand); pass `hideWhenSingle={false}` where the label
  // is doing real work as a heading.
  hideWhenSingle = true,
  className = '',
  label = 'Sections',
}) {
  const shown = (tabs || []).filter(Boolean);
  if (!shown.length) return null;
  if (shown.length === 1 && hideWhenSingle) return null;

  return (
    // overflow-x-auto, never wrap: a wrapped segmented control breaks into two
    // rows of half-pills and stops reading as one control. Scrolling is the
    // right idiom for a tab strip, and it keeps the PAGE from panning — which
    // is the bug this component exists to prevent.
    <div role="tablist" aria-label={label}
      className={`flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto w-fit max-w-full ${className}`}>
      {shown.map(t => {
        const on = t.id === value;
        const Icon = t.icon;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on}
            onClick={() => onChange(t.id)} title={t.title || undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
              on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {Icon && <Icon size={14} className={on ? 'text-powder-600' : 'text-gray-400'} />}
            {t.label}
            {/* A count belongs beside the label, not inside it — "Boxes (3)"
                gets re-translated and re-pluralised by every author otherwise. */}
            {t.badge != null && t.badge !== '' && t.badge !== 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                t.badgeTone === 'alert' ? 'bg-red-500 text-white'
                  : on ? 'bg-powder-100 text-powder-700' : 'bg-gray-200 text-gray-600'}`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
