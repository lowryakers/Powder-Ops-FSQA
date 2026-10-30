// THE DATABASE, OFF THE SERVER, EVERY DAY (D-290).
//
// The weekly Friday job stores a ZIP of CSVs — readable, but it cannot bring
// the application back: no schema, no signatures as stored, no audit log as a
// table. This is the copy that can. Every day the live SQLite database is
// copied with SQLite's own online backup (safe while the app is running),
// checked, and uploaded to R2 beside the COA lab-report files.
//
// RETENTION IS 30 DAILY + 12 MONTHLY. The first backup of each month is also
// stored under monthly/, so a problem found in March can still be restored to
// the state it was in before Christmas. Pruning reads the list this module
// keeps in app_settings — the one place that knows which keys it wrote.
//
// A BACKUP NOBODY HAS RESTORED IS A HOPE. `restoreTest()` downloads the newest
// daily copy into a scratch file, runs SQLite's full integrity check, and
// compares each table's rows with the live database. Run from Settings, once a
// quarter at least; the bell says when one is due.
//
// NOTHING HERE WRITES TO A RECORD TABLE. It reads the database, writes files to
// object storage, and records its own status in app_settings and the audit log.
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { getDbPath, logAudit } from './db.js';

export const DAILY_KEEP = 30;
export const MONTHLY_KEEP = 12;
export const STALE_HOURS = 36;     // a daily job that has not succeeded in a day and a half
export const RESTORE_TEST_DAYS = 92; // once a quarter
export const BACKUP_HOUR = 1;      // plant time; the quietest hour

const LIST_KEY = 'db_backups';
const LAST_KEY = 'last_db_backup';
const RESTORE_KEY = 'last_restore_test';

function getSetting(db, key) {
  try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || 'null'); } catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, JSON.stringify(value));
}

export const dailyKey = (ymd) => `backups/db/daily/compliance-${ymd}.db`;
export const monthlyKey = (ym) => `backups/db/monthly/compliance-${ym}.db`;
const coaKeyFor = (dbKey) => dbKey.replace(/compliance-([\d-]+)\.db$/, 'coa-files-$1.zip');

/**
 * Which stored backups to keep and which to delete. PURE.
 *
 * `list` holds `{ kind: 'daily'|'monthly', period, key, coa_key? }`. The
 * newest `daily` by period and the newest `monthly` by period are kept; the
 * rest go. Ties on a period (a re-run the same day) keep one.
 */
export function planRetention(list, { daily = DAILY_KEEP, monthly = MONTHLY_KEEP } = {}) {
  const keep = []; const drop = [];
  for (const [kind, n] of [['daily', daily], ['monthly', monthly]]) {
    const seen = new Set();
    const rows = (list || []).filter((b) => b.kind === kind).sort((a, b) => String(b.period).localeCompare(String(a.period)));
    for (const b of rows) {
      if (seen.has(b.period) || seen.size >= n) { drop.push(b); continue; }
      seen.add(b.period); keep.push(b);
    }
  }
  return { keep, drop };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmpFile = (name) => path.join(os.tmpdir(), `readydoc-${process.pid}-${Date.now()}-${name}`);

/** Every user table and its row count, from an open database. */
function tableCounts(handle) {
  const tables = handle.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name`).all().map((r) => r.name);
  const out = {};
  for (const t of tables) {
    try { out[t] = handle.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n; } catch { out[t] = null; }
  }
  return out;
}

/**
 * Take today's backup. `deps` = { storageEnabled, putObject, deleteObject }.
 * Always records what happened in `last_db_backup`, success or not.
 */
export async function runDbBackup(db, deps, { now = new Date(), ymd, actor = 'system', coaDir } = {}) {
  const day = ymd || now.toISOString().slice(0, 10);
  const status = { at: now.toISOString(), period: day, ok: false, by: typeof actor === 'string' ? actor : actor?.name };
  if (!deps?.storageEnabled?.()) {
    status.error = 'Off-server storage (R2) is not configured, so no backup left the server.';
    setSetting(db, LAST_KEY, status);
    return status;
  }
  const tmp = tmpFile('backup.db');
  try {
    await db.backup(tmp);
    const check = new Database(tmp, { readonly: true, fileMustExist: true });
    let quick; let counts;
    try {
      quick = check.prepare('PRAGMA quick_check').pluck().get();
      counts = tableCounts(check);
    } finally { check.close(); }
    if (quick !== 'ok') throw new Error(`The copy failed SQLite's quick check (${quick}).`);

    const buf = readFileSync(tmp);
    const list = getSetting(db, LIST_KEY) || [];
    const entries = [{ kind: 'daily', period: day, key: dailyKey(day) }];
    const ym = day.slice(0, 7);
    if (!list.some((b) => b.kind === 'monthly' && b.period === ym)) entries.push({ kind: 'monthly', period: ym, key: monthlyKey(ym) });

    // The lab reports behind the COA records live beside the database, not in
    // it (D-224); a database restored without them is 135 requests with no PDF.
    const coaFolder = coaDir || path.join(path.dirname(getDbPath()), 'coa-files');
    let coaBuf = null;
    if (existsSync(coaFolder) && readdirSync(coaFolder).length) {
      const zip = new AdmZip(); zip.addLocalFolder(coaFolder); coaBuf = zip.toBuffer();
    }
    for (const e of entries) {
      await deps.putObject(e.key, buf, 'application/x-sqlite3');
      if (coaBuf) { e.coa_key = coaKeyFor(e.key); await deps.putObject(e.coa_key, coaBuf, 'application/zip'); }
      e.size = buf.length; e.sha256 = sha256(buf); e.at = status.at;
    }
    const merged = [...entries, ...list.filter((b) => !entries.some((e) => e.kind === b.kind && e.period === b.period))];
    const { keep, drop } = planRetention(merged);
    for (const b of drop) {
      // A re-run the same day overwrote the same key; never delete what was kept.
      if (keep.some((k) => k.key === b.key)) continue;
      await deps.deleteObject?.(b.key);
      if (b.coa_key) await deps.deleteObject?.(b.coa_key);
    }
    setSetting(db, LIST_KEY, keep);
    Object.assign(status, {
      ok: true, key: entries[0].key, monthly: entries.length > 1, size: buf.length, sha256: entries[0].sha256,
      tables: Object.keys(counts).length, coa_files: !!coaBuf, kept: { daily: keep.filter((b) => b.kind === 'daily').length, monthly: keep.filter((b) => b.kind === 'monthly').length },
    });
    logAudit(actor, 'backup', 'database', day, { key: status.key, size: status.size, sha256: status.sha256, monthly: status.monthly, coa_files: status.coa_files }, null, null, `Database backup ${day}`);
  } catch (e) {
    status.error = e.message;
    console.warn('[backup] daily database backup failed:', e.message);
  } finally {
    try { unlinkSync(tmp); } catch { /* not written */ }
  }
  setSetting(db, LAST_KEY, status);
  return status;
}

