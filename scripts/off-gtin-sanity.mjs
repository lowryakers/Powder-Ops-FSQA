#!/usr/bin/env node
/**
 * Sanity-check a GTIN against the public Open Food Facts product database
 * before allocating it to a new SKU.
 *
 * WHY THIS EXISTS: GS1 capacity is tight (`docs`'s GS1-capacity note —
 * `850046726` sits at 76/100), and a check-digit passing is not the same
 * question as "does somebody else already use this exact number." OFF's
 * public catalogue is millions of real products; a hit there is worth a
 * second look before the number goes on film.
 *
 * NOT A RUNTIME DEPENDENCY. Opt-in only, never wired into `npm run check` or
 * called from the server — this is something a person runs by hand from a
 * terminal while allocating a barcode, the same way `check:prodcopy` is a
 * hand-run tool rather than part of CI. Nothing here writes to ReadyDoc.
 *
 * NO SECRETS, NO API KEY. Open Food Facts's read API
 * (https://openfoodfacts.github.io/openfoodfacts-server/api/) is public and
 * needs none; this script sends nothing but the barcode itself.
 *
 * FAILS SOFT. A network error, a timeout, or an unreachable host prints a
 * plain "could not check" line and exits 0 — this is a convenience lookup,
 * not a gate, and a firewall or an outage must never look like a failed
 * check. (This sandboxed session's own egress proxy blocks
 * world.openfoodfacts.org outright — confirmed with a direct request before
 * writing this file — so it could not be run live here; it is written
 * against Open Food Facts's documented v2 product endpoint, not tested end
 * to end in this session. Try it from a normal machine or from Railway.)
 *
 * Source for the "reuse, don't fork" call: `openfoodfacts/openfoodfacts-python`
 * (MIT) — https://github.com/openfoodfacts/openfoodfacts-python — is the
 * official SDK for this same API. Pulling in a whole Python SDK for one GET
 * request is more than this needs; the plain REST call below is the smaller
 * footprint and keeps this a zero-dependency Node script.
 *
 * Usage:
 *   node scripts/off-gtin-sanity.mjs 850046726019 [more GTINs...]
 */
import { normalizeGtin, gtinValid } from '../shared/gtin.js';

const TIMEOUT_MS = 8000;
const FIELDS = 'code,product_name,brands,quantity';

async function lookup(gtin) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(gtin)}.json?fields=${FIELDS}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'PowderOps-GTIN-sanity/1.0 (internal tool)' } });
    if (!res.ok && res.status !== 404) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, reason: 'unreadable response' };
    // OFF answers status 0 with no product for a barcode it has never seen —
    // that is the GOOD outcome here, not an error.
    if (body.status === 0 || !body.product) return { ok: true, found: false };
    return { ok: true, found: true, product: body.product };
  } catch (e) {
    // Any network failure — DNS, TLS, a blocking proxy, a timeout — reads the
    // same: "could not check", never "this GTIN is free".
    return { ok: false, reason: e.name === 'AbortError' ? 'timed out' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('Usage: node scripts/off-gtin-sanity.mjs <gtin> [more gtins...]');
    process.exit(0);
  }
  for (const raw of args) {
    const gtin = normalizeGtin(raw);
    if (!gtinValid(gtin)) {
      console.log(`${raw} — SKIP: not a valid GTIN (check digit fails) — nothing to look up`);
      continue;
    }
    const r = await lookup(gtin);
    if (!r.ok) {
      console.log(`${gtin} — could not check (${r.reason}) — not a verdict either way, just try again`);
    } else if (!r.found) {
      console.log(`${gtin} — not found in Open Food Facts's public catalogue`);
    } else {
      const p = r.product;
      console.log(`${gtin} — ALREADY IN Open Food Facts: "${p.product_name || '(no name recorded)'}"`
        + `${p.brands ? ` — ${p.brands}` : ''}${p.quantity ? ` — ${p.quantity}` : ''} — look before allocating this number`);
    }
  }
}

main();
