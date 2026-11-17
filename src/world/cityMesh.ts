import * as THREE from 'three/webgpu';
import { GeomBuilder, type Vec3 } from '../render/geomBuilder';
import type { CityMaterials } from '../render/materials';
import type { Building, CityData, Connector, Highway, HighwaySample } from './cityGen';
import { pointAt, pointInPolygon, type GraphEdge, type GraphNode, type PathPoint } from './streetGraph';

/**
 * Transforme les données de la ville en maillages. Tout est fusionné par matériau :
 * une poignée de draw calls pour tout le quartier.
 */

const ROAD_KIND = { intersection: 0, alley: 1, street: 2, avenue: 3, boulevard: 4, highway: 5, ringway: 6, connector: 7 } as const;
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
function addRoadEdge(gb: GeomBuilder, solid: GeomBuilder, e: GraphEdge, skipCurb: (x: number, z: number) => boolean): void {
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
        if (e.onRing && skipCurb((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)) continue;
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

function addHighway(hw: Highway, road: GeomBuilder, solid: GeomBuilder, glow: GeomBuilder, roadKind: number): void {
  const s = hw.samples;
  const half = hw.halfWidth;
  const bh = hw.barrierHeight;
  const thick = 0.9;
  const n = s.length;
  const inGap = (side: number, k: number): boolean => {
    for (const g of hw.gaps) {
      if (g.side !== side) continue;
      // Les indices d'ouverture peuvent dépasser la boucle : on compare modulo n.
      const rel = (((k - g.from) % n) + n) % n;
      if (rel <= g.to - g.from) return true;
    }
    return false;
  };
  const edge = (p: HighwaySample, side: number, lift = 0): Vec3 => [p.x + -p.tz * side * half, p.y + lift, p.z + p.tx * side * half];
  const edgeOut = (p: HighwaySample, side: number, lift: number, out: number): Vec3 => [p.x + -p.tz * side * (half + out), p.y + lift, p.z + p.tx * side * (half + out)];
  const segs = hw.closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = s[k] as HighwaySample;
    const b = s[(k + 1) % n] as HighwaySample;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const va = a.s, vb = a.s + len;
    const aL = edge(a, 1, 0.02), aR = edge(a, -1, 0.02), bL = edge(b, 1, 0.02), bR = edge(b, -1, 0.02);
    const data = [roadKind, 1e6, half, 0] as const;
    road.quadUv(aL, bL, bR, aR, [0, 1, 0], [half, va, half, vb, -half, vb, -half, va], [1, 1, 1], data);
    for (const side of [1, -1]) {
      // Flanc : sous 4 m (rampe) et sur le côté extérieur de la ville, il descend jusqu'au sol.
      const toGround = side === hw.outerSide;
      const lowA = toGround || a.y < 4 ? 0 : a.y - thick;
      const lowB = toGround || b.y < 4 ? 0 : b.y - thick;
      const topA = edgeOut(a, side, 0.02, 0.35), topB = edgeOut(b, side, 0.02, 0.35);
      const botA: Vec3 = [topA[0], lowA, topA[2]];
      const botB: Vec3 = [topB[0], lowB, topB[2]];
      const nrm: Vec3 = [-a.tz * side, 0, a.tx * side];
      const open = inGap(side, k);
      if (a.y > 0.05 || b.y > 0.05) solid.quad(botB, botA, topA, topB, nrm, 0, 0, len, 1, CONCRETE);
      if (open) continue;
      // Glissière : muret plein + liseré lumineux (le mur extérieur est plus haut).
      const h = toGround ? bh + 1.6 : bh;
      const inA = edge(a, side, 0.02), inB = edge(b, side, 0.02);
      const inTopA = edge(a, side, h), inTopB = edge(b, side, h);
      const outTopA = edgeOut(a, side, h, 0.35), outTopB = edgeOut(b, side, h, 0.35);
      const nin: Vec3 = [a.tz * side, 0, -a.tx * side];
      solid.quad(inA, inB, inTopB, inTopA, nin, 0, 0, len, h, CONCRETE);
      solid.quad(inTopA, inTopB, outTopB, outTopA, [0, 1, 0], 0, 0, len, 0.35, CONCRETE);
      solid.quad(topB, topA, outTopA, outTopB, nrm, 0, 0, len, h, CONCRETE);
      const stripColor: Vec3 = toGround ? [0.15, 0.6, 1.0] : [1.0, 0.5, 0.12];
      const y0 = toGround ? h - 0.35 : 0.5;
      glow.quad([inA[0], inA[1] + y0, inA[2]], [inB[0], inB[1] + y0, inB[2]], [inB[0], inB[1] + y0 + 0.12, inB[2]], [inA[0], inA[1] + y0 + 0.12, inA[2]], nin, 0, 0, len, 0.12, stripColor, [1, 3, 1, 0.9]);
    }
    if (a.y >= 4 || b.y >= 4) {
      const lowA = a.y - thick, lowB = b.y - thick;
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

/** Bretelle au sol : ruban posé juste au-dessus de la chaussée qu'elle rejoint. */
function addConnector(gb: GeomBuilder, c: Connector): void {
  const half = c.width / 2;
  const count = c.pts.length / 2;
  const data = [ROAD_KIND.connector, 1e6, half, 0] as const;
  let pl: Vec3 = [0, 0, 0], pr: Vec3 = [0, 0, 0], v = 0;
  for (let k = 0; k < count; k++) {
    const x = c.pts[k * 2] as number, z = c.pts[k * 2 + 1] as number;
    const a = Math.max(0, k - 1), b = Math.min(count - 1, k + 1);
    let tx = (c.pts[b * 2] as number) - (c.pts[a * 2] as number), tz = (c.pts[b * 2 + 1] as number) - (c.pts[a * 2 + 1] as number);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const y = 0.035;
    const lp: Vec3 = [x + tz * half, y, z - tx * half];
    const rp: Vec3 = [x - tz * half, y, z + tx * half];
    if (k > 0) {
      const pv = v;
      v += Math.hypot(x - (c.pts[k * 2 - 2] as number), z - (c.pts[k * 2 - 1] as number));
      gb.quadUv(pr, rp, lp, pl, [0, 1, 0], [-half, pv, -half, v, half, v, half, pv], [1, 1, 1], data);
    }
    pl = lp;
    pr = rp;
  }
}

export interface CityMeshes {
  group: THREE.Group;
  triangles: number;
  /** Quartiers extérieurs : leurs maillages sont masqués quand la caméra est loin (ils sont dans le brouillard). */
  zones: { cx: number; cz: number; radius: number; group: THREE.Group }[];
}

/** Masque les quartiers trop lointains pour être vus : à appeler de temps en temps. */
export function updateCityZones(meshes: CityMeshes, x: number, z: number): void {
  for (const zn of meshes.zones) zn.group.visible = Math.hypot(x - zn.cx, z - zn.cz) < zn.radius + 430;
}

export function buildCityMeshes(city: CityData, mats: CityMaterials): CityMeshes {
  const root = new THREE.Group();
  root.name = 'ville';
  const zones: CityMeshes['zones'] = [];
  let total = 0;
  // La ville principale d'un bloc, puis les quartiers extérieurs par morceaux : ce qui est hors
  // champ ou trop loin (dans le brouillard) n'est pas dessiné.
  const main = buildZone(city, mats, -1, null);
  total += main.triangles;
  root.add(main.group);
  // Chaque quartier est découpé en carrés de CHUNK mètres de côté.
  for (const d of city.graph.districts) {
    const n = Math.ceil((d.radius + 130) / CHUNK);
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
      const part = buildZone(city, mats, d.id, { x0: d.cx + i * CHUNK, z0: d.cz + j * CHUNK });
      if (part.triangles === 0) continue;
      total += part.triangles;
      root.add(part.group);
      zones.push({ cx: d.cx + (i + 0.5) * CHUNK, cz: d.cz + (j + 0.5) * CHUNK, radius: CHUNK * 0.75, group: part.group });
    }
  }
  return { group: root, triangles: total, zones };
}

/**
 * À quelle zone appartient un point : −1 = ville principale (tout ce qui est à l'intérieur de
 * l'autoroute de ceinture ou collé derrière elle), sinon le numéro du quartier extérieur.
 * Les réponses sont gardées en mémoire : la question est posée des dizaines de fois par objet.
 */
const zoneCache = new Map<string, number>();
let zoneCity: CityData | null = null;
let mainPoly: number[] = [];
function zoneAt(city: CityData, x: number, z: number): number {
  if (zoneCity !== city) {
    zoneCity = city;
    zoneCache.clear();
    // Contour de la ville principale : l'autoroute de ceinture, élargie de 50 m vers l'extérieur.
    mainPoly = [];
    const rw = city.ringway;
    for (let i = 0; i < rw.samples.length; i += 4) {
      const p = rw.samples[i];
      if (!p) continue;
      const off = (rw.halfWidth + 50) * rw.outerSide;
      mainPoly.push(p.x - p.tz * off, p.z + p.tx * off);
    }
  }
  const key = `${x},${z}`;
  let zone = zoneCache.get(key);
  if (zone === undefined) {
    zone = -1;
    if (!pointInPolygon(mainPoly, x, z)) {
      for (const d of city.graph.districts) if (Math.hypot(x - d.cx, z - d.cz) < d.radius + 130) zone = d.id;
    }
    zoneCache.set(key, zone);
  }
  return zone;
}

/** Côté d'un morceau de quartier (m). */
const CHUNK = 300;

function buildZone(city: CityData, mats: CityMaterials, zone: number, cell: { x0: number; z0: number } | null): { group: THREE.Group; triangles: number } {
  const group = new THREE.Group();
  group.name = zone < 0 ? 'ville principale' : `quartier ${zone}`;
  const main = zone < 0;
  /** Vrai si ce point appartient à la zone (et au morceau) en cours. */
  const here = (x: number, z: number): boolean => {
    if (zoneAt(city, x, z) !== zone) return false;
    return !cell || (x >= cell.x0 && x < cell.x0 + CHUNK && z >= cell.z0 && z < cell.z0 + CHUNK);
  };
  const mid = (e: GraphEdge): boolean => {
    const k = Math.floor(e.pts.length / 4) * 2;
    return here(e.pts[k] as number, e.pts[k + 1] as number);
  };
  const sh = 0; // les trottoirs sont au niveau du sol (seule la bordure est en relief)

  // ——— Immeubles ———
  const bld = new GeomBuilder();
  const glow = new GeomBuilder();
  for (const b of city.buildings) if (here(b.footprint.cx, b.footprint.cz)) addBuilding(bld, glow, b);

  // ——— Sol (dallage de trottoir partout), routes par-dessus, bordures ———
  const solid = new GeomBuilder();
  const groundGeo = new GeomBuilder();
  // Le sol est découpé en dalles de 60 m : un seul triangle géant perd en précision de profondeur
  // et passerait par endroits devant la chaussée posée 5 cm plus haut.
  if (main) {
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
  // Pas de bordure de trottoir en travers d'une bretelle.
  const nearConnector = (x: number, z: number): boolean => {
    for (const c of city.connectors) {
      for (let k = 0; k < c.pts.length; k += 2) {
        if (Math.hypot((c.pts[k] as number) - x, (c.pts[k + 1] as number) - z) < c.width / 2 + 1.2) return true;
      }
    }
    return false;
  };
  for (const e of city.graph.edges) if (e.district === zone && mid(e)) addRoadEdge(roads, solid, e, nearConnector);
  for (const n of city.graph.nodes) if (n.district === zone && n.edges.length > 0 && here(n.x, n.z)) addJunction(roads, n);

  // ——— Parcs, arbres, mobilier ———
  for (const r of city.parks) {
    if (!here(r.cx, r.cz)) continue;
    solid.box(r.cx, 0.0, r.cz, r.w, 0.06, r.d, r.yaw, [0.02, 0.05, 0.03]);
  }
  for (const t of city.trees) {
    if (!here(t.x, t.z)) continue;
    if (t.palm) {
      // Palmier : tronc fin, palmes retombantes en étoile.
      solid.cylinder(t.x, sh, t.z, 0.2, 0.13, t.height, 6, [0.07, 0.05, 0.035], [0, 0, 0, 0], false);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + t.x;
        const dx = Math.sin(a), dz = Math.cos(a);
        solid.box(t.x + dx * t.radius * 0.5, t.height - 0.15, t.z + dz * t.radius * 0.5, 0.55, 0.1, t.radius, a, [0.03, 0.11, 0.05], [0, 0, 0, 0], true, true);
        solid.box(t.x + dx * t.radius * 1.1, t.height - 0.75, t.z + dz * t.radius * 1.1, 0.4, 0.1, t.radius * 0.5, a, [0.025, 0.09, 0.045], [0, 0, 0, 0], true, true);
      }
      continue;
    }
    solid.cylinder(t.x, sh, t.z, 0.22, 0.14, t.height * 0.5, 6, [0.05, 0.035, 0.025], [0, 0, 0, 0], false);
    solid.cylinder(t.x, sh + t.height * 0.35, t.z, t.radius, t.radius * 0.55, t.height * 0.35, 7, [0.02, 0.07, 0.04], [0, 0, 0, 0], false);
    solid.cylinder(t.x, sh + t.height * 0.7, t.z, t.radius * 0.55, 0.05, t.height * 0.3, 7, [0.025, 0.08, 0.045], [0, 0, 0, 0], false);
  }
  for (const l of city.lamps) {
    if (!here(l.x, l.z)) continue;
    solid.cylinder(l.x, sh, l.z, 0.1, 0.07, l.height, 6, DARK_METAL, [0, 0, 0, 0], false);
    const ax = l.x + l.dx * l.arm * 0.5;
    const az = l.z + l.dz * l.arm * 0.5;
    const yaw = Math.atan2(l.dx, l.dz);
    solid.box(ax, sh + l.height, az, 0.09, 0.09, l.arm, yaw, DARK_METAL, [0, 0, 0, 0], true, true);
    // Tête lumineuse (aData : graine, type 3 = uni, -, intensité)
    glow.box(l.x + l.dx * l.arm, sh + l.height - 0.08, l.z + l.dz * l.arm, 0.32, 0.12, 0.8, yaw, l.color, [1, 3, 1, 2.6], true, true);
  }
  for (const p of city.props) if (here(p.x, p.z)) solid.box(p.x, p.y, p.z, p.sx, p.sy, p.sz, p.yaw, p.color);
  for (const g of city.glowBoxes) if (here(g.x, g.z)) glow.box(g.x, g.y, g.z, g.sx, g.sy, g.sz, g.yaw, g.color, [1, 4, 1, 1.5], true, false);

  // ——— Enseignes ———
  for (const sg of city.signs) {
    if (!here(sg.x, sg.z)) continue;
    const yaw = Math.atan2(sg.nx, sg.nz);
    // aData : graine, type, largeur de la grande face, hauteur
    const faceW = Math.max(sg.along, sg.out);
    glow.box(sg.x, sg.y, sg.z, sg.along, sg.up, sg.out, yaw, sg.color, [Math.floor(sg.seed * 4000), sg.type, faceW, sg.up], true, true);
  }

  // ——— Autoroute surélevée ———
  const hwRoad = new GeomBuilder();
  if (main) addHighway(city.highway, hwRoad, solid, glow, ROAD_KIND.highway);
  if (main) addHighway(city.ringway, hwRoad, solid, glow, ROAD_KIND.ringway);
  const connectorGeo = new GeomBuilder();
  for (const c of main ? city.connectors : []) {
    addConnector(connectorGeo, c);
    // Portique vert « autoroute » à l'entrée de la bretelle, visible depuis le périphérique.
    const k = 5;
    const x = c.pts[k * 2] as number, z = c.pts[k * 2 + 1] as number;
    let tx = (c.pts[k * 2 + 4] as number) - x, tz = (c.pts[k * 2 + 5] as number) - z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const yaw = Math.atan2(tx, tz);
    const half = c.width / 2 + 0.9;
    for (const side of [1, -1]) solid.box(x + tz * side * half, 3.4, z - tx * side * half, 0.3, 6.8, 0.3, yaw, DARK_METAL);
    solid.box(x, 6.9, z, half * 2 + 0.3, 0.3, 0.3, yaw, DARK_METAL, [0, 0, 0, 0], true, true);
    // Panneau vert (comme sur les voies rapides japonaises) avec trois chevrons blancs « tout droit ».
    glow.box(x, 5.6, z, half * 2 - 1.4, 1.9, 0.14, yaw, [0.03, 0.55, 0.2], [1, 3, 1, 0.9], true, true);
    const P = (u: number, v: number, f: number): Vec3 => [x + tz * u - tx * f, 5.6 + v, z - tx * u - tz * f];
    for (const f of [0.09, -0.09]) {
      for (let cIdx = -1; cIdx <= 1; cIdx++) {
        const u0 = cIdx * 1.5;
        for (const sgn of [1, -1]) {
          glow.quad(P(u0 + sgn * 0.6, -0.45, f), P(u0 + sgn * 0.6, -0.1, f), P(u0, 0.6, f), P(u0, 0.25, f), [-tx * Math.sign(f), 0, -tz * Math.sign(f)], 0, 0, 1, 1, [1, 1, 1], [1, 3, 1, 1.3]);
        }
      }
    }
  }

  // ——— Flaques de lumière au sol (plans additifs, pas de vraies lumières) ———
  const pools = new GeomBuilder();
  for (const p of city.pools) {
    if (!here(p.x, p.z)) continue;
    const r = p.radius;
    const c: Vec3 = [p.color[0] * p.intensity, p.color[1] * p.intensity, p.color[2] * p.intensity];
    pools.quad([p.x - r, 0.04, p.z + r], [p.x + r, 0.04, p.z + r], [p.x + r, 0.04, p.z - r], [p.x - r, 0.04, p.z - r], [0, 1, 0], 0, 0, 1, 1, c);
  }

  const roadGeo = roads.build();

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, order = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.matrixAutoUpdate = false;
    // Ville principale : un seul gros maillage, toujours visible. Quartiers : dessinés seulement s'ils sont dans le champ.
    m.frustumCulled = !main;
    if (!main) geo.computeBoundingSphere();
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
    [connectorGeo, mats.connectorRoad, 'bretelles'],
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
