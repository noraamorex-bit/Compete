// Enemies: sentinel drones (wander → chase → shoot), kamikaze rushers
// (charge → detonate), and boss sentinels (tanky, heavy bursts).
// Also owns the enemy projectile pool and wave spawning.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, rand, raycastColliders, groundHeightAt, pointInAABB } from './utils.js';
import { audio } from './audio.js';

const E = CONFIG.enemy;
const MAX_PROJECTILES = 72; // headroom for the boss nova ring
const POOL_SIZE = 9; // >= max simultaneous alive + dying

const STATE = { SPAWNING: 0, WANDER: 1, CHASE: 2, DYING: 3 };

// ---------- Enemy meshes ----------
// Each build* returns { group, body, core, ring, spinners }.
// `core` is the glowing weak-point (crit target + hit-flash tint), `ring`
// and `body` get idle spin, `spinners` is extra animated parts [{mesh,ax,ay,az}].

// SENTINEL DRONE — an armored floating eye-turret: faceted hull with a menacing
// single optic, side gun pods, a stabilizer halo, top antennae, thruster glow.
function buildDroneMesh({ scale = 1, shellColor = 0x8992a6, coreColor = 0xff5040 } = {}) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: shellColor, roughness: 0.5, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a303c, roughness: 0.6, metalness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x454e5e, roughness: 0.55, metalness: 0.35 });
  const coreMat = new THREE.MeshBasicMaterial({ color: coreColor });
  const box = new THREE.BoxGeometry(1, 1, 1);

  // Hull: a wide beveled diamond (two stacked frusta) — reads mechanical, not a blob.
  const body = new THREE.Group();
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.34, 6), shell);
  top.position.y = 0.13;
  const bot = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 6), trim);
  bot.rotation.x = Math.PI; bot.position.y = -0.14;
  body.add(top, bot);
  // Armor collar around the seam.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.12, 6), dark);
  body.add(collar);
  g.add(body);

  // Optic housing + glowing eye on the front.
  const brow = new THREE.Mesh(box, dark);
  brow.scale.set(0.36, 0.16, 0.14); brow.position.set(0, 0.02, 0.4);
  g.add(brow);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), coreMat);
  core.position.set(0, 0.02, 0.46);
  core.scale.z = 0.7;
  g.add(core);

  // Side gun pods.
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 6), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.44, -0.02, 0.16);
    g.add(pod);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), trim);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.44, -0.02, 0.42);
    g.add(barrel);
  }

  // Top antenna cluster.
  for (const [x, h, rz] of [[-0.12, 0.28, 0.2], [0.12, 0.34, -0.2], [0, 0.4, 0]]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, h, 4), trim);
    ant.position.set(x, 0.28 + h / 2, -0.06);
    ant.rotation.z = rz;
    g.add(ant);
  }

  // Stabilizer halo (spins).
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 6, 20), trim);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < 3; i++) {
    const node = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), coreMat);
    const a = (i / 3) * Math.PI * 2;
    node.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
    ring.add(node);
  }

  // Underside thruster glow.
  const thruster = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 8), coreMat);
  thruster.rotation.x = Math.PI; thruster.position.y = -0.42; thruster.scale.multiplyScalar(0.9);
  thruster.material = new THREE.MeshBasicMaterial({ color: coreColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  g.add(thruster);

  g.scale.setScalar(scale);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, body, core, ring, spinners: [{ mesh: body, ax: 0, ay: 0.5, az: 0 }] };
}

