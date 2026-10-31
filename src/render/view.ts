import * as THREE from 'three';
import { STEP } from '../core/time.ts';
import { MACHINES, moverPosition, wheelAngle, type Wheel, type Machine, type Portal } from '../map/layout.ts';
import type { Decoded, Recording, SceneInfo } from '../physics/recording.ts';
import type { Cast, Pose } from '../actors/cast.ts';
import { cropAt } from './camera.ts';
import { Effects } from './effects.ts';
import { Captions } from './captions.ts';
import { MARBLE_SKINS, GROUND_PATTERNS, mapTurn, type Effects as EffectsConfig, type Look, type MapDoc, type MarbleSkin } from '../map/types.ts';

/** Frames the frozen block holds still before it tips and falls; frames the ground takes to fade out. */
const FREEZE_HOLD = 90;
const FADE_FRAMES = 30;
const ICE = 0xd8f3ff;

const STUCK_COLOR = 0xff2a2a;

export interface Crop { x: number; y: number; w: number; h: number }

export class View {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly marbles: THREE.InstancedMesh;
  private readonly walls: THREE.InstancedMesh;
  private readonly info: SceneInfo;
  private readonly m: Decoded = { x: 0, y: 0, angle: 0 };
  private readonly movers: THREE.Mesh[];
  private shownWalls: Uint8Array | null = null;
  private readonly cast: Cast;
  private readonly pose: Pose = { cell: 0, size: 1, sx: 1, sy: 1, angle: null, dim: 1 };
  private readonly cells: THREE.InstancedBufferAttribute;
  /** 1 for plain marbles (shaded by the skin), 0 for characters (their picture is drawn as is). */
  private readonly plain: THREE.InstancedBufferAttribute;
  private readonly captions: Captions | null;
  /** Tint each marble currently shows (0xRRGGBB), so colours are only re-uploaded when they change. */
  private readonly shownTint: Int32Array;
  private readonly baseTint: Int32Array;
  private paint: { colors: Int32Array; frames: Int32Array } | null = null;
  private flip: { colors: Int32Array; frames: Int32Array } | null = null;
  /** Size machines and the step each marble crossed them, once the bake is done. */
  private sizes: { scale: number; steps: Int32Array }[] = [];
  private shapes: { cell: number; steps: Int32Array }[] = [];
  private mixes: { color: number; steps: Int32Array }[] = [];

  private readonly crop: Crop;
  /** Per-frame camera from cameraTrack, or null for a still camera on `crop`. */
  private track: Float32Array | null = null;
  private readonly shot: Crop = { x: 0, y: 0, w: 0, h: 0 };
  readonly effects: Effects | null;
  private readonly ending: MapDoc['ending'];
  private readonly turn: Pick<MapDoc, 'spin' | 'rock'>;
  private ground!: THREE.Mesh;
  /** Things that vanish with the ground when the map breaks or the block falls. */
  private fixtures: THREE.Object3D[] = [];
  private wheels: THREE.Group[] = [];
  private frozen: { frame: number; x: Float32Array; y: Float32Array; a: Float32Array; ok: Uint8Array; cx: number; cy: number } | null = null;

  private readonly exportScale: number;

