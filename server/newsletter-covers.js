// Newsletter banner covers — the Notion-style "pick a header" gallery.
//
// The covers are DRAWN, not photographed. A stock-photo gallery would mean
// licensing, megabytes of assets in the repo, and a second copy of every image
// for the PDF; a set of gradients with a motif costs nothing, always renders,
// and can't expire. It also means the app preview and the PDF are the same
// picture rather than two things that drift.
//
// One definition, two renderers: this file emits plain geometry in a fixed
// 1000×300 viewBox, the client draws it as SVG, and the PDF draws the same
// numbers with pdfkit. Anything Marnee picks looks the same in both.
//
// Shapes are generated from a seed derived from the cover id, so a cover looks
// identical every time it's rendered — the fireworks don't rearrange themselves
// between the preview and the download.

export const COVER_VIEWBOX = { w: 1000, h: 300 };

// Deterministic PRNG (mulberry32). Same seed → same arrangement, everywhere.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The gallery. `group` is what the picker groups by; `tags` let the editor
 * suggest something seasonal for the month being written.
 *
 * `colors` is the background gradient (left → right). `ink` is the colour the
 * title should be drawn in over it — every cover here is dark enough for white.
 */
export const COVERS = [
  // ── Seasons ────────────────────────────────────────────────────────────────
  { id: 'spring-bloom', label: 'Spring Bloom', group: 'Seasons', months: [3, 4, 5],
    colors: ['#2E7D5B', '#7FB069', '#C9DE8E'], motif: 'dots', accent: '#FFFFFF' },
  { id: 'summer-sun', label: 'Summer', group: 'Seasons', months: [6, 7, 8],
    colors: ['#F0803C', '#F5B041', '#FFD98E'], motif: 'waves', accent: '#FFFFFF' },
  { id: 'autumn-harvest', label: 'Autumn', group: 'Seasons', months: [9, 10, 11],
    colors: ['#8C3B14', '#C25E22', '#E8A33D'], motif: 'leaves', accent: '#FFE9C7' },
  { id: 'winter-frost', label: 'Winter', group: 'Seasons', months: [12, 1, 2],
    colors: ['#123A5C', '#1F6F9E', '#7FC4E3'], motif: 'flakes', accent: '#FFFFFF' },

  // ── Holidays & the calendar ────────────────────────────────────────────────
  { id: 'fireworks', label: 'Fireworks', group: 'Holidays', months: [7],
    colors: ['#0B1B3A', '#16305E', '#0B1B3A'], motif: 'burst', accent: '#FFFFFF' },
  { id: 'stars-stripes', label: 'Stars & Stripes', group: 'Holidays', months: [7],
    colors: ['#0A2A5E', '#123C7A', '#8C1420'], motif: 'stars', accent: '#FFFFFF' },
  { id: 'new-year', label: 'New Year', group: 'Holidays', months: [1],
    colors: ['#171033', '#3A2A6B', '#6E4BA8'], motif: 'sparkle', accent: '#FFD86B' },
  { id: 'harvest-table', label: 'Thanksgiving', group: 'Holidays', months: [11],
    colors: ['#5C2F12', '#95521F', '#C98A3C'], motif: 'leaves', accent: '#FFE9C7' },
  { id: 'pumpkin', label: 'Halloween', group: 'Holidays', months: [10],
    colors: ['#1B1024', '#4A2159', '#D2691E'], motif: 'sparkle', accent: '#FFB74D' },
  { id: 'holiday-lights', label: 'Holidays', group: 'Holidays', months: [12],
    colors: ['#0D2B22', '#14513C', '#8C1420'], motif: 'lights', accent: '#FFFFFF' },

  // ── Celebrations ───────────────────────────────────────────────────────────
  { id: 'confetti', label: 'Confetti', group: 'Celebrations', months: [],
    colors: ['#1C3A6E', '#2D5AA8', '#4E8AD4'], motif: 'confetti', accent: '#FFFFFF' },
  { id: 'birthday', label: 'Birthdays', group: 'Celebrations', months: [],
    colors: ['#7A1F5C', '#B03A7A', '#E87BA8'], motif: 'confetti', accent: '#FFFFFF' },
  { id: 'milestone', label: 'Milestone', group: 'Celebrations', months: [],
    colors: ['#12403A', '#1D6E60', '#37A98F'], motif: 'sparkle', accent: '#FFE9A8' },

  // ── The plant ──────────────────────────────────────────────────────────────
  { id: 'powder-blue', label: 'Powder Ops', group: 'Powder Ops', months: [],
    colors: ['#03384F', '#0369A1', '#38A3D1'], motif: 'dots', accent: '#FFFFFF' },
  { id: 'production', label: 'On the Floor', group: 'Powder Ops', months: [],
    colors: ['#2B2F38', '#3F4757', '#5A6478'], motif: 'waves', accent: '#FFFFFF' },
  { id: 'safety-first', label: 'Safety First', group: 'Powder Ops', months: [],
    colors: ['#7A4A05', '#B8770F', '#E3A72B'], motif: 'stripes', accent: '#FFFFFF' },
];

