import { Rng } from '../core/rng';
import { DELIVERIES } from '../config/missions';
import { graphPath } from '../race/route';
import type { GraphEdge, GraphNode, StreetGraph } from './streetGraph';

/** Une mission de livraison : du point A au point B, par les rues qu'on veut. */
export interface Delivery {
  id: number;
  name: string;
  from: { x: number; z: number; node: number };
  to: { x: number; z: number; node: number };
  /** Longueur du trajet conseillé (m) et quartiers touchés (−1 = ville principale). */
  length: number;
  districts: number[];
  /** Temps des médailles (s) : or, argent, bronze. */
  medals: [number, number, number];
}

/** Longueur d'un chemin dans le réseau (m), ou −1 s'il n'y en a pas. */
function pathLength(graph: StreetGraph, a: number, b: number): number {
  const p = graphPath(graph, a, b);
  if (!p) return -1;
  let len = 0;
  for (const e of p.edges) len += (graph.edges[e] as GraphEdge).length;
  return len;
}

/** Les missions de la ville : toujours les mêmes pour une même graine. */
export function buildDeliveries(graph: StreetGraph, seed: number): Delivery[] {
  const D = DELIVERIES;
  const rng = new Rng(seed ^ 0xc0115);
  const nodes = graph.nodes.filter((n) => n.edges.length >= 2);
  const out: Delivery[] = [];
  const used = new Set<number>();
  // La moitié des missions restent dans la ville principale : un nouveau joueur en a assez pour varier.
  const city = nodes.filter((n) => n.district < 0);
  for (let tries = 0; tries < 900 && out.length < D.names.length; tries++) {
    const pool = out.length < D.names.length / 2 && city.length > 4 ? city : nodes;
    const a = pool[rng.int(0, pool.length - 1)] as GraphNode, b = pool[rng.int(0, pool.length - 1)] as GraphNode;
    if (a.id === b.id || used.has(a.id) || used.has(b.id)) continue;
    const crow = Math.hypot(a.x - b.x, a.z - b.z);
    if (crow < D.minDistance * 0.6 || crow > D.maxDistance) continue;
    const length = pathLength(graph, a.id, b.id);
    if (length < D.minDistance || length > D.maxDistance) continue;
    used.add(a.id); used.add(b.id);
    out.push({
      id: out.length,
      name: D.names[out.length] as string,
      from: { x: a.x, z: a.z, node: a.id },
      to: { x: b.x, z: b.z, node: b.id },
      length,
      districts: [...new Set([a.district, b.district])],
      medals: [length / D.goldSpeed, length / D.silverSpeed, length / D.bronzeSpeed],
    });
  }
  return out;
}

export type DeliveryEvent = { type: 'pris'; mission: Delivery } | { type: 'livre'; mission: Delivery; time: number; place: number } | { type: 'abandon'; mission: Delivery };

/**
 * Les colis sur la carte : lesquels sont proposés, lequel est en cours de livraison, le chrono.
 * Les colis proposés changent d'endroit de temps en temps (un autre de la liste prend la place).
 */
export class Deliveries {
  /** Missions proposées en ce moment (indices dans `bank`). */
  readonly offered: number[] = [];
  /** Livraison en cours. */
  current: Delivery | null = null;
  time = 0;
  /** Chemin conseillé vers l'arrivée (x, z, x, z…), recalculé de temps en temps. */
  guide: number[] = [];
  readonly events: DeliveryEvent[] = [];
  private readonly timers: number[] = [];
  private guideTimer = 0;
  /** Change à chaque fois que la liste des colis proposés bouge (pour redessiner). */
  generation = 0;

  constructor(readonly bank: Delivery[], private readonly graph: StreetGraph, private readonly isOpen: (district: number) => boolean) {}

  private available(m: Delivery): boolean {
    return m.districts.every((d) => this.isOpen(d));
  }

  /** Tire une mission libre au hasard (ni proposée, ni en cours). */
  private draw(): number {
    const free = this.bank.filter((m) => this.available(m) && !this.offered.includes(m.id) && m !== this.current);
    return free.length ? (free[Math.floor(Math.random() * free.length)] as Delivery).id : -1;
  }

