/**
 * Banc d'essai de la circulation : les voitures roulent-elles, restent-elles sur les rues,
 * et se laissent-elles pousser ?   sh scripts/run-sim.sh traffic
 */
import { createPhysicsWorld, GROUP_WORLD } from '../src/physics/physicsWorld';
import { Vehicle } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A } from '../src/config/handling';
import { WORLD } from '../src/config/world';
import { generateCity } from '../src/world/cityGen';
import { Traffic } from '../src/world/traffic';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';

const phys = await createPhysicsWorld();
const R = phys.rapier;
phys.world.createCollider(R.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(0.8).setCollisionGroups(GROUP_WORLD));
const city = generateCity(WORLD.seed);
const traffic = new Traffic(phys, city.graph, WORLD.seed);
const car = new Vehicle(phys, CAR_SPEC, { x: city.spawn.x, y: 0.8, z: city.spawn.z, yaw: city.spawn.yaw });
const input = emptyDriveInput();
const actors = [{ x: 0, z: 0, vx: 0, vz: 0 }];
const start = traffic.cars.map(() => ({ x: 0, z: 0 }));
let junctions = 0, maxJump = 0, stops = 0;
const prev = traffic.cars.map(() => ({ x: NaN, z: NaN, state: '' }));
const step = (): void => {
  const a = actors[0]!; const lv = car.body.linvel(); a.x = car.pos.x; a.z = car.pos.z; a.vx = lv.x; a.vz = lv.z;
  car.update(FIXED_DT, input, PRESET_A);
  traffic.beforeStep(FIXED_DT, actors);
  phys.world.step();
  car.afterStep();
  traffic.cars.forEach((c, i) => {
    const p = prev[i]!;
    if (c.active && !Number.isNaN(p.x) && c.state !== 'choc') maxJump = Math.max(maxJump, Math.hypot(c.x - p.x, c.z - p.z));
    if (c.state === 'carrefour' && p.state === 'rue') junctions++;
    p.x = c.active ? c.x : NaN; p.z = c.z; p.state = c.state;
  });
};
for (let i = 0; i < 30; i++) step();
traffic.cars.forEach((c, i) => { start[i]!.x = c.x; start[i]!.z = c.z; });
for (let i = 0; i < 60 * 90; i++) { step(); if (i % 60 === 0) stops += traffic.cars.filter((c) => c.active && c.speed < 0.2).length; }
const active = traffic.cars.filter((c) => c.active);
const moved = active.map((c, i) => Math.hypot(c.x - start[i]!.x, c.z - start[i]!.z));
console.log(`circulation: ${active.length}/${traffic.cars.length} actives après 90 s ; ${junctions} carrefours traversés ; saut max ${maxJump.toFixed(2)} m par pas ; voitures à l'arrêt (moyenne) ${(stops / 90).toFixed(1)} ; vitesse moyenne ${(active.reduce((s, c) => s + c.speed, 0) / active.length * 3.6).toFixed(0)} km/h ; déplacement médian ${moved.sort((a, b) => a - b)[moved.length >> 1]!.toFixed(0)} m`);
// Choc : on place le joueur 25 m derrière une voiture, lancé à 90 km/h.
const victim = active.find((c) => c.state === 'rue' && c.speed > 5)!;
const hx = Math.sin(victim.yaw), hz = Math.cos(victim.yaw);
car.teleport(victim.x - hx * 25, 0.62, victim.z - hz * 25, victim.yaw, 25);
input.throttle = 1;
let hitAt = -1, vAfter = 0;
for (let i = 0; i < 60 * 4; i++) { step(); if (hitAt < 0 && victim.state === 'choc') hitAt = i / 60; if (victim.state === 'choc') vAfter = Math.max(vAfter, victim.speed); }
console.log(`choc à 90 km/h: voiture passée en physique libre à ${hitAt.toFixed(2)} s, poussée jusqu'à ${(vAfter * 3.6).toFixed(0)} km/h ; joueur ${(car.speed * 3.6).toFixed(0)} km/h après 4 s, hauteur ${car.pos.y.toFixed(2)} ; victime y=${victim.body.translation().y.toFixed(2)}`);
