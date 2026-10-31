// Turns the first closed shape of an SVG path ("d" attribute) into points, centred on 0,0 and scaled so the
// larger half-extent is 1. Handles M L H V C S Q T Z in both absolute and relative form; arcs (A) are
// replaced by a straight line to their end point, so convert arcs to curves in the drawing tool if they matter.
import type { Pt } from './geometry.ts';

const CURVE_STEPS = 12;

export function svgOutline(d: string): Pt[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cmd = '';
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let ctrl: Pt | null = null;
  let closed = false;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  const point = (rel: boolean) => {
    const x = num();
    const y = num();
    return rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
  };
  const bezier = (p: Pt[]) => {
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      pts.push(p.length === 3
        ? { x: u * u * p[0].x + 2 * u * t * p[1].x + t * t * p[2].x, y: u * u * p[0].y + 2 * u * t * p[1].y + t * t * p[2].y }
        : {
          x: u ** 3 * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t ** 3 * p[3].x,
          y: u ** 3 * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t ** 3 * p[3].y,
        });
    }
  };

  while (i < tokens.length && !closed) {
    if (!isNum()) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M':
        if (pts.length) { closed = true; break; }
        cur = start = point(rel);
        pts.push(cur);
        cmd = rel ? 'l' : 'L';
        ctrl = null;
        break;
      case 'L': cur = point(rel); pts.push(cur); ctrl = null; break;
      case 'H': cur = { x: (rel ? cur.x : 0) + num(), y: cur.y }; pts.push(cur); ctrl = null; break;
      case 'V': cur = { x: cur.x, y: (rel ? cur.y : 0) + num() }; pts.push(cur); ctrl = null; break;
      case 'C': {
        const a = point(rel);
        const b = point(rel);
        const e = point(rel);
        bezier([cur, a, b, e]);
        ctrl = b;
        cur = e;
        break;
      }
      case 'S': {
        const a: Pt = ctrl ? { x: 2 * cur.x - ctrl.x, y: 2 * cur.y - ctrl.y } : cur;
        const b = point(rel);
        const e = point(rel);
        bezier([cur, a, b, e]);
        ctrl = b;
        cur = e;
        break;
      }
      case 'Q': {
        const a = point(rel);
        const e = point(rel);
        bezier([cur, a, e]);
        ctrl = a;
        cur = e;
        break;
      }
      case 'T': {
        const a: Pt = ctrl ? { x: 2 * cur.x - ctrl.x, y: 2 * cur.y - ctrl.y } : cur;
        const e = point(rel);
        bezier([cur, a, e]);
        ctrl = a;
        cur = e;
        break;
      }
      case 'A': {
        i += 5;
        cur = point(rel);
        pts.push(cur);
        ctrl = null;
        break;
      }
      case 'Z':
        cur = start;
        closed = true;
        break;
      default:
        throw new Error(`đường SVG có lệnh "${cmd}" chưa hỗ trợ`);
    }
  }
  if (pts.length < 3) throw new Error('đường SVG cần ít nhất 3 điểm');
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1;
  return pts.map((p) => ({ x: (p.x - cx) / half, y: (p.y - cy) / half }));
}
