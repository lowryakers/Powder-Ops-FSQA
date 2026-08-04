// Where the weights go on the scale.
//
// Reproduces the placement diagram from the plant's Scale Calibration
// Verification procedure sheet: the centre point, and two diagonal pairs of
// corner points — you use the centre plus EITHER diagonal, which is what their
// key says ("🔴 and 🔶 OR 🔴 and 🔺"). Same colours and same geometry, so it
// reads as the same picture.
//
// Drawn as SVG rather than embedding the scan for the reason the process maps
// are data and not pictures: this is looked at on a phone next to a scale. It
// stays sharp at any size, it prints, and — the part a scan can't do — it
// carries THIS form's weights, so a Batching operator reads "25 kg" where a
// Kitting operator reads "50 g" from the same component.
//
// The numbers match the written steps above it: 1 in the centre (the minimum),
// 2 at a corner (running total = target), 3 at the opposite corner (running
// total = maximum). The weights are cumulative — nothing is taken off between
// points — which is why 2 and 3 are labelled with the running total.

const C = {
  platform: '#e9eaec',
  platformEdge: '#9aa0a6',
  grid: '#c3c8ce',
  red: '#ef4444',
  redEdge: '#b91c1c',
  amber: '#fbbf24',
  amberEdge: '#b45309',
  green: '#22c55e',
  greenEdge: '#15803d',
};

// A diamond (their yellow marker) as a rotated square.
function Diamond({ x, y, label }) {
  const r = 15;
  return (
    <g>
      <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
        fill={C.amber} stroke={C.amberEdge} strokeWidth="2" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="#78350f">{label}</text>
    </g>
  );
}

// A triangle (their green marker).
function Triangle({ x, y, label }) {
  const r = 16;
  return (
    <g>
      <polygon points={`${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`}
        fill={C.green} stroke={C.greenEdge} strokeWidth="2" />
      <text x={x} y={y + 10} textAnchor="middle" fontSize="12" fontWeight="700" fill="#052e16">{label}</text>
    </g>
  );
}

function Swatch({ kind }) {
  return kind === 'diamond'
    ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><polygon points="8,1 15,8 8,15 1,8" fill={C.amber} stroke={C.amberEdge} strokeWidth="1.5" /></svg>
    : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><polygon points="8,1 15,13 1,13" fill={C.green} stroke={C.greenEdge} strokeWidth="1.5" /></svg>;
}

const Dot = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6.5" fill={C.red} stroke={C.redEdge} strokeWidth="1.5" />
  </svg>
);

export default function ScalePlacementDiagram({ points = [], unit = '' }) {
  // Running totals: the weights stay on, so point 2 reads as the target and
  // point 3 as the maximum — the same numbers printed on the form.
  const w = (i) => (points[i] ? `${points[i].nominal} ${unit}` : null);

  return (
    <div className="space-y-2">
      <svg viewBox="0 0 300 250" className="w-full max-w-[300px] mx-auto block" role="img"
        aria-label="Scale platform showing the centre weight position and two diagonal pairs of corner positions">
        {/* platform */}
        <rect x="30" y="20" width="240" height="200" rx="20" fill={C.platform} stroke={C.platformEdge} strokeWidth="2.5" />
        {/* quadrant lines */}
        <line x1="150" y1="20" x2="150" y2="220" stroke={C.grid} strokeWidth="1.5" />
        <line x1="30" y1="120" x2="270" y2="120" stroke={C.grid} strokeWidth="1.5" />
        {/* the two diagonals */}
        <line x1="45" y1="35" x2="255" y2="205" stroke={C.platformEdge} strokeWidth="1.5" strokeDasharray="6 5" />
        <line x1="255" y1="35" x2="45" y2="205" stroke={C.platformEdge} strokeWidth="1.5" strokeDasharray="6 5" />

        {/* one diagonal: diamonds */}
        <Diamond x={88} y={66} label="2" />
        <Diamond x={212} y={174} label="3" />
        {/* the other diagonal: triangles */}
        <Triangle x={212} y={66} label="2" />
        <Triangle x={88} y={174} label="3" />

        {/* centre — always used, always first */}
        <circle cx="150" cy="120" r="19" fill={C.red} stroke={C.redEdge} strokeWidth="2.5" />
        <text x="150" y="126" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">1</text>

        <text x="150" y="243" textAnchor="middle" fontSize="12" fill="#6b7280">
          Centre first, then two opposite corners
        </text>
      </svg>

      <div className="text-xs text-gray-700 space-y-1.5">
        {/* Each pair stays on one line — an "OR" that wraps away from the
            thing it separates reads as a third option. */}
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
          <span className="font-semibold">Use the centre plus either diagonal:</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Dot /> and <Swatch kind="diamond" /></span>
          <span className="text-gray-400 font-semibold">OR</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Dot /> and <Swatch kind="triangle" /></span>
        </div>
        <ul className="space-y-0.5 text-gray-600">
          <li><span className="font-semibold text-gray-800">1</span> — centre{w(0) ? `: place ${w(0)}` : ''}</li>
          <li><span className="font-semibold text-gray-800">2</span> — a corner{w(1) ? `: add weight to reach ${w(1)}` : ''}</li>
          <li><span className="font-semibold text-gray-800">3</span> — the opposite corner{w(2) ? `: add weight to reach ${w(2)}` : ''}</li>
        </ul>
        <p className="text-gray-500">Nothing comes off between points — the readings are the running total.</p>
      </div>
    </div>
  );
}
