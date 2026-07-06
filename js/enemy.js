// Enemies: sentinel drones (wander → chase → shoot), kamikaze rushers
// (charge → detonate), and boss sentinels (tanky, heavy bursts).
// Also owns the enemy projectile pool and wave spawning.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, rand, raycastColliders, groundHeightAt, pointInAABB } from './utils.js';
import { audio } from './audio.js';

const E = CONFIG.enemy;
const MAX_PROJECTILES = 40;
const POOL_SIZE = 9; // >= max simultaneous alive + dying

const STATE = { SPAWNING: 0, WANDER: 1, CHASE: 2, DYING: 3 };

function buildDroneMesh({ scale = 1, shellColor = 0x9aa4b8, coreColor = 0xff5040 } = {}) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: shellColor, roughness: 0.45, metalness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x39404f, roughness: 0.6, metalness: 0.3 });
  const coreMat = new THREE.MeshBasicMaterial({ color: coreColor });

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

  g.scale.setScalar(scale);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, body, core, ring };
}

function buildRusherMesh() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x6e3440, roughness: 0.5, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2c1a20, roughness: 0.6, metalness: 0.3 });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });

  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), shell);
  body.scale.set(0.75, 1.15, 0.75);
  g.add(body);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), coreMat);
  core.position.z = 0.24;
  g.add(core);

  // Spikes make it read as dangerous.
  const spikeGeo = new THREE.ConeGeometry(0.07, 0.3, 4);
  for (const [x, y, rz] of [[-0.3, 0.1, 1.1], [0.3, 0.1, -1.1], [0, 0.45, 0]]) {
    const s = new THREE.Mesh(spikeGeo, trim);
    s.position.set(x, y, 0);
    s.rotation.z = rz;
    g.add(s);
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 5, 14), trim);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, body, core, ring };
}

function buildMesh(type) {
  if (type === 'rusher') return buildRusherMesh();
  if (type === 'boss') {
    return buildDroneMesh({
      scale: E.types.boss.meshScale,
      shellColor: 0x4a3550,
      coreColor: 0xff2040,
    });
  }
  return buildDroneMesh();
}

class Enemy {
  constructor(scene) {
    this.scene = scene;
    this.type = null;
    this.stats = E.types.drone;
    this.mesh = null;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this._ensureMesh('drone');

    this.health = 1;
    this.maxHealth = 1;
    this.state = STATE.SPAWNING;
    this.stateT = 0;
    this.yaw = 0;
    this.hitFlash = 0;
    this.hoverSeed = Math.random() * 10;

    this.wanderTarget = new THREE.Vector3();
    this.wanderT = 0;
    this.losT = 0;
    this.burstLeft = 0;
    this.burstT = 0;
    this.cooldown = rand(0.5, 1.5);
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.active = false;
    this.mesh.visible = false;
  }

  // Meshes are rebuilt only when this pool slot changes type.
  _ensureMesh(type) {
    if (this.type === type) return;
    if (this.mesh) this.scene.remove(this.mesh);
    const { group, body, core, ring } = buildMesh(type);
    this.mesh = group;
    this.body = body;
    this.core = core;
    this.ring = ring;
    this.coreBaseColor = core.material.color.clone();
    this.mesh.position.copy(this.position);
    this.scene.add(group);
    this.type = type;
    this.stats = E.types[type];
  }

  spawn(pos, type = 'drone', healthScale = 1) {
    this._ensureMesh(type);
    this.position.set(pos.x, pos.y + this.stats.hover, pos.z);
    this.mesh.position.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.maxHealth = this.stats.health * healthScale;
    this.health = this.maxHealth;
    this.state = STATE.SPAWNING;
    this.stateT = 0;
    this.losT = 99;
    this.cooldown = rand(0.8, 1.6);
    this.active = true;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.scale.setScalar(0.01);
    this.core.material.color.copy(this.coreBaseColor);
  }

  get baseScale() {
    return this.stats.meshScale || 1;
  }
}

