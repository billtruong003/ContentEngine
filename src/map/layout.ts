// Turns a map into carved ground, valve gates and moving parts.
// Caves, pipes, waterfall shafts and conveyor tubes are all carved out of one slab, so there are no seams to leak through.
import { dist, insidePolygon, outline, outlineYAt, piece, smoothPath, type Pt, type WallPiece } from './geometry.ts';
import { buildField, sampleField, traceOutlines, type Carve, type Field } from './terrain.ts';
import { valveId, type Cave, type Flow, type MapDoc, type Valve } from './types.ts';

export interface Wall extends WallPiece {
  color: string;
}

/**
 * A conveyor paddle. It rises out of the floor at `start`, rides up the belt along `u` for `length` px,
 * sinks back into the ground at the top, waits there and jumps back to the bottom while hidden.
 * `n` points from the belt floor into the tube; `points` are the paddle outline relative to its base.
 */
export interface Mover {
  owner: string;
  start: Pt;
  u: Pt;
  n: Pt;
  length: number;
  depth: number;
  loop: number;
  offset: number;
  speed: number;
  points: Pt[];
  color: string;
}

/** A teleport: marbles that reach `entry` reappear at `exit`, one at a time. */
export interface Portal {
  flow: number;
  /** Starting colours this portal takes; empty takes every marble. */
  only: string[];
  entry: Pt;
  exit: Pt;
  /** Marbles within this distance of `entry` are taken. */
  r: number;
  color: string;
}

/** A scoop wheel: arms turning about x, y inside a round chamber, carrying marbles up and over. */
export interface Wheel {
  x: number;
  y: number;
  /** Arm length, a few px short of the chamber wall. */
  r: number;
  hub: number;
  arms: number;
  /** Radians per second; positive turns clockwise on screen. */
  spin: number;
  color: string;
}

export function wheelAngle(w: Wheel, t: number): number {
  return w.spin * t;
}

/** A fixed round pin in a pegboard flow. */
export interface Peg {
  x: number;
  y: number;
  r: number;
}

export interface Layout {
  field: Field;
  /** Static wall boxes along the carved outline; physics only, the renderer draws the field instead. */
  terrain: WallPiece[];
  /** Valve gates, removable at run time. */
  gates: Wall[];
  movers: Mover[];
  machines: Machine[];
  portals: Portal[];
  pegs: Peg[];
  wheels: Wheel[];
  /** The line marbles travel along for each flow (by index), or null if that flow could not be built. */
  routes: (Pt[] | null)[];
  errors: string[];
  warnings: string[];
}

/**
 * A machine is a bar a→b across a passage. Marbles that cross a "paint" bar take on their final colour,
 * a "swap" bar turns them into `character`, a "size" bar makes them `scale` times their normal size.
 */
export interface Machine {
  kind: MachineKind;
  flow: number;
  a: Pt;
  b: Pt;
  character?: string;
  scale?: number;
  shape?: string;
  color?: string;
}

export type MachineKind = 'paint' | 'swap' | 'size' | 'shape' | 'mix' | 'double';

/** Name, colour and handle letter of each machine, for the editor. */
export const MACHINES: Record<MachineKind, { name: string; color: string; letter: string }> = {
  paint: { name: 'Máy sơn', color: '#ffd23f', letter: 'S' },
  swap: { name: 'Máy đổi nhân vật', color: '#e07bff', letter: 'Đ' },
  size: { name: 'Máy đổi cỡ', color: '#4dd98b', letter: 'C' },
  shape: { name: 'Máy đổi hình', color: '#5ad1ff', letter: 'H' },
  mix: { name: 'Máy trộn màu', color: '#ff7aa8', letter: 'T' },
  double: { name: 'Máy nhân đôi', color: '#ffffff', letter: '2' },
};

interface Opening {
  a: Pt;
  b: Pt;
  mid: Pt;
  /** Unit vector pointing out of the cave. */
  normal: Pt;
  width: number;
}

interface Plan {
  flow: Flow;
  name: string;
  src: Cave;
  tgt: Cave;
  opening: Opening;
  target: Pt;
}

