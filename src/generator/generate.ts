// Makes new maps from a seed, and remixes existing ones. A map is built from a recipe: one pick for each "dish"
// (layout, cave shapes, road, paint, ending...). Any dish can be locked to a fixed value; the rest come from the seed,
// so the same seed and locks always give the same map. Nothing here runs physics: scripts/batch.ts plays each
// candidate through and throws away maps where marbles get stuck.
import { createRng, type Rng } from '../core/rng.ts';
import { outline } from '../map/geometry.ts';
import { reachable, topPoint } from '../map/reach.ts';
import { THEMES } from '../map/theme.ts';
import {
  MARBLE_SKINS, PALETTES, SOUND_SETS, valveId,
  type Caption, type Cave, type Flow, type FlowKind, type MapDoc, type MarbleShape, type MarbleSkin, type Paint, type PaintMode, type Shape, type SoundSet,
} from '../map/types.ts';

export const LAYOUTS = ['one', 'merge', 'split', 'chain', 'tiers', 'race'] as const;
export const SHAPES = ['circle', 'hexagon', 'octagon', 'pentagon', 'square', 'star', 'heart', 'drop', 'moon', 'rounded'] as const;
export const ROADS = ['pipe', 'zigzag', 'waterfall', 'pegs', 'mixed'] as const;
export const PAINTS = ['rainbow', 'gradient', 'stripes', 'checker', 'depth', 'image'] as const;
export const ENDINGS = ['none', 'zoom', 'flip', 'break', 'freeze'] as const;
export const MARBLE_LOOKS = ['round', 'square', 'triangle', 'star', 'heart', 'diamond'] as const;
export const EFFECTS = ['tails', 'sparks', 'stains', 'shake'] as const;
export const THEME_NAMES = ['none', ...Object.keys(THEMES)] as const;
/** Text over the video: a title, a live count of the marbles in the picture, seconds left, or (races) a scoreboard. */
export const TEXTS = ['none', 'title', 'counter', 'countdown', 'score'] as const;
/** How fast marbles fall: "normal" is the engine default, the slower ones lower gravity and add air drag. */
export const PACES = ['normal', 'slow', 'slower'] as const;
const PACE: Record<(typeof PACES)[number], { gravity?: number; drag?: number; time: number }> = {
  normal: { time: 1 },
  slow: { gravity: 2000, drag: 1.5, time: 1.6 },
  slower: { gravity: 1400, drag: 3, time: 2.3 },
};

export interface Recipe {
  layout: (typeof LAYOUTS)[number];
  /** Shape of the cave the picture forms in. */
  target: (typeof SHAPES)[number];
  road: (typeof ROADS)[number];
  paint: (typeof PAINTS)[number];
  palette: string;
  /** Colours the marbles start with. */
  marbles: string;
  ending: (typeof ENDINGS)[number];
  look: (typeof MARBLE_LOOKS)[number];
  effects: (typeof EFFECTS)[number][];
  background: string;
  /** "none" uses `background`, `skin` and `sound` as picked; a theme brings its own. */
  theme: string;
  skin: MarbleSkin;
  text: (typeof TEXTS)[number];
  sound: SoundSet;
  pace: (typeof PACES)[number];
}

export const LABELS: Record<string, string> = {
  one: 'Một chảy một', merge: 'Nhiều về một', split: 'Một chia nhiều', chain: 'Dây chuyền', tiers: 'Thác nhiều tầng', race: 'Đua song song',
  circle: 'tròn', hexagon: 'lục giác', octagon: 'bát giác', pentagon: 'ngũ giác', square: 'vuông', star: 'ngôi sao', heart: 'trái tim',
  drop: 'giọt nước', moon: 'bán nguyệt', rounded: 'chữ nhật bo góc',
  pipe: 'ống', zigzag: 'zigzag', waterfall: 'thác', pegs: 'lưới chốt', mixed: 'đủ kiểu đường',
  rainbow: 'cầu vồng', gradient: 'chuyển màu', stripes: 'sọc', checker: 'ô cờ', depth: 'theo độ sâu', image: 'ảnh',
  glass: 'bi thủy tinh', metal: 'bi kim loại', gem: 'bi ngọc', glow: 'bi phát sáng', flat: '',
  ...Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, `theme ${t.name.toLowerCase()}`])),
  slow: 'rơi chậm', slower: 'rơi rất chậm', normal: '',
  none: '', zoom: 'zoom cuối', flip: 'lật màu', break: 'vỡ hang', freeze: 'đóng băng',
};

