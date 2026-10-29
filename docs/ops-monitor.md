# Bots monitor: how ReadyDoc tells you the #ops-requests bots have stopped

ReadyDoc watches the #ops-requests bots and tells **you only** when they stop working. It tells you again when they
start working again. It is **off** until you turn it on in Railway. (Decision D-259.)

## What it watches

| Alert | When it fires | When it clears |
|---|---|---|
| **Webhook errors** (Procurement or Controller) | Messages to that bot's webhook have failed for 15 minutes straight, with no success in between. | The next message to that webhook goes through. If few messages are posted, this can take a while. |
| **Bots silent** | No bot has been seen for 2 hours, Monday to Friday, 7:00 AM to 5:00 PM Mountain time. | Any bot is seen again. If it is still silent at 5 PM, it clears the next time a bot is seen, for example the next morning. |

"Seen" means a bot used its ReadyDoc key, or posted a message. ReadyBot does not count. The test account
("Test Runner") does not count either.

Paid holidays are **not** skipped. If the bots are quiet on a holiday weekday, you will get an alert.

## How you are told

Each alert and each recovery comes two ways:

1. **A message in a private channel called #alerts.** You are the only member. ReadyBot posts it. This is the record.
2. **A notification on your phone.** This needs:
   - the Powder Ops app installed on your phone, with notifications allowed;
   - the VAPID keys set in Railway (they already are, for chat notifications).

You get **one** alert when a problem starts and **one** when it ends, never repeats in between. Your phone may show
the channel notification and the alert notification as one or as two; some phones show both.

If anyone else is added to #alerts, the monitor stops posting there and only sends the phone notification. The status
page then says `unsafe`. Remove the extra person to fix it.

## Settings (Railway variables)

| Variable | What it does | Default |
|---|---|---|
| `OPS_MONITOR_ENABLED` | `1` turns the monitor on. Remove it to turn it off. | off |
| `OPS_MONITOR_SILENCE_MINUTES` | How long the bots can be silent before an alert. | `120` |
| `OPS_MONITOR_WEBHOOK_MINUTES` | How long webhook errors can last before an alert. | `15` |
| `OPS_MONITOR_USER_ID` | Only needed if your ReadyDoc account has no email on file. Your user id. | not set |

None of these is a secret. Alerts go to the ReadyDoc account whose email is `lowry@powder-ops.com`. Nothing is
emailed; the address is only used to find your account.

## Turning it on

1. Open the status page while signed in as an admin: `https://app.powder-ops.com/api/admin/ops-monitor/status`.
   It will say `"enabled": false` for now.
2. Check that the Powder Ops app is on your phone with notifications allowed.
3. In Railway, set `OPS_MONITOR_ENABLED` to `1`. Railway restarts the app, and #alerts appears in your channel list.
4. Open the status page again and check:
   - `"recipient": "resolved"` means it found your account. If it says `not_found`, set `OPS_MONITOR_USER_ID`.
   - `"push_ready": { "ready": true }` means your phone will get notifications. If `phone_subscribed` is false,
     open the app on your phone and turn notifications on.
   - `"alerts_channel": "ok"`.

## Testing it

At a quiet time on a weekday between 7 AM and 5 PM:

1. In Railway, set `OPS_MONITOR_SILENCE_MINUTES` to `5`.
2. Wait about 5 minutes with no bot activity. You should get a "Bots alert: no bot has been seen…" post in #alerts
   and a phone notification.
3. When a bot next runs, you get a "Bots recovered" post.
4. Remove `OPS_MONITOR_SILENCE_MINUTES` from Railway, so it goes back to 2 hours.

## Turning it off

Remove `OPS_MONITOR_ENABLED` in Railway. The #alerts channel and its old posts stay; nothing new is posted.

## When you get an alert

- **Webhook errors:** open `/api/admin/ops-webhook/status` to see the last error. Check the webhook variables in
  Railway, and check that the Grok Bot routines are turned on.
- **Bots silent:** check whether the bots' scheduled runs are running in Grok Bot. Look at the last time a bot
  posted in #ops-requests.
- **Status page:** `/api/admin/ops-monitor/status` shows what is open, when it started, and whether the post and the
  phone notification went out.

## Limits

- It runs inside ReadyDoc, so if ReadyDoc itself is down, it cannot tell you.
- The weekday P0 sweep reads Gmail only, so ReadyDoc cannot see it. The 2-hour rule relies on Procurement's
  90-minute backup check. Keep the monitor off until that schedule is live.
