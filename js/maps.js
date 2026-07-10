// Map definitions. Each map owns its geometry, palette, sky, lighting, fog,
// props, and ambient weather — a distinct place, not a recolor.

import * as THREE from 'three';
import { aabb, rand } from './utils.js';

export const MAP_LIST = [
  { id: 'arena', name: 'VOLT ARENA', desc: 'DUSK · LASER HAZARD', swatch: ['#2c3a55', '#ff8a3d'] },
  { id: 'glacier', name: 'GLACIER', desc: 'ARCTIC STATION · SNOWFALL', swatch: ['#cfe2f2', '#7fd4ef'] },
  { id: 'ember', name: 'EMBERFALL', desc: 'VOLCANIC FOUNDRY · NIGHT', swatch: ['#1a1014', '#ff5a1e'] },
];

// ---------- shared helpers ----------

function canvasTex(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyDome(top, mid, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      mid: { value: new THREE.Color(mid) },
      bottom: { value: new THREE.Color(bottom) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = h > 0.12
          ? mix(mid, top, smoothstep(0.12, 0.75, h))
          : mix(bottom, mid, smoothstep(-0.08, 0.12, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), mat);
  mesh.frustumCulled = false;
  return mesh;
}

// Ambient weather: falling snow or rising embers, recycled around the player.
class ParticleField {
  constructor(group, kind) {
    this.kind = kind;
    const N = 260;
    this.n = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = rand(-28, 28);
      this.pos[i * 3 + 1] = rand(0, 18);
      this.pos[i * 3 + 2] = rand(-28, 28);
      this.vel[i] = kind === 'snow' ? rand(1.2, 2.4) : rand(0.7, 1.6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: kind === 'snow' ? 0xffffff : 0xff7a30,
      size: kind === 'snow' ? 0.09 : 0.07,
      transparent: true,
      opacity: kind === 'snow' ? 0.85 : 0.7,
      depthWrite: false,
      blending: kind === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    group.add(this.points);
    this._t = 0;
  }

  update(dt, focus) {
    this._t += dt;
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      if (this.kind === 'snow') {
        p[i * 3 + 1] -= this.vel[i] * dt;
        p[i * 3] += Math.sin(this._t * 0.8 + i) * dt * 0.4;
        if (p[i * 3 + 1] < 0) {
          p[i * 3 + 1] = 18;
          p[i * 3] = focus.x + rand(-28, 28);
          p[i * 3 + 2] = focus.z + rand(-28, 28);
        }
      } else {
        p[i * 3 + 1] += this.vel[i] * dt;
        p[i * 3] += Math.sin(this._t * 1.3 + i * 2) * dt * 0.3;
        if (p[i * 3 + 1] > 12) {
          p[i * 3 + 1] = rand(0, 0.5);
          p[i * 3] = focus.x + rand(-26, 26);
          p[i * 3 + 2] = focus.z + rand(-26, 26);
        }
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// Small builder that accumulates meshes into a group and matching AABBs.
class B {
  constructor(shadows) {
    this.group = new THREE.Group();
    this.colliders = [];
    this.shadows = shadows;
    this.box = new THREE.BoxGeometry(1, 1, 1);
  }

  add(mesh, shadow = true) {
    mesh.castShadow = shadow && this.shadows;
    mesh.receiveShadow = this.shadows;
    this.group.add(mesh);
    return mesh;
  }

  solid(cx, cy, cz, sx, sy, sz, mat, ry = 0) {
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    this.add(m);
    if (ry !== 0) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      this.colliders.push(aabb(cx, cy, cz, sx * c + sz * s, sy, sx * s + sz * c));
    } else {
      this.colliders.push(aabb(cx, cy, cz, sx, sy, sz));
    }
    return m;
  }

  deco(cx, cy, cz, sx, sy, sz, mat, ry = 0) {
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    this.add(m, false);
    return m;
  }

  // Cylinder/cone prop with a fitted square collider.
  cyl(geo, mat, x, y, z, collideR = 0, collideH = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.add(m);
    if (collideR > 0) {
      this.colliders.push(aabb(x, y, z, collideR * 1.6, collideH, collideR * 1.6));
    }
    return m;
  }

  walls(size, height, thickness, mat) {
    const H = size / 2, T = thickness;
    this.solid(0, height / 2, -H - T / 2, size + T * 2, height, T, mat);
    this.solid(0, height / 2, H + T / 2, size + T * 2, height, T, mat);
    this.solid(-H - T / 2, height / 2, 0, T, height, size, mat);
    this.solid(H + T / 2, height / 2, 0, T, height, size, mat);
  }

  ground(size, mat, apronColor) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = this.shadows;
    this.group.add(g);
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 4, size * 4),
      new THREE.MeshStandardMaterial({ color: apronColor, roughness: 1 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    this.group.add(apron);
  }
}

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh || o.isPoints) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    }
  });
}