  /**
   * `crop` zooms the camera onto part of the frame (debugging, editor).
   * `exportScale` renders at a fixed size (frame size × scale) and keeps each frame readable for video export.
   */
  constructor(
    container: HTMLElement, scene: SceneInfo, cast: Cast,
    opts: { crop?: Crop; exportScale?: number; effects?: EffectsConfig; ending?: MapDoc['ending']; spin?: MapDoc['spin']; rock?: MapDoc['rock']; look?: Look; captions?: MapDoc } = {},
  ) {
    this.ending = opts.ending;
    this.turn = { spin: opts.spin, rock: opts.rock };
    this.cast = cast;
    this.crop = opts.crop ?? { x: 0, y: 0, w: scene.frame.width, h: scene.frame.height };
    this.exportScale = opts.exportScale ?? 0;
    this.info = scene;
    const { background } = scene.frame;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: this.exportScale > 0 });
    this.renderer.setPixelRatio(this.exportScale ? 1 : Math.min(window.devicePixelRatio, 2));
    container.replaceChildren(this.renderer.domElement);
    this.scene.background = new THREE.Color(background);
    const c = this.crop;
    this.camera = new THREE.OrthographicCamera(c.x, c.x + c.w, -c.y, -(c.y + c.h), -10, 10);

    const n = scene.marbleColors.length;
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.cells = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.cells.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCell', this.cells);
    this.plain = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.plain.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPlain', this.plain);
    const look = opts.look ?? {};
    this.marbles = new THREE.InstancedMesh(geometry, atlasMaterial(cast, look.marble ?? 'flat'), n);
    const color = new THREE.Color();
    this.baseTint = Int32Array.from(scene.marbleColors, (c) => parseInt(c.slice(1), 16));
    this.shownTint = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) this.marbles.setColorAt(i, color.setHex(0xffffff));
    this.marbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marbles.frustumCulled = false;

    this.walls = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), scene.walls.length);
    scene.walls.forEach((w, i) => this.walls.setColorAt(i, color.set(w.color)));
    this.walls.frustumCulled = false;

    this.movers = scene.movers.map((m) => {
      const shape = new THREE.Shape(m.points.map((p) => new THREE.Vector2(p.x, -p.y)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: m.color }));
      return mesh;
    });

    // Plates reach down into the ground, so the ground is drawn over them.
    this.effects = opts.effects && Object.values(opts.effects).some(Boolean) ? new Effects(opts.effects, scene, this.renderer) : null;
    this.ground = groundMesh(scene, look);
    // Shadows and glow halos are more copies of the marbles, sharing their positions and colours.
    const twin = (material: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, n);
      mesh.instanceMatrix = this.marbles.instanceMatrix;
      mesh.instanceColor = this.marbles.instanceColor;
      mesh.frustumCulled = false;
      return mesh;
    };
    const shadow = look.shadow ? [twin(shadowMaterial(cast, scene.marbleRadius))] : [];
    const halo = look.marble === 'glow' ? [twin(haloMaterial())] : [];
    const backdrop = look.backdrop ? [backdropMesh(scene, look.backdrop)] : [];
    const extras = [...scene.machines.map(machineMesh), ...scene.portals.flatMap(portalMeshes), ...pegMeshes(scene)];
    this.wheels = scene.wheels.map(wheelMesh);
    this.fixtures = [...this.movers, ...this.wheels, ...extras, this.walls];
    const layers = [...backdrop, ...(this.effects?.under ?? []), ...this.movers, this.ground, ...this.wheels, ...extras, this.walls, ...shadow, ...halo, this.marbles, ...(this.effects?.over ?? [])];
    layers.forEach((o, i) => (o.renderOrder = i));
    this.scene.add(...layers);
    const { w, h } = this.crop;
    this.captions = opts.captions?.captions?.length ? new Captions(opts.captions, w, h, this.exportScale || 1) : null;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  // Returns how many marbles are still on screen in this frame.
  render(rec: Recording, frame: number): number {
    this.aimCamera(frame);
    this.fadeGround(frame);
    const endFrame = this.ending ? Math.round(this.ending.t / STEP) : Infinity;
    if (this.ending?.kind === 'freeze' && frame >= endFrame && (!this.frozen || this.frozen.frame !== endFrame)) this.freeze(rec, endFrame);
    const ice = this.ending?.kind === 'freeze' && frame >= endFrame ? this.frozen : null;
    const walls = rec.wallsAt(frame);
    if (walls !== this.shownWalls) this.updateWalls(walls);
    this.info.wheels.forEach((w, i) => (this.wheels[i].rotation.z = -wheelAngle(w, frame * STEP)));
    this.info.movers.forEach((m, i) => {
      const p = moverPosition(m, frame * STEP);
      this.movers[i].position.set(p.x, -p.y, 0);
    });
    const m = this.marbles.instanceMatrix.array as Float32Array;
    const cells = this.cells.array as Float32Array;
    const plain = this.plain.array as Float32Array;
    // Red stuck marbles help while editing; a video never shows them.
    const stuck = this.exportScale ? null : rec.stuckAt(frame);
    const color = new THREE.Color();
    const d = this.info.marbleRadius * 2;
    const p = this.pose;
    let visible = 0;
    let recolored = false;
    for (let i = 0; i < rec.marbleCount; i++) {
      if (ice) {
        if (!ice.ok[i]) { writeMatrix(m, i, 0, 0, 0, 0, 0); continue; }
        this.iceAt(ice, i, frame, this.m);
      } else if (!rec.marble(frame, i, this.m)) {
        writeMatrix(m, i, 0, 0, 0, 0, 0);
        continue;
      }
      if (i < this.info.firstSpare) visible++;
      this.cast.pose(rec, i, frame, p);
      if (p.cell === 0 && this.shapes.length) p.cell = this.shapeAt(i, frame);
      cells[i] = p.cell;
      plain[i] = this.cast.isPlain(p.cell) ? 1 : 0;
      const k = this.sizes.length ? this.sizeAt(i, frame) : 1;
      writeMatrix(m, i, this.m.x, -this.m.y, -(p.angle ?? this.m.angle), d * k * p.size * p.sx, d * k * p.size * p.sy);
      let tint = this.tintOf(i, frame, stuck, p);
      if (ice) tint = blendHex(tint, ICE, Math.min(0.55, (frame - ice.frame) / 40));
      if (tint !== this.shownTint[i]) {
        this.shownTint[i] = tint;
        this.marbles.setColorAt(i, color.setHex(tint));
        recolored = true;
      }
    }
    this.marbles.instanceMatrix.needsUpdate = true;
    this.cells.needsUpdate = true;
    this.plain.needsUpdate = true;
    if (recolored) this.marbles.instanceColor!.needsUpdate = true;
    this.effects?.update(rec, frame, (i) => (this.shownTint[i] < 0 ? 0xffffff : this.shownTint[i]), this.renderer);
    this.renderer.render(this.scene, this.camera);
    if (this.captions) {
      this.camera.updateMatrixWorld();
      this.captions.update(rec, frame, (x, y) => this.toScreen(x, y));
      this.renderer.autoClear = false;
      this.renderer.render(this.captions.scene, this.captions.camera);
      this.renderer.autoClear = true;
    }
    return visible;
  }

  private readonly projected = new THREE.Vector3();

  // A frame point → video px, following the moving, spinning, shaking camera.
  private toScreen(x: number, y: number): { x: number; y: number } {
    const v = this.projected.set(x, -y, 0).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.crop.w, y: ((1 - v.y) / 2) * this.crop.h };
  }

  // The camera sits on the middle of the shot so it can turn with a spinning map; shake nudges it.
  private aimCamera(frame: number): void {
    const c = this.track ? cropAt(this.track, frame, this.shot) : this.crop;
    const s = this.effects?.shake(frame) ?? { x: 0, y: 0 };
    this.camera.left = -c.w / 2;
    this.camera.right = c.w / 2;
    this.camera.top = c.h / 2;
    this.camera.bottom = -c.h / 2;
    this.camera.position.set(c.x + c.w / 2 + s.x, -(c.y + c.h / 2 + s.y), 0);
    this.camera.rotation.z = (mapTurn(this.turn, frame * STEP) * Math.PI) / 180;
    this.camera.updateProjectionMatrix();
  }

  // Both endings take the ground away: "break" right at its time, "freeze" once the block starts to fall.
  private fadeGround(frame: number): void {
    if (!this.ending) return;
    const start = Math.round(this.ending.t / STEP) + (this.ending.kind === 'freeze' ? FREEZE_HOLD : 0);
    const k = Math.max(0, Math.min(1, (frame - start) / FADE_FRAMES));
    (this.ground.material as THREE.ShaderMaterial).uniforms.opacity.value = 1 - k;
    for (const o of this.fixtures) o.visible = k < 1;
  }

  private freeze(rec: Recording, frame: number): void {
    const n = rec.marbleCount;
    const f = { frame, x: new Float32Array(n), y: new Float32Array(n), a: new Float32Array(n), ok: new Uint8Array(n), cx: 0, cy: 0 };
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (!rec.marble(Math.min(frame, rec.frames - 1), i, this.m)) continue;
      f.x[i] = this.m.x; f.y[i] = this.m.y; f.a[i] = this.m.angle; f.ok[i] = 1;
      f.cx += this.m.x; f.cy += this.m.y; count++;
    }
    f.cx /= count || 1;
    f.cy /= count || 1;
    this.frozen = f;
  }

  // A frozen marble: its spot when the ice set, turned with the block and dropped with it.
  private iceAt(f: NonNullable<View['frozen']>, i: number, frame: number, out: Decoded): void {
    const t = Math.max(0, (frame - f.frame - FREEZE_HOLD) * STEP);
    const a = 0.25 * t * t;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = f.x[i] - f.cx;
    const dy = f.y[i] - f.cy;
    out.x = f.cx + dx * c - dy * s;
    out.y = f.cy + dx * s + dy * c + 0.5 * 900 * t * t;
    out.angle = f.a[i] + a;
  }

  /** The current frame as a base64 JPEG (export mode only). */
  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/jpeg', 0.92).slice('data:image/jpeg;base64,'.length);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private updateWalls(open: Uint8Array): void {
    const m = this.walls.instanceMatrix.array as Float32Array;
    this.info.walls.forEach((w, i) => {
      const s = open[i] ? 0 : 1;
      writeMatrix(m, i, w.cx, -w.cy, -w.angle, w.length * s, w.thickness * s);
    });
    this.walls.instanceMatrix.needsUpdate = true;
    this.shownWalls = open;
  }

  /** The colour-flip ending (see flipColors). */
  setFlip(flip: { colors: Int32Array; frames: Int32Array } | null): void {
    this.flip = flip;
  }

  /** Machines and the step each marble crossed them, known once the bake is done; `cloneOf` gives twins their parent's look. */
  setMachines(machines: Machine[], machineSteps: Int32Array[], cloneOf: Int32Array): void {
    for (let k = 0; k < cloneOf.length; k++) if (cloneOf[k] >= 0) this.baseTint[k] = this.baseTint[cloneOf[k]];
    this.shownTint.fill(-1);
    this.sizes = machines.flatMap((m, k) => (m.kind === 'size' ? [{ scale: m.scale!, steps: machineSteps[k] }] : []));
    this.shapes = machines.flatMap((m, k) => (m.kind === 'shape' ? [{ cell: this.cast.shapeCell(m.shape!), steps: machineSteps[k] }] : []));
    this.mixes = machines.flatMap((m, k) => (m.kind === 'mix' ? [{ color: m.color ? parseInt(m.color.slice(1), 16) : this.average(machineSteps[k]), steps: machineSteps[k] }] : []));
  }

  // The blend of every marble that crossed a mixer.
  private average(steps: Int32Array): number {
    let r = 0, g = 0, b = 0, n = 0;
    steps.forEach((s, i) => {
      if (s < 0) return;
      const c = this.baseTint[i];
      r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++;
    });
    return n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n) : 0xffffff;
  }

  private shapeAt(i: number, frame: number): number {
    let best = -1;
    let cell = 0;
    for (const s of this.shapes) {
      const at = s.steps[i];
      if (at >= 0 && at <= frame && at > best) { best = at; cell = s.cell; }
    }
    return cell;
  }

  // The size machine a marble crossed last decides its size.
  private sizeAt(i: number, frame: number): number {
    let best = -1;
    let scale = 1;
    for (const s of this.sizes) {
      const at = s.steps[i];
      if (at >= 0 && at <= frame && at > best) { best = at; scale = s.scale; }
    }
    return scale;
  }

  /** A moving camera (see cameraTrack). The output keeps the size given as `crop`. */
  setCamera(track: Float32Array): void {
    this.track = track;
  }

  /** Marbles that start as a picture: their own colour from the first frame (-1 keeps the colour they have). */
  setStart(colors: Int32Array): void {
    colors.forEach((c, i) => { if (c >= 0) this.baseTint[i] = c; });
  }

  /** Final colours and the frame each marble gets painted (from the bake). */
  setPaint(colors: Int32Array, frames: Int32Array): void {
    this.paint = { colors, frames };
  }

  // Stuck beats painted beats the marble's own look. Characters keep their picture (white tint) unless painted.
  private tintOf(i: number, frame: number, stuck: Uint8Array | null, p: Pose): number {
    if (stuck?.[i]) return STUCK_COLOR;
    const flip = this.flip;
    if (flip && flip.colors[i] >= 0 && frame >= flip.frames[i]) return flip.colors[i];
    const paint = this.paint;
    if (paint && paint.colors[i] >= 0 && paint.frames[i] >= 0 && frame >= paint.frames[i]) return paint.colors[i];
    let mixed = -1;
    for (const m of this.mixes) if (m.steps[i] >= 0 && frame >= m.steps[i]) mixed = m.color;
    const plain = this.cast.isPlain(p.cell);
    const base = mixed >= 0 && plain ? mixed : plain ? this.baseTint[i] : 0xffffff;
    if (p.dim === 1) return base;
    const k = p.dim;
    return (Math.round(((base >> 16) & 255) * k) << 16) | (Math.round(((base >> 8) & 255) * k) << 8) | Math.round((base & 255) * k);
  }

  private readonly onResize = () => this.resize();

  private resize(): void {
    const { w: width, h: height } = this.crop;
    if (this.exportScale) {
      this.renderer.setSize(Math.round(width * this.exportScale), Math.round(height * this.exportScale));
      return;
    }
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    this.renderer.setSize(Math.floor(width * scale), Math.floor(height * scale));
  }
}

