// A scale reported dropped or damaged, and QA's authorization of its return to
// use (D-194, SQF 11.2.3.4, the caution in the Equipment Calibration SOP).
//
// ONE WRITER for the event, called by the Calibration screen and the public
// scale kiosk alike, so the floor's report and the office's are the same record.
//
// What filing does, in one transaction:
//   - stores the event with the time it HAPPENED (not the time it was typed);
//   - takes the instrument out of service, so it drops out of every due count
//     and the daily check says "do not use";
//   - opens a product disposition through product-disposition.js (the same
//     writer a failed check uses), with the window frozen at the last
//     documented acceptable check before the incident.
// Then, fire-and-forget, it tells Production and QA (Adam and Maria — the
// procedure's "notify Production and QA/QC").
//
// THE INCIDENT OWNS THE INSTRUMENT'S STATUS WHILE IT IS OPEN. A calibration
// filed against the scale no longer flips it back to active, and the edit form
// cannot either: only `authorizeReturn` does, and only for QA, with a password,
// an inspection note and a passing check dated after the incident.

import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';
import { stampOnFile, withDisposition, canDecide, affectedSinceFor } from './product-disposition.js';
import { PLANT_TZ, parseServerTime } from './plant-clock.js';
import { checkIncident, returnBlockers, INCIDENT_KINDS, SCALE_CAUTION } from '../shared/scale-incident.js';
import { resolveTarget } from './receiving-notify.js';
import { botDm, postMessageAs } from './api/comms.js';
import { pushToUser } from './push.js';
import { readyDocOrigin } from './links.js';

export const INCIDENT_TARGETS = {
  scale: {
    label: 'Adam and Maria',
    names: ['Adam', 'Maria'],
    fallbackDepartments: ['qa', 'quality'],
    subject: 'Scale out of service — dropped or damaged',
  },
};

