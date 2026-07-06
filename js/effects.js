// Visual effects: GPU particle pool, bullet tracers, kill shockwaves,
// and DOM-projected floating damage numbers.

import * as THREE from 'three';
import { rand } from './utils.js';

const MAX_PARTICLES = 240;
const MAX_TRACERS = 24;
const MAX_RINGS = 6;
const MAX_DMG_NUMBERS = 14;

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // ---- Particle pool (single THREE.Points) ----
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);   // remaining
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pGravity = new Float32Array(MAX_PARTICLES);
    this.pCursor = 0;
    this.pPos.fill(9999);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // ---- Tracer pool ----
    this.tracers = [];
    const tGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 4, 1, true);
    tGeo.translate(0, 0.5, 0); // pivot at base
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tCursor = 0;

    // ---- Shockwave rings ----
    this.rings = [];
    const rGeo = new THREE.RingGeometry(0.9, 1, 28);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({
        color: 0x4de8ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0 });
    }
    this.rCursor = 0;

    // ---- Damage number pool (DOM) ----
    this.dmgContainer = document.getElementById('dmg-numbers');
    this.dmgPool = [];
    for (let i = 0; i < MAX_DMG_NUMBERS; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-num';
      el.style.display = 'none';
      this.dmgContainer.appendChild(el);
      this.dmgPool.push({ el, life: 0, pos: new THREE.Vector3(), vy: 0 });
    }
    this.dCursor = 0;

    this._v = new THREE.Vector3();
  }

  spawnParticle(pos, vel, color, life, gravity) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
    this.pVel[i * 3] = vel.x; this.pVel[i * 3 + 1] = vel.y; this.pVel[i * 3 + 2] = vel.z;
    this.pCol[i * 3] = color.r; this.pCol[i * 3 + 1] = color.g; this.pCol[i * 3 + 2] = color.b;
    this.pLife[i] = life;
    this.pMaxLife[i] = life;
    this.pGravity[i] = gravity;
  }

  // Spark burst — bullet impacts, enemy hits.
  burst(pos, colorHex, count = 10, speed = 4, gravity = 9, life = 0.45) {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      this._v.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize()
        .multiplyScalar(speed * rand(0.4, 1.1));
      this.spawnParticle(pos, this._v, col, life * rand(0.6, 1.2), gravity);
    }
  }

  explosion(pos) {
    this.burst(pos, 0xffa040, 22, 7, 6, 0.7);
    this.burst(pos, 0x4de8ff, 14, 5, 3, 0.55);
    this.ring(pos);
  }

  ring(pos) {
    const r = this.rings[this.rCursor];
    this.rCursor = (this.rCursor + 1) % MAX_RINGS;
    r.mesh.position.copy(pos);
    r.mesh.position.y = Math.max(pos.y, 0.15);
    r.life = 0.45;
    r.mesh.visible = true;
  }

  tracer(from, to) {
    const t = this.tracers[this.tCursor];
    this.tCursor = (this.tCursor + 1) % MAX_TRACERS;
    const dir = this._v.subVectors(to, from);
    const len = dir.length();
    if (len < 0.5) return;
    t.mesh.position.copy(from);
    t.mesh.scale.set(1, len, 1);
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    t.mesh.material.opacity = 0.55;
    t.mesh.visible = true;
    t.life = 0.07;
  }

  damageNumber(worldPos, amount, crit) {
    const d = this.dmgPool[this.dCursor];
    this.dCursor = (this.dCursor + 1) % MAX_DMG_NUMBERS;
    d.el.textContent = Math.round(amount);
    d.el.className = crit ? 'dmg-num crit' : 'dmg-num';
    d.el.style.display = 'block';
    d.pos.copy(worldPos);
    d.pos.x += rand(-0.25, 0.25);
    d.pos.y += rand(0, 0.3);
    d.vy = 1.6;
    d.life = 0.8;
  }

  update(dt, camera, viewW, viewH) {
    // Particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -9999; continue; }
      this.pVel[i * 3 + 1] -= this.pGravity[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      // Fade by shrinking color toward black (additive blending).
      const f = Math.min(1, this.pLife[i] / (this.pMaxLife[i] * 0.5));
      if (f < 1) {
        this.pCol[i * 3] *= (1 - dt * 4);
        this.pCol[i * 3 + 1] *= (1 - dt * 4);
        this.pCol[i * 3 + 2] *= (1 - dt * 4);
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // Tracers
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.55;
      if (t.life <= 0) t.mesh.visible = false;
    }

    // Rings
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const p = 1 - r.life / 0.45;
      const s = 0.4 + p * 4.2;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = (1 - p) * 0.8;
    }

    // Damage numbers — project world → screen.
    for (const d of this.dmgPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.el.style.display = 'none'; continue; }
      d.pos.y += d.vy * dt;
      d.vy *= (1 - dt * 2.5);
      this._v.copy(d.pos).project(camera);
      if (this._v.z > 1 || this._v.z < -1) { d.el.style.display = 'none'; d.life = 0; continue; }
      const sx = (this._v.x * 0.5 + 0.5) * viewW;
      const sy = (-this._v.y * 0.5 + 0.5) * viewH;
      const op = Math.min(1, d.life / 0.3);
      d.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      d.el.style.opacity = op;
    }
  }

  clear() {
    this.pLife.fill(0);
    this.pPos.fill(9999);
    for (const t of this.tracers) { t.mesh.visible = false; t.life = 0; }
    for (const r of this.rings) { r.mesh.visible = false; r.life = 0; }
    for (const d of this.dmgPool) { d.el.style.display = 'none'; d.life = 0; }
  }
}
