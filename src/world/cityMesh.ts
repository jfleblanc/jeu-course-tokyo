import * as THREE from 'three/webgpu';
import { WORLD } from '../config/world';
import { GeomBuilder, type Vec3 } from '../render/geomBuilder';
import type { CityMaterials } from '../render/materials';
import type { Building, CityData, HighwaySample } from './cityGen';
import type { GraphEdge } from './streetGraph';

/**
 * Transforme les données de la ville en maillages. Tout est fusionné par matériau :
 * une poignée de draw calls pour tout le quartier.
 */

const ROAD_KIND = { intersection: 0, alley: 1, street: 2, avenue: 3, boulevard: 4, highway: 5 } as const;
const SIDEWALK: Vec3 = [0.075, 0.078, 0.09];
const CONCRETE: Vec3 = [0.085, 0.088, 0.095];
const DARK_METAL: Vec3 = [0.035, 0.037, 0.042];

function addBuilding(gb: GeomBuilder, glow: GeomBuilder, b: Building): void {
  // aData = (graine, largeur de cellule, part allumée, style) ; style +10 = décor lointain
  const iseed = Math.floor(b.seed * 4000);
  const data = [iseed, b.cellW, b.lit, b.style + (b.backdrop ? 10 : 0)] as const;
  for (const t of b.tiers) {
    const sx = t.x1 - t.x0;
    const sz = t.z1 - t.z0;
    gb.box((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2, sx, t.y1 - t.y0, sz, 0, b.wall, data, true, false);
  }
  const top = b.tiers[b.tiers.length - 1];
  if (!top) return;
  const cx = (top.x0 + top.x1) / 2;
  const cz = (top.z0 + top.z1) / 2;
  const w = top.x1 - top.x0;
  const d = top.z1 - top.z0;
  // Petits volumes techniques sur le toit (aData.w = 20 : pas de fenêtres)
  const roofData = [iseed, 1, 0, 20] as const;
  const k = b.seed * 97;
  const r1 = k - Math.floor(k);
  const r2 = (k * 7.3) % 1;
  if (w > 8 && d > 8) {
    gb.box(cx + (r1 - 0.5) * w * 0.4, top.y1 + 1.1, cz + (r2 - 0.5) * d * 0.4, Math.min(5, w * 0.35), 2.2, Math.min(4, d * 0.35), 0, [b.wall[0] * 0.8, b.wall[1] * 0.8, b.wall[2] * 0.8], roofData);
  }
  // Parapet
  if (!b.backdrop || b.height < 90) {
    const ph = 0.7;
    const col: Vec3 = [b.wall[0] * 1.1, b.wall[1] * 1.1, b.wall[2] * 1.1];
    gb.box(cx, top.y1 + ph / 2, top.z0 + 0.15, w, ph, 0.3, 0, col, roofData);
    gb.box(cx, top.y1 + ph / 2, top.z1 - 0.15, w, ph, 0.3, 0, col, roofData);
    gb.box(top.x0 + 0.15, top.y1 + ph / 2, cz, 0.3, ph, d, 0, col, roofData);
    gb.box(top.x1 - 0.15, top.y1 + ph / 2, cz, 0.3, ph, d, 0, col, roofData);
  }
  // Balise rouge clignotante sur les immeubles hauts (aData.y = 5 : clignote)
  if (b.height > 48) {
    gb.box(cx, top.y1 + 2.5, cz, 0.18, 5, 0.18, 0, DARK_METAL, roofData);
    glow.box(cx, top.y1 + 5.2, cz, 0.7, 0.7, 0.7, 0, [1, 0.06, 0.04], [iseed, 5, 1, 1], true, true);
  }
}

function addRoadEdge(gb: GeomBuilder, e: GraphEdge): void {
  const half = e.width / 2;
  const data = [ROAD_KIND[e.kind], e.length, half, 0] as const;
  const L = e.length;
  // UV : u = position en travers (−half..half), v = distance le long de la rue
  if (e.alongX) {
    gb.quadUv([e.x0, 0, e.z0 + half], [e.x1, 0, e.z0 + half], [e.x1, 0, e.z0 - half], [e.x0, 0, e.z0 - half], [0, 1, 0], [half, 0, half, L, -half, L, -half, 0], [1, 1, 1], data);
  } else {
    gb.quadUv([e.x0 - half, 0, e.z0], [e.x0 - half, 0, e.z1], [e.x0 + half, 0, e.z1], [e.x0 + half, 0, e.z0], [0, 1, 0], [-half, 0, -half, L, half, L, half, 0], [1, 1, 1], data);
  }
}

function addHighway(city: CityData, road: GeomBuilder, solid: GeomBuilder, glow: GeomBuilder): void {
  const hw = city.highway;
  const s = hw.samples;
  const half = hw.halfWidth;
  const bh = hw.barrierHeight;
  const thick = 0.9;
  const edge = (p: HighwaySample, side: number, lift = 0): Vec3 => [p.x + -p.tz * side * half, p.y + lift, p.z + p.tx * side * half];
  const edgeOut = (p: HighwaySample, side: number, lift: number, out: number): Vec3 => [p.x + -p.tz * side * (half + out), p.y + lift, p.z + p.tx * side * (half + out)];
  for (let k = 0; k < s.length - 1; k++) {
    const a = s[k] as HighwaySample;
    const b = s[k + 1] as HighwaySample;
    const len = b.s - a.s;
    // Chaussée (gauche = +1 : côté −tz, +tx tourné de 90°)
    const aL = edge(a, 1, 0.02), aR = edge(a, -1, 0.02), bL = edge(b, 1, 0.02), bR = edge(b, -1, 0.02);
    const data = [ROAD_KIND.highway, 1e6, half, 0] as const;
    road.quadUv(aL, bL, bR, aR, [0, 1, 0], [half, a.s, half, b.s, -half, b.s, -half, a.s], [1, 1, 1], data);
    // Dessous et flancs du tablier ; sous 4 m, le flanc descend jusqu'au sol (rampe pleine).
    const lowA = Math.max(0, a.y - thick) * (a.y < 4 ? 0 : 1);
    const lowB = Math.max(0, b.y - thick) * (b.y < 4 ? 0 : 1);
    for (const side of [1, -1]) {
      const topA = edgeOut(a, side, 0.02, 0.35), topB = edgeOut(b, side, 0.02, 0.35);
      const botA: Vec3 = [topA[0], lowA, topA[2]];
      const botB: Vec3 = [topB[0], lowB, topB[2]];
      const n: Vec3 = [-a.tz * side, 0, a.tx * side];
      if (side > 0) solid.quad(botB, botA, topA, topB, n, 0, 0, len, 1, CONCRETE);
      else solid.quad(botA, botB, topB, topA, n, 0, 0, len, 1, CONCRETE);
      // Glissière : muret plein + liseré lumineux
      const inA = edge(a, side, 0.02), inB = edge(b, side, 0.02);
      const inTopA = edge(a, side, bh), inTopB = edge(b, side, bh);
      const outTopA = edgeOut(a, side, bh, 0.35), outTopB = edgeOut(b, side, bh, 0.35);
      const nin: Vec3 = [a.tz * side, 0, -a.tx * side];
      if (side > 0) {
        solid.quad(inA, inB, inTopB, inTopA, nin, 0, 0, len, bh, CONCRETE);
        solid.quad(inTopA, inTopB, outTopB, outTopA, [0, 1, 0], 0, 0, len, 0.35, CONCRETE);
        solid.quad(topB, topA, outTopA, outTopB, n, 0, 0, len, bh, CONCRETE);
        glow.quad([inA[0], inA[1] + 0.5, inA[2]], [inB[0], inB[1] + 0.5, inB[2]], [inB[0], inB[1] + 0.62, inB[2]], [inA[0], inA[1] + 0.62, inA[2]], nin, 0, 0, len, 0.12, [1.0, 0.5, 0.12], [1, 3, 1, 0.9]);
      } else {
        solid.quad(inB, inA, inTopA, inTopB, nin, 0, 0, len, bh, CONCRETE);
        solid.quad(inTopB, inTopA, outTopA, outTopB, [0, 1, 0], 0, 0, len, 0.35, CONCRETE);
        solid.quad(topA, topB, outTopB, outTopA, n, 0, 0, len, bh, CONCRETE);
        glow.quad([inB[0], inB[1] + 0.5, inB[2]], [inA[0], inA[1] + 0.5, inA[2]], [inA[0], inA[1] + 0.62, inA[2]], [inB[0], inB[1] + 0.62, inB[2]], nin, 0, 0, len, 0.12, [1.0, 0.5, 0.12], [1, 3, 1, 0.9]);
      }
    }
    if (a.y >= 4 || b.y >= 4) {
      const uaL = edgeOut(a, 1, 0, 0.35), uaR = edgeOut(a, -1, 0, 0.35), ubL = edgeOut(b, 1, 0, 0.35), ubR = edgeOut(b, -1, 0, 0.35);
      solid.quad([uaL[0], lowA, uaL[2]], [ubL[0], lowB, ubL[2]], [ubR[0], lowB, ubR[2]], [uaR[0], lowA, uaR[2]], [0, -1, 0], 0, 0, 1, 1, CONCRETE);
    }
  }
  for (const p of hw.pillars) {
    const h = p.top - 0.9;
    solid.box(p.x, h / 2, p.z, 1.5, h, 1.5, p.yaw, CONCRETE);
    solid.box(p.x, h - 0.35, p.z, half * 2 + 0.4, 0.9, 2.0, p.yaw, CONCRETE, [0, 0, 0, 0], true, true);
    // Néon bleu sous le tablier, de chaque côté du pilier
    glow.box(p.x, h - 0.85, p.z, half * 1.6, 0.08, 0.14, p.yaw, [0.2, 0.55, 1.0], [1, 3, 1, 1.2], false, true);
  }
}

export interface CityMeshes {
  group: THREE.Group;
  triangles: number;
}

export function buildCityMeshes(city: CityData, mats: CityMaterials): CityMeshes {
  const group = new THREE.Group();
  group.name = 'ville';
  const sh = WORLD.sidewalkHeight;

  // ——— Immeubles ———
  const bld = new GeomBuilder();
  const glow = new GeomBuilder();
  for (const b of city.buildings) addBuilding(bld, glow, b);

  // ——— Routes ———
  const roads = new GeomBuilder();
  for (const e of city.graph.edges) addRoadEdge(roads, e);
  for (const n of city.graph.nodes) {
    if (n.halfX <= 0 || n.halfZ <= 0) continue;
    roads.quad(
      [n.x - n.halfX, 0, n.z + n.halfZ], [n.x + n.halfX, 0, n.z + n.halfZ], [n.x + n.halfX, 0, n.z - n.halfZ], [n.x - n.halfX, 0, n.z - n.halfZ],
      [0, 1, 0], 0, 0, 1, 1, [1, 1, 1], [ROAD_KIND.intersection, 1e6, 100, 0],
    );
  }

  // ——— Trottoirs, parcs, mobilier ———
  const solid = new GeomBuilder();
  for (const r of city.blocks) {
    solid.box((r.x0 + r.x1) / 2, sh / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, sh, r.z1 - r.z0, 0, SIDEWALK);
  }
  // Bande de trottoir extérieure, sous les immeubles de décor
  const B = city.bounds;
  const outer = 60;
  solid.box((B.x0 + B.x1) / 2, sh / 2, B.z0 - outer / 2, B.x1 - B.x0 + outer * 2, sh, outer, 0, SIDEWALK);
  solid.box((B.x0 + B.x1) / 2, sh / 2, B.z1 + outer / 2, B.x1 - B.x0 + outer * 2, sh, outer, 0, SIDEWALK);
  solid.box(B.x0 - outer / 2, sh / 2, (B.z0 + B.z1) / 2, outer, sh, B.z1 - B.z0, 0, SIDEWALK);
  solid.box(B.x1 + outer / 2, sh / 2, (B.z0 + B.z1) / 2, outer, sh, B.z1 - B.z0, 0, SIDEWALK);
  for (const r of city.parks) {
    solid.box((r.x0 + r.x1) / 2, sh + 0.02, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.04, r.z1 - r.z0, 0, [0.02, 0.05, 0.03]);
  }
  for (const t of city.trees) {
    solid.cylinder(t.x, sh, t.z, 0.22, 0.14, t.height * 0.5, 6, [0.05, 0.035, 0.025], [0, 0, 0, 0], false);
    solid.cylinder(t.x, sh + t.height * 0.35, t.z, t.radius, t.radius * 0.55, t.height * 0.35, 7, [0.02, 0.07, 0.04], [0, 0, 0, 0], false);
    solid.cylinder(t.x, sh + t.height * 0.7, t.z, t.radius * 0.55, 0.05, t.height * 0.3, 7, [0.025, 0.08, 0.045], [0, 0, 0, 0], false);
  }
  for (const l of city.lamps) {
    solid.cylinder(l.x, sh, l.z, 0.1, 0.07, l.height, 6, DARK_METAL, [0, 0, 0, 0], false);
    const ax = l.x + l.dx * l.arm * 0.5;
    const az = l.z + l.dz * l.arm * 0.5;
    const yaw = Math.atan2(l.dx, l.dz);
    solid.box(ax, sh + l.height, az, 0.09, 0.09, l.arm, yaw, DARK_METAL, [0, 0, 0, 0], true, true);
    // Tête lumineuse (aData : graine, type 3 = uni, -, intensité)
    glow.box(l.x + l.dx * l.arm, sh + l.height - 0.08, l.z + l.dz * l.arm, 0.32, 0.12, 0.8, yaw, l.color, [1, 3, 1, 2.6], true, true);
  }
  for (const p of city.props) solid.box(p.x, p.y, p.z, p.sx, p.sy, p.sz, p.yaw, p.color);
  for (const g of city.glowBoxes) glow.box(g.x, g.y, g.z, g.sx, g.sy, g.sz, g.yaw, g.color, [1, 4, 1, 1.5], true, false);

  // ——— Enseignes ———
  for (const sg of city.signs) {
    const yaw = Math.atan2(sg.nx, sg.nz);
    // aData : graine, type, largeur de la grande face, hauteur
    const faceW = Math.max(sg.along, sg.out);
    glow.box(sg.x, sg.y, sg.z, sg.along, sg.up, sg.out, yaw, sg.color, [Math.floor(sg.seed * 4000), sg.type, faceW, sg.up], true, true);
  }

  // ——— Autoroute surélevée ———
  const hwRoad = new GeomBuilder();
  addHighway(city, hwRoad, solid, glow);

  // ——— Flaques de lumière au sol (plans additifs, pas de vraies lumières) ———
  const pools = new GeomBuilder();
  for (const p of city.pools) {
    const r = p.radius;
    const c: Vec3 = [p.color[0] * p.intensity, p.color[1] * p.intensity, p.color[2] * p.intensity];
    pools.quad([p.x - r, 0.04, p.z + r], [p.x + r, 0.04, p.z + r], [p.x + r, 0.04, p.z - r], [p.x - r, 0.04, p.z - r], [0, 1, 0], 0, 0, 1, 1, c);
  }

  const roadGeo = roads.build();

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, order = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.matrixAutoUpdate = false;
    m.frustumCulled = false; // un seul gros maillage : toujours visible
    m.renderOrder = order;
    group.add(m);
    return m;
  };
  let triangles = 0;
  const tri = (g: THREE.BufferGeometry): number => (g.index ? g.index.count / 3 : 0);

  // Sol de base, loin sous le brouillard
  const base = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mats.ground);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.05;
  base.name = 'sol';
  group.add(base);

  for (const [builder, mat, name] of [
    [bld, mats.building, 'immeubles'],
    [solid, mats.solid, 'mobilier'],
    [glow, mats.glow, 'lumineux'],
    [hwRoad, mats.highwayRoad, 'autoroute'],
  ] as const) {
    const geo = builder.build();
    triangles += tri(geo);
    add(geo, mat, name);
  }
  triangles += tri(roadGeo);
  add(roadGeo, mats.road, 'routes');
  const poolGeo = pools.build();
  triangles += tri(poolGeo);
  add(poolGeo, mats.pool, 'flaques', 2);

  return { group, triangles };
}
