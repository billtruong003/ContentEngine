// Makes the picture caves end up full. Plays the map, measures how much of each picture cave the settled pile
// covers, and changes how many marbles each source cave starts with. When a source cannot hold that many, the
// picture caves it feeds shrink instead. A few rounds get within a few percent of the goal. Marbles poured in at
// one spot heap up there and leave the far corners empty, so the map also rocks once they are in.
import { createRng } from '../core/rng.ts';
import { buildLayout } from '../map/layout.ts';
import { fillPoints, insidePolygon, outline, type Pt } from '../map/geometry.ts';
import { reachable } from '../map/reach.ts';
import { sampleField } from '../map/terrain.ts';
import { DEFAULT_PHYSICS, type Cave, type MapDoc } from '../map/types.ts';
import { trial, type TrialResult } from './trial.ts';

/** Share of a picture cave's area the pile should cover. Higher and the last marbles back up into the pipe. */
export const FILL_GOAL = 0.92;
/** With rocking the pile levels out, so it can go right up to the top. */
export const ROCK_GOAL = 0.98;
const CLOSE_ENOUGH = 0.03;
/** Grid step (px) for measuring areas. */
const SAMPLE = 3;
/** Largest a source cave may grow to, as a share of its radius. */
const MAX_GROW = 1.4;
/** Gap kept between a grown source and the frame edge or other caves (px). */
const GAP = 40;
/** Smallest a picture cave may shrink to, as a share of its radius. */
const MIN_SHRINK = 0.6;

export interface FillResult {
  map: MapDoc;
  /** Trial of the map as returned. */
  result: TrialResult;
  /** How full each picture cave ended up (0–1). */
  fullness: Record<string, number>;
  log: string[];
}

/**
 * Physics must be loaded first (loadPhysics from sim.ts). `first` is a trial of `doc` already run, if any.
 * Unless `rock` is false the map also rocks once the marbles are in, so the pile reaches the far corners.
 */
export function fillTargets(doc: MapDoc, opts: { goal?: number; rounds?: number; first?: TrialResult; rock?: boolean } = {}): FillResult {
  const rocking = opts.rock ?? true;
  const goal = opts.goal ?? (rocking ? ROCK_GOAL : FILL_GOAL);
  const rounds = opts.rounds ?? (rocking && !doc.rock ? 5 : 4);
  let map = structuredClone(doc);
  let result = opts.first ?? trial(map);
  let best: FillResult | null = null;
  let bestMiss = Infinity;
  const log: string[] = [];
  let before: Measured[] | null = null;
  for (let round = 0; ; round++) {
    const measured = result.final ? measure(map, result) : null;
    const fullness = Object.fromEntries((measured ?? []).map((m) => [m.id, m.fullness]));
    const text = (measured ?? []).map((m) => `${m.id} ${Math.round(m.fullness * 100)}%${m.reach < 0.97 ? ` (chỗ rót chỉ lấp được ${Math.round(m.reach * 100)}%)` : ''}`).join(', ');
    log.push(`lần ${round + 1}: ${result.ok ? 'chạy ổn' : result.problems.join('; ')}${map.rock ? ` · lắc từ giây ${map.rock.t}` : ''}${text ? ` · đầy ${text}` : ''}`);
    // A round without the rocking the caller asked for never counts as the answer.
    const usable = result.ok && measured && (!rocking || map.rock);
    if (usable) {
      // The best round is the one whose fullest or emptiest cave is closest to the goal.
      const miss = Math.max(...measured.map((m) => Math.abs(m.fullness - aim(m, goal))));
      if (!best || miss < bestMiss) {
        best = { map: structuredClone(map), result, fullness, log };
        bestMiss = miss;
      }
      if (miss <= CLOSE_ENOUGH) break;
    }
    if (round >= rounds || !measured) break;
    // A failed run after adding marbles usually means the pile overflowed into the pipe: step back a little.
    const next = result.ok ? adjust(map, result, measured, before, goal) : scaleSources(map, 0.93);
    // A race is only fair if every team starts with as many marbles.
    if (next.captions?.some((c) => c.kind === 'score')) evenTeams(next);
    // Rocking changes how the pile packs, so a run without it says nothing about the next one with it.
    before = result.ok && (!rocking || map.rock) ? measured : null;
    // Rock as soon as the marbles are in; the ones still in the pipe above top the pile up.
    if (rocking && result.arrivedAt !== null) next.rock = { ...next.rock, t: Math.round(result.arrivedAt * 2) / 2 };
    map = next;
    result = trial(map);
  }
  return best ? { ...best, log } : { map: doc, result: opts.first ?? result, fullness: {}, log };
}

