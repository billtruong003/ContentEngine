// Runs the simulation off the main thread and streams recorded frames back in batches.
import type { MapDoc } from '../map/types.ts';
import { encodeFrame, FRAMES_PER_BATCH, wallState, type SceneInfo, type SimReport, type Change } from './recording.ts';
import { loadPhysics, Sim, STEP } from './sim.ts';

export type ToWorker = { type: 'start'; map: MapDoc; duration: number };
export type FromWorker =
  | { type: 'scene'; scene: SceneInfo }
  | { type: 'batch'; data: Int16Array; walls: Change[]; stuck: Change[] }
  | { type: 'done'; report: SimReport; paintSteps: Int32Array; machineSteps: Int32Array[]; sounds: Int32Array; cloneOf: Int32Array };

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const { map, duration } = e.data;
  await loadPhysics();
  const sim = new Sim(map);
  const n = sim.marbles.length;
  const totalFrames = Math.round(duration / STEP) + 1;
  post({
    type: 'scene',
    scene: {
      frame: map.frame,
      marbleRadius: sim.physics.marbleRadius,
      marbleColors: sim.marbleColors,
      marbleCaves: sim.marbleCaves,
      walls: sim.walls.map(({ collider: _, ...w }) => w),
      movers: sim.movers,
      machines: sim.machines,
      portals: sim.portals,
      firstSpare: sim.firstSpare,
      pegs: sim.pegs,
      wheels: sim.wheels,
      field: sim.field,
      ground: { color: '#1b2030', rim: '#8e97ab', rimWidth: 3, ...map.ground },
      warnings: sim.warnings,
      totalFrames,
    },
  });

  const scratch = new Float32Array(n * 3);
  let wallsVersion = -1;
  let stuckVersion = 0;
  for (let start = 0; start < totalFrames; start += FRAMES_PER_BATCH) {
    const count = Math.min(FRAMES_PER_BATCH, totalFrames - start);
    const data = new Int16Array(count * n * 3);
    const walls: Change[] = [];
    const stuck: Change[] = [];
    for (let k = 0; k < count; k++) {
      if (start + k > 0) sim.tick();
      if (sim.wallsVersion !== wallsVersion) {
        wallsVersion = sim.wallsVersion;
        walls.push({ frame: start + k, state: wallState(sim) });
      }
      if (sim.stuckVersion !== stuckVersion) {
        stuckVersion = sim.stuckVersion;
        stuck.push({ frame: start + k, state: sim.stuck.slice() });
      }
      encodeFrame(sim, scratch, data, k * n * 3);
    }
    post({ type: 'batch', data, walls, stuck }, [data.buffer]);
  }
  const report = sim.report();
  const paintSteps = sim.paintSteps.slice();
  const sounds = Int32Array.from(sim.sounds);
  const machineSteps = sim.machineSteps.map((s) => s.slice());
  const cloneOf = sim.cloneOf.slice();
  sim.dispose();
  post({ type: 'done', report, paintSteps, machineSteps, sounds, cloneOf }, [paintSteps.buffer, sounds.buffer, cloneOf.buffer, ...machineSteps.map((s) => s.buffer)]);
};
