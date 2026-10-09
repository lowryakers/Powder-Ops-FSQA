# ReadyDoc bot API

This is how a bot reads and writes ReadyDoc without a browser. Decisions **D-162** (the surface) and **D-164** (the `write` scope).

**There is no separate `/api/v1`.** The bots call the same routes the screens call. A copy of those routes would drift away from the screens within a month. This page lists those routes and what a token can do on them.

Two places must agree:

- `BOT_ROUTES` in `server/bot-api.js` is the contract.
- This page documents the routes in that list.

`npm run check:botapi` fails if a route is listed but not documented here, or documented here but not listed. It also fails if a listed route does not exist in the server source.

## Getting a token

An admin mints one in **Settings → API tokens** (D-161).

- **Account.** Every token belongs to one named, **non-admin** account. The bot acts as that account, so the account's `module_access` decides what the bot can read. A token never widens that account's access.
- **Scopes.** `read` is always on. `write` is optional (it replaced `write-drafts`, which is still accepted when minting and is read as `write`). There is no approve, delete or admin scope, and some acts are never open to a token at all — see **Never via token**.
- **Storage.** The token is shown once and stored only as a hash. If it is lost, mint a new one.
- **Audit.** Every call the bot makes is written to the audit log as `api_token_call`, under the account's name, with the token's prefix.

Send the token as a bearer header:

```
Authorization: Bearer rdk_…
```

Check your setup with `GET /api/bot/whoami` before you do anything else.

## Bots and the ReadyDoc accounts they act as

**Lowry: please fill in this table.** Create each bot account in Settings → Users as a non-admin user, give it only the modules in the "needs" column, then mint its token.

| Bot | ReadyDoc account (name) | Role / department | Needs `module_access` | Scopes | Token label | Owner |
|---|---|---|---|---|---|---|
| Product Manager bot | | | `products` (view, or edit to edit products and file NFP drafts), `artwork` (view, or edit to attach files) | read (+ write) | | |
| Procurement / supply bot | | | `procurement` (view, or edit to create and edit POs) | read (+ write) | | |
| AP / finance bot | | | `ap-drop` (view, or edit to read the whole queue), `partner-reconciliation` (view, or edit to add documents) | read (+ write) | | |
| Comms / notifier bot | | | none (channel membership) | read + write | | |
| | | | | | | |

## What each route needs (`module_access`)

The token's account must hold these grants. Without one, the route answers **403**. A NULL map means an empty account: it can reach Messages and nothing else.

| Route family | Mount guard | Grant on the bot's account |
|---|---|---|
| `/api/products/*`, `/api/nfp/*` | `requireModuleWrite('products')` | `products: view` to read. Filing an NFP draft needs `products: edit`, **and** the account must be a supervisor or in QA (`canManage` in `nfp.js`). |
| `/api/artwork/*` | `requireModuleWrite('artwork')` | `artwork: view` |
| `/api/procurement/*` | its own per-route checks | `procurement: view` |
| `/api/partners/*` | `requireModuleWrite('partner-reconciliation')` | `partner-reconciliation: view` |
| `/api/ap-drop` | none at the mount | Any account with modules set up can read **its own** drops. Seeing the whole queue needs `ap-drop: edit`, or a supervisor in office/admin (`canWorkQueue`). |
| `/api/comms/*` | channel membership | No module grant. The bot reads and posts only in channels its account is a member of. Add the account to a channel in Messages to let the bot in. |
| `/api/bot/whoami` | none | None. Any token or session can call it. |

## What a token is never sent

Every JSON response to a token caller goes through `stripForbidden()`. That filter is applied once, inside `authenticateToken`, so a handler added later cannot leak anything either.

These keys are removed at any depth:

- **Passwords and setup codes:** `password_hash`, `password`, `pin`, `pin_hash`, `setup_code`, `setup_code_expires_at`
- **Credentials:** `token`, `token_hash`, `refresh_token`, `access_token`, `client_secret`, `secret`, `session`
- **Stored files and their contents:** `signature_image`, `extracted_text`, `storage_key`, `body_base64`, `file_data`, `data_url`
- **Personal identifiers:** `ssn`, `dd_account`, `dd_routing`
- **By suffix:** any key ending in `_hash`, `_secret`, `_encrypted`, `_enc` or `_cipher`

