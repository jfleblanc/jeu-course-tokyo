/** Sortir du garage par la rampe, puis y rentrer : sh scripts/run-sim.sh garage */
import { createPhysicsWorld } from '../src/physics/physicsWorld';
import { Vehicle, REST_HEIGHT } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A } from '../src/config/handling';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';
import { generateCity } from '../src/world/cityGen';
import { buildCityColliders } from '../src/world/cityColliders';
import { GARAGE, garageToLocal, garageToWorld } from '../src/world/garageSite';
const phys = await createPhysicsWorld();
const city = generateCity();
buildCityColliders(city, phys);
const site = city.garage;
if (!site) { console.log('AUCUN EMPLACEMENT DE GARAGE'); process.exit(1); }
const G = GARAGE;
const drive = (name: string, way: [number, number][], startYaw: number, y0: number): void => {
  const [sx, sz] = garageToWorld(site, way[0]![0], way[0]![1]);
  const car = new Vehicle(phys, CAR_SPEC, { x: sx, y: y0 + REST_HEIGHT + 0.2, z: sz, yaw: site.yaw + startYaw });
  const input = emptyDriveInput(); let k = 1, t = 0, minY = 1e9, maxY = -1e9, vmax = 0;
  for (; t < 60 * 40 && k < way.length; t++) {
    const [wx, wz] = garageToWorld(site, way[k]![0], way[k]![1]);
    if (Math.hypot(wx - car.pos.x, wz - car.pos.z) < 2.5) { k++; continue; }
    let d = Math.atan2(wx - car.pos.x, wz - car.pos.z) - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    input.steer = Math.max(-1, Math.min(1, d * 2.5)); input.throttle = car.speed * 3.6 < 28 ? 0.8 : 0; input.brake = car.speed * 3.6 > 34 ? 0.5 : 0;
    car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep();
    minY = Math.min(minY, car.pos.y); maxY = Math.max(maxY, car.pos.y); vmax = Math.max(vmax, car.speed * 3.6);
  }
  const [lx, lz] = garageToLocal(site, car.pos.x, car.pos.z);
  console.log(`${name}: ${k >= way.length ? 'arrivée' : 'BLOQUÉE au point ' + k + ' sur ' + (way.length - 1)} en ${(t / 60).toFixed(1)} s ; position finale locale (${lx.toFixed(1)}, ${lz.toFixed(1)}) y=${car.pos.y.toFixed(2)} ; y entre ${minY.toFixed(2)} et ${maxY.toFixed(2)} ; v max ${vmax.toFixed(0)} km/h`);
  phys.world.removeRigidBody(car.body);
};
const rx = (G.rampX0 + G.rampX1) / 2;
const out: [number, number][] = [[G.mainBay.x, G.mainBay.z], [8, 1.5], [13.5, 1.5], [rx, 3.5], [rx, 12], [rx, 24], [rx, G.rampZ1 + 4], [rx, G.rampZ1 + 9]];
drive('sortie du garage', out, G.mainBay.yaw, G.floor);
drive('entrée dans le garage', [...out].reverse(), Math.PI, 0);
console.log(`sol de l'atelier attendu y=${(G.floor + REST_HEIGHT).toFixed(2)} ; rue y=${REST_HEIGHT.toFixed(2)}`);
