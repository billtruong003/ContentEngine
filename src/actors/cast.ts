// Who each marble is and how it looks on a given frame. Characters come from packs in public/packs/;
// every image (plus the plain marble) is packed into one atlas texture so all marbles draw in a single call.
import type { Decoded, Recording } from '../physics/recording.ts';
import { MARBLE_SHAPES, type MapDoc, type MarbleShape } from '../map/types.ts';
import type { Machine } from '../map/layout.ts';

export interface PackIndex {
  name: string;
  characters: Record<string, { expressions: Record<string, string>; sounds: Record<string, string> }>;
  unsorted: string[];
}

/** What a marble shows on one frame. `angle` null means "roll with the physics body". */
export interface Pose {
  cell: number;
  size: number;
  sx: number;
  sy: number;
  angle: number | null;
  dim: number;
}

const CELL = 128;
const COLS = 16;
const HIT_FRAMES = 14;
const SCARED_SPEED = 520;
const SLEEP_FRAMES = 90;
const SLEEP_MOVE_PX = 3;
const BLINK_EVERY = 210;
const BLINK_FRAMES = 7;

export class Cast {
  readonly atlas: HTMLCanvasElement;
  readonly cols = COLS;
  readonly rows: number;
  readonly warnings: string[];
  private readonly cells: Map<string, number>;
  private packs = new Map<string, PackIndex>();
  private readonly start: (string | null)[];
  private readonly scale: number[];
  private readonly upright: boolean[];
  private swaps: { steps: Int32Array; character: string }[] = [];
  private hits: Int32Array[] = [];
  private readonly a: Decoded = { x: 0, y: 0, angle: 0 };
  private readonly b: Decoded = { x: 0, y: 0, angle: 0 };

  private constructor(atlas: HTMLCanvasElement, cells: Map<string, number>, start: (string | null)[], scale: number[], upright: boolean[], warnings: string[]) {
    this.atlas = atlas;
    this.cells = cells;
    this.start = start;
    this.scale = scale;
    this.upright = upright;
    this.warnings = warnings;
    // Taken from the canvas itself so the shader's cell maths always matches what was drawn.
    this.rows = atlas.height / CELL;
  }

  /** True for the plain marble and its shaped versions, which take the marble's colour as a tint. */
  isPlain(cell: number): boolean {
    return cell === 0 || this.shapeCells.has(cell);
  }

  /** Atlas cell of a plain marble drawn as `shape`. */
  shapeCell(shape: string): number {
    return this.cells.get(`shape:${shape}`) ?? 0;
  }

  private get shapeCells(): Set<number> {
    this.plainCells ??= new Set([...this.cells].filter(([k]) => k.startsWith('shape:')).map(([, v]) => v));
    return this.plainCells;
  }

  private plainCells: Set<number> | null = null;

  get hasActors(): boolean {
    return this.start.some((c) => c !== null);
  }

