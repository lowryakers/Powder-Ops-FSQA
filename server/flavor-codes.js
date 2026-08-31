// One flavour, one code — derived from the codes the plant is already printing.
//
// WHY THIS HAS TO EXIST BEFORE THE BOTTLE LINE DOES.
//
// The legacy SKU carries the pack in its prefix (`PP-` pouch, `PSP-` stick), so
// a flavour could get away with a different abbreviation on each pack and
// nothing joined them. The new standard is `<PROTEIN>-<PACK>-<FLAVOUR>`, which
// makes the flavour code shared across every pack of that flavour — so the
// moment a third pack exists, a flavour with two codes is a flavour whose SKUs
// do not line up, and a code meaning two flavours is a SKU that is simply
// ambiguous. Both already exist in the live data:
//
//   ten flavours carry two codes   (Blueberry Muffin is BLM on a pouch, BM on a stick)
//   three codes carry two flavours (CC, CM and SC each mean two different things)
//
// PURE. Product rows in, a decision out: no Express, no database, no writes. The
// codes that will be printed on packaging for years should be checkable without
// standing anything up, and the caller decides what filing them means.

/**
 * Pull `{ flavour -> Set(codes) }` out of the legacy SKUs.
 *
 * Only the two shapes that actually encode a flavour are read: `PP-<code>-<n>`
 * and `<prefix>-<code>`. Anything else (the four beef rows whose "SKU" is a
 * Shopify variant id, the mixes) contributes nothing rather than being guessed
 * at — a wrong code here is a wrong code on film.
 */
export function codesInUse(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const flavour = String(r.base_flavor || r.flavor || '').trim();
    const sku = String(r.sku || '').trim();
    if (!flavour || !sku || /^\d+$/.test(sku)) continue;
    const parts = sku.split('-');
    if (parts.length < 2) continue;
    const code = parts[1].trim().toUpperCase();
    // A code is letters. A serial ("01") is not a flavour abbreviation.
    if (!/^[A-Z]{1,4}$/.test(code)) continue;
    if (!out.has(flavour)) out.set(flavour, new Set());
    out.get(flavour).add(code);
  }
  return out;
}

/**
 * Decide one code per flavour, and say honestly where it cannot.
 *
 * THE TIEBREAK IS LENGTH, AND IT IS EVIDENCE-BASED RATHER THAN TASTE. Two
 * letters gives 676 combinations, three gives 17,576; the plant has 67 flavours
 * and is adding more, and **all three existing collisions are two-letter
 * codes**. So where a flavour already carries both a short and a long form, the
 * long one is kept: it is the form somebody already reached for when the short
 * one stopped being distinctive.
 *
 * WHERE THAT DOES NOT DECIDE, NOTHING IS INVENTED. Two flavours whose only
 * codes are the same, or one flavour with two equally long candidates, are
 * returned in `needs_decision` with the options laid out. A code chosen by a
 * tiebreak nobody agreed to is a code that gets printed and then argued about.
 */
export function resolveFlavorCodes(rows, { issued = {} } = {}) {
  const inUse = codesInUse(rows);
  // CODES ALREADY ISSUED SETTLE THE CONTESTS THEY WERE PART OF. Breaking the
  // CM collision by giving Café Mocha a new abbreviation leaves Chocolate
  // Mousse as the only claimant on CM — so it must stop being reported as
  // contested, or the list of decisions never shrinks and the one thing it is
  // for (telling somebody what still needs deciding) stops being true.
  const settled = new Map(Object.entries(issued || {}));
  const spoken = new Set(settled.values());
  for (const f of settled.keys()) inUse.delete(f);
  const flavours = [...inUse.keys()].sort();

  // Longest first; alphabetical within a length so two runs over the same data
  // rank identically. A suggestion that moves between previews is worse than
  // one that is merely debatable — the training-importer rule.
  const ranked = new Map(flavours.map(f =>
    [f, [...inUse.get(f)].sort((a, b) => b.length - a.length || a.localeCompare(b))]));

  // A code is contested when more than one flavour would land on it.
  const claimants = new Map();
  for (const f of flavours) {
    const top = ranked.get(f)[0];
    if (!claimants.has(top)) claimants.set(top, []);
    claimants.get(top).push(f);
  }

  const resolved = [];
  const needsDecision = [];
  // Seeded with the codes already issued, so nothing can be handed out twice.
  const taken = new Set(spoken);

  for (const f of flavours) {
    const options = ranked.get(f);
    const top = options[0];
    const rivals = claimants.get(top).filter(x => x !== f);

    // Uncontested, or contested but this flavour has an alternative nobody
    // else wants — the ordinary case, and the reason CC frees up entirely once
    // Coconut Cream takes CNC and Cookie Crumble takes CCR.
    const free = options.find(c => {
      const others = claimants.get(c) || [];
      return !taken.has(c) && others.filter(x => x !== f).length === 0;
    });

    if (rivals.length === 0 && !taken.has(top)) {
      resolved.push({ flavor: f, code: top, from: options, reason: options.length > 1 ? 'longest of the codes in use' : 'the only code in use' });
      taken.add(top);
      continue;
    }
    if (free) {
      resolved.push({ flavor: f, code: free, from: options, reason: 'the only one of its codes no other flavour claims' });
      taken.add(free);
      continue;
    }
    // Two flavours, one code, no alternative on either side.
    needsDecision.push({
      flavor: f, options, contested_with: rivals,
      reason: rivals.length
        ? `"${top}" is also the only code for ${rivals.join(', ')} — one of them needs a new abbreviation.`
        : `${options.join(' and ')} are equally good; pick the one to print.`,
    });
  }

  // A flavour with two equally long candidates and no rival is still a choice
  // somebody has to make; it is caught here rather than silently taking the
  // alphabetical winner.
  for (let i = resolved.length - 1; i >= 0; i--) {
    const r = resolved[i];
    const sameLength = r.from.filter(c => c.length === r.code.length);
    if (sameLength.length > 1) {
      resolved.splice(i, 1);
      taken.delete(r.code);
      needsDecision.push({
        flavor: r.flavor, options: r.from, contested_with: [],
        reason: `${sameLength.join(' and ')} are both in use and the same length — pick the one to print.`,
      });
    }
  }

  resolved.sort((a, b) => a.flavor.localeCompare(b.flavor));
  needsDecision.sort((a, b) => a.flavor.localeCompare(b.flavor));
  return { resolved, needs_decision: needsDecision, flavours: flavours.length };
}