// ============================================================
// MAP 1 — VOLT ARENA (dusk industrial; the original)
// ============================================================
function buildArena(scene, b) {
  scene.fog = new THREE.Fog(0x8ba7cf, 70, 260);
  b.group.add(skyDome(0x3563a8, 0x87aede, 0xffb37a));

  b.group.add(new THREE.HemisphereLight(0xbdd5f5, 0x6b5a48, 1.15));
  b.group.add(new THREE.AmbientLight(0x8899bb, 0.75));
  const sun = new THREE.DirectionalLight(0xffe0b3, 2.4);
  sun.position.set(28, 42, 18);
  if (b.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35;
    sc.near = 10; sc.far = 110;
    sun.shadow.bias = -0.0008;
  }
  b.group.add(sun);

  const groundTex = canvasTex((g) => {
    g.fillStyle = '#3d4655'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(20,26,36,.55)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1;
    for (let i = 64; i < 256; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
  });
  groundTex.repeat.set(16, 16);
  b.ground(62, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }), 0x333c4a);

  const matWall = std(0x4a5468, { roughness: 0.9 });
  const matBlock = std(0x717d92);
  const matBlockAlt = std(0x5d6a80);
  const matPlatform = std(0x66738a, { roughness: 0.8 });
  const matAccent = std(0xff8a3d, { roughness: 0.6 });
  const matGlow = new THREE.MeshBasicMaterial({ color: 0x4de8ff });
  const matGlowWarm = new THREE.MeshBasicMaterial({ color: 0xffb060 });

  b.walls(62, 5, 1.2, matWall);
  b.deco(0, 3.4, -30.98, 56, 0.14, 0.02, matGlow);
  b.deco(0, 3.4, 30.98, 56, 0.14, 0.02, matGlow);
  b.deco(-30.98, 3.4, 0, 0.02, 0.14, 56, matGlow);
  b.deco(30.98, 3.4, 0, 0.02, 0.14, 56, matGlow);

  b.solid(0, 0.75, 0, 12, 1.5, 12, matPlatform);
  b.deco(0, 1.515, 0, 3.5, 0.02, 3.5, matGlowWarm);
  for (const dir of [1, -1]) {
    b.solid(0, 0.5, dir * 6.5, 4, 1.0, 1, matPlatform);
    b.solid(0, 0.25, dir * 7.5, 4, 0.5, 1, matPlatform);
  }
  for (const dir of [1, -1]) {
    b.solid(dir * 23, 1, 0, 12, 2, 9, matPlatform);
    b.solid(dir * 16.5, 0.75, 0, 1, 1.5, 4, matPlatform);
    b.solid(dir * 15.5, 0.5, 0, 1, 1.0, 4, matPlatform);
    b.solid(dir * 14.5, 0.25, 0, 1, 0.5, 4, matPlatform);
    b.solid(dir * 25, 2.7, 2.5, 2, 1.4, 1.6, matBlockAlt);
    b.solid(dir * 25, 2.7, -2.5, 2, 1.4, 1.6, matBlockAlt);
  }
  for (const px of [-1, 1]) for (const pz of [-1, 1]) {
    b.solid(px * 13, 2.1, pz * 13, 1.3, 4.2, 1.3, matBlock);
    b.deco(px * 13, 4.36, pz * 13, 0.9, 0.3, 0.9, matGlow);
  }
  const boxes = [
    [7, 1.0, -14, 2.0, 2.0, 2.0, matBlock], [8.6, 0.8, -12.2, 1.6, 1.6, 1.6, matBlockAlt],
    [-7, 1.0, 14, 2.0, 2.0, 2.0, matBlock], [-8.6, 0.8, 12.2, 1.6, 1.6, 1.6, matBlockAlt],
    [-9, 1.1, -8, 2.2, 2.2, 2.2, matBlockAlt], [-9, 2.9, -8, 1.4, 1.4, 1.4, matAccent],
    [9, 1.1, 8, 2.2, 2.2, 2.2, matBlockAlt], [9, 2.9, 8, 1.4, 1.4, 1.4, matAccent],
    [6, 0.9, -16, 5, 1.8, 1.1, matBlock], [-6, 0.9, 16, 5, 1.8, 1.1, matBlock],
    [-20, 0.85, -12, 1.7, 1.7, 1.7, matBlock], [20, 0.85, 12, 1.7, 1.7, 1.7, matBlock],
    [-16, 0.7, 20, 3.6, 1.4, 1.0, matBlockAlt], [16, 0.7, -20, 3.6, 1.4, 1.0, matBlockAlt],
  ];
  for (const [x, y, z, sx, sy, sz, m] of boxes) b.solid(x, y, z, sx, sy, sz, m);
  b.solid(-14, 0.7, 3, 3.2, 1.4, 0.7, matAccent, Math.PI / 5);
  b.solid(14, 0.7, -3, 3.2, 1.4, 0.7, matAccent, -Math.PI / 5);

  return {
    sun,
    hazardEnabled: true,
    enemySpawns: [
      v3(-24, 0, -24), v3(24, 0, -24), v3(-24, 0, 24), v3(24, 0, 24),
      v3(0, 0, 24), v3(0, 0, -24), v3(-24, 0, 0), v3(24, 0, 0), v3(0, 1.6, 0),
    ],
    playerSpawn: v3(0, 0.91, -22),
    teamSpawns: [
      [v3(0, 0.91, -24), v3(-8, 0.91, -24), v3(8, 0.91, -24), v3(-16, 0.91, -25)],
      [v3(0, 0.91, 24), v3(-8, 0.91, 24), v3(8, 0.91, 24), v3(16, 0.91, 25)],
    ],
    particles: null,
  };
}

