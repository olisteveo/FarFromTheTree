// Do the landmark achievements actually unlock? For every landmark in world/landmarks.ts: drop a leaf
// just above its landing spot (and a few points around it, at different times of the wind), let it
// settle, run the Achievements update every step and check the right one unlocks. Also drops a few
// leaves on the street beside the low ones (the bull, the steps) to check those don't.
//   npx tsx tools/achievement-landings.ts [tries=8]
import fs from "node:fs";
import os from "node:os";
import { CityData, inPoly } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { Landmarks, type Landmark } from "../src/world/landmarks";
import { landmarkSolids } from "../src/render/landmarks";
import { Achievements, ACHIEVEMENTS } from "../src/game/achievements";

try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ }
const tries = Number(process.argv[2] ?? 8);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const landmarks = new Landmarks(city);
landmarkSolids(landmarks, flow.facades);

let rand = 12345;
const rnd = () => ((rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0) / 4294967296);

/** dive a leaf onto (x, y, z) the way a player would, carried by the wind: from a metre up and upwind,
 *  sinking at 6 m/s (or diving harder, at 10, if that misses) and drifting at most of the wind's speed. Fly it for a while: what unlocked, and where
 *  it ended up. (A leaf dropped dead still into a 20 m/s wind just lifts off: nobody lands like that.) */
function drop(x: number, y: number, z: number, clock: number, want = "", sink = 6) {
  const W = flow.sample(x, y + 1, z, clock, { vx: 0, vy: 0, vz: 0 } as Parameters<Airflow["sample"]>[4]);
  const vx = W.x * 0.7, vz = W.z * 0.7, fall = 1 / sink;
  const g = new Glider(city, flow, { x: x - vx * fall, y: y + 1, z: z - vz * fall, heading: Math.atan2(vx, vz) });
  g.detach();
  g.clock = clock;
  g.vel.set(vx, -sink, vz);
  const ach = new Achievements(landmarks);
  const got: string[] = [];
  ach.onUnlock = (a) => got.push(a.id);
  const dt = 1 / 120;
  for (let i = 0; i < 8 / dt && g.state === "flying"; i++) {
    g.step(dt, { pitch: i < 30 ? 1 : 0, roll: 0, spread: false, curl: false, corkscrew: 0, loop: false });
    ach.update(dt, g);
    if (want && got.includes(want)) break;
  }
  return { got, end: g.pos.clone(), state: g.state, failure: g.failure };
}

/** the points to drop on: the spot, then around it (anywhere on the roof for a building) */
function points(l: Landmark): [number, number, number][] {
  const out: [number, number, number][] = [l.spot];
  const b = l.building;
  while (out.length < tries) {
    if (b) {
      const x = b.x0 + rnd() * (b.x1 - b.x0), z = b.z0 + rnd() * (b.z1 - b.z0);
      if (inPoly(b.poly, x, z)) out.push([x, b.h + 0.5, z]);
    } else out.push([l.spot[0] + (rnd() - 0.5) * 1.2, l.spot[1], l.spot[2] + (rnd() - 0.5) * 1.2]);
  }
  return out;
}

let fails = 0;
const ids = new Set(ACHIEVEMENTS.filter((a) => a.snap).map((a) => a.id));
for (const l of landmarks.list) {
  if (!ACHIEVEMENTS.some((a) => a.id === l.id)) { console.log(`✗ ${l.id}: no achievement for this landmark`); fails++; }
  ids.delete(l.id);
  let ok = 0;
  const misses: string[] = [];
  for (const [i, p] of points(l).entries()) {
    let r = drop(p[0], p[1], p[2], i * 37.3, l.id);
    if (!r.got.includes(l.id)) r = drop(p[0], p[1], p[2], i * 37.3, l.id, 10);
    if (r.got.includes(l.id)) ok++;
    else misses.push(`(${p.map((v) => v.toFixed(1)).join(", ")}) -> ended ${r.state} at (${r.end.x.toFixed(1)}, ${r.end.y.toFixed(1)}, ${r.end.z.toFixed(1)})${r.got.length ? ` got ${r.got}` : ""}${r.failure ? ` ${r.failure}` : ""}`);
  }
  const pass = ok >= Math.ceil(tries * 0.75);
  if (!pass) fails++;
  console.log(`${pass ? "✓" : "✗"} ${l.id.padEnd(9)} ${ok}/${tries} drops unlocked it (${l.name})`);
  for (const m of misses) console.log(`    miss ${m}`);
}
for (const id of ids) { console.log(`✗ ${id}: a snapshot achievement with no landmark`); fails++; }

// near misses: settling on the street beside the low landmarks must not count
for (const [id, dx, dz] of [["bull", 4, 0], ["bull", 0, 5], ["steps", 8, 0], ["steps", 0, -9]] as const) {
  const l = landmarks.list.find((q) => q.id === id)!;
  const r = drop(l.x + dx, 1.2, l.z + dz, 3);
  const bad = r.got.includes(id);
  if (bad) fails++;
  console.log(`${bad ? "✗" : "✓"} beside ${id} (${dx}, ${dz}): ${bad ? "unlocked it (shouldn't)" : "nothing"}`);
}
console.log(fails ? `${fails} problem(s)` : "all landmark achievements unlock");
process.exit(fails ? 1 : 0);
