// VOLTAGE — game bootstrap, state machine, and main loop.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { EnemyManager } from './enemy.js';
import { Pickups } from './pickups.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { input, isTouchDevice } from './input.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------- Renderer ----------
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isTouchDevice,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouchDevice ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(isTouchDevice ? 70 : 75, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);

// ---------- Weapon progression ----------
let totalKills = Number(localStorage.getItem('voltage.totalKills') || 0);
let selectedWeaponId = localStorage.getItem('voltage.weapon') || 'volt';

const weaponStats = (id) => CONFIG.weapons.find((w) => w.id === id) || CONFIG.weapons[0];
const weaponUnlocked = (w) => totalKills >= w.unlockKills;
if (!weaponUnlocked(weaponStats(selectedWeaponId))) selectedWeaponId = 'volt';

// ---------- World & actors ----------
const world = buildWorld(scene, { shadows: true });
const effects = new Effects(scene);
const player = new Player(camera, world.colliders);
const weapon = new Weapon(camera, effects, world.colliders, weaponStats(selectedWeaponId));
const enemies = new EnemyManager(scene, effects, world.colliders, world.enemySpawns);
const pickups = new Pickups(scene, effects, world.colliders);
const hud = new HUD();

// ---------- Game state ----------
const State = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' };
let state = State.MENU;
let kills = 0;
let score = 0;
let multiplier = 1;
let comboT = 0;
let wave = 1;
let waveState = 'active';        // 'active' | 'intermission'
let intermissionT = 0;
let boostT = 0;                  // double-damage seconds remaining
let runTime = 0;
let bestScore = Number(localStorage.getItem('voltage.bestScore') || 0);
let bestWave = Number(localStorage.getItem('voltage.bestWave') || 0);

const LOOK_SENS = 0.0027;
const BASE_FOV = isTouchDevice ? 70 : 75;

// ---------- Settings ----------
const settings = {
  sens: Number(localStorage.getItem('voltage.sens') || 1),
  gfx: localStorage.getItem('voltage.gfx') || 'high',
};

function applyGraphics() {
  const high = settings.gfx === 'high';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, isTouchDevice ? 1.75 : 2) : 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = high;
  world.sun.castShadow = high;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.needsUpdate = true;
  });
}

function waveConfig(n) {
  const W = CONFIG.waves;
  const base = { healthScale: W.healthScale(n), speedScale: W.speedScale(n) };

  if (n % W.bossEvery === 0) {
    const bossNum = n / W.bossEvery;
    const escorts = Math.min(2 + bossNum, 5);
    const types = ['boss'];
    for (let i = 0; i < escorts; i++) types.push(i % 2 === 0 ? 'drone' : 'rusher');
    return { ...base, types, maxAlive: 5, bossHealthScale: W.bossHealthScale(bossNum), isBoss: true };
  }

  const total = W.count(n);
  const rushers = Math.round(total * W.rusherShare(n));
  const types = [];
  for (let i = 0; i < total; i++) types.push(i < rushers ? 'rusher' : 'drone');
  // Interleave so rushers arrive spread through the wave.
  types.sort(() => Math.random() - 0.5);
  return { ...base, types, maxAlive: W.maxAlive(n), isBoss: false };
}

// ---------- Menus / UI wiring ----------
const menuStart = $('menu-start');
const menuPause = $('menu-pause');
const menuDeath = $('menu-death');
const mobileControls = $('mobile-controls');
const btnSound = $('btn-sound');

$('hint-desktop').classList.toggle('hidden', isTouchDevice);
$('hint-mobile').classList.toggle('hidden', !isTouchDevice);
document.body.classList.toggle('touch', isTouchDevice);

function refreshBestLine() {
  if (bestScore <= 0) return;
  $('best-line').classList.remove('hidden');
  $('best-num').textContent = bestScore.toLocaleString('en-US');
  $('best-wave').textContent = bestWave;
}
refreshBestLine();

// ---------- Weapon select UI ----------
const weaponSelectEl = $('weapon-select');

