import { Rng } from '../core/rng';
import { STREET_PROPS } from '../config/props';
import type { CityData } from './cityGen';
import { GARAGE_BOUNDS, garageToLocal } from './garageSite';
import type { LampStriker } from './lampField';
import { pointAt, type PathPoint } from './streetGraph';

export const PROP_KINDS = ['cone', 'barriere', 'poubelle', 'panneau', 'carton'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** Un objet de rue : son pied (x, y, z), son orientation et son genre. */
export interface StreetProp { x: number; y: number; z: number; yaw: number; kind: PropKind; variant: number }

/** Sème les objets le long des rues : même graine, mêmes objets. */
export function generateStreetProps(city: CityData): StreetProp[] {
  const S = STREET_PROPS;
  const rng = new Rng(city.seed ^ 0x51c0de);
  const out: StreetProp[] = [];
  const p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  const free = (x: number, z: number): boolean => {
    for (const l of city.lamps) if (Math.abs(l.x - x) < 1.6 && Math.abs(l.z - z) < 1.6) return false;
    for (const c of city.connectors) for (let k = 0; k < c.pts.length; k += 2) if (Math.abs((c.pts[k] as number) - x) < 9 && Math.abs((c.pts[k + 1] as number) - z) < 9) return false;
    if (city.garage) {
      const [lx, lz] = garageToLocal(city.garage, x, z);
      if (lx > GARAGE_BOUNDS.x0 - 3 && lx < GARAGE_BOUNDS.x1 + 3 && lz > GARAGE_BOUNDS.z0 - 3 && lz < GARAGE_BOUNDS.z1 + 6) return false;
    }
    return true;
  };
  const put = (e: (typeof city.graph.edges)[number], s: number, side: number, off: number, kind: PropKind, y = 0, turn = 0): void => {
    pointAt(e, s, p);
    const nx = p.tz * side, nz = -p.tx * side;
    const x = p.x + nx * off, z = p.z + nz * off;
    if (!free(x, z)) return;
    out.push({ x, y, z, yaw: Math.atan2(p.tx, p.tz) + turn, kind, variant: rng.int(0, 3) });
  };
  for (const e of city.graph.edges) {
    const usable = e.length - e.trimA - e.trimB;
    if (usable < 26 || e.onRing) continue;
    const docks = city.graph.districts[e.district]?.theme === 'docks';
    const country = city.graph.districts[e.district]?.theme === 'collines';
    const walk = e.width / 2;
    // Poubelles sur le trottoir.
    const bins = country ? 0 : Math.round((usable / S.binEvery) * (0.5 + rng.next()));
    for (let k = 0; k < bins; k++) put(e, e.trimA + 4 + rng.next() * (usable - 8), rng.chance(0.5) ? 1 : -1, walk + 1.15, 'poubelle');
    // Panneau avant le carrefour.
    if (rng.chance(S.signShare)) put(e, e.length - e.trimB - 5, -1, walk + 0.75, 'panneau', 0, Math.PI);
    // Petit chantier : une barrière puis une file de cônes, sur le bord de la chaussée.
    if (e.kind !== 'alley' && !country && usable > 50 && rng.chance(S.worksShare)) {
      const side = rng.chance(0.5) ? 1 : -1;
      const s0 = e.trimA + 8 + rng.next() * (usable - 34);
      put(e, s0, side, walk - 0.75, 'barriere', 0, Math.PI / 2);
      for (let k = 1; k <= 4; k++) put(e, s0 + k * 2.6, side, walk - 0.55, 'cone');
      put(e, s0 + 13.4, side, walk - 0.75, 'barriere', 0, Math.PI / 2);
    }
    // Cartons : un tas contre le mur, surtout aux docks.
    if (!country && rng.chance(docks ? S.boxShareDocks : S.boxShare)) {
      const side = rng.chance(0.5) ? 1 : -1;
      const s0 = e.trimA + 5 + rng.next() * (usable - 12);
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        put(e, s0 + k * 0.72, side, walk + 1.3 + rng.next() * 0.25, 'carton', 0, rng.next() * 0.6);
        if (rng.chance(0.4)) put(e, s0 + k * 0.72, side, walk + 1.35, 'carton', 0.6, rng.next() * 0.6);
      }
    }
  }
  return out;
}

const STANDING = 0, FLYING = 1, LYING = 2;
const CELL = 12;

/** Objets de rue renversables : pas de moteur physique, des trajectoires calculées (comme les lampadaires). */
export class PropField {
  readonly state: Uint8Array;
  /** Par objet renversé : centre (x, y, z) et orientation (quaternion). */
  readonly pose: Float32Array;
  readonly dirty: number[] = [];
  /** Chocs du dernier pas : numéro de l'objet, vitesse de la voiture (vx, vz). */
  readonly events: number[] = [];
  private readonly vel: Float32Array;
  private readonly spin: Float32Array;
  private readonly grid = new Map<number, number[]>();
  private readonly active: number[] = [];
  private seed = 4242;

