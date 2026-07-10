// The rival: remote player avatar with snapshot interpolation, hit spheres,
// and local presentation of their shots.

import * as THREE from 'three';

function buildAvatar(isAlly) {
  const g = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({
    color: isAlly ? 0x3f5f82 : 0x8a4550, roughness: 0.5, metalness: 0.3,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: isAlly ? 0x222c3a : 0x2b2230, roughness: 0.6, metalness: 0.3,
  });
  const visor = new THREE.MeshBasicMaterial({ color: isAlly ? 0x4de8ff : 0xff3040 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const part = (mat, x, y, z, sx, sy, sz, parent = g) => {
    const m = new THREE.Mesh(box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // y=0 is the avatar's AABB center (matches player.position).
  part(armor, 0, 0.1, 0, 0.52, 0.62, 0.32);            // torso
  part(dark, 0, -0.45, 0, 0.44, 0.5, 0.28);            // hips/legs block
  part(dark, -0.13, -0.78, 0, 0.16, 0.24, 0.22);       // foot L
  part(dark, 0.13, -0.78, 0, 0.16, 0.24, 0.22);        // foot R

  // Head group pitches with aim.
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0);
  part(armor, 0, 0, 0, 0.3, 0.28, 0.3, head);
  part(visor, 0, 0.02, -0.14, 0.2, 0.07, 0.04, head);
  g.add(head);

  // Gun arm group pitches with aim.
  const gun = new THREE.Group();
  gun.position.set(0.3, 0.28, 0);
  part(dark, 0, 0, -0.3, 0.09, 0.11, 0.62, gun);
  part(armor, 0, -0.1, 0.05, 0.12, 0.22, 0.14, gun);   // arm
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.64);
  gun.add(muzzle);
  g.add(gun);

  // Allies get a floating marker so you never mistake them for hostiles.
  let marker = null;
  if (isAlly) {
    marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.16, 4),
      new THREE.MeshBasicMaterial({ color: 0x4de8ff })
    );
    marker.rotation.x = Math.PI; // point down
    marker.position.y = 1.1;
    g.add(marker);
  }

  return { group: g, head, gun, muzzle, marker };
}

export class RemotePlayer {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.isAlly = false;
    this._buildMesh(false);

    this.position = new THREE.Vector3();   // interpolated AABB center
    this.alive = false;
    this.yaw = 0;
    this.pitch = 0;

    // Snapshot interpolation: render ~120ms behind the newest packet.
    this._snaps = [];
    this._walkPhase = 0;
    this._v = new THREE.Vector3();
  }

  _buildMesh(isAlly) {
    const wasVisible = this.mesh?.visible ?? false;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    const { group, head, gun, muzzle, marker } = buildAvatar(isAlly);
    this.mesh = group;
    this.head = head;
    this.gun = gun;
    this.muzzle = muzzle;
    this.marker = marker;
    this.mesh.visible = wasVisible;
    if (this.position) this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
    this.isAlly = isAlly;
  }

  setTeamLook(isAlly) {
    if (isAlly !== this.isAlly) this._buildMesh(isAlly);
  }

  show(spawnPos) {
    this.alive = true;
    this.mesh.visible = true;
    this._snaps.length = 0;
    if (spawnPos) this.position.copy(spawnPos);
    this.mesh.position.copy(this.position);
  }

  hide() {
    this.alive = false;
    this.mesh.visible = false;
  }

  die() {
    this.alive = false;
    this.effects.explosion(this.position.clone());
  }

  // Incoming state packet: { p:[x,y,z], yw, pt }
  pushSnapshot(s) {
    this._snaps.push({ t: performance.now(), p: s.p, yw: s.yw, pt: s.pt });
    if (this._snaps.length > 10) this._snaps.shift();
  }

  // Their client told us they fired; show tracer + flash from their muzzle.
  showShot(toArr) {
    const from = this.muzzle.getWorldPosition(this._v).clone();
    const to = new THREE.Vector3(toArr[0], toArr[1], toArr[2]);
    this.effects.tracer(from, to);
    this.effects.burst(from, 0xffd9a0, 3, 2, 3, 0.15);
  }

  update(dt) {
    if (!this.alive || this._snaps.length === 0) return;
    const renderT = performance.now() - 120;
    const s = this._snaps;

    // Find the pair straddling renderT.
    let a = s[0], b = s[s.length - 1];
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].t <= renderT && s[i + 1].t >= renderT) { a = s[i]; b = s[i + 1]; break; }
    }
    const span = Math.max(1, b.t - a.t);
    const k = Math.min(1.25, Math.max(0, (renderT - a.t) / span)); // slight extrapolation
    const prevX = this.position.x, prevZ = this.position.z;
    this.position.set(
      a.p[0] + (b.p[0] - a.p[0]) * k,
      a.p[1] + (b.p[1] - a.p[1]) * k,
      a.p[2] + (b.p[2] - a.p[2]) * k
    );

    // Shortest-arc yaw interpolation.
    let dy = b.yw - a.yw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = a.yw + dy * k;
    this.pitch = a.pt + (b.pt - a.pt) * k;

    // Present: body yaw+π because the avatar faces its local +z? No —
    // player forward is (-sin yaw, -cos yaw); avatar was modeled facing -z,
    // so mesh yaw = player yaw directly.
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    this.head.rotation.x = -this.pitch * 0.7;
    this.gun.rotation.x = -this.pitch;

    if (this.marker) {
      this.marker.position.y = 1.1 + Math.sin(performance.now() * 0.004) * 0.06;
      this.marker.rotation.y += dt * 2;
    }

    // Walk bob from actual horizontal motion.
    const speed = Math.hypot(this.position.x - prevX, this.position.z - prevZ) / Math.max(dt, 1e-4);
    if (speed > 0.5) {
      this._walkPhase += dt * (4 + speed);
      this.mesh.position.y += Math.abs(Math.sin(this._walkPhase)) * 0.04;
      this.mesh.rotation.z = Math.sin(this._walkPhase) * 0.03;
    } else {
      this.mesh.rotation.z = 0;
    }
  }

  // Hit spheres for the local player's hitscan: head = crit.
  raySpheres() {
    return [
      { x: this.position.x, y: this.position.y + 0.62, z: this.position.z, r: 0.3, crit: true },
      { x: this.position.x, y: this.position.y + 0.05, z: this.position.z, r: 0.55, crit: false },
    ];
  }
}