// A paint machine is drawn as a rainbow bar across the passage.
function machineMesh(m: Machine): THREE.Mesh {
  if (m.kind !== 'paint') return barMesh(m, m.kind === 'size' ? (m.scale! >= 1 ? '#4dd98b' : '#ff9f43') : MACHINES[m.kind].color);
  const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
  const geometry = new THREE.PlaneGeometry(len, 4, 24, 1);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setHSL((pos.getX(i) / len + 0.5) * 0.85, 0.9, 0.6, THREE.SRGBColorSpace);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
  mesh.position.set((m.a.x + m.b.x) / 2, -(m.a.y + m.b.y) / 2, 0);
  mesh.rotation.z = -Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x);
  return mesh;
}

// A wheel: hub and arms in the belt colour, turned each frame to the angle the physics used.
function wheelMesh(w: Wheel): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: w.color });
  const hub = new THREE.Mesh(new THREE.CircleGeometry(w.hub, 32), mat);
  g.add(hub);
  for (let k = 0; k < w.arms; k++) {
    const a = (2 * Math.PI * k) / w.arms;
    const arm = new THREE.Mesh(new THREE.PlaneGeometry(w.r - w.hub, 6), mat);
    const mid = (w.r + w.hub) / 2;
    arm.position.set(Math.cos(a) * mid, -Math.sin(a) * mid, 0);
    arm.rotation.z = -a;
    g.add(arm);
  }
  g.position.set(w.x, -w.y, 0);
  return g;
}

