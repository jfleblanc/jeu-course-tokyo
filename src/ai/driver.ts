import { clamp } from '../core/math';
import type { AiLevel } from '../config/race';
import type { DriveInput } from '../input/actions';
import type { Route, RoutePoint } from '../race/route';
import type { Vehicle } from '../vehicle/vehicle';

/**
 * Pilote automatique : suit la ligne de course par « poursuite pure » (il vise un point
 * devant lui) et choisit sa vitesse d'après la courbure à venir. Aucune dépendance au rendu.
 */
/**
 * Temps estimé d'un pilote sur un tracé (s) : vitesses de passage en virage, puis une passe
 * avant (accélération) et une passe arrière (freinage). Sert de référence au contre-la-montre.
 */
export function estimateTime(route: Route, level: AiLevel, speedFactor: number, accel: number): number {
  const pts = route.points, n = pts.length;
  const top = (level.topSpeed / 3.6) * speedFactor;
  const v = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const c = (pts[k] as RoutePoint).curvature;
    v[k] = c > 0.0015 ? Math.min(top, Math.sqrt((level.cornerGrip * speedFactor) / c)) : top;
  }
  v[0] = Math.min(v[0] as number, 2);
  for (let k = 1; k < n; k++) {
    const d = (pts[k] as RoutePoint).s - (pts[k - 1] as RoutePoint).s;
    v[k] = Math.min(v[k] as number, Math.sqrt((v[k - 1] as number) ** 2 + 2 * accel * d));
  }
  for (let k = n - 2; k >= 0; k--) {
    const d = (pts[k + 1] as RoutePoint).s - (pts[k] as RoutePoint).s;
    v[k] = Math.min(v[k] as number, Math.sqrt((v[k + 1] as number) ** 2 + 2 * level.braking * d));
  }
  let t = 0;
  for (let k = 1; k < n; k++) t += ((pts[k] as RoutePoint).s - (pts[k - 1] as RoutePoint).s) / Math.max(1, ((v[k] as number) + (v[k - 1] as number)) / 2);
  return t;
}

/** `cornerFactor` : adhérence en plus dans les virages (1 = celle du pilote), pour un adversaire qui remonte. */
export function driveAlongRoute(car: Vehicle, route: Route, index: number, level: AiLevel, speedFactor: number, lateralOffset: number, out: DriveInput, cornerFactor = 1): void {
  const pts = route.points;
  const n = pts.length;
  const speed = Math.max(0, car.forwardSpeed);

  // — Direction : viser un point plus loin quand on va vite —
  const look = level.lookAhead + speed * 0.3;
  let target = pts[Math.min(n - 1, index)] as RoutePoint;
  for (let k = index; k < n; k++) {
    target = pts[k] as RoutePoint;
    if (target.s - (pts[Math.min(n - 1, index)] as RoutePoint).s >= look) break;
  }
  // Décalage latéral (pour ne pas rouler tous sur la même ligne) : gauche = (tz, −tx)
  const tx = target.x + target.tz * lateralOffset;
  const tz = target.z - target.tx * lateralOffset;
  let diff = Math.atan2(tx - car.pos.x, tz - car.pos.z) - car.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  out.steer = clamp(diff * 2.4, -1, 1);

  // — Vitesse : la plus contraignante des vitesses de passage à venir, compte tenu du freinage possible —
  const top = (level.topSpeed / 3.6) * speedFactor;
  let allowed = top;
  const here = (pts[Math.min(n - 1, index)] as RoutePoint).s;
  for (let k = index; k < n; k += 2) {
    const q = pts[k] as RoutePoint;
    const d = q.s - here;
    if (d > 150) break;
    const corner = q.curvature > 0.0015 ? Math.sqrt((level.cornerGrip * speedFactor * cornerFactor) / q.curvature) : top;
    const reachable = Math.sqrt(corner * corner + 2 * level.braking * cornerFactor * Math.max(0, d - 4));
    if (reachable < allowed) allowed = reachable;
  }
  const error = allowed - speed;
  if (error > 1) {
    out.throttle = clamp(error / 6, 0.25, 1);
    out.brake = 0;
  } else if (error < -1.5) {
    out.throttle = 0;
    out.brake = clamp(-error / 7, 0.2, 1);
  } else {
    out.throttle = 0.2;
    out.brake = 0;
  }
  // En gros dérapage ou très désaxé : on lève le pied.
  if (Math.abs(diff) > 0.9) out.throttle = Math.min(out.throttle, 0.3);
  out.drift = false;
  out.nos = false;
  out.shiftUp = false;
  out.shiftDown = false;
}
