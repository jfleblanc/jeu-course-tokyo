import * as THREE from 'three/webgpu';
import { color, float, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CarSpec } from '../config/handling';
import { REST_HEIGHT, type Vehicle } from './vehicle';

/**
 * Voiture procédurale (prototype) : carrosserie extrudée à partir d'un profil,
 * habitacle vitré, roues séparées qui tournent et braquent, phares, feux, intérieur.
 *
 * Emplacements prévus pour un futur modèle glTF : `body` (carrosserie), `wheels[i]`
 * (pivot de roue : position + braquage, enfant `spin` pour la rotation), `interior`
 * et `eyePoint` (caméra intérieure). Remplacer les maillages sans toucher au reste.
 *
 * Repère voiture : +Z = avant, +X = gauche, +Y = haut. Origine = centre du châssis.
 */
export interface CarVisual {
  root: THREE.Group;
  body: THREE.Group;
  /** Vitres et toit, masqués en vue intérieure. */
  cabin: THREE.Group;
  interior: THREE.Group;
  steeringWheel: THREE.Object3D;
  wheels: { pivot: THREE.Group; spin: THREE.Group }[];
  /** Position des yeux du conducteur (volant à droite, comme au Japon). */
  eyePoint: THREE.Vector3;
  headlight: THREE.SpotLight;
  brakeLevel: ReturnType<typeof uniform>;
  reverseLevel: ReturnType<typeof uniform>;
}

/**
 * Fusionne tous les maillages d'un groupe en un seul maillage par matériau.
 * Une voiture passe ainsi d'environ 80 appels de dessin à une vingtaine (important avec les adversaires).
 */
