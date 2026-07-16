# Data safety — protecting the compliance database

The entire application state (audit log, deviations, CAPAs, training records,
production history — everything an auditor asks for) lives in a **single SQLite
file**. On Railway, a service's container filesystem is **ephemeral**: it is
recreated on every deploy and can be reset on restart. If the database file is
not on a **persistent volume**, a deploy can wipe all compliance history.

This is the highest-priority operational risk for the app. Two things are needed:
a persistent volume, and off-container backups.

---

## 1. Put the database on a persistent Railway volume

No code change is required — the server already honors `DB_PATH`
(`server/db.js`). Steps in the Railway dashboard:

1. Open the service → **Variables** and confirm/add:
   `DB_PATH = /data/compliance.db`
2. Open the service → **Settings → Volumes → + New Volume**.
   - **Mount path:** `/data`
   - Attach it to this service.
3. **Redeploy.** On boot the server creates `/data/compliance.db` on the volume.
   From then on the data survives deploys and restarts.

> First-time cutover: a fresh volume starts empty, so the app re-seeds a new
> database. If you already have production data in the current container that you
> need to keep, take a backup **before** switching `DB_PATH` (see below), then
> restore that file onto the volume.

## 2. Automated backups

`npm run backup` (`scripts/backup-db.js`) makes a **consistent** snapshot using
SQLite's online backup API — safe to run against the live database (a plain file
copy of a WAL database can capture a torn state).

- Writes a timestamped copy to `BACKUP_DIR` (default `<db dir>/backups`).
- Retains the newest `BACKUP_KEEP` snapshots (default 14), prunes the rest.
- If R2/S3 object storage is configured (the same `R2_*` vars used by chat
  uploads — see `server/storage.js`), it **also uploads the snapshot off-box**,
  which is what actually protects you if the whole Railway service is lost.

Environment variables:

| var           | default              | purpose                                  |
|---------------|----------------------|------------------------------------------|
| `DB_PATH`     | server default       | source database                          |
| `BACKUP_DIR`  | `<db dir>/backups`   | where snapshots are written              |
| `BACKUP_KEEP` | `14`                 | how many local snapshots to retain       |
| `R2_*`        | (unset)              | if set, snapshot is uploaded off-box     |

### Scheduling it

Pick whichever fits your setup:

- **Railway Cron service** — add a second service from the same repo with a cron
  schedule (e.g. daily `0 7 * * *`) and start command `npm run backup`, sharing
  the `/data` volume and the `R2_*` variables. This is the simplest fully-managed
  option.
- **GitHub Action** — a scheduled workflow that runs `npm run backup` against a
  copy pulled from the volume, or that triggers the Railway cron. Use when you'd
  rather keep the schedule in the repo.

For a food-safety audit you want to be able to say: *records are retained on
durable storage, backed up daily to a separate location, and recoverable.* A
volume plus a scheduled `npm run backup` with `R2_*` set satisfies that.

## 3. Restoring

1. Stop or scale down the service (so nothing writes during restore).
2. Copy the chosen snapshot over the live file, e.g. on the volume:
   `cp /data/backups/compliance-<stamp>.db /data/compliance.db`
   (remove any stale `-wal`/`-shm` sidecar files next to it first).
3. Start the service. Verify the audit log and a few recent records.
