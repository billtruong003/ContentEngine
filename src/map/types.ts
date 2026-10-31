export type Shape =
  | { kind: 'polygon'; sides: number; radius: number; rotation?: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'star'; points: number; radius: number; inner?: number; rotation?: number }
  | { kind: 'heart' | 'drop' | 'moon'; radius: number; rotation?: number }
  /** Rectangle with rounded corners: `radius` is half the width, `aspect` height ÷ width, `corner` 0–0.5 of the shorter side. */
  | { kind: 'rounded'; radius: number; aspect?: number; corner?: number; rotation?: number }
  /** Any outline drawn in Figma or Illustrator: the first closed shape of an SVG path, scaled to fit `radius`. */
  | { kind: 'path'; d: string; radius: number; rotation?: number };

export type MarbleShape = 'square' | 'triangle' | 'star' | 'heart' | 'diamond';
export const MARBLE_SHAPES: MarbleShape[] = ['square', 'triangle', 'star', 'heart', 'diamond'];

export const SHAPE_KINDS: Shape['kind'][] = ['circle', 'polygon', 'star', 'heart', 'drop', 'moon', 'rounded', 'path'];

/** A gate on the cave floor. `x` is the offset from the cave centre. */
export interface Valve {
  id?: string;
  x?: number;
  width: number;
}

export interface Cave {
  id: string;
  x: number;
  y: number;
  shape: Shape;
  valves?: Valve[];
  /** Floor slope in degrees that steers marbles to the valves. Defaults to 40 when the cave has valves; false keeps the plain floor. */
  funnel?: number | false;
  /** `paint`: the marbles start already showing this picture, each by the spot it starts on. */
  marbles?: { count: number; colors: string[]; actors?: Actors; paint?: Paint };
  /** Upright walls that split the cave into `count` bays, `height` (0–1) of the cave tall, rising from the floor. */
  dividers?: { count: number; height?: number; thickness?: number };
  /** The picture marbles form once they settle in this cave. */
  paint?: Paint;
}

/** Marbles drawn as characters from a pack in public/packs/<pack>/. Physics stays a circle of marbleRadius. */
export interface Actors {
  pack: string;
  /** Character ids to pick from (seeded, evenly). Defaults to every character in the pack. */
  characters?: string[];
  /** Keep characters upright instead of rolling with the marble. */
  upright?: boolean;
  /** Drawn size relative to the physics circle (1 = same diameter). */
  scale?: number;
}

export type PaintMode = 'image' | 'rainbow' | 'gradient' | 'stripes' | 'checker' | 'depth';

export interface Paint {
  /**
   * "image": colours come from `image`. "rainbow": hue runs across the pile. "gradient": blends `colors` across the pile.
   * "stripes": bands of `colors`. "checker": squares of `colors`. "depth": dark at the bottom, light at the top.
   */
  mode: PaintMode;
  /** File under public/targets/, or a full URL. */
  image?: string;
  /**
   * How the picture sits: "contain" shows all of it over the settled pile, "cover" fills the pile.
   * "shared" spreads one picture over every cave with the same paint, each cave showing its own piece
   * (works for every mode, e.g. one rainbow across a row of caves).
   */
  fit?: 'contain' | 'cover' | 'shared';
  /** Colour for marbles that land on transparent pixels. */
  background?: string;
  /** Colours for gradient, stripes, checker and depth. Defaults to `palette`. */
  colors?: string[];
  /** A ready-made colour set (see PALETTES), used when `colors` is not given. */
  palette?: string;
  /** "x" runs left to right, "y" top to bottom. Gradient and rainbow default to x, stripes to y. */
  direction?: 'x' | 'y';
  /** Stripes: how many bands. */
  bands?: number;
  /** Checker: square size in px. */
  cell?: number;
  /** Colour flip ending: from second `t` every marble in the cave switches to this second paint, top to bottom. */
  flip?: Paint & { t: number };
}

export const PAINT_MODES: PaintMode[] = ['image', 'rainbow', 'gradient', 'stripes', 'checker', 'depth'];

export const PALETTES: Record<string, string[]> = {
  pastel: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'],
  neon: ['#ff00a0', '#ffe600', '#00ff9c', '#00c8ff', '#b400ff'],
  earth: ['#5b3a29', '#8c5a3c', '#c49a6c', '#a3b18a', '#588157'],
  ocean: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'],
  candy: ['#ff5d8f', '#ffffff', '#5dd9ff'],
  fire: ['#370617', '#9d0208', '#e85d04', '#faa307', '#ffe169'],
};

export type FlowKind = 'pipe' | 'zigzag' | 'waterfall' | 'pegs' | 'conveyor' | 'wheel' | 'portal';

