/**
 * Banc d'essai sans affichage : fait rouler la voiture sur un sol plat avec des
 * commandes scriptées et imprime des chiffres (0-100, vitesse max, virage, drift).
 * Sert à vérifier la physique sans navigateur.
 */
import { createPhysicsWorld, GROUP_WORLD } from '../src/physics/physicsWorld';
import { Vehicle } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A, PRESET_B, type HandlingConfig } from '../src/config/handling';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';

async function run(name: string, cfg: HandlingConfig) {
  const phys = await createPhysicsWorld();
  const R = phys.rapier;
  phys.world.createCollider(R.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(0.8).setCollisionGroups(GROUP_WORLD));
  const car = new Vehicle(phys, CAR_SPEC, { x: 0, y: 0.8, z: 0, yaw: 0 });
  const input = emptyDriveInput();
  let t = 0;
  const step = (n: number, fn?: () => void) => {
    for (let i = 0; i < n; i++) {
      car.update(FIXED_DT, input, cfg);
      input.shiftUp = input.shiftDown = false;
      phys.world.step();
      car.afterStep();
      t += FIXED_DT;
      fn?.();
    }
  };
  const kmh = () => car.forwardSpeed * 3.6;
  console.log(`\n===== ${name} =====`);
  step(120);
  console.log(`repos: y=${car.pos.y.toFixed(3)} comp=${car.wheels.map((w) => w.compression.toFixed(3)).join(',')} v=${kmh().toFixed(2)}`);

  // Accélération
  input.throttle = 1;
  let t100 = -1, t200 = -1; const t0 = t;
  step(60 * 40, () => {
    if (t100 < 0 && kmh() >= 100) t100 = t - t0;
    if (t200 < 0 && kmh() >= 200) t200 = t - t0;
  });
  console.log(`0-100: ${t100.toFixed(2)} s   0-200: ${t200.toFixed(2)} s   vmax(40s): ${kmh().toFixed(0)} km/h  rapport ${car.drivetrain.gearLabel} rpm ${car.drivetrain.rpm.toFixed(0)}  x-dérive=${car.pos.x.toFixed(2)}`);

  // Freinage depuis vmax
  input.throttle = 0; input.brake = 1;
  const z0 = car.pos.z; const v0 = kmh(); const tb = t;
  step(60 * 12, () => { if (kmh() < 1 && input.brake) { console.log(`freinage ${v0.toFixed(0)}→0: ${(car.pos.z - z0).toFixed(0)} m en ${(t - tb).toFixed(1)} s`); input.brake = 0; } });

  // Marche arrière auto
  input.brake = 1; step(60 * 3);
  console.log(`marche arrière 3 s: ${kmh().toFixed(0)} km/h rapport ${car.drivetrain.gearLabel}`);
  input.brake = 0; input.throttle = 1; step(60 * 4);
  console.log(`relance: ${kmh().toFixed(0)} km/h rapport ${car.drivetrain.gearLabel}`);

  // Virages à vitesse stabilisée
  for (const target of [50, 100, 160]) {
    input.steer = 0; input.brake = 0;
    step(60 * 30, () => { input.throttle = kmh() < target ? 1 : 0; input.brake = kmh() > target + 5 ? 0.6 : 0; });
    input.steer = 1;
    let maxSlip = 0, maxRoll = 0;
    step(60 * 4, () => {
      input.throttle = kmh() < target ? 0.7 : 0.1;
      maxSlip = Math.max(maxSlip, Math.abs(car.bodySlip));
      const q = car.rot; const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      maxRoll = Math.max(maxRoll, Math.acos(Math.min(1, upY)));
    });
    const latG = (car.speed * Math.abs(car.yawRate)) / 9.81;
    console.log(`virage plein braquage à ${target}: v=${kmh().toFixed(0)} lacet=${(car.yawRate * 57.3).toFixed(0)}°/s  latG=${latG.toFixed(2)}  rayon=${(car.speed / Math.max(0.01, Math.abs(car.yawRate))).toFixed(0)} m  dérive=${(car.bodySlip * 57.3).toFixed(1)}° (max ${(maxSlip * 57.3).toFixed(1)}°) inclinaison max ${(maxRoll * 57.3).toFixed(1)}°`);
  }

  // Drift : 110 km/h, braquer + espace + gaz, selon trois façons de tenir le volant
  for (const mode of ['plein braquage tenu', 'braquage 0.6 s puis volant droit', 'braquage 0.6 s puis contre-braquage 0.4', 'braquage 0.6 s puis contre-braquage 1.0', 'braquage 0.6 s puis volant droit, demi-gaz']) {
    input.steer = 0; input.drift = false;
    step(60 * 20, () => { input.throttle = kmh() < 110 ? 1 : 0; input.brake = kmh() > 118 ? 0.5 : 0; });
    input.brake = 0; input.steer = 1; input.drift = true; input.throttle = 1;
    let peak = 0; const td = t; const trace: string[] = [];
    // Courbure de la trajectoire : de combien la direction du déplacement tourne pendant le drift.
    const dir0 = Math.atan2(car.body.linvel().x, car.body.linvel().z); let turned = 0; let prevDir = dir0; const v0 = kmh();
    step(60 * 4, () => {
      const lv = car.body.linvel(); const dirNow = Math.atan2(lv.x, lv.z); let dd = dirNow - prevDir; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); turned += dd; prevDir = dirNow;
      const e = t - td;
      if (e > 0.6 && mode.includes('droit')) input.steer = 0;
      if (e > 0.6 && mode.includes('contre')) input.steer = mode.includes('1.0') ? -1 : -0.4;
      if (e > 0.6 && mode.includes('demi')) input.throttle = 0.5;
      peak = Math.max(peak, Math.abs(car.bodySlip));
      if (Math.abs((e * 2) % 1) < FIXED_DT * 2) trace.push((car.bodySlip * 57.3).toFixed(0));
    });
    console.log(`drift [${mode}]: angle max ${(peak * 57.3).toFixed(0)}°  trace(0.5s) ${trace.join(' ')}  v ${v0.toFixed(0)}→${(car.speed * 3.6).toFixed(0)}  trajectoire tournée de ${(Math.abs(turned) * 57.3).toFixed(0)}° en 4 s`);
    input.drift = false; input.steer = 0; input.throttle = 0.5;
    let recover = -1; const tr = t;
    step(60 * 5, () => { if (recover < 0 && Math.abs(car.bodySlip) < 0.05 && Math.abs(car.yawRate) < 0.1) recover = t - tr; });
    console.log(`   sortie: stabilisée en ${recover.toFixed(2)} s  v=${kmh().toFixed(0)}`);
  }
  // Sans drift : lever de pied + braquage brusque à 130 (la voiture doit rester saine)
  input.steer = 0;
  step(60 * 20, () => { input.throttle = kmh() < 130 ? 1 : 0; });
  input.throttle = 0; input.steer = 1; let pk = 0;
  step(60 * 2, () => { pk = Math.max(pk, Math.abs(car.bodySlip)); });
  input.steer = -1; step(60 * 2, () => { pk = Math.max(pk, Math.abs(car.bodySlip)); });
  console.log(`chicane brusque à 130 sans drift: dérive max ${(pk * 57.3).toFixed(0)}°  v=${kmh().toFixed(0)}`);
  // Plein gaz en 1re en braquant (antipatinage)
  input.steer = 0; input.throttle = 0; input.brake = 1; step(60 * 6); input.brake = 0; step(30);
  car.drivetrain.setGear(1); input.throttle = 1; input.steer = 1; pk = 0;
  step(60 * 4, () => { pk = Math.max(pk, Math.abs(car.bodySlip)); });
  console.log(`départ plein gaz braqué: dérive max ${(pk * 57.3).toFixed(0)}°  v=${kmh().toFixed(0)}`);
}