/** `route` is the line marbles travel along and `width` its width; machines are placed on it. */
type Built = { carves: Carve[]; route: Pt[]; width: number; movers?: Mover[]; portal?: Omit<Portal, 'flow' | 'only'>; pegs?: Peg[]; wheel?: Wheel; warning?: string } | { error: string };

const GATE_COLOR = '#c9d0de';
const MOVER_COLOR = '#c99a52';
const PORTAL_COLOR = '#b06bff';
const GATE_THICKNESS = 8;
const DEFAULT_FUNNEL = 40;
const TERRAIN_THICKNESS = 12;
/** Carved paths reach this far into the target so they always join it. */
const JOIN = 16;

export function moverPosition(m: Mover, t: number): Pt {
  const p = (((m.offset + m.speed * t) % m.loop) + m.loop) % m.loop;
  const { start: s, u, n, length, depth } = m;
  if (p < depth) return { x: s.x - n.x * (depth - p), y: s.y - n.y * (depth - p) };
  if (p < depth + length) return { x: s.x + u.x * (p - depth), y: s.y + u.y * (p - depth) };
  const sink = Math.min(depth, p - depth - length);
  return { x: s.x + u.x * length - n.x * sink, y: s.y + u.y * length - n.y * sink };
}

/** `walls: false` skips the physics colliders, for the editor preview. */
export function buildLayout(map: MapDoc, { walls = true } = {}): Layout {
  const errors: string[] = [];
  const warnings: string[] = [];
  const caves = new Map(map.caves.map((c) => [c.id, c]));
  const gates: Wall[] = [];
  const openings = new Map<string, Opening>();
  const carves: Carve[] = map.caves.map((cave) => {
    const own: Opening[] = [];
    (cave.valves ?? []).forEach((v, k) => {
      const id = valveId(v, k);
      const o = valveOpening(cave, v);
      if (!o) {
        errors.push(`hang ${cave.id}, van "${id}": nằm ngoài đáy hang (x lệch quá xa?)`);
        return;
      }
      openings.set(`${cave.id}/${id}`, o);
      gates.push(gate(cave, id, o));
      own.push(o);
    });
    const keep = [...(cave.funnel === false || !own.length ? [] : funnel(cave, own, cave.funnel ?? DEFAULT_FUNNEL)), ...dividers(cave)];
    return cave.shape.kind === 'circle'
      ? { kind: 'circle', x: cave.x, y: cave.y, r: cave.shape.radius, keep }
      : { kind: 'polygon', points: outline(cave), keep };
  });

  const flows = map.flows ?? [];
  const used = new Set<string>();
  const movers: Mover[] = [];
  const machines: Machine[] = [];
  const portals: Portal[] = [];
  const pegs: Peg[] = [];
  const wheels: Wheel[] = [];
  const routes: (Pt[] | null)[] = flows.map(() => null);
  flows.forEach((flow, i) => {
    const src = caves.get(flow.from)!;
    const tgt = caves.get(flow.to)!;
    const name = `flows[${i}] ${flow.from}→${flow.to}`;
    const key = `${src.id}/${flow.valve ?? valveId(src.valves![0], 0)}`;
    const opening = openings.get(key);
    if (!opening) return;
    used.add(key);
    const tx = targetX(flow, opening, tgt, flows);
    const ty = outlineYAt(tgt, tx, 'top');
    if (ty === null) {
      errors.push(`${name}: điểm rơi x=${Math.round(tx)} nằm ngoài hang ${tgt.id}`);
      return;
    }
    const plan = { flow, name, src, tgt, opening, target: { x: tx, y: ty } };
    const built = flow.kind === 'pipe' ? pipe(plan)
      : flow.kind === 'zigzag' ? pipe({ ...plan, flow: { ...flow, via: zigzagVia(plan) } })
      : flow.kind === 'waterfall' ? waterfall(plan)
      : flow.kind === 'pegs' ? pegboard(plan, map.physics?.marbleRadius ?? 4)
      : flow.kind === 'portal' ? portal(plan)
      : flow.kind === 'wheel' ? wheel(plan, map.physics?.marbleRadius ?? 4)
      : conveyor(plan, map, caves);
    if ('error' in built) {
      errors.push(`${name}: ${built.error}`);
      return;
    }
    carves.push(...built.carves);
    routes[i] = built.route;
    movers.push(...(built.movers ?? []));
    if (built.portal) portals.push({ flow: i, ...built.portal, only: (flow.only ?? []).map((c) => c.toLowerCase()) });
    pegs.push(...(built.pegs ?? []));
    if (built.wheel) wheels.push(built.wheel);
    const bar = (at: number) => barAcross(built.route, at, built.width / 2 + 10);
    if (flow.paint) machines.push({ kind: 'paint', flow: i, ...bar(flow.paint.at ?? 0.5) });
    if (flow.swap) machines.push({ kind: 'swap', flow: i, character: flow.swap.character, ...bar(flow.swap.at ?? 0.4) });
    if (flow.size) machines.push({ kind: 'size', flow: i, scale: flow.size.scale, ...bar(flow.size.at ?? 0.3) });
    if (flow.shape) machines.push({ kind: 'shape', flow: i, shape: flow.shape.shape, ...bar(flow.shape.at ?? 0.5) });
    if (flow.mix) machines.push({ kind: 'mix', flow: i, color: flow.mix.color, ...bar(flow.mix.at ?? 0.5) });
    if (flow.double) machines.push({ kind: 'double', flow: i, ...bar(flow.double.at ?? 0.4) });
    if (built.warning) warnings.push(`${name}: ${built.warning}`);
  });
  // Pipes and the like need a valve each; only portals may share one (a colour sorter).
  const byValve = new Map<string, number[]>();
  flows.forEach((f, i) => {
    const src = caves.get(f.from);
    if (!src?.valves?.length) return;
    const key = `${src.id}/${f.valve ?? valveId(src.valves[0], 0)}`;
    byValve.set(key, [...(byValve.get(key) ?? []), i]);
  });
  for (const [key, list] of byValve) {
    if (list.length > 1 && list.some((i) => flows[i].kind !== 'portal')) errors.push(`van ${key} có ${list.length} đường nối. Một van chỉ nối một đường, trừ khi tất cả là cổng dịch chuyển (máy phân loại).`);
  }
  for (const key of openings.keys()) {
    if (!used.has(key)) warnings.push(`van ${key} chưa nối vào đâu, mở ra bi sẽ không có chỗ chảy.`);
  }

  const field = buildField(map.frame.width, map.frame.height, carves);
  for (const p of portals) {
    if (p.entry.y > map.frame.height - p.r) errors.push(`flows[${p.flow}]: cổng vào tụt khỏi đáy khung hình. Nâng hang ${flows[p.flow].from} lên.`);
  }
  return { field, terrain: walls ? terrainWalls(field) : [], gates, movers, machines, portals, pegs, wheels, routes, errors, warnings };
}

