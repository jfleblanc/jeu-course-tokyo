import { Rng } from '../core/rng';
import { NEON_PALETTE, WORLD, type RoadKind } from '../config/world';
import { generateStreetGraph, type GraphEdge, type GraphNode, type StreetGraph } from './streetGraph';

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

/** Un étage (retrait) d'immeuble : boîte posée à la hauteur y0. */
export interface Tier extends Rect {
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
  footprint: Rect;
  tiers: Tier[];
  height: number;
  /** Graine propre à l'immeuble (0..1) : allumage des fenêtres, etc. */
  seed: number;
  /** 0 = bureaux, 1 = résidentiel, 2 = tour vitrée. */
  style: number;
  wall: [number, number, number];
  /** Largeur et hauteur d'une cellule de fenêtre (m). */
  cellW: number;
  cellH: number;
  /** Part des fenêtres allumées. */
  lit: number;
  facades: Facade[];
  /** Vrai pour le décor hors limites (pas de collision). */
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
  /** Limites jouables (bord extérieur du périphérique). */
  bounds: Rect;
  /** Îlots (trottoirs surélevés). */
  blocks: Rect[];
  buildings: Building[];
  signs: Sign[];
  lamps: Lamp[];
  pools: LightPool[];
  /** Petits objets sombres (poteaux, boîtiers). */
  props: Box[];
  /** Petits objets lumineux (distributeurs, feux). */
  glowBoxes: Box[];
  trees: Tree[];
  parks: Rect[];
  highway: Highway;
  spawn: SpawnPoint;
  /** Points de réapparition sur la chaussée (milieu de chaque rue). */
  respawns: SpawnPoint[];
}

type SideKinds = { w: RoadKind | null; e: RoadKind | null; n: RoadKind | null; s: RoadKind | null };

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

function splitLots(rng: Rng, rect: Rect, sides: SideKinds, out: { rect: Rect; sides: SideKinds }[], depth = 0): void {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const maxLot = rng.range(17, 34);
  const longest = Math.max(w, d);
  if (longest <= maxLot || depth > 6) {
    out.push({ rect, sides });
    return;
  }
  const t = rng.range(0.38, 0.62);
  if (w >= d) {
    const cut = rect.x0 + w * t;
    if (cut - rect.x0 < 9 || rect.x1 - cut < 9) {
      out.push({ rect, sides });
      return;
    }
    splitLots(rng, { ...rect, x1: cut }, { ...sides, e: null }, out, depth + 1);
    splitLots(rng, { ...rect, x0: cut }, { ...sides, w: null }, out, depth + 1);
  } else {
    const cut = rect.z0 + d * t;
    if (cut - rect.z0 < 9 || rect.z1 - cut < 9) {
      out.push({ rect, sides });
      return;
    }
    splitLots(rng, { ...rect, z1: cut }, { ...sides, s: null }, out, depth + 1);
    splitLots(rng, { ...rect, z0: cut }, { ...sides, n: null }, out, depth + 1);
  }
}

function facadesOf(rect: Rect, sides: SideKinds): Facade[] {
  const f: Facade[] = [];
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  if (sides.w) f.push({ cx: rect.x0, cz, nx: -1, nz: 0, length: rect.z1 - rect.z0, kind: sides.w });
  if (sides.e) f.push({ cx: rect.x1, cz, nx: 1, nz: 0, length: rect.z1 - rect.z0, kind: sides.e });
  if (sides.n) f.push({ cx, cz: rect.z0, nx: 0, nz: -1, length: rect.x1 - rect.x0, kind: sides.n });
  if (sides.s) f.push({ cx, cz: rect.z1, nx: 0, nz: 1, length: rect.x1 - rect.x0, kind: sides.s });
  return f;
}