A bot never receives a file's bytes or storage key. To get a file, it asks the route's own file endpoint for a short-lived URL, the same way a screen does.

A signed-in person still gets the full shape the screen uses. Only token callers are filtered.

## Pagination

List routes marked **paged** below are always paged for a token caller.

- **Query:** `limit` (default **200**, maximum 200; anything higher is capped) and `offset` (default 0).
- **Headers on every paged response:**
  - `X-Total-Count`: the whole list
  - `X-Limit`: the page size actually used
  - `X-Offset`: where this page starts
- **Body:** keeps the same shape the screen gets. Where the route returns an object, the paged array is the one named in its entry below.
- **Sessions:** a signed-in session is paged only if it passes `limit` or `offset`. The screens are unchanged.

```
GET /api/products?limit=50&offset=100
X-Total-Count: 118
X-Limit: 50
X-Offset: 100
```

## Errors

| Status | `error` | Meaning |
|---|---|---|
| **401** | `Authentication required` | Any of: no token, a malformed token, an unknown token, a revoked or expired token, or a token whose account was deactivated or has since become an admin. Mint a new token. Do not retry. |
| **403** | `token_scope` | A `read` token tried to write ("This token is read-only."). Also returned for `@channel` / `@here` / `@everyone` in a token's message. The `message` field says which. |
| **403** | `token_denied` | The act is person-only, or not open to tokens. `category` says which: `delete`, `decision`, `user_admin`, `token_admin`, or `not_open_to_tokens` (a write that is not on the list below). Audited as `api_token_write_blocked`. A person has to do it signed in. |
| **403** | `approve_requires_human_session` | The route approves, signs, decides or releases. A token can never do it, whatever its scope, and the attempt is audited as `api_token_approve_blocked`. A person has to do it signed in. Filing an NFP as `source: "paper"` also counts, because a paper panel is filed as already approved. |
| **403** | other text | The account lacks the module grant (e.g. "No modules have been assigned…") or the route's own role rule. This is fixed in Settings → Users, not on the token. |
| **404** | `Not found` | Three cases. The record does not exist. Or it is a channel the bot's account is not a member of: membership is never confirmed to a non-member. Or it is an **external** account (`users.is_external`) reaching outside Messages: that is answered 404, never 403, so a client cannot learn which modules the plant runs. |
| **429** | `rate_limited` | Too many calls. The limit is per token, over a sliding minute, with reads, writes and bulk writes counted separately. The defaults are 120 reads, 20 writes and 5 bulk writes a minute (`API_TOKEN_RPM` / `API_TOKEN_WRITE_RPM` / `API_TOKEN_BULK_RPM`). A bulk write is one call that changes many rows: products bulk-edit and import commit, PO bulk update, applying a procurement scenario, partner document import. Wait the number of seconds in the `Retry-After` header, then retry. |

## What `write` may write

A `write` token may write **only** to the routes below (`WRITE_AREAS` in `server/bot-api.js`). Every other write is refused with `token_denied` / `not_open_to_tokens`. Being on this list only opens the door: the token acts as its account, so the account's module grant and the route's own role rule still decide. A token never does more than its account can.

