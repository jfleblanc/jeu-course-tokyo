import * as THREE from 'three/webgpu';
import { clamp, damp, lerp } from '../core/math';
import type { CarVisual } from '../vehicle/carModel';
import type { Vehicle } from '../vehicle/vehicle';

export type CameraMode = 'poursuite' | 'interieure';

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _eye = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Deux caméras sur un seul objet caméra :
 *  - poursuite : ressort amorti derrière la voiture, anticipe la trajectoire,
 *    champ de vision qui s'ouvre avec la vitesse, léger tremblement à haute vitesse ;
 *  - intérieure : aux yeux du conducteur, rotation légèrement amortie.
 * La caméra n'est jamais collée rigidement au châssis physique.
 */
export class CameraRig {
  mode: CameraMode = 'poursuite';
  private readonly pos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly interiorQuat = new THREE.Quaternion();
  private heading = 0;
  private fov = 62;
  private shakeT = 0;
  private initialized = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  toggle(visual: CarVisual): CameraMode {
    this.mode = this.mode === 'poursuite' ? 'interieure' : 'poursuite';
    this.applyVisibility(visual);
    this.initialized = false;
    return this.mode;
  }

  /** Après une autre vue (garage) : la caméra se replace d'un coup au lieu de traverser la carte. */
  reset(): void {
    this.initialized = false;
  }

  applyVisibility(visual: CarVisual): void {
    const inside = this.mode === 'interieure';
    visual.cabin.visible = !inside;
    visual.interior.visible = inside;
  }

  /** `lookBack` : vue arrière tant que c'est vrai (la vue normale reprend aussitôt après). */
  update(dt: number, visual: CarVisual, car: Vehicle, lookBack = false): void {
    const root = visual.root;
    const speed = car.speed;
    const speedT = clamp(speed / 70, 0, 1);

    if (this.mode === 'interieure') {
      _eye.copy(visual.eyePoint);
      // La tête recule un peu à l'accélération et plonge au freinage.
      _eye.z -= clamp(car.accelLong * 0.004, -0.05, 0.05);
      root.localToWorld(_eye);
      if (!this.initialized) {
        this.interiorQuat.copy(root.quaternion);
        this.initialized = true;
      }
      // Roulis/tangage atténués : on suit le châssis avec un léger retard.
      this.interiorQuat.slerp(root.quaternion, 1 - Math.exp(-18 * dt));
      this.camera.position.copy(_eye);
      // La caméra regarde vers −Z, la voiture avance vers +Z : demi-tour autour de Y.
      _q.setFromAxisAngle(WORLD_UP, Math.PI);
      this.camera.quaternion.copy(this.interiorQuat);
      if (!lookBack) this.camera.quaternion.multiply(_q);
      this.fov = damp(this.fov, 72 + speedT * 10, 4, dt);
    } else {
      _fwd.set(0, 0, 1).applyQuaternion(root.quaternion);
      _up.set(0, 1, 0).applyQuaternion(root.quaternion);
      // Cap suivi : mélange entre le nez de la voiture et la direction réelle du déplacement,
      // pour voir « dans » le virage pendant un drift.
      const carHeading = Math.atan2(_fwd.x, _fwd.z);
      const slipLook = clamp(car.bodySlip, -0.7, 0.7) * 0.55 * (car.forwardSpeed > 2 ? 1 : 0);
      const targetHeading = carHeading + slipLook;
      if (!this.initialized) this.heading = targetHeading;
      let diff = targetHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const reverse = car.forwardSpeed < -2 ? 0.25 : 1;
      this.heading += diff * (1 - Math.exp(-(4.2 + speedT * 3) * reverse * dt));

      const dist = lerp(6.1, 7.4, speedT);
      const height = lerp(2.15, 1.95, speedT);
      _target.copy(root.position);
      _desired.set(_target.x - Math.sin(this.heading) * dist, _target.y + height, _target.z - Math.cos(this.heading) * dist);
      _look.set(_target.x + Math.sin(this.heading) * 5, _target.y + 0.75, _target.z + Math.cos(this.heading) * 5);
      if (!this.initialized) {
        this.pos.copy(_desired);
        this.lookAt.copy(_look);
        this.initialized = true;
      }
      // Ressorts séparés pour la position et la visée.
      const kp = 1 - Math.exp(-11 * dt);
      this.pos.x += (_desired.x - this.pos.x) * kp;
      this.pos.z += (_desired.z - this.pos.z) * kp;
      this.pos.y += (_desired.y - this.pos.y) * (1 - Math.exp(-6 * dt));
      this.lookAt.lerp(_look, 1 - Math.exp(-14 * dt));
      if (this.pos.y < 0.5) this.pos.y = 0.5;

      this.camera.position.copy(this.pos);
      // Petit tremblement à haute vitesse
      this.shakeT += dt * (18 + speed * 0.4);
      const shake = Math.max(0, speedT - 0.55) * 0.035;
      this.camera.position.x += Math.sin(this.shakeT * 1.7) * shake;
      this.camera.position.y += Math.sin(this.shakeT * 2.3 + 1.3) * shake;
      _m.lookAt(this.camera.position, this.lookAt, WORLD_UP);
      if (lookBack) {
        // Vue arrière : la caméra passe devant la voiture et regarde derrière elle. Les ressorts de
        // la vue normale continuent de tourner : en relâchant, on la retrouve telle quelle.
        this.camera.position.set(_target.x + Math.sin(carHeading) * dist, _target.y + height, _target.z + Math.cos(carHeading) * dist);
        _look.set(_target.x - Math.sin(carHeading) * 5, _target.y + 0.75, _target.z - Math.cos(carHeading) * 5);
        _m.lookAt(this.camera.position, _look, WORLD_UP);
      }
      this.camera.quaternion.setFromRotationMatrix(_m);
      this.fov = damp(this.fov, 58 + speedT * 20, 3, dt);
    }
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
