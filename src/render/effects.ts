import type * as THREE from 'three/webgpu';
import { EFFECTS } from '../config/effects';
import type { PhysicsWorld } from '../physics/physicsWorld';
import { REST_HEIGHT, type Vehicle } from '../vehicle/vehicle';
import { Particles } from './particles';

/** Ce que la boucle de jeu dit des voitures, à chaque image. */
export interface EffectsFrame {
  /** Voiture du joueur d'abord, puis les adversaires. */
  cars: readonly Vehicle[];
  /** Route de campagne ou de montagne sous la voiture du joueur : les roues soulèvent de la poussière. */
  dusty: boolean;
  /** NOS en cours (voiture du joueur). */
  nos: boolean;
  camera: THREE.Vector3;
}

/**
 * Effets de particules du jeu : qui émet quoi, et quand.
 * Les trajectoires sont dans `particles.ts` ; les réglages dans `config/effects.ts`.
 */
export class Effects {
  private readonly glow: Particles;
  private readonly soft: Particles;
  private seed = 99;
  /** Points de frottement contre un mur relevés pendant les pas de physique (x, y, z, vitesse). */
  private readonly rubs: number[] = [];
  /** Intensité du frottement tôle contre mur ou glissière (0..1), pour le son. */
  scrape = 0;
  /** Patinage ou glisse des pneus du joueur (0..1), pour le son. */
  squeal = 0;
  private carry: number[] = [];
  /** Part des fumées et poussières réellement émises (1 = tout). Baisse toute seule si l'image ralentit ; 0 = coupées. */
  density = 1;
  /** Faux : aucune particule (réglage « ?particules=non », pour comparer). */
  enabled = true;
  private frameMs = 16;

  constructor(scene: THREE.Object3D) {
    this.glow = new Particles(scene, EFFECTS.maxGlow, true);
    this.soft = new Particles(scene, EFFECTS.maxSoft, false);
  }

  get count(): number {
    return this.glow.alive + this.soft.alive;
  }