const BACKGROUNDS = ['#10131a', '#0d1b2a', '#1a1023', '#101a14', '#1b1b1b', '#0b132b', '#22162b'];
const TEAM_NAMES = ['Đỏ', 'Vàng', 'Xanh', 'Lá', 'Tím', 'Cam'];
const TITLES = ['Hình gì sẽ hiện ra?', 'Xem tới cuối nhé!', 'Đoán xem ra hình gì?', 'Đã mắt chưa?', 'Bi chạy đi đâu đây?'];
const TEAMS = [['#ff4d5e', '#ff7a85'], ['#ffd23f', '#ffe27a'], ['#3fa7ff', '#7cc3ff'], ['#4dd98b', '#8be8b3'], ['#c77dff', '#e0b0ff'], ['#ff9f43', '#ffc38a']];
const W = 1080;
const H = 1920;
/** Generated maps use small marbles: more of them, so the picture comes out sharper. */
const MARBLE_RADIUS = 3;
/** Frame px per settled marble, measured on the templates (piles are not perfectly packed). */
const PX_PER_MARBLE = 4 * MARBLE_RADIUS * MARBLE_RADIUS;
/** How full the picture caves end up. */
const FILL = 0.75;

export interface Options {
  /** Pictures under public/targets/ the "image" paint may use. Without any, "image" is never picked. */
  images?: string[];
}

/** Every value a dish can take, for the CLI help and for checking locks. */
export function choices(opts: Options = {}): Record<keyof Recipe, readonly string[]> {
  return {
    layout: LAYOUTS, target: SHAPES, road: ROADS, paint: opts.images?.length ? PAINTS : PAINTS.filter((p) => p !== 'image'),
    palette: Object.keys(PALETTES), marbles: Object.keys(PALETTES), ending: ENDINGS, look: MARBLE_LOOKS, effects: EFFECTS, background: BACKGROUNDS,
    theme: THEME_NAMES, skin: MARBLE_SKINS, text: TEXTS, sound: SOUND_SETS, pace: PACES,
  };
}

/** "layout=merge,ending=freeze,effects=tails+sparks" → a partial recipe. Throws on unknown dishes or values. */
export function parseLock(text: string, opts: Options = {}): Partial<Recipe> {
  const all = choices(opts);
  const lock: Record<string, unknown> = {};
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [key, value = ''] = part.split('=').map((s) => s.trim());
    if (!(key in all)) throw new Error(`không có món "${key}". Có: ${Object.keys(all).join(', ')}`);
    const allowed = all[key as keyof Recipe];
    if (key === 'effects') {
      const list = value ? value.split('+') : [];
      for (const v of list) if (!allowed.includes(v)) throw new Error(`effects: không có "${v}". Có: ${allowed.join(', ')}`);
      lock.effects = list;
    } else if (key === 'background') {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('background: cần mã màu dạng #10131a');
      lock.background = value;
    } else {
      if (!allowed.includes(value)) throw new Error(`${key}: không có "${value}". Có: ${allowed.join(', ')}`);
      lock[key] = value;
    }
  }
  return lock as Partial<Recipe>;
}

export function pickRecipe(seed: number, lock: Partial<Recipe> = {}, opts: Options = {}): Recipe {
  const rng = createRng(seed * 7 + 3);
  const all = choices(opts);
  const pick = <K extends keyof Recipe>(key: K): Recipe[K] => (lock[key] ?? one(rng, all[key])) as Recipe[K];
  const r: Recipe = {
    layout: pick('layout'),
    target: pick('target'),
    road: pick('road'),
    paint: pick('paint'),
    palette: pick('palette'),
    marbles: pick('marbles'),
    ending: pick('ending'),
    look: lock.look ?? (rng() < 0.7 ? 'round' : one(rng, MARBLE_LOOKS.slice(1))),
    // Stains are only picked when locked: with thousands of marbles they soon paint every pipe solid.
    effects: lock.effects ?? EFFECTS.filter((e) => rng() < (e === 'stains' ? 0 : e === 'shake' ? 0.25 : 0.45)),
    background: pick('background'),
    theme: lock.theme ?? (rng() < 0.45 ? 'none' : one(rng, THEME_NAMES.slice(1))),
    skin: 'flat',
    text: 'none',
    sound: 'tick',
    pace: 'slow',
  };
  // Picked after the older dishes, so adding these did not change what earlier seeds make.
  const theme = THEMES[r.theme];
  r.skin = lock.skin ?? theme?.look.marble ?? (rng() < 0.35 ? 'flat' : one(rng, MARBLE_SKINS.slice(1)));
  r.sound = lock.sound ?? theme?.sound ?? one(rng, SOUND_SETS);
  // A scoreboard needs teams in separate caves, so only races show one.
  r.text = lock.text ?? one(rng, r.layout === 'race' ? (['none', 'title', 'countdown', 'score', 'score'] as const) : TEXTS.slice(0, 4));
  r.pace = lock.pace ?? (rng() < 0.55 ? 'slow' : 'slower');
  return r;
}

