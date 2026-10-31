// Every change the editor makes to a map goes through one of these commands, whether it comes from the mouse,
// the property panel or a script calling window.__editor.run(). They edit the map in place and throw a plain
// message when the request does not make sense, so the caller can show it or fix the call.
import type { MachineKind } from '../map/layout.ts';
import { valveId, type MarbleShape, type Cave, type Flow, type FlowKind, type MapDoc, type Shape } from '../map/types.ts';

export type Patch = { [key: string]: unknown };

export interface Commands {
  'map.update': Patch;
  'cave.add': { shape?: Shape; x: number; y: number; id?: string; marbles?: Cave['marbles'] };
  'cave.update': { id: string } & Patch;
  'cave.remove': { id: string };
  'cave.rename': { id: string; to: string };
  'valve.update': { cave: string; index: number } & Patch;
  'valve.remove': { cave: string; index: number };
  'flow.add': { from: string; to: string; kind?: FlowKind; valve?: string };
  'flow.update': { index: number } & Patch;
  'flow.remove': { index: number };
  'machine.set': { flow: number; kind: MachineKind; at?: number; character?: string; scale?: number; shape?: MarbleShape; color?: string };
  'machine.remove': { flow: number; kind: MachineKind };
  /** When the cave's valves open, in seconds. null removes the event so they stay shut. */
  'valve.openAt': { cave: string; t: number | null };
}

export type Command = { [K in keyof Commands]: { op: K } & Commands[K] }[keyof Commands];

export const SHAPES: Record<string, Shape> = {
  circle: { kind: 'circle', radius: 150 },
  triangle: { kind: 'polygon', sides: 3, radius: 170 },
  square: { kind: 'polygon', sides: 4, radius: 160 },
  pentagon: { kind: 'polygon', sides: 5, radius: 160 },
  hexagon: { kind: 'polygon', sides: 6, radius: 150 },
  octagon: { kind: 'polygon', sides: 8, radius: 150 },
  star: { kind: 'star', points: 5, radius: 180, inner: 0.6 },
  heart: { kind: 'heart', radius: 170 },
  drop: { kind: 'drop', radius: 170 },
  moon: { kind: 'moon', radius: 190 },
  rounded: { kind: 'rounded', radius: 170, aspect: 0.7, corner: 0.2 },
};

export function blankMap(): MapDoc {
  return {
    schemaVersion: 1,
    name: 'Map mới',
    seed: 1,
    duration: 20,
    frame: { width: 1080, height: 1920, background: '#10131a' },
    caves: [
      { id: 'A', x: 540, y: 520, shape: { kind: 'polygon', sides: 6, radius: 200 }, marbles: { count: 900, colors: ['#ff4d5e', '#ffd23f', '#3fa7ff'] } },
    ],
    flows: [],
    events: [],
  };
}

