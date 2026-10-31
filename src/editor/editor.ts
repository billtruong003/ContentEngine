// Map editor: build a video with the mouse. Parts on the left, the map in the middle, settings on the right.
// Everything also works from code through window.__editor, so a script can drive the same editor.
import { formatMap } from '../map/format.ts';
import type { Pt } from '../map/geometry.ts';
import type { Layout } from '../map/layout.ts';
import { validateMap } from '../map/validate.ts';
import type { Cave, MapDoc } from '../map/types.ts';
import { MACHINES, type MachineKind } from '../map/layout.ts';
import { generate, parseLock, remix, type Aspect } from '../generator/generate.ts';
import { blankMap, COMMAND_NAMES, mirrorOf, nextId, SHAPES, type Command } from './commands.ts';
import { History, type Source } from './history.ts';
import { button, renderPanel } from './panel.ts';
import { Stage, type Selection } from './stage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const top = $('top');
const left = $('left');
const right = $('right');
const problems = $('problems');
const toastEl = $('toast');
const logEl = $('log');
const playFrame = $<HTMLIFrameElement>('play');

const ed = {
  history: new History(blankMap(), null),
  layout: null as Layout | null,
  errors: [] as string[],
  warnings: [] as string[],
  selection: null as Selection,
  grid: 10,
  mirror: false,
  packs: [] as { name: string; characters: string[] }[],
  targets: [] as string[],
  select(s: Selection) {
    ed.selection = s;
    refresh();
  },
  changed() {
    recompute();
    stage.redraw();
  },
  toast,
  drop,
};

const stage = new Stage($<HTMLCanvasElement>('stage'), ed);

// ---- validation, throttled so dragging stays smooth ----

let timer = 0;
let lastRun = 0;
function recompute(): void {
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    recomputeNow();
    stage.redraw();
  }, Math.max(0, 70 - (performance.now() - lastRun)));
}

function recomputeNow(): void {
  clearTimeout(timer);
  timer = 0;
  lastRun = performance.now();
  try {
    const r = validateMap(ed.history.map, { walls: false });
    ed.layout = r.layout ?? null;
    ed.errors = r.errors;
    ed.warnings = r.warnings;
  } catch (e) {
    ed.errors = [`Lỗi khi dựng map: ${(e as Error).message}`];
  }
  drawProblems();
}

