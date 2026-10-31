// Text over the video: titles, countdowns, live marble counters, team names and a race scoreboard.
// Everything is drawn on a 2D canvas the size of the video and laid over the WebGL picture as one texture,
// so it ends up in exported frames too. The canvas is only redrawn when something on it changes.
import * as THREE from 'three';
import { STEP } from '../core/time.ts';
import { insidePolygon, outline, type Pt } from '../map/geometry.ts';
import { DEFAULT_DURATION, type Caption, type MapDoc } from '../map/types.ts';
import type { Decoded, Recording } from '../physics/recording.ts';

const FONT = '"Arial Black", "Segoe UI Black", Arial, sans-serif';
const FADE = 0.4;
const TITLE_SECONDS = 3.5;

interface Zone { poly: Pt[]; x0: number; x1: number; y0: number; y1: number }
interface Item { text: string; x: number; y: number; size: number; alpha: number; color: string; panel?: boolean }

export class Captions {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly list: Caption[];
  private readonly map: MapDoc;
  private readonly zones = new Map<string, Zone>();
  private readonly w: number;
  private readonly h: number;
  /** Canvas px per video px. */
  private readonly px: number;
  /** One video px of a 1080-wide video, so sizes look the same at any resolution. */
  private readonly unit: number;
  private readonly m: Decoded = { x: 0, y: 0, angle: 0 };
  private shown = '';

  constructor(map: MapDoc, w: number, h: number, px: number) {
    this.map = map;
    this.list = map.captions ?? [];
    this.w = w;
    this.h = h;
    this.px = px;
    this.unit = w / 1080;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * px);
    canvas.height = Math.round(h * px);
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }));
    plane.position.set(w / 2, -h / 2, 0);
    this.scene.add(plane);
    this.camera = new THREE.OrthographicCamera(0, w, 0, -h, -1, 1);
    const counted = new Set(this.list.flatMap((c) => (c.kind === 'counter' ? [c.cave!] : c.kind === 'score' ? c.caves! : [])));
    for (const id of counted) {
      const poly = outline(map.caves.find((c) => c.id === id)!);
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      this.zones.set(id, { poly, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
  }

  /** Redraws the text for this frame if it changed. `toScreen` turns a frame point into video px. */
  update(rec: Recording, frame: number, toScreen: (x: number, y: number) => { x: number; y: number }): void {
    const t = frame * STEP;
    const counts = this.zones.size ? this.count(rec, frame) : null;
    const items: Item[] = [];
    const u = this.unit;
    const row = (at: Caption['at'], fallback: 'top' | 'middle' | 'bottom', size: number) => {
      const spot = at ?? fallback;
      return spot === 'top' ? 80 * u + size / 2 : spot === 'middle' ? this.h / 2 : this.h - 110 * u - size / 2;
    };
    for (const c of this.list) {
      const from = c.t ?? 0;
      // Counts and names go when a breaking or freezing ending scatters the caves.
      const until = c.until ?? (c.kind === 'title' ? from + TITLE_SECONDS : c.kind === 'countdown' ? this.endTime() : this.map.ending?.t ?? Infinity);
      if (t < from || t >= until) continue;
      const alpha = c.kind === 'title' ? Math.min(1, (t - from) / FADE, (until - t) / FADE) : 1;
      const color = c.color ?? '#ffffff';
      if (c.kind === 'title') {
        const size = (c.size ?? 76) * u;
        this.wrap(c.text!, size).forEach((line, k, all) => items.push({ text: line, x: this.w / 2, y: row(c.at, 'top', size) + (k - (all.length - 1) / 2) * size * 1.15, size, alpha, color }));
      } else if (c.kind === 'countdown') {
        const size = (c.size ?? 96) * u;
        const n = Math.ceil(until - t);
        items.push({ text: (c.text ?? '{n}').replace('{n}', String(n)), x: this.w / 2, y: row(c.at, 'bottom', size), size, alpha, color });
      } else if (c.kind === 'counter' || c.kind === 'label') {
        const cave = this.map.caves.find((k) => k.id === c.cave)!;
        const size = (c.size ?? (c.kind === 'label' ? 54 : 46)) * u;
        // Labels sit above the cave, counters below it.
        const y = c.kind === 'label' ? cave.y - cave.shape.radius - 34 : cave.y + cave.shape.radius + 40;
        const p = toScreen(cave.x, y);
        const text = c.kind === 'label' ? c.text! : (c.text ?? '{n}').replace('{n}', String(counts!.get(c.cave!) ?? 0));
        items.push({ text, x: p.x, y: p.y, size, alpha, color });
      } else {
        const size = (c.size ?? 46) * u;
        const rows = c.caves!.map((id, k) => ({ name: c.names?.[k] ?? id, n: counts!.get(id) ?? 0 })).sort((a, b) => b.n - a.n);
        const top = row(c.at, 'top', size);
        rows.forEach((r, k) => items.push({
          text: `${k + 1}. ${r.name}  ${r.n}`, x: this.w / 2, y: top + k * size * 1.3, size, alpha,
          color: k === 0 && r.n > 0 ? '#ffd23f' : color, panel: true,
        }));
      }
    }
    const key = items.map((i) => `${i.text}|${Math.round(i.x)}|${Math.round(i.y)}|${i.alpha.toFixed(2)}`).join('/');
    if (key === this.shown) return;
    this.shown = key;
    this.draw(items);
  }

  // Seconds left run out when the ending (or the zoom onto the finished picture) starts.
  private endTime(): number {
    return this.map.ending?.t ?? this.map.camera?.zoom?.t ?? this.map.duration ?? DEFAULT_DURATION;
  }

  private count(rec: Recording, frame: number): Map<string, number> {
    const out = new Map<string, number>();
    for (const id of this.zones.keys()) out.set(id, 0);
    const m = this.m;
    for (let i = 0; i < rec.marbleCount; i++) {
      if (!rec.marble(frame, i, m)) continue;
      for (const [id, z] of this.zones) {
        if (m.x < z.x0 || m.x > z.x1 || m.y < z.y0 || m.y > z.y1 || !insidePolygon(m, z.poly)) continue;
        out.set(id, out.get(id)! + 1);
        break;
      }
    }
    return out;
  }

  private wrap(text: string, size: number): string[] {
    const ctx = this.ctx;
    ctx.font = `900 ${size * this.px}px ${FONT}`;
    const max = this.w * 0.88 * this.px;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  private draw(items: Item[]): void {
    const { ctx, px } = this;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const it of items) {
      const size = it.size * px;
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.globalAlpha = it.alpha;
      if (it.panel) {
        const w = ctx.measureText(it.text).width + size;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.roundRect(it.x * px - w / 2, it.y * px - size * 0.65, w, size * 1.3, size * 0.3);
        ctx.fill();
      }
      ctx.lineWidth = size * 0.18;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeText(it.text, it.x * px, it.y * px);
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, it.x * px, it.y * px);
    }
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }
}