  private r(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** À appeler après chaque pas de physique : relève où la caisse frotte contre un mur ou une autre voiture. */
  sampleContacts(phys: PhysicsWorld, car: Vehicle): void {
    const lv = car.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (speed < EFFECTS.sparkMinSpeed || this.rubs.length > 48) return;
    phys.world.contactPairsWith(car.collider, (other) => {
      phys.world.contactPair(car.collider, other, (m) => {
        const n = m.normal();
        if (Math.abs(n.y) > 0.6) return; // sol, rampe : pas un mur
        // (seule la vitesse le long du mur fait des étincelles ; un choc de face fait un bruit, pas une gerbe)
        const along = Math.hypot(lv.x - n.x * (lv.x * n.x + lv.z * n.z), lv.z - n.z * (lv.x * n.x + lv.z * n.z));
        if (along < EFFECTS.sparkMinSpeed) return;
        for (let i = 0; i < Math.min(2, m.numSolverContacts()); i++) {
          const q = m.solverContactPoint(i);
          this.rubs.push(q.x, q.y, q.z, along);
        }
      });
    });
  }

  private sparks(x: number, y: number, z: number, vx: number, vz: number, count: number, hot = 1): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const s = 0.25 + this.r() * 0.5;
      this.glow.emit(
        x + (this.r() - 0.5) * 0.25, y + (this.r() - 0.5) * 0.2, z + (this.r() - 0.5) * 0.25,
        vx * s + (this.r() - 0.5) * 5, 1.2 + this.r() * 4.5, vz * s + (this.r() - 0.5) * 5,
        0.22 + this.r() * 0.5, 0.11, 0.03,
        3.2 * hot, (1.3 + this.r() * 0.9) * hot, 0.35 * hot, 1, 13, 0.6,
      );
    }
  }

  /** Gerbe d'étincelles ponctuelle (lampadaire fauché, choc). */
  burst(x: number, y: number, z: number, vx: number, vz: number, count: number): void {
    this.sparks(x, y, z, vx, vz, count);
  }

  /** Éclats de bois et feuilles quand un arbre casse ou est fauché. */
  wood(x: number, y: number, z: number, vx: number, vz: number, big: boolean, palm: boolean): void {
    if (!this.enabled) return;
    const chips = big ? 10 : 5, leaves = big ? 14 : 7;
    for (let i = 0; i < chips; i++) {
      this.soft.emit(x + (this.r() - 0.5) * 0.6, y + 0.3 + this.r() * 1.2, z + (this.r() - 0.5) * 0.6,
        vx * (0.2 + this.r() * 0.5) + (this.r() - 0.5) * 6, 2 + this.r() * 5, vz * (0.2 + this.r() * 0.5) + (this.r() - 0.5) * 6,
        0.7 + this.r() * 0.7, 0.16, 0.1, 0.5, 0.33, 0.18, 0.95, 12, 0.5);
    }
    for (let i = 0; i < leaves; i++) {
      const h = palm ? 0.8 : 0.35 + this.r() * 0.5;
      this.soft.emit(x + (this.r() - 0.5) * 2.4, y + (big ? 9 : 5) * h + this.r() * 2, z + (this.r() - 0.5) * 2.4,
        vx * 0.25 + (this.r() - 0.5) * 5, 1 + this.r() * 3, vz * 0.25 + (this.r() - 0.5) * 5,
        1.4 + this.r() * 1.6, 0.2, 0.14, 0.12, 0.42 + this.r() * 0.2, 0.16, 0.9, 2.2, 1.6);
    }
  }

  /** Flammèches à l'échappement (turbo qui décharge). */
  backfire(car: Vehicle, strength: number): void {
    const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
    const lv = car.body.linvel();
    for (let i = 0; i < Math.round(EFFECTS.backfire * strength); i++) {
      const side = (this.r() < 0.5 ? -1 : 1) * 0.42;
      const x = car.pos.x - sn * 2.3 + cs * side, z = car.pos.z - cs * 2.3 - sn * side;
      const back = 2 + this.r() * 5;
      const blue = this.r() < 0.35;
      this.glow.emit(x, car.pos.y - 0.22, z, lv.x - sn * back, 0.3 + this.r() * 0.8, lv.z - cs * back,
        0.08 + this.r() * 0.14, 0.34, 0.08, blue ? 0.6 : 3.4, blue ? 1.2 : 1.5, blue ? 3.4 : 0.25, 0.9, -1, 2);
    }
  }

  /** Objet de rue renversé : quelques éclats de sa couleur. */
  debris(x: number, y: number, z: number, vx: number, vz: number, r: number, g: number, b: number, count: number): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      this.soft.emit(x + (this.r() - 0.5) * 0.4, y + this.r() * 0.6, z + (this.r() - 0.5) * 0.4,
        vx * (0.3 + this.r() * 0.5) + (this.r() - 0.5) * 5, 2 + this.r() * 4, vz * (0.3 + this.r() * 0.5) + (this.r() - 0.5) * 5,
        0.6 + this.r() * 0.6, 0.14, 0.09, r, g, b, 0.95, 12, 0.6);
    }
  }

  /** À appeler à chaque image avec sa durée réelle (ms) : règle le garde-fou. */
  measure(ms: number): void {
    this.frameMs += (Math.min(ms, 100) - this.frameMs) * 0.05;
    if (this.frameMs > EFFECTS.slowMs) this.density = Math.max(EFFECTS.minDensity, this.density - 0.02);
    else if (this.frameMs < EFFECTS.fastMs) this.density = Math.min(1, this.density + 0.004);
  }

  update(dt: number, f: EffectsFrame): void {
    let scrape = 0, squeal = 0;
    const dens = this.enabled ? this.density : 0;
    // Frottements relevés par la physique (murs, voitures).
    const rubs = this.rubs;
    for (let i = 0; i < rubs.length; i += 4) {
      const v = rubs[i + 3] as number;
      const lv = (f.cars[0] as Vehicle).body.linvel();
      if (this.r() < Math.min(1, v * EFFECTS.sparksPerMeter * dt * 2)) this.sparks(rubs[i] as number, rubs[i + 1] as number, rubs[i + 2] as number, lv.x, lv.z, 1 + Math.floor(this.r() * 2));
      scrape = Math.max(scrape, Math.min(1, v / 30));
    }
    rubs.length = 0;

    f.cars.forEach((car, ci) => {
      const me = ci === 0;
      if (!me && Math.hypot(car.pos.x - f.camera.x, car.pos.z - f.camera.z) > EFFECTS.range) return;
      const lv = car.body.linvel();
      const speed = Math.hypot(lv.x, lv.z);
      const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
      const ground = car.pos.y - REST_HEIGHT + 0.05;
      // Glissière : gerbe au flanc qui frotte.
      if (car.scraping && speed > EFFECTS.sparkMinSpeed) {
        const n = (this.carry[ci] ?? 0) + speed * EFFECTS.sparksPerMeter * dt;
        const whole = Math.floor(n);
        this.carry[ci] = n - whole;
        const along = (this.r() - 0.3) * 3;
        this.sparks(car.pos.x - car.scrapeNx * 0.95 + sn * along, ground + 0.35, car.pos.z - car.scrapeNz * 0.95 + cs * along, lv.x + car.scrapeNx * 3, lv.z + car.scrapeNz * 3, whole);
        if (me) scrape = Math.max(scrape, Math.min(1, speed / 30));
      }
      // Pneus : fumée quand ils glissent ou patinent, poussière en campagne.
      for (const w of car.wheels) {
        if (!w.inContact) continue;
        const wx = car.pos.x + cs * w.mx + sn * w.mz, wz = car.pos.z - sn * w.mx + cs * w.mz;
        const wheelV = Math.abs(w.spinSpeed) * car.spec.wheelRadius;
        const spin = Math.max(0, wheelV - speed - 2.5) / 8; // la roue tourne plus vite que la route
        const lock = speed > 8 && wheelV < speed * 0.5 ? 0.6 : 0; // roue bloquée
        const slide = speed > 6 ? Math.max(0, w.gripUse - EFFECTS.smokeFrom) * 1.6 : 0;
        const held = car.launchHold && !w.front ? Math.max(0, car.throttle - 0.55) * 1.6 : 0; // moteur rincé sur la grille
        const amount = Math.min(1, Math.max(spin, lock, slide, held));
        if (me) squeal = Math.max(squeal, Math.min(1, Math.max(spin, lock, held * 0.6)));
        if (amount > 0.05 && this.r() < amount * EFFECTS.smokeRate * dt * dens * (me ? 1 : EFFECTS.othersShare)) {
          const g = 0.72 + this.r() * 0.2;
          this.soft.emit(wx + (this.r() - 0.5) * 0.3, ground + 0.1, wz + (this.r() - 0.5) * 0.3,
            lv.x * 0.25 + (this.r() - 0.5) * 1.2 - sn * spin * 2, 0.5 + this.r() * 0.9, lv.z * 0.25 + (this.r() - 0.5) * 1.2 - cs * spin * 2,
            0.6 + this.r() * 0.5, 0.3, EFFECTS.smokeSize * (0.8 + this.r() * 0.4), g, g, g * 1.04, EFFECTS.smokeAlpha * (0.5 + amount * 0.5), -0.5, 1.1);
        }
        if (me && f.dusty && !w.front && speed > EFFECTS.dustMinSpeed && this.r() < Math.min(1.5, speed / 27.8) * EFFECTS.dustRate * dt * dens) {
          this.soft.emit(wx, ground + 0.08, wz, lv.x * 0.18 + (this.r() - 0.5), 0.4 + this.r() * 0.7, lv.z * 0.18 + (this.r() - 0.5),
            0.7 + this.r() * 0.5, 0.35, EFFECTS.smokeSize * (0.9 + this.r() * 0.4), 0.55, 0.47, 0.36, EFFECTS.dustAlpha, -0.3, 0.9);
        }
      }
    });
    // NOS : la flamme bleue existe déjà sur le modèle ; on ajoute des flammèches qui se détachent.
    if (f.nos && this.r() < 30 * dt) {
      const car = f.cars[0] as Vehicle;
      const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw), lv = car.body.linvel();
      const side = (this.r() < 0.5 ? -1 : 1) * 0.42;
      this.glow.emit(car.pos.x - sn * 2.4 + cs * side, car.pos.y - 0.22, car.pos.z - cs * 2.4 - sn * side, lv.x * 0.7 - sn * 3, 0.2 + this.r(), lv.z * 0.7 - cs * 3, 0.12 + this.r() * 0.15, 0.3, 0.06, 0.5, 1.3, 3.6, 0.8, -1.5, 2);
    }
    this.scrape += (scrape - this.scrape) * Math.min(1, dt * (scrape > this.scrape ? 18 : 7));
    this.squeal += (squeal - this.squeal) * Math.min(1, dt * 9);
    this.glow.update(dt);
    this.soft.update(dt, f.camera, EFFECTS.maxScreen);
  }
}
