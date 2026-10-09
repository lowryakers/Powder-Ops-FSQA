# ReadyDoc bot API

This is how a bot reads ReadyDoc and files drafts without a browser. Decision **D-162**.

**There is no separate `/api/v1`.** The bots call the same routes the screens call. A copy of those routes would drift away from the screens within a month. This page lists those routes and what a token can do on them.

Two places must agree:

- `BOT_ROUTES` in `server/bot-api.js` is the contract.
- This page documents the routes in that list.

`npm run check:botapi` fails if a route is listed but not documented here, or documented here but not listed. It also fails if a listed route does not exist in the server source.

## Getting a token

An admin mints one in **Settings → API tokens** (D-161).

- **Account.** Every token belongs to one named, **non-admin** account. The bot acts as that account, so the account's `module_access` decides what the bot can read. A token never widens that account's access.
- **Scopes.** `read` is always on. `write-drafts` is optional. There is no approve scope and no admin scope.
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
| Product Manager bot | | | `products` (view, or edit to file NFP drafts), `artwork` (view) | read (+ write-drafts) | | |
| Procurement / supply bot | | | `procurement` (view) | read | | |
| AP / finance bot | | | `ap-drop` (view, or edit to read the whole queue), `partner-reconciliation` (view) | read | | |
| Comms / notifier bot | | | none (channel membership) | read + write-drafts | | |
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
| **403** | `token_scope` | The token lacks the scope for this act. Either it is a `read` token trying to write, or it is a write the `write-drafts` allow-list does not include. Also returned for `@channel` / `@here` / `@everyone` in a token's message and for creating a channel. The `message` field says which. |
| **403** | `approve_requires_human_session` | The route approves, signs, decides or releases. A token can never do it, whatever its scope, and the attempt is audited as `api_token_approve_blocked`. A person has to do it signed in. Filing an NFP as `source: "paper"` also counts, because a paper panel is filed as already approved. |
| **403** | other text | The account lacks the module grant (e.g. "No modules have been assigned…") or the route's own role rule. This is fixed in Settings → Users, not on the token. |
| **404** | `Not found` | Three cases. The record does not exist. Or it is a channel the bot's account is not a member of: membership is never confirmed to a non-member. Or it is an **external** account (`users.is_external`) reaching outside Messages: that is answered 404, never 403, so a client cannot learn which modules the plant runs. |
| **429** | `rate_limited` | Too many calls. The limit is per token, over a sliding minute, with reads and writes counted separately. The defaults are 120 reads and 20 writes a minute (`API_TOKEN_RPM` / `API_TOKEN_WRITE_RPM`). Wait the number of seconds in the `Retry-After` header, then retry. |

## What `write-drafts` may write

The `write-drafts` scope allows only the writes below. Everything else is refused.

- `POST /api/nfp`: files a **draft** panel.
- `PUT /api/nfp/:id` and `PUT /api/nfp/:id/panel`: only while the panel is still a draft.
- `POST /api/comms/channels/:id/messages`: posts a message.

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

- **Scope:** `write-drafts`.
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

- **Scope:** `write-drafts`.
- **Grant:** membership of the channel.
- **Body:** `{ body, parent_id? }`. Set `parent_id` to reply in a thread.
- **Returns:** **201** with the message.
- **Attribution.** The message is the bot account's: `user_id` and `user_name` are that account, never a person's. The audit entry carries the token prefix.
- **Membership.** A channel the account is not in is **404**. An admin-post channel refuses a non-admin account.
- **No broadcasts.** `@channel`, `@here` and `@everyone` are refused for a token with **403 `token_scope`**. A bot may @mention a person by name.
- **No new channels.** `POST /api/comms/channels` is not on the allow-list.

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
