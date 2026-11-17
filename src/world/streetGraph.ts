import { Rng } from '../core/rng';
import { WORLD, type RoadKind } from '../config/world';

/**
 * Réseau de rues sous forme de graphe (intersections = nœuds, rues = arêtes).
 * Tout en découle : géométrie des routes, îlots d'immeubles, et plus tard les
 * tracés de course, la ligne de l'IA et la mini-carte.
 * Aucune dépendance au rendu.
 */
export interface GraphNode {
  id: number;
  /** Indices dans la grille. */
  i: number;
  j: number;
  x: number;
  z: number;
  /** Demi-dimensions du carrefour (0 si aucune rue ne croise dans cette direction). */
  halfX: number;
  halfZ: number;
  edges: number[];
}

export interface GraphEdge {
  id: number;
  a: number;
  b: number;
  kind: RoadKind;
  width: number;
  /** Vrai si la rue est orientée est-ouest (le long de X). */
  alongX: boolean;
  /** Extrémités de la chaussée, raccourcies aux bords des carrefours. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  length: number;
}

export interface StreetGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  xs: number[];
  zs: number[];
  kindX: RoadKind[];
  kindZ: RoadKind[];
  /** Arête horizontale partant du nœud (i, j) vers (i+1, j), ou -1. */
  hEdge: number[][];
  /** Arête verticale partant du nœud (i, j) vers (i, j+1), ou -1. */
  vEdge: number[][];
  /** Indice (dans zs) de la ligne du boulevard qui porte l'autoroute. */
  boulevardJ: number;
}

function makeLines(rng: Rng, count: number, longGaps: number[]): number[] {
  const pos: number[] = [0];
  for (let i = 1; i < count; i++) {
    let gap = rng.range(WORLD.spacingMin, WORLD.spacingMax);
    if (longGaps.includes(i - 1)) gap = rng.range(98, 108);
    pos.push((pos[i - 1] as number) + gap);
  }
  const mid = ((pos[0] as number) + (pos[count - 1] as number)) / 2;
  return pos.map((p) => Math.round((p - mid) * 2) / 2);
}

function pickKind(rng: Rng): RoadKind {
  const r = rng.next();
  return r < 0.22 ? 'avenue' : r < 0.58 ? 'street' : 'alley';
}

export function generateStreetGraph(seed: number): StreetGraph {
  const rng = new Rng(seed);
  const nx = WORLD.linesX;
  const nz = WORLD.linesZ;
  // Les rampes d'autoroute ont besoin de deux longs tronçons sur le boulevard.
  const xs = makeLines(rng, nx, [1, nx - 3]);
  const zs = makeLines(rng, nz, []);
  const boulevardJ = Math.floor(nz / 2);

  const kindX: RoadKind[] = [];
  const kindZ: RoadKind[] = [];
  for (let i = 0; i < nx; i++) kindX.push(i === 0 || i === nx - 1 ? 'avenue' : pickKind(rng));
  for (let j = 0; j < nz; j++) kindZ.push(j === 0 || j === nz - 1 ? 'avenue' : j === boulevardJ ? 'boulevard' : pickKind(rng));
  // Garantit au moins une avenue nord-sud au centre pour traverser le quartier.
  kindX[Math.floor(nx / 2)] = 'avenue';
  // Pas de ruelle collée au boulevard : on veut de la place pour respirer.
  if (kindZ[boulevardJ - 1] === 'alley') kindZ[boulevardJ - 1] = 'street';

  const nodes: GraphNode[] = [];
  const nodeId = (i: number, j: number): number => j * nx + i;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      nodes.push({ id: nodeId(i, j), i, j, x: xs[i] as number, z: zs[j] as number, halfX: 0, halfZ: 0, edges: [] });
    }
  }

  interface RawEdge {
    a: number;
    b: number;
    kind: RoadKind;
    alongX: boolean;
    i: number;
    j: number;
    removed: boolean;
  }
  const raw: RawEdge[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (i < nx - 1) raw.push({ a: nodeId(i, j), b: nodeId(i + 1, j), kind: kindZ[j] as RoadKind, alongX: true, i, j, removed: false });
      if (j < nz - 1) raw.push({ a: nodeId(i, j), b: nodeId(i, j + 1), kind: kindX[i] as RoadKind, alongX: false, i, j, removed: false });
    }
  }

  // ——— Suppression de quelques petites rues, sans jamais couper le réseau ———
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
    const seen = new Uint8Array(nodes.length);
    const stack = [0];
    seen[0] = 1;
    let count = 1;
    while (stack.length) {
      const n = stack.pop() as number;
      for (const m of adj[n] as number[]) {
        if (!seen[m]) {
          seen[m] = 1;
          count++;
          stack.push(m);
        }
      }
    }
    return count === nodes.length;
  };
  for (const e of raw) {
    if (e.kind !== 'street' && e.kind !== 'alley') continue;
    if (!rng.chance(WORLD.removeEdgeChance)) continue;
    if ((degree[e.a] as number) <= 2 || (degree[e.b] as number) <= 2) continue;
    e.removed = true;
    if (connected()) {
      degree[e.a] = (degree[e.a] as number) - 1;
      degree[e.b] = (degree[e.b] as number) - 1;
    } else {
      e.removed = false;
    }
  }

  // ——— Taille des carrefours ———
  for (const e of raw) {
    if (e.removed) continue;
    const half = WORLD.roadWidth[e.kind] / 2;
    for (const id of [e.a, e.b]) {
      const n = nodes[id] as GraphNode;
      if (e.alongX) n.halfZ = Math.max(n.halfZ, half);
      else n.halfX = Math.max(n.halfX, half);
    }
  }

  // ——— Arêtes finales ———
  const edges: GraphEdge[] = [];
  const hEdge: number[][] = [];
  const vEdge: number[][] = [];
  for (let i = 0; i < nx; i++) {
    hEdge.push(new Array<number>(nz).fill(-1));
    vEdge.push(new Array<number>(nz).fill(-1));
  }
  for (const e of raw) {
    if (e.removed) continue;
    const a = nodes[e.a] as GraphNode;
    const b = nodes[e.b] as GraphNode;
    const id = edges.length;
    const edge: GraphEdge = {
      id,
      a: e.a,
      b: e.b,
      kind: e.kind,
      width: WORLD.roadWidth[e.kind],
      alongX: e.alongX,
      x0: e.alongX ? a.x + a.halfX : a.x,
      z0: e.alongX ? a.z : a.z + a.halfZ,
      x1: e.alongX ? b.x - b.halfX : b.x,
      z1: e.alongX ? b.z : b.z - b.halfZ,
      length: 0,
    };
    edge.length = e.alongX ? edge.x1 - edge.x0 : edge.z1 - edge.z0;
    edges.push(edge);
    a.edges.push(id);
    b.edges.push(id);
    if (e.alongX) (hEdge[e.i] as number[])[e.j] = id;
    else (vEdge[e.i] as number[])[e.j] = id;
  }

  return { nodes, edges, xs, zs, kindX, kindZ, hEdge, vEdge, boulevardJ };
}
