# GTIN sanity check against Open Food Facts (opt-in, hand-run)

`scripts/off-gtin-sanity.mjs 850046726019` — before allocating a new barcode, check whether it already
exists in [Open Food Facts](https://world.openfoodfacts.org)'s public product database. A check digit
passing only proves the number is *well-formed*; this is a second, cheap opinion on whether it is *taken*
by someone else's product before it goes on film.

- **Not a runtime dependency.** Not called from the server, not in `npm run check`. Run it by hand while
  allocating a number, same as `verify:prodcopy`.
- **No secrets.** Open Food Facts's [read API](https://openfoodfacts.github.io/openfoodfacts-server/api/)
  is public and needs no key, no account, and no env var. The script sends only the GTIN.
- **Rate limits.** OFF asks that automated read traffic stay reasonable and carry a `User-Agent`
  identifying the caller (the script sends `PowderOps-GTIN-sanity/1.0`). This is a by-hand tool run a few
  times per new SKU, nowhere near a volume that would need throttling.
- **Fails soft, on purpose.** A network error, a blocked host, or a timeout prints "could not check" and
  exits 0 — it is a convenience lookup, not a gate, and an outage must never read as "this number is free."
- **Reuses `shared/gtin.js`**, not a second copy — it normalizes and validates with the same functions
  everything else in the catalogue uses before it ever makes a request.
- **Could not be run end-to-end in this sandboxed session** — `world.openfoodfacts.org` is blocked by this
  environment's own outbound proxy (confirmed directly, not assumed), which the script's fail-soft path
  handles correctly but couldn't demonstrate a real hit against. It is written against Open Food Facts's
  documented v2 product endpoint; try it from a normal machine or from Railway.
- **Why not the official Python SDK** (`openfoodfacts/openfoodfacts-python`, MIT): a whole SDK is more than
  a single GET request needs, and it would be Python beside an otherwise all-Node toolset. The plain REST
  call keeps this a zero-dependency script. See `docs/github-reuse-scan-powder-ops-2026-09.md` for the
  fuller reuse-vs-build reasoning.
