import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_SPEC, type CarTraits } from '../config/handling';
import { createCarVisual, type CarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { REST_HEIGHT } from '../vehicle/vehicle';
import { GARAGE, GARAGE_BOUNDS, garageToLocal, type GarageSite } from './garageSite';

/** Une voiture à garer dans le garage. */
export interface GarageCar {
  glb: string | null;
  color: readonly [number, number, number];
  bigWing: boolean;
  traits: CarTraits;
}

const G = GARAGE;
const W = G.halfW * 2, D = G.halfD * 2, H = G.height;
/**
 * Pièces du modèle « Car Garage | Desert Garage Environment » (DevPoly3D, CC BY-NC 4.0) gardées
 * pour meubler l'atelier : plateau tournant, servantes, établi et ses outils, panneau à outils.
 * Sa coque (murs, toit, auvent) ne sert pas : l'atelier a ses propres murs.
 */
// (le chargeur retire les points des noms : « Cube.003 » devient « Cube003 »)
const MODEL_KEEP = /^(Circle|Cube003|Cube006|Cube010|Cube005|Cube007|Cube014|Cube01[123]|Cube02[123]|Cylinder00[67])$/;
/** Le modèle a son mur d'outils en x = −8 : on le colle contre le mur −x de l'atelier. */
const MODEL_X = -G.halfW + 8;

/**
 * Garage du joueur : un atelier au sous-sol d'un immeuble de la ville, avec ses voitures, ses
 * outils et le mécano. Une rampe le relie à la rue. À l'intérieur, on le voit par une caméra de
 * surveillance, en hauteur dans un coin.
 */
export class GarageScene {
  readonly group = new THREE.Group();
  private readonly room = new THREE.Group();
  private readonly cars: CarVisual[] = [];
  private readonly mech = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private readonly site: GarageSite;
  private time = 0;
  private token = 0;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camAim = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();

  constructor(scene: THREE.Object3D, site: GarageSite | null) {
    // Sans emplacement en ville (ne devrait pas arriver) : l'atelier existe quand même, à l'écart.
    this.site = site ?? { x: 0, z: 0, yaw: 0 };
    const root = this.group;
    root.position.set(this.site.x, site ? 0 : -600, this.site.z);
    root.rotation.y = this.site.yaw;
    const g = this.room;
    g.position.y = G.floor;
    root.add(g);
    const mat = (r: number, gr: number, b: number, rough = 0.85, metal = 0): THREE.MeshStandardNodeMaterial => {
      const m = new THREE.MeshStandardNodeMaterial();
      m.color = new THREE.Color(r, gr, b);
      m.roughness = rough;
      m.metalness = metal;
      return m;
    };
    const glow = (r: number, gr: number, b: number, k = 2): THREE.MeshBasicNodeMaterial => {
      const m = new THREE.MeshBasicNodeMaterial();
      m.color = new THREE.Color(r * k, gr * k, b * k);
      return m;
    };
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, parent: THREE.Object3D = g): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      parent.add(mesh);
      return mesh;
    };
    const cyl = (m: THREE.Material, r: number, h: number, x: number, y: number, z: number, parent: THREE.Object3D = g): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const concrete = mat(0.1, 0.1, 0.11, 0.6), wall = mat(0.11, 0.115, 0.13), dark = mat(0.04, 0.04, 0.05, 0.6, 0.3);
    const red = mat(0.5, 0.03, 0.03, 0.45, 0.3), steel = mat(0.35, 0.36, 0.38, 0.35, 0.8), yellow = mat(0.7, 0.5, 0.03);
    const rubber = mat(0.02, 0.02, 0.022, 0.9), blue = mat(0.04, 0.12, 0.4, 0.5, 0.2), white = mat(0.6, 0.6, 0.58);
    const rx = (G.rampX0 + G.rampX1) / 2, rw = G.rampX1 - G.rampX0;
    // ——— L'atelier (repère : sol de l'atelier à y = 0) ———
    box(concrete, W + 0.6, 0.3, D + 0.6, 0, -0.15, 0);
    box(wall, W, H, 0.3, 0, H / 2, -G.halfD - 0.15);
    box(wall, W, H, 0.3, 0, H / 2, G.halfD + 0.15);
    box(wall, 0.3, H, D, -G.halfW - 0.15, H / 2, 0);
    // Mur côté rampe, ouvert sur la porte.
    box(wall, 0.3, H, G.doorZ0 + G.halfD, G.halfW + 0.15, H / 2, (G.doorZ0 - G.halfD) / 2);
    box(wall, 0.3, H, G.halfD - G.doorZ1, G.halfW + 0.15, H / 2, (G.doorZ1 + G.halfD) / 2);
    box(wall, 0.3, H - 3.3, G.doorZ1 - G.doorZ0, G.halfW + 0.15, 3.3 + (H - 3.3) / 2, (G.doorZ0 + G.doorZ1) / 2);
    box(dark, W + 0.6, 0.3, D + 0.6, 0, H + 0.15, 0);
    // Rideau de fer relevé, montants jaunes.
    for (let k = 0; k < 3; k++) box(steel, 0.12, 0.28, G.doorZ1 - G.doorZ0, G.halfW - 0.05, 3.2 - k * 0.3, (G.doorZ0 + G.doorZ1) / 2);
    box(yellow, 0.4, 3.3, 0.25, G.halfW + 0.15, 1.65, G.doorZ0 - 0.12);
    box(yellow, 0.4, 3.3, 0.25, G.halfW + 0.15, 1.65, G.doorZ1 + 0.12);
    // Bande de couleur à mi-hauteur.
    box(mat(0.45, 0.05, 0.2), W - 0.4, 0.3, 0.05, 0, 1.3, -G.halfD + 0.03);
    box(mat(0.45, 0.05, 0.2), W - 0.4, 0.3, 0.05, 0, 1.3, G.halfD - 0.03);
    // Marquage au sol : les places, et une flèche vers la sortie.
    for (const b of G.bays) for (const side of [-1, 1]) box(yellow, 0.1, 0.02, 4.8, b.x + side * 1.85, 0.011, b.z + 0.4);
    for (let k = 0; k < 5; k++) box(yellow, 0.9, 0.02, 0.14, 3.5 + k * 1.8, 0.011, (G.doorZ0 + G.doorZ1) / 2);
    // ——— Palier, rampe, murs de soutènement (hors de l'atelier, à ciel ouvert) ———
    const out = new THREE.Group();
    out.position.y = G.floor;
    root.add(out);
    box(concrete, rw + 0.6, 0.3, G.rampZ0 - G.landingZ0 + 0.6, rx, -0.15, (G.landingZ0 + G.rampZ0) / 2, 0, out);
    const run = G.rampZ1 - G.rampZ0, rise = -G.floor, len = Math.hypot(run, rise);
    const ramp = box(concrete, rw, 0.3, len, rx, rise / 2 - 0.15, (G.rampZ0 + G.rampZ1) / 2, 0, out);
    ramp.rotation.x = -Math.atan2(rise, run);
    // bandes de guidage lumineuses sur la rampe
    for (const sx of [-rw / 2 + 0.25, rw / 2 - 0.25]) {
      const strip = box(glow(1.0, 0.75, 0.2, 1.3), 0.12, 0.04, len, rx + sx, rise / 2 + 0.03, (G.rampZ0 + G.rampZ1) / 2, 0, out);
      strip.rotation.x = -Math.atan2(rise, run);
    }
    // mur extérieur (jusqu'à 1 m au-dessus de la rue), mur du fond du palier, mur côté immeuble
    box(wall, 0.4, rise + 1, G.rampZ1 - 3 - G.landingZ0, G.rampX1 + 0.2, (rise + 1) / 2, (G.landingZ0 + G.rampZ1 - 3) / 2, 0, out);
    box(wall, rw + 0.8, rise + 1, 0.4, rx, (rise + 1) / 2, G.landingZ0 - 0.2, 0, out);
    box(wall, 0.3, rise, G.rampZ1 - G.halfD - 0.3, G.halfW + 0.15, rise / 2, (G.rampZ1 + G.halfD + 0.3) / 2, 0, out);
    box(wall, 0.3, rise - H, G.halfD + 0.3 - G.landingZ0, G.halfW + 0.15, H + (rise - H) / 2, (G.halfD + 0.3 + G.landingZ0) / 2, 0, out);
    // ——— L'immeuble au-dessus : sobre, avec son enseigne au-dessus de la rampe ———
    const GB = GARAGE_BOUNDS;
    const bd = GB.z1 - 2 - GB.z0;
    const building = mat(0.06, 0.065, 0.08, 0.7);
    box(building, W + 0.6, G.buildingHeight, bd, 0, G.buildingHeight / 2 + 0.02, (GB.z0 + GB.z1 - 2) / 2, 0, root);
    for (let fl = 0; fl < 3; fl++) for (let k = 0; k < 6; k++) {
      box(glow(1.0, 0.8, 0.5, (k * 7 + fl * 3) % 4 === 0 ? 0.25 : 1.1), 2.4, 1.5, 0.08, -10 + k * 4, 5.2 + fl * 3.4, GB.z1 - 2 + 0.03, 0, root);
    }
    // enseigne « ガレージ » stylisée : un bandeau lumineux et une flèche vers la rampe
    box(glow(1.0, 0.1, 0.5, 2), 9, 1.1, 0.12, -3, 2.9, GB.z1 - 2 + 0.08, 0, root);
    box(glow(0.1, 0.9, 1.0, 2), 5, 0.3, 0.12, -3, 2.0, GB.z1 - 2 + 0.08, 0, root);
    box(dark, 0.3, 4.6, 0.3, G.rampX1 + 0.2, 2.3, G.rampZ1 - 3, 0, root);
    box(dark, 0.3, 4.6, 0.3, G.rampX0 - 0.3, 2.3, G.rampZ1 - 3, 0, root);
    box(dark, rw + 1.4, 1.0, 0.35, rx, 4.6, G.rampZ1 - 3, 0, root);
    box(glow(0.1, 1.0, 0.45, 2), rw - 0.6, 0.45, 0.1, rx, 4.6, G.rampZ1 - 2.8, 0, root);
    // ——— Outils (en plus de ceux du modèle 3D chargé plus bas) ———
    // Étagères avec cartons et bidons, contre le mur du fond, à droite des places.
    for (let lv = 0; lv < 4; lv++) box(steel, 3.6, 0.06, 0.6, -9.6, 0.5 + lv * 0.85, -G.halfD + 0.4);
    for (const sx of [-1.8, 1.8]) box(steel, 0.08, 3.2, 0.6, -9.6 + sx, 1.6, -G.halfD + 0.4);
    for (let k = 0; k < 12; k++) {
      const lv = k % 4, col = [mat(0.35, 0.25, 0.14), blue, red, white, yellow][k % 5] as THREE.Material;
      box(col, 0.45 + (k % 3) * 0.14, 0.4 + (k % 2) * 0.14, 0.45, -11 + ((k * 0.83) % 2.9), 0.74 + lv * 0.85 + (k % 2) * 0.07, -G.halfD + 0.4);
    }
    // Piles de pneus, fûts, cônes, extincteur.
    for (const [x, z, n] of [[11.8, 7.4, 4], [10.7, 7.6, 3], [-12.1, 7.5, 5], [-11, 7.7, 2]] as const) {
      for (let k = 0; k < n; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.13, 8, 18), rubber);
        t.rotation.x = Math.PI / 2;
        t.position.set(x, 0.13 + k * 0.27, z);
        g.add(t);
      }
    }
    for (const [x, z, m] of [[6.2, 7.6, blue], [5.3, 7.7, red], [4.4, 7.6, yellow]] as const) cyl(m, 0.3, 0.9, x, 0.45, z);
    for (const [x, z] of [[11.6, -1.2], [11.6, 6.4]] as const) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 10), mat(0.9, 0.3, 0.02));
      c.position.set(x, 0.28, z);
      g.add(c);
    }
    cyl(red, 0.09, 0.5, G.halfW - 0.3, 1.3, -3);
    // Néon et tubes au plafond.
    box(glow(1.0, 0.1, 0.5, 2.2), 3.6, 0.14, 0.06, 5.6, 3.4, -G.halfD + 0.05);
    box(glow(0.1, 0.8, 1.0, 2.2), 2.2, 0.14, 0.06, 5.6, 3.0, -G.halfD + 0.05);
    for (const [x, z] of [[-6.5, -2.5], [4, -2.5], [-6.5, 3.5], [4, 3.5]] as const) {
      box(glow(1.0, 0.93, 0.8, 2.4), 2.4, 0.06, 0.22, x, H - 0.25, z);
      box(dark, 2.6, 0.1, 0.34, x, H - 0.17, z);
      const l = new THREE.PointLight(0xfff0d8, 30, 18, 1.7);
      l.position.set(x, H - 0.7, z);
      l.visible = false;
      g.add(l);
      this.lights.push(l);
    }
    // ——— Le mécano : en combinaison, casquette, une clé à la main ———
    const suit = mat(0.05, 0.14, 0.3), skin = mat(0.55, 0.38, 0.28), cap = mat(0.5, 0.04, 0.04);
    const m = this.mech;
    box(suit, 0.18, 0.78, 0.2, -0.12, 0.39, 0, 0, m);
    box(suit, 0.18, 0.78, 0.2, 0.12, 0.39, 0, 0, m);
    box(suit, 0.48, 0.62, 0.26, 0, 1.1, 0, 0, m);
    box(skin, 0.2, 0.22, 0.2, 0, 1.55, 0, 0, m);
    box(cap, 0.23, 0.08, 0.24, 0, 1.68, 0, 0, m);
    box(cap, 0.2, 0.03, 0.14, 0, 1.65, 0.17, 0, m);
    box(suit, 0.13, 0.55, 0.14, -0.31, 1.1, 0, 0, m);
    this.arm.position.set(0.31, 1.36, 0);
    box(suit, 0.13, 0.5, 0.14, 0, -0.22, 0, 0, this.arm);
    box(steel, 0.04, 0.3, 0.04, 0, -0.56, 0.02, 0, this.arm);
    m.add(this.arm);
    g.add(m);
    scene.add(root);
    // ——— Mobilier du modèle 3D ———
    const loader = new GLTFLoader() as unknown as { loadAsync(u: string): Promise<{ scene: THREE.Group }> };
    loader
      .loadAsync(new URL('models/garage.glb', document.baseURI).href)
      .then((gltf) => {
        const keep: THREE.Object3D[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (MODEL_KEEP.test(o.name)) keep.push(o);
        });
        const holder = new THREE.Group();
        holder.position.set(MODEL_X, 0, 0);
        for (const o of keep) {
          // on garde la position que la pièce avait dans le modèle complet
          const w = o.matrixWorld.clone();
          o.removeFromParent();
          o.matrix.copy(w);
          o.matrix.decompose(o.position, o.quaternion, o.scale);
          holder.add(o);
        }
        g.add(holder);
      })
      .catch((err: unknown) => console.info('Mobilier du garage indisponible.', err));
  }

  /** Le mécano n'est là que si une voiture est sur le plateau. */
  showMechanic(on: boolean): void {
    this.mech.visible = on;
  }

  /** Allume ou éteint les lampes de l'atelier (de vraies lumières : inutile loin du garage). */
  setLights(on: boolean): void {
    for (const l of this.lights) l.visible = on;
  }

  /** Vrai si ce point du monde est dans l'atelier (sous l'immeuble). */
  contains(x: number, y: number, z: number): boolean {
    if (y > -1) return false;
    const [lx, lz] = garageToLocal(this.site, x, z);
    return Math.abs(lx) < G.halfW + 0.3 && Math.abs(lz) < G.halfD + 0.3;
  }

  /** Distance à plat entre ce point et le garage. */
  distance(x: number, z: number): number {
    return Math.hypot(x - this.site.x, z - this.site.z);
  }

  /** Place (monde) de la voiture du joueur dans l'atelier. */
  bayPose(): { x: number; y: number; z: number; yaw: number } {
    const c = Math.cos(this.site.yaw), s = Math.sin(this.site.yaw);
    return { x: this.site.x + G.mainBay.x * c + G.mainBay.z * s, y: this.group.position.y + G.floor, z: this.site.z - G.mainBay.x * s + G.mainBay.z * c, yaw: this.site.yaw + G.mainBay.yaw };
  }

  /**
   * Gare ces voitures : la première est la voiture principale, sur le plateau ; les autres le
   * long du mur. `showMain` faux : la principale n'est pas affichée (c'est la vraie voiture du
   * joueur qui est là).
   */
  setCars(list: GarageCar[], showMain = true): void {
    const token = ++this.token;
    for (const v of this.cars) {
      this.room.remove(v.root);
      v.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !mesh.userData.shared) mesh.geometry.dispose();
      });
    }
    this.cars.length = 0;
    list.slice(0, G.bays.length + 1).forEach((c, k) => {
      if (k === 0 && !showMain) return;
      const bay = k === 0 ? G.mainBay : (G.bays[k - 1] as (typeof G.bays)[number]);
      const v = createCarVisual(CAR_SPEC, { color: c.color, bigWing: c.bigWing, lights: false });
      v.interior.visible = false;
      const pose = (): void => {
        v.wheels.forEach((w, i) => {
          const front = i < 2, left = i % 2 === 0;
          const o = v.wheelOffsets[i];
          w.pivot.position.set((left ? 1 : -1) * (front ? c.traits.halfTrackFront : c.traits.halfTrackRear) + (o?.x ?? 0), CAR_SPEC.wheelRadius - REST_HEIGHT + (o?.y ?? 0), (front ? c.traits.axleFrontZ : c.traits.axleRearZ) + (o?.z ?? 0));
        });
      };
      pose();
      v.root.position.set(bay.x, REST_HEIGHT, bay.z);
      v.root.rotation.y = bay.yaw;
      this.room.add(v.root);
      this.cars.push(v);
      if (c.glb) {
        v.root.visible = false;
        void loadCarAsset(c.glb)
          .then((asset) => {
            if (token !== this.token) return;
            applyCarAsset(v, asset, CAR_SPEC, { lod: k === 0 ? 0 : 1, traits: c.traits });
            v.interior.visible = false;
            pose();
          })
          .catch(() => undefined)
          .finally(() => {
            v.root.visible = true;
          });
      }
    });
  }

  /**
   * Fait vivre la scène et place la caméra de surveillance. `follow` : point du monde que la
   * caméra accompagne (la voiture du joueur quand il roule dans l'atelier).
   */
  update(dt: number, camera: THREE.PerspectiveCamera, follow: { x: number; y: number; z: number } | null = null): void {
    this.time += dt;
    const t = this.time;
    // Le mécano tourne autour de la voiture principale : il s'arrête, bricole, repart.
    const spots = [[1.5, 1.2, -2.0], [1.3, -1.4, -1.1], [-1.4, -1.5, 1.0], [-1.5, 1.3, 2.2], [-3.4, 2.4, -1.6]] as const;
    const cs = Math.cos(G.mainBay.yaw), sn = Math.sin(G.mainBay.yaw);
    const place = (k: number, out: THREE.Vector3): number => {
      const s = spots[k % spots.length] as (typeof spots)[number];
      out.set(G.mainBay.x + s[0] * cs + s[1] * sn, 0, G.mainBay.z - s[0] * sn + s[1] * cs);
      return s[2] + G.mainBay.yaw;
    };
    const stay = 6.5, move = 1.6;
    const phase = t % (stay + move);
    const k = Math.floor(t / (stay + move));
    const yawNow = place(k, this.to);
    place(k + spots.length - 1, this.from);
    const w = Math.min(1, phase / move);
    const e = w * w * (3 - 2 * w);
    this.mech.position.lerpVectors(this.from, this.to, e);
    const working = phase > move;
    this.mech.rotation.y = working ? yawNow : Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
    this.mech.rotation.x = working ? 0.32 + Math.sin(t * 1.3) * 0.04 : 0;
    this.mech.position.y = working ? -0.05 : Math.abs(Math.sin(t * 9)) * 0.03;
    this.arm.rotation.x = working ? -1.2 + Math.sin(t * 7) * 0.35 : Math.sin(t * 9) * 0.5;
    // Caméra de surveillance : en hauteur dans le coin près de la porte ; elle balaie lentement,
    // ou accompagne la voiture qui roule.
    this.group.updateMatrixWorld();
    const sway = Math.sin(t * 0.22) * 0.9;
    this.camPos.set(5.2, H - 0.4, G.halfD - 0.7);
    this.room.localToWorld(this.camPos);
    this.camAim.set(-5.2 + sway, 0.3, -1.2 - sway * 0.3);
    this.room.localToWorld(this.camAim);
    if (follow) this.camAim.lerp(this.aim.set(follow.x, follow.y, follow.z), 0.65);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camAim);
    if (Math.abs(camera.fov - 64) > 0.01) { camera.fov = 64; camera.updateProjectionMatrix(); }
  }
}
