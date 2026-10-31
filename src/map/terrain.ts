// The map is one solid slab of ground; caves and paths are regions carved out of it.
// We sample a signed distance field on a grid (positive = solid, negative = open) and trace its zero line,
// which gives smooth wall outlines with no seams where a pipe meets a cave.
import { distanceToEdges, distanceToSegment, insidePolygon, type Pt } from './geometry.ts';

export type Carve = (
  | { kind: 'polygon'; points: Pt[] }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'path'; points: Pt[]; r: number }
) & {
  /** Polygons left solid inside this carve (e.g. a funnel floor). */
  keep?: Pt[][];
};

export interface Field {
  cell: number;
  cols: number;
  rows: number;
  /** Signed distance in px at node (i * cell, j * cell), row-major. */
  d: Float32Array;
}

export const FIELD_CELL = 3;
/** Distances are only computed this far from each carve; anything further counts as deep solid. */
export const FIELD_FAR = 32;

export function buildField(width: number, height: number, carves: Carve[], cell = FIELD_CELL): Field {
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const d = new Float32Array(cols * rows).fill(FIELD_FAR);
  for (const c of carves) {
    const [x0, y0, x1, y1] = bounds(c);
    // The outermost ring of nodes stays solid so every outline is a closed loop.
    const i0 = Math.max(1, Math.floor((x0 - FIELD_FAR) / cell));
    const i1 = Math.min(cols - 2, Math.ceil((x1 + FIELD_FAR) / cell));
    const j0 = Math.max(1, Math.floor((y0 - FIELD_FAR) / cell));
    const j1 = Math.min(rows - 2, Math.ceil((y1 + FIELD_FAR) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        const s = sdf(c, { x: i * cell, y: j * cell });
        if (s < d[k]) d[k] = s;
      }
    }
  }
  return { cell, cols, rows, d };
}

export function sampleField(f: Field, x: number, y: number): number {
  const fx = Math.max(0, Math.min(f.cols - 1.001, x / f.cell));
  const fy = Math.max(0, Math.min(f.rows - 1.001, y / f.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const k = j * f.cols + i;
  const top = f.d[k] * (1 - tx) + f.d[k + 1] * tx;
  const bottom = f.d[k + f.cols] * (1 - tx) + f.d[k + f.cols + 1] * tx;
  return top * (1 - ty) + bottom * ty;
}

// Marching squares on the zero line, stitched into closed loops and simplified.
export function traceOutlines(f: Field, tolerance = 0.6): Pt[][] {
  const { cols, rows, d, cell } = f;
  const H = (i: number, j: number) => (j * cols + i) * 2;
  const V = (i: number, j: number) => (j * cols + i) * 2 + 1;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = d[j * cols + i] > 0;
      const tr = d[j * cols + i + 1] > 0;
      const br = d[(j + 1) * cols + i + 1] > 0;
      const bl = d[(j + 1) * cols + i] > 0;
      const top = H(i, j);
      const right = V(i + 1, j);
      const bottom = H(i, j + 1);
      const left = V(i, j);
      const cut: number[] = [];
      if (tl !== tr) cut.push(top);
      if (tr !== br) cut.push(right);
      if (br !== bl) cut.push(bottom);
      if (bl !== tl) cut.push(left);
      if (cut.length === 2) link(cut[0], cut[1]);
      else if (cut.length === 4) {
        const centre = (d[j * cols + i] + d[j * cols + i + 1] + d[(j + 1) * cols + i + 1] + d[(j + 1) * cols + i]) / 4 > 0;
        if (centre === tl) { link(top, right); link(bottom, left); }
        else { link(top, left); link(bottom, right); }
      }
    }
  }

  const point = (id: number): Pt => {
    const k = id >> 1;
    const i = k % cols;
    const j = (k - i) / cols;
    const a = d[k];
    if (id & 1) {
      const t = a / (a - d[k + cols]);
      return { x: i * cell, y: (j + t) * cell };
    }
    const t = a / (a - d[k + 1]);
    return { x: (i + t) * cell, y: j * cell };
  };

  const seen = new Set<number>();
  const loops: Pt[][] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(point(cur));
      const [a, b] = links.get(cur)!;
      const next = a !== prev && !seen.has(a) ? a : b;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(simplifyLoop(loop, tolerance));
  }
  return loops;
}

function simplifyLoop(loop: Pt[], tolerance: number): Pt[] {
  let far = 0;
  for (let i = 1; i < loop.length; i++) if (dist2(loop[0], loop[i]) > dist2(loop[0], loop[far])) far = i;
  const a = simplify(loop.slice(0, far + 1), tolerance);
  const b = simplify([...loop.slice(far), loop[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// Ramer–Douglas–Peucker.
function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const e = distanceToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (e > worst) { worst = e; index = i; }
  }
  if (worst <= tolerance) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(pts.slice(index), tolerance)];
}

function sdf(c: Carve, p: Pt): number {
  let s = shapeSdf(c, p);
  for (const k of c.keep ?? []) s = Math.max(s, -polygonSdf(k, p));
  return s;
}

function shapeSdf(c: Carve, p: Pt): number {
  if (c.kind === 'circle') return Math.hypot(p.x - c.x, p.y - c.y) - c.r;
  if (c.kind === 'polygon') return polygonSdf(c.points, p);
  let best = Infinity;
  for (let i = 0; i < c.points.length - 1; i++) best = Math.min(best, distanceToSegment(p, c.points[i], c.points[i + 1]));
  return best - c.r;
}

function polygonSdf(points: Pt[], p: Pt): number {
  const e = distanceToEdges(p, points);
  return insidePolygon(p, points) ? -e : e;
}

function bounds(c: Carve): [number, number, number, number] {
  if (c.kind === 'circle') return [c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r];
  const pad = c.kind === 'path' ? c.r : 0;
  const xs = c.points.map((p) => p.x);
  const ys = c.points.map((p) => p.y);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function dist2(a: Pt, b: Pt): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
