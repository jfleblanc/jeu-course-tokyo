/** Demi-tour au frein à main : sh scripts/run-sim.sh handbrake */
import { createPhysicsWorld, GROUP_WORLD } from '../src/physics/physicsWorld';
import { Vehicle } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A as BASE } from '../src/config/handling';
const PRESET_A = process.env.SANS ? { ...BASE, handbrakeYaw: 0, handbrakeDecel: 0, handbrakeSpeed: 0.001 } : BASE;
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';
const phys = await createPhysicsWorld();
phys.world.createCollider(phys.rapier.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(0.9).setCollisionGroups(GROUP_WORLD));
for (const kmh of [30, 50, 70, 100, 150]) {
  const car = new Vehicle(phys, CAR_SPEC, { x: 0, y: 0.62, z: 0, yaw: 0 });
  const input = emptyDriveInput();
  car.body.setLinvel({ x: 0, y: 0, z: kmh / 3.6 }, true);
  for (let i = 0; i < 30; i++) { input.throttle = 0.5; car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep(); }
  input.throttle = 0; input.steer = 1; input.drift = true;
  let turned = 0, prev = car.yaw, t180 = -1, t90 = -1, maxTilt = 0; const x0 = car.pos.x, z0 = car.pos.z;
  for (let i = 0; i < 60 * 4; i++) {
    car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep();
    let d = car.yaw - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); turned += d; prev = car.yaw;
    if (t90 < 0 && Math.abs(turned) > Math.PI / 2) t90 = i / 60;
    if (t180 < 0 && Math.abs(turned) > Math.PI * 0.97) { t180 = i / 60; break; }
    const q = car.rot; maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) * 57.3);
  }
  console.log(`${kmh} km/h, espace + volant à fond: quart de tour en ${t90 < 0 ? '—' : t90.toFixed(2) + ' s'}, demi-tour en ${t180 < 0 ? '— (tourné de ' + Math.abs(turned * 57.3).toFixed(0) + '° en 4 s)' : t180.toFixed(2) + ' s'} ; vitesse à la fin ${(car.speed * 3.6).toFixed(0)} km/h ; déplacement ${Math.hypot(car.pos.x - x0, car.pos.z - z0).toFixed(0)} m ; inclinaison max ${maxTilt.toFixed(0)}°`);
  phys.world.removeRigidBody(car.body);
}