  /** Loads the packs a map uses and assigns a starting character to every marble (seeded, deterministic). */
  static async load(map: MapDoc, marbleCaves: number[], machines: Machine[]): Promise<Cast> {
    const warnings: string[] = [];
    const packs = new Map<string, PackIndex>();
    const wanted = new Set<string>();
    for (const c of map.caves) if (c.marbles?.actors) wanted.add(c.marbles.actors.pack);
    for (const m of machines) if (m.kind === 'swap' && m.character?.includes('/')) wanted.add(m.character.split('/')[0]);
    for (const name of wanted) {
      try {
        const res = await fetch(`/packs/${name}/pack.json`);
        if (!res.ok) throw new Error();
        packs.set(name, await res.json());
      } catch {
        warnings.push(`Thiếu pack "${name}" (public/packs/${name}/). Bi vẽ thành viên tròn trơn.`);
      }
    }

    const start = marbleCaves.map((caveIndex, i) => {
      const actors = map.caves[caveIndex]?.marbles?.actors;
      const pack = actors && packs.get(actors.pack);
      if (!actors || !pack) return null;
      const ids = (actors.characters ?? Object.keys(pack.characters).sort()).filter((id) => pack.characters[id]);
      if (!ids.length) return null;
      return `${actors.pack}/${ids[Math.floor(hash(map.seed * 7919 + i) * ids.length)]}`;
    });
    const scale = marbleCaves.map((c) => map.caves[c]?.marbles?.actors?.scale ?? 1.2);
    const upright = marbleCaves.map((c) => map.caves[c]?.marbles?.actors?.upright ?? false);

    // Cell 0 is the plain shaded marble; then one cell per character expression.
    const images: [string, string][] = [];
    for (const [name, pack] of packs) {
      for (const [id, c] of Object.entries(pack.characters)) {
        for (const [expr, file] of Object.entries(c.expressions)) images.push([`${name}/${id}@${expr}`, `/packs/${name}/${file}`]);
      }
    }
    const cells = new Map<string, number>();
    const rows = Math.ceil((images.length + 1 + MARBLE_SHAPES.length) / COLS) + 1;
    const atlas = document.createElement('canvas');
    atlas.width = COLS * CELL;
    atlas.height = rows * CELL;
    const ctx = atlas.getContext('2d')!;
    drawMarble(ctx);
    const loaded = await Promise.all(images.map(([, src]) => loadImage(src).catch(() => null)));
    images.forEach(([key], k) => {
      const img = loaded[k];
      if (!img) {
        warnings.push(`Không mở được ảnh ${images[k][1]}`);
        return;
      }
      const cell = cells.size + 1;
      cells.set(key, cell);
      // A small inset keeps neighbouring cells from bleeding into each other at small sizes.
      const s = Math.min((CELL - 8) / img.width, (CELL - 8) / img.height);
      ctx.drawImage(img, (cell % COLS) * CELL + (CELL - img.width * s) / 2, Math.floor(cell / COLS) * CELL + (CELL - img.height * s) / 2, img.width * s, img.height * s);
    });
    // Plain marble cells in other shapes, for shape machines.
    for (const shape of MARBLE_SHAPES) {
      const cell = cells.size + 1;
      cells.set(`shape:${shape}`, cell);
      ctx.save();
      ctx.translate((cell % COLS) * CELL, Math.floor(cell / COLS) * CELL);
      drawShape(ctx, shape);
      ctx.restore();
    }
    for (const m of machines) {
      if (m.kind !== 'swap') continue;
      const c = m.character!;
      const known = [...cells.keys()].some((k) => (c.includes('/') ? k.startsWith(`${c}@`) : k.includes(`/${c}@`)));
      if (!known) warnings.push(`Máy đổi nhân vật: không có nhân vật "${c}" trong pack nào đang dùng.`);
    }
    const cast = new Cast(atlas, cells, start, scale, upright, warnings);
    cast.packs = packs;
    return cast;
  }

  /** Swap machines and their crossing steps, known once the bake is done. */
  setSwaps(machines: Machine[], machineSteps: Int32Array[]): void {
    this.swaps = machines.flatMap((m, k) => (m.kind === 'swap' ? [{ steps: machineSteps[k], character: m.character! }] : []));
  }

  /** Impact sounds as [frame, marble, x, strength]; hard hits show the "hit" face. */
  setHits(sounds: ArrayLike<number>): void {
    const lists = new Map<number, number[]>();
    for (let k = 0; k < sounds.length; k += 4) (lists.get(sounds[k + 1]) ?? lists.set(sounds[k + 1], []).get(sounds[k + 1])!).push(sounds[k]);
    this.hits = this.start.map((_, i) => Int32Array.from(lists.get(i) ?? []));
  }

  /** Path under public/ of a character's sound for `action`, if the pack has one. */
  soundOf(who: string | null, action: string): string | null {
    if (!who) return null;
    const [pack, id] = who.split('/');
    const file = this.packs.get(pack)?.characters[id]?.sounds[action];
    return file ? `packs/${pack}/${file}` : null;
  }

