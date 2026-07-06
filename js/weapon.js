// The rifle: procedural low-poly viewmodel, sway/bob/kick animation,
// hitscan shooting with spread + recoil, reload sequence, muzzle flash.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, rand, raycastColliders } from './utils.js';
import { audio } from './audio.js';

const W = CONFIG.weapon;

function buildRifleMesh() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.55, metalness: 0.35 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x3a4252, roughness: 0.6, metalness: 0.25 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.45, metalness: 0.2 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x4de8ff });
  const box = new THREE.BoxGeometry(1, 1, 1);

  const part = (mat, x, y, z, sx, sy, sz) => {
    const m = new THREE.Mesh(box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };

  part(mid, 0, 0, -0.12, 0.062, 0.085, 0.46);          // receiver
  part(dark, 0, 0.005, -0.42, 0.034, 0.034, 0.34);     // barrel
  part(dark, 0, 0.048, -0.03, 0.03, 0.03, 0.2);        // top rail
  part(mid, 0, 0.075, -0.02, 0.045, 0.03, 0.075);      // sight block
  part(glow, 0, 0.093, -0.02, 0.014, 0.012, 0.014);    // sight dot
  part(dark, 0, -0.07, 0.02, 0.05, 0.09, 0.06);        // grip
  const mag = part(accent, 0, -0.095, -0.09, 0.05, 0.13, 0.07); // magazine
  mag.rotation.x = 0.12;
  part(mid, 0, -0.01, 0.16, 0.05, 0.075, 0.16);        // stock
  part(dark, 0, 0.005, -0.6, 0.045, 0.045, 0.045);     // muzzle brake
  part(accent, 0.0, -0.028, -0.32, 0.055, 0.028, 0.12);// foregrip accent

  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  return { group: g, mag };
}

export class Weapon {
  constructor(camera, effects, colliders) {
    this.camera = camera;
    this.effects = effects;
    this.colliders = colliders;

    this.ammo = W.magSize;
    this.reloading = false;
    this.reloadT = 0;
    this._reloadStage = 0;
    this.cooldown = 0;
    this.bloom = 0;             // accumulated spread from firing

    this.onAmmoChanged = null;  // cb(ammo)
    this.onHit = null;          // cb('hit'|'crit'|'kill')

    // --- viewmodel rig ---
    this.root = new THREE.Group();       // rest position under camera
    this.root.position.set(0.24, -0.22, -0.38);
    const { group, mag } = buildRifleMesh();
    this.mesh = group;
    this.magMesh = mag;
    this._magRest = mag.position.clone();
    this.root.add(this.mesh);
    camera.add(this.root);

    // Muzzle flash: additive plane + point light at the muzzle.
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.005, -0.64);
    this.mesh.add(this.muzzle);

