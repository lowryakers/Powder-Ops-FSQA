const MO_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#a855f7', '#0ea5e9', '#d946ef',
  '#65a30d', '#ea580c', '#7c3aed', '#0d9488', '#dc2626',
];

export function buildMOColorMap(entries) {
  const uniqueMOs = [...new Set(entries.map((e) => e.mo || e).filter(Boolean))].sort();
  const map = {};
  uniqueMOs.forEach((mo, i) => {
    map[mo] = MO_PALETTE[i % MO_PALETTE.length];
  });
  return map;
}

export function getMOColor(moColorMap, mo) {
  if (!mo || !moColorMap[mo]) return { bg: '#f3f4f6', border: '#e5e7eb', text: '#6b7280' };
  const color = moColorMap[mo];
  return { bg: `${color}12`, border: `${color}40`, text: color };
}
