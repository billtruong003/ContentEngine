import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-deterministic-compat';
import { createRng } from '../core/rng.ts';
import { STEP } from '../core/time.ts';
import { fillPoints, insidePolygon, outline, type Pt, type WallPiece } from '../map/geometry.ts';
import { buildLayout, moverPosition, type Machine, type Mover, type Peg, type Portal, type Wheel, wheelAngle, type Wall as LayoutWall } from '../map/layout.ts';
import { sampleField, type Field } from '../map/terrain.ts';
import { DEFAULT_PHYSICS, mapTurn, rockEnd, type MapDoc, type MapEvent, type Physics } from '../map/types.ts';

export { STEP };
// Marbles are ~0.8 m in physics space; Rapier's tolerances are tuned for objects near 1 m and run much faster than at 0.08 m.
const PX_PER_METER = 10;
/** Marbles leave a portal side by side in lanes this far apart (in marble radii), moving down at PORTAL_SPEED px/s. */
const PORTAL_LANE = 2.6;
const PORTAL_SPEED = 250;
const CHECK_EVERY = 30;
/** Steps between waking every marble while the map rocks. */
const WAKE_EVERY = 10;
const LOST_MARGIN = 50;
const TELEPORT_PX = 30;
// Marbles move at most ~6 px per step, so checking every other step cannot skip a machine (radius >= 20 px).
const PAINT_CHECK_EVERY = 2;
// Gravity alone changes velocity by 50 px/s per step; anything well above that is an impact.
const SOUND_THRESHOLD = 450;
const MAX_SOUNDS_PER_STEP = 8;
// A marble that has not moved this far in this many steps counts as stuck, unless it is resting in a cave
// that is meant to hold it (one whose valves are all closed, or that has none).
const STUCK_STEPS = 180;
const STUCK_MOVE_PX = 6;
/** A marble resting this long in a cave with an open valve gets a small shake, like a vibrator on a hopper. */
const SHAKE_STEPS = 120;
const SHAKE_SPEED = 250;

let ready: Promise<void> | null = null;
export function loadPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

export interface Wall extends LayoutWall {
  collider: Collider | null;
}

export interface SimReport {
  lost: number;
  stuck: number;
  /** Marbles resting outside every cave (in pipes, on ramps...). */
  outside: number;
  caves: Record<string, number>;
  /** Marbles that ended in a cave with a target picture without passing a paint machine. */
  unpainted: number;
  /** Where stuck marbles bunch up, biggest clusters first. */
  stuckSpots: { x: number; y: number; count: number }[];
}

const SPOT_SIZE = 40;

