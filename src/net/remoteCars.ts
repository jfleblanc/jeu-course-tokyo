import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CAR_MODELS, NEON_COLORS, PAINTS } from '../config/cars';
import { CAR_SPEC } from '../config/handling';
import { NET } from '../config/net';
import { GROUP_CAR, type PhysicsWorld } from '../physics/physicsWorld';
import { createCarVisual, type CarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { REST_HEIGHT } from '../vehicle/vehicle';
import type { Peer, Salon } from './salon';

interface Remote {
  visual: CarVisual;
  label: HTMLElement;
  key: string;
  body: RAPIER.RigidBody;
  /** Position et orientation affichées (et celles de son corps physique). */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  placed: boolean;
  shown: boolean;
  /** Corps physique actif : on peut se toucher. */
  solid: boolean;
  /** Temps restant pendant lequel la voiture reste traversable (elle vient d'apparaître ou de sauter). */
  ghost: number;
  yaw: number;
  name: string;
}

/**
 * Les voitures des autres joueurs. Chacune est placée là où elle doit être maintenant (dernier état
 * reçu, prolongé par sa vitesse) et l'affichage y glisse en douceur. Elle a un corps physique
 * « cinématique » : ma voiture la heurte comme une autre voiture, sans pouvoir la déplacer — c'est
 * l'ordinateur de l'autre joueur qui, de son côté, encaisse le choc avec ma voiture.
 */
export class RemoteCars {
  private readonly cars = new Map<number, Remote>();
  private readonly a = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly labels: HTMLElement;
  /** Nom du joueur local (pour distinguer deux joueurs du même nom). */
  myName = '';

  constructor(private readonly scene: THREE.Object3D, private readonly salon: Salon, private readonly phys: PhysicsWorld) {
    this.labels = document.createElement('div');
    this.labels.id = 'noms-joueurs';
    document.body.append(this.labels);
  }

  /** Positions des joueurs visibles, pour les cartes. */
  readonly dots: { x: number; z: number; yaw: number; name: string }[] = [];

  private build(peer: Peer): Remote {
    const m = CAR_MODELS.find((c) => c.id === peer.car?.model) ?? (CAR_MODELS[0] as (typeof CAR_MODELS)[number]);
    const paint = peer.car && peer.car.paint >= 0 ? PAINTS[peer.car.paint]?.color : undefined;
    const visual = createCarVisual(CAR_SPEC, { color: paint ?? m.color, bigWing: m.bigWing, lights: false });
    visual.interior.visible = false;
    const neon = peer.car && peer.car.neon >= 0 ? NEON_COLORS[peer.car.neon]?.color : undefined;
    visual.setUnderglow(neon ?? null);
    const pose = (): void => {
      visual.wheels.forEach((w, i) => {
        const front = i < 2, left = i % 2 === 0;
        const o = visual.wheelOffsets[i];
        w.pivot.position.set((left ? 1 : -1) * (front ? m.traits.halfTrackFront : m.traits.halfTrackRear) + (o?.x ?? 0), CAR_SPEC.wheelRadius - REST_HEIGHT + (o?.y ?? 0), (front ? m.traits.axleFrontZ : m.traits.axleRearZ) + (o?.z ?? 0));
      });
    };
    pose();
    if (m.glb) {
      void loadCarAsset(m.glb)
        .then((asset) => {
          applyCarAsset(visual, asset, CAR_SPEC, { lod: 1, traits: m.traits });
          visual.interior.visible = false;
          pose();
        })
        .catch(() => undefined);
    }
    visual.root.visible = false;
    this.scene.add(visual.root);
    const label = document.createElement('div');
    label.className = 'nom-joueur';
    this.labels.append(label);
    // Corps physique : une boîte de la taille d'une voiture, rangée sous la carte tant qu'elle ne sert pas.
    const R = this.phys.rapier;
    const body = this.phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500 - peer.id * 4, 0).setCanSleep(false));
    this.phys.world.createCollider(R.ColliderDesc.cuboid(0.9, 0.5, 2.15).setTranslation(0, 0.1, 0).setDensity(0).setFriction(0.35).setRestitution(0.15).setCollisionGroups(GROUP_CAR), body);
    return { visual, label, key: JSON.stringify(peer.car), body, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), placed: false, shown: false, solid: false, ghost: NET.ghostSeconds, yaw: 0, name: peer.name };
  }

  private drop(id: number): void {
    const r = this.cars.get(id);
    if (!r) return;
    this.scene.remove(r.visual.root);
    r.visual.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.shared) mesh.geometry.dispose();
    });
    r.label.remove();
    this.phys.world.removeRigidBody(r.body);
    this.cars.delete(id);
  }

  update(camera: THREE.PerspectiveCamera, show: boolean, dt: number): void {
    const now = performance.now() / 1000;
    this.dots.length = 0;
    for (const id of [...this.cars.keys()]) if (!this.salon.peers.has(id)) this.drop(id);
    for (const peer of this.salon.peers.values()) {
      let r = this.cars.get(peer.id);
      if (r && r.key !== JSON.stringify(peer.car)) { this.drop(peer.id); r = undefined; } // il a changé de voiture
      if (!r) { r = this.build(peer); this.cars.set(peer.id, r); }
      r.name = this.salon.label(peer, this.myName);
      const s = peer.samples;
      const present = !peer.hidden && s.length > 0;
      const visible = show && present;
      r.visual.root.visible = visible;
      r.shown = present;
      if (!present) { r.placed = false; r.ghost = NET.ghostSeconds; r.label.style.display = 'none'; continue; }
      // Où elle doit être maintenant : dernier état reçu, prolongé par sa vitesse.
      const p = s[s.length - 1] as number[];
      const ahead = Math.min(NET.extrapolate, Math.max(0, now - p[0]!));
      this.v.set(p[1]! + p[8]! * ahead, p[2]! + p[9]! * ahead, p[3]! + p[10]! * ahead);
      this.a.set(p[4]!, p[5]!, p[6]!, p[7]!);
      if (!r.placed || r.pos.distanceTo(this.v) > NET.jump) {
        // Apparition, replacement ou départ de course : on la pose d'un coup, et elle reste traversable un instant.
        r.pos.copy(this.v);
        r.quat.copy(this.a);
        r.placed = true;
        r.ghost = NET.ghostSeconds;
      } else {
        const k = 1 - Math.exp(-dt * NET.smooth);
        r.pos.lerp(this.v, k);
        r.quat.slerp(this.a, k);
      }
      r.ghost = Math.max(0, r.ghost - dt);
      const root = r.visual.root;
      root.position.copy(r.pos);
      root.quaternion.copy(r.quat);
      const steer = p[11]!;
      r.visual.wheels.forEach((w, i) => { if (i < 2) w.pivot.rotation.y = steer; });
      this.v.set(0, 0, 1).applyQuaternion(r.quat);
      r.yaw = Math.atan2(this.v.x, this.v.z);
      this.dots.push({ x: r.pos.x, z: r.pos.z, yaw: r.yaw, name: r.name });
      if (!visible) { r.label.style.display = 'none'; continue; }
      // Nom au-dessus de la voiture.
      if (r.label.textContent !== `${peer.symbol} ${r.name}`) r.label.textContent = `${peer.symbol} ${r.name}`;
      this.v.copy(r.pos);
      this.v.y += 1.7;
      const dist = this.v.distanceTo(camera.position);
      this.v.project(camera);
      if (this.v.z < 1 && dist < 220 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1) {
        r.label.style.display = 'block';
        r.label.style.transform = `translate(-50%, -100%) translate(${((this.v.x + 1) / 2) * window.innerWidth}px, ${((1 - this.v.y) / 2) * window.innerHeight}px)`;
        r.label.style.opacity = String(Math.min(1, 40 / dist + 0.35));
      } else r.label.style.display = 'none';
    }
  }

  /**
   * À appeler à chaque pas de physique, avant le calcul : place les corps des autres voitures.
   * `me` : ma voiture. Une voiture qui apparaît sur la mienne reste traversable jusqu'à ce qu'on se soit écartés.
   */
  syncBodies(me: { x: number; y: number; z: number }, mineHidden: boolean): void {
    for (const r of this.cars.values()) {
      const near = Math.hypot(r.pos.x - me.x, r.pos.y - me.y, r.pos.z - me.z);
      const want = r.shown && r.placed && !mineHidden && (r.solid ? true : r.ghost <= 0 && near > 4.6);
      if (want) {
        if (!r.solid) {
          r.body.setTranslation(r.pos, true);
          r.body.setRotation(r.quat, true);
          r.solid = true;
        }
        r.body.setNextKinematicTranslation(r.pos);
        r.body.setNextKinematicRotation(r.quat);
      } else if (r.solid || r.body.translation().y > -400) {
        r.solid = false;
        r.body.setTranslation({ x: 0, y: -500, z: 0 }, true);
      }
      // (elle vient de sauter : on repasse en fantôme)
      if (r.solid && r.ghost > 0) r.solid = false;
    }
  }

  /** Position d'un joueur (ou null s'il n'est pas là) : pour savoir qui est sur une borne de départ. */
  where(id: number): { x: number; z: number } | null {
    const r = this.cars.get(id);
    return r && r.shown && r.placed ? r.pos : null;
  }
}
