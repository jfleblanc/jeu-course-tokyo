import { Rng } from '../core/rng';
import { WORLD, type RoadKind } from '../config/world';

/**
 * Réseau de rues organique, sous forme de graphe (carrefours = nœuds, rues = arêtes courbes).
 * Tout en découle : géométrie des routes, immeubles le long des rues, et plus tard les
 * tracés de course, la ligne de l'IA et la mini-carte. Aucune dépendance au rendu.
 *
 * Principe : on part d'un treillis de lignes, on l'arrondit (ville en forme de galet),
 * on l'ondule (les lignes deviennent des courbes), on décale chaque carrefour, on ajoute
 * des avenues en diagonale (carrefours en Y, îlots triangulaires) et on supprime des
 * petites rues. Chaque ligne est ensuite lissée par une courbe passant par ses carrefours.
 */
export interface GraphNode {
  id: number;
  x: number;
  z: number;
  edges: number[];
  /** Rayon approximatif du carrefour (m). */
  radius: number;
  /** Coins du carrefour (là où deux bords de rue se rejoignent). */
  corners: { x: number; z: number }[];
  /** Contour du carrefour, dans l'ordre, pour le dessiner. */
  outline: { x: number; z: number }[];
  onRing: boolean;
}

export interface GraphEdge {
  id: number;
  a: number;
  b: number;
  kind: RoadKind;
  width: number;
  /** Points de la courbe, de a vers b : x0, z0, x1, z1… */
  pts: number[];
  /** Distance cumulée à chaque point. */
  cum: number[];
  length: number;
  /** Longueur occupée par le carrefour à chaque bout : la chaussée va de trimA à length − trimB. */
  trimA: number;
  trimB: number;
  onRing: boolean;
}

export interface StreetGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Arêtes du boulevard central, d'ouest en est. */
  boulevard: number[];
  /** Arêtes du périphérique, dans l'ordre de la boucle. */
  ring: number[];
  /** Contour du périphérique (x0, z0, x1, z1…), pour savoir si un point est dans la ville. */
  ringPolygon: number[];
  /** Rayon moyen de la ville (m). */
  radius: number;
}

export interface PathPoint {
  x: number;
  z: number;
  /** Tangente normalisée. */
  tx: number;
  tz: number;
}

/** Point et tangente à la distance `s` le long d'une arête (depuis le nœud a). */
export function pointAt(e: GraphEdge, s: number, out: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 }): PathPoint {
  const cum = e.cum;
  const n = cum.length;
  const d = s < 0 ? 0 : s > e.length ? e.length : s;
  let k = 0;
  while (k < n - 2 && (cum[k + 1] as number) < d) k++;
  const x0 = e.pts[k * 2] as number, z0 = e.pts[k * 2 + 1] as number;
  const x1 = e.pts[k * 2 + 2] as number, z1 = e.pts[k * 2 + 3] as number;
  const seg = (cum[k + 1] as number) - (cum[k] as number) || 1;
  const t = (d - (cum[k] as number)) / seg;
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  // Tangente lissée entre les segments voisins (évite les cassures visibles).
  let tx = (x1 - x0) / seg, tz = (z1 - z0) / seg;
  if (t > 0.5 && k < n - 2) {
    const x2 = e.pts[k * 2 + 4] as number, z2 = e.pts[k * 2 + 5] as number;
    const s2 = (cum[k + 2] as number) - (cum[k + 1] as number) || 1;
    const w = t - 0.5;
    tx = tx * (1 - w) + ((x2 - x1) / s2) * w;
    tz = tz * (1 - w) + ((z2 - z1) / s2) * w;
  } else if (t < 0.5 && k > 0) {
    const xp = e.pts[k * 2 - 2] as number, zp = e.pts[k * 2 - 1] as number;
    const sp = (cum[k] as number) - (cum[k - 1] as number) || 1;
    const w = 0.5 - t;
    tx = tx * (1 - w) + ((x0 - xp) / sp) * w;
    tz = tz * (1 - w) + ((z0 - zp) / sp) * w;
  }
  const len = Math.hypot(tx, tz) || 1;
  out.tx = tx / len;
  out.tz = tz / len;
  return out;
}

