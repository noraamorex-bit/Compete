// The guns: parametric low-poly viewmodels, sway/bob/kick animation,
// aim-down-sights, hitscan shooting with spread + recoil, reload, muzzle flash.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, rand, raycastColliders } from './utils.js';
import { audio } from './audio.js';

const REST_POS = new THREE.Vector3(0.24, -0.22, -0.38);
// Sight dot sits at local (0, 0.093, z); this root offset centers it on the camera.
const ADS_POS = new THREE.Vector3(0, -0.093, -0.46);

// ---------- Weapon viewmodels ----------
// Each weapon has its own silhouette. The one hard constraint: every gun must
// place its sight glow at local (0, 0.093, -0.02) so ADS_POS aligns it with the
// crosshair. Each builder returns { group, mag, muzzleZ }; `mag` is the part the
// reload animation drops/rotates, `muzzleZ` is where the muzzle flash sits.

const BOX = new THREE.BoxGeometry(1, 1, 1);
const AIM = [0, 0.093, -0.02]; // shared aim point

function gunKit(stats) {
  const g = new THREE.Group();
  // Keep metalness low — no env map, so high metalness renders black.
  const mats = {
    metal: new THREE.MeshStandardMaterial({ color: 0x4d5666, roughness: 0.45, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x353d49, roughness: 0.4, metalness: 0.45 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x525b6a, roughness: 0.8, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x343a45, roughness: 0.8, metalness: 0.05 }),
    accent: new THREE.MeshStandardMaterial({ color: stats.accent, roughness: 0.5, metalness: 0.25 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x4de8ff }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.7, metalness: 0.05 }),
  };
  const part = (mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(BOX, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  const cyl = (mat, x, y, z, r1, r2, h, seg = 8, rx = Math.PI / 2, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  return { g, mats, part, cyl };
}

// Red-dot optic (open tube, glow at aim point).
function addRedDot(part, m) {
  part(m.metal, -0.02, 0.082, -0.02, 0.006, 0.045, 0.065);
  part(m.metal, 0.02, 0.082, -0.02, 0.006, 0.045, 0.065);
  part(m.metal, 0, 0.107, -0.02, 0.046, 0.007, 0.065);
  part(m.metal, 0, 0.062, -0.02, 0.046, 0.008, 0.065);
  part(m.glow, ...AIM, 0.008, 0.008, 0.004);
}

// Low iron sights: rear notch + front post, glow bead at aim point.
function addIronSights(part, m, frontZ) {
  part(m.steel, -0.014, 0.078, 0.02, 0.006, 0.03, 0.01);   // rear posts
  part(m.steel, 0.014, 0.078, 0.02, 0.006, 0.03, 0.01);
  part(m.steel, 0, 0.076, frontZ, 0.008, 0.032, 0.01);     // front post
  part(m.glow, ...AIM, 0.01, 0.01, 0.006);                 // bead
}

// Trigger group shared by long guns.
function addGrip(part, m, gz = 0.045) {
  part(m.polymer, 0, -0.09, gz, 0.04, 0.095, 0.052, -0.28);
  part(m.dark, 0, -0.128, gz + 0.013, 0.042, 0.02, 0.05, -0.28);
  part(m.steel, 0, -0.06, gz - 0.047, 0.007, 0.028, 0.01, 0.25);
  part(m.metal, 0, -0.082, gz - 0.045, 0.036, 0.006, 0.075);
}

function finish(g, mag, muzzleZ) {
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { group: g, mag, muzzleZ };
}

// ===== VOLT-7 — balanced assault carbine =====
function buildAR(stats) {
  const { g, mats: m, part } = gunKit(stats);
  part(m.metal, 0, 0.012, -0.09, 0.05, 0.046, 0.34);
  part(m.polymer, 0, -0.028, -0.06, 0.048, 0.05, 0.27);
  part(m.steel, -0.026, 0.012, -0.03, 0.004, 0.02, 0.07);            // port
  part(m.steel, -0.03, 0.034, 0.045, 0.014, 0.01, 0.045);           // charging handle
  part(m.metal, 0, 0.043, -0.09, 0.032, 0.012, 0.32);               // rail
  for (let i = 0; i < 7; i++) part(m.steel, 0, 0.051, -0.21 + i * 0.04, 0.034, 0.004, 0.016);
  // Octagonal vented handguard
  part(m.polymer, 0, 0.008, -0.37, 0.046, 0.048, 0.24);
  part(m.polymer, 0, 0.008, -0.37, 0.04, 0.04, 0.235, 0, 0, Math.PI / 4);
  for (let i = 0; i < 3; i++) { part(m.dark, -0.025, 0.008, -0.3 - i * 0.06, 0.003, 0.016, 0.032); }
  part(m.accent, 0, 0.008, -0.48, 0.05, 0.052, 0.014);
  part(m.steel, 0, 0.012, -0.56, 0.02, 0.02, 0.16);                 // barrel
  part(m.metal, 0, 0.012, -0.64, 0.03, 0.032, 0.06);               // brake
  addRedDot(part, m);
  addGrip(part, m);
  part(m.metal, 0, 0.008, 0.13, 0.028, 0.028, 0.1);                // buffer tube
  part(m.dark, 0, -0.022, 0.2, 0.038, 0.07, 0.08);                 // butt
  part(m.dark, 0, 0.026, 0.19, 0.034, 0.022, 0.09);
  part(m.accent, -0.02, -0.022, 0.2, 0.002, 0.05, 0.06);
  const mag = new THREE.Group();
  mag.position.set(0, -0.075, -0.085);
  const body = new THREE.Mesh(BOX, m.dark); body.scale.set(0.042, 0.12, 0.062);
  body.position.set(0, -0.045, 0); body.rotation.x = 0.18; mag.add(body);
  const base = new THREE.Mesh(BOX, m.accent); base.scale.set(0.046, 0.016, 0.068);
  base.position.set(0, -0.108, -0.012); base.rotation.x = 0.18; mag.add(base);
  g.add(mag);
  return finish(g, mag, -0.7);
}

// ===== SCATTER-6 — pump shotgun: fat receiver, under-tube, sliding pump =====
function buildShotgun(stats) {
  const { g, mats: m, part, cyl } = gunKit(stats);
  part(m.metal, 0, 0.01, -0.08, 0.06, 0.075, 0.32);                // beefy receiver
  part(m.steel, -0.031, 0.02, -0.02, 0.005, 0.03, 0.09);          // ejection port
  cyl(m.steel, 0, 0.03, -0.5, 0.032, 0.034, 0.62);               // thick barrel
  cyl(m.dark, 0, 0.03, -0.82, 0.042, 0.042, 0.04);               // wide choke
  cyl(m.steel, 0, -0.03, -0.46, 0.026, 0.026, 0.5);              // under mag tube
  part(m.wood, 0, 0.008, 0.18, 0.05, 0.075, 0.18);               // wood stock
  part(m.wood, 0, 0.055, 0.13, 0.04, 0.03, 0.1);                 // comb
  part(m.accent, -0.026, 0.008, 0.18, 0.003, 0.05, 0.12);
  addIronSights(part, m, -0.78);
  addGrip(part, m, 0.03);
  // Pump grip (this is the animated "mag").
  const mag = new THREE.Group();
  mag.position.set(0, -0.03, -0.42);
  const pump = new THREE.Mesh(BOX, m.wood); pump.scale.set(0.06, 0.055, 0.16); mag.add(pump);
  const ribs = new THREE.Mesh(BOX, m.dark); ribs.scale.set(0.065, 0.012, 0.16); ribs.position.y = 0.02; mag.add(ribs);
  g.add(mag);
  return finish(g, mag, -0.86);
}

// ===== SPARK-9 — compact SMG: stubby, long curved mag, folding stub =====
function buildSMG(stats) {
  const { g, mats: m, part, cyl } = gunKit(stats);
  part(m.metal, 0, 0.012, -0.05, 0.045, 0.06, 0.26);             // short receiver
  part(m.dark, 0, 0.048, -0.05, 0.03, 0.012, 0.22);             // stubby rail
  part(m.steel, -0.024, 0.02, 0.0, 0.004, 0.024, 0.05);        // bolt
  cyl(m.steel, 0, 0.012, -0.26, 0.018, 0.018, 0.2);           // short barrel
  cyl(m.dark, 0, 0.012, -0.37, 0.028, 0.03, 0.05);            // compensator
  part(m.accent, 0, 0.012, -0.19, 0.032, 0.034, 0.02);       // barrel shroud band
  addRedDot(part, m);
  addGrip(part, m, 0.02);
  // Folding stub stock
  part(m.dark, 0, 0.01, 0.12, 0.02, 0.02, 0.11);
  part(m.dark, 0, -0.03, 0.17, 0.05, 0.012, 0.03);
  // Long curved magazine (the animated mag)
  const mag = new THREE.Group();
  mag.position.set(0, -0.075, -0.02);
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(BOX, i === 3 ? m.accent : m.dark);
    seg.scale.set(0.04, 0.05, 0.05);
    seg.position.set(0, -0.03 - i * 0.045, i * 0.02);
    seg.rotation.x = 0.32;
    mag.add(seg);
  }
  g.add(mag);
  return finish(g, mag, -0.4);
}

// ===== STORM-99 — heavy LMG: ribbed shroud, drum, carry handle, bipod =====
function buildLMG(stats) {
  const { g, mats: m, part, cyl } = gunKit(stats);
  part(m.metal, 0, 0.01, -0.08, 0.065, 0.085, 0.4);            // big receiver
  // Carry handle arch
  part(m.dark, 0, 0.09, -0.12, 0.02, 0.05, 0.03);
  part(m.dark, 0, 0.09, 0.02, 0.02, 0.05, 0.03);
  part(m.metal, 0, 0.115, -0.05, 0.024, 0.02, 0.18);
  // Ribbed heavy barrel shroud
  cyl(m.steel, 0, 0.02, -0.5, 0.05, 0.05, 0.5);
  for (let i = 0; i < 6; i++) cyl(m.dark, 0, 0.02, -0.34 - i * 0.06, 0.055, 0.055, 0.014, 10);
  cyl(m.metal, 0, 0.02, -0.82, 0.045, 0.05, 0.08);            // muzzle
  part(m.accent, 0, 0.02, -0.28, 0.058, 0.058, 0.016);
  addRedDot(part, m);
  addGrip(part, m, 0.04);
  // Bipod (folded down under the barrel)
  part(m.steel, -0.03, -0.16, -0.62, 0.008, 0.16, 0.01, 0.3, 0, 0.25);
  part(m.steel, 0.03, -0.16, -0.62, 0.008, 0.16, 0.01, 0.3, 0, -0.25);
  part(m.dark, 0, -0.01, 0.16, 0.05, 0.08, 0.1);             // stock
  // Big drum magazine (animated)
  const mag = new THREE.Group();
  mag.position.set(0, -0.11, -0.06);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), m.dark);
  drum.rotation.z = Math.PI / 2; mag.add(drum);
  const drumFace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 14), m.accent);
  drumFace.rotation.z = Math.PI / 2; mag.add(drumFace);
  const neck = new THREE.Mesh(BOX, m.dark); neck.scale.set(0.04, 0.08, 0.05); neck.position.y = 0.09; mag.add(neck);
  g.add(mag);
  return finish(g, mag, -0.88);
}

