// PvP match manager: 1v1 / 2v2 / 4v4 team deathmatch over a host-relayed
// star network. Slots: host = 0, joiners 1..N-1. Teams are assigned by
// join order at match start (alternating), so they stay balanced even if
// someone left the lobby. Authority: each client owns its own position and
// health; the shooter judges hits and sends damage events.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Net } from './net.js';
import { RemotePlayer } from './remote.js';
import { audio } from './audio.js';

export const MODES = {
  '1v1': { players: 2, target: 10 },
  '2v2': { players: 4, target: 15 },
  '4v4': { players: 8, target: 25 },
};

const RESPAWN_DELAY = 2.5;
const SEND_INTERVAL = 0.05; // 20 Hz
const PEER_TIMEOUT_MS = 8000;
const G = CONFIG.grenade;

export class Duel {
  constructor({ scene, effects, player, weapon, grenades, hud, world }) {
    this.scene = scene;
    this.effects = effects;
    this.player = player;
    this.weapon = weapon;
    this.grenades = grenades;
    this.hud = hud;
    this.world = world;

    this.net = new Net();

    this.mode = '1v1';
    this.mapId = 'arena';
    this.mySlot = 0;
    this.roster = new Map();     // slot → team (during a match)
    this.players = new Map();    // slot → RemotePlayer (everyone but me)

    this.active = false;
    this.countdown = 0;
    this.scores = [0, 0];
    this.respawnT = 0;
    this._sendT = 0;
    this._lastBanner = -1;
    this._lastAttacker = -1;
    this._lastHostRecv = 0;
    this._peerRecv = new Map();  // host: slot → last packet time

    // Set by main:
    this.onStatus = null;
    this.onDiag = null;
    this.onLobby = null;         // cb(count, max, isHost) — lobby roster changed
    this.onMatchStart = null;    // cb(mapId, mode) — load world BEFORE spawns are read
    this.onMatchEnd = null;      // cb(won, reason)
    this.onScore = null;         // cb(myTeamKills, enemyTeamKills)
    this.onLeft = null;

    this._wireNet();

    // Weapon target adapter — replaces the AI manager in PvP.
    const self = this;
    this.targets = {
      raycast(origin, dir, maxDist) {
        let best = null;
        for (const [slot, rp] of self.players) {
          if (!rp.alive || self.teamOf(slot) === self.myTeam) continue;
          for (const s of rp.raySpheres()) {
            const d = raySphere(origin, dir, s);
            if (d < maxDist && (!best || d < best.dist)) best = { enemy: slot, dist: d, crit: s.crit };
          }
        }
        return best;
      },
      applyDamage(slot, dmg, _point, crit) {
        self._send({ t: 'hit', target: slot, d: Math.round(dmg), c: !!crit });
        return 'damaged';
      },
    };
  }

  get myTeam() { return this.roster.get(this.mySlot) ?? 0; }
  teamOf(slot) { return this.roster.get(slot) ?? 0; }
  get killTarget() { return MODES[this.mode].target; }
  get killsMe() { return this.scores[this.myTeam]; }
  get killsThem() { return this.scores[1 - this.myTeam]; }