/** Applies one command and returns what it made (the new cave id, flow index...), if anything. */
export function apply(map: MapDoc, cmd: Command): unknown {
  map.flows ??= [];
  switch (cmd.op) {
    case 'map.update': {
      const { op: _, ...p } = cmd;
      merge(map, p);
      return;
    }
    case 'cave.add': {
      const id = cmd.id ?? nextId(map);
      if (caveOf(map, id, false)) throw new Error(`Đã có hang "${id}"`);
      const cave: Cave = { id, x: Math.round(cmd.x), y: Math.round(cmd.y), shape: structuredClone(cmd.shape ?? SHAPES.circle) };
      if (cmd.marbles) cave.marbles = structuredClone(cmd.marbles);
      map.caves.push(cave);
      return id;
    }
    case 'cave.update': {
      const { op: _, id, ...p } = cmd;
      merge(caveOf(map, id), p);
      return;
    }
    case 'cave.remove': {
      caveOf(map, cmd.id);
      map.caves = map.caves.filter((c) => c.id !== cmd.id);
      for (let i = map.flows.length - 1; i >= 0; i--) {
        const f = map.flows[i];
        if (f.from === cmd.id || f.to === cmd.id) apply(map, { op: 'flow.remove', index: i });
      }
      map.events = map.events.filter((e) => e.cave !== cmd.id);
      return;
    }
    case 'cave.rename': {
      const cave = caveOf(map, cmd.id);
      if (!cmd.to || /\s/.test(cmd.to)) throw new Error('Tên hang không được trống hoặc có dấu cách');
      if (cmd.to === cmd.id) return;
      if (caveOf(map, cmd.to, false)) throw new Error(`Đã có hang "${cmd.to}"`);
      cave.id = cmd.to;
      for (const f of map.flows) {
        if (f.from === cmd.id) f.from = cmd.to;
        if (f.to === cmd.id) f.to = cmd.to;
      }
      for (const e of map.events) if (e.cave === cmd.id) e.cave = cmd.to;
      return;
    }
    case 'valve.update': {
      const { op: _, cave, index, ...p } = cmd;
      const v = caveOf(map, cave).valves?.[index];
      if (!v) throw new Error(`Hang "${cave}" không có van số ${index}`);
      merge(v, p);
      return;
    }
    case 'valve.remove': {
      const cave = caveOf(map, cmd.cave);
      const v = cave.valves?.[cmd.index];
      if (!v) throw new Error(`Hang "${cmd.cave}" không có van số ${cmd.index}`);
      const id = valveId(v, cmd.index);
      for (let i = map.flows.length - 1; i >= 0; i--) {
        if (map.flows[i].from === cave.id && flowValve(map, map.flows[i]) === id) map.flows.splice(i, 1);
      }
      // Valves without an id are named by position, so give the others fixed ids before the list shifts.
      cave.valves!.forEach((w, k) => { if (k !== cmd.index && !w.id) w.id = valveId(w, k); });
      cave.valves!.splice(cmd.index, 1);
      if (!cave.valves!.length) {
        delete cave.valves;
        map.events = map.events.filter((e) => e.cave !== cave.id);
      }
      return;
    }
    case 'flow.add': {
      const src = caveOf(map, cmd.from);
      const tgt = caveOf(map, cmd.to);
      if (src === tgt) throw new Error('Hang không thể chảy vào chính nó');
      const valve = cmd.valve ?? freeValve(map, src) ?? addValve(map, src, tgt);
      const flow: Flow = { from: src.id, valve, to: tgt.id, kind: cmd.kind ?? guessKind(src, tgt) };
      map.flows.push(flow);
      if (!map.events.some((e) => e.cave === src.id && e.do === 'valve.open')) {
        map.events.push({ t: 1, do: 'valve.open', cave: src.id });
      }
      return map.flows.length - 1;
    }
    case 'flow.update': {
      const { op: _, index, ...p } = cmd;
      merge(flowOf(map, index), p);
      return;
    }
    case 'flow.remove': {
      const f = flowOf(map, cmd.index);
      map.flows.splice(cmd.index, 1);
      // A valve the flow used and nothing else uses goes too, so no dead valve is left behind.
      const src = caveOf(map, f.from, false);
      const id = flowValve(map, f);
      if (src && id && !map.flows.some((g) => g.from === src.id && flowValve(map, g) === id)) {
        const k = (src.valves ?? []).findIndex((v, i) => valveId(v, i) === id);
        if (k >= 0) apply(map, { op: 'valve.remove', cave: src.id, index: k });
      }
      return;
    }
    case 'machine.set': {
      const f = flowOf(map, cmd.flow);
      const at = cmd.at === undefined ? undefined : Math.round(Math.max(0.05, Math.min(0.95, cmd.at)) * 100) / 100;
      if (cmd.kind === 'paint') f.paint = { ...f.paint, ...(at !== undefined && { at }) };
      else if (cmd.kind === 'size') f.size = { scale: cmd.scale ?? f.size?.scale ?? 1.6, ...(f.size?.at !== undefined && { at: f.size.at }), ...(at !== undefined && { at }) };
      else if (cmd.kind === 'shape') f.shape = { shape: cmd.shape ?? f.shape?.shape ?? 'square', ...(f.shape?.at !== undefined && { at: f.shape.at }), ...(at !== undefined && { at }) };
      else if (cmd.kind === 'mix') f.mix = { ...f.mix, ...(cmd.color !== undefined && { color: cmd.color }), ...(at !== undefined && { at }) };
      else if (cmd.kind === 'double') f.double = { ...f.double, ...(at !== undefined && { at }) };
      else {
        const character = cmd.character ?? f.swap?.character;
        if (!character) throw new Error('Máy đổi nhân vật cần "character"');
        f.swap = { ...f.swap, character, ...(at !== undefined && { at }) };
      }
      return;
    }
    case 'machine.remove': {
      delete flowOf(map, cmd.flow)[cmd.kind];
      return;
    }
    case 'valve.openAt': {
      const cave = caveOf(map, cmd.cave);
      map.events = map.events.filter((e) => !(e.cave === cave.id && e.do === 'valve.open' && !e.valve));
      if (cmd.t !== null) map.events.push({ t: cmd.t, do: 'valve.open', cave: cave.id });
      map.events.sort((a, b) => a.t - b.t);
      return;
    }
  }
  throw new Error(`Không có lệnh "${(cmd as { op: string }).op}". Có: ${COMMAND_NAMES.join(', ')}`);
}

