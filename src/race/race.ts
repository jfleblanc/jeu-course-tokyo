import { driveAlongRoute } from '../ai/driver';
import { CAR_MODELS } from '../config/cars';
import type { CarSpec, HandlingConfig } from '../config/handling';
import { AI_DRIVERS, PICKUPS, RACE, RUBBER_BAND, type AiLevel, AGGRESSIVE } from '../config/race';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { emptyDriveInput, type DriveInput } from '../input/actions';
import type { PhysicsWorld } from '../physics/physicsWorld';
import { REST_HEIGHT, Vehicle } from '../vehicle/vehicle';
import type { Route, RoutePoint } from './route';

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
  /** Écart momentané pour contourner une voiture de la circulation (m). */
  avoid: number;
  input: DriveInput;
  stuckTime: number;
  resets: number;
}

export interface Pickup {
  kind: 'cash' | 'teleport';
  x: number;
  /** Altitude de la chaussée à cet endroit (m). */
  y: number;
  z: number;
  /** Indice du point du tracé le plus proche. */
  index: number;
  taken: boolean;
}

export type RaceEvent = { type: 'cash'; amount: number } | { type: 'teleport'; gained: number };

export interface RaceOptions {
  /** Multiplicateur de niveau des adversaires (1 = normal). */
  difficulty?: number;
  /** Puissance moteur des adversaires (1 = voiture de série). */
  power?: number;
  /** Adhérence et freins des adversaires (1 = voiture de série). */
  grip?: number;
  /** Pilotes adverses (trois). Par défaut : tirés au sort d'après le tracé. */
  drivers?: AiLevel[];
  /** Valeur d'une mallette d'argent (¥). */
  cashValue?: number;
}

/** Trois pilotes tirés au sort, toujours les mêmes pour un tracé donné. */
export function pickDrivers(seed: number): AiLevel[] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const pool = [...AI_DRIVERS];
  const out: AiLevel[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0] as AiLevel);
  return out;
}

export class Race {
  phase: RacePhase = 'idle';
  route: Route | null = null;
  racers: Racer[] = [];
  /** Temps de course (s), 0 pendant le décompte. */
  time = 0;
  /** Temps restant avant le départ (s). */
  countdown = 0;
  /** Voitures de la circulation que les adversaires doivent contourner (mis à jour par le jeu). */
  obstacles: { x: number; z: number }[] = [];
  /** Incrémenté à chaque départ : le rendu sait qu'il doit reconstruire le décor de course. */
  generation = 0;
  /** Multiplicateur de niveau des adversaires (1 = normal). */
  difficulty = 1;
  /** Puissance moteur des adversaires par rapport à une voiture de série (alignée sur celle du joueur). */
  powerMatch = 1;
  /** Adhérence et freins des adversaires par rapport à une voiture de série. */
  gripMatch = 1;
  private aiCfg: HandlingConfig | null = null;
  /** Objets à ramasser (mallettes, téléporteur). */
  pickups: Pickup[] = [];
  /** Argent ramassé pendant la course (ajouté à la récompense). */
  bonusMoney = 0;
  /** Événements à afficher (vidés par l'interface). */
  events: RaceEvent[] = [];
  private cashValue = 0;
  private readonly hold: DriveInput = emptyDriveInput();
  private readonly idle: DriveInput = emptyDriveInput();