function refreshWeaponMenu() {
  weaponSelectEl.innerHTML = '';
  for (const w of CONFIG.weapons) {
    const unlocked = weaponUnlocked(w);
    const card = document.createElement('button');
    card.className = 'wpn-card'
      + (w.id === selectedWeaponId ? ' selected' : '')
      + (unlocked ? '' : ' locked');
    card.innerHTML = `
      <div class="wpn-name">${w.name}</div>
      <div class="wpn-desc">${unlocked ? w.desc : `${Math.min(totalKills, w.unlockKills)}/${w.unlockKills} KILLS`}</div>`;
    if (unlocked) {
      card.addEventListener('click', () => {
        audio.init();
        selectedWeaponId = w.id;
        localStorage.setItem('voltage.weapon', selectedWeaponId);
        weapon.setStats(w);
        refreshWeaponMenu();
        audio.ui();
      });
    }
    weaponSelectEl.appendChild(card);
  }
}
refreshWeaponMenu();

function trackKillProgress() {
  totalKills++;
  localStorage.setItem('voltage.totalKills', String(totalKills));
  for (const w of CONFIG.weapons) {
    if (w.unlockKills === totalKills) {
      hud.waveBannerShow(`${w.name} UNLOCKED`, 'EQUIP IT FROM THE MENU');
      audio.waveClear();
      refreshWeaponMenu();
    }
  }
}

function setState(next) {
  state = next;
  menuStart.classList.toggle('hidden', state !== State.MENU);
  menuPause.classList.toggle('hidden', state !== State.PAUSED);
  menuDeath.classList.toggle('hidden', state !== State.DEAD);
  const inGame = state === State.PLAYING;
  hud.root.classList.toggle('hidden', !inGame && state !== State.PAUSED);
  mobileControls.classList.toggle('hidden', !isTouchDevice || !inGame);
  weapon.root.visible = inGame || state === State.PAUSED;
  if (!inGame) input.reset();
}

// Fullscreen makes phone play far better; ignore where unsupported (iOS Safari).
function goFullscreen() {
  if (!isTouchDevice || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
}

function startRun() {
  goFullscreen();
  kills = 0;
  score = 0;
  multiplier = 1;
  comboT = 0;
  boostT = 0;
  wave = 1;
  waveState = 'active';
  runTime = 0;
  player.respawn(world.playerSpawn);
  weapon.reset();
  weapon.damageMult = 1;
  enemies.clearAll();
  enemies.beginWave(waveConfig(1), player.position);
  pickups.clear();
  effects.clear();
  hud.reset();
  hud.setAmmo(weapon.ammo, false);
  setState(State.PLAYING);
  hud.waveBannerShow('WAVE 1', 'ELIMINATE ALL DRONES');
  audio.waveStart();
  if (!isTouchDevice) input.requestLock(document.body);
}

function resume() {
  goFullscreen();
  setState(State.PLAYING);
  audio.resume();
  if (!isTouchDevice) input.requestLock(document.body);
}

function pause() {
  if (state !== State.PLAYING || !player.alive) return;
  setState(State.PAUSED);
  input.releaseLock();
}

// Back to the start screen (weapon select lives there).
function goToMenu() {
  input.releaseLock();
  weapon.reset();
  player.respawn(world.playerSpawn);
  player.alive = false; // menu-backdrop drones ignore a dead player
  enemies.clearAll();
  enemies.beginWave({ types: Array(5).fill('drone'), maxAlive: 5 }, new THREE.Vector3(0, 0, 0));
  pickups.clear();
  effects.clear();
  refreshWeaponMenu();
  refreshBestLine();
  setState(State.MENU);
}

function die() {
  input.releaseLock();
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('voltage.bestScore', String(bestScore));
  }
  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem('voltage.bestWave', String(bestWave));
  }
  refreshBestLine();
  $('death-score').textContent = score.toLocaleString('en-US');
  $('death-wave').textContent = wave;
  $('death-kills').textContent = kills;
  $('death-best').textContent = bestScore.toLocaleString('en-US');
  // Short delay so the death moment reads before the menu appears.
  setTimeout(() => { if (state === State.PLAYING) setState(State.DEAD); }, 900);
}

