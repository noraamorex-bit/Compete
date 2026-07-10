# ⚡ VOLTAGE — Arena FPS

A complete, polished browser first-person shooter. Three distinct maps, six weapons, endless drone waves — plus 1v1, 2v2, and 4v4 online multiplayer. Built with vanilla JavaScript and Three.js — no build step, no dependencies to install.

**Play it:** open `index.html` via any static server, or deploy the repo to Vercel as-is.

## Features

- Full FPS movement: sprint (with FOV kick), jump, acceleration, step-up, camera bob and sway
- Six unlockable weapons (assault rifle, shotgun, SMG, LMG, marksman rifle, hand cannon) with aim-down-sights, recoil, bloom spread, muzzle flash, tracers, reload animations, hit markers, floating damage numbers
- Three enemy types: sentinel drones (chase/orbit + plasma bursts), kamikaze rushers (charge and detonate), and boss sentinels every 5th wave with their own health bar
- Pickups: health packs and double-damage cores drop from kills (bosses always pay out)
- Grenades on a 6s cooldown (G / grenade button) with bouncing physics and AoE falloff
- A rotating laser hazard sweeps the arena from wave 4 — duck behind cover or take high ground
- Local top-5 leaderboard on the death screen; weapon cards show damage/rate/range stat bars
- Juice: boss-kill slow-mo, low-health heartbeat, death camera
- **Online multiplayer: 1v1, 2v2, 4v4** — peer-to-peer over WebRTC (PeerJS) with the host relaying for team modes: host picks mode + map, shares the 4-letter code, teams auto-balance by join order; first team to 10/15/25 kills; ally markers, friendly-fire blocking, countdown, respawns, host rematch, and disconnect handling. No accounts, no game server
- **Three maps with their own identities**: VOLT ARENA (dusk industrial, laser hazard), GLACIER (bright arctic station with falling snow, ice spikes, a frozen pond, radar dome), and EMBERFALL (night volcanic foundry with glowing lava channels, obsidian columns, rising embers)
- Desktop **and** mobile: pointer-lock mouse aim + WASD, or virtual joystick + swipe look + touch buttons (auto-detected)
- Minimal modern HUD: health, ammo, kills, streaks, dynamic crosshair, directional damage indicators
- Procedural Web Audio sound effects — zero audio assets
- Wave mode: escalating rounds with more, tougher, faster enemies and intermissions
- Score system with a kill-chain multiplier (up to ×8) and crit bonuses; best score/wave persistence
- Settings: sensitivity slider and a graphics quality toggle (pause menu)
- Installable PWA with offline play (service worker + manifest + app icon)

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD | Left-side virtual joystick |
| Look | Mouse (pointer lock) | Swipe right side |
| Shoot | Left click | ◉ Fire button |
| Aim (ADS) | Hold right click | Aim toggle button |
| Jump | Space | Jump button |
| Sprint | Shift | Sprint toggle (or push joystick past rim) |
| Reload | R | Reload button |
| Pause | Esc | ❚❚ button |

## Run locally

Any static file server works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy

Push to GitHub and import into [Vercel](https://vercel.com) — it deploys as a static site with zero configuration.

## Tech

- [Three.js](https://threejs.org) (vendored in `lib/`) for rendering
- Custom AABB collision, hitscan and AI raycasts (no physics engine)
- Procedural sounds via the Web Audio API
- ES modules served directly — no bundler

## Project layout

```
index.html        Shell: HUD, menus, mobile controls
css/style.css     All UI styling
js/main.js        Bootstrap, game states, main loop
js/config.js      Central gameplay tuning
js/world.js       Arena geometry, lighting, colliders
js/player.js      Movement, collision, camera feel, health
js/weapon.js      Rifle viewmodel, gunplay, hit detection
js/enemy.js       Drone AI, projectiles, respawns
js/effects.js     Particles, tracers, rings, damage numbers
js/hud.js         DOM HUD updates
js/input.js       Keyboard/mouse + touch input
js/audio.js       Procedural sound engine
lib/              Vendored Three.js
```