/** A finished map for this seed. `lock` fixes any dishes; the rest are picked from the seed. */
export function generate(seed: number, lock: Partial<Recipe> = {}, opts: Options = {}): { map: MapDoc; recipe: Recipe } {
  const recipe = pickRecipe(seed, lock, opts);
  const rng = createRng(seed * 13 + 1);
  const b = new Builder(recipe, rng, opts);
  // Slower marbles take longer to arrive and settle.
  const settle = Math.round(BUILD[recipe.layout](b) * PACE[recipe.pace].time);
  const map = b.finish(seed, settle);
  return { map, recipe: b.final! };
}

/** Short Vietnamese description of a recipe, used as the map name. */
export function describe(r: Recipe): string {
  const parts = [LABELS[r.layout], `hang ${LABELS[r.target]}`, LABELS[r.road], r.layout === 'race' ? '' : `sơn ${LABELS[r.paint]}${r.paint === 'image' ? '' : ` ${r.palette}`}`];
  if (r.look !== 'round') parts.push(`bi hình ${r.look}`);
  if (r.ending !== 'none') parts.push(LABELS[r.ending]);
  if (r.pace !== 'normal') parts.push(LABELS[r.pace]);
  if (r.theme !== 'none') parts.push(LABELS[r.theme]);
  else if (r.skin !== 'flat') parts.push(LABELS[r.skin]);
  return parts.filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- layouts

class Builder {
  readonly caves: Cave[] = [];
  readonly flows: Flow[] = [];
  readonly events: MapDoc['events'] = [];
  /** Caves the picture forms in. */
  readonly targets: string[] = [];
  /** Race teams, in cave order: index into TEAMS. */
  teams: number[] = [];
  /** The recipe as built: some layouts overrule a dish (a race has no paint machine, so no marble look). */
  final: Recipe | null = null;
  readonly r: Recipe;
  readonly rng: Rng;
  readonly opts: Options;
  constructor(r: Recipe, rng: Rng, opts: Options) {
    this.r = r;
    this.rng = rng;
    this.opts = opts;
  }

  /** A cave of the recipe's target shape that fits in a circle of `size` px radius. */
  targetShape(size: number): Shape {
    return shapeOf(this.r.target, size, this.rng);
  }

  /** A plain shape for caves that hold and release marbles (they need a floor for the valves). */
  holderShape(size: number): Shape {
    return shapeOf(one(this.rng, ['circle', 'hexagon', 'octagon', 'pentagon', 'rounded'] as const), size, this.rng);
  }

  road(i: number, options: FlowKind[] = ['pipe', 'zigzag', 'waterfall', 'pegs']): FlowKind {
    if (this.r.road !== 'mixed') return this.r.road as FlowKind;
    return options[(i + Math.floor(this.rng() * options.length)) % options.length];
  }

  cave(id: string, x: number, y: number, shape: Shape, extra: Partial<Cave> = {}): Cave {
    const c: Cave = { id, x: Math.round(x), y: Math.round(y), shape, ...extra };
    this.caves.push(c);
    return c;
  }

  flow(from: string, to: string, kind: FlowKind, extra: Partial<Flow> = {}): void {
    const f: Flow = { from, to, kind, ...extra };
    if (kind === 'zigzag') f.turns = 2 + Math.floor(this.rng() * 3);
    this.flows.push(f);
  }

  /** A flow into a picture cave: carries the paint machine, and the marble look machine if the recipe has one. */
  paintedFlow(from: string, to: string, kind: FlowKind, extra: Partial<Flow> = {}): void {
    const look: Partial<Flow> = this.r.look === 'round' ? {} : { shape: { at: 0.25, shape: this.r.look as MarbleShape } };
    this.flow(from, to, kind, { ...extra, ...look, paint: { at: 0.6 } });
  }

  open(t: number, cave: string): void {
    this.events.push({ t, do: 'valve.open', cave });
  }

  marbles(cave: Cave, count: number, colors?: string[]): void {
    cave.marbles = { count: Math.round(count), colors: colors ?? PALETTES[this.r.marbles] };
  }

  /** How many marbles the target caves can show without overflowing, keeping some headroom. */
  room(ids = this.targets): number {
    return 0.8 * ids.reduce((s, id) => s + area(this.caves.find((c) => c.id === id)!), 0) / PX_PER_MARBLE;
  }

  // Sources are smaller than the picture caves, so a picture cave sized for the layout would end up a third full and
  // the picture would be a thin strip. Shrink each one (around its centre) until the marbles fill about FILL of it.
  private fitTargets(): void {
    const total = this.caves.reduce((s, c) => s + (c.marbles?.count ?? 0), 0);
    const share = total / this.targets.length;
    for (const id of this.targets) {
      const cave = this.caves.find((c) => c.id === id)!;
      const scale = Math.sqrt((share * PX_PER_MARBLE) / FILL / area(cave));
      if (scale < 1) cave.shape.radius = Math.round(cave.shape.radius * Math.max(0.55, scale));
    }
  }

  finish(seed: number, settle: number): MapDoc {
    const r = this.r;
    const ending = r.layout === 'race' && r.ending === 'flip' ? 'zoom' : r.ending;
    const duration = Math.round(settle + (ending === 'none' ? 2 : ending === 'zoom' ? 4 : 5));
    this.fitTargets();
    for (const id of this.targets) pourAtTop(this.caves.find((c) => c.id === id)!, this.caves, this.flows);
    for (const id of this.targets) {
      const cave = this.caves.find((c) => c.id === id)!;
      if (r.layout !== 'race') cave.paint = paintFor(this.rng, this.opts, r.paint, r.palette, this.targets.length > 1);
      if (ending === 'flip' && cave.paint) {
        const other = one(this.rng, Object.keys(PALETTES).filter((p) => p !== r.palette));
        cave.paint.flip = { ...paintFor(this.rng, this.opts, r.paint === 'image' ? 'rainbow' : r.paint, other, this.targets.length > 1), t: settle };
      }
    }
    const kinds = [...new Set(this.flows.map((f) => f.kind))];
    this.final = {
      ...r,
      ending,
      road: kinds.length === 1 ? (kinds[0] as Recipe['road']) : 'mixed',
      look: this.flows.some((f) => f.shape) ? r.look : 'round',
      text: r.text === 'score' && r.layout !== 'race' ? 'counter' : r.text,
    };
    const map: MapDoc = {
      schemaVersion: 1,
      name: describe(this.final),
      seed,
      duration,
      frame: { width: W, height: H, background: r.background },
      physics: { marbleRadius: MARBLE_RADIUS, ...(PACE[r.pace].gravity ? { gravity: PACE[r.pace].gravity, drag: PACE[r.pace].drag } : {}) },
      caves: [],
      events: [],
    };
    const effects = r.effects.filter((e) => e !== 'sparks' || r.layout !== 'race');
    if (effects.length) map.effects = Object.fromEntries(effects.map((e) => [e, true]));
    if (ending === 'zoom') map.camera = { zoom: { cave: this.targets[Math.floor(this.rng() * this.targets.length)], t: settle, scale: 1.6 } };
    if (ending === 'break' || ending === 'freeze') map.ending = { kind: ending, t: settle };
    this.style(map);
    map.caves = this.caves;
    map.flows = this.flows;
    map.events = this.events.sort((a, b) => a.t - b.t);
    return reorder(map);
  }

  // Theme, marble skin, hit sound and text over the video.
  private style(map: MapDoc): void {
    const r = this.final!;
    const theme = THEMES[r.theme];
    if (theme) {
      map.theme = r.theme;
      if (r.skin !== theme.look.marble) map.look = { marble: r.skin };
      if (r.sound !== theme.sound) map.sound = r.sound;
    } else {
      if (r.skin !== 'flat') map.look = { marble: r.skin, ...(r.skin !== 'glow' && this.rng() < 0.6 ? { shadow: true } : {}) };
      if (r.sound !== 'tick') map.sound = r.sound;
    }
    const captions: Caption[] = [];
    const race = r.layout === 'race';
    if (r.text === 'title') captions.push({ kind: 'title', text: race ? 'Đội nào thắng?' : one(this.rng, TITLES), at: race ? 'middle' : 'top' });
    if (r.text === 'countdown') captions.push({ kind: 'countdown', text: '{n}' });
    if (r.text === 'counter') for (const id of this.targets) captions.push({ kind: 'counter', cave: id, text: this.targets.length > 1 ? '{n}' : '{n} bi' });
    if (r.text === 'score') {
      const names = this.teams.map((k) => TEAM_NAMES[k]);
      this.caves.filter((c) => c.marbles).forEach((c, i) => captions.push({ kind: 'label', cave: c.id, text: names[i].toUpperCase(), color: TEAMS[this.teams[i]][1] }));
      captions.push({ kind: 'score', caves: this.targets, names, at: 'middle', t: 2 });
    }
    if (captions.length) map.captions = captions;
  }
}

/** Each layout places its caves and returns the second the marbles have settled by. */
const BUILD: Record<Recipe['layout'], (b: Builder) => number> = {
  one(b) {
    const src = b.cave('A', 540, 460, b.holderShape(205 + b.rng() * 25), { valves: [{ width: 56 }] });
    b.cave('B', 540, 1400, b.targetShape(290 + b.rng() * 30));
    b.targets.push('B');
    b.marbles(src, Math.min(b.room(), 0.55 * area(src) / PX_PER_MARBLE));
    b.paintedFlow('A', 'B', b.road(0));
    b.open(1, 'A');
    return 16;
  },
  merge(b) {
    const n = b.rng() < 0.5 ? 2 : 3;
    const xs = n === 2 ? [290, 790] : [200, 540, 880];
    const size = n === 2 ? 190 : 160;
    b.cave('BIG', 540, 1390, b.targetShape(330 + b.rng() * 15));
    b.targets.push('BIG');
    const each = Math.min(b.room() / n, 0.55 * area({ id: '', x: 0, y: 0, shape: { kind: 'circle', radius: size } }) / PX_PER_MARBLE);
    const teams = shuffle(b.rng, TEAMS);
    xs.forEach((x, i) => {
      const id = String.fromCharCode(65 + i);
      const src = b.cave(id, x, 390, b.holderShape(size), { valves: [{ width: 56 }] });
      b.marbles(src, each, b.rng() < 0.5 ? teams[i] : undefined);
      // Side caves sit far from the centre; a straight drop would miss the bowl, so they take pipes or zigzags.
      const side = n === 3 && i !== 1;
      b.paintedFlow(id, 'BIG', side && b.r.road !== 'zigzag' ? 'pipe' : b.road(i, side ? ['pipe', 'zigzag'] : ['waterfall', 'zigzag', 'pegs', 'pipe']));
      b.open(1.5 + i * (0.8 + b.rng() * 1.5), id);
    });
    return 20;
  },
  split(b) {
    const n = b.rng() < 0.5 ? 2 : 3;
    const xs = n === 2 ? [290, 790] : [200, 540, 880];
    const offsets = n === 2 ? [-150, 150] : [-200, 0, 200];
    const big = b.cave('BIG', 540, 520, shapeOf(one(b.rng, ['circle', 'octagon'] as const), 390, b.rng), {
      valves: offsets.map((x, i) => ({ id: `v${i + 1}`, x, width: 56 })),
    });
    xs.forEach((x, i) => {
      const id = `T${i + 1}`;
      b.cave(id, x, 1560, b.targetShape(n === 2 ? 220 : 175));
      b.targets.push(id);
      b.paintedFlow('BIG', id, n === 3 && i === 1 ? b.road(i, ['waterfall', 'pegs', 'zigzag']) : 'pipe', { valve: `v${i + 1}` });
    });
    b.marbles(big, Math.min(b.room(), 0.55 * area(big) / PX_PER_MARBLE), ['#e9edf5', '#c9d0de']);
    b.open(1, 'BIG');
    return 18;
  },
  chain(b) {
    const a = b.cave('A', 360, 380, b.holderShape(210), { valves: [{ x: 30, width: 54 }] });
    const mid = b.cave('B', 720, 930, b.holderShape(175), { valves: [{ width: 54 }] });
    b.cave('C', 430, 1520, b.targetShape(270));
    b.targets.push('C');
    b.marbles(a, Math.min(b.room(), 0.85 * area(mid) / PX_PER_MARBLE, 0.55 * area(a) / PX_PER_MARBLE));
    b.flow('A', 'B', b.road(0, ['pipe', 'zigzag']) === 'zigzag' ? 'zigzag' : 'pipe');
    b.paintedFlow('B', 'C', b.road(1, ['pipe', 'zigzag']) === 'zigzag' ? 'zigzag' : 'pipe');
    b.open(1, 'A');
    b.open(6, 'B');
    return 20;
  },
  tiers(b) {
    const top = b.cave('T', 540, 300, shapeOf('circle', 210, b.rng), { valves: [{ id: 'l', x: -40, width: 60 }, { id: 'r', x: 40, width: 60 }] });
    for (const [id, x] of [['L', 280], ['R', 800]] as const) {
      b.cave(id, x, 860, shapeOf(one(b.rng, ['hexagon', 'circle', 'octagon'] as const), 150, b.rng), { valves: [{ id: 'l', x: -55, width: 46 }, { id: 'r', x: 55, width: 46 }] });
      b.flow('T', id, 'pipe', { valve: id === 'L' ? 'l' : 'r' });
    }
    for (let i = 0; i < 4; i++) {
      const id = `D${i + 1}`;
      b.cave(id, 135 + 270 * i, 1560, b.targetShape(118));
      b.targets.push(id);
      b.paintedFlow(i < 2 ? 'L' : 'R', id, 'pipe', { valve: i % 2 ? 'r' : 'l' });
    }
    b.marbles(top, Math.min(b.room(), 0.55 * area(top) / PX_PER_MARBLE));
    b.open(1, 'T');
    b.open(5, 'L');
    b.open(5, 'R');
    return 20;
  },
  race(b) {
    const order = shuffle(b.rng, TEAMS.map((_, k) => k));
    const teams = order.map((k) => TEAMS[k]);
    b.teams = order.slice(0, 3);
    const roads = shuffle(b.rng, ['waterfall', 'zigzag', 'pegs', 'pipe'] as FlowKind[]);
    [180, 540, 900].forEach((x, i) => {
      const id = String.fromCharCode(65 + i);
      const src = b.cave(id, x, 330, shapeOf('hexagon', 140, b.rng), { valves: [{ width: 50 }] });
      b.cave(`${id}2`, x, 1590, b.targetShape(150));
      b.targets.push(`${id}2`);
      b.marbles(src, Math.min(0.55 * area(src) / PX_PER_MARBLE, b.room([`${id}2`])), teams[i]);
      const kind = b.r.road === 'mixed' ? roads[i] : (b.r.road as FlowKind);
      const extra: Partial<Flow> = kind === 'pipe' ? { via: [[x + 80, 700], [x - 80, 1000], [x + 80, 1300]] } : {};
      b.flow(id, `${id}2`, kind, extra);
      b.open(1, id);
    });
    return 18;
  },
};

// ---------------------------------------------------------------- remix

export const ASPECTS = ['colors', 'paint', 'shapes', 'roads', 'effects', 'ending', 'style'] as const;
export type Aspect = (typeof ASPECTS)[number];

/**
 * A new take on an existing map: same caves in the same places, with the aspects not in `keep` re-rolled from
 * the seed. "shapes" only changes caves that receive marbles and have no valves, so every valve keeps its floor;
 * "roads" only swaps pipes, zigzags, waterfalls and pin boards without fixed waypoints.
 */
export function remix(source: MapDoc, seed: number, keep: Aspect[] = [], opts: Options = {}): MapDoc {
  const map = structuredClone(source);
  const rng = createRng(seed * 31 + 7);
  const change = (a: Aspect) => !keep.includes(a);
  const palettes = Object.keys(PALETTES);
  const recipe = pickRecipe(seed, {}, opts);

  if (change('colors')) {
    map.frame.background = recipe.background;
    const teams = shuffle(rng, TEAMS);
    map.caves.forEach((c, i) => {
      if (!c.marbles || c.marbles.actors) return;
      const team = c.marbles.colors.length <= 2;
      c.marbles.colors = team ? teams[i % teams.length] : PALETTES[one(rng, palettes)];
    });
  }
  if (change('paint')) {
    const painted = map.caves.filter((c) => c.paint);
    for (const c of painted) {
      const flip = c.paint!.flip;
      c.paint = paintFor(rng, opts, recipe.paint, recipe.palette, painted.length > 1);
      if (flip) c.paint.flip = { ...paintFor(rng, opts, 'rainbow', one(rng, palettes), painted.length > 1), t: flip.t };
    }
  }
  if (change('shapes')) {
    const fed = new Set((map.flows ?? []).map((f) => f.to));
    for (const c of map.caves) {
      if (c.valves?.length || !fed.has(c.id) || c.dividers) continue;
      const size = c.shape.radius;
      c.shape = shapeOf(one(rng, SHAPES), size, rng);
      // Keep the same room for marbles: shapes that fill less of their circle get a bit larger.
      const scale = Math.sqrt(area({ ...c, shape: shapeOf('circle', size, rng) }) * 0.55 / area(c));
      if (scale > 1) c.shape.radius = Math.round(c.shape.radius * Math.min(1.25, scale));
      // A landing spot picked for the old shape means nothing for the new one.
      for (const f of map.flows ?? []) if (f.to === c.id) delete f.at;
      pourAtTop(c, map.caves, map.flows ?? []);
    }
  }
  if (change('roads')) {
    for (const f of map.flows ?? []) {
      if (f.via || !['pipe', 'zigzag', 'waterfall', 'pegs'].includes(f.kind)) continue;
      // Waterfalls and pin boards drop almost straight down; a source standing off to the side needs a pipe or zigzag.
      const from = map.caves.find((c) => c.id === f.from)!;
      const to = map.caves.find((c) => c.id === f.to)!;
      const valve = from.valves?.find((v, i) => valveId(v, i) === (f.valve ?? valveId(from.valves![0], 0)));
      const straight = Math.abs(from.x + (valve?.x ?? 0) - to.x - (f.at ?? 0)) < 120;
      f.kind = one(rng, (straight ? ['pipe', 'zigzag', 'waterfall', 'pegs'] : ['pipe', 'zigzag']) as FlowKind[]);
      delete f.turns;
      delete f.swing;
      delete f.spread;
      if (f.kind === 'zigzag') f.turns = 2 + Math.floor(rng() * 3);
    }
  }
  if (change('effects')) {
    const effects = recipe.effects;
    if (effects.length) map.effects = Object.fromEntries(effects.map((e) => [e, true]));
    else delete map.effects;
  }
  if (change('ending')) {
    const t = map.ending?.t ?? map.camera?.zoom?.t ?? map.caves.find((c) => c.paint?.flip)?.paint?.flip?.t ?? (map.duration ?? 30) - 2;
    delete map.ending;
    if (map.camera?.zoom) delete map.camera.zoom;
    for (const c of map.caves) if (c.paint) delete c.paint.flip;
    const painted = map.caves.filter((c) => c.paint);
    const ending = recipe.ending === 'flip' && !painted.length ? 'zoom' : recipe.ending;
    const target = painted[0] ?? map.caves[map.caves.length - 1];
    if (ending === 'zoom') map.camera = { ...map.camera, zoom: { cave: target.id, t, scale: 1.6 } };
    if (ending === 'flip') for (const c of painted) c.paint!.flip = { mode: 'rainbow', direction: rng() < 0.5 ? 'x' : 'y', t };
    if (ending === 'break' || ending === 'freeze') map.ending = { kind: ending, t };
    if (ending !== 'none') map.duration = Math.max(map.duration ?? 30, Math.ceil(t + (ending === 'zoom' ? 4 : 5)));
  }
  if (change('style')) {
    delete map.theme;
    delete map.look;
    delete map.sound;
    if (recipe.theme !== 'none') map.theme = recipe.theme;
    else if (recipe.skin !== 'flat') map.look = { marble: recipe.skin };
    if (recipe.theme === 'none' && recipe.sound !== 'tick') map.sound = recipe.sound;
  }
  map.seed = seed;
  map.name = `${source.name} (remix ${seed})`;
  return map;
}

// ---------------------------------------------------------------- helpers

function paintFor(rng: Rng, opts: Options, mode: string, palette: string, shared: boolean): Paint {
  const p: Paint = { mode: mode as PaintMode };
  if (mode === 'image') {
    p.image = one(rng, opts.images!);
    p.background = '#e9edf5';
  } else if (mode !== 'rainbow') p.palette = palette;
  if (mode === 'gradient' || mode === 'stripes' || mode === 'rainbow') p.direction = rng() < 0.5 ? 'x' : 'y';
  if (mode === 'stripes') p.bands = 5 + Math.floor(rng() * 6);
  if (mode === 'checker') p.cell = 40 + Math.floor(rng() * 4) * 8;
  if (shared && mode !== 'depth') p.fit = 'shared';
  return p;
}

// Same key order as hand-written maps, so generated files read like the rest.
function reorder(map: MapDoc): MapDoc {
  const { caves, flows, events, ...head } = map;
  return { ...head, caves, flows, events };
}

function shapeOf(name: (typeof SHAPES)[number], size: number, rng: Rng): Shape {
  const r = Math.round(size);
  switch (name) {
    case 'circle': return { kind: 'circle', radius: r };
    case 'hexagon': return { kind: 'polygon', sides: 6, radius: r };
    case 'octagon': return { kind: 'polygon', sides: 8, radius: r, rotation: 22.5 };
    case 'pentagon': return { kind: 'polygon', sides: 5, radius: r };
    case 'square': return { kind: 'polygon', sides: 4, radius: Math.round(r * 0.95), rotation: rng() < 0.5 ? 0 : 45 };
    case 'star': return { kind: 'star', points: rng() < 0.6 ? 5 : 6, radius: Math.round(r * 1.12), inner: 0.6 };
    case 'heart': return { kind: 'heart', radius: r };
    case 'drop': return { kind: 'drop', radius: r };
    case 'moon': return { kind: 'moon', radius: Math.round(r * 1.1) };
    case 'rounded': return { kind: 'rounded', radius: r, aspect: 0.75, corner: 0.25 };
  }
}

function area(cave: Cave): number {
  const p = outline(cave);
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function one<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Half-width (px) of the foot of a pin board feeding a picture cave, and roughly that of a waterfall. */
const NARROW_FOOT = 60;
const WATERFALL_FOOT = 50;
/** Steps tried when turning a picture cave so it can fill edge to edge. */
const TURNS = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 105, -105, 120, -120, 135, -135, 150, -150, 165, -165, 180];

// Marbles poured in at one spot only go down and sideways: a part of the picture cave higher than the inlet (the far
// lobe of an upright heart) stays empty. Turn the cave as little as possible so that it can fill, and let a pipe or a
// narrow-footed pin board land on its highest point. Waterfalls drop straight down, so only the cave turns for those.
function pourAtTop(cave: Cave, caves: Cave[], flows: Flow[]): void {
  const into = flows.filter((f) => f.to === cave.id);
  if (!into.length || cave.dividers || into.some((f) => f.kind === 'conveyor' || f.kind === 'portal' || f.at !== undefined)) return;
  const flow = into[0];
  // Several flows into one cave spread across its top (see targetX in layout.ts); they keep their spots.
  const steer = into.length === 1 && (flow.kind === 'pipe' || flow.kind === 'zigzag' || flow.kind === 'pegs');
  // A wide pin board foot would swallow the top of the picture cave, lobes and all.
  if (steer && flow.kind === 'pegs') flow.spread = NARROW_FOOT;
  const src = caves.find((c) => c.id === flow.from)!;
  // Where marbles come down on the cave: one spot for a pipe, a foot's width for a waterfall
  // (see layout.ts for the same sums).
  const foot = (x: number) => Array.from({ length: 9 }, (_, k) => x - WATERFALL_FOOT + (WATERFALL_FOOT * k) / 4);
  const landing = (c: Cave): number[] => {
    if (steer) return [topPoint(c).x];
    const xs = outline(c).map((p) => p.x);
    const half = (Math.max(...xs) - Math.min(...xs)) / 2;
    if (into.length > 1) return into.flatMap((_, k) => foot(c.x - half * 0.35 + (half * 0.7 * k) / (into.length - 1)));
    return foot(Math.max(c.x - half * 0.5, Math.min(c.x + half * 0.5, src.x)));
  };
  const base = cave.shape.kind === 'circle' ? null : cave.shape.rotation ?? 0;
  const tries = (base === null ? [0] : TURNS).map((d) => {
    const c = base === null ? cave : { ...cave, shape: { ...cave.shape, rotation: base + d } as Shape };
    const xs = landing(c);
    return { d, x: xs[0], reach: reachable(c, xs) };
  });
  const best = Math.max(...tries.map((t) => t.reach));
  // TURNS runs from the smallest turn up, so the first one about as good as the best wins.
  const pick = tries.find((t) => t.reach >= best - 0.01)!;
  if (base !== null && pick.d) (cave.shape as { rotation?: number }).rotation = (((base + pick.d) % 360) + 360) % 360;
  if (steer) flow.at = Math.round(pick.x - cave.x);
}
