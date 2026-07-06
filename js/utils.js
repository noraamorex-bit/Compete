// Small math / collision helpers shared across modules.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential damping factor.
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export const rand = (a, b) => a + Math.random() * (b - a);

// ---- AABB colliders: plain { min:{x,y,z}, max:{x,y,z} } objects ----

export function aabb(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  return {
    min: { x: cx - hx, y: cy - hy, z: cz - hz },
    max: { x: cx + hx, y: cy + hy, z: cz + hz },
  };
}

export function aabbOverlap(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

export function pointInAABB(p, b, pad = 0) {
  return (
    p.x > b.min.x - pad && p.x < b.max.x + pad &&
    p.y > b.min.y - pad && p.y < b.max.y + pad &&
    p.z > b.min.z - pad && p.z < b.max.z + pad
  );
}

// Slab-test ray vs AABB. Returns hit distance or Infinity.
export function rayAABB(ox, oy, oz, dx, dy, dz, box, maxDist = Infinity) {
  let tmin = 0, tmax = maxDist;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mins = [box.min.x, box.min.y, box.min.z];
  const maxs = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return Infinity;
    } else {
      const inv = 1 / d[i];
      let t1 = (mins[i] - o[i]) * inv;
      let t2 = (maxs[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest ray hit against a collider list. Returns { dist, collider } or null.
export function raycastColliders(ox, oy, oz, dx, dy, dz, colliders, maxDist = Infinity) {
  let best = maxDist, hit = null;
  for (const c of colliders) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, c, best);
    if (t < best) { best = t; hit = c; }
  }
  return hit ? { dist: best, collider: hit } : null;
}

// Ray vs sphere. Returns hit distance or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  return t >= 0 ? t : Infinity;
}

// Height of the highest collider top under (x, z), for hover/ground sampling.
export function groundHeightAt(x, z, colliders, pad = 0.1) {
  let h = 0;
  for (const c of colliders) {
    if (x > c.min.x - pad && x < c.max.x + pad && z > c.min.z - pad && z < c.max.z + pad) {
      if (c.max.y > h && c.max.y < 4.5) h = c.max.y; // ignore perimeter walls
    }
  }
  return h;
}