  /** Mission proposée dont le cercle de départ contient ce point (ou null). */
  pickupAt(x: number, z: number): Delivery | null {
    if (this.current) return null;
    for (const id of this.offered) {
      const m = this.bank[id] as Delivery;
      if (Math.hypot(m.from.x - x, m.from.z - z) < DELIVERIES.radius) return m;
    }
    return null;
  }

  accept(m: Delivery): void {
    const k = this.offered.indexOf(m.id);
    if (k < 0 || this.current) return;
    this.offered.splice(k, 1);
    this.timers.splice(k, 1);
    this.current = m;
    this.time = 0;
    this.guideTimer = 0;
    this.generation++;
    this.events.push({ type: 'pris', mission: m });
  }

  cancel(): void {
    if (!this.current) return;
    this.events.push({ type: 'abandon', mission: this.current });
    this.current = null;
    this.guide.length = 0;
    this.generation++;
  }

  /** `running` : le chrono tourne (pas de menu ouvert). */
  update(dt: number, x: number, z: number, running: boolean): void {
    const D = DELIVERIES;
    // Garder le bon nombre de colis sur la carte ; déplacer ceux qui attendent depuis trop longtemps.
    for (let k = this.offered.length - 1; k >= 0; k--) {
      this.timers[k] = (this.timers[k] as number) - dt;
      const m = this.bank[this.offered[k] as number] as Delivery;
      const near = Math.hypot(m.from.x - x, m.from.z - z) < 120; // pas sous le nez du joueur
      if (!this.available(m) || ((this.timers[k] as number) <= 0 && !near)) {
        this.offered.splice(k, 1);
        this.timers.splice(k, 1);
        this.generation++;
      }
    }
    while (this.offered.length < D.active) {
      const id = this.draw();
      if (id < 0) break;
      this.offered.push(id);
      this.timers.push(D.moveSeconds * (0.6 + Math.random() * 0.8));
      this.generation++;
    }
    const m = this.current;
    if (!m) return;
    if (running) this.time += dt;
    if (Math.hypot(m.to.x - x, m.to.z - z) < D.goalRadius) {
      const t = this.time;
      const place = t <= m.medals[0] ? 1 : t <= m.medals[1] ? 2 : t <= m.medals[2] ? 3 : 4;
      this.events.push({ type: 'livre', mission: m, time: t, place });
      this.current = null;
      this.guide.length = 0;
      this.generation++;
      return;
    }
    // Chemin conseillé : du carrefour le plus proche jusqu'à l'arrivée.
    this.guideTimer -= dt;
    if (this.guideTimer <= 0) {
      this.guideTimer = 1.2;
      guidePath(this.graph, x, z, m.to.node, this.guide);
    }
  }
}

/** Chemin par les rues depuis (x, z) jusqu'à un carrefour : rempli dans `out` (x, z, x, z…), vide s'il n'y en a pas. */
export function guidePath(graph: StreetGraph, x: number, z: number, toNode: number, out: number[]): void {
  out.length = 0;
  let best = -1, bd = Infinity;
  for (const n of graph.nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n.id; }
  }
  const p = best >= 0 ? graphPath(graph, best, toNode) : null;
  if (!p) return;
  out.push(x, z);
  let node = best;
  const first = graph.nodes[best] as GraphNode;
  out.push(first.x, first.z);
  for (const eid of p.edges) {
    const e = graph.edges[eid] as GraphEdge;
    const fwd = e.a === node;
    // on suit le tracé de la rue (elle peut tourner)
    const n = e.pts.length / 2;
    for (let k = 1; k < n; k++) {
      const q = fwd ? k : n - 1 - k;
      out.push(e.pts[q * 2] as number, e.pts[q * 2 + 1] as number);
    }
    node = fwd ? e.b : e.a;
  }
}

/** Carrefour le plus proche d'un point. */
export function nearestNode(graph: StreetGraph, x: number, z: number): number {
  let best = -1, bd = Infinity;
  for (const n of graph.nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}
