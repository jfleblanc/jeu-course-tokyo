import { GROUP_WORLD, type PhysicsWorld } from '../physics/physicsWorld';
import type { CityData, HighwaySample } from './cityGen';

/**
 * Collisions de la ville : des boîtes simples (jamais le maillage visuel),
 * plus un maillage de triangles pour l'autoroute surélevée.
 */
export function buildCityColliders(city: CityData, phys: PhysicsWorld): number {
  const R = phys.rapier;
  const world = phys.world;
  let count = 0;
  const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, friction = 0.6): void => {
    const desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(friction).setRestitution(0.05).setCollisionGroups(GROUP_WORLD);
    if (yaw !== 0) desc.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    world.createCollider(desc);
    count++;
  };

  // Sol
  box(0, -1, 0, 3000, 1, 3000, 0, 0.9);

  // Immeubles : une boîte orientée par immeuble
  for (const b of city.buildings) {
    if (b.backdrop) continue;
    const f = b.footprint;
    const h = Math.min(b.height, 30);
    box(f.cx, h / 2, f.cz, f.w / 2, h / 2, f.d / 2, f.yaw, 0.3);
  }

  // Murs invisibles derrière le périphérique (le bord de la ville)
  for (const w of city.walls) box(w.x, 15, w.z, 0.5, 15, w.halfLength, w.yaw, 0.3);

  // Piliers d'autoroute
  for (const p of city.highway.pillars) box(p.x, p.top / 2, p.z, 0.8, p.top / 2, 0.8, p.yaw, 0.3);

  // Autoroute : tablier + glissières (+ flancs pleins sous les rampes) en un seul trimesh
  const hw = city.highway;
  const verts: number[] = [];
  const idx: number[] = [];
  const half = hw.halfWidth;
  const bh = hw.barrierHeight + 0.5;
  const s = hw.samples;
  // Par échantillon et par côté : 0 = bord chaussée, 1 = haut glissière intérieur,
  // 2 = haut glissière extérieur, 3 = bas extérieur (sol sous la rampe, sinon dessous du tablier)
  const PER = 8;
  for (const p of s as HighwaySample[]) {
    for (const side of [1, -1]) {
      const ox = -p.tz * side;
      const oz = p.tx * side;
      const low = p.y < 4 ? -0.2 : p.y - 0.9;
      verts.push(p.x + ox * half, p.y + 0.02, p.z + oz * half);
      verts.push(p.x + ox * half, p.y + bh, p.z + oz * half);
      verts.push(p.x + ox * (half + 0.35), p.y + bh, p.z + oz * (half + 0.35));
      verts.push(p.x + ox * (half + 0.35), low, p.z + oz * (half + 0.35));
    }
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < s.length - 1; k++) {
    const a = k * PER;
    const b = (k + 1) * PER;
    // tablier (entre les deux bords chaussée)
    quad(a + 0, b + 0, b + 4, a + 4);
    for (const o of [0, 4]) {
      quad(a + o, a + o + 1, b + o + 1, b + o); // face intérieure de la glissière
      quad(a + o + 1, a + o + 2, b + o + 2, b + o + 1); // dessus
      quad(a + o + 2, a + o + 3, b + o + 3, b + o + 2); // face extérieure / flanc
    }
    // dessous du tablier
    quad(a + 3, b + 3, b + 7, a + 7);
  }
  const desc = R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(0.9).setCollisionGroups(GROUP_WORLD);
  world.createCollider(desc);
  count++;
  return count;
}