// ============================================================
// MAP 2 — GLACIER (arctic research station; snowfall, ice, domes)
// ============================================================
function buildGlacier(scene, b) {
  scene.fog = new THREE.Fog(0xd9e6f2, 45, 190);
  b.group.add(skyDome(0x8fb3d9, 0xd6e4f2, 0xffffff));

  b.group.add(new THREE.HemisphereLight(0xffffff, 0xa8c2d8, 1.3));
  b.group.add(new THREE.AmbientLight(0xcfe0f0, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-20, 50, 26);
  if (b.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35;
    sc.near = 10; sc.far = 120;
    sun.shadow.bias = -0.0008;
  }
  b.group.add(sun);

  // Snow ground with speckle + drift streaks.
  const snowTex = canvasTex((g) => {
    g.fillStyle = '#e8eef5'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(160,185,210,${Math.random() * 0.14})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    g.strokeStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.moveTo(Math.random() * 256, Math.random() * 256);
      g.bezierCurveTo(Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256);
      g.stroke();
    }
  });
  snowTex.repeat.set(10, 10);
  b.ground(62, new THREE.MeshStandardMaterial({ map: snowTex, roughness: 1 }), 0xdde7f0);

  // Frozen pond — glossy, reflective-looking sheet at center.
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(8.5, 28),
    new THREE.MeshStandardMaterial({ color: 0x9fd0e8, roughness: 0.12, metalness: 0.35 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.y = 0.015;
  b.group.add(pond);

  // Ice-cliff perimeter.
  const matCliff = std(0xc2d8e8, { roughness: 0.7 });
  b.walls(62, 6, 1.4, matCliff);

  const matIce = new THREE.MeshStandardMaterial({
    color: 0xa8dcf0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85,
  });
  const matHut = std(0xc9d2d8, { roughness: 0.6 });
  const matHutDark = std(0x77828c, { roughness: 0.7 });
  const matCrate = std(0x5e7c94);
  const matWindow = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });

  // Ice spike clusters — cones, a silhouette the arena doesn't have.
  const spikes = [
    [-13, 12, 4.5, 1.5], [-11, 14.5, 2.6, 0.9], [-15.2, 13.5, 3.2, 1.1],
    [13, -12, 5, 1.6], [11.4, -14.4, 3, 1.0], [15, -13.6, 2.4, 0.8],
    [-22, -8, 3.6, 1.2], [22, 8, 3.8, 1.2],
  ];
  for (const [x, z, h, r] of spikes) {
    b.cyl(new THREE.ConeGeometry(r, h, 6), matIce, x, h / 2, z, r * 0.7, h);
  }

  // Research modules: two long labs with lit window strips + roof access.
  for (const dir of [1, -1]) {
    const x = dir * 17, z = dir * 15;
    b.solid(x, 1.4, z, 10, 2.8, 4.4, matHut, dir * 0.25);
    b.deco(x, 1.7, z + dir * 2.26, 8.4, 0.5, 0.06, matWindow, dir * 0.25);
    b.solid(x - dir * 5.4, 0.5, z + dir * 2.2, 2, 1.0, 2, matCrate, dir * 0.25);
    b.solid(x - dir * 6.6, 0.9, z + dir * 3.4, 2, 1.8, 2, matCrate, dir * 0.25);
    b.deco(x + dir * 2, 3.1, z, 1.2, 0.6, 1.2, matHutDark, dir * 0.25); // roof vent
  }

  // Radar dome (walk-around cover) + dish tower in opposite corners.
  b.cyl(new THREE.SphereGeometry(3.4, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), matHut, -19, 0, 19, 3.2, 3.4);
  b.cyl(new THREE.CylinderGeometry(0.6, 0.8, 5, 8), matHutDark, 20, 2.5, -20, 0.8, 5);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1, 12, 1, true), matHut);
  dish.position.set(20, 5.4, -20);
  dish.rotation.x = Math.PI * 0.65;
  b.add(dish, false);

  // Snow drift mounds — soft low cover.
  const matDrift = std(0xf2f6fa, { roughness: 1 });
  const drifts = [[6, -6, 3.4, 1.0], [-6, 6, 3.4, 1.0], [0, -17, 4.2, 1.2], [0, 17, 4.2, 1.2], [-24, 2, 3, 0.9], [24, -2, 3, 0.9]];
  for (const [x, z, w, h] of drifts) b.solid(x, h / 2 - 0.15, z, w, h, w * 0.6, matDrift);

  // Elevated ice shelf walkway (east) with snow-crate steps.
  b.solid(24.5, 1.1, 12, 9, 2.2, 6, matIce);
  b.solid(19.2, 0.55, 12, 1.6, 1.1, 3, matCrate);
  b.solid(20.8, 1.1, 12, 1.6, 2.2, 3, matCrate);

  return {
    sun,
    hazardEnabled: false,
    enemySpawns: [
      v3(-24, 0, -24), v3(24, 0, -24), v3(-24, 0, 24), v3(24, 0, 24),
      v3(0, 0, 25), v3(0, 0, -25), v3(-25, 0, 0), v3(25, 0, 0),
    ],
    playerSpawn: v3(0, 0.91, -23),
    teamSpawns: [
      [v3(-4, 0.91, -25), v3(4, 0.91, -25), v3(-12, 0.91, -24), v3(12, 0.91, -24)],
      [v3(-4, 0.91, 25), v3(4, 0.91, 25), v3(-12, 0.91, 24), v3(12, 0.91, 24)],
    ],
    particles: new ParticleField(b.group, 'snow'),
  };
}

