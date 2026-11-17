import { GROUP_WORLD, type PhysicsWorld } from '../physics/physicsWorld';
import type { CityData, Highway, HighwaySample } from './cityGen';

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

  const addHighwayCollider = (hw: Highway): void => {
    const verts: number[] = [];
    const idx: number[] = [];
    const half = hw.halfWidth;
    const s = hw.samples;
    const n = s.length;
    // Par échantillon et par côté : 0 = bord chaussée, 1 = haut glissière intérieur,
    // 2 = haut glissière extérieur, 3 = bas extérieur (sol sous la rampe ou côté extérieur, sinon dessous du tablier)
    const PER = 8;
    for (const p of s as HighwaySample[]) {
      for (const side of [1, -1]) {
        const ox = -p.tz * side;
        const oz = p.tx * side;
        const bh = hw.barrierHeight + (side === hw.outerSide ? 1.6 : 0.5);
        const low = p.y < 4 || side === hw.outerSide ? -0.2 : p.y - 0.9;
        verts.push(p.x + ox * half, p.y + 0.02, p.z + oz * half);
        verts.push(p.x + ox * half, p.y + bh, p.z + oz * half);
        verts.push(p.x + ox * (half + 0.35), p.y + bh, p.z + oz * (half + 0.35));
        verts.push(p.x + ox * (half + 0.35), low, p.z + oz * (half + 0.35));
      }
    }
    const inGap = (side: number, k: number): boolean => {
      for (const g of hw.gaps) {
        if (g.side !== side) continue;
        const rel = (((k - g.from) % n) + n) % n;
        if (rel <= g.to - g.from) return true;
      }
      return false;
    };
    const quad = (a: number, b: number, c: number, d: number): void => {
      idx.push(a, b, c, a, c, d);
    };
    const segs = hw.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = k * PER;
      const b = ((k + 1) % n) * PER;
      quad(a + 0, b + 0, b + 4, a + 4); // tablier
      for (const [o, side] of [[0, 1], [4, -1]] as const) {
        if (inGap(side, k)) continue; // ouverture pour une bretelle
        quad(a + o + 2, a + o + 3, b + o + 3, b + o + 2); // face extérieure / flanc
        // Glissière : une boîte pleine par tronçon. (Une simple paroi de triangles laissait la
        // caisse s'enfoncer dedans puis s'y accrocher : la voiture s'arrêtait net en la frôlant.)
        {
          const pa = s[k] as HighwaySample, pb = s[(k + 1) % n] as HighwaySample;
          const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          const yaw = Math.atan2(dx, dz), pitch = -Math.asin(dy / len);
          const bh = hw.barrierHeight + (side === hw.outerSide ? 1.6 : 0.5);
          const T = 0.3;
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, mz = (pa.z + pb.z) / 2;
          const ox = -(pa.tz + pb.tz) / 2 * side, oz = (pa.tx + pb.tx) / 2 * side;
          const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
          world.createCollider(R.ColliderDesc.cuboid(T, bh / 2 + 0.3, len / 2 + 0.06)
            .setTranslation(mx + ox * (half + T), my + bh / 2 - 0.3, mz + oz * (half + T))
            .setRotation({ x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp })
            .setFriction(0.3).setRestitution(0.05).setCollisionGroups(GROUP_WORLD));
          count++;
        }
      }
      const sa = s[k] as HighwaySample;
      if (sa.y >= 4) quad(a + 3, b + 3, b + 7, a + 7); // dessous du tablier
    }
    // Frottement 0,3 comme les immeubles : frôler une glissière ne freine pas plus que frôler un mur
    // (les roues n'utilisent pas ce frottement, seulement la caisse).
    // FIX_INTERNAL_EDGES : sans lui, une voiture qui retombe sur le tablier peut « buter » sur
    // l'arête entre deux triangles comme sur un mur.
    const desc = R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx), R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.3).setCollisionGroups(GROUP_WORLD);
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

  // Mur invisible le long du flanc extérieur de l'autoroute de ceinture (le bord de la ville)
  for (const w of city.walls) box(w.x, 15, w.z, 0.5, 15, w.halfLength, w.yaw, 0.3);

  // Piliers d'autoroute
  for (const p of [...city.highway.pillars, ...city.ringway.pillars]) box(p.x, (p.top - 0.9) / 2, p.z, 0.8, (p.top - 0.9) / 2, 0.8, p.yaw, 0.3);

  // Autoroutes : tablier + glissières (+ flancs pleins) en un trimesh chacune
  for (const hw of [city.highway, city.ringway]) addHighwayCollider(hw);
  // Route de montagne : chaussée et glissières, plateau du sommet, parapets.
  if (city.mountain) {
    const mt = city.mountain;
    addHighwayCollider(mt.road);
    world.createCollider(R.ColliderDesc.cylinder(1, mt.rTop).setTranslation(mt.cx, mt.height - 1, mt.cz).setFriction(0.9).setCollisionGroups(GROUP_WORLD));
    count++;
  }
  for (const br of city.bridges) addHighwayCollider(br);
  for (const br of city.bridges) for (const p of br.pillars) box(p.x, (p.top - 0.9) / 2, p.z, 0.8, (p.top - 0.9) / 2, 0.8, p.yaw, 0.3);
  // Buttes : un cône (prolongé jusqu'à sa pointe) par butte.
  for (const m of city.mounds) {
    if (!m.solid) continue;
    const full = (m.height * m.r0) / (m.r0 - m.r1);
    world.createCollider(R.ColliderDesc.cone(full / 2, m.r0).setTranslation(m.x, full / 2, m.z).setFriction(0.6).setCollisionGroups(GROUP_WORLD));
    count++;
  }
  for (const b of city.solids) box(b.x, b.y, b.z, b.hx, b.hy, b.hz, b.yaw, 0.3);
  return count;
}
