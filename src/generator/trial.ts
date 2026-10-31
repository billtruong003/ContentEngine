// Plays a candidate map through without drawing anything and decides whether it is good enough to film:
// no stuck or lost marbles, (nearly) every marble ends in a picture cave, and the pile comes to rest in time.
// It also measures when the pile settles, so the ending can start right after instead of at a guess.
import { outline, type Pt } from '../map/geometry.ts';
import { validateMap } from '../map/validate.ts';
import { DEFAULT_DURATION, rockEnd, type Cave, type MapDoc } from '../map/types.ts';
import { Sim, STEP, type SimReport } from '../physics/sim.ts';

/** Share of marbles that must end inside the picture caves. */
const MIN_FILL = 0.97;
/** At most this share may still be moving for the pile to count as settled. */
const MAX_MOVING = 0.01;
const SAMPLE_STEPS = 30;
/** Share of marbles that may rest in the pipe just above a full picture cave. */
const MAX_BACKED_UP = 0.01;
/** How far above a picture cave (px) a resting marble still counts as backed up rather than stuck. */
const MOUTH = 80;
/** px a marble must move between two samples to count as moving. */
const MOVE_PX = 2;

export interface TrialResult {
  ok: boolean;
  problems: string[];
  /** Second the pile came to rest, or null if it never did. */
  settledAt: number | null;
  /** First second (nearly) every marble was inside the picture caves, still moving or not. */
  arrivedAt: number | null;
  report: SimReport | null;
  /** Where every marble ended (x, y, angle per marble; lost marbles are NaN), and the cave index it started in. */
  final: Float32Array | null;
  startCaves: number[];
  /** The caves the picture forms in. */
  targets: string[];
}

/** Physics must be loaded first (loadPhysics from sim.ts). */
export function trial(doc: MapDoc): TrialResult {
  const problems: string[] = [];
  // The run checks the filling only: endings and spins happen after the picture is done and would scatter it.
  // Rocking is part of the filling and stays.
  const raw = structuredClone(doc);
  delete raw.ending;
  delete raw.spin;
  // Long enough for the rocking and the pile to settle after it, even when the ending was timed before it.
  raw.duration = Math.max(doc.duration ?? DEFAULT_DURATION, raw.rock ? rockEnd(raw.rock) + 4 : 0) + 6;
  const { map, errors, warnings } = validateMap(raw);
  if (!map) return { ok: false, problems: errors, settledAt: null, arrivedAt: null, report: null, final: null, startCaves: [], targets: [] };
  problems.push(...warnings);

  const fed = new Set((map.flows ?? []).map((f) => f.to));
  const painted = map.caves.filter((c) => c.paint).map((c) => c.id);
  const targets = painted.length ? painted : map.caves.filter((c) => fed.has(c.id) && !c.valves?.length).map((c) => c.id);
  const lastOpen = Math.max(0, ...map.events.map((e) => e.t), map.rock ? rockEnd(map.rock) : 0);

  const sim = new Sim(map);
  const n = sim.marbles.length;
  let before = new Float32Array(n * 3);
  let now = new Float32Array(n * 3);
  sim.readMarbles(before);
  const steps = Math.round(map.duration! / STEP);
  let settledAt: number | null = null;
  let arrivedAt: number | null = null;
  let report: SimReport | null = null;
  for (let s = 1; s <= steps; s++) {
    sim.tick();
    if (s % SAMPLE_STEPS) continue;
    sim.readMarbles(now);
    let moving = 0;
    for (let i = 0; i < n; i++) {
      if (sim.isLost(i)) continue;
      if (Math.hypot(now[i * 3] - before[i * 3], now[i * 3 + 1] - before[i * 3 + 1]) > MOVE_PX) moving++;
    }
    [before, now] = [now, before];
    if (arrivedAt === null) {
      const r = sim.report();
      if (targets.reduce((sum, id) => sum + r.caves[id], 0) >= n * MIN_FILL) arrivedAt = sim.time;
    }
    if (sim.time <= lastOpen + 1 || moving > n * MAX_MOVING) continue;
    report = sim.report();
    const inTargets = targets.reduce((sum, id) => sum + report!.caves[id], 0);
    if (inTargets >= n * MIN_FILL) {
      settledAt = sim.time;
      break;
    }
  }
  report ??= sim.report();
  sim.readMarbles(now);
  for (let i = 0; i < n; i++) if (sim.isLost(i)) now[i * 3] = now[i * 3 + 1] = NaN;
  const startCaves = [...sim.marbleCaves];
  for (const w of sim.warnings) problems.push(w);
  sim.dispose();

  // A full picture cave backs the last few marbles up into the pipe right above it: that reads as full, not stuck.
  const backedUp = report.stuck <= n * MAX_BACKED_UP && report.stuckSpots.every((p) => targets.some((id) => nearCave(map.caves.find((c) => c.id === id)!, p)));
  if (report.stuck && !backedUp) problems.push(`${report.stuck} bi kẹt${report.stuckSpots[0] ? ` quanh (${report.stuckSpots[0].x}, ${report.stuckSpots[0].y})` : ''}`);
  if (report.lost) problems.push(`${report.lost} bi rơi khỏi map`);
  if (report.unpainted) problems.push(`${report.unpainted} bi lọt máy sơn`);
  if (settledAt === null) {
    const inTargets = targets.reduce((sum, id) => sum + report!.caves[id], 0);
    problems.push(inTargets < n * MIN_FILL
      ? `chỉ ${inTargets}/${n} bi vào hang đích (${targets.join(', ')})`
      : 'đống bi chưa nằm yên trước khi hết giờ');
  }
  return { ok: problems.length === 0, problems, settledAt, arrivedAt, report, final: now, startCaves, targets };
}

/** Moves the ending to just after the pile settled and trims the video to fit. */
export function retime(map: MapDoc, settledAt: number): MapDoc {
  const t = Math.ceil((settledAt + 0.8) * 2) / 2;
  const zoom = map.camera?.zoom;
  const flips = map.caves.map((c) => c.paint?.flip).filter((f) => f !== undefined);
  if (map.ending) map.ending.t = t;
  if (zoom) zoom.t = t;
  for (const f of flips) f.t = t;
  const tail = map.ending ? 5 : zoom || flips.length ? 4 : 1.5;
  map.duration = t + tail;
  return map;
}

function nearCave(cave: Cave, p: Pt): boolean {
  const poly = outline(cave);
  const xs = poly.map((q) => q.x);
  const ys = poly.map((q) => q.y);
  return p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.y >= Math.min(...ys) - MOUTH && p.y <= Math.max(...ys);
}