export interface Flow {
  from: string;
  /** Valve id on the source cave. Defaults to its first valve. */
  valve?: string;
  to: string;
  kind: FlowKind;
  /** Where the flow lands on the target, as an offset from the target centre. */
  at?: number;
  /** Extra points a pipe must pass through, in frame pixels. */
  via?: [number, number][];
  /** Zigzag: how many swings and how far each swings sideways (px). */
  turns?: number;
  swing?: number;
  /** Wheel: radius (px), number of arms, turning speed in degrees per second. */
  radius?: number;
  arms?: number;
  /** Pegs: half-width of the pin board at the bottom (px). */
  spread?: number;
  /** Conveyor: belt speed in px/s, paddle height and gap between paddles in px. */
  speed?: number;
  paddle?: number;
  spacing?: number;
  /** A paint machine on this flow: marbles passing it switch to the colour of the spot where they will end up. */
  paint?: { at?: number };
  /** A swap machine: marbles passing it become `character` ("pack/id", or just "id" from the same pack). */
  swap?: { at?: number; character: string };
  /** A size machine: marbles passing it grow or shrink to `scale` times the normal size (physics and picture). */
  size?: { at?: number; scale: number };
  /** A shape machine: marbles passing it are drawn as this shape from then on (physics stays round). */
  shape?: { at?: number; shape: MarbleShape };
  /** A mixer: marbles passing it take one blended colour, `color` or the average of everything that goes through. */
  mix?: { at?: number; color?: string };
  /** A doubler: every marble passing it gets a twin right behind it. */
  double?: { at?: number };
  /** Portal only: take just marbles whose starting colour is in this list. Several portals on one valve make a sorter. */
  only?: string[];
}

export interface MapEvent {
  t: number;
  /** "valve.open" / "valve.close" act on `cave`; "gravity" turns gravity to `angle` and scales it by `strength`. */
  do: 'valve.open' | 'valve.close' | 'gravity';
  cave?: string;
  /** Defaults to every valve on the cave. */
  valve?: string;
  /** Gravity direction in degrees: 0 is down, 90 pulls to the right, -90 to the left, 180 up. */
  angle?: number;
  /** Gravity multiplier, 1 = the map's normal gravity. */
  strength?: number;
}

export const EVENT_KINDS: MapEvent['do'][] = ['valve.open', 'valve.close', 'gravity'];

/** Picture-only extras (they never change the physics). */
export interface Effects {
  /** Glowing tails behind fast marbles. */
  tails?: boolean;
  /** Marbles leave faint colour on the background where they roll; by the end the paths form a painting. */
  stains?: boolean;
  /** Sparks where marbles cross a paint machine. */
  sparks?: boolean;
  /** Screen shake when a big wave of marbles lands; a number scales it (1 = normal). */
  shake?: boolean | number;
}

/** How a plain marble is shaded: "flat" is the old drawing, the rest look like real 3D marbles. */
export type MarbleSkin = 'flat' | 'glass' | 'metal' | 'gem' | 'glow';
export const MARBLE_SKINS: MarbleSkin[] = ['flat', 'glass', 'metal', 'gem', 'glow'];

/** Texture drawn on the carved ground. */
export type GroundPattern = 'plain' | 'paper' | 'wood' | 'chalk' | 'dots' | 'plates';
export const GROUND_PATTERNS: GroundPattern[] = ['plain', 'paper', 'wood', 'chalk', 'dots', 'plates'];

/** Picture-only styling. Fields set here win over the theme. */
export interface Look {
  marble?: MarbleSkin;
  /** Soft shadow under every marble. */
  shadow?: boolean;
  pattern?: GroundPattern;
  /** Two colours: the background behind the caves runs from the first (top) to the second (bottom). */
  backdrop?: string[];
}

/** Text over the video. Everything except "label" and "counter" stays put on screen while the camera moves. */
export interface Caption {
  /**
   * "title": big text, fades out. "countdown": seconds left until `until`. "counter": marbles inside `cave` right now.
   * "label": text above `cave` (team names). "score": live table of `caves`, most marbles first.
   */
  kind: 'title' | 'countdown' | 'counter' | 'label' | 'score';
  /** Title and label text. Counter and countdown: `{n}` is replaced by the number, e.g. "{n} bi". */
  text?: string;
  cave?: string;
  /** Score: the caves to compare, and the name shown for each (defaults to the cave id). */
  caves?: string[];
  names?: string[];
  /** Seconds it shows from and until. Title defaults to 0 → 3.5, countdown counts to the ending (or the end of the video). */
  t?: number;
  until?: number;
  /** Where on screen: title and score default to the top, countdown to the bottom. */
  at?: 'top' | 'middle' | 'bottom';
  /** Letter height in px of a 1080-wide video. */
  size?: number;
  color?: string;
}

