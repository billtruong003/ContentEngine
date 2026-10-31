// The property panel on the right: whatever is selected, as plain form fields. Every field commits through a command.
import { THEMES } from '../map/theme.ts';
import {
  DEFAULT_DURATION, DEFAULT_PHYSICS, FLOW_KINDS, GROUND_PATTERNS, MARBLE_SHAPES, MARBLE_SKINS, PALETTES, SOUND_SETS, valveId,
  type Caption, type Cave, type Flow, type GroundPattern, type MapDoc, type MarbleShape, type MarbleSkin, type Shape, type SoundSet,
} from '../map/types.ts';
import type { Command } from './commands.ts';
import type { Selection } from './stage.ts';

export interface PanelHost {
  map: MapDoc;
  selection: Selection;
  packs: { name: string; characters: string[] }[];
  targets: string[];
  run(label: string, cmds: Command[]): void;
  select(s: Selection): void;
  duplicate(id: string, mirrored: boolean): void;
}

const MARBLE_SHAPE_NAMES: Record<MarbleShape, string> = { square: 'Vuông', triangle: 'Tam giác', star: 'Ngôi sao', heart: 'Trái tim', diamond: 'Thoi' };
const KIND_NAMES: Record<string, string> = { pipe: 'Ống cong', waterfall: 'Thác', conveyor: 'Băng chuyền gạt', portal: 'Cổng dịch chuyển', zigzag: 'Zigzag', pegs: 'Lưới chốt', wheel: 'Bánh xe múc' };
const PAINT_NAMES: [string, string][] = [
  ['', 'Không'], ['image', 'Theo ảnh'], ['rainbow', 'Cầu vồng'], ['gradient', 'Chuyển màu'],
  ['stripes', 'Sọc'], ['checker', 'Ô cờ'], ['depth', 'Theo độ sâu'],
];
const SHAPE_NAMES: Record<Shape['kind'], string> = { circle: 'Tròn', polygon: 'Đa giác', star: 'Ngôi sao', heart: 'Trái tim', drop: 'Giọt nước', moon: 'Bán nguyệt', rounded: 'Chữ nhật bo góc', path: 'Hình SVG' };

export function renderPanel(el: HTMLElement, host: PanelHost): void {
  const focused = (document.activeElement as HTMLElement | null)?.dataset.key;
  el.replaceChildren();
  const sel = host.selection;
  const cave = sel?.kind === 'cave' ? host.map.caves.find((c) => c.id === sel.id) : undefined;
  const flow = sel?.kind === 'flow' ? host.map.flows?.[sel.index] : undefined;
  if (cave) cavePanel(el, host, cave);
  else if (flow && sel?.kind === 'flow') flowPanel(el, host, flow, sel.index);
  else mapPanel(el, host);
  if (focused) el.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus();
}

