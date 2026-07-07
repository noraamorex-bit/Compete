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
    this.bossWrap = $('boss-bar-wrap');
    this.bossFill = $('boss-bar-fill');
    this.boostChip = $('boost-chip');
    this.boostSecs = $('boost-secs');

    // Directional damage indicator pool.
    this.indicators = [];
    const indWrap = $('hit-indicators');
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'hit-ind';
      el.style.opacity = '0';
      indWrap.appendChild(el);
      this.indicators.push({ el, angle: 0, life: 0 });
    }
    this._indCursor = 0;

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

  healFlash() {
    this.healVignette.style.opacity = '1';
    setTimeout(() => { this.healVignette.style.opacity = '0'; }, 220);
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

  // frac 0..1 (1 = ready)
  setNade(frac) {
    if (this._nadeFrac === frac) return;
    this._nadeFrac = frac;
    const fill = document.getElementById('nade-fill');
    fill.style.width = (frac * 100) + '%';
    fill.classList.toggle('ready', frac >= 1);
    document.getElementById('mc-nade')?.classList.toggle('cooling', frac < 1);
  }

  // frac null hides the bar.
  setBossBar(frac) {
    this.bossWrap.classList.toggle('hidden', frac == null);
    if (frac != null) this.bossFill.style.width = (clamp(frac, 0, 1) * 100) + '%';
  }

  // seconds <= 0 hides the chip.
  setBoost(seconds) {
    this.boostChip.classList.toggle('hidden', seconds <= 0);
    if (seconds > 0) this.boostSecs.textContent = Math.ceil(seconds) + 's';
  }

  // faceAngle: the player yaw that would face the source,
  // i.e. atan2(playerX - sourceX, playerZ - sourceZ).
  showDamageFrom(faceAngle) {
    const ind = this.indicators[this._indCursor];
    this._indCursor = (this._indCursor + 1) % this.indicators.length;
    ind.angle = faceAngle;
    ind.life = 1.1;
  }

  // Called each frame so indicators stay world-anchored as the player turns.
  updateIndicators(dt, playerYaw) {
    for (const ind of this.indicators) {
      if (ind.life <= 0) continue;
      ind.life -= dt;
      if (ind.life <= 0) { ind.el.style.opacity = '0'; continue; }
      const rot = playerYaw - ind.angle; // 0 = source dead ahead (arc on top)
      ind.el.style.transform = `rotate(${rot.toFixed(3)}rad)`;
      ind.el.style.opacity = Math.min(1, ind.life / 0.4).toFixed(2);
    }
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
    this.setBossBar(null);
    this.setBoost(0);
    this.waveBanner.classList.add('hidden');
    this.dmgVignette.style.opacity = '0';
    this.healVignette.style.opacity = '0';
    for (const ind of this.indicators) { ind.life = 0; ind.el.style.opacity = '0'; }
  }
}