// KAMIKAZE RUSHER — a spiked charging bomb-drone with an unstable pulsing core.
function buildRusherMesh() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x7a2f38, roughness: 0.5, metalness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x35181e, roughness: 0.6, metalness: 0.3 });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });

  // Faceted warhead body.
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), shell);
  body.scale.set(0.85, 1.05, 0.85);
  g.add(body);

  // Exposed unstable core.
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), coreMat);
  core.position.z = 0.24;
  g.add(core);

  // Radial spikes — reads "do not touch".
  const spikeGeo = new THREE.ConeGeometry(0.06, 0.28, 4);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = new THREE.Mesh(spikeGeo, trim);
    s.position.set(Math.cos(a) * 0.34, Math.sin(a) * 0.34, -0.05);
    s.rotation.z = -a + Math.PI / 2;
    g.add(s);
  }
  const nose = new THREE.Mesh(spikeGeo, trim);
  nose.rotation.x = -Math.PI / 2; nose.position.z = 0.42; nose.scale.set(1.3, 1.3, 1.3);
  g.add(nose);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 5, 14), trim);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, body, core, ring, spinners: [{ mesh: body, ax: 0.6, ay: 0.6, az: 0 }] };
}

// OVERSEER BOSS — deliberately unlike the drone: a hovering war-platform with a
// segmented orbital shell, four radial weapon arms, a spiked crown, and a large
// central plasma eye (the weak point). Compact enough that cover matters.
function buildBossMesh() {
  const g = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: 0x5b4a72, roughness: 0.5, metalness: 0.45 });
  const armorDark = new THREE.MeshStandardMaterial({ color: 0x2c2438, roughness: 0.55, metalness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a6ab0, roughness: 0.45, metalness: 0.5 });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff2040 });
  const box = new THREE.BoxGeometry(1, 1, 1);

  // Central housing (dodecahedron) — the "head".
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.52, 0), armor);
  g.add(body);

  // Big plasma eye set into the front — crit weak point.
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.18, 8), armorDark);
  socket.rotation.x = Math.PI / 2; socket.position.z = 0.42;
  g.add(socket);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), coreMat);
  core.position.z = 0.5; core.scale.z = 0.7;
  g.add(core);

  // Orbital shell: split armor plates on a spinning ring.
  const ring = new THREE.Group();
  const plateGeo = new THREE.TorusGeometry(0.95, 0.12, 8, 6, Math.PI / 2.4);
  for (let i = 0; i < 4; i++) {
    const plate = new THREE.Mesh(plateGeo, armor);
    plate.rotation.x = Math.PI / 2;
    plate.rotation.z = (i / 4) * Math.PI * 2;
    ring.add(plate);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), coreMat);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    lamp.position.set(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95);
    ring.add(lamp);
  }
  g.add(ring);

  // Four radial weapon arms with muzzle pods.
  const arms = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.Mesh(box, armorDark);
    arm.scale.set(0.12, 0.12, 0.7);
    arm.position.set(Math.cos(a) * 0.5, -0.18, Math.sin(a) * 0.5);
    arm.rotation.y = -a + Math.PI / 2;
    arms.add(arm);
    const pod = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 6), trim);
    pod.position.set(Math.cos(a) * 0.85, -0.18, Math.sin(a) * 0.85);
    pod.rotation.x = Math.PI / 2; pod.rotation.z = -a;
    arms.add(pod);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), coreMat);
    glow.position.set(Math.cos(a) * 0.99, -0.18, Math.sin(a) * 0.99);
    arms.add(glow);
  }
  g.add(arms);

  // Spiked crown on top.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 4), trim);
    horn.position.set(Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3);
    horn.rotation.z = -Math.cos(a) * 0.4;
    horn.rotation.x = Math.sin(a) * 0.4;
    g.add(horn);
  }

  // Underglow.
  const under = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.5, 10),
    new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  under.rotation.x = Math.PI; under.position.y = -0.6;
  g.add(under);

  g.scale.setScalar(E.types.boss.meshScale);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return {
    group: g, body, core, ring,
    spinners: [
      { mesh: body, ax: 0, ay: 0.3, az: 0 },
      { mesh: arms, ax: 0, ay: -0.5, az: 0 },
    ],
  };
}

