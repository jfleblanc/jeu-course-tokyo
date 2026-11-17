import { Rng } from '../core/rng';
import { NEON_PALETTE, WORLD, type RoadKind } from '../config/world';
import { generateStreetGraph, pointAt, pointInPolygon, type GraphEdge, type GraphNode, type PathPoint, type StreetGraph } from './streetGraph';

/**
 * Génération du quartier : uniquement des données (aucun rendu, aucune physique).
 * cityMesh.ts en fait des maillages, cityColliders.ts des collisions.
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Rectangle orienté au sol. L'axe local Z (profondeur) pointe vers la rue. */
export interface Obb {
  cx: number;
  cz: number;
  /** Largeur le long de la rue. */
  w: number;
  /** Profondeur. */
  d: number;
  yaw: number;
}

/** Un volume (retrait) d'immeuble, centré sur l'emprise. */
export interface Tier {
  w: number;
  d: number;
  y0: number;
  y1: number;
}

export interface Facade {
  /** Centre de la façade au sol. */
  cx: number;
  cz: number;
  /** Normale sortante (vers la rue). */
  nx: number;
  nz: number;
  length: number;
  kind: RoadKind;
}

export interface Building {
  footprint: Obb;
  tiers: Tier[];
  height: number;
  /** Graine propre à l'immeuble (0..1) : allumage des fenêtres, etc. */
  seed: number;
  /** 0 = bureaux, 1 = résidentiel, 2 = tour vitrée. */
  style: number;
  wall: [number, number, number];
  /** Largeur d'une cellule de fenêtre (m). */
  cellW: number;
  /** Part des fenêtres allumées. */
  lit: number;
  facades: Facade[];
  /** Vrai pour le décor lointain (pas de collision). */
  backdrop: boolean;
}

export interface Sign {
  x: number;
  y: number;
  z: number;
  /** Dimensions : le long de la façade, en hauteur, en épaisseur (vers la rue). */
  along: number;
  up: number;
  out: number;
  nx: number;
  nz: number;
  color: readonly [number, number, number];
  seed: number;
  /** 0 = enseigne à glyphes, 1 = panneau/écran, 2 = tube néon uni. */
  type: number;
}

export interface Lamp {
  x: number;
  z: number;
  /** Direction du bras, vers la chaussée. */
  dx: number;
  dz: number;
  height: number;
  arm: number;
  color: readonly [number, number, number];
}

export interface LightPool {
  x: number;
  z: number;
  radius: number;
  color: readonly [number, number, number];
  intensity: number;
}

export interface Box {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  color: readonly [number, number, number];
}

export interface Tree {
  x: number;
  z: number;
  height: number;
  radius: number;
}

/** Mur invisible (bord de la ville). */
export interface Wall {
  x: number;
  z: number;
  yaw: number;
  halfLength: number;
}

export interface HighwaySample {
  x: number;
  y: number;
  z: number;
  /** Tangente horizontale normalisée. */
  tx: number;
  tz: number;
  /** Distance parcourue depuis le début (m). */
  s: number;
}

export interface Highway {
  samples: HighwaySample[];
  halfWidth: number;
  barrierHeight: number;
  pillars: { x: number; z: number; top: number; yaw: number }[];
}

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

export interface CityData {
  seed: number;
  graph: StreetGraph;
  /** Boîte englobante de la zone jouable. */
  bounds: Rect;
  buildings: Building[];
  signs: Sign[];
  lamps: Lamp[];
  pools: LightPool[];
  /** Petits objets sombres (poteaux, boîtiers). */
  props: Box[];
  /** Petits objets lumineux (distributeurs, feux). */
  glowBoxes: Box[];
  trees: Tree[];
  parks: Obb[];
  /** Murs invisibles derrière le périphérique. */
  walls: Wall[];
  highway: Highway;
  spawn: SpawnPoint;
  /** Points de réapparition sur la chaussée (milieu de chaque rue). */
  respawns: SpawnPoint[];
}

const KIND_RANK: Record<RoadKind, number> = { alley: 0, street: 1, avenue: 2, boulevard: 3 };

const WALLS: ReadonlyArray<readonly [number, number, number]> = [
  [0.085, 0.09, 0.11],
  [0.07, 0.075, 0.1],
  [0.11, 0.1, 0.105],
  [0.06, 0.07, 0.085],
  [0.1, 0.085, 0.08],
  [0.075, 0.085, 0.095],
];