function cavePanel(el: HTMLElement, host: PanelHost, cave: Cave): void {
  const id = cave.id;
  const set = (label: string, patch: Record<string, unknown>) => host.run(label, [{ op: 'cave.update', id, ...patch }]);
  const s = cave.shape;
  el.append(
    title(`Hang ${id}`),
    row('Tên', text('id', id, (v) => { host.run(`Đổi tên hang ${id}`, [{ op: 'cave.rename', id, to: v }]); host.select({ kind: 'cave', id: v }); })),
    row('Vị trí x, y', num('x', cave.x, (v) => set('Dời hang', { x: v })), num('y', cave.y, (v) => set('Dời hang', { y: v }))),
    row('Hình', select('shape', Object.entries(SHAPE_NAMES), s.kind, (kind) => {
      const r = s.radius;
      const shape: Shape = kind === 'circle' ? { kind, radius: r }
        : kind === 'star' ? { kind, points: 5, radius: r, inner: 0.6 }
        : kind === 'heart' || kind === 'drop' || kind === 'moon' ? { kind, radius: r }
        : kind === 'rounded' ? { kind, radius: r, aspect: 0.7, corner: 0.2 }
        : kind === 'path' ? { kind, radius: r, d: 'M0 0 L100 0 L50 90 Z' }
        : { kind: 'polygon', sides: 6, radius: r };
      host.run(`Đổi hình hang ${id}`, [{ op: 'cave.update', id, shape: null }, { op: 'cave.update', id, shape }]);
    })),
    row('Bán kính', num('radius', s.radius, (v) => set('Đổi cỡ hang', { shape: { radius: v } }), { min: 30, step: 5 })),
  );
  if (s.kind === 'polygon') el.append(row('Số cạnh', num('sides', s.sides, (v) => set('Đổi số cạnh', { shape: { sides: v } }), { min: 3, max: 12 })));
  if (s.kind === 'star') {
    el.append(
      row('Số cánh', num('points', s.points, (v) => set('Đổi số cánh', { shape: { points: v } }), { min: 3, max: 12 })),
      row('Độ lõm', num('inner', s.inner ?? 0.5, (v) => set('Đổi độ lõm', { shape: { inner: v } }), { min: 0.2, max: 0.9, step: 0.05 })),
    );
  }
  if (s.kind === 'rounded') {
    el.append(
      row('Cao ÷ rộng', num('aspect', s.aspect ?? 0.7, (v) => set('Đổi tỉ lệ', { shape: { aspect: v } }), { min: 0.2, max: 3, step: 0.05 })),
      row('Bo góc', num('corner', s.corner ?? 0.2, (v) => set('Đổi bo góc', { shape: { corner: v } }), { min: 0, max: 0.5, step: 0.05 })),
    );
  }
  if (s.kind === 'path') el.append(row('Đường SVG (d)', text('d', s.d, (v) => set('Đổi hình SVG', { shape: { d: v } }))), hint('Dán thuộc tính d của một path SVG (vẽ trong Figma rồi Copy as SVG). Chỉ lấy hình khép kín đầu tiên.'));
  if (s.kind !== 'circle') el.append(row('Xoay (độ)', num('rotation', s.rotation ?? 0, (v) => set('Xoay hang', { shape: { rotation: v || null } }), { step: 5 })));

  el.append(row('Vách ngăn', num('dividers', cave.dividers?.count ?? 0, (v) => set('Đổi vách ngăn', { dividers: v && v >= 2 ? { count: v } : null }), { min: 0, max: 20 })));
  if (cave.dividers) el.append(row('Vách cao', num('dividerHeight', cave.dividers.height ?? 0.6, (v) => set('Đổi độ cao vách', { dividers: { height: v } }), { min: 0.05, max: 1, step: 0.05 })));
  el.append(section('Bi'));
  const m = cave.marbles;
  el.append(row('Số bi', num('count', m?.count ?? 0, (v) => set('Đổi số bi', v ? { marbles: { count: v, colors: m?.colors ?? ['#ff4d5e', '#ffd23f', '#3fa7ff'] } } : { marbles: null }), { min: 0, step: 50 })));
  if (m) {
    const colors = document.createElement('div');
    colors.className = 'colors';
    m.colors.forEach((c, k) => {
      const input = color(`color${k}`, c, (v) => set('Đổi màu bi', { marbles: { colors: m.colors.map((x, j) => (j === k ? v : x)) } }));
      input.title = 'Chuột phải để bỏ màu này';
      input.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (m.colors.length > 1) set('Bỏ màu bi', { marbles: { colors: m.colors.filter((_, j) => j !== k) } });
      });
      colors.append(input);
    });
    colors.append(button('+', () => set('Thêm màu bi', { marbles: { colors: [...m.colors, '#ffffff'] } })));
    el.append(row('Màu', colors));

    const sp = m.paint;
    el.append(row('Hình lúc đầu', select('startImage', [['', 'Không'], ...host.targets.map((t) => [t, t] as [string, string])], sp?.mode === 'image' ? sp.image ?? '' : '', (v) =>
      set('Đổi hình lúc đầu', { marbles: { paint: v ? { mode: 'image', image: v, fit: sp?.fit ?? 'contain', background: sp?.background ?? '#2b2b2b' } : null } }))));
    if (sp?.mode === 'image') {
      el.append(
        row('Vừa khung', select('startFit', [['contain', 'Hiện đủ ảnh'], ['cover', 'Lấp kín']], sp.fit ?? 'contain', (v) => set('Đổi cách đặt hình lúc đầu', { marbles: { paint: { fit: v } } }))),
        row('Màu nền', color('startBg', sp.background ?? '#2b2b2b', (v) => set('Đổi màu nền hình lúc đầu', { marbles: { paint: { background: v } } }))),
        hint('Bi trong hang này xếp sẵn thành hình ngay từ đầu video.'),
      );
    }

    const a = m.actors;
    el.append(row('Nhân vật', select('pack', [['', 'Không (bi tròn)'], ...host.packs.map((p) => [p.name, p.name] as [string, string])], a?.pack ?? '', (v) => set('Đổi nhân vật', { marbles: { actors: v ? { pack: v } : null } }))));
    const pack = host.packs.find((p) => p.name === a?.pack);
    if (a && pack) {
      const list = document.createElement('div');
      list.className = 'chips';
      for (const c of pack.characters) {
        const on = !a.characters || a.characters.includes(c);
        list.append(chip(c, on, () => {
          const now = a.characters ?? pack.characters;
          const next = on ? now.filter((x) => x !== c) : [...now, c];
          set('Chọn nhân vật', { marbles: { actors: { characters: next.length === pack.characters.length || !next.length ? null : next } } });
        }));
      }
      el.append(row('Gồm', list));
      el.append(
        row('Đứng thẳng', check('upright', !!a.upright, (v) => set('Đổi kiểu đứng', { marbles: { actors: { upright: v || null } } }))),
        row('Cỡ vẽ', num('scale', a.scale ?? 1.2, (v) => set('Đổi cỡ nhân vật', { marbles: { actors: { scale: v } } }), { min: 0.5, max: 3, step: 0.1 })),
      );
    }
  }

  el.append(section('Ghép hình'));
  const p = cave.paint;
  el.append(row('Kiểu', select('paint', PAINT_NAMES, p?.mode ?? '', (v) => {
    host.run('Đổi kiểu ghép hình', [{ op: 'cave.update', id, paint: null }, ...(v ? [{ op: 'cave.update', id, paint: v === 'image' ? { mode: v, image: host.targets[0] ?? '', fit: 'contain' } : { mode: v } } as Command] : [])]);
  })));
  if (p?.mode === 'image') {
    el.append(
      row('Ảnh', select('image', host.targets.map((t) => [t, t] as [string, string]), p.image ?? '', (v) => set('Đổi ảnh đích', { paint: { image: v } }))),
      row('Vừa khung', select('fit', [['contain', 'Hiện đủ ảnh'], ['cover', 'Lấp kín'], ['shared', 'Chung với hang khác']], p.fit ?? 'contain', (v) => set('Đổi cách đặt ảnh', { paint: { fit: v } }))),
      row('Màu nền', color('bg', p.background ?? '#e9edf5', (v) => set('Đổi màu nền ảnh', { paint: { background: v } }))),
    );
  }
  if (p && p.mode !== 'image') el.append(row('Chung với hang khác', check('shared', p.fit === 'shared', (v) => set('Đổi cách trải màu', { paint: { fit: v ? 'shared' : null } }))));
  if (p?.fit === 'shared') el.append(hint('Mọi hang có cùng kiểu sơn này dùng chung một tấm, mỗi hang hiện đúng mảnh của nó. Dùng cho kiểu ghép tranh nhiều hang.'));
  if (p && ['gradient', 'stripes', 'checker', 'depth'].includes(p.mode)) {
    el.append(row('Bảng màu', select('palette', [['', 'Tự chọn màu'], ...Object.keys(PALETTES).map((k) => [k, k] as [string, string])], p.palette ?? '', (v) => set('Đổi bảng màu', { paint: { palette: v || null, colors: null } }))));
    if (!p.palette) {
      const list = p.colors ?? ['#ff4d5e', '#ffd23f', '#3fa7ff'];
      const colors = document.createElement('div');
      colors.className = 'colors';
      list.forEach((c, k) => colors.append(color(`pcolor${k}`, c, (v) => set('Đổi màu sơn', { paint: { colors: list.map((x, j) => (j === k ? v : x)) } }))));
      colors.append(button('+', () => set('Thêm màu sơn', { paint: { colors: [...list, '#ffffff'] } })));
      el.append(row('Màu', colors));
    }
  }
  if (p && ['rainbow', 'gradient', 'stripes'].includes(p.mode)) {
    el.append(row('Hướng', select('direction', [['x', 'Trái sang phải'], ['y', 'Trên xuống dưới']], p.direction ?? (p.mode === 'stripes' ? 'y' : 'x'), (v) => set('Đổi hướng sơn', { paint: { direction: v } }))));
  }
  if (p?.mode === 'stripes') el.append(row('Số sọc', num('bands', p.bands ?? 6, (v) => set('Đổi số sọc', { paint: { bands: v } }), { min: 1, max: 40 })));
  if (p?.mode === 'checker') el.append(row('Cỡ ô (px)', num('cell', p.cell ?? 40, (v) => set('Đổi cỡ ô', { paint: { cell: v } }), { min: 8, max: 200, step: 4 })));
  if (p) el.append(hint('Thêm máy sơn trên đường nối chảy vào hang này, bi qua máy mới đổi màu.'));

  el.append(section('Van'));
  (cave.valves ?? []).forEach((v, k) => {
    const vset = (patch: Record<string, unknown>) => host.run('Sửa van', [{ op: 'valve.update', cave: id, index: k, ...patch }]);
    el.append(row(`Van ${valveId(v, k)}`,
      num(`vx${k}`, v.x ?? 0, (x) => vset({ x: x || null }), { step: 5, label: 'lệch' }),
      num(`vw${k}`, v.width, (w) => vset({ width: w }), { min: 10, step: 5, label: 'rộng' }),
      button('Bỏ', () => host.run('Bỏ van', [{ op: 'valve.remove', cave: id, index: k }]), 'danger'),
    ));
  });
  if (cave.valves?.length) {
    const open = host.map.events.find((e) => e.cave === id && e.do === 'valve.open' && !e.valve);
    el.append(
      row('Mở van lúc (s)', num('open', open?.t ?? null, (t) => host.run('Đổi giờ mở van', [{ op: 'valve.openAt', cave: id, t }]), { min: 0, step: 0.5, optional: 'không mở' })),
      row('Phễu (độ)', num('funnel', cave.funnel === false ? null : (cave.funnel ?? 40), (v) => set('Đổi phễu', { funnel: v === null ? false : v === 40 ? null : v }), { min: 10, max: 70, step: 5, optional: 'đáy phẳng' })),
    );
  } else {
    el.append(hint('Kéo nút + ở dưới hang sang hang khác để nối. Van tự thêm.'));
  }

  el.append(section(''), row('', button('Nhân đôi', () => host.duplicate(id, false)), button('Lật gương', () => host.duplicate(id, true)), button('Xoá hang', () => host.run(`Xoá hang ${id}`, [{ op: 'cave.remove', id }]), 'danger')));
}