export function pointInPolygon(poly: number[], x: number, z: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2] as number, zi = poly[i * 2 + 1] as number;
    const xj = poly[j * 2] as number, zj = poly[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

interface Chain {
  nodes: number[];
  kind: RoadKind;
  closed: boolean;
  role: 'ring' | 'boulevard' | 'line' | 'diagonal';
}

const SUBDIV = 9;
const MAX_CORNER = 34;

export function generateStreetGraph(seed: number): StreetGraph {
  const rng = new Rng(seed);
  const N = WORLD.lines;
  const mid = Math.floor(N / 2);
  const half = ((N - 1) / 2) * WORLD.spacing;

  // ——— 1. Positions des lignes (irrégulières), puis des carrefours ———
  const linePos = (): number[] => {
    const p: number[] = [];
    for (let k = 0; k < N; k++) {
      const base = -1 + (2 * k) / (N - 1);
      const wobble = k === 0 || k === N - 1 ? 0 : rng.range(-0.3, 0.3) / (N - 1);
      p.push(base + wobble * 2);
    }
    return p;
  };
  const us = linePos();
  const vs = linePos();
  // Ondulations lentes : deux vagues par axe, de longueurs d'onde différentes.
  const waves = [0, 1, 2, 3].map(() => ({ f: rng.range(0.006, 0.013), p: rng.range(0, Math.PI * 2), a: rng.range(0.6, 1) }));
  const warp = (x: number, z: number): [number, number] => {
    const w0 = waves[0] as (typeof waves)[number], w1 = waves[1] as (typeof waves)[number];
    const w2 = waves[2] as (typeof waves)[number], w3 = waves[3] as (typeof waves)[number];
    const dx = WORLD.warp * (w0.a * Math.sin(z * w0.f + w0.p) + 0.5 * w1.a * Math.sin((z + x * 0.4) * w1.f * 2.1 + w1.p));
    const dz = WORLD.warp * (w2.a * Math.sin(x * w2.f + w2.p) + 0.5 * w3.a * Math.sin((x - z * 0.4) * w3.f * 2.1 + w3.p));
    return [x + dx, z + dz];
  };
  const nodes: GraphNode[] = [];
  const id = (i: number, j: number): number => j * N + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = us[i] as number, v = vs[j] as number;
      // Carré → disque (cartographie elliptique), dosé par « roundness ».
      const cu = u * Math.sqrt(1 - (v * v) / 2);
      const cv = v * Math.sqrt(1 - (u * u) / 2);
      const r = WORLD.roundness;
      let x = (u + (cu * 1.18 - u) * r) * half * 1.12; // un peu plus large que haute
      let z = (v + (cv * 1.18 - v) * r) * half;
      [x, z] = warp(x, z);
      const edge = i === 0 || j === 0 || i === N - 1 || j === N - 1;
      if (!edge) {
        x += rng.range(-1, 1) * WORLD.jitter;
        z += rng.range(-1, 1) * WORLD.jitter;
      }
      nodes.push({ id: id(i, j), x, z, edges: [], radius: 0, corners: [], outline: [], onRing: edge });
    }
  }

  // ——— 2. Lignes : périphérique, boulevard, avenues larges, rues, ruelles (raccourcis) ———
  // Beaucoup de voies larges ; les ruelles s'intercalent entre elles.
  const pattern: RoadKind[] = ['avenue', 'street', 'avenue', 'alley', 'street', 'avenue', 'alley', 'avenue', 'street', 'alley', 'avenue'];
  const kindOfLine = (k: number, shift: number): RoadKind => pattern[(k + shift) % pattern.length] as RoadKind;
  const rowShift = rng.int(0, 3);
  const colShift = rng.int(4, 7);
  const chains: Chain[] = [];
  const ringNodes: number[] = [];
  for (let i = 0; i < N; i++) ringNodes.push(id(i, 0));
  for (let j = 1; j < N; j++) ringNodes.push(id(N - 1, j));
  for (let i = N - 2; i >= 0; i--) ringNodes.push(id(i, N - 1));
  for (let j = N - 2; j >= 1; j--) ringNodes.push(id(0, j));
  chains.push({ nodes: ringNodes, kind: 'avenue', closed: true, role: 'ring' });
  for (let j = 1; j < N - 1; j++) {
    const row: number[] = [];
    for (let i = 0; i < N; i++) row.push(id(i, j));
    if (j === mid) chains.push({ nodes: row, kind: 'boulevard', closed: false, role: 'boulevard' });
    else chains.push({ nodes: row, kind: kindOfLine(j, rowShift), closed: false, role: 'line' });
  }
  for (let i = 1; i < N - 1; i++) {
    const col: number[] = [];
    for (let j = 0; j < N; j++) col.push(id(i, j));
    chains.push({ nodes: col, kind: i === mid ? 'avenue' : kindOfLine(i, colShift), closed: false, role: 'line' });
  }
  // Deux avenues en diagonale qui se jettent dans le boulevard (carrefours en Y).
  const diag1: number[] = [];
  for (let k = 0; k <= mid - 1; k++) diag1.push(id(k, k + 1));
  diag1.push(id(mid - 1, mid));
  const diag2: number[] = [];
  for (let k = 0; k <= N - 2 - mid; k++) diag2.push(id(mid + 1 + k, mid + k));
  const dedupe = (list: number[]): number[] => list.filter((v, k) => k === 0 || v !== list[k - 1]);
  chains.push({ nodes: dedupe(diag1), kind: 'avenue', closed: false, role: 'diagonal' });
  chains.push({ nodes: dedupe(diag2), kind: 'avenue', closed: false, role: 'diagonal' });

  // ——— 3. Arêtes brutes, puis suppression de petites rues sans couper le réseau ———
  interface Raw {
    chain: number;
    k: number;
    a: number;
    b: number;
    removed: boolean;
  }
  const raw: Raw[] = [];
  const seen = new Set<string>();
  chains.forEach((c, ci) => {
    const count = c.closed ? c.nodes.length : c.nodes.length - 1;
    for (let k = 0; k < count; k++) {
      const a = c.nodes[k] as number;
      const b = c.nodes[(k + 1) % c.nodes.length] as number;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue; // une diagonale ne double pas une rue existante
      seen.add(key);
      raw.push({ chain: ci, k, a, b, removed: false });
    }
  });
  const degree = new Array<number>(nodes.length).fill(0);
  for (const e of raw) {
    degree[e.a] = (degree[e.a] as number) + 1;
    degree[e.b] = (degree[e.b] as number) + 1;
  }
  const connected = (): boolean => {
    const adj: number[][] = nodes.map(() => []);
    for (const e of raw) {
      if (e.removed) continue;
      (adj[e.a] as number[]).push(e.b);
      (adj[e.b] as number[]).push(e.a);
    }
    const mark = new Uint8Array(nodes.length);
    const stack = [0];
    mark[0] = 1;
    let count = 1;
    while (stack.length) {
      const n = stack.pop() as number;
      for (const m of adj[n] as number[]) {
        if (!mark[m]) {
          mark[m] = 1;
          count++;
          stack.push(m);
        }
      }
    }
    return count === nodes.length;
  };
  for (const e of raw) {
    const kind = (chains[e.chain] as Chain).kind;
    if (kind !== 'street' && kind !== 'alley') continue;
    if (!rng.chance(WORLD.removeChance[kind])) continue;
    if ((degree[e.a] as number) <= 2 || (degree[e.b] as number) <= 2) continue;
    e.removed = true;
    if (connected()) {
      degree[e.a] = (degree[e.a] as number) - 1;
      degree[e.b] = (degree[e.b] as number) - 1;
    } else {
      e.removed = false;
    }
  }

  // ——— 4. Courbes : chaque ligne est lissée par une spline passant par ses carrefours ———
  const edges: GraphEdge[] = [];
  const boulevard: number[] = [];
  const ring: number[] = [];
  for (const r of raw) {
    if (r.removed) continue;
    const c = chains[r.chain] as Chain;
    const L = c.nodes.length;
    const at = (k: number): GraphNode => {
      const idx = c.closed ? ((k % L) + L) % L : Math.max(0, Math.min(L - 1, k));
      return nodes[c.nodes[idx] as number] as GraphNode;
    };
    const p0 = at(r.k - 1), p1 = at(r.k), p2 = at(r.k + 1), p3 = at(r.k + 2);
    const pts: number[] = [];
    const cum: number[] = [];
    let len = 0;
    for (let q = 0; q <= SUBDIV; q++) {
      const t = q / SUBDIV;
      const x = catmull(p0.x, p1.x, p2.x, p3.x, t);
      const z = catmull(p0.z, p1.z, p2.z, p3.z, t);
      if (q > 0) len += Math.hypot(x - (pts[pts.length - 2] as number), z - (pts[pts.length - 1] as number));
      pts.push(x, z);
      cum.push(len);
    }
    const e: GraphEdge = {
      id: edges.length,
      a: r.a,
      b: r.b,
      kind: c.kind,
      width: WORLD.roadWidth[c.kind],
      pts,
      cum,
      length: len,
      trimA: 0,
      trimB: 0,
      onRing: c.role === 'ring',
    };
    edges.push(e);
    (nodes[r.a] as GraphNode).edges.push(e.id);
    (nodes[r.b] as GraphNode).edges.push(e.id);
    if (c.role === 'boulevard') boulevard.push(e.id);
    if (c.role === 'ring') ring.push(e.id);
  }

  // ——— 5. Carrefours : où chaque rue s'arrête, et le contour à remplir ———
  const tmp: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  for (const node of nodes) {
    if (node.edges.length === 0) continue;
    const arms = node.edges.map((eid) => {
      const e = edges[eid] as GraphEdge;
      const fromA = e.a === node.id;
      // Direction de départ, mesurée un peu plus loin pour ignorer les petites irrégularités.
      const p = pointAt(e, fromA ? Math.min(8, e.length * 0.3) : e.length - Math.min(8, e.length * 0.3), tmp);
      let dx = p.x - node.x, dz = p.z - node.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      return { e, fromA, dx, dz, h: e.width / 2, angle: Math.atan2(dz, dx), trim: 0 };
    });
    arms.sort((p, q) => p.angle - q.angle);
    const n = arms.length;
    type Corner = { reflex: boolean; x: number; z: number; x2: number; z2: number };
    const corners: Corner[] = [];
    for (let k = 0; k < n; k++) {
      const a = arms[k] as (typeof arms)[number];
      const b = arms[(k + 1) % n] as (typeof arms)[number];
      let phi = b.angle - a.angle;
      if (phi <= 0) phi += Math.PI * 2;
      // Bord droit de a et bord gauche de b (b est à droite de a quand l'angle augmente).
      const arx = -a.dz, arz = a.dx;
      const blx = b.dz, blz = -b.dx;
      if (n === 1 || phi > Math.PI - 0.12) {
        // Pas de coin rentrant : on relie simplement les deux bords au niveau du nœud.
        corners.push({ reflex: true, x: node.x + arx * a.h, z: node.z + arz * a.h, x2: node.x + blx * b.h, z2: node.z + blz * b.h });
        continue;
      }
      const sin = Math.sin(phi), cos = Math.cos(phi);
      const t = Math.min(MAX_CORNER, Math.max(0, (b.h + a.h * cos) / sin));
      const s = Math.min(MAX_CORNER, Math.max(0, (a.h + b.h * cos) / sin));
      a.trim = Math.max(a.trim, t);
      b.trim = Math.max(b.trim, s);
      const cx = node.x + arx * a.h + a.dx * t;
      const cz = node.z + arz * a.h + a.dz * t;
      corners.push({ reflex: false, x: cx, z: cz, x2: cx, z2: cz });
      node.corners.push({ x: cx, z: cz });
    }
    // Longueur retirée à chaque rue (avec une petite marge), puis contour du carrefour.
    for (const arm of arms) {
      const trim = Math.min(arm.e.length * 0.45, arm.trim + 0.6);
      if (arm.fromA) arm.e.trimA = trim;
      else arm.e.trimB = trim;
      arm.trim = trim;
      node.radius = Math.max(node.radius, Math.hypot(trim, arm.h));
    }
    for (let k = 0; k < n; k++) {
      const arm = arms[k] as (typeof arms)[number];
      const p = pointAt(arm.e, arm.fromA ? arm.trim : arm.e.length - arm.trim, tmp);
      // Tangente orientée vers l'extérieur du carrefour.
      const ox = arm.fromA ? p.tx : -p.tx;
      const oz = arm.fromA ? p.tz : -p.tz;
      node.outline.push({ x: p.x + oz * arm.h, z: p.z - ox * arm.h }); // bord gauche
      node.outline.push({ x: p.x - oz * arm.h, z: p.z + ox * arm.h }); // bord droit
      const c = corners[k] as Corner;
      node.outline.push({ x: c.x, z: c.z });
      if (c.reflex) node.outline.push({ x: c.x2, z: c.z2 });
    }
  }

  // ——— 6. Contour du périphérique ———
  const ringPolygon: number[] = [];
  let cur = (chains[0] as Chain).nodes[0] as number;
  for (const eid of ring) {
    const e = edges[eid] as GraphEdge;
    const forward = e.a === cur;
    const count = e.pts.length / 2;
    for (let q = 0; q < count - 1; q++) {
      const k = forward ? q : count - 1 - q;
      ringPolygon.push(e.pts[k * 2] as number, e.pts[k * 2 + 1] as number);
    }
    cur = forward ? e.b : e.a;
  }
  let radius = 0;
  for (let k = 0; k < ringPolygon.length; k += 2) radius += Math.hypot(ringPolygon[k] as number, ringPolygon[k + 1] as number);
  radius /= ringPolygon.length / 2;

  return { nodes, edges, boulevard, ring, ringPolygon, radius };
}
