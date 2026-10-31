// Works out the colour every marble should end up with: where it rests at the end of the bake decides
// which pixel of the target picture it shows. Runs in the browser because it decodes images.
import { insidePolygon, outline } from '../map/geometry.ts';
import { PALETTES, type Cave, type MapDoc, type Paint } from '../map/types.ts';
import type { Decoded, Recording } from '../physics/recording.ts';
import { STEP } from '../core/time.ts';

const DEFAULT_BACKGROUND = '#1d2230';
/** A colour flip sweeps from the top of the pile to the bottom over this many frames. */
const FLIP_SWEEP = 40;
/** How far above a picture cave (px) backed-up marbles still join its picture. */
const MOUTH = 80;

/** The second picture of a colour-flip ending: colour per marble (-1 = none) and the frame it flips at. */
export async function flipColors(map: MapDoc, rec: Recording): Promise<{ colors: Int32Array; frames: Int32Array } | null> {
  if (!map.caves.some((c) => c.paint?.flip)) return null;
  const frames = new Int32Array(rec.marbleCount).fill(-1);
  const colors = await finalColors(map, rec, (c) => c.paint?.flip, (i, cave, y, box) => {
    frames[i] = Math.round(cave.paint!.flip!.t / STEP + ((y - box.y) / Math.max(1, box.h)) * FLIP_SWEEP);
  });
  return { colors, frames };
}

/** Starting colour per marble for caves whose marbles start as a picture (`marbles.paint`), or null if none do. */
export async function startColors(map: MapDoc, rec: Recording): Promise<Int32Array | null> {
  if (!map.caves.some((c) => c.marbles?.paint)) return null;
  // Marbles start on a loose grid and drop into a pile; the picture is drawn on the pile, just before the first gate opens.
  const opens = map.events.filter((e) => e.do === 'valve.open').map((e) => e.t);
  const frame = Math.max(0, Math.min(rec.frames - 1, Math.round((opens.length ? Math.min(...opens) : 0) / STEP)));
  return finalColors(map, rec, (c) => c.marbles?.paint, undefined, frame);
}

/** Final colour per marble as 0xRRGGBB (sRGB), or -1 for marbles that keep their own colour. */
export async function finalColors(
  map: MapDoc,
  rec: Recording,
  paintOf: (cave: Cave) => Paint | undefined = (c) => c.paint,
  onMember?: (i: number, cave: Cave, y: number, box: Box) => void,
  frame?: number,
): Promise<Int32Array> {
  const out = new Int32Array(rec.marbleCount).fill(-1);
  // After a "break" ending the marbles are flying away; the picture is the pile just before it broke.
  const end = map.ending?.kind === 'break' ? Math.round(map.ending.t / STEP) - 1 : Infinity;
  const last = frame ?? Math.max(0, Math.min(rec.frames - 1, end));
  const xs = new Float32Array(rec.marbleCount);
  const ys = new Float32Array(rec.marbleCount);
  const alive = new Uint8Array(rec.marbleCount);
  const m: Decoded = { x: 0, y: 0, angle: 0 };
  for (let i = 0; i < rec.marbleCount; i++) {
    if (!rec.marble(last, i, m)) continue;
    xs[i] = m.x;
    ys[i] = m.y;
    alive[i] = 1;
  }

  for (const cave of map.caves) {
    const paint = paintOf(cave);
    if (!paint) continue;
    const poly = outline(cave);
    const members: number[] = [];
    // A full cave backs its last marbles up into the pipe just above it; they belong to the picture too.
    const x0 = Math.min(...poly.map((p) => p.x));
    const x1 = Math.max(...poly.map((p) => p.x));
    const y0 = Math.min(...poly.map((p) => p.y)) - MOUTH;
    const y1 = Math.max(...poly.map((p) => p.y));
    for (let i = 0; i < rec.marbleCount; i++) {
      if (!alive[i] || xs[i] < x0 || xs[i] > x1 || ys[i] < y0 || ys[i] > y1) continue;
      if (insidePolygon({ x: xs[i], y: ys[i] }, poly) || !insideAny(map, xs[i], ys[i])) members.push(i);
    }
    if (!members.length) continue;
    const r = map.physics?.marbleRadius ?? 4;
    const box = {
      x: Math.min(...members.map((i) => xs[i])) - r,
      y: Math.min(...members.map((i) => ys[i])) - r,
      w: 0,
      h: 0,
    };
    box.w = Math.max(...members.map((i) => xs[i])) + r - box.x;
    box.h = Math.max(...members.map((i) => ys[i])) + r - box.y;
    const pick = await picker(paint, paint.fit === 'shared' ? sharedBox(map, paint, paintOf) : box);
    for (const i of members) {
      out[i] = pick(xs[i], ys[i]);
      onMember?.(i, cave, ys[i], box);
    }
  }
  return out;
}