// Box colliders along every carved outline, pushed into the solid side and never thicker than the ground there.
function terrainWalls(field: Field): WallPiece[] {
  const walls: WallPiece[] = [];
  for (const loop of traceOutlines(field)) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const len = dist(a, b);
      if (len < 0.01) continue;
      const nx = (b.y - a.y) / len;
      const ny = -(b.x - a.x) / len;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const side: 1 | -1 = sampleField(field, mid.x + nx * 1.5, mid.y + ny * 1.5) > 0 ? 1 : -1;
      let thickness = 2;
      while (thickness < TERRAIN_THICKNESS && sampleField(field, mid.x + nx * side * (thickness + 2), mid.y + ny * side * (thickness + 2)) > 0.5) {
        thickness += 2;
      }
      // Overlap neighbours slightly so marbles never catch on a joint.
      const ex = ((b.x - a.x) / len) * 0.5;
      const ey = ((b.y - a.y) / len) * 0.5;
      walls.push(piece('terrain', { x: a.x - ex, y: a.y - ey }, { x: b.x + ex, y: b.y + ey }, thickness, side));
    }
  }
  return walls;
}

// Solid wedges on the cave floor that rise from each valve edge at `degrees`, so nothing can rest away from a valve.
// Between two valves the wedges meet in a ridge that sheds marbles to both sides.
function funnel(cave: Cave, openings: Opening[], degrees: number): Pt[][] {
  const span = cave.shape.radius * 2;
  const rise = Math.tan((degrees * Math.PI) / 180);
  const sorted = [...openings].sort((p, q) => p.mid.x - q.mid.x);
  const wedges: Pt[][] = [];
  sorted.forEach((o, i) => {
    const [a, b] = o.a.x < o.b.x ? [o.a, o.b] : [o.b, o.a];
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    // Each wedge stops halfway to the neighbouring valve, so two wedges form a Λ ridge, not a V pocket.
    const left = prev ? (Math.max(prev.a.x, prev.b.x) + a.x) / 2 : a.x - span;
    const right = next ? (b.x + Math.min(next.a.x, next.b.x)) / 2 : b.x + span;
    const floor = cave.y + span;
    wedges.push(
      [a, { x: left, y: a.y - (a.x - left) * rise }, { x: left, y: floor }, { x: a.x, y: floor }],
      [b, { x: right, y: b.y - (right - b.x) * rise }, { x: right, y: floor }, { x: b.x, y: floor }],
    );
  });
  return wedges;
}