/** Normalise "2026-10-21T09:40" (a datetime-local box) to SQLite's shape, UTC. */
export function toDbTime(v) {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

/** Is there an open incident on this instrument? */
export function openIncidentFor(db, instrumentId) {
  if (!instrumentId) return null;
  try {
    return db.prepare(`SELECT * FROM instrument_incidents WHERE instrument_id = ? AND status = 'open'
      ORDER BY occurred_at DESC LIMIT 1`).get(instrumentId) || null;
  } catch { return null; }
}

/**
 * Production entries that may have used the scale: same room, on or after the
 * day of the last good check. A LIST FOR QA TO START FROM, not a verdict — a
 * scale moves between rooms and an entry carries only a date, so this is the
 * runs worth looking at, never "the affected lots".
 */
export function possiblyAffectedRuns(db, incident, { limit = 60 } = {}) {
  const room = incident.room;
  if (!room) return [];
  const from = String(incident.affected_since || incident.occurred_at || '').slice(0, 10);
  if (!from) return [];
  try {
    return db.prepare(`SELECT id, date, team, room, product_name, mo_number, lot_number, mo_lines
      FROM production_entries WHERE date >= ? AND (lower(room) = lower(?) OR mo_lines LIKE ?)
      ORDER BY date DESC LIMIT ?`).all(from, room, `%"room":"${String(room).replace(/["%_]/g, '')}"%`, limit)
      .map(r => {
        const lines = (() => { try { return JSON.parse(r.mo_lines || '[]'); } catch { return []; } })();
        const mos = lines.length
          ? lines.map(l => [l.mo_number, l.lot_number, l.product_name].filter(Boolean).join(' · ')).filter(Boolean)
          : [[r.mo_number, r.lot_number, r.product_name].filter(Boolean).join(' · ')].filter(Boolean);
        return {
          id: r.id, date: r.date, team: r.team, room: r.room, runs: mos,
          after_incident: r.date >= String(incident.occurred_at || '').slice(0, 10),
        };
      });
  } catch { return []; }
}

export function shapeIncident(db, row) {
  if (!row) return row;
  const base = withDisposition('incident', row);
  return {
    ...base,
    kind_label: INCIDENT_KINDS[row.kind] || row.kind,
    can_return: row.status === 'open',
    possibly_affected: possiblyAffectedRuns(db, row),
  };
}

/**
 * File a report. `actor` is the signed-in user (app) or null (kiosk);
 * `source` is 'app' | 'kiosk'. Returns { error, status } or { incident }.
 */
export function fileIncident(db, body, { actor = null, source = 'app' } = {}) {
  const input = {
    ...body,
    reported_by: String(body?.reported_by || actor?.name || '').trim(),
  };
  const errors = checkIncident(input);
  if (errors.length) return { error: errors.join(' '), errors, status: 400 };

  let instrument = null;
  if (input.instrument_id) {
    instrument = db.prepare('SELECT * FROM calibration_instruments WHERE id = ?').get(input.instrument_id);
    if (!instrument) return { error: 'That scale is not on the instrument list.', status: 404 };
  }
  const occurredAt = toDbTime(input.occurred_at);
  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO instrument_incidents
      (id, instrument_id, scale_label, room, form_code, kind, occurred_at, reported_by, reported_by_id, source, description, lots_since)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, instrument?.id || null,
      String(input.scale_label || '').trim() || (instrument ? [instrument.name, instrument.asset_number && `#${instrument.asset_number}`].filter(Boolean).join(' ') : null),
      String(input.room || instrument?.room || '').trim() || null,
      input.form_code || null, input.kind, occurredAt, input.reported_by, actor?.id || null, source,
      String(input.description || '').trim() || null, String(input.lots_since || '').trim() || null,
    );
    if (instrument && instrument.status !== 'retired') {
      db.prepare("UPDATE calibration_instruments SET status = 'out_of_service', updated_at = datetime('now') WHERE id = ?").run(instrument.id);
    }
    stampOnFile(db, 'incident', id, null, actor || input.reported_by);
  })();
  const row = db.prepare('SELECT * FROM instrument_incidents WHERE id = ?').get(id);
  logAudit(actor || input.reported_by, 'create', 'instrument_incident', id,
    { kind: input.kind, instrument_id: row.instrument_id, occurred_at: occurredAt, source, out_of_service: !!instrument },
    null, row, `${row.scale_label || 'Scale'} · ${INCIDENT_KINDS[input.kind]}`);
  notifyIncident(db, row, actor).catch(() => {});
  return { incident: shapeIncident(db, row) };
}

const plantTime = (v) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: PLANT_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      .format(parseServerTime(v));
  } catch { return v; }
};

async function notifyIncident(db, row, actor) {
  const people = resolveTarget(db, 'scale', actor?.id || null, INCIDENT_TARGETS);
  const appPath = '/?tab=calibration';
  const link = `${readyDocOrigin()}${appPath}`;
  const sent = [];
  for (const p of people) {
    try {
      const { bot, dm } = botDm(db, p.id);
      // Bot bold is *text*, not **text** — the chat renderer isn't markdown.
      await postMessageAs(db, dm, bot,
        `⚠️ *Scale out of service — ${String(INCIDENT_KINDS[row.kind] || 'damaged').toLowerCase()}*\n`
        + `${row.scale_label || 'A scale'}${row.room ? ` · Room ${row.room}` : ''}\n`
        + `Happened: ${plantTime(row.occurred_at)} · reported by ${row.reported_by}\n`
        + `${row.description ? `${row.description}\n` : ''}`
        + 'Product weighed on it since the incident goes on HOLD until QA/QC evaluates it. '
        + 'The scale stays out of service until QA authorizes its return.\n'
        + `[Open it](${link})`);
      pushToUser(p.id, {
        title: 'Scale out of service',
        body: `${row.scale_label || 'A scale'} reported ${String(INCIDENT_KINDS[row.kind] || 'damaged').toLowerCase()}`.slice(0, 120),
        tag: `scale-incident-${row.id}`, renotify: true, url: appPath,
      }).catch(() => {});
      sent.push(p.name);
    } catch { /* one failure must not lose the others */ }
  }
  try { db.prepare('UPDATE instrument_incidents SET notified_to = ? WHERE id = ?').run(sent.join(', ') || null, row.id); } catch { /* ignore */ }
}