function flowPanel(el: HTMLElement, host: PanelHost, flow: Flow, index: number): void {
  const set = (label: string, patch: Record<string, unknown>) => host.run(label, [{ op: 'flow.update', index, ...patch }]);
  el.append(
    title(`${flow.from} → ${flow.to}`),
    row('Kiểu', select('kind', FLOW_KINDS.map((k) => [k, KIND_NAMES[k]] as [string, string]), flow.kind, (v) => set('Đổi kiểu đường nối', { kind: v }))),
    row('Điểm rơi (lệch tâm)', num('at', flow.at ?? null, (v) => set('Đổi điểm rơi', { at: v }), { step: 5, optional: 'tự chọn' })),
  );
  if (flow.kind === 'pipe') {
    el.append(hint(`Có ${flow.via?.length ?? 0} điểm uốn. Nháy đúp lên ống để thêm, kéo để dời, chuột phải để bỏ.`));
    if (flow.via?.length) el.append(row('', button('Bỏ hết điểm uốn', () => set('Bỏ hết điểm uốn', { via: null }))));
  }
  if (flow.kind === 'zigzag') {
    el.append(
      row('Số lần uốn', num('turns', flow.turns ?? null, (v) => set('Đổi số lần uốn', { turns: v }), { min: 1, max: 12, optional: '4' })),
      row('Lắc ngang (px)', num('swing', flow.swing ?? null, (v) => set('Đổi độ lắc', { swing: v }), { min: 20, step: 10, optional: '130' })),
    );
  }
  if (flow.kind === 'wheel') {
    el.append(
      row('Bán kính bánh', num('wheelR', flow.radius ?? null, (v) => set('Đổi cỡ bánh xe', { radius: v }), { min: 80, step: 10, optional: '170' })),
      row('Số cánh', num('arms', flow.arms ?? null, (v) => set('Đổi số cánh', { arms: v }), { min: 3, max: 16, optional: '6' })),
      row('Tốc độ (độ/giây)', num('wheelSpeed', flow.speed ?? null, (v) => set('Đổi tốc độ bánh xe', { speed: v }), { min: 5, step: 5, optional: '50' })),
    );
  }
  if (flow.kind === 'pegs') {
    el.append(row('Nửa bề rộng (px)', num('spread', flow.spread ?? null, (v) => set('Đổi bề rộng lưới chốt', { spread: v }), { min: 40, step: 10, optional: '150' })));
  }
  if (flow.kind === 'conveyor') {
    el.append(
      row('Tốc độ (px/s)', num('speed', flow.speed ?? null, (v) => set('Đổi tốc độ băng chuyền', { speed: v }), { min: 20, step: 10, optional: '140' })),
      row('Cao thanh gạt', num('paddle', flow.paddle ?? null, (v) => set('Đổi thanh gạt', { paddle: v }), { min: 6, step: 2, optional: 'tự chọn' })),
      row('Cách nhau', num('spacing', flow.spacing ?? null, (v) => set('Đổi khoảng cách thanh gạt', { spacing: v }), { min: 10, step: 5, optional: 'tự chọn' })),
    );
  }

  el.append(section('Máy'));
  el.append(row('Máy sơn', check('paint', !!flow.paint, (on) => host.run(on ? 'Thêm máy sơn' : 'Bỏ máy sơn', [on ? { op: 'machine.set', flow: index, kind: 'paint', at: 0.6 } : { op: 'machine.remove', flow: index, kind: 'paint' }]))));
  const characters = host.packs.flatMap((p) => p.characters.map((c) => `${p.name}/${c}`));
  el.append(row('Máy đổi nhân vật', check('swap', !!flow.swap, (on) => host.run(on ? 'Thêm máy đổi nhân vật' : 'Bỏ máy đổi nhân vật', [on ? { op: 'machine.set', flow: index, kind: 'swap', at: 0.4, character: characters[0] ?? 'blobs/blue' } : { op: 'machine.remove', flow: index, kind: 'swap' }]))));
  if (flow.swap) {
    const options = characters.includes(flow.swap.character) ? characters : [flow.swap.character, ...characters];
    el.append(row('Hoá thành', select('character', options.map((c) => [c, c] as [string, string]), flow.swap.character, (v) => host.run('Đổi nhân vật của máy', [{ op: 'machine.set', flow: index, kind: 'swap', character: v }]))));
  }
  el.append(row('Máy đổi cỡ', check('size', !!flow.size, (on) => host.run(on ? 'Thêm máy đổi cỡ' : 'Bỏ máy đổi cỡ', [on ? { op: 'machine.set', flow: index, kind: 'size', at: 0.3, scale: 1.6 } : { op: 'machine.remove', flow: index, kind: 'size' }]))));
  if (flow.size) el.append(row('Cỡ mới (lần)', num('scale', flow.size.scale, (v) => host.run('Đổi cỡ của máy', [{ op: 'machine.set', flow: index, kind: 'size', scale: v ?? 1.6 }]), { min: 0.3, max: 3, step: 0.1 })));
  el.append(row('Máy đổi hình', check('shapeM', !!flow.shape, (on) => host.run(on ? 'Thêm máy đổi hình' : 'Bỏ máy đổi hình', [on ? { op: 'machine.set', flow: index, kind: 'shape', at: 0.5, shape: 'square' } : { op: 'machine.remove', flow: index, kind: 'shape' }]))));
  if (flow.shape) el.append(row('Thành hình', select('marbleShape', MARBLE_SHAPES.map((k) => [k, MARBLE_SHAPE_NAMES[k]] as [string, string]), flow.shape.shape, (v) => host.run('Đổi hình của máy', [{ op: 'machine.set', flow: index, kind: 'shape', shape: v as MarbleShape }]))));
  el.append(row('Máy trộn màu', check('mix', !!flow.mix, (on) => host.run(on ? 'Thêm máy trộn màu' : 'Bỏ máy trộn màu', [on ? { op: 'machine.set', flow: index, kind: 'mix', at: 0.5 } : { op: 'machine.remove', flow: index, kind: 'mix' }]))));
  if (flow.mix) el.append(hint('Bi qua máy trộn đổi sang màu pha của tất cả bi đi qua. Ghi "color" trong JSON để chọn màu cố định.'));
  el.append(row('Máy nhân đôi', check('double', !!flow.double, (on) => host.run(on ? 'Thêm máy nhân đôi' : 'Bỏ máy nhân đôi', [on ? { op: 'machine.set', flow: index, kind: 'double', at: 0.4 } : { op: 'machine.remove', flow: index, kind: 'double' }]))));
  if (flow.kind === 'portal') {
    el.append(row('Chỉ nhận màu', text('only', (flow.only ?? []).join(' '), (v) => set('Đổi màu cổng nhận', { only: v.trim() ? v.trim().split(/[\s,]+/) : null }))));
    el.append(hint('Để trống thì nhận mọi bi. Nhiều cổng trên cùng một van, mỗi cổng một màu, thành máy phân loại.'));
  }
  if (flow.paint || flow.swap || flow.size || flow.shape || flow.mix || flow.double) el.append(hint('Kéo nút tròn của máy dọc đường nối để dời chỗ.'));
  el.append(section(''), row('', button('Xoá đường nối', () => { host.run('Xoá đường nối', [{ op: 'flow.remove', index }]); host.select(null); }, 'danger')));
}