  _wireNet() {
    const n = this.net;
    n.onDiag = (line) => this.onDiag?.(line);
    n.onError = (msg) => {
      if (this.active) this._matchBroken(msg);
      else this.onStatus?.(msg);
    };

    // ---- Host events ----
    n.onOpen = () => {
      if (!n.isHost) return;
      this.onStatus?.(`CODE: ${n.code} — WAITING FOR PLAYERS…`);
      this.onLobby?.(n.playerCount, MODES[this.mode].players, true);
    };
    n.onPeerJoined = (slot) => {
      n.sendToSlot(slot, { t: 'welcome', slot, mode: this.mode, map: this.mapId, count: n.playerCount });
      n.broadcast({ t: 'lobby', count: n.playerCount });
      this.onStatus?.(`CODE: ${n.code} — ${n.playerCount}/${MODES[this.mode].players} PLAYERS`);
      this.onLobby?.(n.playerCount, MODES[this.mode].players, true);
      if (!this.active && n.playerCount === MODES[this.mode].players) this.startMatch();
    };
    n.onPeerLeft = (slot) => {
      this._peerRecv.delete(slot);
      if (this.active) {
        const m = { t: 'left', slot };
        n.broadcast(m);
        this._process(m);
      } else {
        n.broadcast({ t: 'lobby', count: n.playerCount });
        this.onStatus?.(`CODE: ${n.code} — ${n.playerCount}/${MODES[this.mode].players} PLAYERS`);
        this.onLobby?.(n.playerCount, MODES[this.mode].players, true);
      }
    };
    n.onPeerMessage = (slot, m) => {
      this._peerRecv.set(slot, performance.now());
      if (m.t === 'bye') { n.dropSlot(slot); n.onPeerLeft?.(slot); return; }
      m.from = slot;
      n.broadcast(m, slot); // relay to everyone else
      this._process(m);
    };

    // ---- Client events ----
    n.onConnectedToHost = () => {
      this._lastHostRecv = performance.now();
      this.onStatus?.('CONNECTED — WAITING FOR HOST TO START');
    };
    n.onHostMessage = (m) => {
      this._lastHostRecv = performance.now();
      this._process(m);
    };
    n.onHostLost = () => this._matchBroken('HOST DISCONNECTED');
  }

  // ---- Lobby ----

  hostMatch(mode, mapId) {
    this.mode = mode;
    this.mapId = mapId;
    this.onStatus?.('CONTACTING MATCH SERVER…');
    return this.net.host(MODES[mode].players);
  }

  joinMatch(code) {
    if (!code || code.trim().length < 4) { this.onStatus?.('ENTER A 4-LETTER CODE'); return; }
    this.onStatus?.('CONNECTING…');
    this.net.join(code);
  }

  cancelLobby() { this.net.destroy(); }

  leave() {
    if (this.net.isHost) this.net.broadcast({ t: 'bye' });
    else this.net.sendToHost({ t: 'bye' });
    this.net.destroy();
    this.active = false;
    this._clearAvatars();
  }

  _clearAvatars() {
    for (const rp of this.players.values()) rp.hide();
  }

  // ---- Match flow ----

  // Host: assign balanced teams by join order and start everyone.
  startMatch() {
    if (!this.net.isHost || this.net.playerCount < 2) return;
    const slots = [0, ...[...this.net.conns.keys()].sort((a, b) => a - b)];
    const roster = slots.map((slot, i) => [slot, i % 2]);
    this.net.broadcast({ t: 'start', roster, map: this.mapId, mode: this.mode });
    this._beginLocal(roster, this.mapId, this.mode);
  }

  requestRematch() {
    if (this.net.isHost) this.startMatch();
  }

  _beginLocal(rosterArr, mapId, mode) {
    this.mode = mode;
    this.mapId = mapId;
    this.roster = new Map(rosterArr);
    this.active = true;
    this.scores = [0, 0];
    this.respawnT = 0;
    this.countdown = 3;
    this._lastBanner = -1;
    this._lastAttacker = -1;
    this._lastHostRecv = performance.now();
    this._peerRecv.clear();
    for (const [slot] of this.roster) {
      if (slot !== this.mySlot) this._peerRecv.set(slot, performance.now());
    }

    // Main loads the world for mapId here (spawns must be fresh below).
    this.onMatchStart?.(mapId, mode);

    // Avatars for everyone else, tinted by team, at their team spawn.
    const teamIdx = [0, 0];
    const spawnOf = (team) => {
      const list = this.world.teamSpawns[team];
      return list[(teamIdx[team]++) % list.length];
    };
    this._clearAvatars();
    let mySpawn = null;
    for (const [slot, team] of this.roster) {
      if (slot === this.mySlot) { mySpawn = spawnOf(team); continue; }
      let rp = this.players.get(slot);
      if (!rp) { rp = new RemotePlayer(this.scene, this.effects); this.players.set(slot, rp); }
      rp.setTeamLook(team === this.myTeam);
      rp.show(spawnOf(team));
    }
    // Drop avatars for slots not in this roster.
    for (const [slot, rp] of this.players) {
      if (!this.roster.has(slot)) rp.hide();
    }

    this.player.respawn(mySpawn || this.world.teamSpawns[this.myTeam][0]);
    this.weapon.reset();
    this.weapon.damageMult = 1;
    this.grenades.reset();
    this.onScore?.(0, 0);
  }

