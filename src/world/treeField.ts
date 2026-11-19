import { TREES } from '../config/props';
import type { Tree } from './cityGen';
import type { LampStriker } from './lampField';

const STANDING = 0, FLYING = 1, FALLING = 2, LYING = 3;
const CELL = 12;

/**
 * Arbres renversables. Les petits arbres et les palmiers s'envolent comme les lampadaires.
 * Les gros (`solid`, avec un tronc en dur) arrêtent la voiture, sauf si elle arrive avec assez
 * d'élan (vitesse × masse) : alors le tronc casse, l'arbre bascule et la voiture perd de la vitesse.
 * Trajectoires calculées ici, sans moteur physique ; `src/render/treeVisuals.ts` lit l'état.
 */
export class TreeField {
  readonly state: Uint8Array;
  /** Par arbre à terre : point de pivot (x, y, z) et orientation (quaternion). */
  readonly pose: Float32Array;
  /** Hauteur du pivot dans le modèle (0 = au pied). */
  readonly pivot: Float32Array;
  readonly dirty: number[] = [];
  /** Compteurs pour le son : petits arbres fauchés, gros arbres cassés. */
  knocked = 0;
  broken = 0;
  /** Chocs de ce pas, pour les éclats : x, y, z, vx, vz, genre (0 petit arbre, 1 palmier, 2 gros tronc). */
  readonly events: number[] = [];
  /** Appelé quand le tronc d'un gros arbre doit devenir traversable (cassé) ou redevenir dur. */
  setSolid: ((id: number, on: boolean) => void) | null = null;
  private readonly vel: Float32Array;
  private readonly spin: Float32Array;
  private readonly grid = new Map<number, number[]>();
  private readonly active: number[] = [];
  private seed = 7;