// ——— Essais dans la vraie ville : rampe d'autoroute, trottoir, mur ———
async function cityTest() {
  const { generateCity } = await import('../src/world/cityGen');
  const { buildCityColliders } = await import('../src/world/cityColliders');
  const phys = await createPhysicsWorld();
  const city = generateCity();
  const n = buildCityColliders(city, phys);
  console.log(`\n===== VILLE : ${n} collisions, ${city.buildings.length} immeubles, ${city.graph.edges.length} rues, ${city.signs.length} enseignes =====`);
  const input = emptyDriveInput();
  const mk = (x: number, z: number, yaw: number) => new Vehicle(phys, CAR_SPEC, { x, y: 0.8, z, yaw });
  const drive = (car: Vehicle, steps: number, fn?: (i: number) => void) => {
    for (let i = 0; i < steps; i++) { fn?.(i); car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep(); }
  };
  // 1) Monter la rampe et traverser toute l'autoroute
  const s = city.highway.samples;
  const first = s[0]!, last = s[s.length - 1]!;
  let car = mk(first.x - 25, first.z, Math.PI / 2);
  input.throttle = 1; let maxY = 0, minUp = 1, done = -1, maxV = 0;
  drive(car, 60 * 40, (i) => {
    input.throttle = car.forwardSpeed * 3.6 < 140 ? 1 : 0.2;
    // suit l'axe de l'autoroute
    let best = s[0]!, bd = 1e9;
    for (const p of s) { const d = (p.x - car.pos.x - 12 * Math.sin(car.yaw)) ** 2 + (p.z - car.pos.z - 12 * Math.cos(car.yaw)) ** 2; if (d < bd) { bd = d; best = p; } }
    const want = Math.atan2(best.x - car.pos.x, best.z - car.pos.z);
    let d = want - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    input.steer = Math.max(-1, Math.min(1, d * 3));
    maxY = Math.max(maxY, car.pos.y); maxV = Math.max(maxV, car.speed * 3.6);
    const q = car.rot; const upNow = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (upNow < minUp - 0.01 && upNow < 0.97 && process.env.TRACE) console.log(`  t=${(i / 60).toFixed(2)} x=${(car.pos.x - first.x).toFixed(0)} y=${car.pos.y.toFixed(2)} tilt=${(Math.acos(upNow) * 57.3).toFixed(0)}° v=${(car.speed * 3.6).toFixed(0)} contacts=${car.wheels.map((w) => (w.inContact ? 1 : 0)).join('')}`);
    minUp = Math.min(minUp, upNow);
    if (done < 0 && car.pos.x > last.x + 10) done = i / 60;
  });
  console.log(`autoroute: hauteur max ${maxY.toFixed(2)} m (tablier ${(s[Math.floor(s.length / 2)]!.y + 0.59).toFixed(2)}), traversée en ${done.toFixed(1)} s, v max ${maxV.toFixed(0)} km/h, inclinaison max ${(Math.acos(minUp) * 57.3).toFixed(1)}°, fin y=${car.pos.y.toFixed(2)}`);
  phys.world.removeRigidBody(car.body);
  // 2) Monter sur un trottoir à 70 km/h en biais
  const e = city.graph.edges.find((g) => g.kind === 'avenue' && !g.alongX && g.length > 60)!;
  car = mk(e.x0, e.z0 + 5, 0.25);
  input.steer = 0; input.throttle = 1; minUp = 1; maxY = 0; let hitSpeed = 0;
  drive(car, 60 * 6, () => { const q = car.rot; minUp = Math.min(minUp, 1 - 2 * (q.x * q.x + q.z * q.z)); maxY = Math.max(maxY, car.pos.y); hitSpeed = Math.max(hitSpeed, car.speed * 3.6); });
  console.log(`trottoir + mur en biais: v max ${hitSpeed.toFixed(0)} km/h, hauteur max ${maxY.toFixed(2)}, inclinaison max ${(Math.acos(minUp) * 57.3).toFixed(1)}°, fin v=${(car.speed * 3.6).toFixed(0)} y=${car.pos.y.toFixed(2)} x=${(car.pos.x - e.x0).toFixed(1)}`);
  phys.world.removeRigidBody(car.body);
  // 3) Mur de face à 150 km/h
  car = mk(e.x0, e.z0 + 5, Math.PI / 2);
  minUp = 1; hitSpeed = 0;
  drive(car, 60 * 8, () => { const q = car.rot; minUp = Math.min(minUp, 1 - 2 * (q.x * q.x + q.z * q.z)); hitSpeed = Math.max(hitSpeed, car.speed * 3.6); });
  console.log(`mur de face: v max ${hitSpeed.toFixed(0)} km/h, inclinaison max ${(Math.acos(Math.max(-1, minUp)) * 57.3).toFixed(1)}°, fin y=${car.pos.y.toFixed(2)} dx=${(car.pos.x - e.x0).toFixed(1)} (demi-largeur ${e.width / 2} + trottoir 3)`);
}
await cityTest();
await run('A', PRESET_A);
await run('B', PRESET_B);