  _endMatch(won, reason) {
    this.active = false;
    this._clearAvatars();
    this.onMatchEnd?.(won, reason || null);
  }

  _matchBroken(reason) {
    const wasActive = this.active;
    this.active = false;
    this._clearAvatars();
    this.net.destroy();
    if (wasActive) this.onMatchEnd?.(true, reason);
    else this.onLeft?.(reason);
  }

  onLocalDeath() {
    const by = this._lastAttacker >= 0 ? this._lastAttacker : this._anyEnemySlot();
    this.scores[this.teamOf(by)]++;
    this.onScore?.(this.killsMe, this.killsThem);
    this._send({ t: 'died', by });
    if (this.scores[this.teamOf(by)] >= this.killTarget) {
      this._endMatch(this.teamOf(by) === this.myTeam, null);
      return;
    }
    this.respawnT = RESPAWN_DELAY;
    this.hud.waveBannerShow('ELIMINATED', 'RESPAWNING…');
  }

  _anyEnemySlot() {
    for (const [slot, team] of this.roster) if (team !== this.myTeam) return slot;
    return 0;
  }

  explodeAt(pos) {
    if (!this.active) return;
    for (const [slot, rp] of this.players) {
      if (!rp.alive || this.teamOf(slot) === this.myTeam) continue;
      const d = rp.position.distanceTo(pos);
      if (d > G.radius) continue;
      const dmg = Math.round(G.damageCenter + (G.damageEdge - G.damageCenter) * (d / G.radius));
      this._send({ t: 'hit', target: slot, d: dmg, c: false });
      this.effects.damageNumber(rp.position.clone(), dmg, false);
    }
  }

  notifyFired(hitPoint) {
    this._send({ t: 'fire', to: [r2(hitPoint.x), r2(hitPoint.y), r2(hitPoint.z)] });
  }

  notifyNade(origin, dir) {
    this._send({
      t: 'nade',
      p: [r2(origin.x), r2(origin.y), r2(origin.z)],
      d: [r2(dir.x), r2(dir.y), r2(dir.z)],
    });
  }

  // Send a message to the whole match (host stamps + broadcasts; client → host relays).
  _send(m) {
    if (this.net.isHost) {
      m.from = this.mySlot;
      this.net.broadcast(m);
    } else {
      this.net.sendToHost(m);
    }
  }

