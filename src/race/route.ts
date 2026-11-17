import { Rng } from '../core/rng';
import { RACE } from '../config/race';
import { pointAt, type GraphEdge, type GraphNode, type PathPoint, type StreetGraph } from '../world/streetGraph';

/**
 * Tracé de course généré à partir du réseau de rues : une suite de rues sans demi-tour,
 * qui privilégie les grands axes, d'une longueur visée. Aucune dépendance au rendu.
 */
export interface RoutePoint {
  x: number;
  z: number;
  /** Tangente normalisée. */
  tx: number;
  tz: number;
  /** Distance depuis le début du tracé (m). */
  s: number;
  /** Courbure (1/m) : sert à calculer la vitesse de passage. */
  curvature: number;
}

export interface RouteTurn {
  /** Indice du point au sommet du virage. */
  index: number;
  s: number;
  /** Changement de cap (rad), positif = à gauche. */
  angle: number;
}

export interface Route {
  seed: number;
  edges: number[];
  points: RoutePoint[];
  length: number;
  /** Indices des points de passage ; le dernier est l'arrivée. */
  checkpoints: number[];
  turns: RouteTurn[];
}

const KIND_WEIGHT = { boulevard: 3, avenue: 3, street: 1.4, alley: 0.6 } as const;
const STEP = 3;

function walk(graph: StreetGraph, rng: Rng, target: number): { edges: number[]; forward: boolean[] } | null {
  // Départ sur une avenue assez longue pour la grille (pas sur le boulevard, encombré de piliers).
  const candidates = graph.edges.filter((e) => e.kind === 'avenue' && e.length - e.trimA - e.trimB > 90);
  if (candidates.length === 0) return null;
  const first = rng.pick(candidates);
  let forward = rng.chance(0.5);
  const edges = [first.id];
  const dirs = [forward];
  const visited = new Set<number>([forward ? first.a : first.b]);
  let length = first.length;
  let cur: GraphEdge = first;
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  while (length < target) {
    const nodeId = forward ? cur.b : cur.a;
    visited.add(nodeId);
    const node = graph.nodes[nodeId] as GraphNode;
    // Direction d'arrivée au carrefour
    pointAt(cur, forward ? cur.length - 6 : 6, p);
    const inx = forward ? p.tx : -p.tx, inz = forward ? p.tz : -p.tz;
    const options: { e: GraphEdge; fwd: boolean; w: number }[] = [];
    for (const eid of node.edges) {
      if (eid === cur.id) continue;
      const e = graph.edges[eid] as GraphEdge;
      const fwd = e.a === nodeId;
      const other = fwd ? e.b : e.a;
      if (visited.has(other)) continue;
      pointAt(e, fwd ? 6 : e.length - 6, p);
      const ox = fwd ? p.tx : -p.tx, oz = fwd ? p.tz : -p.tz;
      const cos = inx * ox + inz * oz;
      if (cos < -0.35) continue; // pas de demi-tour ni d'épingle trop serrée
      // On aime les grands axes, et un peu plus les virages que la ligne droite (sinon c'est monotone).
      const turnBonus = cos > 0.9 ? 0.8 : 1.3;
      options.push({ e, fwd, w: KIND_WEIGHT[e.kind] * turnBonus });
    }
    if (options.length === 0) return null;
    let total = 0;
    for (const o of options) total += o.w;
    let r = rng.next() * total;
    let chosen = options[0] as (typeof options)[number];
    for (const o of options) {
      r -= o.w;
      if (r <= 0) {
        chosen = o;
        break;
      }
    }
    cur = chosen.e;
    forward = chosen.fwd;
    edges.push(cur.id);
    dirs.push(forward);
    length += cur.length;
  }
  return { edges, forward: dirs };
}

