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

**Closures force choices** (`src/world/blockers.ts`). Each one shuts the street layer up to the
roofline and sends you over the roofs, under through the subway, or round by another street. They
must make sense in the city, and they never cut one of the main ways through (below). Where a way
has to cross one, a tight emergency lane stays open.

| Where | Closure |
|---|---|
| Battery Park | Tutorial: street only, then the first choices at Bowling Green |
| Broadway, FiDi | A water main break: a geyser (about 26 m) from a crater, fenced by the crews' MDF hoarding, with FDNY, DEP and NYPD trucks. Its column and fall of spray soak you and blast you back. It sits over the subway, so going under is the way past. |
| Centre St (courthouses) and E 15th (off Union Sq) | Building sites: the scaffold and netting stay on the building, with a tower crane. The street is shut by a sidewalk-shed deck, hoarding and jersey barriers. Above it the concrete pump's boom, the crane's cable and its swinging load are solid. |
| Mulberry St | The festival: curtains of lanterns wall to wall up to the roofline. They snag and tear. |
| Times Square | Packed: NYPD and DSNY trucks, barricades stacked three high, and a web of lights and holiday banners up to 36 m. |
| Columbus Circle | The Thanksgiving parade: grandstands, sawhorses, bunting, and the giant turkey balloon. |
| Central Park | Rain, puddles, kids and dogs. Plant the seed in Sheep Meadow. |

## The ways through, currents and crosswinds

The wind is the level design (`src/world/airflow.ts`, `src/world/windFeatures.ts`).

- **A few set ways through:**
  - **the Rooftops**, along the course path above the roofline;
  - **the West Side** and **the East Side**, at street level (16 m) along the avenues;
  - **the subway.**
- **Only on the ways does the air carry you uptown.** Off them (beyond about 60 m, fading by 140 m)
  the city's air turns across you or quartering back, in patches a few blocks wide, and slows. That
  costs you time without trapping you.
- **Currents** (jets) run along the ways in links of 160–290 m, with gaps:
  - About 64% of the Rooftops is covered, and over 80% of the side ways. There are never gaps on
    crosstown legs.
  - Grades: breeze, stream or gale.
  - A current is a fast tailwind core with a soft hold in its middle and a churning shear edge that
    throws you out. It never steers you: staying in is work, and leaving is a matter of flying for
    its edge.
- **False leads:** 28 currents peel off the ways and look just as good (streams and gales). They run
  back downtown, toward the edge of the map, or up blind streets.
- **Crosswinds:** cross streets gust across in pulses. Junction bursts (strong gusts thrown out
  across the avenue: `AIR.crossBurst`) are built but switched off until they're tuned: at 5–9 m/s
  they broke the Rooftops way.
- **The edge of the map** is a visible wall of wind that blows you back toward the city and on
  uptown. Over the rivers the air drags you into the water.
- **The subway's streams:** entrances draw you down onto the uptown track just above the train
  roofs. Exits lift you out when you turn or slow toward them.
  Tunnels curve and dip gently between stations (`subwayBend.ts`); the stations stay straight.

## Central Park and the rain

- **The rain** (`src/world/rain.ts`, `src/render/rain.ts`) builds as you enter the park.
- **Wetness** rises over time (fastest spread, slowest curled), and raindrops hit and wear the leaf.
  A wet leaf is heavier and lifts less. Past 70% wet the damage climbs, and at 100% you're soaked
  through. The leaf doesn't mend in the rain.
- **Puddles** spread over the paths after a few seconds of rain, and coming down in one drowns you.
  Each path always keeps a dry strip, and there are none near the gates or the meadow.
- **Getting back up off the grass:** in the rain a flare or spread on the ground gives a harder pop.
- **The music** switches to "The Rain" and ducks under the downpour.
- **Sheep Meadow** is ringed in soft green, with a light column. Both fade as you come down to land.

## Damage

- **Walls:** a hit harder than 4.5 m/s tears the leaf (glancing off a tunnel wall hurts less). Every
  bump shows, harmless or not: a flash at the screen's edges, a knock, and a shake of the leaf meter.
  The flash is red when it hurt.
- **Mending:** the leaf mends while you fly clean, after 4 s at 3% per second, but every hit leaves
  a scar that lowers the ceiling.
- **Trains:** a brutal hit, not instant death. Head-on from a downtown train tears 50% of the leaf,
  and the uptown train from behind 35%. They fling you along with the train and out into the gap
  between the tracks.
- **Other hazards:** cabs, washing lines, lanterns, the geyser, kids and rats.
- **Durability:** the leaf left at the finish is recorded on the leaderboard.

## Achievements

There are 27 (`src/game/achievements.ts`), most for landing on landmarks and famous spots. Each one
is a pixel-art polaroid of the moment (`tools/achievements/snapshots.py`), shown on a card when it
unlocks and collected in a pixel photo album that you open from the title screen or the pause menu.

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
- `tools/pilots.ts`: skilled bot pilots fly each way through, tree to meadow. A way must stay
  winnable; the Rooftops way should plant at least 1 run in 3.
- The s&box port: `docs/SBOX_MIGRATION.md` at the repo root. `npm run build` enforces that
  `src/world`, `src/sim` and `src/core` stay portable.
