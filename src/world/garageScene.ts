import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_SPEC, type CarTraits } from '../config/handling';
import { createCarVisual, type CarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { REST_HEIGHT } from '../vehicle/vehicle';
import { GARAGE, GARAGE_BOUNDS, GARAGE_FIXTURES, garageToLocal, type GarageSite } from './garageSite';

/** Une voiture à garer dans le garage. */
export interface GarageCar {
  glb: string | null;
  color: readonly [number, number, number];
  bigWing: boolean;
  traits: CarTraits;
  /** Néon sous la voiture, s'il y en a un. */
  neon?: readonly [number, number, number] | null;
}

const G = GARAGE;
const W = G.halfW * 2, D = G.halfD * 2, H = G.height;
/**
 * Pièces du modèle « Car Garage | Desert Garage Environment » (DevPoly3D, CC BY-NC 4.0) gardées
 * pour meubler l'atelier : plateau tournant, servantes, établi et ses outils, panneau à outils.
 * Sa coque (murs, toit, auvent) ne sert pas : l'atelier a ses propres murs.
 */
// (le chargeur retire les points des noms : « Cube.003 » devient « Cube003 »)
/** Emprise au sol d'un meuble (repère de l'atelier) et sa hauteur. */
export interface FurnitureBox { x0: number; z0: number; x1: number; z1: number; h: number }
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
  /** Appelé une fois le mobilier chargé, avec l'emprise de chaque meuble. */
  onFurniture: ((boxes: FurnitureBox[]) => void) | null = null;
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
  /** Personnage du joueur (modèle 3D articulé) : os utiles et leur orientation de repos. */
  private readonly bones = new Map<string, { bone: THREE.Object3D; rest: THREE.Quaternion; side: number }>();
  private hasCharacter = false;
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  /** Animations du personnage (reportées d'une bibliothèque libre) : travail à genoux, repos, marche. */
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private playing = '';
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly qc = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

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
        // Encombrement de chaque meuble posé au sol, dans le repère de l'atelier : il devient solide.
        holder.updateMatrixWorld(true);
        const bb = new THREE.Box3();
        const boxes: FurnitureBox[] = [];
        for (const o of keep) {
          bb.setFromObject(o);
          // (boîte en coordonnées du monde : on la ramène dans le repère de l'atelier, sol à 0)
          const y0 = bb.min.y - this.group.position.y - G.floor, y1 = bb.max.y - this.group.position.y - G.floor;
          if (bb.isEmpty() || y0 > 0.5 || y1 < 0.35) continue; // accroché au mur, posé sur l'établi ou à plat au sol
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (const [wx, wz] of [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.min.x, bb.max.z], [bb.max.x, bb.max.z]] as const) {
            const [lx, lz] = garageToLocal(this.site, wx, wz);
            x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
          }
          boxes.push({ x0, z0, x1, z1, h: Math.min(y1, 2.2) });
        }
        this.furniture = boxes;
        this.onFurniture?.(boxes);
      })
      .catch((err: unknown) => console.info('Mobilier du garage indisponible.', err));
    // ——— Le personnage du joueur : « Kaku » (Cyrone, CC BY 4.0), à la place de la silhouette ———
    loader
      .loadAsync(new URL('models/kaku.glb', document.baseURI).href)
      .then((gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        // Taille mesurée sur le squelette (un maillage articulé est dessiné d'après ses os, pas
        // d'après la place de son nœud : sa boîte englobante peut être dans une autre unité).
        const bb = new THREE.Box3();
        const bp = new THREE.Vector3();
        model.traverse((o) => {
          if (/^CH_/.test(o.name)) bb.expandByPoint(bp.setFromMatrixPosition(o.matrixWorld));
        });
        // (des orteils au haut du crâne : un peu plus que du premier au dernier os)
        const k = 1.62 / Math.max(0.01, bb.max.y - bb.min.y);
        model.scale.multiplyScalar(k);
        model.position.set(-((bb.min.x + bb.max.x) / 2) * k, -bb.min.y * k + 0.06, -((bb.min.z + bb.max.z) / 2) * k);
        model.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh;
          if (mesh.isMesh) mesh.frustumCulled = false; // (les os bougent : la boîte d'origine ne vaut plus)
          const mt = /^CH_([A-Za-z]+\d?)_\d+$/.exec(o.name);
          if (mt) this.bones.set(mt[1] as string, { bone: o, rest: o.quaternion.clone(), side: 0 });
        });
        for (const b of [...this.mech.children]) this.mech.remove(b);
        this.mech.add(model);
        this.mech.rotation.set(0, 0, 0);
        this.mech.updateMatrixWorld(true);
        // De quel côté est chaque bras (x du personnage) : sert au sens des rotations.
        const inv = new THREE.Matrix4().copy(this.mech.matrixWorld).invert();
        const v = new THREE.Vector3();
        for (const e of this.bones.values()) e.side = Math.sign(v.setFromMatrixPosition(e.bone.matrixWorld).applyMatrix4(inv).x) || 1;
        // Une clé à cliquet dans la main droite, tenue dans le poing (taille compensée : les os ne sont pas à l'échelle 1).
        const hand = this.bones.get('RightHand')?.bone;
        if (hand) {
          const ws = hand.getWorldScale(new THREE.Vector3()).x || 1;
          const tool = new THREE.Group();
          const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.3, metalness: 0.9 });
          const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.13, 8), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
          grip.position.y = -0.03;
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 6), chrome);
          shaft.position.y = 0.09;
          const head = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.022, 10), chrome);
          head.rotation.x = Math.PI / 2;
          head.position.y = 0.16;
          const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.04, 8), chrome);
          socket.rotation.x = Math.PI / 2;
          socket.position.set(0, 0.16, -0.03);
          tool.add(grip, shaft, head, socket);
          // dans le poing : le manche traverse la paume d'avant en arrière, la tête dépasse devant
          tool.rotation.x = Math.PI / 2;
          tool.scale.setScalar(1 / ws);
          tool.position.set(-0.085 / ws, -0.025 / ws, 0.0);
          hand.add(tool);
        }
        // Doigts : poing fermé à droite (il tient l'outil), main détendue à gauche.
        for (const [name, e] of this.bones) {
          const m = /^(Left|Right)Hand(Index|Middle|Ring)(\d)$/.exec(name);
          if (!m) continue;
          const right = m[1] === 'Right';
          const curl = (right ? 1.05 : 0.35) * (m[3] === '1' ? 0.9 : 1);
          e.bone.quaternion.multiply(this.qa.setFromAxisAngle(this.axisZ, right ? curl : -curl));
          e.rest.copy(e.bone.quaternion);
        }
        void this.loadAnimations(model);
        this.hasCharacter = true;
      })
      .catch((err: unknown) => console.info('Personnage indisponible, silhouette conservée.', err));
  }

  /** Charge les animations du personnage (fichier produit par tools/retarget-anim.mjs). */
  private async loadAnimations(model: THREE.Object3D): Promise<void> {
    try {
      const res = await fetch(new URL('models/kaku-anims.json', document.baseURI).href);
      if (!res.ok) return;
      const data = (await res.json()) as { fps: number; clips: Record<string, { duration: number; frames: number; tracks: Record<string, { q: number[]; p?: number[] }> }> };
      const mixer = new THREE.AnimationMixer(model);
      for (const [name, clip] of Object.entries(data.clips)) {
        const times = Array.from({ length: clip.frames }, (_, k) => k / data.fps);
        const tracks: THREE.KeyframeTrack[] = [];
        for (const [bone, tr] of Object.entries(clip.tracks)) {
          const node = THREE.PropertyBinding.sanitizeNodeName(bone);
          tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, tr.q));
          if (tr.p) tracks.push(new THREE.VectorKeyframeTrack(`${node}.position`, times, tr.p));
        }
        const action = mixer.clipAction(new THREE.AnimationClip(name, clip.duration, tracks));
        action.play();
        action.setEffectiveWeight(0);
        this.actions.set(name, action);
      }
      this.mixer = mixer;
    } catch (err) {
      console.info('Animations du personnage indisponibles, pose calculée conservée.', err);
    }
  }

  /** Joue une animation (fondu d'un quart de seconde avec la précédente). Faux si les animations ne sont pas chargées. */
  private animate(name: 'travail' | 'repos' | 'marche', dt: number, speed = 1): boolean {
    const mixer = this.mixer;
    if (!mixer) return false;
    if (name !== this.playing) this.playing = name;
    for (const [k, a] of this.actions) {
      const target = k === name ? 1 : 0;
      const w = a.getEffectiveWeight();
      a.setEffectiveWeight(w + Math.sign(target - w) * Math.min(Math.abs(target - w), dt * 4));
      if (k === name) a.setEffectiveTimeScale(speed);
    }
    mixer.update(dt);
    return true;
  }

  /**
   * Tourne un os d'un angle donné dans le repère du personnage (x = sa droite/gauche, y = haut,
   * z = devant lui), par-dessus sa pose de repos — quels que soient les axes propres de l'os.
   */
  private turn(name: string, rx: number, ry: number, rz: number): void {
    const e = this.bones.get(name);
    if (!e || !e.bone.parent) return;
    // orientation du parent dans le repère du personnage
    this.mech.getWorldQuaternion(this.qa).invert();
    e.bone.parent.getWorldQuaternion(this.qb);
    this.qa.multiply(this.qb);
    this.qc.setFromEuler(this.euler.set(rx, ry, rz * e.side, 'XYZ'));
    // os = parent⁻¹ · rotation · parent · repos
    e.bone.quaternion.copy(this.qa).invert().multiply(this.qc).multiply(this.qa).multiply(e.rest);
  }

  /** Pose du personnage : au travail (penché, bras en avant, il serre) ou en marche. */
  private poseCharacter(working: boolean, t: number, still = false): void {
    const step = still ? 0 : Math.sin(t * 9);
    this.turn('Spine', working ? 0.38 + Math.sin(t * 1.3) * 0.04 : 0.03, 0, 0);
    this.mech.updateMatrixWorld(true);
    for (const [arm, fore, leg, shin, ph] of [['LeftArm', 'LeftForeArm', 'LeftUpLeg', 'LeftLeg', 1], ['RightArm', 'RightForeArm', 'RightUpLeg', 'RightLeg', -1]] as const) {
      const work = Math.sin(t * 7 + ph);
      // bras : de la pose en croix vers le bas (autour de z), puis vers l'avant (autour de x)
      this.turn(arm, working ? -0.62 + work * 0.1 : step * ph * 0.45, 0, -1.3);
      this.turn(leg, working ? -0.12 : -step * ph * 0.5, 0, 0);
      this.mech.updateMatrixWorld(true);
      this.turn(fore, working ? -0.55 + work * 0.3 : still ? -0.1 : -0.25, 0, 0);
      this.turn(shin, working ? 0.22 : Math.max(0, step * ph) * 0.6, 0, 0);
    }
    this.turn('Head', working ? 0.25 : 0, 0, 0);
  }

  // ——— À pied dans l'atelier ———
  /** Le joueur marche (repère de l'atelier) ; `null` quand le personnage n'est pas commandé. */
  walker: { x: number; z: number; yaw: number; moving: boolean; stride: number } | null = null;
  /** Nombre de voitures garées le long du mur (elles font obstacle et on peut y monter). */
  parkedCount = 0;
  private furniture: FurnitureBox[] = [];

  /** Il descend de la voiture du plateau, côté conducteur. */
  startWalk(): void {
    this.walker = { x: G.mainBay.x + 0.3, z: G.mainBay.z - 1.7, yaw: Math.PI, moving: false, stride: 0 };
    this.mech.visible = true;
  }

  stopWalk(): void {
    this.walker = null;
  }

  /** Avance (`forward` : −1..1) et tourne (`turn` > 0 : à gauche), sans traverser murs, meubles et voitures. */
  walk(dt: number, forward: number, turn: number): void {
    const w = this.walker;
    if (!w) return;
    w.yaw += turn * 2.7 * dt;
    const speed = forward * (forward > 0 ? 3.1 : 1.6);
    w.moving = Math.abs(speed) > 0.2;
    if (w.moving) w.stride += dt * Math.sign(speed);
    w.x += Math.sin(w.yaw) * speed * dt;
    w.z += Math.cos(w.yaw) * speed * dt;
    const R = 0.36;
    const out = (x0: number, z0: number, x1: number, z1: number): void => {
      if (w.x < x0 - R || w.x > x1 + R || w.z < z0 - R || w.z > z1 + R) return;
      // sortie par le côté le plus proche
      const dl = w.x - (x0 - R), dr = x1 + R - w.x, db = w.z - (z0 - R), df = z1 + R - w.z;
      const m = Math.min(dl, dr, db, df);
      if (m === dl) w.x = x0 - R; else if (m === dr) w.x = x1 + R; else if (m === db) w.z = z0 - R; else w.z = z1 + R;
    };
    out(G.mainBay.x - 2.3, G.mainBay.z - 1.0, G.mainBay.x + 2.3, G.mainBay.z + 1.0);
    for (let k = 0; k < Math.min(this.parkedCount, G.bays.length); k++) {
      const b = G.bays[k] as (typeof G.bays)[number];
      out(b.x - 1.0, b.z - 2.3, b.x + 1.0, b.z + 2.3);
    }
    for (const f of GARAGE_FIXTURES) out(f[0], f[1], f[2], f[3]);
    for (const f of this.furniture) out(f.x0, f.z0, f.x1, f.z1);
    w.x = Math.max(-G.halfW + 0.45, Math.min(G.halfW - 0.45, w.x));
    w.z = Math.max(-G.halfD + 0.45, Math.min(G.halfD - 0.45, w.z));
  }

  /** Voiture à portée de main : −1 aucune, 0 celle du plateau, k ≥ 1 la k-ième garée le long du mur. */
  nearCar(): number {
    const w = this.walker;
    if (!w) return -1;
    let best = -1, bd = 2.2;
    const near = (k: number, x0: number, z0: number, x1: number, z1: number): void => {
      const d = Math.hypot(Math.max(x0 - w.x, 0, w.x - x1), Math.max(z0 - w.z, 0, w.z - z1));
      if (d < bd - 1.3) { bd = d + 1.3; best = k; }
    };
    near(0, G.mainBay.x - 2.3, G.mainBay.z - 1.0, G.mainBay.x + 2.3, G.mainBay.z + 1.0);
    for (let k = 0; k < Math.min(this.parkedCount, G.bays.length); k++) {
      const b = G.bays[k] as (typeof G.bays)[number];
      near(k + 1, b.x - 1.0, b.z - 2.3, b.x + 1.0, b.z + 2.3);
    }
    return best;
  }

  /** Caméra à la troisième personne, derrière le personnage, sans sortir de la pièce. */
  private walkCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const w = this.walker;
    if (!w) return;
    this.group.updateMatrixWorld();
    this.camPos.set(w.x - Math.sin(w.yaw) * 3.4, 2.15, w.z - Math.cos(w.yaw) * 3.4);
    this.camPos.x = Math.max(-G.halfW + 0.5, Math.min(G.halfW - 0.5, this.camPos.x));
    this.camPos.z = Math.max(-G.halfD + 0.5, Math.min(G.halfD - 0.5, this.camPos.z));
    this.room.localToWorld(this.camPos);
    this.camAim.set(w.x + Math.sin(w.yaw) * 1.2, 1.25, w.z + Math.cos(w.yaw) * 1.2);
    this.room.localToWorld(this.camAim);
    // (la caméra suit en douceur : pas d'à-coup quand on tourne)
    camera.position.lerp(this.camPos, Math.min(1, dt * 7));
    camera.lookAt(this.camAim);
    if (Math.abs(camera.fov - 62) > 0.01) { camera.fov = 62; camera.updateProjectionMatrix(); }
  }

  /** Montée en voiture : 0 = pas commencée, puis de 0 à 1 (il va à la portière et s'installe). */
  boarding = 0;

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

  /** Ramène un point (la caméra) à l'intérieur de l'atelier : sous le plafond, entre les murs. */
  keepInside(p: THREE.Vector3): void {
    this.room.updateMatrixWorld();
    this.room.worldToLocal(p);
    p.x = Math.max(-G.halfW + 0.5, Math.min(G.halfW - 0.5, p.x));
    p.z = Math.max(-G.halfD + 0.5, Math.min(G.halfD - 0.5, p.z));
    p.y = Math.min(p.y, H - 0.7);
    this.room.localToWorld(p);
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
      v.setUnderglow(c.neon ?? null);
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
    // Postes de travail : à genoux devant chaque roue, puis devant le pare-chocs. [côté, le long de la voiture]
    const spots = [[1.5, 1.3], [1.5, -1.3], [-1.5, -1.3], [-1.5, 1.3], [0, 3.0]] as const;
    const cs = Math.cos(G.mainBay.yaw), sn = Math.sin(G.mainBay.yaw);
    const place = (k: number, out: THREE.Vector3): number => {
      const s = spots[k % spots.length] as (typeof spots)[number];
      out.set(G.mainBay.x + s[0] * cs + s[1] * sn, 0, G.mainBay.z - s[0] * sn + s[1] * cs);
      // il regarde la voiture : la roue en face de lui, ou le centre s'il est devant
      const along = s[0] === 0 ? 0 : s[1];
      return Math.atan2(G.mainBay.x + along * sn - out.x, G.mainBay.z + along * cs - out.z);
    };
    const stay = 12.9, move = 2.2; // (deux tours de l'animation de travail, puis il change de roue)
    const phase = t % (stay + move);
    const k = Math.floor(t / (stay + move));
    const yawNow = place(k, this.to);
    place(k + spots.length - 1, this.from);
    const w = Math.min(1, phase / move);
    const e = w * w * (3 - 2 * w);
    this.mech.position.lerpVectors(this.from, this.to, e);
    let working = phase > move;
    if (this.walker && this.boarding === 0) {
      // Le joueur commande le personnage.
      const w = this.walker;
      this.mech.scale.setScalar(1);
      this.mech.position.set(w.x, w.moving ? Math.abs(Math.sin(w.stride * 9)) * 0.02 : 0, w.z);
      this.mech.rotation.set(0, w.yaw, 0);
      if (this.hasCharacter && !this.animate(w.moving ? 'marche' : 'repos', dt, 1.25)) { this.mech.updateMatrixWorld(true); this.poseCharacter(false, w.stride, !w.moving); }
      if (this.mixer) this.mech.position.y = 0;
      this.walkCamera(camera, dt);
      return;
    }
    if (this.boarding > 0) {
      // Il lâche tout, rejoint la portière du conducteur et se glisse au volant.
      const f = Math.min(1, this.boarding);
      const door = this.from.set(G.mainBay.x + 1.25 * cs + 0.1 * sn, 0, G.mainBay.z - 1.25 * sn + 0.1 * cs);
      this.mech.position.lerp(door, Math.min(1, f * 1.6));
      this.mech.rotation.y = Math.atan2(G.mainBay.x - this.mech.position.x, G.mainBay.z - this.mech.position.z);
      const duck = Math.max(0, (f - 0.6) / 0.4);
      this.mech.scale.setScalar(1 - duck * 0.85);
      this.mech.position.x += (G.mainBay.x - this.mech.position.x) * duck * 0.5;
      this.mech.position.z += (G.mainBay.z - this.mech.position.z) * duck * 0.5;
      if (this.hasCharacter && !this.animate('marche', dt, 1.3)) { this.mech.updateMatrixWorld(true); this.poseCharacter(false, t * 1.4); }
      this.placeCamera(camera, follow);
      return;
    }
    this.mech.scale.setScalar(1);
    this.mech.rotation.y = working ? yawNow : Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
    if (this.hasCharacter) {
      if (!this.animate(working ? 'travail' : 'marche', dt)) {
        this.mech.position.y = working ? 0 : Math.abs(Math.sin(t * 9)) * 0.02;
        this.mech.updateMatrixWorld(true);
        this.poseCharacter(working, t);
      }
    } else {
      this.mech.rotation.x = working ? 0.32 + Math.sin(t * 1.3) * 0.04 : 0;
      this.mech.position.y = working ? -0.05 : Math.abs(Math.sin(t * 9)) * 0.03;
      this.arm.rotation.x = working ? -1.2 + Math.sin(t * 7) * 0.35 : Math.sin(t * 9) * 0.5;
    }
    this.placeCamera(camera, follow);
  }

  private placeCamera(camera: THREE.PerspectiveCamera, follow: { x: number; y: number; z: number } | null): void {
    const t = this.time;
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