function makeBuilding(rng: Rng, rect: Rect, sides: SideKinds, centerDist: number, backdrop: boolean): Building {
  const facades = facadesOf(rect, sides);
  let rank = -1;
  for (const f of facades) rank = Math.max(rank, KIND_RANK[f.kind]);
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  let height: number;
  if (rank <= 0) height = rng.range(9, 24);
  else if (rank === 1) height = rng.range(14, 36);
  else if (rank === 2) height = rng.range(24, 58);
  else height = rng.range(32, 76);
  // Plus haut vers le centre, quelques tours.
  height *= 1.15 - 0.4 * Math.min(1, centerDist);
  if (rank >= 1 && rng.chance(0.07)) height *= 1.7;
  if (backdrop) height = rng.range(26, 85);
  height = Math.round(height / 3.4) * 3.4 + 1.2;

  const style = height > 60 ? 2 : rank <= 1 && rng.chance(0.55) ? 1 : rng.chance(0.25) ? 2 : 0;
  const tiers: Tier[] = [];
  const tierCount = height > 22 && Math.min(w, d) > 13 ? (rng.chance(0.65) ? (rng.chance(0.4) ? 3 : 2) : 1) : 1;
  let cur: Rect = { ...rect };
  let y = 0;
  for (let k = 0; k < tierCount; k++) {
    const last = k === tierCount - 1;
    const top = last ? height : y + (height - y) * rng.range(0.45, 0.75);
    tiers.push({ ...cur, y0: y, y1: top });
    y = top;
    // Retrait de l'étage suivant (jamais sous 6 m de large).
    const inX = Math.min(rng.range(1.2, 4), (cur.x1 - cur.x0 - 7) / 2);
    const inZ = Math.min(rng.range(1.2, 4), (cur.z1 - cur.z0 - 7) / 2);
    cur = {
      x0: cur.x0 + Math.max(0, inX) * (rng.chance(0.8) ? 1 : 0),
      x1: cur.x1 - Math.max(0, inX) * (rng.chance(0.8) ? 1 : 0),
      z0: cur.z0 + Math.max(0, inZ) * (rng.chance(0.8) ? 1 : 0),
      z1: cur.z1 - Math.max(0, inZ) * (rng.chance(0.8) ? 1 : 0),
    };
  }

  return {
    footprint: rect,
    tiers,
    height,
    seed: rng.next(),
    style,
    wall: [...rng.pick(WALLS)] as [number, number, number],
    cellW: style === 2 ? rng.range(1.5, 2.2) : style === 1 ? rng.range(2.6, 3.6) : rng.range(1.8, 2.8),
    cellH: 3.4,
    lit: style === 1 ? rng.range(0.12, 0.34) : style === 2 ? rng.range(0.15, 0.42) : rng.range(0.1, 0.4),
    facades,
    backdrop,
  };
}

