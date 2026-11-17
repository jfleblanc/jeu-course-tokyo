/** Vérifie les quartiers extérieurs : sh scripts/run-sim.sh districts */
import { WORLD } from '../src/config/world';
import { generateCity } from '../src/world/cityGen';
import { pointInPolygon } from '../src/world/streetGraph';

const city = generateCity(WORLD.seed);
const g = city.graph;
const main = g.edges.filter((e) => e.district < 0);
console.log(`ville: ${g.nodes.length} carrefours, ${g.edges.length} rues (${main.length} dans la ville principale), ${city.buildings.length} immeubles, ${city.walls.length} murs, limites ${Object.values(city.bounds).map((v) => v.toFixed(0)).join(' ')}`);
console.log(`départ ${city.spawn.x.toFixed(1)} ${city.spawn.z.toFixed(1)} ; rayon ${g.radius.toFixed(0)}`);
for (const d of g.districts) {
  const edges = g.edges.filter((e) => e.district === d.id);
  const len = edges.reduce((s, e) => s + e.length, 0);
  const b = city.buildings.filter((x) => !x.backdrop && Math.hypot(x.footprint.cx - d.cx, x.footprint.cz - d.cz) < d.radius);
  const entry = g.nodes[d.entryNode]!;
  // connexité : tous les carrefours du quartier atteignables depuis l'entrée
  const seen = new Set([entry.id]); const todo = [entry.id];
  while (todo.length) { const n = g.nodes[todo.pop()!]!; for (const id of n.edges) { const e = g.edges[id]!; const o = e.a === n.id ? e.b : e.a; if (!seen.has(o)) { seen.add(o); todo.push(o); } } }
  const nodes = g.nodes.filter((n) => n.district === d.id && n.edges.length > 0);
  const onRoad = city.buildings.filter((x) => !x.backdrop && Math.hypot(x.footprint.cx - d.gate.x, x.footprint.cz - d.gate.z) < 12).length;
  console.log(`quartier ${d.id} « ${d.name} » niv. ${d.unlockLevel}: centre ${d.cx.toFixed(0)},${d.cz.toFixed(0)} (à ${Math.hypot(d.cx, d.cz).toFixed(0)} m du centre-ville), rayon ${d.radius.toFixed(0)}, ${edges.length} rues (${(len / 1000).toFixed(1)} km), ${nodes.length} carrefours dont ${seen.size} reliés à l'entrée, ${b.length} immeubles, entrée à ${Math.hypot(entry.x - d.gate.x, entry.z - d.gate.z).toFixed(0)} m de la barrière, immeubles sur l'accès: ${onRoad}, barrière dans le quartier: ${pointInPolygon(d.polygon, d.gate.x, d.gate.z)}`);
}

// Passage libre : aucun mur invisible sur la largeur de la route d'accès, de l'autoroute au quartier.
for (const d of g.districts) {
  const e = g.nodes[d.entryNode]!;
  const hx = Math.sin(d.gate.yaw), hz = Math.cos(d.gate.yaw);
  const sx = d.gate.x - hx * 30, sz = d.gate.z - hz * 30; // sur l'autoroute
  const len = Math.hypot(e.x - sx, e.z - sz) + 40; const tx = (e.x - sx) / (len - 40), tz = (e.z - sz) / (len - 40);
  let worst = Infinity, where = '';
  for (let t = 0; t <= len; t += 1) for (let lat = -5.5; lat <= 5.5; lat += 0.5) {
    const x = sx + tx * t + tz * lat, z = sz + tz * t - tx * lat;
    for (const w of city.walls) {
      const dx = x - w.x, dz = z - w.z; const ax = Math.sin(w.yaw), az = Math.cos(w.yaw);
      const along = Math.max(-w.halfLength, Math.min(w.halfLength, dx * ax + dz * az));
      const dist = Math.hypot(dx - ax * along, dz - az * along);
      if (dist < worst) { worst = dist; where = `à ${t} m, écart ${lat}`; }
    }
  }
  const inWay = city.buildings.filter((b) => !b.backdrop && b.height > 1.5).filter((b) => { for (let t = 0; t <= len - 40; t += 2) { const x = sx + tx * t, z = sz + tz * t; if (Math.hypot(x - b.footprint.cx, z - b.footprint.cz) < Math.max(b.footprint.w, b.footprint.d) / 2 + 3) return true; } return false; }).length;
  console.log(`passage vers « ${d.name} »: mur invisible le plus proche de la chaussée à ${worst.toFixed(1)} m (${where}) ; immeubles en travers: ${inWay}`);
}

