// The drawing area: shows the carved ground and every part, and turns mouse drags into map edits.
import { dist, insidePolygon, outline, outlineYAt, type Pt } from '../map/geometry.ts';
import { MACHINES, moverPosition, type MachineKind, type Layout } from '../map/layout.ts';
import { applyTheme } from '../map/theme.ts';
import type { Cave, MapDoc } from '../map/types.ts';
import { mirrorOf } from './commands.ts';
import type { History } from './history.ts';

export type Selection = { kind: 'cave'; id: string } | { kind: 'flow'; index: number } | null;

export interface Host {
  history: History;
  layout: Layout | null;
  errors: string[];
  selection: Selection;
  /** Snap step in px, 0 for none. */
  grid: number;
  mirror: boolean;
  select(s: Selection): void;
  /** The map was changed in place during a drag. */
  changed(): void;
  toast(message: string, kind?: 'err' | 'ok'): void;
  drop(item: string, at: Pt): void;
}

type Hit =
  | { t: 'radius'; cave: Cave }
  | { t: 'valve'; cave: Cave; index: number }
  | { t: 'connect'; cave: Cave }
  | { t: 'via'; flow: number; k: number }
  | { t: 'machine'; flow: number; kind: MachineKind }
  | { t: 'cave'; cave: Cave }
  | { t: 'flow'; flow: number };

type Drag =
  | { t: 'pan'; from: Pt; ox: number; oy: number; moved: boolean }
  | { t: 'move'; id: string; dx: number; dy: number; partner?: string }
  | { t: 'radius'; id: string; partner?: string }
  | { t: 'valve'; id: string; index: number; partner?: string }
  | { t: 'connect'; id: string; to: Pt }
  | { t: 'via'; flow: number; k: number }
  | { t: 'machine'; flow: number; kind: MachineKind };