interface Measured {
  id: string;
  fullness: number;
  marbles: number;
  area: number;
  perMarble: number;
  /** The most of the cave its inlets can ever fill (0–1). */
  reach: number;
}

/** The fullness to aim for in one cave: the goal, or a little under what its inlets can reach. */
const aim = (m: Measured, goal: number): number => Math.min(goal, m.reach - 0.02);

// Area under the pile: the grid points inside the cave that lie below the highest marble in their column.
function measure(map: MapDoc, r: TrialResult): Measured[] {
  const radius = map.physics?.marbleRadius ?? DEFAULT_PHYSICS.marbleRadius;
  const pos = r.final!;
  const n = pos.length / 3;
  const { routes } = buildLayout(map, { walls: false });
  return r.targets.map((id) => {
    const cave = map.caves.find((c) => c.id === id)!;
    const poly = outline(cave);
    const box = bounds(poly);
    const bin = radius * 3;
    const tops = new Map<number, number>();
    let marbles = 0;
    for (let i = 0; i < n; i++) {
      const p = { x: pos[i * 3], y: pos[i * 3 + 1] };
      if (Number.isNaN(p.x) || p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1 || !insidePolygon(p, poly)) continue;
      marbles++;
      const k = Math.floor(p.x / bin);
      tops.set(k, Math.min(tops.get(k) ?? Infinity, p.y - radius));
    }
    let area = 0;
    let filled = 0;
    for (let y = box.y0; y <= box.y1; y += SAMPLE) {
      for (let x = box.x0; x <= box.x1; x += SAMPLE) {
        if (!insidePolygon({ x, y }, poly)) continue;
        area++;
        if (y >= (tops.get(Math.floor(x / bin)) ?? Infinity)) filled++;
      }
    }
    // Each flow's route ends where it lands on the cave.
    const inlets = (map.flows ?? []).flatMap((f, k) => (f.to === id && routes[k] ? [routes[k]!.at(-1)!.x] : []));
    const reach = inlets.length ? reachable(cave, inlets) : 1;
    return { id, fullness: area ? filled / area : 0, marbles, area: area * SAMPLE * SAMPLE, perMarble: marbles ? (filled * SAMPLE * SAMPLE) / marbles : 0, reach };
  });
}

