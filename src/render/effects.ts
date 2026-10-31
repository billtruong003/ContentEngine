// Picture-only extras: glowing tails behind fast marbles, colour stains left on the background, sparks where
// marbles cross a paint machine, and a screen shake when a big wave of marbles lands. Nothing here touches
// the physics. Tails, sparks and shake are worked out from the recording for each frame on its own, so
// seeking shows the same picture as playing; stains build up frame by frame and are rebuilt after a seek back.
import * as THREE from 'three';
import type { Effects as EffectsConfig } from '../map/types.ts';
import type { Decoded, Recording, SceneInfo } from '../physics/recording.ts';

const TAIL_FRAMES = 6;
/** px per frame a marble must move before it shows a tail. */
const TAIL_SPEED = 4;
const SPARKS_PER_MARBLE = 3;
const SPARK_FRAMES = 22;
const MAX_SPARKS = 6000;
/** Stains are drawn at this fraction of the frame size, then stretched; they are meant to look soft. */
const STAIN_SCALE = 0.5;
const STAIN_ALPHA = 0.05;
const SHAKE_WINDOW = 8;

export class Effects {
  /** Meshes for the main scene, in draw order: stains go under the ground, the rest over the marbles. */
  readonly under: THREE.Object3D[] = [];
  readonly over: THREE.Object3D[] = [];
  private readonly cfg: EffectsConfig;
  private readonly radius: number;
  private readonly m: Decoded = { x: 0, y: 0, angle: 0 };
  private readonly p: Decoded = { x: 0, y: 0, angle: 0 };
  private tails: THREE.InstancedMesh | null = null;
  private sparks: THREE.InstancedMesh | null = null;
  private paintFrames: Int32Array | null = null;
  private shakeEnergy: Float32Array | null = null;
  private stain: { target: THREE.WebGLRenderTarget; scene: THREE.Scene; camera: THREE.OrthographicCamera; dots: THREE.InstancedMesh; upTo: number } | null = null;