/** The passing check that proves the scale accurate again, if there is one. */
export function returnCheckFor(db, incident) {
  if (!incident?.instrument_id) return null;
  const cal = db.prepare(`SELECT id, result, calibrated_at at FROM calibration_records
    WHERE instrument_id = ? AND calibrated_at > ? AND result IN ('pass','adjusted_pass')
    ORDER BY calibrated_at DESC LIMIT 1`).get(incident.instrument_id, incident.occurred_at);
  const ver = db.prepare(`SELECT id, result, performed_at at FROM scale_verifications
    WHERE instrument_id = ? AND performed_at > ? AND result = 'pass'
    ORDER BY performed_at DESC LIMIT 1`).get(incident.instrument_id, incident.occurred_at);
  const best = [cal && { kind: 'calibration', ...cal }, ver && { kind: 'scale_verification', ...ver }]
    .filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return best || null;
}

/**
 * QA authorizes the scale back into use. The caller has already passed
 * gateSignature. Returns { error, status, blockers } or { incident }.
 */
export function authorizeReturn(db, incidentId, { inspection }, user) {
  if (!canDecide(user)) return { error: 'Returning a scale to use is QA/QC\'s authorization.', status: 403 };
  const row = db.prepare('SELECT * FROM instrument_incidents WHERE id = ?').get(incidentId);
  if (!row) return { error: 'Incident not found.', status: 404 };
  if (row.status !== 'open') return { error: `This scale was already returned to use by ${row.returned_by}.`, status: 409 };
  if (!row.instrument_id) {
    return { error: 'Link the report to the scale on the instrument list first — a return to use needs that scale\'s own check.', status: 400 };
  }
  const check = returnCheckFor(db, row);
  const blockers = returnBlockers({ incident: row, check, inspection });
  if (blockers.length) return { error: blockers.join(' '), blockers, status: 409 };
  db.transaction(() => {
    db.prepare(`UPDATE instrument_incidents SET status = 'closed', returned_at = datetime('now'), returned_by = ?,
      return_inspection = ?, return_check_kind = ?, return_check_id = ? WHERE id = ?`)
      .run(user.name, String(inspection).trim(), check.kind, check.id, row.id);
    // Another open incident on the same scale keeps it out of service.
    const other = db.prepare("SELECT 1 FROM instrument_incidents WHERE instrument_id = ? AND status = 'open' AND id != ?")
      .get(row.instrument_id, row.id);
    if (!other) {
      db.prepare("UPDATE calibration_instruments SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status = 'out_of_service'")
        .run(row.instrument_id);
    }
  })();
  const updated = db.prepare('SELECT * FROM instrument_incidents WHERE id = ?').get(row.id);
  logAudit(user, 'returned_to_use', 'instrument_incident', row.id,
    { instrument_id: row.instrument_id, check: check.kind, check_id: check.id, signature_verified: true }, row, updated,
    row.scale_label);
  return { incident: shapeIncident(db, updated) };
}

