import { validateMap } from './map/validate.ts';
import { insidePolygon, outline } from './map/geometry.ts';
import { applyTheme } from './map/theme.ts';
import { DEFAULT_DURATION, rockEnd, type MapDoc } from './map/types.ts';
import { Recording, type SceneInfo } from './physics/recording.ts';
import type { FromWorker, ToWorker } from './physics/worker.ts';
import { finalColors, flipColors, startColors } from './paint/paint.ts';
import { Cast } from './actors/cast.ts';
import { View } from './render/view.ts';
import { cameraSize, cameraTrack, needsTrack } from './render/camera.ts';

const FPS = 60;
const params = new URLSearchParams(location.search);
// ?template=<name> opens a file from templates/, ?generated=<name> one from generated/, instead of maps/.
const folder = params.has('template') ? 'templates' : params.has('generated') ? 'generated' : 'maps';
const mapName = params.get('template') ?? params.get('generated') ?? params.get('map') ?? 'three-to-one';
// ?view=x,y,w,h zooms onto part of the frame.
const cropValues = params.get('view')?.split(',').map(Number);
const viewCrop = cropValues?.length === 4 ? { x: cropValues[0], y: cropValues[1], w: cropValues[2], h: cropValues[3] } : undefined;
// ?export=1&scale=2 is what `npm run render` opens in a hidden browser: no HUD, fixed size, frames handed out on request.
const exportScale = params.has('export') ? Number(params.get('scale') ?? 1) : 0;
// ?embed=1 is the editor's test run: the map arrives by postMessage instead of from maps/.
const embed = params.has('embed');
const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const bar = document.getElementById('bar')!;
const barRec = bar.querySelector<HTMLElement>('.rec')!;
const barHead = bar.querySelector<HTMLElement>('.head')!;

let map: MapDoc;
let worker: Worker | null = null;
let scene: SceneInfo | null = null;
let rec: Recording | null = null;
let view: View | null = null;
let startedAt = 0;
let bakeRate = 0;

let playhead = 0;
let playing = false;
let autoPlay = true;
let speed = 1;
let last = performance.now();
let fps = FPS;
let visible = 0;
/** Painting state for maps with a target picture: null while not applicable. */
type PaintState = { status: 'waiting' | 'ready' | 'failed'; painted: number; message?: string };
let paint: PaintState | null = null;
let cast: Cast | null = null;
/** Characters, swaps and pictures depend on the whole run, so such maps only play once the bake is complete. */
let needsFullBake = false;
let finished = false;
/** The run ended while marbles were still landing in their caves. */
let unfinished = false;
/** The map failed validation; the HUD keeps showing why. */
let failed = false;

// Maps come from the dev server's file API rather than an import, so editing a map file never reloads open pages.
async function load(): Promise<boolean> {
  const res = await fetch(`/api/${folder}/${encodeURIComponent(mapName)}`);
  if (!res.ok) {
    const names: string[] = await fetch(`/api/${folder}`).then((r) => r.json()).catch(() => []);
    return fail([`Không có map "${mapName}". Có: ${names.join(', ')}`]);
  }
  const raw: unknown = await res.json();
  const result = validateMap(raw);
  if (!result.map) return fail(result.errors);
  map = applyTheme(result.map);
  // The exporter asks for a longer run when the marbles were still flowing at the end of the last one.
  const duration = Number(params.get('duration'));
  if (duration > 0) map.duration = duration;
  return true;
}

function fail(errors: string[]): false {
  failed = true;
  Object.assign(window, { __marble: { error: errors } });
  hud.innerHTML = `<span class="err">Map lỗi:\n${errors.map((e) => `  • ${e}`).join('\n')}</span>`;
  return false;
}