export const getCover = (id) => COVERS.find(c => c.id === id) || null;

/** Covers that suit a given month (1–12), best first. Drives "for July". */
export function coversForMonth(month) {
  return COVERS.filter(c => c.months?.includes(Number(month)));
}

// ── Motifs ───────────────────────────────────────────────────────────────────
// Each returns primitives in the 1000×300 viewBox:
//   { type:'circle', cx, cy, r, fill|stroke, width?, opacity }
//   { type:'line',   x1, y1, x2, y2, stroke, width, opacity }
//   { type:'poly',   points:[[x,y]…], fill|stroke, width?, opacity, close? }
// Deliberately a tiny vocabulary — everything in it maps 1:1 onto both SVG and
// pdfkit, so neither renderer needs a special case.
const H = COVER_VIEWBOX.h, W = COVER_VIEWBOX.w;

const MOTIFS = {
  burst(r, accent) {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const cx = 70 + r() * (W - 140), cy = 45 + r() * (H - 130);
      const rays = 10 + Math.floor(r() * 6), len = 26 + r() * 40;
      for (let k = 0; k < rays; k++) {
        const a = (k / rays) * Math.PI * 2 + r() * 0.12;
        out.push({ type: 'line', x1: cx, y1: cy, x2: cx + Math.cos(a) * len, y2: cy + Math.sin(a) * len,
          stroke: accent, width: 1.6, opacity: 0.55 + r() * 0.3 });
        out.push({ type: 'circle', cx: cx + Math.cos(a) * len, cy: cy + Math.sin(a) * len, r: 2.2,
          fill: accent, opacity: 0.8 });
      }
      out.push({ type: 'circle', cx, cy, r: 3, fill: accent, opacity: 0.9 });
    }
    return out;
  },
  confetti(r, accent) {
    const out = [];
    for (let i = 0; i < 70; i++) {
      const cx = r() * W, cy = r() * H, w = 6 + r() * 9, h = 3 + r() * 5, a = r() * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pt = (dx, dy) => [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
      out.push({ type: 'poly', close: true, fill: accent, opacity: 0.25 + r() * 0.5,
        points: [pt(-w / 2, -h / 2), pt(w / 2, -h / 2), pt(w / 2, h / 2), pt(-w / 2, h / 2)] });
    }
    return out;
  },
  dots(r, accent) {
    const out = [];
    for (let i = 0; i < 90; i++) {
      out.push({ type: 'circle', cx: r() * W, cy: r() * H, r: 2 + r() * 7,
        fill: accent, opacity: 0.12 + r() * 0.28 });
    }
    return out;
  },
  waves(r, accent) {
    const out = [];
    for (let band = 0; band < 5; band++) {
      const base = 60 + band * 48, amp = 12 + r() * 16, phase = r() * Math.PI * 2;
      const points = [];
      for (let x = 0; x <= W; x += 25) points.push([x, base + Math.sin((x / W) * Math.PI * 4 + phase) * amp]);
      out.push({ type: 'poly', points, stroke: accent, width: 3, opacity: 0.26 + band * 0.07 });
    }
    return out;
  },
  stripes(r, accent) {
    const out = [];
    for (let i = -6; i < 26; i++) {
      const x = i * 52;
      out.push({ type: 'poly', close: true, fill: accent, opacity: 0.15,
        points: [[x, 0], [x + 24, 0], [x + 24 - H * 0.6, H], [x - H * 0.6, H]] });
    }
    return out;
  },
  stars(r, accent) {
    const out = [];
    for (let i = 0; i < 26; i++) {
      const cx = r() * W, cy = r() * H, rad = 5 + r() * 9, pts = [];
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? rad * 0.42 : rad;
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      out.push({ type: 'poly', close: true, points: pts, fill: accent, opacity: 0.3 + r() * 0.5 });
    }
    return out;
  },
  sparkle(r, accent) {
    const out = [];
    for (let i = 0; i < 34; i++) {
      const cx = r() * W, cy = r() * H, rad = 4 + r() * 12;
      out.push({ type: 'poly', close: true, fill: accent, opacity: 0.35 + r() * 0.5,
        points: [[cx, cy - rad], [cx + rad * 0.28, cy - rad * 0.28], [cx + rad, cy],
          [cx + rad * 0.28, cy + rad * 0.28], [cx, cy + rad], [cx - rad * 0.28, cy + rad * 0.28],
          [cx - rad, cy], [cx - rad * 0.28, cy - rad * 0.28]] });
    }
    return out;
  },
  leaves(r, accent) {
    const out = [];
    for (let i = 0; i < 40; i++) {
      const cx = r() * W, cy = r() * H, rad = 6 + r() * 12, a = r() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pt = (dx, dy) => [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
      out.push({ type: 'poly', close: true, fill: accent, opacity: 0.18 + r() * 0.35,
        points: [pt(0, -rad), pt(rad * 0.6, 0), pt(0, rad), pt(-rad * 0.6, 0)] });
    }
    return out;
  },
  flakes(r, accent) {
    const out = [];
    for (let i = 0; i < 30; i++) {
      const cx = r() * W, cy = r() * H, rad = 6 + r() * 11;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI;
        out.push({ type: 'line', x1: cx - Math.cos(a) * rad, y1: cy - Math.sin(a) * rad,
          x2: cx + Math.cos(a) * rad, y2: cy + Math.sin(a) * rad,
          stroke: accent, width: 1.4, opacity: 0.3 + r() * 0.45 });
      }
    }
    return out;
  },
  lights(r, accent) {
    const out = [];
    const bulbs = ['#E8443A', '#F2C14E', '#4CAF6D', '#4E8AD4', '#FFFFFF'];
    for (let strand = 0; strand < 3; strand++) {
      const base = 42 + strand * 92, amp = 20 + r() * 14, phase = r() * Math.PI * 2;
      const points = [];
      for (let x = 0; x <= W; x += 20) points.push([x, base + Math.sin((x / W) * Math.PI * 5 + phase) * amp]);
      out.push({ type: 'poly', points, stroke: accent, width: 1.2, opacity: 0.3 });
      for (let x = 30; x < W; x += 62) {
        const y = base + Math.sin((x / W) * Math.PI * 5 + phase) * amp;
        out.push({ type: 'circle', cx: x, cy: y + 7, r: 5.5,
          fill: bulbs[Math.floor(r() * bulbs.length)], opacity: 0.9 });
      }
    }
    return out;
  },
};

/**
 * The drawable form of a cover: its gradient plus its motif geometry, in the
 * 1000×300 viewBox. Cached — the arrangement is deterministic, so there's no
 * reason to regenerate it per request.
 */
const shapeCache = new Map();
export function coverShapes(cover) {
  if (!cover) return [];
  if (shapeCache.has(cover.id)) return shapeCache.get(cover.id);
  const motif = MOTIFS[cover.motif] || (() => []);
  const shapes = motif(rng(seedOf(cover.id)), cover.accent || '#FFFFFF');
  shapeCache.set(cover.id, shapes);
  return shapes;
}

/** What the API hands the client: everything needed to draw the cover. */
export function coverPayload(cover) {
  return {
    id: cover.id, label: cover.label, group: cover.group, months: cover.months || [],
    colors: cover.colors, accent: cover.accent,
    viewbox: COVER_VIEWBOX, shapes: coverShapes(cover),
  };
}