/** Link a kiosk report that named no instrument to the right instrument row. */
export function linkIncident(db, incidentId, instrumentId, user) {
  if (!canDecide(user)) return { error: 'Only QA/QC can link a report to a scale.', status: 403 };
  const row = db.prepare('SELECT * FROM instrument_incidents WHERE id = ?').get(incidentId);
  if (!row) return { error: 'Incident not found.', status: 404 };
  if (row.instrument_id) return { error: 'This report already names its scale.', status: 409 };
  const inst = db.prepare('SELECT * FROM calibration_instruments WHERE id = ?').get(instrumentId);
  if (!inst) return { error: 'That scale is not on the instrument list.', status: 404 };
  db.transaction(() => {
    db.prepare('UPDATE instrument_incidents SET instrument_id = ?, room = COALESCE(room, ?) WHERE id = ?').run(inst.id, inst.room || null, row.id);
    if (inst.status !== 'retired') {
      db.prepare("UPDATE calibration_instruments SET status = 'out_of_service', updated_at = datetime('now') WHERE id = ?").run(inst.id);
    }
    // The window is frozen against the instrument's own history now it is known.
    const r2 = db.prepare('SELECT * FROM instrument_incidents WHERE id = ?').get(row.id);
    const since = affectedSinceFor(db, 'incident', r2);
    db.prepare('UPDATE instrument_incidents SET affected_since = ? WHERE id = ?').run(since, row.id);
  })();
  const updated = db.prepare('SELECT * FROM instrument_incidents WHERE id = ?').get(row.id);
  logAudit(user, 'update', 'instrument_incident', row.id, { linked_instrument: inst.id }, row, updated);
  return { incident: shapeIncident(db, updated) };
}

/** Open (and recently closed) incidents for the Calibration screen. */
export function listIncidents(db, { status = 'open', limit = 100 } = {}) {
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM instrument_incidents ORDER BY occurred_at DESC LIMIT ?').all(limit)
    : db.prepare('SELECT * FROM instrument_incidents WHERE status = ? ORDER BY occurred_at DESC LIMIT ?').all(status, limit);
  return rows.map(r => ({ ...shapeIncident(db, r), return_check: r.status === 'open' ? returnCheckFor(db, r) : null }));
}

/** Out-of-service scales, for the daily check and the kiosk banner. */
export function outOfServiceScales(db) {
  try {
    return db.prepare(`SELECT ci.id, ci.name, ci.asset_number, ci.room, ci.type,
        (SELECT occurred_at FROM instrument_incidents ii WHERE ii.instrument_id = ci.id AND ii.status = 'open' ORDER BY occurred_at DESC LIMIT 1) incident_at,
        (SELECT kind FROM instrument_incidents ii WHERE ii.instrument_id = ci.id AND ii.status = 'open' ORDER BY occurred_at DESC LIMIT 1) incident_kind
      FROM calibration_instruments ci
      WHERE ci.status = 'out_of_service' AND lower(COALESCE(ci.type, '')) LIKE '%scale%'
      ORDER BY ci.room, ci.asset_number`).all()
      .map(r => ({ ...r, incident_label: r.incident_kind ? INCIDENT_KINDS[r.incident_kind] : null }));
  } catch { return []; }
}

/** Scales the kiosk can name in a report — id, name, asset, room only. */
export function scalesForKiosk(db) {
  try {
    return db.prepare(`SELECT id, name, asset_number, room, status FROM calibration_instruments
      WHERE status != 'retired' AND lower(COALESCE(type, '')) LIKE '%scale%'
      ORDER BY room, asset_number LIMIT 300`).all();
  } catch { return []; }
}

/**
 * The caution with the document it belongs to, read from the registry by
 * TITLE. The number is Document Control's (the live registry carries it as
 * SOP 415 V2 while the seeded DCR log says SOP 417), so it is looked up rather
 * than written into code; `document_source` says whether it was found.
 */
export function cautionWithDocument(db) {
  const row = (() => {
    try {
      return db.prepare(`SELECT doc_number, revision, title FROM sop_documents
        WHERE lower(title) LIKE '%equipment calibration%' AND status NOT IN ('archived','superseded')
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get() || null;
    } catch { return null; }
  })();
  return {
    ...SCALE_CAUTION,
    document: row?.doc_number ? String(row.doc_number).trim() : null,
    revision: row?.revision || null,
    document_title: row?.title || SCALE_CAUTION.document_title,
    document_source: row ? 'register' : 'not_found',
  };
}
