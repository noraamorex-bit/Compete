// The guns: parametric low-poly viewmodels, sway/bob/kick animation,
// aim-down-sights, hitscan shooting with spread + recoil, reload, muzzle flash.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, rand, raycastColliders } from './utils.js';
import { audio } from './audio.js';

const REST_POS = new THREE.Vector3(0.24, -0.22, -0.38);
// Sight dot sits at local (0, 0.093, z); this root offset centers it on the camera.
const ADS_POS = new THREE.Vector3(0, -0.093, -0.46);

// Parametric low-poly rifle. The camera sees the gun's left (-x) flank, so
// mechanical details (port, charging handle, vents) live on that side.
// The optic's glow dot sits at local (0, 0.093, z) — ADS_POS aligns to it.
function buildRifleMesh(stats) {
  const g = new THREE.Group();
  // Note: keep metalness low — there's no environment map, so high
  // metalness renders as pure black regardless of base color.
  const metal = new THREE.MeshStandardMaterial({ color: 0x4d5666, roughness: 0.45, metalness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x353d49, roughness: 0.4, metalness: 0.45 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x525b6a, roughness: 0.8, metalness: 0.05 });
  const polymerDark = new THREE.MeshStandardMaterial({ color: 0x343a45, roughness: 0.8, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: stats.accent, roughness: 0.5, metalness: 0.25 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x4de8ff });
  const box = new THREE.BoxGeometry(1, 1, 1);

  const part = (mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };

  const barrelLen = 0.34 * stats.barrel;
  const barrelEnd = -0.25 - barrelLen;
  const guardLen = barrelLen * 0.72;
  const guardMid = -0.25 - guardLen / 2;

  // ---- Receiver ----
  part(metal, 0, 0.012, -0.09, 0.05, 0.046, 0.34);                    // upper
  part(polymer, 0, -0.028, -0.06, 0.048, 0.05, 0.27);                 // lower
  part(steel, -0.026, 0.012, -0.03, 0.004, 0.02, 0.07);               // ejection port
  part(steel, -0.03, 0.034, 0.045, 0.014, 0.01, 0.045);               // charging handle
  part(polymerDark, -0.027, -0.02, -0.015, 0.004, 0.014, 0.03);       // mag release
  part(steel, -0.027, -0.005, 0.02, 0.005, 0.008, 0.035, 0, 0, 0.5);  // selector lever

  // ---- Top rail with notches ----
  part(metal, 0, 0.043, -0.09, 0.032, 0.012, 0.32);
  for (let i = 0; i < 7; i++) {
    part(steel, 0, 0.051, -0.21 + i * 0.04, 0.034, 0.004, 0.016);
  }

  // ---- Handguard: octagonal (two boxes, one rotated 45°) + vents ----
  part(polymer, 0, 0.008, guardMid, 0.046, 0.048, guardLen);
  part(polymer, 0, 0.008, guardMid, 0.04, 0.04, guardLen * 0.98, 0, 0, Math.PI / 4);
  const vents = Math.max(2, Math.round(guardLen / 0.075));
  for (let i = 0; i < vents; i++) {
    const vz = -0.27 - (i + 0.5) * (guardLen - 0.04) / vents;
    part(polymerDark, -0.025, 0.008, vz, 0.003, 0.016, 0.032);
    part(polymerDark, 0, -0.019, vz, 0.016, 0.003, 0.032);            // bottom vent
  }
  part(accent, 0, 0.008, -0.25 - guardLen + 0.015, 0.05, 0.052, 0.014); // guard end band

  // ---- Barrel, muzzle device, front sight ----
  part(steel, 0, 0.012, (barrelEnd - 0.25 - guardLen) / 2 - 0.02, 0.02, 0.02, barrelLen - guardLen + 0.02);
  part(metal, 0, 0.012, barrelEnd - 0.025, 0.03, 0.032, 0.06);        // muzzle brake
  part(polymerDark, -0.017, 0.012, barrelEnd - 0.02, 0.003, 0.014, 0.035); // brake slot
  part(polymerDark, 0.017, 0.012, barrelEnd - 0.02, 0.003, 0.014, 0.035);
  part(steel, 0, 0.045, barrelEnd + 0.06, 0.007, 0.03, 0.008);        // front sight post

  // ---- Red-dot optic: open tube you can see through; dot at y 0.093 ----
  part(metal, -0.02, 0.082, -0.02, 0.006, 0.045, 0.065);              // left plate
  part(metal, 0.02, 0.082, -0.02, 0.006, 0.045, 0.065);               // right plate
  part(metal, 0, 0.107, -0.02, 0.046, 0.007, 0.065);                  // hood
  part(metal, 0, 0.062, -0.02, 0.046, 0.008, 0.065);                  // base
  part(glow, 0, 0.093, -0.02, 0.008, 0.008, 0.004);                   // the dot

  // ---- Grip, trigger, trigger guard ----
  part(polymer, 0, -0.09, 0.045, 0.04, 0.095, 0.052, -0.28);          // angled grip
  part(polymerDark, 0, -0.128, 0.058, 0.042, 0.02, 0.05, -0.28);      // grip base
  part(steel, 0, -0.06, -0.002, 0.007, 0.028, 0.01, 0.25);            // trigger
  part(metal, 0, -0.082, 0.0, 0.036, 0.006, 0.075);                   // guard bottom
  part(metal, 0, -0.066, -0.035, 0.036, 0.03, 0.006);                 // guard front
  part(metal, 0, -0.066, 0.036, 0.036, 0.03, 0.006);                  // guard rear

  // ---- Magazine (animated during reload) ----
  const mag = new THREE.Group();
  mag.position.set(0, -0.075, -0.085);
  const isShotgun = (stats.pellets || 1) > 1;
  const bigMag = stats.magSize >= 60;
  if (isShotgun) {
    // Shotgun: under-barrel shell tube instead of a box mag.
    part(steel, 0, -0.012, guardMid - 0.02, 0.024, 0.024, guardLen + 0.05);
    const shell = new THREE.Mesh(box, accent);
    shell.position.set(0, -0.02, 0.02);
    shell.scale.set(0.03, 0.04, 0.05);
    mag.add(shell); // token "shell in the loading port" so reloads still read
  } else {
    const body = new THREE.Mesh(box, polymerDark);
    body.scale.set(0.042, bigMag ? 0.16 : 0.12, bigMag ? 0.11 : 0.062);
    body.position.set(0, bigMag ? -0.06 : -0.045, 0);
    body.rotation.x = bigMag ? 0 : 0.18;
    mag.add(body);
    const base = new THREE.Mesh(box, accent);
    base.scale.set(0.046, 0.016, bigMag ? 0.115 : 0.068);
    base.position.set(0, bigMag ? -0.145 : -0.108, bigMag ? 0 : -0.012);
    base.rotation.x = bigMag ? 0 : 0.18;
    mag.add(base);
  }
  g.add(mag);

  // ---- Stock: buffer tube, slim butt (kept dark — it sits near the eye in ADS) ----
  part(metal, 0, 0.008, 0.13, 0.028, 0.028, 0.1);                     // buffer tube
  part(polymerDark, 0, -0.022, 0.2, 0.038, 0.07, 0.08);               // butt
  part(polymerDark, 0, 0.026, 0.19, 0.034, 0.022, 0.09);              // cheek riser
  part(accent, -0.02, -0.022, 0.2, 0.002, 0.05, 0.06);                // side accent stripe

  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  return { group: g, mag, muzzleZ: barrelEnd - 0.06 };
}