// ——— Conduite réelle : traversée du pont, montée de la route de montagne ———
{
  const { createPhysicsWorld } = await import('../src/physics/physicsWorld');
  const { buildCityColliders } = await import('../src/world/cityColliders');
  const { Vehicle } = await import('../src/vehicle/vehicle');
  const { CAR_SPEC, PRESET_A } = await import('../src/config/handling');
  const { emptyDriveInput } = await import('../src/input/actions');
  const { FIXED_DT } = await import('../src/core/loop');
  const phys = await createPhysicsWorld();
  const n = buildCityColliders(city, phys);
  console.log(`collisions: ${n} ; arbres ${city.trees.length} ; buttes ${city.mounds.filter((m) => m.solid).length} ; montagnes ${city.mounds.filter((m) => !m.solid).length} ; ponts ${city.bridges.length}`);
  const drive = (name: string, samples: { x: number; y: number; z: number; tx: number; tz: number }[], target: number): void => {
    const s0 = samples[2]!;
    const car = new Vehicle(phys, CAR_SPEC, { x: s0.x, y: s0.y + 0.8, z: s0.z, yaw: Math.atan2(s0.tx, s0.tz) });
    const input = emptyDriveInput();
    let idx = 2, maxY = -1e9, minGap = 1e9, maxLat = 0, maxV = 0, t = 0, stuck = 0;
    while (t < 400 && idx < samples.length - 3) {
      while (idx < samples.length - 3 && (samples[idx]!.x - car.pos.x) * samples[idx]!.tx + (samples[idx]!.z - car.pos.z) * samples[idx]!.tz < 0) idx++;
      const look = samples[Math.min(samples.length - 1, idx + 4 + Math.floor(car.speed / 6))]!;
      let diff = Math.atan2(look.x - car.pos.x, look.z - car.pos.z) - car.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      input.steer = Math.max(-1, Math.min(1, diff * 2.4));
      input.throttle = car.speed < target ? 1 : 0; input.brake = car.speed > target + 3 ? 0.4 : 0;
      car.update(FIXED_DT, input, PRESET_A); phys.world.step(); car.afterStep(); t += FIXED_DT;
      const sp = samples[idx]!;
      maxY = Math.max(maxY, car.pos.y); minGap = Math.min(minGap, car.pos.y - sp.y);
      maxLat = Math.max(maxLat, Math.abs((car.pos.x - sp.x) * sp.tz - (car.pos.z - sp.z) * sp.tx)); maxV = Math.max(maxV, car.speed);
      stuck = car.speed < 1 ? stuck + FIXED_DT : 0; if (stuck > 5) break;
    }
    console.log(`${name}: ${idx >= samples.length - 3 ? 'arrivé' : 'BLOQUÉ à ' + idx + '/' + samples.length} en ${t.toFixed(0)} s ; hauteur max ${maxY.toFixed(1)} m ; écart latéral max ${maxLat.toFixed(1)} m ; sous la chaussée au pire ${minGap.toFixed(2)} m ; v max ${(maxV * 3.6).toFixed(0)} km/h ; position finale y=${car.pos.y.toFixed(1)}`);
    phys.world.removeRigidBody(car.body);
  };
  for (const br of city.bridges) { drive('pont (aller)', br.samples, 38); drive('pont (retour)', [...br.samples].reverse().map((p) => ({ ...p, tx: -p.tx, tz: -p.tz })), 38); }
  if (city.mountain) { drive('route de montagne (montée)', city.mountain.road.samples, 22); drive('route de montagne (descente)', [...city.mountain.road.samples].reverse().map((p) => ({ ...p, tx: -p.tx, tz: -p.tz })), 20); }
}
