/** Arbres : petit arbre fauché, gros tronc qui tient ou qui casse selon l'élan : sh scripts/run-sim.sh trees */
import { createPhysicsWorld, GROUP_WORLD } from '../src/physics/physicsWorld';
import { Vehicle, REST_HEIGHT } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A } from '../src/config/handling';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';
import { TreeField } from '../src/world/treeField';
import type { Tree } from '../src/world/cityGen';
const phys = await createPhysicsWorld();
const R = phys.rapier;
phys.world.createCollider(R.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setCollisionGroups(GROUP_WORLD));
const run = (name: string, kmh: number, solid: boolean, throttle = 0.6): void => {
  const tree: Tree = { x: 0, z: 60, height: 10, radius: 3, solid };
  const trunk = solid ? phys.world.createCollider(R.ColliderDesc.cuboid(0.3, 1.5, 0.3).setTranslation(0, 1.5, 60).setCollisionGroups(GROUP_WORLD)) : null;
  const field = new TreeField([tree]);
  field.setSolid = (_id, on): void => trunk?.setEnabled(on);
  const car = new Vehicle(phys, CAR_SPEC, { x: 0, y: REST_HEIGHT + 0.05, z: 0, yaw: 0 });
  car.body.setLinvel({ x: 0, y: 0, z: kmh / 3.6 }, true);
  const input = emptyDriveInput(); input.throttle = throttle;
  let before = 0, after = -1, minV = 1e9;
  for (let t = 0; t < 60 * 6; t++) {
    const lv = car.body.linvel();
    const striker = { x: car.pos.x, z: car.pos.z, yaw: car.yaw, vx: lv.x, vz: lv.z, y: car.pos.y - 0.5, mass: car.body.mass(), slow: (keep: number): void => { const v = car.body.linvel(); car.body.setLinvel({ x: v.x * keep, y: v.y, z: v.z * keep }, true); } };
    if (car.pos.z < 55) before = car.speed * 3.6;
    field.update(FIXED_DT, [striker], car.pos.x, car.pos.z);
    car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep();
    if (car.pos.z > 50) minV = Math.min(minV, car.speed * 3.6);
    if (after < 0 && car.pos.z > 66) after = car.speed * 3.6;
  }
  const st = ['debout', 'en vol', 'bascule', 'couché'][field.state[0] as number];
  console.log(`${name} (${car.body.mass().toFixed(0)} kg) : arrive à ${before.toFixed(0)} km/h, vitesse mini ${minV.toFixed(0)}, ${after < 0 ? 'ne passe pas' : 'ressort à ' + after.toFixed(0) + ' km/h'} ; arbre ${st} ; pose y=${(field.pose[1] as number).toFixed(2)} ; z final voiture ${car.pos.z.toFixed(0)}`);
  phys.world.removeRigidBody(car.body);
  if (trunk) phys.world.removeCollider(trunk, false);
};
run('petit arbre à 80', 80, false);
run('gros arbre à 55, sans gaz', 55, true, 0);
run('gros arbre à 140', 140, true);
