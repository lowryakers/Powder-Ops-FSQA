// A controlled value changed IN THE APP (D-328).
//
// Until now a controlled value — the ATP limit, the temperature and humidity
// limits, the dilution chemicals and ranges, the scale tolerances — could only be
// changed in code. Document Control approved the change, but only a developer
// could make it. An entry that declares `editable(snapshot)` can now be changed
// on the Controlled Changes screen: Document Control proposes the new value, a
// QA supervisor reviews it with their password, and it is approved with a
// password — the same three steps as an SOP revision (D-319). Approving puts it
// in use at once, and `afterApply` moves anything that follows it.
//
// PURE: snapshots in, snapshots out. The routes in api/controlled.js write.

// A path is dot-separated; `name[x]` picks an array element — by index when x is
// a number, otherwise the element whose `key` is x.
function step(obj, seg) {
  const m = seg.match(/^([^[]+)\[([^\]]+)\]$/);
  if (!m) return { parent: obj, prop: seg };
  const arr = obj?.[m[1]];
  if (!Array.isArray(arr)) return { parent: undefined, prop: null };
  const idx = /^\d+$/.test(m[2]) ? Number(m[2]) : arr.findIndex(e => e && e.key === m[2]);
  return { parent: arr, prop: idx };
}
export function getAt(obj, path) {
  let cur = obj;
  for (const seg of String(path).split('.')) {
    const { parent, prop } = step(cur, seg);
    if (parent === undefined || prop === null || prop === -1) return undefined;
    cur = parent[prop];
  }
  return cur;
}
export function setAt(obj, path, value) {
  const segs = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    const { parent, prop } = step(cur, segs[i]);
    if (parent === undefined || prop === null || prop === -1) return false;
    if (i === segs.length - 1) { parent[prop] = value; return true; }
    cur = parent[prop];
  }
  return false;
}

/** What the screen draws: each field with the value in force. */
export function editableFields(entry, snapshot) {
  if (typeof entry?.editable !== 'function' || !snapshot) return [];
  return entry.editable(snapshot).map(f => ({ ...f, value: getAt(snapshot, f.path) ?? null }));
}

function coerce(field, raw) {
  const blank = raw === null || raw === undefined || String(raw).trim() === '';
  if (field.type === 'number') {
    if (blank) return field.optional ? { value: null } : { error: `${field.label} is required.` };
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) return { error: `${field.label} must be a number.` };
    return { value: n };
  }
  if (blank) return field.optional ? { value: null } : { error: `${field.label} is required.` };
  return { value: String(raw).trim() };
}

/**
 * The proposed snapshot: the APPROVED one with the typed values put in. Returns
 * { snapshot, changes:[{path,label,from,to}], errors:[] }.
 */
export function buildProposal(entry, approved, values) {
  const fields = editableFields(entry, approved);
  const snapshot = JSON.parse(JSON.stringify(approved));
  const errors = [];
  const changes = [];
  for (const f of fields) {
    if (!values || !Object.prototype.hasOwnProperty.call(values, f.path)) continue;
    const c = coerce(f, values[f.path]);
    if (c.error) { errors.push(c.error); continue; }
    const from = f.value ?? null;
    if (c.value === from) continue;
    setAt(snapshot, f.path, c.value);
    changes.push({ path: f.path, label: f.label, from, to: c.value });
  }
  if (!errors.length && typeof entry.validate === 'function') errors.push(...(entry.validate(snapshot) || []));
  return { snapshot, changes, errors };
}
