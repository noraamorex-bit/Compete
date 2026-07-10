// World manager: loads/swaps maps at runtime while keeping the collider and
// spawn arrays STABLE — every system (player, enemies, grenades, hazard)
// holds references to these arrays, so we mutate them in place.

import * as THREE from 'three';
import { buildMap } from './maps.js';

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.opts = opts;
    this.colliders = [];
    this.enemySpawns = [];
    this.teamSpawns = [[], []];
    this.playerSpawn = new THREE.Vector3(0, 0.91, -22);
    this.sun = null;
    this.hazardEnabled = false;
    this.mapId = null;
    this._built = null;
  }

  load(id) {
    if (id === this.mapId) return;
    if (this._built) this._built.dispose();
    const b = buildMap(this.scene, id, this.opts);
    this._built = b;
    this.mapId = id;

    this.colliders.length = 0;
    this.colliders.push(...b.colliders);
    this.enemySpawns.length = 0;
    this.enemySpawns.push(...b.enemySpawns);
    for (const t of [0, 1]) {
      this.teamSpawns[t].length = 0;
      this.teamSpawns[t].push(...b.teamSpawns[t]);
    }
    this.playerSpawn.copy(b.playerSpawn);
    this.sun = b.sun;
    this.hazardEnabled = b.hazardEnabled;
  }

  update(dt, focus) {
    this._built?.update(dt, focus);
  }
}
