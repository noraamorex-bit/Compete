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
    this.scoreNum = $('score-num');
    this.waveChip = $('wave-chip');
    this.comboRow = $('combo-row');
    this.comboChip = $('combo-chip');
    this.comboFill = $('combo-fill');
    this.waveBanner = $('wave-banner');
    this.waveBannerTitle = $('wave-banner-title');
    this.waveBannerSub = $('wave-banner-sub');
    this.reloadHint = $('reload-hint');
    this.crosshair = $('crosshair');
    this.hitmarker = $('hitmarker');
    this.dmgVignette = $('damage-vignette');
    this.healVignette = $('heal-vignette');

    this._lastHealth = -1;
    this._lastScore = -1;
    this._dmgTimer = null;
    this._bannerTimer = null;
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

  setKills(kills) {
    this.killsNum.textContent = kills;
  }

  setScore(score, bump = true) {
    const s = Math.round(score);
    if (s === this._lastScore) return;
    this._lastScore = s;
    this.scoreNum.textContent = s.toLocaleString('en-US');
    if (bump) {
      this.scoreNum.classList.remove('bump');
      void this.scoreNum.offsetWidth; // restart animation
      this.scoreNum.classList.add('bump');
    }
  }

  setWave(n) {
    this.waveChip.textContent = 'WAVE ' + n;
  }

  // multiplier 1 hides the row; frac is the remaining combo window 0..1.
  setCombo(multiplier, frac) {
    if (multiplier <= 1) {
      this.comboRow.classList.add('hidden');
      return;
    }
    this.comboRow.classList.remove('hidden');
    this.comboChip.textContent = '×' + multiplier;
    this.comboFill.style.width = (clamp(frac, 0, 1) * 100) + '%';
  }

  waveBannerShow(title, sub = '') {
    this.waveBannerTitle.textContent = title;
    this.waveBannerSub.textContent = sub;
    this.waveBanner.classList.remove('hidden', 'show');
    void this.waveBanner.offsetWidth;
    this.waveBanner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.waveBanner.classList.add('hidden'), 2300);
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

  setADS(blend) {
    this.crosshair.classList.toggle('ads', blend > 0.6);
  }

  setCrosshairSpread(spreadRad, moving) {
    // Convert weapon spread to a pixel gap, roughly.
    const px = clamp(6 + spreadRad * 900 + (moving ? 4 : 0), 6, 30);
    this.crosshair.style.setProperty('--gap', px.toFixed(1) + 'px');
  }

  reset() {
    this._lastHealth = -1;
    this._lastScore = -1;
    this.setHealth(CONFIG.player.maxHealth);
    this.setKills(0);
    this.setScore(0, false);
    this.setWave(1);
    this.setCombo(1, 0);
    this.waveBanner.classList.add('hidden');
    this.dmgVignette.style.opacity = '0';
  }
}
