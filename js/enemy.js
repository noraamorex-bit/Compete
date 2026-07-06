// Sentinel drones: wander → detect → chase/orbit → fire plasma bursts.
// Includes the enemy projectile pool and respawn logic.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, rand, raycastColliders, groundHeightAt, pointInAABB } from './utils.js';
import { audio } from './audio.js';

const E = CONFIG.enemy;
const MAX_PROJECTILES = 40;

const STATE = { SPAWNING: 0, WANDER: 1, CHASE: 2, DYING: 3 };

function buildDroneMesh() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x9aa4b8, roughness: 0.45, metalness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x39404f, roughness: 0.6, metalness: 0.3 });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff5040 });

  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 0), shell);
  body.scale.set(1, 0.78, 1);
  g.add(body);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), coreMat);
  core.position.z = 0.32;
  g.add(core);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 18), trim);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const finGeo = new THREE.BoxGeometry(0.1, 0.34, 0.5);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, trim);
    fin.position.set(side * 0.62, 0.12, 0.1);
    fin.rotation.z = side * 0.5;
    g.add(fin);
  }

  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, body, core, ring };
}

class Enemy {
  constructor(scene) {
    const { group, body, core, ring } = buildDroneMesh();
    this.mesh = group;
    this.body = body;
    this.core = core;
    this.ring = ring;
    this.coreBaseColor = new THREE.Color(0xff5040);
    scene.add(group);

    this.position = group.position;
    this.velocity = new THREE.Vector3();
    this.health = E.health;
    this.state = STATE.SPAWNING;
    this.stateT = 0;
    this.yaw = 0;
    this.hitFlash = 0;
    this.hoverSeed = Math.random() * 10;

    this.wanderTarget = new THREE.Vector3();
    this.wanderT = 0;
    this.losT = 0;             // time since player last seen
    this.burstLeft = 0;
    this.burstT = 0;
    this.cooldown = rand(0.5, 1.5);
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.active = false;
    this.mesh.visible = false;
  }

  spawn(pos) {
    this.position.set(pos.x, pos.y + E.hoverHeight, pos.z);
    this.velocity.set(0, 0, 0);
    this.health = E.health;
    this.state = STATE.SPAWNING;
    this.stateT = 0;
    this.losT = 99;
    this.cooldown = rand(0.8, 1.6);
    this.active = true;
    this.mesh.visible = true;
    this.mesh.scale.set(0.01, 0.01, 0.01);
    this.core.material.color.copy(this.coreBaseColor);
  }
}