// Buttons
const clickAnd = (fn) => () => { audio.init(); audio.ui(); fn(); };
$('btn-play').addEventListener('click', clickAnd(startRun));
$('btn-resume').addEventListener('click', clickAnd(resume));
$('btn-restart').addEventListener('click', clickAnd(startRun));
$('btn-respawn').addEventListener('click', clickAnd(startRun));
$('btn-menu').addEventListener('click', clickAnd(goToMenu));
$('btn-death-menu').addEventListener('click', clickAnd(goToMenu));
$('btn-pause-hud').addEventListener('click', clickAnd(pause));
btnSound.addEventListener('click', () => {
  audio.init();
  audio.setEnabled(!audio.enabled);
  btnSound.textContent = `SOUND: ${audio.enabled ? 'ON' : 'OFF'}`;
  audio.ui();
});

// Settings: sensitivity slider + graphics toggle.
const sensSlider = $('sens-slider');
const sensVal = $('sens-val');
const btnGfx = $('btn-gfx');

function refreshSettingsUI() {
  sensSlider.value = String(Math.round(settings.sens * 100));
  sensVal.textContent = settings.sens.toFixed(2).replace(/0$/, '');
  btnGfx.textContent = `GRAPHICS: ${settings.gfx.toUpperCase()}`;
}
sensSlider.addEventListener('input', () => {
  settings.sens = Number(sensSlider.value) / 100;
  localStorage.setItem('voltage.sens', String(settings.sens));
  sensVal.textContent = settings.sens.toFixed(2).replace(/0$/, '');
});
btnGfx.addEventListener('click', () => {
  audio.init();
  settings.gfx = settings.gfx === 'high' ? 'low' : 'high';
  localStorage.setItem('voltage.gfx', settings.gfx);
  applyGraphics();
  refreshSettingsUI();
  audio.ui();
});
refreshSettingsUI();

// Esc → pause comes from pointer-lock release on desktop.
input.onPause = () => { if (state === State.PLAYING && !isTouchDevice) pause(); };
input.onAnyGesture = () => audio.resume();

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === State.PAUSED) resume();
  if (e.code === 'KeyP' && state === State.PLAYING) pause();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// Click canvas to re-lock when playing unlocked (e.g. after alt-tab).
canvas.addEventListener('click', () => {
  if (state === State.PLAYING && !isTouchDevice && !input.pointerLocked) {
    input.requestLock(document.body);
  }
});

// ---------- Event wiring ----------
weapon.onAmmoChanged = (ammo) => hud.setAmmo(ammo, false);
weapon.onHit = (kind) => hud.hitmark(kind);

player.onDamaged = () => hud.damageFlash();
player.onDied = () => die();

enemies.onKill = (pos, crit, type) => {
  kills++;
  const base = CONFIG.enemy.types[type]?.score ?? 100;
  score += (base + (crit ? CONFIG.score.critBonus : 0)) * multiplier;
  multiplier = Math.min(multiplier + 1, CONFIG.score.maxMultiplier);
  comboT = CONFIG.score.comboWindow;
  hud.setKills(kills);
  hud.setScore(score);
  player.addTrauma(type === 'boss' ? 0.3 : 0.12);
  trackKillProgress();

  // Drops: bosses always pay out, others roll the dice.
  if (state === State.PLAYING) {
    if (type === 'boss') {
      pickups.spawn(pos, 'health');
      pickups.spawn(new THREE.Vector3(pos.x + 1.2, pos.y, pos.z + 1.2), 'boost');
    } else {
      const roll = Math.random();
      if (roll < CONFIG.pickups.dropBoost) pickups.spawn(pos, 'boost');
      else if (roll < CONFIG.pickups.dropBoost + CONFIG.pickups.dropHealth) pickups.spawn(pos, 'health');
    }
  }
};

enemies.onPlayerDamaged = (amount, srcPos) => {
  hud.showDamageFrom(Math.atan2(
    player.position.x - srcPos.x,
    player.position.z - srcPos.z
  ));
};