| Area | Routes |
|---|---|
| Products | `POST /api/products`, `PUT /api/products/:sku`, `PUT /api/products/:sku/colors`, `POST /api/products/:sku/na`, `POST /api/products/:sku/barcode`, `POST /api/products/:sku/packaging-po`, `POST` and `PUT /api/products/specs[/:specId]`, `POST /api/products/bottle-drafts`, `POST` and `PUT /api/products/shelf/:slot`, `POST /api/products/import/preview`; bulk: `POST /api/products/bulk-edit`, `POST /api/products/import/commit` |
| Artwork | `POST /api/artwork`, `POST /api/artwork/versions/:id/files`, `POST /api/artwork/versions/:id/checks`, `POST /api/artwork/versions/:id/status` to `draft` or `in_review` only |
| Supply orders | `POST /api/procurement/pos`, `PUT /api/procurement/pos/:id`, `PUT /api/procurement/demand/:id`, `PUT /api/procurement/parts/:id`, `POST /api/procurement/scenarios`; bulk: `PUT /api/procurement/pos/bulk`, `POST /api/procurement/scenarios/:id/apply` |
| AP Drop | `POST /api/ap-drop` (upload), `PUT /api/ap-drop/:id`, `POST /api/ap-drop/:id/notes`, `POST /api/ap-drop/:id/reparse`, `POST /api/ap-drop/:id/route-partner` (files a draft on the ledger), `POST /api/ap-drop/:id/status` to `new`, `triaged`, `matched`, `needs_info` or `duplicate_suspect` only |
| Partner reconciliation | `POST /api/partners/:id/documents`, `…/documents/scan`, `POST /api/partners/:id/credits`, `PUT /api/partners/:id` (office/admin accounts only); while the document is a **draft**: `PUT /api/partners/documents/:docId`, `…/category`, `…/file`, `…/read-lines`; bulk: `POST /api/partners/:id/documents/import` |
| Nutrition panels | `POST /api/nfp` (always lands as a draft); while the panel is a **draft**: `PUT /api/nfp/:id`, `PUT /api/nfp/:id/panel` |
| Messages | `POST /api/comms/channels/:id/messages` |

## Never via token

These are refused to every token, whatever its scope and whatever its account's role. The guard runs before the route, so nothing is read or changed. The lists live in one file, `server/middleware/no-token-approve.js`.

| Category | What | Error |
|---|---|---|
| Approve | approving, deciding, signing, verifying, releasing, finalizing, settling; sending a panel or a batch for approval; filing a paper (already approved) panel; artwork to approved / print-ready | `approve_requires_human_session` |
| `delete` | every `DELETE`, and any write whose path names deleting, voiding, archiving, purging, cancelling, withdrawing, deactivating, revoking, retiring or disputing | `token_denied` |
| `decision` | rejecting, dismissing, resolving, reopening, closing, reinstating, restoring, waiving; confirming a product readiness step; moving an AP Drop to paid / closed / in QuickBooks / in a payment run / not finance / receivable-other; artwork to rejected or superseded | `token_denied` |
| `user_admin` | every write under `/api/users` (accounts, roles, module access, passwords, signatures), onboarding end-access, `/api/org` and `/api/comms/admin` writes | `token_denied` |
| `token_admin` | `/api/api-tokens` and `/api/kiosk-tokens` (reads included), auditor passes, partner portal links | `token_denied` |

## Using it from an MCP client

`packages/readydoc-mcp` is a stdio MCP server with one tool per route on this page. It never approves anything (D-163). Install, configure and connect it as described in its [README](../packages/readydoc-mcp/README.md):

- Set `READYDOC_URL` and `READYDOC_TOKEN`.
- Point the client at `node packages/readydoc-mcp/bin.mjs`.

## After a deploy

Run this checklist once after a release that touches the bot surface, and once after first setup. It takes about five minutes.

1. **Create one non-admin account per bot** in Settings → Users, with only the modules in the table above.
2. **Mint one token per bot** in Settings → Bot API tokens.
   - Use `read`, plus `write` only for the bots that create or edit records or post messages.
   - Put each token in that bot's secret store.
3. **Run the smoke test** against the live app:

   ```sh
   READYDOC_URL=https://app.powder-ops.com \
   READYDOC_ADMIN_TOKEN=<your own admin session token> \
   SMOKE_BOT_USER="<a bot account's name or id>" \
   node scripts/smoke-bot-api.mjs
   ```

   It runs these steps and prints a PASS/FAIL table:
   - mints a temporary **read + write** token for that account;
   - checks `GET /api/bot/whoami` and `GET /api/products` answer **200**;
   - tries `POST /api/nfp/:id/decide` and an artwork approve, and expects **403 `approve_requires_human_session`**;
   - tries `DELETE /api/procurement/pos/:id` and `GET /api/api-tokens`, and expects **403 `token_denied`** (`delete`, `token_admin`);
   - revokes the token and checks it is refused with **401**.

   The token is always revoked, even when a step fails. The script writes no record at all, so it is safe on production. The approve and delete attempts name ids that do not exist, because the guard refuses on the path before any record is looked up.