function mergeByMaterial(group: THREE.Object3D): void {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  for (const m of meshes) {
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    // On ne garde que les attributs communs à toutes les formes.
    for (const name of Object.keys(src.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') src.deleteAttribute(name);
    src.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
    const mat = m.material as THREE.Material;
    const list = buckets.get(mat);
    if (list) list.push(src);
    else buckets.set(mat, [src]);
  }
  for (const child of [...group.children]) group.remove(child);
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (merged) group.add(new THREE.Mesh(merged, mat));
    for (const g of geos) g.dispose();
  }
}

/**
 * Extrude un profil latéral (z, y) sur la largeur de la voiture.
 * `arches` : passages de roue découpés dans le bas du profil (le dernier point du
 * profil doit être à l'avant, en bas ; le premier à l'arrière, en bas).
 */
function extrudeProfile(points: [number, number][], width: number, bevel: number, arches: { z: number; y: number; r: number }[] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([z, y], k) => (k === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  const bottom = (points[points.length - 1] as [number, number])[1];
  // Retour vers l'arrière le long du bas de caisse, en contournant chaque roue.
  for (const a of [...arches].sort((m, n) => n.z - m.z)) {
    const dy = bottom - a.y;
    const dz = Math.sqrt(Math.max(0, a.r * a.r - dy * dy));
    const ang = Math.atan2(dy, dz);
    shape.lineTo(a.z + dz, bottom);
    shape.absarc(a.z, a.y, a.r, ang, Math.PI - ang, false);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments: 20,
  });
  // L'extrusion part le long de +Z ; on la couche sur X et on la centre.
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export interface CarVisualOptions {
  /** Couleur de carrosserie (linéaire). */
  color?: readonly [number, number, number];
  /** Faux pour les adversaires : pas de vraies lumières (elles coûtent cher), seulement les feux émissifs. */
  lights?: boolean;
}

export function createCarVisual(spec: CarSpec, options: CarVisualOptions = {}): CarVisual {
  const root = new THREE.Group();
  root.name = 'voiture';
  const body = new THREE.Group();
  const cabin = new THREE.Group();
  const interior = new THREE.Group();
  root.add(body, cabin, interior);

  const ground = -REST_HEIGHT; // hauteur du sol dans le repère voiture
  const wheelY = ground + spec.wheelRadius;

  // ——— Matériaux ———
  const paint = new THREE.MeshPhysicalNodeMaterial();
  const paintColor = options.color ?? [0.72, 0.035, 0.05];
  paint.colorNode = color(paintColor[0], paintColor[1], paintColor[2]);
  paint.metalnessNode = float(0.55);
  paint.roughnessNode = float(0.32);
  // Adversaires : vernis plus mat, sinon nos phares font une tache blanche sur leur coffre.
  const glossy = options.lights !== false;
  paint.metalnessNode = float(glossy ? 0.55 : 0.25);
  paint.roughnessNode = float(glossy ? 0.32 : 0.55);
  paint.clearcoatNode = float(glossy ? 1.0 : 0.2);
  paint.clearcoatRoughnessNode = float(glossy ? 0.06 : 0.4);

  const dark = new THREE.MeshStandardNodeMaterial();
  dark.colorNode = color(0.018, 0.018, 0.02);
  dark.roughnessNode = float(0.55);

  const glass = new THREE.MeshPhysicalNodeMaterial();
  glass.colorNode = color(0.01, 0.014, 0.02);
  glass.roughnessNode = float(0.42);
  glass.metalnessNode = float(0.3);

  const rubber = new THREE.MeshStandardNodeMaterial();
  rubber.colorNode = color(0.012, 0.012, 0.013);
  rubber.roughnessNode = float(0.85);

  const rim = new THREE.MeshStandardNodeMaterial();
  rim.colorNode = color(0.5, 0.52, 0.56);
  rim.metalnessNode = float(0.95);
  rim.roughnessNode = float(0.25);

  const trim = new THREE.MeshStandardNodeMaterial();
  trim.colorNode = color(0.03, 0.03, 0.034);
  trim.roughnessNode = float(0.7);

  const brakeLevel = uniform(0);
  const reverseLevel = uniform(0);
  const headMat = new THREE.MeshBasicNodeMaterial();
  headMat.colorNode = vec3(0.85, 0.92, 1.0).mul(7.0);
  const tailMat = new THREE.MeshBasicNodeMaterial();
  tailMat.colorNode = vec3(1.0, 0.03, 0.02).mul(brakeLevel.mul(5.5).add(1.4));
  const reverseMat = new THREE.MeshBasicNodeMaterial();
  reverseMat.colorNode = vec3(1.0, 1.0, 0.95).mul(reverseLevel.mul(4.0).add(0.05));
  const dashGlow = new THREE.MeshBasicNodeMaterial();
  dashGlow.colorNode = vec3(0.1, 0.8, 1.0).mul(1.6);
  const dashGlow2 = new THREE.MeshBasicNodeMaterial();
  dashGlow2.colorNode = vec3(1.0, 0.25, 0.5).mul(1.2);

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const boxGeo = (sx: number, sy: number, sz: number): THREE.BoxGeometry => new THREE.BoxGeometry(sx, sy, sz);

  // ——— Carrosserie : profil latéral (z, y), de l'arrière vers l'avant ———
  const R = spec.wheelRadius + 0.055;
  const lower = extrudeProfile(
    [
      [-2.16, -0.38], // bas du pare-chocs arrière
      [-2.25, -0.2],
      [-2.24, 0.12],
      [-2.12, 0.27], // arête du coffre (queue de canard)
      [-1.5, 0.25],
      [-1.2, 0.24],
      [0.72, 0.22], // base du pare-brise
      [1.45, 0.13], // capot
      [2.02, 0.0],
      [2.22, -0.12], // nez
      [2.24, -0.28],
      [2.14, -0.38], // lame avant
    ],
    1.8,
    0.07,
    [
      { z: spec.axleFrontZ, y: wheelY + 0.02, r: R },
      { z: spec.axleRearZ, y: wheelY + 0.02, r: R },
    ],
  );
  mesh(lower, paint, body);
  // Intérieur des passages de roue (sinon on voit à travers)
  for (const z of [spec.axleFrontZ, spec.axleRearZ]) mesh(boxGeo(1.2, 0.5, 0.86), dark, body, 0, wheelY + 0.12, z);
  // Bas de caisse, diffuseur, calandre, lame
  mesh(boxGeo(1.86, 0.1, 2.0), trim, body, 0, -0.37, 0.02);
  mesh(boxGeo(1.5, 0.16, 0.12), trim, body, 0, -0.3, -2.2);
  mesh(boxGeo(1.3, 0.16, 0.08), dark, body, 0, -0.2, 2.235);
  mesh(boxGeo(1.84, 0.04, 0.3), trim, body, 0, -0.39, 2.12);
  // Sorties d'échappement
  const pipe = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10);
  pipe.rotateX(Math.PI / 2);
  for (const x of [-0.5, -0.38, 0.38, 0.5]) mesh(pipe, rim, body, x, -0.3, -2.25);
  // Aileron
  mesh(boxGeo(1.62, 0.035, 0.3), trim, body, 0, 0.5, -2.02).rotation.x = -0.1;
  for (const x of [-0.6, 0.6]) mesh(boxGeo(0.04, 0.24, 0.16), trim, body, x, 0.38, -1.98);
  // Rétroviseurs
  for (const x of [-0.96, 0.96]) mesh(boxGeo(0.2, 0.11, 0.1), paint, body, x, 0.31, 0.62);

  // Phares, feux arrière (bandeau pleine largeur), feux de recul
  for (const x of [-0.64, 0.64]) {
    mesh(boxGeo(0.4, 0.07, 0.06), headMat, body, x, -0.02, 2.19).rotation.y = x > 0 ? -0.3 : 0.3;
    mesh(boxGeo(0.22, 0.03, 0.05), headMat, body, x * 0.98, -0.2, 2.24);
  }
  mesh(boxGeo(1.6, 0.06, 0.05), tailMat, body, 0, 0.13, -2.255);
  for (const x of [-0.7, 0.7]) mesh(boxGeo(0.28, 0.11, 0.05), tailMat, body, x, 0.13, -2.26);
  for (const x of [-0.3, 0.3]) mesh(boxGeo(0.12, 0.05, 0.05), reverseMat, body, x, -0.08, -2.262);

  // ——— Habitacle (vitres + toit), masqué en vue intérieure ———
  const greenhouse = extrudeProfile(
    [
      [-1.5, 0.24],
      [-0.92, 0.6],
      [-0.2, 0.675],
      [0.12, 0.66],
      [0.8, 0.22],
    ],
    1.52,
    0.06,
  );
  mesh(greenhouse, glass, cabin);
  const roof = extrudeProfile(
    [
      [-0.98, 0.585],
      [-0.2, 0.69],
      [0.16, 0.672],
      [0.12, 0.62],
      [-0.2, 0.64],
      [-0.9, 0.56],
    ],
    1.5,
    0.02,
  );
  mesh(roof, paint, cabin);
  // Montants
  for (const x of [-0.74, 0.74]) {
    const a = mesh(boxGeo(0.06, 0.62, 0.07), paint, cabin, x, 0.44, 0.47);
    a.rotation.x = 0.98;
  }

  // ——— Intérieur (vue conducteur) ———
  // Posé au-dessus du plancher de la coque (y ≈ 0.25) : la carrosserie est un volume plein.
  const driverX = -0.37; // volant à droite
  mesh(boxGeo(1.46, 0.012, 2.1), dark, interior, 0, 0.306, -0.3); // plancher sombre
  mesh(boxGeo(1.5, 0.13, 0.4), trim, interior, 0, 0.315, 0.74); // planche de bord
  mesh(boxGeo(1.46, 0.02, 0.36), dark, interior, 0, 0.385, 0.86); // dessus de planche, vers le pare-brise
  mesh(boxGeo(0.4, 0.06, 0.14), trim, interior, driverX, 0.41, 0.62); // casquette des compteurs
  mesh(boxGeo(0.26, 0.05, 0.01), dashGlow, interior, driverX, 0.365, 0.548); // compteurs
  mesh(boxGeo(0.2, 0.09, 0.01), dashGlow2, interior, 0.04, 0.335, 0.535); // écran central
  mesh(boxGeo(0.22, 0.07, 0.8), trim, interior, 0, 0.345, 0.1); // console centrale
  for (const x of [-0.76, 0.76]) {
    mesh(boxGeo(0.06, 0.12, 2.0), trim, interior, x, 0.31, -0.2); // contre-portes
    const pillar = mesh(boxGeo(0.05, 0.62, 0.06), trim, interior, x * 0.95, 0.47, 0.5); // montants de pare-brise
    pillar.rotation.x = 0.98;
  }
  mesh(boxGeo(1.44, 0.03, 1.2), trim, interior, 0, 0.675, -0.42); // ciel de toit
  mesh(boxGeo(1.44, 0.04, 0.06), trim, interior, 0, 0.655, 0.16); // traverse de pare-brise
  mesh(boxGeo(0.16, 0.045, 0.02), dark, interior, 0, 0.615, 0.24); // rétroviseur intérieur
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(driverX, 0.35, 0.44);
  steeringWheel.rotation.x = -0.35;
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.016, 8, 28), dark);
  const spokes = new THREE.Mesh(boxGeo(0.3, 0.03, 0.02), dark);
  const spoke2 = new THREE.Mesh(boxGeo(0.03, 0.155, 0.02), dark);
  spoke2.position.y = -0.078;
  const spinner = new THREE.Group();
  spinner.add(wheelRing, spokes, spoke2);
  steeringWheel.add(spinner);
  mergeByMaterial(interior);
  const spinnerHolder = new THREE.Group();
  spinnerHolder.add(wheelRing, spokes, spoke2);
  mergeByMaterial(spinnerHolder);
  spinner.add(spinnerHolder);
  interior.add(steeringWheel);
  interior.visible = false;

  // ——— Roues ———
  const tireGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.26, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(spec.wheelRadius * 0.7, spec.wheelRadius * 0.7, 0.2, 20);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = boxGeo(0.04, spec.wheelRadius * 1.34, 0.05);
  const wheels: CarVisual['wheels'] = [];
  for (let i = 0; i < 4; i++) {
    const left = i % 2 === 0;
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    pivot.add(spin);
    mesh(tireGeo, rubber, spin);
    mesh(hubGeo, dark, spin);
    // Jante : anneau + 5 branches (pour bien voir la roue tourner)
    const outer = left ? 0.12 : -0.12;
    for (let k = 0; k < 5; k++) {
      const sp = mesh(spokeGeo, rim, spin, outer, 0, 0);
      sp.rotation.x = (k / 5) * Math.PI;
    }
    const ring = mesh(new THREE.TorusGeometry(spec.wheelRadius * 0.7, 0.022, 6, 24), rim, spin, outer, 0, 0);
    ring.rotation.y = Math.PI / 2;
    mergeByMaterial(spin);
    root.add(pivot);
    wheels.push({ pivot, spin });
  }

  mergeByMaterial(body);
  mergeByMaterial(cabin);

  // ——— Phares : un seul projecteur réel (le reste de la ville est émissif) ———
  const headlight = new THREE.SpotLight(0xdfe8ff, 15, 115, 0.62, 0.7, 0.5);
  headlight.position.set(0, 0.1, 2.0);
  headlight.target.position.set(0, -0.9, 30);
  headlight.castShadow = false;
  if (options.lights !== false) root.add(headlight, headlight.target);

  // Lumière d'appoint qui suit la voiture : fait vivre la carrosserie et le sol proche.
  const fill = new THREE.PointLight(0xb9a8ff, 30, 11, 1.8);
  fill.position.set(0, 4.0, -1.4);
  if (options.lights !== false) root.add(fill);

  return {
    root,
    body,
    cabin,
    interior,
    steeringWheel: spinner,
    wheels,
    eyePoint: new THREE.Vector3(driverX, 0.525, -0.05),
    headlight,
    brakeLevel,
    reverseLevel,
  };
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** Recopie l'état physique (interpolé) dans le modèle. À appeler à chaque image. */
export function syncCarVisual(v: CarVisual, car: Vehicle, alpha: number): void {
  const p0 = car.prevPos;
  const p1 = car.pos;
  v.root.position.set(p0.x + (p1.x - p0.x) * alpha, p0.y + (p1.y - p0.y) * alpha, p0.z + (p1.z - p0.z) * alpha);
  _qa.set(car.prevRot.x, car.prevRot.y, car.prevRot.z, car.prevRot.w);
  _qb.set(car.rot.x, car.rot.y, car.rot.z, car.rot.w);
  v.root.quaternion.slerpQuaternions(_qa, _qb, alpha);

  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i];
    const vis = v.wheels[i];
    if (!w || !vis) continue;
    const susp = w.prevSuspLength + (w.suspLength - w.prevSuspLength) * alpha;
    vis.pivot.position.set(w.mx, w.my - susp, w.mz);
    vis.pivot.rotation.y = w.steerAngle;
    vis.spin.rotation.x = w.prevSpin + (w.spin - w.prevSpin) * alpha;
  }
  v.steeringWheel.rotation.z = -car.steerAngle * 5.5;
  v.brakeLevel.value = car.braking && !car.reversing ? 1 : 0;
  v.reverseLevel.value = car.reversing ? 1 : 0;
}