pickups.onPickup = (type) => {
  if (type === 'health') {
    player.health = Math.min(CONFIG.player.maxHealth, player.health + CONFIG.pickups.healthAmount);
    hud.healFlash();
    audio.pickupHealth();
  } else {
    boostT = CONFIG.pickups.boostDuration;
    audio.pickupBoost();
  }
};

enemies.onWaveCleared = () => {
  if (state !== State.PLAYING || !player.alive) return;
  waveState = 'intermission';
  intermissionT = CONFIG.waves.intermission;
  hud.waveBannerShow('WAVE CLEARED', `WAVE ${wave + 1} INCOMING`);
  audio.waveClear();
};

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Main loop ----------
let lastT = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  if (state === State.PLAYING) {
    runTime += dt;

    // Look — slower while aiming for fine control.
    const look = input.consumeLook();
    const adsSens = 1 - 0.35 * weapon.adsBlend;
    player.look(look.x, look.y, LOOK_SENS * settings.sens * adsSens * (isTouchDevice ? 1.2 : 1));

    player.update(dt, input, weapon.adsBlend);
    weapon.update(dt, input, player, enemies, look.x, look.y);
    enemies.update(dt, player);
    pickups.update(dt, player);

    // Damage boost timer
    if (boostT > 0) boostT = Math.max(0, boostT - dt);
    weapon.damageMult = boostT > 0 ? 2 : 1;

    // FOV: sprint widens, ADS narrows toward the weapon's zoom.
    const targetFov = (BASE_FOV + CONFIG.player.sprintFovKick * player.sprintBlend)
      * (1 - weapon.adsBlend) + weapon.stats.adsFov * weapon.adsBlend;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }

    // Combo window decay
    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) multiplier = 1;
    }

    // Wave intermission → next wave
    if (waveState === 'intermission') {
      intermissionT -= dt;
      if (intermissionT <= 0) {
        waveState = 'active';
        wave++;
        hud.setWave(wave);
        const cfg = waveConfig(wave);
        if (cfg.isBoss) {
          hud.waveBannerShow(`WAVE ${wave}`, 'BOSS INBOUND — SENTINEL PRIME');
        } else {
          hud.waveBannerShow(`WAVE ${wave}`, `${cfg.types.length} HOSTILES`);
        }
        audio.waveStart();
        enemies.beginWave(cfg, player.position);
      }
    }

    // HUD
    hud.setHealth(player.health);
    hud.setLowHealthGlow(player.health);
    hud.setAmmo(weapon.ammo, weapon.reloading);
    hud.setCrosshairSpread(weapon.currentSpread, player.speed2D > 1);
    hud.setCombo(multiplier, comboT / CONFIG.score.comboWindow);
    hud.setADS(weapon.adsBlend);
    hud.setBoost(boostT);
    hud.updateIndicators(dt, player.yaw);
    const boss = enemies.activeBoss;
    hud.setBossBar(boss ? boss.health / boss.maxHealth : null);
  } else if (state === State.MENU || state === State.DEAD) {
    if (camera.fov !== BASE_FOV) {
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
    // Slow cinematic orbit behind the menus.
    const t = now * 0.00006;
    camera.position.set(Math.sin(t) * 26, 9, Math.cos(t) * 26);
    camera.lookAt(0, 1.5, 0);
    if (state === State.MENU) enemies.update(dt, player);
  }

  effects.update(dt, camera, innerWidth, innerHeight);
  renderer.render(scene, camera);
}

// Debug/test hook (harmless in production).
window.__game = {
  player, enemies, weapon, input, settings, pickups,
  get state() { return state; },
  get score() { return score; },
  get multiplier() { return multiplier; },
  get wave() { return wave; },
  get waveState() { return waveState; },
  get totalKills() { return totalKills; },
  get boostT() { return boostT; },
  set wave(n) { wave = n; },
};

applyGraphics();

// Menu backdrop: a few idle drones wandering the arena.
player.respawn(world.playerSpawn);
player.alive = false; // drones ignore a dead player in menu state
enemies.beginWave({ types: Array(5).fill('drone'), maxAlive: 5 }, new THREE.Vector3(0, 0, 0));
setState(State.MENU);
requestAnimationFrame(frame);

// PWA: offline cache + install support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
