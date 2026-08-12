// Where the weights go on the scale.
//
// THERE ARE TWO PLACEMENT PATTERNS AND THEY ARE NOT INTERCHANGEABLE, because
// they tell an operator to load the scale in physically different places:
//
//   • `corners`    — the centre plus EITHER diagonal pair of corners, the
//                    plant's long-standing sheet ("● and ◆ OR ● and ▲"). This
//                    is the pattern for four of the five forms.
//   • `centerline` — all three points in a row across the centre line, from the
//                    revised sheet supplied for the Batching PALLET scale
//                    ("◇ and ● and ▲"), where the weights sit either side of
//                    the centre rather than at corners.
//
// Which one a form uses is a property OF THAT FORM (`diagram` in
// `server/scale-forms.js`), not a global setting. A single component drawing
// one picture for every scale is how four forms silently started showing a
// placement nobody had agreed for them — the sheet changed for one scale.
//
// Drawn as SVG rather than embedding the scan, for the reason the process maps
// are data and not pictures: this is looked at on a phone next to a scale. It
// stays sharp at any size, it prints, and — the part a scan cannot do — it
// carries THIS form's weights, so a Batching operator reads "25 kg" where a
// Kitting operator reads "50 g" from the same component. The scan itself is
// linked from the procedure card for anyone who wants the controlled sheet.
//
// In both patterns the weights are CUMULATIVE — nothing comes off between
// points — which is why 2 and 3 are labelled with the running total.

const C = {
  platform: '#e5e7eb',
  platformEdge: '#9ca3af',
  frame: '#3f3f3f',
  panel: '#d9d9d9',
  grid: '#6b6b6b',
  red: '#f5453f',
  redEdge: '#c1201a',
  amber: '#ffd966',
  amberEdge: '#bf9000',
  green: '#2eb24a',
  greenEdge: '#1a7a31',
};

function Diamond({ x, y, r = 15, label, fontSize = 13 }) {
  return (
    <g>
      <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
        fill={C.amber} stroke={C.amberEdge} strokeWidth="2" />
      {label && <text x={x} y={y + fontSize / 3} textAnchor="middle" fontSize={fontSize} fontWeight="700" fill="#78350f">{label}</text>}
    </g>
  );
}

function Triangle({ x, y, r = 16, label, fontSize = 12 }) {
  return (
    <g>
      <polygon points={`${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`}
        fill={C.green} stroke={C.greenEdge} strokeWidth="2" />
      {label && <text x={x} y={y + r * 0.62} textAnchor="middle" fontSize={fontSize} fontWeight="700" fill="#052e16">{label}</text>}
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

/** Centre plus either diagonal pair of corners — the pattern on four forms. */
function CornerPattern({ w }) {
  return (
    <>
      <svg viewBox="0 0 300 250" className="w-full max-w-[300px] mx-auto block" role="img"
        aria-label="Scale platform showing the centre weight position and two diagonal pairs of corner positions">
        <rect x="30" y="20" width="240" height="200" rx="20" fill={C.platform} stroke={C.platformEdge} strokeWidth="2.5" />
        <line x1="150" y1="20" x2="150" y2="220" stroke={C.grid} strokeWidth="1.5" />
        <line x1="30" y1="120" x2="270" y2="120" stroke={C.grid} strokeWidth="1.5" />
        <line x1="45" y1="35" x2="255" y2="205" stroke={C.platformEdge} strokeWidth="1.5" strokeDasharray="6 5" />
        <line x1="255" y1="35" x2="45" y2="205" stroke={C.platformEdge} strokeWidth="1.5" strokeDasharray="6 5" />

        {/* one diagonal: diamonds */}
        <Diamond x={88} y={66} label="2" />
        <Diamond x={212} y={174} label="3" />
        {/* the other diagonal: triangles */}
        <Triangle x={212} y={66} label="2" />
        <Triangle x={88} y={174} label="3" />

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
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Swatch kind="circle" /> and <Swatch kind="diamond" /></span>
          <span className="text-gray-400 font-semibold">OR</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Swatch kind="circle" /> and <Swatch kind="triangle" /></span>
        </div>
        <ul className="space-y-0.5 text-gray-600">
          <li><span className="font-semibold text-gray-800">1</span> — centre{w(0) ? `: place ${w(0)}` : ''}</li>
          <li><span className="font-semibold text-gray-800">2</span> — a corner{w(1) ? `: add weight to reach ${w(1)}` : ''}</li>
          <li><span className="font-semibold text-gray-800">3</span> — the opposite corner{w(2) ? `: add weight to reach ${w(2)}` : ''}</li>
        </ul>
      </div>
    </>
  );
}

/** All three points across the centre line — the revised Batching pallet sheet. */
function CenterLinePattern({ w }) {
  return (
    <>
      <svg viewBox="0 0 320 260" className="w-full max-w-[320px] mx-auto block" role="img"
        aria-label="Scale platform divided into quadrants, with three weight positions in a row across the centre: a diamond to the left, a circle in the centre, and a triangle to the right">
        <rect x="18" y="14" width="284" height="232" fill={C.frame} />
        <rect x="34" y="30" width="252" height="200" fill={C.panel} stroke={C.frame} strokeWidth="1" />
        <line x1="160" y1="30" x2="160" y2="230" stroke={C.grid} strokeWidth="1.5" />
        <line x1="34" y1="130" x2="286" y2="130" stroke={C.grid} strokeWidth="1.5" />

        {/* Drawn in this order so the centre circle sits above its neighbours'
            edges, the way it overlaps them on the sheet. */}
        <Diamond x={108} y={130} r={26} label="2" fontSize={15} />
        <Triangle x={212} y={130} r={26} label="3" fontSize={14} />
        <circle cx="160" cy="130" r="27" fill={C.red} stroke={C.redEdge} strokeWidth="2" />
        <text x="160" y="137" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">1</text>

        <text x="160" y="252" textAnchor="middle" fontSize="12" fill="#6b7280">
          Centre first, then either side of it
        </text>
      </svg>

      <div className="text-xs text-gray-700 space-y-1.5">
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
      </div>
    </>
  );
}

// `corners` is the default on purpose: a form that has not said otherwise gets
// the pattern four of the five use and the plant has always used.
export default function ScalePlacementDiagram({ points = [], unit = '', variant = 'corners' }) {
  // Running totals: the weights stay on, so point 2 reads as the target and
  // point 3 as the maximum — the same numbers printed on the form.
  const w = (i) => (points[i] ? `${points[i].nominal} ${unit}` : null);
  return (
    <div className="space-y-2">
      {variant === 'centerline' ? <CenterLinePattern w={w} /> : <CornerPattern w={w} />}
      <p className="text-xs text-gray-500">Nothing comes off between points — the readings are the running total.</p>
    </div>
  );
}
