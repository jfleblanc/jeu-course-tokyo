import * as THREE from 'three/webgpu';
import { CAR_SPEC } from '../config/handling';
import { createCarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { REST_HEIGHT } from '../vehicle/vehicle';
import type { GarageCar } from '../world/garageScene';

const W = 400, H = 225, STRIP = 12;

/**
 * Photos des voitures du joueur pour le menu du garage : la voiture, avec SA peinture et SON
 * néon, est dessinée à part sur un plateau, puis l'image est relue et gardée en mémoire.
 * (Les photos fixes de `public/vignettes` servent pour le concessionnaire et en attendant.)
 */
export class CarPhotos {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, W / (H + STRIP), 0.3, 60);
  private readonly target = new THREE.RenderTarget(W, H + STRIP);
  private readonly cache = new Map<string, string>();
  private busy = false;

  constructor(private readonly renderer: THREE.WebGPURenderer, environment: THREE.Texture | null) {
    const s = this.scene;
    s.background = new THREE.Color(0.035, 0.035, 0.05);
    s.environment = environment;
    s.environmentIntensity = 0.5;
    s.add(new THREE.HemisphereLight(0xcfd8ff, 0x20222c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 6, 4);
    s.add(key);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    rim.position.set(-5, 3, -4);
    s.add(rim);
    // Plateau tournant et son liseré, mur du fond.
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.55, metalness: 0.6 }));
    disc.position.y = -0.04;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.75, 3.75, 0.05, 40), new THREE.MeshStandardMaterial({ color: 0xc8791a, roughness: 0.6 }));
    ring.position.y = -0.06;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.09;
    s.add(disc, ring, floor);
    // Repère : une bande verte en haut de l'image. Elle dit dans quel sens l'image est relue, puis on la coupe.
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial({ color: 0x00ff00, fog: false }));
    const d = 1;
    const hh = Math.tan((this.camera.fov * Math.PI) / 360) * d;
    strip.scale.set(hh * this.camera.aspect, (hh * STRIP) / (H + STRIP), 1);
    strip.position.set(0, hh - (hh * STRIP) / (H + STRIP), -d);
    this.camera.add(strip);
    s.add(this.camera);
    const a = 0.8, dist = 5.6;
    this.camera.position.set(Math.sin(a) * dist, 1.55, Math.cos(a) * dist);
    this.camera.lookAt(0, 0.45, 0);
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  /** Prépare la photo d'une voiture (une à la fois). Renvoie l'image quand elle est prête, ou `null` si occupé ou raté. */
  async take(key: string, car: GarageCar): Promise<string | null> {
    if (this.busy || this.cache.has(key)) return this.cache.get(key) ?? null;
    this.busy = true;
    const v = createCarVisual(CAR_SPEC, { color: car.color, bigWing: car.bigWing, lights: false });
    try {
      const pose = (): void => {
        v.wheels.forEach((w, i) => {
          const front = i < 2, left = i % 2 === 0;
          const o = v.wheelOffsets[i];
          w.pivot.position.set((left ? 1 : -1) * (front ? car.traits.halfTrackFront : car.traits.halfTrackRear) + (o?.x ?? 0), CAR_SPEC.wheelRadius - REST_HEIGHT + (o?.y ?? 0), (front ? car.traits.axleFrontZ : car.traits.axleRearZ) + (o?.z ?? 0));
        });
      };
      if (car.glb) applyCarAsset(v, await loadCarAsset(car.glb), CAR_SPEC, { lod: 0, traits: car.traits });
      pose();
      v.interior.visible = false;
      v.setUnderglow(car.neon ?? null);
      v.root.position.set(0, REST_HEIGHT, 0);
      this.scene.add(v.root);
      const r = this.renderer;
      const before = r.getRenderTarget();
      r.setRenderTarget(this.target);
      r.render(this.scene, this.camera); // (d'un seul tenant : aucune image du jeu ne doit se glisser pendant que la cible est détournée)
      r.setRenderTarget(before);
      const px = (await r.readRenderTargetPixelsAsync(this.target, 0, 0, W, H + STRIP)) as Uint8Array;
      const url = this.develop(px);
      this.cache.set(key, url);
      return url;
    } catch (err) {
      console.info('Photo de voiture impossible :', err);
      this.cache.set(key, ''); // on n'insiste pas : la photo fixe reste
      return null;
    } finally {
      this.scene.remove(v.root);
      this.busy = false;
    }
  }

  /** Image relue (lumière linéaire, sens inconnu) → image prête à afficher. */
  private develop(px: Uint8Array): string {
    const full = H + STRIP;
    const green = (row: number): boolean => { const i = (row * W + (W >> 1)) * 4; return (px[i + 1] as number) > 200 && (px[i] as number) < 80; };
    const topFirst = green(2) || !green(full - 3); // la bande est dans les premières lignes : image à l'endroit
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(W, H);
    const lut = new Uint8ClampedArray(256);
    // exposition, courbe douce, puis passage en sRGB
    for (let k = 0; k < 256; k++) lut[k] = 255 * Math.pow(1 - Math.exp(-(k / 255) * 2.4), 1 / 2.2);
    for (let y = 0; y < H; y++) {
      const src = topFirst ? y + STRIP : full - 1 - STRIP - y;
      for (let x = 0; x < W; x++) {
        const i = (src * W + x) * 4, o = (y * W + x) * 4;
        img.data[o] = lut[px[i] as number] as number;
        img.data[o + 1] = lut[px[i + 1] as number] as number;
        img.data[o + 2] = lut[px[i + 2] as number] as number;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.86);
  }
}