    const flashTex = this._flashTexture();
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({
        map: flashTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      })
    );
    this.flash.renderOrder = 10;
    this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 7, 2);
    this.muzzle.add(this.flashLight);
    this._flashT = 0;

    // Animation state
    this._kick = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  _flashTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.3, 'rgba(255,190,90,0.85)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    // Star points
    g.strokeStyle = 'rgba(255,220,150,0.9)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(32, 2); g.lineTo(32, 62); g.moveTo(2, 32); g.lineTo(62, 32); g.stroke();
    return new THREE.CanvasTexture(c);
  }

  get currentSpread() {
    return W.baseSpread + this.bloom;
  }

  reset() {
    this.ammo = W.magSize;
    this.reloading = false;
    this.reloadT = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this._kick = 0;
    this.onAmmoChanged?.(this.ammo);
  }

  startReload() {
    if (this.reloading || this.ammo === W.magSize) return;
    this.reloading = true;
    this.reloadT = 0;
    this._reloadStage = 0;
    audio.reloadStart();
  }

  // enemies: EnemyManager (raycast + applyDamage), player: for spread/recoil coupling.
  update(dt, input, player, enemies, lookDX, lookDY) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - W.spreadRecovery * dt);

    // --- Reload sequence ---
    if (this.reloading) {
      this.reloadT += dt;
      const p = this.reloadT / W.reloadTime;
      if (this._reloadStage === 0 && p > 0.35) { this._reloadStage = 1; audio.reloadMid(); }
      if (this._reloadStage === 1 && p > 0.78) { this._reloadStage = 2; audio.reloadEnd(); }
      if (this.reloadT >= W.reloadTime) {
        this.reloading = false;
        this.ammo = W.magSize;
        this.onAmmoChanged?.(this.ammo);
      }
    } else if (input.consumeReload() && this.ammo < W.magSize) {
      this.startReload();
    }

    // --- Firing ---
    if (input.firing && !this.reloading && this.cooldown <= 0 && player.alive) {
      if (this.ammo > 0) {
        this._fire(player, enemies);
      } else {
        audio.dryFire();
        this.cooldown = 0.28;
        this.startReload(); // auto-reload on empty trigger pull
      }
    }
    // Auto-reload the instant the mag runs dry and trigger is released.
    if (this.ammo === 0 && !this.reloading && !input.firing) this.startReload();

    this._animate(dt, player, lookDX, lookDY);
  }

  _fire(player, enemies) {
    this.ammo--;
    this.cooldown = W.fireInterval;
    this.onAmmoChanged?.(this.ammo);

    // Spread: base + bloom + movement penalty.
    const movePenalty = clamp(player.speed2D / CONFIG.player.sprintSpeed, 0, 1) * W.moveSpread
      + (player.grounded ? 0 : W.moveSpread * 0.8);
    const spread = W.baseSpread + this.bloom + movePenalty;
    this.bloom = Math.min(this.bloom + W.spreadPerShot, 0.028);

    const origin = this.camera.getWorldPosition(this._tmpV);
    this.camera.getWorldDirection(this._dir);
    // Apply cone spread.
    this._dir.x += rand(-spread, spread);
    this._dir.y += rand(-spread, spread);
    this._dir.z += rand(-spread, spread);
    this._dir.normalize();

    // World geometry hit
    const worldHit = raycastColliders(
      origin.x, origin.y, origin.z,
      this._dir.x, this._dir.y, this._dir.z,
      this.colliders, W.range
    );
    let maxDist = worldHit ? worldHit.dist : W.range;

    // Enemy hit (closer than world geometry?)
    const enemyHit = enemies.raycast(origin, this._dir, maxDist);

    const hitPoint = this._tmpV2.copy(origin).addScaledVector(
      this._dir, enemyHit ? enemyHit.dist : maxDist
    );

    if (enemyHit) {
      const dmg = W.damage * (enemyHit.crit ? W.critMultiplier : 1);
      const result = enemies.applyDamage(enemyHit.enemy, dmg, hitPoint, enemyHit.crit);
      this.effects.burst(hitPoint, enemyHit.crit ? 0xff8a3d : 0xffd166, 8, 3.5, 4, 0.35);
      this.effects.damageNumber(hitPoint, dmg, enemyHit.crit);
      audio.hit(enemyHit.crit);
      this.onHit?.(result === 'killed' ? 'kill' : enemyHit.crit ? 'crit' : 'hit');
    } else if (worldHit) {
      this.effects.burst(hitPoint, 0xcfd6e4, 6, 3, 8, 0.3);
      // Ground-level floor hit check happens implicitly via colliders; floor plane:
    } else if (this._dir.y < -0.01) {
      // Floor plane hit
      const t = -origin.y / this._dir.y;
      if (t < W.range) {
        hitPoint.copy(origin).addScaledVector(this._dir, t);
        this.effects.burst(hitPoint, 0xcfd6e4, 6, 3, 8, 0.3);
      }
    }

    // Tracer from muzzle
    const muzzlePos = this.muzzle.getWorldPosition(new THREE.Vector3());
    this.effects.tracer(muzzlePos, hitPoint);

    // Feel: kick, flash, recoil, shake, sound
    this._kick = 1;
    this._flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    player.addRecoil(W.recoilKick * rand(0.8, 1.2));
    player.yaw += rand(-1, 1) * W.recoilKick * 0.35;
    player.addTrauma(0.06);
    audio.shoot();
  }

  _animate(dt, player, lookDX, lookDY) {
    // Sway from look input (lowpassed)
    const k = damp(10, dt);
    this._swayX += (clamp(-lookDX * 0.00045, -0.03, 0.03) - this._swayX) * k;
    this._swayY += (clamp(lookDY * 0.00045, -0.03, 0.03) - this._swayY) * k;

    // Bob from player movement
    const bob = player.bobAmp;
    const bx = Math.cos(player.bobPhase) * 0.012 * bob;
    const by = Math.sin(player.bobPhase * 2) * 0.009 * bob;

    // Kick recovery
    this._kick *= 1 - damp(14, dt);

    // Reload animation curve: dip down + rotate, mag drops and returns.
    let rDip = 0, rRot = 0;
    if (this.reloading) {
      const p = this.reloadT / W.reloadTime;
      const ease = p < 0.25 ? p / 0.25 : p > 0.8 ? (1 - p) / 0.2 : 1;
      rDip = ease * 0.09;
      rRot = ease * 0.5;
      // Magazine motion
      const magP = clamp((p - 0.2) / 0.5, 0, 1);
      const magOut = Math.sin(magP * Math.PI);
      this.magMesh.position.y = this._magRest.y - magOut * 0.14;
      this.magMesh.rotation.x = 0.12 + magOut * 0.5;
    } else {
      this.magMesh.position.copy(this._magRest);
      this.magMesh.rotation.x = 0.12;
    }

    this.root.position.set(
      0.24 + this._swayX + bx,
      -0.22 + this._swayY + by - rDip,
      -0.38 + this._kick * 0.055
    );
    this.root.rotation.set(
      this._swayY * 1.6 + this._kick * 0.12 + rRot,
      this._swayX * 1.8,
      this._swayX * 0.8 - rRot * 0.35
    );

    // Muzzle flash decay
    if (this._flashT > 0) {
      this._flashT -= dt;
      const f = Math.max(0, this._flashT / 0.045);
      this.flash.material.opacity = f;
      const s = 0.7 + f * 0.6;
      this.flash.scale.set(s, s, s);
      this.flashLight.intensity = f * 3.2;
    } else {
      this.flash.material.opacity = 0;
      this.flashLight.intensity = 0;
    }
  }
}
