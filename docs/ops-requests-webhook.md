# #ops-requests webhook wake (D-251)

When a person posts in `#ops-requests` or `#ops-requests-test`, ReadyDoc wakes the right Grok Bot routine within
seconds instead of waiting for its hourly check. Off by default.

## What each target does

| Target | Wakes | Fires when |
|---|---|---|
| `procurement` | Routine A on the Procurement bot | a person posts a new message or thread reply in either channel |
| `controller` | Routine B on the Controller bot | `*Procurement Bot` replies in a thread with text starting `→ Controller` |

Nothing else fires: no other channel, no DM, no edit, delete or reaction, no other bot post.

## Railway variables

| Variable | What it is |
|---|---|
| `OPS_WEBHOOK_URL` | Routine A's webhook URL (Procurement) |
| `OPS_WEBHOOK_KEY` | Routine A's key (starts `crsr_`) |
| `OPS_WEBHOOK_CONTROLLER_URL` | Routine B's webhook URL (Controller) |
| `OPS_WEBHOOK_CONTROLLER_KEY` | Routine B's key |
| `OPS_WEBHOOK_ENABLED` | `1` turns it on. Unset or `0` is off |
| `OPS_WEBHOOK_SIGNING_SECRET` | optional; adds an `X-Powder-Ops-Signature` header (Grok Bot does not check it) |

A target is on only when the flag is on **and** its own URL and key are both set.

## Turning it on

1. Railway → the ReadyDoc service → **Variables**.
2. Add `OPS_WEBHOOK_URL` and `OPS_WEBHOOK_KEY` (the Procurement pair).
3. Add `OPS_WEBHOOK_CONTROLLER_URL` and `OPS_WEBHOOK_CONTROLLER_KEY` (the Controller pair).
4. Last, add `OPS_WEBHOOK_ENABLED` = `1`. Railway redeploys.
5. Check: the deploy log has a line starting `[ops-webhook]` saying which targets are ON.
6. Post a `[TEST]` message in `#ops-requests-test` and watch the routine's run history.
7. Status (admin, signed in): open `https://app.powder-ops.com/api/admin/ops-webhook/status` — each target's state,
   the last 20 sends and failures in the last 24 hours.

## Turning it off

Set `OPS_WEBHOOK_ENABLED` to `0` (or delete it). Railway redeploys and nothing is sent. To stop one target only,
delete its URL or key.