function mapPanel(el: HTMLElement, host: PanelHost): void {
  const map = host.map;
  const set = (label: string, patch: Record<string, unknown>) => host.run(label, [{ op: 'map.update', ...patch }]);
  const phys = { ...DEFAULT_PHYSICS, ...map.physics };
  const ground = { color: '#1b2030', rim: '#8e97ab', ...map.ground };
  el.append(
    title('Cả video'),
    row('Tên video', text('name', map.name, (v) => set('Đổi tên video', { name: v }))),
    row('Seed', num('seed', map.seed, (v) => set('Đổi seed', { seed: v })), button('Ngẫu nhiên', () => set('Đổi seed', { seed: Math.floor(Math.random() * 100000) }))),
    row('Dài (giây)', num('duration', map.duration ?? DEFAULT_DURATION, (v) => set('Đổi độ dài', { duration: v }), { min: 1, max: 600 })),
    section('Bi'),
    row('Bán kính bi', num('marbleRadius', phys.marbleRadius, (v) => set('Đổi cỡ bi', { physics: { marbleRadius: v } }), { min: 2, max: 30 })),
    row('Trọng lực', num('gravity', phys.gravity, (v) => set('Đổi trọng lực', { physics: { gravity: v } }), { step: 100 })),
    row('Lực cản không khí', num('drag', phys.drag, (v) => set('Đổi lực cản', { physics: { drag: v || null } }), { min: 0, max: 20, step: 0.5 })),
    hint('Muốn bi rơi chậm: giảm trọng lực (vd 1500) hoặc tăng lực cản (vd 2–4).'),
    row('Ma sát', num('friction', phys.friction, (v) => set('Đổi ma sát', { physics: { friction: v } }), { min: 0, max: 2, step: 0.05 })),
    row('Độ nảy', num('restitution', phys.restitution, (v) => set('Đổi độ nảy', { physics: { restitution: v } }), { min: 0, max: 1, step: 0.05 })),
    section('Màu'),
    row('Nền', color('background', map.frame.background, (v) => set('Đổi màu nền', { frame: { background: v } }))),
    row('Đất', color('ground', ground.color, (v) => set('Đổi màu đất', { ground: { color: v } }))),
    row('Viền đất', color('rim', ground.rim, (v) => set('Đổi màu viền', { ground: { rim: v } }))),
    section('Kiểu dáng'),
    row('Theme', select('theme', [['', 'Không (tự chọn màu)'], ...Object.entries(THEMES).map(([k, t]) => [k, t.name] as [string, string])], map.theme ?? '', (v) => set('Đổi theme', { theme: v || null }))),
    row('Kiểu bi', select('skin', [['', 'Theo theme'], ...MARBLE_SKINS.map((k) => [k, SKIN_NAMES[k]] as [string, string])], map.look?.marble ?? '', (v) => set('Đổi kiểu bi', { look: { marble: v || null } }))),
    row('Bóng dưới bi', check('shadow', !!(map.look?.shadow ?? (map.theme && THEMES[map.theme]?.look.shadow)), (v) => set('Đổi bóng bi', { look: { shadow: v } }))),
    row('Vân trên đất', select('pattern', [['', 'Theo theme'], ...GROUND_PATTERNS.map((k) => [k, PATTERN_NAMES[k]] as [string, string])], map.look?.pattern ?? '', (v) => set('Đổi vân đất', { look: { pattern: v || null } }))),
    row('Tiếng bi', select('sound', [['', 'Theo theme'], ...SOUND_SETS.map((k) => [k, SOUND_NAMES[k]] as [string, string])], map.sound ?? '', (v) => set('Đổi tiếng bi', { sound: v || null }))),
    row('Tiêu đề', text('title', map.captions?.find((c) => c.kind === 'title')?.text ?? '', (v) => set('Đổi tiêu đề', { captions: setTitle(map, v) }))),
    hint('Có theme thì màu nền, màu đất đi theo theme. Chữ khác (đếm bi, đếm ngược, bảng điểm) sửa trong file JSON, mục "captions".'),
    section('Camera'),
    row('Map cao (px)', num('frameHeight', map.frame.height, (v) => set('Đổi chiều cao map', { frame: { height: v } }), { min: 400, max: 4000, step: 100 })),
    row('Video cao (px)', num('camHeight', map.camera?.height ?? map.frame.height, (v) => set('Đổi chiều cao video', { camera: { height: v === map.frame.height ? null : v } }), { min: 400, max: 4000, step: 100 })),
    row('Đi theo bi', check('follow', !!map.camera?.follow, (v) => set('Đổi camera', { camera: { follow: v || null } }))),
    row('Cuối video phóng to vào', select('zoomCave', [['', 'Không'], ...map.caves.map((c) => [c.id, `Hang ${c.id}`] as [string, string])], map.camera?.zoom?.cave ?? '', (v) => set('Đổi cảnh cuối', { camera: { zoom: v ? { cave: v, t: Math.max(0, (map.duration ?? DEFAULT_DURATION) - 5), scale: 1.8 } : null } }))),
    ...(map.camera?.zoom ? [row('Phóng từ giây', num('zoomT', map.camera.zoom.t, (v) => set('Đổi giờ phóng to', { camera: { zoom: { t: v } } }), { min: 0, step: 0.5 }))] : []),
    hint('Map cao hơn video thì bật "Đi theo bi" để camera chạy theo dòng bi.'),
    section('Hiệu ứng'),
    row('Đuôi sáng', check('tails', !!map.effects?.tails, (v) => set('Đổi hiệu ứng', { effects: { tails: v || null } }))),
    row('Vệt sơn trên nền', check('stains', !!map.effects?.stains, (v) => set('Đổi hiệu ứng', { effects: { stains: v || null } }))),
    row('Tia lửa ở máy sơn', check('sparks', !!map.effects?.sparks, (v) => set('Đổi hiệu ứng', { effects: { sparks: v || null } }))),
    row('Rung khi bi đổ mạnh', check('shake', !!map.effects?.shake, (v) => set('Đổi hiệu ứng', { effects: { shake: v || null } }))),
    section('Nhạc nền'),
    row('File trong public/music/', text('music', map.music?.file ?? '', (v) => set('Đổi nhạc', { music: v ? { file: v } : null }))),
    hint('Bấm vào một hang hoặc một đường nối để chỉnh nó.'),
  );
}

