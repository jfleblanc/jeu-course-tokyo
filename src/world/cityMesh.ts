import * as THREE from 'three/webgpu';
import { GeomBuilder, type Vec3 } from '../render/geomBuilder';
import type { CityMaterials } from '../render/materials';
import type { Building, CityData, HighwaySample } from './cityGen';
import { pointAt, type GraphEdge, type GraphNode, type PathPoint } from './streetGraph';

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
  const f = b.footprint;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  // Repère local de l'immeuble → monde
  const wx = (lx: number, lz: number): number => f.cx + lx * c + lz * s;
  const wz = (lx: number, lz: number): number => f.cz - lx * s + lz * c;
  for (const t of b.tiers) {
    gb.box(f.cx, (t.y0 + t.y1) / 2, f.cz, t.w, t.y1 - t.y0, t.d, f.yaw, b.wall, data, true, false);
  }
  const top = b.tiers[b.tiers.length - 1];
  if (!top) return;
  const w = top.w, d = top.d;
  // Petits volumes techniques sur le toit (aData.w = 20 : pas de fenêtres)
  const roofData = [iseed, 1, 0, 20] as const;
  const k = b.seed * 97;
  const r1 = k - Math.floor(k);
  const r2 = (k * 7.3) % 1;
  if (w > 8 && d > 8) {
    const lx = (r1 - 0.5) * w * 0.4, lz = (r2 - 0.5) * d * 0.4;
    gb.box(wx(lx, lz), top.y1 + 1.1, wz(lx, lz), Math.min(5, w * 0.35), 2.2, Math.min(4, d * 0.35), f.yaw, [b.wall[0] * 0.8, b.wall[1] * 0.8, b.wall[2] * 0.8], roofData);
  }
  // Parapet
  if (b.height < 90) {
    const ph = 0.7;
    const col: Vec3 = [b.wall[0] * 1.1, b.wall[1] * 1.1, b.wall[2] * 1.1];
    gb.box(wx(0, d / 2 - 0.15), top.y1 + ph / 2, wz(0, d / 2 - 0.15), w, ph, 0.3, f.yaw, col, roofData);
    gb.box(wx(0, -d / 2 + 0.15), top.y1 + ph / 2, wz(0, -d / 2 + 0.15), w, ph, 0.3, f.yaw, col, roofData);
    gb.box(wx(w / 2 - 0.15, 0), top.y1 + ph / 2, wz(w / 2 - 0.15, 0), 0.3, ph, d, f.yaw, col, roofData);
    gb.box(wx(-w / 2 + 0.15, 0), top.y1 + ph / 2, wz(-w / 2 + 0.15, 0), 0.3, ph, d, f.yaw, col, roofData);
  }
  // Balise rouge clignotante sur les immeubles hauts (type 5 : clignote)
  if (b.height > 48) {
    gb.box(f.cx, top.y1 + 2.5, f.cz, 0.18, 5, 0.18, 0, DARK_METAL, roofData);
    glow.box(f.cx, top.y1 + 5.2, f.cz, 0.7, 0.7, 0.7, 0, [1, 0.06, 0.04], [iseed, 5, 1, 1], true, true);
  }
}

const CURB: Vec3 = [0.11, 0.115, 0.125];

