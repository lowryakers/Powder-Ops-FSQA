import Papa from 'papaparse';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';

function parseTime(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[4].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function parseDuration(startStr, endStr) {
  const start = parseTime(startStr);
  const end = parseTime(endStr);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function normalizeTeam(team) {
  if (!team) return null;
  const t = team.trim().toLowerCase();
  if (t.includes('batch') || t.includes('blend')) return 'Batching';
  if (t.includes('hand') || t.includes('fill')) return 'Hand Fill';
  if (t.includes('kit')) return 'Kitting';
  if (t.includes('stick') || t.includes('sachet')) return 'Stick Pack';
  return team.trim();
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d;
}

function transformEODRow(row) {
  const date = parseDate(row["Today's Date"]);
  const team = normalizeTeam(row['Team']);
  const product = (row['Product Name:'] || '').trim();
  const mo = (row['MO #: '] || row['MO #:'] || '').trim();
  const lot = (row['Lot #:'] || '').trim();
  const quantity = parseFloat((row['Quantity Completed:'] || '').replace(/,/g, ''));
  const people = parseFloat(row['# of people working:']);
  const durationDecimal = parseFloat(row['Duration (decimal)']);
  const unitsPerHour = parseFloat(row['Units/Hour']);
  const startTime = row['Project Start Time:'];
  const endTime = row['Project End Time:'];
  const notes = (row['Notes/Observations on this MO # or Lot #:'] || '').trim();
  const reviewer = (row['Reviewed By (QA)'] || '').trim();
  const room = (row['Room'] || '').trim();

  if (!date || !team || isNaN(quantity) || quantity <= 0) return null;

  const duration = !isNaN(durationDecimal) && durationDecimal > 0
    ? durationDecimal
    : parseDuration(startTime, endTime);

  const manHours = duration && people ? duration * people : null;
  const unitsPerManHour = manHours && manHours > 0 ? quantity / manHours : null;
  const unitsPerMinute = duration && duration > 0 ? quantity / (duration * 60) : null;

  return {
    date,
    dateStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    week: getWeekKey(date),
    team,
    product,
    mo,
    lot,
    quantity,
    people: isNaN(people) ? null : people,
    duration,
    manHours,
    unitsPerManHour,
    unitsPerMinute,
    unitsPerHour: !isNaN(unitsPerHour) ? unitsPerHour : null,
    startTime,
    endTime,
    notes,
    reviewer,
    room,
  };
}

function normalizeProduct(p) {
  return (p || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeMOs(runs) {
  const digits = (mo) => mo.replace(/[^0-9]/g, '');

  const moInfo = new Map();
  runs.forEach((r) => {
    if (!r.mo) return;
    if (!moInfo.has(r.mo)) moInfo.set(r.mo, { d: digits(r.mo), products: new Set() });
    if (r.product) moInfo.get(r.mo).products.add(normalizeProduct(r.product));
  });

  const productsOverlap = (a, b) => {
    if (!a.size || !b.size) return true;
    for (const p of a) {
      for (const q of b) {
        if (p.includes(q) || q.includes(p)) return true;
      }
    }
    return false;
  };

  const remap = {};
  for (const [shortMO, shortInfo] of moInfo) {
    for (const [longMO, longInfo] of moInfo) {
      if (longInfo.d.length > shortInfo.d.length && longInfo.d.endsWith(shortInfo.d)) {
        if (!productsOverlap(shortInfo.products, longInfo.products)) continue;
        const existing = remap[shortMO];
        if (!existing || digits(existing).length < longInfo.d.length) {
          remap[shortMO] = longMO;
        }
      }
    }
  }

  if (!Object.keys(remap).length) return runs;
  return runs.map((r) => r.mo && remap[r.mo] ? { ...r, mo: remap[r.mo] } : r);
}

export async function fetchSheetData() {
  try {
    const res = await fetch(`${API_BASE}/api/eod`);
    if (res.ok) {
      const { data } = await res.json();
      const runs = data.map(transformEODRow).filter(Boolean).sort((a, b) => b.date - a.date);
      return normalizeMOs(runs);
    }
  } catch {}

  // Fallback: local CSV for dev/offline
  const res = await fetch('/data.csv');
  const text = await res.text();
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  const runs = data.map(transformEODRow).filter(Boolean).sort((a, b) => b.date - a.date);
  return normalizeMOs(runs);
}

export async function fetchScheduleData() {
  try {
    const res = await fetch(`${API_BASE}/api/schedule`);
    if (res.ok) {
      const json = await res.json();
      return { data: json.data || [], snapshots: json.snapshots || [] };
    }
  } catch {}
  return { data: [], snapshots: [] };
}

export async function fetchSnapshot(id) {
  try {
    const res = await fetch(`${API_BASE}/api/schedule/snapshot/${encodeURIComponent(id)}`);
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function refreshData() {
  try {
    const res = await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
    return await res.json();
  } catch {
    return null;
  }
}

function getWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

export function getTeamColor(team) {
  const colors = {
    'Batching': '#f59e0b',
    'Hand Fill': '#10b981',
    'Kitting': '#8b5cf6',
    'Stick Pack': '#3b82f6',
  };
  return colors[team] || '#6b7280';
}

export function getTeams(runs) {
  return [...new Set(runs.map((r) => r.team))].sort();
}

export function getProducts(runs) {
  return [...new Set(runs.map((r) => r.product).filter(Boolean))].sort();
}
