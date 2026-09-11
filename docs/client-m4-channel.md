# The M4 Dynamic coordination channel

One private Messages channel — `client--m4` — where manufacturing coordination between Powder Ops and
M4 Dynamic happens in writing, in one place, instead of across email threads, texts and phone calls.

It is created automatically the first time this release boots. Nothing below needs a deploy.

## What is already there

| | |
|---|---|
| Channel | `client--m4`, **private**, anyone in it may post, not a default channel |
| Topic | the three release rules, that the schedule is not set from chat, and that exceptions are Lowry's |
| First message | the channel guide, **pinned** so whoever joins next month still sees it |
| Posted by | **Alex**, the Account Manager account |

The guide covers, in this order: putting ReadyDoc on a phone (iPhone Safari and Android Chrome, step by
step), using one thread per MO, that nothing typed here starts or moves a production order, the three
release rules, a status-update template to fill in, and who to `@` for what.

## Who is in it

**Powder Ops** — Lowry, Adam, Jake. Matched against the roster that already exists; nobody is created.
**Danny is deliberately not a member.**

**M4 Dynamic** — five accounts, created signed-out with no password:

| Name in ReadyDoc | Email |
|---|---|
| Matt (M4 Dynamic) | matt@m4dynamic.com |
| Jean Salcedo (M4 Dynamic) | projects@m4dynamic.com |
| Cristian (M4 Dynamic) | ops@m4dynamic.com |
| Sophie (M4 Dynamic) | sophie@m4dynamic.com |
| M4 Purchasing | buyer@m4dynamic.com |

`coordinator@m4dynamic.com` was optional and is **not** created. Add it in Settings if it is wanted.

The company is in the display name on purpose — the plant has its own Matt, and a member list with two
of them is ambiguous in exactly the way that costs somebody an hour.

## Giving the M4 people their sign-in

No password exists anywhere, in this repository or in the database. For each person:

1. **Settings → Users**, find them, **Reset password**.
2. ReadyDoc shows a **setup code** once. Send it to that person with their sign-in name.
3. They open <https://start.powder-ops.com>, type their name, and are asked to choose a password.

The code lasts 14 days. Re-issue it the same way if it lapses.

## Adding or removing someone later

Open the channel → the member list → add or remove. Admins only.

**Tick "Client (outside company)" on any new M4 account** (Settings → Users). That one tick is what keeps
the account out of #general and #announcements and out of every ReadyDoc module — it is Messages and
nothing else. Without it, the next deploy adds them to the plant's default channels.

If the boot log said a Powder Ops name was **not found on the roster**, that person was not added and
nothing guessed at who they meant: add them by hand from the member list. The names it looked for are
recorded in `app_settings.client_channels_seed_missing`.

## What this channel cannot do

- **It cannot schedule anything.** A message here never raises a task, starts a Manufacturing Order or
  writes the production schedule. The app refuses it, not just the guide.
- **It cannot become public**, and it cannot be renamed out of the `client--` family.
- **The M4 accounts reach nothing else.** No Production, no Accounting, no AP Drop, no Partner
  Reconciliation, no Procurement, and no other channel — only the one they were added to.
- **Nothing leaves ReadyDoc.** No email is sent, no QuickBooks record is written, no payable is created.
  A document attached here is the copy both companies work from, not an approval.

## Opening a channel for another client

Same shape: an admin creates a channel named `client--<company>`. It is forced private, it maps to no
Task Center team, and none of the rules above have to be remembered — they follow from the name.
