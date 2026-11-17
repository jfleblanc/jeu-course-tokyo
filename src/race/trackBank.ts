import { RACE, TRACK_BANK } from '../config/race';
import type { StreetGraph } from '../world/streetGraph';
import { generateRoute, routeFromPath, type Route, type RoutePoint } from './route';

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
  route: Route;
  /** Position de la ligne de départ (là où se trouve la borne dans la ville). */
  start: RoutePoint;
}

/** `colRoad` : axe de la route du col (avec altitude), pour les courses de montagne. */
export function buildTrackBank(graph: StreetGraph, colRoad?: { samples: { x: number; y: number; z: number }[]; halfWidth: number }): Track[] {
  const tracks: Track[] = [];
  for (const def of TRACK_BANK) {
    const district = def.district ?? -1;
    if (district >= graph.districts.length) continue;
    let route: Route | null;
    if (def.col) {
      if (!colRoad) continue;
      route = routeFromPath(def.col > 0 ? colRoad.samples : [...colRoad.samples].reverse(), def.seed, colRoad.halfWidth);
    } else {
      route = def.circuit ? generateRoute(graph, def.seed, RACE.circuit.lapLength, RACE.circuit.laps, district) : generateRoute(graph, def.seed, RACE.targetLength, 1, district);
    }
    if (!route) continue;
    // Validation automatique : longueur plausible, assez de points de passage.
    const perLap = route.lapLength;
    if (perLap < 500 || route.checkpoints.length < 4) continue;
    const start = route.points[Math.round(RACE.startLine / 3)] as RoutePoint;
    // Deux bornes de départ ne doivent pas se chevaucher.
    if (tracks.some((t) => Math.hypot(t.start.x - start.x, t.start.z - start.z) < 40)) continue;
    tracks.push({ id: tracks.length, name: def.name, circuit: def.circuit, district, route, start });
  }
  return tracks;
}