// Thin walls left standing inside the cave, from below the floor up to `height` of the cave.
function dividers(cave: Cave): Pt[][] {
  const d = cave.dividers;
  if (!d || d.count < 2) return [];
  const poly = outline(cave);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const half = (d.thickness ?? 10) / 2;
  const tip = bottom - (bottom - top) * Math.max(0.05, Math.min(1, d.height ?? 0.6));
  return Array.from({ length: d.count - 1 }, (_, k) => {
    const x = left + ((right - left) * (k + 1)) / d.count;
    return [{ x: x - half, y: tip }, { x: x + half, y: tip }, { x: x + half, y: bottom + 40 }, { x: x - half, y: bottom + 40 }];
  });
}

// A bar of half-length `half` across the route, `fraction` of the way along it.
function barAcross(route: Pt[], fraction: number, half: number): { a: Pt; b: Pt } {
  const lengths = route.slice(1).map((p, i) => dist(route[i], p));
  let left = lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, fraction));
  let i = 0;
  while (i < lengths.length - 1 && left > lengths[i]) left -= lengths[i++];
  const p0 = route[i];
  const p1 = route[i + 1];
  const k = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
  const c = { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k };
  const len = lengths[i] || 1;
  const nx = -(p1.y - p0.y) / len;
  const ny = (p1.x - p0.x) / len;
  return { a: { x: c.x - nx * half, y: c.y - ny * half }, b: { x: c.x + nx * half, y: c.y + ny * half } };
}

function valveOpening(cave: Cave, v: Valve): Opening | null {
  const cx = cave.x + (v.x ?? 0);
  const ya = outlineYAt(cave, cx - v.width / 2, 'bottom');
  const yb = outlineYAt(cave, cx + v.width / 2, 'bottom');
  if (ya === null || yb === null || ya < cave.y || yb < cave.y) return null;
  const a = { x: cx - v.width / 2, y: ya };
  const b = { x: cx + v.width / 2, y: yb };
  const mid = { x: cx, y: (ya + yb) / 2 };
  const width = dist(a, b);
  let normal = { x: -(b.y - a.y) / width, y: (b.x - a.x) / width };
  if (normal.x * (mid.x - cave.x) + normal.y * (mid.y - cave.y) < 0) normal = { x: -normal.x, y: -normal.y };
  return { a, b, mid, normal, width };
}

// A plank across the valve mouth, slightly longer than the opening so it seals against the ground.
function gate(cave: Cave, id: string, o: Opening): Wall {
  const ux = (o.b.x - o.a.x) / o.width;
  const uy = (o.b.y - o.a.y) / o.width;
  const a = { x: o.a.x - ux * 6, y: o.a.y - uy * 6 };
  const b = { x: o.b.x + ux * 6, y: o.b.y + uy * 6 };
  const side: 1 | -1 = (b.y - a.y) * o.normal.x - (b.x - a.x) * o.normal.y > 0 ? 1 : -1;
  return { ...piece(cave.id, a, b, GATE_THICKNESS, side), valve: id, color: GATE_COLOR };
}