  constructor(cfg: EffectsConfig, info: SceneInfo, renderer: THREE.WebGLRenderer) {
    this.cfg = cfg;
    this.radius = info.marbleRadius;
    const n = info.marbleColors.length;
    const disc = new THREE.CircleGeometry(1, 12);
    const glow = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    if (cfg.tails) {
      this.tails = new THREE.InstancedMesh(disc, glow(), n * TAIL_FRAMES);
      this.tails.frustumCulled = false;
      this.over.push(this.tails);
    }
    if (cfg.sparks) {
      this.sparks = new THREE.InstancedMesh(disc, glow(), MAX_SPARKS);
      this.sparks.frustumCulled = false;
      this.over.push(this.sparks);
    }
    if (cfg.stains) {
      const { width, height } = info.frame;
      const target = new THREE.WebGLRenderTarget(Math.round(width * STAIN_SCALE), Math.round(height * STAIN_SCALE));
      const dots = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ transparent: true, opacity: STAIN_ALPHA, depthWrite: false }), n);
      dots.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(dots);
      const camera = new THREE.OrthographicCamera(0, width, 0, -height, -10, 10);
      this.stain = { target, scene, camera, dots, upTo: -1 };
      this.clearStains(renderer);
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthWrite: false }));
      quad.position.set(width / 2, -height / 2, 0);
      this.under.push(quad);
    }
  }

  /** Frame each marble crossed a paint machine (sparks fly from there). */
  setPaintFrames(frames: Int32Array): void {
    this.paintFrames = frames;
  }

  /** Impact sounds [frame, marble, x, strength]: the louder the frames around now, the harder the shake. */
  setSounds(sounds: ArrayLike<number>, totalFrames: number): void {
    if (!this.cfg.shake) return;
    const e = new Float32Array(totalFrames);
    for (let k = 0; k < sounds.length; k += 4) e[sounds[k]] += sounds[k + 3];
    this.shakeEnergy = e;
  }

  /** Screen offset in px for this frame. */
  shake(frame: number): { x: number; y: number } {
    const e = this.shakeEnergy;
    if (!e) return { x: 0, y: 0 };
    let sum = 0;
    for (let f = Math.max(0, frame - SHAKE_WINDOW); f <= frame && f < e.length; f++) sum += e[f];
    const strength = typeof this.cfg.shake === 'number' ? this.cfg.shake : 1;
    const amp = Math.min(14, Math.max(0, sum / 4000 - 1)) * strength;
    return { x: amp * noise(frame * 1.7), y: amp * noise(frame * 2.3 + 11) };
  }

  update(rec: Recording, frame: number, tint: (i: number) => number, renderer: THREE.WebGLRenderer): void {
    if (this.tails) this.drawTails(rec, frame, tint);
    if (this.sparks) this.drawSparks(rec, frame, tint);
    if (this.stain) this.drawStains(rec, frame, tint, renderer);
  }

  // Up to TAIL_FRAMES earlier positions of each fast marble, smaller and fainter the older they are.
  private drawTails(rec: Recording, frame: number, tint: (i: number) => number): void {
    const mesh = this.tails!;
    const color = new THREE.Color();
    let k = 0;
    for (let i = 0; i < rec.marbleCount; i++) {
      if (!rec.marble(frame, i, this.m)) continue;
      if (frame < 1 || !rec.marble(frame - 1, i, this.p) || Math.hypot(this.m.x - this.p.x, this.m.y - this.p.y) < TAIL_SPEED) continue;
      const c = tint(i);
      for (let a = 1; a <= TAIL_FRAMES && frame - a >= 0; a++) {
        if (!rec.marble(frame - a, i, this.p)) break;
        const fade = 1 - a / (TAIL_FRAMES + 1);
        put(mesh, k, this.p.x, this.p.y, this.radius * (0.4 + 0.6 * fade));
        mesh.setColorAt(k++, color.setHex(c).multiplyScalar(0.55 * fade));
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Each marble throws a few sparks of its new colour when it crosses the paint bar; they arc and fade.
  private drawSparks(rec: Recording, frame: number, tint: (i: number) => number): void {
    const mesh = this.sparks!;
    const frames = this.paintFrames;
    const color = new THREE.Color();
    let k = 0;
    if (frames) {
      for (let i = 0; i < rec.marbleCount && k < MAX_SPARKS; i++) {
        const age = frame - frames[i];
        if (frames[i] < 0 || age < 0 || age >= SPARK_FRAMES || !rec.marble(frames[i], i, this.p)) continue;
        const c = tint(i);
        for (let s = 0; s < SPARKS_PER_MARBLE && k < MAX_SPARKS; s++) {
          const angle = hash(i * 7 + s) * Math.PI * 2;
          const speed = 2 + hash(i * 13 + s * 3) * 3;
          const x = this.p.x + Math.cos(angle) * speed * age;
          const y = this.p.y + Math.sin(angle) * speed * age + 0.08 * age * age;
          const life = 1 - age / SPARK_FRAMES;
          put(mesh, k, x, y, Math.max(0.6, 1.8 * life));
          mesh.setColorAt(k++, color.setHex(c).multiplyScalar(life));
        }
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Every frame stamps each moving marble faintly onto a texture behind the ground, so paths show up as paint.
  private drawStains(rec: Recording, frame: number, tint: (i: number) => number, renderer: THREE.WebGLRenderer): void {
    const st = this.stain!;
    if (frame < st.upTo) this.clearStains(renderer);
    const color = new THREE.Color();
    const before = renderer.getRenderTarget();
    renderer.autoClear = false;
    for (let f = st.upTo + 1; f <= frame; f++) {
      let k = 0;
      for (let i = 0; i < rec.marbleCount; i++) {
        if (!rec.marble(f, i, this.m)) continue;
        if (f > 0 && rec.marble(f - 1, i, this.p) && Math.hypot(this.m.x - this.p.x, this.m.y - this.p.y) < 0.5) continue;
        put(st.dots, k, this.m.x, this.m.y, this.radius * 1.1);
        st.dots.setColorAt(k++, color.setHex(tint(i)));
      }
      st.dots.count = k;
      st.dots.instanceMatrix.needsUpdate = true;
      if (st.dots.instanceColor) st.dots.instanceColor.needsUpdate = true;
      renderer.setRenderTarget(st.target);
      renderer.render(st.scene, st.camera);
    }
    renderer.setRenderTarget(before);
    renderer.autoClear = true;
    st.upTo = frame;
  }

  private clearStains(renderer: THREE.WebGLRenderer): void {
    const st = this.stain!;
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(st.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.setRenderTarget(before);
    st.upTo = -1;
  }
}

function put(mesh: THREE.InstancedMesh, k: number, x: number, y: number, r: number): void {
  (mesh.instanceMatrix.array as Float32Array).set([r, 0, 0, 0, 0, r, 0, 0, 0, 0, 1, 0, x, -y, 0, 1], k * 16);
}

// Repeatable pseudo-random numbers: the same input always gives the same spark and the same shake.
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(t: number): number {
  const i = Math.floor(t);
  const u = t - i;
  const a = hash(i) * 2 - 1;
  const b = hash(i + 1) * 2 - 1;
  return a + (b - a) * u * u * (3 - 2 * u);
}