const LAMP_COOL: readonly [number, number, number] = [0.75, 0.85, 1.0];
const LAMP_WARM: readonly [number, number, number] = [1.0, 0.72, 0.4];

function neon(rng: Rng): readonly [number, number, number] {
  return rng.pick(NEON_PALETTE);
}

/** Grille de recherche spatiale : évite de comparer chaque immeuble à tous les autres. */
class SpatialHash<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly size: number) {}
  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  insert(x0: number, z0: number, x1: number, z1: number, item: T): void {
    const s = this.size;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++) {
      for (let iz = Math.floor(z0 / s); iz <= Math.floor(z1 / s); iz++) {
        const k = this.key(ix, iz);
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }
  /** Appelle `fn` pour chaque élément proche ; s'arrête si `fn` renvoie vrai. */
  some(x0: number, z0: number, x1: number, z1: number, fn: (item: T) => boolean): boolean {
    const s = this.size;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++) {
      for (let iz = Math.floor(z0 / s); iz <= Math.floor(z1 / s); iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const item of list) if (fn(item)) return true;
      }
    }
    return false;
  }
}

interface RoadSample {
  x: number;
  z: number;
  /** Rayon à garder libre (demi-chaussée + trottoir). */
  r: number;
  /** Tolérance : dans une courbe, un immeuble droit mord un peu sur le trottoir. */
  slack: number;
  kind: RoadKind;
}

/** Deux rectangles orientés se chevauchent-ils ? (théorème des axes séparateurs) */
function obbOverlap(a: Obb, b: Obb, margin: number): boolean {
  const ca = Math.cos(a.yaw), sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
  // Axes locaux : X = (c, −s), Z = (s, c)
  const axes: [number, number][] = [[ca, -sa], [sa, ca], [cb, -sb], [sb, cb]];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  const ahw = a.w / 2 - margin, ahd = a.d / 2 - margin, bhw = b.w / 2 - margin, bhd = b.d / 2 - margin;
  for (const [ax, az] of axes) {
    const dist = Math.abs(dx * ax + dz * az);
    const ra = ahw * Math.abs(ca * ax - sa * az) + ahd * Math.abs(sa * ax + ca * az);
    const rb = bhw * Math.abs(cb * ax - sb * az) + bhd * Math.abs(sb * ax + cb * az);
    if (dist > ra + rb) return false;
  }
  return true;
}

function makeBuilding(rng: Rng, fp: Obb, facades: Facade[], centerDist: number, boost: number): Building {
  let rank = -1;
  for (const f of facades) rank = Math.max(rank, KIND_RANK[f.kind]);
  let height: number;
  if (rank < 0) height = rng.range(16, 48);
  else if (rank === 0) height = rng.range(9, 24);
  else if (rank === 1) height = rng.range(14, 36);
  else if (rank === 2) height = rng.range(24, 58);
  else height = rng.range(32, 76);
  // Plus haut vers le centre, quelques tours.
  height *= 1.2 - 0.5 * Math.min(1, centerDist);
  if (rank !== 0 && rng.chance(0.07)) height *= 1.7;
  height *= boost;
  height = Math.round(height / 3.4) * 3.4 + 1.2;

  const style = height > 60 ? 2 : rank <= 1 && rng.chance(0.55) ? 1 : rng.chance(0.25) ? 2 : 0;
  const tiers: Tier[] = [];
  const tierCount = height > 22 && Math.min(fp.w, fp.d) > 13 ? (rng.chance(0.65) ? (rng.chance(0.4) ? 3 : 2) : 1) : 1;
  let w = fp.w, d = fp.d, y = 0;
  for (let k = 0; k < tierCount; k++) {
    const last = k === tierCount - 1;
    const top = last ? height : y + (height - y) * rng.range(0.45, 0.75);
    tiers.push({ w, d, y0: y, y1: top });
    y = top;
    // Retrait du volume suivant (jamais sous 7 m de large).
    w = Math.max(7, w - rng.range(2, 7));
    d = Math.max(7, d - rng.range(2, 7));
  }
  return {
    footprint: fp,
    tiers,
    height,
    seed: rng.next(),
    style,
    wall: [...rng.pick(WALLS)] as [number, number, number],
    cellW: style === 2 ? rng.range(1.5, 2.2) : style === 1 ? rng.range(2.6, 3.6) : rng.range(1.8, 2.8),
    lit: style === 1 ? rng.range(0.12, 0.34) : style === 2 ? rng.range(0.15, 0.42) : rng.range(0.1, 0.4),
    facades,
    backdrop: false,
  };
}