const SKIN_NAMES: Record<MarbleSkin, string> = { flat: 'Phẳng', glass: 'Thủy tinh', metal: 'Kim loại', gem: 'Ngọc', glow: 'Phát sáng' };
const PATTERN_NAMES: Record<GroundPattern, string> = { plain: 'Trơn', paper: 'Giấy kẻ ô', wood: 'Gỗ', chalk: 'Bảng đen', dots: 'Chấm bi', plates: 'Tấm thép' };
const SOUND_NAMES: Record<SoundSet, string> = { tick: 'Tách', glass: 'Thủy tinh', wood: 'Gỗ', metal: 'Kim loại', coin: 'Đồng xu', pop: 'Bụp' };

// The captions list with the title replaced (or removed when empty).
function setTitle(map: MapDoc, text: string): Caption[] | null {
  const rest = (map.captions ?? []).filter((c) => c.kind !== 'title');
  const list = text ? [{ kind: 'title' as const, text }, ...rest] : rest;
  return list.length ? list : null;
}

// ---- tiny form helpers ----

function title(t: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = t;
  return h;
}

function section(t: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = t;
  return h;
}

function hint(t: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = t;
  return p;
}

function row(label: string, ...inputs: HTMLElement[]): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  const span = document.createElement('span');
  span.textContent = label;
  const box = document.createElement('div');
  box.append(...inputs);
  r.append(span, box);
  return r;
}

