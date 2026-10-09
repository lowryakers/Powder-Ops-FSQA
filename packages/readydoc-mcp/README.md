# readydoc-mcp

An MCP server that lets a bot use ReadyDoc without a browser. It runs on the bot's own machine over **stdio** and calls ReadyDoc's REST surface over HTTPS with a bot token (`docs/bot-api.md`). Nothing runs inside ReadyDoc, and nothing on Railway changes.

The server **never approves anything.** It has no approve, decide, send, release or sign tool, and ReadyDoc refuses those acts to any token anyway.

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
- **`write-drafts` scope:** can also file draft nutrition panels and post messages.

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
| Products | `list_products`, `get_product` |
| Nutrition panels | `list_nfp`, `get_nfp`, `create_nfp_draft` (write-drafts) |
| Artwork | `list_artwork`, `get_artwork_for_sku`, `get_artwork_version` |
| Procurement | `list_supply_orders`, `procurement_summary`, `list_procurement_demand` |
| Messages | `list_channels`, `read_channel_messages`, `read_thread`, `post_channel_message` (write-drafts) |
| AP Drop | `list_ap_drops` |
| Partner reconciliation | `list_partners`, `get_partner_reconciliation`, `list_partner_credits` |

Responses come back as JSON text. A paged list also returns `page: { total, limit, offset }`, where the limit is at most 200.

`create_nfp_draft` sends only the fields it declares. A model cannot add `status`, `source` or an approver to a draft.

## Errors

When ReadyDoc refuses a request, the tool returns an error that says what to do next:

| ReadyDoc returns | The tool says |
|---|---|
| 401 | The token is revoked or expired, or its account changed. Mint a new one. |
| 403 `approve_requires_human_session` | This needs a human in ReadyDoc. |
| 403 `token_scope` | The token may not do that, with the reason. |
| 403, other | The bot's account lacks the module. It is set in Settings → Users. |
| 404 | Not found, or the account cannot see it. |
| 429 | Rate limited. Retry after *N* seconds. |

## Test

```sh
npm test               # unit tests against a mocked fetch
npm run check:botmcp   # from the repo root: route parity, stdio, smoke test
```