// ============================================================
// MAP 3 — EMBERFALL (volcanic foundry at night; lava, obsidian)
// ============================================================
function buildEmber(scene, b) {
  scene.fog = new THREE.Fog(0x2a1418, 55, 200);
  b.group.add(skyDome(0x06030a, 0x2a0f12, 0xff4a1a));

  b.group.add(new THREE.HemisphereLight(0xff9a60, 0x241418, 0.85));
  b.group.add(new THREE.AmbientLight(0x9a6a58, 0.85));
  const sun = new THREE.DirectionalLight(0xff8055, 1.1);
  sun.position.set(-30, 30, -20);
  if (b.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35;
    sc.near = 10; sc.far = 120;
    sun.shadow.bias = -0.0008;
  }
  b.group.add(sun);

  // Cracked basalt ground.
  const basaltTex = canvasTex((g) => {
    g.fillStyle = '#3a333d'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.moveTo(Math.random() * 256, Math.random() * 256);
      g.lineTo(Math.random() * 256, Math.random() * 256);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,90,30,.10)';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(Math.random() * 256, Math.random() * 256);
      g.lineTo(Math.random() * 256, Math.random() * 256);
      g.stroke();
    }
  });
  basaltTex.repeat.set(12, 12);
  b.ground(62, new THREE.MeshStandardMaterial({ map: basaltTex, roughness: 1 }), 0x17141a);

  // Glowing lava channels crossing the field, with point lights above them.
  const matLava = new THREE.MeshBasicMaterial({ color: 0xff5a1e });
  const lavaStrips = [
    [-8, -4, 22, 1.4, 0.6], [10, 8, 18, 1.2, -0.4], [0, -18, 14, 1.1, 1.2], [-16, 14, 12, 1.0, 0.2],
  ];
  for (const [x, z, len, w, ry] of lavaStrips) {
    const strip = b.deco(x, 0.02, z, w, 0.02, len, matLava, ry);
    strip.receiveShadow = false;
  }
  for (const [x, z] of [[-8, -4], [10, 8]]) {
    const l = new THREE.PointLight(0xff6a20, 1.6, 16, 2);
    l.position.set(x, 1.4, z);
    b.group.add(l);
  }

  // Perimeter: dark basalt ramparts with glowing fissures.
  const matRampart = std(0x453c48, { roughness: 0.75 });
  b.walls(62, 6, 1.4, matRampart);
  for (const [x, z, w, ry] of [[0, -30.9, 40, 0], [0, 30.9, 40, 0], [-30.9, 0, 40, Math.PI / 2], [30.9, 0, 40, Math.PI / 2]]) {
    b.deco(x, 1.1, z, w, 0.1, 0.06, matLava, ry);
  }

  // Obsidian columns — glossy hex prisms, tall and moody.
  const matObsidian = std(0x322a3e, { roughness: 0.25, metalness: 0.2 });
  const cols = [[-12, -12, 5.5, 1.3], [12, 12, 5.5, 1.3], [-14, 10, 4, 1.0], [14, -10, 4, 1.0], [-4, 20, 4.6, 1.1], [4, -20, 4.6, 1.1]];
  for (const [x, z, h, r] of cols) {
    b.cyl(new THREE.CylinderGeometry(r * 0.85, r, h, 6), matObsidian, x, h / 2, z, r * 0.75, h);
  }

  // Central crucible: round foundry platform with a glowing vat.
  const matIron = std(0x59505c, { roughness: 0.5, metalness: 0.25 });
  b.cyl(new THREE.CylinderGeometry(4.4, 4.8, 1.6, 12), matIron, 0, 0.8, 0, 4.4, 1.6);
  const vat = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 1.5, 10), matObsidian);
  vat.position.set(0, 2.35, 0);
  b.add(vat);
  b.colliders.push(aabb(0, 2.35, 0, 2.8, 1.5, 2.8));
  const melt = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.08, 10), matLava);
  melt.position.set(0, 3.12, 0);
  b.add(melt, false);
  const vatLight = new THREE.PointLight(0xff6a20, 1.8, 14, 2);
  vatLight.position.set(0, 4, 0);
  b.group.add(vatLight);
  // Steps up to the crucible rim.
  b.solid(0, 0.4, 6.1, 3.4, 0.8, 1.2, matIron);
  b.solid(0, 0.4, -6.1, 3.4, 0.8, 1.2, matIron);

  // Angled foundry slabs — jagged cover language.
  const matSlab = std(0x4d4152, { roughness: 0.65 });
  const slabs = [
    [-8, 8, 3.6, 1.6, 0.9, 0.5], [8, -8, 3.6, 1.6, 0.9, -0.5],
    [-20, -4, 3, 1.4, 0.8, 1.1], [20, 4, 3, 1.4, 0.8, -1.1],
    [-6, -14, 4, 1.7, 1.0, -0.3], [6, 14, 4, 1.7, 1.0, 0.3],
    [-18, 20, 2.6, 1.5, 2.2, 0.7], [18, -20, 2.6, 1.5, 2.2, -0.7],
  ];
  for (const [x, z, w, h, d, ry] of slabs) b.solid(x, h / 2, z, w, h, d, matSlab, ry);

  return {
    sun,
    hazardEnabled: false,
    enemySpawns: [
      v3(-24, 0, -24), v3(24, 0, -24), v3(-24, 0, 24), v3(24, 0, 24),
      v3(0, 0, 25), v3(0, 0, -25), v3(-25, 0, 0), v3(25, 0, 0),
    ],
    playerSpawn: v3(0, 0.91, -23),
    teamSpawns: [
      [v3(-4, 0.91, -25), v3(4, 0.91, -25), v3(-12, 0.91, -24), v3(12, 0.91, -24)],
      [v3(-4, 0.91, 25), v3(4, 0.91, 25), v3(-12, 0.91, 24), v3(12, 0.91, 24)],
    ],
    particles: new ParticleField(b.group, 'embers'),
  };
}

const BUILDERS = { arena: buildArena, glacier: buildGlacier, ember: buildEmber };

export function buildMap(scene, id, { shadows = true } = {}) {
  const b = new B(shadows);
  const built = (BUILDERS[id] || buildArena)(scene, b);
  scene.add(b.group);
  return {
    group: b.group,
    colliders: b.colliders,
    ...built,
    update(dt, focus) { built.particles?.update(dt, focus); },
    dispose() {
      scene.remove(b.group);
      disposeGroup(b.group);
    },
  };
}
