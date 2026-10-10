# Far From the Tree

**Play it: [farfromthetree.world](https://farfromthetree.world)**

Battery Park, late November. Every other leaf in the city has fallen. You're the last one: let go,
ride the wind uptown through Manhattan and plant your seed in Central Park.

A speedrun-flavoured leaf-flight game in the browser (three.js + TypeScript), built on real New York
open data: the real streets, buildings, subway line, stations and entrances along an 8.8 km route.
It runs on PC and phones (touch controls), with a global leaderboard.

## How it plays

- **Three layers.** The rooftops are slow and safe, the street is in the middle (cabs, people,
  pets, parked cars), and the subway is the fastest and deadliest (trains, rats). Closed streets
  (a burst water main, the Mulberry St festival, the Union Square market, Times Square, the
  Thanksgiving parade) force you to change layer.
- **The wind carries you.** Avenue tailwinds, cross-street gusts, gust fronts sweeping uptown,
  steam, dust devils, tower downdrafts, and 28 hidden currents graded breeze / stream / gale (a gale
  grabs you and carries you). Closed streets push warm air up and over.
- **The subway.** Dive at a way in (the downtown end of each station) and its air draws you down the
  stairs and onto the tracks; ride the tunnel's draught uptown; the ways out at the uptown end of each
  station, and the massive vents, fire you back up into the street.
- **The edge of the map** is a visible wall of wind that carries you back; over the rivers the wind
  drags you into the water.
- **Controls:** W/S dive and flare, A/D bank, Space spread (catch the wind), Shift curl (punch
  through it), Q/E corkscrew, double-tap S to loop, R to fall again, Esc to pause. On phones: a
  thumb stick under the leaf and buttons.

## Features

- Stylised Manhattan from NYC Open Data: building footprints and heights with procedural facades,
  street furniture, traffic, crowds and pets; a distant city, harbour and bridges to the horizon.
- Hand-built landmarks: Chinatown's paifang gates, lanterns and the Manhattan Bridge with its arch
  and colonnade; Central Park's south end (the Pond, Gapstow Bridge, Wollman Rink); subway stations
  with fare control, platforms and trains.
- An orchestral score (strings, horn, harp, timpani) in layers that crossfade as you change layer:
  melancholy on the street, open over the roofs, driving in the subway.
- A pixel-art intro film, a random view of the city behind the title, a pause menu with music and
  sound volumes, achievements, discoveries, a minimap, run recording and replays.
- Quality tiers: phones get a leaner city (streamed buildings, smaller textures, no far city).

## Running it locally

```
cd web
npm install
npm run dev          # http://localhost:5173
npm run build        # type-checks src and tools, then builds web/dist
```

Useful URL flags: `?nointro`, `?q=low|medium|high`, `?at=<metres along the route>,<height>`,
`?sub=<metres along the subway>`, `?cam=x,y,z,yawDeg,pitchDeg` (free camera), `?fly=1` (autopilot).

## Deploying

`web/` deploys to Cloudflare Pages on every push to `main` (build `npm run build`, output `dist`,
Node 22). The leaderboard is a Pages Function (`web/functions/api`) on a D1 database bound as `DB`;
runs get a server-side ticket so a submitted time can't beat the real clock.

## Repo layout

```
web/
  src/
    main.ts            the game loop, camera, wiring
    sim/               the leaf (glider.ts) and the test pilots (pilot.ts)
    world/             city data, the wind (airflow.ts, windFeatures.ts), the subway (underground.ts),
                       traffic, crowds, blockers
    render/            everything drawn: buildings and facades, far city, streets, subway, Chinatown,
                       Central Park, people, effects
    game/              HUD, audio and music, pause menu, touch controls, tutorial, leaderboard
  functions/api/       the leaderboard (Cloudflare Pages Functions + D1)
  public/              city data, models, textures, sounds, music, the intro film
  tools/               the asset pipelines and the test tools (below)
  results/             bot playtest reports
```

### Asset pipelines (web/tools)

- `build-city.ts` turns the NYC Open Data downloads into `public/city.json` and `public/far.dat`.
- `chinatown/`, `park/`, `entrances/`, `subway/`, `street/`, `people/`, `vehicles/`, `buildings/`:
  textures authored as Tesseract compositions and models built by headless Blender (run at idle
  priority).
- `audio/`: the sound library, synthesised in Python.
- `music/`: the score, written as code (`compose.py`) and played with the
  [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) orchestral samples (CC0,
  downloaded to `samples/`, not in git); `export.py` writes `public/music`.
- `cutscene/`: the intro film.

### Test tools

- `play.ts`: many full runs by human-like bot pilots in parallel (low priority), reported in
  `results/`.
- `entry-approach.ts`, `exit-test.ts`: can a leaf get into and out of the subway.
- `pilot-trace.ts`, `wind-features.ts`, `in-out-gap.ts` and others: traces and checks.
- `shot.ps1`: headless screenshots of any game URL.

## Credits

Map data: NYC Open Data (OTI, DOT, Parks, MTA); distant city and New Jersey © OpenStreetMap
contributors. Buildings are styled, not copied. Orchestral samples: VSCO 2 Community Edition (CC0).

The first prototype was an s&box (C#) project; its files (`Assets/`, `Code/`, `Editor/`,
`farfromthetree.sbproj`) are still in the repo but the game is now the web version in `web/`.
