// 1v1 duel: lobby, message protocol, remote presentation, score, respawns.
// Authority: each client owns its position/health; the shooter judges hits.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Net } from './net.js';
import { RemotePlayer } from './remote.js';
import { audio } from './audio.js';

const KILL_TARGET = 10;
const RESPAWN_DELAY = 2.5;
const SEND_INTERVAL = 0.05; // 20 Hz
const PEER_TIMEOUT_MS = 8000; // no packets for this long → rival is gone
const G = CONFIG.grenade;

const DUEL_SPAWNS = [
  new THREE.Vector3(0, 0.91, -24), new THREE.Vector3(0, 0.91, 24),
  new THREE.Vector3(-24, 0.91, 0), new THREE.Vector3(24, 0.91, 0),
  new THREE.Vector3(-22, 0.91, -22), new THREE.Vector3(22, 0.91, 22),
];

export class Duel {
  constructor({ scene, effects, player, weapon, grenades, hud }) {
    this.effects = effects;
    this.player = player;
    this.weapon = weapon;
    this.grenades = grenades;
    this.hud = hud;

    this.net = new Net();
    this.remote = new RemotePlayer(scene, effects);

    this.active = false;        // match running
    this.countdown = 0;
    this.killsMe = 0;
    this.killsThem = 0;
    this.respawnT = 0;          // local respawn countdown, 0 = alive
    this._sendT = 0;
    this._rematchMe = false;
    this._rematchThem = false;
    this._lastBanner = -1;

    // Set by main:
    this.onStatus = null;       // cb(text) — lobby status line
    this.onDiag = null;         // cb(line) — diagnostic log line
    this.onMatchStart = null;
    this.onMatchEnd = null;     // cb(won, reason)
    this.onScore = null;        // cb(me, them)
    this.onLeft = null;         // opponent gone → back to menu

    this.net.onOpen = () => {
      if (this.net.isHost) this.onStatus?.(`CODE: ${this.net.code} — WAITING FOR RIVAL…`);
    };
    this.net.onConnected = () => {
      this.onStatus?.('RIVAL CONNECTED');
      if (this.net.isHost) {
        this.net.send({ t: 'start' });
        this._startMatch();
      }
    };
    this.net.onDiag = (line) => this.onDiag?.(line);
    this.net.onMessage = (m) => this._handle(m);
    this.net.onClosed = () => this._opponentGone('RIVAL DISCONNECTED');
    this.net.onError = (msg) => {
      if (this.active) this._opponentGone(msg);
      else this.onStatus?.(msg);
    };

    // Weapon target adapter — plugs into weapon.update in place of the AI manager.
    const self = this;
    this.targets = {
      raycast(origin, dir, maxDist) {
        if (!self.remote.alive) return null;
        let best = null;
        for (const s of self.remote.raySpheres()) {
          const d = raySphere(origin, dir, s);
          if (d < maxDist && (!best || d < best.dist)) best = { enemy: 'rival', dist: d, crit: s.crit };
        }
        return best;
      },
      applyDamage(_target, dmg, _point, crit) {
        self.net.send({ t: 'hit', d: Math.round(dmg), c: !!crit });
        return 'damaged';
      },
    };
  }

  // ---- Lobby ----

  hostMatch() {
    this.onStatus?.('CONTACTING MATCH SERVER…');
    return this.net.host(); // code shown once the server confirms (onOpen)
  }

  joinMatch(code) {
    if (!code || code.trim().length < 4) { this.onStatus?.('ENTER A 4-LETTER CODE'); return; }
    this.onStatus?.('CONNECTING…');
    this.net.join(code);
  }

  cancelLobby() {
    this.net.destroy();
  }

  leave() {
    this.net.send({ t: 'bye' });
    this.net.destroy();
    this.active = false;
    this.remote.hide();
  }

  // ---- Match flow ----

  _startMatch() {
    this.active = true;
    this.killsMe = 0;
    this.killsThem = 0;
    this.respawnT = 0;
    this.countdown = 3;
    this._rematchMe = false;
    this._rematchThem = false;
    this._lastBanner = -1;
    this._lastRecv = performance.now();

    // Host takes spawn 0, joiner spawn 1 — opposite ends.
    const mySpawn = DUEL_SPAWNS[this.net.isHost ? 0 : 1];
    const theirSpawn = DUEL_SPAWNS[this.net.isHost ? 1 : 0];
    this.player.respawn(mySpawn);
    this.weapon.reset();
    this.weapon.damageMult = 1;
    this.grenades.reset();
    this.remote.show(theirSpawn);
    this.onScore?.(0, 0);
    this.onMatchStart?.();
  }

  requestRematch() {
    this._rematchMe = true;
    this.net.send({ t: 'rematch' });
    this.onStatus?.('WAITING FOR RIVAL…');
    this._maybeRematch();
  }

  _maybeRematch() {
    if (this._rematchMe && this._rematchThem) this._startMatch();
  }

  _endMatch(won) {
    this.active = false;
    this.remote.hide();
    this.onMatchEnd?.(won, won ? 'TARGET REACHED' : null);
  }

