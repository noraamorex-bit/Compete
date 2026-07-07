// Arena hazard: a rotating laser beam sweeping from the central pylon.
// Active from CONFIG.hazard.startWave on; cover and high ground block it.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { raycastColliders } from './utils.js';

const H = CONFIG.hazard;

export class LaserSweep {
  constructor(scene, colliders) {
    this.colliders = colliders;
    this.active = false;
    this.warmup = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.dir = 1;
    this.tickT = 0;
    this.onHitPlayer = null; // cb(damage, sourcePos)

    // Emitter pylon on the central platform.
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x2c333f, roughness: 0.6, metalness: 0.4 });
    this.pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.4, 8), pylonMat);
    this.pylon.position.set(0, 1.5 + 0.7, 0);
    this.pylon.castShadow = true;
    scene.add(this.pylon);

    this.emitter = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshBasicMaterial({ color: 0xff2040 })
    );
    this.emitter.position.set(0, 2.45, 0);
    scene.add(this.emitter);

    // Beam: thin glowing box from inner to outer radius.
    const len = H.outerRadius - H.innerRadius;
    const beamGeo = new THREE.BoxGeometry(0.12, 0.12, len);
    beamGeo.translate(0, 0, -(H.innerRadius + len / 2));
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff2040, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    const haloGeo = new THREE.BoxGeometry(0.4, 0.4, len);
    haloGeo.translate(0, 0, -(H.innerRadius + len / 2));
    this.halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
      color: 0xff2040, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.beam.add(this.halo);
    this.beam.position.set(0, H.height, 0);
    scene.add(this.beam);

    this._setVisible(false);
  }

  _setVisible(v) {
    this.beam.visible = v;
    this.emitter.visible = true; // pylon always shows; emitter glows when armed
    this.emitter.material.color.setHex(v ? 0xff2040 : 0x5a2830);
  }

  // Called at the start of each wave (and from goToMenu with wave 0).
  setWave(waveNumber) {
    const on = waveNumber >= H.startWave;
    if (on && !this.active) this.angle = Math.random() * Math.PI * 2;
    this.active = on;
    this.warmup = on ? H.warmup : 0;
    this.dir = waveNumber % 2 === 0 ? 1 : -1;
    this._setVisible(on);
  }

  stop() {
    this.active = false;
    this._setVisible(false);
  }

  update(dt, player) {
    if (!this.active) return;
    this.tickT = Math.max(0, this.tickT - dt);
    this.emitter.rotation.y += dt * 2;

    if (this.warmup > 0) {
      // Telegraph: beam blinks and doesn't hurt yet.
      this.warmup -= dt;
      const blink = (this.warmup * 5) % 1 > 0.5;
      this.beamMat.opacity = blink ? 0.25 : 0.06;
      this.halo.material.opacity = blink ? 0.08 : 0.02;
      return;
    }

    this.angle += H.speed * this.dir * dt;
    this.beam.rotation.y = this.angle;
    const pulse = 0.75 + Math.sin(performance.now() * 0.02) * 0.15;
    this.beamMat.opacity = pulse;
    this.halo.material.opacity = 0.16;

    if (!player.alive || this.tickT > 0) return;

    // Hit test: player inside the beam's swept line at beam height?
    // Beam local -z axis rotated by angle → world direction.
    const dx = -Math.sin(this.angle);
    const dz = -Math.cos(this.angle);
    const px = player.position.x;
    const pz = player.position.z;
    const proj = px * dx + pz * dz;               // distance along the beam
    if (proj < H.innerRadius || proj > H.outerRadius) return;
    const perp = Math.abs(px * dz - pz * dx);     // distance off the beam line
    if (perp > H.halfWidth + player.half.x) return;
    const feet = player.position.y - player.half.y;
    const head = player.position.y + player.half.y;
    if (feet > H.height + 0.35 || head < H.height - 0.35) return;

    // Cover blocks the beam.
    const ox = dx * (H.innerRadius - 0.1);
    const oz = dz * (H.innerRadius - 0.1);
    const hit = raycastColliders(ox, H.height, oz, dx, 0, dz, this.colliders, proj - H.innerRadius);
    if (hit) return;

    this.tickT = H.tickInterval;
    this.onHitPlayer?.(H.damage, new THREE.Vector3(px - dx, H.height, pz - dz));
  }
}