/**
 * Restore the newest daily backup into a scratch file and check it.
 * `deps` = { storageEnabled, getObjectBuffer }.
 */
export async function restoreTest(db, deps, { actor, now = new Date() } = {}) {
  const list = (getSetting(db, LIST_KEY) || []).filter((b) => b.kind === 'daily').sort((a, b) => String(b.period).localeCompare(String(a.period)));
  const result = { at: now.toISOString(), by: actor?.name || 'system', ok: false };
  if (!deps?.storageEnabled?.()) { result.error = 'Off-server storage (R2) is not configured.'; return result; }
  if (!list.length) { result.error = 'No daily database backup has been stored yet. Run one first.'; return result; }
  const pick = list[0];
  result.key = pick.key; result.period = pick.period;
  const tmp = tmpFile('restore.db');
  try {
    const buf = await deps.getObjectBuffer(pick.key);
    if (!buf) throw new Error(`The backup ${pick.key} could not be downloaded.`);
    result.sha256_matches = pick.sha256 ? sha256(buf) === pick.sha256 : null;
    if (result.sha256_matches === false) throw new Error('The downloaded copy does not match the fingerprint recorded when it was stored.');
    writeFileSync(tmp, buf);
    const restored = new Database(tmp, { readonly: true, fileMustExist: true });
    let integrity; let backupCounts;
    try {
      integrity = restored.prepare('PRAGMA integrity_check').pluck().get();
      backupCounts = tableCounts(restored);
    } finally { restored.close(); }
    const live = tableCounts(db);
    const missing = Object.keys(live).filter((t) => !(t in backupCounts));
    // The live database is newer, so it may hold MORE rows; a table where the
    // backup holds more is worth a look (something was deleted since).
    const shrank = Object.keys(backupCounts).filter((t) => live[t] != null && backupCounts[t] != null && live[t] < backupCounts[t])
      .map((t) => ({ table: t, backup: backupCounts[t], live: live[t] }));
    Object.assign(result, {
      integrity, tables: Object.keys(backupCounts).length, rows: Object.values(backupCounts).reduce((s, n) => s + (n || 0), 0),
      users: backupCounts.users ?? null, audit_rows: backupCounts.audit_log ?? null, missing_tables: missing, fewer_rows_now: shrank,
      size: statSync(tmp).size,
    });
    result.ok = integrity === 'ok' && missing.length === 0;
    if (!result.ok && !result.error) result.error = integrity !== 'ok' ? `Integrity check: ${integrity}` : `Tables missing from the backup: ${missing.join(', ')}`;
  } catch (e) {
    result.error = e.message;
  } finally {
    try { unlinkSync(tmp); } catch { /* not written */ }
  }
  setSetting(db, RESTORE_KEY, result);
  logAudit(actor || 'system', 'restore_test', 'database', result.period || 'none',
    { key: result.key, ok: result.ok, integrity: result.integrity, tables: result.tables, error: result.error || null }, null, null, 'Backup restore test');
  return result;
}

/** What the Settings card and the bell read. */
export function backupHealth(db, { now = new Date(), storageOn = true } = {}) {
  const last = getSetting(db, LAST_KEY);
  const list = getSetting(db, LIST_KEY) || [];
  const restore = getSetting(db, RESTORE_KEY);
  const lastOk = list.filter((b) => b.kind === 'daily').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
  const hoursSince = lastOk?.at ? (now - new Date(lastOk.at)) / 36e5 : null;
  const daysSinceRestore = restore?.ok && restore.at ? (now - new Date(restore.at)) / 864e5 : null;
  return {
    storage_on: storageOn,
    last, last_ok: lastOk, hours_since_ok: hoursSince == null ? null : Math.round(hoursSince * 10) / 10,
    stale: hoursSince == null || hoursSince > STALE_HOURS,
    daily: list.filter((b) => b.kind === 'daily').length, monthly: list.filter((b) => b.kind === 'monthly').length,
    list,
    restore_test: restore,
    restore_due: daysSinceRestore == null || daysSinceRestore > RESTORE_TEST_DAYS,
    rules: { daily: DAILY_KEEP, monthly: MONTHLY_KEEP, stale_hours: STALE_HOURS, restore_days: RESTORE_TEST_DAYS },
  };
}
