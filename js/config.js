// Central gameplay tuning. All units are meters / seconds unless noted.
export const CONFIG = {
  player: {
    height: 1.8,
    radius: 0.35,
    eyeHeight: 1.62,
    walkSpeed: 5.6,
    sprintSpeed: 9.2,
    accel: 42,
    airAccel: 14,
    friction: 10,
    jumpVelocity: 7.6,
    gravity: 21,
    sprintFovKick: 7,         // degrees added while sprinting
    stepHeight: 0.55,
    maxHealth: 100,
    regenDelay: 4.0,
    regenRate: 18,
  },

  // Weapon roster — later entries unlock via lifetime kills.
  weapons: [
    {
      id: 'volt', name: 'VOLT-7', desc: 'ASSAULT RIFLE', unlockKills: 0,
      damage: 26, critMultiplier: 2.0, magSize: 30,
      fireInterval: 1 / 11, reloadTime: 1.55, range: 120,
      baseSpread: 0.006, moveSpread: 0.02, spreadPerShot: 0.0065, spreadRecovery: 0.09,
      recoilKick: 0.011, adsFov: 55,
      accent: 0xff8a3d, barrel: 1.0,
    },
    {
      id: 'spark', name: 'SPARK-9', desc: 'SMG', unlockKills: 25,
      damage: 15, critMultiplier: 2.0, magSize: 42,
      fireInterval: 1 / 17, reloadTime: 1.25, range: 90,
      baseSpread: 0.009, moveSpread: 0.022, spreadPerShot: 0.005, spreadRecovery: 0.13,
      recoilKick: 0.007, adsFov: 58,
      accent: 0x4de8ff, barrel: 0.7,
    },
    {
      id: 'arc', name: 'ARC-12', desc: 'MARKSMAN', unlockKills: 75,
      damage: 68, critMultiplier: 2.5, magSize: 12,
      fireInterval: 0.36, reloadTime: 1.8, range: 160,
      baseSpread: 0.0015, moveSpread: 0.014, spreadPerShot: 0.014, spreadRecovery: 0.06,
      recoilKick: 0.026, adsFov: 38,
      accent: 0xb07aff, barrel: 1.35,
    },
  ],

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
