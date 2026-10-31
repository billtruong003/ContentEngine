// Renders maps to MP4: starts the dev server, opens each map in a hidden Chrome, pulls every frame as a JPEG
// and pipes them into ffmpeg together with the collision soundtrack (and optional background music).
//
// Usage: npm run render -- <map names, templates/<name>, generated/<name>, or patterns like "generated/gen-s1-*" ...>
//          [--out output] [--scale 1] [--skip-done]
//   --scale 2 renders a 1080×1920 map at 2160×3840 (4K vertical).
//   --skip-done leaves out maps whose MP4 is already in --out, so a long run can be stopped and started again.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { createServer } from 'vite';
import { readVoice, soundtrackWav, type Voice } from '../src/audio/mix.ts';
import type { MapDoc, SoundSet } from '../src/map/types.ts';

const FRAMES_PER_CALL = 10;
const BROWSERS = [
  process.env.MARBLE_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const FOLDERS = ['maps', 'templates', 'generated'] as const;
const PARAM = { maps: 'map', templates: 'template', generated: 'generated' } as const;

interface Handle {
  name: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  settled: boolean;
  duration: number;
  needed: number;
  report: unknown;
  paint: unknown;
  sounds: number[];
  voices: string[];
  sound: SoundSet;
}

/** Longest video the exporter stretches a map to while waiting for its marbles to settle (seconds). */
const MAX_DURATION = 600;

const { names, out, scale, skipDone } = parseArgs(process.argv.slice(2));
if (!names.length) {
  console.log('Cần ít nhất 1 map. Ví dụ: npm run render -- paint-three-to-one --scale 1');
  process.exit(1);
}
await checkFfmpeg();
const chrome = BROWSERS.find((p) => p && existsSync(p));
if (!chrome) {
  console.log('Không tìm thấy Chrome hoặc Edge. Đặt biến MARBLE_CHROME trỏ tới file chạy của trình duyệt.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  // A long, crowded map keeps the page busy for minutes while it bakes.
  protocolTimeout: 30 * 60_000,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failed = 0;
try {
  for (const name of names) {
    if (skipDone && existsSync(join(out, `${basename(name)}.mp4`))) {
      console.log(`- ${name}: đã có video, bỏ qua`);
      continue;
    }
    try {
      await renderOne(browser, name);
    } catch (e) {
      failed++;
      console.log(`✗ ${name}: ${(e as Error).message}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

async function renderOne(browser: Browser, entry: string): Promise<void> {
  const t0 = performance.now();
  const folder = folderOf(entry);
  const name = basename(entry);
  const map = JSON.parse(readFileSync(`${folder}/${name}.json`, 'utf8')) as MapDoc;
  let page = await browser.newPage();
  // Marbles still flowing when the run ends: run again long enough for them to settle, so the video ends after that.
  let duration = 0;
  let h: Handle;
  for (;;) {
    // A fresh tab each run: the previous one is still busy with its worker and textures.
    if (duration) { await page.close(); page = await browser.newPage(); }
    page.on('pageerror', (e) => console.log(`  [trang] ${e}`));
    page.on('error', (e) => console.log(`
  [trang sập] ${e.message}`));
    await page.goto(`http://localhost:${port}/?${PARAM[folder]}=${encodeURIComponent(name)}&export=1&scale=${scale}${duration ? `&duration=${duration}` : ''}`);
    process.stdout.write(`… ${name}: đang tính mô phỏng${duration ? ` lại với ${duration} s` : ''}`);
    await page.waitForFunction('window.__marble', { timeout: 30 * 60_000, polling: 500 });
    const handle = await page.evaluate(() => {
      const h = (window as unknown as { __marble: Handle & { error?: string[]; frames?: unknown } }).__marble;
      if (h.error) return { error: h.error };
      const { frames: _, ...data } = h;
      return data;
    });
    if ('error' in handle) throw new Error(`map lỗi: ${(handle.error as string[]).join('; ')}`);
    h = handle as Handle;
    if (h.settled || h.duration >= MAX_DURATION) break;
    duration = Math.min(MAX_DURATION, Math.ceil(Math.max(h.needed, h.duration * 1.25)));
    console.log(` bi chưa chảy xong lúc hết ${h.duration} s`);
  }
  if (!h.settled) console.log(`
  ⚠ ${name}: tới ${MAX_DURATION} s bi vẫn chưa nằm yên, video dừng ở đó`);
  console.log(` xong (${((performance.now() - t0) / 1000).toFixed(0)} s)`);

  const wavPath = join(out, `${name}.sounds.wav`);
  const voices = new Map<string, Voice | null>();
  const voiceOf = (n: number) => {
    const file = h.voices[n];
    if (!file) return null;
    if (!voices.has(file)) voices.set(file, existsSync(join('public', file)) ? readVoice(readFileSync(join('public', file))) : null);
    return voices.get(file)!;
  };
  writeFileSync(wavPath, soundtrackWav(h.sounds, h.totalFrames, h.fps, h.width, voiceOf, h.sound));
  const mp4 = join(out, `${name}.mp4`);
  const music = map.music ? join('public/music', map.music.file) : null;
  if (music && !existsSync(music)) throw new Error(`không có file nhạc ${music}`);
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(h.fps), '-c:v', 'mjpeg', '-i', '-',
    '-i', wavPath,
    ...(music ? ['-stream_loop', '-1', '-i', music] : []),
    ...(music
      ? ['-filter_complex', `[2:a]volume=${map.music!.volume ?? 0.6}[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`, '-map', '0:v', '-map', '[a]']
      : ['-map', '0:v', '-map', '1:a']),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    mp4,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise<number>((resolve) => ffmpeg.on('close', (code) => resolve(code ?? 1)));

  let lastFrame: Buffer | null = null;
  let shown = -1;
  for (let start = 0; start < h.totalFrames; start += FRAMES_PER_CALL) {
    const batch = await page.evaluate(
      (s, c) => (window as unknown as { __marble: { frames(s: number, c: number): string[] } }).__marble.frames(s, c),
      start, FRAMES_PER_CALL,
    );
    for (const [k, b64] of batch.entries()) {
      const frame = Buffer.from(b64, 'base64');
      // Breaking and freezing endings clear the screen; the thumbnail is the finished picture just before.
      if (!map.ending || start + k <= map.ending.t * h.fps) lastFrame = frame;
      if (!ffmpeg.stdin.write(frame)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    }
    const pct = Math.floor(((start + batch.length) / h.totalFrames) * 100);
    if (pct >= shown + 10) {
      shown = pct - (pct % 10);
      process.stdout.write(`\r… ${name}: vẽ khung ${pct}%   `);
    }
  }
  ffmpeg.stdin.end();
  const code = await finished;
  await page.close();
  rmSync(wavPath);
  if (code !== 0) throw new Error(`ffmpeg dừng với mã ${code}`);

  if (lastFrame) writeFileSync(join(out, `${name}.jpg`), lastFrame);
  const seconds = (performance.now() - t0) / 1000;
  writeFileSync(join(out, `${name}.json`), JSON.stringify({
    map: name, title: h.name, size: `${Math.round(h.width * scale)}x${Math.round(h.height * scale)}`,
    fps: h.fps, frames: h.totalFrames, sounds: h.sounds.length / 4, characterSounds: h.voices.filter(Boolean).length, renderSeconds: Math.round(seconds),
    report: h.report, paint: h.paint,
  }, null, 2));
  console.log(`\r✓ ${name}: ${mp4} (${(h.totalFrames / h.fps).toFixed(0)} s video, ${Math.round(h.width * scale)}x${Math.round(h.height * scale)}, mất ${seconds.toFixed(0)} s)`);
}

function folderOf(entry: string): (typeof FOLDERS)[number] {
  return FOLDERS.find((d) => entry.startsWith(`${d}/`)) ?? 'maps';
}

function parseArgs(args: string[]): { names: string[]; out: string; scale: number; skipDone: boolean } {
  let out = 'output';
  let scale = 1;
  let skipDone = false;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--scale') scale = Number(args[++i]);
    else if (args[i] === '--skip-done') skipDone = true;
    else {
      const arg = args[i].replaceAll('\\', '/').replace(/\.json$/, '');
      const dir = folderOf(arg);
      const prefix = dir === 'maps' ? '' : `${dir}/`;
      const name = basename(arg);
      if (name.includes('*')) {
        const pattern = new RegExp(`^${name.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
        names.push(...readdirSync(dir).filter((f) => f.endsWith('.json') && pattern.test(f.slice(0, -5))).map((f) => prefix + f.slice(0, -5)));
      } else names.push(prefix + name);
    }
  }
  return { names, out, scale, skipDone };
}

function checkFfmpeg(): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', () => {
      console.log('Không tìm thấy ffmpeg. Cài ffmpeg (https://ffmpeg.org) và thêm vào PATH rồi chạy lại.');
      process.exit(1);
    });
    p.on('close', () => resolve());
  });
}