export const COMMAND_NAMES: (keyof Commands)[] = [
  'map.update', 'cave.add', 'cave.update', 'cave.remove', 'cave.rename', 'valve.update', 'valve.remove',
  'flow.add', 'flow.update', 'flow.remove', 'machine.set', 'machine.remove', 'valve.openAt',
];

/** The cave placed as this one's mirror image across the vertical centre line, if there is one. */
export function mirrorOf(map: MapDoc, cave: Cave): Cave | undefined {
  const mx = map.frame.width - cave.x;
  if (Math.abs(mx - cave.x) < 1) return;
  return map.caves.find((c) => c !== cave && Math.abs(c.x - mx) < 1 && Math.abs(c.y - cave.y) < 1 && c.shape.kind === cave.shape.kind && c.shape.radius === cave.shape.radius);
}

export function nextId(map: MapDoc): string {
  const used = new Set(map.caves.map((c) => c.id));
  for (let round = 0; ; round++) {
    for (let k = 0; k < 26; k++) {
      const id = String.fromCharCode(65 + k) + (round ? round : '');
      if (!used.has(id)) return id;
    }
  }
}

export function flowValve(map: MapDoc, f: Flow): string | undefined {
  const src = map.caves.find((c) => c.id === f.from);
  return f.valve ?? (src?.valves?.[0] ? valveId(src.valves[0], 0) : undefined);
}

// Target higher than the source needs a conveyor; one right below gets a waterfall; anything else a pipe.
function guessKind(src: Cave, tgt: Cave): FlowKind {
  if (tgt.y - tgt.shape.radius < src.y + src.shape.radius * 0.5) return 'conveyor';
  if (Math.abs(tgt.x - src.x) < tgt.shape.radius * 0.5) return 'waterfall';
  return 'pipe';
}

function freeValve(map: MapDoc, src: Cave): string | undefined {
  const used = new Set(map.flows!.filter((f) => f.from === src.id).map((f) => flowValve(map, f)));
  return (src.valves ?? []).map(valveId).find((id) => !used.has(id));
}

// A new valve on the floor, leaning towards the target and clear of the valves already there.
function addValve(map: MapDoc, src: Cave, tgt: Cave): string {
  const r = map.physics?.marbleRadius ?? 4;
  const width = Math.max(50, Math.round(r * 12));
  const reach = src.shape.radius * 0.45;
  const valves = (src.valves ??= []);
  let x = Math.round(Math.max(-reach, Math.min(reach, (tgt.x - src.x) * 0.3)));
  for (let tries = 0; tries < 8 && valves.some((v) => Math.abs((v.x ?? 0) - x) < width + 20); tries++) {
    x += (x >= 0 ? 1 : -1) * (width + 20);
  }
  const ids = new Set(valves.map(valveId));
  let n = valves.length;
  while (ids.has(`v${n}`)) n++;
  valves.push({ id: `v${n}`, ...(x && { x }), width });
  return `v${n}`;
}

function caveOf(map: MapDoc, id: string, must?: true): Cave;
function caveOf(map: MapDoc, id: string, must: false): Cave | undefined;
function caveOf(map: MapDoc, id: string, must = true): Cave | undefined {
  const cave = map.caves.find((c) => c.id === id);
  if (!cave && must) throw new Error(`Không có hang "${id}". Có: ${map.caves.map((c) => c.id).join(', ')}`);
  return cave;
}

function flowOf(map: MapDoc, index: number): Flow {
  const f = map.flows?.[index];
  if (!f) throw new Error(`Không có đường nối số ${index} (có ${map.flows?.length ?? 0})`);
  return f;
}

// Deep merge; null deletes a key, arrays are replaced whole.
function merge(target: object, patch: Patch): void {
  const t = target as Patch;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete t[k];
    else if (isPlain(v) && isPlain(t[k])) merge(t[k] as object, v);
    else t[k] = structuredClone(v);
  }
}

function isPlain(v: unknown): v is Patch {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