// Pins are drawn like little islands of ground: the ground colour with its rim.
function pegMeshes({ pegs, ground }: SceneInfo): THREE.Mesh[] {
  const rim = new THREE.MeshBasicMaterial({ color: ground.rim });
  const fill = new THREE.MeshBasicMaterial({ color: ground.color });
  return pegs.flatMap((g) => {
    const outer = new THREE.Mesh(new THREE.CircleGeometry(g.r, 20), rim);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(Math.max(1, g.r - 1.5), 20), fill);
    outer.position.set(g.x, -g.y, 0);
    inner.position.set(g.x, -g.y, 0);
    return [outer, inner];
  });
}

// A portal is a glowing ring at each end.
function portalMeshes(p: Portal): THREE.Mesh[] {
  return [p.entry, p.exit].map((c) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(p.r + 2, p.r + 8, 40), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.9 }));
    mesh.position.set(c.x, -c.y, 0);
    return mesh;
  });
}

// Every other machine is a plain bar in its own colour (size: green grows, orange shrinks).
function barMesh(m: Machine, color: string): THREE.Mesh {
  const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  mesh.position.set((m.a.x + m.b.x) / 2, -(m.a.y + m.b.y) / 2, 0);
  mesh.rotation.z = -Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x);
  return mesh;
}

