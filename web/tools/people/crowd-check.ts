// Headless checks for the sidewalk crowd (src/world/crowd.ts):
//   npx tsx tools/people/crowd-check.ts [x,z] [range]
// Build time, counts by role, update cost, and sanity: nobody in a building or the road,
// no teleports frame to frame, how often two people overlap.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CityData, inPoly } from "../../src/world/data";
import { Airflow } from "../../src/world/airflow";

const here = path.dirname(fileURLToPath(import.meta.url));
const city = new CityData(JSON.parse(fs.readFileSync(path.join(here, "../../public/city.json"), "utf8")));
const flow = new Airflow(city);
const crowd = flow.crowd;
let t0 = performance.now();
crowd.attach(city, { street: flow.streetLayout });
console.log(`attach ${(performance.now() - t0).toFixed(0)} ms, ${crowd.walkers.length} people, ${crowd.props.length} props`);
const roles: Record<string, number> = {};
for (const w of crowd.walkers) roles[w.role ?? "?"] = (roles[w.role ?? "?"] ?? 0) + 1;
console.log(roles);

const ts = city.raw.landmarks.timesSquare;
const arg = process.argv[2]?.split(",").map(Number);
const spots: [string, number, number][] = arg ? [["arg", arg[0], arg[1]]] : [
  ["Times Sq", ts[0], ts[1] - 160], ["Flatiron", ...(city.raw.landmarks.flatiron as [number, number])], ["Chinatown", -500, 1950],
  ["route 3000", city.route.at(3000).x, city.route.at(3000).z],
];
const range = Number(process.argv[3] ?? 170);
const side = city.raw.sidewalk;
for (const [name, x, z] of spots) {
  const T = 123.4;
  t0 = performance.now();
  for (let i = 0; i < 20; i++) crowd.update(T + i / 60, x, z, range);
  const ms = (performance.now() - t0) / 20;
  const prev = new Map<number, { x: number; z: number }>();
  for (const s of crowd.now) prev.set(s.w.seed, { x: s.x, z: s.z });
  crowd.update(T + 20 / 60 + 1 / 60, x, z, range);
  let jumps = 0, maxJ = 0, inB = 0, onWalk = 0, n = 0, over = 0, moving = 0;
  const acts: Record<string, number> = {};
  for (const s of crowd.now) {
    acts[s.act] = (acts[s.act] ?? 0) + 1;
    const p = prev.get(s.w.seed);
    if (p) { const d = Math.hypot(s.x - p.x, s.z - p.z); maxJ = Math.max(maxJ, d); if (d > 0.2) jumps++; }
    if (s.w.role === "fan" || s.w.wander) continue;
    n++;
    if (city.buildingAt(s.x, s.z)) inB++;
    if (side.some((poly) => inPoly(poly, s.x, s.z))) onWalk++;
    if (s.v > 0.1) moving++;
  }
  for (const s of crowd.now) for (const o of crowd.grid.at(s.x, s.z)) if (o !== s && o.w.seed < s.w.seed && o.w.group !== s.w.group && Math.hypot(o.x - s.x, o.z - s.z) < 0.45) over++;
  console.log(`${name}: ${crowd.now.length} placed (${moving} walking) in ${ms.toFixed(2)} ms; on sidewalk ${(onWalk / Math.max(1, n) * 100).toFixed(1)}%, in buildings ${inB}; jumps>0.2m ${jumps} (max ${maxJ.toFixed(2)}); overlapping pairs ${over}`, acts);
}
