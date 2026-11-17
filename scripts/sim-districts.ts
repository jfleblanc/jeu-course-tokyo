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
