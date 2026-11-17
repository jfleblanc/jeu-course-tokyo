import { GROUP_WORLD, type PhysicsWorld, GROUP_BARRIER } from '../physics/physicsWorld';
import { RailGuide, setRailGuide } from './railGuide';
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

  // Glissières douces : toutes les routes à glissières y sont inscrites.
  const rails = new RailGuide();
  setRailGuide(rails);

  const addHighwayCollider = (hw: Highway): void => {
    rails.add(hw);
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
        // (le tablier se prolonge sous la glissière : une roue au ras du bord a toujours la route sous elle)
        verts.push(p.x + ox * (half + 0.34), p.y + 0.02, p.z + oz * (half + 0.34));
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
    // Glissières : des boîtes pleines à bords arrondis, bout à bout.
    // Une paroi de triangles laissait la caisse s'enfoncer puis s'accrocher ; des boîtes bout à
    // bout à angles vifs faisaient buter la caisse sur chaque jointure. Des bouts ronds qui se
    // recouvrent donnent une paroi lisse : on glisse le long sans à-coup.
    const RAD = 0.26, T = 0.3, FRICTION = Number((globalThis as { BARRIER_FRICTION?: number }).BARRIER_FRICTION ?? 0);
    for (const side of [1, -1]) {
      const bh = hw.barrierHeight + (side === hw.outerSide ? 1.6 : 0.5);
      let k = 0;
      while (k < segs) {
        if (inGap(side, k)) { k++; continue; }
        // Sur les portions presque droites, un élément couvre deux tronçons.
        let span = 1;
        if (k + 1 < segs && !inGap(side, k + 1)) {
          const p0 = s[k] as HighwaySample, p2 = s[(k + 2) % n] as HighwaySample;
          if (p0.tx * p2.tx + p0.tz * p2.tz > 0.9994 && Math.abs(p2.y - 2 * (s[(k + 1) % n] as HighwaySample).y + p0.y) < 0.02) span = 2;
        }
        const pa = s[k] as HighwaySample, pb = s[(k + span) % n] as HighwaySample;
        // (en retrait de 12 cm : la glissière douce agit avant, l'obstacle physique n'est qu'un secours)
        const off = half + T + 0.12;
        const ax = pa.x - pa.tz * side * off, az = pa.z + pa.tx * side * off;
        const bx = pb.x - pb.tz * side * off, bz = pb.z + pb.tx * side * off;
        const dx = bx - ax, dy = pb.y - pa.y, dz = bz - az;
        const len = Math.hypot(dx, dy, dz) || 1;
        const yaw = Math.atan2(dx, dz), pitch = -Math.asin(dy / len);
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        // Boîte à bords arrondis : face plane côté route, bouts ronds qui recouvrent l'élément suivant.
        // Aucun frottement ni rebond : on glisse le long.
        world.createCollider(R.ColliderDesc.roundCuboid(T - RAD, bh / 2 + 0.3 - RAD, len / 2, RAD)
          .setTranslation((ax + bx) / 2, (pa.y + pb.y) / 2 + bh / 2 - 0.3, (az + bz) / 2)
          .setRotation({ x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp })
          .setFriction(FRICTION).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0).setRestitutionCombineRule(R.CoefficientCombineRule.Min).setCollisionGroups(GROUP_BARRIER));
        count++;
        k += span;
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = k * PER;
      const b = ((k + 1) % n) * PER;
      quad(a + 0, b + 0, b + 4, a + 4); // tablier
      for (const [o, side] of [[0, 1], [4, -1]] as const) {
        if (inGap(side, k)) continue; // ouverture pour une bretelle
        quad(a + o + 2, a + o + 3, b + o + 3, b + o + 2); // face extérieure / flanc
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
    // Relief : mêmes triangles que l'affichage (la route passe 0,6 m au-dessus).
    const T = mt.terrain;
    const verts = new Float32Array(T.ni * T.nj * 3);
    for (let j = 0; j < T.nj; j++) for (let i = 0; i < T.ni; i++) {
      const o = (j * T.ni + i) * 3;
      verts[o] = T.x0 + (T.ux * i + T.vx * j) * T.cell;
      verts[o + 1] = T.heights[j * T.ni + i] as number;
      verts[o + 2] = T.z0 + (T.uz * i + T.vz * j) * T.cell;
    }
    const idx: number[] = [];
    for (let j = 0; j < T.nj - 1; j++) for (let i = 0; i < T.ni - 1; i++) {
      const a = j * T.ni + i, b = a + 1, c = a + T.ni, d = c + 1;
      if ((verts[a * 3 + 1] as number) <= 0 && (verts[b * 3 + 1] as number) <= 0 && (verts[c * 3 + 1] as number) <= 0 && (verts[d * 3 + 1] as number) <= 0) continue;
      idx.push(a, d, b, a, c, d);
    }
    world.createCollider(R.ColliderDesc.trimesh(verts, new Uint32Array(idx), R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8).setCollisionGroups(GROUP_WORLD));
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
