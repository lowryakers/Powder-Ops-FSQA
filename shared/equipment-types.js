/**
 * The equipment type vocabulary, in one place.
 *
 * It used to live only in EquipmentPanel.jsx, which was fine while nothing else
 * needed it — then the setup checklist had to decide "does this thing have a
 * lockout point", guessed at the spellings ('tool' for what the app calls
 * 'Hand Tool'), and silently asked a plastic scoop for a LOTO procedure. A
 * server-side copy of a client list is the same bug waiting to happen again, so
 * this sits in `shared/` and is imported by both, like rich-markup.js.
 */
export const MACHINE_TYPES = [
  'A/C', 'Auger', 'Coder', 'Compressor', 'Conveyor', 'Cooler', 'Dehumidifier',
  'Dust Collector', 'Fan', 'Feeder', 'Filler', 'Forklift', 'Forklift Charger',
  'Hand Tool', 'Heat Tunnel', 'HEPA Filter', 'Hydraulic Lift', 'Metal Detector',
  'Mixer', 'Oven', 'Pallet Jack', 'Pallet Wrapper', 'Pump', 'Scale',
  'Scissor Lift', 'Sealer', 'Shop Vac', 'Sifter', 'Tank', 'Tape Machine',
  'Turn Table', 'X-Ray', 'Other',
];

/**
 * Rows in `equipment` that are not machines.
 *
 * 39 of the plant's 183 equipment records are inspection or cleaning ZONES —
 * BPG zones, light fixture zones, sanitation zones, environmental monitoring
 * points. They live in this table because the PM generator needs something to
 * hang a recurring schedule on, which is legitimate; what they are not is
 * equipment somebody operates. Asking a light fixture zone for a lockout
 * procedure, a training course and a work instruction is precisely the noise
 * that teaches people a checklist is worth ignoring.
 *
 * They were also missing from the type dropdown entirely, which is worse than
 * cosmetic: a `<select>` whose value isn't among its options falls back to the
 * FIRST one, so opening a BPG zone in the edit form and saving would silently
 * retype it as 'A/C'. Same trap as the retired rooms in the Production Log.
 */
export const ZONE_TYPES = ['Inspection Zone', 'Light Fixture Zone', 'Cleaning Zone', 'Monitoring'];

export const EQUIPMENT_TYPES = [...MACHINE_TYPES, ...ZONE_TYPES];

/**
 * Types with no stored energy source to lock out.
 *
 * DELIBERATELY ALMOST EMPTY. This decides whether a safety step is asked for,
 * and the asymmetry is stark: wrongly asking for a LOTO procedure costs someone
 * a moment deciding it doesn't apply, while wrongly omitting it means nothing
 * ever says the procedure is missing. So only what plainly has no lockout point
 * is listed, and 'Other' is not — an unknown type gets asked.
 */
export const NO_LOTO_TYPES = ['Hand Tool'];

// Things nobody is trained to "operate". Same reasoning, less at stake.
export const NO_TRAINING_TYPES = ['Hand Tool'];

/**
 * Types that measure, and therefore need a calibration record.
 *
 * Matched against the type only — matching the free-text NAME as well meant
 * anything with "scale" in its name (a scale-mounted hopper) was told it needed
 * its own calibration instrument.
 */
export const CALIBRATED_TYPES = ['Scale', 'Metal Detector', 'X-Ray'];

const norm = (t) => String(t || '').trim().toLowerCase();
const has = (list, t) => list.some(x => norm(x) === norm(t));

export const isZone = (type) => has(ZONE_TYPES, type);

// A zone is scheduled and inspected, and that is the whole of it — so it keeps
// the PM steps and is asked for none of the rest.
export const needsLoto = (type) => !isZone(type) && !has(NO_LOTO_TYPES, type);
export const needsTraining = (type) => !isZone(type) && !has(NO_TRAINING_TYPES, type);
export const needsCalibration = (type) => !isZone(type) && has(CALIBRATED_TYPES, type);
