# GitHub reuse scan — Powder Ops (ReadyDoc / Artwork-Proofing / bot bench), September 2026

**Scan date:** 16 September 2026. **No prior "2026-09-14 ReadyDoc-only starter" was found in this repo** (checked
`docs/`, full git history) or reachable from this session — this report starts fresh and covers all three lanes.
**How verified:** `gh` CLI is not installed in this environment and this session's GitHub API access is bound to
`lowryakers/Powder-Ops-FSQA` only (no general search). Every candidate below was checked with a live fetch of its
public GitHub page (About sidebar license badge, star count, primary language) or its raw `LICENSE`/manifest file
via `raw.githubusercontent.com`, plus web search to find candidates. **Nothing here is migrated, forked, or wired
in** — this is the report only, per the brief.

---

## Bottom line

**Keep building:** ReadyDoc's own spine. Nothing found here is a QMS, CMMS, or MES built for a dietary-supplement
SQF/NSF plant — that category is close to empty on GitHub (confirmed by search, not assumed), and the commercial
alternatives (Atlas CMMS, SENAITE, OpenMES, OpenQMS) are all copyleft (AGPL/GPL) dual-licensed products, which is
the wrong shape for a private plant SaaS you don't intend to open-source. Keep the QMS spine, PM/WO, Operator View,
signatures, and Products/fill-weight work exactly where they are.

**Reuse (library, not platform):** a short list of small, permissively-licensed utility libraries that do one
narrow thing ReadyDoc or Artwork-Proofing already half-solves or hasn't solved cleanly — GTIN/GS1 check-digit
validation in Node, and a mature Python invoice-to-structured-data extractor whose *label-ordering* pattern maps
directly onto `server/invoice-figures.js`. These are small, bounded wins, not rewrites.

**Ignore / don't bother:** everything QMS/CMMS/MES/LIMS-shaped is AGPL or GPL and dual-licensed for a reason —
their authors want you to either open-source your fork or pay them, and ReadyDoc is neither. Also ignore anything
here that duplicates work ReadyDoc has *already shipped and hardened past the public version* — this happened
twice in this scan (GTIN padding, offline-first sync) and is called out explicitly below, because "we already
built this, and ours handles an edge case theirs doesn't" is itself a useful finding.

**Steal the pattern, not the repo:** Open Food Facts' nutrition-table OCR pipeline (AGPL, and the older one is
archived) and the CMMS UX patterns (checklist-gated work-order completion, tablet-first shop floor screens) are
worth reading for architecture ideas. None of it should be embedded or run as a dependency.

---

## Candidate table

Stars and license are as read from the repo's own GitHub page or LICENSE file on 16 Sep 2026; "last commit" is
reported only where the fetched page surfaced it plainly (GitHub's rendered page often doesn't show an exact
timestamp without opening the commits tab, which these tools can't reliably drill into — marked "not surfaced"
rather than guessed).

