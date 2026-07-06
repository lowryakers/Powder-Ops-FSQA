// Format a Date as YYYY-MM-DD in *local* time.
// Avoid new Date().toISOString().slice(0, 10) for "today": it returns the
// UTC date, which is tomorrow's date during US evenings.
export function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateStr(d);
}
