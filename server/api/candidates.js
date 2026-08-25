import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { coerceCustomData, mergeCustomData } from '../custom-fields.js';

// People we would like to work with, when the timing is right.
//
// A small tracker, and small on purpose. The plant hires rarely and has low
// turnover, so what is worth keeping is not a pipeline but a memory: who was
// good, who vouched for them, and how to reach them in eighteen months. There
// are no stages, no requisitions, no vacancies and no automated anything.
//
// THE ACCESS RULE IS THE MOST IMPORTANT THING IN THIS FILE. Every row is
// personal data about somebody who does not work here — a mobile number, whose
// daughter they are, whether they are currently out of work. It is not a
// compliance record; no auditor asks for it and nothing else depends on it. So
// it is confined to the people whose job it actually is, at the mount, rather
// than left to a module grant that could reach a supervisor by accident.

const router = Router();

// Office and HR keep this list; admins can reach everything. Deliberately NOT
// `canEditModule(user, 'candidates')` — a module grant is something an admin
// ticks in a hurry, and this is the one list where a wrong tick hands somebody
// the whole plant's contact network.
export function mayUseCandidates(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return ['office', 'hr'].includes(String(user.department || '').toLowerCase());
}

router.use((req, res, next) => {
  if (!mayUseCandidates(req.user)) {
    return res.status(403).json({ error: 'The candidate list is kept by the office. Ask an admin if you need access.' });
  }
  next();
});

// Five, and each is a different answer somebody actually gives. "Interviewed"
// is deliberately absent — that is a DATE, and "interviewed in March" answers a
// question that a tick never could.
export const STATUSES = [
  { value: 'prospect', label: 'Prospect', hint: 'Worth a conversation' },
  { value: 'keep_warm', label: 'Keep warm', hint: "We'd hire them when the timing is right" },
  { value: 'not_a_fit', label: 'Not a fit', hint: 'We spoke and it was not right' },
  { value: 'hired', label: 'Hired', hint: 'They work here now' },
  { value: 'unavailable', label: 'Unavailable', hint: 'Happy where they are, or moved on' },
];
const STATUS_VALUES = STATUSES.map(s => s.value);

// Kept as typed AND normalised for dialling. Marnee's sheet holds
// "3858663869", "13854553558" and "18018335033" — the same ten digits with and
// without a country code — so the last ten are what make a `tel:` link work and
// what makes two entries for one person findable.
export function digitsOf(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
export function prettyPhone(phone) {
  const d = digitsOf(phone);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(phone || '');
}

const parseAreas = (v) => {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') {
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(String); } catch { /* not JSON */ }
    // "cleaning/Maintenance" in one cell is two areas, and splitting it is the
    // difference between finding her under Cleaning and not finding her at all.
    return v.split(/[/,;]/).map(s => s.trim()).filter(Boolean);
  }
  return [];
};

const shape = (r) => ({
  ...r,
  areas: (() => { try { return JSON.parse(r.areas || '[]'); } catch { return []; } })(),
  custom_data: (() => { try { return JSON.parse(r.custom_data || '{}'); } catch { return {}; } })(),
  phone_display: prettyPhone(r.phone),
  phone_digits: digitsOf(r.phone),
});

router.get('/', (req, res) => {
  const db = getDb();
  const { q, status, area, limit } = req.query;
  let sql = 'SELECT * FROM candidates WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (area) { sql += ' AND areas LIKE ?'; params.push(`%${area}%`); }
  if (q) {
    // Notes are searched too, and that is the point: "Reina's previous
    // coworker" is how somebody is actually remembered, not by their job title.
    const clauses = [`LOWER(name) LIKE LOWER(?)`, `LOWER(COALESCE(company,'')) LIKE LOWER(?)`,
      `LOWER(COALESCE(title,'')) LIKE LOWER(?)`, `LOWER(COALESCE(notes,'')) LIKE LOWER(?)`,
      `LOWER(COALESCE(referred_by,'')) LIKE LOWER(?)`];
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
    // THE PHONE CLAUSE ONLY EXISTS WHEN THE QUERY HAS DIGITS IN IT. Stripping
    // non-digits from "Reina" leaves an empty string, and `LIKE '%%'` matches
    // every row — so an OR'd phone clause quietly turned every text search into
    // "show me everyone". Caught by searching for a word, not a number.
    const digits = String(q).replace(/\D/g, '');
    if (digits) {
      clauses.push(`REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'-',''),' ',''),'(',''),')','') LIKE ?`);
      params.push(`%${digits}%`);
    }
    sql += ` AND (${clauses.join(' OR ')})`;
  }
  // Bounded like every other list endpoint here.
  sql += ' ORDER BY name COLLATE NOCASE LIMIT ?';
  params.push(Math.min(Number(limit) || 500, 1000));
  res.json(db.prepare(sql).all(...params).map(shape));
});

