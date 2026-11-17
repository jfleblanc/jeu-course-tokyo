import { Rng } from '../core/rng';
import { NEON_PALETTE, WORLD, type RoadKind } from '../config/world';
import { generateStreetGraph, mergeGraph, pointAt, pointInPolygon, type GraphEdge, type GraphNode, type PathPoint, type StreetGraph } from './streetGraph';

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
  /** Vrai pour un palmier (tronc fin, couronne de palmes). */
  palm?: boolean;
  /** Hauteur du pied de l'arbre (0 = au sol ; sert sur les pentes de la colline). */
  y?: number;
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
  /** Vrai pour une boucle fermée (autoroute de ceinture). */
  closed: boolean;
  /** Côté extérieur de la ville (+1 ou −1), 0 s'il n'y en a pas : le flanc y descend jusqu'au sol. */
  outerSide: number;
  /** Ouvertures dans la glissière (là où une bretelle rejoint l'autoroute), en indices d'échantillons. */
  gaps: { side: number; from: number; to: number }[];
}

/** Bretelle au sol entre le périphérique et l'autoroute de ceinture. */
export interface Connector {
  /** Points de l'axe : x0, z0, x1, z1… */
  pts: number[];
  width: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

/** Colline de la route de montagne : un cône tronqué, la route enroulée autour, un plateau au sommet. */
export interface Mountain {
  road: Highway;
  cx: number;
  cz: number;
  /** Rayon du cône au sol et au sommet (m). */
  rBase: number;
  rTop: number;
  height: number;
}

/** Butte ou montagne : cône tronqué. `solid` = avec collision (les montagnes lointaines n'en ont pas). */
export interface Mound {
  x: number;
  z: number;
  r0: number;
  r1: number;
  height: number;
  solid: boolean;
  color: readonly [number, number, number];
}

/** Boîte de collision libre (parapets du sommet…). */
export interface SolidBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
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
  /** Autoroute surélevée du boulevard central. */
  highway: Highway;
  /** Autoroute de ceinture. */
  ringway: Highway;
  connectors: Connector[];
  /** Route de montagne (quartier des collines), s'il y en a une. */
  mountain: Mountain | null;
  /** Collisions supplémentaires. */
  solids: SolidBox[];
  /** Ponts d'accès aux quartiers (même structure qu'une autoroute surélevée). */
  bridges: Highway[];
  /** Buttes boisées et montagnes de la campagne. */
  mounds: Mound[];
  /** Zones de campagne (x, z, rayon) : le sol y est de l'herbe, pas du dallage. */
  countryside: number[][];
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

/** Décor du quartier en cours de construction (null = ville principale). */
let theme: string | null = null;

const DOCK_WALLS: ReadonlyArray<readonly [number, number, number]> = [[0.1, 0.075, 0.06], [0.07, 0.08, 0.09], [0.12, 0.1, 0.08], [0.06, 0.065, 0.07]];
const BAY_WALLS: ReadonlyArray<readonly [number, number, number]> = [[0.24, 0.22, 0.2], [0.2, 0.2, 0.22], [0.26, 0.2, 0.18], [0.16, 0.2, 0.21]];
const CONTAINER_COLORS: ReadonlyArray<readonly [number, number, number]> = [[0.5, 0.08, 0.05], [0.05, 0.16, 0.42], [0.06, 0.3, 0.15], [0.6, 0.24, 0.03], [0.42, 0.42, 0.4], [0.5, 0.4, 0.05]];

function makeBuilding(rng: Rng, fp: Obb, facades: Facade[], centerDist: number, boost: number): Building {
  if (theme) return makeThemedBuilding(rng, fp, facades, boost);
  return makeCityBuilding(rng, fp, facades, centerDist, boost);
}

/** Immeuble d'un quartier à thème : entrepôts bas (docks), hôtels clairs (baie), maisons basses (collines). */
function makeThemedBuilding(rng: Rng, fp: Obb, facades: Facade[], boost: number): Building {
  const b = makeCityBuilding(rng, fp, facades, 0.6, boost);
  const flat = (h: number): void => {
    b.height = Math.round(h / 3.4) * 3.4 + 1.2;
    b.tiers = [{ w: fp.w, d: fp.d, y0: 0, y1: b.height }];
  };
  if (theme === 'docks') {
    // Entrepôt : bas, large, presque sans fenêtres. Ni tours ni habitations sur les docks.
    flat(rng.chance(0.85) ? rng.range(7, 13) : rng.range(13, 19));
    b.style = 0;
    b.cellW = rng.range(4, 6);
    b.lit = rng.range(0.02, 0.07);
    b.wall = [...rng.pick(DOCK_WALLS)] as [number, number, number];
  } else if (theme === 'baie') {
    // Hôtels et résidences de bord de mer : clairs, moyens, bien éclairés ; quelques tours.
    if (!rng.chance(0.12)) flat(Math.min(b.height * 0.6, rng.range(12, 30)));
    b.style = rng.chance(0.7) ? 1 : 2;
    b.cellW = b.style === 1 ? rng.range(2.6, 3.4) : rng.range(1.6, 2.2);
    b.lit = rng.range(0.35, 0.6);
    b.wall = [...rng.pick(BAY_WALLS)] as [number, number, number];
  } else {
    // Campagne : petites maisons basses, sans vitrine ni enseigne.
    flat(rng.range(3.4, 7.5));
    b.style = 1;
    b.cellW = rng.range(2.8, 3.8);
    b.lit = rng.chance(0.5) ? rng.range(0.12, 0.3) : rng.range(0.04, 0.09);
    b.facades = [];
    b.wall = [...rng.pick(DOCK_WALLS)] as [number, number, number];
  }
  return b;
}

function makeCityBuilding(rng: Rng, fp: Obb, facades: Facade[], centerDist: number, boost: number): Building {
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
  return { samples, halfWidth: H.deckHalfWidth, barrierHeight: H.barrierHeight, pillars, closed: false, outerSide: 0, gaps: [] };
}

/**
 * Autoroute de ceinture : une boucle large qui entoure la ville, à l'extérieur du périphérique.
 * Elle alterne des portions au sol et des portions surélevées. Dans chaque portion au sol,
 * deux bretelles en pente douce la relient au périphérique : on y entre et on en sort à pleine vitesse.
 * Son flanc extérieur est un mur plein : c'est la limite visible de la ville.
 */
function buildRingway(graph: StreetGraph, rng: Rng): { ringway: Highway; connectors: Connector[]; groundCenters: number[] } {
  const C = WORLD.ringway;
  const poly = graph.ringPolygon;
  const n = poly.length / 2;
  const px = (k: number): number => poly[(((k % n) + n) % n) * 2] as number;
  const pz = (k: number): number => poly[(((k % n) + n) % n) * 2 + 1] as number;

  // Périphérique : distances cumulées et normale sortante en chaque point.
  const aveCum: number[] = [0];
  for (let k = 1; k <= n; k++) aveCum.push((aveCum[k - 1] as number) + Math.hypot(px(k) - px(k - 1), pz(k) - pz(k - 1)));
  const aveLen = aveCum[n] as number;
  const outward = (k: number): [number, number] => {
    let tx = px(k + 1) - px(k - 1), tz = pz(k + 1) - pz(k - 1);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    let nx = tz, nz = -tx;
    if (nx * px(k) + nz * pz(k) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [nx, nz];
  };
  /** Point du périphérique à la distance s (boucle), avec sa normale sortante. */
  const avePoint = (s: number): { x: number; z: number; nx: number; nz: number } => {
    const d = ((s % aveLen) + aveLen) % aveLen;
    let k = 0;
    while (k < n - 1 && (aveCum[k + 1] as number) < d) k++;
    const t = (d - (aveCum[k] as number)) / ((aveCum[k + 1] as number) - (aveCum[k] as number) || 1);
    const [n0x, n0z] = outward(k);
    const [n1x, n1z] = outward(k + 1);
    let nx = n0x + (n1x - n0x) * t, nz = n0z + (n1z - n0z) * t;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    return { x: px(k) + (px(k + 1) - px(k)) * t, z: pz(k) + (pz(k + 1) - pz(k)) * t, nx, nz };
  };

  // 1. Décalage du périphérique vers l'extérieur, puis lissage.
  let ox: number[] = [], oz: number[] = [];
  for (let k = 0; k < n; k++) {
    const [nx, nz] = outward(k);
    ox.push(px(k) + nx * C.offset);
    oz.push(pz(k) + nz * C.offset);
  }
  for (let pass = 0; pass < 10; pass++) {
    const sx: number[] = [], sz: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k - 1 + n) % n, b = (k + 1) % n;
      sx.push(((ox[a] as number) + 2 * (ox[k] as number) + (ox[b] as number)) / 4);
      sz.push(((oz[a] as number) + 2 * (oz[k] as number) + (oz[b] as number)) / 4);
    }
    ox = sx;
    oz = sz;
  }
  // 2. Rééchantillonnage tous les 3 m.
  const cum: number[] = [0];
  for (let k = 1; k <= n; k++) cum.push((cum[k - 1] as number) + Math.hypot((ox[k % n] as number) - (ox[k - 1] as number), (oz[k % n] as number) - (oz[k - 1] as number)));
  const total = cum[n] as number;
  const count = Math.round(total / 3);
  const samples: HighwaySample[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const d = (total * i) / count;
    while (seg < n - 1 && (cum[seg + 1] as number) < d) seg++;
    const t = (d - (cum[seg] as number)) / ((cum[seg + 1] as number) - (cum[seg] as number) || 1);
    const a = seg, b = (seg + 1) % n;
    samples.push({ x: (ox[a] as number) + ((ox[b] as number) - (ox[a] as number)) * t, y: 0, z: (oz[a] as number) + ((oz[b] as number) - (oz[a] as number)) * t, tx: 1, tz: 0, s: d });
  }
  for (let i = 0; i < count; i++) {
    const a = samples[(i - 1 + count) % count] as HighwaySample;
    const b = samples[(i + 1) % count] as HighwaySample;
    const cur = samples[i] as HighwaySample;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    cur.tx = (b.x - a.x) / l;
    cur.tz = (b.z - a.z) / l;
  }
  // Côté extérieur : addHighway décale de (−tz, tx)·côté.
  const s0 = samples[0] as HighwaySample;
  const outerSide = -s0.tz * s0.x + s0.tx * s0.z > 0 ? 1 : -1;

