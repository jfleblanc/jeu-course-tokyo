import * as THREE from 'three/webgpu';
import { CAR_SPEC } from '../config/handling';
import { TRAFFIC } from '../config/traffic';
import { createCarVisual } from '../vehicle/carModel';
import { REST_HEIGHT } from '../vehicle/vehicle';
import type { Traffic } from '../world/traffic';

/**
 * Affichage de la circulation. Toutes les voitures sont la toute première voiture du jeu (la
 * carrosserie procédurale), dans des couleurs ordinaires. Elles sont dessinées par instances :
 * une dizaine d'appels de dessin pour toute la circulation, quel que soit le nombre de voitures.
 * Les roues ne tournent pas et les feux de frein sont fixes : c'est le prix de l'économie.
 */
export class TrafficVisuals {
  private readonly parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly car = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, traffic: Traffic) {
    const n = traffic.cars.length;
    // Voiture modèle, peinte en blanc : la couleur de chaque voiture vient de son instance.
    const tpl = createCarVisual(CAR_SPEC, { color: [1, 1, 1], lights: false });
    tpl.interior.visible = false;
    tpl.wheels.forEach((w, i) => {
      w.pivot.position.set((i % 2 === 0 ? 1 : -1) * CAR_SPEC.halfTrack, CAR_SPEC.wheelRadius - REST_HEIGHT, i < 2 ? CAR_SPEC.axleFrontZ : CAR_SPEC.axleRearZ);
    });
    tpl.root.position.set(0, 0, 0);
    tpl.root.updateMatrixWorld(true);
    const tint = new THREE.Color();
    tpl.root.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      // On saute l'habitacle et ce qui est caché.
      for (let p: THREE.Object3D | null = src; p; p = p.parent) if (!p.visible) return;
      const mesh = new THREE.InstancedMesh(src.geometry, src.material as THREE.Material, n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (src.material === tpl.paint) {
        traffic.cars.forEach((c, i) => {
          const col = TRAFFIC.colors[c.color] as [number, number, number];
          mesh.setColorAt(i, tint.setRGB(col[0], col[1], col[2]));
        });
      }
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.zero);
      scene.add(mesh);
      this.parts.push({ mesh, local: src.matrixWorld.clone() });
    });
  }

  /** `x`, `z` : position de la caméra ; au-delà de 170 m les voitures ne sont pas dessinées (brouillard). */
  update(traffic: Traffic, x: number, z: number): void {
    const cars = traffic.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.active || (c.x - x) ** 2 + (c.z - z) ** 2 > 170 * 170) {
        for (const p of this.parts) p.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const t = c.body.translation();
      const q = c.body.rotation();
      this.car.compose(this.pos.set(t.x, t.y, t.z), this.quat.set(q.x, q.y, q.z, q.w), this.one);
      for (const p of this.parts) p.mesh.setMatrixAt(i, this.m.multiplyMatrices(this.car, p.local));
    }
    for (const p of this.parts) p.mesh.instanceMatrix.needsUpdate = true;
  }
}
