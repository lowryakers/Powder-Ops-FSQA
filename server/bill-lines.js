// What a bill says line by line, and where it asks to be paid (payment run part C, D-363).
//
// PURE: text in, facts out, each with the line it came from. Nothing here is
// stored — the payment run reads the bill's own extracted text on every look,
// so a better reader changes the answer without rewriting anything on file.
//
// A LINE IS ONLY A LINE WHEN ITS ARITHMETIC HOLDS: the last number on it must be
// the quantity times the unit price (to the cent, or within half a percent for a
// rounded unit price). That is what tells "Whey isolate 1,000 3.25 3,250.00"
// from a phone number, a date or an address with digits in it. A line that does
// not add up is not read, and the check says the lines were not read rather
// than guessing.
//
// BANK DETAILS ARE READ ONLY BESIDE A ROUTING NUMBER. "Account #" on an invoice
// is usually OUR customer account with the vendor; only an account number near
// a valid ABA routing number is the vendor's bank. Only the last four digits are
// ever returned.

const NUM = /-?\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$?\d+(?:\.\d+)?/g;
const toNum = (s) => Number(String(s).replace(/[$,]/g, ''));
const HEADER = /\b(?:subtotal|sub-total|total|tax|shipping|freight|balance|amount\s+due|paid|deposit|discount|page)\b/i;

/** ABA routing checksum: 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10). */
export function abaValid(r) {
  const d = String(r || '').replace(/\D/g, '');
  if (d.length !== 9 || /^0{9}$/.test(d)) return false;
  const n = [...d].map(Number);
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
}

/** The bill's lines: [{ qty, unit_price, amount, description, evidence }]. */
export function readBillLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || HEADER.test(line)) continue;
    const nums = [...line.matchAll(NUM)];
    if (nums.length < 3) continue;
    const amount = toNum(nums[nums.length - 1][0]);
    if (!(amount > 0)) continue;
    // The two numbers that multiply to the amount, nearest the end first.
    let hit = null;
    for (let j = nums.length - 2; j >= 1 && !hit; j--) {
      for (let i = j - 1; i >= 0 && !hit; i--) {
        const a = toNum(nums[i][0]), b = toNum(nums[j][0]);
        if (!(a > 0 && b > 0)) continue;
        const ok = (x) => Math.abs(x - amount) < 0.011 || Math.abs(x - amount) / amount < 0.005;
        if (ok(a * b)) {
          // Quantity is usually the whole number; when both are, the first one.
          const aWhole = Number.isInteger(a), bWhole = Number.isInteger(b);
          const [qty, price] = aWhole && !bWhole ? [a, b] : (!aWhole && bWhole ? [b, a] : [a, b]);
          hit = { qty, unit_price: price, at: nums[i].index };
        }
      }
    }
    if (!hit) continue;
    const description = line.slice(0, hit.at).replace(/[\s:#-]+$/, '').trim();
    if (!/[a-z]{2}/i.test(description)) continue;
    out.push({ qty: hit.qty, unit_price: Math.round(hit.unit_price * 10000) / 10000, amount, description, evidence: line.slice(0, 200) });
  }
  return out;
}

/** Where the bill asks to be paid: { routing, account_last4, evidence } or null. */
export function readRemit(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\b(?:routing|aba|rtn|transit)\b[^\d\n]{0,25}(\d[\d -]{7,12}\d)/i);
    if (!m) continue;
    const routing = m[1].replace(/\D/g, '');
    if (!abaValid(routing)) continue;
    let last4 = null, accEvidence = null;
    for (let k = Math.max(0, i - 4); k <= Math.min(lines.length - 1, i + 4) && !last4; k++) {
      const a = lines[k].match(/\b(?:account|acct)\b(?:\s*(?:no\.?|number|#))?[^\d\n]{0,15}(\d[\d -]{2,18}\d)/i);
      if (!a) continue;
      const digits = a[1].replace(/\D/g, '');
      if (digits === routing || digits.length < 4) continue;
      last4 = digits.slice(-4); accEvidence = lines[k].trim().replace(/\d(?=[\d -]*\d{4})/g, '•').slice(0, 160);
    }
    return { routing, account_last4: last4, evidence: lines[i].trim().slice(0, 160), account_evidence: accEvidence };
  }
  return null;
}

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Pair each bill line with a PO row: a part number printed in the line, else
 * the PO description inside the line (or the other way), else — one line and
 * one PO row — each other. Returns [{ line, po }] with po null when unmatched.
 */
export function matchLinesToPo(lines, poRows) {
  const rows = poRows.filter(r => r.status !== 'cancelled');
  const used = new Set();
  const pick = (line) => {
    const d = fold(line.description);
    const byPart = rows.find((r, i) => !used.has(i) && r.part_no && fold(r.part_no).length >= 3 && ` ${d} `.includes(` ${fold(r.part_no)} `));
    if (byPart) return byPart;
    return rows.find((r, i) => {
      if (used.has(i)) return false;
      const pd = fold(r.description);
      return pd.length >= 4 && (d.includes(pd) || (d.length >= 4 && pd.includes(d)));
    }) || null;
  };
  const out = lines.map(line => {
    const po = pick(line);
    if (po) used.add(rows.indexOf(po));
    return { line, po };
  });
  if (out.length === 1 && !out[0].po && rows.length === 1) out[0].po = rows[0];
  return out;
}

/**
 * The line checks: quantity off by more than `qtyPct`, unit price above the PO
 * by more than `noteBy` (note) or `highlightBy` (highlight), a line not on the PO.
 * Returns flags { key, label, reason, severity }.
 */
export function lineFlags(pairs, { qtyPct = 20, noteBy = 2, highlightBy = 10, money = (n) => `$${n}` } = {}) {
  const flags = [];
  const name = (l) => `"${l.description.slice(0, 40)}"`;
  pairs.forEach(({ line, po }, i) => {
    if (!po) { flags.push({ key: `line_${i}_extra`, label: 'Line', reason: `${name(line)} is not on the PO`, severity: 'note' }); return; }
    const oq = Number(po.qty), op = Number(po.unit_price);
    if (oq > 0) {
      const off = (line.qty - oq) / oq * 100;
      if (off > qtyPct) flags.push({ key: `line_${i}_qty`, label: 'Quantity', reason: `${name(line)}: billed ${line.qty} against ${oq} ordered (${off.toFixed(0)}% over)`, severity: 'highlight' });
      else if (off < -qtyPct) flags.push({ key: `line_${i}_qty`, label: 'Quantity', reason: `${name(line)}: billed ${line.qty} of ${oq} ordered (${Math.abs(off).toFixed(0)}% under; a part delivery?)`, severity: 'note' });
    }
    if (op > 0) {
      const up = (line.unit_price - op) / op * 100;
      if (up > highlightBy) flags.push({ key: `line_${i}_price`, label: 'Unit price', reason: `${name(line)}: ${money(line.unit_price)} each against ${money(op)} on the PO (${up.toFixed(1)}% over)`, severity: 'highlight' });
      else if (up > noteBy) flags.push({ key: `line_${i}_price`, label: 'Unit price', reason: `${name(line)}: ${money(line.unit_price)} each against ${money(op)} on the PO (${up.toFixed(1)}% over)`, severity: 'note' });
    }
  });
  return flags;
}