  // 3. Profil en long : portions au sol réparties sur la boucle, le reste surélevé.
  const centers: number[] = [];
  const phase = rng.range(0, 1);
  for (let k = 0; k < C.groundSections; k++) centers.push(((k + phase + rng.range(-0.08, 0.08)) / C.groundSections) * total);
  for (const sp of samples) {
    let d = Infinity;
    for (const c of centers) {
      const diff = Math.abs(sp.s - c);
      d = Math.min(d, diff, total - diff);
    }
    const r = Math.max(0, Math.min(1, (d - C.groundHalf) / C.rampLength));
    sp.y = C.height * r * r * (3 - 2 * r);
  }

  // 4. Bretelles : deux par portion au sol, en S très allongé (entrée et sortie à pleine vitesse).
  const nearestSample = (x: number, z: number): number => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < count; i++) {
      const sp = samples[i] as HighwaySample;
      const d = (sp.x - x) ** 2 + (sp.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const nearestAveArc = (x: number, z: number): number => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const d = (px(k) - x) ** 2 + (pz(k) - z) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return aveCum[best] as number;
  };
  const connectors: Connector[] = [];
  const gaps: Highway['gaps'] = [];
  const aveHalf = WORLD.roadWidth.avenue / 2;
  const w = C.connectorWidth;
  for (const c of centers) {
    const mid = samples[Math.round((c / total) * count) % count] as HighwaySample;
    const sAve = nearestAveArc(mid.x, mid.z);
    for (const dir of [1, -1]) {
      const pts: number[] = [];
      let gFrom = Infinity, gTo = -Infinity, prevIdx = -1;
      const steps = 44;
      for (let q = 0; q <= steps; q++) {
        const u = q / steps;
        // Départ loin du centre de la portion au sol, arrivée près du centre.
        const s = sAve - dir * (C.connectorLength + 24) + dir * u * C.connectorLength;
        const a = avePoint(s);
        const ax = a.x + a.nx * (aveHalf - w / 2), az = a.z + a.nz * (aveHalf - w / 2);
        const idx = nearestSample(ax, az);
        const h = samples[idx] as HighwaySample;
        // Bord intérieur de l'autoroute : vers la ville = −(côté extérieur)
        const inx = -(-h.tz) * outerSide, inz = -h.tx * outerSide;
        const bx = h.x + inx * (C.halfWidth - w / 2 - 0.6), bz = h.z + inz * (C.halfWidth - w / 2 - 0.6);
        const k = u * u * (3 - 2 * u);
        pts.push(ax + (bx - ax) * k, az + (bz - az) * k);
        if (u > 0.3) {
          // Indices « déroulés » pour gérer le passage par zéro de la boucle.
          let unwrapped = idx;
          if (prevIdx >= 0) {
            while (unwrapped - prevIdx > count / 2) unwrapped -= count;
            while (prevIdx - unwrapped > count / 2) unwrapped += count;
          }
          prevIdx = unwrapped;
          gFrom = Math.min(gFrom, unwrapped);
          gTo = Math.max(gTo, unwrapped);
        }
      }
      connectors.push({ pts, width: w });
      gaps.push({ side: -outerSide, from: gFrom - 3, to: gTo + 4 });
    }
  }

  // 5. Piliers sous les portions surélevées.
  const pillars: Highway['pillars'] = [];
  const every = Math.round(C.pillarSpacing / 3);
  for (let i = 0; i < count; i += every) {
    const sp = samples[i] as HighwaySample;
    if (sp.y > 3.2) pillars.push({ x: sp.x, z: sp.z, top: sp.y, yaw: Math.atan2(sp.tx, sp.tz) });
  }
  const groundCenters = centers.map((c) => Math.round((c / total) * count) % count);
  return { ringway: { samples, halfWidth: C.halfWidth, barrierHeight: WORLD.highway.barrierHeight, pillars, closed: true, outerSide, gaps }, connectors, groundCenters };
}