  constructor(readonly trees: Tree[]) {
    const n = trees.length;
    this.state = new Uint8Array(n);
    this.pose = new Float32Array(n * 7);
    this.pivot = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 4);
    trees.forEach((t, i) => {
      const k = Math.floor(t.x / CELL) * 100003 + Math.floor(t.z / CELL);
      const cell = this.grid.get(k);
      if (cell) cell.push(i); else this.grid.set(k, [i]);
    });
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, strikers: readonly LampStriker[], fx: number, fz: number): void {
    for (const c of strikers) {
      const speed = Math.hypot(c.vx, c.vz);
      if (speed < TREES.minSpeed) continue;
      const sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
      const cx = Math.floor(c.x / CELL), cz = Math.floor(c.z / CELL);
      // (on regarde un peu devant : un gros tronc doit céder avant que la carrosserie ne le touche)
      const reach = TREES.hitHalfLength + speed * dt * 2;
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
        const cell = this.grid.get(i * 100003 + j);
        if (!cell) continue;
        for (const id of cell) {
          if (this.state[id] !== STANDING) continue;
          const t = this.trees[id] as Tree;
          if (Math.abs((t.y ?? 0) - (c.y ?? 0)) > 2.5) continue;
          const dx = t.x - c.x, dz = t.z - c.z;
          const along = dx * sn + dz * cs, side = dx * cs - dz * sn;
          if (Math.abs(along) > reach || Math.abs(side) > TREES.hitHalfWidth) continue;
          if (t.solid) {
            if (speed * (c.mass ?? 1200) < TREES.breakMomentum) continue; // pas assez d'élan : le tronc tient
            this.snap(id, c, speed);
            c.slow(1 - TREES.breakSlowdown);
          } else {
            this.knock(id, c, speed, side);
            c.slow(1 - TREES.slowdown);
          }
        }
      }
    }
    for (let n = this.active.length - 1; n >= 0; n--) {
      const id = this.active[n] as number;
      const t = this.trees[id] as Tree;
      const p = id * 7, v = id * 3, s = id * 4;
      const pose = this.pose, vel = this.vel, spin = this.spin;
      const ground = t.y ?? 0;
      const st = this.state[id];
      if (st === FLYING) {
        vel[v + 1] = (vel[v + 1] as number) - 9.81 * 1.6 * dt;
        pose[p] = (pose[p] as number) + (vel[v] as number) * dt;
        pose[p + 1] = (pose[p + 1] as number) + (vel[v + 1] as number) * dt;
        pose[p + 2] = (pose[p + 2] as number) + (vel[v + 2] as number) * dt;
        this.rotate(id, (spin[s + 3] as number) * dt);
        if ((pose[p + 1] as number) < ground + 0.4 && (vel[v + 1] as number) < 0) {
          const h = Math.hypot(vel[v] as number, vel[v + 2] as number) || 1;
          this.lay(id, (vel[v] as number) / h, (vel[v + 2] as number) / h, ground + 0.35);
        }
        this.dirty.push(id);
      } else if (st === FALLING) {
        // Bascule autour du pied, de plus en plus vite, et le pied glisse un peu.
        spin[s + 3] = (spin[s + 3] as number) + 3.2 * dt;
        const step = (spin[s + 3] as number) * dt;
        vel[v + 1] = (vel[v + 1] as number) + step; // angle parcouru
        this.rotate(id, step);
        const slide = Math.exp(-3 * dt);
        pose[p] = (pose[p] as number) + (vel[v] as number) * dt;
        pose[p + 2] = (pose[p + 2] as number) + (vel[v + 2] as number) * dt;
        vel[v] = (vel[v] as number) * slide;
        vel[v + 2] = (vel[v + 2] as number) * slide;
        if ((vel[v + 1] as number) >= 1.5) {
          this.lay(id, -(spin[s + 2] as number), spin[s] as number, ground + 0.25);
        }
        this.dirty.push(id);
      } else if (Math.hypot(t.x - fx, t.z - fz) > TREES.respawnDistance) {
        this.restore(id);
        this.active.splice(n, 1);
      }
    }
    while (this.active.length > TREES.maxDown) this.restore(this.active.shift() as number);
  }

  /** Tourne la pose de `angle` autour de l'axe horizontal mémorisé dans `spin`. */
  private rotate(id: number, angle: number): void {
    const p = id * 7, s = id * 4, pose = this.pose, spin = this.spin;
    const sh = Math.sin(angle / 2), ch = Math.cos(angle / 2);
    const ax = (spin[s] as number) * sh, ay = (spin[s + 1] as number) * sh, az = (spin[s + 2] as number) * sh;
    const qx = pose[p + 3] as number, qy = pose[p + 4] as number, qz = pose[p + 5] as number, qw = pose[p + 6] as number;
    pose[p + 3] = ch * qx + ax * qw + ay * qz - az * qy;
    pose[p + 4] = ch * qy + ay * qw + az * qx - ax * qz;
    pose[p + 5] = ch * qz + az * qw + ax * qy - ay * qx;
    pose[p + 6] = ch * qw - ax * qx - ay * qy - az * qz;
  }

  /** Couche l'arbre au sol, la cime vers (dx, dz). */
  private lay(id: number, dx: number, dz: number, y: number): void {
    const p = id * 7, k = Math.SQRT1_2;
    this.pose[p + 1] = y;
    this.pose[p + 3] = dz * k; this.pose[p + 4] = 0; this.pose[p + 5] = -dx * k; this.pose[p + 6] = k;
    this.state[id] = LYING;
  }

  private start(id: number, pivot: number): void {
    const t = this.trees[id] as Tree;
    const p = id * 7;
    this.pivot[id] = pivot;
    this.pose[p] = t.x; this.pose[p + 1] = (t.y ?? 0) + pivot; this.pose[p + 2] = t.z;
    this.pose[p + 3] = 0; this.pose[p + 4] = 0; this.pose[p + 5] = 0; this.pose[p + 6] = 1;
    this.active.push(id);
    this.dirty.push(id);
  }

  private knock(id: number, c: LampStriker, speed: number, side: number): void {
    const t = this.trees[id] as Tree;
    const v = id * 3, s = id * 4;
    this.state[id] = FLYING;
    this.start(id, t.height * 0.4);
    const dirx = c.vx / speed, dirz = c.vz / speed;
    const out = (side >= 0 ? 1 : -1) * (0.15 + this.rand() * 0.3);
    const carry = TREES.carry * (0.8 + this.rand() * 0.4);
    this.vel[v] = (dirx + dirz * out) * speed * carry;
    this.vel[v + 1] = TREES.popUp * (0.8 + this.rand() * 0.5) + speed * 0.05;
    this.vel[v + 2] = (dirz - dirx * out) * speed * carry;
    this.spin[s] = dirz; this.spin[s + 1] = 0; this.spin[s + 2] = -dirx;
    this.spin[s + 3] = -(2 + this.rand() * 2.5 + speed * 0.05);
    this.knocked++;
    this.events.push(t.x, t.y ?? 0, t.z, c.vx, c.vz, t.palm ? 1 : 0);
  }

  private snap(id: number, c: LampStriker, speed: number): void {
    const v = id * 3, s = id * 4;
    this.state[id] = FALLING;
    this.start(id, 0);
    const dirx = c.vx / speed, dirz = c.vz / speed;
    this.vel[v] = dirx * speed * 0.3;
    this.vel[v + 1] = 0; // angle de bascule parcouru
    this.vel[v + 2] = dirz * speed * 0.3;
    // axe horizontal perpendiculaire à la course : l'arbre tombe vers l'avant
    this.spin[s] = dirz; this.spin[s + 1] = 0; this.spin[s + 2] = -dirx;
    this.spin[s + 3] = 0.9 + speed * 0.04;
    this.setSolid?.(id, false);
    this.broken++;
    const t = this.trees[id] as Tree;
    this.events.push(t.x, t.y ?? 0, t.z, c.vx, c.vz, 2);
  }

  private restore(id: number): void {
    this.state[id] = STANDING;
    this.dirty.push(id);
    if ((this.trees[id] as Tree).solid) this.setSolid?.(id, true);
  }

  reset(): void {
    for (const id of this.active) this.restore(id);
    this.active.length = 0;
  }
}