function drawProblems(): void {
  const lines = [
    ...ed.errors.map((e) => `<div class="err">✗ ${esc(e)}</div>`),
    ...ed.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`),
  ];
  problems.innerHTML = lines.length ? lines.join('') : '<div class="ok">✓ Map ổn. Bấm Chạy thử (Ctrl+Enter) để xem bi chảy.</div>';
}

// ---- whole-UI refresh after every committed change ----

function bind(h: History): void {
  ed.history = h;
  h.onChange = () => {
    const s = ed.selection;
    if (s?.kind === 'cave' && !h.map.caves.some((c) => c.id === s.id)) ed.selection = null;
    if (s?.kind === 'flow' && !h.map.flows?.[s.index]) ed.selection = null;
    recomputeNow();
    refresh();
  };
  ed.selection = null;
  recomputeNow();
  refresh();
  stage.fit();
  history.replaceState(null, '', h.file ? `?map=${h.file}` : location.pathname);
}

function refresh(): void {
  renderPanel(right, {
    map: ed.history.map,
    selection: ed.selection,
    packs: ed.packs,
    targets: ed.targets,
    select: ed.select,
    duplicate,
    run: (label, cmds) => run(label, cmds),
  });
  renderTop();
  renderHistory();
  stage.redraw();
}

function run(label: string, cmds: Command[], source: Source = 'người'): unknown[] | null {
  try {
    return ed.history.run(label, cmds, source);
  } catch (e) {
    toast((e as Error).message, 'err');
    return null;
  }
}

// ---- top bar ----

function renderTop(): void {
  const h = ed.history;
  const file = document.createElement('div');
  file.className = 'file';
  file.innerHTML = `${esc(h.file ?? 'chưa lưu')}${h.dirty ? ' •' : ''}<br><small>${esc(h.map.name)}</small>`;
  const sep = () => Object.assign(document.createElement('div'), { className: 'sep' });
  const gap = Object.assign(document.createElement('div'), { className: 'gap' });
  const undo = button('↶ Hoàn tác', () => ed.history.undo());
  undo.disabled = !h.done.length;
  undo.title = h.done.length ? `Ctrl+Z: ${h.done[h.done.length - 1].label}` : 'Ctrl+Z';
  const redo = button('↷ Làm lại', () => ed.history.redo());
  redo.disabled = !h.undone.length;
  redo.title = 'Ctrl+Shift+Z';
  const grid = button(ed.grid ? `Lưới ${ed.grid}` : 'Lưới tắt', () => {
    const steps = [10, 20, 40, 5, 0];
    ed.grid = steps[(steps.indexOf(ed.grid) + 1) % steps.length];
    refresh();
  });
  grid.title = 'Bắt dính lưới khi kéo. Bấm để đổi bước.';
  const mirror = button('Gương', () => { ed.mirror = !ed.mirror; refresh(); });
  mirror.className = ed.mirror ? 'on' : '';
  mirror.title = 'Đặt, kéo và nối một bên thì bên đối xứng làm theo';
  const playing = document.body.classList.contains('playing');
  const play = button(playing ? '■ Sửa tiếp' : '▶ Chạy thử', () => (playing ? stopPlay() : startPlay()), 'primary');
  play.title = 'Ctrl+Enter';
  top.replaceChildren(
    file,
    button('Mới ▾', () => newMenu(top.children[1] as HTMLElement)),
    button('Mở ▾', () => openMenu(top.children[2] as HTMLElement)),
    button('Lưu', () => save()),
    button('Lưu thành template', () => saveTemplate()),
    sep(), undo, redo,
    sep(), grid, mirror, button('Vừa khung', () => stage.fit()),
    gap, play, button('Xuất video', () => exportVideo()),
  );
}

// ---- left palette ----

const PARTS: [string, string, string][] = [
  ['circle', 'Tròn', '<circle cx="12" cy="12" r="9"/>'],
  ['triangle', 'Tam giác', '<polygon points="12,21 3.5,6 20.5,6"/>'],
  ['square', 'Vuông', '<rect x="4" y="4" width="16" height="16"/>'],
  ['pentagon', 'Ngũ giác', '<polygon points="7,20 17,20 20,10.5 12,4 4,10.5"/>'],
  ['hexagon', 'Lục giác', '<polygon points="7.5,20 16.5,20 21,12 16.5,4 7.5,4 3,12"/>'],
  ['octagon', 'Bát giác', '<polygon points="8.5,20.5 15.5,20.5 20.5,15.5 20.5,8.5 15.5,3.5 8.5,3.5 3.5,8.5 3.5,15.5"/>'],
  ['star', 'Ngôi sao', '<polygon points="12,21 9.6,15 3.4,14.8 8.2,10.6 6.7,4.5 12,8 17.3,4.5 15.8,10.6 20.6,14.8 14.4,15"/>'],
  ['heart', 'Trái tim', '<path d="M12 21 C4 14 2 10 4.5 6.5 C7 3.5 10.5 4.5 12 7.5 C13.5 4.5 17 3.5 19.5 6.5 C22 10 20 14 12 21Z"/>'],
  ['drop', 'Giọt nước', '<path d="M12 2.5 C15 8 19 11 19 15 A7 7 0 0 1 5 15 C5 11 9 8 12 2.5Z"/>'],
  ['moon', 'Bán nguyệt', '<path d="M3 8 H21 A9 9 0 0 1 3 8Z"/>'],
  ['rounded', 'Chữ nhật bo góc', '<rect x="3" y="6" width="18" height="12" rx="3"/>'],
];

function renderLeft(): void {
  const part = (key: string, label: string, svg: string, color = '#7aa2ff') => {
    const el = document.createElement('div');
    el.className = 'part';
    el.draggable = true;
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">${svg}</svg>${label}`;
    el.title = 'Kéo vào map, hoặc bấm để thêm vào giữa màn hình';
    el.addEventListener('dragstart', (e) => e.dataTransfer!.setData('text/plain', key));
    el.addEventListener('click', () => drop(key, stage.center()));
    return el;
  };
  const h = (t: string) => Object.assign(document.createElement('h3'), { textContent: t });
  const history = Object.assign(document.createElement('div'), { id: 'history' });
  left.replaceChildren(
    h('Hang'), ...PARTS.map(([k, l, s]) => part(k, l, s)),
    h('Máy (thả lên đường nối)'),
    part('paint', 'Máy sơn', '<path d="M3 12h18" stroke="#ffd23f" stroke-width="4"/>', '#ffd23f'),
    part('swap', 'Máy đổi nhân vật', '<path d="M3 12h18" stroke="#e07bff" stroke-width="4"/>', '#e07bff'),
    part('size', 'Máy phóng to bi', '<path d="M3 12h18" stroke="#4dd98b" stroke-width="4"/>', '#4dd98b'),
    part('shape', 'Máy đổi hình', '<path d="M3 12h18" stroke="#5ad1ff" stroke-width="4"/>', '#5ad1ff'),
    part('mix', 'Máy trộn màu', '<path d="M3 12h18" stroke="#ff7aa8" stroke-width="4"/>', '#ff7aa8'),
    part('double', 'Máy nhân đôi', '<path d="M3 12h18" stroke="#ffffff" stroke-width="4"/>', '#ffffff'),
    h('Bi (thả vào hang)'),
    part('marbles', 'Thêm 300 bi', '<circle cx="8" cy="15" r="4"/><circle cx="16" cy="15" r="4"/><circle cx="12" cy="8" r="4"/>', '#ff4d5e'),
    h('Lịch sử'), history,
  );
  renderHistory();
}