export function generateCity(seed: number = WORLD.seed): CityData {
  const graph = generateStreetGraph(seed);
  // `rng` change de générateur pendant la construction des quartiers extérieurs : la ville
  // principale reste exactement la même qu'avant leur ajout.
  const mainRng = new Rng(seed ^ 0x9e3779b9);
  const districtRng = new Rng(seed ^ 0x51ed270b);
  let rng = mainRng;
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
  const solids: SolidBox[] = [];
  const bridges: Highway[] = [];
  const mounds: Mound[] = [];
  /** Vallées sous les ponts (x, z, rayon) : rien n'y pousse. */
  const valleys: number[][] = [];
  let mountain: Mountain | null = null;
  const respawns: SpawnPoint[] = [];
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };

  // ——— Autoroute de ceinture, puis quartiers extérieurs greffés au-delà ———
  const { ringway, connectors, groundCenters } = buildRingway(graph, rng);
  const mainEdgeCount = graph.edges.length;
  /** Axes des routes d'accès (pour dégager le décor autour) : x0, z0, x1, z1. */
  const accessLines: number[][] = [];
  {
    const D = WORLD.districts;
    D.list.forEach((def, k) => {
      const idx = groundCenters[def.section % groundCenters.length];
      if (idx === undefined) return;
      const mid = ringway.samples[idx] as HighwaySample;
      const nx = -mid.tz * ringway.outerSide, nz = mid.tx * ringway.outerSide;
      const edgeX = mid.x + nx * ringway.halfWidth, edgeZ = mid.z + nz * ringway.halfWidth;
      const half = ((def.lines - 1) / 2) * def.spacing;
      const reach = (def.bridge > 0 ? def.bridge : D.accessLength) + half;
      const cx = edgeX + nx * reach, cz = edgeZ + nz * reach;
      const sub = generateStreetGraph(seed + 7919 * (k + 1), { district: k, lines: def.lines, spacing: def.spacing, cx, cz, ezx: nx, ezz: nz });
      // Entrée : le carrefour du quartier le plus proche de la sortie de l'autoroute.
      let entry = sub.nodes[0] as (typeof sub.nodes)[number], bd = Infinity;
      for (const node of sub.nodes) {
        if (node.edges.length === 0) continue;
        const d = Math.hypot(node.x - edgeX, node.z - edgeZ);
        if (d < bd) {
          bd = d;
          entry = node;
        }
      }
      const offset = mergeGraph(graph, sub);
      // Route d'accès : de la chaussée de l'autoroute jusqu'au carrefour d'entrée.
      const ax = mid.x + nx * (ringway.halfWidth - 1.5), az = mid.z + nz * (ringway.halfWidth - 1.5);
      if (def.bridge > 0) {
        // ——— Grand pont : on quitte la ville par-dessus une vallée, on arrive ailleurs ———
        const len = Math.hypot(entry.x - ax, entry.z - az) - entry.radius + 2;
        const tx = (entry.x - ax) / Math.hypot(entry.x - ax, entry.z - az), tz = (entry.z - az) / Math.hypot(entry.x - ax, entry.z - az);
        const Hb = D.bridgeHeight, flat0 = 34, ramp = 120, flat1 = 14;
        const samples: HighwaySample[] = [];
        for (let st = 0; st <= len; st += 3) {
          const up = Math.max(0, Math.min(1, (st - flat0) / ramp)), down = Math.max(0, Math.min(1, (len - flat1 - st) / ramp));
          const u = Math.min(up, down);
          samples.push({ x: ax + tx * st, y: Hb * u * u * (3 - 2 * u), z: az + tz * st, tx, tz, s: st });
        }
        const pillars: Highway['pillars'] = [];
        for (let i = 8; i < samples.length - 8; i += 12) {
          const sp = samples[i] as HighwaySample;
          if (sp.y > 4) pillars.push({ x: sp.x, z: sp.z, top: sp.y, yaw: Math.atan2(tx, tz) });
        }
        bridges.push({ samples, halfWidth: D.accessWidth / 2, barrierHeight: WORLD.highway.barrierHeight, pillars, closed: false, outerSide: 0, gaps: [] });
        accessLines.push([ax, az, entry.x, entry.z]);
        // Deux grands pylônes et leurs haubans lumineux, visibles de loin ; balises rouges au sommet.
        const yaw = Math.atan2(tx, tz);
        const towerH = 78, hw = D.accessWidth / 2 + 1.6;
        for (const f of [0.34, 0.66]) {
          const px = ax + tx * len * f, pz = az + tz * len * f;
          for (const side of [-1, 1]) {
            props.push({ x: px + tz * side * hw, y: towerH / 2, z: pz - tx * side * hw, sx: 2.2, sy: towerH, sz: 3, yaw, color: [0.2, 0.21, 0.24] });
            glowBoxes.push({ x: px + tz * side * hw, y: towerH + 0.8, z: pz - tx * side * hw, sx: 1, sy: 1, sz: 1, yaw, color: [1.0, 0.1, 0.05] });
            // Haubans : des points lumineux de la tête du pylône vers le tablier, de part et d'autre.
            for (const along of [-1, 1]) for (let q = 1; q <= 9; q++) {
              const reachS = q * 16;
              for (let h = 0; h < 3; h++) {
                const w = (h + 1) / 4;
                glowBoxes.push({ x: px + tz * side * hw + tx * along * reachS * w, y: Hb + 1.2 + (towerH - Hb - 4) * (1 - w), z: pz - tx * side * hw + tz * along * reachS * w, sx: 0.22, sy: 0.22, sz: 0.22, yaw, color: [0.75, 0.9, 1.0] });
              }
            }
          }
          props.push({ x: px, y: towerH - 6, z: pz, sx: hw * 2, sy: 2.4, sz: 2.4, yaw, color: [0.2, 0.21, 0.24] });
        }
        // La rivière au fond de la vallée : une longue lueur bleutée sous le pont.
        for (let q = -5; q <= 5; q++) pools.push({ x: ax + tx * len * 0.5 + tz * q * 150, z: az + tz * len * 0.5 - tx * q * 150, radius: 120, color: [0.03, 0.09, 0.16], intensity: 1 });
        valleys.push([ax + tx * len * 0.5, az + tz * len * 0.5, len * 0.5 + 60]);
      } else {
        const pts: number[] = [];
        const steps = Math.max(6, Math.round(Math.hypot(entry.x - ax, entry.z - az) / 5));
        for (let q = 0; q <= steps; q++) pts.push(ax + ((entry.x - ax) * q) / steps, az + ((entry.z - az) * q) / steps);
        connectors.push({ pts, width: D.accessWidth });
        accessLines.push([ax, az, entry.x, entry.z]);
        // Glissières en béton de chaque côté de la route d'accès : on ne peut pas en sortir pour
        // aller buter contre les limites invisibles, et le passage se lit d'un coup d'œil.
        {
          const len = Math.hypot(entry.x - ax, entry.z - az);
          const tx = (entry.x - ax) / len, tz = (entry.z - az) / len;
          const from = 5, to = len - entry.radius - 4;
          if (to - from > 8) {
            const midS = (from + to) / 2;
            for (const side of [1, -1]) {
              const gx = tz * side, gz = -tx * side;
              const off = D.accessWidth / 2 + 0.9;
              const fp: Obb = { cx: ax + tx * midS + gx * off, cz: az + tz * midS + gz * off, w: to - from, d: 0.7, yaw: Math.atan2(-gx, -gz) };
              buildings.push({ footprint: fp, tiers: [{ w: fp.w, d: fp.d, y0: 0, y1: 1.25 }], height: 1.25, seed: 0.5, style: 0, wall: [0.16, 0.16, 0.17], cellW: 40, lit: 0, facades: [], backdrop: false });
            }
          }
        }
      }
      const span = Math.ceil(D.accessWidth / 2 / 3) + 1;
      ringway.gaps.push({ side: ringway.outerSide, from: idx - span, to: idx + span });
      let radius = 0;
      for (let q = 0; q < sub.ringPolygon.length; q += 2) radius = Math.max(radius, Math.hypot((sub.ringPolygon[q] as number) - cx, (sub.ringPolygon[q + 1] as number) - cz));
      if (def.theme === 'collines') {
        // ——— Route de montagne : part du bord extérieur du quartier, s'enroule autour d'une colline ———
        const M = WORLD.mountain;
        let far = entry, best = -Infinity;
        for (const node of sub.nodes) {
          if (node.edges.length === 0) continue;
          const d = (node.x - cx) * nx + (node.z - cz) * nz;
          if (d > best) {
            best = d;
            far = node;
          }
        }
        const sx = far.x + nx * (far.radius - 1), sz = far.z + nz * (far.radius - 1);
        const p0x = sx + nx * M.approach, p0z = sz + nz * M.approach;
        // Centre de la colline : à gauche du pied de la route.
        const hx = p0x + nz * M.baseRadius, hz = p0z - nx * M.baseRadius;
        const a0 = Math.atan2(p0z - hz, p0x - hx);
        // Sens de rotation : celui qui prolonge la ligne droite d'approche.
        const dir = -Math.sin(a0) * nx + Math.cos(a0) * nz > 0 ? 1 : -1;
        const t0 = 0.955;
        const dense: [number, number, number][] = [];
        for (let q = 0; q <= M.approach; q += 1) dense.push([sx + nx * q, 0, sz + nz * q]);
        const N2 = 2400;
        for (let q = 1; q <= N2; q++) {
          const t = q / N2;
          const ang = a0 + dir * Math.PI * 2 * M.turns * t;
          // Jusqu'à t0 on monte en spirale ; ensuite on est en haut et on rentre vers le plateau.
          const r = t <= t0 ? M.baseRadius - ((M.baseRadius - M.topRadius) * t) / t0 : M.topRadius - 24 * ((t - t0) / (1 - t0));
          dense.push([hx + Math.cos(ang) * r, t <= t0 ? (M.height * t) / t0 : M.height, hz + Math.sin(ang) * r]);
        }
        // Rééchantillonnage tous les 3 m.
        const samples: HighwaySample[] = [];
        let acc = 0, next = 0;
        for (let q = 1; q < dense.length; q++) {
          const a = dense[q - 1] as [number, number, number], b = dense[q] as [number, number, number];
          const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
          while (next <= acc + len) {
            const u = (next - acc) / (len || 1);
            samples.push({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, z: a[2] + (b[2] - a[2]) * u, tx: (b[0] - a[0]) / (len || 1), tz: (b[2] - a[2]) / (len || 1), s: next });
            next += 3;
          }
          acc += len;
        }
        const ms = samples[Math.floor(samples.length / 2)] as HighwaySample;
        const outerSide = -ms.tz * (ms.x - hx) + ms.tx * (ms.z - hz) > 0 ? 1 : -1;
        mountain = {
          road: { samples, halfWidth: M.halfWidth, barrierHeight: WORLD.highway.barrierHeight, pillars: [], closed: false, outerSide, gaps: [] },
          cx: hx, cz: hz, rBase: M.baseRadius - M.halfWidth, rTop: M.topRadius - M.halfWidth, height: M.height,
        };
        accessLines.push([sx, sz, p0x, p0z]);
      }
      graph.districts.push({
        id: k, name: def.name, unlockLevel: def.unlockLevel, cx, cz, radius: radius + 60, polygon: sub.ringPolygon, entryNode: offset + sub.nodes.indexOf(entry),
        gate: { x: edgeX + nx * 20, z: edgeZ + nz * 20, yaw: Math.atan2(nx, nz), width: D.accessWidth },
        theme: def.theme, outX: nx, outZ: nz,
      });
    });
  }
  /** Distance à la route d'accès la plus proche (m). */
  const nearAccess = (x: number, z: number): number => {
    let best = Infinity;
    for (const [x0, z0, x1, z1] of accessLines as [number, number, number, number][]) {
      const dx = x1 - x0, dz = z1 - z0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - x0 - dx * t, z - z0 - dz * t));
    }
    return best;
  };
  const inDistrict = (x: number, z: number, margin: number): boolean => graph.districts.some((d) => Math.hypot(x - d.cx, z - d.cz) < d.radius + margin);

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
  // Autoroute de ceinture et bretelles : rien ne se construit dessus ni dessous.
  for (let i = 0; i < ringway.samples.length; i += 2) {
    const sp = ringway.samples[i] as HighwaySample;
    const r = ringway.halfWidth + 3;
    roadHash.insert(sp.x - r, sp.z - r, sp.x + r, sp.z + r, { x: sp.x, z: sp.z, r, slack: 0.4, kind: 'alley' });
  }
  for (const br of bridges) {
    for (let i = 0; i < br.samples.length; i += 2) {
      const sp = br.samples[i] as HighwaySample;
      const r = br.halfWidth + 5;
      roadHash.insert(sp.x - r, sp.z - r, sp.x + r, sp.z + r, { x: sp.x, z: sp.z, r, slack: 0.3, kind: 'alley' });
    }
  }
  const inValley = (x: number, z: number): boolean => valleys.some((v) => Math.hypot(x - (v[0] as number), z - (v[1] as number)) < (v[2] as number));
  if (mountain) {
    const mt: Mountain = mountain;
    for (let i = 0; i < mt.road.samples.length; i += 2) {
      const sp = mt.road.samples[i] as HighwaySample;
      if (sp.y > 14) break;
      const r = mt.road.halfWidth + 4;
      roadHash.insert(sp.x - r, sp.z - r, sp.x + r, sp.z + r, { x: sp.x, z: sp.z, r, slack: 0.3, kind: 'alley' });
    }
  }
  const connectorHash = new SpatialHash<{ x: number; z: number; r: number }>(40);
  for (const c of connectors) {
    const r = c.width / 2 + 1.5;
    for (let k = 0; k < c.pts.length; k += 2) {
      const x = c.pts[k] as number, z = c.pts[k + 1] as number;
      roadHash.insert(x - r, z - r, x + r, z + r, { x, z, r, slack: 0.3, kind: 'alley' });
      connectorHash.insert(x - r, z - r, x + r, z + r, { x, z, r });
    }
  }
  const onConnector = (x: number, z: number): boolean => connectorHash.some(x - 8, z - 8, x + 8, z + 8, (q) => Math.hypot(q.x - x, q.z - z) < q.r + 1.5);
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

  /** Arbre de campagne : avec un tronc en dur (on ne traverse pas la forêt en voiture). */
  const plantTree = (x: number, z: number, height: number, radius: number): void => {
    trees.push({ x, z, height, radius });
    solids.push({ x, y: 1.5, z, hx: 0.3, hy: 1.5, hz: 0.3, yaw: 0 });
  };

  /** Pagode à trois toits (décor) posée à la hauteur y ; `k` = échelle. */
  const addPagoda = (x: number, y: number, z: number, yaw: number, k: number): void => {
    const red: readonly [number, number, number] = [0.42, 0.07, 0.04];
    const roof: readonly [number, number, number] = [0.03, 0.035, 0.04];
    const levels: [number, number, number][] = [[12.5, 4.6, 9], [9.5, 8.4, 6.2], [6.8, 11.6, 4]];
    levels.forEach(([roofW, top, bodyW], i) => {
      // Corps de l'étage (sauf le premier, qui est le pavillon), puis son toit débordant.
      const prev = i === 0 ? 0 : ((levels[i - 1] as [number, number, number])[1] + 0.5);
      if (i > 0) props.push({ x, y: y + k * (prev + (top - prev) / 2), z, sx: bodyW * k, sy: (top - prev) * k, sz: bodyW * k, yaw, color: red });
      props.push({ x, y: y + k * (top + 0.25), z, sx: roofW * k, sy: 0.5 * k, sz: roofW * k, yaw, color: roof });
      props.push({ x, y: y + k * (top + 0.75), z, sx: roofW * 0.7 * k, sy: 0.5 * k, sz: roofW * 0.7 * k, yaw, color: roof });
    });
    props.push({ x, y: y + k * 14.4, z, sx: 0.4 * k, sy: 4 * k, sz: 0.4 * k, yaw, color: [0.3, 0.24, 0.08] });
    // Lanternes aux quatre coins.
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const [lx, lz] of [[5, 5], [-5, 5], [5, -5], [-5, -5]] as const) glowBoxes.push({ x: x + (lx * c + lz * sn) * k, y: y + 3.6 * k, z: z + (-lx * sn + lz * c) * k, sx: 0.5, sy: 0.7, sz: 0.5, yaw, color: [1.0, 0.6, 0.22] });
  };
  /** Torii (portique rouge) en travers d'une route : `w` = largeur du passage. */
  const addTorii = (x: number, y: number, z: number, yaw: number, w: number): void => {
    const red: readonly [number, number, number] = [0.5, 0.07, 0.04];
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const side of [-1, 1]) props.push({ x: x + side * (w / 2) * c, y: y + 4.5, z: z - side * (w / 2) * sn, sx: 0.9, sy: 9, sz: 0.9, yaw, color: red });
    props.push({ x, y: y + 9.3, z, sx: w + 5, sy: 0.9, sz: 1.2, yaw, color: red });
    props.push({ x, y: y + 7.6, z, sx: w + 1.5, sy: 0.6, sz: 0.8, yaw, color: red });
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
  const buildAlong = (list: GraphEdge[]): void => {
  const ordered = [...list].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]);
  // Deux passes : d'abord de grands immeubles, puis de plus petits pour boucher les trous.
  for (const pass of [0, 1])
  for (const e of ordered) {
    const half = e.width / 2;
    const sw = WORLD.sidewalk[e.kind];
    for (const side of [1, -1]) {
      // Côté extérieur du périphérique : immeubles plus profonds et plus hauts (ils ferment la ville).
      pointAt(e, e.length / 2, p);
      // (pour un quartier extérieur, « extérieur » se juge depuis son propre centre)
      const dc = e.district >= 0 ? graph.districts[e.district] : undefined;
      const ocx = dc ? dc.cx : 0, ocz = dc ? dc.cz : 0;
      const outer = e.onRing && (p.x + p.tz * side - ocx) ** 2 + (p.z - p.tx * side - ocz) ** 2 > (p.x - ocx) ** 2 + (p.z - ocz) ** 2;
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
            } else if (theme === 'collines' && rng.chance(0.9)) {
              // Campagne : la plupart du temps, pas de maison mais un bout de forêt au bord de la route.
              const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
              for (let q = rng.int(2, 5); q > 0; q--) {
                const lx = rng.range(-fp.w / 2, fp.w / 2), lz = rng.range(-fp.d / 2 + 2.5, fp.d / 2);
                plantTree(fp.cx + lx * c + lz * sn, fp.cz - lx * sn + lz * c, rng.range(7, 14), rng.range(2, 3.6));
              }
            } else if (theme === 'docks' && !outer && rng.chance(0.3)) {
              // Docks : vaste cour ou stationnement, presque vide — une ou deux remorques garées.
              occupy(fp);
              const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
              for (let q = rng.int(0, 2); q > 0; q--) {
                const lx = rng.range(-fp.w / 2 + 6.5, fp.w / 2 - 6.5), lz = rng.range(-fp.d / 2 + 2, fp.d / 2 - 4);
                if (Math.abs(fp.w) < 14) break;
                const cfp: Obb = { cx: fp.cx + lx * c + lz * sn, cz: fp.cz - lx * sn + lz * c, w: 12.2, d: 2.5, yaw: fp.yaw + (rng.chance(0.5) ? 0 : Math.PI / 2) };
                if (hitsRoad(cfp) || hitsBuilding(cfp)) continue;
                buildings.push({ footprint: cfp, tiers: [{ w: cfp.w, d: cfp.d, y0: 0, y1: 2.6 }], height: 2.6, seed: rng.next(), style: 0, wall: [...rng.pick(CONTAINER_COLORS)] as [number, number, number], cellW: 12.2, lit: 0, facades: [], backdrop: false });
              }
            } else if (theme === 'docks' && !outer && rng.chance(0.5)) {
              // Docks : un parc à conteneurs en bord de rue à la place d'un immeuble.
              occupy(fp);
              const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
              const cols = Math.max(1, Math.floor(fp.w / 12.9)), rows = Math.max(1, Math.floor(fp.d / 3.1));
              for (let q = 0; q < cols; q++) for (let r = 0; r < rows; r++) {
                if (rng.chance(0.25)) continue;
                const lx = (q - (cols - 1) / 2) * 12.9, lz = (r - (rows - 1) / 2) * 3.1;
                const cfp: Obb = { cx: fp.cx + lx * c + lz * sn, cz: fp.cz - lx * sn + lz * c, w: 12.2, d: 2.5, yaw: fp.yaw };
                const h = 2.6 * rng.int(1, 4);
                buildings.push({ footprint: cfp, tiers: [{ w: cfp.w, d: cfp.d, y0: 0, y1: h }], height: h, seed: rng.next(), style: 0, wall: [...rng.pick(CONTAINER_COLORS)] as [number, number, number], cellW: 12.2, lit: 0, facades: [], backdrop: false });
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
  };
  buildAlong(graph.edges.slice(0, mainEdgeCount));

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
    const atSea = graph.districts.some((dd) => (dd.theme === 'baie' || dd.theme === 'docks') && Math.hypot(fp.cx - (dd.cx + dd.outX * (dd.radius + 330)), fp.cz - (dd.cz + dd.outZ * (dd.radius + 330))) < 420);
    const onHill = mountain !== null && Math.hypot(fp.cx - (mountain as Mountain).cx, fp.cz - (mountain as Mountain).cz) < (mountain as Mountain).rBase + 60;
    const rural = graph.districts.some((dd) => dd.theme === 'collines' && Math.hypot(fp.cx - dd.cx, fp.cz - dd.cz) < dd.radius + 900 && (fp.cx - dd.cx) * dd.outX + (fp.cz - dd.cz) * dd.outZ > -dd.radius);
    if (!inDistrict(fp.cx, fp.cz, 40) && nearAccess(fp.cx, fp.cz) > 50 && !atSea && !onHill && !inValley(fp.cx, fp.cz) && !rural) buildings.push(b);
  }

  // ——— Limite de la ville : mur invisible le long du flanc extérieur de l'autoroute de ceinture ———
  // (le flanc lui-même est un mur plein bien visible ; ceci empêche seulement de sauter par-dessus)
  {
    const rs = ringway.samples;
    const off = (ringway.halfWidth + 0.9) * ringway.outerSide;
    const stepW = 3;
    for (let i = 0; i < rs.length; i += stepW) {
      const a = rs[i] as HighwaySample, b = rs[(i + stepW) % rs.length] as HighwaySample;
      const axx = a.x - a.tz * off, azz = a.z + a.tx * off;
      const bxx = b.x - b.tz * off, bzz = b.z + b.tx * off;
      const len = Math.hypot(bxx - axx, bzz - azz);
      // (pas de mur devant la sortie vers un quartier extérieur)
      const clearance = WORLD.districts.accessWidth / 2 + 3;
      if (nearAccess((axx + bxx) / 2, (azz + bzz) / 2) > clearance && nearAccess(axx, azz) > clearance && nearAccess(bxx, bzz) > clearance) walls.push({ x: (axx + bxx) / 2, z: (azz + bzz) / 2, yaw: Math.atan2(bxx - axx, bzz - azz), halfLength: len / 2 + 0.5 });
    }
    // Immeubles de décor juste derrière le mur (sans collision : on ne peut pas les atteindre).
    let i = 0;
    while (i < rs.length) {
      const sp = rs[i] as HighwaySample;
      const wB = rng.range(22, 44), dB = rng.range(22, 36);
      const nx = -sp.tz * ringway.outerSide, nz = sp.tx * ringway.outerSide;
      const dist = ringway.halfWidth + 7 + dB / 2;
      const fp: Obb = { cx: sp.x + nx * dist, cz: sp.z + nz * dist, w: wB, d: dB, yaw: Math.atan2(-nx, -nz) };
      const bd = makeBuilding(rng, fp, [{ cx: sp.x + nx * (ringway.halfWidth + 7), cz: sp.z + nz * (ringway.halfWidth + 7), nx: -nx, nz: -nz, length: wB, kind: 'avenue' }], 1, 1.7);
      bd.backdrop = true;
      const clear = nearAccess(fp.cx, fp.cz) < 34 || inDistrict(fp.cx, fp.cz, -20) || inValley(fp.cx, fp.cz);
      if (!clear) buildings.push(bd);
      // (les enseignes sont tirées quand même : la ville principale reste identique)
      const signsHere: Sign[] = clear ? [] : signs;
      addSigns(rng, bd, signsHere);
      i += Math.max(4, Math.round((wB + rng.range(1, 6)) / 3));
    }
  }

  // ——— Quartiers extérieurs : immeubles le long des rues, cœurs d'îlots, limite ———
  rng = districtRng;
  for (const d of graph.districts) {
    theme = d.theme;
    const firstSign = signs.length;
    buildAlong(graph.edges.filter((e) => e.district === d.id));
    const tries = Math.floor((d.radius * d.radius * 4) / 300);
    for (let k = 0; k < tries; k++) {
      const x = rng.range(d.cx - d.radius, d.cx + d.radius), z = rng.range(d.cz - d.radius, d.cz + d.radius);
      if (!pointInPolygon(d.polygon, x, z)) continue;
      const fp: Obb = { cx: x, cz: z, w: rng.range(11, 22), d: rng.range(11, 22), yaw: rng.range(0, Math.PI) };
      occupied.some(x - 20, z - 20, x + 20, z + 20, (q) => {
        fp.yaw = q.yaw;
        return true;
      });
      if (d.theme === 'docks' && rng.chance(0.7)) {
        // Parc à conteneurs : des rangées de piles de une à quatre hauteurs (avec collision).
        const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
        const rows = rng.int(2, 5), cols = rng.int(1, 3);
        for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
          const lx = (q - (cols - 1) / 2) * 12.9, lz = (r - (rows - 1) / 2) * 3.1;
          const cfp: Obb = { cx: x + lx * c + lz * sn, cz: z - lx * sn + lz * c, w: 12.2, d: 2.5, yaw: fp.yaw };
          if (hitsRoad(cfp) || hitsBuilding(cfp)) continue;
          const h = 2.6 * rng.int(1, 4);
          buildings.push({ footprint: cfp, tiers: [{ w: cfp.w, d: cfp.d, y0: 0, y1: h }], height: h, seed: rng.next(), style: 0, wall: [...rng.pick(CONTAINER_COLORS)] as [number, number, number], cellW: 12.2, lit: 0, facades: [], backdrop: false });
          occupy(cfp);
        }
        // De temps en temps, une grue portique au-dessus du parc (décor, sans collision).
        if (rng.chance(0.05)) {
          const h = rng.range(26, 38), span = 34;
          // Pas de pied de grue sur une chaussée.
          let clear = true;
          for (const side of [-1, 1]) for (const leg of [-1, 1]) if (hitsRoad({ cx: x + side * (span / 2) * c + leg * 5 * sn, cz: z - side * (span / 2) * sn + leg * 5 * c, w: 2.5, d: 2.5, yaw: fp.yaw })) clear = false;
          if (clear) {
          for (const side of [-1, 1]) for (const leg of [-1, 1]) props.push({ x: x + side * (span / 2) * c + leg * 5 * sn, y: h / 2, z: z - side * (span / 2) * sn + leg * 5 * c, sx: 1.1, sy: h, sz: 1.1, yaw: fp.yaw, color: [0.2, 0.09, 0.02] });
          props.push({ x, y: h, z, sx: span + 14, sy: 2.2, sz: 3, yaw: fp.yaw, color: [0.22, 0.1, 0.02] });
          props.push({ x: x + 4 * c, y: h + 3, z: z - 4 * sn, sx: 5, sy: 4, sz: 4, yaw: fp.yaw, color: [0.1, 0.1, 0.11] });
          for (const side of [-1, 1]) glowBoxes.push({ x: x + side * (span / 2 + 6) * c, y: h + 1.6, z: z - side * (span / 2 + 6) * sn, sx: 0.7, sy: 0.7, sz: 0.7, yaw: 0, color: [1.0, 0.1, 0.05] });
          }
        }
        continue;
      }
      if (hitsRoad(fp) || hitsBuilding(fp)) continue;
      if (d.theme === 'collines' && fp.w > 14 && fp.d > 14 && rng.chance(0.07)) {
        // Temple : un pavillon (avec collision) au milieu d'un jardin, sous une pagode à trois toits.
        parks.push(fp);
        occupy(fp);
        const hall: Obb = { cx: x, cz: z, w: 9, d: 9, yaw: fp.yaw };
        buildings.push({ footprint: hall, tiers: [{ w: 9, d: 9, y0: 0, y1: 4.6 }], height: 4.6, seed: rng.next(), style: 1, wall: [0.34, 0.06, 0.04], cellW: 3, lit: 0.5, facades: [], backdrop: false });
        addPagoda(x, 0, z, fp.yaw, 1);
        continue;
      }
      if (d.theme === 'collines') {
        if (rng.chance(0.4)) {
          // Butte boisée : un vrai relief au milieu des champs (avec collision).
          const r0 = rng.range(15, 30), h = rng.range(9, 22);
          const sq: Obb = { cx: x, cz: z, w: r0 * 2, d: r0 * 2, yaw: 0 };
          if (!hitsRoad(sq) && !hitsBuilding(sq)) {
            occupy(sq);
            mounds.push({ x, z, r0, r1: r0 * 0.25, height: h, solid: true, color: [0.03, 0.05, 0.035] });
            for (let q = rng.int(9, 16); q > 0; q--) {
              const a = rng.range(0, Math.PI * 2), rho = rng.range(r0 * 0.3, r0 * 0.95);
              trees.push({ x: x + Math.cos(a) * rho, z: z + Math.sin(a) * rho, y: (h * (r0 - rho)) / (r0 * 0.75), height: rng.range(8, 14), radius: rng.range(2.2, 3.6) });
            }
            continue;
          }
        }
        if (rng.chance(0.82)) {
          // Forêt : quelques arbres serrés.
          occupy(fp);
          const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
          for (let q = rng.int(3, 7); q > 0; q--) {
            const lx = rng.range(-fp.w / 2 + 1.5, fp.w / 2 - 1.5), lz = rng.range(-fp.d / 2 + 1.5, fp.d / 2 - 1.5);
            plantTree(x + lx * c + lz * sn, z - lx * sn + lz * c, rng.range(8, 15), rng.range(2.2, 3.8));
          }
          continue;
        }
      }
      // Campagne : très peu de maisons isolées au milieu des terres.
      if (d.theme === 'collines' && rng.chance(0.75)) continue;
      finishBuilding(fp, null, 1.1);
    }
    if (d.theme === 'docks') {
      // Quai : au bord extérieur, une rangée de grandes grues de quai, des murs de conteneurs,
      // un cargo à quai et l'eau du port au-delà (décor, hors d'atteinte).
      const qx = d.cx + d.outX * (d.radius + 30), qz = d.cz + d.outZ * (d.radius + 30);
      const px = d.outZ, pz = -d.outX; // le long du quai
      const yaw = Math.atan2(d.outX, d.outZ);
      const steel: readonly [number, number, number] = [0.5, 0.2, 0.03];
      for (let k = -4; k <= 4; k++) {
        const gx = qx + px * k * 95, gz = qz + pz * k * 95;
        // Grue de quai : quatre pieds, un portique, une flèche qui avance au-dessus de l'eau.
        for (const sa of [-1, 1]) for (const sb of [-1, 1]) props.push({ x: gx + px * sa * 13 + d.outX * sb * 11, y: 24, z: gz + pz * sa * 13 + d.outZ * sb * 11, sx: 1.6, sy: 48, sz: 1.6, yaw, color: steel });
        props.push({ x: gx, y: 48.5, z: gz, sx: 29, sy: 3, sz: 25, yaw, color: steel });
        props.push({ x: gx + d.outX * 34, y: 51, z: gz + d.outZ * 34, sx: 3.2, sy: 2.6, sz: 92, yaw, color: steel });
        props.push({ x: gx, y: 60, z: gz, sx: 2.4, sy: 22, sz: 2.4, yaw, color: steel });
        glowBoxes.push({ x: gx, y: 71.6, z: gz, sx: 0.9, sy: 0.9, sz: 0.9, yaw, color: [1.0, 0.1, 0.05] });
        glowBoxes.push({ x: gx + d.outX * 78, y: 52.8, z: gz + d.outZ * 78, sx: 0.8, sy: 0.8, sz: 0.8, yaw, color: [1.0, 0.1, 0.05] });
        for (const sa of [-1, 1]) glowBoxes.push({ x: gx + px * sa * 13, y: 46, z: gz + pz * sa * 13, sx: 1.4, sy: 0.5, sz: 1.4, yaw, color: [1.0, 0.75, 0.4] });
        // Murs de conteneurs entre les grues.
        for (let r = 0; r < 3; r++) for (let q = -2; q <= 2; q++) {
          const lv = rng.int(2, 5);
          props.push({ x: gx + px * (47 + q * 12.9) - d.outX * (18 + r * 3.2), y: lv * 1.3, z: gz + pz * (47 + q * 12.9) - d.outZ * (18 + r * 3.2), sx: 12.2, sy: lv * 2.6, sz: 2.5, yaw: yaw + Math.PI / 2, color: rng.pick(CONTAINER_COLORS) });
        }
      }
      // Cargo à quai, chargé de conteneurs.
      const shx = qx + d.outX * 62, shz = qz + d.outZ * 62;
      props.push({ x: shx, y: 7, z: shz, sx: 36, sy: 14, sz: 300, yaw: yaw + Math.PI / 2, color: [0.05, 0.06, 0.09] });
      props.push({ x: shx + px * 125, y: 26, z: shz + pz * 125, sx: 30, sy: 24, sz: 22, yaw: yaw + Math.PI / 2, color: [0.3, 0.3, 0.32] });
      for (let q = -8; q <= 6; q++) for (let r = -1; r <= 1; r++) {
        const lv = rng.int(2, 5);
        props.push({ x: shx + px * q * 13.2 + d.outX * r * 9, y: 14 + lv * 1.3, z: shz + pz * q * 13.2 + d.outZ * r * 9, sx: 8.6, sy: lv * 2.6, sz: 12.4, yaw: yaw + Math.PI / 2, color: rng.pick(CONTAINER_COLORS) });
      }
      for (let q = -3; q <= 3; q++) glowBoxes.push({ x: shx + px * (125 + q * 3.5), y: 39, z: shz + pz * (125 + q * 3.5), sx: 1.6, sy: 0.9, sz: 0.6, yaw, color: [1.0, 0.85, 0.6] });
      pools.push({ x: d.cx + d.outX * (d.radius + 360), z: d.cz + d.outZ * (d.radius + 360), radius: 340, color: [0.015, 0.06, 0.1], intensity: 1 });
    }
    // Docks : peu d'enseignes au néon. Campagne : aucune.
    if (d.theme === 'docks' || d.theme === 'collines') {
      const kept = signs.slice(firstSign).filter(() => d.theme === 'docks' && rng.chance(0.3));
      signs.length = firstSign;
      signs.push(...kept);
    }
    if (d.theme === 'baie') {
      // Palmiers le long des avenues.
      for (const e of graph.edges) {
        if (e.district !== d.id || (e.kind !== 'avenue' && e.kind !== 'boulevard')) continue;
        for (let st = e.trimA + 6; st < e.length - e.trimB - 6; st += 17) {
          pointAt(e, st, p);
          for (const side of [1, -1]) trees.push({ x: p.x + p.tz * side * (e.width / 2 + 1.3), z: p.z - p.tx * side * (e.width / 2 + 1.3), height: rng.range(8, 12), radius: rng.range(2.6, 3.4), palm: true });
        }
      }
      // Grande roue illuminée au bord de l'eau (décor, hors d'atteinte), et la mer au-delà.
      const wx = d.cx + d.outX * (d.radius + 60), wz = d.cz + d.outZ * (d.radius + 60);
      const yaw = Math.atan2(d.outX, d.outZ);
      const ax = Math.cos(yaw), az = -Math.sin(yaw); // axe du plan de la roue (perpendiculaire à la direction du large)
      const R0 = 46, hub = 54;
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        glowBoxes.push({ x: wx + ax * Math.cos(a) * R0, y: hub + Math.sin(a) * R0, z: wz + az * Math.cos(a) * R0, sx: 2.2, sy: 2.2, sz: 1.2, yaw, color: k % 2 ? [1.0, 0.2, 0.6] : [0.2, 0.9, 1.0] });
      }
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        for (let q = 1; q <= 5; q++) glowBoxes.push({ x: wx + ax * Math.cos(a) * R0 * (q / 6), y: hub + Math.sin(a) * R0 * (q / 6), z: wz + az * Math.cos(a) * R0 * (q / 6), sx: 0.8, sy: 0.8, sz: 0.6, yaw, color: [1.0, 0.85, 0.5] });
      }
      for (const side of [-1, 1]) props.push({ x: wx + ax * side * 14, y: hub / 2, z: wz + az * side * 14, sx: 1.6, sy: hub, sz: 1.6, yaw, color: [0.12, 0.12, 0.14] });
      pools.push({ x: d.cx + d.outX * (d.radius + 330), z: d.cz + d.outZ * (d.radius + 330), radius: 330, color: [0.02, 0.1, 0.14], intensity: 1 });
    }
    if (d.theme === 'collines') {
      // Chaîne de montagnes à l'horizon, du côté opposé à la ville (décor, sans collision).
      for (let q = 0; q < 16; q++) {
        const a = Math.atan2(d.outZ, d.outX) + rng.range(-1.9, 1.9);
        const dist = d.radius + rng.range(260, 760);
        const mx = d.cx + Math.cos(a) * dist, mz = d.cz + Math.sin(a) * dist;
        if (mountain && Math.hypot(mx - (mountain as Mountain).cx, mz - (mountain as Mountain).cz) < (mountain as Mountain).rBase + 180) continue;
        const r0 = rng.range(170, 340);
        mounds.push({ x: mx, z: mz, r0, r1: r0 * rng.range(0.04, 0.16), height: rng.range(130, 310), solid: false, color: [0.022, 0.03, 0.04] });
      }
    }
    if (d.theme === 'collines' && mountain) {
      const mt: Mountain = mountain;
      const rs = mt.road.samples;
      const first = rs[8] as HighwaySample;
      addTorii(first.x, 0, first.z, Math.atan2(first.tx, first.tz), mt.road.halfWidth * 2 + 3);
      // Sommet : grand temple au centre du plateau, torii à l'arrivée, parapet rouge tout autour.
      addPagoda(mt.cx, mt.height, mt.cz, Math.atan2(d.outX, d.outZ), 1.7);
      props.push({ x: mt.cx, y: mt.height + 4, z: mt.cz, sx: 15, sy: 8, sz: 15, yaw: Math.atan2(d.outX, d.outZ), color: [0.36, 0.06, 0.04] });
      const last = rs[rs.length - 10] as HighwaySample;
      addTorii(last.x, mt.height, last.z, Math.atan2(last.tx, last.tz), mt.road.halfWidth * 2 + 3);
      const rim = mt.rTop - 1.2, segs = 44;
      for (let q = 0; q < segs; q++) {
        const a = ((q + 0.5) / segs) * Math.PI * 2;
        const px = mt.cx + Math.cos(a) * rim, pz = mt.cz + Math.sin(a) * rim;
        // Ouverture là où la route arrive sur le plateau.
        let open = false;
        for (let i = rs.length - 1; i >= 0 && (rs[i] as HighwaySample).y > mt.height - 6; i -= 2) if (Math.hypot((rs[i] as HighwaySample).x - px, (rs[i] as HighwaySample).z - pz) < mt.road.halfWidth + 6) open = true;
        if (open) continue;
        const len = (Math.PI * 2 * rim) / segs;
        const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
        props.push({ x: px, y: mt.height + 0.7, z: pz, sx: 0.5, sy: 1.4, sz: len + 0.3, yaw, color: [0.42, 0.07, 0.04] });
        solids.push({ x: px, y: mt.height + 1.5, z: pz, hx: 0.4, hy: 1.5, hz: len / 2 + 0.3, yaw });
        if (q % 4 === 0) glowBoxes.push({ x: px, y: mt.height + 1.7, z: pz, sx: 0.45, sy: 0.6, sz: 0.45, yaw, color: [1.0, 0.6, 0.22] });
      }
      // Arbres sur les pentes, hors de l'emprise de la route.
      for (let q = 0; q < 420; q++) {
        const a = rng.range(0, Math.PI * 2), rho = rng.range(mt.rTop + 6, mt.rBase - 4);
        const tx = mt.cx + Math.cos(a) * rho, tz = mt.cz + Math.sin(a) * rho;
        let clear = true;
        for (let i = 0; i < rs.length; i += 3) if (Math.hypot((rs[i] as HighwaySample).x - tx, (rs[i] as HighwaySample).z - tz) < mt.road.halfWidth + 5) { clear = false; break; }
        if (clear) trees.push({ x: tx, z: tz, y: (mt.height * (mt.rBase - rho)) / (mt.rBase - mt.rTop), height: rng.range(8, 15), radius: rng.range(2.2, 3.6) });
      }
    }
    theme = null;
    // Limite : mur invisible autour du quartier, derrière ses immeubles, ouvert devant la route d'accès.
    const poly = d.polygon;
    const m = poly.length / 2;
    const out = 46;
    const ring: [number, number][] = [];
    for (let k = 0; k < m; k++) {
      const x = poly[k * 2] as number, z = poly[k * 2 + 1] as number;
      const l = Math.hypot(x - d.cx, z - d.cz) || 1;
      ring.push([x + ((x - d.cx) / l) * out, z + ((z - d.cz) / l) * out]);
    }
    for (let k = 0; k < m; k++) {
      const [ax, az] = ring[k] as [number, number], [bx, bz] = ring[(k + 1) % m] as [number, number];
      const len = Math.hypot(bx - ax, bz - az);
      const parts = Math.max(1, Math.round(len / 12));
      for (let q = 0; q < parts; q++) {
        const x0 = ax + ((bx - ax) * q) / parts, z0 = az + ((bz - az) * q) / parts;
        const x1 = ax + ((bx - ax) * (q + 1)) / parts, z1 = az + ((bz - az) * (q + 1)) / parts;
        if (nearAccess((x0 + x1) / 2, (z0 + z1) / 2) < 24 || nearAccess(x0, z0) < 18 || nearAccess(x1, z1) < 18) continue;
        // Pas de mur (haut de 30 m) en travers de la route de montagne quand elle passe au-dessus.
        if (mountain) {
          let under = false;
          for (const sp of (mountain as Mountain).road.samples) {
            if (sp.y > 34) break;
            if (Math.hypot(sp.x - (x0 + x1) / 2, sp.z - (z0 + z1) / 2) < 16) { under = true; break; }
          }
          if (under) continue;
        }
        walls.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, yaw: Math.atan2(x1 - x0, z1 - z0), halfLength: len / parts / 2 + 0.5 });
      }
    }
  }
  rng = mainRng;

  // ——— Lampadaires, flaques de lumière, points de réapparition ———
  for (const e of graph.edges) {
    rng = e.district >= 0 ? districtRng : mainRng;
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
        if (onConnector(x, z)) continue;
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

  // Campagne : un lampadaire sur quatre seulement, la nuit y est plus noire.
  for (const d of graph.districts) {
    if (d.theme !== 'collines') continue;
    const dim = new Rng(seed ^ 0x33aa71);
    const keep = <T extends { x: number; z: number }>(list: T[]): T[] => list.filter((q) => Math.hypot(q.x - d.cx, q.z - d.cz) > d.radius || dim.chance(0.25));
    const l2 = keep(lamps), p2 = keep(pools);
    lamps.length = 0;
    lamps.push(...l2);
    pools.length = 0;
    pools.push(...p2);
  }
  const countryside: number[][] = [];
  for (const d of graph.districts) if (d.theme === 'collines') countryside.push([d.cx, d.cz, d.radius + 220]);
  if (mountain) countryside.push([(mountain as Mountain).cx, (mountain as Mountain).cz, (mountain as Mountain).rBase + 200]);
  for (const v of valleys) countryside.push([v[0] as number, v[1] as number, (v[2] as number) + 160]);
  // Éclairage public propre à chaque quartier : sodium orangé sur les docks, rose chaud sur la baie, doré dans les collines.
  for (const d of graph.districts) {
    const tint: readonly [number, number, number] = d.theme === 'docks' ? [1.0, 0.5, 0.14] : d.theme === 'baie' ? [1.0, 0.62, 0.7] : [1.0, 0.78, 0.45];
    for (const l of lamps) if (Math.hypot(l.x - d.cx, l.z - d.cz) < d.radius) l.color = tint;
    for (const q of pools) if (q.radius < 20 && Math.hypot(q.x - d.cx, q.z - d.cz) < d.radius) q.color = tint;
  }
  rng = mainRng;
  const highway = buildHighway(graph);

  // ——— Départ : sur une avenue large, près du centre, loin d'un carrefour ———
  let spawn: SpawnPoint = respawns[0] ?? { x: 0, z: 0, yaw: 0 };
  let best = Infinity;
  graph.edges.forEach((e, k) => {
    if (e.district >= 0 || e.kind !== 'avenue' || e.onRing || e.length - e.trimA - e.trimB < 50) return;
    const r = respawns[k] as SpawnPoint;
    const score = Math.abs(Math.hypot(r.x, r.z) - R * 0.35);
    if (score < best) {
      best = score;
      pointAt(e, e.trimA + 10, p);
      spawn = { x: p.x + p.tz * (e.width / 4), z: p.z - p.tx * (e.width / 4), yaw: Math.atan2(p.tx, p.tz) };
    }
  });

  for (const sp of ringway.samples) {
    B.x0 = Math.min(B.x0, sp.x);
    B.x1 = Math.max(B.x1, sp.x);
    B.z0 = Math.min(B.z0, sp.z);
    B.z1 = Math.max(B.z1, sp.z);
  }
  if (mountain) {
    const mt: Mountain = mountain;
    const r = mt.rBase + 30;
    B.x0 = Math.min(B.x0, mt.cx - r);
    B.x1 = Math.max(B.x1, mt.cx + r);
    B.z0 = Math.min(B.z0, mt.cz - r);
    B.z1 = Math.max(B.z1, mt.cz + r);
  }
  for (const d of graph.districts) {
    B.x0 = Math.min(B.x0, d.cx - d.radius);
    B.x1 = Math.max(B.x1, d.cx + d.radius);
    B.z0 = Math.min(B.z0, d.cz - d.radius);
    B.z1 = Math.max(B.z1, d.cz + d.radius);
  }
  const margin = 60;
  const bounds: Rect = { x0: B.x0 - margin, x1: B.x1 + margin, z0: B.z0 - margin, z1: B.z1 + margin };
  return { seed, graph, bounds, buildings, signs, lamps, pools, props, glowBoxes, trees, parks, walls, highway, ringway, connectors, mountain, solids, bridges, mounds, countryside, spawn, respawns };
}
