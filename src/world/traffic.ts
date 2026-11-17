import type RAPIER from '@dimforge/rapier3d-compat';
import { TRAFFIC } from '../config/traffic';
import { Rng } from '../core/rng';
import { GROUP_CAR, type PhysicsWorld } from '../physics/physicsWorld';
import { REST_HEIGHT } from '../vehicle/vehicle';
import { pointAt, type GraphEdge, type PathPoint, type StreetGraph } from './streetGraph';

/**
 * Circulation : voitures « sur rails » (corps cinématiques) qui suivent le graphe de rues.
 * Dès qu'une voiture de course arrive vite sur elles, elles deviennent de vrais corps
 * dynamiques : on peut les pousser, elles glissent, puis sont retirées et remplacées plus loin.
 * Aucune dépendance à Three.js : l'affichage lit `cars`.
 */
export interface TrafficCar {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  active: boolean;
  /** 'rue' = suit une rue, 'carrefour' = traverse un carrefour, 'choc' = percutée (physique libre). */
  state: 'rue' | 'carrefour' | 'choc';
  edge: number;
  forward: boolean;
  s: number;
  speed: number;
  x: number;
  z: number;
  yaw: number;
  // Traversée de carrefour
  jx0: number; jz0: number; jx1: number; jz1: number; jyaw0: number; jyaw1: number; jt: number; jlen: number;
  nextEdge: number;
  nextForward: boolean;
  hitTime: number;
  color: number;
  /** Distance parcourue (pour faire tourner les roues à l'affichage). */
  travel: number;
  braking: boolean;
  /** Temps passé à l'arrêt (anti-blocage). */
  stuck: number;
}

