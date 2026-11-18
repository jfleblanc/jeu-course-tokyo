import { RACE, TRACK_BANK } from '../config/race';
import type { StreetGraph } from '../world/streetGraph';
import { generateRoute, graphPath, routeFromLegs, routeFromPath, type Route, type RouteLeg, type RoutePoint } from './route';

/**
 * Banque de tracés : générés une fois au démarrage à partir de graines fixes, donc identiques
 * à chaque partie. Chaque tracé a un point de départ dans la ville.
 */
export interface Track {
  id: number;
  name: string;
  circuit: boolean;
  /** Secteur : −1 = ville principale, sinon numéro du quartier (il faut l'avoir débloqué). */
  district: number;
  /** Grande course : tous les quartiers traversés. */
  also?: number[];
  route: Route;
  /** Position de la ligne de départ (là où se trouve la borne dans la ville). */
  start: RoutePoint;
}

type LinkRoad = { name: string; nodeA: number; nodeB: number; road: { samples: { x: number; y: number; z: number }[] } };

/** Enchaîne des liaisons : rues d'approche, liaison, traversée du quartier commun, liaison suivante, rues d'arrivée. */
function regionRoute(graph: StreetGraph, via: (LinkRoad | undefined)[], seed: number): { route: Route; districts: number[] } | null {
  if (via.length === 0 || via.some((l) => !l)) return null;
  const list = via as LinkRoad[];
  const districtOf = (n: number): number => (graph.nodes[n] as { district: number }).district;
  // Sens de chaque liaison : on en sort par le bout qui touche le quartier de la suivante.
  const rev: boolean[] = list.map((l, k) => {
    const next = list[k + 1], before = list[k - 1];
    if (next) return [districtOf(next.nodeA), districtOf(next.nodeB)].includes(districtOf(l.nodeA));
    if (before) return ![districtOf(before.nodeA), districtOf(before.nodeB)].includes(districtOf(l.nodeA));
    return false;
  });
  const enter = (k: number): number => (rev[k] ? (list[k] as LinkRoad).nodeB : (list[k] as LinkRoad).nodeA);
  const leave = (k: number): number => (rev[k] ? (list[k] as LinkRoad).nodeA : (list[k] as LinkRoad).nodeB);
  const legs: RouteLeg[] = [];
  const districts: number[] = [districtOf(enter(0))];
  // Approche : quelques rues du quartier de départ, jusqu'au pied de la première liaison.
  const lead = graphPath(graph, enter(0), (_n, d) => d > 260, districtOf(enter(0)));
  if (!lead) return null;
  legs.push({ edges: [...lead.edges].reverse(), forward: [...lead.forward].reverse().map((f) => !f) });
  for (let k = 0; k < list.length; k++) {
    const s = (list[k] as LinkRoad).road.samples;
    legs.push({ path: rev[k] ? [...s].reverse() : s });
    districts.push(districtOf(leave(k)));
    if (k < list.length - 1) {
      const across = graphPath(graph, leave(k), enter(k + 1), districtOf(leave(k)));
      if (!across) return null;
      legs.push(across);
    }
  }
  const out = graphPath(graph, leave(list.length - 1), (_n, d) => d > 260, districtOf(leave(list.length - 1)));
  if (!out) return null;
  legs.push(out);
  return { route: routeFromLegs(graph, legs, seed), districts };
}

/** `colRoad` : axe de la route du col ; `links` : liaisons entre quartiers, pour les grandes courses. */
export function buildTrackBank(graph: StreetGraph, colRoad?: { samples: { x: number; y: number; z: number }[]; halfWidth: number }, links: LinkRoad[] = []): Track[] {
  const tracks: Track[] = [];
  for (const def of TRACK_BANK) {
    let district = def.district ?? -1;
    if (district >= graph.districts.length) continue;
    let route: Route | null;
    let also: number[] | undefined;
    if (def.via) {
      const built = regionRoute(graph, def.via.map((n) => links.find((l) => l.name === n)), def.seed);
      if (!built) continue;
      route = built.route;
      also = built.districts;
      route.aggression = 0.5;
    } else if (def.col) {
      if (!colRoad) continue;
      route = routeFromPath(def.col > 0 ? colRoad.samples : [...colRoad.samples].reverse(), def.seed, colRoad.halfWidth);
      route.aggression = 1;
    } else {
      route = def.circuit ? generateRoute(graph, def.seed, RACE.circuit.lapLength, RACE.circuit.laps, district) : generateRoute(graph, def.seed, RACE.targetLength, 1, district);
    }
    if (!route) continue;
    // Validation automatique : longueur plausible, assez de points de passage.
    const perLap = route.lapLength;
    if (perLap < 500 || route.checkpoints.length < 4) continue;
    // (grande course : ouverte quand son quartier le plus tardif l'est)
    if (also) district = also.reduce((m, d) => ((graph.districts[d]?.unlockLevel ?? 0) > (graph.districts[m]?.unlockLevel ?? 0) ? d : m), also[0] as number);
    const start = route.points[Math.round(RACE.startLine / 3)] as RoutePoint;
    // Deux bornes de départ ne doivent pas se chevaucher.
    if (tracks.some((t) => Math.hypot(t.start.x - start.x, t.start.z - start.z) < 40)) continue;
    tracks.push({ id: tracks.length, name: def.name, circuit: def.circuit, district, also, route, start });
  }
  return tracks;
}