export class Weapon {
  constructor(camera, effects, colliders, stats) {
    this.camera = camera;
    this.effects = effects;
    this.colliders = colliders;

    this.reloading = false;
    this.reloadT = 0;
    this._reloadStage = 0;
    this.cooldown = 0;
    this.bloom = 0;             // accumulated spread from firing
    this.adsBlend = 0;          // 0 = hip, 1 = aimed
    this.damageMult = 1;        // pickup boost sets this to 2

    this.onAmmoChanged = null;  // cb(ammo)
    this.onHit = null;          // cb('hit'|'crit'|'kill')
    this.onFired = null;        // cb(hitPoint) — for duel shot replication

    // --- viewmodel rig ---
    this.root = new THREE.Group();
    this.root.position.copy(REST_POS);
    camera.add(this.root);

    // Short-range fill so the gun's camera-facing surfaces aren't pitch black.
    const fill = new THREE.PointLight(0xbfd0e8, 0.55, 2.2, 2);
    fill.position.set(0.05, 0.18, 0.25);
    camera.add(fill);

    // Muzzle flash: additive plane + point light, repositioned per weapon.
    this.muzzle = new THREE.Object3D();
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

    this.mesh = null;
    this.setStats(stats);
  }

  // Swap the equipped weapon: stats + rebuilt viewmodel.
  setStats(stats) {
    this.stats = stats;
    if (this.mesh) this.root.remove(this.mesh);
    const { group, mag, muzzleZ } = buildRifleMesh(stats);
    this.mesh = group;
    this.magMesh = mag;
    this._magRest = mag.position.clone();
    this._magRestRotX = mag.rotation.x;
    this.root.add(this.mesh);
    this.muzzle.position.set(0, 0.005, muzzleZ);
    this.mesh.add(this.muzzle);
    this.reset();
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
    g.strokeStyle = 'rgba(255,220,150,0.9)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(32, 2); g.lineTo(32, 62); g.moveTo(2, 32); g.lineTo(62, 32); g.stroke();
    return new THREE.CanvasTexture(c);
  }

