import { GROUP_WORLD, type PhysicsWorld, GROUP_BARRIER } from '../physics/physicsWorld';
import { RailGuide, setRailGuide } from './railGuide';
import { GARAGE, GARAGE_BOUNDS, garageToWorld } from './garageSite';
import type { CityData, Highway, HighwaySample } from './cityGen';

/**
 * Collisions de la ville : des boîtes simples (jamais le maillage visuel),
 * plus un maillage de triangles pour l'autoroute surélevée.
 */
/** Troncs des gros arbres, par numéro d'arbre : on peut les désactiver quand l'arbre est cassé. */
export const treeTrunks = new Map<number, { setEnabled(on: boolean): void }>();

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
  const site = city.garage;
  if (!site) box(0, -1, 0, 3000, 1, 3000, 0, 0.9);
  else {
    // Le sol est troué à l'emplacement du garage : quatre grandes dalles autour d'un carré, puis,
    // dans ce carré, des blocs posés dans le repère du garage qui laissent libres l'atelier et la
    // rampe. Les blocs sont épais : leurs flancs servent de murs au sous-sol.
    const Q = 70, far = 3000;
    box(site.x, -1, site.z + Q + far / 2, far, 1, far / 2, 0, 0.9);
    box(site.x, -1, site.z - Q - far / 2, far, 1, far / 2, 0, 0.9);
    box(site.x + Q + far / 2, -1, site.z, far / 2, 1, Q, 0, 0.9);
    box(site.x - Q - far / 2, -1, site.z, far / 2, 1, Q, 0, 0.9);
    const G = GARAGE, GB = GARAGE_BOUNDS, L = 115, deep = 5;
    // bloc local : de (x0, z0) à (x1, z1), du niveau `top` jusqu'à `deep` mètres sous le sol de l'atelier
    const block = (x0: number, z0: number, x1: number, z1: number, top = 0, friction = 0.9): void => {
      const [wx, wz] = garageToWorld(site, (x0 + x1) / 2, (z0 + z1) / 2);
      const bottom = G.floor - deep;
      box(wx, (top + bottom) / 2, wz, (x1 - x0) / 2, (top - bottom) / 2, (z1 - z0) / 2, site.yaw, friction);
    };
    block(-L, -L, GB.x0, L);
    block(GB.x1, -L, L, L);
    block(GB.x0, -L, GB.x1, GB.z0);
    block(GB.x0, GB.z1, GB.x1, L);
    // Sous l'immeuble, entre l'atelier et la rue ; et derrière le palier.
    block(GB.x0, G.halfD + G.wall, G.rampX0, GB.z1);
    block(G.rampX0, GB.z0, GB.x1, G.landingZ0);
    // Sol de l'atelier et du palier.
    block(GB.x0, GB.z0, GB.x1, G.rampZ0 + 0.5, G.floor);
    // Mur entre l'atelier et le palier, de part et d'autre de la porte.
    block(G.halfW, G.landingZ0, G.rampX0, G.doorZ0, 0, 0.3);
    block(G.halfW, G.doorZ1, G.rampX0, G.halfD + G.wall, 0, 0.3);
    // Accessoires fixes de l'atelier : étagères au fond, piles de pneus, fûts (le mobilier du modèle 3D est mesuré au chargement).
    {
      const solid = (x0: number, z0: number, x1: number, z1: number, h: number): void => {
        const [wx, wz] = garageToWorld(site, (x0 + x1) / 2, (z0 + z1) / 2);
        box(wx, G.floor + h / 2, wz, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, site.yaw, 0.3);
      };
      solid(-11.5, -G.halfD, -7.7, -G.halfD + 0.75, 3.2); // étagères
      solid(10.2, 7.0, 12.3, G.halfD, 1.1); // pneus
      solid(-12.6, 7.0, -10.5, G.halfD, 1.3);
      solid(3.9, 7.2, 6.7, G.halfD, 0.9); // fûts
    }
    // Rampe : une dalle inclinée du palier jusqu'à la rue.
    {
      const run = G.rampZ1 - G.rampZ0, rise = -G.floor;
      const len = Math.hypot(run, rise), pitch = -Math.asin(rise / len), T = 0.4;
      const [wx, wz] = garageToWorld(site, (G.rampX0 + G.rampX1) / 2, (G.rampZ0 + G.rampZ1) / 2);
      // (centre décalé d'une demi-épaisseur sous la surface, le long de la normale)
      const ny = run / len, nzl = -rise / len;
      const [ox, oz] = [Math.sin(site.yaw) * nzl * (T / 2), Math.cos(site.yaw) * nzl * (T / 2)];
      const cy = Math.cos(site.yaw / 2), sy = Math.sin(site.yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      world.createCollider(R.ColliderDesc.cuboid((G.rampX1 - G.rampX0) / 2, T / 2, len / 2 + 0.3)
        .setTranslation(wx - ox, G.floor / 2 - ny * (T / 2), wz - oz)
        .setRotation({ x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp })
        .setFriction(0.9).setCollisionGroups(GROUP_WORLD));
      count++;
    }
    // L'immeuble au-dessus (son plancher est le plafond de l'atelier) et le parapet de la rampe.
    {
      const [wx, wz] = garageToWorld(site, 0, (GB.z0 + GB.z1 - 2) / 2);
      box(wx, G.buildingHeight / 2 + 0.02, wz, G.halfW + G.wall, G.buildingHeight / 2, (GB.z1 - 2 - GB.z0) / 2, site.yaw, 0.3);
      const [px, pz] = garageToWorld(site, GB.x1 + 0.2, (G.landingZ0 + GB.z1 - 3) / 2);
      box(px, 0.5, pz, 0.2, 0.5, (GB.z1 - 3 - G.landingZ0) / 2, site.yaw, 0.3);
      const [qx, qz] = garageToWorld(site, (G.rampX0 + GB.x1) / 2, G.landingZ0 - 0.2);
      box(qx, 0.5, qz, (GB.x1 - G.rampX0) / 2 + 0.4, 0.5, 0.2, site.yaw, 0.3);
    }
  }

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
  treeTrunks.clear();
  city.trees.forEach((t, i) => {
    if (!t.solid) return;
    treeTrunks.set(i, world.createCollider(R.ColliderDesc.cuboid(0.3, 1.5, 0.3).setTranslation(t.x, (t.y ?? 0) + 1.5, t.z).setFriction(0.3).setRestitution(0.05).setCollisionGroups(GROUP_WORLD)));
    count++;
  });
  return count;
}