export class EnemyManager {
  constructor(scene, effects, colliders, enemySpawns) {
    this.scene = scene;
    this.effects = effects;
    this.colliders = colliders;
    this.spawnPoints = enemySpawns;

    this.enemies = [];
    for (let i = 0; i < E.maxAlive; i++) this.enemies.push(new Enemy(scene));
    this.respawnTimers = [];

    this.onKill = null;          // cb(position)
    this.onPlayerDamaged = null; // cb(amount)

    // ---- Projectile pool ----
    this.projectiles = [];
    const pGeo = new THREE.SphereGeometry(0.09, 6, 5);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xff7a55 });
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const m = new THREE.Mesh(pGeo, pMat);
      m.visible = false;
      // Glow shell
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 6, 5),
        new THREE.MeshBasicMaterial({
          color: 0xff5030, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.add(halo);
      scene.add(m);
      this.projectiles.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
    }

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._flat = new THREE.Vector3();
  }

  reset(playerPos) {
    this.respawnTimers.length = 0;
    for (const e of this.enemies) {
      e.spawn(this._pickSpawn(playerPos));
    }
    for (const p of this.projectiles) { p.life = 0; p.mesh.visible = false; }
  }

  aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.active && e.state !== STATE.DYING) n++;
    return n;
  }

  _pickSpawn(playerPos) {
    // Prefer spawn points far from the player, with randomness among the far half.
    const sorted = [...this.spawnPoints].sort(
      (a, b) => b.distanceToSquared(playerPos) - a.distanceToSquared(playerPos)
    );
    const idx = Math.floor(Math.random() * Math.ceil(sorted.length / 2));
    return sorted[idx];
  }

  _hasLOS(from, to) {
    this._v.subVectors(to, from);
    const dist = this._v.length();
    if (dist < 0.001) return true;
    this._v.divideScalar(dist);
    const hit = raycastColliders(from.x, from.y, from.z, this._v.x, this._v.y, this._v.z, this.colliders, dist);
    return !hit;
  }

  // Weapon hit test: core (crit) first, then body sphere. Returns nearest.
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const e of this.enemies) {
      if (!e.active || e.state === STATE.DYING || e.state === STATE.SPAWNING) continue;
      const p = e.position;
      // Core world position
      this._v.set(0, 0, 0.32).applyQuaternion(e.mesh.quaternion).add(p);
      const distCore = this._raySphere(origin, dir, this._v, E.coreRadius);
      const distBody = this._raySphere(origin, dir, p, E.bodyRadius);
      const crit = distCore < distBody;
      const d = Math.min(distCore, distBody);
      if (d < maxDist && (!best || d < best.dist)) {
        best = { enemy: e, dist: d, crit };
      }
    }
    return best;
  }

  _raySphere(o, d, c, r) {
    const lx = c.x - o.x, ly = c.y - o.y, lz = c.z - o.z;
    const tca = lx * d.x + ly * d.y + lz * d.z;
    if (tca < 0) return Infinity;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) return Infinity;
    const t = tca - Math.sqrt(r * r - d2);
    return t >= 0 ? t : Infinity;
  }

  applyDamage(enemy, amount, point, crit) {
    if (!enemy.active || enemy.state === STATE.DYING) return 'dead';
    enemy.health -= amount;
    enemy.hitFlash = 1;
    // Getting shot always aggros.
    if (enemy.state === STATE.WANDER) { enemy.state = STATE.CHASE; enemy.losT = 0; }
    if (enemy.health <= 0) {
      enemy.state = STATE.DYING;
      enemy.stateT = 0;
      enemy.velocity.set(rand(-1.5, 1.5), 2.2, rand(-1.5, 1.5));
      audio.kill();
      this.onKill?.(enemy.position.clone());
      return 'killed';
    }
    return 'damaged';
  }

  _fireProjectile(enemy, targetPos) {
    const p = this.projectiles.find((pr) => pr.life <= 0);
    if (!p) return;
    // Muzzle = core position
    this._v.set(0, 0, 0.4).applyQuaternion(enemy.mesh.quaternion).add(enemy.position);
    p.mesh.position.copy(this._v);
    // Slight inaccuracy keeps bolts dodgeable.
    this._v2.copy(targetPos);
    this._v2.x += rand(-0.7, 0.7);
    this._v2.y += rand(-0.4, 0.4);
    this._v2.z += rand(-0.7, 0.7);
    p.vel.subVectors(this._v2, p.mesh.position).normalize().multiplyScalar(E.projectileSpeed);
    p.life = 3;
    p.mesh.visible = true;
    audio.enemyShoot();
  }

  update(dt, player) {
    const playerEye = player.eyePosition;

    // ---- Respawn queue ----
    for (let i = this.respawnTimers.length - 1; i >= 0; i--) {
      this.respawnTimers[i] -= dt;
      if (this.respawnTimers[i] <= 0) {
        this.respawnTimers.splice(i, 1);
        const e = this.enemies.find((en) => !en.active);
        if (e) {
          const sp = this._pickSpawn(player.position);
          e.spawn(sp);
          this.effects.ring(new THREE.Vector3(sp.x, sp.y + 0.2, sp.z));
        }
      }
    }

    // ---- Enemies ----
    for (const e of this.enemies) {
      if (!e.active) continue;
      e.stateT += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);

      // Hit flash: core tints toward white
      const f = e.hitFlash;
      e.core.material.color.setRGB(1, 0.31 + f * 0.69, 0.25 + f * 0.75);

      if (e.state === STATE.DYING) {
        this._updateDying(e, dt);
        continue;
      }

      if (e.state === STATE.SPAWNING) {
        const s = Math.min(1, e.stateT / 0.45);
        const eased = 1 - Math.pow(1 - s, 3);
        e.mesh.scale.set(eased, eased, eased);
        if (s >= 1) { e.state = STATE.WANDER; e.wanderT = 0; }
        continue;
      }

      const toPlayer = this._toPlayer.subVectors(player.position, e.position);
      const distToPlayer = toPlayer.length();
      const seesPlayer =
        player.alive &&
        distToPlayer < (e.state === STATE.CHASE ? E.loseRange : E.detectRange) &&
        this._hasLOS(e.position, playerEye);

      if (seesPlayer) e.losT = 0; else e.losT += dt;

      // ---- Steering ----
      let speed = E.wanderSpeed;
      let moveDir = this._v2.set(0, 0, 0);

      if (e.state === STATE.WANDER) {
        e.wanderT -= dt;
        if (e.wanderT <= 0 || e.position.distanceTo(e.wanderTarget) < 1.5) {
          const lim = CONFIG.arena.size / 2 - 4;
          e.wanderTarget.set(rand(-lim, lim), 0, rand(-lim, lim));
          e.wanderT = rand(4, 8);
        }
        moveDir.subVectors(e.wanderTarget, e.position);
        moveDir.y = 0;
        if (moveDir.lengthSq() > 1) moveDir.normalize();
        if (seesPlayer) { e.state = STATE.CHASE; e.strafeDir = Math.random() < 0.5 ? -1 : 1; }
      } else if (e.state === STATE.CHASE) {
        speed = E.chaseSpeed;
        const flat = this._flat.set(toPlayer.x, 0, toPlayer.z);
        const d = flat.length();
        if (d > 0.01) flat.divideScalar(d);
        // Approach or back off around preferred range, orbit-strafe otherwise.
        const rangeErr = d - E.preferredRange;
        moveDir.copy(flat).multiplyScalar(clamp(rangeErr * 0.35, -1, 1));
        // Tangential strafe
        moveDir.x += -flat.z * 0.7 * e.strafeDir;
        moveDir.z += flat.x * 0.7 * e.strafeDir;
        if (Math.random() < dt * 0.25) e.strafeDir *= -1;
        if (moveDir.lengthSq() > 1) moveDir.normalize();

        // Fire control
        if (player.alive && seesPlayer && distToPlayer < E.attackRange) {
          if (e.burstLeft > 0) {
            e.burstT -= dt;
            if (e.burstT <= 0) {
              this._fireProjectile(e, playerEye);
              e.burstLeft--;
              e.burstT = E.burstInterval;
            }
          } else {
            e.cooldown -= dt;
            if (e.cooldown <= 0) {
              e.burstLeft = E.burstCount;
              e.burstT = 0;
              e.cooldown = rand(E.burstCooldownMin, E.burstCooldownMax);
            }
          }
        }

        if (e.losT > 3.5 || !player.alive) { e.state = STATE.WANDER; e.wanderT = 0; }
      }

      // Separation from other drones
      for (const other of this.enemies) {
        if (other === e || !other.active || other.state === STATE.DYING) continue;
        const dx = e.position.x - other.position.x;
        const dz = e.position.z - other.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          moveDir.x += (dx / d) * (1 - d / 2) * 1.4;
          moveDir.z += (dz / d) * (1 - d / 2) * 1.4;
        }
      }

      // Smooth velocity, move with collision slide
      e.velocity.x += (moveDir.x * speed - e.velocity.x) * damp(4, dt);
      e.velocity.z += (moveDir.z * speed - e.velocity.z) * damp(4, dt);
      this._moveEnemy(e, dt);

      // Hover height above ground/boxes + gentle bob
      const groundY = groundHeightAt(e.position.x, e.position.z, this.colliders);
      const targetY = groundY + E.hoverHeight + Math.sin(performance.now() * 0.0016 + e.hoverSeed) * 0.14;
      e.position.y += (targetY - e.position.y) * damp(3.5, dt);

      // Face movement or player
      let targetYaw = e.yaw;
      if (e.state === STATE.CHASE) {
        targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      } else if (e.velocity.lengthSq() > 0.05) {
        targetYaw = Math.atan2(e.velocity.x, e.velocity.z);
      }
      let dy = targetYaw - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw += dy * damp(6, dt);
      e.mesh.rotation.y = e.yaw;

      // Idle spin flourishes
      e.ring.rotation.z += dt * 1.5;
      e.body.rotation.y += dt * 0.4;
    }

    this._updateProjectiles(dt, player);
  }

  _updateDying(e, dt) {
    e.velocity.y -= 14 * dt;
    e.position.addScaledVector(e.velocity, dt);
    e.mesh.rotation.x += dt * 7;
    e.mesh.rotation.z += dt * 5;
    const s = Math.max(0.25, 1 - e.stateT * 0.8);
    e.mesh.scale.set(s, s, s);
    // Sparks trail
    if (Math.random() < dt * 30) this.effects.burst(e.position, 0xffa040, 2, 2, 5, 0.3);

    const ground = groundHeightAt(e.position.x, e.position.z, this.colliders);
    if (e.position.y <= ground + 0.3 || e.stateT > 2.5) {
      this.effects.explosion(e.position.clone());
      e.active = false;
      e.mesh.visible = false;
      this.respawnTimers.push(E.respawnDelay);
    }
  }

  _moveEnemy(e, dt) {
    const half = { x: 0.55, y: 0.45, z: 0.55 };
    for (const axis of ['x', 'z']) {
      const delta = e.velocity[axis] * dt;
      if (delta === 0) continue;
      e.position[axis] += delta;
      for (const c of this.colliders) {
        if (
          e.position.x - half.x < c.max.x && e.position.x + half.x > c.min.x &&
          e.position.y - half.y < c.max.y && e.position.y + half.y > c.min.y &&
          e.position.z - half.z < c.max.z && e.position.z + half.z > c.min.z
        ) {
          if (delta > 0) e.position[axis] = c.min[axis] - half[axis] - 0.001;
          else e.position[axis] = c.max[axis] + half[axis] + 0.001;
          e.velocity[axis] = 0;
        }
      }
    }
    const lim = CONFIG.arena.size / 2 - 1.5;
    e.position.x = clamp(e.position.x, -lim, lim);
    e.position.z = clamp(e.position.z, -lim, lim);
  }

  _updateProjectiles(dt, player) {
    const pBox = {
      min: {
        x: player.position.x - player.half.x - 0.12,
        y: player.position.y - player.half.y,
        z: player.position.z - player.half.z - 0.12,
      },
      max: {
        x: player.position.x + player.half.x + 0.12,
        y: player.position.y + player.half.y,
        z: player.position.z + player.half.z + 0.12,
      },
    };

    for (const p of this.projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;

      let impact = pos.y < 0.02;

      if (!impact && player.alive && pointInAABB(pos, pBox)) {
        player.takeDamage(E.projectileDamage);
        this.onPlayerDamaged?.(E.projectileDamage);
        impact = true;
      }

      if (!impact) {
        for (const c of this.colliders) {
          if (pointInAABB(pos, c)) { impact = true; break; }
        }
      }

      if (impact || p.life <= 0) {
        if (impact) {
          this.effects.burst(pos, 0xff7a55, 5, 2.5, 5, 0.3);
          audio.projectileImpact();
        }
        p.life = 0;
        p.mesh.visible = false;
      }
    }
  }
}