function addSigns(rng: Rng, b: Building, signs: Sign[]): void {
  const baseTop = (b.tiers[0] as Tier).y1;
  for (const f of b.facades) {
    const density = f.kind === 'alley' ? 4.6 : f.kind === 'street' ? 5.5 : f.kind === 'avenue' ? 7.5 : 8.5;
    const count = Math.floor((f.length / density) * rng.range(0.6, 1.3));
    // Le long de la façade : tangente = (−nz, nx)
    const tx = -f.nz;
    const tz = f.nx;
    for (let k = 0; k < count; k++) {
      const t = (k + rng.range(0.2, 0.8)) / Math.max(1, count) - 0.5;
      const px = f.cx + tx * t * (f.length - 2);
      const pz = f.cz + tz * t * (f.length - 2);
      const color = neon(rng);
      if (rng.chance(0.62)) {
        // Enseigne verticale en drapeau, perpendiculaire à la façade (typique de Tokyo)
        const up = Math.min(rng.range(2.6, 7.5), Math.max(2, baseTop - 5));
        const yMax = Math.min(baseTop - up / 2 - 0.5, f.kind === 'alley' ? 11 : 17);
        const yMin = 3.8 + up / 2;
        if (yMax < yMin) continue;
        const out = rng.range(0.8, 1.35);
        const maxOut = f.kind === 'alley' ? 0.15 : 0.35;
        const off = rng.range(0.1, maxOut) + out / 2;
        signs.push({ x: px + f.nx * off, y: rng.range(yMin, yMax), z: pz + f.nz * off, along: 0.22, up, out, nx: f.nx, nz: f.nz, color, seed: rng.next(), type: rng.chance(0.75) ? 0 : 2 });
      } else {
        // Panneau à plat sur la façade
        const along = Math.min(rng.range(1.8, 5), f.length * 0.5);
        const up = rng.range(0.9, 2.4);
        const yMax = Math.min(baseTop - up / 2 - 0.4, 13);
        const yMin = 3.9 + up / 2;
        if (yMax < yMin) continue;
        signs.push({ x: px + f.nx * 0.12, y: rng.range(yMin, yMax), z: pz + f.nz * 0.12, along, up, out: 0.16, nx: f.nx, nz: f.nz, color, seed: rng.next(), type: rng.chance(0.6) ? 0 : 1 });
      }
    }
    // Grand écran publicitaire en hauteur sur les grands axes
    if (KIND_RANK[f.kind] >= 2 && baseTop > 24 && f.length > 14 && rng.chance(0.4)) {
      const along = Math.min(f.length * 0.7, rng.range(8, 15));
      const up = rng.range(4, 7);
      signs.push({ x: f.cx + f.nx * 0.2, y: rng.range(14, Math.min(baseTop - up / 2 - 1, 30)), z: f.cz + f.nz * 0.2, along, up, out: 0.3, nx: f.nx, nz: f.nz, color: neon(rng), seed: rng.next(), type: 1 });
    }
  }
}

