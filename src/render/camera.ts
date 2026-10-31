// Works out where the camera looks in every frame, once the whole run is baked: it follows the moving
// marbles and can zoom onto a cave at the end. Everything comes from the recording, so exports are repeatable.
import { STEP } from '../core/time.ts';
import type { Camera, MapDoc } from '../map/types.ts';
import type { Decoded, Recording } from '../physics/recording.ts';
import type { Crop } from './view.ts';

/** A marble moving more than this many px per frame counts as moving. */
const MOVING = 0.6;
/** Share of the gap to the target the camera closes each frame. */
const FOLLOW = 0.03;
const ZOOM_SECONDS = 2;

export function cameraSize(map: MapDoc): { w: number; h: number } {
  return { w: map.camera?.width ?? map.frame.width, h: map.camera?.height ?? map.frame.height };
}

export function needsTrack(cam: Camera | undefined): boolean {
  return !!cam && (!!cam.follow || !!cam.zoom);
}

/** x, y, w, h per frame. */
export function cameraTrack(map: MapDoc, rec: Recording): Float32Array {
  const cam = map.camera ?? {};
  const { w, h } = cameraSize(map);
  const { width: fw, height: fh } = map.frame;
  const out = new Float32Array(rec.totalFrames * 4);
  const a: Decoded = { x: 0, y: 0, angle: 0 };
  const b: Decoded = { x: 0, y: 0, angle: 0 };

  const centre = (frame: number, prev: { x: number; y: number }) => {
    let sx = 0, sy = 0, n = 0, ax = 0, ay = 0, all = 0;
    for (let i = 0; i < rec.marbleCount; i++) {
      if (!rec.marble(frame, i, a)) continue;
      ax += a.x; ay += a.y; all++;
      if (frame > 0 && rec.marble(frame - 1, i, b) && Math.hypot(a.x - b.x, a.y - b.y) > MOVING) { sx += a.x; sy += a.y; n++; }
    }
    if (n >= 3) return { x: sx / n, y: sy / n };
    if (frame === 0 && all) return { x: ax / all, y: ay / all };
    return prev;
  };

  const zoomCave = cam.zoom && map.caves.find((c) => c.id === cam.zoom!.cave);
  let pos = centre(0, { x: fw / 2, y: fh / 2 });
  for (let f = 0; f < rec.totalFrames; f++) {
    if (cam.follow && f > 0) {
      const target = centre(f, pos);
      pos = { x: pos.x + (target.x - pos.x) * FOLLOW, y: pos.y + (target.y - pos.y) * FOLLOW };
    }
    let cx = cam.follow ? pos.x : fw / 2;
    let cy = cam.follow ? pos.y : fh / 2;
    let k = 1;
    if (zoomCave) {
      const u = smooth((f * STEP - cam.zoom!.t) / ZOOM_SECONDS);
      k = 1 + ((cam.zoom!.scale ?? 1.8) - 1) * u;
      cx += (zoomCave.x - cx) * u;
      cy += (zoomCave.y - cy) * u;
    }
    const cw = w / k;
    const ch = h / k;
    const o = f * 4;
    out[o] = clamp(cx - cw / 2, 0, fw - cw);
    out[o + 1] = clamp(cy - ch / 2, 0, fh - ch);
    out[o + 2] = cw;
    out[o + 3] = ch;
  }
  return out;
}

export function cropAt(track: Float32Array, frame: number, out: Crop): Crop {
  const o = Math.min(frame, track.length / 4 - 1) * 4;
  out.x = track[o];
  out.y = track[o + 1];
  out.w = track[o + 2];
  out.h = track[o + 3];
  return out;
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
