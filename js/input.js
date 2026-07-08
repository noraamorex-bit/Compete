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
    this.aiming = false;
    this.jumpQueued = false;
    this.sprint = false;
    this.reloadQueued = false;
    this.nadeQueued = false;

    this.onPause = null;   // callbacks set by main
    this.onAnyGesture = null;

    this._keys = new Set();
    this._locked = false;
    this._joyTouch = null;   // { id, ox, oy }
    this._lookTouch = null;  // { id, x, y }
    this._fireTouch = null;  // { id, x, y } — fire button doubles as look surface
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
      if (e.code === 'KeyG') this.nadeQueued = true;
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
      if (!this._locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this._locked;
      this._locked = document.pointerLockElement != null;
      if (was && !this._locked) {
        this.firing = false;
        this.aiming = false;
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

    const applyLook = (touchState, t) => {
      this.lookDX += (t.clientX - touchState.x) * 2.4;
      this.lookDY += (t.clientY - touchState.y) * 2.4;
      touchState.x = t.clientX;
      touchState.y = t.clientY;
    };

    const onMove = (e) => {
      // Only claim the gesture when it belongs to us (keeps menu sliders usable).
      if (!this._joyTouch && !this._lookTouch && !this._fireTouch) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this._joyTouch && t.identifier === this._joyTouch.id) {
          setJoy(t.clientX - this._joyTouch.ox, t.clientY - this._joyTouch.oy);
        } else if (this._lookTouch && t.identifier === this._lookTouch.id) {
          applyLook(this._lookTouch, t);
        } else if (this._fireTouch && t.identifier === this._fireTouch.id) {
          // Slide-to-aim while holding fire (CoD-mobile style).
          applyLook(this._fireTouch, t);
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
        } else if (this._fireTouch && t.identifier === this._fireTouch.id) {
          this._fireTouch = null;
          this.firing = false;
          document.getElementById('mc-fire').classList.remove('pressed');
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

    // Fire button: press to shoot, drag the same thumb to aim while firing.
    const fireBtn = document.getElementById('mc-fire');
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      fireBtn.classList.add('pressed');
      this.onAnyGesture?.();
      if (!this._fireTouch) {
        const t = e.changedTouches[0];
        this._fireTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
      this.firing = true;
    }, { passive: false });

    hold('mc-jump', () => { this.jumpQueued = true; });
    hold('mc-reload', () => { this.reloadQueued = true; });
    hold('mc-nade', () => { this.nadeQueued = true; });

    const sprintBtn = document.getElementById('mc-sprint');
    sprintBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._sprintToggle = !this._sprintToggle;
      this.sprint = this._sprintToggle;
      sprintBtn.classList.toggle('toggled', this._sprintToggle);
      this.onAnyGesture?.();
    }, { passive: false });

    this._aimBtn = document.getElementById('mc-aim');
    this._aimBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.aiming = !this.aiming;
      this._aimBtn.classList.toggle('toggled', this.aiming);
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
  consumeNade() { const n = this.nadeQueued; this.nadeQueued = false; return n; }

  reset() {
    this.firing = false;
    this.aiming = false;
    this.jumpQueued = false;
    this.reloadQueued = false;
    this.nadeQueued = false;
    this.lookDX = 0;
    this.lookDY = 0;
    this._aimBtn?.classList.remove('toggled');
  }
}

export const input = new Input();