// ===== ARC-12 — marksman rifle: long barrel, big scope, skeleton stock =====
function buildMarksman(stats) {
  const { g, mats: m, part, cyl } = gunKit(stats);
  part(m.metal, 0, 0.012, -0.05, 0.048, 0.05, 0.34);
  part(m.dark, 0, -0.026, -0.03, 0.046, 0.04, 0.26);
  cyl(m.steel, 0, 0.012, -0.62, 0.017, 0.02, 0.72);          // long thin barrel
  cyl(m.metal, 0, 0.012, -1.0, 0.03, 0.03, 0.07);           // muzzle brake
  part(m.accent, 0, 0.012, -0.3, 0.036, 0.038, 0.016);
  // Big scope tube (reticle glow at aim point)
  cyl(m.dark, 0, 0.088, -0.02, 0.032, 0.032, 0.3, 12, Math.PI / 2);
  cyl(m.metal, 0, 0.088, -0.19, 0.04, 0.04, 0.04, 12, Math.PI / 2);   // objective bell
  cyl(m.metal, 0, 0.088, 0.14, 0.036, 0.036, 0.04, 12, Math.PI / 2);  // eyepiece
  part(m.dark, -0.02, 0.05, -0.05, 0.01, 0.03, 0.04);        // front ring mount
  part(m.dark, 0.02, 0.05, -0.05, 0.01, 0.03, 0.04);
  part(m.glow, ...AIM, 0.012, 0.012, 0.005);                 // reticle
  addGrip(part, m, 0.03);
  // Skeleton thumbhole stock
  part(m.dark, 0, -0.01, 0.16, 0.04, 0.05, 0.14);
  part(m.dark, 0, 0.05, 0.2, 0.036, 0.024, 0.1);            // cheek rest
  part(m.dark, 0, -0.06, 0.26, 0.04, 0.06, 0.03);           // butt
  part(m.accent, -0.021, -0.01, 0.18, 0.002, 0.04, 0.1);
  // Box magazine (animated)
  const mag = new THREE.Group();
  mag.position.set(0, -0.075, -0.06);
  const body = new THREE.Mesh(BOX, m.dark); body.scale.set(0.04, 0.11, 0.06);
  body.position.y = -0.04; mag.add(body);
  const base = new THREE.Mesh(BOX, m.accent); base.scale.set(0.044, 0.014, 0.066);
  base.position.y = -0.095; mag.add(base);
  g.add(mag);
  return finish(g, mag, -1.0);
}

