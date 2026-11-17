import * as THREE from 'three/webgpu';
import { CAR_SPEC, type CarTraits } from '../config/handling';
import { createCarVisual, type CarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { REST_HEIGHT } from '../vehicle/vehicle';

/** Une voiture à garer dans le garage. */
export interface GarageCar {
  glb: string | null;
  color: readonly [number, number, number];
  bigWing: boolean;
  traits: CarTraits;
}

/** Le garage est construit loin sous la ville : rien d'autre n'entre dans le champ. */
const ORIGIN = new THREE.Vector3(0, -600, 0);
const W = 26, D = 17, H = 6.2;
/** Emplacements : la voiture principale au milieu de l'atelier, les autres le long du mur du fond. */
const MAIN_BAY = { x: -3.5, z: 2.2, yaw: 0.55 };
const BAYS = [-9.6, -4.8, 0, 4.8].map((x) => ({ x: x + 0.6, z: -5.2, yaw: 0 }));

/**
 * Garage du joueur, en vrai : un atelier avec ses voitures, ses outils, et le mécano qui
 * travaille sur la voiture principale. On le regarde d'en haut, dans un coin, comme par une
 * caméra de surveillance.
 */
export class GarageScene {
  readonly group = new THREE.Group();
  private readonly cars: CarVisual[] = [];
  private readonly mech = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private time = 0;
  private token = 0;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  constructor(scene: THREE.Object3D) {
    const g = this.group;
    g.position.copy(ORIGIN);
    g.visible = false;
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
    const red = mat(0.5, 0.03, 0.03, 0.45, 0.3), steel = mat(0.35, 0.36, 0.38, 0.35, 0.8), yellow = mat(0.7, 0.5, 0.03), wood = mat(0.22, 0.13, 0.06);
    const rubber = mat(0.02, 0.02, 0.022, 0.9), blue = mat(0.04, 0.12, 0.4, 0.5, 0.2), white = mat(0.6, 0.6, 0.58);
    // ——— La pièce ———
    box(concrete, W, 0.3, D, 0, -0.15, 0);
    box(wall, W, H, 0.3, 0, H / 2, -D / 2);
    box(wall, 0.3, H, D, -W / 2, H / 2, 0);
    box(wall, 0.3, H, D, W / 2, H / 2, 0);
    box(wall, W, H, 0.3, 0, H / 2, D / 2);
    box(dark, W, 0.3, D, 0, H + 0.15, 0);
    // Bande de couleur à mi-hauteur, plinthe.
    box(mat(0.45, 0.05, 0.2), W - 0.4, 0.35, 0.05, 0, 1.4, -D / 2 + 0.18);
    box(mat(0.45, 0.05, 0.2), 0.05, 0.35, D - 0.4, -W / 2 + 0.18, 1.4, 0);
    // Marquage au sol : places le long du mur, zone de travail hachurée.
    for (const b of BAYS) for (const side of [-1, 1]) box(yellow, 0.1, 0.02, 5.2, b.x + side * 2.2, 0.011, b.z);
    for (let k = 0; k < 9; k++) box(yellow, 0.12, 0.02, 1.2, MAIN_BAY.x - 4 + k, 0.011, MAIN_BAY.z + 3.6, 0.8);
    for (let k = 0; k < 9; k++) box(yellow, 0.12, 0.02, 1.2, MAIN_BAY.x - 4 + k, 0.011, MAIN_BAY.z - 3.2, 0.8);
    // Grande porte à lames, sur le mur de droite.
    for (let k = 0; k < 14; k++) box(k % 2 ? steel : mat(0.28, 0.29, 0.31, 0.4, 0.7), 0.12, 0.32, 7.4, W / 2 - 0.2, 0.2 + k * 0.33, 1.5);
    box(yellow, 0.16, 4.9, 0.25, W / 2 - 0.22, 2.45, -2.35);
    box(yellow, 0.16, 4.9, 0.25, W / 2 - 0.22, 2.45, 5.35);
    // ——— Outils ———
    // Servantes rouges à tiroirs.
    for (const [x, z, yaw] of [[-11.6, 3.2, Math.PI / 2], [-11.6, 5.2, Math.PI / 2], [-0.4, 6.9, Math.PI]] as const) {
      const t = new THREE.Group();
      t.position.set(x, 0, z);
      t.rotation.y = yaw;
      g.add(t);
      box(red, 1.5, 1.05, 0.7, 0, 0.62, 0, 0, t);
      for (let k = 0; k < 5; k++) box(steel, 1.3, 0.03, 0.02, 0, 0.26 + k * 0.19, 0.36, 0, t);
      box(dark, 1.56, 0.05, 0.76, 0, 1.17, 0, 0, t);
      for (const sx of [-0.6, 0.6]) for (const sz of [-0.25, 0.25]) cyl(rubber, 0.06, 0.1, sx, 0.05, sz, t);
    }
    // Établi contre le mur du bas, avec étau, boîtes et panneau à outils.
    box(wood, 5.2, 0.12, 0.9, -7, 0.95, D / 2 - 0.75);
    for (const sx of [-2.4, 0, 2.4]) box(steel, 0.1, 0.9, 0.8, -7 + sx, 0.45, D / 2 - 0.75);
    box(steel, 0.35, 0.3, 0.25, -5.2, 1.16, D / 2 - 0.8);
    box(blue, 0.6, 0.3, 0.4, -8.6, 1.16, D / 2 - 0.7);
    box(red, 0.45, 0.22, 0.3, -7.6, 1.12, D / 2 - 0.6);
    box(mat(0.3, 0.2, 0.1), 5, 1.6, 0.06, -7, 2.4, D / 2 - 0.2);
    for (let k = 0; k < 11; k++) box(k % 3 === 0 ? red : steel, 0.07, 0.35 + (k % 4) * 0.12, 0.03, -9.2 + k * 0.44, 2.4 + ((k * 7) % 3) * 0.15, D / 2 - 0.25);
    // Étagères avec cartons et bidons, contre le mur du fond à droite.
    for (let lv = 0; lv < 4; lv++) box(steel, 4.4, 0.06, 0.7, 9.6, 0.5 + lv * 0.9, -D / 2 + 0.6);
    for (const sx of [-2.2, 2.2]) box(steel, 0.08, 3.5, 0.7, 9.6 + sx, 1.75, -D / 2 + 0.6);
    for (let k = 0; k < 14; k++) {
      const lv = k % 4, col = [mat(0.35, 0.25, 0.14), blue, red, white, yellow][k % 5] as THREE.Material;
      box(col, 0.5 + (k % 3) * 0.15, 0.42 + (k % 2) * 0.16, 0.5, 7.9 + (k * 0.83) % 3.6, 0.76 + lv * 0.9 + (k % 2) * 0.08, -D / 2 + 0.6);
    }
    // Piles de pneus, fûts d'huile, cric, cônes, extincteur.
    for (const [x, z, n] of [[11.4, 6.6, 4], [10.2, 7.1, 3], [-11.9, -2, 5], [-11.2, -0.8, 2]] as const) {
      for (let k = 0; k < n; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.13, 8, 18), rubber);
        t.rotation.x = Math.PI / 2;
        t.position.set(x, 0.13 + k * 0.27, z);
        g.add(t);
      }
    }
    for (const [x, z, m] of [[6.2, 7.4, blue], [5.3, 7.5, red], [-11.9, 7.4, yellow]] as const) cyl(m, 0.3, 0.9, x, 0.45, z);
    box(red, 0.5, 0.16, 1.1, MAIN_BAY.x + 2.7, 0.12, MAIN_BAY.z + 1.6, 0.4);
    cyl(steel, 0.02, 0.9, MAIN_BAY.x + 2.9, 0.5, MAIN_BAY.z + 2.1).rotation.z = 0.9;
    for (const [x, z] of [[2.2, 5.8], [3, 6.3]] as const) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 10), mat(0.9, 0.3, 0.02));
      c.position.set(x, 0.28, z);
      g.add(c);
    }
    cyl(red, 0.09, 0.5, -12.6, 1.3, 0.9);
    // Compresseur et tuyau jaune.
    cyl(blue, 0.32, 1.0, 11.8, 0.55, -3).rotation.z = Math.PI / 2;
    box(dark, 0.5, 0.35, 0.4, 11.8, 1.05, -3);
    // Enseigne au néon et éclairage : tubes au plafond.
    box(glow(1.0, 0.1, 0.5, 2.2), 3.6, 0.14, 0.06, -6.2, 4.6, -D / 2 + 0.2);
    box(glow(0.1, 0.8, 1.0, 2.2), 2.2, 0.14, 0.06, -6.2, 4.2, -D / 2 + 0.2);
    for (const k of [0, 1, 2]) box(glow(1.0, 0.1, 0.5, 2.2), 0.14, 0.7, 0.06, -9 + k * 0.5, 3.5, -D / 2 + 0.2);
    for (const [x, z] of [[-6, -2], [3, -2], [-6, 4], [3, 4]] as const) {
      box(glow(1.0, 0.93, 0.8, 2.4), 2.4, 0.06, 0.22, x, H - 0.5, z);
      box(dark, 2.6, 0.1, 0.34, x, H - 0.42, z);
      const l = new THREE.PointLight(0xfff0d8, 34, 20, 1.7);
      l.position.set(x, H - 1.0, z);
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
    scene.add(g);
  }

  /** Affiche ou cache le garage (ses lumières coûtent cher : éteintes quand on ne le regarde pas). */
  setVisible(on: boolean): void {
    this.group.visible = on;
    for (const l of this.lights) l.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Gare ces voitures : la première est la voiture principale, au milieu de l'atelier. */
  setCars(list: GarageCar[]): void {
    const token = ++this.token;
    for (const v of this.cars) {
      this.group.remove(v.root);
      v.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !mesh.userData.shared) mesh.geometry.dispose();
      });
    }
    this.cars.length = 0;
    list.slice(0, BAYS.length + 1).forEach((c, k) => {
      const bay = k === 0 ? MAIN_BAY : (BAYS[k - 1] as (typeof BAYS)[number]);
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
      this.group.add(v.root);
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

  /** Fait vivre la scène et place la caméra de surveillance. */
  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.time += dt;
    const t = this.time;
    // Le mécano tourne autour de la voiture principale : il s'arrête, bricole, repart.
    const spots = [[1.5, 1.2, -2.0], [1.3, -1.4, -1.1], [-1.4, -1.5, 1.0], [-1.5, 1.3, 2.2], [0.2, 2.9, 3.1]] as const;
    const cs = Math.cos(MAIN_BAY.yaw), sn = Math.sin(MAIN_BAY.yaw);
    const place = (k: number, out: THREE.Vector3): number => {
      const s = spots[k % spots.length] as (typeof spots)[number];
      out.set(MAIN_BAY.x + s[0] * cs + s[1] * sn, 0, MAIN_BAY.z - s[0] * sn + s[1] * cs);
      return s[2] + MAIN_BAY.yaw;
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
    // Au travail : il se penche et serre. En marche : il balance le bras.
    this.mech.rotation.x = working ? 0.32 + Math.sin(t * 1.3) * 0.04 : 0;
    this.mech.position.y = working ? -0.05 : Math.abs(Math.sin(t * 9)) * 0.03;
    this.arm.rotation.x = working ? -1.2 + Math.sin(t * 7) * 0.35 : Math.sin(t * 9) * 0.5;
    // Caméra de surveillance : en hauteur dans un coin, elle balaie lentement.
    const sway = Math.sin(t * 0.22) * 0.9;
    camera.position.set(ORIGIN.x + W / 2 - 3.5, ORIGIN.y + H - 1.1, ORIGIN.z + D / 2 - 1.0);
    camera.lookAt(ORIGIN.x - 4.2 + sway, ORIGIN.y + 0.6, ORIGIN.z - 0.2 - sway * 0.5);
    if (Math.abs(camera.fov - 54) > 0.01) { camera.fov = 54; camera.updateProjectionMatrix(); }
  }
}