4. **If `GET /api/products` fails**, the smoke account lacks the `products` module. Grant it, then run the test again.
5. **Check each bot from its own client:** its `whoami` tool should name the right account and scopes.

---

## Self-check

### `GET /api/bot/whoami`

- **Scope:** `read`.
- **Grant:** none.
- **Query:** none.
- **What it tells you:** who the token acts as, what it may do, when it expires, how fast it may call, and the routes on this page.
- **For a session:** `auth: "session"`, and the token fields are null.

```json
{
  "auth": "token",
  "user": { "id": "…", "name": "Catalog Bot", "role": "supervisor", "department": "qa",
            "module_access": { "products": "edit", "artwork": "view" } },
  "scopes": ["read"],
  "tokenPrefix": "rdk_cnZ4",
  "label": "Catalog reader",
  "expires_at": null,
  "rate_limits": { "read": 120, "write": 20 },
  "page_max": 200,
  "routes": ["GET /api/bot/whoami", "GET /api/products", "…"]
}
```

## Products

### `GET /api/products`

- **Scope:** `read`.
- **Grant:** `products`.
- **Query:** `limit`, `offset`.
- **Paged:** yes; the paged array is `products`.
- **Returns:** the catalog. `specs` and `readinessSteps` are reference lists and are not paged.

```json
{
  "products": [
    { "sku": "42224277651538", "legacy_sku": null, "gtin": "850079939066", "gtin_valid": 1,
      "category": "Beef Protein", "pack": "PLG", "flavor": "Cinnamon Sugar Beef Protein Pouch",
      "base_flavor": "Cinnamon Sugar", "readiness": { "…": "…" }, "stage": { "…": "…" } }
  ],
  "specs": [ { "spec_id": "SPEC-BOTTLE", "name": "Protein Bottle", "format": "Bottle" } ],
  "readinessSteps": [ { "key": "sku", "label": "SKU assigned" } ]
}
```

### `GET /api/products/:sku`

- **Scope:** `read`.
- **Grant:** `products`.
- **Returns:** one product with its readiness, stage, colors and packaging spec. The SKU may be the current code or a `legacy_sku`.
- **404:** an unknown SKU.

```json
{ "sku": "42224277651538", "gtin": "850079939066", "category": "Beef Protein", "pack": "PLG",
  "flavor": "Cinnamon Sugar Beef Protein Pouch", "colors": [ "…" ], "readiness": { "…": "…" } }
```

### `PUT /api/products/:sku`

- **Scope:** `write`.
- **Grant:** `products: edit`, and the account must be a supervisor or in QA (`canManage`).
- **Body:** only the fields you are changing. An absent field is left alone; a blank one clears it. The same rules as the screen and the CSV import apply (`buildPatch`): a malformed value is refused with **400** naming the expected format.
- **Refused fields:** `nfp_version` / `nfp_approved_at` (`NFP_OWNED`) and `artwork_status` / `artwork_version` (`ARTWORK_OWNED`) answer **400** — those move only through their own approval flows. Renaming a SKU is a separate act and not open to tokens.
- **Returns:** **200** with the product.

## Nutrition panels (NFP)

### `GET /api/nfp`

- **Scope:** `read`.
- **Grant:** `products`.
- **Query:** `limit`, `offset`.
- **Paged:** yes; the paged array is `versions`.
- **Returns:** every panel version. `missing` lists products with no panel and is not paged.

```json
{
  "versions": [ { "id": "4dd0…", "sku": "42224277651538", "version": "V1", "status": "draft",
                  "source": "upload", "serving_size": null, "formula_rev": null, "drive_url": null } ],
  "missing": [ { "sku": "HBF-CHU", "flavor": "Cinnamon Sugar Beef Protein Stick", "pack": "STK" } ],
  "storage": false
}
```

