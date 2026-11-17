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

// ——— Frein à main à l'arrêt : la voiture ne bouge pas, le moteur monte ; on relâche, elle part ———
{
  const car = new Vehicle(phys, CAR_SPEC, { x: 50, y: 0.62, z: 0, yaw: 0 });
  const input = emptyDriveInput();
  for (let i = 0; i < 60; i++) { car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep(); }
  input.drift = true; input.throttle = 1; let vmax = 0, rpmMax = 0, rpmMin = 1e9;
  for (let i = 0; i < 180; i++) { car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep(); vmax = Math.max(vmax, car.speed); if (i > 90) { rpmMax = Math.max(rpmMax, car.drivetrain.rpm); rpmMin = Math.min(rpmMin, car.drivetrain.rpm); } }
  const moved = Math.hypot(car.pos.x - 50, car.pos.z);
  input.drift = false;
  for (let i = 0; i < 120; i++) { car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep(); }
  console.log(`frein à main + gaz à fond, 3 s à l'arrêt: déplacement ${moved.toFixed(2)} m, v max ${(vmax * 3.6).toFixed(1)} km/h, régime entre ${rpmMin.toFixed(0)} et ${rpmMax.toFixed(0)} tr/min (maxi ${CAR_SPEC.redlineRpm}) ; 2 s après avoir relâché: ${(car.speed * 3.6).toFixed(0)} km/h`);
  // tenue sur la grille (décompte)
  const c2 = new Vehicle(phys, CAR_SPEC, { x: 80, y: 0.62, z: 0, yaw: 0 }); const in2 = emptyDriveInput(); c2.launchHold = true; in2.throttle = 0.7;
  for (let i = 0; i < 150; i++) { c2.update(FIXED_DT, in2, PRESET_A); phys.world.step(); c2.afterStep(); }
  console.log(`grille, gaz à 70 %: déplacement ${Math.hypot(c2.pos.x - 80, c2.pos.z).toFixed(2)} m, régime ${c2.drivetrain.rpm.toFixed(0)} tr/min (${(c2.drivetrain.rpm / CAR_SPEC.redlineRpm * 100).toFixed(0)} % du maxi)`);
}