function blendHex(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s;
  return ch(16) | ch(8) | ch(0);
}

function writeMatrix(m: Float32Array, i: number, x: number, y: number, angle: number, sx: number, sy: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m.set([c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, 1, 0, x, y, 0, 1], i * 16);
}

// The carved ground: the distance field goes into a texture (±16 px packed into a byte) and a shader fills
// the solid side and draws a rim along the outline. Linear filtering of distances keeps edges smooth.
// `look.pattern` draws a texture (graph paper, wood grain, chalk dust...) over the fill.
function groundMesh({ field, ground }: SceneInfo, look: Look): THREE.Mesh {
  const { cols, rows, cell, d } = field;
  const data = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = Math.max(-16, Math.min(16, d[j * cols + i]));
      data[(rows - 1 - j) * cols + i] = Math.round(((v + 16) / 32) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  // Texel centres sit on the field nodes (i * cell, j * cell).
  const w = cols * cell;
  const h = rows * cell;
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines: { PATTERN: Math.max(0, GROUND_PATTERNS.indexOf(look.pattern ?? 'plain')) },
    uniforms: {
      field: { value: tex },
      fill: { value: new THREE.Color(ground.color) },
      rim: { value: new THREE.Color(ground.rim) },
      rimWidth: { value: ground.rimWidth },
      opacity: { value: 1 },
      size: { value: new THREE.Vector2(w, h) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D field;
      uniform vec3 fill;
      uniform vec3 rim;
      uniform float rimWidth;
      uniform float opacity;
      uniform vec2 size;
      varying vec2 vUv;
      ${NOISE}
      vec3 surface(vec2 w) {
        #if PATTERN == 1
          vec2 g = abs(fract(w / 24.0 - 0.5) - 0.5) * 24.0;
          vec2 big = abs(fract(w / 120.0 - 0.5) - 0.5) * 120.0;
          float line = 1.0 - smoothstep(0.3, 1.1, min(g.x, g.y));
          float major = 1.0 - smoothstep(0.5, 1.5, min(big.x, big.y));
          return mix(fill, vec3(0.42, 0.58, 0.86), max(line * 0.28, major * 0.5));
        #elif PATTERN == 2
          float bend = noise(w * vec2(0.003, 0.02)) * 5.0 + noise(w * vec2(0.02, 0.15)) * 0.4;
          float ring = fract(w.y * 0.03 + bend);
          float grain = smoothstep(0.0, 0.45, ring) * smoothstep(1.0, 0.55, ring);
          float plank = 1.0 - smoothstep(0.0, 1.5, abs(fract(w.y / 140.0) - 0.5) * 140.0 - 68.0);
          return fill * (0.74 + 0.32 * grain) * (0.94 + 0.12 * noise(w * 0.04)) * (1.0 - plank * 0.35);
        #elif PATTERN == 3
          float dust = noise(w * 0.012) * 0.55 + noise(w * 0.07) * 0.3 + hash(floor(w * 0.5)) * 0.15;
          float smear = smoothstep(0.62, 0.9, noise(w * vec2(0.004, 0.012)));
          return mix(fill * (0.88 + 0.24 * dust), vec3(0.85), smear * 0.035);
        #elif PATTERN == 4
          vec2 c = w / 30.0;
          c.x += 0.5 * mod(floor(c.y), 2.0);
          float dotMask = 1.0 - smoothstep(3.0, 4.2, length((fract(c) - 0.5) * 30.0));
          return mix(fill, rim, dotMask * 0.22);
        #elif PATTERN == 5
          vec2 plate = vec2(160.0, 100.0);
          vec2 f = fract(w / plate);
          vec2 e = min(f, 1.0 - f) * plate;
          float seam = 1.0 - smoothstep(0.8, 2.2, min(e.x, e.y));
          float rivet = 1.0 - smoothstep(2.4, 3.4, length(e - 9.0));
          float brushed = noise(vec2(w.x * 0.6, w.y * 0.008)) * 0.1;
          return fill * (0.9 + brushed) * (1.0 - seam * 0.5) + rivet * 0.2;
        #else
          return fill;
        #endif
      }
      void main() {
        float d = texture2D(field, vUv).r * 32.0 - 16.0;
        float aa = max(fwidth(d), 0.001);
        float solid = smoothstep(-aa, aa, d);
        float edge = 1.0 - smoothstep(rimWidth - aa, rimWidth + aa, d);
        gl_FragColor = vec4(mix(surface(vec2(vUv.x, 1.0 - vUv.y) * size), rim, edge), solid * opacity);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(w / 2 - cell / 2, -(h / 2 - cell / 2), 0);
  return mesh;
}

const NOISE = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

// The background behind the caves, top colour to bottom colour. It reaches well past the frame so a spinning
// map never shows its edge.
function backdropMesh({ frame }: SceneInfo, colors: string[]): THREE.Mesh {
  const size = Math.max(frame.width, frame.height) * 3;
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(colors[0]) },
      bottom: { value: new THREE.Color(colors[1] ?? colors[0]) },
      height: { value: frame.height },
    },
    vertexShader: `
      varying float vY;
      void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // The plane is centred on the frame, so its own y runs from +height/2 (top) to -height/2 (bottom).
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 bottom;
      uniform float height;
      varying float vY;
      void main() {
        gl_FragColor = vec4(mix(top, bottom, clamp(0.5 - vY / height, 0.0, 1.0)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.position.set(frame.width / 2, -frame.height / 2, 0);
  return mesh;
}

// Every marble is a quad that samples one cell of the cast atlas, tinted by its instance colour.
// `vDir` is the spot on the marble in screen directions (-1..1), so the light stays put while the marble rolls.
const MARBLE_VERTEX = `
  attribute float aCell;
  attribute float aPlain;
  uniform float cols;
  uniform float rows;
  varying vec2 vUv;
  varying vec2 vDir;
  varying vec3 vTint;
  varying float vPlain;
  void main() {
    float col = mod(aCell, cols);
    float row = floor(aCell / cols);
    vUv = vec2((col + uv.x) / cols, 1.0 - (row + 1.0 - uv.y) / rows);
    vec2 axis = instanceMatrix[0].xy / max(length(instanceMatrix[0].xy), 1e-6);
    vec2 q = position.xy * 2.0;
    vDir = vec2(axis.x * q.x - axis.y * q.y, axis.y * q.x + axis.x * q.y);
    vTint = instanceColor;
    vPlain = aPlain;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

function atlasTexture(cast: Cast): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cast.atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Skins shade plain marbles as lit balls: glass (dark core, bright rim, light focused on the far side), metal
// (reflects a bright sky over a dark floor), gem (cut facets), glow (white-hot centre; a halo is drawn separately).
// Characters keep their picture.
function atlasMaterial(cast: Cast, skin: MarbleSkin): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines: { SKIN: Math.max(0, MARBLE_SKINS.indexOf(skin)) },
    uniforms: { atlas: { value: atlasTexture(cast) }, cols: { value: cast.cols }, rows: { value: cast.rows } },
    vertexShader: MARBLE_VERTEX,
    fragmentShader: `
      uniform sampler2D atlas;
      varying vec2 vUv;
      varying vec2 vDir;
      varying vec3 vTint;
      varying float vPlain;
      void main() {
        vec4 t = texture2D(atlas, vUv);
        if (t.a < 0.03) discard;
        vec3 col = t.rgb * vTint;
        float alpha = t.a;
        #if SKIN > 0
        if (vPlain > 0.5) {
          vec2 p = vDir;
          float r2 = min(dot(p, p), 1.0);
          vec3 n = normalize(vec3(p, sqrt(1.0 - r2) + 0.05));
          vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
          vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
          vec3 base = vTint;
          float diff = max(dot(n, L), 0.0);
          #if SKIN == 1
            float rimLight = pow(1.0 - n.z, 2.0);
            float caustic = smoothstep(0.6, 0.0, length(p - vec2(0.3, -0.4)));
            col = base * (0.28 + 0.42 * diff) + base * caustic * 0.6 + mix(base, vec3(1.0), 0.5) * rimLight * 0.5;
            col += pow(max(dot(n, H), 0.0), 70.0) * 1.2;
            alpha *= 0.93;
          #elif SKIN == 2
            vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
            float sky = smoothstep(-0.2, 0.3, R.y);
            float horizon = 1.0 - smoothstep(0.0, 0.1, abs(R.y + 0.02));
            col = base * (mix(vec3(0.1), vec3(1.05), sky) + horizon * 0.5) + pow(max(dot(n, H), 0.0), 90.0);
          #elif SKIN == 3
            float seg = 6.2831853 / 8.0;
            float a = atan(p.y, p.x);
            float aq = (floor(a / seg) + 0.5) * seg;
            float r = length(p);
            vec3 f = r < 0.42 ? vec3(0.0, 0.0, 1.0) : normalize(vec3(cos(aq) * 0.7, sin(aq) * 0.7, 0.72));
            col = base * (0.3 + 0.9 * max(dot(f, L), 0.0)) + pow(max(dot(f, H), 0.0), 30.0) * 0.8;
            float ringEdge = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.42));
            float spoke = smoothstep(0.42, 0.48, abs(fract(a / seg) - 0.5)) * step(0.42, r);
            col += (ringEdge + spoke) * 0.22;
          #elif SKIN == 4
            float core = smoothstep(0.8, 0.0, length(p));
            col = mix(base * 1.15, vec3(1.0), core * 0.7);
          #endif
        }
        #endif
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

// A soft dark copy of each marble, nudged down and to the right (away from the light).
function shadowMaterial(cast: Cast, radius: number): THREE.ShaderMaterial {
  const vertex = MARBLE_VERTEX
    .replace('uniform float rows;', 'uniform float rows;\n  uniform vec2 offset;')
    .replace(
      'gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
      'vec4 w = instanceMatrix * vec4(position * 1.08, 1.0);\n    w.xy += offset;\n    gl_Position = projectionMatrix * modelViewMatrix * w;',
    );
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      atlas: { value: atlasTexture(cast) }, cols: { value: cast.cols }, rows: { value: cast.rows },
      offset: { value: new THREE.Vector2(radius * 0.45, -radius * 0.6) },
    },
    vertexShader: vertex,
    fragmentShader: `
      uniform sampler2D atlas;
      varying vec2 vUv;
      void main() {
        float a = texture2D(atlas, vUv).a;
        if (a < 0.03) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.38);
      }`,
  });
}

// The glow skin's halo: a larger soft disc in the marble's colour, added on top of what is behind.
function haloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying float vR;
      varying vec3 vTint;
      void main() {
        vR = length(position.xy * 2.0) * 2.6;
        vTint = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position.xy * 2.6, 0.0, 1.0);
      }`,
    fragmentShader: `
      varying float vR;
      varying vec3 vTint;
      void main() {
        float a = 0.32 * exp(-1.8 * max(vR - 0.9, 0.0)) * (1.0 - smoothstep(1.9, 2.6, vR));
        gl_FragColor = vec4(vTint * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