// Each source gets as many marbles as the fullest-to-be picture cave it feeds can take.
function adjust(doc: MapDoc, r: TrialResult, measured: Measured[], before: Measured[] | null, goal: number): MapDoc {
  const map = structuredClone(doc);
  const pos = r.final!;
  const byId = new Map(measured.map((m) => [m.id, m]));
  const polys = new Map(measured.map((m) => [m.id, outline(map.caves.find((c) => c.id === m.id)!)]));
  // How many marbles from each source ended in each picture cave.
  const sent = new Map<number, Map<string, number>>();
  r.startCaves.forEach((src, i) => {
    if (src < 0 || Number.isNaN(pos[i * 3])) return;
    const p = { x: pos[i * 3], y: pos[i * 3 + 1] };
    for (const [id, poly] of polys) {
      if (!insidePolygon(p, poly)) continue;
      const per = sent.get(src) ?? new Map<string, number>();
      per.set(id, (per.get(id) ?? 0) + 1);
      sent.set(src, per);
      break;
    }
  });
  const shrink = new Map<string, number>();
  for (const [src, per] of sent) {
    const cave = map.caves[src];
    const factor = Math.min(...[...per.keys()].map((id) => {
      const m = byId.get(id)!;
      if (!m.marbles) return 1;
      return wanted(m, before?.find((b) => b.id === id), aim(m, goal)) / m.marbles;
    }));
    const want = Math.round(cave.marbles!.count * factor);
    let room = capacity(map, cave);
    // A source that cannot hold enough grows first, as far as the frame and its neighbours allow, so the picture keeps its size.
    if (want > room) {
      const grow = Math.min(MAX_GROW, Math.sqrt(want / room) * 1.03, roomToGrow(map, cave));
      if (grow > 1.01) {
        cave.shape.radius = Math.round(cave.shape.radius * grow);
        room = capacity(map, cave);
      }
    }
    cave.marbles!.count = Math.min(want, room);
    if (want > room) for (const id of per.keys()) shrink.set(id, Math.min(shrink.get(id) ?? 1, room / want));
  }
  // Area goes with the square of the radius.
  for (const [id, k] of shrink) {
    const cave = map.caves.find((c) => c.id === id)!;
    cave.shape.radius = Math.round(cave.shape.radius * Math.max(MIN_SHRINK, Math.sqrt(k)));
  }
  return map;
}

// Marbles a picture cave needs. Deeper piles pack tighter, so one run alone guesses low; with an earlier run of the
// same cave, draw the line through both and read off the goal.
function wanted(m: Measured, prev: Measured | undefined, goal: number): number {
  const guess = (goal * m.area) / (m.perMarble || 1);
  if (!prev || Math.abs(prev.area - m.area) > m.area * 0.01 || Math.abs(m.fullness - prev.fullness) < 0.02 || m.marbles === prev.marbles) return guess;
  const slope = (m.fullness - prev.fullness) / (m.marbles - prev.marbles);
  if (slope <= 0) return guess;
  return Math.max(m.marbles * 0.5, Math.min(m.marbles * 3, m.marbles + (goal - m.fullness) / slope));
}

// How much a cave can grow before its outline nears the frame edge or another cave. Caves are treated as the
// circle around their outline, which errs on the safe side.
function roomToGrow(map: MapDoc, cave: Cave): number {
  const reach = (c: Cave) => Math.max(...outline(c).map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  const r = reach(cave);
  let free = Math.min(cave.x, map.frame.width - cave.x, cave.y, map.frame.height - cave.y) - GAP;
  for (const other of map.caves) if (other !== cave) free = Math.min(free, Math.hypot(other.x - cave.x, other.y - cave.y) - reach(other) - GAP);
  return Math.max(1, free / r);
}

// Same marbles and same size of picture cave for every team.
function evenTeams(map: MapDoc): void {
  const teams = map.caves.filter((c) => c.marbles);
  const fewest = Math.min(...teams.map((c) => c.marbles!.count));
  for (const c of teams) c.marbles!.count = fewest;
  const fed = new Set((map.flows ?? []).map((f) => f.to));
  const goals = map.caves.filter((c) => fed.has(c.id) && !c.marbles);
  const smallest = Math.min(...goals.map((c) => c.shape.radius));
  for (const c of goals) c.shape.radius = smallest;
}

function scaleSources(doc: MapDoc, k: number): MapDoc {
  const map = structuredClone(doc);
  for (const c of map.caves) if (c.marbles) c.marbles.count = Math.round(c.marbles.count * k);
  return map;
}

// How many marbles a source cave can start with: the same placement grid the simulation uses, a little under full.
function capacity(map: MapDoc, cave: Cave): number {
  const radius = map.physics?.marbleRadius ?? DEFAULT_PHYSICS.marbleRadius;
  const { field } = buildLayout(map, { walls: false });
  return Math.floor(0.97 * fillPoints(cave, radius, 0, createRng(0), (p) => sampleField(field, p.x, p.y) < -radius * 1.5, !!cave.marbles?.paint).capacity);
}

function bounds(poly: Pt[]): { x0: number; x1: number; y0: number; y1: number } {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