function bake(): void {
  worker?.terminate();
  view?.dispose();
  scene = rec = view = null;
  failed = false;
  playhead = 0;
  playing = false;
  autoPlay = true;
  paint = map.caves.some((c) => c.paint || c.marbles?.paint) ? { status: 'waiting', painted: 0 } : null;
  needsFullBake = !!paint || map.caves.some((c) => c.marbles?.actors) || !!map.flows?.some((f) => f.swap || f.size || f.shape || f.mix || f.double) || !!map.effects?.sparks || !!map.effects?.shake || (!viewCrop && needsTrack(map.camera));
  finished = false;
  unfinished = false;
  cast = null;
  let done: Extract<FromWorker, { type: 'done' }> | null = null;
  // Runs once both the cast (images) and the finished bake are in.
  const finish = async () => {
    if (!cast || !done || !view) return;
    const r = rec!;
    cast.setSwaps(scene!.machines, done.machineSteps);
    view.setMachines(scene!.machines, done.machineSteps, done.cloneOf);
    view.effects?.setPaintFrames(done.paintSteps);
    view.effects?.setSounds(done.sounds, r.totalFrames);
    cast.setHits(done.sounds);
    if (paint) await applyPaint(r, done.paintSteps);
    unfinished = !exportScale && !!arrivals(r);
    if (!viewCrop && needsTrack(map.camera)) view.setCamera(cameraTrack(map, r));
    finished = true;
    if (exportScale) publishForExport(r, done.sounds);
  };
  startedAt = performance.now();
  worker = new Worker(new URL('./physics/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    if (msg.type === 'scene') {
      const s = (scene = msg.scene);
      rec = new Recording(s.marbleColors.length, s.totalFrames);
      Cast.load(map, s.marbleCaves, s.machines).then((c) => {
        if (scene !== s) return;
        cast = c;
        const { w, h } = cameraSize(map);
        // A camera smaller than the frame starts on the top-left until its track is ready.
        const crop = viewCrop ?? (w !== map.frame.width || h !== map.frame.height ? { x: 0, y: 0, w, h } : undefined);
        view = new View(app, s, c, { crop, exportScale, effects: map.effects, ending: map.ending, spin: map.spin, rock: map.rock, look: map.look, captions: map });
        finish();
      });
    } else if (msg.type === 'batch') {
      rec!.addBatch(msg.data, msg.walls, msg.stuck);
      bakeRate = rec!.frames / ((performance.now() - startedAt) / 1000);
    } else {
      rec!.done = true;
      rec!.report = msg.report;
      rec!.paintFrames = msg.paintSteps;
      done = msg;
      finish();
    }
  };
  worker.postMessage({ type: 'start', map, duration: map.duration ?? DEFAULT_DURATION } satisfies ToWorker);
}

export interface ExportHandle {
  ready: true;
  name: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  /** False when marbles were still flowing when the run ended: the exporter then runs it again for longer. */
  settled: boolean;
  /** Seconds this run was baked for, and roughly how long it would need for the marbles to settle. */
  duration: number;
  needed: number;
  report: unknown;
  paint: PaintState | null;
  /** Hit sound set for the soundtrack. */
  sound: string;
  /** [frame, marble, x, strength] per impact. */
  sounds: number[];
  /** Per impact: the character's sound file under public/, or "" for the default tick. */
  voices: string[];
  frames(start: number, count: number): string[];
}

/** A little stillness after the last marble settles before the video ends. */
const TAIL_SECONDS = 2;
/** Seconds each timed effect needs to play out after it starts. */
const ENDING_SECONDS = 4;
const ZOOM_SECONDS = 2.5;
const FLIP_SECONDS = 1;

// The exported video stops shortly after the pile comes to rest, so it never sits frozen waiting for `duration`.
// It only ever gets shorter, and never cuts into a scripted moment (an event, zoom, flip, ending, spin or rock).
function videoFrames(r: Recording): { frames: number; settled: boolean; needed: number } {
  const step = 6;
  const allowed = Math.max(3, Math.ceil(r.marbleCount * 0.002));
  const a = { x: 0, y: 0, angle: 0 };
  const b = { x: 0, y: 0, angle: 0 };
  let settled = 0;
  for (let f = r.totalFrames - 1; f >= step; f -= step) {
    let moving = 0;
    for (let i = 0; i < r.marbleCount && moving <= allowed; i++) {
      if (r.marble(f, i, a) && r.marble(f - step, i, b) && Math.hypot(a.x - b.x, a.y - b.y) > 3) moving++;
    }
    if (moving > allowed) { settled = f; break; }
  }
  const scripted = Math.max(
    0,
    ...map.events.map((e) => e.t),
    map.ending ? map.ending.t + ENDING_SECONDS : 0,
    map.camera?.zoom ? map.camera.zoom.t + ZOOM_SECONDS : 0,
    ...map.caves.map((c) => (c.paint?.flip ? c.paint.flip.t + FLIP_SECONDS : 0)),
    map.spin ? map.spin.until ?? Infinity : 0,
    map.rock ? rockEnd(map.rock) : 0,
  );
  const end = Math.max(settled, scripted * FPS) + TAIL_SECONDS * FPS;
  const run = (r.totalFrames - 1) / FPS;
  if (end <= r.totalFrames) return { frames: Math.ceil(end), settled: true, needed: run };
  const arriving = arrivals(r);
  return { frames: r.totalFrames, settled: !arriving, needed: arriving ? run + arriving.seconds : run };
}

