// Central gameplay tuning. All units are meters / seconds unless noted.
export const CONFIG = {
  player: {
    height: 1.8,
    radius: 0.35,
    eyeHeight: 1.62,
    walkSpeed: 5.6,
    sprintSpeed: 8.4,
    accel: 42,
    airAccel: 14,
    friction: 10,
    jumpVelocity: 7.6,
    gravity: 21,
    stepHeight: 0.55,
    maxHealth: 100,
    regenDelay: 4.0,
    regenRate: 18,
  },

  weapon: {
    damage: 26,
    critMultiplier: 2.0,
    magSize: 30,
    fireInterval: 1 / 11,     // ~660 RPM
    reloadTime: 1.55,
    range: 120,
    baseSpread: 0.006,        // radians
    moveSpread: 0.02,
    spreadPerShot: 0.0065,
    spreadRecovery: 0.09,
    recoilKick: 0.011,        // camera pitch per shot (radians)
  },

  enemy: {
    maxAlive: 6,
    health: 100,
    hoverHeight: 1.55,
    wanderSpeed: 2.1,
    chaseSpeed: 4.4,
    detectRange: 26,
    loseRange: 34,
    attackRange: 21,
    preferredRange: 11,
    burstCount: 3,
    burstInterval: 0.14,
    burstCooldownMin: 1.1,
    burstCooldownMax: 2.0,
    projectileSpeed: 24,
    projectileDamage: 11,
    bodyRadius: 0.72,
    coreRadius: 0.3,
  },

  arena: {
    size: 62,                 // outer square, wall to wall
    wallHeight: 5,
  },

  waves: {
    intermission: 4.0,        // seconds between waves
    spawnStagger: 0.9,        // delay between spawns within a wave
    count: (n) => 2 + 2 * n,            // total enemies in wave n
    maxAlive: (n) => Math.min(2 + n, 7),
    healthScale: (n) => Math.min(1 + 0.07 * (n - 1), 1.8),
    speedScale: (n) => Math.min(1 + 0.04 * (n - 1), 1.35),
  },

  score: {
    killPoints: 100,
    critBonus: 25,
    maxMultiplier: 8,
    comboWindow: 6.0,         // seconds to keep the chain alive
  },
};