// Flows without an explicit landing point spread across the target top, in the order they are listed.
function targetX(flow: Flow, o: Opening, tgt: Cave, flows: Flow[]): number {
  if (flow.at !== undefined) return tgt.x + flow.at;
  const xs = outline(tgt).map((p) => p.x);
  const half = (Math.max(...xs) - Math.min(...xs)) / 2;
  // Conveyors land on the near shoulder of the target so the chute from the top stays short.
  if (flow.kind === 'conveyor') return tgt.x - (Math.sign(tgt.x - o.mid.x) || 1) * half * 0.45;
  const siblings = flows.filter((f) => f.to === tgt.id && f.at === undefined && f.kind !== 'conveyor');
  if (siblings.length > 1) {
    const k = siblings.indexOf(flow);
    return tgt.x - half * 0.35 + (half * 0.7 * k) / (siblings.length - 1);
  }
  return Math.max(tgt.x - half * 0.5, Math.min(tgt.x + half * 0.5, o.mid.x));
}

function pipe({ flow, opening: o, target: t }: Plan): Built {
  if (t.y < o.mid.y + 40) return { error: 'hang đích cao hơn chỗ ra, bi không tự chảy lên được. Dùng "conveyor".' };
  const via = (flow.via ?? []).map(([x, y]) => ({ x, y }));
  const start = { x: o.mid.x + o.normal.x * 20, y: o.mid.y + o.normal.y * 20 };
  const curve = smoothPath([start, ...via, { x: t.x, y: t.y - 40 }], o.normal, { x: 0, y: 1 });
  const climbs = curve.some((p, i) => i > 0 && p.y < curve[i - 1].y - 1);
  const back = { x: o.mid.x - o.normal.x * 8, y: o.mid.y - o.normal.y * 8 };
  return {
    route: [o.mid, ...curve],
    width: o.width,
    carves: [{ kind: 'path', r: o.width / 2, points: [back, o.mid, ...curve, { x: t.x, y: t.y + JOIN }] }],
    warning: climbs ? 'ống có đoạn đi lên, bi có thể kẹt. Thử bớt điểm via.' : undefined,
  };
}

// A short drop from the valve into a portal, and a second portal just above the target. Loops and swaps need it:
// a belt always stands between the top of its source and the bottom of its target, so a closed loop of
// belts and pipes would have to cross itself.
function portal({ opening: o, target: t }: Plan): Built {
  const entry = { x: o.mid.x + o.normal.x * 110, y: o.mid.y + o.normal.y * 110 };
  const exit = { x: t.x, y: t.y - 110 };
  const r = o.width / 2;
  const back = { x: o.mid.x - o.normal.x * 8, y: o.mid.y - o.normal.y * 8 };
  return {
    route: [exit, { x: t.x, y: t.y }],
    width: o.width,
    portal: { entry, exit, r: r + 6, color: PORTAL_COLOR },
    carves: [
      { kind: 'path', r, points: [back, o.mid, entry] },
      { kind: 'path', r, points: [{ x: exit.x, y: exit.y - 14 }, exit, { x: t.x, y: t.y + JOIN }] },
    ],
  };
}

