// GET /api/records — the record interface's read side (D-207, move 02).
//
// One list across every record type that implements the interface, each row
// described the same way: form, what, where, who, when, result, who signed.
// The seed of move 04's single retrieval surface.
//
// READ ONLY, and mounted WITHOUT requireModuleWrite: each type is read only by
// someone who can open that type's module (`canReadType`), so the module guard
// would be a second, coarser copy of the same rule. Filing, signing and revoking
// stay on each module's own routes, which already hold the password gate.
import { Router } from 'express';
import { getDb } from '../db.js';
import { RECORD_TYPES, INTERFACE, canReadType, recordType, retrieveRecords } from '../record-interface.js';
import { renderSignedRecord } from '../signed-record-pdf.js';

const router = Router();

// The adopted types this person may read, and what each implements.
router.get('/types', (req, res) => {
  res.json(RECORD_TYPES.filter(t => canReadType(req.user, t)).map(t => ({
    type: t.type, label: t.label, implements: INTERFACE.filter(k => typeof t[k] === 'function'),
  })));
});

router.get('/', (req, res) => {
  if (req.query.type && !String(req.query.type).split(',').every(recordType)) {
    return res.status(400).json({ error: `Unknown record type. Known: ${RECORD_TYPES.map(t => t.type).join(', ')}.` });
  }
  res.json(retrieveRecords(getDb(), req.user, req.query));
});

// One record printed, every signature with its meaning (D-293). The same
// read rule as the description below.
router.get('/:type/:id/pdf', (req, res) => {
  const t = recordType(req.params.type);
  if (!t || !canReadType(req.user, t)) return res.status(404).json({ error: 'Not found' });
  const row = t.get(getDb(), req.params.id);
  if (!row || !t.canRead(req.user, row)) return res.status(404).json({ error: 'Not found' });
  renderSignedRecord(res, t.describe(row), { printedBy: req.user?.name });
});

// One record, described. 404 for a record the caller may not read — a 403
// would confirm it exists.
router.get('/:type/:id', (req, res) => {
  const t = recordType(req.params.type);
  if (!t || !canReadType(req.user, t)) return res.status(404).json({ error: 'Not found' });
  const db = getDb();
  const row = t.get(db, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!t.canRead(req.user, row)) return res.status(404).json({ error: 'Not found' });
  res.json(t.describe(row));
});

export default router;