/** Ce que la circulation doit éviter ou qui peut la percuter : joueur et adversaires. */
export interface TrafficActor {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

const HALF = { x: 0.86, y: 0.5, z: 2.05 };

export class Traffic {
  readonly cars: TrafficCar[] = [];
  enabled = true;
  /** Zone sans circulation autour du joueur (m) : grille de départ pendant le décompte. */
  keepOut = 0;
  private readonly rng: Rng;
  private readonly usable: GraphEdge[];
  private readonly p: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly graph: StreetGraph,
    seed: number,
  ) {
    this.rng = new Rng(seed ^ 0x7ac1f1c);
    // Pas de ruelles, pas de rues trop courtes.
    this.usable = graph.edges.filter((e) => e.kind !== 'alley' && e.length - e.trimA - e.trimB > 30);
    const R = phys.rapier;
    for (let i = 0; i < TRAFFIC.count; i++) {
      const body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50 - i * 3, 0).setCanSleep(false));
      const collider = phys.world.createCollider(
        R.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z).setTranslation(0, 0.12, 0).setDensity(0).setFriction(0.35).setRestitution(0.1).setCollisionGroups(GROUP_CAR),
        body,
      );
      body.setEnabled(false);
      this.cars.push({
        body, collider, active: false, state: 'rue', edge: 0, forward: true, s: 0, speed: 0, x: 0, z: 0, yaw: 0,
        jx0: 0, jz0: 0, jx1: 0, jz1: 0, jyaw0: 0, jyaw1: 0, jt: 0, jlen: 1, nextEdge: 0, nextForward: true, hitTime: 0,
        color: i % TRAFFIC.colors.length, travel: 0, braking: false, stuck: 0,
      });
    }
  }

  /** Décalage latéral de la voie (conduite à gauche) pour une rue. */
  private lane(e: GraphEdge): number {
    return e.kind === 'boulevard' ? 9.5 : e.width * 0.24;
  }

  /** Point sur la voie, dans le sens de marche. */
  private lanePoint(e: GraphEdge, forward: boolean, s: number, out: { x: number; z: number; yaw: number }): void {
    const p = pointAt(e, s, this.p);
    const dir = forward ? 1 : -1;
    const tx = p.tx * dir, tz = p.tz * dir;
    const off = this.lane(e);
    // gauche du sens de marche = (tz, −tx)
    out.x = p.x + tz * off;
    out.z = p.z - tx * off;
    out.yaw = Math.atan2(tx, tz);
  }

  private readonly tmp = { x: 0, z: 0, yaw: 0 };
  /** Rues du tracé de la course en cours : la circulation y apparaît. null = toute la ville. */
  private routeEdges: GraphEdge[] | null = null;

  /** Début ou fin de course : la circulation se replace (sur le tracé, ou partout). */
  setRoute(edgeIds: number[] | null): void {
    this.clear();
    this.routeEdges = edgeIds ? [...new Set(edgeIds)].map((id) => this.graph.edges[id] as GraphEdge).filter((e) => e.length - e.trimA - e.trimB > 30) : null;
  }


  private spawn(c: TrafficCar, fx: number, fz: number, anywhere: boolean): boolean {
    for (let attempt = 0; attempt < 12; attempt++) {
      const e = this.rng.pick(this.routeEdges && this.routeEdges.length ? this.routeEdges : this.usable);
      const forward = this.rng.chance(0.5);
      const s = e.trimA + this.rng.next() * (e.length - e.trimA - e.trimB);
      this.lanePoint(e, forward, s, this.tmp);
      const d = Math.hypot(this.tmp.x - fx, this.tmp.z - fz);
      if (d > TRAFFIC.spawnMax || (!anywhere && d < TRAFFIC.spawnMin) || (anywhere && d < 35) || d < this.keepOut) continue;
      let free = true;
      for (const o of this.cars) if (o !== c && o.active && Math.hypot(o.x - this.tmp.x, o.z - this.tmp.z) < 22) free = false;
      if (!free) continue;
      c.edge = e.id; c.forward = forward; c.s = s; c.state = 'rue';
      c.x = this.tmp.x; c.z = this.tmp.z; c.yaw = this.tmp.yaw;
      c.speed = TRAFFIC.speed[e.kind] * 0.8;
      c.active = true; c.hitTime = 0; c.stuck = 0;
      const R = this.phys.rapier;
      c.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      c.body.setEnabled(true);
      c.body.setTranslation({ x: c.x, y: REST_HEIGHT, z: c.z }, true);
      c.body.setRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }, true);
      return true;
    }
    return false;
  }

  private retire(c: TrafficCar): void {
    c.active = false;
    // (rangée loin sous la carte : un corps seulement désactivé peut rester un obstacle fantôme)
    c.body.setTranslation({ x: c.x, y: -500, z: c.z }, false);
    c.body.setEnabled(false);
  }

  /** Retire toutes les voitures (début de course, par exemple). */
  clear(): void {
    for (const c of this.cars) if (c.active) this.retire(c);
    this.filled = false;
  }

  private filled = false;

  /** Prépare le carrefour au bout de la rue : choisit la suivante et le trajet pour la rejoindre. */
  private enterJunction(c: TrafficCar): void {
    const e = this.graph.edges[c.edge] as GraphEdge;
    const node = this.graph.nodes[c.forward ? e.b : e.a];
    let options = node ? node.edges.filter((id) => id !== e.id && (this.graph.edges[id] as GraphEdge).kind !== 'alley') : [];
    if (options.length === 0) options = [e.id]; // cul-de-sac : demi-tour
    const nextId = this.rng.pick(options);
    const next = this.graph.edges[nextId] as GraphEdge;
    const nextForward = nextId === e.id ? !c.forward : next.a === (c.forward ? e.b : e.a);
    c.nextEdge = nextId;
    c.nextForward = nextForward;
    c.jx0 = c.x; c.jz0 = c.z; c.jyaw0 = c.yaw;
    this.lanePoint(next, nextForward, nextForward ? next.trimA : next.length - next.trimB, this.tmp);
    c.jx1 = this.tmp.x; c.jz1 = this.tmp.z; c.jyaw1 = this.tmp.yaw;
    c.jlen = Math.max(2, Math.hypot(c.jx1 - c.jx0, c.jz1 - c.jz0));
    c.jt = 0;
    c.state = 'carrefour';
  }

  /** À appeler dans le pas fixe, AVANT world.step(). `actors` : le joueur d'abord, puis les adversaires. */
  beforeStep(dt: number, actors: TrafficActor[]): void {
    const focus = actors[0];
    if (!this.enabled || !focus) {
      if (this.filled) this.clear();
      return;
    }
    const R = this.phys.rapier;
    // Remplissage : tout de suite au début, puis une voiture à la fois.
    const limit = this.routeEdges ? TRAFFIC.raceCount : TRAFFIC.count;
    for (let i = 0; i < limit; i++) {
      const c = this.cars[i] as TrafficCar;
      if (!c.active) {
        // En course, jamais d'apparition surprise tout près : toujours à distance.
        this.spawn(c, focus.x, focus.z, !this.filled && !this.routeEdges);
        if (this.filled) break;
      }
    }
    this.filled = true;

    for (const c of this.cars) {
      if (!c.active) continue;
      const dFocus = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (c.state === 'choc') {
        const t = c.body.translation();
        const q = c.body.rotation();
        c.x = t.x; c.z = t.z;
        c.yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
        c.hitTime += dt;
        const v = c.body.linvel();
        c.speed = Math.hypot(v.x, v.z);
        if ((c.hitTime > 6 && dFocus > 60) || c.hitTime > 25 || t.y < -5) this.retire(c);
        continue;
      }
      // Bloquée trop longtemps (face à face, joueur garé devant…) : on la retire si personne ne regarde de près.
      c.stuck = c.speed < 0.3 ? c.stuck + dt : 0;
      if (dFocus > TRAFFIC.despawn || dFocus < this.keepOut || (c.stuck > 8 && dFocus > 45)) {
        this.retire(c);
        continue;
      }
      const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
      // Une voiture de course arrive vite : on rend la main à la physique juste avant le contact.
      let struck = false;
      for (const a of actors) {
        const dx = a.x - c.x, dz = a.z - c.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 9) continue;
        const closing = -((a.vx - hx * c.speed) * dx + (a.vz - hz * c.speed) * dz) / (dist || 1);
        if (dist < 3.2 || (closing > 5 && dist < 3.2 + closing * 0.22)) struck = true;
        // Contact de biais à l'arrêt (coin contre coin) : sans ça la voiture reste un mur immobile.
        if (c.stuck > 1.2 && dist < 5) struck = true;
      }
      if (struck) {
        c.state = 'choc';
        c.hitTime = 0;
        c.body.setBodyType(R.RigidBodyType.Dynamic, true);
        c.body.setAdditionalMassProperties(TRAFFIC.mass, { x: 0, y: -0.2, z: 0 }, { x: 1700, y: 1900, z: 500 }, { x: 0, y: 0, z: 0, w: 1 }, true);
        c.body.setLinearDamping(0.9);
        c.body.setAngularDamping(1.6);
        c.body.setLinvel({ x: hx * c.speed, y: 0, z: hz * c.speed }, true);
        continue;
      }

      // Obstacle devant : joueur, adversaire ou autre voiture de la circulation.
      let blocked = false;
      const ahead = (ox: number, oz: number): void => {
        const dx = ox - c.x, dz = oz - c.z;
        const along = dx * hx + dz * hz;
        if (along < 2 || along > TRAFFIC.lookAhead) return;
        if (Math.abs(dx * hz - dz * hx) < 2.3) blocked = true;
      };
      for (const a of actors) ahead(a.x, a.z);
      for (const o of this.cars) if (o !== c && o.active) ahead(o.x, o.z);

      const e = this.graph.edges[c.edge] as GraphEdge;
      const end = c.forward ? e.length - e.trimB : e.trimA;
      const toEnd = c.state === 'rue' ? Math.abs(end - c.s) : 0;
      let target: number = c.state === 'carrefour' ? TRAFFIC.junctionSpeed : TRAFFIC.speed[e.kind];
      // On ralentit à l'approche du carrefour.
      if (c.state === 'rue' && toEnd < 22) target = Math.max(TRAFFIC.junctionSpeed, target * (toEnd / 22));
      if (blocked) target = 0;
      c.braking = c.speed > target + 0.3;
      c.speed += Math.max(-TRAFFIC.brake * dt, Math.min(TRAFFIC.accel * dt, target - c.speed));
      const step = c.speed * dt;
      c.travel += step;

      if (c.state === 'rue') {
        c.s += c.forward ? step : -step;
        if ((c.forward && c.s >= end) || (!c.forward && c.s <= end)) {
          c.s = end;
          this.lanePoint(e, c.forward, c.s, this.tmp);
          c.x = this.tmp.x; c.z = this.tmp.z; c.yaw = this.tmp.yaw;
          this.enterJunction(c);
        } else {
          this.lanePoint(e, c.forward, c.s, this.tmp);
          c.x = this.tmp.x; c.z = this.tmp.z; c.yaw = this.tmp.yaw;
        }
      } else {
        c.jt = Math.min(1, c.jt + step / c.jlen);
        const k = c.jt * c.jt * (3 - 2 * c.jt);
        c.x = c.jx0 + (c.jx1 - c.jx0) * c.jt;
        c.z = c.jz0 + (c.jz1 - c.jz0) * c.jt;
        let dyaw = c.jyaw1 - c.jyaw0;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        c.yaw = c.jyaw0 + dyaw * k;
        if (c.jt >= 1) {
          const next = this.graph.edges[c.nextEdge] as GraphEdge;
          c.edge = c.nextEdge;
          c.forward = c.nextForward;
          c.s = c.forward ? next.trimA : next.length - next.trimB;
          c.state = 'rue';
        }
      }
      c.body.setNextKinematicTranslation({ x: c.x, y: REST_HEIGHT, z: c.z });
      c.body.setNextKinematicRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) });
    }
  }
}