// A scoop wheel beside the source: marbles drop in on the near side low down, the arms sweep them up the near
// wall and over the top, and they leave through a gap on the far side into a chute down to the target.
function wheel({ flow, opening: o, target: t }: Plan, marbleRadius: number): Built {
  const R = flow.radius ?? 170;
  const dir = Math.sign(t.x - o.mid.x) || 1;
  const c = { x: o.mid.x + dir * (R + 40), y: o.mid.y + R * 0.6 + 70 };
  const feed = { x: c.x - dir * R * 0.8, y: c.y + R * 0.45 };
  // Each gap between two arms is a closed bucket (hub inside, wall outside). On the far side, a little below
  // level, the lower arm of each bucket slopes down to the wall, so the marbles roll out through the gap there.
  const out = (-18 * Math.PI) / 180;
  const exit = { x: c.x + dir * R * 0.97 * Math.cos(out), y: c.y - R * 0.97 * Math.sin(out) };
  const lip = { x: c.x + dir * (R + 60), y: exit.y + 45 };
  if (t.y < lip.y + 40) return { error: `hang ${flow.to} cao quá: bánh xe chỉ đưa bi lên tới y≈${Math.round(lip.y)}. Hạ hang đích xuống hoặc tăng "radius".` };
  if (dir * (t.x - lip.x) < 0) return { error: `hang ${flow.to} quá gần nguồn, bánh xe không có chỗ. Dời hang ra xa.` };
  const r = o.width / 2;
  const chute = Math.max(marbleRadius * 3.5, R * 0.22);
  const back = { x: o.mid.x - o.normal.x * 8, y: o.mid.y - o.normal.y * 8 };
  return {
    route: [o.mid, feed, { x: c.x, y: c.y - R }, exit, lip, t],
    width: chute * 2,
    wheel: { x: c.x, y: c.y, r: R - marbleRadius * 0.7, hub: R * 0.4, arms: flow.arms ?? 6, spin: (dir * (flow.speed ?? 50) * Math.PI) / 180, color: MOVER_COLOR },
    carves: [
      { kind: 'circle', x: c.x, y: c.y, r: R },
      { kind: 'path', r, points: [back, o.mid, { x: feed.x - dir * 10, y: feed.y - 40 }, feed] },
      // A wide mouth, so a whole bucket empties in the moment it passes.
      { kind: 'path', r: chute, points: [exit, lip, { x: t.x, y: t.y - 20 }, { x: t.x, y: t.y + JOIN }] },
    ],
  };
}

// A pipe that swings left and right on its way down, `turns` times (default 4).
function zigzagVia({ flow, opening: o, target: t }: Plan): [number, number][] {
  const turns = Math.max(1, flow.turns ?? 4);
  const top = o.mid.y + 60;
  const bottom = t.y - 80;
  // Each leg must fall at least as far as it runs sideways, or marbles stall in the turns.
  const swing = Math.min(flow.swing ?? 130, ((bottom - top) / turns) * 0.6);
  return Array.from({ length: turns }, (_, k) => {
    const u = (k + 0.5) / turns;
    const x = o.mid.x + (t.x - o.mid.x) * u + (k % 2 ? swing : -swing);
    return [Math.round(x), Math.round(top + (bottom - top) * u)];
  });
}

// A wide shaft full of pins in staggered rows: marbles bounce off them and spread out, like a Galton board.
function pegboard({ flow, opening: o, target: t, tgt }: Plan, marbleRadius: number): Built {
  if (t.y < o.mid.y + 200) return { error: 'lưới chốt cần hang đích thấp hơn chỗ ra ít nhất 200 px.' };
  // The board's foot must sit fully over the target, or marbles pile up in the corner that misses it.
  const xs = outline(tgt).map((p) => p.x);
  const room = Math.min(t.x - Math.min(...xs), Math.max(...xs) - t.x) * 0.8;
  const half = Math.min(room, Math.max(o.width / 2 + 30, flow.spread ?? 150));
  if (half < o.width / 2 + 20) return { error: `hang ${tgt.id} quá hẹp cho lưới chốt.` };
  const lift = (p: Pt) => ({ x: p.x - o.normal.x * 6, y: p.y - o.normal.y * 6 });
  const top = [lift(o.a), lift(o.b)].sort((p, q) => p.x - q.x);
  const neck = o.mid.y + 50;
  const corner = (x: number) => ({ x, y: Math.max(t.y, outlineYAt(tgt, x, 'top') ?? t.y) + JOIN });
  const bl = corner(t.x - half);
  const br = corner(t.x + half);
  const nl = { x: o.mid.x - o.width / 2 - 10, y: neck };
  const nr = { x: o.mid.x + o.width / 2 + 10, y: neck };
  // Pins sit on rows from just below the neck down to 70 px above the target; gaps fit three marbles side by side.
  const r = Math.max(4, marbleRadius * 1.4);
  const gap = 2 * r + marbleRadius * 6.5;
  const rowGap = gap * 0.87;
  const pins: Peg[] = [];
  const y0 = neck + 70;
  const y1 = Math.min(bl.y, br.y) - JOIN - 70;
  for (let row = 0, y = y0; y <= y1; row++, y += rowGap) {
    const u = (y - neck) / (Math.min(bl.y, br.y) - neck);
    const left = nl.x + (bl.x - nl.x) * u + gap * 0.6;
    const right = nr.x + (br.x - nr.x) * u - gap * 0.6;
    for (let x = t.x + (row % 2 ? gap / 2 : 0); x <= right; x += gap) if (x >= left) pins.push({ x, y, r });
    for (let x = t.x + (row % 2 ? gap / 2 : 0) - gap; x >= left; x -= gap) if (x <= right) pins.push({ x, y, r });
  }
  return {
    route: [o.mid, { x: t.x, y: neck + 40 }, t],
    width: half * 2,
    pegs: pins,
    carves: [{ kind: 'polygon', points: [top[0], top[1], nr, br, bl, nl] }],
  };
}