  get currentSpread() {
    return (this.stats.baseSpread + this.bloom) * this._adsSpreadFactor();
  }

  _adsSpreadFactor() {
    return 1 - 0.75 * this.adsBlend;
  }

  reset() {
    this.ammo = this.stats.magSize;
    this.reloading = false;
    this.reloadT = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this._kick = 0;
    this.adsBlend = 0;
    this.onAmmoChanged?.(this.ammo);
  }

  startReload() {
    if (this.reloading || this.ammo === this.stats.magSize) return;
    this.reloading = true;
    this.reloadT = 0;
    this._reloadStage = 0;
    audio.reloadStart();
  }

  update(dt, input, player, enemies, lookDX, lookDY) {
    const S = this.stats;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - S.spreadRecovery * dt);

    // --- ADS blend (drops out during reload) ---
    const adsTarget = input.aiming && !this.reloading && player.alive ? 1 : 0;
    this.adsBlend += (adsTarget - this.adsBlend) * damp(13, dt);

    // --- Reload sequence ---
    if (this.reloading) {
      this.reloadT += dt;
      const p = this.reloadT / S.reloadTime;
      if (this._reloadStage === 0 && p > 0.35) { this._reloadStage = 1; audio.reloadMid(); }
      if (this._reloadStage === 1 && p > 0.78) { this._reloadStage = 2; audio.reloadEnd(); }
      if (this.reloadT >= S.reloadTime) {
        this.reloading = false;
        this.ammo = S.magSize;
        this.onAmmoChanged?.(this.ammo);
      }
    } else if (input.consumeReload() && this.ammo < S.magSize) {
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
    const S = this.stats;
    this.ammo--;
    this.cooldown = S.fireInterval;
    this.onAmmoChanged?.(this.ammo);

    // Spread: (base + bloom + movement penalty), tightened while aiming.
    const movePenalty = clamp(player.speed2D / CONFIG.player.sprintSpeed, 0, 1) * S.moveSpread
      + (player.grounded ? 0 : S.moveSpread * 0.8);
    const spread = (S.baseSpread + this.bloom + movePenalty) * this._adsSpreadFactor();
    this.bloom = Math.min(this.bloom + S.spreadPerShot, 0.028);

    const origin = this.camera.getWorldPosition(this._tmpV);
    const baseDir = this.camera.getWorldDirection(new THREE.Vector3());
    const muzzlePos = this.muzzle.getWorldPosition(new THREE.Vector3());
    const pellets = S.pellets || 1;

    // Damage per pellet, aggregated per enemy so one shot shows one number.
    const hits = new Map(); // enemy -> { total, crit, point }
    for (let i = 0; i < pellets; i++) {
      this._dir.copy(baseDir);
      this._dir.x += rand(-spread, spread);
      this._dir.y += rand(-spread, spread);
      this._dir.z += rand(-spread, spread);
      this._dir.normalize();

      const worldHit = raycastColliders(
        origin.x, origin.y, origin.z,
        this._dir.x, this._dir.y, this._dir.z,
        this.colliders, S.range
      );
      const maxDist = worldHit ? worldHit.dist : S.range;
      const enemyHit = enemies.raycast(origin, this._dir, maxDist);

      const hitPoint = this._tmpV2.copy(origin).addScaledVector(
        this._dir, enemyHit ? enemyHit.dist : maxDist
      );

      if (enemyHit) {
        let rec = hits.get(enemyHit.enemy);
        if (!rec) { rec = { total: 0, crit: false, point: hitPoint.clone() }; hits.set(enemyHit.enemy, rec); }
        rec.total += S.damage * this.damageMult * (enemyHit.crit ? S.critMultiplier : 1);
        rec.crit = rec.crit || enemyHit.crit;
        this.effects.burst(hitPoint, enemyHit.crit ? 0xff8a3d : 0xffd166, 4, 3.5, 4, 0.3);
      } else if (worldHit) {
        this.effects.burst(hitPoint, 0xcfd6e4, 3, 3, 8, 0.25);
      } else if (this._dir.y < -0.01) {
        // Floor plane hit
        const t = -origin.y / this._dir.y;
        if (t < S.range) {
          hitPoint.copy(origin).addScaledVector(this._dir, t);
          this.effects.burst(hitPoint, 0xcfd6e4, 3, 3, 8, 0.25);
        }
      }
      this.effects.tracer(muzzlePos, hitPoint);
    }

    // Apply aggregated damage.
    let killed = false, anyCrit = false;
    for (const [enemy, rec] of hits) {
      const result = enemies.applyDamage(enemy, rec.total, rec.point, rec.crit);
      this.effects.damageNumber(rec.point, rec.total, rec.crit);
      if (result === 'killed') killed = true;
      if (rec.crit) anyCrit = true;
    }
    if (hits.size > 0) {
      audio.hit(anyCrit);
      this.onHit?.(killed ? 'kill' : anyCrit ? 'crit' : 'hit');
    }
    this.onFired?.(this._tmpV2); // last pellet's end point

    // Feel: kick, flash, recoil, shake, sound — recoil softened while aiming.
    const recoilScale = 1 - 0.35 * this.adsBlend;
    this._kick = 1;
    this._flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    player.addRecoil(S.recoilKick * rand(0.8, 1.2) * recoilScale);
    player.yaw += rand(-1, 1) * S.recoilKick * 0.35 * recoilScale;
    player.addTrauma(0.06);
    audio.shoot();
  }