function renderHistory(): void {
  const el = document.getElementById('history');
  if (!el) return;
  const entries = ed.history.done.slice(-14).reverse();
  el.innerHTML = entries.length
    ? entries.map((e) => `<div title="${esc(e.label)}">${e.source !== 'người' ? `<b>${e.source}</b> ` : ''}${esc(e.label)}</div>`).join('')
    : '<div>Chưa sửa gì</div>';
}

// ---- adding parts ----

function drop(item: string, at: Pt): void {
  const map = ed.history.map;
  const W = map.frame.width;
  if (SHAPES[item]) {
    const shape = SHAPES[item];
    const cmds: Command[] = [{ op: 'cave.add', shape, x: at.x, y: at.y }];
    if (ed.mirror && Math.abs(at.x - W / 2) > shape.radius) {
      const ids = new Set(map.caves.map((c) => c.id));
      const first = nextId(map);
      ids.add(first);
      const second = nextId({ ...map, caves: [...ids].map((id) => ({ id }) as Cave) });
      cmds[0] = { ...cmds[0], id: first } as Command;
      cmds.push({ op: 'cave.add', id: second, shape: mirrored(shape), x: W - at.x, y: at.y });
    }
    const res = run('Thêm hang', cmds);
    if (res) ed.select({ kind: 'cave', id: res[0] as string });
    return;
  }
  if (item === 'marbles') {
    const cave = stage.caveAt(at);
    if (!cave) return toast('Thả bi vào trong một hang.');
    const m = cave.marbles;
    run(`Thêm bi vào hang ${cave.id}`, [{ op: 'cave.update', id: cave.id, marbles: { count: (m?.count ?? 0) + 300, colors: m?.colors ?? ['#ff4d5e', '#ffd23f', '#3fa7ff'] } }]);
    ed.select({ kind: 'cave', id: cave.id });
    return;
  }
  if (['paint', 'swap', 'size', 'shape', 'mix', 'double'].includes(item)) {
    const flow = stage.flowAt(at, 40);
    if (flow < 0) return toast('Thả máy lên một đường nối (đường gạch giữa hai hang).');
    const at01 = stage.fractionOn(flow, at);
    const cmd: Command = item === 'paint'
      ? { op: 'machine.set', flow, kind: 'paint', at: at01 }
      : item === 'size' ? { op: 'machine.set', flow, kind: 'size', at: at01, scale: 1.6 }
      : item === 'shape' ? { op: 'machine.set', flow, kind: 'shape', at: at01, shape: 'square' }
      : item === 'mix' || item === 'double' ? { op: 'machine.set', flow, kind: item, at: at01 }
      : { op: 'machine.set', flow, kind: 'swap', at: at01, character: swapTarget(map.flows![flow].from) };
    const label = `Thêm ${MACHINES[item as MachineKind].name.toLowerCase()}`;
    if (run(label, [cmd])) ed.select({ kind: 'flow', index: flow });
  }
}

// A character other than the one the source cave starts with, so the swap is visible.
function swapTarget(from: string): string {
  const actors = ed.history.map.caves.find((c) => c.id === from)?.marbles?.actors;
  const pack = ed.packs.find((p) => p.name === actors?.pack) ?? ed.packs[0];
  if (!pack) return 'blobs/blue';
  const first = actors?.characters?.[0];
  return `${pack.name}/${pack.characters.find((c) => c !== first) ?? pack.characters[0]}`;
}

