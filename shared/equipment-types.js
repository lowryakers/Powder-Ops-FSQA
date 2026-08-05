/**
 * The equipment vocabulary, in one place.
 *
 * It used to live only in EquipmentPanel.jsx, which was fine while nothing else
 * needed it — then the setup checklist had to decide "does this thing have a
 * lockout point", kept a server-side copy, and guessed at the spellings
 * ('tool' for what the app calls 'Hand Tool'). Now it sits in `shared/` and is
 * imported by the form, the checklist and the boot migrations alike, like
 * rich-markup.js.
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
 * Types that describe an AREA rather than a machine.
 *
 * 39 of the plant's 183 equipment rows are these — BPG inspection zones, light
 * fixture zones, sanitation zones, environmental monitoring points. They belong
 * in the equipment table: `pm_schedules.equipment_id` is NOT NULL and a zone
 * genuinely needs a recurring schedule, so pulling them out would mean a second
 * copy of the PM machinery for things that already work correctly.
 *
 * THIS LIST IS NOT THE RUNTIME AUTHORITY. `equipment.asset_kind` is — a column
 * somebody can set and correct. This list only supplies the DEFAULT when a new
 * row is created with one of these types, and the one-time backfill that
 * classified the existing rows. Inferring the distinction from a free-text type
 * at read time is what let a zone typed slightly differently turn into a machine
 * owing a lockout procedure, a training course and a work instruction.
 *
 * They were also missing from the type dropdown, which is worse than cosmetic:
 * a `<select>` whose value isn't among its options falls back to the FIRST one,
 * so opening a BPG zone in the edit form and saving would silently retype it as
 * 'A/C'. Same trap as the retired rooms in the Production Log.
 */
export const ZONE_TYPES = ['Inspection Zone', 'Light Fixture Zone', 'Cleaning Zone', 'Monitoring'];

export const EQUIPMENT_TYPES = [...MACHINE_TYPES, ...ZONE_TYPES];

export const ASSET_KINDS = ['machine', 'zone'];

const norm = (t) => String(t || '').trim().toLowerCase();
const has = (list, t) => list.some(x => norm(x) === norm(t));

/** The default classification for a NEW row of this type. Never a read-time answer. */
export const defaultAssetKind = (type) => (has(ZONE_TYPES, type) ? 'zone' : 'machine');

export const isZone = (equipment) => equipment?.asset_kind === 'zone';

/**
 * Types that measure, and therefore want a calibration record.
 *
 * Matched on the type only — matching the free-text NAME as well meant anything
 * with "scale" in its name (a scale-mounted hopper) was told it needed its own
 * calibration instrument. Unlike LOTO this has no column of its own, because
 * the calibration step is a recommendation rather than a safety requirement;
 * if it ever needs a per-machine override, give it one rather than widening
 * this list.
 */
export const CALIBRATED_TYPES = ['Scale', 'Metal Detector', 'X-Ray'];

export const needsCalibration = (eq) => !isZone(eq) && has(CALIBRATED_TYPES, eq?.type);

/**
 * Does anyone get trained to operate this?
 *
 * A zone isn't operated, and neither is a hand scoop. Everything else is asked.
 */
export const needsTraining = (eq) => !isZone(eq) && norm(eq?.type) !== 'hand tool';

/**
 * Does this need a lockout/tagout procedure?
 *
 * `equipment.loto_required` is the authority and defaults to 1 — the LOTO
 * module and the compliance badge have always read it, so re-deriving it from
 * a type string here is how the setup checklist ended up disagreeing with both.
 * The asymmetry also argues for reading a column that defaults to "yes":
 * wrongly ASKING for a lockout procedure costs someone a moment marking it not
 * required, while wrongly omitting it means nothing ever says it is missing.
 */
export const needsLoto = (eq) => eq?.loto_required !== 0 && eq?.loto_required !== false;
