// DOM HUD: health, ammo, kills, crosshair spread, hitmarkers, vignettes.

import { CONFIG } from './config.js';
import { clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.healthFill = $('health-fill');
    this.healthNum = $('health-num');
    this.ammoMag = $('ammo-mag');
    this.killsNum = $('kills-num');
    this.streakWrap = $('streak-wrap');
    this.streakNum = $('streak-num');
    this.reloadHint = $('reload-hint');
    this.crosshair = $('crosshair');
    this.hitmarker = $('hitmarker');
    this.dmgVignette = $('damage-vignette');
    this.healVignette = $('heal-vignette');

    this._lastHealth = -1;
    this._hmTimer = null;
    this._dmgTimer = null;
    this._streakTimer = null;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setHealth(hp) {
    const h = Math.max(0, Math.round(hp));
    if (h === this._lastHealth) return;
    this._lastHealth = h;
    const pct = clamp(h / CONFIG.player.maxHealth, 0, 1);
    this.healthFill.style.width = (pct * 100) + '%';
    this.healthFill.classList.toggle('low', pct < 0.35);
    this.healthNum.textContent = h;
  }

  setAmmo(ammo, reloading) {
    this.ammoMag.textContent = reloading ? '--' : ammo;
    this.ammoMag.classList.toggle('empty', !reloading && ammo === 0);
    const showHint = !reloading && ammo > 0 && ammo <= 6;
    this.reloadHint.classList.toggle('hidden', !showHint);
  }

  setKills(kills, bump = true) {
    this.killsNum.textContent = kills;
    if (bump) {
      this.killsNum.classList.remove('bump');
      void this.killsNum.offsetWidth; // restart animation
      this.killsNum.classList.add('bump');
    }
  }

  showStreak(streak) {
    if (streak < 2) return;
    const names = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'RAMPAGE', 5: 'UNSTOPPABLE' };
    this.streakNum.textContent = names[Math.min(streak, 5)] + (streak > 5 ? ` ×${streak}` : '');
    this.streakWrap.classList.remove('hidden');
    clearTimeout(this._streakTimer);
    this._streakTimer = setTimeout(() => this.streakWrap.classList.add('hidden'), 1800);
  }

  // kind: 'hit' | 'crit' | 'kill'
  hitmark(kind) {
    const hm = this.hitmarker;
    hm.classList.remove('show', 'crit', 'kill');
    void hm.offsetWidth;
    if (kind !== 'hit') hm.classList.add(kind);
    hm.classList.add('show');
  }

  damageFlash() {
    this.dmgVignette.style.transition = 'none';
    this.dmgVignette.style.opacity = '1';
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => {
      this.dmgVignette.style.transition = 'opacity .5s ease-out';
      this.dmgVignette.style.opacity = '0';
    }, 60);
  }

  setLowHealthGlow(hp) {
    // Persistent red edge when near death.
    if (hp < 30 && hp > 0) {
      this.dmgVignette.style.opacity = String(0.35 + (30 - hp) / 30 * 0.4);
    }
  }

  setCrosshairSpread(spreadRad, moving) {
    // Convert weapon spread to a pixel gap, roughly.
    const px = clamp(6 + spreadRad * 900 + (moving ? 4 : 0), 6, 30);
    this.crosshair.style.setProperty('--gap', px.toFixed(1) + 'px');
  }

  reset() {
    this._lastHealth = -1;
    this.setHealth(CONFIG.player.maxHealth);
    this.setKills(0, false);
    this.streakWrap.classList.add('hidden');
    this.dmgVignette.style.opacity = '0';
  }
}