  constructor(readonly props: StreetProp[]) {
    const n = props.length;
    this.state = new Uint8Array(n);
    this.pose = new Float32Array(n * 7);
    this.vel = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 4);
    props.forEach((q, i) => {
      const k = Math.floor(q.x / CELL) * 100003 + Math.floor(q.z / CELL);
      const cell = this.grid.get(k);
      if (cell) cell.push(i); else this.grid.set(k, [i]);
    });
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, strikers: readonly LampStriker[], fx: number, fz: number): void {
    const S = STREET_PROPS;
    for (const c of strikers) {
      const speed = Math.hypot(c.vx, c.vz);
      if (speed < S.minSpeed) continue;
      const sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
      const cx = Math.floor(c.x / CELL), cz = Math.floor(c.z / CELL);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
        const cell = this.grid.get(i * 100003 + j);
        if (!cell) continue;
        for (const id of cell) {
          if (this.state[id] !== STANDING) continue;
          const q = this.props[id] as StreetProp;
          const K = S.kinds[q.kind];
          if (Math.abs(q.y - (c.y ?? 0)) > 2) continue;
          const dx = q.x - c.x, dz = q.z - c.z;
          const along = dx * sn + dz * cs, side = dx * cs - dz * sn;
          if (Math.abs(along) > 2.3 + K.radius || Math.abs(side) > 0.95 + K.radius) continue;
          this.knock(id, c, speed, side);
          c.slow(1 - K.slowdown);
        }
      }
    }
    const pose = this.pose, vel = this.vel, spin = this.spin;
    for (let n = this.active.length - 1; n >= 0; n--) {
      const id = this.active[n] as number;
      const q = this.props[id] as StreetProp;
      const K = S.kinds[q.kind];
      const p = id * 7, v = id * 3, s = id * 4;
      if (this.state[id] === FLYING) {
        vel[v + 1] = (vel[v + 1] as number) - 9.81 * 1.5 * dt;
        pose[p] = (pose[p] as number) + (vel[v] as number) * dt;
        pose[p + 1] = (pose[p + 1] as number) + (vel[v + 1] as number) * dt;
        pose[p + 2] = (pose[p + 2] as number) + (vel[v + 2] as number) * dt;
        const a = (spin[s + 3] as number) * dt, sh = Math.sin(a / 2), ch = Math.cos(a / 2);
        const ax = (spin[s] as number) * sh, ay = (spin[s + 1] as number) * sh, az = (spin[s + 2] as number) * sh;
        const qx = pose[p + 3] as number, qy = pose[p + 4] as number, qz = pose[p + 5] as number, qw = pose[p + 6] as number;
        pose[p + 3] = ch * qx + ax * qw + ay * qz - az * qy;
        pose[p + 4] = ch * qy + ay * qw + az * qx - ax * qz;
        pose[p + 5] = ch * qz + az * qw + ax * qy - ay * qx;
        pose[p + 6] = ch * qw - ax * qx - ay * qy - az * qz;
        const rest = K.radius + 0.03; // couché : son axe est à un rayon du sol
        if ((pose[p + 1] as number) < rest && (vel[v + 1] as number) < 0) {
          if ((vel[v + 1] as number) < -3.5) {
            // un rebond, puis il s'immobilise
            pose[p + 1] = rest;
            vel[v + 1] = -(vel[v + 1] as number) * 0.38;
            vel[v] = (vel[v] as number) * 0.6; vel[v + 2] = (vel[v + 2] as number) * 0.6;
            spin[s + 3] = (spin[s + 3] as number) * 0.6;
          } else {
            const h = Math.hypot(vel[v] as number, vel[v + 2] as number) || 1;
            const dx = (vel[v] as number) / h, dz = (vel[v + 2] as number) / h, k = Math.SQRT1_2;
            pose[p + 1] = rest;
            pose[p + 3] = dz * k; pose[p + 4] = 0; pose[p + 5] = -dx * k; pose[p + 6] = k;
            this.state[id] = LYING;
          }
        }
        this.dirty.push(id);
      } else if (Math.hypot(q.x - fx, q.z - fz) > S.respawnDistance) {
        this.state[id] = STANDING;
        this.dirty.push(id);
        this.active.splice(n, 1);
      }
    }
  }

  private knock(id: number, c: LampStriker, speed: number, side: number): void {
    const S = STREET_PROPS;
    const q = this.props[id] as StreetProp;
    const K = S.kinds[q.kind];
    const p = id * 7, v = id * 3, s = id * 4;
    this.state[id] = FLYING;
    this.pose[p] = q.x; this.pose[p + 1] = q.y + K.half; this.pose[p + 2] = q.z;
    this.pose[p + 3] = 0; this.pose[p + 4] = Math.sin(q.yaw / 2); this.pose[p + 5] = 0; this.pose[p + 6] = Math.cos(q.yaw / 2);
    const dirx = c.vx / speed, dirz = c.vz / speed;
    const out = (side >= 0 ? 1 : -1) * (0.2 + this.rand() * 0.5);
    const carry = S.carry * (0.7 + this.rand() * 0.5);
    this.vel[v] = (dirx + dirz * out) * speed * carry;
    this.vel[v + 1] = S.popUp * (0.6 + this.rand() * 0.8) + speed * 0.07;
    this.vel[v + 2] = (dirz - dirx * out) * speed * carry;
    // il culbute autour d'un axe horizontal, un peu de travers
    const tilt = (this.rand() - 0.5) * 0.8;
    const ax = dirz + dirx * tilt, az = -dirx + dirz * tilt, al = Math.hypot(ax, az) || 1;
    this.spin[s] = ax / al; this.spin[s + 1] = 0; this.spin[s + 2] = az / al;
    this.spin[s + 3] = 4 + this.rand() * 6 + speed * 0.15;
    this.active.push(id);
    this.dirty.push(id);
    this.events.push(id, c.vx, c.vz);
  }

  reset(): void {
    for (const id of this.active) { this.state[id] = STANDING; this.dirty.push(id); }
    this.active.length = 0;
  }
}