function buildMesh(type) {
  if (type === 'rusher') return buildRusherMesh();
  if (type === 'boss') return buildBossMesh();
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
    // Boss specials.
    this.novaCd = 0;
    this.slamCd = 0;
    this.special = null;      // null | 'nova' | 'slam'
    this.specialT = 0;
    this.flankAngle = 0;
    this.flankT = 0;
    this.mesh.visible = false;
  }

  // Meshes are rebuilt only when this pool slot changes type.
  _ensureMesh(type) {
    if (this.type === type) return;
    if (this.mesh) { this.scene.remove(this.mesh); disposeObj(this.mesh); }
    const { group, body, core, ring, spinners } = buildMesh(type);
    this.mesh = group;
    this.body = body;
    this.core = core;
    this.ring = ring;
    this.spinners = spinners || [];
    this.coreZ = core.position.z; // local forward offset of the weak-point
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
    this.novaCd = rand(this.stats.novaCooldownMin || 6, this.stats.novaCooldownMax || 8);
    this.slamCd = this.stats.slamCooldown || 9;
    this.special = null;
    this.specialT = 0;
    this.flankT = 0;
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

    // ---- Projectile pool (each has its own material so bolts can be tinted) ----
    this.projectiles = [];
    const pGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const haloGeo = new THREE.SphereGeometry(0.22, 8, 6);
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xff7a55 }));
      m.visible = false;
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
        color: 0xff5030, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.add(halo);
      scene.add(m);
      this.projectiles.push({ mesh: m, halo, vel: new THREE.Vector3(), life: 0, dmg: E.projectileDamage });
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
      this._v.set(0, 0, e.coreZ * s)
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

  _tintProjectile(p, color, haloColor) {
    p.mesh.material.color.setHex(color);
    p.halo.material.color.setHex(haloColor);
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
    p.dmg = E.projectileDamage;
    p.mesh.scale.setScalar(1);
    this._tintProjectile(p, enemy.type === 'boss' ? 0xff5aa0 : 0xff7a55, enemy.type === 'boss' ? 0xff3080 : 0xff5030);
    p.mesh.visible = true;
    audio.enemyShoot();
  }

  // Boss special: radial plasma nova — a ring of bolts fired outward.
  _fireNova(enemy) {
    const T = enemy.stats;
    const cx = enemy.position.x, cy = enemy.position.y, cz = enemy.position.z;
    for (let i = 0; i < T.novaCount; i++) {
      const p = this.projectiles.find((pr) => pr.life <= 0);
      if (!p) break;
      const a = (i / T.novaCount) * Math.PI * 2;
      p.mesh.position.set(cx + Math.cos(a) * 0.8, cy, cz + Math.sin(a) * 0.8);
      p.vel.set(Math.cos(a) * T.novaSpeed, rand(-0.5, 0.5), Math.sin(a) * T.novaSpeed);
      p.life = 4;
      p.dmg = E.projectileDamage;
      p.mesh.scale.setScalar(1.3);
      this._tintProjectile(p, 0xc060ff, 0x8020ff);
      p.mesh.visible = true;
    }
    this.effects.ring(new THREE.Vector3(cx, cy, cz));
    this.effects.burst(enemy.position, 0xc060ff, 20, 6, 2, 0.5);
    audio.bossSpawn();
  }

  // Boss special: ground slam — AoE burst that hurts the player if in range/LOS.
  _bossSlam(enemy, player) {
    const T = enemy.stats;
    const pos = enemy.position.clone();
    this.effects.ring(new THREE.Vector3(pos.x, 0.2, pos.z));
    this.effects.burst(new THREE.Vector3(pos.x, 0.3, pos.z), 0xff2040, 40, 12, 4, 0.9);
    this.effects.explosion(new THREE.Vector3(pos.x, 0.4, pos.z));
    audio.grenadeExplode();
    if (player.alive) {
      const d = Math.hypot(player.position.x - pos.x, player.position.z - pos.z);
      if (d < T.slamRadius && this._hasLOS(pos, player.position)) {
        const dmg = Math.round(T.slamDamage * (1 - 0.5 * d / T.slamRadius)); // falloff
        player.takeDamage(dmg);
        this.onPlayerDamaged?.(dmg, pos);
      }
    }
  }

  // Boss special driver. Returns true while a special is winding up (the boss
  // braces and holds fire). Slam triggers when the player closes in; nova is on
  // a timer. Both telegraph before they land.
  _updateBossSpecial(e, player, dt, dist, sees) {
    const T = e.stats;
    if (e.special) {
      e.specialT -= dt;
      if (e.specialT <= 0) {
        if (e.special === 'nova') this._fireNova(e);
        else if (e.special === 'slam') this._bossSlam(e, player);
        e.special = null;
      }
      return true;
    }
    e.novaCd -= dt;
    e.slamCd -= dt;
    if (player.alive && sees && dist < T.slamRange && e.slamCd <= 0) {
      e.special = 'slam';
      e.specialT = T.slamWindup;
      e.slamCd = T.slamCooldown;
      this.effects.ring(new THREE.Vector3(e.position.x, 0.2, e.position.z)); // warning
      return true;
    }
    if (player.alive && sees && e.novaCd <= 0 && dist < T.attackRange) {
      e.special = 'nova';
      e.specialT = T.novaWindup;
      e.novaCd = rand(T.novaCooldownMin, T.novaCooldownMax);
      return true;
    }
    return false;
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

      // Core tint: hit-flash white, plus a bright pulse while a boss charges.
      let coreBright = e.hitFlash;
      if (e.type === 'boss' && e.special) {
        coreBright = Math.max(coreBright, 0.45 + 0.4 * Math.sin(e.stateT * 34));
        const s = 1.25 + 0.4 * Math.sin(e.stateT * 34);
        e.core.scale.set(s, s * 0.7, s);
      } else if (e.type === 'boss') {
        e.core.scale.set(1, 0.7, 1);
      }
      e.core.material.color.copy(e.coreBaseColor).lerp(WHITE, coreBright);

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
          // Drones & boss: close on the player and orbit-strafe hard.
          const busy = e.type === 'boss' && this._updateBossSpecial(e, player, dt, d, seesPlayer);

          const rangeErr = d - T.preferredRange;
          moveDir.copy(flat).multiplyScalar(clamp(rangeErr * 0.5, -1, 1));

          // Anti-camp: drones circle aggressively and flip flank sides so they
          // don't queue up in a corner-camper's crosshair.
          let strafeGain = 0.7;
          if (e.type === 'drone') {
            e.flankT -= dt;
            if (e.flankT <= 0) {
              e.flankT = rand(1.5, 3.5);
              if (Math.random() < (T.flankChance || 0)) e.strafeDir *= -1;
            }
            strafeGain = 0.95;
          }
          moveDir.x += -flat.z * strafeGain * e.strafeDir;
          moveDir.z += flat.x * strafeGain * e.strafeDir;
          if (Math.random() < dt * 0.15) e.strafeDir *= -1;
          if (busy) moveDir.multiplyScalar(0.15); // brace during a special windup
          if (moveDir.lengthSq() > 1) moveDir.normalize();

          if (!busy && T.canShoot && player.alive && seesPlayer && distToPlayer < T.attackRange) {
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

          if (e.losT > 4.5 || !player.alive) { e.state = STATE.WANDER; e.wanderT = 0; }
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

      // Idle spin flourishes.
      if (e.type === 'boss') e.ring.rotation.y += dt * 0.6;
      else e.ring.rotation.z += dt * (e.type === 'rusher' ? 4 : 1.5);
      for (const sp of e.spinners) {
        sp.mesh.rotation.x += sp.ax * dt;
        sp.mesh.rotation.y += sp.ay * dt;
        sp.mesh.rotation.z += sp.az * dt;
      }
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
        player.takeDamage(p.dmg);
        this.onPlayerDamaged?.(p.dmg, pos.clone().addScaledVector(p.vel, -0.5));
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

function disposeObj(obj) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose();
    }
  });
}
