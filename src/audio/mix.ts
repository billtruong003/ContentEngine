// Builds the collision soundtrack from the bake's impact list. Every sound starts on the exact frame of its
// impact, so audio cannot drift from the picture. Without character voices every hit uses a synthesized sound
// from the map's sound set: the plain "tick", or glass, wood, metal, coin, pop.
import type { SoundSet } from '../map/types.ts';

const SAMPLE_RATE = 48000;
const TICK_SECONDS = 0.05;
/** Pitch variants made per sound set, so a shower of hits does not sound like one note repeated. */
const VARIANTS = 12;

// Each set: length in seconds, loudness, and one sample at time t for variant k (0..1).
const SETS: Record<Exclude<SoundSet, 'tick'>, { seconds: number; gain: number; at: (t: number, k: number, noise: number) => number }> = {
  // Two high inharmonic partials that ring a little.
  glass: { seconds: 0.12, gain: 0.7, at: (t, k) => {
    const f = 2600 + k * 1800;
    return (Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 2.76 * t) * 0.3) * Math.exp(-t * 38);
  } },
  // A dull knock: low body, a hint of a second partial and a burst of noise.
  wood: { seconds: 0.06, gain: 1.3, at: (t, k, noise) => {
    const f = 420 + k * 380;
    return (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2.3 * t) * 0.35) * Math.exp(-t * 120) + noise * Math.exp(-t * 600) * 0.5;
  } },
  // Bell-like partials that fade slowly.
  metal: { seconds: 0.18, gain: 0.65, at: (t, k) => {
    const f = 900 + k * 700;
    return (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 2.41 * t) * 0.3 + Math.sin(2 * Math.PI * f * 3.9 * t) * 0.2) * Math.exp(-t * 22);
  } },
  // "Ching": two notes a fifth apart, the second a moment later.
  coin: { seconds: 0.14, gain: 0.55, at: (t, k) => {
    const f = 1700 + k * 900;
    const second = t > 0.025 ? Math.sin(2 * Math.PI * f * 1.5 * (t - 0.025)) * Math.exp(-(t - 0.025) * 30) : 0;
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 45) * 0.6 + second * 0.5;
  } },
  // A short bubbly pop: pitch drops fast.
  pop: { seconds: 0.05, gain: 1.1, at: (t, k) => {
    const f0 = 700 + k * 600;
    const phase = 2 * Math.PI * (f0 * 0.35 * t + (f0 * 0.65 * (1 - Math.exp(-t * 80))) / 80);
    return Math.sin(phase) * Math.exp(-t * 70) * Math.min(1, t * 2000);
  } },
};

function bank(set: Exclude<SoundSet, 'tick'>): Float32Array[] {
  const { seconds, at } = SETS[set];
  const length = Math.round(seconds * SAMPLE_RATE);
  return Array.from({ length: VARIANTS }, (_, v) => {
    const out = new Float32Array(length);
    for (let s = 0; s < length; s++) out[s] = at(s / SAMPLE_RATE, v / (VARIANTS - 1), hash(v * 7919 + s) * 2 - 1);
    return out;
  });
}

/** A recorded voice: mono samples in [-1, 1] at SAMPLE_RATE. */
export type Voice = Float32Array;

/**
 * Interleaved stereo WAV (16-bit PCM). `sounds` holds [frame, marble, x px, strength px/s] entries;
 * `voiceOf(n)` returns the voice for the n-th impact (the character it came from), or null for the synthesized tick.
 */
export function soundtrackWav(
  sounds: ArrayLike<number>, totalFrames: number, fps: number, frameWidth: number,
  voiceOf: (impact: number) => Voice | null = () => null,
  set: SoundSet = 'tick',
): Uint8Array {
  const bankOf = set === 'tick' ? null : bank(set);
  const setGain = set === 'tick' ? 1 : SETS[set].gain;
  const length = Math.ceil((totalFrames / fps) * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const tickLength = Math.round(TICK_SECONDS * SAMPLE_RATE);

  for (let k = 0; k < sounds.length; k += 4) {
    const frame = sounds[k];
    const x = sounds[k + 2];
    const strength = sounds[k + 3];
    const start = Math.round((frame / fps) * SAMPLE_RATE);
    const gain = Math.min(1, strength / 2000) * 0.22;
    const pan = Math.max(0, Math.min(1, x / frameWidth));
    const voice = voiceOf(k / 4);
    if (voice) {
      for (let s = 0; s < voice.length && start + s < length; s++) {
        const v = voice[s] * gain * 1.6;
        left[start + s] += v * Math.cos((pan * Math.PI) / 2);
        right[start + s] += v * Math.sin((pan * Math.PI) / 2);
      }
      continue;
    }
    if (bankOf) {
      const sample = bankOf[Math.floor(hash(k) * VARIANTS)];
      const g = gain * setGain;
      for (let s = 0; s < sample.length && start + s < length; s++) {
        left[start + s] += sample[s] * g * Math.cos((pan * Math.PI) / 2);
        right[start + s] += sample[s] * g * Math.sin((pan * Math.PI) / 2);
      }
      continue;
    }
    const pitch = 1300 + hash(k) * 1700;
    for (let s = 0; s < tickLength && start + s < length; s++) {
      const t = s / SAMPLE_RATE;
      const env = Math.exp(-t * 90);
      const click = s < 48 ? (hash(k + s * 7) - 0.5) * (1 - s / 48) : 0;
      const v = (Math.sin(2 * Math.PI * pitch * t) * env + click) * gain;
      left[start + s] += v * Math.cos((pan * Math.PI) / 2);
      right[start + s] += v * Math.sin((pan * Math.PI) / 2);
    }
  }
  return wav(left, right);
}

/** Reads a 16-bit PCM WAV (mono or stereo, any rate) into mono samples at SAMPLE_RATE. */
export function readVoice(bytes: Uint8Array): Voice | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let channels = 1;
  let rate = SAMPLE_RATE;
  let bits = 16;
  while (at + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) return null;
      const frames = Math.floor(size / (2 * channels));
      const out = new Float32Array(Math.floor((frames * SAMPLE_RATE) / rate));
      for (let i = 0; i < out.length; i++) {
        const src = Math.min(frames - 1, Math.floor((i * rate) / SAMPLE_RATE));
        out[i] = view.getInt16(at + 8 + src * 2 * channels, true) / 32768;
      }
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

function wav(left: Float32Array, right: Float32Array): Uint8Array {
  const n = left.length;
  const out = new Uint8Array(44 + n * 4);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 4, true);
  // Soft limiter: dense showers of hits should get louder, never clip.
  const pcm = (v: number) => Math.round(Math.tanh(v) * 32000);
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 4, pcm(left[i]), true);
    view.setInt16(46 + i * 4, pcm(right[i]), true);
  }
  return out;
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
