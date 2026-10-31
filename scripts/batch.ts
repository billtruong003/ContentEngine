// One command, a pile of videos: makes new maps from a seed (or remixes one map), plays each through to throw away
// maps where marbles get stuck, saves the good ones to generated/ and renders them all to output/<batch>/.
//
//   npm run batch -- --count 10 --seed 1
//   npm run batch -- --count 5 --lock layout=merge,ending=freeze,effects=tails+sparks
//   npm run batch -- --count 6 --remix templates/02-nhieu-ve-mot --keep shapes,roads
//   npm run batch -- --count 10 --no-render          (maps only, render later)
//   npm run batch -- --render "generated/*"         (render a folder overnight, skipping videos already made)
//   npm run batch -- --list                         (every dish and the values it can take)
//   npm run batch -- --count 10 --no-fill           (skip filling the picture caves: faster, emptier pictures)
//   npm run batch -- --count 10 --no-rock           (fill, but without rocking the map at the end)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ASPECTS, choices, describe, generate, parseLock, remix, type Aspect, type Recipe } from '../src/generator/generate.ts';
import { fillTargets } from '../src/generator/fill.ts';
import { retime, trial } from '../src/generator/trial.ts';
import { formatMap } from '../src/map/format.ts';
import type { MapDoc } from '../src/map/types.ts';
import { loadPhysics } from '../src/physics/sim.ts';

process.on('uncaughtException', (e) => {
  console.log(`Lỗi: ${e.message}`);
  process.exit(1);
});
const args = parseArgs(process.argv.slice(2));
const images = existsSync('public/targets') ? readdirSync('public/targets').filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];

if (args.list) {
  for (const [dish, values] of Object.entries(choices({ images }))) console.log(`${dish.padEnd(11)} ${values.join(', ')}`);
  console.log(`\nRemix --keep: ${ASPECTS.join(', ')}`);
  process.exit(0);
}
if (args.render) process.exit(await render(args.render.split(/\s+/), args.out ?? 'output/batch', true));

const source = args.remix ? JSON.parse(readFileSync(`${args.remix.replace(/\.json$/, '')}.json`, 'utf8')) as MapDoc : null;
const batch = args.name ?? (source ? `remix-${basename(args.remix!)}-s${args.seed}` : `gen-s${args.seed}`);
const lock = parseLock(args.lock ?? '', { images });
const keep = (args.keep ?? '').split(',').filter(Boolean) as Aspect[];
for (const k of keep) if (!ASPECTS.includes(k)) throw new Error(`--keep: không có "${k}". Có: ${ASPECTS.join(', ')}`);

await loadPhysics();
mkdirSync('generated', { recursive: true });
const made: { file: string; name: string; recipe?: Recipe; seed: number; settledAt: number }[] = [];
const seen = new Set<string>();
const maxTries = args.count * args.tries;
console.log(`Đợt "${batch}": cần ${args.count} map${source ? ` remix từ ${args.remix}` : ''}${args.lock ? `, khóa ${args.lock}` : ''}`);

for (let k = 0; made.length < args.count && k < maxTries; k++) {
  const seed = args.seed * 1000 + k;
  let map: MapDoc;
  let recipe: Recipe | undefined;
  if (source) map = remix(source, seed, keep, { images });
  else ({ map, recipe } = generate(seed, lock, { images }));
  // The same dishes twice make two near-identical videos; keep the batch varied.
  const key = recipe ? describe(recipe) : JSON.stringify([map.caves.map((c) => [c.shape, c.paint?.mode]), map.flows?.map((f) => f.kind), map.ending, map.camera]);
  if (seen.has(key)) continue;
  const t0 = performance.now();
  const first = trial(map);
  if (!first.ok) {
    console.log(`  ✗ seed ${seed}: ${first.problems.join('; ')} (${((performance.now() - t0) / 1000).toFixed(1)} s) · ${map.name}`);
    continue;
  }
  // Then change the marble counts until the picture caves end up full.
  const filled = args.noFill ? { map, result: first, fullness: {} as Record<string, number> } : fillTargets(map, { first, rock: !args.noRock });
  map = filled.map;
  const r = filled.result;
  const took = ((performance.now() - t0) / 1000).toFixed(1);
  const full = Object.values(filled.fullness);
  seen.add(key);
  retime(map, r.settledAt!);
  const file = `${batch}-${String(made.length + 1).padStart(2, '0')}`;
  writeFileSync(`generated/${file}.json`, formatMap(map));
  made.push({ file, name: map.name, recipe, seed, settledAt: r.settledAt! });
  const [lo, hi] = [Math.round(Math.min(...full) * 100), Math.round(Math.max(...full) * 100)];
  const fullText = full.length ? ` · đầy ${lo}${hi > lo ? `–${hi}` : ''}%` : '';
  console.log(`  ✓ ${file}: ${map.name}${fullText} · lắng ở giây ${r.settledAt!.toFixed(1)}, video ${map.duration} s (${took} s)`);
}

if (made.length < args.count) console.log(`Chỉ được ${made.length}/${args.count} map sau ${maxTries} lần thử. Bớt khóa hoặc tăng --tries.`);
if (!made.length) process.exit(1);
const out = args.out ?? `output/${batch}`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/batch.json`, JSON.stringify({ batch, seed: args.seed, lock: args.lock ?? null, remix: args.remix ?? null, keep, maps: made }, null, 2));
if (args.noRender) {
  console.log(`Đã lưu ${made.length} map vào generated/. Xuất video: npm run batch -- --render "generated/${batch}-*" --out ${out}`);
  process.exit(0);
}
process.exit(await render(made.map((m) => `generated/${m.file}`), out, false));

// Hands the maps to the normal exporter. With `skipDone`, videos already in `out` are left alone, so a stopped
// overnight run picks up where it left off. A fresh batch always renders: its maps may reuse the names of older ones.
function render(entries: string[], out: string, skipDone: boolean): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/render.ts', ...entries, '--out', out, ...(skipDone ? ['--skip-done'] : [])], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function parseArgs(list: string[]) {
  const a = { count: 10, seed: 1, tries: 6, lock: undefined as string | undefined, remix: undefined as string | undefined, keep: undefined as string | undefined,
    name: undefined as string | undefined, out: undefined as string | undefined, render: undefined as string | undefined, noRender: false, noFill: false, noRock: false, list: false };
  for (let i = 0; i < list.length; i++) {
    const v = () => list[++i];
    switch (list[i]) {
      case '--count': a.count = Number(v()); break;
      case '--seed': a.seed = Number(v()); break;
      case '--tries': a.tries = Number(v()); break;
      case '--lock': a.lock = v(); break;
      case '--remix': a.remix = v().replaceAll('\\', '/'); break;
      case '--keep': a.keep = v(); break;
      case '--name': a.name = v(); break;
      case '--out': a.out = v(); break;
      case '--render': a.render = v(); break;
      case '--no-render': a.noRender = true; break;
      case '--no-fill': a.noFill = true; break;
      case '--no-rock': a.noRock = true; break;
      case '--list': a.list = true; break;
      default: throw new Error(`không hiểu "${list[i]}". Xem đầu file scripts/batch.ts`);
    }
  }
  if (a.name && !/^[a-z0-9][a-z0-9-]*$/.test(a.name)) throw new Error('--name: chỉ chữ thường không dấu, số và gạch ngang');
  return a;
}
