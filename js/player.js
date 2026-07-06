// First-person player: movement with acceleration/friction, AABB collision
// with step-up, jumping, sprint, camera bob, and health.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp } from './utils.js';
import { audio } from './audio.js';

const P = CONFIG.player;
const EPS = 0.001;

export class Player {
  constructor(camera, colliders) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.colliders = colliders;

    this.position = new THREE.Vector3();   // AABB center
    this.velocity = new THREE.Vector3();
    this.half = new THREE.Vector3(P.radius, P.height / 2, P.radius);

    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.health = P.maxHealth;
    this.alive = true;
    this.timeSinceDamage = 999;
    this.sprinting = false;
    this.sprintBlend = 0;     // 0..1, drives the FOV kick

    // Feel
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.trauma = 0;          // camera shake 0..1
    this.recoilPitch = 0;     // recovering recoil offset
    this.landBlend = 0;       // landing dip

    this.onDamaged = null;    // cb(amount)
    this.onDied = null;

    this._wish = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  respawn(spawn) {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.atan2(spawn.x, spawn.z); // face arena center
    this.pitch = 0;
    this.health = P.maxHealth;
    this.alive = true;
    this.timeSinceDamage = 999;
    this.trauma = 0;
    this.recoilPitch = 0;
    this.sprintBlend = 0;
  }

