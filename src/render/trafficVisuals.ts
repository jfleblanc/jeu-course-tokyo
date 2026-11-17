import * as THREE from 'three/webgpu';
import { CAR_SPEC } from '../config/handling';
import { TRAFFIC } from '../config/traffic';
import { createCarVisual, type CarVisual } from '../vehicle/carModel';
import { REST_HEIGHT } from '../vehicle/vehicle';
import type { Traffic } from '../world/traffic';

/**
 * Affichage de la circulation. Pour l'essai, toutes les voitures sont la toute première voiture
 * du jeu (la carrosserie procédurale, très légère à dessiner), dans des couleurs ordinaires.
 * Pour passer à un vrai modèle 3D : remplacer `createCarVisual` par un modèle chargé (glbCar.ts).
 */
export class TrafficVisuals {
  private readonly cars: CarVisual[] = [];

  constructor(scene: THREE.Scene, traffic: Traffic) {
    traffic.cars.forEach((c) => {
      const v = createCarVisual(CAR_SPEC, { color: TRAFFIC.colors[c.color] as [number, number, number], lights: false });
      v.interior.visible = false;
      v.wheels.forEach((w, i) => {
        w.pivot.position.set((i % 2 === 0 ? 1 : -1) * CAR_SPEC.halfTrack, CAR_SPEC.wheelRadius - REST_HEIGHT, i < 2 ? CAR_SPEC.axleFrontZ : CAR_SPEC.axleRearZ);
      });
      v.root.visible = false;
      scene.add(v.root);
      this.cars.push(v);
    });
  }

  update(traffic: Traffic): void {
    traffic.cars.forEach((c, i) => {
      const v = this.cars[i] as CarVisual;
      v.root.visible = c.active;
      if (!c.active) return;
      const t = c.body.translation();
      const q = c.body.rotation();
      v.root.position.set(t.x, t.y, t.z);
      v.root.quaternion.set(q.x, q.y, q.z, q.w);
      (v.brakeLevel as unknown as { value: number }).value = c.braking || c.speed < 0.5 ? 1 : 0;
      const spin = c.travel / CAR_SPEC.wheelRadius;
      for (const w of v.wheels) w.spin.rotation.x = spin;
    });
  }
}
