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
  /** Altitude de la chaussée (m) ; absente = au niveau du sol. */
  y?: number;
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
  /** Carrefours traversés, dans l'ordre (sert à savoir quelles rues transversales barrer). */
  nodes: number[];
  /** Nombre de tours (1 = course d'un point à un autre). */
  laps: number;
  /** Nombre de points d'un tour ; les points sont répétés pour chaque tour. */
  lapPoints: number;
  lapLength: number;
  points: RoutePoint[];
  length: number;
  /** Indices des points de passage ; le dernier est l'arrivée. */
  checkpoints: number[];
  turns: RouteTurn[];
  /** Demi-largeur de la chaussée quand le tracé ne suit pas des rues (route du col). */
  halfWidth?: number;
  /** Pilotes agressifs sur ce tracé (voir AGGRESSIVE) : 0 ou absent = normaux, 1 = à fond. */
  aggression?: number;
}

const KIND_WEIGHT = { boulevard: 3, avenue: 3, street: 1.4, alley: 0.6 } as const;
const STEP = 3;

function walk(graph: StreetGraph, rng: Rng, target: number, district: number): { edges: number[]; forward: boolean[] } | null {
  // Départ sur une avenue assez longue pour la grille (pas sur le boulevard, encombré de piliers).
  const candidates = graph.edges.filter((e) => e.district === district && e.kind === 'avenue' && e.length - e.trimA - e.trimB > 90);
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

/** Rue suivante possible depuis un carrefour : pas de demi-tour, pas de carrefour déjà traversé. */
function optionsAt(graph: StreetGraph, cur: GraphEdge, forward: boolean, visited: Set<number>): { e: GraphEdge; fwd: boolean; cos: number }[] {
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  const nodeId = forward ? cur.b : cur.a;
  const node = graph.nodes[nodeId] as GraphNode;
  pointAt(cur, forward ? cur.length - 6 : 6, p);
  const inx = forward ? p.tx : -p.tx, inz = forward ? p.tz : -p.tz;
  const out: { e: GraphEdge; fwd: boolean; cos: number }[] = [];
  for (const eid of node.edges) {
    if (eid === cur.id) continue;
    const e = graph.edges[eid] as GraphEdge;
    const fwd = e.a === nodeId;
    if (visited.has(fwd ? e.b : e.a)) continue;
    // Un tracé reste dans son secteur (ville principale ou quartier).
    if (e.district !== cur.district) continue;
    pointAt(e, fwd ? 6 : e.length - 6, p);
    const cos = inx * (fwd ? p.tx : -p.tx) + inz * (fwd ? p.tz : -p.tz);
    if (cos < -0.35) continue;
    out.push({ e, fwd, cos });
  }
  return out;
}

/**
 * Circuit fermé : on part du milieu d'une avenue, on s'éloigne au hasard sur la moitié de la
 * longueur visée, puis on revient au point de départ par le plus court chemin encore libre.
 */
function walkLoop(graph: StreetGraph, rng: Rng, target: number, district: number): { edges: number[]; forward: boolean[] } | null {
  const candidates = graph.edges.filter((e) => e.district === district && e.kind === 'avenue' && !e.onRing && e.length - e.trimA - e.trimB > 90);
  if (candidates.length === 0) return null;
  const first = rng.pick(candidates);
  let forward = rng.chance(0.5);
  const startNode = forward ? first.a : first.b;
  const edges = [first.id];
  const dirs = [forward];
  const visited = new Set<number>([forward ? first.b : first.a, startNode]);
  let length = first.length;
  let cur: GraphEdge = first;
  while (length < target * 0.5) {
    const opts = optionsAt(graph, cur, forward, visited);
    if (opts.length === 0) return null;
    let total = 0;
    const weights = opts.map((o) => KIND_WEIGHT[o.e.kind] * (o.cos > 0.9 ? 0.8 : 1.3));
    for (const w of weights) total += w;
    let r = rng.next() * total;
    let pick = 0;
    for (let k = 0; k < opts.length; k++) {
      r -= weights[k] as number;
      if (r <= 0) {
        pick = k;
        break;
      }
    }
    const chosen = opts[pick] as (typeof opts)[number];
    cur = chosen.e;
    forward = chosen.fwd;
    visited.add(forward ? cur.b : cur.a);
    edges.push(cur.id);
    dirs.push(forward);
    length += cur.length;
  }
  // Retour : plus court chemin vers le carrefour de départ, sans repasser par un carrefour déjà pris.
  visited.delete(startNode);
  const from = forward ? cur.b : cur.a;
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, { edge: GraphEdge; fwd: boolean; node: number }>();
  const open = new Set<number>([from]);
  while (open.size) {
    let best = -1, bd = Infinity;
    for (const id of open) {
      const d = dist.get(id) as number;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    open.delete(best);
    if (best === startNode) break;
    for (const eid of (graph.nodes[best] as GraphNode).edges) {
      const e = graph.edges[eid] as GraphEdge;
      if (eid === first.id || (best === from && eid === cur.id)) continue;
      const fwd = e.a === best;
      const other = fwd ? e.b : e.a;
      if (visited.has(other) && other !== startNode) continue;
      if (other === from) continue;
      // Les petites rues coûtent un peu plus cher : le retour préfère les grands axes.
      const nd = bd + e.length * (e.kind === 'alley' ? 1.5 : e.kind === 'street' ? 1.15 : 1);
      if (nd < (dist.get(other) ?? Infinity)) {
        dist.set(other, nd);
        prev.set(other, { edge: e, fwd, node: best });
        open.add(other);
      }
    }
  }
  if (!prev.has(startNode)) return null;
  const back: { edge: GraphEdge; fwd: boolean }[] = [];
  let at = startNode;
  while (at !== from) {
    const step = prev.get(at);
    if (!step) return null;
    back.unshift({ edge: step.edge, fwd: step.fwd });
    at = step.node;
  }
  for (const b of back) {
    edges.push(b.edge.id);
    dirs.push(b.fwd);
    length += b.edge.length;
  }
  if (length < target * 0.8 || length > target * 1.3) return null;
  // Aucun virage en épingle sur le retour, ni en revenant sur la rue de départ.
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  for (let k = 0; k < edges.length; k++) {
    const a = graph.edges[edges[k] as number] as GraphEdge, af = dirs[k] as boolean;
    const b = graph.edges[edges[(k + 1) % edges.length] as number] as GraphEdge, bf = dirs[(k + 1) % edges.length] as boolean;
    pointAt(a, af ? a.length - 6 : 6, p);
    const ax = af ? p.tx : -p.tx, az = af ? p.tz : -p.tz;
    pointAt(b, bf ? 6 : b.length - 6, p);
    if (ax * (bf ? p.tx : -p.tx) + az * (bf ? p.tz : -p.tz) < -0.35) return null;
  }
  return { edges, forward: dirs };
}

/**
 * Génère un tracé. Avec `laps` > 1, c'est un circuit fermé de `target` mètres par tour.
 * Renvoie null seulement si le réseau ne permet vraiment aucun parcours.
 */
/** `district` : −1 = ville principale, sinon le numéro du quartier où tracer la course. */
export function generateRoute(graph: StreetGraph, seed: number, target: number = RACE.targetLength, laps = 1, district = -1): Route | null {
  const closed = laps > 1;
  let found: { edges: number[]; forward: boolean[] } | null = null;
  let used = seed;
  for (let attempt = 0; attempt < 300 && !found; attempt++) {
    used = seed + attempt * 7919;
    found = closed ? walkLoop(graph, new Rng(used), target, district) : walk(graph, new Rng(used), target, district);
  }
  if (!found) return null;

  // 1. Axe des rues, bout à bout (les carrefours sont traversés en ligne droite).
  const raw: number[] = [];
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  found.edges.forEach((eid, k) => {
    const e = graph.edges[eid] as GraphEdge;
    const fwd = found.forward[k] as boolean;
    const last = k === found.edges.length - 1;
    // Circuit : on part du milieu de la première rue. Sinon : la dernière rue s'arrête en son milieu (arrivée).
    const from = closed && k === 0 ? e.length / 2 : fwd ? e.trimA : e.length - e.trimB;
    const to = !closed && last ? e.length / 2 : fwd ? e.length - e.trimB : e.trimA;
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
  if (closed) {
    // Fin du tour : on revient sur la première rue, jusqu'à son milieu.
    const e = graph.edges[found.edges[0] as number] as GraphEdge;
    const fwd = found.forward[0] as boolean;
    const from = fwd ? e.trimA : e.length - e.trimB;
    const steps = Math.max(1, Math.round(Math.abs(e.length / 2 - from) / 4));
    for (let q = 0; q <= steps; q++) {
      pointAt(e, from + ((e.length / 2 - from) * q) / steps, p);
      raw.push(p.x, p.z);
    }
  }
  const nodes: number[] = found.edges.map((eid, k) => {
    const e = graph.edges[eid] as GraphEdge;
    return (found.forward[k] as boolean) ? e.b : e.a;
  });
  return finishRoute(raw, found.edges, nodes, laps, used);
}

/**
 * Tracé à partir d'une route hors du réseau de rues (le col de montagne) : `path` = points de l'axe
 * avec leur altitude. Pas de rues transversales à barrer, pas de circulation.
 */
export function routeFromPath(path: { x: number; y: number; z: number }[], seed: number, halfWidth: number): Route {
  const raw: number[] = [];
  for (const p of path) raw.push(p.x, p.z);
  const route = finishRoute(raw, [], [], 1, seed, 2);
  // Altitude : celle du point d'axe le plus proche (on avance en même temps sur les deux listes).
  let k = 0;
  for (const q of route.points) {
    while (k < path.length - 1 && Math.hypot((path[k + 1] as { x: number }).x - q.x, (path[k + 1] as { z: number }).z - q.z) <= Math.hypot((path[k] as { x: number }).x - q.x, (path[k] as { z: number }).z - q.z)) k++;
    q.y = (path[k] as { y: number }).y;
  }
  route.halfWidth = halfWidth;
  return route;
}

function finishRoute(raw: number[], edges: number[], nodes: number[], laps: number, used: number, smoothing = 14): Route {
  const closed = laps > 1;
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
  for (let pass = 0; pass < smoothing; pass++) {
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
  // 6. Circuit : on répète les points, les points de passage et les virages pour chaque tour.
  const lapPoints = n;
  if (closed) {
    const lapCheckpoints = checkpoints.slice();
    const lapTurns = turns.slice();
    for (let lap = 1; lap < laps; lap++) {
      const off = points.length;
      const sOff = length * lap;
      for (let q = 0; q < n; q++) {
        const src = points[q] as RoutePoint;
        points.push({ ...src, s: src.s + sOff });
      }
      for (const c of lapCheckpoints) checkpoints.push(c + off);
      for (const t of lapTurns) turns.push({ index: t.index + off, s: t.s + sOff, angle: t.angle });
    }
  }
  return { seed: used, edges, nodes, laps: closed ? laps : 1, lapPoints, lapLength: length, points, length: length * (closed ? laps : 1), checkpoints, turns };
}