  characterAt(i: number, frame: number): string | null {
    let who = this.start[i];
    let when = -1;
    for (const s of this.swaps) {
      const step = s.steps[i];
      if (step >= 0 && step <= frame && step > when) {
        when = step;
        who = s.character.includes('/') ? s.character : `${(who ?? '').split('/')[0]}/${s.character}`;
      }
    }
    return who;
  }

  pose(rec: Recording, i: number, frame: number, out: Pose): void {
    out.sx = out.sy = 1;
    out.dim = 1;
    const who = this.characterAt(i, frame);
    if (!who) {
      out.cell = 0;
      out.size = 1;
      out.angle = null;
      return;
    }
    out.size = this.scale[i];
    out.angle = this.upright[i] ? 0 : null;
    const expr = this.expression(rec, i, frame);
    const cell = this.cells.get(`${who}@${expr}`);
    out.cell = cell ?? this.cells.get(`${who}@default`) ?? 0;
    if (cell !== undefined) return;
    // No picture for this expression: fake it with motion and shading.
    if (expr === 'hit') { out.sx = 1.25; out.sy = 0.8; }
    else if (expr === 'scared') out.angle = (out.angle ?? 0) + Math.sin(frame * 0.9 + i) * 0.25;
    else if (expr === 'sleep') { out.dim = 0.72; out.sy = 1 + Math.sin(frame * 0.08 + i) * 0.04; }
  }

  private expression(rec: Recording, i: number, frame: number): string {
    const hits = this.hits[i];
    if (hits && hits.length) {
      let lo = 0;
      let hi = hits.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (hits[mid] <= frame) lo = mid + 1; else hi = mid; }
      if (lo > 0 && frame - hits[lo - 1] < HIT_FRAMES) return 'hit';
    }
    if (!rec.marble(frame, i, this.a)) return 'default';
    if (frame >= 2 && rec.marble(frame - 2, i, this.b) && Math.hypot(this.a.x - this.b.x, this.a.y - this.b.y) * 30 > SCARED_SPEED) {
      return 'scared';
    }
    if (frame >= SLEEP_FRAMES && rec.marble(frame - SLEEP_FRAMES, i, this.b) && Math.hypot(this.a.x - this.b.x, this.a.y - this.b.y) < SLEEP_MOVE_PX) {
      return 'sleep';
    }
    return (frame + Math.floor(hash(i) * BLINK_EVERY)) % BLINK_EVERY < BLINK_FRAMES ? 'blink' : 'default';
  }
}

function drawMarble(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(CELL * 0.36, CELL * 0.34, CELL * 0.04, CELL / 2, CELL / 2, CELL / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#e6e6e6');
  g.addColorStop(1, '#8c8c8c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(CELL / 2, CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: MarbleShape): void {
  const g = ctx.createLinearGradient(0, 0, CELL, CELL);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#9a9a9a');
  ctx.fillStyle = g;
  const c = CELL / 2;
  const r = CELL / 2 - 3;
  ctx.beginPath();
  if (shape === 'square') ctx.rect(c - r * 0.86, c - r * 0.86, r * 1.72, r * 1.72);
  else if (shape === 'diamond') { ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c); }
  else if (shape === 'triangle') { ctx.moveTo(c, c - r); ctx.lineTo(c + r * 0.95, c + r * 0.7); ctx.lineTo(c - r * 0.95, c + r * 0.7); }
  else if (shape === 'star') {
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (Math.PI * k) / 5;
      const rr = k % 2 ? r * 0.45 : r;
      ctx.lineTo(c + rr * Math.cos(a), c + rr * Math.sin(a));
    }
  } else {
    for (let k = 0; k <= 40; k++) {
      const t = (2 * Math.PI * k) / 40;
      ctx.lineTo(c + (r * 16 * Math.sin(t) ** 3) / 17, c - (r * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 17);
    }
  }
  ctx.closePath();
  ctx.fill();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
