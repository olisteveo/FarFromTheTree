# Far From the Tree: web build design

The working design for the three.js build. It follows the game plan
(`far-from-the-tree-plan.html`) and the POC plan, plus Oliver's calls since.
Later this ports to s&box: the world data and tuning are engine-agnostic on purpose.

## The game in one breath

You are the last leaf on a tree in Battery Park. Let go, ride the wind up Broadway
through the Financial District, Chinatown, SoHo, Union Square, the Flatiron, Herald
Square and Times Square to Central Park, and plant your seed in Sheep Meadow. One
life. A millisecond timer from the moment you let go. R restarts instantly.

## Season and mood

The end of autumn, turning to winter. You were the last leaf on the last tree in
Battery Park; every other tree in the city is bare and it is getting colder. Low,
cold late-November sun (pale gold light, blue shade), breath-thick steam from every
vent, old brown leaves in the gutters. The city is a concrete jungle: apart from
Battery Park and Central Park, the old parks are building sites, and street trees are
sparse and bare. The seed must be planted on open ground in Central Park (a tree
can't grow on top of another tree).

## Real Manhattan

The city is built from NYC Open Data, not invented:

- Building footprints with real roof heights and construction years (5,172 buildings
  in a 760 m corridor along the route, plus 6,000 tall towers for the skyline).
- Street centrelines with traffic direction, widths and lanes; roadbed, sidewalk,
  median, plaza and park polygons; the shoreline; 27,000 street trees.
- Subway stations and the real entrance stairs for the Broadway line.

Buildings are styled from their year and height (brick tenements, SoHo cast iron,
prewar masonry, art deco, mid-century curtain walls, glass towers), but none copies
a real building's design and there are no real brands. Credit: NYC Open Data.

The route is a polyline up Broadway. Its arc length `s` (0 at the tree, ~8.6 km at
the seed spot) is the authoring coordinate for blockers, events and progress.

## Three layers

| Layer | Speed | Danger | Wind |
|---|---|---|---|
| **Rooftops** | slowest (~4-5 m/s along the route) | safest | strong but swirling crosswinds off the Hudson, gusts that push you back; thermals keep you up |
| **Street** | middle (~9-12 m/s) | middle | avenue canyons channel the wind uptown; side streets blast across at intersections; slipstreams behind cabs, buses and trucks; dangers: puddles, open manholes, traffic |
| **Subway** | fastest (~20-30 m/s) | deadliest | the trains' piston wind: a constant tailwind plus huge surges ahead of each train |

**Layer drops are the core choice.** Height becomes speed: a dive from a roof into
the street canyon converts altitude into a burst, and dropping through a grate or
stair from the street into the tunnel gives the biggest, riskiest boost. Some places
let you go roof to street to subway in one dive.

**Going up:** steam vents, AC exhaust, subway grates when a train passes, the stairs'
updraft, rooftop thermals, wind deflecting up building faces.
**Going down:** roof gaps and edges, curling into a dive, grates and stairs.

**Blockers force layer changes.** Each section closes one layer at least once, so no
single layer goes the whole way. Authored by `s`:

| Section | Blocker |
|---|---|
| Battery Park | Tutorial: street only, then the first choices at Bowling Green |
| Financial District | Roofs: the towers are too tall to stay over. Street: a water main break on Broadway throws a 9 m curtain of spray across it (hop it high, or duck into the subway). |
| City Hall / Chinatown | Street: the festival lantern canopy and crowds on Mott St. Up to the low roofs or down at Canal St. |
| SoHo | Subway: Prince St is flooded (water main break). Up the vent. |
| Union Sq / Flatiron | Street: the Union Square Holiday Market's stalls and strings of lights close 14th St to Broadway (8 m). Roofs: the square itself is open, nothing to stand on. The Flatiron wind (23rd St) is a street-level gift. |
| Herald / Times Sq | Street: the Times Square crowds and the TKTS steps. Roofs or subway. |
| Columbus Circle | Subway: the line ends at 57 St. Roofs: Billionaires' Row is too tall. The street takes you into the park, over the Thanksgiving parade's 7 m barriers and under (or round) its giant turkey balloon, which boings you away. |
| Central Park | Canopy, lawn and paths. Kids and dogs. Plant the seed. |

## Flight model (the whole game)

An arcade glider in moving air, built to feel like a leaf, not a plane:

- **Airspeed and energy.** The leaf has its own airspeed along its nose. Diving trades
  height for airspeed and flaring trades it back for height. A drop becomes speed.
- **Catch.** The air carries the leaf: its velocity eases toward the local wind.
  *Spread* (Space) catches hard and floats; *curl* (Shift) barely catches, drops fast
  and punches through headwinds. Riding a tailwind means spreading; crossing a
  crosswind or diving through a gap means curling.
- **Bank to turn.** A/D banks; the turn rate grows with bank and shrinks with speed.
- **Surf.** Angling across a strong stream converts some of the push into speed along
  your heading (the plan's "tilt boosting"). Skill, not a button.
- **Integrity.** Impacts tear the leaf: it gets heavier, flutters and turns worse.
  Shown on the leaf itself (tears, browning), never as a health bar.
- **Readable wind.** Wind streaks show strength and direction (gold tailwind, blue
  headwind, white updraft). Steam, litter, flags and drifting leaves all tell the
  same story. The camera leans toward the wind ahead.

## Tutorial (Battery Park)

The run's timer starts only when you leave the park, so the tutorial costs nothing.
It is skippable, and skipped automatically once you've done it. Each step waits
for you to do the thing:

1. **Let go.** Any key. The leaf drops off the branch.
2. **Bank.** A/D to turn toward the harbour breeze.
3. **Ride.** Fly into the golden stream; the wind carries you.
4. **Spread.** Hold Space over the steam vent to rise.
5. **Curl and dive.** Hold Shift and W to drop fast, then S to flare out of it.
6. **Three ways uptown.** At Bowling Green: the roofs (slow, safe), the street,
   or the subway stairs (fastest, deadliest).

## Look

PS2 Spider-Man 2 as the floor, with modern light on top:

- Textured facades per style with real window grids, storefront bands, cornices, roof
  parapets and clutter (water towers, bulkheads, HVAC).
- Streets from the real roadbed with lane markings, crosswalks, curbs and sidewalks.
- Yellow cabs, buses and trucks in traffic on the real one-way streets.
- Late-November golden hour from the west, the sun kept out of the player's face
  (north heading puts it on the left). No blinding sun disc; cold blue shade, light
  shafts down the cross streets.
- Per-district grade: FiDi cold steel, Chinatown warm red, Midtown neon, the park gold.
- Subway: tiled tunnels, I-beam columns, station platforms, flickering fluorescents.

## Tech

- `tools/osm/*`: data download (NYC Open Data) and `tools/build-city.ts` for the
  conversion to `public/city.json` (local metres, grid-aligned: +z is uptown).
- `src/world`: the city model, route, wind field and lanes (no three.js; the
  headless bot and the s&box exporter use it too).
- `src/sim`: the leaf.
- `src/render`: meshes, materials, sky and post.
- `src/game`: loop, camera, input, HUD, tutorial, audio.
- `tools/fly.ts`: headless test flights per layer (regression for feel and speeds).
