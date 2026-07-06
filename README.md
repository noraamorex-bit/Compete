# ⚡ VOLTAGE — Arena FPS

A complete, polished browser first-person shooter. One arena, one rifle, endless sentinel drones. Built with vanilla JavaScript and Three.js — no build step, no dependencies to install.

**Play it:** open `index.html` via any static server, or deploy the repo to Vercel as-is.

## Features

- Full FPS movement: sprint, jump, acceleration, step-up, camera bob and sway
- One satisfying assault rifle: recoil, bloom spread, muzzle flash, tracers, reload animation, hit markers, floating damage numbers
- Sentinel drone enemies: wander → detect → chase/orbit → plasma bursts, death animations, respawns
- Desktop **and** mobile: pointer-lock mouse aim + WASD, or virtual joystick + swipe look + touch buttons (auto-detected)
- Minimal modern HUD: health, ammo, kills, streaks, dynamic crosshair
- Procedural Web Audio sound effects — zero audio assets
- Kill streaks, best-score persistence, pause / restart / death flow

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD | Left-side virtual joystick |
| Aim | Mouse (pointer lock) | Swipe right side |
| Shoot | Left click | ◉ Fire button |
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
