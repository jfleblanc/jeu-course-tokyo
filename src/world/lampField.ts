import { LAMPS } from '../config/props';
import type { Lamp } from './cityGen';

/** Ce qu'il faut savoir d'une voiture pour savoir si elle fauche un lampadaire. */
export interface LampStriker {
  x: number; z: number; yaw: number; vx: number; vz: number;
  /** Appelé quand la voiture renverse un lampadaire : `keep` = part de vitesse conservée. */
  slow(keep: number): void;
}

const STANDING = 0, FLYING = 1, LYING = 2;
const CELL = 12;

/**
 * Lampadaires renversables. Ils n'ont pas de collision : quand une voiture passe dessus assez
 * vite, le lampadaire s'envole en tournoyant (trajectoire calculée ici, sans moteur physique),
 * retombe couché, et la voiture perd un tout petit peu de vitesse. Il se redresse quand le joueur
 * est loin. La logique ne dépend pas du rendu : `src/render/lampVisuals.ts` lit l'état.
 */
export class LampField {
  readonly count: number;
  readonly state: Uint8Array;
  /** Centre de gravité (x, y, z) et orientation (quaternion x, y, z, w) de chaque lampadaire renversé. */
  readonly pose: Float32Array;
  /** Indices dont l'affichage doit être rafraîchi (vidé par le rendu). */
  readonly dirty: number[] = [];
  /** Nombre de lampadaires fauchés depuis le début (pour le son, les essais). */
  knocked = 0;
  private readonly vel: Float32Array;
  private readonly spin: Float32Array;
  private readonly grid = new Map<number, number[]>();
  private readonly active: number[] = [];
  private seed = 1;

  constructor(readonly lamps: Lamp[]) {
    this.count = lamps.length;
    this.state = new Uint8Array(this.count);
    this.pose = new Float32Array(this.count * 7);
    this.vel = new Float32Array(this.count * 3);
    this.spin = new Float32Array(this.count * 4);
    lamps.forEach((l, i) => {
      const k = this.key(l.x, l.z);
      const cell = this.grid.get(k);
      if (cell) cell.push(i); else this.grid.set(k, [i]);
    });
  }

  private key(x: number, z: number): number {
    return Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** À appeler à chaque pas : `strikers` = les voitures, (fx, fz) = position du joueur. */
  update(dt: number, strikers: readonly LampStriker[], fx: number, fz: number): void {
    for (const c of strikers) {
      const speed = Math.hypot(c.vx, c.vz);
      if (speed < LAMPS.minSpeed) continue;
      const sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
      const cx = Math.floor(c.x / CELL), cz = Math.floor(c.z / CELL);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
        const cell = this.grid.get(i * 100003 + j);
        if (!cell) continue;
        for (const id of cell) {
          if (this.state[id] !== STANDING) continue;
          const l = this.lamps[id] as Lamp;
          const dx = l.x - c.x, dz = l.z - c.z;
          const along = dx * sn + dz * cs, side = dx * cs - dz * sn;
          if (Math.abs(along) > LAMPS.hitHalfLength || Math.abs(side) > LAMPS.hitHalfWidth) continue;
          this.knock(id, c, speed, side);
          c.slow(1 - LAMPS.slowdown);
        }
      }
    }
    // Vol des lampadaires fauchés
    for (let n = this.active.length - 1; n >= 0; n--) {
      const id = this.active[n] as number;
      const p = id * 7, v = id * 3, s = id * 4;
      const pose = this.pose, vel = this.vel, spin = this.spin;
      if (this.state[id] === FLYING) {
        vel[v + 1] = (vel[v + 1] as number) - 9.81 * 1.6 * dt;
        pose[p] = (pose[p] as number) + (vel[v] as number) * dt;
        pose[p + 1] = (pose[p + 1] as number) + (vel[v + 1] as number) * dt;
        pose[p + 2] = (pose[p + 2] as number) + (vel[v + 2] as number) * dt;
        // rotation autour d'un axe horizontal fixe
        const half = ((spin[s + 3] as number) * dt) / 2;
        const sh = Math.sin(half), ch = Math.cos(half);
        const ax = (spin[s] as number) * sh, ay = (spin[s + 1] as number) * sh, az = (spin[s + 2] as number) * sh;
        const qx = pose[p + 3] as number, qy = pose[p + 4] as number, qz = pose[p + 5] as number, qw = pose[p + 6] as number;
        pose[p + 3] = ch * qx + ax * qw + ay * qz - az * qy;
        pose[p + 4] = ch * qy + ay * qw + az * qx - ax * qz;
        pose[p + 5] = ch * qz + az * qw + ax * qy - ay * qx;
        pose[p + 6] = ch * qw - ax * qx - ay * qy - az * qz;
        if ((pose[p + 1] as number) < 0.2 && (vel[v + 1] as number) < 0) {
          // Retombé : couché dans le sens où il est parti.
          const h = Math.hypot(vel[v] as number, vel[v + 2] as number) || 1;
          const dxn = (vel[v] as number) / h, dzn = (vel[v + 2] as number) / h;
          // quaternion qui couche l'axe vertical sur (dxn, 0, dzn) : quart de tour autour de (dzn, 0, −dxn)
          const k = Math.SQRT1_2;
          pose[p + 1] = 0.12;
          pose[p + 3] = dzn * k; pose[p + 4] = 0; pose[p + 5] = -dxn * k; pose[p + 6] = k;
          this.state[id] = LYING;
        }
        this.dirty.push(id);
      } else {
        // Couché : il se redresse quand plus personne n'est là pour le voir.
        const l = this.lamps[id] as Lamp;
        if (Math.hypot(l.x - fx, l.z - fz) > LAMPS.respawnDistance) {
          this.state[id] = STANDING;
          this.active.splice(n, 1);
          this.dirty.push(id);
        }
      }
    }
  }

  private knock(id: number, c: LampStriker, speed: number, side: number): void {
    const l = this.lamps[id] as Lamp;
    const p = id * 7, v = id * 3, s = id * 4;
    const yaw = Math.atan2(l.dx, l.dz);
    this.state[id] = FLYING;
    this.pose[p] = l.x; this.pose[p + 1] = l.height / 2; this.pose[p + 2] = l.z;
    this.pose[p + 3] = 0; this.pose[p + 4] = Math.sin(yaw / 2); this.pose[p + 5] = 0; this.pose[p + 6] = Math.cos(yaw / 2);
    // Il part dans le sens de la voiture, un peu sur le côté où il a été touché.
    const dirx = c.vx / speed, dirz = c.vz / speed;
    const out = (side >= 0 ? 1 : -1) * (0.15 + this.rand() * 0.3);
    const carry = LAMPS.carry * (0.8 + this.rand() * 0.4);
    this.vel[v] = (dirx + dirz * out) * speed * carry;
    this.vel[v + 1] = LAMPS.popUp * (0.8 + this.rand() * 0.5) + speed * 0.06;
    this.vel[v + 2] = (dirz - dirx * out) * speed * carry;
    // Fauché par le pied : il bascule vers l'avant (axe horizontal, perpendiculaire à la course).
    this.spin[s] = dirz; this.spin[s + 1] = 0; this.spin[s + 2] = -dirx;
    this.spin[s + 3] = -(3 + this.rand() * 4 + speed * 0.08);
    this.active.push(id);
    this.dirty.push(id);
    this.knocked++;
  }

  /** Redresse tout (changement de partie, essais). */
  reset(): void {
    for (const id of this.active) { this.state[id] = STANDING; this.dirty.push(id); }
    this.active.length = 0;
  }
}
