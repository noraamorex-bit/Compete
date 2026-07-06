// VOLTAGE — game bootstrap, state machine, and main loop.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { EnemyManager } from './enemy.js';
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

// ---------- World & actors ----------
const world = buildWorld(scene, { shadows: true });
const effects = new Effects(scene);
const player = new Player(camera, world.colliders);
const weapon = new Weapon(camera, effects, world.colliders);
const enemies = new EnemyManager(scene, effects, world.colliders, world.enemySpawns);
const hud = new HUD();

// ---------- Game state ----------
const State = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' };
let state = State.MENU;
let kills = 0;
let streak = 0;
let streakT = 0;
let runTime = 0;
let best = Number(localStorage.getItem('voltage.best') || 0);

const LOOK_SENS = 0.0023;

// ---------- Menus / UI wiring ----------
const menuStart = $('menu-start');
const menuPause = $('menu-pause');
const menuDeath = $('menu-death');
const mobileControls = $('mobile-controls');
const btnSound = $('btn-sound');

$('hint-desktop').classList.toggle('hidden', isTouchDevice);
$('hint-mobile').classList.toggle('hidden', !isTouchDevice);
if (best > 0) {
  $('best-line').classList.remove('hidden');
  $('best-num').textContent = best;
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

function startRun() {
  kills = 0;
  streak = 0;
  runTime = 0;
  player.respawn(world.playerSpawn);
  weapon.reset();
  enemies.reset(player.position);
  effects.clear();
  hud.reset();
  hud.setAmmo(weapon.ammo, false);
  setState(State.PLAYING);
  if (!isTouchDevice) input.requestLock(document.body);
}

function resume() {
  setState(State.PLAYING);
  audio.resume();
  if (!isTouchDevice) input.requestLock(document.body);
}

function pause() {
  if (state !== State.PLAYING || !player.alive) return;
  setState(State.PAUSED);
  input.releaseLock();
}

function die() {
  input.releaseLock();
  if (kills > best) {
    best = kills;
    localStorage.setItem('voltage.best', String(best));
  }
  $('death-kills').textContent = kills;
  $('death-best').textContent = best;
  const m = Math.floor(runTime / 60);
  const s = Math.floor(runTime % 60).toString().padStart(2, '0');
  $('death-time').textContent = `${m}:${s}`;
  // Short delay so the death moment reads before the menu appears.
  setTimeout(() => { if (state === State.PLAYING) setState(State.DEAD); }, 900);
}

// Buttons
const clickAnd = (fn) => () => { audio.init(); audio.ui(); fn(); };
$('btn-play').addEventListener('click', clickAnd(startRun));
$('btn-resume').addEventListener('click', clickAnd(resume));
$('btn-restart').addEventListener('click', clickAnd(startRun));
$('btn-respawn').addEventListener('click', clickAnd(startRun));
$('btn-pause-hud').addEventListener('click', clickAnd(pause));
btnSound.addEventListener('click', () => {
  audio.init();
  audio.setEnabled(!audio.enabled);
  btnSound.textContent = `SOUND: ${audio.enabled ? 'ON' : 'OFF'}`;
  audio.ui();
});

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

enemies.onKill = () => {
  kills++;
  streak++;
  streakT = 4;
  hud.setKills(kills);
  hud.showStreak(streak);
  player.addTrauma(0.12);
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

    // Look
    const look = input.consumeLook();
    player.look(look.x, look.y, LOOK_SENS * (isTouchDevice ? 0.55 : 1));

    player.update(dt, input);
    weapon.update(dt, input, player, enemies, look.x, look.y);
    enemies.update(dt, player);

    // Streak window decay
    if (streakT > 0) {
      streakT -= dt;
      if (streakT <= 0) streak = 0;
    }

    // HUD
    hud.setHealth(player.health);
    hud.setLowHealthGlow(player.health);
    hud.setAmmo(weapon.ammo, weapon.reloading);
    hud.setCrosshairSpread(weapon.currentSpread, player.speed2D > 1);
  } else if (state === State.MENU || state === State.DEAD) {
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
window.__game = { player, enemies, weapon, input, get state() { return state; } };

// Menu backdrop: a few idle drones wandering the arena.
player.respawn(world.playerSpawn);
player.alive = false; // drones ignore a dead player in menu state
enemies.reset(new THREE.Vector3(0, 0, 0));
setState(State.MENU);
requestAnimationFrame(frame);