function mirrored<T extends Cave['shape']>(shape: T): T {
  const s = structuredClone(shape);
  if ('rotation' in s && s.rotation) s.rotation = -s.rotation;
  return s;
}

function duplicate(id: string, mirror: boolean): void {
  const map = ed.history.map;
  const cave = map.caves.find((c) => c.id === id);
  if (!cave) return;
  const copy = structuredClone(cave);
  copy.id = nextId(map);
  if (mirror) {
    copy.x = map.frame.width - cave.x;
    copy.shape = mirrored(copy.shape);
    copy.valves?.forEach((v) => { if (v.x) v.x = -v.x; });
  } else {
    copy.x += 60;
    copy.y += 60;
  }
  const { id: newId, x, y, shape, ...rest } = copy;
  const res = run(mirror ? `Lật gương hang ${id}` : `Nhân đôi hang ${id}`, [
    { op: 'cave.add', id: newId, x, y, shape },
    { op: 'cave.update', id: newId, ...rest },
  ]);
  if (res) ed.select({ kind: 'cave', id: newId });
}

// ---- files ----

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function openMap(name: string, folder: 'maps' | 'templates' | 'generated' = 'maps'): Promise<boolean> {
  if (!confirmDiscard()) return false;
  try {
    const map = await api<MapDoc>(`${folder}/${name}`);
    bind(new History(map, folder === 'maps' ? name : null));
    toast(folder === 'maps' ? `Đã mở ${name}` : `Map mới từ ${folder}/${name}`, 'ok');
    return true;
  } catch (e) {
    toast((e as Error).message, 'err');
    return false;
  }
}

function confirmDiscard(): boolean {
  return !ed.history.dirty || confirm('Map đang sửa chưa lưu. Bỏ các thay đổi?');
}

async function save(name?: string): Promise<boolean> {
  const h = ed.history;
  let file = name ?? h.file;
  if (!file) {
    file = prompt('Lưu vào maps/ với tên file (chữ thường không dấu, số, gạch ngang):', slug(h.map.name))?.trim() ?? '';
    if (!file) return false;
    const existing = await api<string[]>('maps');
    if (existing.includes(file) && !confirm(`maps/${file}.json đã có. Ghi đè?`)) return false;
  }
  try {
    const text = formatMap(h.map);
    await api(`maps/${file}`, { method: 'PUT', body: text });
    h.file = file;
    h.saved = text;
    history.replaceState(null, '', `?map=${file}`);
    toast(`Đã lưu maps/${file}.json`, 'ok');
    renderTop();
    return true;
  } catch (e) {
    toast((e as Error).message, 'err');
    return false;
  }
}

async function saveTemplate(name?: string): Promise<boolean> {
  const file = name ?? prompt('Tên template (chữ thường không dấu, số, gạch ngang):', slug(ed.history.map.name))?.trim();
  if (!file) return false;
  try {
    await api(`templates/${file}`, { method: 'PUT', body: formatMap(ed.history.map) });
    toast(`Đã lưu templates/${file}.json. Lần sau chọn ở Mới ▾`, 'ok');
    return true;
  } catch (e) {
    toast((e as Error).message, 'err');
    return false;
  }
}

// A generated or remixed map opens as a new, unsaved map, so Lưu never overwrites the map it came from.
async function newGenerated(seed?: number, lock = '', keep?: Aspect[]): Promise<{ seed: number; name: string } | null> {
  if (!confirmDiscard()) return null;
  const s = seed ?? 1 + (Date.now() % 99_999);
  const images = await api<string[]>('targets').catch(() => []);
  const map = keep ? remix(ed.history.map, s, keep, { images }) : generate(s, parseLock(lock, { images }), { images }).map;
  bind(new History(map, null));
  toast(`${keep ? 'Remix' : 'Map ngẫu nhiên'} seed ${s}. Bấm ▶ Chạy thử xem có kẹt không.`, 'ok');
  return { seed: s, name: map.name };
}

async function newMenu(anchor: HTMLElement): Promise<void> {
  const templates = await api<string[]>('templates').catch(() => []);
  menu(anchor, [
    { items: [
      ['Map trống', () => { if (confirmDiscard()) { bind(new History(blankMap(), null)); } }],
      ['Map ngẫu nhiên', () => newGenerated()],
      ['Remix map đang mở', () => newGenerated(undefined, '', [])],
    ] },
    { title: 'Từ template', items: templates.length ? templates.map((t) => [t, () => openMap(t, 'templates')]) : [['(chưa có, dùng Lưu thành template)', () => {}]] },
  ]);
}

