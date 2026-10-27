// Consistent SQLite backup for the compliance database.
//
// Uses better-sqlite3's online .backup() API, which produces a correct snapshot
// even while the app is running with WAL enabled (a plain `cp` of a WAL database
// can capture a torn state). Writes a timestamped copy into BACKUP_DIR, prunes to
// the most recent BACKUP_KEEP files, and — if R2/S3 object storage is configured
// — also uploads the snapshot off-box (zero-egress on Cloudflare R2).
//
// Run manually:      npm run backup
// Or on a schedule:  a Railway cron service / GitHub Action calling `npm run backup`.
//
// Env:
//   DB_PATH      source database (defaults to server default)
//   BACKUP_DIR   where snapshots are written (default: <db dir>/backups)
//   BACKUP_KEEP  how many local snapshots to retain (default: 14)
//   COA_FILES_DIR the COA lab reports folder (default: <db dir>/coa-files), zipped beside the snapshot
//   R2_*         if set (see server/storage.js), the snapshot is also uploaded
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import AdmZip from 'adm-zip';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDbPath } from '../server/db.js';
import { storageEnabled, putObject } from '../server/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const src = process.env.DB_PATH || getDbPath();
  const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(src), 'backups');
  const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10) || 14);

  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `compliance-${stamp}.db`;
  const dest = path.join(backupDir, filename);

  // Online backup — safe against a live WAL database.
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const { size } = statSync(dest);
  console.log(`[backup] wrote ${dest} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  // Off-box copy when object storage is configured.
  if (storageEnabled()) {
    try {
      const key = `backups/${filename}`;
      await putObject(key, readFileSync(dest), 'application/x-sqlite3');
      console.log(`[backup] uploaded to object storage: ${key}`);
    } catch (e) {
      console.warn(`[backup] off-box upload failed: ${e.message}`);
    }
  } else {
    console.log('[backup] object storage not configured — local snapshot only');
  }

  // The lab reports behind the COA records (D-224). They live beside the
  // database in coa-files/, not in it, so a database snapshot alone restores
  // 135 requests whose PDFs are gone. Zipped with the same stamp and kept and
  // pruned the same way.
  const coaDir = process.env.COA_FILES_DIR || path.join(path.dirname(src), 'coa-files');
  if (existsSync(coaDir)) {
    const zip = new AdmZip();
    zip.addLocalFolder(coaDir);
    const zipName = `coa-files-${stamp}.zip`;
    const zipPath = path.join(backupDir, zipName);
    zip.writeZip(zipPath);
    console.log(`[backup] wrote ${zipPath} (${(statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB, ${readdirSync(coaDir).length} files)`);
    if (storageEnabled()) {
      try {
        await putObject(`backups/${zipName}`, readFileSync(zipPath), 'application/zip');
        console.log(`[backup] uploaded to object storage: backups/${zipName}`);
      } catch (e) {
        console.warn(`[backup] off-box upload of the COA files failed: ${e.message}`);
      }
    }
  } else {
    console.log(`[backup] no COA files folder at ${coaDir} — nothing to add`);
  }

  // Prune old local snapshots, newest kept.
  const snapshots = readdirSync(backupDir)
    .filter(f => /^compliance-.*\.db$/.test(f))
    .map(f => ({ f, t: statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of snapshots.slice(keep)) {
    unlinkSync(path.join(backupDir, f));
    console.log(`[backup] pruned old snapshot ${f}`);
  }
  const zips = readdirSync(backupDir)
    .filter(f => /^coa-files-.*\.zip$/.test(f))
    .map(f => ({ f, t: statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of zips.slice(keep)) {
    unlinkSync(path.join(backupDir, f));
    console.log(`[backup] pruned old COA files archive ${f}`);
  }
}

main().catch(err => {
  console.error('[backup] failed:', err.message);
  process.exit(1);
});