/** Autoroute surélevée : elle suit la courbe du boulevard central, avec une rampe à chaque bout. */
function buildHighway(graph: StreetGraph): Highway {
  const H = WORLD.highway;
  // Courbe du boulevard, rééchantillonnée tous les 3 m.
  const edges = graph.boulevard.map((id) => graph.edges[id] as GraphEdge);
  let total = 0;
  for (const e of edges) total += e.length;
  const first = edges[0] as GraphEdge;
  const last = edges[edges.length - 1] as GraphEdge;
  const startS = first.trimA + 8;
  const endS = total - last.trimB - 8;
  const samples: HighwaySample[] = [];
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  const sampleAt = (s: number): void => {
    let rem = s;
    let e = first;
    for (const cand of edges) {
      e = cand;
      if (rem <= cand.length) break;
      rem -= cand.length;
    }
    pointAt(e, rem, p);
  };
  for (let s = startS; s <= endS; s += 3) {
    sampleAt(s);
    samples.push({ x: p.x, y: 0, z: p.z, tx: p.tx, tz: p.tz, s: s - startS });
  }
  const length = (samples[samples.length - 1] as HighwaySample).s;

  // Les rampes doivent laisser passer les rues transversales : au premier carrefour rencontré,
  // le tablier doit déjà être assez haut. On raccourcit la rampe si nécessaire.
  const rampFor = (edge: GraphEdge, fromStart: boolean): number => {
    const node = graph.nodes[fromStart ? edge.b : edge.a] as GraphNode;
    const dist = edge.length - (fromStart ? edge.trimA : edge.trimB) - 8 - node.radius;
    return Math.max(36, Math.min(H.rampLength, dist / 0.56));
  };
  const rampA = rampFor(first, true);
  const rampB = rampFor(last, false);
  for (const sp of samples) {
    const r = Math.min(1, sp.s / rampA, (length - sp.s) / rampB);
    sp.y = H.height * r * r * (3 - 2 * r);
  }

  const pillars: Highway['pillars'] = [];
  let next = rampA * 0.55;
  for (const sp of samples) {
    if (sp.s < next) continue;
    if (length - sp.s < rampB * 0.5) break;
    // Pas de pilier au milieu d'un carrefour.
    let blocked = false;
    for (const node of graph.nodes) {
      if (node.edges.length > 2 && Math.hypot(sp.x - node.x, sp.z - node.z) < node.radius + 3) blocked = true;
    }
    if (blocked) {
      next = sp.s + 3;
      continue;
    }
    next = sp.s + H.pillarSpacing;
    if (sp.y > 3) pillars.push({ x: sp.x, z: sp.z, top: sp.y, yaw: Math.atan2(sp.tx, sp.tz) });
  }
  return { samples, halfWidth: H.deckHalfWidth, barrierHeight: H.barrierHeight, pillars };
}

