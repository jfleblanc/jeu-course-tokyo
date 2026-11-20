import * as THREE from 'three/webgpu';
import { CAR_MODELS, NEON_COLORS, PAINTS } from '../config/cars';
import { CAR_SPEC } from '../config/handling';
import { NET } from '../config/net';
import { createCarVisual, type CarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { REST_HEIGHT } from '../vehicle/vehicle';
import type { Peer, Salon } from './salon';

interface Remote { visual: CarVisual; label: HTMLElement; key: string; x: number; z: number; yaw: number; shown: boolean }

/**
 * Les voitures des autres joueurs : dessinées d'après leurs messages, avec un petit retard pour
 * lisser le mouvement (interpolation entre deux états reçus). Ce sont des fantômes : pas de choc.
 */
export class RemoteCars {
  private readonly cars = new Map<number, Remote>();
  private readonly a = new THREE.Quaternion();
  private readonly b = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly labels: HTMLElement;

  constructor(private readonly scene: THREE.Object3D, private readonly salon: Salon) {
    this.labels = document.createElement('div');
    this.labels.id = 'noms-joueurs';
    document.body.append(this.labels);
  }

  /** Positions des joueurs visibles, pour la mini-carte. */
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
    label.textContent = `${peer.symbol} ${peer.name}`;
    this.labels.append(label);
    return { visual, label, key: JSON.stringify(peer.car), x: 0, z: 0, yaw: 0, shown: false };
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
    this.cars.delete(id);
  }

  update(camera: THREE.PerspectiveCamera, show: boolean): void {
    const now = performance.now() / 1000 - NET.delay;
    this.dots.length = 0;
    for (const id of [...this.cars.keys()]) if (!this.salon.peers.has(id)) this.drop(id);
    for (const peer of this.salon.peers.values()) {
      let r = this.cars.get(peer.id);
      if (r && r.key !== JSON.stringify(peer.car)) { this.drop(peer.id); r = undefined; } // il a changé de voiture
      if (!r) { r = this.build(peer); this.cars.set(peer.id, r); }
      const s = peer.samples;
      const visible = show && !peer.hidden && s.length > 0;
      r.visual.root.visible = visible;
      r.shown = visible;
      if (!visible) { r.label.style.display = 'none'; continue; }
      // Les deux états qui encadrent l'instant affiché.
      let k = s.length - 1;
      while (k > 0 && (s[k] as number[])[0]! > now) k--;
      const p0 = s[k] as number[], p1 = s[Math.min(k + 1, s.length - 1)] as number[];
      const span = p1[0]! - p0[0]!;
      const root = r.visual.root;
      if (span > 1e-4 && now <= p1[0]!) {
        const u = Math.min(1, Math.max(0, (now - p0[0]!) / span));
        root.position.set(p0[1]! + (p1[1]! - p0[1]!) * u, p0[2]! + (p1[2]! - p0[2]!) * u, p0[3]! + (p1[3]! - p0[3]!) * u);
        this.a.set(p0[4]!, p0[5]!, p0[6]!, p0[7]!);
        this.b.set(p1[4]!, p1[5]!, p1[6]!, p1[7]!);
        root.quaternion.slerpQuaternions(this.a, this.b, u);
      } else {
        // Plus rien de récent : on prolonge un instant d'après sa vitesse, puis il reste sur place.
        const ahead = Math.min(NET.extrapolate, Math.max(0, now - p1[0]!));
        root.position.set(p1[1]! + p1[8]! * ahead, p1[2]! + p1[9]! * ahead, p1[3]! + p1[10]! * ahead);
        root.quaternion.set(p1[4]!, p1[5]!, p1[6]!, p1[7]!);
      }
      // Roues avant braquées.
      const steer = p1[11]!;
      r.visual.wheels.forEach((w, i) => { if (i < 2) w.pivot.rotation.y = steer; });
      r.x = root.position.x; r.z = root.position.z;
      this.v.set(0, 0, 1).applyQuaternion(root.quaternion);
      r.yaw = Math.atan2(this.v.x, this.v.z);
      this.dots.push({ x: r.x, z: r.z, yaw: r.yaw, name: peer.name });
      // Nom au-dessus de la voiture.
      this.v.copy(root.position);
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

  /** Position d'un joueur (ou null s'il n'est pas visible) : pour savoir qui est sur une borne de départ. */
  where(id: number): { x: number; z: number } | null {
    const r = this.cars.get(id);
    return r && r.shown ? r : null;
  }
}
