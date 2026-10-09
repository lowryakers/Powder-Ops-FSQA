# readydoc-mcp

An MCP server that lets a bot use ReadyDoc without a browser. It runs on the bot's own machine over **stdio** and calls ReadyDoc's REST surface over HTTPS with a bot token (`docs/bot-api.md`). Nothing runs inside ReadyDoc, and nothing on Railway changes.

The server **never approves, deletes or administers anything.** It has no approve, decide, sign, verify, release, settle, send, delete, void, archive, revoke, admin or token tool, and ReadyDoc refuses those acts to any token anyway.

## Install

From a checkout of this repository:

```sh
cd packages/readydoc-mcp
npm ci
```

Requires Node 18 or later. The only dependency is `@modelcontextprotocol/sdk`.

## Configure

The server needs two environment variables. It exits straight away with a message if either is missing.

| Variable | What it is |
|---|---|
| `READYDOC_URL` | The app's address, e.g. `https://app.powder-ops.com` (a bare hostname gets `https://`). |
| `READYDOC_TOKEN` | A bot token starting with `rdk_`. An admin mints one in ReadyDoc under **Settings → Bot API tokens**, for the bot's own non-admin account. |

The token can do exactly what its account can do, minus every approval:

- **`read` scope:** reads only.
- **`write` scope:** can also create and edit what the account is allowed to: product records, artwork files, supply orders, AP Drop uploads and notes, partner reconciliation documents (while draft), draft nutrition panels and messages. Never more than the account itself can do.

Keep the token in the bot's secret store, never in a file that gets committed.

## Client config

Add this block to your MCP client's config, with the path to your checkout:

```json
{
  "mcpServers": {
    "readydoc": {
      "command": "node",
      "args": ["/path/to/Powder-Ops-FSQA/packages/readydoc-mcp/bin.mjs"],
      "env": {
        "READYDOC_URL": "https://app.powder-ops.com",
        "READYDOC_TOKEN": "rdk_…"
      }
    }
  }
}
```

## Tools

There is one tool per route in `docs/bot-api.md`:

| Area | Tools |
|---|---|
| Self-check | `whoami` |
| Products | `list_products`, `get_product`, `update_product` (write) |
| Nutrition panels | `list_nfp`, `get_nfp`, `create_nfp_draft` (write; always a draft) |
| Artwork | `list_artwork`, `get_artwork_for_sku`, `get_artwork_version`, `attach_artwork_file` (write) |
| Procurement | `list_supply_orders`, `procurement_summary`, `list_procurement_demand`, `create_supply_order`, `update_supply_order` (write) |
| Messages | `list_channels`, `read_channel_messages`, `read_thread`, `post_channel_message` (write) |
| AP Drop | `list_ap_drops`, `upload_ap_drop`, `add_ap_drop_note` (write) |
| Partner reconciliation | `list_partners`, `get_partner_reconciliation`, `list_partner_credits`, `add_partner_document`, `update_partner_document` (write) |

Responses come back as JSON text. A paged list also returns `page: { total, limit, offset }`, where the limit is at most 200.

Every writing tool sends only the fields it declares. A model cannot add `status`, `source` or an approver to a draft by inventing an argument.

`attach_artwork_file`, `upload_ap_drop` and `add_partner_document` take a `file_path`: a file on the machine this server runs on. It is read there and uploaded as the request's file.

## Errors

When ReadyDoc refuses a request, the tool returns an error that says what to do next:

| ReadyDoc returns | The tool says |
|---|---|
| 401 | The token is revoked or expired, or its account changed. Mint a new one. |
| 403 `approve_requires_human_session` | This needs a human in ReadyDoc. |
| 403 `token_scope` | The token is read-only. |
| 403 `token_denied` | This needs a person in ReadyDoc, with the category (`delete`, `decision`, `user_admin`, `token_admin`, `not_open_to_tokens`). |
| 403, other | The bot's account lacks the module. It is set in Settings → Users. |
| 404 | Not found, or the account cannot see it. |
| 429 | Rate limited. Retry after *N* seconds. |

## Test

```sh
npm test               # unit tests against a mocked fetch
npm run check:botmcp   # from the repo root: route parity, stdio, smoke test
```
