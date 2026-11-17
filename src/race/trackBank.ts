import { RACE, TRACK_BANK } from '../config/race';
import type { StreetGraph } from '../world/streetGraph';
import { generateRoute, type Route, type RoutePoint } from './route';

/**
 * Banque de tracés : générés une fois au démarrage à partir de graines fixes, donc identiques
 * à chaque partie. Chaque tracé a un point de départ dans la ville.
 */
export interface Track {
  id: number;
  name: string;
  circuit: boolean;
  route: Route;
  /** Position de la ligne de départ (là où se trouve la borne dans la ville). */
  start: RoutePoint;
}

export function buildTrackBank(graph: StreetGraph): Track[] {
  const tracks: Track[] = [];
  for (const def of TRACK_BANK) {
    const route = def.circuit ? generateRoute(graph, def.seed, RACE.circuit.lapLength, RACE.circuit.laps) : generateRoute(graph, def.seed);
    if (!route) continue;
    // Validation automatique : longueur plausible, assez de points de passage.
    const perLap = route.lapLength;
    if (perLap < 500 || route.checkpoints.length < 4) continue;
    const start = route.points[Math.round(RACE.startLine / 3)] as RoutePoint;
    // Deux bornes de départ ne doivent pas se chevaucher.
    if (tracks.some((t) => Math.hypot(t.start.x - start.x, t.start.z - start.z) < 40)) continue;
    tracks.push({ id: tracks.length, name: def.name, circuit: def.circuit, route, start });
  }
  return tracks;
}
