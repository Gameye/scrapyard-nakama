# Game loop

One loop, owned by the shared renderer: `mountRenderer` (`game/renderer.ts`)
calls `renderer.setAnimationLoop(frame)` and its teardown clears it. During a
match the frame is `startGame`'s (`game/runtime.ts`); in the garage it is the
turntable's (`game/turntable.ts`). Never both: the gameplay screen unmounts
before the garage mounts, and each teardown runs before the next mount.

Paths below are relative to `game/src/game/`.

## Per animation frame (`runtime.ts` → `match.ts`)

```
runtime frame(time)
├─ arena.update(time / 1000)               arena animation: signals, cranes, flicker (visual only)
├─ match.frame(time)
│   ├─ dt = clamp(time − last, 0, 0.1 s)   tab switches and hiccups never step more than 0.1 s
│   ├─ pilot.read(looking, driving)        keyboard + mouse → player.control (throttle, steer, handbrake, fire);
│   │                                      driving only when playing, alive and past the pre-match hold
│   ├─ unless paused: accumulator += dt
│   │     while accumulator ≥ PHYSICS_STEP (1/60 s): step(PHYSICS_STEP)     ← fixed steps, below
│   ├─ view.place(accumulator / PHYSICS_STEP)   models between the last two steps; wheels from the ray-cast car
│   ├─ chase.update(…)                     camera follows the interpolated model; mouse look
│   ├─ pilot.layAim()                      crosshair ray + lock-on → player.control.aim, HUD target
│   ├─ pilot.look(dt)                      every 0.15 s: which rivals are in plain view (HUD markers)
│   ├─ view.animate(dt)                    turrets onto aim, ambient effects, engine/loop audio,
│   │                                      particles, muzzle light, HUD pulses decay
│   └─ mode.show(camera)                   the mode's scenery (free for all: pickups, hot zone)
├─ followShadow(sun, ahead of the car)     shadow frustum follows the view
├─ onFrame(match, camera)                  the HUD writes the DOM (hud/Hud.tsx update)
└─ composer.render()                       MSAA → GTAO → bloom → output (per quality setting)
```

Paused: no steps (`dt` still read, `frameDt` = 0), so the rules' clock, the
physics and every timer stand still; the scene still renders.

## Per fixed step (`match.ts` step → `simulation.ts` step)

```
match.step(dt)                             live = phase is playing or destroyed (not paused, not over)
├─ sim.step(dt, live)
│   ├─ held = rules.phase === 'preMatch'   countdown: nobody drives or fires
│   ├─ think(bot) for every live machine with a brain (ai.ts), when live and not held
│   ├─ for every machine:
│   │     last pose ← pose                 (interpolation, crash detection)
│   │     driveCar(control, or WRECKED when down/held, × mode.speedFactor)
│   │     alive: rightIfUpended; pullTrigger → fire (hitscan or rocket launch); reload edges reported
│   │     down: deadFor += dt
│   ├─ world.step()                        Rapier, fixed timestep 1/60 s
│   ├─ for every machine: read pose back; a hard jolt is a crash (reported)
│   ├─ flyRockets(dt)                      swept ray per rocket; bursts: shove + falloff damage
│   └─ when live: rules.tick(dt); respawn everyone the rules say is due (pickSpawn, sees, reset)
├─ when live: elapsed += dt; mode.report(feed) (events → feed lines, callouts); feed.beep (countdown ticks)
├─ destroyed and the player is back → playing
├─ playing, the player down for 1.4 s → destroyed (death board)
└─ playing or destroyed: mode.outcome() defined → finish: bots stand down, victory / defeat
```

Inside the step, combat reports to the view as it happens (`SimEvents`:
`fired`, `shot`, `rocket`, `burst`, `hurt`, `wrecked`, `crashed`,
`reloading`, `respawned`), at the same points the old inline code ran, so
effects and sounds keep their order within the step.

## Timing rules

- Simulation time only: the rules (`ffa/rules.ts`, `tdm/rules.ts`) advance by
  `tick(dt)` with the fixed step; no gameplay timer reads the wall clock or
  the frame rate. The HUD reads the rules' clock (`rules.now`).
- The React tree does not re-render per frame: it re-renders on player-view
  phase changes (`onPhase`) and menu state only.
- Frame-rate-dependent code is presentation only: camera smoothing, turret
  laying, particle emission, audio levels, HUD fades — all fed the frame's
  `dt`, all stopped (dt = 0) while paused.
- `window.tick(ms)` (dev) runs one runtime frame by hand at a given time:
  hidden tabs get no animation frames.
