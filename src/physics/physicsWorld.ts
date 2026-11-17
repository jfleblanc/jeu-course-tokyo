import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT } from '../core/loop';

export type Rapier = typeof RAPIER;

/** Groupes de collision : (appartenance << 16) | filtre. */
export const GROUP_WORLD = (0x0001 << 16) | 0xffff;
export const GROUP_CAR = (0x0002 << 16) | 0xffff;

export interface PhysicsWorld {
  rapier: Rapier;
  world: RAPIER.World;
}

export async function createPhysicsWorld(): Promise<PhysicsWorld> {
  // Rapier 0.19 émet un avertissement interne (wasm-bindgen) sans conséquence à l'initialisation : on le filtre.
  const warn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].includes('deprecated parameters for the initialization function')) return;
    warn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = warn;
  }
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  return { rapier: RAPIER, world };
}
