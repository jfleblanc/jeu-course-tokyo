/**
 * Banc d'essai par voiture : chaque modèle du garage, avec sa physique (masse, roues motrices,
 * empattement), sur les mêmes épreuves. Sert à vérifier que toutes restent saines et différentes.
 *   sh scripts/run-sim.sh cars
 */
import { createPhysicsWorld, GROUP_WORLD } from '../src/physics/physicsWorld';
import { Vehicle } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A, type HandlingConfig } from '../src/config/handling';
import { CAR_MODELS } from '../src/config/cars';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';

const phys = await createPhysicsWorld();
const R = phys.rapier;
phys.world.createCollider(R.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(0.8).setCollisionGroups(GROUP_WORLD));
console.log('voiture        masse  transm.  repos  0-100  100-0  virage 100 km/h (lacet °/s, dérive °, roulis °)  gaz en virage (dérive °)  drift (angle °)  choc → AE86 (km/h cible / perte)');
for (const m of CAR_MODELS) {
  const cfg: HandlingConfig = { ...PRESET_A, enginePower: PRESET_A.enginePower * m.power, gripFront: PRESET_A.gripFront * m.grip, gripRear: PRESET_A.gripRear * m.grip, gripLong: PRESET_A.gripLong * m.grip, brakeForce: PRESET_A.brakeForce * m.brake };
  const car = new Vehicle(phys, CAR_SPEC, { x: 0, y: 0.8, z: 0, yaw: 0 });
  car.setTraits(m.traits);
  const input = emptyDriveInput();
  let t = 0;
  const step = (n: number, fn?: () => void): void => {
    for (let i = 0; i < n; i++) {
      car.update(FIXED_DT, input, cfg);
      phys.world.step();
      car.afterStep();
      t += FIXED_DT;
      fn?.();
    }
  };
  const reset = (speed = 0): void => { car.teleport(0, 0.62, 0, 0, speed); Object.assign(input, emptyDriveInput()); };
  const kmh = (): number => car.forwardSpeed * 3.6;
  const roll = (): number => { const q = car.body.rotation(); return Math.abs(Math.asin(Math.max(-1, Math.min(1, 2 * (q.x * q.y + q.w * q.z))))) * 57.3; };
  step(150);
  const rest = car.pos.y;
  // 0-100
  input.throttle = 1; let t100 = -1; const t0 = t;
  step(60 * 14, () => { if (t100 < 0 && kmh() >= 100) t100 = t - t0; });
  // 100-0
  reset(100 / 3.6); step(20); input.brake = 1; let stop = -1; const t1 = t;
  step(60 * 6, () => { if (stop < 0 && kmh() < 2) stop = t - t1; });
  // Virage à 100 km/h, gaz maintenus à 35 %
  reset(100 / 3.6); step(20); input.steer = 1; input.throttle = 0.35;
  let yaw = 0, slip = 0, maxRoll = 0; let prev = car.yaw;
  step(60 * 3, () => { maxRoll = Math.max(maxRoll, roll()); });
  prev = car.yaw; step(60); yaw = Math.abs(car.yaw - prev) * 57.3; slip = Math.abs(car.bodySlip) * 57.3;
  // Plein gaz en virage depuis 50 km/h (survirage de puissance ? sous-virage ?)
  reset(50 / 3.6); step(20); input.steer = 1; input.throttle = 1; let powerSlip = 0;
  step(60 * 3, () => { powerSlip = Math.max(powerSlip, Math.abs(car.bodySlip) * 57.3); maxRoll = Math.max(maxRoll, roll()); });
  // Drift à 90 km/h
  reset(90 / 3.6); step(20); input.steer = 1; input.throttle = 0.8; input.drift = true; let drift = 0;
  step(60 * 3, () => { drift = Math.max(drift, Math.abs(car.bodySlip) * 57.3); maxRoll = Math.max(maxRoll, roll()); });
  // Choc : on percute une AE86 arrêtée à 80 km/h
  reset(80 / 3.6);
  const ae = CAR_MODELS[0]!; const target = new Vehicle(phys, CAR_SPEC, { x: 0, y: 0.62, z: 14, yaw: 0 }); target.setTraits(ae.traits);
  const idle = emptyDriveInput(); let hit = 0; const v0 = 80;
  step(60 * 1.2, () => { target.update(FIXED_DT, idle, PRESET_A); target.afterStep(); hit = Math.max(hit, target.forwardSpeed * 3.6); });
  const lost = v0 - kmh();
  phys.world.removeRigidBody(target.body);
  console.log(`${m.id.padEnd(13)} ${String(m.traits.mass).padStart(5)}  ${(m.traits.driveFront === 0 ? 'arrière' : m.traits.driveFront === 1 ? 'avant' : '4 roues').padEnd(8)} ${rest.toFixed(3)}  ${t100.toFixed(2)}   ${stop.toFixed(2)}   ${yaw.toFixed(0).padStart(3)} / ${slip.toFixed(1).padStart(4)} / ${maxRoll.toFixed(1).padStart(4)}   ${powerSlip.toFixed(1).padStart(5)}   ${drift.toFixed(1).padStart(5)}   ${hit.toFixed(0).padStart(3)} / ${lost.toFixed(0)}`);
  phys.world.removeRigidBody(car.body);
}
