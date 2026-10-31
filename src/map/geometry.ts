import type { Rng } from '../core/rng.ts';
import type { Cave, Shape } from './types.ts';
import { svgOutline } from './svg.ts';

export interface Pt { x: number; y: number }

// A wall piece is a thin box whose face lies on the line a→b, body on one side. Coordinates are frame pixels, y down.
export interface WallPiece {
  owner: string;
  a: Pt;
  b: Pt;
  cx: number;
  cy: number;
  length: number;
  thickness: number;
  angle: number;
  valve: string | null;
}

const CIRCLE_SEGMENTS = 72;

// Polygons get a flat bottom edge so a centred valve sits on it.
export function outline(cave: Cave): Pt[] {
  const s = cave.shape;
  const rot = s.kind === 'circle' ? 0 : ((s.rotation ?? 0) * Math.PI) / 180;
  if (s.kind === 'star') {
    const n = s.points * 2;
    return Array.from({ length: n }, (_, k) => {
      const a = Math.PI / 2 + rot + (2 * Math.PI * k) / n;
      const r = k % 2 ? s.radius * (s.inner ?? 0.5) : s.radius;
      return { x: cave.x + r * Math.cos(a), y: cave.y + r * Math.sin(a) };
    });
  }
  if (s.kind !== 'circle' && s.kind !== 'polygon') {
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    return unitOutline(s).map((p) => ({ x: cave.x + (p.x * c - p.y * sn) * s.radius, y: cave.y + (p.x * sn + p.y * c) * s.radius }));
  }
  const n = s.kind === 'circle' ? CIRCLE_SEGMENTS : s.sides;
  const start = Math.PI / 2 + Math.PI / n + rot;
  return Array.from({ length: n }, (_, k) => {
    const a = start + (2 * Math.PI * k) / n;
    return { x: cave.x + s.radius * Math.cos(a), y: cave.y + s.radius * Math.sin(a) };
  });
}

// Outlines of the curved shapes, centred on 0,0 with radius 1, y down.
const outlineCache = new Map<string, Pt[]>();
function unitOutline(s: Exclude<Shape, { kind: 'circle' | 'polygon' | 'star' }>): Pt[] {
  const key = JSON.stringify({ ...s, radius: 1, rotation: 0 });
  const hit = outlineCache.get(key);
  if (hit) return hit;
  let pts: Pt[];
  const N = 72;
  const ring = (f: (t: number) => Pt) => Array.from({ length: N }, (_, k) => f((2 * Math.PI * k) / N));
  if (s.kind === 'heart') {
    // The classic heart curve, point at the bottom, fitted into the unit circle.
    pts = ring((t) => ({ x: (16 * Math.sin(t) ** 3) / 17, y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 }));
  } else if (s.kind === 'drop') {
    // A round bottom narrowing to a point at the top.
    pts = ring((t) => ({ x: 0.62 * Math.sin(t) * Math.sin(t / 2) ** 1.2 * 1.6, y: -Math.cos(t) }));
  } else if (s.kind === 'moon') {
    // A bowl: the lower half of a circle with a flat lid, centred on its middle.
    pts = Array.from({ length: N / 2 + 1 }, (_, k) => {
      const t = (Math.PI * k) / (N / 2);
      return { x: Math.cos(t), y: Math.sin(t) - 0.5 };
    });
  } else if (s.kind === 'rounded') {
    const h = Math.max(0.1, s.aspect ?? 0.7);
    const r = Math.min(1, h) * Math.max(0, Math.min(0.5, s.corner ?? 0.2)) * 2;
    const corners = [[1 - r, h - r, 0], [-1 + r, h - r, 90], [-1 + r, -h + r, 180], [1 - r, -h + r, 270]] as const;
    pts = corners.flatMap(([cx, cy, from]) => Array.from({ length: 10 }, (_, k) => {
      const a = ((from + (90 * k) / 9) * Math.PI) / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }));
  } else if (s.kind === 'path') {
    pts = svgOutline(s.d);
  } else {
    pts = [];
  }
  outlineCache.set(key, pts);
  return pts;
}

export function piece(owner: string, a: Pt, b: Pt, thickness: number, side: 1 | -1): WallPiece {
  const length = dist(a, b);
  const nx = ((b.y - a.y) / length) * side;
  const ny = (-(b.x - a.x) / length) * side;
  return {
    owner, a, b, length, thickness, valve: null,
    cx: (a.x + b.x) / 2 + (nx * thickness) / 2,
    cy: (a.y + b.y) / 2 + (ny * thickness) / 2,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

// Topmost (or bottommost) point of the cave outline straight above (below) x.
export function outlineYAt(cave: Cave, x: number, edge: 'top' | 'bottom'): number | null {
  const poly = outline(cave);
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if ((p.x - x) * (q.x - x) > 0 || p.x === q.x) continue;
    const y = p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y);
    if (best === null || (edge === 'top' ? y < best : y > best)) best = y;
  }
  return best;
}

export function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToEdges(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

// Loose hex grid inside the cave, bottom rows first, so marbles settle instead of looking stacked.
// `free` rejects spots inside ground that was left solid in the cave (a funnel floor).
/** `tight` packs marbles almost touching (a cave that starts as a picture); otherwise they get room to drop and settle. */
export function fillPoints(cave: Cave, radius: number, count: number, rng: Rng, free: (p: Pt) => boolean = () => true, tight = false): { points: Pt[]; capacity: number } {
  const poly = outline(cave);
  const step = radius * (tight ? 2.04 : 2.3);
  const jitter = tight ? 0.02 : 0.3;
  const rowStep = step * 0.866;
  const r = cave.shape.radius;
  const candidates: Pt[] = [];
  for (let row = 0, y = cave.y + r; y > cave.y - r; row++, y -= rowStep) {
    for (let x = cave.x - r + (row % 2) * (step / 2); x < cave.x + r; x += step) {
      const p = { x, y };
      if (insidePolygon(p, poly) && distanceToEdges(p, poly) > radius * 1.5 && free(p)) candidates.push(p);
    }
  }
  const points = candidates.slice(0, count).map((p) => ({
    x: p.x + (rng() - 0.5) * radius * jitter,
    y: p.y + (rng() - 0.5) * radius * jitter,
  }));
  return { points, capacity: candidates.length };
}

// Smooth curve through every point: cubic Bézier pieces whose handles follow unit tangents scaled to each
// piece's length, so uneven point spacing cannot make the curve loop back on itself.
export function smoothPath(points: Pt[], startDir: Pt, endDir: Pt, samplesPerSegment = 12): Pt[] {
  const tangents = points.map((p, i) => {
    if (i === 0) return unit(startDir);
    if (i === points.length - 1) return unit(endDir);
    return unit({ x: points[i + 1].x - points[i - 1].x, y: points[i + 1].y - points[i - 1].y });
  });
  const out: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p3 = points[i + 1];
    const k = dist(p0, p3) * 0.4;
    const p1 = { x: p0.x + tangents[i].x * k, y: p0.y + tangents[i].y * k };
    const p2 = { x: p3.x - tangents[i + 1].x * k, y: p3.y - tangents[i + 1].y * k };
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const u = 1 - t;
      const f = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

function unit(v: Pt): Pt {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
