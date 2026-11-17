/** Descente de rampe à pleine vitesse (voiture la plus rapide) : sh scripts/run-sim.sh ramp */
import { createPhysicsWorld } from '../src/physics/physicsWorld';
import { Vehicle } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A, type HandlingConfig } from '../src/config/handling';
import { CAR_MODELS } from '../src/config/cars';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';
import { generateCity } from '../src/world/cityGen';
import { buildCityColliders } from '../src/world/cityColliders';
const phys = await createPhysicsWorld();
const city = generateCity();
buildCityColliders(city, phys);
const input = emptyDriveInput();
type S = { x: number; y: number; z: number; tx: number; tz: number };
const m = CAR_MODELS.find((c) => c.id === (process.env.CAR ?? 'gt300'))!;
const cfg: HandlingConfig = { ...PRESET_A, enginePower: PRESET_A.enginePower * m.power, gripFront: PRESET_A.gripFront * m.grip, gripRear: PRESET_A.gripRear * m.grip, gripLong: PRESET_A.gripLong * m.grip };
const run = (name: string, s: S[], i0: number, i1: number, kmh: number) => {
  const a = s[i0]!; const yaw = Math.atan2(a.tx, a.tz); const v0 = kmh / 3.6;
  const car = new Vehicle(phys, CAR_SPEC, { x: a.x, y: a.y + 0.62, z: a.z, yaw }); car.setTraits(m.traits);
  car.body.setLinvel({ x: a.tx * v0, y: 0, z: a.tz * v0 }, true);
  let k = i0, vMin = 1e9, air = 0, where = '', worstDrop = 0, prev = kmh; const log: string[] = [];
  for (let i = 0; i < 60 * 25 && k < i1; i++) {
    while (k < i1 && (car.pos.x - s[k]!.x) * s[k]!.tx + (car.pos.z - s[k]!.z) * s[k]!.tz > 0) k++;
    const t = s[Math.min(i1, k + 4)]!;
    let d = Math.atan2(t.x - car.pos.x, t.z - car.pos.z) - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    input.steer = Math.max(-1, Math.min(1, d * 3)); input.throttle = car.speed * 3.6 < kmh ? 1 : 0.3;
    car.update(FIXED_DT, input, cfg); phys.world.step(); car.afterStep();
    const v = car.speed * 3.6; const h = car.pos.y - s[k]!.y;
    air = Math.max(air, h);
    if (prev - v > worstDrop) { worstDrop = prev - v; where = `à ${k - i0} éch., y=${car.pos.y.toFixed(1)}, écart latéral ${((car.pos.x - s[k]!.x) * -s[k]!.tz + (car.pos.z - s[k]!.z) * s[k]!.tx).toFixed(1)} m`; }
    prev = v; vMin = Math.min(vMin, v);
    if (process.env.TRACE && i % 5 === 0) log.push(`    éch ${k - i0}: route y=${s[k]!.y.toFixed(2)} voiture y=${car.pos.y.toFixed(2)} v=${v.toFixed(0)} tangage=${(Math.asin(Math.max(-1, Math.min(1, car.body.linvel().y / (car.speed || 1)))) * 57.3).toFixed(0)}°`);
  }
  console.log(`${name} à ${kmh} km/h (${m.id}): ${k >= i1 ? 'passée' : 'PAS ARRIVÉE'} ; v mini ${vMin.toFixed(0)} km/h ; pire perte en un pas ${worstDrop.toFixed(0)} km/h ${where} ; hauteur max au-dessus de la route ${air.toFixed(2)} m`);
  for (const l of log) console.log(l);
  phys.world.removeRigidBody(car.body);
};
const hs = city.highway.samples as S[];
for (const v of [150, 220, 290]) run('autoroute centrale, descente de fin', hs, hs.length - 50, hs.length - 1, v);
const br = city.bridges[0]?.samples as S[] | undefined;
if (br) for (const v of [150, 220, 290]) { run('pont de Hakone, vers la campagne', br, br.length - 70, br.length - 1, v); const rev = [...br].reverse().map((p) => ({ ...p, tx: -p.tx, tz: -p.tz })); run('pont de Hakone, vers la ville', rev, rev.length - 70, rev.length - 1, v); }
// Ceinture : chaque descente (de surélevé vers le sol)
const rs = city.ringway.samples as S[]; let done = 0;
for (let i = 2; i < rs.length - 60 && done < 4; i++) if (rs[i]!.y > 6 && rs[i + 1]!.y < rs[i]!.y - 0.01 && rs[i - 1]!.y >= rs[i]!.y - 0.001) { let j = i; while (j < rs.length - 1 && rs[j]!.y > 0.01) j++; run(`ceinture, descente n° ${++done}`, rs, i - 8, Math.min(rs.length - 1, j + 14), 290); i = j; }
