import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { GROUP_WORLD, type PhysicsWorld } from '../physics/physicsWorld';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { District } from './streetGraph';

/**
 * Barrières de chantier à l'entrée des quartiers extérieurs. Tant que le joueur n'a pas le
 * niveau requis, la route d'accès est fermée (barrière lumineuse + collision) ; elle s'ouvre
 * dès que le niveau est atteint.
 */
export class DistrictGates {
  private readonly gates: { district: District; group: THREE.Group; collider: RAPIER.Collider | null }[] = [];
  private warnCooldown = 0;

  constructor(
    scene: THREE.Scene,
    private readonly phys: PhysicsWorld,
    districts: District[],
  ) {
    const amber = new THREE.MeshBasicNodeMaterial();
    amber.colorNode = vec3(1.0, 0.42, 0.04).mul(2.0);
    const dark = new THREE.MeshStandardNodeMaterial();
    dark.color = new THREE.Color(0.03, 0.03, 0.035);
    dark.roughness = 0.7;
    for (const d of districts) {
      const g = new THREE.Group();
      const w = d.gate.width + 6;
      // Deux lisses lumineuses, des plots sombres, et deux balises hautes visibles de loin.
      for (const y of [0.55, 1.15]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 0.18), amber);
        bar.position.set(0, y, 0);
        g.add(bar);
      }
      for (let k = 0; k <= 6; k++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.7), dark);
        post.position.set(-w / 2 + (w * k) / 6, 0.75, 0);
        g.add(post);
      }
      for (const side of [-1, 1]) {
        const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 0.3), amber);
        beacon.position.set((side * w) / 2, 4.5, 0);
        g.add(beacon);
      }
      g.position.set(d.gate.x, 0, d.gate.z);
      g.rotation.y = d.gate.yaw;
      scene.add(g);
      this.gates.push({ district: d, group: g, collider: null });
    }
  }

  /** Ouvre ou ferme chaque barrière selon le niveau. Renvoie les quartiers qui viennent de s'ouvrir. */
  setLevel(level: number, allOpen: boolean): District[] {
    const opened: District[] = [];
    const R = this.phys.rapier;
    for (const g of this.gates) {
      const locked = !allOpen && level < g.district.unlockLevel;
      if (locked && !g.collider) {
        const d = g.district;
        const desc = R.ColliderDesc.cuboid(d.gate.width / 2 + 3, 2.5, 0.5)
          .setTranslation(d.gate.x, 2.5, d.gate.z)
          .setRotation({ x: 0, y: Math.sin(d.gate.yaw / 2), z: 0, w: Math.cos(d.gate.yaw / 2) })
          .setCollisionGroups(GROUP_WORLD);
        g.collider = this.phys.world.createCollider(desc);
      } else if (!locked && g.collider) {
        this.phys.world.removeCollider(g.collider, false);
        g.collider = null;
        opened.push(g.district);
      }
      g.group.visible = locked;
    }
    return opened;
  }

  /** Quartier fermé dont la barrière est juste devant le joueur (pour afficher un message), sinon null. */
  blockedNear(dt: number, x: number, z: number): District | null {
    this.warnCooldown -= dt;
    if (this.warnCooldown > 0) return null;
    for (const g of this.gates) {
      if (!g.collider) continue;
      if (Math.hypot(x - g.district.gate.x, z - g.district.gate.z) < 26) {
        this.warnCooldown = 6;
        return g.district;
      }
    }
    return null;
  }
}