export class EnemyManager {
  constructor(scene, effects, colliders, enemySpawns) {
    this.scene = scene;
    this.effects = effects;
    this.colliders = colliders;
    this.spawnPoints = enemySpawns;

    this.enemies = [];
    for (let i = 0; i < POOL_SIZE; i++) this.enemies.push(new Enemy(scene));

    // Wave spawning state — driven by beginWave().
    this.pendingTypes = [];
    this.maxAlive = E.maxAlive;
    this.healthScale = 1;
    this.speedScale = 1;
    this.bossHealthScale = 1;
    this.spawnTimer = 0;
    this.waveActive = false;
    this.activeBoss = null;

    this.onKill = null;          // cb(position, crit, type)
    this.onWaveCleared = null;
    this.onPlayerDamaged = null; // cb(amount, sourcePosition)

    // ---- Projectile pool ----
    this.projectiles = [];
    const pGeo = new THREE.SphereGeometry(0.09, 6, 5);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xff7a55 });
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const m = new THREE.Mesh(pGeo, pMat);
      m.visible = false;
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

  clearAll() {
    this.pendingTypes.length = 0;
    this.waveActive = false;
    this.activeBoss = null;
    for (const e of this.enemies) {
      e.active = false;
      e.mesh.visible = false;
    }
    for (const p of this.projectiles) { p.life = 0; p.mesh.visible = false; }
  }

  // Queue a wave: `types` is the full spawn list (e.g. ['boss','drone','rusher',...]).
  beginWave({ types, maxAlive, healthScale = 1, speedScale = 1, bossHealthScale = 1 }, playerPos) {
    this.pendingTypes = [...types];
    this.maxAlive = maxAlive;
    this.healthScale = healthScale;
    this.speedScale = speedScale;
    this.bossHealthScale = bossHealthScale;
    this.spawnTimer = 0;
    this.waveActive = true;
    const initial = Math.min(maxAlive, this.pendingTypes.length, 3);
    for (let i = 0; i < initial; i++) this._spawnOne(playerPos, false);
  }

  _spawnOne(playerPos, ringFx = true) {
    if (this.pendingTypes.length === 0) return;
    const e = this.enemies.find((en) => !en.active);
    if (!e) return;
    const type = this.pendingTypes.shift();
    const sp = this._pickSpawn(playerPos);
    const scale = type === 'boss' ? this.healthScale * this.bossHealthScale : this.healthScale;
    e.spawn(sp, type, scale);
    if (ringFx || type === 'boss') this.effects.ring(new THREE.Vector3(sp.x, sp.y + 0.2, sp.z));
    if (type === 'boss') audio.bossSpawn();
  }

  aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.active && e.state !== STATE.DYING) n++;
    return n;
  }

  _pickSpawn(playerPos) {
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
      const s = e.baseScale;
      this._v.set(0, 0, (e.type === 'rusher' ? 0.24 : 0.32) * s)
        .applyQuaternion(e.mesh.quaternion).add(p);
      const distCore = this._raySphere(origin, dir, this._v, e.stats.coreRadius);
      const distBody = this._raySphere(origin, dir, p, e.stats.bodyRadius);
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
    if (enemy.state === STATE.WANDER) { enemy.state = STATE.CHASE; enemy.losT = 0; }
    if (enemy.health <= 0) {
      enemy.health = 0;
      enemy.state = STATE.DYING;
      enemy.stateT = 0;
      enemy.velocity.set(rand(-1.5, 1.5), 2.2, rand(-1.5, 1.5));
      audio.kill();
      this.onKill?.(enemy.position.clone(), crit, enemy.type);
      return 'killed';
    }
    return 'damaged';
  }

  // Explosion + slot free + wave-clear check. Used by deaths and detonations.
  _removeEnemy(e, big = false) {
    this.effects.explosion(e.position.clone());
    if (big) {
      this.effects.burst(e.position, 0xff2040, 30, 9, 5, 0.8);
      this.effects.ring(e.position.clone());
    }
    e.active = false;
    e.mesh.visible = false;
    if (this.waveActive && this.pendingTypes.length === 0 && this.enemies.every((en) => !en.active)) {
      this.waveActive = false;
      this.onWaveCleared?.();
    }
  }

  _fireProjectile(enemy, targetPos) {
    const p = this.projectiles.find((pr) => pr.life <= 0);
    if (!p) return;
    this._v.set(0, 0, 0.4 * enemy.baseScale).applyQuaternion(enemy.mesh.quaternion).add(enemy.position);
    p.mesh.position.copy(this._v);
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

    // ---- Staggered wave spawning ----
    if (this.pendingTypes.length > 0 && this.aliveCount() < this.maxAlive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnOne(player.position);
        this.spawnTimer = CONFIG.waves.spawnStagger;
      }
    }

    this.activeBoss = null;

    // ---- Enemies ----
    for (const e of this.enemies) {
      if (!e.active) continue;
      const T = e.stats;
      e.stateT += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);

      if (e.type === 'boss' && e.state !== STATE.DYING) this.activeBoss = e;

      // Hit flash: core tints toward white
      const f = e.hitFlash;
      e.core.material.color.copy(e.coreBaseColor).lerp(WHITE, f);

      if (e.state === STATE.DYING) {
        this._updateDying(e, dt);
        continue;
      }

      if (e.state === STATE.SPAWNING) {
        const s = Math.min(1, e.stateT / 0.45);
        const eased = 1 - Math.pow(1 - s, 3);
        e.mesh.scale.setScalar(eased * e.baseScale);
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
      let speed = T.wanderSpeed * this.speedScale;
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
        speed = T.chaseSpeed * this.speedScale;
        const flat = this._flat.set(toPlayer.x, 0, toPlayer.z);
        const d = flat.length();
        if (d > 0.01) flat.divideScalar(d);

        if (e.type === 'rusher') {
          // Kamikaze: charge straight in with a slight weave, detonate on contact.
          moveDir.copy(flat);
          const weave = Math.sin(performance.now() * 0.004 + e.hoverSeed * 7) * 0.35;
          moveDir.x += -flat.z * weave;
          moveDir.z += flat.x * weave;
          if (moveDir.lengthSq() > 1) moveDir.normalize();

          if (player.alive && distToPlayer < T.detonateRange) {
            player.takeDamage(T.detonateDamage);
            this.onPlayerDamaged?.(T.detonateDamage, e.position.clone());
            this._removeEnemy(e, true);
            continue;
          }
          if (e.losT > 6 || !player.alive) { e.state = STATE.WANDER; e.wanderT = 0; }
        } else {
          // Drones/boss: hold preferred range and orbit-strafe.
          const rangeErr = d - T.preferredRange;
          moveDir.copy(flat).multiplyScalar(clamp(rangeErr * 0.35, -1, 1));
          moveDir.x += -flat.z * 0.7 * e.strafeDir;
          moveDir.z += flat.x * 0.7 * e.strafeDir;
          if (Math.random() < dt * 0.25) e.strafeDir *= -1;
          if (moveDir.lengthSq() > 1) moveDir.normalize();

          if (T.canShoot && player.alive && seesPlayer && distToPlayer < T.attackRange) {
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
                e.burstLeft = T.burstCount;
                e.burstT = 0;
                e.cooldown = rand(T.burstCooldownMin, T.burstCooldownMax);
              }
            }
          }

          if (e.losT > 3.5 || !player.alive) { e.state = STATE.WANDER; e.wanderT = 0; }
        }
      }

      // Separation from other enemies
      const sepR = e.type === 'boss' ? 3.2 : 2;
      for (const other of this.enemies) {
        if (other === e || !other.active || other.state === STATE.DYING) continue;
        const dx = e.position.x - other.position.x;
        const dz = e.position.z - other.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < sepR * sepR && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          moveDir.x += (dx / d) * (1 - d / sepR) * 1.4;
          moveDir.z += (dz / d) * (1 - d / sepR) * 1.4;
        }
      }

      // Smooth velocity, move with collision slide
      e.velocity.x += (moveDir.x * speed - e.velocity.x) * damp(4, dt);
      e.velocity.z += (moveDir.z * speed - e.velocity.z) * damp(4, dt);
      this._moveEnemy(e, dt);

      // Hover height above ground/boxes + gentle bob
      const groundY = groundHeightAt(e.position.x, e.position.z, this.colliders);
      const bobSpeed = e.type === 'rusher' ? 0.004 : 0.0016;
      const targetY = groundY + T.hover + Math.sin(performance.now() * bobSpeed + e.hoverSeed) * 0.14;
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
      e.mesh.position.copy(e.position);

      // Idle spin flourishes
      e.ring.rotation.z += dt * (e.type === 'rusher' ? 4 : 1.5);
      e.body.rotation.y += dt * 0.4;
    }

    this._updateProjectiles(dt, player);
  }

  _updateDying(e, dt) {
    e.velocity.y -= 14 * dt;
    e.position.addScaledVector(e.velocity, dt);
    e.mesh.position.copy(e.position);
    e.mesh.rotation.x += dt * 7;
    e.mesh.rotation.z += dt * 5;
    const s = Math.max(0.25, 1 - e.stateT * 0.8) * e.baseScale;
    e.mesh.scale.setScalar(s);
    if (Math.random() < dt * 30) this.effects.burst(e.position, 0xffa040, 2, 2, 5, 0.3);

    const ground = groundHeightAt(e.position.x, e.position.z, this.colliders);
    if (e.position.y <= ground + 0.3 || e.stateT > 2.5) {
      this._removeEnemy(e, e.type === 'boss');
    }
  }

  _moveEnemy(e, dt) {
    const r = e.stats.bodyRadius * 0.8;
    const half = { x: r, y: 0.45 * e.baseScale, z: r };
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
        this.onPlayerDamaged?.(E.projectileDamage, pos.clone().addScaledVector(p.vel, -0.5));
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

const WHITE = new THREE.Color(1, 1, 1);
