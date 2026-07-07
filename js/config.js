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
  // `pellets` > 1 makes a shot fire multiple hitscan pellets (shotgun).
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
      id: 'scatter', name: 'SCATTER-6', desc: 'SHOTGUN', unlockKills: 10,
      damage: 16, pellets: 7, critMultiplier: 1.5, magSize: 6,
      fireInterval: 0.9, reloadTime: 2.0, range: 40,
      baseSpread: 0.04, moveSpread: 0.012, spreadPerShot: 0.002, spreadRecovery: 0.1,
      recoilKick: 0.032, adsFov: 62,
      accent: 0xffd166, barrel: 0.85,
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
      id: 'storm', name: 'STORM-99', desc: 'LMG', unlockKills: 50,
      damage: 16, critMultiplier: 2.0, magSize: 80,
      fireInterval: 1 / 15, reloadTime: 2.4, range: 110,
      baseSpread: 0.011, moveSpread: 0.024, spreadPerShot: 0.004, spreadRecovery: 0.1,
      recoilKick: 0.009, adsFov: 58,
      accent: 0x53e07f, barrel: 1.15,
    },
    {
      id: 'arc', name: 'ARC-12', desc: 'MARKSMAN', unlockKills: 75,
      damage: 68, critMultiplier: 2.5, magSize: 12,
      fireInterval: 0.36, reloadTime: 1.8, range: 160,
      baseSpread: 0.0015, moveSpread: 0.014, spreadPerShot: 0.014, spreadRecovery: 0.06,
      recoilKick: 0.026, adsFov: 38,
      accent: 0xb07aff, barrel: 1.35,
    },
    {
      id: 'titan', name: 'TITAN-50', desc: 'HAND CANNON', unlockKills: 100,
      damage: 120, critMultiplier: 3.0, magSize: 5,
      fireInterval: 0.65, reloadTime: 1.7, range: 140,
      baseSpread: 0.003, moveSpread: 0.016, spreadPerShot: 0.02, spreadRecovery: 0.07,
      recoilKick: 0.042, adsFov: 50,
      accent: 0xff4d5e, barrel: 0.55,
    },
  ],

  enemy: {
    maxAlive: 6,
    detectRange: 26,
    loseRange: 34,
    burstInterval: 0.14,
    projectileSpeed: 24,
    projectileDamage: 11,

    // Per-type stats. `score` is the base kill reward.
    types: {
      drone: {
        health: 100, hover: 1.55, wanderSpeed: 2.1, chaseSpeed: 4.4,
        bodyRadius: 0.72, coreRadius: 0.3, canShoot: true,
        attackRange: 21, preferredRange: 11,
        burstCount: 3, burstCooldownMin: 1.1, burstCooldownMax: 2.0,
        score: 100,
      },
      rusher: {
        health: 45, hover: 1.0, wanderSpeed: 3.0, chaseSpeed: 7.2,
        bodyRadius: 0.5, coreRadius: 0.22, canShoot: false,
        detonateRange: 1.7, detonateDamage: 22,
        score: 80,
      },
      boss: {
        health: 850, hover: 2.3, wanderSpeed: 1.6, chaseSpeed: 2.4,
        bodyRadius: 1.75, coreRadius: 0.6, canShoot: true,
        attackRange: 27, preferredRange: 14,
        burstCount: 5, burstCooldownMin: 0.9, burstCooldownMax: 1.5,
        score: 600, meshScale: 2.5,
      },
    },
  },

  grenade: {
    cooldown: 6,
    speed: 16,
    upBoost: 3.0,
    gravity: 19,
    bounce: 0.42,
    fuse: 1.5,
    radius: 5.5,
    damageCenter: 95,
    damageEdge: 25,
  },

  hazard: {
    startWave: 4,             // laser sweep activates from this wave on
    innerRadius: 6.6,
    outerRadius: 30,
    height: 1.2,
    halfWidth: 0.55,          // beam half-thickness for the hit test
    speed: 0.55,              // rad/s sweep
    damage: 12,
    tickInterval: 0.6,        // min seconds between hits on the player
    warmup: 2.5,              // blink-warning seconds at wave start
  },

  pickups: {
    healthAmount: 35,
    boostDuration: 10,        // double-damage seconds
    dropHealth: 0.16,         // per-kill drop chance
    dropBoost: 0.08,
    ttl: 14,                  // seconds before a drop despawns
    grabRadius: 1.5,
  },

  arena: {
    size: 62,                 // outer square, wall to wall
    wallHeight: 5,
  },

  waves: {
    intermission: 4.0,        // seconds between waves
    spawnStagger: 0.9,        // delay between spawns within a wave
    bossEvery: 5,             // every Nth wave is a boss wave
    count: (n) => 2 + 2 * n,            // total enemies in wave n
    maxAlive: (n) => Math.min(2 + n, 7),
    healthScale: (n) => Math.min(1 + 0.07 * (n - 1), 1.8),
    speedScale: (n) => Math.min(1 + 0.04 * (n - 1), 1.35),
    rusherShare: (n) => (n >= 2 ? 0.3 : 0), // fraction of a normal wave that spawns as rushers
    bossHealthScale: (b) => 1 + 0.4 * (b - 1), // b = 1st, 2nd... boss
  },

  score: {
    critBonus: 25,
    maxMultiplier: 8,
    comboWindow: 6.0,         // seconds to keep the chain alive
  },
};