  _animate(dt, player, lookDX, lookDY) {
    const ads = this.adsBlend;
    const hip = 1 - ads;

    // Sway from look input (lowpassed), damped while aiming.
    const k = damp(10, dt);
    this._swayX += (clamp(-lookDX * 0.00045, -0.03, 0.03) - this._swayX) * k;
    this._swayY += (clamp(lookDY * 0.00045, -0.03, 0.03) - this._swayY) * k;
    const swayX = this._swayX * (1 - 0.8 * ads);
    const swayY = this._swayY * (1 - 0.8 * ads);

    // Bob from player movement, damped while aiming.
    const bob = player.bobAmp * (1 - 0.7 * ads);
    const bx = Math.cos(player.bobPhase) * 0.012 * bob;
    const by = Math.sin(player.bobPhase * 2) * 0.009 * bob;

    // Kick recovery
    this._kick *= 1 - damp(14, dt);

    // Reload animation curve: dip down + rotate, mag drops and returns.
    let rDip = 0, rRot = 0;
    if (this.reloading) {
      const p = this.reloadT / this.stats.reloadTime;
      const ease = p < 0.25 ? p / 0.25 : p > 0.8 ? (1 - p) / 0.2 : 1;
      rDip = ease * 0.09;
      rRot = ease * 0.5;
      const magP = clamp((p - 0.2) / 0.5, 0, 1);
      const magOut = Math.sin(magP * Math.PI);
      this.magMesh.position.y = this._magRest.y - magOut * 0.14;
      this.magMesh.rotation.x = this._magRestRotX + magOut * 0.5;
    } else {
      this.magMesh.position.copy(this._magRest);
      this.magMesh.rotation.x = this._magRestRotX;
    }

    // Blend hip rest pose toward the centered ADS pose.
    const px = REST_POS.x * hip + ADS_POS.x * ads;
    const py = REST_POS.y * hip + ADS_POS.y * ads;
    const pz = REST_POS.z * hip + ADS_POS.z * ads;

    this.root.position.set(
      px + swayX + bx,
      py + swayY + by - rDip,
      pz + this._kick * 0.055 * (1 - 0.4 * ads)
    );
    this.root.rotation.set(
      swayY * 1.6 + this._kick * 0.12 * (1 - 0.4 * ads) + rRot,
      swayX * 1.8 - hip * 0.05,          // slight inward cant at the hip
      swayX * 0.8 - rRot * 0.35 + hip * 0.025
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
