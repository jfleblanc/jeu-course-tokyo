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

// ——— Frôler une glissière : la voiture doit glisser le long, sans à-coup ———
const scrape = (name: string, s: S[], i0: number, kmh: number, side: number, closed: boolean, half: number) => {
  const a = s[i0]!; const v0 = kmh / 3.6;
  const car = new Vehicle(phys, CAR_SPEC, { x: a.x, y: a.y + 0.62, z: a.z, yaw: Math.atan2(a.tx, a.tz) }); car.setTraits(m.traits);
  car.body.setLinvel({ x: a.tx * v0, y: 0, z: a.tz * v0 }, true);
  let k = i0, worst = 0, prev = kmh, vMin = 1e9, touched = 0, maxTilt = 0; const N = s.length; let maxSpin = 0, maxHop = 0;
  for (let i = 0; i < 60 * 14; i++) {
    for (let g = 0; g < 6; g++) { const q = s[(k + 1) % N]!; if ((car.pos.x - q.x) * q.tx + (car.pos.z - q.z) * q.tz > 0 && (closed || k < N - 2)) k = (k + 1) % N; }
    const p = s[k]!;
    const lat = (car.pos.x - p.x) * -p.tz + (car.pos.z - p.z) * p.tx;
    // on vise un point au-delà de la glissière : la voiture s'y appuie en permanence
    const t = s[closed ? (k + 6) % N : Math.min(N - 1, k + 6)]!;
    const aimX = t.x - t.tz * side * (half + 1.5), aimZ = t.z + t.tx * side * (half + 1.5);
    let d = Math.atan2(aimX - car.pos.x, aimZ - car.pos.z) - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    input.steer = Math.max(-0.5, Math.min(0.5, d * 2)); input.throttle = car.speed * 3.6 < kmh ? 1 : 0.3;
    car.update(FIXED_DT, input, cfg); phys.world.step(); car.afterStep();
    const v = car.speed * 3.6; const q = car.rot;
    if (Math.abs(lat) > half - 1.2) touched++;
    if (i > 30) { const av = car.body.angvel(); const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) }; const yawR = av.x * up.x + av.y * up.y + av.z * up.z; maxSpin = Math.max(maxSpin, Math.hypot(av.x - up.x * yawR, av.y - up.y * yawR, av.z - up.z * yawR) * 57.3); maxHop = Math.max(maxHop, Math.abs(car.body.linvel().y - (s[(k + 1) % N]!.y - p.y) / 3 * car.speed)); }
    if (i > 30 && prev - v > worst && process.env.TRACE) console.log(`    t=${(i / 60).toFixed(2)} éch ${k} lat ${lat.toFixed(2)} y-route ${(car.pos.y - p.y).toFixed(2)} v ${prev.toFixed(0)}→${v.toFixed(0)} cap ${((Math.atan2(Math.sin(car.yaw - Math.atan2(p.tx, p.tz)), Math.cos(car.yaw - Math.atan2(p.tx, p.tz)))) * 57.3).toFixed(0)}° roues ${car.wheels.map((w) => (w.inContact ? w.compression.toFixed(2) : '--')).join('/')}`);
    if (i > 30) { worst = Math.max(worst, prev - v); vMin = Math.min(vMin, v); maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) * 57.3); }
    prev = v;
  }
  console.log(`${name} à ${kmh} km/h, appuyée ${side > 0 ? 'à gauche' : 'à droite'}: contact ${(touched / 60).toFixed(0)} s ; pire perte en un pas ${worst.toFixed(1)} km/h ; v mini ${vMin.toFixed(0)} km/h ; inclinaison max ${maxTilt.toFixed(0)}° ; roulis/tangage max ${maxSpin.toFixed(0)} °/s ; saut vertical max ${maxHop.toFixed(2)} m/s`);
  phys.world.removeRigidBody(car.body);
};
for (const v of [120, 200]) for (const side of [1, -1]) scrape('autoroute centrale', hs, 40, v, side, false, city.highway.halfWidth);
for (const v of [150, 250]) for (const side of [1, -1]) scrape('ceinture', rs, 30, v, side, true, city.ringway.halfWidth);
if (city.mountain) { const cs = city.mountain.road.samples as S[]; for (const side of [1, -1]) scrape('col', cs, 60, 90, side, false, city.mountain.road.halfWidth); }
