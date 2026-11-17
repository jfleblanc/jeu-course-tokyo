import type { CityData, HighwaySample } from '../world/cityGen';
import { GARAGE, garageToWorld } from '../world/garageSite';

export interface TestSpot { id: string; label: string; x: number; y: number; z: number; yaw: number }

/**
 * Endroits où se téléporter pour essayer sans conduire jusque-là : `?lieu=<id>` dans l'adresse
 * (ouvre aussi tous les quartiers et saute l'écran titre), puis PagePréc / PageSuiv pour passer
 * d'un endroit à l'autre. `?lieu=liste` affiche la liste.
 */
export function testSpots(city: CityData): TestSpot[] {
  const out: TestSpot[] = [];
  const on = (id: string, label: string, s: HighwaySample[], f: number, reverse = false): void => {
    const p = s[Math.max(0, Math.min(s.length - 1, Math.round((s.length - 1) * f)))];
    if (!p) return;
    out.push({ id, label, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(p.tx, p.tz) + (reverse ? Math.PI : 0) });
  };
  out.push({ id: 'depart', label: 'Point de départ', x: city.spawn.x, y: 0, z: city.spawn.z, yaw: city.spawn.yaw });
  if (city.garage) {
    const g = city.garage, G = GARAGE;
    const [bx, bz] = garageToWorld(g, G.mainBay.x, G.mainBay.z);
    out.push({ id: 'garage', label: 'Garage (dans l’atelier)', x: bx, y: G.floor, z: bz, yaw: g.yaw + G.mainBay.yaw });
    const rx = (G.rampX0 + G.rampX1) / 2;
    const [tx, tz] = garageToWorld(g, rx, G.rampZ1 + 9);
    out.push({ id: 'garage-rue', label: 'Garage (dans la rue, devant la rampe)', x: tx, y: 0, z: tz, yaw: g.yaw + Math.PI });
    const [lx, lz] = garageToWorld(g, rx, G.rampZ0 + 6);
    out.push({ id: 'garage-rampe', label: 'Garage (en bas de la rampe)', x: lx, y: G.floor * (1 - 6 / (G.rampZ1 - G.rampZ0)), z: lz, yaw: g.yaw });
  }
  on('autoroute', 'Autoroute centrale (sur le tablier)', city.highway.samples, 0.3);
  on('rampe', 'Autoroute centrale, avant la descente', city.highway.samples, 0.8);
  // Ceinture : une portion surélevée
  const rs = city.ringway.samples;
  const high = rs.findIndex((p) => p.y > 6);
  if (high >= 0) on('ceinture', 'Autoroute de ceinture', rs, (high + 10) / rs.length);
  const names = ['baie', 'docks', 'collines'];
  for (const d of city.graph.districts) {
    const e = city.graph.nodes[d.entryNode];
    const id = names[d.id] ?? `quartier${d.id}`;
    if (e) out.push({ id, label: `${d.name} (entrée)`, x: e.x, y: 0, z: e.z, yaw: Math.atan2(d.outX, d.outZ) });
    out.push({ id: `${id}-centre`, label: `${d.name} (centre)`, x: d.cx, y: 0, z: d.cz, yaw: Math.atan2(d.outX, d.outZ) });
    // Bord extérieur du quartier : là où est la limite côté large.
    let best = null as null | { x: number; z: number }, bv = -Infinity;
    for (const w of city.walls) {
      if (Math.hypot(w.x - d.cx, w.z - d.cz) > d.radius + 60) continue;
      const v = (w.x - d.cx) * d.outX + (w.z - d.cz) * d.outZ;
      if (v > bv) { bv = v; best = w; }
    }
    if (best) out.push({ id: `${id}-limite`, label: d.theme === 'docks' ? 'Quai des docks' : `${d.name} (limite côté large)`, x: best.x - d.outX * 40, y: 0, z: best.z - d.outZ * 40, yaw: Math.atan2(d.outX, d.outZ) });
  }
  const hakone = city.bridges[0];
  if (hakone) on('pont-hakone', 'Pont de Hakone', hakone.samples, 0.05);
  const mt = city.mountain;
  if (mt) {
    on('col', 'Col de Hakone (pied, côté A)', mt.road.samples, 0.01);
    on('lacets', 'Col de Hakone (lacets)', mt.road.samples, 0.25);
    on('sommet', 'Col de Hakone (au col, temple)', mt.road.samples, mt.summit / mt.road.samples.length - 0.02);
    on('col-b', 'Col de Hakone (pied, côté B)', mt.road.samples, 0.99, true);
  }
  for (const l of city.links) {
    const id = l.kind === 'tunnel' ? 'tunnel' : 'pont';
    on(id, `${l.name} (entrée côté collines)`, l.road.samples, 0.02);
    on(`${id}-milieu`, `${l.name} (milieu)`, l.road.samples, 0.5);
    on(`${id}-fin`, `${l.name} (devant la barrière)`, l.road.samples, 0.88);
  }
  return out;
}