async function openMenu(anchor: HTMLElement): Promise<void> {
  const maps = await api<string[]>('maps').catch(() => []);
  const generated = await api<string[]>('generated').catch(() => []);
  menu(anchor, [
    { title: 'maps/', items: maps.map((m) => [m, () => openMap(m)]) },
    ...(generated.length ? [{ title: 'generated/ (mở thành map mới)', items: generated.map((m) => [m, () => openMap(m, 'generated')] as [string, () => void]) }] : []),
  ]);
}

function menu(anchor: HTMLElement, groups: { title?: string; items: [string, () => void][] }[]): void {
  document.querySelector('.menu')?.remove();
  const el = document.createElement('div');
  el.className = 'menu';
  for (const g of groups) {
    if (g.title) el.append(Object.assign(document.createElement('h4'), { textContent: g.title }));
    for (const [label, fn] of g.items) el.append(button(label, () => { el.remove(); fn(); }));
  }
  const box = anchor.getBoundingClientRect();
  el.style.left = `${box.left}px`;
  el.style.top = `${box.bottom + 4}px`;
  document.body.append(el);
  setTimeout(() => document.addEventListener('pointerdown', function close(e) {
    if (!el.contains(e.target as Node)) { el.remove(); document.removeEventListener('pointerdown', close); }
  }), 0);
}

// ---- test run and export ----

let frameReady: Promise<void> | null = null;
function startPlay(): void {
  if (ed.errors.length) return toast('Map còn lỗi (xem góc dưới). Sửa xong mới chạy thử được.', 'err');
  document.body.classList.add('playing');
  frameReady ??= new Promise((resolve) => {
    const onReady = (e: MessageEvent) => {
      if (e.source === playFrame.contentWindow && e.data?.type === 'marble:ready') {
        window.removeEventListener('message', onReady);
        resolve();
      }
    };
    window.addEventListener('message', onReady);
    playFrame.src = '/?embed=1';
  });
  const map = structuredClone(ed.history.map);
  frameReady.then(() => {
    playFrame.contentWindow!.postMessage({ type: 'marble:play', map }, '*');
    playFrame.focus();
  });
  renderTop();
}

function stopPlay(): void {
  playFrame.contentWindow?.postMessage({ type: 'marble:stop' }, '*');
  document.body.classList.remove('playing');
  renderTop();
}

window.addEventListener('message', (e) => {
  if (e.source === playFrame.contentWindow && e.data?.type === 'marble:exit') stopPlay();
});

let exporting = false;
async function exportVideo(): Promise<void> {
  if (exporting) return;
  if (ed.errors.length) return toast('Map còn lỗi, chưa xuất được.', 'err');
  if (!(await save())) return;
  const file = ed.history.file!;
  exporting = true;
  logEl.textContent = `Xuất ${file}.mp4 ...\n`;
  try {
    const res = await fetch(`/api/render/${file}`, { method: 'POST' });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (logEl.textContent + decoder.decode(value)).split('\n').filter((l, k, all) => l.trim() || k === all.length - 1);
      logEl.textContent = lines.slice(-12).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    }
    const ok = logEl.textContent.includes('[exit 0]');
    toast(ok ? `Xong: output/${file}.mp4` : 'Xuất video lỗi, xem log', ok ? 'ok' : 'err');
    if (ok) setTimeout(() => (logEl.textContent = ''), 15000);
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    exporting = false;
  }
}

// ---- keyboard ----

window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).matches('input, select, textarea');
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === 's') { e.preventDefault(); save(); return; }
  if (ctrl && e.key === 'Enter') { e.preventDefault(); document.body.classList.contains('playing') ? stopPlay() : startPlay(); return; }
  if (typing) return;
  if (ctrl && key === 'z') { e.preventDefault(); e.shiftKey ? ed.history.redo() : ed.history.undo(); }
  else if (ctrl && key === 'y') { e.preventDefault(); ed.history.redo(); }
  else if (ctrl && key === 'd' && ed.selection?.kind === 'cave') { e.preventDefault(); duplicate(ed.selection.id, false); }
  else if (e.key === 'Escape') { document.body.classList.contains('playing') ? stopPlay() : ed.select(null); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    const s = ed.selection;
    if (s?.kind === 'cave') run(`Xoá hang ${s.id}`, [{ op: 'cave.remove', id: s.id }]);
    if (s?.kind === 'flow') run('Xoá đường nối', [{ op: 'flow.remove', index: s.index }]);
  } else if (e.key.startsWith('Arrow') && ed.selection?.kind === 'cave') {
    e.preventDefault();
    const step = (ed.grid || 1) * (e.shiftKey ? 5 : 1);
    const cave = ed.history.map.caves.find((c) => c.id === (ed.selection as { id: string }).id)!;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const cmds: Command[] = [{ op: 'cave.update', id: cave.id, x: cave.x + dx, y: cave.y + dy }];
    const m = ed.mirror && mirrorOf(ed.history.map, cave);
    if (m) cmds.push({ op: 'cave.update', id: m.id, x: m.x - dx, y: m.y + dy });
    run(`Dời hang ${cave.id}`, cmds);
  }
});