  _opponentGone(reason) {
    const wasActive = this.active;
    this.active = false;
    this.remote.hide();
    this.net.destroy();
    if (wasActive) this.onMatchEnd?.(true, reason);
    else this.onLeft?.(reason);
  }

  // Local player died (called from main when health hits 0 in duel mode).
  onLocalDeath() {
    this.killsThem++;
    this.onScore?.(this.killsMe, this.killsThem);
    this.net.send({ t: 'died' });
    if (this.killsThem >= KILL_TARGET) { this._endMatch(false); return; }
    this.respawnT = RESPAWN_DELAY;
    this.hud.waveBannerShow('ELIMINATED', 'RESPAWNING…');
  }

  // My grenade exploded at pos — judge AoE vs the rival.
  explodeAt(pos) {
    if (!this.active || !this.remote.alive) return;
    const d = this.remote.position.distanceTo(pos);
    if (d > G.radius) return;
    const dmg = Math.round(G.damageCenter + (G.damageEdge - G.damageCenter) * (d / G.radius));
    this.net.send({ t: 'hit', d: dmg, c: false });
    this.effects.damageNumber(this.remote.position.clone(), dmg, false);
  }

  notifyFired(hitPoint) {
    this.net.send({ t: 'fire', to: [r2(hitPoint.x), r2(hitPoint.y), r2(hitPoint.z)] });
  }

  notifyNade(origin, dir) {
    this.net.send({
      t: 'nade',
      p: [r2(origin.x), r2(origin.y), r2(origin.z)],
      d: [r2(dir.x), r2(dir.y), r2(dir.z)],
    });
  }

  _handle(m) {
    this._lastRecv = performance.now();
    switch (m.t) {
      case 'start':
        if (!this.net.isHost) this._startMatch();
        break;
      case 's':
        this.remote.pushSnapshot(m);
        break;
      case 'fire':
        this.remote.showShot(m.to);
        audio.enemyShoot();
        break;
      case 'hit': {
        if (!this.active || !this.player.alive) break;
        this.player.takeDamage(m.d);
        this.hud.showDamageFrom(Math.atan2(
          this.player.position.x - this.remote.position.x,
          this.player.position.z - this.remote.position.z
        ));
        break;
      }
      case 'died':
        this.killsMe++;
        this.onScore?.(this.killsMe, this.killsThem);
        this.remote.die();
        this.hud.hitmark('kill');
        audio.kill();
        if (this.killsMe >= KILL_TARGET) this._endMatch(true);
        break;
      case 'spawn':
        this.remote.position.set(m.p[0], m.p[1], m.p[2]);
        this.remote.show();
        break;
      case 'nade':
        this.grenades.throwVisual(
          new THREE.Vector3(m.p[0], m.p[1], m.p[2]),
          new THREE.Vector3(m.d[0], m.d[1], m.d[2])
        );
        break;
      case 'rematch':
        this._rematchThem = true;
        this._maybeRematch();
        break;
      case 'bye':
        this._opponentGone('RIVAL LEFT THE MATCH');
        break;
    }
  }

  update(dt) {
    if (!this.active) return;

    // Rival silent too long (crashed tab, dead link) → forfeit in our favor.
    if (performance.now() - this._lastRecv > PEER_TIMEOUT_MS) {
      this._opponentGone('RIVAL DISCONNECTED');
      return;
    }

    // Countdown banner: 3‑2‑1‑FIGHT
    if (this.countdown > 0) {
      this.countdown -= dt;
      const n = Math.ceil(Math.max(0, this.countdown));
      if (n !== this._lastBanner) {
        this._lastBanner = n;
        this.hud.waveBannerShow(n > 0 ? String(n) : 'FIGHT', n > 0 ? `FIRST TO ${KILL_TARGET}` : '');
        if (n === 0) audio.waveStart(); else audio.ui();
      }
    }

    this.remote.update(dt);

    // Local respawn
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        // Spawn far from the rival.
        let best = DUEL_SPAWNS[0], bd = -1;
        for (const s of DUEL_SPAWNS) {
          const d = s.distanceToSquared(this.remote.position);
          if (d > bd) { bd = d; best = s; }
        }
        this.player.respawn(best);
        this.weapon.reset();
        this.net.send({ t: 'spawn', p: [best.x, best.y, best.z] });
      }
    }

    // State broadcast @ 20 Hz (heartbeat while dead so the link stays proven).
    this._sendT -= dt;
    if (this._sendT <= 0) {
      this._sendT = SEND_INTERVAL;
      if (this.player.alive) {
        const p = this.player.position;
        this.net.send({
          t: 's',
          p: [r2(p.x), r2(p.y), r2(p.z)],
          yw: r3(this.player.yaw),
          pt: r3(this.player.pitch),
        });
      } else {
        this.net.send({ t: 'hb' });
      }
    }
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function raySphere(o, d, s) {
  const lx = s.x - o.x, ly = s.y - o.y, lz = s.z - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > s.r * s.r) return Infinity;
  const t = tca - Math.sqrt(s.r * s.r - d2);
  return t >= 0 ? t : Infinity;
}
