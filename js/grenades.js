// Grenades: cooldown-based throwable with bouncing physics and AoE damage.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { pointInAABB } from './utils.js';
import { audio } from './audio.js';

const G = CONFIG.grenade;
const POOL_SIZE = 4;

function buildGrenadeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a303c, roughness: 0.5, metalness: 0.4 })
  );
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.025, 5, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb52e })
  );
  band.rotation.x = Math.PI / 2;
  g.add(body, band);
  return g;
}

export class Grenades {
  constructor(scene, effects, colliders, enemies) {
    this.scene = scene;
    this.effects = effects;
    this.colliders = colliders;
    this.enemies = enemies;
    this.cooldown = 0;
    this.onExplode = null; // cb(position) — main hooks shake

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = buildGrenadeMesh();
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), fuse: 0, active: false });
    }
    this._v = new THREE.Vector3();
  }

  get ready() { return this.cooldown <= 0; }
  get cooldownFrac() { return 1 - Math.max(0, this.cooldown) / G.cooldown; }

  reset() {
    this.cooldown = 0;
    for (const n of this.pool) { n.active = false; n.mesh.visible = false; }
  }

  throw(origin, dir) {
    if (this.cooldown > 0) return false;
    if (!this._launch(origin, dir, false)) return false;
    this.cooldown = G.cooldown;
    return true;
  }

  // Replicates a rival's grenade: same physics/FX, no damage, no cooldown.
  throwVisual(origin, dir) {
    this._launch(origin, dir, true);
  }

  _launch(origin, dir, visual) {
    const n = this.pool.find((x) => !x.active);
    if (!n) return false;
    n.active = true;
    n.visual = visual;
    n.fuse = G.fuse;
    n.mesh.visible = true;
    n.mesh.position.copy(origin).addScaledVector(dir, 0.5);
    n.vel.copy(dir).multiplyScalar(G.speed);
    n.vel.y += G.upBoost;
    audio.grenadeThrow();
    return true;
  }

  _explode(n) {
    const pos = n.mesh.position;
    n.active = false;
    n.mesh.visible = false;
    audio.grenadeExplode();
    this.effects.explosion(pos.clone());
    this.effects.burst(pos, 0xffb060, 30, 10, 7, 0.8);
    this.effects.ring(pos.clone());
    if (n.visual) return; // remote grenade: presentation only

    // AoE damage with linear falloff. Kills route through the normal pipeline.
    for (const e of this.enemies.enemies) {
      if (!e.active || e.state === 3) continue;
      const d = e.position.distanceTo(pos);
      if (d > G.radius) continue;
      const dmg = G.damageCenter + (G.damageEdge - G.damageCenter) * (d / G.radius);
      this.enemies.applyDamage(e, dmg, e.position.clone(), false);
      this.effects.damageNumber(e.position.clone(), dmg, false);
    }
    this.onExplode?.(pos.clone());
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (const n of this.pool) {
      if (!n.active) continue;
      n.fuse -= dt;
      if (n.fuse <= 0) { this._explode(n); continue; }

      n.vel.y -= G.gravity * dt;
      const pos = n.mesh.position;
      // Per-axis move + bounce off colliders and the floor.
      for (const axis of ['x', 'y', 'z']) {
        pos[axis] += n.vel[axis] * dt;
        for (const c of this.colliders) {
          if (pointInAABB(pos, c, 0.1)) {
            pos[axis] -= n.vel[axis] * dt;
            n.vel[axis] *= -G.bounce;
            if (Math.abs(n.vel[axis]) > 1.5) audio.grenadeBounce();
            break;
          }
        }
      }
      if (pos.y < 0.11) {
        pos.y = 0.11;
        if (Math.abs(n.vel.y) > 1.5) audio.grenadeBounce();
        n.vel.y *= -G.bounce;
        // Ground friction
        n.vel.x *= 0.94;
        n.vel.z *= 0.94;
      }
      n.mesh.rotation.x += dt * 8;
      n.mesh.rotation.z += dt * 6;
      // Fuse blink
      n.mesh.children[1].material.color.setHex(
        (n.fuse * 6) % 1 > 0.5 ? 0xff3020 : 0xffb52e
      );
    }
  }
}
