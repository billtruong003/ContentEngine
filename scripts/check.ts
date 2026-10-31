// Runs maps to the end without a browser and reports stuck, lost and per-cave marble counts.
// Usage: node scripts/check.ts [map names, templates/<name> or generated/<name> ...]. Without names: every map and template.
import { readdirSync, readFileSync } from 'node:fs';
import { DEFAULT_DURATION } from '../src/map/types.ts';
import { validateMap } from '../src/map/validate.ts';
import { loadPhysics, Sim, STEP } from '../src/physics/sim.ts';

const names = process.argv.slice(2).map((n) => n.replace(/\.json$/, '').replaceAll('\\', '/'));
const dirs = names.some((n) => n.startsWith('generated/')) ? ['maps', 'templates', 'generated'] : ['maps', 'templates'];
const files = dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `${dir}/${f}`))
  .filter((f) => !names.length || names.some((n) => f === `${n}.json` || f === `maps/${n}.json`));

await loadPhysics();
let failed = 0;

for (const file of files) {
  const { map, errors } = validateMap(JSON.parse(readFileSync(file, 'utf8')));
  if (!map) {
    console.log(`✗ ${file}: map lỗi\n  ${errors.join('\n  ')}`);
    failed++;
    continue;
  }
  const sim = new Sim(map);
  const steps = Math.round((map.duration ?? DEFAULT_DURATION) / STEP);
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) sim.tick();
  const r = sim.report();
  const passed = (kind: string) => {
    const hit = new Set<number>();
    sim.machines.forEach((m, k) => m.kind === kind && sim.machineSteps[k].forEach((s, i) => s >= 0 && hit.add(i)));
    return hit.size;
  };
  const machines = [
    sim.machines.some((m) => m.kind === 'paint') ? `qua máy sơn ${passed('paint')}, lọt ${r.unpainted}` : '',
    sim.machines.some((m) => m.kind === 'swap') ? `qua máy đổi nhân vật ${passed('swap')}` : '',
  ].filter(Boolean);
  sim.dispose();
  const ok = r.stuck === 0 && r.lost === 0 && r.unpainted === 0;
  if (!ok) failed++;
  const caves = Object.entries(r.caves).map(([id, n]) => `${id} ${n}`).join(' · ');
  console.log(`${ok ? '✓' : '✗'} ${file}: kẹt ${r.stuck} · thất lạc ${r.lost} · ngoài hang ${r.outside} | ${caves}${machines.map((s) => ` | ${s}`).join('')} | ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  for (const s of r.stuckSpots) console.log(`  kẹt ${s.count} bi quanh (${s.x}, ${s.y})`);
  for (const w of sim.warnings) console.log(`  ⚠ ${w}`);
}

process.exit(failed ? 1 : 0);