  addTrauma(t) { this.trauma = clamp(this.trauma + t, 0, 1); }
  addRecoil(pitch) { this.recoilPitch += pitch; }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.timeSinceDamage = 0;
    this.addTrauma(0.32);
    audio.playerHurt();
    this.onDamaged?.(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.onDied?.();
    }
  }

  get eyePosition() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y - this.half.y + P.eyeHeight,
      this.position.z
    );
  }

  get speed2D() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  // adsBlend (0..1) slows movement and suppresses sprint while aiming.
  update(dt, input, adsBlend = 0) {
    if (!this.alive) return;
    this.timeSinceDamage += dt;

    // Health regen after a quiet period.
    if (this.timeSinceDamage > P.regenDelay && this.health < P.maxHealth) {
      this.health = Math.min(P.maxHealth, this.health + P.regenRate * dt);
    }

    // --- Horizontal movement ---
    const movingInput = Math.abs(input.moveX) > 0.05 || Math.abs(input.moveZ) > 0.05;
    this.sprinting = input.sprint && input.moveZ > 0.1 && adsBlend < 0.4;
    const targetSpeed = (this.sprinting ? P.sprintSpeed : P.walkSpeed) * (1 - 0.35 * adsBlend);

    // Sprint FOV blend (only counts once actually moving fast).
    const sprintTarget = this.sprinting && this.speed2D > P.walkSpeed * 0.85 ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * damp(7, dt);

    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(-this._fwd.z, 0, this._fwd.x); // fwd × up
    this._wish.set(0, 0, 0)
      .addScaledVector(this._fwd, input.moveZ)
      .addScaledVector(this._right, input.moveX);
    if (this._wish.lengthSq() > 1) this._wish.normalize();

    const accel = this.grounded ? P.accel : P.airAccel;
    this.velocity.x += this._wish.x * accel * dt * targetSpeed / P.walkSpeed;
    this.velocity.z += this._wish.z * accel * dt * targetSpeed / P.walkSpeed;

    // Friction / speed clamp
    if (this.grounded && !movingInput) {
      const f = Math.max(0, 1 - P.friction * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }
    const sp = this.speed2D;
    if (sp > targetSpeed) {
      const f = targetSpeed / sp;
      this.velocity.x *= f;
      this.velocity.z *= f;
    }

    // --- Jump & gravity ---
    if (input.consumeJump() && this.grounded) {
      this.velocity.y = P.jumpVelocity;
      this.grounded = false;
      audio.jump();
    }
    this.velocity.y -= P.gravity * dt;

    // --- Integrate with collision ---
    const wasGrounded = this.grounded;
    const fallSpeed = -this.velocity.y;
    this._moveAxis(0, this.velocity.x * dt);
    this._moveAxis(2, this.velocity.z * dt);
    this._moveY(this.velocity.y * dt);

    if (!wasGrounded && this.grounded) {
      audio.land();
      this.landBlend = clamp(fallSpeed / 14, 0.15, 0.8);
      this.addTrauma(clamp(fallSpeed / 60, 0, 0.15));
    }

    // Arena safety clamp
    const lim = CONFIG.arena.size / 2 - 0.5;
    this.position.x = clamp(this.position.x, -lim, lim);
    this.position.z = clamp(this.position.z, -lim, lim);
    if (this.position.y < -5) this.position.y = 5; // paranoia

    // --- Camera bob & footsteps ---
    const moveSpeed = this.speed2D;
    if (this.grounded && moveSpeed > 0.8) {
      const prev = this.bobPhase;
      this.bobPhase += dt * (6 + moveSpeed * 0.9);
      this.bobAmp += (1 - this.bobAmp) * damp(8, dt);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        audio.footstep();
      }
    } else {
      this.bobAmp *= 1 - damp(6, dt);
    }
    this.landBlend *= 1 - damp(7, dt);

    // --- Recoil recovery & shake decay ---
    this.recoilPitch *= 1 - damp(11, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    this._applyCamera();
  }

  _applyCamera() {
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.022 * this.bobAmp;
    const shake = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    const sx = (Math.sin(t * 91.7) + Math.sin(t * 47.3)) * 0.014 * shake;
    const sy = (Math.sin(t * 83.1) + Math.sin(t * 59.9)) * 0.014 * shake;

    this.camera.position.set(
      this.position.x + bobX,
      this.position.y - this.half.y + P.eyeHeight + bobY - this.landBlend * 0.22,
      this.position.z
    );
    this.camera.rotation.y = this.yaw + sx;
    this.camera.rotation.x = this.pitch + this.recoilPitch + sy;
    this.camera.rotation.z = Math.cos(this.bobPhase) * 0.0035 * this.bobAmp;
  }

  _box() {
    return {
      min: {
        x: this.position.x - this.half.x,
        y: this.position.y - this.half.y,
        z: this.position.z - this.half.z,
      },
      max: {
        x: this.position.x + this.half.x,
        y: this.position.y + this.half.y,
        z: this.position.z + this.half.z,
      },
    };
  }

  _overlaps(box, c) {
    return (
      box.min.x < c.max.x && box.max.x > c.min.x &&
      box.min.y < c.max.y && box.max.y > c.min.y &&
      box.min.z < c.max.z && box.max.z > c.min.z
    );
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return;
    const key = axis === 0 ? 'x' : 'z';
    this.position[key] += delta;
    let box = this._box();
    for (const c of this.colliders) {
      if (!this._overlaps(box, c)) continue;

      // Step-up: low obstacle with free space above.
      const feet = this.position.y - this.half.y;
      const stepUp = c.max.y - feet;
      if (stepUp > 0 && stepUp <= P.stepHeight && this.velocity.y <= 0.1) {
        const oldY = this.position.y;
        this.position.y = c.max.y + this.half.y + EPS;
        const raised = this._box();
        let free = true;
        for (const c2 of this.colliders) {
          if (this._overlaps(raised, c2)) { free = false; break; }
        }
        if (free) { box = raised; continue; }
        this.position.y = oldY;
      }

      // Clamp against the face we ran into.
      if (delta > 0) this.position[key] = c.min[key] - this.half[key] - EPS;
      else this.position[key] = c.max[key] + this.half[key] + EPS;
      this.velocity[key] = 0;
      box = this._box();
    }
  }

  _moveY(delta) {
    this.position.y += delta;
    this.grounded = false;
    const box = this._box();

    for (const c of this.colliders) {
      if (!this._overlaps(box, c)) continue;
      if (delta <= 0) {
        this.position.y = c.max.y + this.half.y + EPS;
        this.velocity.y = 0;
        this.grounded = true;
      } else {
        this.position.y = c.min.y - this.half.y - EPS;
        this.velocity.y = 0;
      }
      return;
    }

    // Floor plane
    if (this.position.y - this.half.y <= 0) {
      this.position.y = this.half.y;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }
  }
}
