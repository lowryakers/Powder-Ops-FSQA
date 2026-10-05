// One definition of what a search box's words are (D-143), shared by every grid
// that takes several.
/** The words a search box holds: whitespace-separated, a "quoted phrase" as one. */
export function searchTerms(q) {
  const out = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || '').toLowerCase()))) {
    const t = (m[1] ?? m[2]).trim();
    if (t) out.push(t);
  }
  return out;
}