/** Génère un tracé. Renvoie null seulement si le réseau ne permet vraiment aucun parcours. */
export function generateRoute(graph: StreetGraph, seed: number, target: number = RACE.targetLength): Route | null {
  let found: { edges: number[]; forward: boolean[] } | null = null;
  let used = seed;
  for (let attempt = 0; attempt < 300 && !found; attempt++) {
    used = seed + attempt * 7919;
    found = walk(graph, new Rng(used), target);
  }
  if (!found) return null;

  // 1. Axe des rues, bout à bout (les carrefours sont traversés en ligne droite).
  const raw: number[] = [];
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  found.edges.forEach((eid, k) => {
    const e = graph.edges[eid] as GraphEdge;
    const fwd = found.forward[k] as boolean;
    const last = k === found.edges.length - 1;
    const from = fwd ? e.trimA : e.length - e.trimB;
    // La dernière rue s'arrête en son milieu : c'est l'arrivée.
    const to = last ? e.length / 2 : fwd ? e.length - e.trimB : e.trimA;
    const span = Math.abs(to - from);
    const steps = Math.max(1, Math.round(span / 4));
    // Sur le boulevard, le milieu est occupé par les piliers de l'autoroute :
    // la ligne de course passe sur la chaussée de gauche (dans le sens de la marche).
    const side = e.kind === 'boulevard' ? 9.5 : 0;
    for (let q = 0; q <= steps; q++) {
      pointAt(e, from + ((to - from) * q) / steps, p);
      const dx = fwd ? p.tx : -p.tx, dz = fwd ? p.tz : -p.tz;
      raw.push(p.x + dz * side, p.z - dx * side);
    }
  });
  // 2. Rééchantillonnage régulier puis lissage : les angles des carrefours deviennent des courbes.
  const resample = (pts: number[]): number[] => {
    const out: number[] = [pts[0] as number, pts[1] as number];
    let carry = 0;
    for (let k = 2; k < pts.length; k += 2) {
      const ax = pts[k - 2] as number, az = pts[k - 1] as number, bx = pts[k] as number, bz = pts[k + 1] as number;
      const len = Math.hypot(bx - ax, bz - az);
      let d = STEP - carry;
      while (d <= len) {
        out.push(ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len);
        d += STEP;
      }
      carry = len - (d - STEP);
    }
    return out;
  };
  let pts = resample(raw);
  for (let pass = 0; pass < 14; pass++) {
    const next = pts.slice();
    for (let k = 2; k < pts.length - 2; k += 2) {
      next[k] = ((pts[k - 2] as number) + 2 * (pts[k] as number) + (pts[k + 2] as number)) / 4;
      next[k + 1] = ((pts[k - 1] as number) + 2 * (pts[k + 1] as number) + (pts[k + 3] as number)) / 4;
    }
    pts = next;
  }
  pts = resample(pts);

  // 3. Tangentes, distances, courbure.
  const n = pts.length / 2;
  const points: RoutePoint[] = [];
  let s = 0;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    let tx = (pts[b * 2] as number) - (pts[a * 2] as number), tz = (pts[b * 2 + 1] as number) - (pts[a * 2 + 1] as number);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    if (k > 0) s += Math.hypot((pts[k * 2] as number) - (pts[k * 2 - 2] as number), (pts[k * 2 + 1] as number) - (pts[k * 2 - 1] as number));
    points.push({ x: pts[k * 2] as number, z: pts[k * 2 + 1] as number, tx, tz, s, curvature: 0 });
  }
  const heading = (k: number): number => {
    const q = points[Math.max(0, Math.min(n - 1, k))] as RoutePoint;
    return Math.atan2(q.tx, q.tz);
  };
  const delta = (a: number, b: number): number => {
    const d = b - a;
    return Math.atan2(Math.sin(d), Math.cos(d));
  };
  for (let k = 0; k < n; k++) {
    const span = 3;
    (points[k] as RoutePoint).curvature = Math.abs(delta(heading(k - span), heading(k + span))) / (2 * span * STEP);
  }

  // 4. Points de passage réguliers ; le dernier point est l'arrivée.
  const length = (points[n - 1] as RoutePoint).s;
  const checkpoints: number[] = [];
  const count = Math.max(2, Math.round((length - RACE.startLine) / RACE.checkpointSpacing));
  for (let k = 1; k <= count; k++) {
    const at = RACE.startLine + ((length - RACE.startLine) * k) / count;
    let idx = Math.min(n - 1, Math.round(at / STEP));
    if (k === count) idx = n - 1;
    checkpoints.push(idx);
  }

  // 5. Virages marqués : là où le cap change beaucoup en peu de distance.
  const turns: RouteTurn[] = [];
  const win = Math.round(24 / STEP);
  const threshold = (RACE.turnAngleDeg * Math.PI) / 180;
  let k = win;
  while (k < n - win) {
    const ang = delta(heading(k - win), heading(k + win));
    if (Math.abs(ang) > threshold) {
      // Cherche le sommet (changement de cap maximal) dans le voisinage.
      let best = k, bestAng = ang;
      for (let q = k; q < Math.min(n - win, k + win * 2); q++) {
        const a2 = delta(heading(q - win), heading(q + win));
        if (Math.abs(a2) > Math.abs(bestAng)) {
          bestAng = a2;
          best = q;
        }
      }
      turns.push({ index: best, s: (points[best] as RoutePoint).s, angle: bestAng });
      k = best + win * 2;
    } else {
      k++;
    }
  }
  return { seed: used, edges: found.edges, points, length, checkpoints, turns };
}
