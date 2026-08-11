/**
 * A free-text column in a log table.
 *
 * Someone typing three sentences into a Reason field should not restructure the
 * log. `max-width` on a `<td>` does nothing under the default `table-layout:
 * auto` — the browser is free to give the column whatever width the rest of the
 * row leaves, and with a long enough string it picks a narrow one and wraps to
 * fifteen lines. That is how one disposal reason turned every row on the screen
 * into a 400px-tall ribbon and pushed the columns people came to read off the
 * bottom.
 *
 * So the constraint goes on a block INSIDE the cell, where width is honoured,
 * and the text is clamped to two lines. Nothing is lost: the full text is on the
 * record (every log here opens the row), and it is on the `title` for a hover.
 *
 * Deliberately NOT a tooltip component or an expand toggle. A log table is for
 * scanning; the place to read a paragraph is the record it belongs to.
 */
// Written out rather than built from `lines`: Tailwind generates utilities by
// scanning the source for literal class names, so `line-clamp-${n}` produces a
// class that exists in the markup and nowhere in the stylesheet.
const CLAMP = {
  1: 'truncate',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
};

export default function TextCell({ value, width = '18rem', lines = 2, preLine = false, className = '' }) {
  const text = value == null || value === '' ? null : String(value);
  if (!text) return <span className="text-gray-400">—</span>;
  return (
    // `preLine` is for the cells holding several values on their own lines (a
    // disposal against three write-offs). Those are not free text and their
    // line breaks are meaningful, but eight of them still turn one row into a
    // wall — so the newlines are kept and the clamp still applies.
    <div title={text} style={{ maxWidth: width }}
      className={`${CLAMP[lines] || CLAMP[2]} ${preLine ? 'whitespace-pre-line' : ''} ${className}`}>
      {text}
    </div>
  );
}