function addSigns(rng: Rng, b: Building, signs: Sign[]): void {
  const baseTop = (b.tiers[0] as Tier).y1;
  for (const f of b.facades) {
    const density = f.kind === 'alley' ? 4.6 : f.kind === 'street' ? 5.5 : f.kind === 'avenue' ? 8 : 9;
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
        signs.push({
          x: px + f.nx * off,
          y: rng.range(yMin, yMax),
          z: pz + f.nz * off,
          along: 0.22,
          up,
          out,
          nx: f.nx,
          nz: f.nz,
          color,
          seed: rng.next(),
          type: rng.chance(0.75) ? 0 : 2,
        });
      } else {
        // Panneau à plat sur la façade
        const along = Math.min(rng.range(1.8, 5), f.length * 0.5);
        const up = rng.range(0.9, 2.4);
        const yMax = Math.min(baseTop - up / 2 - 0.4, 13);
        const yMin = 3.9 + up / 2;
        if (yMax < yMin) continue;
        signs.push({
          x: px + f.nx * 0.12,
          y: rng.range(yMin, yMax),
          z: pz + f.nz * 0.12,
          along,
          up,
          out: 0.16,
          nx: f.nx,
          nz: f.nz,
          color,
          seed: rng.next(),
          type: rng.chance(0.6) ? 0 : 1,
        });
      }
    }
    // Grand écran / panneau publicitaire en hauteur sur les grands axes
    if (KIND_RANK[f.kind] >= 2 && baseTop > 24 && f.length > 14 && rng.chance(0.4)) {
      const along = Math.min(f.length * 0.7, rng.range(8, 15));
      const up = rng.range(4, 7);
      signs.push({
        x: f.cx + f.nx * 0.2,
        y: rng.range(14, Math.min(baseTop - up / 2 - 1, 30)),
        z: f.cz + f.nz * 0.2,
        along,
        up,
        out: 0.3,
        nx: f.nx,
        nz: f.nz,
        color: neon(rng),
        seed: rng.next(),
        type: 1,
      });
    }
  }
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildHighway(graph: StreetGraph): Highway {
  const H = WORLD.highway;
  const z = graph.zs[graph.boulevardJ] as number;
  const nx = graph.xs.length;
  // Les rampes tiennent dans les deux longs tronçons du boulevard, entre deux carrefours.
  const nodeHalf = (i: number): number => (graph.nodes[graph.boulevardJ * nx + i] as GraphNode).halfX;
  const startX = (graph.xs[1] as number) + nodeHalf(1) + 6;
  const endX = (graph.xs[nx - 2] as number) - nodeHalf(nx - 2) - 6;
  const total = endX - startX;

  // Points de contrôle : droit sur les rampes, ondulation au milieu (courbe de Catmull-Rom).
  const ctrl: { x: number; z: number }[] = [];
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const x = startX + total * u;
    const flat = Math.min(u, 1 - u) * total < H.rampLength + 10 ? 0 : 1;
    ctrl.push({ x, z: z + flat * H.weave * Math.sin(u * Math.PI * 3) });
  }
  const samples: HighwaySample[] = [];
  const stepsPerSeg = 16;
  let s = 0;
  let px = 0;
  let pz = 0;
  for (let k = 0; k < n; k++) {
    const c0 = ctrl[Math.max(0, k - 1)] as { x: number; z: number };
    const c1 = ctrl[k] as { x: number; z: number };
    const c2 = ctrl[k + 1] as { x: number; z: number };
    const c3 = ctrl[Math.min(n, k + 2)] as { x: number; z: number };
    for (let q = 0; q < stepsPerSeg + (k === n - 1 ? 1 : 0); q++) {
      const t = q / stepsPerSeg;
      const x = catmull(c0.x, c1.x, c2.x, c3.x, t);
      const zz = catmull(c0.z, c1.z, c2.z, c3.z, t);
      if (samples.length > 0) s += Math.hypot(x - px, zz - pz);
      px = x;
      pz = zz;
      samples.push({ x, y: 0, z: zz, tx: 1, tz: 0, s });
    }
  }
  const length = s;
  for (let k = 0; k < samples.length; k++) {
    const a = samples[Math.max(0, k - 1)] as HighwaySample;
    const b = samples[Math.min(samples.length - 1, k + 1)] as HighwaySample;
    const cur = samples[k] as HighwaySample;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    cur.tx = dx / len;
    cur.tz = dz / len;
    // Profil en long : rampe douce (smoothstep) à chaque bout.
    const dEnd = Math.min(cur.s, length - cur.s);
    const r = Math.min(1, dEnd / H.rampLength);
    cur.y = H.height * r * r * (3 - 2 * r);
  }

  const pillars: Highway['pillars'] = [];
  let next = H.rampLength * 0.55;
  for (const p of samples) {
    if (p.s < next) continue;
    if (length - p.s < H.rampLength * 0.5) break;
    next = p.s + H.pillarSpacing;
    // Pas de pilier au milieu d'un carrefour.
    let blocked = false;
    for (let i = 0; i < nx; i++) {
      const node = graph.nodes[graph.boulevardJ * nx + i] as GraphNode;
      if (node.halfX > 0 && Math.abs(p.x - node.x) < node.halfX + 2.5) blocked = true;
    }
    if (blocked) {
      next = p.s + 4;
      continue;
    }
    if (p.y > 3) pillars.push({ x: p.x, z: p.z, top: p.y, yaw: Math.atan2(p.tx, p.tz) });
  }
  return { samples, halfWidth: H.deckHalfWidth, barrierHeight: H.barrierHeight, pillars };
}