// A shaft that widens from the valve down to the target; when the target is off to the side, its lower wall is the slide.
function waterfall({ opening: o, target: t, tgt }: Plan): Built {
  const hw = o.width / 2 + 30;
  const lift = (p: Pt) => ({ x: p.x - o.normal.x * 6, y: p.y - o.normal.y * 6 });
  const top = [lift(o.a), lift(o.b)].sort((p, q) => p.x - q.x);
  // Each bottom corner sinks below the target's own top at that x, so no ledge of ground is left between them.
  const corner = (x: number) => ({ x, y: Math.max(t.y, outlineYAt(tgt, x, 'top') ?? t.y) + JOIN });
  const bl = corner(t.x - hw);
  const br = corner(t.x + hw);
  const slope = t.x > o.mid.x ? (bl.y - top[0].y) / Math.max(1, bl.x - top[0].x) : (br.y - top[1].y) / Math.max(1, top[1].x - br.x);
  if (slope > 0 && slope < 0.4) return { error: `thành thác quá thoải (${Math.round(slope * 100)}%, cần ít nhất 40%). Hạ hang đích xuống hoặc đưa lại gần.` };
  return { route: [o.mid, t], width: o.width + 60, carves: [{ kind: 'polygon', points: [top[0], top[1], br, bl] }] };
}

