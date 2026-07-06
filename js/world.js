// Arena construction: geometry, lighting, sky, and the static AABB collider list.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { aabb } from './utils.js';

const PALETTE = {
  ground: 0x38414f,
  groundLine: 0x2e3644,
  wall: 0x4a5468,
  block: 0x717d92,
  blockAlt: 0x5d6a80,
  accent: 0xff8a3d,
  emissive: 0x4de8ff,
  platform: 0x66738a,
};

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3d4655';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(20, 26, 36, 0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  g.lineWidth = 1;
  for (let i = 64; i < 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyDome() {
  const geo = new THREE.SphereGeometry(300, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3563a8) },
      mid: { value: new THREE.Color(0x87aede) },
      bottom: { value: new THREE.Color(0xffb37a) },
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function buildWorld(scene, { shadows = true } = {}) {
  const S = CONFIG.arena.size;
  const H = S / 2;
  const WH = CONFIG.arena.wallHeight;
  const colliders = [];

  scene.fog = new THREE.Fog(0x8ba7cf, 70, 260);
  scene.add(skyDome());

  // ---- Lighting ----
  scene.add(new THREE.HemisphereLight(0xbdd5f5, 0x6b5a48, 1.15));
  scene.add(new THREE.AmbientLight(0x8899bb, 0.75));
  const sun = new THREE.DirectionalLight(0xffe0b3, 2.4);
  sun.position.set(28, 42, 18);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -H - 4; sc.right = H + 4; sc.top = H + 4; sc.bottom = -H - 4;
    sc.near = 10; sc.far = 110;
    sun.shadow.bias = -0.0008;
  }
  scene.add(sun);

  // ---- Materials ----
  const matGround = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 });
  const matWall = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 });
  const matBlock = new THREE.MeshStandardMaterial({ color: PALETTE.block, roughness: 0.85 });
  const matBlockAlt = new THREE.MeshStandardMaterial({ color: PALETTE.blockAlt, roughness: 0.85 });
  const matPlatform = new THREE.MeshStandardMaterial({ color: PALETTE.platform, roughness: 0.8 });
  const matAccent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.6 });
  const matGlow = new THREE.MeshBasicMaterial({ color: PALETTE.emissive });
  const matGlowWarm = new THREE.MeshBasicMaterial({ color: 0xffb060 });

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  // Adds a box mesh AND a matching collider.
  function solid(cx, cy, cz, sx, sy, sz, mat, ry = 0) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    scene.add(m);
    // Colliders stay axis-aligned; rotated meshes get a fitted AABB.
    if (ry !== 0) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      colliders.push(aabb(cx, cy, cz, sx * c + sz * s, sy, sx * s + sz * c));
    } else {
      colliders.push(aabb(cx, cy, cz, sx, sy, sz));
    }
    return m;
  }

  // Decorative only — no collider.
  function deco(cx, cy, cz, sx, sy, sz, mat) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    scene.add(m);
    return m;
  }

  // ---- Ground ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  scene.add(ground);
  // Apron outside the walls so gaps never show sky.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(S * 4, S * 4),
    new THREE.MeshStandardMaterial({ color: 0x333c4a, roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);

  // ---- Perimeter walls (with accent stripe) ----
  const T = 1.2; // wall thickness
  solid(0, WH / 2, -H - T / 2, S + T * 2, WH, T, matWall);
  solid(0, WH / 2, H + T / 2, S + T * 2, WH, T, matWall);
  solid(-H - T / 2, WH / 2, 0, T, WH, S, matWall);
  solid(H + T / 2, WH / 2, 0, T, WH, S, matWall);
  deco(0, 3.4, -H - T / 2 + T / 2 + 0.02, S * 0.9, 0.14, 0.02, matGlow);
  deco(0, 3.4, H + T / 2 - T / 2 - 0.02, S * 0.9, 0.14, 0.02, matGlow);
  deco(-H - T / 2 + T / 2 + 0.02, 3.4, 0, 0.02, 0.14, S * 0.9, matGlow);
  deco(H + T / 2 - T / 2 - 0.02, 3.4, 0, 0.02, 0.14, S * 0.9, matGlow);

  // ---- Central platform with steps (N + S) ----
  solid(0, 0.75, 0, 12, 1.5, 12, matPlatform);
  deco(0, 1.515, 0, 3.5, 0.02, 3.5, matGlowWarm); // landing pad glow
  for (const dir of [1, -1]) {
    solid(0, 0.5, dir * 6.5, 4, 1.0, 1, matPlatform);
    solid(0, 0.25, dir * 7.5, 4, 0.5, 1, matPlatform);
  }

  // ---- Side high platforms (E + W) with steps ----
  for (const dir of [1, -1]) {
    solid(dir * 23, 1, 0, 12, 2, 9, matPlatform);
    solid(dir * 16.5, 0.75, 0, 1, 1.5, 4, matPlatform);
    solid(dir * 15.5, 0.5, 0, 1, 1.0, 4, matPlatform);
    solid(dir * 14.5, 0.25, 0, 1, 0.5, 4, matPlatform);
    // Cover on top of the platform
    solid(dir * 25, 2.7, 2.5, 2, 1.4, 1.6, matBlockAlt);
    solid(dir * 25, 2.7, -2.5, 2, 1.4, 1.6, matBlockAlt);
  }

  // ---- Corner pillars with glow caps ----
  for (const px of [-1, 1]) for (const pz of [-1, 1]) {
    solid(px * 13, 2.1, pz * 13, 1.3, 4.2, 1.3, matBlock);
    deco(px * 13, 4.36, pz * 13, 0.9, 0.3, 0.9, matGlow);
  }

  // ---- Scattered cover: boxes, stacks, barriers ----
  const boxes = [
    [7, 1.0, -14, 2.0, 2.0, 2.0, matBlock],
    [8.6, 0.8, -12.2, 1.6, 1.6, 1.6, matBlockAlt],
    [-7, 1.0, 14, 2.0, 2.0, 2.0, matBlock],
    [-8.6, 0.8, 12.2, 1.6, 1.6, 1.6, matBlockAlt],
    [-9, 1.1, -8, 2.2, 2.2, 2.2, matBlockAlt],
    [-9, 2.9, -8, 1.4, 1.4, 1.4, matAccent],
    [9, 1.1, 8, 2.2, 2.2, 2.2, matBlockAlt],
    [9, 2.9, 8, 1.4, 1.4, 1.4, matAccent],
    [6, 0.9, -16, 5, 1.8, 1.1, matBlock],
    [-6, 0.9, 16, 5, 1.8, 1.1, matBlock],
    [-20, 0.85, -12, 1.7, 1.7, 1.7, matBlock],
    [20, 0.85, 12, 1.7, 1.7, 1.7, matBlock],
    [-16, 0.7, 20, 3.6, 1.4, 1.0, matBlockAlt],
    [16, 0.7, -20, 3.6, 1.4, 1.0, matBlockAlt],
  ];
  for (const [x, y, z, sx, sy, sz, m] of boxes) solid(x, y, z, sx, sy, sz, m);

  // Rotated accent barriers for visual variety.
  solid(-14, 0.7, 3, 3.2, 1.4, 0.7, matAccent, Math.PI / 5);
  solid(14, 0.7, -3, 3.2, 1.4, 0.7, matAccent, -Math.PI / 5);

  // ---- Spawn points ----
  const enemySpawns = [
    new THREE.Vector3(-24, 0, -24),
    new THREE.Vector3(24, 0, -24),
    new THREE.Vector3(-24, 0, 24),
    new THREE.Vector3(24, 0, 24),
    new THREE.Vector3(0, 0, 24),
    new THREE.Vector3(0, 0, -24),
    new THREE.Vector3(-24, 0, 0),
    new THREE.Vector3(24, 0, 0),
    new THREE.Vector3(0, 1.6, 0),          // on the central platform
  ];

  const playerSpawn = new THREE.Vector3(0, CONFIG.player.height / 2 + 0.01, -22);

  return { colliders, enemySpawns, playerSpawn };
}
