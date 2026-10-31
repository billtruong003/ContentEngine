import { buildLayout, type Layout } from './layout.ts';
import { svgOutline } from './svg.ts';
import { THEMES } from './theme.ts';
import {
  CAPTION_KINDS, GROUND_PATTERNS, MARBLE_SHAPES, MARBLE_SKINS, SHAPE_KINDS, EVENT_KINDS, FLOW_KINDS, PAINT_MODES, PALETTES, SOUND_SETS, valveId,
  type Cave, type MapDoc,
} from './types.ts';

export interface Validated {
  map: MapDoc | null;
  errors: string[];
  warnings: string[];
  /** Present once the map is structurally sound, even if the layout itself has errors. */
  layout?: Layout;
}

export function validateMap(raw: unknown, opts?: { walls?: boolean }): Validated {
  const errors: string[] = [];
  const m = raw as MapDoc;
  const need = (ok: unknown, msg: string) => { if (!ok) errors.push(msg); };
  const done = (): Validated => ({ map: null, errors, warnings: [] });

  need(m && typeof m === 'object', 'map phải là một object JSON');
  if (errors.length) return done();

  need(m.schemaVersion === 1, `schemaVersion: cần 1, đang là ${m.schemaVersion}`);
  need(Number.isInteger(m.seed), 'seed: phải là số nguyên');
  need(m.duration === undefined || (m.duration > 0 && m.duration <= 600), 'duration: từ 0 tới 600 giây');
  need(m.frame?.width > 0 && m.frame?.height > 0, 'frame: cần width và height > 0');
  // Positions are recorded in 1/8 px as 16-bit numbers.
  need(!(m.frame?.width > 4000 || m.frame?.height > 4000), 'frame: mỗi chiều tối đa 4000 px. Map dài hơn thì dùng camera đi theo bi trong khung 4000 px');
  if (m.ending) need((m.ending.kind === 'break' || m.ending.kind === 'freeze') && m.ending.t >= 0, 'ending: cần kind "break" hoặc "freeze" và t >= 0');
  if (m.spin) need(m.spin.t >= 0 && Number.isFinite(m.spin.speed) && (m.spin.until === undefined || m.spin.until > m.spin.t), 'spin: cần t >= 0, speed (độ/giây), until > t');
  if (m.rock) {
    const r = m.rock;
    need(r.t >= 0, 'rock.t: giây bắt đầu lắc, phải >= 0');
    need(r.angle === undefined || (r.angle > 0 && r.angle <= 60), 'rock.angle: từ 1 tới 60 độ');
    need(r.swings === undefined || (Number.isInteger(r.swings) && r.swings >= 1 && r.swings <= 10), 'rock.swings: số lần lắc, từ 1 tới 10');
    need(r.period === undefined || (r.period >= 0.5 && r.period <= 10), 'rock.period: giây mỗi lần lắc, từ 0.5 tới 10');
  }
  if (m.theme !== undefined) need(THEMES[m.theme], `theme: "${m.theme}" không có. Có: ${Object.keys(THEMES).join(', ')}`);
  if (m.sound !== undefined) need(SOUND_SETS.includes(m.sound), `sound: "${m.sound}" không có. Có: ${SOUND_SETS.join(', ')}`);
  if (m.look) {
    if (m.look.marble !== undefined) need(MARBLE_SKINS.includes(m.look.marble), `look.marble: "${m.look.marble}" không có. Có: ${MARBLE_SKINS.join(', ')}`);
    if (m.look.pattern !== undefined) need(GROUND_PATTERNS.includes(m.look.pattern), `look.pattern: "${m.look.pattern}" không có. Có: ${GROUND_PATTERNS.join(', ')}`);
    if (m.look.backdrop !== undefined) need(Array.isArray(m.look.backdrop) && m.look.backdrop.length >= 1 && m.look.backdrop.every((c) => /^#[0-9a-f]{6}$/i.test(c)), 'look.backdrop: 1 hoặc 2 màu dạng #rrggbb');
  }
  if (m.physics) {
    const p = m.physics;
    need(p.gravity === undefined || (p.gravity > 0 && p.gravity <= 20000), 'physics.gravity: từ 1 tới 20000');
    need(p.drag === undefined || (p.drag >= 0 && p.drag <= 20), 'physics.drag: từ 0 tới 20 (0 là không cản)');
    need(p.stiffness === undefined || (p.stiffness >= 10 && p.stiffness <= 1000), 'physics.stiffness: từ 10 tới 1000 Hz');
  }
  const cam = m.camera;
  if (cam) {
    need(cam.width === undefined || (cam.width > 0 && cam.width <= m.frame?.width), 'camera.width: từ 1 tới frame.width');
    need(cam.height === undefined || (cam.height > 0 && cam.height <= m.frame?.height), 'camera.height: từ 1 tới frame.height');
    if (cam.zoom) {
      need(Array.isArray(m.caves) && m.caves.some((c) => c.id === cam.zoom!.cave), `camera.zoom.cave: không có hang "${cam.zoom.cave}"`);
      need(cam.zoom.t >= 0, 'camera.zoom.t: phải >= 0');
      need(cam.zoom.scale === undefined || (cam.zoom.scale >= 1 && cam.zoom.scale <= 6), 'camera.zoom.scale: từ 1 tới 6');
    }
  }
  need(Array.isArray(m.caves) && m.caves.length > 0, 'caves: cần ít nhất 1 hang');
  need(m.flows === undefined || Array.isArray(m.flows), 'flows: phải là mảng');
  need(Array.isArray(m.events), 'events: phải là mảng (có thể rỗng)');
  if (errors.length) return done();

  const ids = new Set<string>();
  m.caves.forEach((c, i) => {
    const at = `caves[${i}]${c.id ? ` (${c.id})` : ''}`;
    need(typeof c.id === 'string' && c.id, `${at}: thiếu id`);
    need(!ids.has(c.id), `${at}: trùng id "${c.id}"`);
    ids.add(c.id);
    need(Number.isFinite(c.x) && Number.isFinite(c.y), `${at}: cần x, y`);
    const s = c.shape;
    need(SHAPE_KINDS.includes(s?.kind), `${at}.shape.kind: "${s?.kind}" không có. Có: ${SHAPE_KINDS.join(', ')}`);
    if (s?.kind === 'path') {
      try { svgOutline(s.d); } catch (e) { need(false, `${at}.shape.d: ${(e as Error).message}`); }
    }
    need(s?.radius > 0, `${at}.shape.radius: phải > 0`);
    if (s?.kind === 'polygon') need(Number.isInteger(s.sides) && s.sides >= 3, `${at}.shape.sides: số nguyên >= 3`);
    if (s?.kind === 'star') need(Number.isInteger(s.points) && s.points >= 3, `${at}.shape.points: số nguyên >= 3`);
    (c.valves ?? []).forEach((v, k) => need(v.width > 0, `${at}.valves[${k}].width: phải > 0`));
    if (c.dividers) need(Number.isInteger(c.dividers.count) && c.dividers.count >= 2 && c.dividers.count <= 20, `${at}.dividers.count: số ngăn, từ 2 tới 20`);
    if (c.paint) {
      need(PAINT_MODES.includes(c.paint.mode), `${at}.paint.mode: "${c.paint.mode}" không có. Có: ${PAINT_MODES.join(', ')}`);
      if (c.paint.mode === 'image') need(typeof c.paint.image === 'string' && c.paint.image, `${at}.paint.image: cần tên file ảnh trong public/targets/`);
      if (c.paint.palette) need(PALETTES[c.paint.palette], `${at}.paint.palette: "${c.paint.palette}" không có. Có: ${Object.keys(PALETTES).join(', ')}`);
      if (c.paint.flip) {
        need(PAINT_MODES.includes(c.paint.flip.mode), `${at}.paint.flip.mode: "${c.paint.flip.mode}" không có. Có: ${PAINT_MODES.join(', ')}`);
        need(c.paint.flip.t >= 0, `${at}.paint.flip.t: giây lật màu, phải >= 0`);
        if (c.paint.flip.mode === 'image') need(typeof c.paint.flip.image === 'string' && c.paint.flip.image, `${at}.paint.flip.image: cần tên file ảnh`);
      }
      (c.paint.colors ?? []).forEach((col, k) => need(/^#[0-9a-f]{6}$/i.test(col), `${at}.paint.colors[${k}]: cần dạng #rrggbb`));
    }
    if (c.marbles) {
      need(Number.isInteger(c.marbles.count) && c.marbles.count >= 0, `${at}.marbles.count: số nguyên >= 0`);
      need(Array.isArray(c.marbles.colors) && c.marbles.colors.length > 0, `${at}.marbles.colors: cần ít nhất 1 màu`);
    }
  });

  const cave = (id: string) => m.caves.find((c) => c.id === id);
  const hasValve = (c: Cave, id: string) => (c.valves ?? []).some((v, k) => valveId(v, k) === id);

  (m.flows ?? []).forEach((f, i) => {
    const at = `flows[${i}]`;
    const src = cave(f.from);
    need(src, `${at}.from: không có hang "${f.from}"`);
    need(cave(f.to), `${at}.to: không có hang "${f.to}"`);
    need(f.from !== f.to, `${at}: hang không thể chảy vào chính nó`);
    need(FLOW_KINDS.includes(f.kind), `${at}.kind: "${f.kind}" không có. Có: ${FLOW_KINDS.join(', ')}`);
    if (src) need(src.valves?.length, `${at}: hang "${f.from}" chưa có van để chảy ra`);
    if (f.shape) need(MARBLE_SHAPES.includes(f.shape.shape), `${at}.shape.shape: "${f.shape.shape}" không có. Có: ${MARBLE_SHAPES.join(', ')}`);
    if (f.mix?.color) need(/^#[0-9a-f]{6}$/i.test(f.mix.color), `${at}.mix.color: cần dạng #rrggbb`);
    if (f.only) need(f.kind === 'portal' && Array.isArray(f.only) && f.only.length > 0, `${at}.only: chỉ dùng với "portal", cần ít nhất 1 màu`);
    if (f.size) need(f.size.scale >= 0.3 && f.size.scale <= 3, `${at}.size.scale: từ 0.3 tới 3`);
    if (src && f.valve) need(hasValve(src, f.valve), `${at}.valve: hang "${f.from}" không có van "${f.valve}"`);
  });

  m.events.forEach((e, i) => {
    const at = `events[${i}]`;
    need(e.t >= 0, `${at}.t: phải >= 0`);
    need(EVENT_KINDS.includes(e.do), `${at}.do: "${e.do}" không có. Có: ${EVENT_KINDS.join(', ')}`);
    if (e.do === 'gravity') {
      need(Number.isFinite(e.angle ?? 0) && (e.strength ?? 1) >= 0, `${at}: gravity cần angle (độ) và strength >= 0`);
      return;
    }
    const c = cave(e.cave ?? '');
    need(c, `${at}.cave: không có hang "${e.cave}"`);
    if (c) need(c.valves?.length, `${at}: hang "${e.cave}" không có van`);
    if (c && e.valve) need(hasValve(c, e.valve), `${at}.valve: hang "${e.cave}" không có van "${e.valve}"`);
  });
  need(m.captions === undefined || Array.isArray(m.captions), 'captions: phải là mảng');
  (m.captions ?? []).forEach((c, i) => {
    const at = `captions[${i}]`;
    need(CAPTION_KINDS.includes(c.kind), `${at}.kind: "${c.kind}" không có. Có: ${CAPTION_KINDS.join(', ')}`);
    if (c.kind === 'title' || c.kind === 'label') need(typeof c.text === 'string' && c.text, `${at}.text: cần chữ để hiện`);
    if (c.kind === 'counter' || c.kind === 'label') need(cave(c.cave ?? ''), `${at}.cave: không có hang "${c.cave}"`);
    if (c.kind === 'score') {
      need(Array.isArray(c.caves) && c.caves.length >= 2, `${at}.caves: bảng điểm cần ít nhất 2 hang`);
      for (const id of c.caves ?? []) need(cave(id), `${at}.caves: không có hang "${id}"`);
    }
    need(c.size === undefined || (c.size >= 8 && c.size <= 400), `${at}.size: từ 8 tới 400 px`);
    need(c.until === undefined || c.until > (c.t ?? 0), `${at}.until: phải sau t`);
    if (c.at !== undefined) need(['top', 'middle', 'bottom'].includes(c.at), `${at}.at: top, middle hoặc bottom`);
  });
  if (errors.length) return done();

  const layout = buildLayout(m, opts);
  return { map: layout.errors.length ? null : m, errors: layout.errors, warnings: layout.warnings, layout };
}
