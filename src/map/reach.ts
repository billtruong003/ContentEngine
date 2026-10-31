// Which part of a cave a pile poured in at the top can ever fill. Marbles only go down or sideways, so a pocket that
// rises above every way in (the far lobe of a heart, the tip of a pentagon fed from its shoulder) stays empty however
// many marbles come.
import { insidePolygon, outline, type Pt } from './geometry.ts';
import type { Cave } from './types.ts';

/** Grid step (px) for the check. */
const STEP = 4;

/** Share (0–1) of the cave a pile poured in from the top at each of `xs` can reach. */
export function reachable(cave: Cave, xs: number[]): number {
  const poly = outline(cave);
  const x0 = Math.min(...poly.map((p) => p.x));
  const y0 = Math.min(...poly.map((p) => p.y));
  const w = Math.ceil((Math.max(...poly.map((p) => p.x)) - x0) / STEP) + 1;
  const h = Math.ceil((Math.max(...poly.map((p) => p.y)) - y0) / STEP) + 1;
  const inside = new Uint8Array(w * h);
  let area = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!insidePolygon({ x: x0 + i * STEP, y: y0 + j * STEP }, poly)) continue;
      inside[j * w + i] = 1;
      area++;
    }
  }
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  for (const x of xs) {
    // The highest cell inside near that x is where the marbles land (a sharp tip may miss the exact column).
    let land = -1;
    const c = Math.round((x - x0) / STEP);
    for (let i = Math.max(0, c - 2); i <= Math.min(w - 1, c + 2); i++) {
      for (let j = 0; j < h; j++) {
        if (!inside[j * w + i]) continue;
        if (land < 0 || j < Math.floor(land / w)) land = j * w + i;
        break;
      }
    }
    if (land >= 0 && !seen[land]) { seen[land] = 1; queue.push(land); }
  }
  let reached = queue.length;
  while (queue.length) {
    const k = queue.pop()!;
    const i = k % w;
    const j = (k - i) / w;
    for (const [di, dj] of [[-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || ni >= w || nj >= h) continue;
      const n = nj * w + ni;
      if (!inside[n] || seen[n]) continue;
      seen[n] = 1;
      reached++;
      queue.push(n);
    }
  }
  return area ? reached / area : 0;
}

/** The highest point of the cave outline (the middle of a flat top). */
export function topPoint(cave: Cave): Pt {
  const poly = outline(cave);
  const y = Math.min(...poly.map((p) => p.y));
  const top = poly.filter((p) => p.y < y + 1);
  return { x: top.reduce((s, p) => s + p.x, 0) / top.length, y };
}
