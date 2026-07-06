// Unified input: keyboard/mouse with Pointer Lock on desktop,
// virtual joystick + touch look + buttons on mobile.

import { clamp } from './utils.js';

export const isTouchDevice =
  ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
  matchMedia('(pointer: coarse)').matches;

class Input {
  constructor() {
    // Consumed by player/weapon each frame:
    this.moveX = 0;        // -1..1 strafe
    this.moveZ = 0;        // -1..1 forward
    this.lookDX = 0;       // accumulated look delta (px), consumed per frame
    this.lookDY = 0;
    this.firing = false;
    this.jumpQueued = false;
    this.sprint = false;
    this.reloadQueued = false;

    this.onPause = null;   // callbacks set by main
    this.onAnyGesture = null;

    this._keys = new Set();
    this._locked = false;
    this._joyTouch = null;   // { id, ox, oy }
    this._lookTouch = null;  // { id, x, y }
    this._sprintToggle = false;

    this._bindKeyboard();
    this._bindMouse();
    if (isTouchDevice) this._bindTouch();
  }

  // ---- Desktop ----

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if (e.code === 'KeyR') this.reloadQueued = true;
      this._updateMoveFromKeys();
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      this._updateMoveFromKeys();
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this.firing = false;
      this._updateMoveFromKeys();
    });
  }

  _updateMoveFromKeys() {
    if (isTouchDevice && this._joyTouch) return;
    const k = this._keys;
    this.moveX = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.moveZ = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this._sprintToggle;
  }

  _bindMouse() {
    document.addEventListener('mousemove', (e) => {
      if (!this._locked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (this._locked && e.button === 0) this.firing = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this._locked;
      this._locked = document.pointerLockElement != null;
      if (was && !this._locked) {
        this.firing = false;
        this.onPause?.();     // Esc released the lock → pause
      }
    });
  }

  get pointerLocked() { return this._locked; }

  async requestLock(el) {
    if (isTouchDevice) return;
    try { await el.requestPointerLock(); } catch { /* denied — playing unlocked still works */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- Mobile ----

  _bindTouch() {
    const joyZone = document.getElementById('joystick-zone');
    const lookZone = document.getElementById('look-zone');
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    const JOY_RADIUS = 44;

    const setJoy = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const capped = Math.min(len, JOY_RADIUS);
      if (len > 0.001) { dx = dx / len * capped; dy = dy / len * capped; }
      joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.moveX = clamp(dx / JOY_RADIUS, -1, 1);
      this.moveZ = clamp(-dy / JOY_RADIUS, -1, 1);
      // Push past the rim to auto-sprint.
      this.sprint = this._sprintToggle || len > JOY_RADIUS * 1.35;
    };

    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.onAnyGesture?.();
      if (this._joyTouch) return;
      const t = e.changedTouches[0];
      this._joyTouch = { id: t.identifier, ox: t.clientX, oy: t.clientY };
      joyBase.classList.remove('hidden');
      joyBase.style.left = t.clientX + 'px';
      joyBase.style.top = t.clientY + 'px';
      setJoy(0, 0);
    }, { passive: false });

    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.onAnyGesture?.();
      if (this._lookTouch) return;
      const t = e.changedTouches[0];
      this._lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
    }, { passive: false });

    const onMove = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this._joyTouch && t.identifier === this._joyTouch.id) {
          setJoy(t.clientX - this._joyTouch.ox, t.clientY - this._joyTouch.oy);
        } else if (this._lookTouch && t.identifier === this._lookTouch.id) {
          this.lookDX += (t.clientX - this._lookTouch.x) * 2.4;
          this.lookDY += (t.clientY - this._lookTouch.y) * 2.4;
          this._lookTouch.x = t.clientX;
          this._lookTouch.y = t.clientY;
        }
      }
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this._joyTouch && t.identifier === this._joyTouch.id) {
          this._joyTouch = null;
          this.moveX = 0; this.moveZ = 0;
          this.sprint = this._sprintToggle;
          joyBase.classList.add('hidden');
        } else if (this._lookTouch && t.identifier === this._lookTouch.id) {
          this._lookTouch = null;
        }
      }
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    // Action buttons — bind on touchstart for zero latency.
    const hold = (id, down, up) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('pressed');
        this.onAnyGesture?.();
        down();
      }, { passive: false });
      const release = (e) => { e.preventDefault(); el.classList.remove('pressed'); up?.(); };
      el.addEventListener('touchend', release);
      el.addEventListener('touchcancel', release);
    };

    hold('mc-fire', () => { this.firing = true; }, () => { this.firing = false; });
    hold('mc-jump', () => { this.jumpQueued = true; });
    hold('mc-reload', () => { this.reloadQueued = true; });

    const sprintBtn = document.getElementById('mc-sprint');
    sprintBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._sprintToggle = !this._sprintToggle;
      this.sprint = this._sprintToggle;
      sprintBtn.classList.toggle('toggled', this._sprintToggle);
      this.onAnyGesture?.();
    }, { passive: false });
  }

  // Read-and-clear accumulated look delta.
  consumeLook() {
    const d = { x: this.lookDX, y: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return d;
  }

  consumeJump() { const j = this.jumpQueued; this.jumpQueued = false; return j; }
  consumeReload() { const r = this.reloadQueued; this.reloadQueued = false; return r; }

  reset() {
    this.firing = false;
    this.jumpQueued = false;
    this.reloadQueued = false;
    this.lookDX = 0;
    this.lookDY = 0;
  }
}

export const input = new Input();