const PAINT_LABELS: Record<string, string> = { image: 'ảnh', rainbow: 'cầu vồng', gradient: 'chuyển màu', stripes: 'sọc', checker: 'ô cờ', depth: 'độ sâu' };
const ACCENT = '#7aa2ff';
const DANGER = '#ff5c6c';
const PAINT = '#ffd23f';
const SWAP = '#e07bff';
const SIZE = '#4dd98b';
const CONNECT_GAP = 26;

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly host: Host;
  private scale = 0.4;
  private ox = 0;
  private oy = 0;
  private drag: Drag | null = null;
  private hover: Hit | null = null;
  private ground: { layout: Layout; image: HTMLCanvasElement } | null = null;
  private queued = false;

  constructor(canvas: HTMLCanvasElement, host: Host) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.host = host;
    new ResizeObserver(() => this.redraw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('dblclick', (e) => this.doubleClick(e));
    canvas.addEventListener('contextmenu', (e) => this.rightClick(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.dataTransfer?.getData('text/plain');
      if (item) host.drop(item, this.snap(this.world(e)));
    });
  }

  private get map(): MapDoc {
    return this.host.history.map;
  }

  /** Fits the whole frame in view. */
  fit(): void {
    const { width, height } = this.map.frame;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.scale = Math.min((w - 40) / width, (h - 40) / height);
    this.ox = (w - width * this.scale) / 2;
    this.oy = (h - height * this.scale) / 2;
    this.redraw();
  }

  /** Centre of what is on screen, in frame pixels. */
  center(): Pt {
    return this.snap({ x: (this.canvas.clientWidth / 2 - this.ox) / this.scale, y: (this.canvas.clientHeight / 2 - this.oy) / this.scale });
  }

  redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  // ---- drawing ----

  private draw(): void {
    const { canvas, ctx, map } = this;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
    const themed = applyTheme(map);
    const { width: fw, height: fh, background } = themed.frame;
    // The caves are holes in the ground: the video shows the backdrop through them, so the editor does too.
    const backdrop = themed.look?.backdrop;
    if (backdrop?.length) {
      const g = ctx.createLinearGradient(0, 0, 0, fh);
      g.addColorStop(0, backdrop[0]);
      g.addColorStop(1, backdrop[backdrop.length - 1]);
      ctx.fillStyle = g;
    } else ctx.fillStyle = background;
    ctx.fillRect(0, 0, fw, fh);

    const layout = this.host.layout;
    if (layout) {
      if (this.ground?.layout !== layout) this.ground = { layout, image: groundImage(layout, map) };
      ctx.imageSmoothingEnabled = true;
      // Image pixel i holds the field node at i * cell, so shift by half a cell to centre it there.
      const { cols, rows, cell } = layout.field;
      ctx.drawImage(this.ground.image, -cell / 2, -cell / 2, cols * cell, rows * cell);
    }
    this.drawGrid(fw, fh);
    if (this.host.mirror) {
      this.line([{ x: fw / 2, y: 0 }, { x: fw / 2, y: fh }], 'rgba(122,162,255,.45)', 2, [16, 12]);
    }
    if (layout) {
      for (const m of layout.movers) {
        const p = moverPosition(m, 0);
        ctx.fillStyle = m.color;
        ctx.beginPath();
        m.points.forEach((q, k) => (k ? ctx.lineTo(p.x + q.x, p.y + q.y) : ctx.moveTo(p.x + q.x, p.y + q.y)));
        ctx.fill();
      }
      for (const g of layout.gates) this.line([g.a, g.b], g.color, 8);
      for (const w of layout.wheels) {
        for (let k = 0; k < w.arms; k++) {
          const a = (2 * Math.PI * k) / w.arms;
          this.line([{ x: w.x + Math.cos(a) * w.hub, y: w.y + Math.sin(a) * w.hub }, { x: w.x + Math.cos(a) * w.r, y: w.y + Math.sin(a) * w.r }], w.color, 6);
        }
      }
      ctx.fillStyle = '#8e97ab';
      for (const g of layout.pegs) {
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // A portal pair: two rings joined by a faint dotted line so it is clear which entry leads where.
      for (const p of layout.portals) {
        this.line([p.entry, p.exit], 'rgba(176,107,255,.35)', 2, [3, 9]);
        for (const c of [p.entry, p.exit]) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(c.x, c.y, p.r + 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    const sel = this.host.selection;
    const broken = brokenCaves(map, this.host.errors);
    (map.flows ?? []).forEach((f, i) => {
      const route = layout?.routes[i];
      if (!route) return;
      const selected = sel?.kind === 'flow' && sel.index === i;
      const hovered = this.hover?.t === 'flow' && this.hover.flow === i;
      this.line(route, selected ? ACCENT : hovered ? 'rgba(122,162,255,.8)' : 'rgba(255,255,255,.28)', selected ? 5 : 3, [14, 10]);
      this.arrow(route, selected ? ACCENT : 'rgba(255,255,255,.5)');
      if (selected && f.kind === 'pipe') {
        (f.via ?? []).forEach(([x, y]) => this.handle({ x, y }, ACCENT, 'square'));
      }
    });
    for (const m of layout?.machines ?? []) {
      const { color, letter } = MACHINES[m.kind];
      this.line([m.a, m.b], color, 7);
      this.handle({ x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 }, color, 'round', letter);
    }

    for (const cave of map.caves) {
      const selected = sel?.kind === 'cave' && sel.id === cave.id;
      const hovered = (this.hover && 'cave' in this.hover && this.hover.cave === cave) || (this.drag?.t === 'connect' && this.caveAt(this.drag.to) === cave && cave.id !== this.drag.id);
      const pts = outline(cave);
      if (cave.marbles?.count) this.fillPolygon(pts, cave.marbles.colors[0] + '33');
      if (broken.has(cave.id)) this.polygon(pts, DANGER, 4, [10, 8]);
      else if (selected || hovered) this.polygon(pts, ACCENT, selected ? 4 : 2);
      else this.polygon(pts, 'rgba(255,255,255,.22)', 1.5);
      this.label(cave);
      this.handle({ x: cave.x, y: bottomOf(cave) + CONNECT_GAP }, hovered || selected ? ACCENT : 'rgba(255,255,255,.35)', 'round', '+');
      if (selected) {
        this.handle({ x: cave.x + cave.shape.radius, y: cave.y }, ACCENT, 'round');
        (cave.valves ?? []).forEach((v) => {
          const x = cave.x + (v.x ?? 0);
          this.handle({ x, y: outlineYAt(cave, x, 'bottom') ?? cave.y + cave.shape.radius }, '#c9d0de', 'square');
        });
      }
    }

    if (this.drag?.t === 'connect') {
      const from = this.map.caves.find((c) => c.id === (this.drag as { id: string }).id)!;
      this.line([{ x: from.x, y: bottomOf(from) + CONNECT_GAP }, this.drag.to], ACCENT, 3, [10, 8]);
    }
  }

  private drawGrid(fw: number, fh: number): void {
    const g = this.host.grid;
    if (!g || g * this.scale < 6) return;
    const step = g * this.scale < 12 ? g * 5 : g;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let x = 0; x <= fw; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, fh); }
    for (let y = 0; y <= fh; y += step) { ctx.moveTo(0, y); ctx.lineTo(fw, y); }
    ctx.stroke();
  }

  private label(cave: Cave): void {
    const { ctx } = this;
    const px = 1 / this.scale;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${20 * px}px system-ui, sans-serif`;
    ctx.fillText(cave.id, cave.x, cave.y);
    const notes = [
      cave.marbles?.count ? `${cave.marbles.count} bi` : '',
      cave.marbles?.actors ? cave.marbles.actors.pack : '',
      cave.marbles?.paint ? 'hình lúc đầu' : '',
      cave.paint ? `ghép ${PAINT_LABELS[cave.paint.mode]}` : '',
    ].filter(Boolean);
    if (notes.length) {
      ctx.font = `${13 * px}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillText(notes.join(' · '), cave.x, cave.y + 22 * px);
    }
  }

  private handle(p: Pt, color: string, shape: 'round' | 'square', text?: string): void {
    const { ctx } = this;
    const r = 8 / this.scale;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0b0d12';
    ctx.lineWidth = 2 / this.scale;
    ctx.beginPath();
    if (shape === 'round') ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    else ctx.rect(p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6);
    ctx.fill();
    ctx.stroke();
    if (text) {
      ctx.fillStyle = '#0b0d12';
      ctx.font = `700 ${11 / this.scale}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x, p.y + 0.5 / this.scale);
    }
  }

  private line(pts: Pt[], color: string, width: number, dash: number[] = []): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width / this.scale;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash.map((d) => d / this.scale));
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private arrow(route: Pt[], color: string): void {
    const a = route[route.length - 2];
    const b = route[route.length - 1];
    if (!a || !b) return;
    const len = dist(a, b) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const s = 12 / this.scale;
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ux * s * 1.6 - uy * s, b.y - uy * s * 1.6 + ux * s);
    ctx.lineTo(b.x - ux * s * 1.6 + uy * s, b.y - uy * s * 1.6 - ux * s);
    ctx.fill();
  }

  private polygon(pts: Pt[], color: string, width: number, dash: number[] = []): void {
    this.line([...pts, pts[0]], color, width, dash);
  }

  private fillPolygon(pts: Pt[], color: string): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.fill();
  }

  // ---- input ----

  private world(e: { clientX: number; clientY: number }): Pt {
    const box = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - box.left - this.ox) / this.scale, y: (e.clientY - box.top - this.oy) / this.scale };
  }

  private snap(p: Pt): Pt {
    const g = this.host.grid;
    return g ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : { x: Math.round(p.x), y: Math.round(p.y) };
  }

  caveAt(p: Pt): Cave | undefined {
    return [...this.map.caves].reverse().find((c) => insidePolygon(p, outline(c)));
  }

  private hit(p: Pt): Hit | null {
    const near = (q: Pt, px = 11) => dist(p, q) <= px / this.scale;
    const map = this.map;
    const sel = this.host.selection;
    const layout = this.host.layout;
    if (sel?.kind === 'cave') {
      const cave = map.caves.find((c) => c.id === sel.id);
      if (cave) {
        if (near({ x: cave.x + cave.shape.radius, y: cave.y })) return { t: 'radius', cave };
        const k = (cave.valves ?? []).findIndex((v) => {
          const x = cave.x + (v.x ?? 0);
          return near({ x, y: outlineYAt(cave, x, 'bottom') ?? cave.y });
        });
        if (k >= 0) return { t: 'valve', cave, index: k };
      }
    }
    if (sel?.kind === 'flow') {
      const k = (map.flows?.[sel.index]?.via ?? []).findIndex(([x, y]) => near({ x, y }));
      if (k >= 0) return { t: 'via', flow: sel.index, k };
    }
    for (const m of layout?.machines ?? []) {
      if (near({ x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 })) return { t: 'machine', flow: m.flow, kind: m.kind };
    }
    for (const cave of map.caves) if (near({ x: cave.x, y: bottomOf(cave) + CONNECT_GAP })) return { t: 'connect', cave };
    const cave = this.caveAt(p);
    if (cave) return { t: 'cave', cave };
    const flow = this.flowAt(p);
    return flow >= 0 ? { t: 'flow', flow } : null;
  }

  /** Index of the flow whose route passes within a few pixels of p, or -1. */
  flowAt(p: Pt, px = 12): number {
    const routes = this.host.layout?.routes ?? [];
    let best = -1;
    let bestD = px / this.scale;
    routes.forEach((r, i) => {
      if (!r) return;
      const d = project(r, p).d;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /** Fraction along a flow's route nearest to p. */
  fractionOn(flow: number, p: Pt): number {
    const r = this.host.layout?.routes[flow];
    return r ? project(r, p).f : 0.5;
  }

  private down(e: PointerEvent): void {
    if (e.button === 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.world(e);
    const hit = e.button === 1 ? null : this.hit(p);
    const { history, mirror } = this.host;
    const partner = (cave: Cave) => (mirror ? mirrorOf(this.map, cave)?.id : undefined);
    if (!hit) {
      this.drag = { t: 'pan', from: { x: e.clientX, y: e.clientY }, ox: this.ox, oy: this.oy, moved: false };
      return;
    }
    if (hit.t === 'cave' || hit.t === 'radius' || hit.t === 'valve') this.host.select({ kind: 'cave', id: hit.cave.id });
    if (hit.t === 'flow' || hit.t === 'via' || hit.t === 'machine') this.host.select({ kind: 'flow', index: hit.flow });
    switch (hit.t) {
      case 'cave':
        history.begin(`Dời hang ${hit.cave.id}`);
        this.drag = { t: 'move', id: hit.cave.id, dx: hit.cave.x - p.x, dy: hit.cave.y - p.y, partner: partner(hit.cave) };
        break;
      case 'radius':
        history.begin(`Đổi cỡ hang ${hit.cave.id}`);
        this.drag = { t: 'radius', id: hit.cave.id, partner: partner(hit.cave) };
        break;
      case 'valve':
        history.begin(`Dời van hang ${hit.cave.id}`);
        this.drag = { t: 'valve', id: hit.cave.id, index: hit.index, partner: partner(hit.cave) };
        break;
      case 'connect':
        this.drag = { t: 'connect', id: hit.cave.id, to: p };
        break;
      case 'via':
        history.begin('Dời điểm uốn ống');
        this.drag = { t: 'via', flow: hit.flow, k: hit.k };
        break;
      case 'machine':
        history.begin(`Dời ${MACHINES[hit.kind].name.toLowerCase()}`);
        this.drag = { t: 'machine', flow: hit.flow, kind: hit.kind };
        break;
      case 'flow':
        this.drag = null;
        break;
    }
  }

  private move(e: PointerEvent): void {
    const p = this.world(e);
    const d = this.drag;
    if (!d) {
      const hit = this.hit(p);
      if (JSON.stringify(hit && { ...hit, cave: 'cave' in hit ? hit.cave.id : undefined }) !== JSON.stringify(this.hover && { ...this.hover, cave: 'cave' in this.hover ? this.hover.cave.id : undefined })) {
        this.hover = hit;
        this.redraw();
      }
      this.canvas.style.cursor = !hit ? 'grab' : hit.t === 'connect' ? 'crosshair' : hit.t === 'flow' ? 'pointer' : 'move';
      return;
    }
    const map = this.map;
    const cave = (id?: string) => map.caves.find((c) => c.id === id);
    const W = map.frame.width;
    switch (d.t) {
      case 'pan':
        this.ox = d.ox + e.clientX - d.from.x;
        this.oy = d.oy + e.clientY - d.from.y;
        d.moved ||= Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) > 3;
        this.redraw();
        return;
      case 'move': {
        const q = this.snap({ x: p.x + d.dx, y: p.y + d.dy });
        const c = cave(d.id)!;
        c.x = q.x;
        c.y = q.y;
        const m = cave(d.partner);
        if (m) { m.x = W - q.x; m.y = q.y; }
        break;
      }
      case 'radius': {
        const c = cave(d.id)!;
        const r = Math.max(30, Math.round(dist(p, c) / 5) * 5);
        c.shape.radius = r;
        const m = cave(d.partner);
        if (m) m.shape.radius = r;
        break;
      }
      case 'valve': {
        const c = cave(d.id)!;
        const x = this.snap(p).x - c.x;
        const v = c.valves![d.index];
        if (x) v.x = x; else delete v.x;
        const mv = cave(d.partner)?.valves?.[d.index];
        if (mv) { if (x) mv.x = -x; else delete mv.x; }
        break;
      }
      case 'connect':
        d.to = p;
        this.redraw();
        return;
      case 'via': {
        const q = this.snap(p);
        map.flows![d.flow].via![d.k] = [q.x, q.y];
        break;
      }
      case 'machine': {
        const f = map.flows![d.flow];
        const at = Math.round(Math.max(0.05, Math.min(0.95, this.fractionOn(d.flow, p))) * 100) / 100;
        (f as unknown as Record<string, object>)[d.kind] = { ...(f[d.kind] as object), at };
        break;
      }
    }
    this.host.changed();
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const { history } = this.host;
    if (d.t === 'pan') {
      if (!d.moved) this.host.select(null);
      return;
    }
    if (d.t === 'connect') {
      const target = this.caveAt(this.world(e));
      if (target && target.id !== d.id) this.connect(d.id, target.id);
      this.redraw();
      return;
    }
    history.end();
  }

  /** Makes a flow between two caves, and the mirrored one too when mirror mode is on. */
  connect(from: string, to: string): void {
    const { history } = this.host;
    const cmds: Parameters<History['run']>[1] = [{ op: 'flow.add', from, to }];
    if (this.host.mirror) {
      const map = this.map;
      const src = map.caves.find((c) => c.id === from)!;
      const tgt = map.caves.find((c) => c.id === to)!;
      const ms = mirrorOf(map, src);
      const mt = mirrorOf(map, tgt) ?? (Math.abs(tgt.x - map.frame.width / 2) < 1 ? tgt : undefined);
      if (ms && mt && ms !== src) cmds.push({ op: 'flow.add', from: ms.id, to: mt.id });
    }
    try {
      const [index] = history.run(`Nối ${from} → ${to}`, cmds);
      this.host.select({ kind: 'flow', index: index as number });
    } catch (err) {
      this.host.toast((err as Error).message, 'err');
    }
  }

  // Double-click on a selected pipe adds a bend point where it lengthens the pipe least.
  private doubleClick(e: MouseEvent): void {
    const sel = this.host.selection;
    const p = this.snap(this.world(e));
    const index = sel?.kind === 'flow' ? sel.index : this.flowAt(p);
    const flow = this.map.flows?.[index];
    const route = this.host.layout?.routes[index];
    if (!flow || !route) return;
    if (flow.kind !== 'pipe') {
      this.host.toast('Chỉ ống (pipe) mới có điểm uốn. Đổi kiểu đường nối ở bảng bên phải.');
      return;
    }
    const via = flow.via ?? [];
    const chain = [route[0], ...via.map(([x, y]) => ({ x, y })), route[route.length - 1]];
    let best = 0;
    let cost = Infinity;
    for (let k = 0; k < chain.length - 1; k++) {
      const c = dist(chain[k], p) + dist(p, chain[k + 1]) - dist(chain[k], chain[k + 1]);
      if (c < cost) { cost = c; best = k; }
    }
    const next = [...via];
    next.splice(best, 0, [p.x, p.y]);
    this.host.history.run('Thêm điểm uốn ống', [{ op: 'flow.update', index, via: next }]);
    this.host.select({ kind: 'flow', index });
  }

  // Right-click on a bend point removes it.
  private rightClick(e: MouseEvent): void {
    e.preventDefault();
    const hit = this.hit(this.world(e));
    if (hit?.t !== 'via') return;
    const via = [...this.map.flows![hit.flow].via!];
    via.splice(hit.k, 1);
    this.host.history.run('Bỏ điểm uốn ống', [{ op: 'flow.update', index: hit.flow, via: via.length ? via : null }]);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const box = this.canvas.getBoundingClientRect();
    const sx = e.clientX - box.left;
    const sy = e.clientY - box.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(0.1, Math.min(4, this.scale * k));
    this.ox = sx - ((sx - this.ox) * scale) / this.scale;
    this.oy = sy - ((sy - this.oy) * scale) / this.scale;
    this.scale = scale;
    this.redraw();
  }
}

function bottomOf(cave: Cave): number {
  return Math.max(...outline(cave).map((p) => p.y));
}

// Nearest point on a polyline: distance and fraction of the way along it.
function project(route: Pt[], p: Pt): { d: number; f: number } {
  let total = 0;
  let best = { d: Infinity, at: 0 };
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const len = dist(a, b);
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const d = dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (d < best.d) best = { d, at: total + len * t };
    total += len;
  }
  return { d: best.d, f: total ? best.at / total : 0 };
}

// Cave ids named in error messages ("hang A", "A→B"), so the editor can outline them in red.
function brokenCaves(map: MapDoc, errors: string[]): Set<string> {
  const out = new Set<string>();
  for (const c of map.caves) {
    const id = c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(hang "?${id}"?(?![\\w])|(?<![\\w])${id}→|→${id}(?![\\w]))`);
    if (errors.some((e) => re.test(e))) out.add(c.id);
  }
  return out;
}

// The ground at field resolution: solid nodes in the ground colour with a rim near the outline.
function groundImage(layout: Layout, map: MapDoc): HTMLCanvasElement {
  const { field } = layout;
  const ground = { color: '#1b2030', rim: '#8e97ab', rimWidth: 3, ...applyTheme(map).ground };
  const fill = rgb(ground.color);
  const rim = rgb(ground.rim);
  const canvas = document.createElement('canvas');
  canvas.width = field.cols;
  canvas.height = field.rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(field.cols, field.rows);
  const rimWidth = Math.max(ground.rimWidth, field.cell * 1.2);
  for (let k = 0; k < field.d.length; k++) {
    const d = field.d[k];
    if (d <= -field.cell / 2) continue;
    const c = d < rimWidth ? rim : fill;
    img.data[k * 4] = c[0];
    img.data[k * 4 + 1] = c[1];
    img.data[k * 4 + 2] = c[2];
    img.data[k * 4 + 3] = d <= 0 ? 160 : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