// Paddle conveyor: a straight tilted tube under the source valve. Paddles rise out of its floor, push marbles
// up to a short landing, then sink into the ground and return out of sight. A chute runs from the landing
// down into the target.
function conveyor({ flow, opening: o, target: t, tgt }: Plan, map: MapDoc, caves: Map<string, Cave>): Built {
  const r = map.physics?.marbleRadius ?? 4;
  const h = flow.paddle ?? 6 * r;
  // Less than one marble of room above the paddle tips, so nothing slips back over them.
  const tube = h + 1.2 * r;
  const spacing = flow.spacing ?? h * 1.6;
  const speed = flow.speed ?? 140;
  const depth = h + 20;
  const landing = h + 30;
  const dir = Math.sign(t.x - o.mid.x) || 1;
  const xs = outline(tgt).map((p) => p.x);
  const nearEdge = dir > 0 ? Math.min(...xs) : Math.max(...xs);

  // Top of the belt: clear of the target, high enough that the chute after the landing falls at 35%.
  const topX = nearEdge - dir * (h + 40);
  const chuteX = topX + dir * landing;
  const drop = landing * 0.35;
  const top = { x: topX, y: t.y - 30 - 0.35 * Math.abs(t.x - chuteX) - drop + tube / 2 };
  const chuteStart = { x: chuteX, y: top.y + drop - tube / 2 };
  if (dir * (top.x - o.mid.x) < tube) {
    return { error: `hang ${tgt.id} quá gần, băng chuyền không có chỗ. Dời ra xa thêm ${Math.ceil(tube - dir * (top.x - o.mid.x))} px.` };
  }
  if (top.y > o.mid.y) return { error: 'hang đích thấp hơn chỗ ra. Dùng "pipe" hoặc "waterfall".' };

  // Lower the belt foot until the tube lid stays clear of the valve and the tube passes under every cave.
  // The foot sits behind the valve so the whole feed drops into the tube, leaving no pocket behind it.
  const foot = { x: (dir > 0 ? Math.min(o.a.x, o.b.x) : Math.max(o.a.x, o.b.x)) - dir * 2, y: o.mid.y + 30 + 2 * tube };
  let u = { x: 1, y: 0 };
  let n = { x: 0, y: -1 };
  const lidY = (x: number) => foot.y + n.y * tube + ((x - (foot.x + n.x * tube)) * u.y) / u.x;
  const at = (p: Pt, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });
  // The belt band (from the hidden return path up to the lid, plus a margin of ground) must not touch any cave:
  // no cave corner inside the band, and no point of the band inside a cave.
  const crossed = () => {
    const len = dist(foot, top);
    const inBand = (p: Pt) => {
      const along = (p.x - foot.x) * u.x + (p.y - foot.y) * u.y;
      const across = (p.x - foot.x) * n.x + (p.y - foot.y) * n.y;
      return along > -14 && along < len + 14 && across > -depth - 14 && across < tube + 14;
    };
    const probes = Array.from({ length: Math.ceil(len / 8) + 1 }, (_, k) => (k * 8) / len).flatMap((k) => {
      const p = { x: foot.x + (top.x - foot.x) * k, y: foot.y + (top.y - foot.y) * k };
      return [p, at(p, tube + 14), at(p, -depth)];
    });
    return [...caves.values()].find((c) => {
      const poly = outline(c);
      return poly.some(inBand) || probes.some((p) => insidePolygon(p, poly));
    });
  };
  let hit: Cave | undefined;
  for (let k = 0; k < 60; k++) {
    const len = dist(foot, top);
    u = { x: (top.x - foot.x) / len, y: (top.y - foot.y) / len };
    n = u.x > 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    const clear = Math.min(lidY(o.a.x), lidY(o.b.x)) - (o.mid.y + 14);
    if (clear < 0) { foot.y -= clear; continue; }
    hit = crossed();
    if (!hit) break;
    foot.y += 15;
  }
  const length = dist(foot, top);
  const angle = (Math.atan2(foot.y - top.y, Math.abs(top.x - foot.x)) * 180) / Math.PI;
  if (hit) return { error: `băng chuyền cắt qua hang ${hit.id}. Dời các hang ra xa nhau hơn.` };
  const overshoot = foot.y + depth + 10 - map.frame.height;
  if (overshoot > 0) return { error: `chân băng chuyền tụt khỏi đáy khung hình ${Math.ceil(overshoot)} px. Nâng hang ${flow.from} lên.` };
  if (angle > 72) return { error: `băng chuyền dốc quá (${Math.round(angle)}°, tối đa 72°). Dời hang ${tgt.id} ra xa hoặc hạ thấp xuống.` };
  if (t.y - 30 - chuteStart.y < 0.25 * Math.abs(t.x - chuteStart.x)) return { error: 'máng từ đỉnh băng chuyền xuống hang đích không đủ dốc.' };

  const back = { x: foot.x - u.x * 4, y: foot.y - u.y * 4 };
  const lift = (p: Pt) => ({ x: p.x - o.normal.x * 6, y: p.y - o.normal.y * 6 });
  const feed = [lift(o.a), lift(o.b), { x: o.b.x, y: lidY(o.b.x) + 8 }, { x: o.a.x, y: lidY(o.a.x) + 8 }];

  const count = Math.max(1, Math.ceil((2 * depth + length) / spacing));
  const thick = 3;
  const points = [
    { x: -u.x * thick, y: -u.y * thick },
    { x: u.x * thick, y: u.y * thick },
    { x: u.x * thick + n.x * h, y: u.y * thick + n.y * h },
    { x: -u.x * thick + n.x * h, y: -u.y * thick + n.y * h },
  ];
  const movers: Mover[] = Array.from({ length: count }, (_, k) => ({
    owner: flow.from, start: foot, u, n, length, depth, loop: count * spacing, offset: k * spacing, speed, points, color: MOVER_COLOR,
  }));
  return {
    movers,
    route: [foot, top, chuteStart, { x: t.x, y: t.y - 30 }],
    width: tube,
    carves: [
      { kind: 'polygon', points: [back, top, at(top, tube), at(back, tube)] },
      { kind: 'polygon', points: feed },
      { kind: 'path', r: tube / 2, points: [at(top, tube / 2), chuteStart, { x: t.x, y: t.y - 30 }, { x: t.x, y: t.y + JOIN }] },
    ],
  };
}