window.addEventListener('beforeunload', (e) => { if (ed.history.dirty) e.preventDefault(); });

// ---- the file changed on disk (a script or another app edited it) ----

import.meta.hot?.on('marble:file', async ({ folder, name }: { folder: string; name: string }) => {
  if (folder !== 'maps' || name !== ed.history.file) return;
  const map = await api<MapDoc>(`maps/${name}`).catch(() => null);
  if (!map) return;
  const text = formatMap(map);
  const h = ed.history;
  if (text === formatMap(h.map)) { h.saved = text; renderTop(); return; }
  if (text === h.saved) return;
  h.replace(map, `Sửa từ ngoài (maps/${name}.json)`, 'file');
  h.saved = text;
  toast('File map vừa được sửa từ bên ngoài, đã nạp lại. Ctrl+Z để quay về bản trước.', 'ok');
});

// ---- the same editor, for code ----

const editorApi = {
  commands: COMMAND_NAMES,
  /** A copy of the current map. */
  get map(): MapDoc { return structuredClone(ed.history.map); },
  get file(): string | null { return ed.history.file; },
  get dirty(): boolean { return ed.history.dirty; },
  /** Runs one command or a list as one undo step. Returns results plus the map's errors and warnings afterwards. */
  run(cmds: Command | Command[], label?: string) {
    const list = Array.isArray(cmds) ? cmds : [cmds];
    try {
      const results = ed.history.run(label ?? list.map((c) => c.op).join(', '), list, 'script');
      return { ok: true, results, errors: ed.errors, warnings: ed.warnings };
    } catch (e) {
      return { ok: false, error: (e as Error).message, commands: COMMAND_NAMES };
    }
  },
  /** Replaces the whole map, as one undo step. */
  load(map: MapDoc, label = 'Thay cả map') {
    ed.history.replace(structuredClone(map), label, 'script');
    return { errors: ed.errors, warnings: ed.warnings };
  },
  check: () => ({ errors: ed.errors, warnings: ed.warnings }),
  undo: () => ed.history.undo()?.label ?? null,
  redo: () => ed.history.redo()?.label ?? null,
  history: () => ed.history.done.map(({ label, source }) => ({ label, source })),
  select: (s: Selection) => ed.select(s),
  open: (name: string) => openMap(name),
  openTemplate: (name: string) => openMap(name, 'templates'),
  /** A new map from a seed. `lock` fixes dishes, e.g. "layout=merge,ending=freeze" (see npm run batch -- --list). */
  generate: (seed?: number, lock?: string) => newGenerated(seed, lock),
  /** The current map with the aspects not in `keep` re-rolled: colors, paint, shapes, roads, effects, ending. */
  remix: (seed?: number, keep: Aspect[] = []) => newGenerated(seed, '', keep),
  save: (name?: string) => save(name),
  saveTemplate: (name: string) => saveTemplate(name),
  play: startPlay,
  stop: stopPlay,
  exportVideo,
};
Object.assign(window, { __editor: editorApi });

// ---- helpers ----

let toastTimer = 0;
function toast(message: string, kind?: 'err' | 'ok'): void {
  toastEl.textContent = message;
  toastEl.className = `show ${kind ?? ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.className = ''), kind === 'err' ? 5000 : 2800);
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map-moi';
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ---- start ----

renderLeft();
const params = new URLSearchParams(location.search);
bind(ed.history);
api<{ name: string; characters: string[] }[]>('packs').then((p) => { ed.packs = p; refresh(); }).catch(() => {});
api<string[]>('targets').then((t) => { ed.targets = t; refresh(); }).catch(() => {});
if (params.get('map')) openMap(params.get('map')!);
else if (params.get('template')) openMap(params.get('template')!, 'templates');