function num(key: string, value: number | null, onSet: (v: number | null) => void, o: { min?: number; max?: number; step?: number; optional?: string; label?: string } = {}): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.dataset.key = key;
  input.value = value === null ? '' : String(value);
  if (o.min !== undefined) input.min = String(o.min);
  if (o.max !== undefined) input.max = String(o.max);
  input.step = String(o.step ?? 1);
  if (o.optional) input.placeholder = o.optional;
  if (o.label) input.title = o.label;
  input.addEventListener('change', () => {
    if (input.value === '') return o.optional ? onSet(null) : undefined;
    let v = Number(input.value);
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    onSet(v);
  });
  return input;
}

function text(key: string, value: string, onSet: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.dataset.key = key;
  input.value = value;
  input.addEventListener('change', () => onSet(input.value.trim()));
  return input;
}

function color(key: string, value: string, onSet: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.dataset.key = key;
  input.value = value;
  input.addEventListener('change', () => onSet(input.value));
  return input;
}

function select(key: string, options: [string, string][], value: string, onSet: (v: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  s.dataset.key = key;
  for (const [v, label] of options) s.append(new Option(label, v, false, v === value));
  s.addEventListener('change', () => onSet(s.value));
  return s;
}

function check(key: string, value: boolean, onSet: (v: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.key = key;
  input.checked = value;
  input.addEventListener('change', () => onSet(input.checked));
  return input;
}

function chip(label: string, on: boolean, onClick: () => void): HTMLElement {
  const b = button(label, onClick);
  b.className = on ? 'chip on' : 'chip';
  return b;
}

export function button(label: string, onClick: () => void, kind?: 'danger' | 'primary'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (kind) b.className = kind;
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}