// Marbles still landing in the caves they end up in (ones never opened), and roughly how many more seconds that
// takes at the current rate. A map that only circles marbles between open caves never settles, and running it
// longer would not finish anything, so it reports nothing.
function arrivals(r: Recording): { seconds: number } | null {
  const opened = new Set(map.events.filter((e) => e.do === 'valve.open').map((e) => e.cave));
  const targets = map.caves.filter((c) => !opened.has(c.id)).map((c) => outline(c));
  if (!targets.length) return null;
  const m = { x: 0, y: 0, angle: 0 };
  const count = (f: number) => {
    let n = 0;
    for (let i = 0; i < r.marbleCount; i++) if (r.marble(f, i, m) && targets.some((poly) => insidePolygon(m, poly))) n++;
    return n;
  };
  const last = r.totalFrames - 1;
  const now = count(last);
  const perSecond = (now - count(Math.max(0, last - 2 * FPS))) / 2;
  if (perSecond <= 0) return null;
  return { seconds: ((r.marbleCount - now) / perSecond) * 1.2 + 3 };
}

function publishForExport(r: Recording, sounds: Int32Array): void {
  const { frames: total, settled, needed } = videoFrames(r);
  const handle: ExportHandle = {
    settled,
    needed,
    duration: map.duration ?? DEFAULT_DURATION,
    ready: true,
    name: map.name,
    fps: FPS,
    width: cameraSize(map).w,
    height: cameraSize(map).h,
    totalFrames: total,
    report: r.report,
    paint,
    sound: map.sound ?? 'tick',
    sounds: Array.from(sounds),
    voices: Array.from({ length: sounds.length / 4 }, (_, k) => cast!.soundOf(cast!.characterAt(sounds[k * 4 + 1], sounds[k * 4]), 'hit') ?? ''),
    frames(start, count) {
      const out: string[] = [];
      for (let i = start; i < Math.min(start + count, total); i++) {
        view!.render(r, i);
        out.push(view!.snapshot());
      }
      return out;
    },
  };
  Object.assign(window, { __marble: handle });
}

async function applyPaint(r: Recording, frames: Int32Array): Promise<void> {
  try {
    const colors = await finalColors(map, r);
    const flip = await flipColors(map, r);
    const start = await startColors(map, r);
    if (r !== rec) return;
    if (start) view!.setStart(start);
    view!.setPaint(colors, frames);
    view!.setFlip(flip);
    let painted = 0;
    for (let i = 0; i < colors.length; i++) if (colors[i] >= 0 && frames[i] >= 0) painted++;
    paint = { status: 'ready', painted };
  } catch (e) {
    paint = { status: 'failed', painted: 0, message: (e as Error).message };
  }
}

// Start on our own once the rest of the bake will finish before playback reaches it.
function canPlayThrough(r: Recording): boolean {
  // A picture only exists once the whole run is known, so painted maps wait for the full bake.
  if (needsFullBake) return finished;
  if (r.done) return true;
  if (bakeRate <= 0 || r.frames < FPS) return false;
  const secondsToFinish = (r.totalFrames - r.frames) / bakeRate;
  const secondsOfPlayback = (r.totalFrames - playhead) / (FPS * speed);
  return secondsToFinish <= secondsOfPlayback;
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (rec && view && rec.frames > 0) {
    if (autoPlay && !playing && canPlayThrough(rec)) playing = true;
    if (playing) playhead = Math.min(playhead + dt * FPS * speed, rec.frames - 1);
    if (playing && playhead >= rec.totalFrames - 1) playing = false;
    visible = view.render(rec, Math.floor(playhead));
  }
  drawHud();
  requestAnimationFrame(frame);
}

