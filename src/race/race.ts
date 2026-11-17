import { driveAlongRoute } from '../ai/driver';
import type { CarSpec, HandlingConfig } from '../config/handling';
import { AI_DRIVERS, RACE, RUBBER_BAND, type AiLevel } from '../config/race';
import { clamp } from '../core/math';
import { emptyDriveInput, type DriveInput } from '../input/actions';
import type { PhysicsWorld } from '../physics/physicsWorld';
import { REST_HEIGHT, Vehicle } from '../vehicle/vehicle';
import type { StreetGraph } from '../world/streetGraph';
import { generateRoute, type Route, type RoutePoint } from './route';

/**
 * Déroulement d'une course : grille de départ, décompte, suivi de la progression de chaque
 * voiture, points de passage, classement, arrivée. Aucune dépendance au rendu.
 */
export type RacePhase = 'idle' | 'countdown' | 'running' | 'finished';

export interface Racer {
  name: string;
  isPlayer: boolean;
  car: Vehicle;
  level: AiLevel | null;
  /** Indice du point du tracé le plus proche (ne recule presque jamais). */
  index: number;
  /** Distance parcourue le long du tracé (m). */
  progress: number;
  /** Prochain point de passage à franchir. */
  nextCheckpoint: number;
  finished: boolean;
  finishTime: number;
  /** Décalage latéral sur la ligne de course (m). */
  lane: number;
  input: DriveInput;
  stuckTime: number;
  resets: number;
}