export function generateCity(seed: number = WORLD.seed): CityData {
  const graph = generateStreetGraph(seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const { xs, zs, hEdge, vEdge } = graph;
  const nx = xs.length;
  const nz = zs.length;
  const edgeOf = (id: number): GraphEdge | null => (id >= 0 ? (graph.edges[id] as GraphEdge) : null);

  const ring = WORLD.roadWidth.avenue / 2;
  const bounds: Rect = {
    x0: (xs[0] as number) - ring,
    x1: (xs[nx - 1] as number) + ring,
    z0: (zs[0] as number) - ring,
    z1: (zs[nz - 1] as number) + ring,
  };
  const halfSpan = Math.max(bounds.x1, bounds.z1);

  const blocks: Rect[] = [];
  const buildings: Building[] = [];
  const signs: Sign[] = [];
  const lamps: Lamp[] = [];
  const pools: LightPool[] = [];
  const props: Box[] = [];
  const glowBoxes: Box[] = [];
  const trees: Tree[] = [];
  const parks: Rect[] = [];

  // ——— Îlots et immeubles ———
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const west = edgeOf((vEdge[i] as number[])[j] as number);
      const east = edgeOf((vEdge[i + 1] as number[])[j] as number);
      const north = edgeOf((hEdge[i] as number[])[j] as number);
      const south = edgeOf((hEdge[i] as number[])[j + 1] as number);
      const block: Rect = {
        x0: (xs[i] as number) + (west ? west.width / 2 : 0),
        x1: (xs[i + 1] as number) - (east ? east.width / 2 : 0),
        z0: (zs[j] as number) + (north ? north.width / 2 : 0),
        z1: (zs[j + 1] as number) - (south ? south.width / 2 : 0),
      };
      blocks.push(block);
      const sides: SideKinds = {
        w: west ? west.kind : null,
        e: east ? east.kind : null,
        n: north ? north.kind : null,
        s: south ? south.kind : null,
      };
      const region: Rect = {
        x0: block.x0 + (west ? WORLD.sidewalk[west.kind] : 0),
        x1: block.x1 - (east ? WORLD.sidewalk[east.kind] : 0),
        z0: block.z0 + (north ? WORLD.sidewalk[north.kind] : 0),
        z1: block.z1 - (south ? WORLD.sidewalk[south.kind] : 0),
      };
      if (region.x1 - region.x0 < 8 || region.z1 - region.z0 < 8) continue;
      const lots: { rect: Rect; sides: SideKinds }[] = [];
      splitLots(rng, region, sides, lots);
      for (const lot of lots) {
        const cx = (lot.rect.x0 + lot.rect.x1) / 2;
        const cz = (lot.rect.z0 + lot.rect.z1) / 2;
        const hasStreet = lot.sides.w || lot.sides.e || lot.sides.n || lot.sides.s;
        // Quelques petits parcs / sanctuaires arborés pour aérer.
        if (hasStreet && rng.chance(0.045)) {
          parks.push(lot.rect);
          const count = rng.int(3, 7);
          for (let k = 0; k < count; k++) {
            trees.push({
              x: rng.range(lot.rect.x0 + 2, lot.rect.x1 - 2),
              z: rng.range(lot.rect.z0 + 2, lot.rect.z1 - 2),
              height: rng.range(5, 9),
              radius: rng.range(1.6, 2.8),
            });
          }
          continue;
        }
        const b = makeBuilding(rng, lot.rect, lot.sides, Math.hypot(cx, cz) / halfSpan, false);
        buildings.push(b);
        addSigns(rng, b, signs);
        // Distributeurs automatiques au pied des immeubles, côté petites rues
        for (const f of b.facades) {
          if (KIND_RANK[f.kind] <= 1 && rng.chance(0.3)) {
            const t = rng.range(-0.35, 0.35) * f.length;
            const off = f.kind === 'alley' ? 0.32 : 0.4;
            glowBoxes.push({
              x: f.cx - f.nz * t + f.nx * off,
              y: 0.95 + WORLD.sidewalkHeight,
              z: f.cz + f.nx * t + f.nz * off,
              sx: 1.0,
              sy: 1.8,
              sz: 0.6,
              yaw: Math.atan2(f.nx, f.nz),
              color: rng.pick([[0.8, 0.9, 1.0], [1.0, 0.25, 0.2], [0.3, 0.6, 1.0], [0.9, 1.0, 0.9]] as const),
            });
          }
        }
      }
    }
  }

  // ——— Décor hors limites : une rangée d'immeubles derrière le périphérique ———
  const sw = WORLD.sidewalk.avenue;
  const depth = 34;
  const ringSides: { x0: number; z0: number; x1: number; z1: number; side: keyof SideKinds }[] = [
    { x0: bounds.x0 - depth - 30, x1: bounds.x1 + depth + 30, z0: bounds.z0 - sw - depth, z1: bounds.z0 - sw, side: 's' },
    { x0: bounds.x0 - depth - 30, x1: bounds.x1 + depth + 30, z0: bounds.z1 + sw, z1: bounds.z1 + sw + depth, side: 'n' },
    { x0: bounds.x0 - sw - depth, x1: bounds.x0 - sw, z0: bounds.z0 - sw, z1: bounds.z1 + sw, side: 'e' },
    { x0: bounds.x1 + sw, x1: bounds.x1 + sw + depth, z0: bounds.z0 - sw, z1: bounds.z1 + sw, side: 'w' },
  ];
  for (const r of ringSides) {
    const horizontal = r.side === 'n' || r.side === 's';
    let cur = horizontal ? r.x0 : r.z0;
    const end = horizontal ? r.x1 : r.z1;
    while (cur < end - 8) {
      const size = Math.min(rng.range(18, 42), end - cur);
      const rect: Rect = horizontal ? { x0: cur, x1: cur + size, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: cur, z1: cur + size };
      const sides: SideKinds = { w: null, e: null, n: null, s: null };
      sides[r.side] = 'avenue';
      const b = makeBuilding(rng, rect, sides, 1, true);
      buildings.push(b);
      addSigns(rng, b, signs);
      cur += size;
    }
  }
  // Silhouettes lointaines dans le brouillard
  for (let k = 0; k < 90; k++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = halfSpan + rng.range(90, 520);
    const cx = Math.cos(ang) * dist * 1.1;
    const cz = Math.sin(ang) * dist * 1.1;
    const w = rng.range(22, 50);
    const d = rng.range(22, 50);
    const rect: Rect = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
    const b = makeBuilding(rng, rect, { w: null, e: null, n: null, s: null }, 1, true);
    b.height = rng.range(50, 190);
    b.tiers = [{ ...rect, y0: 0, y1: b.height }];
    b.style = 2;
    buildings.push(b);
  }

  // ——— Lampadaires, flaques de lumière, feux ———
  const respawns: SpawnPoint[] = [];
  for (const e of graph.edges) {
    const dirX = e.alongX ? 1 : 0;
    const dirZ = e.alongX ? 0 : 1;
    const mx = (e.x0 + e.x1) / 2;
    const mz = (e.z0 + e.z1) / 2;
    const lane = e.kind === 'alley' ? 0 : e.kind === 'boulevard' ? 10 : e.width / 4;
    // Conduite à gauche, comme au Japon : on réapparaît sur la voie de gauche.
    respawns.push({ x: mx + (e.alongX ? 0 : lane), z: mz + (e.alongX ? -lane : 0), yaw: e.alongX ? Math.PI / 2 : 0 });
    if (e.kind === 'alley') {
      // Ruelles : pas de lampadaire, seulement de petites flaques colorées sous les néons.
      const count = Math.floor(e.length / 14);
      for (let k = 0; k < count; k++) {
        const t = (k + rng.range(0.2, 0.8)) / count;
        const side = rng.chance(0.5) ? 1 : -1;
        const off = side * (e.width / 2 - 1.2);
        pools.push({
          x: e.x0 + dirX * e.length * t + dirZ * off,
          z: e.z0 + dirZ * e.length * t + dirX * off,
          radius: rng.range(3.5, 6),
          color: neon(rng),
          intensity: 0.55,
        });
      }
      continue;
    }
    const spacing = e.kind === 'street' ? 30 : 34;
    const count = Math.max(1, Math.round(e.length / spacing));
    const color = e.kind === 'street' ? LAMP_WARM : LAMP_COOL;
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const sides = e.kind === 'street' ? [k % 2 === 0 ? 1 : -1] : [1, -1];
      for (const side of sides) {
        const off = side * (e.width / 2 + 0.7);
        const x = e.x0 + dirX * e.length * t + dirZ * off;
        const z = e.z0 + dirZ * e.length * t + dirX * off;
        const arm = e.kind === 'street' ? 1.6 : 3.2;
        const height = e.kind === 'street' ? 6.5 : 9;
        lamps.push({ x, z, dx: -side * dirZ, dz: -side * dirX, height, arm, color });
        pools.push({
          x: x - side * dirZ * (arm + 1.5),
          z: z - side * dirX * (arm + 1.5),
          radius: e.kind === 'street' ? 8 : 11,
          color,
          intensity: 0.5,
        });
      }
    }
  }
  // Feux de circulation aux carrefours des grands axes
  for (const node of graph.nodes) {
    if (node.halfX < 5 || node.halfZ < 5) continue;
    const corners: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [sx, sz] of corners) {
      const x = node.x + sx * (node.halfX + 0.8);
      const z = node.z + sz * (node.halfZ + 0.8);
      props.push({ x, y: 2.6, z, sx: 0.16, sy: 5.2, sz: 0.16, yaw: 0, color: [0.05, 0.05, 0.06] });
      props.push({ x, y: 5.0, z, sx: 0.4, sy: 1.1, sz: 0.4, yaw: 0, color: [0.03, 0.03, 0.035] });
      const green = sx * sz > 0;
      glowBoxes.push({ x, y: green ? 4.7 : 5.3, z, sx: 0.46, sy: 0.26, sz: 0.46, yaw: 0, color: green ? [0.1, 1.0, 0.5] : [1.0, 0.1, 0.08] });
    }
  }

  const highway = buildHighway(graph);

  // ——— Départ : sur l'avenue centrale, face au boulevard ———
  const ci = Math.floor(nx / 2);
  const startEdge = edgeOf((vEdge[ci] as number[])[graph.boulevardJ - 2] as number) ?? (graph.edges[0] as GraphEdge);
  const spawn: SpawnPoint = startEdge.alongX
    ? { x: startEdge.x0 + 12, z: startEdge.z0 - startEdge.width / 4, yaw: Math.PI / 2 }
    : { x: startEdge.x0 + startEdge.width / 4, z: startEdge.z0 + 12, yaw: 0 };

  return { seed, graph, bounds, blocks, buildings, signs, lamps, pools, props, glowBoxes, trees, parks, highway, spawn, respawns };
}
