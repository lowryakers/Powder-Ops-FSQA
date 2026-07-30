import { useApiGet } from '../../hooks/useApi';

// Renders the user-added fields for a scope — the client half of the self-serve
// structure engine. A module opts in with two lines: <CustomFields> in its form
// and <CustomFieldValues> on its record display. Nothing about a new field
// requires touching the module again.

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

// One input, typed. Mirrors the server's FIELD_TYPES exactly.
export function CustomFieldInput({ field, value, onChange }) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        {field.label}{field.required && ' *'}
      </label>
    );
  }
  return (
    <div className={field.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      {field.type === 'select' ? (
        <select required={field.required} value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls}>
          <option value="">Select…</option>
          {(field.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea required={field.required} value={value ?? ''} onChange={e => onChange(e.target.value)} rows={2} className={inputCls} />
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          step={field.type === 'number' ? 'any' : undefined}
          required={field.required}
          value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls} />
      )}
      {field.help_text && <p className="mt-0.5 text-[11px] text-gray-500">{field.help_text}</p>}
    </div>
  );
}

// The whole active field set for a scope. Renders nothing at all when the team
// hasn't added any, so a module carries no visual cost for opting in.
export function CustomFields({ scope, values, onChange, title }) {
  const { data: fields } = useApiGet(`/structure/fields/${encodeURIComponent(scope)}`, [scope]);
  if (!fields?.length) return null;
  const set = (k, v) => onChange({ ...(values || {}), [k]: v });
  return (
    <div className="rounded-lg border border-powder-200 bg-powder-50/50 p-3">
      {title && <p className="text-xs font-semibold text-powder-800 mb-2">{title}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {fields.map(f => (
          <CustomFieldInput key={f.key} field={f} value={values?.[f.key]} onChange={v => set(f.key, v)} />
        ))}
      </div>
    </div>
  );
}

// Read-only display on a filed record. Includes values whose field has since
// been retired (and any orphaned key) so nothing already recorded goes
// invisible — the same rule the server enforces in describeCustomData.
export function CustomFieldValues({ scope, data, className = '' }) {
  const { data: fields } = useApiGet(`/structure/fields/${encodeURIComponent(scope)}?all=1`, [scope]);
  if (!data || typeof data !== 'object') return null;
  const defs = fields || [];
  const known = new Set(defs.map(d => d.key));
  const blank = (v) => v === '' || v === null || v === undefined;
  const fmt = (def, v) => {
    if (def.type === 'checkbox') return v ? 'Yes' : 'No';
    if (def.type === 'select') return (def.options || []).find(o => o.value === String(v))?.label || String(v);
    return String(v);
  };
  const shown = [
    ...defs.filter(d => !blank(data[d.key])).map(d => ({ key: d.key, label: d.label, value: fmt(d, data[d.key]) })),
    ...Object.keys(data).filter(k => !known.has(k) && !blank(data[k]))
      .map(k => ({ key: k, label: k.replace(/_/g, ' '), value: String(data[k]) })),
  ];
  if (!shown.length) return null;
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 ${className}`}>
      {shown.map(f => (
        <div key={f.key} className="text-xs text-gray-700">
          <span className="text-gray-400">{f.label}:</span> {f.value}
        </div>
      ))}
    </div>
  );
}