router.get('/meta', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT status, areas FROM candidates').all();
  const areas = new Map();
  for (const r of rows) {
    try { for (const a of JSON.parse(r.areas || '[]')) areas.set(a, (areas.get(a) || 0) + 1); } catch { /* skip */ }
  }
  res.json({
    statuses: STATUSES,
    counts: STATUS_VALUES.reduce((acc, s) => ({ ...acc, [s]: rows.filter(r => r.status === s).length }), {}),
    total: rows.length,
    // Offered as suggestions, never as a closed list — Marnee types the area
    // she means and a new one simply appears next time.
    areas: [...areas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count })),
  });
});

router.get('/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(shape(row));
});

function writable(body, db, existing) {
  const status = body.status || existing?.status || 'prospect';
  if (!STATUS_VALUES.includes(status)) throw new Error(`Unknown status "${status}"`);
  return {
    name: String(body.name ?? existing?.name ?? '').trim(),
    title: body.title ?? existing?.title ?? null,
    company: body.company ?? existing?.company ?? null,
    areas: JSON.stringify(parseAreas(body.areas ?? existing?.areas)),
    phone: body.phone ?? existing?.phone ?? null,
    email: body.email ?? existing?.email ?? null,
    referred_by: body.referred_by ?? existing?.referred_by ?? null,
    interviewed_on: body.interviewed_on ?? existing?.interviewed_on ?? null,
    last_contacted_on: body.last_contacted_on ?? existing?.last_contacted_on ?? null,
    status,
    notes: body.notes ?? existing?.notes ?? null,
    // `coerceCustomData(db, scope, raw)` returns `{ data, errors }` and
    // `mergeCustomData(existingRaw, incoming)` takes two arguments — checked
    // against the module rather than copied from a caller, because two of the
    // existing callers pass the wrong shapes.
    custom_data: JSON.stringify(
      (existing
        ? mergeCustomData(existing.custom_data, coerceCustomData(db, 'candidate', body.custom_data).data)
        : coerceCustomData(db, 'candidate', body.custom_data).data) || {}),
  };
}

router.post('/', (req, res) => {
  const db = getDb();
  let f;
  try { f = writable(req.body, db, null); } catch (e) { return res.status(400).json({ error: e.message }); }
  // A NAME IS THE ONLY REQUIRED FIELD. Two of the seven rows in the sheet this
  // replaces are a first name and a phone number — "Vanessa, cleaning,
  // reference from Romina" is a real and useful entry, and a form that refuses
  // it is a form somebody keeps a private list instead of.
  if (!f.name) return res.status(400).json({ error: 'A name is needed — everything else can come later.' });
  const id = uuid();
  db.prepare(`INSERT INTO candidates (id, name, title, company, areas, phone, email, referred_by,
      interviewed_on, last_contacted_on, status, notes, custom_data, source, external_id, created_by, updated_by)
    VALUES (@id, @name, @title, @company, @areas, @phone, @email, @referred_by,
      @interviewed_on, @last_contacted_on, @status, @notes, @custom_data, @source, @external_id, @by, @by)`)
    .run({ ...f, id, source: req.body.source || null, external_id: req.body.external_id || null, by: req.user.name });
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'candidate', id, null, null, row, row.name);
  res.status(201).json(shape(row));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  let f;
  try { f = writable(req.body, db, existing); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!f.name) return res.status(400).json({ error: 'A name is needed.' });
  db.prepare(`UPDATE candidates SET name=@name, title=@title, company=@company, areas=@areas,
      phone=@phone, email=@email, referred_by=@referred_by, interviewed_on=@interviewed_on,
      last_contacted_on=@last_contacted_on, status=@status, notes=@notes, custom_data=@custom_data,
      updated_by=@by, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...f, id: req.params.id, by: req.user.name });
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'candidate', row.id, null, existing, row, row.name);
  res.json(shape(row));
});

// DELETED, NOT RETIRED — the opposite of the rule everywhere else here, and
// deliberately so. A candidate row is somebody's phone number and a note about
// their family; it is not evidence of anything and nothing references it. If a
// person asks to come off the list, or the note turns out to be wrong, the row
// should go. The audit entry keeps who removed it and when, which is the part
// worth keeping.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM candidates WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'candidate', req.params.id, { name: existing.name }, existing, null, existing.name);
  res.json({ ok: true });
});

export default router;
