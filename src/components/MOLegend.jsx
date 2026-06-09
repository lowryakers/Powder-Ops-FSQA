export default function MOLegend({ moColorMap, label = 'Manufacturing Orders' }) {
  const entries = Object.entries(moColorMap);
  if (!entries.length) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{label} ({entries.length})</h3>
      <div className="flex flex-wrap gap-2">
        {entries.map(([mo, color]) => (
          <span
            key={mo}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}35` }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            {mo}
          </span>
        ))}
      </div>
    </div>
  );
}