export const CAPTION_KINDS: Caption['kind'][] = ['title', 'countdown', 'counter', 'label', 'score'];

/** Sound each marble hit makes in the exported video. */
export type SoundSet = 'tick' | 'glass' | 'wood' | 'metal' | 'coin' | 'pop';
export const SOUND_SETS: SoundSet[] = ['tick', 'glass', 'wood', 'metal', 'coin', 'pop'];

export interface Camera {
  /** Video size. The frame may be larger (a map taller than the screen) and the camera moves over it. Defaults to the frame size. */
  width?: number;
  height?: number;
  /** Follow the moving marbles. */
  follow?: boolean;
  /** Zoom onto a cave from second `t`, e.g. to end on the finished picture. `scale` 2 shows half the width. */
  zoom?: { cave: string; t: number; scale?: number };
}

export interface Rock {
  t: number;
  angle?: number;
  swings?: number;
  period?: number;
}

export const ROCK_DEFAULTS = { angle: 40, swings: 4, period: 3 };

export const rockEnd = (r: Rock): number => r.t + (r.swings ?? ROCK_DEFAULTS.swings) * (r.period ?? ROCK_DEFAULTS.period);

/** How far the whole map is turned at second `t`, in degrees clockwise: its spin plus any rocking. */
export function mapTurn(map: Pick<MapDoc, 'spin' | 'rock'>, t: number): number {
  let deg = 0;
  const sp = map.spin;
  if (sp && t > sp.t) deg = (Math.min(t, sp.until ?? Infinity) - sp.t) * sp.speed;
  const r = map.rock;
  if (r && t > r.t && t < rockEnd(r)) {
    const period = r.period ?? ROCK_DEFAULTS.period;
    // Each swing a little smaller, ending level.
    const fade = 1 - (t - r.t) / (rockEnd(r) - r.t);
    deg += (r.angle ?? ROCK_DEFAULTS.angle) * fade * Math.sin((2 * Math.PI * (t - r.t)) / period);
  }
  return deg;
}

export interface Physics {
  gravity: number;
  marbleRadius: number;
  friction: number;
  restitution: number;
  /** Air drag: 0 = none. Higher values cap how fast marbles fall (top speed ≈ gravity ÷ drag px/s), so they drift down slower. */
  drag: number;
  /**
   * How hard marbles push back when pressed together, in Hz (Rapier's default is 30). At this scale deep piles let
   * marbles sink halfway into each other; about 120 keeps them apart, so a pile looks as full as it was packed.
   */
  stiffness?: number;
}

export interface MapDoc {
  schemaVersion: 1;
  name: string;
  seed: number;
  /** Seconds of video. Defaults to DEFAULT_DURATION. */
  duration?: number;
  frame: { width: number; height: number; background: string };
  physics?: Partial<Physics>;
  /** Background music for exported videos: a file in public/music/, looped to the video length. */
  music?: { file: string; volume?: number };
  /** Colours of the carved ground: fill, and the rim drawn along every outline. */
  ground?: { color?: string; rim?: string; rimWidth?: number };
  /** What the video shows. Without it the video is the whole frame, standing still. */
  camera?: Camera;
  effects?: Effects;
  /** A ready-made style (see THEMES in theme.ts): background, ground colours and texture, marble skin. */
  theme?: string;
  look?: Look;
  captions?: Caption[];
  sound?: SoundSet;
  /** How the video ends: "break" shatters the ground and marbles fly out; "freeze" ices the marbles into one block that tips over and falls. */
  ending?: { kind: 'break' | 'freeze'; t: number };
  /** The whole map turns from second `t` at `speed` degrees per second (positive = clockwise) until `until`. */
  spin?: { t: number; speed: number; until?: number };
  /**
   * From second `t` the whole map rocks side to side `swings` times, `angle` degrees each way at first and less
   * each swing, `period` seconds per swing. The pile sloshes into the far corners, so the picture caves fill edge to edge.
   */
  rock?: Rock;
  caves: Cave[];
  flows?: Flow[];
  events: MapEvent[];
}

export const DEFAULT_PHYSICS: Physics = {
  gravity: 3000,
  marbleRadius: 4,
  friction: 0.2,
  restitution: 0.1,
  drag: 0,
};

export const DEFAULT_DURATION = 30;
export const FLOW_KINDS: FlowKind[] = ['pipe', 'zigzag', 'waterfall', 'pegs', 'conveyor', 'wheel', 'portal'];

export const valveId = (v: Valve, i: number): string => v.id ?? `v${i}`;
