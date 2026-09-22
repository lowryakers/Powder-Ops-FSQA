// A standing list of things to restock, and the cycle that asks about it.
//
// Marnee asked for "a recurring Supply Order for Monthly break room snacks and
// supplies / Monthly cleaning supplies / Monthly production supplies", and for
// a way to tag items so the groups can be tracked.
//
// THOSE THREE THINGS ARE NOT ORDERS, THEY ARE LISTS. A `supply_orders` row is
// ONE item — a name, a quantity, a unit, a supplier, a link — and that is what
// gets marked ordered, part-received and paid. "Monthly break room supplies" is
// a dozen of those, and which dozen is the whole question each month: some
// months the paper towels do not need doing. So a recurring ORDER is the wrong
// object; what recurs is the ASKING.
//
// SO THE CYCLE RAISES ONE PROMPT, NOT N DRAFT ROWS. Filing eighteen new rows
// on the first of every month whether or not anything is needed would put noise
// in the one queue that has to stay readable — the exact reason the "used up"
// strip groups suggestions instead of writing requests (a queue with
// duplicates in it stops being read). The cycle opens, Marnee ticks what is
// actually low, and THAT files real orders. "Nothing needed this month" is a
// one-click answer and is recorded with a name and a date, because a cycle
// that was deliberately skipped and one that nobody opened are different facts.
//
// WHAT GETS ORDERED STAYS THE OFFICE'S DECISION. Nothing here orders anything,
// and nothing here spends money.
//
// PURE: dates and shapes in, dates and shapes out. No Express, no database in
// the period arithmetic — the part that decides when somebody is asked should
// be checkable without standing a server up.

/** The cadences a standing list can run on. */
export const CADENCES = ['weekly', 'monthly', 'quarterly'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);

/**
 * The period a date falls in, in the vocabulary each cadence reads best.
 *
 * This string IS the idempotence key (`UNIQUE (list_id, period)`), so a cycle
 * can be opened by the hourly job, by a redeploy in the same hour and by
 * somebody pressing the button, and there is still one of it.
 */
export function periodOf(cadence, dateStr) {
  const d = parse(dateStr);
  const y = d.getUTCFullYear();
  if (cadence === 'monthly') return `${y}-${pad(d.getUTCMonth() + 1)}`;
  if (cadence === 'quarterly') return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  // ISO week, so a list due on a Monday does not change period mid-cycle at
  // new year — the trap a naive "week of the year" count walks straight into.
  const t = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

/**
 * When, inside the period `dateStr` falls in, this list comes due.
 *
 * `day` is the day of the month (monthly, quarterly — clamped to 28 so a list
 * set to the 31st is still asked about in February) or the ISO weekday
 * (weekly, 1 = Monday).
 */
export function dueDateOf(cadence, day, dateStr) {
  const d = parse(dateStr);
  if (cadence === 'weekly') {
    const want = Math.min(7, Math.max(1, Number(day) || 1));
    const have = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + (want - have));
    return iso(d);
  }
  const dom = Math.min(28, Math.max(1, Number(day) || 1));
  if (cadence === 'quarterly') {
    const qStart = Math.floor(d.getUTCMonth() / 3) * 3;
    return `${d.getUTCFullYear()}-${pad(qStart + 1)}-${pad(dom)}`;
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(dom)}`;
}

/**
 * Which lists owe a cycle today, and what that cycle would be.
 *
 * DERIVED, never a stored "next run" — a stored date drifts the first time
 * somebody changes the cadence, and then the list is either asked about twice
 * or silently never again. Lists whose cycle for this period already exists
 * are simply absent; the caller writes what this returns.
 */
export function cyclesDue(lists, today, existing = new Set()) {
  const out = [];
  for (const l of lists) {
    if (!l.active) continue;
    // A LIST WITH NOTHING ON IT HAS NOTHING TO ASK ABOUT. The three lists ship
    // named and empty — nobody outside the office knows what "Monthly break
    // room snacks and supplies" covers — and a cycle offering an empty tick
    // list reads as the feature being broken.
    if (!l.item_count) continue;
    const cadence = CADENCES.includes(l.cadence) ? l.cadence : 'monthly';
    const period = periodOf(cadence, today);
    if (existing.has(`${l.id}:${period}`)) continue;
    const due = dueDateOf(cadence, l.day, today);
    // Not yet: the first of the month has not arrived. A cycle opened early is
    // a prompt to order things nobody has used yet.
    if (due > today) continue;
    out.push({ list_id: l.id, name: l.name, period, due_date: due });
  }
  return out;
}

/** How late an open cycle is, in whole days. Derived on every read. */
export function cycleAge(cycle, today) {
  if (!cycle?.due_date) return 0;
  return Math.max(0, Math.round((parse(today) - parse(cycle.due_date)) / 86400000));
}

/**
 * Tags, canonicalised against what is already in use.
 *
 * A TAG IS A CATEGORY YOU CAN ORDER FROM, which is why a spelling of an
 * existing one is folded into it ("break room" files as "Break room") while a
 * genuinely new tag is kept exactly as typed — the `candidates.tags` rule. Two
 * spellings of one group is two groups, and the whole point of this is being
 * able to ask what the break room costs.
 */
export function normalizeTags(raw, known = []) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,;]/);
  const byLower = new Map(known.map(k => [String(k).toLowerCase(), k]));
  const out = [];
  for (const t of list) {
    const v = String(t || '').trim();
    if (!v) continue;
    const canon = byLower.get(v.toLowerCase()) || v;
    if (!out.includes(canon)) out.push(canon);
  }
  return out;
}