// ===== TITAN-50 — hand cannon: stubby revolver, big cylinder, no stock =====
function buildCannon(stats) {
  const { g, mats: m, part, cyl } = gunKit(stats);
  part(m.metal, 0, 0.02, -0.04, 0.05, 0.07, 0.18);           // frame
  part(m.metal, 0, 0.055, -0.08, 0.03, 0.02, 0.2);          // top strap / rib
  cyl(m.steel, 0, 0.02, -0.22, 0.03, 0.032, 0.22);          // thick short barrel
  cyl(m.dark, 0, 0.02, -0.34, 0.042, 0.042, 0.04);          // muzzle crown
  part(m.accent, 0, 0.02, -0.14, 0.036, 0.04, 0.018);       // barrel band
  addIronSights(part, m, -0.3);
  // Chunky angled grip (no long body)
  part(m.wood, 0, -0.11, 0.06, 0.05, 0.13, 0.06, -0.32);
  part(m.dark, 0, -0.175, 0.085, 0.052, 0.02, 0.06, -0.32);
  part(m.steel, 0, -0.05, -0.04, 0.007, 0.03, 0.01, 0.25);  // trigger
  part(m.metal, 0, -0.075, -0.03, 0.036, 0.006, 0.07);      // guard
  // Revolver cylinder (the animated "mag" — swings/drops on reload)
  const mag = new THREE.Group();
  mag.position.set(0, 0.0, -0.02);
  const cyl6 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12), m.steel);
  cyl6.rotation.x = Math.PI / 2; mag.add(cyl6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.12, 6), m.dark);
    bore.rotation.x = Math.PI / 2;
    bore.position.set(Math.cos(a) * 0.032, Math.sin(a) * 0.032, 0);
    mag.add(bore);
  }
  const flute = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 12), m.accent);
  flute.rotation.x = Math.PI / 2; mag.add(flute);
  g.add(mag);
  return finish(g, mag, -0.36);
}

const WEAPON_BUILDERS = {
  volt: buildAR, scatter: buildShotgun, spark: buildSMG,
  storm: buildLMG, arc: buildMarksman, titan: buildCannon,
};

function buildWeaponMesh(stats) {
  return (WEAPON_BUILDERS[stats.id] || buildAR)(stats);
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
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry && o.geometry !== BOX) o.geometry.dispose(); // BOX is shared
        o.material?.dispose();
      });
    }
    const { group, mag, muzzleZ } = buildWeaponMesh(stats);
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
