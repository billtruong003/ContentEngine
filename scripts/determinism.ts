// Runs every map and template twice from scratch and checks both runs land on identical marble positions.
import { readdirSync, readFileSync } from 'node:fs';
import { validateMap } from '../src/map/validate.ts';
import { loadPhysics, Sim } from '../src/physics/sim.ts';

const STEPS = 600;
const CHECK_EVERY = 120;

await loadPhysics();
let failed = 0;

const files = ['maps', 'templates'].flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `${dir}/${f}`));
for (const file of files) {
  const { map, errors } = validateMap(JSON.parse(readFileSync(file, 'utf8')));
  if (!map) {
    console.log(`✗ ${file}: map lỗi\n  ${errors.join('\n  ')}`);
    failed++;
    continue;
  }
  const run = () => {
    const sim = new Sim(map);
    const hashes: number[] = [];
    const t0 = performance.now();
    for (let i = 1; i <= STEPS; i++) {
      sim.tick();
      if (i % CHECK_EVERY === 0) hashes.push(sim.hash());
    }
    const ms = (performance.now() - t0) / STEPS;
    const marbles = sim.marbles.length;
    sim.dispose();
    return { hashes, ms, marbles };
  };
  const a = run();
  const b = run();
  const same = a.hashes.every((h, i) => h === b.hashes[i]);
  if (!same) failed++;
  console.log(`${same ? '✓' : '✗'} ${file}: ${a.marbles} bi, ${STEPS} bước, ${a.ms.toFixed(2)} ms/bước, hash cuối ${a.hashes.at(-1)!.toString(16)}${same ? '' : ` ≠ ${b.hashes.at(-1)!.toString(16)}`}`);
}

process.exit(failed ? 1 : 0);
