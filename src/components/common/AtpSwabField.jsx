import AtpLimitHint from './AtpLimitHint.jsx';

/**
 * THE ATP READING BOX — ONE DEFINITION, WHEREVER A SWAB IS EXPECTED.
 *
 * It began inside the Operator View's `production_clean` branch, reached by a
 * title regex matching three seeder-written words; D-112 moved the verdict to
 * the server (`swab_plan`, from `server/clean-swabs.js`) so the floor screen
 * could stop keeping its own list of titles. The box itself stayed private to
 * that file — and the Task Center, which completes the same tasks through the
 * same endpoint, asked for no reading at all. Every Production Line Pre-Op
 * finished at a desk therefore filed with `atp_reading` NULL and `atp_limit`
 * NULL: "ATP —" on a record graded against nothing.
 *
 * So the box lives here and both screens import it. A second copy is how one
 * of them quietly stops asking again.
 *
 * It enforces nothing. `AtpLimitHint` says what is about to happen while there
 * is still time to act on it; the server decides, and a missing reading is a
 * gap rather than a failure (D-020).
 */
export default function AtpSwabField({ value, onChange, lang = 'en', label }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label || (lang === 'es' ? 'Lectura ATP (RLU)' : 'ATP swab reading (RLU)')}
      </label>
      <input type="number" step="any" value={value || ''} onChange={e => onChange(e.target.value)}
        data-atp-field
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 10" />
      <AtpLimitHint value={value} lang={lang} />
    </div>
  );
}
