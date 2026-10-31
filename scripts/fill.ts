// Makes the picture caves of existing maps end up full (see src/generator/fill.ts).
//
//   npm run fill -- templates/02-nhieu-ve-mot            (shows what would change)
//   npm run fill -- "generated/gen-s1-*" --write         (saves the changes into the same files)
//   npm run fill -- maps/three-to-one --goal 0.85 --write
//   npm run fill -- maps/three-to-one --no-rock          (fill without rocking the map at the end)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fillTargets } from '../src/generator/fill.ts';
import { retime } from '../src/generator/trial.ts';
import { formatMap } from '../src/map/format.ts';
import type { MapDoc } from '../src/map/types.ts';
import { loadPhysics } from '../src/physics/sim.ts';

const args = process.argv.slice(2);
const write = args.includes('--write');
const goalAt = args.indexOf('--goal');
const goal = goalAt >= 0 ? Number(args[goalAt + 1]) : undefined;
const rock = !args.includes('--no-rock');
const entries = args.filter((a, i) => !a.startsWith('--') && (goalAt < 0 || i !== goalAt + 1));
if (!entries.length) {
  console.log('Cần ít nhất 1 map. Ví dụ: npm run fill -- templates/02-nhieu-ve-mot --write');
  process.exit(1);
}

await loadPhysics();
let failed = 0;
for (const file of entries.flatMap(expand)) {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as MapDoc;
  const t0 = performance.now();
  const { map, result, fullness, log } = fillTargets(doc, { goal, rock });
  const counts = map.caves.filter((c) => c.marbles).map((c) => `${c.id} ${doc.caves.find((d) => d.id === c.id)!.marbles!.count}→${c.marbles!.count}`).join(', ');
  const shrunk = map.caves.filter((c, i) => c.shape.radius < doc.caves[i].shape.radius).map((c) => c.id);
  const grown = map.caves.filter((c, i) => c.shape.radius > doc.caves[i].shape.radius).map((c) => c.id);
  const ok = result.ok && Object.keys(fullness).length > 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${file} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  for (const line of log) console.log(`    ${line}`);
  if (ok) {
    console.log(`    bi: ${counts}${grown.length ? ` · phóng to hang ${grown.join(', ')}` : ''}${shrunk.length ? ` · thu nhỏ hang ${shrunk.join(', ')}` : ''}`);
    // Generated maps end right after the pile settles; keep that true after the change.
    if (map.ending || map.camera?.zoom || map.caves.some((c) => c.paint?.flip)) retime(map, result.settledAt!);
    if (write) writeFileSync(file, formatMap(map));
  }
}
if (!write) console.log('\nChưa ghi gì. Thêm --write để lưu.');
process.exit(failed ? 1 : 0);

function expand(entry: string): string[] {
  const path = entry.replaceAll('\\', '/').replace(/\.json$/, '');
  const name = basename(path);
  const dir = path.includes('/') ? dirname(path) : 'maps';
  if (!name.includes('*')) return [`${dir}/${name}.json`];
  const pattern = new RegExp(`^${name.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return readdirSync(dir).filter((f) => f.endsWith('.json') && pattern.test(f.slice(0, -5))).map((f) => `${dir}/${f}`);
}