### `GET /api/nfp/sku/:sku`

- **Scope:** `read`.
- **Grant:** `products`.
- **Returns:** one product's panel history, newest first.
- **Files:** a panel's file is listed by name. Its bytes come from `GET /api/nfp/files/:id` as a short-lived URL, never inline.

```json
{ "versions": [ { "id": "4dd0…", "sku": "42224277651538", "version": "V1", "status": "draft" } ], "storage": false }
```

### `POST /api/nfp`

- **Scope:** `write`.
- **Grant:** `products: edit`, and the account must be a supervisor or in QA.
- **Body:** `{ sku, version, serving_size?, servings_per_container?, drive_url?, change_summary?, provenance? }`
- **Returns:** **201** with the new panel.
- **Always a draft.** A token always files a **draft**, whatever `status` the body sends. Approval happens on the panel's signed link or in the app, by a person.
- **Paper panels.** `source: "paper"` from a token is refused with `approve_requires_human_session`.
- **Other errors:**
  - 400: the SKU is not in the catalog, or the version is missing.
  - 409: that SKU already has this version. Panels are never rewritten.

```json
{ "id": "4dd0…", "sku": "42224277651538", "version": "BOTAPI-V1", "status": "draft", "approved_at": null }
```

## Artwork

### `GET /api/artwork`

- **Scope:** `read`.
- **Grant:** `artwork`.
- **Query:** `limit`, `offset`, `status`.
- **Paged:** yes; the paged array is `packs`, the current version of each pack. `missing` is not paged.

```json
{
  "packs": [ { "id": "b4d2…", "sku": "42224277651538", "component": "pouch", "version": 1,
               "status": "draft", "source": "upload", "nfp_version": null } ],
  "missing": [ { "sku": "HBF-CHU", "pack": "STK" } ],
  "storage": false
}
```

### `GET /api/artwork/sku/:sku`

- **Scope:** `read`.
- **Grant:** `artwork`.
- **Returns:** the product and every artwork version for it, with its checks.

```json
{ "product": { "sku": "42224277651538", "gtin": "850079939066" },
  "versions": [ { "id": "b4d2…", "component": "pouch", "version": 1, "status": "draft" } ] }
```

### `GET /api/artwork/versions/:id`

- **Scope:** `read`.
- **Grant:** `artwork`.
- **Returns:** one artwork version with its proofing checks, its files and the label snapshot the proofer saw. File bytes come from `GET /api/artwork/files/:id` as a short-lived URL.

```json
{ "id": "b4d2…", "sku": "42224277651538", "component": "pouch", "version": 1, "status": "draft",
  "flavor": "…", "gtin": "850079939066", "checks": [ "…" ], "files": [ "…" ], "snapshot": null }
```

### `POST /api/artwork/versions/:id/files`

- **Scope:** `write`.
- **Grant:** `artwork: edit`, and the account must be a supervisor or in QA.
- **Body:** `multipart/form-data` with up to 10 `files` and an optional `kind` (`print_pdf` by default, `preview`, `dieline`, `proof_report`, `other`).
- **Returns:** **201** with the files filed.
- **Errors:** 400 with no file; 404 for an unknown version; 503 when file storage is not configured.

## Procurement

### `GET /api/procurement/pos`

- **Scope:** `read`.
- **Grant:** `procurement`.
- **Query:** `limit`, `offset`, `status`, `quarter`, `q`, `vendor`.
- **Paged:** yes; the body is the array.

```json
[ { "id": "…", "po_number": "PO-1042", "vendor": "…", "status": "open", "quarter": "2026-Q4", "total": 1820.5 } ]
```

### `GET /api/procurement/summary`

- **Scope:** `read`.
- **Grant:** `procurement`.
- **Query:** `quarter`.
- **Returns:** open purchase-order totals.

```json
{ "open_count": 0, "urgent_delayed_count": 0, "scheduled_spend": 0, "delayed_count": 0, "urgent_count": 0, "quarters": [] }
```