  _process(m) {
    switch (m.t) {
      case 'welcome':
        this.mySlot = m.slot;
        this.mode = m.mode;
        this.mapId = m.map;
        this.onStatus?.(`JOINED ${this.net.code} — ${m.count}/${MODES[m.mode].players} PLAYERS`);
        this.onLobby?.(m.count, MODES[m.mode].players, false);
        break;
      case 'lobby':
        if (!this.active) {
          this.onStatus?.(`IN LOBBY — ${m.count}/${MODES[this.mode].players} PLAYERS`);
          this.onLobby?.(m.count, MODES[this.mode].players, this.net.isHost);
        }
        break;
      case 'full':
        this.onStatus?.('MATCH IS FULL');
        break;
      case 'start':
        if (!this.net.isHost) this._beginLocal(m.roster, m.map, m.mode);
        break;
      case 's':
        this.players.get(m.from)?.pushSnapshot(m);
        break;
      case 'fire': {
        const rp = this.players.get(m.from);
        if (rp?.alive) { rp.showShot(m.to); audio.enemyShoot(); }
        break;
      }
      case 'nade':
        this.grenades.throwVisual(
          new THREE.Vector3(m.p[0], m.p[1], m.p[2]),
          new THREE.Vector3(m.d[0], m.d[1], m.d[2])
        );
        break;
      case 'hit': {
        if (!this.active || m.target !== this.mySlot || !this.player.alive) break;
        this._lastAttacker = m.from;
        this.player.takeDamage(m.d);
        const src = this.players.get(m.from);
        if (src) {
          this.hud.showDamageFrom(Math.atan2(
            this.player.position.x - src.position.x,
            this.player.position.z - src.position.z
          ));
        }
        break;
      }
      case 'died': {
        const killerTeam = this.teamOf(m.by);
        this.scores[killerTeam]++;
        this.players.get(m.from)?.die();
        if (m.by === this.mySlot) this.hud.hitmark('kill');
        audio.kill();
        this.onScore?.(this.killsMe, this.killsThem);
        if (this.scores[killerTeam] >= this.killTarget) {
          this._endMatch(killerTeam === this.myTeam, null);
        }
        break;
      }
      case 'spawn': {
        const rp = this.players.get(m.from);
        if (rp) {
          rp.position.set(m.p[0], m.p[1], m.p[2]);
          rp.show();
        }
        break;
      }
      case 'left': {
        this._peerRecv.delete(m.slot);
        this.players.get(m.slot)?.hide();
        this.roster.delete(m.slot);
        if (this.active && !this._hasEnemies()) this._endMatch(true, 'ALL RIVALS LEFT');
        break;
      }
      case 'bye':
        if (!this.net.isHost) this._matchBroken('HOST LEFT THE MATCH');
        break;
      case 'hb':
        break;
    }
  }

  _hasEnemies() {
    for (const [slot, team] of this.roster) {
      if (slot !== this.mySlot && team !== this.myTeam) return true;
    }
    return false;
  }

  update(dt) {
    if (!this.active) return;
    const now = performance.now();

    // Liveness: clients watch the host; the host watches every peer.
    if (!this.net.isHost) {
      if (now - this._lastHostRecv > PEER_TIMEOUT_MS) { this._matchBroken('HOST DISCONNECTED'); return; }
    } else {
      for (const [slot, t] of this._peerRecv) {
        if (now - t > PEER_TIMEOUT_MS) {
          this.net.dropSlot(slot);
          this._peerRecv.delete(slot);
          const m = { t: 'left', slot };
          this.net.broadcast(m);
          this._process(m);
        }
      }
    }
    if (!this.active) return;

    // Countdown banner: 3-2-1-FIGHT
    if (this.countdown > 0) {
      this.countdown -= dt;
      const n = Math.ceil(Math.max(0, this.countdown));
      if (n !== this._lastBanner) {
        this._lastBanner = n;
        const modeLabel = `${this.mode.toUpperCase()} — FIRST TEAM TO ${this.killTarget}`;
        this.hud.waveBannerShow(n > 0 ? String(n) : 'FIGHT', n > 0 ? modeLabel : '');
        if (n === 0) audio.waveStart(); else audio.ui();
      }
    }

    for (const rp of this.players.values()) rp.update(dt);

    // Local respawn — farthest team spawn from the nearest living enemy.
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        const spawns = this.world.teamSpawns[this.myTeam];
        let best = spawns[0], bd = -1;
        for (const s of spawns) {
          let nearest = Infinity;
          for (const [slot, rp] of this.players) {
            if (this.teamOf(slot) === this.myTeam || !rp.alive) continue;
            nearest = Math.min(nearest, s.distanceToSquared(rp.position));
          }
          if (nearest > bd) { bd = nearest; best = s; }
        }
        this.player.respawn(best);
        this.weapon.reset();
        this._send({ t: 'spawn', p: [best.x, best.y, best.z] });
      }
    }

    // State broadcast @ 20 Hz (heartbeat while dead).
    this._sendT -= dt;
    if (this._sendT <= 0) {
      this._sendT = SEND_INTERVAL;
      if (this.player.alive) {
        const p = this.player.position;
        this._send({
          t: 's',
          p: [r2(p.x), r2(p.y), r2(p.z)],
          yw: r3(this.player.yaw),
          pt: r3(this.player.pitch),
        });
      } else {
        this._send({ t: 'hb' });
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