/** Chaussée d'une rue : ruban qui suit la courbe, entre les deux carrefours. */
function addRoadEdge(gb: GeomBuilder, solid: GeomBuilder, e: GraphEdge): void {
  const half = e.width / 2;
  const s0 = e.trimA, s1 = e.length - e.trimB;
  const usable = s1 - s0;
  if (usable <= 0.05) return;
  const data = [ROAD_KIND[e.kind], usable, half, 0] as const;
  const steps = Math.max(1, Math.ceil(usable / 5));
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  let pl: Vec3 = [0, 0, 0], pr: Vec3 = [0, 0, 0], pv = 0;
  for (let k = 0; k <= steps; k++) {
    const v = (usable * k) / steps;
    pointAt(e, s0 + v, p);
    // gauche = (tz, −tx)
    const l: Vec3 = [p.x + p.tz * half, 0, p.z - p.tx * half];
    const r: Vec3 = [p.x - p.tz * half, 0, p.z + p.tx * half];
    if (k > 0) {
      // UV : u = position en travers (−half..half), v = distance le long de la rue
      gb.quadUv(pr, r, l, pl, [0, 1, 0], [-half, pv, -half, v, half, v, half, pv], [1, 1, 1], data);
      // Bordure de trottoir (visuelle) de chaque côté
      for (const side of [1, -1]) {
        const a = side > 0 ? pl : pr, b = side > 0 ? l : r;
        const ox = p.tz * side * 0.3, oz = -p.tx * side * 0.3;
        const a2: Vec3 = [a[0] + ox, 0.09, a[2] + oz], b2: Vec3 = [b[0] + ox, 0.09, b[2] + oz];
        const a1: Vec3 = [a[0], 0.09, a[2]], b1: Vec3 = [b[0], 0.09, b[2]];
        solid.quad(a1, b1, b2, a2, [0, 1, 0], 0, 0, 1, 1, CURB);
        solid.quad(a, b, b1, a1, [-p.tz * side, 0, p.tx * side], 0, 0, 1, 1, CURB);
      }
    }
    pl = l;
    pr = r;
    pv = v;
  }
}

/** Surface d'un carrefour : éventail de triangles autour du nœud. */
function addJunction(gb: GeomBuilder, n: GraphNode): void {
  const o = n.outline;
  if (o.length < 3) return;
  const data = [ROAD_KIND.intersection, 1e6, 100, 0] as const;
  const c: Vec3 = [n.x, 0, n.z];
  for (let k = 0; k < o.length; k++) {
    const a = o[k] as { x: number; z: number };
    const b = o[(k + 1) % o.length] as { x: number; z: number };
    gb.tri(c, [a.x, 0, a.z], [b.x, 0, b.z], [0, 1, 0], [1, 1, 1], data);
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
  const sh = 0; // les trottoirs sont au niveau du sol (seule la bordure est en relief)

  // ——— Immeubles ———
  const bld = new GeomBuilder();
  const glow = new GeomBuilder();
  for (const b of city.buildings) addBuilding(bld, glow, b);

  // ——— Sol (dallage de trottoir partout), routes par-dessus, bordures ———
  const solid = new GeomBuilder();
  const groundGeo = new GeomBuilder();
  // Le sol est découpé en dalles de 60 m : un seul triangle géant perd en précision de profondeur
  // et passerait par endroits devant la chaussée posée 5 cm plus haut.
  {
    const gy = -0.05;
    const cell = 60;
    const b = city.bounds;
    const x0 = Math.floor(b.x0 / cell) * cell, x1 = Math.ceil(b.x1 / cell) * cell;
    const z0 = Math.floor(b.z0 / cell) * cell, z1 = Math.ceil(b.z1 / cell) * cell;
    const tile = (ax: number, az: number, bx: number, bz: number): void => {
      groundGeo.quad([ax, gy, bz], [bx, gy, bz], [bx, gy, az], [ax, gy, az], [0, 1, 0], 0, 0, 1, 1, SIDEWALK);
    };
    for (let x = x0; x < x1; x += cell) for (let z = z0; z < z1; z += cell) tile(x, z, x + cell, z + cell);
    // Au-delà de la ville (dans le brouillard) : quatre grandes dalles suffisent.
    const G = 2600;
    tile(-G, -G, G, z0);
    tile(-G, z1, G, G);
    tile(-G, z0, x0, z1);
    tile(x1, z0, G, z1);
  }
  const roads = new GeomBuilder();
  for (const e of city.graph.edges) addRoadEdge(roads, solid, e);
  for (const n of city.graph.nodes) addJunction(roads, n);

  // ——— Parcs, arbres, mobilier ———
  for (const r of city.parks) {
    solid.box(r.cx, 0.0, r.cz, r.w, 0.06, r.d, r.yaw, [0.02, 0.05, 0.03]);
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

  for (const [builder, mat, name] of [
    [groundGeo, mats.ground, 'sol'],
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