  constructor(
    private readonly phys: PhysicsWorld,
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

  /** Lance une course sur le tracé donné. */
  start(route: Route, options: RaceOptions = {}): boolean {
    this.stop();
    this.difficulty = options.difficulty ?? 1;
    this.powerMatch = options.power ?? 1;
    this.gripMatch = options.grip ?? 1;
    this.cashValue = options.cashValue ?? PICKUPS.cashBase;
    const drivers = options.drivers ?? pickDrivers(route.seed);
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
    const place = (slot: { s: number; lane: number }): { x: number; y: number; z: number; yaw: number; index: number } => {
      const p = at(slot.s);
      return { x: p.x + p.tz * slot.lane, y: p.y ?? 0, z: p.z - p.tx * slot.lane, yaw: Math.atan2(p.tx, p.tz), index: Math.round(slot.s / 3) };
    };
    this.racers = [];
    drivers.slice(0, 3).forEach((level, k) => {
      const slot = slots[k] as (typeof slots)[number];
      const g = place(slot);
      const car = new Vehicle(this.phys, this.spec, { x: g.x, y: g.y + REST_HEIGHT + 0.15, z: g.z, yaw: g.yaw });
      // Chaque pilote a la physique de sa voiture (masse, roues motrices, empattement).
      const model = CAR_MODELS.find((m) => m.glb === level.glb);
      // Adversaires allégés : le joueur les pousse plus facilement qu'ils ne le poussent.
      if (model) car.setTraits({ ...model.traits, mass: model.traits.mass * RACE.aiMassFactor });
      this.racers.push(this.makeRacer(level.name, false, car, level, g.index, slot.lane * 0.35));
    });
    const pg = place(slots[3] as (typeof slots)[number]);
    this.playerCar.teleport(pg.x, pg.y + REST_HEIGHT + 0.15, pg.z, pg.yaw);
    this.racers.push(this.makeRacer('Vous', true, this.playerCar, null, pg.index, 0));
    // — Objets à ramasser : mallettes régulières, téléporteur rare (toujours les mêmes pour un tracé) —
    const rng = new Rng(route.seed ^ 0x2545f491);
    this.pickups = [];
    this.bonusMoney = 0;
    this.events = [];
    const lapLen = route.lapLength;
    for (let s = RACE.startLine + PICKUPS.cashSpacing * 0.6; s < lapLen - 60; s += PICKUPS.cashSpacing) {
      const p = at(s + rng.range(-40, 40));
      const side = rng.range(-3, 3);
      this.pickups.push({ kind: 'cash', x: p.x + p.tz * side, y: p.y ?? 0, z: p.z - p.tx * side, index: Math.round(p.s / 3), taken: false });
    }
    if (rng.chance(PICKUPS.teleporterChance)) {
      const p = at(lapLen * rng.range(0.35, 0.6));
      const side = rng.range(-2.5, 2.5);
      this.pickups.push({ kind: 'teleport', x: p.x + p.tz * side, y: p.y ?? 0, z: p.z - p.tx * side, index: Math.round(p.s / 3), taken: false });
    }
    this.phase = 'countdown';
    this.countdown = RACE.countdownSeconds + 0.8; // petit temps mort pour regarder la grille
    this.time = 0;
    this.generation++;
    return true;
  }

  private makeRacer(name: string, isPlayer: boolean, car: Vehicle, level: AiLevel | null, index: number, lane: number): Racer {
    return { name, isPlayer, car, level, index, progress: index * 3, nextCheckpoint: 0, finished: false, finishTime: 0, lane, avoid: 0, input: emptyDriveInput(), stuckTime: 0, resets: 0 };
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
    this.pickups = [];
    this.route = null;
    this.phase = 'idle';
  }

  /** Commandes effectives du joueur : bloquées pendant le décompte. */
  playerInput(raw: DriveInput): DriveInput {
    if (this.phase !== 'countdown') return raw;
    // Sur la grille : seul l'accélérateur passe (pour faire monter le moteur, voiture tenue).
    this.hold.throttle = raw.throttle;
    return this.hold;
  }

  /** À appeler dans le pas fixe, AVANT world.step() : fait conduire les adversaires. */
  beforeStep(dt: number, cfg: HandlingConfig): void {
    const route = this.route;
    if (!route || this.phase === 'idle') return;
    const player = this.player;
    // Réglage des adversaires : celui du joueur, avec l'adhérence et les freins de leur catégorie.
    const ai = (this.aiCfg ??= { ...cfg });
    Object.assign(ai, cfg);
    ai.gripFront *= this.gripMatch; ai.gripRear *= this.gripMatch; ai.gripLong *= this.gripMatch; ai.brakeForce *= this.gripMatch;
    for (const r of this.racers) {
      if (r.isPlayer || !r.level) continue;
      if (this.phase === 'countdown') {
        r.car.update(dt, this.idle, cfg);
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
        let blockAt: number | null = null;
        if (player) {
          const gap = r.progress - player.progress;
          const t = clamp(gap / RUBBER_BAND.distance, -1, 1);
          factor = t > 0 ? 1 - RUBBER_BAND.maxSlow * t : 1 - RUBBER_BAND.maxBoost * t;
          const ag = route.aggression ?? 0;
          if (ag > 0) {
            // Pilotes agressifs : plus vite partout, encore plus quand ils sont derrière, et ils
            // ne lèvent presque plus le pied quand ils mènent.
            factor = (t > 0 ? 1 - RUBBER_BAND.maxSlow * 0.35 * t : 1 + AGGRESSIVE.chase * ag * -t) * (1 + AGGRESSIVE.pace * ag);
            r.car.powerBoost = this.powerMatch * (1 + ag * (AGGRESSIVE.power + AGGRESSIVE.chasePower * Math.max(0, -t)));
            // Le joueur arrive derrière : on se met sur sa trajectoire.
            if (gap > 2 && gap < AGGRESSIVE.blockRange) {
              const q = route.points[Math.min(route.points.length - 1, r.index)] as RoutePoint;
              const pp = player.car.pos;
              const lat = (pp.x - q.x) * q.tz - (pp.z - q.z) * q.tx; // > 0 : le joueur est à gauche
              const room = (route.halfWidth ?? 7) - 2.3;
              blockAt = clamp(lat, -room, room) - r.lane;
            }
          } else r.car.powerBoost = this.powerMatch;
        }
        // Circulation : on contourne la voiture ordinaire la plus proche devant soi.
        const hx = Math.sin(r.car.yaw), hz = Math.cos(r.car.yaw);
        let want = 0, nearest = 45;
        for (const o of this.obstacles) {
          const dx = o.x - r.car.pos.x, dz = o.z - r.car.pos.z;
          const along = dx * hx + dz * hz;
          if (along < 2 || along > nearest) continue;
          const lat = dx * hz - dz * hx; // > 0 : obstacle à gauche
          if (Math.abs(lat) > 3) continue;
          nearest = along;
          want = lat >= 0 ? -3.6 : 3.6;
        }
        if (blockAt !== null && want === 0) r.avoid += clamp(blockAt - r.avoid, -AGGRESSIVE.blockRate * dt, AGGRESSIVE.blockRate * dt);
        else r.avoid += clamp(want - r.avoid, -7 * dt, 7 * dt);
        driveAlongRoute(r.car, route, r.index, r.level, factor * this.difficulty, r.lane + r.avoid, r.input);
      }
      r.car.update(dt, r.input, ai);
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
          r.car.teleport(q.x, (q.y ?? 0) + REST_HEIGHT + 0.2, q.z, Math.atan2(q.tx, q.tz));
          r.stuckTime = 0;
          r.resets++;
        }
      }
    }
    const player = this.player;
    // — Objets à ramasser (le joueur seulement) —
    if (player && !player.finished) {
      const r2 = PICKUPS.radius * PICKUPS.radius;
      for (const pk of this.pickups) {
        if (pk.taken) continue;
        if ((pk.x - player.car.pos.x) ** 2 + (pk.z - player.car.pos.z) ** 2 > r2) continue;
        pk.taken = true;
        if (pk.kind === 'cash') {
          this.bonusMoney += this.cashValue;
          this.events.push({ type: 'cash', amount: this.cashValue });
        } else {
          this.events.push({ type: 'teleport', gained: this.teleportPlayer(player) });
        }
      }
    }
    if (player?.finished && this.phase === 'running') this.phase = 'finished';
  }

  /**
   * Téléporteur : place le joueur juste devant la voiture qui le précède, au plus à
   * `teleporterMax` mètres, en conservant sa vitesse. Renvoie la distance gagnée (m).
   */
  private teleportPlayer(player: Racer): number {
    const route = this.route;
    if (!route) return 0;
    let target = player.progress + PICKUPS.teleporterMax;
    let ahead: Racer | null = null;
    for (const r of this.racers) {
      if (r === player || r.finished || r.progress <= player.progress) continue;
      if (!ahead || r.progress < ahead.progress) ahead = r;
    }
    // Personne devant : le téléporteur ne fait rien gagner (on reste premier).
    if (!ahead) return 0;
    target = Math.min(target, ahead.progress + 9);
    const pts = route.points;
    // Les points de passage sautés sont comptés comme franchis au pas suivant ; on ne franchit jamais l'arrivée ainsi.
    const idx = Math.min(pts.length - 4, Math.round(target / 3));
    const q = pts[idx] as RoutePoint;
    const gained = q.s - player.progress;
    if (gained <= 1) return 0;
    player.car.teleport(q.x, (q.y ?? 0) + REST_HEIGHT + 0.15, q.z, Math.atan2(q.tx, q.tz), Math.max(8, player.car.speed));
    player.index = idx;
    player.progress = q.s;
    return gained;
  }

  /** Tour en cours d'un pilote (1 = premier tour). */
  lapOf(r: Racer): number {
    const route = this.route;
    if (!route) return 1;
    return Math.min(route.laps, Math.floor(r.index / route.lapPoints) + 1);
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