interface CaveArea {
  id: string;
  poly: Pt[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class Sim {
  readonly map: MapDoc;
  readonly physics: Physics;
  readonly world: World;
  readonly marbles: RigidBody[] = [];
  readonly marbleColors: string[] = [];
  /** Valve gates only; the carved ground is static and lives in `field`. */
  readonly walls: Wall[] = [];
  readonly field: Field;
  readonly movers: Mover[];
  readonly machines: Machine[];
  readonly portals: Portal[];
  readonly pegs: Peg[];
  /** Step at which each marble first passed a paint machine, or -1. */
  readonly paintSteps: Int32Array;
  /** Per machine: step at which each marble first crossed it, or -1. */
  readonly machineSteps: Int32Array[];
  /** Index of the cave each marble started in, -1 for spare marbles. */
  readonly marbleCaves: number[] = [];
  /** Marbles from this index on are spares, hidden until a doubler hands one out. */
  firstSpare = 0;
  /** For each spare in use: the marble it is a twin of; -1 otherwise. */
  cloneOf = new Int32Array(0);
  private nextSpare = 0;
  /** Collision sounds as [frame, marble, x px, strength px/s], at most MAX_SOUNDS_PER_STEP per frame. */
  readonly sounds: number[] = [];
  private velX = new Float32Array(0);
  private velY = new Float32Array(0);
  readonly warnings: string[] = [];
  readonly stuck: Uint8Array;
  stepIndex = 0;
  wallsVersion = 0;
  stuckVersion = 0;
  lostCount = 0;
  private readonly moverBodies: RigidBody[] = [];
  private readonly areas: CaveArea[];
  /** Caves with at least one open valve. */
  private readonly draining = new Set<string>();
  private readonly paintedCaves: Set<string>;
  private readonly events: MapEvent[];
  private nextEvent = 0;
  private readonly terrain: Collider[] = [];
  readonly wheels: Wheel[];
  private readonly wheelBodies: RigidBody[] = [];
  /** Set once the "break" ending has shattered the ground: from then on marbles leaving the frame are expected. */
  broken = false;
  private anchors = new Float32Array(0);
  private prevX = new Float32Array(0);
  private prevY = new Float32Array(0);
  private anchorSteps = new Int32Array(0);
  /** Seeded separately from marble placement, so shakes never change where marbles start. */
  private readonly shake: () => number;
  /** Per portal: the marble it sent last, which must clear the exit before the next one comes through. */
  private readonly lastThrough: number[][];

  constructor(map: MapDoc) {
    this.map = map;
    this.physics = { ...DEFAULT_PHYSICS, ...map.physics };
    this.world = new RAPIER.World({ x: 0, y: -this.physics.gravity / PX_PER_METER });
    this.world.timestep = STEP;
    if (this.physics.stiffness) this.world.integrationParameters.contact_natural_frequency = this.physics.stiffness;
    this.events = [...map.events].sort((a, b) => a.t - b.t);

    const layout = buildLayout(map);
    if (layout.errors.length) throw new Error(layout.errors.join('\n'));
    this.warnings.push(...layout.warnings);
    this.field = layout.field;
    for (const w of layout.terrain) this.terrain.push(this.createWallCollider(w));
    for (const w of layout.gates) this.walls.push({ ...w, collider: this.createWallCollider(w) });
    this.movers = layout.movers;
    this.machines = layout.machines;
    this.portals = layout.portals;
    this.pegs = layout.pegs;
    for (const g of this.pegs) {
      this.world.createCollider(RAPIER.ColliderDesc.ball(g.r / PX_PER_METER).setTranslation(g.x / PX_PER_METER, -g.y / PX_PER_METER)
        .setFriction(this.physics.friction).setRestitution(0.3));
    }
    // As many lanes as fit across the exit pipe (its radius is the portal's catch radius less 6 px).
    const r = this.physics.marbleRadius;
    this.lastThrough = this.portals.map((p) => new Array(Math.max(1, Math.floor((2 * (p.r - 6) - 2 * r) / (PORTAL_LANE * r)) + 1)).fill(-1));
    this.paintedCaves = new Set(map.caves.filter((c) => c.paint).map((c) => c.id));
    for (const m of this.movers) this.moverBodies.push(this.createMover(m));
    this.wheels = layout.wheels;
    for (const w of this.wheels) this.wheelBodies.push(this.createWheel(w));
    this.areas = map.caves.map((c) => {
      const poly = outline(c);
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      return { id: c.id, poly, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });

    this.shake = createRng(map.seed + 7919);
    const rng = createRng(map.seed);
    for (const cave of map.caves) {
      if (!cave.marbles?.count) continue;
      const { points, capacity } = fillPoints(cave, this.physics.marbleRadius, cave.marbles.count, rng, (p) => sampleField(this.field, p.x, p.y) < -this.physics.marbleRadius * 1.5, !!cave.marbles.paint);
      if (capacity < cave.marbles.count) {
        this.warnings.push(`Hang ${cave.id} chứa được khoảng ${capacity} bi, đang xin ${cave.marbles.count}. Chỉ tạo ${capacity}.`);
      }
      for (const p of points) {
        this.addMarble(p.x, p.y, cave.marbles.colors[Math.floor(rng() * cave.marbles.colors.length)]);
        this.marbleCaves.push(map.caves.indexOf(cave));
      }
    }
    // Doublers need marbles to hand out: one hidden spare per marble per doubler, parked off-screen.
    this.firstSpare = this.nextSpare = this.marbles.length;
    const spares = this.machines.filter((m) => m.kind === 'double').length * this.marbles.length;
    for (let k = 0; k < spares; k++) {
      this.addMarble(-500, -500, '#ffffff');
      this.marbles[this.marbles.length - 1].setEnabled(false);
      this.marbleCaves.push(-1);
    }
    this.cloneOf = new Int32Array(this.marbles.length).fill(-1);
    this.stuck = new Uint8Array(this.marbles.length);
    this.paintSteps = new Int32Array(this.marbles.length).fill(-1);
    this.machineSteps = this.machines.map(() => new Int32Array(this.marbles.length).fill(-1));
    this.prevX = new Float32Array(this.marbles.length);
    this.prevY = new Float32Array(this.marbles.length);
    this.marbles.forEach((b, i) => {
      this.prevX[i] = b.translation().x * PX_PER_METER;
      this.prevY[i] = -b.translation().y * PX_PER_METER;
    });
    this.anchors = new Float32Array(this.marbles.length * 2);
    this.anchorSteps = new Int32Array(this.marbles.length);
    this.marbles.forEach((b, i) => {
      const t = b.translation();
      this.anchors[i * 2] = t.x * PX_PER_METER;
      this.anchors[i * 2 + 1] = -t.y * PX_PER_METER;
    });
  }

  get time(): number {
    return this.stepIndex * STEP;
  }

  tick(): void {
    while (this.nextEvent < this.events.length && this.events[this.nextEvent].t <= this.time) {
      this.apply(this.events[this.nextEvent++]);
    }
    const next = (this.stepIndex + 1) * STEP;
    this.movers.forEach((m, i) => {
      const body = this.moverBodies[i];
      const p = moverPosition(m, next);
      const target = { x: p.x / PX_PER_METER, y: -p.y / PX_PER_METER };
      const now = body.translation();
      // The jump from the top of the belt back to its foot happens hidden in the ground; teleport rather than sweep.
      if (Math.hypot(target.x - now.x, target.y - now.y) * PX_PER_METER > TELEPORT_PX) body.setTranslation(target, false);
      else body.setNextKinematicTranslation(target);
    });
    // Wheel angles are screen angles (y down, clockwise positive); Rapier's y points up, so they flip sign.
    this.wheels.forEach((w, i) => this.wheelBodies[i].setNextKinematicRotation(-wheelAngle(w, next)));
    if (this.map.spin || this.map.rock) this.turnGravity();
    if (this.map.ending?.kind === 'break' && !this.broken && this.time >= this.map.ending.t) this.shatter();
    this.world.step();
    this.stepIndex++;
    if (this.portals.length) this.teleport();
    this.listen();
    if (this.machines.length && this.stepIndex % PAINT_CHECK_EVERY === 0) this.checkMachines();
    if (this.stepIndex % CHECK_EVERY === 0) this.checkMarbles();
  }

  isLost(i: number): boolean {
    return !this.marbles[i].isEnabled();
  }

  // x, y (frame pixels, y down) and angle for every marble.
  readMarbles(out: Float32Array): void {
    for (let i = 0; i < this.marbles.length; i++) {
      const b = this.marbles[i];
      const t = b.translation();
      out[i * 3] = t.x * PX_PER_METER;
      out[i * 3 + 1] = -t.y * PX_PER_METER;
      out[i * 3 + 2] = -b.rotation();
    }
  }

  report(): SimReport {
    const r: SimReport = {
      lost: this.lostCount, stuck: 0, outside: 0, unpainted: 0, stuckSpots: [],
      caves: Object.fromEntries(this.map.caves.map((c) => [c.id, 0])),
    };
    const spots = new Map<string, { x: number; y: number; count: number }>();
    this.marbles.forEach((b, i) => {
      if (!b.isEnabled()) return;
      const t = b.translation();
      const x = t.x * PX_PER_METER;
      const y = -t.y * PX_PER_METER;
      if (this.stuck[i]) {
        r.stuck++;
        const key = `${Math.floor(x / SPOT_SIZE)},${Math.floor(y / SPOT_SIZE)}`;
        const spot = spots.get(key) ?? { x: Math.round(x), y: Math.round(y), count: 0 };
        spot.count++;
        spots.set(key, spot);
      }
      const cave = this.caveAt(x, y);
      if (cave) r.caves[cave]++;
      else r.outside++;
      if (cave && this.paintedCaves.has(cave) && this.paintSteps[i] < 0) r.unpainted++;
    });
    r.stuckSpots = [...spots.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    return r;
  }

  hash(): number {
    const buf = new Float32Array(this.marbles.length * 3);
    this.readMarbles(buf);
    let h = 0x811c9dc5;
    for (const word of new Uint32Array(buf.buffer)) h = Math.imul(h ^ word, 0x01000193);
    return h >>> 0;
  }

  dispose(): void {
    this.world.free();
  }

  // A marble whose velocity changed sharply in one step has hit something. Keep the hardest hits only.
  private listen(): void {
    if (this.velX.length !== this.marbles.length) {
      this.velX = new Float32Array(this.marbles.length);
      this.velY = new Float32Array(this.marbles.length);
    }
    const hits: [number, number][] = [];
    this.marbles.forEach((b, i) => {
      if (!b.isEnabled() || b.isSleeping()) return;
      const v = b.linvel();
      const dv = Math.hypot(v.x - this.velX[i], v.y - this.velY[i]) * PX_PER_METER;
      this.velX[i] = v.x;
      this.velY[i] = v.y;
      if (dv > SOUND_THRESHOLD) hits.push([dv, i]);
    });
    hits.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
    for (const [dv, i] of hits.slice(0, MAX_SOUNDS_PER_STEP)) {
      this.sounds.push(this.stepIndex, i, Math.round(this.marbles[i].translation().x * PX_PER_METER), Math.round(dv));
    }
  }

  // Each portal sends up to one marble per exit slot per step, lowest in the entry first (so none waits forever
  // in a corner while newer ones drop past it). A slot waits until the
  // marble it sent last has moved clear, so marbles never appear on top of each other.
  private teleport(): void {
    const r = this.physics.marbleRadius;
    this.portals.forEach((p, k) => {
      const slots = this.lastThrough[k];
      const free = slots.map((last, s) => {
        if (last < 0) return true;
        const t = this.marbles[last].translation();
        return Math.hypot(t.x * PX_PER_METER - this.slotX(p, s, slots.length), -t.y * PX_PER_METER - p.exit.y) >= r * 2.2;
      });
      if (!free.some(Boolean)) return;
      const near: [number, number][] = [];
      this.marbles.forEach((b, i) => {
        if (!b.isEnabled()) return;
        const t = b.translation();
        const y = -t.y * PX_PER_METER;
        if (p.only.length && !p.only.includes(this.marbleColors[i].toLowerCase())) return;
        if (Math.hypot(t.x * PX_PER_METER - p.entry.x, y - p.entry.y) < p.r) near.push([y, i]);
      });
      near.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      let n = 0;
      free.forEach((ok, s) => {
        if (!ok || n >= near.length) return;
        const i = near[n++][1];
        const x = this.slotX(p, s, slots.length);
        this.marbles[i].setTranslation({ x: x / PX_PER_METER, y: -p.exit.y / PX_PER_METER }, true);
        this.marbles[i].setLinvel({ x: 0, y: -PORTAL_SPEED / PX_PER_METER }, true);
        this.prevX[i] = x;
        this.prevY[i] = p.exit.y;
        slots[s] = i;
      });
    });
  }

  private slotX(p: Portal, s: number, lanes: number): number {
    return p.exit.x + (s - (lanes - 1) / 2) * this.physics.marbleRadius * PORTAL_LANE;
  }

  // A turning map is the same as gravity turning the other way inside it.
  private turnGravity(): void {
    const { spin, rock } = this.map;
    // One step past the end of the rocking, so gravity lands back on level.
    const rocking = !!rock && this.time >= rock.t && this.time <= rockEnd(rock) + STEP;
    if (!rocking && !(spin && this.time >= spin.t)) return;
    const angle = (mapTurn(this.map, this.time) * Math.PI) / 180;
    const g = this.physics.gravity / PX_PER_METER;
    this.world.gravity = { x: Math.sin(angle) * g, y: -Math.cos(angle) * g };
    // Resting marbles sleep and would ignore the new pull.
    if (rocking && this.stepIndex % WAKE_EVERY === 0) for (const b of this.marbles) if (b.isEnabled()) b.wakeUp();
  }

  // The "break" ending: every wall and gate goes, and each marble is kicked away from the middle of the frame.
  private shatter(): void {
    this.broken = true;
    for (const c of this.terrain) this.world.removeCollider(c, false);
    for (const w of this.walls) if (w.collider) { this.world.removeCollider(w.collider, false); w.collider = null; }
    for (const b of [...this.moverBodies, ...this.wheelBodies]) b.setEnabled(false);
    this.wallsVersion++;
    const cx = this.map.frame.width / 2;
    const cy = this.map.frame.height / 2;
    this.marbles.forEach((b, i) => {
      if (!b.isEnabled()) return;
      const t = b.translation();
      const dx = t.x * PX_PER_METER - cx;
      const dy = -t.y * PX_PER_METER - cy;
      const d = Math.hypot(dx, dy) || 1;
      const kick = 250 + 450 * this.shake();
      b.setLinvel({ x: ((dx / d) * kick) / PX_PER_METER, y: (-(dy / d) * kick + 1500) / PX_PER_METER }, true);
      if (this.stuck[i]) this.stuck[i] = 0;
    });
    this.stuckVersion++;
  }

  // A twin appears where the marble was just before the bar, with the same speed and size, already marked as
  // having passed this doubler so it does not double again.
  private twin(i: number, machine: number, at: Pt): void {
    if (this.nextSpare >= this.marbles.length) return;
    const k = this.nextSpare++;
    const src = this.marbles[i];
    const body = this.marbles[k];
    body.setEnabled(true);
    body.setTranslation({ x: at.x / PX_PER_METER, y: -at.y / PX_PER_METER }, true);
    body.setLinvel(src.linvel(), true);
    body.collider(0).setRadius(src.collider(0).radius());
    this.marbleColors[k] = this.marbleColors[i];
    this.cloneOf[k] = i;
    this.machineSteps[machine][k] = this.stepIndex;
    this.paintSteps[k] = this.paintSteps[i];
    this.prevX[k] = at.x;
    this.prevY[k] = at.y;
    this.anchors[k * 2] = at.x;
    this.anchors[k * 2 + 1] = at.y;
    this.anchorSteps[k] = this.stepIndex;
  }

  // A marble passes a machine when the line from its last checked position to its current one crosses the bar.
  private checkMachines(): void {
    this.marbles.forEach((b, i) => {
      if (!b.isEnabled()) return;
      const t = b.translation();
      const x = t.x * PX_PER_METER;
      const y = -t.y * PX_PER_METER;
      const from = { x: this.prevX[i], y: this.prevY[i] };
      this.prevX[i] = x;
      this.prevY[i] = y;
      this.machines.forEach((m, k) => {
        if (this.machineSteps[k][i] >= 0 || !crosses(from, { x, y }, m.a, m.b)) return;
        this.machineSteps[k][i] = this.stepIndex;
        if (m.kind === 'paint' && this.paintSteps[i] < 0) this.paintSteps[i] = this.stepIndex;
        if (m.kind === 'size') b.collider(0).setRadius((this.physics.marbleRadius * m.scale!) / PX_PER_METER);
        if (m.kind === 'double') this.twin(i, k, from);
      });
    });
  }

  // Switches off marbles that left the frame (indices stay stable) and flags marbles stuck outside caves.
  private checkMarbles(): void {
    const { width, height } = this.map.frame;
    let changed = false;
    const flowing = new Set<string>();
    const waiting: (number | string)[] = [];
    this.marbles.forEach((b, i) => {
      if (!b.isEnabled()) return;
      const t = b.translation();
      const x = t.x * PX_PER_METER;
      const y = -t.y * PX_PER_METER;
      if (x < -LOST_MARGIN || x > width + LOST_MARGIN || y > height + LOST_MARGIN) {
        b.setEnabled(false);
        if (!this.broken) this.lostCount++;
        if (this.stuck[i]) { this.stuck[i] = 0; changed = true; }
        return;
      }
      if (Math.hypot(x - this.anchors[i * 2], y - this.anchors[i * 2 + 1]) > STUCK_MOVE_PX) {
        this.anchors[i * 2] = x;
        this.anchors[i * 2 + 1] = y;
        this.anchorSteps[i] = this.stepIndex;
      }
      const resting = this.stepIndex - this.anchorSteps[i];
      const cave = this.draining.size || resting >= STUCK_STEPS ? this.caveAt(x, y) : null;
      if (cave && this.draining.has(cave)) {
        if (resting < SHAKE_STEPS) flowing.add(cave);
        else waiting.push(i, cave);
        return;
      }
      const isStuck = resting >= STUCK_STEPS && !this.broken && !cave ? 1 : 0;
      if (isStuck !== this.stuck[i]) { this.stuck[i] = isStuck; changed = true; }
    });
    // A draining cave whose pile still moves just has marbles waiting their turn: they are neither stuck nor in need
    // of a shake. Only once the whole pile has stopped (a marble balanced on a ridge between two valves, say) do its
    // resting marbles get a shake, and those resting too long count as stuck.
    for (let k = 0; k < waiting.length; k += 2) {
      const i = waiting[k] as number;
      const stopped = !flowing.has(waiting[k + 1] as string);
      const resting = this.stepIndex - this.anchorSteps[i];
      if (stopped && resting < STUCK_STEPS) {
        const a = this.shake() * Math.PI;
        this.marbles[i].setLinvel({ x: (Math.cos(a) * SHAKE_SPEED) / PX_PER_METER, y: (Math.sin(a) * SHAKE_SPEED) / PX_PER_METER }, true);
      }
      const isStuck = stopped && resting >= STUCK_STEPS && !this.broken ? 1 : 0;
      if (isStuck !== this.stuck[i]) { this.stuck[i] = isStuck; changed = true; }
    }
    if (changed) this.stuckVersion++;
  }

  private caveAt(x: number, y: number): string | null {
    for (const a of this.areas) {
      if (x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY && insidePolygon({ x, y }, a.poly)) return a.id;
    }
    return null;
  }

  private addMarble(x: number, y: number, color: string): void {
    const { marbleRadius, friction, restitution, drag } = this.physics;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x / PX_PER_METER, -y / PX_PER_METER).setLinearDamping(drag));
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(marbleRadius / PX_PER_METER).setFriction(friction).setRestitution(restitution),
      body,
    );
    this.marbles.push(body);
    this.marbleColors.push(color);
  }

  private createWallCollider(w: WallPiece): Collider {
    const desc = RAPIER.ColliderDesc.cuboid(w.length / 2 / PX_PER_METER, w.thickness / 2 / PX_PER_METER)
      .setTranslation(w.cx / PX_PER_METER, -w.cy / PX_PER_METER)
      .setRotation(-w.angle)
      .setFriction(this.physics.friction);
    return this.world.createCollider(desc);
  }

  // A hub with straight arms reaching almost to the chamber wall.
  private createWheel(w: Wheel): RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(w.x / PX_PER_METER, -w.y / PX_PER_METER));
    const hub = w.hub;
    this.world.createCollider(RAPIER.ColliderDesc.ball(hub / PX_PER_METER).setFriction(this.physics.friction), body);
    for (let k = 0; k < w.arms; k++) {
      const a = (2 * Math.PI * k) / w.arms;
      const mid = (w.r + hub) / 2;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((w.r - hub) / 2 / PX_PER_METER, 3 / PX_PER_METER)
          .setTranslation((Math.cos(a) * mid) / PX_PER_METER, (Math.sin(a) * mid) / PX_PER_METER)
          .setRotation(a)
          .setFriction(this.physics.friction),
        body,
      );
    }
    return body;
  }

  private createMover(m: Mover): RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(moverPosition(m, 0).x / PX_PER_METER, -moverPosition(m, 0).y / PX_PER_METER),
    );
    const hull = new Float32Array(m.points.flatMap((p) => [p.x / PX_PER_METER, -p.y / PX_PER_METER]));
    this.world.createCollider(RAPIER.ColliderDesc.convexHull(hull)!.setFriction(this.physics.friction), body);
    return body;
  }

  private apply(e: MapEvent): void {
    if (e.do === 'gravity') {
      const a = ((e.angle ?? 0) * Math.PI) / 180;
      const g = (this.physics.gravity * (e.strength ?? 1)) / PX_PER_METER;
      this.world.gravity = { x: Math.sin(a) * g, y: -Math.cos(a) * g };
      // Resting marbles sleep; wake them so the new pull moves them.
      for (const b of this.marbles) if (b.isEnabled()) b.wakeUp();
      return;
    }
    for (const w of this.walls) {
      if (w.owner !== e.cave || !w.valve || (e.valve && w.valve !== e.valve)) continue;
      if (e.do === 'valve.open' && w.collider) {
        this.world.removeCollider(w.collider, true);
        w.collider = null;
      } else if (e.do === 'valve.close' && !w.collider) {
        w.collider = this.createWallCollider(w);
      }
    }
    this.draining.clear();
    for (const w of this.walls) if (!w.collider) this.draining.add(w.owner);
    this.wallsVersion++;
  }
}

function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const side = (o: Pt, u: Pt, v: Pt) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);
  return side(a, b, p) * side(a, b, q) <= 0 && side(p, q, a) * side(p, q, b) <= 0 && (p.x !== q.x || p.y !== q.y);
}