export function generateCity(seed: number = WORLD.seed): CityData {
  const graph = generateStreetGraph(seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const R = graph.radius;

  const buildings: Building[] = [];
  const signs: Sign[] = [];
  const lamps: Lamp[] = [];
  const pools: LightPool[] = [];
  const props: Box[] = [];
  const glowBoxes: Box[] = [];
  const trees: Tree[] = [];
  const parks: Obb[] = [];
  const walls: Wall[] = [];
  const respawns: SpawnPoint[] = [];
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };

  // ——— Zones à garder libres : chaussées + trottoirs + carrefours ———
  const roadHash = new SpatialHash<RoadSample>(40);
  for (const e of graph.edges) {
    const r = e.width / 2 + WORLD.sidewalk[e.kind];
    for (let s = 0; s <= e.length; s += 4) {
      pointAt(e, s, p);
      roadHash.insert(p.x - r, p.z - r, p.x + r, p.z + r, { x: p.x, z: p.z, r, slack: Math.min(1.7, WORLD.sidewalk[e.kind] * 0.55), kind: e.kind });
    }
  }
  for (const n of graph.nodes) {
    if (n.edges.length === 0) continue;
    const r = n.radius + 1.5;
    roadHash.insert(n.x - r, n.z - r, n.x + r, n.z + r, { x: n.x, z: n.z, r, slack: 0.4, kind: 'street' });
  }
  const occupied = new SpatialHash<Obb>(40);

  const hitsRoad = (o: Obb): boolean => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    const reach = Math.hypot(o.w, o.d) / 2 + 22;
    return roadHash.some(o.cx - reach, o.cz - reach, o.cx + reach, o.cz + reach, (q) => {
      const dx = q.x - o.cx, dz = q.z - o.cz;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      return Math.abs(lx) < o.w / 2 + q.r - q.slack && Math.abs(lz) < o.d / 2 + q.r - q.slack;
    });
  };
  const hitsBuilding = (o: Obb): boolean => {
    const reach = Math.hypot(o.w, o.d) / 2;
    return occupied.some(o.cx - reach, o.cz - reach, o.cx + reach, o.cz + reach, (q) => obbOverlap(o, q, 0.15));
  };
  const occupy = (o: Obb): void => {
    const reach = Math.hypot(o.w, o.d) / 2;
    occupied.insert(o.cx - reach, o.cz - reach, o.cx + reach, o.cz + reach, o);
  };
  /** Type de rue qui longe ce point, s'il y en a une tout près. */
  const roadNear = (x: number, z: number, extra: number): RoadKind | null => {
    let found: RoadKind | null = null;
    roadHash.some(x - 30, z - 30, x + 30, z + 30, (q) => {
      if (Math.hypot(q.x - x, q.z - z) < q.r + extra) {
        if (!found || KIND_RANK[q.kind] > KIND_RANK[found]) found = q.kind;
      }
      return false;
    });
    return found;
  };

  const finishBuilding = (fp: Obb, front: Facade | null, boost: number): void => {
    const c = Math.cos(fp.yaw), s = Math.sin(fp.yaw);
    const facades: Facade[] = [];
    if (front) facades.push(front);
    // Les autres côtés donnent-ils aussi sur une rue (immeuble d'angle) ?
    // [normale x, normale z, distance au centre, longueur de la façade]
    const sides: [number, number, number, number][] = [
      [c, -s, fp.w / 2, fp.d], // +X local
      [-c, s, fp.w / 2, fp.d], // −X local
      [-s, -c, fp.d / 2, fp.w], // −Z local (arrière)
    ];
    if (!front) sides.push([s, c, fp.d / 2, fp.w]);
    for (const [nx, nz, dist, length] of sides) {
      const fx = fp.cx + nx * dist, fz = fp.cz + nz * dist;
      const kind = roadNear(fx + nx * 1.5, fz + nz * 1.5, 1.2);
      if (kind) facades.push({ cx: fx, cz: fz, nx, nz, length, kind });
    }
    const b = makeBuilding(rng, fp, facades, Math.hypot(fp.cx, fp.cz) / R, boost);
    buildings.push(b);
    occupy(fp);
    addSigns(rng, b, signs);
    // Distributeurs automatiques au pied des immeubles, côté petites rues
    for (const f of b.facades) {
      if (KIND_RANK[f.kind] <= 1 && rng.chance(0.3)) {
        const t = rng.range(-0.35, 0.35) * f.length;
        glowBoxes.push({
          x: f.cx - f.nz * t + f.nx * 0.38,
          y: 0.9,
          z: f.cz + f.nx * t + f.nz * 0.38,
          sx: 1.0,
          sy: 1.8,
          sz: 0.6,
          yaw: Math.atan2(f.nx, f.nz),
          color: rng.pick([[0.8, 0.9, 1.0], [1.0, 0.25, 0.2], [0.3, 0.6, 1.0], [0.9, 1.0, 0.9]] as const),
        });
      }
    }
  };

  // ——— Immeubles le long des rues, des plus grands axes aux plus petits ———
  const ordered = [...graph.edges].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]);
  // Deux passes : d'abord de grands immeubles, puis de plus petits pour boucher les trous.
  for (const pass of [0, 1])
  for (const e of ordered) {
    const half = e.width / 2;
    const sw = WORLD.sidewalk[e.kind];
    for (const side of [1, -1]) {
      // Côté extérieur du périphérique : immeubles plus profonds et plus hauts (ils ferment la ville).
      pointAt(e, e.length / 2, p);
      const outer = e.onRing && (p.x + p.tz * side) ** 2 + (p.z - p.tx * side) ** 2 > p.x ** 2 + p.z ** 2;
      let s = e.trimA + 1;
      const end = e.length - e.trimB - 1;
      while (s < end - 8) {
        let w = Math.min(end - s, pass === 1 ? rng.range(8, 13) : e.kind === 'alley' ? rng.range(9, 17) : rng.range(13, 30));
        let d = outer ? rng.range(24, 34) : pass === 1 ? rng.range(8, 14) : e.kind === 'alley' ? rng.range(9, 16) : rng.range(13, 26);
        let placed = false;
        for (let attempt = 0; attempt < 4 && !placed; attempt++) {
          pointAt(e, s + w / 2, p);
          // côté : +1 = gauche du sens a→b, gauche = (tz, −tx)
          const nx = p.tz * side, nz = -p.tx * side;
          const off = half + sw + d / 2;
          const fp: Obb = { cx: p.x + nx * off, cz: p.z + nz * off, w, d, yaw: Math.atan2(-nx, -nz) };
          if (!hitsRoad(fp) && !hitsBuilding(fp)) {
            const fx = p.x + nx * (half + sw), fz = p.z + nz * (half + sw);
            if (!outer && pass === 0 && rng.chance(0.04) && w > 12) {
              // Petit parc / sanctuaire arboré
              parks.push(fp);
              occupy(fp);
              const count = rng.int(3, 7);
              const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
              for (let k = 0; k < count; k++) {
                const lx = rng.range(-w / 2 + 2, w / 2 - 2), lz = rng.range(-d / 2 + 2, d / 2 - 2);
                trees.push({ x: fp.cx + lx * c + lz * sn, z: fp.cz - lx * sn + lz * c, height: rng.range(5, 9), radius: rng.range(1.6, 2.8) });
              }
            } else {
              finishBuilding(fp, { cx: fx, cz: fz, nx: -nx, nz: -nz, length: w, kind: e.kind }, outer ? 1.5 : 1);
            }
            placed = true;
          } else if (attempt % 2 === 0) {
            d *= 0.62;
            if (d < 7) d = 7;
          } else {
            w *= 0.62;
          }
          if (w < 7) break;
        }
        s += placed ? w + rng.range(0, 0.6) : pass === 1 ? 3 : 5;
      }
    }
  }

  // ——— Cœurs d'îlots : on remplit les vides derrière les façades ———
  const B: Rect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (let k = 0; k < graph.ringPolygon.length; k += 2) {
    const x = graph.ringPolygon[k] as number, z = graph.ringPolygon[k + 1] as number;
    B.x0 = Math.min(B.x0, x);
    B.x1 = Math.max(B.x1, x);
    B.z0 = Math.min(B.z0, z);
    B.z1 = Math.max(B.z1, z);
  }
  const area = (B.x1 - B.x0) * (B.z1 - B.z0);
  const fillTries = Math.floor(area / 260);
  for (let k = 0; k < fillTries; k++) {
    const x = rng.range(B.x0, B.x1), z = rng.range(B.z0, B.z1);
    if (!pointInPolygon(graph.ringPolygon, x, z)) continue;
    const fp: Obb = { cx: x, cz: z, w: rng.range(11, 24), d: rng.range(11, 24), yaw: rng.range(0, Math.PI) };
    // S'aligne sur l'immeuble voisin s'il y en a un (plus naturel qu'un angle au hasard).
    occupied.some(x - 20, z - 20, x + 20, z + 20, (q) => {
      fp.yaw = q.yaw;
      return true;
    });
    if (hitsRoad(fp) || hitsBuilding(fp)) continue;
    finishBuilding(fp, null, 1.15);
  }

  // ——— Silhouettes lointaines dans le brouillard (pas de collision) ———
  for (let k = 0; k < 110; k++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = R * 1.25 + rng.range(60, 560);
    const fp: Obb = { cx: Math.cos(ang) * dist * 1.1, cz: Math.sin(ang) * dist, w: rng.range(22, 50), d: rng.range(22, 50), yaw: rng.range(0, Math.PI) };
    const b = makeBuilding(rng, fp, [], 1, 1);
    b.height = rng.range(50, 190);
    b.tiers = [{ w: fp.w, d: fp.d, y0: 0, y1: b.height }];
    b.style = 2;
    b.backdrop = true;
    buildings.push(b);
  }

  // ——— Murs invisibles derrière le trottoir extérieur du périphérique ———
  for (const eid of graph.ring) {
    const e = graph.edges[eid] as GraphEdge;
    pointAt(e, e.length / 2, p);
    const side = (p.x + p.tz) ** 2 + (p.z - p.tx) ** 2 > p.x ** 2 + p.z ** 2 ? 1 : -1;
    const off = e.width / 2 + WORLD.sidewalk[e.kind] + 1.2;
    const count = Math.max(1, Math.ceil(e.length / 9));
    let px = 0, pz = 0;
    for (let k = 0; k <= count; k++) {
      pointAt(e, (e.length * k) / count, p);
      const x = p.x + p.tz * side * off, z = p.z - p.tx * side * off;
      if (k > 0) {
        const len = Math.hypot(x - px, z - pz);
        walls.push({ x: (x + px) / 2, z: (z + pz) / 2, yaw: Math.atan2(x - px, z - pz), halfLength: len / 2 + 0.6 });
      }
      px = x;
      pz = z;
    }
  }

  // ——— Lampadaires, flaques de lumière, points de réapparition ———
  for (const e of graph.edges) {
    const s0 = e.trimA, s1 = e.length - e.trimB;
    const usable = s1 - s0;
    pointAt(e, (s0 + s1) / 2, p);
    const lane = e.kind === 'alley' ? 0 : e.kind === 'boulevard' ? 10 : e.width / 4;
    // Conduite à gauche, comme au Japon : on réapparaît sur la voie de gauche.
    respawns.push({ x: p.x + p.tz * lane, z: p.z - p.tx * lane, yaw: Math.atan2(p.tx, p.tz) });
    if (usable < 6) continue;
    if (e.kind === 'alley') {
      // Ruelles : pas de lampadaire, seulement de petites flaques colorées sous les néons.
      const count = Math.floor(usable / 14);
      for (let k = 0; k < count; k++) {
        pointAt(e, s0 + ((k + rng.range(0.2, 0.8)) / count) * usable, p);
        const off = (rng.chance(0.5) ? 1 : -1) * (e.width / 2 - 1.2);
        pools.push({ x: p.x + p.tz * off, z: p.z - p.tx * off, radius: rng.range(3.5, 6), color: neon(rng), intensity: 0.55 });
      }
      continue;
    }
    const spacing = e.kind === 'street' ? 30 : 34;
    const count = Math.max(1, Math.round(usable / spacing));
    const color = e.kind === 'street' ? LAMP_WARM : LAMP_COOL;
    for (let k = 0; k < count; k++) {
      pointAt(e, s0 + ((k + 0.5) / count) * usable, p);
      const sides = e.kind === 'street' ? [k % 2 === 0 ? 1 : -1] : [1, -1];
      for (const side of sides) {
        const off = e.width / 2 + 0.7;
        const nx = p.tz * side, nz = -p.tx * side;
        const x = p.x + nx * off, z = p.z + nz * off;
        const arm = e.kind === 'street' ? 1.6 : 3.2;
        lamps.push({ x, z, dx: -nx, dz: -nz, height: e.kind === 'street' ? 6.5 : 9, arm, color });
        pools.push({ x: x - nx * (arm + 1.5), z: z - nz * (arm + 1.5), radius: e.kind === 'street' ? 8 : 11, color, intensity: 0.5 });
      }
    }
  }
  // Feux de circulation aux coins des grands carrefours
  for (const node of graph.nodes) {
    let wide = 0;
    for (const eid of node.edges) if (KIND_RANK[(graph.edges[eid] as GraphEdge).kind] >= 2) wide++;
    if (wide < 3) continue;
    node.corners.forEach((c, k) => {
      // Un peu en retrait du coin, vers l'extérieur du carrefour.
      const dx = c.x - node.x, dz = c.z - node.z;
      const l = Math.hypot(dx, dz) || 1;
      const x = c.x + (dx / l) * 1.2, z = c.z + (dz / l) * 1.2;
      props.push({ x, y: 2.6, z, sx: 0.16, sy: 5.2, sz: 0.16, yaw: 0, color: [0.05, 0.05, 0.06] });
      props.push({ x, y: 5.0, z, sx: 0.4, sy: 1.1, sz: 0.4, yaw: 0, color: [0.03, 0.03, 0.035] });
      const green = k % 2 === 0;
      glowBoxes.push({ x, y: green ? 4.7 : 5.3, z, sx: 0.46, sy: 0.26, sz: 0.46, yaw: 0, color: green ? [0.1, 1.0, 0.5] : [1.0, 0.1, 0.08] });
    });
  }

  const highway = buildHighway(graph);

  // ——— Départ : sur une avenue large, près du centre, loin d'un carrefour ———
  let spawn: SpawnPoint = respawns[0] ?? { x: 0, z: 0, yaw: 0 };
  let best = Infinity;
  graph.edges.forEach((e, k) => {
    if (e.kind !== 'avenue' || e.onRing || e.length - e.trimA - e.trimB < 50) return;
    const r = respawns[k] as SpawnPoint;
    const score = Math.abs(Math.hypot(r.x, r.z) - R * 0.35);
    if (score < best) {
      best = score;
      pointAt(e, e.trimA + 10, p);
      spawn = { x: p.x + p.tz * (e.width / 4), z: p.z - p.tx * (e.width / 4), yaw: Math.atan2(p.tx, p.tz) };
    }
  });

  const margin = 60;
  const bounds: Rect = { x0: B.x0 - margin, x1: B.x1 + margin, z0: B.z0 - margin, z1: B.z1 + margin };
  return { seed, graph, bounds, buildings, signs, lamps, pools, props, glowBoxes, trees, parks, walls, highway, spawn, respawns };
}
