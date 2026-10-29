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

## The Test Runner (posting the test questions by bot)

A bot account called **Test Runner** can post the `[TEST]` questions in `#ops-requests-test` for you. Its posts there
wake Procurement just like yours do. It can do nothing else: no other channel, no reactions, no edits, no approvals.

To give Jarvis its token:
1. ReadyDoc → Settings → **Bot API tokens** → **New token**.
2. Account: **Test Runner**. Label: `Jarvis test runner`. Scopes: tick **Read** and **Write**.
3. Create, then copy the token (it starts `rdk_`). It is shown once.
4. Give it to Jarvis the same way you give it the other bot tokens — never in a chat or a file.

If the Test Runner is not in `#ops-requests-test` yet (the channel was created after the last deploy), add it from the
channel's member list, or wait for the next deploy.
To stop it: Settings → Bot API tokens → **Revoke** on that token.

## The Quality bot's signal: a document revision approved (D-277)

The same outbox carries one more event, to the Quality bot: **`document.revision_approved`**, sent once per document
and revision when a revision is approved in ReadyDoc (a draft approved, a paper revision recorded from the worklist,
or a document's first approval). It is separate from the two channel wakes and has its own switch.

| Variable | What it is |
|---|---|
| `QUALITY_WEBHOOK_URL` | The Quality bot routine's webhook URL |
| `QUALITY_WEBHOOK_KEY` | Its key, sent as `Authorization: Bearer <key>` |
| `QUALITY_WEBHOOK_ENABLED` | `1` turns it on. Unset or `0` is off — nothing is queued or sent |

To turn it on: in Railway → the ReadyDoc service → Variables, add the URL and the key, then add
`QUALITY_WEBHOOK_ENABLED` = `1` last. Railway redeploys. Approvals before that are not sent afterwards.

The body: `event`, `version`, `dedupe_id`, `document` (id, doc_number, title, doc_type, category), `old_revision`
(null on a first approval), `new_revision`, `effective_date`, `approved_by`, `approved_at`, `source`
(`draft` | `transcribed` | `first_approval`), `change_summary`, `linked_courses` (id, code, title,
`built_on_revision`, `needs_update`) and `link` (opens the document in ReadyDoc). `OPS_WEBHOOK_SIGNING_SECRET`, when set,
signs it like the others. The bot answers `200 {"success": true}`; anything else is retried on the same schedule.
