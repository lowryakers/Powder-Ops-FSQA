// Where the weights go on the scale.
//
// Reproduces the placement diagram on the plant's Scale Calibration
// Verification procedure sheet: a square platform divided into quadrants, with
// the three placement points in a row ACROSS THE CENTRE LINE — yellow diamond
// to one side, red circle dead centre, green triangle to the other. Its key
// reads "For weight placement use either points: ◇ and ● and ▲".
//
// THIS REPLACED A DIFFERENT PICTURE, and the difference is physical.
//
// The previous sheet placed the second and third weights at two OPPOSING
// CORNERS on a diagonal, and offered a choice of diagonal ("● and ◆ OR ● and
// ▲"). The current one puts them either side of the centre weight on the
// horizontal axis, and uses all three points rather than choosing between two
// sets. That matches the wording of the procedure it sits beside — "add the
// second weight(s) on both sides of the first weight(s)", "add the third
// weight(s) on the sides of the center weight" — where the old text said "at a
// corner" and "at the opposite corner". An operator following the old diagram
// against the current form would be loading the scale in the wrong places.
//
// Drawn as SVG rather than embedding the scan, for the reason the process maps
// are data and not pictures: this is looked at on a phone next to a scale. It
// stays sharp at any size, it prints, and — the part a scan cannot do — it
// carries THIS form's weights, so a Batching operator reads "25 kg" where a
// Kitting operator reads "50 g" from the same component. The scan itself is
// linked from the procedure card for anyone who wants the controlled sheet.
//
// The numbers match the written steps above it: 1 in the centre (the minimum),
// 2 and 3 either side of it. The weights are CUMULATIVE — nothing comes off
// between points — which is why 2 and 3 are labelled with the running total.

const C = {
  platform: '#d9d9d9',
  frame: '#3f3f3f',
  grid: '#6b6b6b',
  red: '#f5453f',
  redEdge: '#c1201a',
  amber: '#ffd966',
  amberEdge: '#bf9000',
  green: '#2eb24a',
  greenEdge: '#1a7a31',
};

function Diamond({ x, y, r = 26, label }) {
  return (
    <g>
      <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
        fill={C.amber} stroke={C.amberEdge} strokeWidth="2" />
      {label && <text x={x} y={y + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="#7a5c00">{label}</text>}
    </g>
  );
}

function Triangle({ x, y, r = 26, label }) {
  return (
    <g>
      <polygon points={`${x},${y - r} ${x + r},${y + r * 0.85} ${x - r},${y + r * 0.85}`}
        fill={C.green} stroke={C.greenEdge} strokeWidth="2" />
      {label && <text x={x} y={y + 16} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0b3d18">{label}</text>}
    </g>
  );
}

const Swatch = ({ kind }) => (
  kind === 'diamond'
    ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><polygon points="8,1 15,8 8,15 1,8" fill={C.amber} stroke={C.amberEdge} strokeWidth="1.5" /></svg>
    : kind === 'triangle'
      ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><polygon points="8,1 15,13 1,13" fill={C.green} stroke={C.greenEdge} strokeWidth="1.5" /></svg>
      : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="6.5" fill={C.red} stroke={C.redEdge} strokeWidth="1.5" /></svg>
);

export default function ScalePlacementDiagram({ points = [], unit = '' }) {
  // Running totals: the weights stay on, so point 2 reads as the target and
  // point 3 as the maximum — the same numbers printed on the form.
  const w = (i) => (points[i] ? `${points[i].nominal} ${unit}` : null);

  return (
    <div className="space-y-2">
      <svg viewBox="0 0 320 260" className="w-full max-w-[320px] mx-auto block" role="img"
        aria-label="Scale platform divided into quadrants, with three weight positions in a row across the centre: a diamond to the left, a circle in the centre, and a triangle to the right">
        {/* The heavy outer frame and the lighter platform inside it, as drawn. */}
        <rect x="18" y="14" width="284" height="232" fill={C.frame} />
        <rect x="34" y="30" width="252" height="200" fill={C.platform} stroke={C.frame} strokeWidth="1" />
        {/* quadrant lines */}
        <line x1="160" y1="30" x2="160" y2="230" stroke={C.grid} strokeWidth="1.5" />
        <line x1="34" y1="130" x2="286" y2="130" stroke={C.grid} strokeWidth="1.5" />

        {/* The three points, in a row across the centre line. Drawn in this
            order so the centre circle sits above its neighbours' edges, the
            way it overlaps them on the sheet. */}
        <Diamond x={108} y={130} label="2" />
        <Triangle x={212} y={130} label="3" />
        <circle cx="160" cy="130" r="27" fill={C.red} stroke={C.redEdge} strokeWidth="2" />
        <text x="160" y="137" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">1</text>

        <text x="160" y="252" textAnchor="middle" fontSize="12" fill="#6b7280">
          Centre first, then either side of it
        </text>
      </svg>

      <div className="text-xs text-gray-700 space-y-1.5">
        {/* The sheet's own key, in its own words. */}
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
          <span className="font-semibold">For weight placement use these points:</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Swatch kind="diamond" /> and <Swatch kind="circle" /> and <Swatch kind="triangle" />
          </span>
        </div>
        <ul className="space-y-0.5 text-gray-600">
          <li><span className="font-semibold text-gray-800">1</span> — centre{w(0) ? `: place ${w(0)}` : ''}</li>
          <li><span className="font-semibold text-gray-800">2</span> — one side of the centre weight{w(1) ? `: add weight to reach ${w(1)}` : ''}</li>
          <li><span className="font-semibold text-gray-800">3</span> — the other side{w(2) ? `: add weight to reach ${w(2)}` : ''}</li>
        </ul>
        <p className="text-gray-500">Nothing comes off between points — the readings are the running total.</p>
      </div>
    </div>
  );
}