### `GET /api/procurement/demand`

- **Scope:** `read`.
- **Grant:** `procurement`.
- **Query:** `limit`, `offset`, `scenario`.
- **Paged:** yes; the body is the array.

```json
[ { "id": "c409…", "product_number": "FG0975",
    "product_name": "FINISHED GOOD- ProDough Daily Recharge 20ct Pouch (Tropical)",
    "requested_qty": 537, "quarter": null, "updated_at": "2026-10-09 22:05:42" } ]
```

### `POST /api/procurement/pos`

- **Scope:** `write`.
- **Grant:** `procurement: edit`.
- **Body:** `{ vendor, po_number?, part_no?, description?, qty?, uom?, unit_price?, order_date?, expected_date?, status?, urgent?, notes?, quarter?, … }`. `vendor` is required; an unknown `status` files as `open`.
- **Returns:** **201** with the purchase order.

### `PUT /api/procurement/pos/:id`

- **Scope:** `write`.
- **Grant:** `procurement: edit`.
- **Body:** only the fields you are changing. An unknown status is refused by name.
- **Returns:** **200** with the purchase order. Deleting one is never open to a token.

## Messages

### `GET /api/comms/channels`

- **Scope:** `read`.
- **Grant:** none.
- **Query:** `limit`, `offset`.
- **Paged:** yes; the body is the array.
- **Returns:** the channels the account can see, with unread counts. `is_member` says whether the bot can read and post there.

```json
[ { "id": "eb09…", "kind": "public", "name": "general", "topic": "Company-wide general chat",
    "is_member": true, "unread": 0, "mentions": 0, "post_policy": "all", "is_default": true } ]
```

### `GET /api/comms/channels/:id/messages`

- **Scope:** `read`.
- **Grant:** channel membership.
- **Query:** `limit` (default 50, maximum 200), `before` (a `created_at` cursor for older messages), `date` (`YYYY-MM-DD`).
- **Pagination:** this route has its own cursor and sets no `X-Total-Count`.
- **Returns:** messages oldest first.
- **404:** a channel the account is not a member of.

```json
[ { "id": "5354…", "channel_id": "eb09…", "user_id": "…", "user_name": "Catalog Bot",
    "body": "Proof run finished for the pouch.", "parent_id": null, "edited": false,
    "deleted": false, "created_at": "2026-10-09 22:05:43.603", "attachments": [], "reactions": [] } ]
```

### `GET /api/comms/messages/:id/thread`

- **Scope:** `read`.
- **Grant:** membership of the message's channel.
- **Returns:** the parent message and its replies.

```json
{ "parent": { "id": "5354…", "user_name": "Catalog Bot", "body": "Proof run finished for the pouch." }, "replies": [] }
```

### `POST /api/comms/channels/:id/messages`

- **Scope:** `write`.
- **Grant:** membership of the channel.
- **Body:** `{ body, parent_id? }`. Set `parent_id` to reply in a thread.
- **Returns:** **201** with the message.
- **Attribution.** The message is the bot account's: `user_id` and `user_name` are that account, never a person's. The audit entry carries the token prefix.
- **Membership.** A channel the account is not in is **404**. An admin-post channel refuses a non-admin account.
- **No broadcasts.** `@channel`, `@here` and `@everyone` are refused for a token with **403 `token_scope`**. A bot may @mention a person by name.
- **No new channels.** `POST /api/comms/channels` is not on the write list (`token_denied`, `not_open_to_tokens`).

```json
{ "id": "5354…", "channel_id": "eb09…", "user_id": "…", "user_name": "Catalog Bot",
  "body": "Proof run finished for the pouch.", "created_at": "2026-10-09 22:05:43.603" }
```

## AP Drop

### `GET /api/ap-drop`

