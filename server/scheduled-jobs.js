// Recurring in-process jobs (single Railway instance — no external cron).
// An hourly tick runs each job at most once per due period, tracked in
// app_settings so restarts never double-run or skip.
//
//  - Friday: full data backup ZIP → R2 (backups/...), keep the last 8,
//    announce in #document_control.
//  - Monday: expiry digest → #quality (certifications expiring ≤30 days or
//    expired; calibration instruments due ≤30 days or overdue).

export function startScheduledJobs(db, deps) {
  const tick = () => {
    try { runDue(db, deps); } catch (e) { console.warn('[jobs] tick failed:', e.message); }
  };
  setTimeout(tick, 30 * 1000); // shortly after boot (catches a missed Friday)
  setInterval(tick, 60 * 60 * 1000).unref();
}

const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil((((t - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
};

function getFlag(db, key) { return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value || null; }
function setFlag(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
}

async function runDue(db, deps) {
  const { storageEnabled, putObject, deleteObject, buildBackupZip, getChannelByName, postMessageAs, getBotUser } = deps;
  const now = new Date();
  const week = isoWeek(now);
  const day = now.getDay(); // 0 Sun … 5 Fri

  // Weekly backup: due Friday; a boot on Sat/Sun still catches the missed run.
  if (day >= 5 || day === 0) {
    if (getFlag(db, 'last_auto_backup_week') !== week && storageEnabled()) {
      try {
        const name = `readydoc-backup-${now.toISOString().slice(0, 10)}.zip`;
        const key = `backups/${name}`;
        const buf = buildBackupZip(db, 'scheduled weekly job');
        await putObject(key, buf, 'application/zip');
        let list = [];
        try { list = JSON.parse(getFlag(db, 'auto_backups') || '[]'); } catch { list = []; }
        list.unshift({ key, name, at: now.toISOString(), size: buf.length });
        for (const old of list.slice(8)) deleteObject(old.key); // keep the last 8 weeks
        setFlag(db, 'auto_backups', JSON.stringify(list.slice(0, 8)));
        setFlag(db, 'last_auto_backup_week', week);
        console.log(`[jobs] weekly backup stored: ${key} (${Math.round(buf.length / 1024)} KB)`);
        const channel = getChannelByName(db, 'document_control') || getChannelByName(db, 'general');
        if (channel) {
          await postMessageAs(db, channel, getBotUser(db),
            `📦 Weekly data backup saved (${name}, ${Math.round(buf.length / 1024)} KB). Admins can download it any time from Settings → Data Backup.`);
        }
      } catch (e) { console.warn('[jobs] weekly backup failed:', e.message); }
    }
  }

  // Monday expiry digest (certifications + calibration).
  if (day === 1 && getFlag(db, 'last_expiry_digest_week') !== week) {
    try {
      const soon = (dateStr) => {
        if (!dateStr) return null;
        return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
      };
      const lines = [];
      let certs = [];
      try { certs = db.prepare('SELECT person_name, cert_type, expiry_date FROM certifications WHERE expiry_date IS NOT NULL').all(); } catch { certs = []; }
      for (const c of certs) {
        const d = soon(c.expiry_date);
        if (d != null && d <= 30) lines.push(`• ${c.person_name} — ${c.cert_type}: ${d < 0 ? `EXPIRED ${-d}d ago` : `expires in ${d}d`} (${c.expiry_date})`);
      }
      let instruments = [];
      try { instruments = db.prepare("SELECT name, asset_number, next_due FROM calibration_instruments WHERE next_due IS NOT NULL AND status != 'retired'").all(); } catch { instruments = []; }
      for (const i of instruments) {
        const d = soon(i.next_due);
        if (d != null && d <= 30) lines.push(`• Calibration — ${i.name}${i.asset_number ? ` #${i.asset_number}` : ''}: ${d < 0 ? `OVERDUE ${-d}d` : `due in ${d}d`} (${i.next_due})`);
      }
      if (lines.length) {
        const channel = getChannelByName(db, 'quality') || getChannelByName(db, 'general');
        if (channel) {
          await postMessageAs(db, channel, getBotUser(db),
            `📋 Monday expiry check — ${lines.length} item${lines.length === 1 ? '' : 's'} need attention:\n${lines.slice(0, 20).join('\n')}${lines.length > 20 ? `\n…and ${lines.length - 20} more (see Certifications / Calibration modules)` : ''}`);
        }
      }
      setFlag(db, 'last_expiry_digest_week', week);
    } catch (e) { console.warn('[jobs] expiry digest failed:', e.message); }
  }
}