type Box = { x: number; y: number; w: number; h: number };

// fit "shared": one picture spread over every cave with the same paint, each cave showing its own piece.
function sharedBox(map: MapDoc, paint: Paint, paintOf: (cave: Cave) => Paint | undefined): Box {
  const key = JSON.stringify(paint);
  const pts = map.caves.filter((c) => JSON.stringify(paintOf(c)) === key).flatMap((c) => outline(c));
  const x = Math.min(...pts.map((p) => p.x));
  const y = Math.min(...pts.map((p) => p.y));
  return { x, y, w: Math.max(...pts.map((p) => p.x)) - x, h: Math.max(...pts.map((p) => p.y)) - y };
}
type Pick = (x: number, y: number) => number;

async function picker(paint: Paint, box: Box): Promise<Pick> {
  const colors = (paint.colors?.length ? paint.colors : PALETTES[paint.palette ?? ''] ?? PALETTES.pastel).map(hex);
  const along = (dir: 'x' | 'y') => (x: number, y: number) => Math.min(1, Math.max(0, dir === 'x' ? (x - box.x) / box.w : (y - box.y) / box.h));
  switch (paint.mode) {
    case 'image': return imagePicker(paint, box);
    case 'rainbow': {
      const t = along(paint.direction ?? 'x');
      return (x, y) => hslHex(t(x, y) * 300, 0.85, 0.58);
    }
    case 'gradient': {
      const t = along(paint.direction ?? 'x');
      return (x, y) => blend(colors, t(x, y));
    }
    case 'depth': {
      const t = along('y');
      const [deep, light] = paint.colors?.length || paint.palette ? [colors[0], colors[colors.length - 1]] : [0x0b2a6b, 0x9ad1ff];
      return (x, y) => blend([light, deep], t(x, y));
    }
    case 'stripes': {
      const dir = paint.direction ?? 'y';
      const t = along(dir);
      const bands = Math.max(1, paint.bands ?? 6);
      return (x, y) => colors[Math.min(bands - 1, Math.floor(t(x, y) * bands)) % colors.length];
    }
    case 'checker': {
      const cell = Math.max(4, paint.cell ?? 40);
      const two = colors.length >= 2 ? colors : [colors[0], 0xffffff];
      return (x, y) => two[(Math.floor((x - box.x) / cell) + Math.floor((y - box.y) / cell)) % two.length];
    }
  }
}

const hex = (c: string) => parseInt(c.slice(1), 16);

// Linear blend through the colour list, t from 0 to 1.
function blend(colors: number[], t: number): number {
  if (colors.length === 1) return colors[0];
  const f = t * (colors.length - 1);
  const k = Math.min(colors.length - 2, Math.floor(f));
  const u = f - k;
  const [a, b] = [colors[k], colors[k + 1]];
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - u) + ((b >> s) & 255) * u) << s;
  return ch(16) | ch(8) | ch(0);
}

// The picture is laid over the box: the settled pile, or every cave sharing it for fit "shared".
async function imagePicker(paint: Paint, box: Box): Promise<Pick> {
  const img = await loadImage(paint.image!.startsWith('http') ? paint.image! : `/targets/${paint.image}`);
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const scale = (paint.fit === 'contain' || !paint.fit ? Math.min : Math.max)(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const { data } = ctx.getImageData(0, 0, w, h);
  const background = parseInt((paint.background ?? DEFAULT_BACKGROUND).slice(1), 16);
  return (x, y) => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(x - box.x)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(y - box.y)));
    const k = (py * w + px) * 4;
    if (data[k + 3] < 128) return background;
    return (data[k] << 16) | (data[k + 1] << 8) | data[k + 2];
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Không mở được ảnh đích ${src}`));
    img.src = src;
  });
}

function hslHex(h: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function insideAny(map: MapDoc, x: number, y: number): boolean {
  return map.caves.some((c) => insidePolygon({ x, y }, outline(c)));
}
