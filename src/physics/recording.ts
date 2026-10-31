import type { Machine, Mover, Peg, Portal, Wall, Wheel } from '../map/layout.ts';
import type { Field } from '../map/terrain.ts';
import type { Sim, SimReport } from './sim.ts';

// One frame = x, y, angle per marble as Int16. x/y in 1/8 px, so a 60 s video of 5,000 marbles is ~108 MB.
const POS_SCALE = 8;
const ANGLE_SCALE = 32767 / Math.PI;
const LOST = -32768;
export const FRAMES_PER_BATCH = 10;

export interface SceneInfo {
  frame: { width: number; height: number; background: string };
  marbleRadius: number;
  marbleColors: string[];
  /** Index (into map.caves) of the cave each marble started in. */
  marbleCaves: number[];
  /** Valve gates. */
  walls: Wall[];
  movers: Mover[];
  machines: Machine[];
  portals: Portal[];
  pegs: Peg[];
  wheels: Wheel[];
  /** Marbles from this index on are spares for doublers, hidden until handed out. */
  firstSpare: number;
  field: Field;
  ground: { color: string; rim: string; rimWidth: number };
  warnings: string[];
  totalFrames: number;
}

/** A per-wall or per-marble flag array that took effect at a frame. */
export interface Change {
  frame: number;
  state: Uint8Array;
}

export type { SimReport };

export interface Decoded {
  x: number;
  y: number;
  angle: number;
}

export function encodeFrame(sim: Sim, scratch: Float32Array, out: Int16Array, offset: number): void {
  sim.readMarbles(scratch);
  for (let i = 0; i < sim.marbles.length; i++) {
    const o = offset + i * 3;
    if (sim.isLost(i)) {
      out[o] = LOST;
      continue;
    }
    const a = scratch[i * 3 + 2];
    out[o] = Math.round(scratch[i * 3] * POS_SCALE);
    out[o + 1] = Math.round(scratch[i * 3 + 1] * POS_SCALE);
    out[o + 2] = Math.round((a - 2 * Math.PI * Math.round(a / (2 * Math.PI))) * ANGLE_SCALE);
  }
}

export function wallState(sim: Sim): Uint8Array {
  return Uint8Array.from(sim.walls, (w) => (w.collider ? 0 : 1));
}

export class Recording {
  readonly marbleCount: number;
  readonly totalFrames: number;
  frames = 0;
  done = false;
  private readonly batches: Int16Array[] = [];
  report: SimReport | null = null;
  /** Frame at which each marble passed a paint machine, or -1. Known once the bake is done. */
  paintFrames: Int32Array | null = null;
  private readonly wallChanges: Change[] = [];
  private readonly stuckChanges: Change[] = [];

  constructor(marbleCount: number, totalFrames: number) {
    this.marbleCount = marbleCount;
    this.totalFrames = totalFrames;
  }

  addBatch(data: Int16Array, walls: Change[], stuck: Change[]): void {
    this.batches.push(data);
    this.wallChanges.push(...walls);
    this.stuckChanges.push(...stuck);
    this.frames += data.length / (this.marbleCount * 3);
  }

  // Returns false for lost marbles.
  marble(frame: number, i: number, out: Decoded): boolean {
    const data = this.batches[Math.floor(frame / FRAMES_PER_BATCH)];
    const o = ((frame % FRAMES_PER_BATCH) * this.marbleCount + i) * 3;
    if (data[o] === LOST) return false;
    out.x = data[o] / POS_SCALE;
    out.y = data[o + 1] / POS_SCALE;
    out.angle = data[o + 2] / ANGLE_SCALE;
    return true;
  }

  wallsAt(frame: number): Uint8Array {
    return latest(this.wallChanges, frame)!.state;
  }

  stuckAt(frame: number): Uint8Array | null {
    return latest(this.stuckChanges, frame)?.state ?? null;
  }
}

function latest(changes: Change[], frame: number): Change | undefined {
  let found: Change | undefined;
  for (const c of changes) {
    if (c.frame > frame) break;
    found = c;
  }
  return found;
}