function drawHud(): void {
  if (failed) return;
  if (!map) {
    hud.textContent = 'Đợi map từ editor...';
    return;
  }
  if (!rec || !scene) {
    hud.textContent = `${map.name}\nĐang dựng map...`;
    return;
  }
  const total = rec.totalFrames;
  const buffering = playing && !rec.done && playhead >= rec.frames - 1;
  const bakeLine = rec.done
    ? `Tính trước: xong (${(rec.totalFrames / bakeRate).toFixed(1)} s, nhanh x${(bakeRate / FPS).toFixed(2)} so với thời gian thật)`
    : `Tính trước: ${Math.floor((rec.frames / total) * 100)}%   tốc độ x${(bakeRate / FPS).toFixed(2)} so với thời gian thật`;
  const state = buffering ? '   [ĐỢI TÍNH]' : playing ? '' : autoPlay && playhead === 0 ? '   [ĐỢI ĐỦ ĐỆM]' : '   [DỪNG]';
  const lost = scene.firstSpare - visible;
  const stuck = rec.stuckAt(Math.floor(playhead))?.reduce((n, s) => n + s, 0) ?? 0;
  const report = rec.report;
  const lines = [
    map.name,
    `FPS ${fps.toFixed(0).padStart(3)}   bi ${visible}${lost ? ` (thất lạc ${lost})` : ''}${stuck ? `   <span class="err">kẹt ${stuck}</span>` : ''}   x${speed}${state}`,
    `t ${(playhead / FPS).toFixed(2)} / ${((total - 1) / FPS).toFixed(0)} s   khung #${Math.floor(playhead)}`,
    bakeLine,
  ];
  if (report) {
    const verdict = report.stuck || report.lost || report.unpainted ? 'err' : 'ok';
    const caves = Object.entries(report.caves).map(([id, n]) => `${id} ${n}`).join(' · ');
    lines.push(`<span class="${verdict}">Cuối video: kẹt ${report.stuck} · thất lạc ${report.lost} · ngoài hang ${report.outside}</span>`, `  trong hang: ${caves}`);
  }
  if (paint) {
    lines.push(
      paint.status === 'waiting' ? `Ghép hình: đợi tính xong cả video${bakeRate > 0 ? `, còn khoảng ${Math.ceil((total - rec.frames) / bakeRate)} giây` : ''}...`
      : paint.status === 'failed' ? `<span class="err">Ghép hình lỗi: ${paint.message}</span>`
      : `Ghép hình: ${paint.painted} bi được sơn${report?.unpainted ? `, <span class="err">${report.unpainted} bi trong hang đích chưa qua máy sơn</span>` : ''}`,
    );
  }
  if (unfinished) lines.push(`<span class="warn">⚠ Hết ${((total - 1) / FPS).toFixed(0)} s mà bi vẫn còn chảy. Xuất video sẽ tự kéo dài cho xong; muốn xem hết ở đây thì tăng Dài (giây).</span>`);
  lines.push(`Space chạy/dừng · ← → tua 1s · , . từng khung · F x4 · R xem lại · Shift+R tính lại · H ẩn bảng này`);
  hud.innerHTML = lines.join('\n') + [...scene.warnings, ...(cast?.warnings ?? [])].map((w) => `\n<span class="warn">⚠ ${w}</span>`).join('');
  barRec.style.width = `${(rec.frames / total) * 100}%`;
  barHead.style.left = `${(playhead / (total - 1)) * 100}%`;
}

function seek(f: number): void {
  if (!rec) return;
  playhead = Math.max(0, Math.min(f, rec.frames - 1));
  autoPlay = false;
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { playing = !playing; autoPlay = false; }
  else if (e.key === 'ArrowRight') seek(playhead + FPS);
  else if (e.key === 'ArrowLeft') seek(playhead - FPS);
  else if (e.key === '.') { playing = false; seek(playhead + 1); }
  else if (e.key === ',') { playing = false; seek(playhead - 1); }
  else if (e.key === 'f' || e.key === 'F') speed = speed === 1 ? 4 : 1;
  else if (e.key === 'R') bake();
  else if (e.key === 'r') { seek(0); playing = true; }
  else if (e.key === 'h' || e.key === 'H') hud.style.display = hud.style.display ? '' : 'none';
});

let dragging = false;
const seekFromBar = (e: PointerEvent) => {
  if (!rec) return;
  const box = bar.getBoundingClientRect();
  seek(((e.clientX - box.left) / box.width) * (rec.totalFrames - 1));
};
bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); seekFromBar(e); });
bar.addEventListener('pointermove', (e) => { if (dragging) seekFromBar(e); });
bar.addEventListener('pointerup', () => { dragging = false; });

if (exportScale) {
  hud.remove();
  bar.remove();
}
if (embed) {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== parent) return;
    if (e.data?.type === 'marble:play') {
      const result = validateMap(e.data.map);
      if (!result.map) {
        worker?.terminate();
        view?.dispose();
        rec = scene = view = null;
        fail(result.errors);
        return;
      }
      map = applyTheme(result.map);
      bake();
    } else if (e.data?.type === 'marble:stop') {
      worker?.terminate();
      playing = false;
      autoPlay = false;
    }
  });
  // Esc hands control back to the editor.
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') parent.postMessage({ type: 'marble:exit' }, '*'); });
  requestAnimationFrame(frame);
  parent.postMessage({ type: 'marble:ready' }, '*');
} else if (await load()) {
  bake();
  if (!exportScale) requestAnimationFrame(frame);
}
