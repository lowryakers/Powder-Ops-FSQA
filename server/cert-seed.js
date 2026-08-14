// The team's real professional certificates, filed in the Certifications
// module the same way a hand upload would file them — one row per certificate,
// the PDF as the evidence, the text inside it extracted so search finds a
// certificate number or a course title printed on the paper.
//
// THE FILES LIVE IN server/assets/certifications, NOT public/ — they carry
// people's names and certificate numbers and must only be served through the
// authenticated module route. The extracted text is baked beside each PDF as
// a .txt (same pattern as the reference library) so seeding needs no PDF
// parser at boot.
//
// ONE-TIME, flagged in app_settings — not per-row insert-only. These are
// records about people: if QA deletes one (someone leaves, a cert is
// superseded), a redeploy must not resurrect it. Within the single run, a
// certificate the plant already entered by hand (same person + type) is left
// alone rather than doubled.
//
// person_name uses the ROSTER's spelling, not the certificate's ("Adam
// Bliss", not "Adam M Bliss") — the record should read like every other
// ReadyDoc record; the certificate's own wording survives in extracted_text
// and the notes. Dates are the completion dates printed on the certificates;
// none of these carry an expiry, so none is invented.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID as uuid } from 'crypto';

export const CERT_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'certifications');

const CERTS = [
  {
    person: 'Adam Bliss', cert_type: 'HACCP', issuer: 'AIB International',
    issued: '2025-10-21', file: 'adam-bliss-haccp-aib-2025',
    notes: 'HACCP Online — 9.0 contact hours, 0.9 CEUs.',
  },
  {
    person: 'Adam Bliss', cert_type: 'PCQI', issuer: 'AIB International',
    issued: '2021-05-03', file: 'adam-bliss-pcqi-aib-2021',
    notes: 'PCQI Online Version 2.0 — 9.0 contact hours, 0.9 CEUs. Certificate names Adam M Bliss.',
  },
  {
    person: 'Carol Rojas', cert_type: 'Food Defense Coordinator', issuer: 'AIB International',
    issued: '2024-10-13', file: 'carol-rojas-food-defense-coordinator-aib-2024',
    notes: 'Food Defense Coordinator Online — 11.0 contact hours, 1.1 CEUs. Certificate names Carol M Rojas.',
  },
  {
    person: 'Carol Rojas', cert_type: 'PCQI', issuer: 'FSPCA', cert_number: '9c63bc5f',
    issued: '2017-11-16', file: 'carol-rojas-pcqi-fspca-2017',
    notes: 'FSPCA Preventive Controls for Human Food, delivered by Lead Instructor Arthur-John Clifford.',
  },
  {
    person: 'Maria Servin', cert_type: 'HACCP (Basic)', issuer: 'Zosi Learning',
    cert_number: '8382f613-0127-431b-8303-eef7fb88cf33',
    issued: '2026-03-23', file: 'maria-servin-basic-haccp-zosi-2026',
    notes: 'Basic HACCP Certification — accredited course; verifiable at zosilearning.com/verify.',
  },
  {
    person: 'Maria Servin', cert_type: 'HACCP (Advanced)', issuer: 'Zosi Learning',
    cert_number: '4e02216d-bbd8-45e3-9371-3bfa03986c73',
    issued: '2026-03-23', file: 'maria-servin-advanced-haccp-zosi-2026',
    notes: 'Advanced HACCP Certification — accredited course; verifiable at zosilearning.com/verify.',
  },
];

export function seedCertifications(db) {
  try {
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'certifications_seed_v1'").get()) return 0;
    const exists = db.prepare(
      'SELECT 1 FROM certifications WHERE LOWER(person_name) = LOWER(?) AND LOWER(cert_type) = LOWER(?)');
    const ins = db.prepare(`INSERT INTO certifications
      (id, person_name, cert_type, issuer, cert_number, issued_date, expiry_date, notes,
       filename, asset_file, content_type, extracted_text, created_by)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'application/pdf', ?, 'system')`);
    let added = 0;
    for (const c of CERTS) {
      if (exists.get(c.person, c.cert_type)) continue;
      const pdf = `${c.file}.pdf`;
      if (!existsSync(join(CERT_ASSETS_DIR, pdf))) continue; // asset missing — don't file a row with no evidence
      let text = '';
      try { text = readFileSync(join(CERT_ASSETS_DIR, `${c.file}.txt`), 'utf8'); } catch { /* searchable by metadata only */ }
      ins.run(uuid(), c.person, c.cert_type, c.issuer, c.cert_number || null, c.issued, c.notes, pdf, pdf, text);
      added++;
    }
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('certifications_seed_v1', ?)").run(new Date().toISOString());
    if (added) console.log(`[seed] Certifications: filed ${added} certificate(s)`);
    return added;
  } catch (e) {
    console.warn('[seed] certifications seed failed:', e.message);
    return 0;
  }
}
