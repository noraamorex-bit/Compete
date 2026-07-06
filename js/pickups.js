// Drops: health packs and double-damage cores. Spin, bob, despawn, grab.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { groundHeightAt } from './utils.js';

const P = CONFIG.pickups;
const POOL_SIZE = 10;

function buildPickupMesh(type) {
  const g = new THREE.Group();
  const color = type === 'health' ? 0x53e07f : 0xffb52e;
  const mat = new THREE.MeshBasicMaterial({ color });
  const box = new THREE.BoxGeometry(1, 1, 1);

  if (type === 'health') {
    // Cross
    const a = new THREE.Mesh(box, mat);
    a.scale.set(0.34, 0.12, 0.12);
    const b = new THREE.Mesh(box, mat);
    b.scale.set(0.12, 0.34, 0.12);
    g.add(a, b);
  } else {
    // Energy core: spinning diamond
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), mat);
    g.add(d);
  }

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  g.add(halo);
  return g;
}

export class Pickups {
  constructor(scene, effects, colliders) {
    this.scene = scene;
    this.effects = effects;
    this.colliders = colliders;
    this.onPickup = null; // cb(type)

    this.items = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this.items.push({
        active: false, type: 'health', life: 0, baseY: 0, seed: Math.random() * 10,
        meshes: {
          health: this._makeHidden(buildPickupMesh('health')),
          boost: this._makeHidden(buildPickupMesh('boost')),
        },
      });
    }
  }

  _makeHidden(mesh) {
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  spawn(pos, type) {
    const it = this.items.find((i) => !i.active);
    if (!it) return;
    it.active = true;
    it.type = type;
    it.life = P.ttl;
    it.baseY = groundHeightAt(pos.x, pos.z, this.colliders) + 0.8;
    const m = it.meshes[type];
    m.position.set(pos.x, it.baseY, pos.z);
    m.visible = true;
  }

  clear() {
    for (const it of this.items) {
      it.active = false;
      it.meshes.health.visible = false;
      it.meshes.boost.visible = false;
    }
  }

  update(dt, player) {
    const t = performance.now() * 0.001;
    for (const it of this.items) {
      if (!it.active) continue;
      it.life -= dt;
      const m = it.meshes[it.type];
      if (it.life <= 0) {
        it.active = false;
        m.visible = false;
        continue;
      }
      m.position.y = it.baseY + Math.sin(t * 2.2 + it.seed) * 0.12;
      m.rotation.y += dt * 2.4;
      // Blink when about to expire.
      m.visible = it.life > 3 || (it.life * 4) % 1 > 0.35;

      if (player.alive) {
        const dx = m.position.x - player.position.x;
        const dy = m.position.y - player.position.y;
        const dz = m.position.z - player.position.z;
        if (dx * dx + dy * dy + dz * dz < P.grabRadius * P.grabRadius) {
          it.active = false;
          m.visible = false;
          this.effects.burst(m.position, it.type === 'health' ? 0x53e07f : 0xffb52e, 12, 3, 2, 0.4);
          this.onPickup?.(it.type);
        }
      }
    }
  }
}