export class Race {
  phase: RacePhase = 'idle';
  route: Route | null = null;
  racers: Racer[] = [];
  /** Temps de course (s), 0 pendant le décompte. */
  time = 0;
  /** Temps restant avant le départ (s). */
  countdown = 0;
  /** Incrémenté à chaque départ : le rendu sait qu'il doit reconstruire le décor de course. */
  generation = 0;
  private readonly hold: DriveInput = emptyDriveInput();

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly graph: StreetGraph,
    private readonly spec: CarSpec,
    private readonly playerCar: Vehicle,
  ) {
    // Commandes neutres pendant le décompte. (Pas de frein : en boîte auto, frein à l'arrêt = marche arrière.)
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get player(): Racer | null {
    return this.racers.find((r) => r.isPlayer) ?? null;
  }

  /** Lance une nouvelle course sur un tracé tiré au sort. Renvoie faux si aucun tracé n'a pu être généré. */
  start(seed: number): boolean {
    this.stop();
    const route = generateRoute(this.graph, seed);
    if (!route) return false;
    this.route = route;
    const pts = route.points;
    const at = (s: number): RoutePoint => pts[Math.min(pts.length - 1, Math.max(0, Math.round(s / 3)))] as RoutePoint;
    // Grille : deux lignes de deux voitures. Le joueur part derrière, à gauche.
    const slots = [
      { s: RACE.startLine - 8, lane: RACE.gridLaneOffset },
      { s: RACE.startLine - 8, lane: -RACE.gridLaneOffset },
      { s: RACE.startLine - 8 - RACE.gridRowSpacing, lane: -RACE.gridLaneOffset },
      { s: RACE.startLine - 8 - RACE.gridRowSpacing, lane: RACE.gridLaneOffset },
    ];
    const place = (slot: { s: number; lane: number }): { x: number; z: number; yaw: number; index: number } => {
      const p = at(slot.s);
      return { x: p.x + p.tz * slot.lane, z: p.z - p.tx * slot.lane, yaw: Math.atan2(p.tx, p.tz), index: Math.round(slot.s / 3) };
    };
    this.racers = [];
    AI_DRIVERS.forEach((level, k) => {
      const slot = slots[k] as (typeof slots)[number];
      const g = place(slot);
      const car = new Vehicle(this.phys, this.spec, { x: g.x, y: REST_HEIGHT + 0.15, z: g.z, yaw: g.yaw });
      this.racers.push(this.makeRacer(level.name, false, car, level, g.index, slot.lane * 0.35));
    });
    const pg = place(slots[3] as (typeof slots)[number]);
    this.playerCar.teleport(pg.x, REST_HEIGHT + 0.15, pg.z, pg.yaw);
    this.racers.push(this.makeRacer('Vous', true, this.playerCar, null, pg.index, 0));
    this.phase = 'countdown';
    this.countdown = RACE.countdownSeconds + 0.8; // petit temps mort pour regarder la grille
    this.time = 0;
    this.generation++;
    return true;
  }

  private makeRacer(name: string, isPlayer: boolean, car: Vehicle, level: AiLevel | null, index: number, lane: number): Racer {
    return { name, isPlayer, car, level, index, progress: index * 3, nextCheckpoint: 0, finished: false, finishTime: 0, lane, input: emptyDriveInput(), stuckTime: 0, resets: 0 };
  }

  /** Arrête la course et retire les adversaires. */
  stop(): void {
    for (const r of this.racers) {
      if (!r.isPlayer) {
        this.phys.world.removeCollider(r.car.collider, false);
        this.phys.world.removeRigidBody(r.car.body);
      }
    }
    this.racers = [];
    this.route = null;
    this.phase = 'idle';
  }

  /** Commandes effectives du joueur : bloquées pendant le décompte. */
  playerInput(raw: DriveInput): DriveInput {
    return this.phase === 'countdown' ? this.hold : raw;
  }

  /** À appeler dans le pas fixe, AVANT world.step() : fait conduire les adversaires. */
  beforeStep(dt: number, cfg: HandlingConfig): void {
    const route = this.route;
    if (!route || this.phase === 'idle') return;
    const player = this.player;
    for (const r of this.racers) {
      if (r.isPlayer || !r.level) continue;
      if (this.phase === 'countdown') {
        r.car.update(dt, this.hold, cfg);
        continue;
      }
      if (r.finished) {
        // Après l'arrivée : on se range et on s'arrête.
        r.input.throttle = 0;
        r.input.brake = 0.7;
        r.input.steer = 0;
      } else {
        // Effet élastique par rapport au joueur.
        let factor = 1;
        if (player) {
          const gap = r.progress - player.progress;
          const t = clamp(gap / RUBBER_BAND.distance, -1, 1);
          factor = t > 0 ? 1 - RUBBER_BAND.maxSlow * t : 1 - RUBBER_BAND.maxBoost * t;
        }
        driveAlongRoute(r.car, route, r.index, r.level, factor, r.lane, r.input);
      }
      r.car.update(dt, r.input, cfg);
    }
  }

  /** À appeler dans le pas fixe, APRÈS world.step() : progression, points de passage, arrivée. */
  afterStep(dt: number): void {
    const route = this.route;
    if (!route || this.phase === 'idle') return;
    for (const r of this.racers) if (!r.isPlayer) r.car.afterStep();
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'running';
        this.time = 0;
      }
      return;
    }
    this.time += dt;
    const pts = route.points;
    const cps = route.checkpoints;
    const radius2 = RACE.trackRadius * RACE.trackRadius;
    for (const r of this.racers) {
      if (r.finished) continue;
      // Point du tracé le plus proche, cherché seulement jusqu'au prochain point de passage :
      // on peut couper entre deux points de passage, mais pas en sauter un.
      const limit = Math.min(pts.length - 1, (cps[r.nextCheckpoint] ?? pts.length - 1) + 12);
      let best = -1, bestD = radius2;
      for (let k = Math.max(0, r.index - 4); k <= limit; k++) {
        const q = pts[k] as RoutePoint;
        const d = (q.x - r.car.pos.x) ** 2 + (q.z - r.car.pos.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best >= 0) {
        r.index = best;
        r.progress = (pts[best] as RoutePoint).s;
      }
      while (r.nextCheckpoint < cps.length && r.index >= (cps[r.nextCheckpoint] as number)) {
        r.nextCheckpoint++;
        if (r.nextCheckpoint === cps.length) {
          r.finished = true;
          r.finishTime = this.time;
        }
      }
      // Adversaire coincé ou perdu : on le replace sur la ligne de course, un peu plus loin.
      if (!r.isPlayer && !r.finished) {
        const lost = best < 0;
        if (r.car.speed < 2.5 || lost) r.stuckTime += dt;
        else r.stuckTime = Math.max(0, r.stuckTime - dt * 2);
        if (r.stuckTime > 2.2) {
          if ((globalThis as { TRACE_RACE?: boolean }).TRACE_RACE) console.log(`   replacement ${r.name} t=${this.time.toFixed(1)} index=${r.index} perdu=${lost} dist=${Math.sqrt(bestD).toFixed(1)} v=${r.car.speed.toFixed(1)} y=${r.car.pos.y.toFixed(2)} courbure=${(pts[r.index] as RoutePoint).curvature.toFixed(3)}`);
          const q = pts[Math.min(pts.length - 1, r.index + 4)] as RoutePoint;
          r.car.teleport(q.x, REST_HEIGHT + 0.2, q.z, Math.atan2(q.tx, q.tz));
          r.stuckTime = 0;
          r.resets++;
        }
      }
    }
    const player = this.player;
    if (player?.finished && this.phase === 'running') this.phase = 'finished';
  }

  /** Classement en direct : arrivés d'abord (par temps), puis par distance parcourue. */
  ranking(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }
}