| Repo | License (verified) | Stars | Last commit | Theme | Overlap with our stack | Reuse path |
|---|---|---|---|---|---|---|
| [enorganic/gtin](https://github.com/enorganic/gtin) | MIT (LICENSE file) | 16 | not surfaced | GS1/GTIN | Python GTIN 8/12/13/14 check-digit validate+parse | Steal pattern — ReadyDoc's own `shared/gtin.js` (D-090) already handles the UPC-A-padded-to-GTIN-14 edge case this doesn't advertise; read for test-case ideas, don't depend on it |
| [SGLMS/gtin-gs1](https://github.com/SGLMS/gtin-gs1) | MIT (LICENSE file) | small (<50, exact count not captured) | not surfaced | GS1/GTIN | PHP GTIN/GS1 create+validate+barcode gen | Don't bother — wrong language, no capability we lack |
| [tmattsson/gs1utils](https://github.com/tmattsson/gs1utils) | Apache-2.0 | 65 | not surfaced | GS1/GTIN | Java: GTIN/GLN/SSCC validation + element-string parsing, zero deps | Don't bother — wrong language; the *AI-element-string parsing* idea (GS1-128 application identifiers) is worth remembering if a future kiosk ever needs to read a GS1-128 case label, not now |
| [ericblade/barcode-validator](https://github.com/ericblade/barcode-validator) | MIT (LICENSE file) | 4 | not surfaced | GS1/GTIN | **Node.js**, ISBN10/13/UPC/GTIN validation | Library, small win — same runtime as ReadyDoc; still, `shared/gtin.js` already does more (the padding/normalization rule this doesn't attempt) — read its test suite for extra check-digit edge cases, don't replace anything |
| [openfoodfacts/openfoodfacts-python](https://github.com/openfoodfacts/openfoodfacts-python) | MIT | 465 | not surfaced (639 commits, active) | GS1/GTIN, FDA label | Python SDK for Open Food Facts' public product database (barcode → product data) | Library — could power a "does this GTIN already exist in the public OFF database" sanity check when allocating new barcodes (`docs` note: GS1 capacity section); Python, so it'd run as a side script or small service, not inline in the Node app |
| [rezahedi/NutriScan](https://github.com/rezahedi/NutriScan) | MIT | 15 | not surfaced | FDA label / NFP OCR | Next.js hobby app: barcode scan → OFF/USDA nutrition lookup | Don't bother — too small/unmaintained-looking to trust, but the "barcode → public nutrition DB" idea overlaps with the OFF Python SDK above; redundant, pick one if ever pursued |
| [openfoodfacts/off-nutrition-table-extractor](https://github.com/openfoodfacts/off-nutrition-table-extractor) | **AGPL-3.0** | 231 | **archived 26 May 2023 — read-only** | FDA label / NFP OCR | SSD table detection → CTPN text detection → OCR post-processing pipeline for nutrition panels | Steal pattern only — architecture reference for Artwork-Proofing's NFP-locate/crop step (a two-stage detect-then-OCR approach); dead repo, AGPL, never embed |
| [openfoodfacts/robotoff](https://github.com/openfoodfacts/robotoff) | **AGPL-3.0** | 114 | active (3,835 commits) | FDA label / NFP OCR | Modern successor: LayoutLMv3 token-classification model for nutrition-table extraction, trained on 3,500+ annotated images | Steal pattern only — the LayoutLMv3-as-token-classifier framing is the most current public approach to "find and read a nutrition panel," and is a reasonable model architecture to imitate if Artwork-Proofing ever wants a second-opinion detector alongside Claude Vision; AGPL forbids embedding as a dependency in closed code |
| [invoice-x/invoice2data](https://github.com/invoice-x/invoice2data) | MIT | 2,200 | active (778 commits) | QBO/AP automation | Mature Python CLI/library: extracts structured fields from PDF invoices via YAML templates | **Best single find of this scan.** Its template system is the pattern ReadyDoc already half-built by hand in `server/invoice-figures.js` (`TOTAL_LABELS`, most-specific-first, `NOT_TOTAL` exclusions) — see idea #1 below |
| [mcohen01/node-quickbooks](https://github.com/mcohen01/node-quickbooks) | ISC (package.json) | 367 | active (372 commits) | QBO/AP automation | Node.js QuickBooks Online API client | **Don't bother.** ReadyDoc already built `server/quickbooks.js` (read-only OAuth client with the correct paging/discovery logic) and then *deliberately hid the whole QBO integration* per D-075 — AP now flows through AP Drop, not QBO. This library would duplicate work already done and then intentionally retired. |
| [adolfousier/invoicepilot](https://github.com/adolfousier/invoicepilot) | MIT | small | active | QBO/AP automation | Rust TUI: finds invoices/statements in Gmail, saves to Drive | Don't bother — it's an inbox-search tool, not an extraction/matching engine; no overlap with AP Drop's actual gap |
| [Grashjs/cmms](https://github.com/Grashjs/cmms) ("Atlas CMMS") | **AGPL-3.0** + commercial dual-license | 776 | active (2,375 commits) | CMMS/PM/WO | Java/Spring + React Native: full CMMS, PM scheduling, mobile work orders | Steal pattern only — mature, real-world checklist-gated work-order UX and recurring-PM scheduling; AGPL + a paid tier for "advanced features" means the authors want you to buy in, not fork; don't bother forking |
| [Mes-Open/OpenMes](https://github.com/Mes-Open/OpenMes) | **AGPL-3.0** core + AFL-3.0 modules | 132 | active (1,692 commits) | CMMS/PM/WO, MRP/MES | Laravel/PHP, tablet-first shop-floor MES with ISA-95 framing | Steal pattern only — "tablet-first, deploy on an old office PC" positioning and its operator-guidance/issue-tracking screens are close in spirit to Operator View; AGPL core |
| [baseeam/baseeam-web-app](https://github.com/baseeam/baseeam-web-app) | unclear — LICENSE.md present, contents not confirmed | 24 | not surfaced | CMMS/PM/WO | EAM/CMMS with offline work-order mobile execution | Unclear — don't bother until the license is actually read; smaller and less proven than Atlas/OpenMES anyway |
| [factorysemantics/factorysemantics-mes](https://github.com/factorysemantics/factorysemantics-mes) | Apache-2.0 | 1 | active but pre-alpha (63 commits, v0.2.0) | MRP/BOM/MES | Python, OPC UA ingestion + ERPNext connector + "MCP agent surface" for shop-floor equipment | The one genuinely permissive MES-adjacent hit — but 1 star and pre-alpha. Watch, don't build on it yet. Worth a bookmark for the "agent reads a PLC via OPC UA" idea, which is a different problem than ReadyDoc solves today |
| [senaite/senaite.core](https://github.com/senaite/senaite.core) | **GPL-2.0** | 385 | active (211 forks) | LIMS/COA/EMP | Plone-based, mature, real-world lab LIMS with sample chain-of-custody | Steal pattern only — the sample-to-result-to-COA workflow shape is close to what `coa.js` + `coa-submission.js` already do by hand; GPL-2.0 forbids embedding, and Plone/Zope is a completely different stack anyway |
| [ryancinsight/OxiQMS](https://github.com/ryancinsight/OxiQMS) | MIT | 1 | active, early-stage | QMS/CAPA/Part 11 | Rust QMS for medical devices (21 CFR 820/ISO 13485), audit logging done, e-sig/doc-control in progress | Genuinely permissive license, but too immature (1 star, core still being built) to evaluate as a component. Worth a re-check in 6–12 months, not now. |
| [C-realize/OpenQMS](https://github.com/C-realize/OpenQMS) | **AGPL-3.0** + commercial dual-license | 27 | active | QMS/CAPA/Part 11 | C#, cloud-native QMS aimed at life-science quality management | Don't bother — same dual-license-for-a-reason pattern as Atlas CMMS and OpenMES |
| [hnpanther/offline-first-pwa](https://github.com/hnpanther/offline-first-pwa) | unclear — not confirmed | small | not surfaced | Bilingual floor/kiosk | React + IndexedDB(Dexie) + Workbox precache PWA for industrial floor data collection (Persian RTL UI, not EN/ES) | **Don't bother.** ReadyDoc's own `src/lib/offline.js` (read cache + write outbox with a `NEVER_QUEUE` list for approvals/signatures) is already a more considered version of exactly this pattern, built against ReadyDoc's own compliance constraints. This reference confirms the shape is sound; it doesn't add anything. |
| [madebyaris/agent-orchestration](https://github.com/madebyaris/agent-orchestration) | MIT | 17 | active | Agent/tooling | TypeScript MCP server: shared memory, task queue, resource locks for multiple AI coding agents | Small, early — worth reading if the bot bench ever has two bots (e.g. AP Drop parser + ReadyBot) racing to write the same row; the "resource lock" primitive is the interesting piece, not the whole server |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | (mixed, mostly MIT per-server; official Anthropic/Linux-Foundation org) | large, well-known | active | Agent/tooling | Official MCP reference server implementations | Explicitly labelled by its own maintainers as reference/educational, not production — read for *shape* (how a QBO-flavored or Slack-flavored MCP server should be structured) if a bot-bench MCP server is ever built in-house |

**Themes searched with no usable candidate found (reported honestly, not padded):**

- **Packaging / artwork prepress QA / dieline checking** — no open-source GitHub project exists in this space.
  Every hit was a commercial SaaS (ArtworkFlow, Dalim, Gard, DNPackaging). This confirms Artwork-Proofing is
  building in a space with essentially no permissive prior art to borrow from — its own Tesseract+Claude Vision
  approach is the reasonable path, not a gap.
- **Dietary-supplement-specific / SQF / HACCP software** — no GitHub hits at all, only commercial platforms
  (GoAudits, FoodReady, Allera, QT9). This matches the plant's own honest read in CLAUDE.md that this category is
  effectively unbuilt in open source. Confirms: keep building ReadyDoc's QMS spine.
- **A genuinely permissive (MIT/Apache/BSD), mature QMS, CMMS, or LIMS** — none found. Every real, actively-used
  project in these three themes is AGPL or GPL, several with an explicit paid tier. See the license risk list.

---

## By product lane

### ReadyDoc (Powder-Ops-FSQA)
**Reuse:** almost nothing needs to change. The one real candidate is `ericblade/barcode-validator` (Node,
MIT) purely as a second source of GTIN/UPC/ISBN check-digit test vectors to throw at `shared/gtin.js`'s test
suite (`npm run check:gtin`) — not as a dependency, since `gtin.js` already solves the UPC-A-padded-as-GTIN-14
problem (D-090) that generic validators don't advertise handling.
**Ignore:** every CMMS/QMS/MES candidate found. ReadyDoc's PM/WO, QA Review, signature, and controlled-document
machinery is more specific to this plant's actual paper forms than any of these generic products, and adopting
one would mean re-deriving all of D-001 through D-096's hard-won specificity inside someone else's schema.
**Confirmed already-ahead-of-public-art:** `src/lib/offline.js`'s read-cache + write-outbox with `NEVER_QUEUE`
for signatures is more considered than the one comparable public reference found (`hnpanther/offline-first-pwa`).

### Artwork-Proofing
**Reuse:** none of the OCR/NFP pipelines found (Open Food Facts' two generations) are usable as dependencies —
both AGPL, one archived. **Steal the pattern**: the two-stage "detect the panel region, then OCR inside it"
architecture (the archived extractor) and the "frame nutrient extraction as token classification over OCR'd
text" idea (Robotoff's current approach) are both legitimate second opinions to weigh against the
Tesseract+Claude-Vision pipeline already in place — worth a design conversation, not a code change.
**Reuse (data cross-check):** `openfoodfacts/openfoodfacts-python` (MIT) could, as a side script, look up a
GTIN against the public Open Food Facts database as a sanity check before allocating a new barcode — genuinely
low-risk, low-effort, and outside the ReadyDoc/Artwork-Proofing spine entirely.

### Finance / AP bots (bot bench)
**Reuse:** `invoice-x/invoice2data` (MIT, mature, 2.2k★) is the standout find of this whole scan. Its label-
priority template matching is the same idea as `server/invoice-figures.js`'s `TOTAL_LABELS` array, done by a
much larger community over many more invoice layouts. See idea #1.
**Ignore:** `node-quickbooks` and every other QBO client library — ReadyDoc built one (`server/quickbooks.js`)
and then the plant deliberately hid the whole tab (D-075, 2026-09-11) because AP now flows through AP Drop.
Adopting a QBO library now would be re-opening a door that was closed on purpose.

### Cross-cutting libraries
GTIN/GS1 validation is a solved problem in several languages (Python, Java, PHP, Node) but none handle the
specific padding edge case ReadyDoc's own `shared/gtin.js` already does — this is a case where the codebase's
own work is ahead of the public libraries, not behind them. No action needed beyond optionally borrowing test
vectors.

---

## Top 5 actionable 90-day ideas (smallest wins, no rip-and-replace)

1. **Borrow invoice2data's template-priority pattern to widen `invoice-figures.js`'s label list.** Read
   `invoice-x/invoice2data`'s bundled YAML templates (hundreds of real-world vendor invoice layouts) for total/
   subtotal/tax label variants not yet in `TOTAL_LABELS`/`NOT_TOTAL`. This is reading their template corpus for
   *vocabulary*, not their code — no dependency, no license exposure, a few hours of work, and it directly
   strengthens AP Drop's own reader.
2. **Add `ericblade/barcode-validator`'s and `enorganic/gtin`'s test vectors to `check:gtin`.** Both are MIT and
   small enough to read end-to-end in an hour. Pull their check-digit edge cases into ReadyDoc's own pure test
   suite as additional assertions — strengthens the existing 35-assertion suite without adding a runtime
   dependency.
3. **One-time GTIN cross-check against Open Food Facts before allocating the next barcode.** A short one-off
   script using `openfoodfacts-python` (MIT) or its plain REST API to confirm a newly-allocated GTIN isn't
   already registered to someone else in the public database — a cheap sanity check for the GS1-capacity work
   already tracked in CLAUDE.md, run by hand, not wired into the app.
4. **Read (don't fork) Atlas CMMS's and OpenMES's mobile work-order screens for UX ideas**, specifically how
   they gate "complete" behind a checklist on a phone — compare against ReadyDoc's own `missingStepTicks()` gate
   to see if there's a rendering idea (progress ring, per-step photo prompt) worth copying in spirit. Zero code
   from either repo touches ReadyDoc; this is a half-day design-review exercise, not an integration.
5. **Bookmark `madebyaris/agent-orchestration`'s resource-lock concept for the bot bench, don't build it yet.**
   If a second automated writer (beyond ReadyBot) is ever added that could race on the same row — e.g., a future
   AP Drop auto-router running concurrently with a manual office action — the "resource lock" primitive from this
   17-star MCP server is the right shape to imitate. Not needed today; nothing currently races.

None of these five require replacing any part of ReadyDoc, Artwork-Proofing, or the bot bench, and none pull in
a new runtime dependency with license risk.

---

## License risk short list

Flagged so nobody mistakes "found on GitHub" for "safe to embed in a closed, hosted SaaS":

| Repo | License | Why it's flagged |
|---|---|---|
| `openfoodfacts/off-nutrition-table-extractor` | AGPL-3.0 | Network-use copyleft; also archived/dead — don't even steal-and-modify, the upstream is frozen |
| `openfoodfacts/robotoff` | AGPL-3.0 | Network-use copyleft — embedding or calling its API as a dependency in a hosted product would trigger source-disclosure obligations |
| `senaite/senaite.core` | GPL-2.0 | Copyleft; also Plone/Zope, a stack with nothing in common with ReadyDoc's Node/React |
| `Grashjs/cmms` (Atlas CMMS) | AGPL-3.0 + paid tier | Explicitly dual-licensed — the authors' business model depends on you either open-sourcing your fork or paying them |
| `Mes-Open/OpenMes` | AGPL-3.0 core | Same shape as Atlas CMMS |
| `C-realize/OpenQMS` | AGPL-3.0 + paid tier | Same shape again — this pattern (AGPL core, paid "commercial" tier) is the norm for every real QMS/CMMS product found in this scan, not the exception |
| `baseeam/baseeam-web-app` | Unclear | A `LICENSE.md` exists but its contents weren't confirmed by the tools available this session — treat as "no license" (all rights reserved) until someone actually opens the file |
| `hnpanther/offline-first-pwa` | Unclear | Not confirmed; also lower priority since ReadyDoc's own offline handling is already more considered |

**Pattern worth naming directly to Lowry:** every mature, real-world, actively-used QMS/CMMS/LIMS/MES project
found in this entire scan is AGPL or GPL with a commercial upsell. This is not a coincidence specific to this
search — it's close to the whole shape of that software category on GitHub today. There is no permissively-
licensed, production-grade alternative to keep building ReadyDoc against; that space simply favors keep-building
over reuse.

---

## Re-check note

- **Date of scan:** 16 September 2026.
- **How verified:** `gh` CLI unavailable in this session; the session's GitHub MCP access is scoped to
  `lowryakers/Powder-Ops-FSQA` only and its `api.github.com` path is blocked outside repo-scoped endpoints (a
  direct request to `api.github.com/search/repositories` and to `api.github.com/repos/torvalds/linux` both
  returned 403 with a message that sessions are bound to their configured repositories) — confirmed by testing
  before relying on any workaround. Candidates were instead found with general web search and verified by
  fetching each repo's public GitHub page (About-sidebar license badge, star count, language) and, where useful,
  the raw `LICENSE`/`package.json` file directly from `raw.githubusercontent.com` (which is not access-gated).
  No star count, license, or commit count in this report was invented; where a tool could not surface a precise
  figure (most "last commit" timestamps), that is stated as "not surfaced" rather than estimated.
- **Re-run this scan** in 90–180 days, or sooner if Artwork-Proofing's NFP-OCR accuracy becomes a live problem
  (worth re-checking Robotoff's model progress specifically) or if the bot bench grows a second concurrent
  writer (worth re-checking `agent-orchestration` and its peers for maturity).
