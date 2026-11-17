import * as THREE from 'three/webgpu';
import { CAR_SPEC } from '../config/handling';
import { GeomBuilder, type Vec3 } from '../render/geomBuilder';
import type { CityMaterials } from '../render/materials';
import { createCarVisual, syncCarVisual, type CarVisual } from '../vehicle/carModel';
import { applyCarAsset, loadCarAsset } from '../vehicle/glbCar';
import { pointAt, type PathPoint, type StreetGraph } from '../world/streetGraph';
import { vec3 } from 'three/tsl';
import type { Race } from './race';
import type { Track } from './trackBank';
import type { Route, RoutePoint } from './route';

/**
 * Décor d'une course : portiques des points de passage, balise du prochain point,
 * panneaux à chevrons dans les virages, ligne de départ, voitures des adversaires.
 * Reconstruit à chaque nouvelle course, retiré à la fin.
 */
const CYAN: Vec3 = [0.1, 0.8, 1.0];
const AMBER: Vec3 = [1.0, 0.55, 0.05];
const MAGENTA: Vec3 = [1.0, 0.1, 0.55];
const DARK: Vec3 = [0.03, 0.03, 0.04];

export class RaceVisuals {
  private readonly group = new THREE.Group();
  private readonly beacon: THREE.Group;
  private cars: CarVisual[] = [];
  private generation = -1;
  private halfWidths: number[] = [];
  private pickupMeshes: THREE.Object3D[] = [];
  private readonly markers = new THREE.Group();
  private readonly cashMat: THREE.Material;
  private readonly teleMat: THREE.Material;
  private readonly cashGeo: THREE.BufferGeometry;
  private readonly teleGeo: THREE.BufferGeometry;
  private spin = 0;
  /** Groupe à part : ses géométries sont partagées et ne doivent pas être libérées avec le décor. */
  private readonly pickupGroup = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private readonly mats: CityMaterials,
    private readonly graph: StreetGraph,
    /** Aperçu : barrer les rues transversales le long du tracé. */
    private readonly barriers = false,
    tracks: Track[] = [],
    /** Modèle 3D imposé à tous les adversaires (`?modele=`) ; null = celui de chaque pilote. */
    private readonly carModelId: string | null = null,
  ) {
    this.group.name = 'course';
    scene.add(this.group);
    // Balise du prochain point de passage : colonne de lumière visible par-dessus les immeubles.
    this.beacon = new THREE.Group();
    const gb = new GeomBuilder();
    gb.cylinder(0, 0, 0, 0.9, 0.9, 120, 10, [0.25, 0.9, 1.0], [1, 3, 1, 1.6], false);
    const col = new THREE.Mesh(gb.build(), mats.glow);
    col.frustumCulled = false;
    this.beacon.add(col);
    this.beacon.visible = false;
    scene.add(this.beacon);

    // Objets à ramasser : mallette dorée, anneau de téléportation.
    const cash = new THREE.MeshBasicNodeMaterial();
    cash.colorNode = vec3(1.0, 0.72, 0.12).mul(2.2);
    this.cashMat = cash;
    const tele = new THREE.MeshBasicNodeMaterial();
    tele.colorNode = vec3(0.75, 0.25, 1.0).mul(2.6);
    this.teleMat = tele;
    this.cashGeo = new THREE.BoxGeometry(1.1, 0.75, 0.32);
    this.teleGeo = new THREE.TorusGeometry(1.25, 0.16, 8, 28);

    // Bornes de départ des courses dans la ville (visibles en balade libre).
    const mg = new GeomBuilder();
    for (const t of tracks) {
      const c: Vec3 = t.circuit ? MAGENTA : CYAN;
      const p = t.start;
      mg.cylinder(p.x, 0.05, p.z, 5.2, 5.2, 0.35, 28, c, [1, 3, 1, 1.0], false);
      mg.cylinder(p.x, 0.05, p.z, 0.35, 0.35, 46, 8, c, [1, 3, 1, 1.3], false);
    }
    const mm = new THREE.Mesh(mg.build(), mats.glow);
    mm.frustumCulled = false;
    this.markers.add(mm);
    scene.add(this.markers);
    scene.add(this.pickupGroup);
  }

  /** Demi-largeur de la chaussée la plus proche d'un point (pour dimensionner un portique). */
  private halfWidthAt(route: Route, p: RoutePoint): number {
    let best = 9, bd = Infinity;
    for (const eid of route.edges) {
      const e = this.graph.edges[eid];
      if (!e) continue;
      for (let k = 0; k < e.pts.length; k += 2) {
        const d = ((e.pts[k] as number) - p.x) ** 2 + ((e.pts[k + 1] as number) - p.z) ** 2;
        if (d < bd) {
          bd = d;
          best = e.width / 2;
        }
      }
    }
    return best;
  }

  private rebuild(race: Race): void {
    this.clear();
    const route = race.route;
    if (!route) return;
    const glow = new GeomBuilder();
    const solid = new GeomBuilder();
    const pts = route.points;

    // — Portiques des points de passage (le dernier = arrivée) —
    this.halfWidths = [];
    route.checkpoints.forEach((idx, k) => {
      if (idx >= route.lapPoints) return; // circuit : les portiques du premier tour servent à tous les tours
      const p = pts[idx] as RoutePoint;
      const half = Math.min(15, this.halfWidthAt(route, p)) + 0.8;
      this.halfWidths.push(half);
      const last = route.laps > 1 ? idx === route.lapPoints - 1 : k === route.checkpoints.length - 1;
      const yaw = Math.atan2(p.tx, p.tz);
      const color = last ? MAGENTA : CYAN;
      const h = last ? 7 : 6;
      for (const side of [1, -1]) {
        const x = p.x + p.tz * side * half, z = p.z - p.tx * side * half;
        solid.box(x, h / 2, z, 0.5, h, 0.5, yaw, DARK);
        glow.box(x, h / 2, z, 0.62, h - 0.6, 0.12, yaw, color, [1, 3, 1, 1.4], false, false);
      }
      glow.box(p.x, h + 0.25, p.z, half * 2 + 0.5, last ? 1.1 : 0.5, 0.3, yaw, color, [1, last ? 1 : 3, half * 2, last ? 1.1 : 1.6], true, true);
    });

    // — Ligne de départ —
    const st = pts[Math.round(34 / 3)] as RoutePoint;
    const sh = Math.min(15, this.halfWidthAt(route, st));
    glow.box(st.x, 0.06, st.z, sh * 2, 0.02, 0.7, Math.atan2(st.tx, st.tz), [1, 1, 1], [1, 3, 1, 0.9], true, false);

    // — Panneaux à chevrons : placés dans l'axe d'arrivée, juste après le virage, face au pilote —
    for (const t of route.turns) {
      if (t.index >= route.lapPoints) continue;
      const before = pts[Math.max(0, t.index - 8)] as RoutePoint;
      const apex = pts[t.index] as RoutePoint;
      const ix = before.tx, iz = before.tz; // direction d'arrivée
      const cx = apex.x + ix * 13, cz = apex.z + iz * 13;
      // Gauche du pilote = (iz, −ix) ; les chevrons pointent du côté du virage.
      const dir = t.angle > 0 ? 1 : -1;
      const ux = iz * dir, uz = -ix * dir;
      const sharp = Math.abs(t.angle) > 1.15;
      const count = sharp ? 5 : 4;
      const w = count * 1.5 + 0.6;
      const yaw = Math.atan2(ix, iz);
      solid.box(cx, 1.55, cz, w, 1.7, 0.18, yaw, DARK, [0, 0, 0, 0], true, true);
      for (const end of [-1, 1]) solid.box(cx + ux * end * (w / 2 - 0.2), 0.4, cz + uz * end * (w / 2 - 0.2), 0.14, 0.8, 0.14, yaw, DARK);
      const n: Vec3 = [-ix, 0, -iz];
      const fx = -ix * 0.11, fz = -iz * 0.11; // légèrement devant le panneau
      const color = sharp ? MAGENTA : AMBER;
      for (let c = 0; c < count; c++) {
        const u0 = (c - (count - 1) / 2) * 1.5;
        // Un chevron « > » : deux barres obliques qui se rejoignent à la pointe.
        const P = (u: number, v: number): Vec3 => [cx + ux * u + fx, 1.55 + v, cz + uz * u + fz];
        for (const sgn of [1, -1]) {
          glow.quad(P(u0 - 0.5, sgn * 0.62), P(u0 - 0.12, sgn * 0.62), P(u0 + 0.52, 0), P(u0 + 0.14, 0), n, 0, 0, 1, 1, color, [1, 3, 1, 1.5]);
        }
      }
    }

    // — Aperçu « rues barrées » : une rangée de barrières à l'entrée de chaque rue qui quitte le tracé —
    if (this.barriers) {
      const used = new Set(route.edges);
      const pp: PathPoint = { x: 0, z: 0, tx: 1, tz: 0 };
      for (const nodeId of route.nodes) {
        const node = this.graph.nodes[nodeId];
        if (!node) continue;
        for (const eid of node.edges) {
          if (used.has(eid)) continue;
          const e = this.graph.edges[eid];
          if (!e) continue;
          const fromA = e.a === nodeId;
          const trim = fromA ? e.trimA : e.trimB;
          pointAt(e, fromA ? trim + 2.5 : e.length - trim - 2.5, pp);
          const yaw = Math.atan2(pp.tx, pp.tz);
          const span = e.width + 1.5;
          const count = Math.max(2, Math.round(span / 2.4));
          const unit = span / count;
          for (let k = 0; k < count; k++) {
            const off = (k + 0.5) * unit - span / 2;
            const x = pp.x + pp.tz * off, z = pp.z - pp.tx * off;
            // Deux pieds, deux lisses rayées rouge et blanc, un feu orange sur une barrière sur deux.
            for (const lx of [-unit * 0.4, unit * 0.4]) solid.box(x + pp.tz * lx, 0.55, z - pp.tx * lx, 0.1, 1.1, 0.5, yaw, DARK);
            const stripes = 6;
            const sw = (unit * 0.94) / stripes;
            for (const y of [0.95, 0.5]) {
              for (let q = 0; q < stripes; q++) {
                const so = (q + 0.5) * sw - (unit * 0.94) / 2;
                const red = (q + k) % 2 === 0;
                glow.box(x + pp.tz * so, y, z - pp.tx * so, sw, 0.26, 0.07, yaw, red ? [1, 0.08, 0.05] : [1, 1, 1], [1, 3, 1, red ? 1.3 : 0.7], true, true);
              }
            }
            if (k % 2 === 0) glow.box(x, 1.28, z, 0.22, 0.22, 0.22, yaw, [1, 0.55, 0.05], [k + 3, 5, 1, 1], true, true);
          }
        }
      }
    }

    for (const [builder, mat] of [[glow, this.mats.glow], [solid, this.mats.solid]] as const) {
      const m = new THREE.Mesh(builder.build(), mat);
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }

    // — Objets à ramasser —
    this.pickupMeshes = race.pickups.map((pk) => {
      const m = pk.kind === 'cash' ? new THREE.Mesh(this.cashGeo, this.cashMat) : new THREE.Mesh(this.teleGeo, this.teleMat);
      m.position.set(pk.x, pk.kind === 'cash' ? 1.0 : 1.5, pk.z);
      this.pickupGroup.add(m);
      return m;
    });

    // — Voitures des adversaires —
    for (const r of race.racers) {
      if (r.isPlayer || !r.level) continue;
      const v = createCarVisual(CAR_SPEC, { color: r.level.color, lights: false });
      // Vrai modèle 3D : la voiture reste cachée le temps du chargement (sinon on verrait la voiture procédurale).
      if (this.carModelId === 'aucun') {
        this.group.add(v.root);
        this.cars.push(v);
        continue;
      }
      v.root.visible = false;
      loadCarAsset(this.carModelId ?? r.level.glb)
        .then((asset) => applyCarAsset(v, asset, CAR_SPEC, { lod: 1, traits: r.car.traits }))
        .catch(() => undefined)
        .finally(() => (v.root.visible = true));
      this.group.add(v.root);
      this.cars.push(v);
    }
    this.beacon.visible = true;
  }

  private clear(): void {
    for (const m of this.pickupMeshes) this.pickupGroup.remove(m);
    this.pickupMeshes = [];
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !mesh.userData.shared) mesh.geometry.dispose();
      });
    }
    this.cars = [];
    this.beacon.visible = false;
  }

  /** À appeler à chaque image. */
  update(race: Race, alpha: number, frameDt = 0.016): void {
    this.markers.visible = !race.active;
    this.spin += frameDt;
    if (race.generation !== this.generation || (!race.active && this.group.children.length > 0)) {
      this.generation = race.generation;
      if (race.active) this.rebuild(race);
      else this.clear();
    }
    const route = race.route;
    if (!route) return;
    let ci = 0;
    for (const r of race.racers) {
      if (r.isPlayer) continue;
      const v = this.cars[ci++];
      if (v) syncCarVisual(v, r.car, alpha);
    }
    race.pickups.forEach((pk, k) => {
      const m = this.pickupMeshes[k];
      if (!m) return;
      m.visible = !pk.taken;
      m.rotation.y = this.spin * (pk.kind === 'cash' ? 1.6 : 2.4) + k;
      m.position.y = (pk.kind === 'cash' ? 1.0 : 1.5) + Math.sin(this.spin * 2.2 + k) * 0.12;
    });
    const player = race.player;
    if (player && player.nextCheckpoint < route.checkpoints.length) {
      const p = route.points[route.checkpoints[player.nextCheckpoint] as number] as RoutePoint;
      this.beacon.position.set(p.x, 7, p.z);
      this.beacon.visible = true;
    } else {
      this.beacon.visible = false;
    }
  }
}