- **Scope:** `read`.
- **Grant:** see the table above.
- **Query:** `limit`, `offset`, `status` (`outstanding` by default, `all`, or one status), `vendor`, `submitter`, `from`, `to`, `overdue=1`, `needs_info=1`, `q` (searches vendor, invoice #, reference, notes, filename and the file's text).
- **Paged:** yes; the body is the array.
- **Returns:** the account's own drops. With `ap-drop: edit`, the whole queue.
- **Omitted for a token:** `storage_key` and `extracted_text`. `GET /api/ap-drop/:id` (not part of this surface) is where a person opens the file.

```json
[ { "id": "…", "created_at": "2026-10-09 22:05:43", "submitter": "Catalog Bot", "source": "drop",
    "filename": "fixture.pdf", "content_sha256": "…", "vendor_name": "Acme", "amount": 12.5,
    "status": "new", "parse_status": "…" } ]
```

### `POST /api/ap-drop`

- **Scope:** `write`.
- **Grant:** any account with modules set up (the intake is open to everyone signed in).
- **Body:** `multipart/form-data` with up to 10 `files` (PDF or photo) and optional typed fields: `vendor_name`, `po_or_co_ref`, `amount`, `due_date`, `notes`.
- **Returns:** **201** with the drops filed. The file is stored and hashed first and the reader runs after; a failed read still files the drop.
- **Errors:** 400 with nothing attached; 503 when file storage is not configured.

### `POST /api/ap-drop/:id/notes`

- **Scope:** `write`.
- **Grant:** the account must be able to see the drop (its own, or the queue).
- **Body:** `{ text }`.
- **Returns:** **201** `{ ok: true }`.

## Partner Reconciliation

### `GET /api/partners`

- **Scope:** `read`.
- **Grant:** `partner-reconciliation`.
- **Query:** `limit`, `offset`.
- **Paged:** yes; the body is the array.

```json
[ { "id": "ed38…", "name": "M4 Dynamics", "code": "M4", "contact_name": "Matt Schramm",
    "terms_days": 30, "is_active": 1 } ]
```

### `GET /api/partners/:id/reconcile`

- **Scope:** `read`.
- **Grant:** `partner-reconciliation`.
- **Query:** `as_of` (`YYYY-MM-DD`; defaults to the end of this month).
- **Returns:** the netted balance, which documents are in it, and what was left out and why. The arithmetic is `server/partner-recon.js` and the client never re-adds.

```json
{ "partner": { "id": "ed38…", "name": "M4 Dynamics" }, "as_of": "2026-10-31",
  "receivable_total": 0, "payable_total": 0, "net_amount": 0, "owed_to": "nobody", "amount_due": 0,
  "documents": { "receivable": [], "payable": [], "excluded": [] },
  "counts": { "receivable": 0, "payable": 0, "excluded": 0, "total": 0 }, "excluded_summary": [] }
```

### `GET /api/partners/:id/credits`

- **Scope:** `read`.
- **Grant:** `partner-reconciliation`.
- **Query:** `limit`, `offset`.
- **Paged:** yes; the body is the array.
- **Returns:** the partner's credit facilities and what each has absorbed.

```json
[ { "id": "…", "partner_id": "ed38…", "direction": "receivable", "applies_to": "manufacturing",
    "amount": 26877.49, "label": "…", "issued_date": "…", "applied_to_date": 26877.49, "remaining_balance": 0 } ]
```

### `POST /api/partners/:id/documents`

- **Scope:** `write`.
- **Grant:** `partner-reconciliation: edit` (the route's own rule).
- **Body:** JSON, or `multipart/form-data` with up to 10 `files`. Fields: `direction` (`receivable` by default, or `payable`), `doc_type` (`invoice`, `po`, `credit`), `doc_number`, `reference`, `description`, `issued_date`, `terms_days`, `due_date`, `amount`, `category`, `line_items`.
- **Returns:** **201** with the documents. Every one lands as a **draft**; approving it as final is a person's act.

### `PUT /api/partners/documents/:docId`

- **Scope:** `write`.
- **Grant:** `partner-reconciliation: edit`.
- **While draft only.** A token may edit a document only while it is a draft and not in a settlement; otherwise `token_denied` / `not_open_to_tokens`. Disputing, voiding, finalizing or deleting one is never open to a token.
- **Returns:** **200** with the document.
