# Taking a snapshot of the production database, and booting the next release against it

Railway deploys `main` automatically, so the first time new code meets the production database is
the deploy — unless it meets a copy first. `npm run verify:prodcopy <file>` is that check
(`scripts/verify-prod-copy.mjs`); this is how to get the file it needs.

**The file has to be the SQLite database.** The Settings → Data & backup zip is CSVs and cannot
exercise a migration.

## One-time setup on a Mac
1. Node LTS from nodejs.org (`node -v` should say v20 or v22).
2. A clone of the repo — GitHub Desktop → File → Clone Repository → `lowryakers/Powder-Ops-FSQA`
   (lands in `~/Documents/GitHub/Powder-Ops-FSQA`), then `npm install` in that folder.
3. `npm install -g @railway/cli && railway login`, then `railway link` in the repo folder:
   workspace → project → environment **production** → the ReadyDoc service.

## Each time
1. `railway ssh` → inside the container `npm run backup` → `exit`. It prints
   `[backup] wrote /app/data/backups/compliance-<stamp>.db` and, with R2 configured,
   `[backup] uploaded to object storage: backups/compliance-<stamp>.db`.
2. Cloudflare dashboard → R2 → the bucket named by the service's `R2_BUCKET` variable → `backups/`
   → download the newest `compliance-<stamp>.db`.
3. In the repo folder: `npm run verify:prodcopy ~/Downloads/compliance-<stamp>.db`.
   The original is never opened for writing; the check boots a copy twice and deletes it.
4. The last line should read *The current code boots cleanly against this production copy.*
   Any `✗` line means do not deploy until it is understood.
5. Delete the snapshot from Downloads afterwards. It is the plant's records.

The step-by-step version with expected output at each step is the "V2 Foundation Runbook" artifact
(3 September 2026).
