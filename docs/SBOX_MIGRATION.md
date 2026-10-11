# Moving Far from the Tree to s&box

The web game (`web/`, live at [farfromthetree.world](https://farfromthetree.world)) is the working version and the design reference. When the new machine is set up, the game gets rebuilt in **s&box** (Source 2, C#) for a Steam release. This doc is the plan for that move, and it sets the rules that keep the web code easy to port in the meantime.

> Status: **not started.** The web game keeps evolving; this doc and `web/export/sbox/` are kept current as it does.

---

## 1. What carries over and what gets rebuilt

| Web game | Lines (approx.) | In s&box | Effort |
|---|---|---|---|
| `web/src/world/`: the city, wind, currents, subway, closures, rain, traffic, crowds | ~4.6k | **Port line by line** into a plain C# library (no engine types), then wrap in Components | Medium, mechanical |
| `web/src/sim/glider.ts`: the leaf's flight model | ~600 | **Port line by line** into a `LeafController` Component (fixed-step) | Small |
| `web/src/core/rng.ts`: deterministic hashes and noise | small | **Port exactly** (integer maths; see §4) | Small |
| `web/public/city.json`, `far.dat`: the map data | 2.5 MB + 1.7 MB | **Reuse as-is**; load them as JSON or binary from the project | None |
| `web/export/sbox/*.json`: derived world, tuning, parity samples | ~370 KB | **Reuse as-is**, as the port's test oracle (see §5) | None |
| Blender pipelines (`web/tools/*/…_blender.py`, `.glb` in `web/public/models`) | | **Re-export** from the same `.blend`/scripts as FBX for s&box (`.vmdl`) | Small per asset |
| Tesseract textures (`web/tools/*/tesseract/`) | | **Reuse** the rendered PNGs as material inputs | Small |
| `web/src/render/`: three.js meshes, shaders, instancing, streaming | ~13k | **Rebuild** with s&box models, materials, `SceneObject`s; most custom streaming and LOD code becomes engine features | Large, but simpler |
| `web/src/game/`: HUD, menus, album, leaderboard UI, input, audio | ~2.6k | **Rebuild** in Razor UI (`.razor` panels) and s&box sound events; logic (achievements, recorder, discoveries) ports directly | Medium |
| `web/public/music`, `audio`: the soundtrack (levelled to -18 LUFS) and effects | | **Reuse** as sound files and events | None |
| `web/functions/api`: the Cloudflare D1 leaderboard | small | Either keep it, called over HTTP from s&box, or move to s&box's own stats and leaderboards | Small |
| `web/tools/`: pilots, audits, screenshot tooling | | Pilots and audits become **C# tests** run against the ported sim (same scenarios, same pass bars) | Medium |

The repo root already has an early s&box project (`Code/`, `Assets/`, `farfromthetree.sbproj`) from the first three-neighbourhood plan: `LeafController`, `WindZone`, `CityGridGenerator`. Treat it as a scratchpad. The web game's systems replaced every one of those ideas. Start the real port from a fresh project, and keep the old code only for reference.

---

## 2. How the web game is built

```
web/
  src/core/     rng.ts: seeded integer hashes and value noise (everything random goes through these)
  src/world/    THE RULES. Pure TypeScript, no renderer, no browser:
                data.ts        CityData: buildings, streets, route, subway, spatial grids, Polyline
                course.ts      the course (tree to Sheep Meadow), streetPath (Dijkstra over streets)
                airflow.ts     Airflow.sample(x,y,z,t) -> wind + lane + flags: THE core of the game
                windFeatures.ts  currents ("jets"), the ways through, false leads, dust devils, lees
                underground.ts tunnels as a signed-distance field, stations, stairs, shafts, trains
                blockers.ts    street closures (water main, festival, market, Times Sq, parade)
                rain.ts, park.ts, traffic.ts, crowd.ts, streetlife.ts, facades.ts, landmarks.ts ...
  src/sim/      glider.ts: the leaf (fixed 120 Hz step: aero, the catch, collisions, damage, death)
                pilot.ts: the autopilot used by the title screen and the tests
  src/render/   three.js only: everything you see, nothing that decides what happens
  src/game/     the shell: HUD, input, audio, menus, achievements, leaderboard, intro/ending films
  functions/    Cloudflare Pages Functions: /api/scores, /api/run (D1)
  tools/        build-city, pilots, audits, Blender/Tesseract pipelines, screenshot tooling
```

**The game loop:** each frame runs N fixed steps of `Glider.step(1/120, input)`. Each step samples `Airflow.sample` at the leaf, applies aerodynamics and the "catch" (how much the air drags the leaf along), then collides against buildings, props, the tunnel SDF and closures. The renderer reads the leaf's state afterwards. In s&box that maps directly to a Component with `OnFixedUpdate` and a fixed timestep of 120 Hz, or 60 Hz with 2 substeps.

---

## 3. Coordinates and units

| | Web (three.js) | s&box (Source 2) |
|---|---|---|
| Up axis | +Y | +Z |
| Handedness | right-handed | right-handed |
| Units | metres | inches (1 m = 39.3701 units) |
| City frame | local metres from `meta.origin` (lat 40.7033, lon -74.017), rotated `gridDeg` 28.9°, so avenues run along ±z and **uptown is +z** | |

**Conversion:**
- **Position:** `S = (x, -z, y) × 39.3701`. This is a proper rotation, so there's no mirroring.
- **Heading:** the web uses `heading = atan2(dx, dz)`, where 0 faces +z (uptown). In s&box, yaw 0 faces +X, so `yaw_degrees = 90 - heading_degrees`, adjusted for the axis swap. Write one helper and test it against `parity.json`.
- **Physics:** do the simulation **in metres** in the ported library, exactly as the web does, and convert only at the boundary, when you place GameObjects and the camera. All tuning tables stay in metres and m/s.

---

## 4. Determinism

Every player gets the same city and the same wind. It's a speedrun track, so:
- All randomness is a pure function of position, seed or time. Nothing calls `Math.random()` in the rules, and the build check enforces this.
- Hashes are **integer** (`Math.imul`, shifts, `>>> 0`). In C#, use `uint` arithmetic with `unchecked` and shift-right on `uint`. `Math.imul(a, b)` is `(int)((uint)a * (uint)b)`.
- **Never** use float sin-hashes (`fract(sin(x) * 43758.5453)`): the last bits differ between JS engines and .NET, so the world would drift. The build check rejects them.
- JS numbers are float64. Port to `double` in the simulation library (not `float`) and the parity samples will match to 4 decimal places. Cast to `float` only at the engine boundary.
- `Polyline` stores `Float32Array`s. Mirror that with `float[]` for the stored points, and do the arithmetic in `double`, the same as JS does.

---

## 5. The export: `web/export/sbox/`

Generate it with `npm run sbox:export` (from `web/`). Re-run it after any gameplay change, and commit the output.

| File | What it holds | Use in the port |
|---|---|---|
| `tuning.json` | conventions plus every tuning table: `FLIGHT`, `AIR`, `JET_GRADE`, `RAIN`, `TUNNEL`, `TRAIN`, `STAIRS`, `VENT`, `PLATFORM`, `CAP`, `LANE`, `PARK` | load at startup, or paste in as C# constants |
| `ways.json` | the course (tree, start, meadow box, street path) and the ways through (West Side, East Side, Rooftops) with heights | data for the first playable build, before `windFeatures` is ported |
| `currents.json` | every current: kind, grade, radius, speed, points; flags for way links and false leads | same: load them prebuilt, port the generator later |
| `closures.json` | street closures and their barriers | collision and art placement |
| `subway.json` | the tunnel line, and every entrance and exit with its entry/exit stream paths | the tunnel build and the streams |
| `parity.json` | **the oracle**: wind samples at ~350 fixed points and times (street, canyon, roofs, beside the way, underground), and a 90 s scripted flight from the tree (the leaf every 0.5 s) | C# tests: port until these match |

**Two ways to port:**
- **Fast:** load the derived JSON (ways, currents, closures, subway) and port only `Airflow.sample` and `Glider.step` first.
- **Faithful:** port the generators too, then check they reproduce the JSON exactly.

Do the fast way first, to get the game flying in s&box early.

---

## 6. Port order (milestones)

1. **Flying in the city:**
   - load `city.json`;
   - extrude the building footprints as simple blocks;
   - port `core/rng`, `world/data` (CityData, Polyline, grids) and `sim/glider`;
   - start with a stub `Airflow` returning a steady uptown breeze;
   - add a camera that follows the leaf.

   Pass: the flight parity matches with the stubbed wind turned off on both sides.
2. **The wind:** port `airflow.ts` and load the currents from `currents.json`. Pass: every `parity.json` wind sample matches.
3. **The subway:**
   - port `underground.ts` (the SDF, stations, shafts, entry and exit streams) and the trains;
   - use the SDF for collision, not mesh colliders: it's exact and cheap;
   - build the tunnel art from the same line.
4. **Closures, rain and the park:** `blockers.ts`, `rain.ts` and `park.ts` (puddles, wetness).
5. **The game shell:**
   - Razor UI: the HUD (timer, route bar, leaf meter), the pause menu, the title, the album, the leaderboard;
   - sound events and the music layers (the two-deck crossfade becomes s&box music playback with fades);
   - achievements, with the pixel polaroids reused as UI images.
6. **The look:**
   - Blender assets re-exported;
   - Tesseract textures turned into materials;
   - Chinatown, Central Park and the landmarks;
   - the facades: replace the web's procedural facade atlases with real materials, or port the generator to write textures at build time;
   - people, traffic and pigeons, using engine animation.
7. **Tests:**
   - port `tools/pilots.ts` as headless C# tests: roofs, subway, west and east;
   - the same pass bars: each route winnable, and Rooftops planting at least 1 run in 3.
8. **Ship:** Steam page, achievements mapped to Steam achievements, and the leaderboard.

---

## 7. Keeping the web code portable

**Enforced by `npm run build`** (`web/tools/sbox/portable-check.ts`). Code in `src/world`, `src/sim` and `src/core` may not:
- import three.js (the leaf's `Vector3`/`Quaternion` in `glider.ts` is the one allowed exception);
- import from `src/render` or `src/game`;
- touch browser APIs (`window`, `document`, `localStorage`, `performance.now` and so on);
- use `Math.random()` or float sin-hashes.

**Known debts:** gameplay data that grew up in render files. These are allow-listed in the check; move them into `src/world` before the port, then delete their allow lines:
- `render/centralPark.ts`: the park collider layout (`parkLayout`, `colliderGrid`, `collideParkColliders`). Used by `airflow.ts` and `glider.ts`.
- `render/streetLayout.ts`: street furniture colliders and signal timing (`streetLayout`, `SIGNAL`, `signalState`). Used by `airflow.ts` and `crowd.ts`.
- `render/facades.ts`: `TILES`, the facade tile metrics used by the world's facade ledges. Used by `world/facades.ts`.

**Conventions to keep:**
- **Tuning lives in named, exported tables** (`FLIGHT`, `AIR`, `RAIN`, …), not in magic numbers in the middle of functions. New mechanics get their own table and get added to `tools/sbox/export.ts`.
- **Content is data:** ways, currents, closures, achievements, landmarks and districts are lists of plain objects. Prefer adding an entry over adding a special case in code.
- **The simulation never reads the clock or the frame rate:** it gets `dt` and `t` passed in. The fixed 120 Hz step stays.
- **Render code reads the simulation and never writes to it.**
- **Every gameplay change** gets `npm run sbox:export` re-run, with the updated `export/sbox` committed alongside it.

---

## 8. Things that get easier in s&box

- **Streaming, LOD and culling:** the web's hand-rolled building streaming, facade texture workers, far-city loader and LOD swaps (and the hitches and pops they cause) become engine features: occlusion culling, mesh LODs, texture streaming.
- **Lighting and post:** real dynamic lights in the subway (the web fakes them), proper shadows, volumetric fog for the rain and steam, and post-processing without fighting WebGL.
- **Threading:** the wind sampling and the traffic and crowd simulation can run off the main thread.
- **Physics:** keep the custom leaf flight model, which is the game's feel. But collision queries against props can use s&box physics traces instead of the web's hand-made collider grids.

## 9. Things to watch

- **Feel first:** port `Glider.step` and `Airflow.sample` faithfully before improving anything. Tune only once the parity tests pass, or the game's feel gets lost in translation.
- **Fixed timestep:** the leaf is tuned at 120 Hz. Don't switch to a variable step.
- **Scale:** the island is about 2.3 km × 9 km. Plan scene partitioning by district: Battery/FiDi, Chinatown, Village/Union Sq, Flatiron/Midtown, Columbus Circle and the Park.
- **Phones:** the web version reaches phones and s&box doesn't. Decide whether to keep the web build alive alongside the Steam release. It's cheap to keep up if the rules stay shared in spirit.
